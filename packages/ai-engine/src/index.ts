import type { MetrologyTelemetryFrame, MixActionProposal, TrackDescriptor } from '@mixing-buddy/shared-types';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { GeminiProvider } from './providers/GeminiProvider.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { LocalOllamaProvider } from './providers/LocalOllamaProvider.js';
import type { AIProvider, AIProviderConfig } from './types.js';
import type { MixAnalysisContext } from './prompts.js';

export * from './types.js';
export * from './types/targets.js';
export * from './data/targetProfiles.js';
export * from './prompts.js';
export * from './providers/AnthropicProvider.js';
export * from './providers/GeminiProvider.js';
export * from './providers/OpenAIProvider.js';
export * from './providers/LocalOllamaProvider.js';
export * from './providers/AgentRunner.js';
export * from './referenceMatch.js';
export * from './skillSynthesis.js';
export * from './targetScopeResolver.js';

export type ProviderType = 'managed' | 'anthropic' | 'gemini' | 'openai' | 'ollama' | 'mock';

export class AIEngine {
  private activeProvider: AIProvider;

  constructor(providerType: ProviderType = 'mock', config: AIProviderConfig = {}) {
    this.activeProvider = this.createProvider(providerType, config);
  }

  public setProvider(providerType: ProviderType, config: AIProviderConfig = {}): void {
    this.activeProvider = this.createProvider(providerType, config);
  }

  public getActiveProvider(): AIProvider {
    return this.activeProvider;
  }

  public async analyzeMix(
    telemetry: MetrologyTelemetryFrame,
    tracks: TrackDescriptor[],
    context?: MixAnalysisContext
  ): Promise<MixActionProposal> {
    return this.activeProvider.analyzeMix(telemetry, tracks, context);
  }

  private createProvider(type: ProviderType, config: AIProviderConfig): AIProvider {
    switch (type) {
      case 'anthropic':
        return new AnthropicProvider(config);
      case 'gemini':
        return new GeminiProvider(config);
      case 'openai':
        return new OpenAIProvider(config);
      case 'ollama':
        return new LocalOllamaProvider(config);
      case 'managed':
      case 'mock':
      default:
        return new MockRuleBasedProvider();
    }
  }
}

export function createDuckingProposal(
  bassTrack: TrackDescriptor,
  triggerSource: string,
  slotIndex?: number
): MixActionProposal {
  let resolvedSlot = slotIndex ?? 1;
  if (bassTrack.insertSlots && bassTrack.insertSlots.length > 0) {
    const compSlot = bassTrack.insertSlots.find(
      (s) => s && (s.pluginName?.toLowerCase().includes('comp') || s.pluginName?.toLowerCase().includes('compressor'))
    );
    if (compSlot && typeof compSlot.slotIndex === 'number' && compSlot.slotIndex >= 1) {
      resolvedSlot = compSlot.slotIndex;
    }
  }

  return {
    id: `prop_${Date.now()}_sidechain_ducking`,
    timestamp: Date.now(),
    category: 'dynamic_control',
    title: `Sidechain Ducking: ${bassTrack.name} via ${triggerSource}`,
    rationale: `Low-end masking detected between sub-bass and kick. Routing ${triggerSource} into Compressor (slot ${resolvedSlot}) and applying ducking envelope restores transient headroom.`,
    confidenceScore: 0.96,
    status: 'pending',
    sidechainRoute: {
      trackName: bassTrack.name,
      slotIndex: resolvedSlot,
      sourcePath: triggerSource
    },
    deltas: [
      {
        trackId: bassTrack.id,
        trackName: bassTrack.name,
        slotIndex: resolvedSlot,
        pluginName: 'Compressor',
        parameterName: 'threshold',
        currentValue: 0.0,
        proposedValue: -18.0,
        unit: 'dB'
      },
      {
        trackId: bassTrack.id,
        trackName: bassTrack.name,
        slotIndex: resolvedSlot,
        pluginName: 'Compressor',
        parameterName: 'ratio',
        currentValue: 1.0,
        proposedValue: 4.0,
        unit: ':1'
      },
      {
        trackId: bassTrack.id,
        trackName: bassTrack.name,
        slotIndex: resolvedSlot,
        pluginName: 'Compressor',
        parameterName: 'attack',
        currentValue: 50.0,
        proposedValue: 15.0,
        unit: 'ms'
      },
      {
        trackId: bassTrack.id,
        trackName: bassTrack.name,
        slotIndex: resolvedSlot,
        pluginName: 'Compressor',
        parameterName: 'release',
        currentValue: 200.0,
        proposedValue: 80.0,
        unit: 'ms'
      }
    ]
  };
}

