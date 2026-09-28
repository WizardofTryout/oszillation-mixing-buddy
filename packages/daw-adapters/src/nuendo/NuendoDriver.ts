import type {
  SupportedDAW,
  TrackDescriptor,
  PluginMetadata,
  TransportState
} from '@mixing-buddy/shared-types';
import type { DAWDriver, DAWDriverEvents, MIDITransport } from '../types.js';

export interface NuendoDriverOptions {
  midiTransport?: MIDITransport;
  numChannels?: number;
}

/**
 * Driver adapter for Steinberg Nuendo and Cubase via Steinberg MIDI Remote API
 */
export class NuendoDriver implements DAWDriver {
  public readonly dawName: SupportedDAW = 'nuendo';
  public isConnected: boolean = false;

  private transport?: MIDITransport;
  private readonly numChannels: number;
  private tracks: Map<string, TrackDescriptor> = new Map();
  private listeners: Set<DAWDriverEvents> = new Set();

  constructor(options: NuendoDriverOptions = {}) {
    this.transport = options.midiTransport;
    this.numChannels = options.numChannels ?? 16;
    this.initializeDefaultTracks();
  }

  private initializeDefaultTracks(): void {
    for (let i = 0; i < this.numChannels; ++i) {
      const id = `track_${i + 1}`;
      this.tracks.set(id, {
        id,
        index: i,
        name: i === 0 ? 'Stereo Out' : `Channel ${i + 1}`,
        type: i === 0 ? 'master' : 'audio',
        volumeDb: 0.0,
        pan: 0.0,
        isMuted: false,
        isSoloed: false,
        isSelected: i === 0,
        insertSlots: []
      });
    }
  }

  public async connect(): Promise<boolean> {
    if (!this.transport) {
      // Create mock / loopback transport if none provided
      this.transport = this.createDefaultTransport();
    }

    this.transport.onMessage = (bytes) => this.handleIncomingMIDI(bytes);
    this.isConnected = true;
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
    return Array.from(this.tracks.values());
  }

  public async setTrackVolume(trackId: string, volumeDb: number): Promise<void> {
    const track = this.tracks.get(trackId);
    if (!track) throw new Error(`Track ${trackId} not found in Nuendo driver.`);

    // Clamp volume to safety boundaries [-96.0 dB, +6.0 dB]
    const clampedDb = Math.max(-96.0, Math.min(6.0, volumeDb));
    track.volumeDb = clampedDb;

    // Convert dB to normalized 14-bit fader value (Nuendo standard fader curve approximation)
    // 0 dB is at ~0.75 in typical DAW faders, +6 dB at 1.0, -96 dB at 0.0
    const normalized = Math.pow(10, clampedDb / 40.0) * 0.75;
    const clampedNorm = Math.max(0.0, Math.min(1.0, normalized));
    const value14Bit = Math.round(clampedNorm * 16383);

    const msb = (value14Bit >> 7) & 0x7f;
    const lsb = value14Bit & 0x7f;

    const channelIndex = track.index % this.numChannels;
    // Send 14-bit CC: CC channelIndex (MSB) + CC channelIndex + 32 (LSB) on MIDI channel 1 (0xB0)
    this.sendMIDI([0xb0, channelIndex, msb]);
    this.sendMIDI([0xb0, channelIndex + 32, lsb]);

    this.notifyTrackListChanged();
  }

  public async setTrackPan(trackId: string, pan: number): Promise<void> {
    const track = this.tracks.get(trackId);
    if (!track) throw new Error(`Track ${trackId} not found in Nuendo driver.`);

    const clampedPan = Math.max(-1.0, Math.min(1.0, pan));
    track.pan = clampedPan;

    // Pan CC: 0..127 (64 = Center)
    const midiValue = Math.round(((clampedPan + 1.0) / 2.0) * 127);
    const channelIndex = track.index % this.numChannels;
    this.sendMIDI([0xb0, 16 + channelIndex, midiValue]);

    this.notifyTrackListChanged();
  }

  public async setTrackMute(trackId: string, muted: boolean): Promise<void> {
    const track = this.tracks.get(trackId);
    if (!track) throw new Error(`Track ${trackId} not found in Nuendo driver.`);

    track.isMuted = muted;
    const channelIndex = track.index % this.numChannels;
    // Note On 16 + channelIndex with velocity 127 (muted) or 0 (unmuted)
    this.sendMIDI([0x90, 16 + channelIndex, muted ? 127 : 0]);

    this.notifyTrackListChanged();
  }

  public async inspectPluginSlot(trackId: string, slotIndex: number): Promise<PluginMetadata | null> {
    const track = this.tracks.get(trackId);
    if (!track) return null;
    return track.insertSlots[slotIndex] ?? null;
  }

  public async setPluginParameter(
    trackId: string,
    slotIndex: number,
    paramName: string,
    targetValue: number,
    unit: string = ''
  ): Promise<void> {
    const track = this.tracks.get(trackId);
    if (!track) throw new Error(`Track ${trackId} not found.`);

    // Map through Steinberg Focused Quick Controls (knobs 0..7)
    const qcIndex = slotIndex % 8;
    const norm = Math.max(0.0, Math.min(1.0, targetValue));
    const value14Bit = Math.round(norm * 16383);
    const msb = (value14Bit >> 7) & 0x7f;
    const lsb = value14Bit & 0x7f;

    // Send Quick Control 14-bit CC: CC 48+q (MSB) and CC 80+q (LSB)
    this.sendMIDI([0xb0, 48 + qcIndex, msb]);
    this.sendMIDI([0xb0, 80 + qcIndex, lsb]);

    // Update track slot metadata cache
    if (!track.insertSlots[slotIndex]) {
      track.insertSlots[slotIndex] = {
        slotIndex,
        pluginName: 'VST3 Insert Plugin',
        format: 'vst3',
        isBypassed: false,
        parameters: []
      };
    }

    const slot = track.insertSlots[slotIndex]!;
    let param = slot.parameters.find((p) => p.name === paramName);
    if (!param) {
      param = {
        id: `qc_${qcIndex}`,
        name: paramName,
        currentValue: targetValue,
        minValue: 0.0,
        maxValue: 1.0,
        displayValue: `${targetValue.toFixed(2)} ${unit}`,
        unit
      };
      slot.parameters.push(param);
    } else {
      param.currentValue = targetValue;
      param.displayValue = `${targetValue.toFixed(2)} ${unit}`;
    }

    this.notifyTrackListChanged();
  }

  public async playRegion(startBar: number, endBar: number): Promise<void> {
    // CC 116 (Cycle / Loop active)
    this.sendMIDI([0xb0, 116, 127]);
    // CC 114 (Play Start)
    this.sendMIDI([0xb0, 114, 127]);

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
    // CC 115 (Stop)
    this.sendMIDI([0xb0, 115, 127]);
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

  private handleIncomingMIDI(bytes: Uint8Array): void {
    if (bytes.length < 3) return;
    const status = bytes[0] & 0xf0;
    const data1 = bytes[1];
    const data2 = bytes[2];

    // Fader feedback from Nuendo (CC 0-15)
    if (status === 0xb0 && data1 < 16) {
      const trackId = `track_${data1 + 1}`;
      const track = this.tracks.get(trackId);
      if (track) {
        const norm = data2 / 127.0;
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
      send: (_bytes) => {},
      close: () => {}
    };
  }
}
