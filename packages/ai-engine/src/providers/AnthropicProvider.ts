import Anthropic from '@anthropic-ai/sdk';
import type { MetrologyTelemetryFrame, MixActionProposal, TrackDescriptor } from '@mixing-buddy/shared-types';
import { MIXING_BUDDY_SYSTEM_PROMPT, buildAnalysisUserPrompt, type MixAnalysisContext } from '../prompts.js';
import type { AIProvider, AIProviderConfig } from '../types.js';

export class AnthropicProvider implements AIProvider {
  public readonly id = 'anthropic';
  public readonly name = 'Anthropic Claude (BYOK)';
  private client: Anthropic;
  private model: string;

  constructor(config: AIProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY || 'dummy_key'
    });
    this.model = config.modelName || 'claude-3-7-sonnet-20250219';
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

    const toolDefinition: Anthropic.Tool = {
      name: 'mcp__propose_mix_adjustment',
      description: 'Submit an actionable mixing proposal to the engineer HUD',
      input_schema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['gain_staging', 'eq_tonal_balance', 'dynamic_control', 'stereo_width', 'masking_reduction']
          },
          title: { type: 'string' },
          rationale: { type: 'string' },
          confidenceScore: { type: 'number', minimum: 0.0, maximum: 1.0 },
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
    };

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: MIXING_BUDDY_SYSTEM_PROMPT,
      tools: [toolDefinition],
      tool_choice: { type: 'tool', name: 'mcp__propose_mix_adjustment' },
      messages: [{ role: 'user', content: userPrompt }]
    });

    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Claude response did not contain a tool_use block');
    }

    const input = toolUse.input as any;
    return {
      id: `prop_${Date.now()}_anthropic`,
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
