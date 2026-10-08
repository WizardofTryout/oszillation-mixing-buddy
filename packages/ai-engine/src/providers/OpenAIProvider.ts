import OpenAI from 'openai';
import type { MetrologyTelemetryFrame, MixActionProposal, TrackDescriptor } from '@mixing-buddy/shared-types';
import { MIXING_BUDDY_SYSTEM_PROMPT, buildAnalysisUserPrompt, type MixAnalysisContext } from '../prompts.js';
import type { AIProvider, AIProviderConfig } from '../types.js';

export class OpenAIProvider implements AIProvider {
  public readonly id: string = 'openai';
  public readonly name: string = 'OpenAI GPT-4o (BYOK)';
  protected client: OpenAI;
  protected model: string;

  constructor(config: AIProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || 'dummy_key',
      baseURL: config.baseUrl
    });
    this.model = config.modelName || 'gpt-4o';
  }

  public async analyzeMix(
    telemetry: MetrologyTelemetryFrame,
    tracks: TrackDescriptor[],
    context?: MixAnalysisContext
  ): Promise<MixActionProposal> {
    const defaultCtx: MixAnalysisContext = context ?? { dawName: 'Nuendo' };

    const telemetrySummary = JSON.stringify(
      {
        lufs: telemetry.loudness,
        truePeak: telemetry.loudness.truePeakDb,
        correlation: telemetry.dynamics.stereoCorrelation,
        lowMudEnergyDb: telemetry.spectrum.frequencyBands.slice(10, 14),
        harshnessEnergyDb: telemetry.spectrum.frequencyBands.slice(22, 26)
      },
      null,
      2
    );

    const tracksSummary = JSON.stringify(
      tracks.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        volumeDb: t.volumeDb,
        pan: t.pan,
        plugins: t.insertSlots.filter(Boolean).map((p) => p!.pluginName)
      })),
      null,
      2
    );

    const userPrompt = buildAnalysisUserPrompt(telemetrySummary, tracksSummary, defaultCtx);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: MIXING_BUDDY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'mcp__propose_mix_adjustment',
            description: 'Submit an actionable mixing proposal to the engineer HUD',
            parameters: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  enum: ['gain_staging', 'eq_tonal_balance', 'dynamic_control', 'stereo_width', 'masking_reduction']
                },
                title: { type: 'string' },
                rationale: { type: 'string' },
                confidenceScore: { type: 'number' },
                deltas: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      trackId: { type: 'string' },
                      trackName: { type: 'string' },
                      slotIndex: { type: 'number' },
                      pluginName: { type: 'string' },
                      parameterName: { type: 'string' },
                      currentValue: { type: 'number' },
                      proposedValue: { type: 'number' },
                      unit: { type: 'string' }
                    },
                    required: ['trackId', 'trackName', 'parameterName', 'currentValue', 'proposedValue', 'unit']
                  }
                }
              },
              required: ['category', 'title', 'rationale', 'confidenceScore', 'deltas']
            }
          }
        }
      ],
      tool_choice: { type: 'function', function: { name: 'mcp__propose_mix_adjustment' } }
    });

    const toolCall = response.choices[0]?.message.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== 'mcp__propose_mix_adjustment') {
      throw new Error('OpenAI response did not contain mcp__propose_mix_adjustment tool call');
    }

    const input = JSON.parse(toolCall.function.arguments);
    return {
      id: `prop_${Date.now()}_openai`,
      timestamp: Date.now(),
      category: input.category,
      title: input.title,
      rationale: input.rationale,
      confidenceScore: input.confidenceScore,
      deltas: input.deltas,
      status: 'pending'
    };
  }
}
