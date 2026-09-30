import type {
  SupportedDAW,
  TrackDescriptor,
  PluginMetadata,
  TransportState
} from '@mixing-buddy/shared-types';
import type { DAWDriver, DAWDriverEvents, MIDITransport } from '../types.js';
import { MacOSAccessibilityClient } from './macos_ax_client.js';
import {
  findParameterSpecification,
  findPluginSpecification,
  formatDisplayValue
} from './transformers.js';

export interface LogicProDriverOptions {
  midiTransport?: MIDITransport;
  numChannels?: number;
  accessibilityClient?: MacOSAccessibilityClient;
}

/**
 * Driver adapter for Apple Logic Pro via hybrid Mackie Control Universal (MCU) + macOS Accessibility
 * with Studio Buddy plugin specifications (ChannelEQ.json / Compressor.json) and mathematical curve transformers.
 */
export class LogicProDriver implements DAWDriver {
  public readonly dawName: SupportedDAW = 'logic_pro';
  public isConnected: boolean = false;

  private transport?: MIDITransport;
  private readonly numChannels: number;
  private readonly axClient: MacOSAccessibilityClient;
  private tracks: Map<string, TrackDescriptor> = new Map();
  private listeners: Set<DAWDriverEvents> = new Set();

  constructor(options: LogicProDriverOptions = {}) {
    this.transport = options.midiTransport;
    this.numChannels = options.numChannels ?? 8;
    this.axClient = options.accessibilityClient ?? new MacOSAccessibilityClient();
  }

  private findOrCreateTrack(idOrName: string): TrackDescriptor {
    let track = this.tracks.get(idOrName);
    if (track) return track;
    for (const t of this.tracks.values()) {
      if (t.name.toLowerCase() === idOrName.toLowerCase() || t.id.toLowerCase() === idOrName.toLowerCase()) {
        return t;
      }
    }
    const isMaster = idOrName.toLowerCase().includes('stereo') || idOrName.toLowerCase().includes('master');
    const newTrack: TrackDescriptor = {
      id: idOrName,
      index: this.tracks.size,
      name: idOrName,
      type: isMaster ? 'master' : 'audio',
      volumeDb: 0.0,
      pan: 0.0,
      isMuted: false,
      isSoloed: false,
      isSelected: false,
      insertSlots: [] // populated live by AX plugin-window scan
    };
    this.tracks.set(idOrName, newTrack);
    return newTrack;
  }

  public async connect(): Promise<boolean> {
    if (!this.transport) {
      this.transport = this.createDefaultTransport();
    }

    this.transport.onMessage = (bytes) => this.handleIncomingMCU(bytes);
    this.isConnected = true;

    // Try synchronizing track names via macOS Accessibility in background
    this.axClient.queryMixerChannels().then((scanned) => {
      if (scanned.length > 0) {
        for (const s of scanned) {
          if (s.id && this.tracks.has(s.id)) {
            const existing = this.tracks.get(s.id)!;
            existing.name = s.name ?? existing.name;
          }
        }
        this.notifyTrackListChanged();
      }
    }).catch(() => {});

    this.notifyTrackListChanged();
    return true;
  }

  public async disconnect(): Promise<void> {
    if (this.transport) {
      this.transport.close();
      this.transport = undefined;
    }
    this.isConnected = false;
  }

  public async getTrackList(): Promise<TrackDescriptor[]> {
    // If no MCU stream data yet, try AX track scan
    if (this.tracks.size === 0) {
      const scanned = await this.axClient.scanLogicTracks();
      for (const t of scanned) {
        this.tracks.set(t.id, t);
      }
    }

    // Merge live plugin-window data into track insertSlots (Hybrid Path)
    try {
      const openPlugins = await this.axClient.scanOpenPluginWindows();
      for (const { trackName, plugin } of openPlugins) {
        let target: TrackDescriptor | undefined;

        // Match by explicit track name in window title
        if (trackName) {
          for (const t of this.tracks.values()) {
            if (t.name.toLowerCase() === trackName.toLowerCase()) {
              target = t;
              break;
            }
          }
        }

        // Fallback: assign to selected track or first audio track
        if (!target) {
          target =
            [...this.tracks.values()].find((t) => t.isSelected) ??
            [...this.tracks.values()].find((t) => t.type !== 'master');
        }

        if (target) {
          const existingIdx = target.insertSlots.findIndex(
            (s) => s?.pluginName?.toLowerCase() === plugin.pluginName.toLowerCase()
          );
          const slotIndex = existingIdx >= 0 ? existingIdx : target.insertSlots.length;
          target.insertSlots[slotIndex] = { ...plugin, slotIndex };
        }
      }
    } catch {
      // AX scan is non-blocking; failure does not affect track list
    }

    return Array.from(this.tracks.values());
  }

