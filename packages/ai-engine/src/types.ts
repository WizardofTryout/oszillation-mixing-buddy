import type { MetrologyTelemetryFrame, MixActionProposal, TrackDescriptor } from '@mixing-buddy/shared-types';
import type { MixAnalysisContext } from './prompts.js';

export interface AIProviderConfig {
  apiKey?: string;
  modelName?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  analyzeMix(
    telemetry: MetrologyTelemetryFrame,
    tracks: TrackDescriptor[],
    context?: MixAnalysisContext
  ): Promise<MixActionProposal>;
}
