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
      return ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-pro'];
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
                !m.name.includes('2.5') && // Exclude legacy 2.5 models
                !m.name.includes('2.0') &&
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

    return ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-pro'];
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
    preferredModel = 'gemini-3.8-flash'
  ): Promise<KeyValidationResult> {
    const snippet = key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : key;
    try {
      // 1. Discover available models dynamically from API
      const models = await GeminiProvider.fetchAvailableModels(key);
      const testModel = models.includes(preferredModel)
        ? preferredModel
        : models.find((m) => m.includes('flash')) || models[0] || 'gemini-3.8-flash';

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
    // Dynamically populated from discovered models; strictly excludes deprecated legacy models
    const fallbackList = this.availableModels.filter(
      (m) => m !== this.modelName && m.includes('flash') && !m.includes('1.5') && !m.includes('2.5') && !m.includes('2.0')
    );
    const safeDefaults = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
    const modelCandidates = Array.from(
      new Set([this.modelName, ...fallbackList, ...safeDefaults].filter((m) => !m.includes('1.5') && !m.includes('2.5') && !m.includes('2.0')))
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
              status: 'pending',
              sidechainRoute: input.sidechainRoute
            };
            const normalized = normalizeProposal(proposal, tracks);
            return {
              assistantText:
                plausibilityNote +
                fallbackNote +
                (textOutput.trim() || input.rationale || `Ich habe die Anweisung analysiert und "${normalized.title}" vorgeschlagen.`),
              proposal: normalized
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
                  status: 'pending',
                  sidechainRoute: parsed.sidechainRoute
                };
                const normalized = normalizeProposal(proposal, tracks);
                return {
                  assistantText: plausibilityNote + fallbackNote + (parsed.rationale ?? textOutput),
                  proposal: normalized
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

/**
 * Resolves a track query (which may be an abbreviation like 'MoReKi', 'SimFou', 'StdGrn')
 * against the list of actual tracks in the active DAW session.
 */
export function resolveTrackDescriptor(
  query: string,
  tracks: TrackDescriptor[]
): TrackDescriptor | undefined {
  if (!query || tracks.length === 0) return undefined;
  const q = query.trim().toLowerCase();

  // 1. Exact match
  const exact = tracks.find((t) => t.name.toLowerCase() === q || t.id.toLowerCase() === q);
  if (exact) return exact;

  // 2. Substring match
  const sub = tracks.find((t) => t.name.toLowerCase().includes(q) || q.includes(t.name.toLowerCase()));
  if (sub) return sub;

  const qClean = q.replace(/[^a-z0-9]/g, '');
  if (!qClean) return undefined;

  // 3. Normalized clean alphanumeric match
  const cleanMatch = tracks.find((t) => {
    const tClean = t.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return tClean === qClean || tClean.includes(qClean) || qClean.includes(tClean);
  });
  if (cleanMatch) return cleanMatch;

  // 4. Explicit MCU LCD abbreviations table
  const mcuMap: Record<string, string> = {
    moreki: 'motown revisited kit',
    simfou: 'simple foundation',
    stdgrn: 'studio grand',
    stout: 'stereo out',
    st_out: 'stereo out'
  };
  if (mcuMap[qClean]) {
    const target = mcuMap[qClean];
    const found = tracks.find((t) => t.name.toLowerCase().includes(target));
    if (found) return found;
  }

  // 5. Initials / Acronym match
  const initialsMatch = tracks.find((t) => {
    const words = t.name.toLowerCase().split(/\s+/).filter(Boolean);
    const inits = words.map((w) => w[0]).join('');
    return inits === qClean || inits.includes(qClean);
  });
  if (initialsMatch) return initialsMatch;

  // 6. Subsequence matching (acronyms / abbreviations sharing starting character)
  if (qClean.length >= 2) {
    for (const t of tracks) {
      const tClean = t.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (tClean.length > 0 && tClean[0] === qClean[0]) {
        let i = 0;
        for (let j = 0; j < tClean.length && i < qClean.length; j++) {
          if (tClean[j] === qClean[i]) i++;
        }
        if (i === qClean.length) return t;
      }
    }
  }

  return undefined;
}

/**
 * Maps free-text / descriptive parameter names to canonical Channel EQ or Compressor parameter IDs
 */
export function mapParameterToCanonical(
  rawParam: string,
  _proposedValue: number,
  unit?: string
): { parameterName: string; pluginName?: string; unit?: string } {
  const p = rawParam.trim();
  const lower = p.toLowerCase();

  const canonicalEq = [
    'low_cut_frequency', 'low_cut_slope', 'low_cut_q',
    'low_shelf_gain', 'low_shelf_frequency', 'low_shelf_q',
    'peak_1_gain', 'peak_1_frequency', 'peak_1_q',
    'peak_2_gain', 'peak_2_frequency', 'peak_2_q',
    'peak_3_gain', 'peak_3_frequency', 'peak_3_q',
    'peak_4_gain', 'peak_4_frequency', 'peak_4_q',
    'high_shelf_gain', 'high_shelf_frequency', 'high_shelf_q',
    'high_cut_frequency', 'high_cut_slope', 'high_cut_q'
  ];

  const canonicalComp = ['threshold', 'ratio', 'attack', 'release', 'make_up', 'knee'];

  if (canonicalEq.includes(lower)) {
    return {
      parameterName: lower,
      pluginName: 'Channel EQ',
      unit: unit || (lower.includes('freq') ? 'Hz' : lower.includes('gain') ? 'dB' : lower.includes('q') ? 'Q' : 'dB/oct')
    };
  }

  if (canonicalComp.includes(lower)) {
    return {
      parameterName: lower,
      pluginName: 'Compressor',
      unit: unit || (lower === 'threshold' || lower === 'make_up' ? 'dB' : lower === 'ratio' ? ':1' : 'ms')
    };
  }

  if (lower === 'fader_db' || lower === 'volume' || lower === 'fader' || lower === 'lautstärke') {
    return { parameterName: 'fader_db', unit: 'dB' };
  }
  if (lower === 'pan' || lower === 'balance' || lower === 'panorama') {
    return { parameterName: 'pan', unit: '%' };
  }

  // Check for frequency mention (e.g. "60 Hz", "280 Hz", "3.8 kHz", "10 kHz", "Gain 60 Hz")
  const freqMatch = lower.match(/(\d+(?:\.\d+)?)\s*(k?hz)/);
  if (freqMatch) {
    let freq = parseFloat(freqMatch[1]);
    if (freqMatch[2] === 'khz') freq *= 1000;

    const isCut = lower.includes('cut') || lower.includes('pass') || lower.includes('filter');
    if (isCut) {
      if (freq <= 500) {
        return { parameterName: 'low_cut_frequency', pluginName: 'Channel EQ', unit: 'Hz' };
      }
      return { parameterName: 'high_cut_frequency', pluginName: 'Channel EQ', unit: 'Hz' };
    }

    // Gain at target frequency
    if (freq < 100) {
      return { parameterName: 'low_shelf_gain', pluginName: 'Channel EQ', unit: 'dB' };
    } else if (freq < 250) {
      return { parameterName: 'peak_1_gain', pluginName: 'Channel EQ', unit: 'dB' };
    } else if (freq < 1000) {
      return { parameterName: 'peak_2_gain', pluginName: 'Channel EQ', unit: 'dB' };
    } else if (freq < 3000) {
      return { parameterName: 'peak_3_gain', pluginName: 'Channel EQ', unit: 'dB' };
    } else if (freq < 8000) {
      return { parameterName: 'peak_4_gain', pluginName: 'Channel EQ', unit: 'dB' };
    } else {
      return { parameterName: 'high_shelf_gain', pluginName: 'Channel EQ', unit: 'dB' };
    }
  }

  // Keyword matching without explicit frequency
  if (lower.includes('air') || lower.includes('glanz') || lower.includes('brilliance') || lower.includes('high shelf') || lower.includes('presence')) {
    return { parameterName: 'high_shelf_gain', pluginName: 'Channel EQ', unit: 'dB' };
  }
  if (lower.includes('low shelf') || lower.includes('sub bass') || lower.includes('sub-bass') || lower.includes('bass boost') || lower.includes('bass gain')) {
    return { parameterName: 'low_shelf_gain', pluginName: 'Channel EQ', unit: 'dB' };
  }
  if (lower.includes('low cut') || lower.includes('high pass') || lower.includes('lowcut') || lower.includes('highpass') || lower.includes('sub rumble')) {
    return { parameterName: 'low_cut_frequency', pluginName: 'Channel EQ', unit: 'Hz' };
  }
  if (lower.includes('high cut') || lower.includes('low pass') || lower.includes('highcut') || lower.includes('lowpass')) {
    return { parameterName: 'high_cut_frequency', pluginName: 'Channel EQ', unit: 'Hz' };
  }
  if (lower.includes('mud') || lower.includes('boxiness') || lower.includes('low mid') || lower.includes('cardboard') || lower.includes('warmth')) {
    return { parameterName: 'peak_2_gain', pluginName: 'Channel EQ', unit: 'dB' };
  }
  if (lower.includes('threshold')) {
    return { parameterName: 'threshold', pluginName: 'Compressor', unit: 'dB' };
  }
  if (lower.includes('ratio')) {
    return { parameterName: 'ratio', pluginName: 'Compressor', unit: ':1' };
  }
  if (lower.includes('attack')) {
    return { parameterName: 'attack', pluginName: 'Compressor', unit: 'ms' };
  }
  if (lower.includes('release')) {
    return { parameterName: 'release', pluginName: 'Compressor', unit: 'ms' };
  }

  return { parameterName: p, unit: unit || 'dB' };
}

/**
 * Normalizes proposal deltas and sidechain routes:
 * - Resolves abbreviated track names to canonical DAW names
 * - Normalizes parameter names to canonical IDs
 * - Dynamically resolves plugin slots (e.g. Compressor slot 5 on bass track)
 */
export function normalizeProposal(
  proposal: MixActionProposal,
  tracks: TrackDescriptor[]
): MixActionProposal {
  if (!proposal) return proposal;

  const normalizedDeltas = (proposal.deltas || []).map((delta) => {
    // 1. Resolve Track Name
    const resolvedTrack = resolveTrackDescriptor(delta.trackName || delta.trackId, tracks);
    const finalTrackName = resolvedTrack ? resolvedTrack.name : delta.trackName;
    const finalTrackId = resolvedTrack ? resolvedTrack.id : delta.trackId;

    // 2. Map Parameter ID
    const mapped = mapParameterToCanonical(delta.parameterName, delta.proposedValue, delta.unit);
    const finalParam = mapped.parameterName;
    const finalPlugin = delta.pluginName || mapped.pluginName;
    const finalUnit = mapped.unit || delta.unit || 'dB';

    // 3. Resolve Slot Index dynamically if missing
    let finalSlot = delta.slotIndex;
    if (resolvedTrack && (finalSlot === undefined || finalSlot === 0)) {
      if (finalPlugin?.toLowerCase().includes('eq')) {
        const eqSlot = resolvedTrack.insertSlots.find((s) => s && s.pluginName?.toLowerCase().includes('eq'));
        if (eqSlot && eqSlot.slotIndex !== undefined) {
          finalSlot = eqSlot.slotIndex;
        }
      } else if (finalPlugin?.toLowerCase().includes('comp')) {
        const compSlot = resolvedTrack.insertSlots.find((s) => s && (s.pluginName?.toLowerCase().includes('comp') || s.pluginName?.toLowerCase().includes('compressor')));
        if (compSlot && compSlot.slotIndex !== undefined) {
          finalSlot = compSlot.slotIndex;
        }
      }
    }

    return {
      ...delta,
      trackId: finalTrackId,
      trackName: finalTrackName,
      parameterName: finalParam,
      pluginName: finalPlugin,
      slotIndex: finalSlot,
      unit: finalUnit
    };
  });

  // 4. Resolve Sidechain Route dynamically
  let sidechainRoute = proposal.sidechainRoute;
  const isDucking =
    proposal.category === 'dynamic_control' ||
    proposal.title.toLowerCase().includes('duck') ||
    proposal.rationale.toLowerCase().includes('sidechain') ||
    proposal.rationale.toLowerCase().includes('ducking');

  if (sidechainRoute || isDucking) {
    let targetTrackName = sidechainRoute?.trackName;
    if (!targetTrackName) {
      // Find bass or ducking target track from deltas or tracks
      const compDelta = normalizedDeltas.find((d) => d.pluginName?.toLowerCase().includes('comp'));
      targetTrackName = compDelta?.trackName || tracks.find((t) => t.name.toLowerCase().includes('bass') || t.name.toLowerCase().includes('foundation'))?.name || tracks[0]?.name;
    }

    const resolvedTarget = resolveTrackDescriptor(targetTrackName || '', tracks);
    const finalTargetName = resolvedTarget ? resolvedTarget.name : targetTrackName || 'Bass';

    // Resolve source track if it's "Audio > MoReKi" etc.
    let finalSourcePath = sidechainRoute?.sourcePath;
    if (!finalSourcePath) {
      const kickTrack = tracks.find((t) => t.name.toLowerCase().includes('kick') || t.name.toLowerCase().includes('motown') || t.name.toLowerCase().includes('drum'));
      finalSourcePath = kickTrack ? `Audio > ${kickTrack.name}` : 'Bus > Bus 1';
    } else if (finalSourcePath.includes('>')) {
      const parts = finalSourcePath.split('>');
      const category = parts[0].trim();
      const rawSource = parts.slice(1).join('>').trim();
      const resolvedSource = resolveTrackDescriptor(rawSource, tracks);
      if (resolvedSource) {
        finalSourcePath = `${category} > ${resolvedSource.name}`;
      }
    } else {
      const resolvedSource = resolveTrackDescriptor(finalSourcePath, tracks);
      if (resolvedSource) {
        finalSourcePath = `Audio > ${resolvedSource.name}`;
      }
    }

    // Dynamic slot lookup for Compressor on target track (e.g. Slot 5 on Simple Foundation)
    let finalSlot = sidechainRoute?.slotIndex ?? 1;
    if (resolvedTarget) {
      const compSlot = resolvedTarget.insertSlots.find((s) =>
        s && (s.pluginName?.toLowerCase().includes('comp') || s.pluginName?.toLowerCase().includes('compressor'))
      );
      if (compSlot && compSlot.slotIndex !== undefined && compSlot.slotIndex >= 1) {
        finalSlot = compSlot.slotIndex;
      }
    }

    sidechainRoute = {
      trackName: finalTargetName,
      slotIndex: finalSlot,
      sourcePath: finalSourcePath
    };

    // Update any deltas that were targeting the compressor on this track to use the dynamic slot
    for (const d of normalizedDeltas) {
      if (d.trackName === finalTargetName && (d.pluginName?.toLowerCase().includes('comp') || ['threshold', 'ratio', 'attack', 'release'].includes(d.parameterName))) {
        d.slotIndex = finalSlot;
        d.pluginName = 'Compressor';
      }
    }
  }

  return {
    ...proposal,
    deltas: normalizedDeltas,
    sidechainRoute
  };
}

