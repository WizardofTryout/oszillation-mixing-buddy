import WebSocket from 'ws';
import type { DAWDriver } from '@mixing-buddy/daw-adapters';
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

  public async listTracks(_args: ListTracksInput): Promise<{ tracks: TrackDescriptor[] }> {
    if (!this.dawDriver) {
      return {
        tracks: [
          {
            id: 'track_1',
            index: 0,
            name: 'Kick Drum',
            type: 'audio',
            volumeDb: -3.5,
            pan: 0.0,
            isMuted: false,
            isSoloed: false,
            isSelected: true,
            insertSlots: [
              {
                slotIndex: 0,
                pluginName: 'Frequency 2',
                format: 'vst3',
                isBypassed: false,
                parameters: []
              }
            ]
          },
          {
            id: 'track_2',
            index: 1,
            name: 'Bass Guitar',
            type: 'audio',
            volumeDb: -4.0,
            pan: 0.0,
            isMuted: false,
            isSoloed: false,
            isSelected: false,
            insertSlots: [
              {
                slotIndex: 0,
                pluginName: 'StudioEQ',
                format: 'vst3',
                isBypassed: false,
                parameters: []
              }
            ]
          },
          {
            id: 'track_3',
            index: 2,
            name: 'Lead Vocal',
            type: 'audio',
            volumeDb: -2.0,
            pan: 0.0,
            isMuted: false,
            isSoloed: false,
            isSelected: false,
            insertSlots: [
              {
                slotIndex: 0,
                pluginName: 'Channel EQ',
                format: 'au',
                isBypassed: false,
                parameters: []
              }
            ]
          }
        ]
      };
    }
    const tracks = await this.dawDriver.getTrackList();
    return { tracks };
  }

  public async proposeMixAdjustment(args: ProposeMixAdjustmentInput): Promise<{
    proposal: MixActionProposal;
    shieldStatus: 'passed' | 'clamped' | 'rejected';
  }> {
    // Validate each delta against Acoustic Shock Shield
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
    return { proposal, shieldStatus: 'passed' };
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
    }

    if (args.proposalId && this.proposals.has(args.proposalId)) {
      const p = this.proposals.get(args.proposalId)!;
      p.status = 'applied';
      await this.broadcastProposalToHUD(p);
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
