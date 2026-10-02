/**
 * AgentRunner.ts – Gemini ReAct Tool-Calling Loop (v2)
 *
 * Changes vs v1:
 *  - Role-Fix: function responses are injected as { role: 'user', parts: [{ functionResponse }] }
 *    to avoid the "Role 'function' is not supported" 400 error from the Gemini API.
 *  - Multi-Key Pool: accepts apiKeys: string[] and rotates on 429 / 503.
 *  - 300 ms inter-tool delay to avoid burst quota hits on the free tier.
 *
 * Tools exposed to Gemini:
 *   1. list_tracks          – fetch live channel strips + inserts from DAW
 *   2. get_track_details    – get insert slots for a specific track
 *   3. audition_region      – locate to bar, play N seconds, stop
 *   4. propose_mix_adjustment – final, validated MixActionProposal
 */

import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from '@google/generative-ai';
import type { MixActionProposal, TrackDescriptor, MetrologyTelemetryFrame } from '@mixing-buddy/shared-types';
import { MIXING_BUDDY_SYSTEM_PROMPT, type MixAnalysisContext } from '../prompts.js';
import { normalizeProposal } from './GeminiProvider.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type AgentStepStatus = 'running' | 'done' | 'error';

export interface AgentStep {
  id: string;
  icon: string;
  label: string;
  status: AgentStepStatus;
  detail?: string;
}

export interface AgentRunnerConfig {
  /**
   * Single key (backwards compat) – converted internally to a single-element pool.
   * Prefer apiKeys for multi-key rotation.
   */
  apiKey?: string;
  /** Multi-key pool: rotated on 429 / 503 */
  apiKeys?: string[];
  modelName?: string;
  /** Invokes a Tauri command – provided by caller so this file stays framework-agnostic */
  invokeTauri: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  /** Called whenever a new step starts or its status changes */
  onStep: (step: AgentStep) => void;
}

export interface AgentRunResult {
  assistantText: string;
  proposal?: MixActionProposal;
  steps: AgentStep[];
}

// --------------------------------------------------------------------------
// Tool Declarations
// --------------------------------------------------------------------------

const TOOL_LIST_TRACKS: FunctionDeclaration = {
  name: 'list_tracks',
  description:
    'Fetch live channel strips and insert plugins from the active DAW session. ' +
    'Always call this BEFORE proposing EQ or dynamics changes to discover which plugins exist on each track.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {}
  }
};

const TOOL_GET_TRACK_DETAILS: FunctionDeclaration = {
  name: 'get_track_details',
  description: 'Get detailed plugin/insert information for a specific track by name.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      trackName: { type: SchemaType.STRING, description: 'Exact or fuzzy track name' }
    },
    required: ['trackName']
  }
};

const TOOL_AUDITION_REGION: FunctionDeclaration = {
  name: 'audition_region',
  description:
    'Locate the DAW playhead to a specific bar and play back for a number of seconds so the engineer can hear the mix at that position.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      startBar: { type: SchemaType.INTEGER, description: 'Bar number to locate to (1-based)' },
      durationSeconds: { type: SchemaType.NUMBER, description: 'Playback duration in seconds (default 8)' }
    },
    required: ['startBar']
  }
};