/**
 * Deterministic Mock/Rule-Based Engine for zero-token testing, offline mode and CI
 */
export class MockRuleBasedProvider implements AIProvider {
  public readonly id = 'mock';
  public readonly name = 'Managed Cloud / Rule-Based Analyzer';

  public async analyzeMix(
    telemetry: MetrologyTelemetryFrame,
    tracks: TrackDescriptor[],
    context?: MixAnalysisContext
  ): Promise<MixActionProposal> {
    const userPrompt = context?.userPrompt?.toLowerCase() ?? '';
    const wantsDucking = userPrompt.includes('sidechain') || userPrompt.includes('duck') || userPrompt.includes('masking');

    const kickTrack = tracks.find((t) => t.name.toLowerCase().includes('kick'));
    const bassTrack = tracks.find((t) => 
      t.name.toLowerCase().includes('bass') || 
      t.name.toLowerCase().includes('foundation') ||
      t.name.toLowerCase().includes('synth')
    );

    // If ducking is requested or both kick and bass are present with sub-bass energy
    const subBassEnergy = (telemetry.spectrum.frequencyBands[1] ?? -30) + (telemetry.spectrum.frequencyBands[2] ?? -30);
    if (bassTrack && (wantsDucking || (kickTrack && subBassEnergy > -50))) {
      const triggerSource = kickTrack ? `Audio > ${kickTrack.name}` : 'Bus > Bus 1';
      return createDuckingProposal(bassTrack, triggerSource);
    }

    // Check for low-end mud in bins around 250 - 400 Hz (bands 11 to 13)
    const mudMag = (telemetry.spectrum.frequencyBands[11] ?? -30) + (telemetry.spectrum.frequencyBands[12] ?? -30);
    const candidateBass = bassTrack ?? tracks[0];

    if (mudMag > -45 && candidateBass) {
      return {
        id: `prop_${Date.now()}_mud_carve`,
        timestamp: Date.now(),
        category: 'eq_tonal_balance',
        title: `Carve 350 Hz Mud on ${candidateBass.name}`,
        rationale:
          'Spectral metrology reveals concentrated acoustic accumulation between 250 Hz and 400 Hz, compromising master headroom and clarity.',
        confidenceScore: 0.94,
        status: 'pending',
        deltas: [
          {
            trackId: candidateBass.id,
            trackName: candidateBass.name,
            slotIndex: 0,
            pluginName: 'StudioEQ',
            parameterName: 'band2_gain',
            currentValue: 0.0,
            proposedValue: -2.5,
            unit: 'dB'
          },
          {
            trackId: candidateBass.id,
            trackName: candidateBass.name,
            slotIndex: 0,
            pluginName: 'StudioEQ',
            parameterName: 'band2_freq',
            currentValue: 350,
            proposedValue: 350,
            unit: 'Hz'
          }
        ]
      };
    }

    // Default Gain Staging suggestion
    const masterLufs = telemetry.loudness.integratedLufs;
    const candidateKick = kickTrack ?? tracks[0];

    return {
      id: `prop_${Date.now()}_gain_balance`,
      timestamp: Date.now(),
      category: 'gain_staging',
      title: `Optimize Fader Balance on ${candidateKick?.name ?? 'Kick'}`,
      rationale: `Current integrated loudness is ${masterLufs.toFixed(1)} LUFS. Trimming kick fader by -1.5 dB recovers dynamic punch.`,
      confidenceScore: 0.88,
      status: 'pending',
      deltas: [
        {
          trackId: candidateKick?.id ?? 'track_1',
          trackName: candidateKick?.name ?? 'Kick',
          parameterName: 'fader_db',
          currentValue: candidateKick?.volumeDb ?? -3.5,
          proposedValue: (candidateKick?.volumeDb ?? -3.5) - 1.5,
          unit: 'dB'
        }
      ]
    };
  }
}
