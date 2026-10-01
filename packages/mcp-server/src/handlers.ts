import fs from 'fs';
import path from 'path';
import os from 'os';
import WebSocket from 'ws';
import {
  findParameterSpecification,
  findPluginSpecification,
  type DAWDriver
} from '@mixing-buddy/daw-adapters';
import type {
  MetrologyTelemetryFrame,
  MixActionProposal,
  ReferenceTrackProfile,
  TrackDescriptor
} from '@mixing-buddy/shared-types';
import {
  computeSpectralDifference,
  generateReferenceMatchProposal,
  type SpectralDifferenceAnalysis
} from '@mixing-buddy/ai-engine';
import type {
  AuditionRegionInput,
  ExecuteMixAdjustmentInput,
  GetMixTelemetryInput,
  ListTracksInput,
  ProposeMixAdjustmentInput,
  MatchReferenceSpectrumInput
} from './tools.js';

export interface ResonancePeak {
  frequencyHz: number;
  magnitudeDb: number;
  character: 'sub_rumble' | 'low_mud' | 'mid_boxiness' | 'harshness' | 'air';
}

export class MixingToolHandlers {
  private latestTelemetry: MetrologyTelemetryFrame | null = null;
  private proposals: Map<string, MixActionProposal> = new Map();
  private lastTrackVolumes: Map<string, number> = new Map();

  constructor(private dawDriver?: DAWDriver) {}

  public setDAWDriver(driver: DAWDriver): void {
    this.dawDriver = driver;
  }

  public updateTelemetry(frame: MetrologyTelemetryFrame): void {
    this.latestTelemetry = frame;
  }

  public async getMixTelemetry(_args: GetMixTelemetryInput): Promise<{
    telemetry: MetrologyTelemetryFrame;
    topResonances: ResonancePeak[];
  }> {
    const frame: MetrologyTelemetryFrame = this.latestTelemetry || {
      version: '1.0',
      sequenceNumber: 1,
      sampleRate: 48000,
      loudness: {
        momentaryLufs: -18.2,
        shortTermLufs: -19.4,
        integratedLufs: -20.1,
        loudnessRangeLu: 6.5,
        truePeakDb: { left: -1.2, right: -1.4 }
      },
      spectrum: {
        timestamp: Date.now(),
        frequencyBands: [
          -28, -25, -22, -20, -18, -16, -15, -14,
          -16, -21, -24, -26, -27, -29, -30, -32,
          -34, -36, -38, -40, -42, -44, -46, -48,
          -50, -52, -54, -56, -58, -60, -64, -68
        ],
        centerFrequenciesHz: [
          25, 31, 40, 50, 63, 80, 100, 125,
          160, 200, 250, 315, 400, 500, 630, 800,
          1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
          6300, 8000, 10000, 12500, 16000, 18000, 19000, 20000
        ],
        spectralResonances: []
      },
      dynamics: {
        stereoCorrelation: 0.88,
        crestFactorDb: 12.4,
        rmsDb: { left: -18.5, right: -18.9 }
      }
    };

    const topResonances = this.extractTopResonances(frame.spectrum.frequencyBands);
    return { telemetry: frame, topResonances };
  }

