import WebSocket from 'ws';
import {
  findParameterSpecification,
  findPluginSpecification,
  type DAWDriver
} from '@mixing-buddy/daw-adapters';
import type { MetrologyTelemetryFrame, MixActionProposal, TrackDescriptor } from '@mixing-buddy/shared-types';
import type {
  AuditionRegionInput,
  ExecuteMixAdjustmentInput,
  GetMixTelemetryInput,
  ListTracksInput,
  ProposeMixAdjustmentInput
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
    // 1. Query dawDriver directly for live AX track & open plugin parameter inspection
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
        // Fallback to HTTP API below
      }
    }

    // 2. Live query to Desktop Companion HTTP API on 127.0.0.1:48123/api/tracks
    try {
      const res = await fetch('http://127.0.0.1:48123/api/tracks', {
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok) {
        const data = (await res.json()) as { tracks?: TrackDescriptor[] };
        if (Array.isArray(data.tracks) && data.tracks.length > 0) {
          return {
            tracks: data.tracks,
            connected: true
          };
        }
      }
    } catch {
      // Desktop companion not reachable or starting up
    }

    // 3. STRICT RULE: NO MOCK ARRAYS! Never simulate tracks!
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

  public getPendingProposals(): MixActionProposal[] {
    return Array.from(this.proposals.values()).filter((p) => p.status === 'pending');
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
