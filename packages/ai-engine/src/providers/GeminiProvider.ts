import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from '@google/generative-ai';
import type { MetrologyTelemetryFrame, MixActionProposal, TrackDescriptor } from '@mixing-buddy/shared-types';
import { MIXING_BUDDY_SYSTEM_PROMPT, buildAnalysisUserPrompt, type MixAnalysisContext } from '../prompts.js';
import type { AIProvider, AIProviderConfig } from '../types.js';

export class GeminiProvider implements AIProvider {
  public readonly id = 'gemini';
  public readonly name = 'Google Gemini (BYOK)';
  private genAI: GoogleGenerativeAI;
  private modelName: string;

  constructor(config: AIProviderConfig) {
    this.genAI = new GoogleGenerativeAI(config.apiKey || process.env.GEMINI_API_KEY || 'dummy_key');
    this.modelName = config.modelName || 'gemini-1.5-pro-latest';
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

    const functionDeclaration: FunctionDeclaration = {
      name: 'mcp__propose_mix_adjustment',
      description: 'Submit an actionable mixing proposal to the engineer HUD',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          category: {
            type: SchemaType.STRING,
            format: 'enum',
            enum: ['gain_staging', 'eq_tonal_balance', 'dynamic_control', 'stereo_width', 'masking_reduction']
          },
          title: { type: SchemaType.STRING },
          rationale: { type: SchemaType.STRING },
          confidenceScore: { type: SchemaType.NUMBER },
          deltas: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                trackId: { type: SchemaType.STRING },
                trackName: { type: SchemaType.STRING },
                slotIndex: { type: SchemaType.INTEGER },
                pluginName: { type: SchemaType.STRING },
                parameterName: { type: SchemaType.STRING },
                currentValue: { type: SchemaType.NUMBER },
                proposedValue: { type: SchemaType.NUMBER },
                unit: { type: SchemaType.STRING }
              },
              required: ['trackId', 'trackName', 'parameterName', 'currentValue', 'proposedValue', 'unit']
            }
          }
        },
        required: ['category', 'title', 'rationale', 'confidenceScore', 'deltas']
      }
    };

    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      systemInstruction: MIXING_BUDDY_SYSTEM_PROMPT,
      tools: [{ functionDeclarations: [functionDeclaration] }]
    });

    const result = await model.generateContent(userPrompt);
    const response = await result.response;
    const call = response.functionCalls()?.[0];

    if (!call || call.name !== 'mcp__propose_mix_adjustment') {
      throw new Error('Gemini response did not contain mcp__propose_mix_adjustment call');
    }

    const input = call.args as any;
    return {
      id: `prop_${Date.now()}_gemini`,
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
