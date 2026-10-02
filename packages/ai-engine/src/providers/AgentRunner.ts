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

export interface AgentUsageStats {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  durationMs: number;
  turnsCount: number;
  model: string;
  activeKeyCount: number;
  estimatedCostUsd: number;
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
  /** Optional callback for token usage, latency and key pool telemetry */
  onUsageUpdate?: (stats: AgentUsageStats) => void;
}

export interface AgentRunResult {
  assistantText: string;
  proposal?: MixActionProposal;
  steps: AgentStep[];
  usage?: AgentUsageStats;
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

const TOOL_AUDITION_REGION: FunctionDeclaration = {
  name: 'audition_region',
  description:
    'Locate the DAW playhead to a specific bar and play back for a range of bars or duration in seconds so the engineer can hear the mix at that position.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      startBar: { type: SchemaType.INTEGER, description: 'Start bar number to locate to (1-based)' },
      endBar: { type: SchemaType.INTEGER, description: 'Optional end bar number (e.g. 13 for "Takt 9 bis 13")' },
      durationSeconds: { type: SchemaType.NUMBER, description: 'Playback duration in seconds (computed automatically from bar range if not specified)' }
    },
    required: ['startBar']
  }
};

const TOOL_SET_TRACK_STATE: FunctionDeclaration = {
  name: 'set_track_state',
  description:
    'Directly adjust a track state in the DAW session: set fader volume (dB), pan (-63..+63), mute/solo toggle, or automation mode ("touch", "latch", "read", "write").',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      trackName: { type: SchemaType.STRING, description: 'Exact or fuzzy name of the track' },
      faderDb: { type: SchemaType.NUMBER, description: 'Target volume in dB (-96.0 to +6.0)' },
      pan: { type: SchemaType.INTEGER, description: 'Pan balance from -63 (hard left) to +63 (hard right)' },
      mute: { type: SchemaType.BOOLEAN, description: 'Mute state' },
      solo: { type: SchemaType.BOOLEAN, description: 'Solo state' },
      automationMode: {
        type: SchemaType.STRING,
        description: 'Automation mode: "read", "touch", "latch", "write", "trim", "off"'
      }
    },
    required: ['trackName']
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

