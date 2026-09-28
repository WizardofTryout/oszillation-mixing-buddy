import type { MetrologyTelemetryFrame, MixActionProposal, TrackDescriptor } from '@mixing-buddy/shared-types';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { GeminiProvider } from './providers/GeminiProvider.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { LocalOllamaProvider } from './providers/LocalOllamaProvider.js';
import type { AIProvider, AIProviderConfig } from './types.js';
import type { MixAnalysisContext } from './prompts.js';

export * from './types.js';
export * from './prompts.js';
export * from './providers/AnthropicProvider.js';
export * from './providers/GeminiProvider.js';
export * from './providers/OpenAIProvider.js';
export * from './providers/LocalOllamaProvider.js';

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

/**
 * Deterministic Mock/Rule-Based Engine for zero-token testing, offline mode and CI
 */
export class MockRuleBasedProvider implements AIProvider {
  public readonly id = 'mock';
  public readonly name = 'Managed Cloud / Rule-Based Analyzer';

  public async analyzeMix(
    telemetry: MetrologyTelemetryFrame,
    tracks: TrackDescriptor[]
  ): Promise<MixActionProposal> {
    // Check for low-end mud in bins around 250 - 400 Hz (bands 11 to 13)
    const mudMag = (telemetry.spectrum.frequencyBands[11] ?? -30) + (telemetry.spectrum.frequencyBands[12] ?? -30);
    const bassTrack = tracks.find((t) => t.name.toLowerCase().includes('bass')) ?? tracks[0];

    if (mudMag > -45 && bassTrack) {
      return {
        id: `prop_${Date.now()}_mud_carve`,
        timestamp: Date.now(),
        category: 'eq_tonal_balance',
        title: `Carve 350 Hz Mud on ${bassTrack.name}`,
        rationale:
          'Spectral metrology reveals concentrated acoustic accumulation between 250 Hz and 400 Hz, compromising master headroom and clarity.',
        confidenceScore: 0.94,
        status: 'pending',
        deltas: [
          {
            trackId: bassTrack.id,
            trackName: bassTrack.name,
            slotIndex: 0,
            pluginName: 'StudioEQ',
            parameterName: 'band2_gain',
            currentValue: 0.0,
            proposedValue: -2.5,
            unit: 'dB'
          },
          {
            trackId: bassTrack.id,
            trackName: bassTrack.name,
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
    const kickTrack = tracks.find((t) => t.name.toLowerCase().includes('kick')) ?? tracks[0];

    return {
      id: `prop_${Date.now()}_gain_balance`,
      timestamp: Date.now(),
      category: 'gain_staging',
      title: `Optimize Fader Balance on ${kickTrack?.name ?? 'Kick'}`,
      rationale: `Current integrated loudness is ${masterLufs.toFixed(1)} LUFS. Trimming kick fader by -1.5 dB recovers dynamic punch.`,
      confidenceScore: 0.88,
      status: 'pending',
      deltas: [
        {
          trackId: kickTrack?.id ?? 'track_1',
          trackName: kickTrack?.name ?? 'Kick',
          parameterName: 'fader_db',
          currentValue: kickTrack?.volumeDb ?? -3.5,
          proposedValue: (kickTrack?.volumeDb ?? -3.5) - 1.5,
          unit: 'dB'
        }
      ]
    };
  }
}
