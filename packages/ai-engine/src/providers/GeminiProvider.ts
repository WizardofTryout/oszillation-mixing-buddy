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
    this.modelName = config.modelName || 'gemini-3.8-flash';
  }

  public async analyzeMix(
    telemetry: MetrologyTelemetryFrame,
    tracks: TrackDescriptor[],
    context?: MixAnalysisContext
  ): Promise<MixActionProposal> {
    const res = await this.generateMixProposal(
      context?.userPrompt ?? 'Analyze the current mix balance and propose the most critical improvement.',
      telemetry,
      tracks,
      context
    );
    if (res.proposal) {
      return res.proposal;
    }
    throw new Error('Gemini did not return an actionable proposal: ' + res.assistantText);
  }

  public async generateMixProposal(
    userPrompt: string,
    telemetry: MetrologyTelemetryFrame | null,
    tracks: TrackDescriptor[],
    context?: MixAnalysisContext
  ): Promise<{ assistantText: string; proposal?: MixActionProposal }> {
    const dawName = context?.dawName ?? 'Logic Pro';
    const ctx: MixAnalysisContext = {
      dawName,
      userPrompt,
      ...context
    };

    const telemetrySummary = telemetry
      ? JSON.stringify(
          {
            sampleRate: telemetry.sampleRate,
            lufs: telemetry.loudness,
            truePeak: telemetry.loudness.truePeakDb,
            correlation: telemetry.dynamics.stereoCorrelation,
            frequencyBands32: telemetry.spectrum.frequencyBands,
            spectralResonances: telemetry.spectrum.spectralResonances
          },
          null,
          2
        )
      : 'No live telemetry frame available currently.';

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

    const fullPrompt = buildAnalysisUserPrompt(telemetrySummary, tracksSummary, ctx);

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

    try {
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        systemInstruction: MIXING_BUDDY_SYSTEM_PROMPT,
        tools: [{ functionDeclarations: [functionDeclaration] }]
      });

      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      const call = response.functionCalls()?.[0];
      const textOutput = response.text ? response.text() : '';

      if (call && call.name === 'mcp__propose_mix_adjustment') {
        const input = call.args as any;
        const proposal: MixActionProposal = {
          id: `prop_${Date.now()}_gemini`,
          timestamp: Date.now(),
          category: input.category,
          title: input.title,
          rationale: input.rationale,
          confidenceScore: input.confidenceScore,
          deltas: input.deltas,
          status: 'pending'
        };
        return {
          assistantText: textOutput.trim() || input.rationale || `Ich habe die Anweisung analysiert und "${proposal.title}" vorgeschlagen.`,
          proposal
        };
      }

      // If Gemini returned structured JSON in text
      if (textOutput.includes('mcp__propose_mix_adjustment') || textOutput.includes('deltas')) {
        try {
          const jsonMatch = textOutput.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const proposal: MixActionProposal = {
              id: `prop_${Date.now()}_gemini`,
              timestamp: Date.now(),
              category: parsed.category ?? 'eq_tonal_balance',
              title: parsed.title ?? 'Mix Adjustment Proposal',
              rationale: parsed.rationale ?? textOutput,
              confidenceScore: parsed.confidenceScore ?? 0.9,
              deltas: parsed.deltas ?? [],
              status: 'pending'
            };
            return {
              assistantText: parsed.rationale ?? textOutput,
              proposal
            };
          }
        } catch {
          // JSON parsing failed, return raw text
        }
      }

      return {
        assistantText: textOutput.trim() || 'Gemini hat die Anweisung verarbeitet.'
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('API_KEY_INVALID') || msg.includes('403') || msg.includes('API key')) {
        return {
          assistantText: `⚠️ Gemini API-Fehler: Der angegebene API-Key ist ungültig oder abgelaufen. Bitte prüfe den Key in den Settings oben. (${msg})`
        };
      }
      return {
        assistantText: `⚠️ Fehler bei der Gemini-Generierung: ${msg}`
      };
    }
  }
}