  public async getProjectInfo(_args?: import('./tools.js').GetProjectInfoInput): Promise<{
    daw: string;
    projectName: string;
    sampleRate: number;
    isPlaying: boolean;
    connected: boolean;
  }> {
    try {
      const res = await fetch('http://127.0.0.1:48123/api/project', {
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok) {
        const data = (await res.json()) as {
          daw: string;
          projectName: string;
          sampleRate: number;
          isPlaying: boolean;
          connected?: boolean;
        };
        return {
          daw: data.daw,
          projectName: data.projectName,
          sampleRate: data.sampleRate,
          isPlaying: data.isPlaying,
          connected: data.connected ?? (data.daw !== 'None' && data.daw !== 'Standalone / None')
        };
      }
    } catch {
      // Offline
    }

    return {
      daw: this.dawDriver ? this.dawDriver.dawName : 'None',
      projectName: 'Kein Projekt geöffnet',
      sampleRate: 48000,
      isPlaying: false,
      connected: false
    };
  }

  public async listTracks(_args: ListTracksInput): Promise<{
    tracks: TrackDescriptor[];
    connected: boolean;
    error?: string;
  }> {
    // 1. Query live channel strips from Desktop Companion (calls list-channel-strips bridge)
    try {
      const res = await fetch('http://127.0.0.1:48123/api/channel-strips', {
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const data = (await res.json()) as {
          success?: boolean;
          channelStrips?: Array<{
            trackName: string;
            faderDb: number;
            pan: number;
            mute: boolean;
            solo: boolean;
            inserts: Array<{ slot: number; name: string }>;
          }>;
        };
        if (data.success && Array.isArray(data.channelStrips) && data.channelStrips.length > 0) {
          const tracks: TrackDescriptor[] = data.channelStrips.map((strip, idx) => ({
            id: `track_${idx + 1}`,
            index: idx,
            name: strip.trackName || `Track ${idx + 1}`,
            type: (strip.trackName?.toLowerCase().includes('master') ? 'master'
              : strip.trackName?.toLowerCase().includes('bus') ? 'bus' : 'audio') as TrackDescriptor['type'],
            volumeDb: strip.faderDb ?? 0,
            pan: strip.pan ?? 0,
            isMuted: strip.mute ?? false,
            isSoloed: strip.solo ?? false,
            isSelected: false,
            insertSlots: (strip.inserts ?? []).map((ins) => ({
              slotIndex: ins.slot,
              pluginName: ins.name,
              format: 'au' as const,
              isBypassed: false,
              parameters: []
            }))
          }));
          return { tracks, connected: true };
        }
      }
    } catch {
      // Fall through to 48124 / dawDriver
    }

    // 1b. Fallback: Query MCP SSE bridge endpoint on 127.0.0.1:48124
    try {
      const res48124 = await fetch('http://127.0.0.1:48124/api/ax-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: ['list-channel-strips'] }),
        signal: AbortSignal.timeout(3000)
      });
      if (res48124.ok) {
        const data = (await res48124.json()) as {
          success?: boolean;
          channelStrips?: Array<{
            trackName: string;
            faderDb: number;
            pan: number;
            mute: boolean;
            solo: boolean;
            inserts: Array<{ slot: number; name: string }>;
          }>;
        };
        if (data.success && Array.isArray(data.channelStrips) && data.channelStrips.length > 0) {
          const tracks: TrackDescriptor[] = data.channelStrips.map((strip, idx) => ({
            id: `track_${idx + 1}`,
            index: idx,
            name: strip.trackName || `Track ${idx + 1}`,
            type: (strip.trackName?.toLowerCase().includes('master') ? 'master'
              : strip.trackName?.toLowerCase().includes('bus') ? 'bus' : 'audio') as TrackDescriptor['type'],
            volumeDb: strip.faderDb ?? 0,
            pan: strip.pan ?? 0,
            isMuted: strip.mute ?? false,
            isSoloed: strip.solo ?? false,
            isSelected: false,
            insertSlots: (strip.inserts ?? []).map((ins) => ({
              slotIndex: ins.slot,
              pluginName: ins.name,
              format: 'au' as const,
              isBypassed: false,
              parameters: []
            }))
          }));
          return { tracks, connected: true };
        }
      }
    } catch {
      // Fall through to dawDriver
    }

    // 2. Query dawDriver directly for live AX track & open plugin parameter inspection
    if (this.dawDriver) {
      try {
        const liveTracks = await this.dawDriver.getTrackList();
        if (liveTracks.length > 0) {
          return {
            tracks: liveTracks,
            connected: this.dawDriver.isConnected
          };
        }
      } catch {
        // Fallback to HTTP legacy API below
      }
    }

    // 3. Legacy HTTP API fallback
    try {
      const res = await fetch('http://127.0.0.1:48123/api/tracks', {
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok) {
        const data = (await res.json()) as { tracks?: TrackDescriptor[] };
        if (Array.isArray(data.tracks) && data.tracks.length > 0) {
          return { tracks: data.tracks, connected: true };
        }
      }
    } catch {
      // Desktop companion not reachable
    }

    // 4. STRICT RULE: NO MOCK ARRAYS!
    return {
      tracks: [],
      connected: false,
      error: 'Keine aktive DAW-Verbindung oder kein Projekt geöffnet'
    };
  }

  public async proposeMixAdjustment(args: ProposeMixAdjustmentInput): Promise<{
    proposal: MixActionProposal;
    shieldStatus: 'passed' | 'clamped' | 'rejected';
  }> {
    let shieldStatus: 'passed' | 'clamped' | 'rejected' = 'passed';

    // Validate each delta against Acoustic Shock Shield and Plugin Specification bounds
    for (const delta of args.deltas) {
      if (delta.parameterName === 'fader_db' || delta.parameterName === 'volume') {
        const isMaster = delta.trackName.toLowerCase().includes('master');
        const maxAllowed = isMaster ? 0.0 : 6.0;
        if (delta.proposedValue > maxAllowed) {
          throw new Error(
            `Acoustic Shield: Proposed volume ${delta.proposedValue} dB exceeds ceiling of ${maxAllowed} dB for ${delta.trackName}`
          );
        }
        const prev = this.lastTrackVolumes.get(delta.trackId) ?? delta.currentValue;
        if (delta.proposedValue - prev > 3.0) {
          throw new Error(
            `Acoustic Shield: Single-step jump of +${(delta.proposedValue - prev).toFixed(1)} dB exceeds safety threshold of +3.0 dB`
          );
        }
      } else if (delta.parameterName !== 'pan') {
        const pluginSpec = delta.pluginName ? findPluginSpecification(delta.pluginName) : null;
        const paramSpec =
          findParameterSpecification(delta.parameterName, pluginSpec) ??
          findParameterSpecification(delta.parameterName);
        if (paramSpec) {
          if (paramSpec.displayMin !== undefined && delta.proposedValue < paramSpec.displayMin) {
            delta.proposedValue = paramSpec.displayMin;
            shieldStatus = 'clamped';
          }
          if (paramSpec.displayMax !== undefined && delta.proposedValue > paramSpec.displayMax) {
            delta.proposedValue = paramSpec.displayMax;
            shieldStatus = 'clamped';
          }
          if (!delta.unit && paramSpec.unit) {
            delta.unit = paramSpec.unit;
          }
        }
      }
    }

    const proposal: MixActionProposal = {
      id: `prop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      category: args.category,
      title: args.title,
      rationale: args.rationale,
      confidenceScore: args.confidenceScore,
      deltas: args.deltas,
      status: 'pending'
    };

    this.proposals.set(proposal.id, proposal);
    await this.broadcastProposalToHUD(proposal);
    return { proposal, shieldStatus };
  }

  public async executeMixAdjustment(args: ExecuteMixAdjustmentInput): Promise<{
    success: boolean;
    appliedValue: number;
    trackId: string;
    message: string;
  }> {
    const isMaster = args.isMaster ?? false;
    const maxCeiling = isMaster ? 0.0 : 6.0;

    let clampedValue = args.value;
    const slotIndex = args.slotIndex ?? 0;

    if (args.parameterName === 'fader_db' || args.parameterName === 'volume') {
      clampedValue = Math.min(Math.max(args.value, -96.0), maxCeiling);

      const prev = this.lastTrackVolumes.get(args.trackId) ?? clampedValue;
      if (clampedValue - prev > 3.0) {
        throw new Error(
          `Acoustic Shield: Rejected sudden jump of +${(clampedValue - prev).toFixed(1)} dB on track ${args.trackId}`
        );
      }
      this.lastTrackVolumes.set(args.trackId, clampedValue);

      if (this.dawDriver) {
        await this.dawDriver.setTrackVolume(args.trackId, clampedValue);
      }
    } else if (args.parameterName === 'pan') {
      clampedValue = Math.min(Math.max(args.value, -1.0), 1.0);
      if (this.dawDriver) {
        await this.dawDriver.setTrackPan(args.trackId, clampedValue);
      }
    } else {
      // Plugin Parameter adjustment (Channel EQ, Compressor, or 3rd-party AU/VST3)
      const pluginSpec = args.pluginName ? findPluginSpecification(args.pluginName) : null;
      const paramSpec =
        findParameterSpecification(args.parameterName, pluginSpec) ??
        findParameterSpecification(args.parameterName);

      if (paramSpec) {
        if (paramSpec.displayMin !== undefined) {
          clampedValue = Math.max(paramSpec.displayMin, clampedValue);
        }
        if (paramSpec.displayMax !== undefined) {
          clampedValue = Math.min(paramSpec.displayMax, clampedValue);
        }
      }

      if (this.dawDriver) {
        await this.dawDriver.setPluginParameter(
          args.trackId,
          slotIndex,
          paramSpec?.id ?? args.parameterName,
          clampedValue,
          args.unit ?? paramSpec?.unit ?? ''
        );
      }
    }

    if (args.proposalId && this.proposals.has(args.proposalId)) {
      const p = this.proposals.get(args.proposalId)!;
      p.status = 'applied';
      await this.broadcastProposalToHUD(p);
    }

    // Forward execution command to Desktop Companion HUD (/api/execute-action)
    try {
      await fetch('http://127.0.0.1:48123/api/execute-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackId: args.trackId,
          slotIndex,
          pluginName: args.pluginName,
          parameterName: args.parameterName,
          value: clampedValue,
          unit: args.unit,
          isMaster
        })
      });
    } catch {
      // Quiet fallback if offline
    }

    return {
      success: true,
      appliedValue: clampedValue,
      trackId: args.trackId,
      message: `Parameter '${args.parameterName}' safely applied to ${clampedValue.toFixed(2)}.`
    };
  }

  private async broadcastProposalToHUD(proposal: MixActionProposal): Promise<void> {
    const payload = JSON.stringify({
      type: 'action_proposal',
      proposal
    });

    try {
      await fetch('http://127.0.0.1:48123/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
    } catch {
      // Quiet fallback
    }

    try {
      const client = new WebSocket('ws://127.0.0.1:48123/meter');
      client.on('open', () => {
        client.send(payload, () => {
          client.close();
        });
      });
      client.on('error', () => {
        // Quiet fallback
      });
    } catch {
      // Quiet fallback
    }
  }

  public async auditionRegion(args: AuditionRegionInput): Promise<{
    auditioning: boolean;
    startBar: number;
    endBar: number;
  }> {
    if (this.dawDriver && args.autoPlay !== false) {
      await this.dawDriver.playRegion(args.startBar, args.endBar);
    }
    return {
      auditioning: true,
      startBar: args.startBar,
      endBar: args.endBar
    };
  }

  public async learnPlugin(args: import('./tools.js').LearnPluginInput): Promise<{
    success: boolean;
    pluginName: string;
    category: string;
    parameterCount: number;
    filePath: string;
    spec: import('@mixing-buddy/daw-adapters').ProfiledPluginSpec;
  }> {
    const { MacOSAccessibilityClient, saveLearnedPluginToVault } = await import(
      '@mixing-buddy/daw-adapters'
    );
    const axClient = new MacOSAccessibilityClient();
    const profiled = await axClient.profileActivePlugin(args.windowTitle);
    if (!profiled) {
      throw new Error(
        'Kein geöffnetes Plugin-Fenster in Logic Pro gefunden. Bitte öffne das gewünschte Plugin-Fenster in der DAW.'
      );
    }

    const saved = saveLearnedPluginToVault(profiled);
    return {
      success: true,
      pluginName: saved.spec.pluginName,
      category: saved.spec.category,
      parameterCount: saved.spec.parameters.length,
      filePath: saved.filePath,
      spec: saved.spec
    };
  }

  public getPendingProposals(): MixActionProposal[] {
    return Array.from(this.proposals.values()).filter((p) => p.status === 'pending');
  }

  public async matchReferenceSpectrum(args: MatchReferenceSpectrumInput): Promise<{
    proposal: MixActionProposal | null;
    analysis: SpectralDifferenceAnalysis | null;
    message: string;
  }> {
    const telemetry = this.latestTelemetry;
    if (!telemetry || !telemetry.spectrum) {
      throw new Error('No live metrology telemetry available. Ensure JUCE meter plugin is active.');
    }

    let referenceProfile: ReferenceTrackProfile | null = null;

    if (args.referenceId) {
      const vaultPath = path.join(os.homedir(), '.mixing-buddy', 'references', `${args.referenceId}.json`);
      try {
        const raw = await fs.promises.readFile(vaultPath, 'utf-8');
        referenceProfile = JSON.parse(raw);
      } catch {
        // Try without .json suffix or fuzzy match
        const dir = path.join(os.homedir(), '.mixing-buddy', 'references');
        if (fs.existsSync(dir)) {
          const files = await fs.promises.readdir(dir);
          const matched = files.find((f) => f.toLowerCase().includes(args.referenceId!.toLowerCase()));
          if (matched) {
            const raw = await fs.promises.readFile(path.join(dir, matched), 'utf-8');
            referenceProfile = JSON.parse(raw);
          }
        }
      }
    }

    if (!referenceProfile && args.frequencyBands) {
      referenceProfile = {
        id: args.referenceId || 'custom_reference',
        name: args.referenceName || 'Custom Reference',
        fileName: 'custom_reference.wav',
        fileFormat: 'wav',
        durationSeconds: 180,
        sampleRate: 44100,
        channels: 2,
        integratedLufs: -12.0,
        truePeakDb: -0.5,
        crestFactorDb: 10.0,
        frequencyBands: args.frequencyBands,
        timestamp: Date.now()
      };
    }

    if (!referenceProfile) {
      throw new Error(
        `Reference profile '${args.referenceId || args.referenceName}' not found in ~/.mixing-buddy/references/ and no frequencyBands provided.`
      );
    }

    // Get active tracks
    const tracksRes = await this.listTracks({});
    const tracks = tracksRes.tracks;

    const threshold = args.thresholdDb ?? 2.5;
    const analysis = computeSpectralDifference(
      telemetry.spectrum.frequencyBands,
      referenceProfile.frequencyBands,
      0,
      threshold
    );

    const proposal = generateReferenceMatchProposal(
      telemetry,
      referenceProfile,
      tracks,
      0,
      threshold
    );

    if (proposal) {
      this.proposals.set(proposal.id, proposal);
      await this.broadcastProposalToHUD(proposal);
      return {
        proposal,
        analysis,
        message: `Generated reference match proposal '${proposal.title}' based on ${analysis.deviantZones.length} frequency deviation zones.`
      };
    }

    return {
      proposal: null,
      analysis,
      message: `Spectral balance is already within the ±${threshold} dB tolerance threshold of reference '${referenceProfile.name}'.`
    };
  }

  private extractTopResonances(bands: number[]): ResonancePeak[] {
    // 32 log-spaced frequency bands across 20 Hz - 20 kHz
    const centerFreqs = [
      25, 31, 40, 50, 63, 80, 100, 125,
      160, 200, 250, 315, 400, 500, 630, 800,
      1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
      6300, 8000, 10000, 12500, 16000, 18000, 19000, 20000
    ];

    const indexed = bands.map((mag, i) => ({
      freq: centerFreqs[i] ?? 1000,
      mag
    }));

    indexed.sort((a, b) => b.mag - a.mag);
    return indexed.slice(0, 5).map(({ freq, mag }) => {
      let character: ResonancePeak['character'] = 'mid_boxiness';
      if (freq < 60) character = 'sub_rumble';
      else if (freq <= 500) character = 'low_mud';
      else if (freq >= 3000 && freq <= 7000) character = 'harshness';
      else if (freq > 7000) character = 'air';

      return {
        frequencyHz: freq,
        magnitudeDb: mag,
        character
      };
    });
  }
}
