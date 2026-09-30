import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from '@google/generative-ai';
import type { MetrologyTelemetryFrame, MixActionProposal, TrackDescriptor } from '@mixing-buddy/shared-types';
import { MIXING_BUDDY_SYSTEM_PROMPT, buildAnalysisUserPrompt, type MixAnalysisContext } from '../prompts.js';
import { validateMixPlausibility } from '../data/targetProfiles.js';
import type { AIProvider, AIProviderConfig } from '../types.js';

export interface KeyValidationResult {
  keySnippet: string;
  valid: boolean;
  model: string;
  availableModels?: string[];
  error?: string;
}

/**
 * Key Manager supporting multi-key round-robin rotation and cooldown handling
 */
export class GeminiKeyManager {
  private keys: string[] = [];
  private currentIndex = 0;
  private cooldowns: Map<string, number> = new Map();

  constructor(rawKeys?: string | string[]) {
    this.setKeys(rawKeys);
  }

  public setKeys(rawKeys?: string | string[]): void {
    if (!rawKeys) {
      const envKey = process.env.GEMINI_API_KEY;
      this.keys = envKey ? [envKey] : [];
      return;
    }

    if (Array.isArray(rawKeys)) {
      this.keys = rawKeys.map((k) => k.trim()).filter((k) => k.length > 5);
    } else {
      this.keys = rawKeys
        .split(/[\n,;]+/)
        .map((k) => k.trim())
        .filter((k) => k.length > 5);
    }
  }

  public getKeys(): string[] {
    return this.keys;
  }

  public getKeysCount(): number {
    return this.keys.length;
  }

  public getNextKey(): string | null {
    if (this.keys.length === 0) return null;

    const now = Date.now();
    for (let attempts = 0; attempts < this.keys.length; attempts++) {
      const idx = (this.currentIndex + attempts) % this.keys.length;
      const candidate = this.keys[idx];
      const cooldownUntil = this.cooldowns.get(candidate) ?? 0;

      if (now >= cooldownUntil) {
        this.currentIndex = (idx + 1) % this.keys.length;
        return candidate;
      }
    }

    // All keys in cooldown -> return the candidate with the earliest expiry
    let earliestKey = this.keys[0];
    let earliestTime = this.cooldowns.get(earliestKey) ?? 0;
    for (const k of this.keys) {
      const t = this.cooldowns.get(k) ?? 0;
      if (t < earliestTime) {
        earliestTime = t;
        earliestKey = k;
      }
    }
    return earliestKey;
  }

  public markCooldown(key: string, durationMs = 60_000): void {
    this.cooldowns.set(key, Date.now() + durationMs);
  }

  public getActiveCooldownCount(): number {
    const now = Date.now();
    let count = 0;
    for (const [_, expire] of this.cooldowns) {
      if (expire > now) count++;
    }
    return count;
  }
}

export class GeminiProvider implements AIProvider {
  public readonly id = 'gemini';
  public readonly name = 'Google Gemini (BYOK)';
  private keyManager: GeminiKeyManager;
  private modelName: string;
  private availableModels: string[] = [];

  constructor(
    config: AIProviderConfig & {
      apiKeys?: string | string[];
      availableModels?: string[];
    }
  ) {
    const keys = config.apiKeys ?? config.apiKey;
    this.keyManager = new GeminiKeyManager(keys);
    this.modelName = config.modelName || 'gemini-3.8-flash';
    this.availableModels = config.availableModels ?? [];
  }

  public getKeyManager(): GeminiKeyManager {
    return this.keyManager;
  }