const TOOL_PROPOSE: FunctionDeclaration = {
  name: 'propose_mix_adjustment',
  description:
    'Submit the final, validated mix adjustment proposal. ' +
    'Only call this AFTER you have verified plugin slots with list_tracks or get_track_details.',
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

// --------------------------------------------------------------------------
// AgentRunner
// --------------------------------------------------------------------------

export class AgentRunner {
  private cfg: AgentRunnerConfig;
  private steps: AgentStep[] = [];
  private fetchedStrips: ChannelStrip[] | null = null;

  /** Resolved key pool (always non-empty after construction guard) */
  private keyPool: string[] = [];
  /** Round-robin index into keyPool */
  private keyIndex = 0;

  constructor(config: AgentRunnerConfig) {
    this.cfg = config;
    // Build key pool from apiKeys or fall back to apiKey
    if (config.apiKeys && config.apiKeys.length > 0) {
      this.keyPool = config.apiKeys.filter((k) => k.trim().length > 5);
    } else if (config.apiKey && config.apiKey.trim().length > 5) {
      this.keyPool = [config.apiKey.trim()];
    }
  }

  // ── Key Rotation ──────────────────────────────────────────────────────────

  private currentKey(): string | null {
    return this.keyPool.length > 0 ? this.keyPool[this.keyIndex] : null;
  }

  private rotateKey(): void {
    if (this.keyPool.length > 1) {
      this.keyIndex = (this.keyIndex + 1) % this.keyPool.length;
    }
  }

  // ── Step helpers ──────────────────────────────────────────────────────────

  private addStep(icon: string, label: string): AgentStep {
    const step: AgentStep = {
      id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      icon,
      label,
      status: 'running'
    };
    this.steps.push(step);
    this.cfg.onStep({ ...step });
    return step;
  }

  private resolveStep(step: AgentStep, detail?: string): void {
    step.status = 'done';
    if (detail) step.detail = detail;
    this.cfg.onStep({ ...step });
  }

  private errorStep(step: AgentStep, detail: string): void {
    step.status = 'error';
    step.detail = detail;
    this.cfg.onStep({ ...step });
  }

  // ── Tool Implementations ──────────────────────────────────────────────────

  private async executeListTracks(): Promise<string> {
    const step = this.addStep('📋', 'Live-Spuren & Channel Strips laden');
    try {
      const result = await this.cfg.invokeTauri<{ channelStrips?: ChannelStrip[] }>('list_channel_strips');
      const strips: ChannelStrip[] = result.channelStrips ?? [];
      this.fetchedStrips = strips;
      const summary = strips.map((s) => ({
        name: s.trackName,
        inserts: (s.inserts ?? []).map((ins) => `Slot ${ins.slot}: ${ins.name}`)
      }));
      this.resolveStep(step, `${strips.length} Spuren geladen`);
      return JSON.stringify(summary);
    } catch (err) {
      this.errorStep(step, String(err));
      return JSON.stringify({ error: String(err), channelStrips: [] });
    }
  }

  private async executeGetTrackDetails(trackName: string): Promise<string> {
    const step = this.addStep('🔍', `Inserts auf „${trackName}" prüfen`);
    try {
      const strips: ChannelStrip[] = this.fetchedStrips ?? [];
      const match = strips.find(
        (s) =>
          s.trackName.toLowerCase().includes(trackName.toLowerCase()) ||
          trackName.toLowerCase().includes(s.trackName.toLowerCase())
      );
      if (!match) {
        const result = await this.cfg.invokeTauri<{ channelStrips?: ChannelStrip[] }>('list_channel_strips');
        const fresh = (result.channelStrips ?? []).find(
          (s) =>
            s.trackName.toLowerCase().includes(trackName.toLowerCase()) ||
            trackName.toLowerCase().includes(s.trackName.toLowerCase())
        );
        if (!fresh) {
          this.resolveStep(step, 'Spur nicht gefunden');
          return JSON.stringify({ error: `Track '${trackName}' not found`, inserts: [] });
        }
        this.resolveStep(step, `${(fresh.inserts ?? []).length} Inserts`);
        return JSON.stringify(fresh);
      }
      this.resolveStep(step, `${(match.inserts ?? []).length} Inserts auf „${match.trackName}"`);
      return JSON.stringify(match);
    } catch (err) {
      this.errorStep(step, String(err));
      return JSON.stringify({ error: String(err) });
    }
  }

  private async executeAuditionRegion(startBar: number, durationSeconds: number): Promise<string> {
    const dur = Math.max(2, Math.min(30, durationSeconds));
    const step = this.addStep('👂', `Wiedergabe Takt ${startBar} · ${dur}s`);
    try {
      await this.cfg.invokeTauri('daw_locate_bar', { bar: startBar });
      await agentDelay(200);
      await this.cfg.invokeTauri('daw_play', {});
      await agentDelay(dur * 1000);
      await this.cfg.invokeTauri('daw_stop', {});
      this.resolveStep(step, `Takt ${startBar} abgespielt`);
      return JSON.stringify({ success: true, bar: startBar, durationSeconds: dur });
    } catch (err) {
      this.errorStep(step, String(err));
      return JSON.stringify({ success: false, error: String(err) });
    }
  }

  // ── Anti-Hallucination Guard ──────────────────────────────────────────────

  private validateProposalAgainstStrips(
    input: Record<string, unknown>,
    tracks: TrackDescriptor[]
  ): { proposal: MixActionProposal; warnings: string[] } {
    const warnings: string[] = [];
    const rawDeltas = (input.deltas as Record<string, unknown>[]) ?? [];

    const sanitizedDeltas = rawDeltas.map((d) => {
      const delta = { ...(d as any) } as any;

      if (delta.pluginName && delta.trackName && this.fetchedStrips) {
        const strip = this.fetchedStrips.find(
          (s) =>
            s.trackName.toLowerCase().includes((delta.trackName as string).toLowerCase()) ||
            (delta.trackName as string).toLowerCase().includes(s.trackName.toLowerCase())
        );
        if (strip) {
          const inserts = strip.inserts ?? [];
          const pluginExists = inserts.some(
            (ins) =>
              ins.name.toLowerCase().includes((delta.pluginName as string).toLowerCase()) ||
              (delta.pluginName as string).toLowerCase().includes(ins.name.toLowerCase())
          );
          if (!pluginExists && delta.pluginName !== 'Master Fader') {
            warnings.push(
              `⚠️ Plugin "${delta.pluginName}" nicht auf Spur "${delta.trackName}" vorhanden. ` +
                `Verfügbare Inserts: ${inserts.map((i) => i.name).join(', ') || 'keine'}`
            );
            const eqInsert = inserts.find(
              (ins) => ins.name.toLowerCase().includes('eq') || ins.name.toLowerCase().includes('equalizer')
            );
            const compInsert = inserts.find(
              (ins) =>
                ins.name.toLowerCase().includes('comp') || ins.name.toLowerCase().includes('compressor')
            );
            const paramName = (delta.parameterName as string).toLowerCase();
            const isEqParam =
              paramName.includes('freq') ||
              paramName.includes('gain') ||
              paramName.includes('shelf') ||
              paramName.includes('peak') ||
              paramName.includes('cut') ||
              paramName.includes('band');
            const isCompParam = ['threshold', 'ratio', 'attack', 'release', 'knee'].includes(paramName);
            if (isEqParam && eqInsert) {
              delta.pluginName = eqInsert.name;
              delta.slotIndex = eqInsert.slot;
            } else if (isCompParam && compInsert) {
              delta.pluginName = compInsert.name;
              delta.slotIndex = compInsert.slot;
            } else if (inserts.length > 0) {
              delta.pluginName = inserts[0].name;
              delta.slotIndex = inserts[0].slot;
            }
          } else if (pluginExists) {
            const ins = inserts.find(
              (i) =>
                i.name.toLowerCase().includes((delta.pluginName as string).toLowerCase()) ||
                (delta.pluginName as string).toLowerCase().includes(i.name.toLowerCase())
            );
            if (ins && (delta.slotIndex === undefined || delta.slotIndex === 0)) {
              delta.slotIndex = ins.slot;
            }
          }
        }
      }

      return delta;
    });

    const proposal: MixActionProposal = {
      id: `prop_${Date.now()}_agent`,
      timestamp: Date.now(),
      category: (input.category as any) ?? 'eq_tonal_balance',
      title: (input.title as string) ?? 'Mix Adjustment',
      rationale: (input.rationale as string) ?? '',
      confidenceScore: (input.confidenceScore as number) ?? 0.9,
      deltas: sanitizedDeltas,
      status: 'pending',
      sidechainRoute: (input.sidechainRoute as any) ?? undefined
    };

    return { proposal, warnings };
  }

  // ── Gemini call with key-rotation retry ──────────────────────────────────

  /**
   * Sends a message to the model using the current key.
   * On 429 / 503 it rotates to the next key and retries once per available key.
   */
  private async sendWithRetry(
    modelName: string,
    systemInstruction: string,
    history: HistoryTurn[],
    newParts: PartUnion[]
  ): Promise<{ response: any; history: HistoryTurn[] }> {
    const maxAttempts = Math.max(1, this.keyPool.length);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const key = this.currentKey();
      if (!key) throw new Error('Kein gültiger API-Key vorhanden.');

      try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction,
          tools: [
            {
              functionDeclarations: [
                TOOL_LIST_TRACKS,
                TOOL_GET_TRACK_DETAILS,
                TOOL_AUDITION_REGION,
                TOOL_PROPOSE
              ]
            }
          ]
        });

        // Replay the full conversation history in this new session
        const chat = model.startChat({ history: history as any });
        const result = await chat.sendMessage(newParts as any);

        // Append turns to history for subsequent calls
        const updatedHistory: HistoryTurn[] = [
          ...history,
          { role: 'user' as const, parts: newParts as any[] },
          {
            role: 'model' as const,
            parts: (result.response.candidates?.[0]?.content?.parts ?? []) as any[]
          }
        ];

        return { response: result.response, history: updatedHistory };
      } catch (err) {
        const msg = String(err);
        const isQuotaError =
          msg.includes('429') ||
          msg.includes('503') ||
          msg.includes('ResourceExhausted') ||
          msg.includes('high demand') ||
          msg.includes('RESOURCE_EXHAUSTED');

        if (isQuotaError && this.keyPool.length > 1) {
          this.rotateKey();
          // Brief back-off before retrying with next key
          await agentDelay(800);
          continue;
        }
        throw err;
      }
    }

    throw new Error('Alle API-Keys haben Quota-Fehler zurückgegeben. Bitte warte kurz und versuche es erneut.');
  }

  // ── Main Run Loop ─────────────────────────────────────────────────────────

  async run(
    userPrompt: string,
    telemetry: MetrologyTelemetryFrame | null,
    tracks: TrackDescriptor[],
    context?: MixAnalysisContext
  ): Promise<AgentRunResult> {
    this.steps = [];
    this.fetchedStrips = null;
    this.keyIndex = 0;

    if (this.keyPool.length === 0) {
      return {
        assistantText: '⚠️ Kein Gemini API-Key konfiguriert.',
        steps: this.steps
      };
    }

    const modelName = this.cfg.modelName || 'gemini-2.5-flash';
    const systemInstruction = buildAgentSystemPrompt(tracks);

    const telemetrySummary = telemetry
      ? JSON.stringify({
          lufs: telemetry.loudness.momentaryLufs,
          truePeak: telemetry.loudness.truePeakDb,
          correlation: telemetry.dynamics.stereoCorrelation,
          frequencyBands32: telemetry.spectrum.frequencyBands
        })
      : 'No live telemetry.';

    const initialUserText =
      `Engineer request: "${userPrompt}"\n\nLive telemetry:\n${telemetrySummary}\n\n` +
      `Instructions: First call list_tracks to inspect the DAW session, then optionally ` +
      `audition_region to listen to a section, then propose_mix_adjustment with ONLY plugins ` +
      `that actually exist on the tracks.`;

    let history: HistoryTurn[] = [];
    let lastText = '';
    let finalProposal: MixActionProposal | undefined;
    const allWarnings: string[] = [];
    const MAX_ITERATIONS = 8;

    try {
      // ── First turn: user prompt ────────────────────────────────────────────
      const firstParts: PartUnion[] = [{ text: initialUserText }];
      let { response, history: h } = await this.sendWithRetry(
        modelName,
        systemInstruction,
        history,
        firstParts
      );
      history = h;

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        // Collect text output from this model turn
        const textParts =
          response.candidates?.[0]?.content?.parts?.filter(
            (p: { text?: string }) => typeof p.text === 'string' && p.text.trim().length > 0
          ) ?? [];
        if (textParts.length > 0) {
          lastText = textParts.map((p: { text?: string }) => p.text ?? '').join('');
        }

        // Check for function calls
        const calls = response.functionCalls?.() ?? [];
        if (!calls || calls.length === 0) {
          // No tool calls – model is done
          break;
        }

        // ── Execute tools ──────────────────────────────────────────────────
        const functionResponseParts: PartUnion[] = [];

        for (const call of calls) {
          const args = (call.args ?? {}) as Record<string, unknown>;

          let toolResult: string;
          if (call.name === 'list_tracks') {
            toolResult = await this.executeListTracks();
          } else if (call.name === 'get_track_details') {
            toolResult = await this.executeGetTrackDetails(String(args.trackName ?? ''));
          } else if (call.name === 'audition_region') {
            toolResult = await this.executeAuditionRegion(
              Number(args.startBar ?? 1),
              Number(args.durationSeconds ?? 8)
            );
          } else if (call.name === 'propose_mix_adjustment') {
            const { proposal, warnings } = this.validateProposalAgainstStrips(args, tracks);
            allWarnings.push(...warnings);
            finalProposal = normalizeProposal(proposal, tracks);
            toolResult =
              'Proposal received and validated. Please provide a brief musical explanation for the engineer.';
          } else {
            toolResult = JSON.stringify({ error: `Unknown tool: ${call.name}` });
          }

          // Role-Fix: inject as { functionResponse } part inside a USER turn
          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              response: { result: toolResult }
            }
          } as PartUnion);

          // 300 ms inter-tool pause to spread quota load across the free tier
          await agentDelay(300);
        }

        // ── Send function responses back to Gemini as a USER turn ──────────
        const { response: nextResponse, history: nextHistory } = await this.sendWithRetry(
          modelName,
          systemInstruction,
          history,
          functionResponseParts
        );
        response = nextResponse;
        history = nextHistory;

        // If we have a final proposal, collect the last explanatory text and stop
        if (finalProposal) {
          const finalParts =
            response.candidates?.[0]?.content?.parts?.filter(
              (p: { text?: string }) => typeof p.text === 'string' && p.text.trim().length > 0
            ) ?? [];
          if (finalParts.length > 0) {
            lastText = finalParts.map((p: { text?: string }) => p.text ?? '').join('');
          }
          break;
        }
      }
    } catch (err) {
      return {
        assistantText: `⚠️ Agent-Fehler: ${String(err)}`,
        steps: this.steps
      };
    }

    const warningText = allWarnings.length > 0 ? '\n\n' + allWarnings.join('\n') : '';
    const assistantText = (lastText.trim() || 'Agent hat die Analyse abgeschlossen.') + warningText;

    return {
      assistantText,
      proposal: finalProposal,
      steps: this.steps
    };
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function agentDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAgentSystemPrompt(tracks: TrackDescriptor[]): string {
  const trackList = tracks
    .map(
      (t) =>
        `- "${t.name}" (${t.type}): ${
          t.insertSlots.filter(Boolean).map((s) => s!.pluginName).join(', ') || 'no inserts'
        }`
    )
    .join('\n');

  return (
    MIXING_BUDDY_SYSTEM_PROMPT +
    `\n\n## AGENTIC TOOL USE RULES (STRICTLY ENFORCED)\n\n` +
    `1. ALWAYS call list_tracks first to discover real plugin slots.\n` +
    `2. NEVER propose a plugin that is not listed in list_tracks results for that track.\n` +
    `3. Use exact slot indices returned by list_tracks (e.g., Compressor at Slot 5).\n` +
    `4. If the engineer says "listen" or specifies a bar number, call audition_region first.\n` +
    `5. Only call propose_mix_adjustment as the FINAL step, after all inspection is complete.\n\n` +
    `## CURRENT TRACKS (may be stale – always call list_tracks to verify)\n` +
    trackList
  );
}

// --------------------------------------------------------------------------
// Internal types
// --------------------------------------------------------------------------

interface InsertInfo {
  slot: number;
  name: string;
}

interface ChannelStrip {
  trackName: string;
  inserts?: InsertInfo[];
}

/** Minimal history turn type that mirrors the Gemini SDK's Content */
interface HistoryTurn {
  role: 'user' | 'model';
  parts: PartUnion[];
}

/** Union of all Part variants used by the SDK */
type PartUnion =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: unknown } };