  public async setTrackVolume(trackId: string, volumeDb: number): Promise<void> {
    const track = this.findOrCreateTrack(trackId);

    const clampedDb = Math.max(-96.0, Math.min(6.0, volumeDb));
    track.volumeDb = clampedDb;

    // MCU Faders use 14-bit Pitch Bend messages: 0xE0 + channel (0..7)
    // 0 dB is at pitch bend value 12288 (out of 16383)
    const normalized = Math.pow(10, clampedDb / 40.0) * 0.75;
    const clampedNorm = Math.max(0.0, Math.min(1.0, normalized));
    const value14Bit = Math.round(clampedNorm * 16383);

    const lsb = value14Bit & 0x7f;
    const msb = (value14Bit >> 7) & 0x7f;
    const ch = track.index % 8;

    this.sendMIDI([0xe0 + ch, lsb, msb]);
    await this.axClient.setChannelFader(track.name, clampedDb).catch(() => false);
    this.notifyTrackListChanged();
  }

  public async setTrackPan(trackId: string, pan: number): Promise<void> {
    const track = this.findOrCreateTrack(trackId);

    const clampedPan = Math.max(-1.0, Math.min(1.0, pan));
    track.pan = clampedPan;

    // MCU V-Pot Pan: CC 16..23, values 1..127 (64 = center)
    const midiValue = Math.round(((clampedPan + 1.0) / 2.0) * 127);
    const ch = track.index % 8;

    this.sendMIDI([0xb0, 16 + ch, midiValue]);
    await this.axClient.setChannelPan(track.name, clampedPan).catch(() => false);
    this.notifyTrackListChanged();
  }

  public async setTrackMute(trackId: string, muted: boolean): Promise<void> {
    const track = this.findOrCreateTrack(trackId);

    track.isMuted = muted;
    const ch = track.index % 8;

    // MCU Mute: Note On 0x10 + ch (Note 16-23)
    this.sendMIDI([0x90, 16 + ch, muted ? 127 : 0]);
    this.notifyTrackListChanged();
  }

  /**
   * Inspects a plugin slot using the recursive AX client and Plugin Specification Database.
   * Reads raw AXValues and transforms them into true audio display values (Hz, dB, ms, :1).
   */
  public async inspectPluginSlot(trackId: string, slotIndex: number): Promise<PluginMetadata | null> {
    const track = this.findOrCreateTrack(trackId);
    const existingSlot = track.insertSlots[slotIndex];

    // 1. Live recursive AX inspection
    const live = await this.axClient.inspectPluginWindow(
      track.name,
      slotIndex,
      existingSlot?.pluginName
    );
    if (live) {
      track.insertSlots[slotIndex] = live;
      return live;
    }

    // 2. If slot exists and matches a known plugin spec (Channel EQ / Compressor), read its parameters directly
    if (existingSlot) {
      const pluginSpec = findPluginSpecification(existingSlot.pluginName);
      if (pluginSpec) {
        const refreshedParams = [];
        for (const paramSpec of pluginSpec.parameters) {
          if (paramSpec.hidden || !paramSpec.editorAX) continue;
          const readRes = await this.axClient.readPluginParameter(pluginSpec.name, paramSpec);
          if (readRes) {
            refreshedParams.push({
              id: paramSpec.id,
              name: paramSpec.label,
              currentValue: readRes.displayValue,
              minValue: paramSpec.displayMin ?? 0,
              maxValue: paramSpec.displayMax ?? 1,
              displayValue: readRes.formatted,
              unit: paramSpec.unit ?? ''
            });
          }
        }
        if (refreshedParams.length > 0) {
          existingSlot.parameters = refreshedParams;
        }
      }
      return existingSlot;
    }

    return null;
  }

