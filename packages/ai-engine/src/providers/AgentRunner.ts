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
  /** Optional accessor for live telemetry frame from audio meter plugin */
  getTelemetry?: () => MetrologyTelemetryFrame | null;
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
      let rawResult: any = null;
      try {
        rawResult = await this.cfg.invokeTauri<any>('list_channel_strips');
      } catch (err) {
        console.warn('list_channel_strips invoke error:', err);
      }

      let rawList: any[] =
        rawResult?.channelStrips ??
        rawResult?.channel_strips ??
        (Array.isArray(rawResult) ? rawResult : []);

      // Fallback 1: get_channel_strips
      if (!rawList || rawList.length === 0) {
        try {
          const fallback = await this.cfg.invokeTauri<any>('get_channel_strips');
          rawList =
            fallback?.channelStrips ??
            fallback?.channel_strips ??
            (Array.isArray(fallback) ? fallback : []);
        } catch {}
      }

      // Fallback 2: get_tracks
      if (!rawList || rawList.length === 0) {
        try {
          const fallbackTracks = await this.cfg.invokeTauri<any>('get_tracks');
          rawList =
            fallbackTracks?.tracks ??
            fallbackTracks?.channelStrips ??
            fallbackTracks?.channel_strips ??
            (Array.isArray(fallbackTracks) ? fallbackTracks : []);
        } catch {}
      }

      // Fallback 3: Live telemetry HTTP endpoint on port 48123
      if (!rawList || rawList.length === 0) {
        try {
          const res = await fetch('http://127.0.0.1:48123/api/tracks');
          if (res.ok) {
            const json = await res.json();
            rawList = Array.isArray(json.tracks) ? json.tracks : Array.isArray(json) ? json : [];
          }
        } catch {}
      }

      const strips: ChannelStrip[] = (rawList || []).map((item: any) => ({
        trackName: item.trackName || item.track_name || item.name || 'Track',
        inserts: (item.inserts || item.insertSlots || []).map((ins: any, idx: number) => ({
          slot: typeof ins.slot === 'number' ? ins.slot : typeof ins.slotIndex === 'number' ? ins.slotIndex : idx,
          name: ins.name || ins.pluginName || ins.plugin_name || 'Plugin'
        }))
      }));

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
      let strips: ChannelStrip[] = this.fetchedStrips ?? [];
      let match = strips.find(
        (s) =>
          s.trackName.toLowerCase().includes(trackName.toLowerCase()) ||
          trackName.toLowerCase().includes(s.trackName.toLowerCase())
      );
      if (!match) {
        await this.executeListTracks();
        strips = this.fetchedStrips ?? [];
        match = strips.find(
          (s) =>
            s.trackName.toLowerCase().includes(trackName.toLowerCase()) ||
            trackName.toLowerCase().includes(s.trackName.toLowerCase())
        );
        if (!match) {
          this.resolveStep(step, 'Spur nicht gefunden');
          return JSON.stringify({ error: `Track '${trackName}' not found`, inserts: [] });
        }
      }
      this.resolveStep(step, `${(match.inserts ?? []).length} Inserts auf „${match.trackName}"`);
      return JSON.stringify(match);
    } catch (err) {
      this.errorStep(step, String(err));
      return JSON.stringify({ error: String(err) });
    }
  }

  // ── Abort and Delay helpers ───────────────────────────────────────────────

  private checkAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('Vom Benutzer abgebrochen.');
    }
  }

  private async executeAuditionRegion(
    startBar: number,
    durationSeconds: number,
    signal?: AbortSignal
  ): Promise<string> {
    const dur = Math.max(2, Math.min(30, durationSeconds));
    const step = this.addStep('👂', `Wiedergabe Takt ${startBar} · ${dur}s`);
    try {
      this.checkAborted(signal);

      let atomicSuccess = false;
      try {
        const atomicRes = await this.cfg.invokeTauri<any>('audition_region', {
          startBar,
          durationSeconds: dur
        });
        if (atomicRes && atomicRes.success !== false) {
          atomicSuccess = true;
        }
      } catch (err) {
        console.warn('audition_region atomic invoke failed, falling back to sequential transport:', err);
      }

      if (!atomicSuccess) {
        this.checkAborted(signal);
        await this.cfg.invokeTauri('daw_locate_bar', { bar: startBar });
        // Transport-Stabilisierung: mindestens 400 ms warten vor Playback
        await agentDelay(400, signal);
        this.checkAborted(signal);
        await this.cfg.invokeTauri('daw_play', {});
        try {
          await agentDelay(dur * 1000, signal);
        } finally {
          await this.cfg.invokeTauri('daw_stop', {});
        }
      }

      this.resolveStep(step, `Takt ${startBar} abgespielt`);
      return JSON.stringify({ success: true, bar: startBar, durationSeconds: dur });
    } catch (err) {
      if (signal?.aborted) {
        try {
          await this.cfg.invokeTauri('daw_stop', {});
        } catch {}
        this.errorStep(step, 'Abgebrochen');
        throw err;
      }
      this.errorStep(step, String(err));
      return JSON.stringify({ success: false, error: String(err) });
    }
  }

  // ── Anti-Hallucination Guard ──────────────────────────────────────────────

  private validateProposalAgainstStrips(
    input: Record<string, unknown>,
    tracks: TrackDescriptor[],
    isSilentPlayback?: boolean
  ): { proposal: MixActionProposal; warnings: string[] } {
    const warnings: string[] = [];
    const rawDeltas = (input.deltas as Record<string, unknown>[]) ?? [];

    let filteredDeltas = rawDeltas;
    if (isSilentPlayback) {
      filteredDeltas = rawDeltas.filter((d) => {
        const param = String(d.parameterName ?? '').toLowerCase();
        const isFader =
          param.includes('volume') ||
          param.includes('fader') ||
          param.includes('pegel') ||
          param.includes('gain');
        const targetVal = Number(d.targetValue ?? 0);
        const deltaVal = Number(d.deltaDb ?? d.delta ?? 0);
        if (isFader && (targetVal <= -50 || deltaVal < -20 || targetVal === -100)) {
          warnings.push(
            `⚠️ Absenkung auf ${targetVal} dB ignoriert: Signalpegel im ausgewählten Bereich zu niedrig für Gain-Staging.`
          );
          return false;
        }
        return true;
      });
      warnings.push('Signalpegel im ausgewählten Bereich zu niedrig für Gain-Staging.');
    }

    const sanitizedDeltas = filteredDeltas.map((d) => {
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
   * Calls model.generateContent({ contents }) with the current key.
   * On 429 / 503 it rotates to the next key and retries once.
   */
  private async generateContentWithRetry(
    modelName: string,
    systemInstruction: string,
    contents: GeminiContent[],
    signal?: AbortSignal
  ): Promise<any> {
    const maxAttempts = Math.min(2, Math.max(1, this.keyPool.length));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      this.checkAborted(signal);

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
                TOOL_AUDITION_REGION,
                TOOL_PROPOSE
              ]
            }
          ]
        });

        const result = await model.generateContent({ contents: contents as any });
        this.checkAborted(signal);
        return result.response;
      } catch (err) {
        if (signal?.aborted || String(err).includes('Vom Benutzer abgebrochen')) {
          throw new Error('Vom Benutzer abgebrochen.');
        }

        const msg = String(err);
        const isQuotaError =
          msg.includes('429') ||
          msg.includes('503') ||
          msg.includes('ResourceExhausted') ||
          msg.includes('high demand') ||
          msg.includes('RESOURCE_EXHAUSTED');

        if (isQuotaError && attempt === 0) {
          if (this.keyPool.length > 1) {
            const quotaStep = this.addStep('⏳', 'API-Quota erreicht · Wechsle Key & warte 2.5s...');
            this.rotateKey();
            await agentDelay(2500, signal);
            this.resolveStep(quotaStep, 'Weiter mit neuem Key');
            continue;
          } else {
            const quotaStep = this.addStep('⏳', 'API-Quota erreicht · Warte 2.5s Cooldown...');
            await agentDelay(2500, signal);
            this.resolveStep(quotaStep, 'Erneuter Versuch');
            continue;
          }
        }

        if (isQuotaError) {
          throw new Error('API-Quota für alle konfigurierten Keys erschöpft. Bitte warte kurz vor der nächsten Anfrage.');
        }

        throw err;
      }
    }

    throw new Error('API-Quota für alle konfigurierten Keys erschöpft. Bitte warte kurz vor der nächsten Anfrage.');
  }

  // ── Main Run Loop ─────────────────────────────────────────────────────────

  async run(
    userPrompt: string,
    telemetry: MetrologyTelemetryFrame | null,
    tracks: TrackDescriptor[],
    context?: MixAnalysisContext,
    signal?: AbortSignal
  ): Promise<AgentRunResult> {
    const activeSignal = signal ?? (context as any)?.signal;
    this.checkAborted(activeSignal);

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
      `Instructions: Complete your work efficiently in 2 turns! Call list_tracks to inspect the session (and audition_region if requested), then immediately submit propose_mix_adjustment with verified plugins!`;

    // Turn 1 (User): initial user request with live telemetry
    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [{ text: initialUserText }]
      }
    ];

    let lastText = '';
    let finalProposal: MixActionProposal | undefined;
    const allWarnings: string[] = [];
    const MAX_ITERATIONS = 3;
    let totalToolCalls = 0;
    const MAX_TOOL_CALLS = 3;
    let auditionExecuted = false;
    let isSilentPlayback = false;

    try {
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        this.checkAborted(activeSignal);

        const response = await this.generateContentWithRetry(
          modelName,
          systemInstruction,
          contents,
          activeSignal
        );

        this.checkAborted(activeSignal);

        // Turn 2 (Model): Append candidate parts to contents
        const candidateContent = response.candidates?.[0]?.content;
        const modelParts = candidateContent?.parts ?? [];
        contents.push({
          role: 'model',
          parts: modelParts
        });

        // Collect text output from this model turn
        const textParts = modelParts.filter(
          (p: { text?: string }) => typeof p.text === 'string' && p.text.trim().length > 0
        );
        if (textParts.length > 0) {
          lastText = textParts.map((p: { text?: string }) => p.text ?? '').join('');
        }

        // Check for function calls
        const calls = response.functionCalls?.() ?? [];
        if (!calls || calls.length === 0) {
          // No more tool calls – model is finished
          break;
        }

        // ── Execute tools ──────────────────────────────────────────────────
        const functionResponses: Array<{ name: string; result: any }> = [];

        for (const call of calls) {
          this.checkAborted(activeSignal);

          if (totalToolCalls >= MAX_TOOL_CALLS) {
            functionResponses.push({
              name: call.name,
              result: JSON.stringify({
                notice: 'Tool-Limit erreicht. Bitte schließe deine Analyse ab und reiche den finalen Vorschlag ein.'
              })
            });
            continue;
          }
          totalToolCalls++;

          const args = (call.args ?? {}) as Record<string, unknown>;

          let toolResult: string;
          if (call.name === 'list_tracks') {
            toolResult = await this.executeListTracks();
          } else if (call.name === 'get_track_details') {
            toolResult = await this.executeGetTrackDetails(String(args.trackName ?? ''));
          } else if (call.name === 'audition_region') {
            auditionExecuted = true;
            toolResult = await this.executeAuditionRegion(
              Number(args.startBar ?? 1),
              Number(args.durationSeconds ?? 8),
              activeSignal
            );
            const liveTelem = this.cfg.getTelemetry?.() ?? telemetry;
            const currentLufs = liveTelem?.loudness?.momentaryLufs ?? -70.0;
            if (currentLufs <= -70.0) {
              isSilentPlayback = true;
              toolResult = JSON.stringify({
                success: true,
                momentaryLufs: currentLufs,
                notice: 'Signalpegel im ausgewählten Bereich zu niedrig für Gain-Staging. Schlage KEINE Absenkung auf -100 dB vor!'
              });
            }
          } else if (call.name === 'propose_mix_adjustment') {
            const { proposal, warnings } = this.validateProposalAgainstStrips(
              args,
              tracks,
              isSilentPlayback
            );
            allWarnings.push(...warnings);
            finalProposal = normalizeProposal(proposal, tracks);
            toolResult =
              'Proposal received and validated. Please provide a brief musical explanation for the engineer.';
          } else {
            toolResult = JSON.stringify({ error: `Unknown tool: ${call.name}` });
          }

          this.checkAborted(activeSignal);

          functionResponses.push({
            name: call.name,
            result: toolResult
          });

          // 300 ms inter-tool pause to spread quota load across the free tier
          await agentDelay(300, activeSignal);
        }

        // Turn 3 (Tool-Ergebnisse vom User):
        contents.push({
          role: 'user',
          parts: functionResponses.map((fr) => ({
            functionResponse: {
              name: fr.name,
              response: { result: fr.result }
            }
          }))
        });
      }
    } catch (err) {
      if (activeSignal?.aborted || String(err).includes('Vom Benutzer abgebrochen')) {
        this.steps.forEach((s) => {
          if (s.status === 'running') {
            s.status = 'error';
            s.detail = s.detail ? `${s.detail} · Abgebrochen` : 'Abgebrochen';
          }
        });
        return {
          assistantText: '⏹ Vorgang vom Benutzer abgebrochen.',
          steps: this.steps
        };
      }
      return {
        assistantText: `⚠️ Agent-Fehler: ${String(err)}`,
        steps: this.steps
      };
    }

    const checkTelem = this.cfg.getTelemetry?.() ?? telemetry;
    if (auditionExecuted && (checkTelem?.loudness?.momentaryLufs ?? -70.0) <= -70.0) {
      isSilentPlayback = true;
    }

    if (isSilentPlayback && !allWarnings.some((w) => w.includes('Signalpegel im ausgewählten Bereich zu niedrig'))) {
      allWarnings.push('⚠️ Signalpegel im ausgewählten Bereich zu niedrig für Gain-Staging.');
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

function agentDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Vom Benutzer abgebrochen.'));
    }
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Vom Benutzer abgebrochen.'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
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
    `2. list_tracks provides ALL tracks and their insert plugins directly. NEVER invent short names or abbreviations (like "MoReKi", "SimFou", "StdGrn"). Always use the exact track names returned by list_tracks.\n` +
    `3. NEVER propose a plugin that is not listed in list_tracks results for that track.\n` +
    `4. Use exact slot indices returned by list_tracks (e.g., Compressor at Slot 5).\n` +
    `5. If the engineer says "listen", "höre", or specifies a bar number, call audition_region.\n` +
    `6. Only call propose_mix_adjustment as the FINAL step, after inspection is complete.\n` +
    `7. Be efficient: complete your recommendations within at most 2-3 tool turns.\n\n` +
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

export interface GeminiContent {
  role: 'user' | 'model';
  parts: any[];
}