  /**
   * Dynamically query all available Gemini models supporting generateContent from the Google AI API
   */
  public static async fetchAvailableModels(apiKey: string): Promise<string[]> {
    if (!apiKey || apiKey.trim().length <= 5) {
      return ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'];
    }

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`
      );
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
        if (Array.isArray(data.models)) {
          const models = data.models
            .filter(
              (m) =>
                Array.isArray(m.supportedGenerationMethods) &&
                m.supportedGenerationMethods.includes('generateContent') &&
                !m.name.includes('1.5') && // Exclude legacy deprecated 1.5 models
                !m.name.includes('embedding') &&
                !m.name.includes('aqa')
            )
            .map((m) => m.name.replace(/^models\//, ''))
            .sort((a, b) => {
              const aFlash = a.includes('flash') ? 0 : 1;
              const bFlash = b.includes('flash') ? 0 : 1;
              return aFlash - bFlash;
            });

          if (models.length > 0) {
            return models;
          }
        }
      }
    } catch {
      // Fallback to modern stable models
    }

    return ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'];
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

  /**
   * Validate one or multiple API keys with a fast lightweight ping and query available models
   */
  public static async validateKey(
    key: string,
    preferredModel = 'gemini-2.5-flash'
  ): Promise<KeyValidationResult> {
    const snippet = key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : key;
    try {
      // 1. Discover available models dynamically from API
      const models = await GeminiProvider.fetchAvailableModels(key);
      const testModel = models.includes(preferredModel)
        ? preferredModel
        : models.find((m) => m.includes('flash')) || models[0] || 'gemini-2.5-flash';

      // 2. Perform lightweight countTokens verification
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: testModel });
      await model.countTokens({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }]
      });

      return {
        keySnippet: snippet,
        valid: true,
        model: testModel,
        availableModels: models
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        keySnippet: snippet,
        valid: false,
        model: preferredModel,
        error: msg
      };
    }
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

    if (this.keyManager.getKeysCount() === 0) {
      return {
        assistantText: '⚠️ Kein Gemini API-Key hinterlegt. Bitte trage deinen Key in den Einstellungen oben ein.'
      };
    }

    let plausibilityNote = '';
    if (telemetry && ctx.targetProfile) {
      const plausCheck = validateMixPlausibility(telemetry, ctx.targetProfile);
      if (!plausCheck.isPlausible && plausCheck.advisory) {
        plausibilityNote = `💡 **Plausibilitäts-Hinweis:** ${plausCheck.advisory}\n\n`;
      }
    }

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

    // Candidate fallback models when flagship model hits 503 ("high demand")
    // Dynamically populated from discovered models; strictly excludes deprecated 1.5 models
    const fallbackList = this.availableModels.filter(
      (m) => m !== this.modelName && m.includes('flash') && !m.includes('1.5')
    );
    const safeDefaults = ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    const modelCandidates = Array.from(
      new Set([this.modelName, ...fallbackList, ...safeDefaults].filter((m) => !m.includes('1.5')))
    );

    let lastError: Error | null = null;
    let usedModel = this.modelName;

    // Retry loop: Tries available keys and fallback models upon 503 / 429
    for (const candidateModel of modelCandidates) {
      const keysToTry = Math.max(1, this.keyManager.getKeysCount());

      for (let attempt = 0; attempt < keysToTry; attempt++) {
        const apiKey = this.keyManager.getNextKey();
        if (!apiKey) break;

        try {
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({
            model: candidateModel,
            systemInstruction: MIXING_BUDDY_SYSTEM_PROMPT,
            tools: [{ functionDeclarations: [functionDeclaration] }]
          });

          const result = await model.generateContent(fullPrompt);
          const response = await result.response;
          const call = response.functionCalls()?.[0];
          // Safely extract text: calling response.text() when the response only contains
          // a function-call part (no text parts) throws the SDK error
          // "model output must contain either output text or tool calls".
          // We guard against this by checking parts directly.
          const textParts = response.candidates?.[0]?.content?.parts?.filter((p: { text?: string }) => typeof p.text === 'string' && p.text.trim().length > 0) ?? [];
          const textOutput = textParts.length > 0 ? textParts.map((p: { text?: string }) => p.text ?? '').join('') : '';
          usedModel = candidateModel;

          let fallbackNote = '';
          if (usedModel !== this.modelName) {
            fallbackNote = `(Automatischer Fallback auf ${usedModel} wegen 503-Auslastung bei ${this.modelName})\n\n`;
          }

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
              assistantText:
                plausibilityNote +
                fallbackNote +
                (textOutput.trim() || input.rationale || `Ich habe die Anweisung analysiert und "${proposal.title}" vorgeschlagen.`),
              proposal
            };
          }

          // Structured JSON in text fallback
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
                  assistantText: plausibilityNote + fallbackNote + (parsed.rationale ?? textOutput),
                  proposal
                };
              }
            } catch {
              // Ignore parse error
            }
          }

          return {
            assistantText: plausibilityNote + fallbackNote + (textOutput.trim() || 'Gemini hat die Anweisung verarbeitet.')
          };
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const msg = lastError.message;

          // If rate limit (429) or temporary overload (503), put key in cooldown and rotate
          if (msg.includes('503') || msg.includes('429') || msg.includes('ResourceExhausted') || msg.includes('high demand')) {
            this.keyManager.markCooldown(apiKey, 60_000);
            continue; // try next key or fallback model
          }

          // If key is invalid, continue to next key
          if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
            this.keyManager.markCooldown(apiKey, 3600_000);
            continue;
          }

          // Other error: break key loop to try fallback model
          break;
        }
      }
    }

    const errDesc = lastError ? lastError.message : 'Alle Keys im Cooldown oder Modelle überlastet';
    return {
      assistantText: `⚠️ Gemini Anfrage fehlgeschlagen: ${errDesc}. Bitte prüfe die Keys oder weiche auf Managed Cloud / Ollama aus.`
    };
  }
}