  /**
   * Sets a plugin parameter on a Logic Pro track using the Plugin Specification Database
   * and bidirectional mathematical curve transformers (Logarithmic, Linear, Piecewise CurveTable).
   */
  public async setPluginParameter(
    trackId: string,
    slotIndex: number,
    paramName: string,
    targetValue: number,
    unit: string = ''
  ): Promise<void> {
    const track = this.findOrCreateTrack(trackId);

    // Resolve plugin and parameter specification from database (ChannelEQ.json / Compressor.json)
    const existingPluginName = track.insertSlots[slotIndex]?.pluginName;
    let pluginSpec = existingPluginName ? findPluginSpecification(existingPluginName) : null;
    const paramSpec = findParameterSpecification(paramName, pluginSpec) ?? findParameterSpecification(paramName);

    if (!pluginSpec && paramSpec) {
      // Infer plugin from matched parameter spec
      const eqMatch = findParameterSpecification(paramName, findPluginSpecification('Channel EQ'));
      pluginSpec = eqMatch ? findPluginSpecification('Channel EQ') : findPluginSpecification('Compressor');
    }

    const resolvedPluginName = existingPluginName || pluginSpec?.name || 'Channel EQ';

    if (!track.insertSlots[slotIndex]) {
      track.insertSlots[slotIndex] = {
        slotIndex,
        pluginName: resolvedPluginName,
        format: 'au',
        isBypassed: false,
        parameters: []
      };
    }

    const slot = track.insertSlots[slotIndex]!;
    if (pluginSpec && slot.pluginName === 'Audio Unit Plugin') {
      slot.pluginName = pluginSpec.name;
    }

    // Clamp value to parameter specification display bounds when available
    let effectiveValue = targetValue;
    if (paramSpec) {
      if (paramSpec.displayMin !== undefined) {
        effectiveValue = Math.max(paramSpec.displayMin, effectiveValue);
      }
      if (paramSpec.displayMax !== undefined) {
        effectiveValue = Math.min(paramSpec.displayMax, effectiveValue);
      }
    }

    const resolvedId = paramSpec?.id ?? `au_param_${slotIndex}_${paramName.toLowerCase().replace(/\s+/g, '_')}`;
    const resolvedLabel = paramSpec?.label ?? paramName;
    const resolvedUnit = paramSpec?.unit ?? unit;
    const formattedDisplay = paramSpec
      ? formatDisplayValue(effectiveValue, resolvedUnit, paramSpec.type)
      : `${effectiveValue.toFixed(2)}${resolvedUnit ? ' ' + resolvedUnit : ''}`;

    let param = slot.parameters.find(
      (p) =>
        p.id.toLowerCase() === resolvedId.toLowerCase() ||
        p.name.toLowerCase() === resolvedLabel.toLowerCase() ||
        p.name.toLowerCase() === paramName.toLowerCase()
    );

    if (!param) {
      param = {
        id: resolvedId,
        name: resolvedLabel,
        currentValue: effectiveValue,
        minValue: paramSpec?.displayMin ?? 0.0,
        maxValue: paramSpec?.displayMax ?? 1.0,
        displayValue: formattedDisplay,
        unit: resolvedUnit
      };
      slot.parameters.push(param);
    } else {
      param.currentValue = effectiveValue;
      param.displayValue = formattedDisplay;
      if (resolvedUnit) param.unit = resolvedUnit;
    }

    this.notifyTrackListChanged();

    // Dispatch via native Swift AXUIElement writer + mathematical curve transformer
    if (paramSpec) {
      const windowTitle = track.name || pluginSpec?.name || slot.pluginName || 'Channel EQ';
      let writeResult = await this.axClient.writePluginParameter(
        windowTitle,
        paramSpec,
        effectiveValue,
        pluginSpec
      );
      const fallbackTitle = pluginSpec?.name ?? slot.pluginName;
      if (!writeResult.success && fallbackTitle && fallbackTitle !== windowTitle) {
        writeResult = await this.axClient.writePluginParameter(
          fallbackTitle,
          paramSpec,
          effectiveValue,
          pluginSpec
        );
      }
      if (!writeResult.success) {
        const opened = await this.axClient.openInsertSlot(track.name, Math.max(1, slotIndex + 1));
        if (opened.success) {
          const targetWin = opened.openedWindow || windowTitle;
          await this.axClient.writePluginParameter(targetWin, paramSpec, effectiveValue, pluginSpec);
          if (opened.openedWindow) {
            await this.axClient.closePluginWindow(opened.openedWindow);
          }
        }
      }
    } else {
      const ok = await this.axClient.setPluginParameter(
        track.name,
        slotIndex,
        paramName,
        effectiveValue,
        slot.pluginName
      );
      if (!ok) {
        const opened = await this.axClient.openInsertSlot(track.name, Math.max(1, slotIndex + 1));
        if (opened.success) {
          await this.axClient.setPluginParameter(
            opened.openedWindow || track.name,
            slotIndex,
            paramName,
            effectiveValue,
            slot.pluginName
          );
          if (opened.openedWindow) {
            await this.axClient.closePluginWindow(opened.openedWindow);
          }
        }
      }
    }
  }

  /**
   * Create a new audio or instrument track in Logic Pro
   */
  public async createTrack(type: 'audio' | 'instrument' = 'audio', name?: string): Promise<TrackDescriptor> {
    const nextIndex = this.tracks.size;
    const trackName = name || (type === 'audio' ? `Audio ${nextIndex + 1}` : `Instrument ${nextIndex + 1}`);
    const id = `logic_track_${nextIndex + 1}`;

    const newTrack: TrackDescriptor = {
      id,
      index: nextIndex,
      name: trackName,
      type,
      volumeDb: 0.0,
      pan: 0.0,
      isMuted: false,
      isSoloed: false,
      isSelected: true,
      insertSlots: [] // plugin slots populated after AX scan once Logic opens the track
    };

    this.tracks.set(id, newTrack);
    this.notifyTrackListChanged();

    // Trigger in Logic Pro via macOS Accessibility / AppleScript
    await this.axClient.createTrack(type, trackName);

    return newTrack;
  }