const TOOL_PROPOSE: FunctionDeclaration = {
  name: 'propose_mix_adjustment',
  description:
    'Submit the final, validated mix adjustment proposal. ' +
    'Only call this AFTER you have verified plugin slots with list_tracks.',
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

  // ── Zero-Turn Local Prefetching ──────────────────────────────────────────

  private async prefetchChannelStrips(fallbackTracks: TrackDescriptor[]): Promise<ChannelStrip[]> {
    try {
      let rawList: any[] = [];
      try {
        const rawResult = await this.cfg.invokeTauri<any>('list_channel_strips');
        rawList =
          rawResult?.channelStrips ??
          rawResult?.channel_strips ??
          (Array.isArray(rawResult) ? rawResult : []);
      } catch {}

      if (!rawList || rawList.length === 0) {
        try {
          const fallback = await this.cfg.invokeTauri<any>('get_channel_strips');
          rawList =
            fallback?.channelStrips ??
            fallback?.channel_strips ??
            (Array.isArray(fallback) ? fallback : []);
        } catch {}
      }

      if (!rawList || rawList.length === 0) {
        try {
          const fallbackTracksRes = await this.cfg.invokeTauri<any>('get_tracks');
          rawList =
            fallbackTracksRes?.tracks ??
            fallbackTracksRes?.channelStrips ??
            fallbackTracksRes?.channel_strips ??
            (Array.isArray(fallbackTracksRes) ? fallbackTracksRes : []);
        } catch {}
      }

      if (!rawList || rawList.length === 0) {
        try {
          const res = await fetch('http://127.0.0.1:48123/api/tracks');
          if (res.ok) {
            const json = await res.json();
            rawList = Array.isArray(json.tracks) ? json.tracks : Array.isArray(json) ? json : [];
          }
        } catch {}
      }

      if (rawList && rawList.length > 0) {
        return rawList.map((item: any) => ({
          trackName: item.trackName || item.track_name || item.name || 'Track',
          faderDb: typeof item.faderDb === 'number' ? item.faderDb : typeof item.volume === 'number' ? item.volume : 0.0,
          pan: typeof item.pan === 'number' ? item.pan : 0,
          inserts: (item.inserts || item.insertSlots || []).map((ins: any, idx: number) => ({
            slot: typeof ins.slot === 'number' ? ins.slot : typeof ins.slotIndex === 'number' ? ins.slotIndex : idx,
            name: ins.name || ins.pluginName || ins.plugin_name || 'Plugin'
          }))
        }));
      }
    } catch (err) {
      console.warn('Prefetch error:', err);
    }

    // Fallback: convert passed-in TrackDescriptor[]
    return (fallbackTracks || []).map((t) => ({
      trackName: t.name,
      faderDb: 0.0,
      pan: 0,
      inserts: t.insertSlots.filter(Boolean).map((s, idx) => ({
        slot: s!.slotIndex ?? idx,
        name: s!.pluginName
      }))
    }));
  }

  // ── Tool Implementations ──────────────────────────────────────────────────

  private async executeListTracks(): Promise<string> {
    const step = this.addStep('📋', 'Live-Spuren & Channel Strips laden');
    try {
      if (this.fetchedStrips && this.fetchedStrips.length > 0) {
        const summary = this.fetchedStrips.map((s) => ({
          name: s.trackName,
          inserts: (s.inserts ?? []).map((ins) => `Slot ${ins.slot}: ${ins.name}`)
        }));
        this.resolveStep(step, `${this.fetchedStrips.length} Spuren (aus Cache)`);
        return JSON.stringify(summary);
      }

      const strips = await this.prefetchChannelStrips([]);
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
    endBar?: number,
    durationSeconds?: number,
    signal?: AbortSignal,
    userPrompt?: string
  ): Promise<string> {
    // Falls userPrompt eine Bar-Range nennt ("Takt 9 bis 13") und endBar nicht übergeben wurde:
    let sBar = startBar;
    let eBar = endBar;
    if ((!eBar || eBar <= sBar) && (!durationSeconds || durationSeconds === 8)) {
      const match = (userPrompt ?? '').match(/(?:takt|bar|bars|takte)\s*(\d+)\s*(?:bis|to|-)\s*(\d+)/i);
      if (match) {
        const pStart = parseInt(match[1], 10);
        const pEnd = parseInt(match[2], 10);
        if (pEnd > pStart) {
          sBar = pStart;
          eBar = pEnd;
        }
      }
    }

    let dur = typeof durationSeconds === 'number' && durationSeconds > 0 ? durationSeconds : 8;
    if (typeof eBar === 'number' && eBar > sBar) {
      const barCount = eBar - sBar;
      // Dynamische Abspieldauer: 2.4s pro Takt bei 100 BPM (z. B. 4 Takte = 9.6s)
      dur = Math.max(2, barCount * 2.4);
    }
    dur = Math.max(2, Math.min(30, dur));

    const stepLabel = eBar && eBar > sBar
      ? `Wiedergabe Takt ${sBar} bis ${eBar} · ${dur.toFixed(1)}s`
      : `Wiedergabe Takt ${sBar} · ${dur.toFixed(1)}s`;

    const step = this.addStep('👂', stepLabel);
    try {
      this.checkAborted(signal);

      // Zwingend daw_locate_bar aufrufen und 300 ms asynchron warten,
      // damit Logic Pro den Playhead im Dialog "Zu Position" physisch platziert,
      // BEVOR daw_play getriggert wird!
      await this.cfg.invokeTauri('daw_locate_bar', { bar: sBar });
      await agentDelay(300, signal);
      this.checkAborted(signal);

      await this.cfg.invokeTauri('daw_play', {});
      try {
        await agentDelay(dur * 1000, signal);
      } finally {
        await this.cfg.invokeTauri('daw_stop', {});
      }

      this.resolveStep(step, eBar && eBar > sBar ? `Takt ${sBar} bis ${eBar} abgespielt` : `Takt ${sBar} abgespielt`);
      return JSON.stringify({ success: true, startBar: sBar, endBar: eBar, durationSeconds: dur });
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

  private async executeSetTrackState(
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    const trackName = String(args.trackName ?? '');
    const step = this.addStep('🎛️', `Spur anpassen: ${trackName}`);
    try {
      this.checkAborted(signal);
      const res = await this.cfg.invokeTauri<any>('set_track_state', {
        trackName,
        faderDb: typeof args.faderDb === 'number' ? args.faderDb : undefined,
        pan: typeof args.pan === 'number' ? args.pan : undefined,
        mute: typeof args.mute === 'boolean' ? args.mute : undefined,
        solo: typeof args.solo === 'boolean' ? args.solo : undefined,
        automationMode: typeof args.automationMode === 'string' ? args.automationMode : undefined
      });

      const details: string[] = [];
      if (typeof args.faderDb === 'number') details.push(`${args.faderDb.toFixed(1)} dB`);
      if (typeof args.pan === 'number') details.push(`Pan: ${args.pan}`);
      if (typeof args.mute === 'boolean') details.push(args.mute ? 'Muted' : 'Unmuted');
      if (typeof args.solo === 'boolean') details.push(args.solo ? 'Soloed' : 'Unsoloed');
      if (typeof args.automationMode === 'string') details.push(`Auto: ${args.automationMode}`);

      this.resolveStep(step, details.join(' · ') || 'Spur aktualisiert');
      return JSON.stringify(res ?? { success: true, trackName });
    } catch (err) {
      if (signal?.aborted) {
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
          // 1. Sortiere Inserts strikt aufsteigend nach physischem Slot (1 bis 15)
          const inserts = [...(strip.inserts ?? [])].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
          const pluginNameLower = String(delta.pluginName).toLowerCase().trim();
          const paramNameLower = String(delta.parameterName ?? '').toLowerCase().trim();

          // 2. Priorisiertes Matching:
          // Prio 1: Exakter Wortabgleich (z. B. "comp" === "comp" oder "compressor" === "compressor")
          let matchedInsert = inserts.find(
            (ins) => ins.name.toLowerCase().trim() === pluginNameLower
          );

          // Prio 2: Typen- und Familien-Abgleich (z. B. "Compressor" matcht "Comp", NICHT "Glow" oder "Limit")
          if (!matchedInsert) {
            const isCompQuery =
              pluginNameLower.includes('comp') ||
              pluginNameLower.includes('dynamics') ||
              paramNameLower.includes('threshold') ||
              paramNameLower.includes('ratio') ||
              paramNameLower.includes('attack') ||
              paramNameLower.includes('release');
            const isEqQuery =
              pluginNameLower.includes('eq') ||
              pluginNameLower.includes('equalizer') ||
              paramNameLower.includes('freq') ||
              paramNameLower.includes('gain') ||
              paramNameLower.includes('shelf') ||
              paramNameLower.includes('peak') ||
              paramNameLower.includes('cut') ||
              paramNameLower.includes('band') ||
              paramNameLower.includes('q');
            const isLimitQuery = pluginNameLower.includes('limit');
            const isGlowQuery = pluginNameLower.includes('glow');
            const isPhatQuery = pluginNameLower.includes('phat');
            const isAmpQuery = pluginNameLower.includes('amp');

            if (isCompQuery && !isLimitQuery && !isGlowQuery && !isPhatQuery) {
              // Nimm das ERSTE gefundene Kompressor-Plugin von oben nach unten (z. B. Slot 2 "Comp")
              matchedInsert = inserts.find((ins) => {
                const n = ins.name.toLowerCase();
                return (n.includes('comp') || n.includes('compressor')) && !n.includes('glow') && !n.includes('limit');
              });
            } else if (isEqQuery) {
              matchedInsert = inserts.find((ins) => {
                const n = ins.name.toLowerCase();
                return n.includes('eq') || n.includes('equalizer');
              });
            } else if (isLimitQuery) {
              matchedInsert = inserts.find((ins) => ins.name.toLowerCase().includes('limit'));
            } else if (isGlowQuery) {
              matchedInsert = inserts.find((ins) => ins.name.toLowerCase().includes('glow'));
            } else if (isPhatQuery) {
              matchedInsert = inserts.find((ins) => ins.name.toLowerCase().includes('phat'));
            } else if (isAmpQuery) {
              matchedInsert = inserts.find((ins) => ins.name.toLowerCase().includes('amp'));
            }
          }

          // Prio 3: Substring-Match (von oben nach unten)
          if (!matchedInsert) {
            matchedInsert = inserts.find(
              (ins) =>
                ins.name.toLowerCase().includes(pluginNameLower) ||
                (pluginNameLower.length >= 4 && pluginNameLower.includes(ins.name.toLowerCase()))
            );
          }

          if (matchedInsert) {
            // ECHTER 1-basierter Slot-Index gefunden! IMMER überschreiben/korrigieren!
            if (delta.slotIndex !== matchedInsert.slot) {
              warnings.push(
                `ℹ️ Slot für "${delta.pluginName}" auf Spur "${strip.trackName}" auf realen Slot ${matchedInsert.slot} (${matchedInsert.name}) korrigiert.`
              );
              delta.slotIndex = matchedInsert.slot;
            }
            delta.pluginName = matchedInsert.name;
          } else if (delta.pluginName !== 'Master Fader') {
            if (inserts.length > 0) {
              warnings.push(
                `⚠️ Plugin "${delta.pluginName}" nicht auf Spur "${strip.trackName}" vorhanden. Verfügbare Inserts: ${inserts.map((i) => `${i.name} (Slot ${i.slot})`).join(', ')}.`
              );
              if (delta.slotIndex === undefined || delta.slotIndex === 0) {
                delta.slotIndex = inserts[0].slot;
              }
            } else {
              warnings.push(
                `⚠️ Plugin "${delta.pluginName}" nicht auf Spur "${strip.trackName}" vorhanden (Spur hat keine Inserts).`
              );
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
    const maxAttempts = Math.min(3, Math.max(1, this.keyPool.length));

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
                TOOL_SET_TRACK_STATE,
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
        const is503 = msg.includes('503') || msg.includes('overloaded') || msg.includes('Service Unavailable');
        const is429 =
          msg.includes('429') ||
          msg.includes('ResourceExhausted') ||
          msg.includes('high demand') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('quota');
        const isQuotaOrOverload = is503 || is429;

        if (isQuotaOrOverload && attempt < maxAttempts - 1) {
          // Sofortigen Key-Wechsel im Pool veranlassen
          if (this.keyPool.length > 1) {
            this.rotateKey();
          }

          // Bei 503: Exponentieller Jitter-Backoff zwischen 1.5s und 2.5s zufällig
          const waitMs = is503
            ? Math.floor(Math.random() * 1000) + 1500
            : (attempt === 0 ? 2500 : 3500);

          const stepLabel = is503
            ? `Model überlastet (503) · Jitter (${(waitMs / 1000).toFixed(1)}s) & Key-Wechsel...`
            : `API-Quota erreicht (429) · Wechsle Key & Cooldown (${(waitMs / 1000).toFixed(1)}s)...`;

          const quotaStep = this.addStep('⏳', stepLabel);
          await agentDelay(waitMs, signal);
          this.resolveStep(quotaStep, 'Weiter mit neuem Key');
          continue;
        }

        if (isQuotaOrOverload) {
          throw new Error('API-Quota oder Modell-Kapazität erschöpft (503/429). Bitte warte kurz vor der nächsten Anfrage.');
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
    const startTime = performance.now();
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
    const systemInstruction = buildAgentSystemPrompt();

    // ── Zero-Turn Local Prefetching (0 API tokens, 0ms latency) ──────────────
    const prefetchStep = this.addStep('⚡', 'Session-Kontext & Spuren lokal vorbereiten');
    const rawStrips = await this.prefetchChannelStrips(tracks);
    this.fetchedStrips = rawStrips;

    // Striktes Pruning des Session-Kontexts (Token-Diät: < 1.200 Tokens)
    const compactStrips = rawStrips.map((s) => ({
      t: s.trackName,
      db: typeof s.faderDb === 'number' ? Math.round(s.faderDb * 10) / 10 : 0.0,
      pan: typeof s.pan === 'number' ? s.pan : 0,
      fx: (s.inserts || []).map((i) => i.name).filter(Boolean)
    }));

    const liveTelem = this.cfg.getTelemetry?.() ?? telemetry;
    const compactTelemetry = liveTelem
      ? {
          lufs: Math.round((liveTelem.loudness?.momentaryLufs ?? -70.0) * 10) / 10,
          tp: Math.round(
            ((typeof liveTelem.loudness?.truePeakDb === 'number'
              ? liveTelem.loudness.truePeakDb
              : liveTelem.loudness?.truePeakDb?.left) ?? -1.0) * 10
          ) / 10,
          corr: Math.round((liveTelem.dynamics?.stereoCorrelation ?? 1.0) * 100) / 100,
          crest: Math.round((liveTelem.dynamics?.crestFactorDb ?? 10.0) * 10) / 10
        }
      : null;

    this.resolveStep(prefetchStep, `${compactStrips.length} Spuren ultra-kompakt bereitgestellt`);

    const lowerPrompt = userPrompt.toLowerCase();
    const wantsAudition =
      lowerPrompt.includes('h\u00f6re') ||
      lowerPrompt.includes('listen') ||
      lowerPrompt.includes('audition') ||
      lowerPrompt.includes('takt') ||
      lowerPrompt.includes('bar');

    const barMatch = userPrompt.match(/(?:takt|bar)\s*(\d+)/i);
    const suggestedBar = barMatch ? parseInt(barMatch[1], 10) : undefined;

    const initialUserText =
      `Engineer request: "${userPrompt}"\n\n` +
      `SESSION CONTEXT (PREFETCHED):\n` +
      `- Tracks & Inserts: ${JSON.stringify(compactStrips)}\n` +
      `- Live Metrology: ${compactTelemetry ? JSON.stringify(compactTelemetry) : 'Standby / Low Signal'}\n\n` +
      `STRICT DIRECTIVE:\n` +
      `SESSION CONTEXT ALREADY ATTACHED. Do NOT call \`list_tracks\`. ` +
      (wantsAudition
        ? `User requested auditioning${suggestedBar ? ` around bar ${suggestedBar}` : ''}. Call \`audition_region\` once, then immediately generate \`propose_mix_adjustment\`! (Max 2 turns total)`
        : `Generate \`propose_mix_adjustment\` immediately in this turn!`);

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

    let promptTokens = 0;
    let candidatesTokens = 0;
    let totalTokens = 0;
    let turnsCount = 0;

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

        // Track token usage
        turnsCount++;
        if (response.usageMetadata) {
          promptTokens += response.usageMetadata.promptTokenCount ?? 0;
          candidatesTokens += response.usageMetadata.candidatesTokenCount ?? 0;
          totalTokens = promptTokens + candidatesTokens;
        }

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
          } else if (call.name === 'set_track_state') {
            toolResult = await this.executeSetTrackState(args, activeSignal);
          } else if (call.name === 'get_track_details') {
            toolResult = await this.executeGetTrackDetails(String(args.trackName ?? ''));
          } else if (call.name === 'audition_region') {
            auditionExecuted = true;
            toolResult = await this.executeAuditionRegion(
              Number(args.startBar ?? 1),
              args.endBar !== undefined ? Number(args.endBar) : undefined,
              args.durationSeconds !== undefined ? Number(args.durationSeconds) : undefined,
              activeSignal,
              userPrompt
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

    const durationMs = Math.round(performance.now() - startTime);
    const estimatedCostUsd = (promptTokens * 0.000000075) + (candidatesTokens * 0.0000003);

    const usageStats: AgentUsageStats = {
      promptTokenCount: promptTokens,
      candidatesTokenCount: candidatesTokens,
      totalTokenCount: totalTokens,
      durationMs,
      turnsCount,
      model: modelName,
      activeKeyCount: this.keyPool.length,
      estimatedCostUsd
    };

    try {
      this.cfg.onUsageUpdate?.(usageStats);
    } catch (e) {
      console.warn('onUsageUpdate error:', e);
    }

    return {
      assistantText,
      proposal: finalProposal,
      steps: this.steps,
      usage: usageStats
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

function buildAgentSystemPrompt(): string {
  return (
    MIXING_BUDDY_SYSTEM_PROMPT +
    `\n\n## AGENTIC TOOL USE RULES (STRICTLY ENFORCED)\n\n` +
    `1. ZERO-TURN PREFETCH: Session context (tracks, faders, pans, inserts, metrology) is already attached in the prompt. Do NOT call \`list_tracks\`!\n` +
    `2. If user requested listening/auditioning (e.g. mentions "höre", "listen", or a bar number), call \`audition_region\` once, then immediately generate \`propose_mix_adjustment\`.\n` +
    `3. Always use the exact track names from the attached session context (NEVER invent or abbreviate names).\n` +
    `4. NEVER propose a plugin that is not listed in the attached fx array for that track.\n` +
    `5. Immediately submit \`propose_mix_adjustment\` with verified plugins as your final proposal.\n` +
    `6. MAX 2 TURNS: Complete in at most 2 turns (Turn 1: audition_region if requested -> Turn 2: propose_mix_adjustment). If no audition is requested, output propose_mix_adjustment in Turn 1!`
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
  faderDb?: number;
  pan?: number;
  inserts?: InsertInfo[];
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: any[];
}