  /**
   * Ensure standard plugin (Channel EQ or Compressor) is loaded on track
   */
  public async ensurePlugin(trackId: string, pluginType: 'eq' | 'compressor'): Promise<PluginMetadata> {
    const track = this.findOrCreateTrack(trackId);

    const pluginName = pluginType === 'eq' ? 'Channel EQ' : 'Compressor';
    let slot = track.insertSlots.find(
      (s) =>
        s &&
        (s.pluginName.toLowerCase().includes(pluginType) ||
          (pluginType === 'eq' && s.pluginName.toLowerCase().includes('channel eq')))
    );
    if (!slot) {
      slot = {
        slotIndex: track.insertSlots.length,
        pluginName,
        format: 'au',
        isBypassed: false,
        parameters: []
      };
      track.insertSlots.push(slot);
      this.notifyTrackListChanged();
      if (pluginType === 'eq') {
        await this.axClient.ensureChannelEQLoaded(track.name);
      }
    }
    return slot;
  }

  /**
   * Toggle bypass of Channel EQ / Plugin on target track (used for A/B auditioning)
   */
  public async togglePluginBypass(trackNameOrId: string, slotIndex: number): Promise<boolean> {
    let track = this.tracks.get(trackNameOrId);
    if (!track) {
      for (const t of this.tracks.values()) {
        if (t.name.toLowerCase() === trackNameOrId.toLowerCase()) {
          track = t;
          break;
        }
      }
    }

    if (track && track.insertSlots[slotIndex]) {
      const slot = track.insertSlots[slotIndex]!;
      slot.isBypassed = !slot.isBypassed;
      this.notifyTrackListChanged();
    }

    const targetName = track ? track.name : trackNameOrId;
    return await this.axClient.togglePluginBypass(targetName, slotIndex);
  }

  public async playRegion(startBar: number, endBar: number): Promise<void> {
    // MCU Transport: Cycle active (Note 86), Play (Note 94)
    this.sendMIDI([0x90, 86, 127]);
    this.sendMIDI([0x90, 94, 127]);

    this.notifyTransportChanged({
      isPlaying: true,
      isRecording: false,
      isLooping: true,
      currentBar: startBar,
      currentBeat: 1,
      tempoBpm: 120.0,
      timeSignature: '4/4',
      loopStartBar: startBar,
      loopEndBar: endBar
    });
  }

  public async stop(): Promise<void> {
    // MCU Transport: Stop (Note 93)
    this.sendMIDI([0x90, 93, 127]);
    this.notifyTransportChanged({
      isPlaying: false,
      isRecording: false,
      isLooping: false,
      currentBar: 1,
      currentBeat: 1,
      tempoBpm: 120.0,
      timeSignature: '4/4',
      loopStartBar: 1,
      loopEndBar: 5
    });
  }

  public subscribe(events: DAWDriverEvents): () => void {
    this.listeners.add(events);
    return () => this.listeners.delete(events);
  }

  private sendMIDI(bytes: number[]): void {
    if (this.transport) {
      this.transport.send(bytes);
    }
  }

  private handleIncomingMCU(bytes: Uint8Array): void {
    if (bytes.length < 3) return;
    const status = bytes[0] & 0xf0;
    const ch = bytes[0] & 0x0f;

    // Pitch bend (Fader move from Logic)
    if (status === 0xe0 && ch < 8) {
      const lsb = bytes[1];
      const msb = bytes[2];
      const val14 = (msb << 7) | lsb;
      const norm = val14 / 16383.0;

      const trackId = `logic_track_${ch + 1}`;
      const track = this.tracks.get(trackId);
      if (track) {
        track.volumeDb = norm > 0 ? (Math.log10(norm / 0.75) * 40.0) : -96.0;
        this.notifyTrackListChanged();
      }
    }
  }

  private notifyTrackListChanged(): void {
    const list = Array.from(this.tracks.values());
    for (const listener of this.listeners) {
      listener.onTrackListChanged?.(list);
    }
  }

  private notifyTransportChanged(transport: TransportState): void {
    for (const listener of this.listeners) {
      listener.onTransportChanged?.(transport);
    }
  }

  private createDefaultTransport(): MIDITransport {
    return {
      send: (_bytes) => {
        // Native CoreMIDI virtual port 'MixingBuddy_MCU_Out'
      },
      close: () => {}
    };
  }
}
