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
import {
  type MixActionProposal,
  type TrackDescriptor,
  type MetrologyTelemetryFrame,
  type TargetScope,
  type TargetProfile,
  type GenreProfileId,
  resolveTargetProfile
} from '@mixing-buddy/shared-types';
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
// Audition Intent Parsing (Single-Pass Deterministisch)
// --------------------------------------------------------------------------

export function parseAuditionIntent(prompt: string): { startBar: number; endBar: number; durationSeconds: number } | null {
  const lower = prompt.toLowerCase();
  const wantsAudition =
    lower.includes('höre') ||
    lower.includes('hoer') ||
    lower.includes('listen') ||
    lower.includes('audition') ||
    lower.includes('takt') ||
    lower.includes('bar');

  if (!wantsAudition) return null;

  // 1. Bereichssuche: "Takt 9 bis 13", "Takt 9 - 13", "Bar 9 to 13"
  const rangeMatch = prompt.match(/(?:takt|bar|bars|takte)\s*(\d+)\s*(?:bis|to|-|\.\.)\s*(?:takt|bar)?\s*(\d+)/i);
  if (rangeMatch) {
    const s = parseInt(rangeMatch[1], 10);
    const e = parseInt(rangeMatch[2], 10);
    const startBar = Math.max(1, Math.min(s, e));
    const endBar = Math.max(startBar + 1, Math.max(s, e));
    const barCount = endBar - startBar;
    // 2.4s pro Takt bei 100 BPM (z. B. 4 Takte = 9.6s)
    const durationSeconds = Math.round(Math.max(2.0, Math.min(30.0, barCount * 2.4)) * 10) / 10;
    return { startBar, endBar, durationSeconds };
  }

  // 2. Einzelner Takt: "starte bei Takt 25", "ab Takt 9", "Takt 9", "bar 16"
  const singleMatch = prompt.match(/(?:takt|bar)\s*(\d+)/i);
  if (singleMatch) {
    const startBar = Math.max(1, parseInt(singleMatch[1], 10));
    const endBar = startBar + 4;
    const durationSeconds = 9.6;
    return { startBar, endBar, durationSeconds };
  }

  // 3. Allgemeine Höranweisung ohne Taktangabe ("Höre dir den Mix an"): Standard Takt 1 bis 5 (9.6s)
  return { startBar: 1, endBar: 5, durationSeconds: 9.6 };
}

// --------------------------------------------------------------------------
// AgentRunner
// --------------------------------------------------------------------------

export class AgentRunner {
  public static cumulativeSessionTokens = 0;
  public static cumulativePromptTokens = 0;
  public static cumulativeCandidatesTokens = 0;
  public static cumulativeTurnsCount = 0;

  public static resetSessionTokens(): void {
    AgentRunner.cumulativeSessionTokens = 0;
    AgentRunner.cumulativePromptTokens = 0;
    AgentRunner.cumulativeCandidatesTokens = 0;
    AgentRunner.cumulativeTurnsCount = 0;
  }

  // ── Legal Studio Multi-Key Engine ─────────────────────────────────────────
  public static keyRequestHistory: Map<string, number[]> = new Map();
  public static lastGlobalApiCallTime = 0;
  public static globalKeyIndex = 0;

  private cfg: AgentRunnerConfig;
  private steps: AgentStep[] = [];
  private fetchedStrips: ChannelStrip[] | null = null;

  /** Resolved key pool (always non-empty after construction guard) */
  public apiKeys: string[] = [];
  /** Current key index in apiKeys pool */
  public currentKeyIndex = 0;
  /** Active model (supports 503 resilient fallback) */
  public activeModel: string = 'gemini-3.8-flash';

  constructor(config: AgentRunnerConfig) {
    this.cfg = config;
    this.activeModel = config.modelName || 'gemini-3.8-flash';
    // Build key pool from apiKeys or fall back to apiKey
    if (config.apiKeys && config.apiKeys.length > 0) {
      this.apiKeys = config.apiKeys.map((k) => k.trim()).filter((k) => k.length > 5);
    } else if (config.apiKey && config.apiKey.trim().length > 5) {
      this.apiKeys = [config.apiKey.trim()];
    }
    if (this.apiKeys.length > 0) {
      this.currentKeyIndex = AgentRunner.globalKeyIndex % this.apiKeys.length;
    }
  }

  // Backward compatibility getter
  public get keyPool(): string[] {
    return this.apiKeys;
  }

  // ── Proactive Key Rotation with 80% Quota Capping & Pacing ────────────────

  /**
   * Proaktive Rotation bei JEDEM Request + 80% Quota-Deckelung (max 4 Anfragen/60s)
   * + Mindestabstand (Pacing) von mindestens 1.500 ms.
   */
  private async getNextKeyWithPacing(signal?: AbortSignal): Promise<string> {
    if (this.apiKeys.length === 0) {
      throw new Error('Kein gültiger API-Key im Pool konfiguriert.');
    }

    // 1. Mindestabstand (Pacing): mind. 1.500 ms zwischen zwei API-Aufrufen
    const now = Date.now();
    const elapsed = now - AgentRunner.lastGlobalApiCallTime;
    if (elapsed < 1500) {
      const waitMs = 1500 - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.checkAborted(signal);

    // 2. Proaktive Rotation bei JEDEM Request
    const poolSize = this.apiKeys.length;
    let chosenKey: string | null = null;

    for (let attempt = 0; attempt < poolSize; attempt++) {
      this.currentKeyIndex = (this.currentKeyIndex + 1) % poolSize;
      AgentRunner.globalKeyIndex = this.currentKeyIndex;
      const candidateKey = this.apiKeys[this.currentKeyIndex];

      // 60-Sekunden-Historie bereinigen
      const currentTime = Date.now();
      const history = (AgentRunner.keyRequestHistory.get(candidateKey) || []).filter(
        (ts) => currentTime - ts < 60000
      );
      AgentRunner.keyRequestHistory.set(candidateKey, history);

      // 80% Quota-Deckelung (Free-Tier Limit: 5 RPM -> max. 4 Anfragen in den letzten 60s)
      if (history.length < 4) {
        chosenKey = candidateKey;
        break;
      }
      // Wenn bereits 4 Anfragen: diesen Key proaktiv überspringen und nächsten im Pool wählen
    }

    // Falls alle Keys an ihrer 80% Grenze sind: warte kurz auf den ältesten Zeitstempel
    if (!chosenKey) {
      this.currentKeyIndex = (this.currentKeyIndex + 1) % poolSize;
      AgentRunner.globalKeyIndex = this.currentKeyIndex;
      chosenKey = this.apiKeys[this.currentKeyIndex];
      const history = AgentRunner.keyRequestHistory.get(chosenKey) || [];
      if (history.length > 0) {
        const oldest = history[0];
        const waitMs = Math.max(500, Math.min(15000, 60000 - (Date.now() - oldest) + 100));
        const waitStep = this.addStep(
          '⏳',
          `80% Quota aller Keys erreicht · Pacing (${(waitMs / 1000).toFixed(1)}s)...`
        );
        await agentDelay(waitMs, signal);
        this.resolveStep(waitStep, 'Quota wieder frei');
      }
    }

    // Zeitstempel für diesen Key registrieren
    const finalHistory = (AgentRunner.keyRequestHistory.get(chosenKey) || []).filter(
      (ts) => Date.now() - ts < 60000
    );
    finalHistory.push(Date.now());
    AgentRunner.keyRequestHistory.set(chosenKey, finalHistory);
    AgentRunner.lastGlobalApiCallTime = Date.now();

    return chosenKey;
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

  // ── Dynamic Session Track Resolver ───────────────────────────────────────

  /**
   * Resolves an LLM-generated track name (which may be abbreviated, MCU-truncated,
   * or slightly mistyped) to the canonical full name as it exists in fetchedStrips.
   *
   * Priority order:
   *  1. Exact match (case-insensitive)
   *  2. One contains the other (case-insensitive)
   *  3. Token-based overlap: ≥ 1 significant token in common
   *  4. Trigram similarity ≥ 0.4
   *  5. No match → return original (unchanged)
   */
  private resolveCanonicalTrackName(aiName: string): string {
    const strips = this.fetchedStrips;
    if (!strips || strips.length === 0) return aiName;

    const lower = aiName.toLowerCase().trim();

    // Prio 1: Exact (case-insensitive)
    const exact = strips.find((s) => s.trackName.toLowerCase().trim() === lower);
    if (exact) return exact.trackName;

    // Prio 2: Substring containment
    const contained = strips.find(
      (s) =>
        s.trackName.toLowerCase().includes(lower) ||
        lower.includes(s.trackName.toLowerCase())
    );
    if (contained) return contained.trackName;

    // Prio 3: Token overlap (≥ 1 significant token, len ≥ 3)
    const aiTokens = lower.split(/[\s_\-\/]+/).filter((t) => t.length >= 3);
    if (aiTokens.length > 0) {
      for (const strip of strips) {
        const stripTokens = strip.trackName.toLowerCase().split(/[\s_\-\/]+/);
        if (aiTokens.some((t) => stripTokens.some((st) => st.includes(t) || t.includes(st)))) {
          return strip.trackName;
        }
      }
    }

    // Prio 4: Trigram similarity
    const trigrams = (s: string): Set<string> => {
      const result = new Set<string>();
      const padded = `  ${s}  `;
      for (let i = 0; i < padded.length - 2; i++) result.add(padded.slice(i, i + 3));
      return result;
    };
    const similarity = (a: string, b: string): number => {
      const ta = trigrams(a);
      const tb = trigrams(b);
      let overlap = 0;
      ta.forEach((t) => { if (tb.has(t)) overlap++; });
      return (2 * overlap) / (ta.size + tb.size);
    };

    let bestScore = 0.4; // minimum threshold
    let bestMatch: string | null = null;
    for (const strip of strips) {
      const score = similarity(lower, strip.trackName.toLowerCase());
      if (score > bestScore) {
        bestScore = score;
        bestMatch = strip.trackName;
      }
    }
    if (bestMatch) return bestMatch;

    // No match – keep original
    return aiName;
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
          return false;
        }
        return true;
      });
    }

    const sanitizedDeltas = filteredDeltas.map((d) => {
      const delta = { ...(d as any) } as any;

      // ── Dynamic Track Name Resolution ─────────────────────────────────────
      // Resolve LLM-generated / MCU-truncated track names to canonical DAW names
      if (delta.trackName && typeof delta.trackName === 'string') {
        const resolved = this.resolveCanonicalTrackName(delta.trackName);
        if (resolved !== delta.trackName) {
          warnings.push(
            `ℹ️ Spurname „${delta.trackName}" → „${resolved}" aufgelöst (dynamische Session-Namensauflösung).`
          );
          delta.trackName = resolved;
        }
      }

      // ── Channel-Strip Parameter Guard (Punkt 1) ───────────────────────────
      const paramNameStr = String(delta.parameterName ?? delta.parameter ?? '').toLowerCase().trim();
      const pluginNameStr = typeof delta.pluginName === 'string' ? delta.pluginName.trim() : undefined;

      const isChannelStripParam = (param: string, plugin?: string) =>
        ['pan', 'fader_db', 'fader', 'volume', 'pegel', 'mute', 'solo'].includes(param.toLowerCase()) ||
        plugin?.toLowerCase() === 'mixer';

      if (isChannelStripParam(paramNameStr, pluginNameStr)) {
        // Überspringe die Suche nach einem Insert-Plugin vollständig!
        delta.pluginName = undefined;
        delta.slotIndex = undefined;
        return delta;
      }

      // ── Plugin Slot Matching ───────────────────────────────────────────────
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

  // ── Gemini call with proactive key rotation, pacing & resilient 503 fallback ──

  /**
   * Calls model.generateContent({ contents }) with proactive key rotation,
   * 80% quota capping (4 RPM), 1.200 ms pacing, and automatic 503 model fallback to gemini-3.5-flash-lite / gemini-3.5-flash.
   */
  private async generateContentWithRetry(
    systemInstruction: string,
    contents: GeminiContent[],
    signal?: AbortSignal
  ): Promise<any> {
    const maxAttempts = Math.max(3, this.apiKeys.length * 2);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      this.checkAborted(signal);

      // Pacing-Bremse zwischen Turns: Vor JEDEM API-Aufruf an das Modell MUSS ein Mindestabstand von 1.500 ms eingehalten werden
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Proaktives Multi-Key Round-Robin & Pacing
      const key = await this.getNextKeyWithPacing(signal);

      try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({
          model: this.activeModel,
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
        const is503 = msg.includes('503') || msg.includes('overloaded') || msg.includes('Service Unavailable') || msg.includes('The model is overloaded');
        const is429 =
          msg.includes('429') ||
          msg.includes('ResourceExhausted') ||
          msg.includes('high demand') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('quota');
        const isQuotaOrOverload = is503 || is429;

        // Resilienter Modell-Fallback bei 503 ServiceUnavailable (Kaskade: 3.8-flash -> 3.5-flash-lite -> 3.5-flash)
        if (is503) {
          if (this.activeModel !== 'gemini-3.5-flash-lite' && this.activeModel !== 'gemini-3.5-flash') {
            const prevModel = this.activeModel;
            this.activeModel = 'gemini-3.5-flash-lite';
            const fallbackStep = this.addStep(
              '🔄',
              `${prevModel} überlastet · Wechsle automatisch auf ${this.activeModel}...`
            );
            await agentDelay(800, signal);
            this.resolveStep(fallbackStep, `Auf ${this.activeModel} umgeschaltet`);
            continue;
          } else if (this.activeModel === 'gemini-3.5-flash-lite') {
            const prevModel = this.activeModel;
            this.activeModel = 'gemini-3.5-flash';
            const fallbackStep = this.addStep(
              '🔄',
              `${prevModel} überlastet · Wechsle automatisch auf ${this.activeModel}...`
            );
            await agentDelay(800, signal);
            this.resolveStep(fallbackStep, `Auf ${this.activeModel} umgeschaltet`);
            continue;
          }
        }

        if (isQuotaOrOverload && attempt < maxAttempts - 1) {
          const waitMs = is503
            ? Math.floor(Math.random() * 1000) + 1500
            : (attempt === 0 ? 1500 : 2500);

          const stepLabel = is503
            ? `Modell überlastet (503) · Jitter (${(waitMs / 1000).toFixed(1)}s) & Key-Wechsel...`
            : `API-Quota erreicht (429) · Wechsle Key & Cooldown (${(waitMs / 1000).toFixed(1)}s)...`;

          const quotaStep = this.addStep('⏳', stepLabel);
          await agentDelay(waitMs, signal);
          this.resolveStep(quotaStep, 'Weiter mit nächstem Key');
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

    if (this.apiKeys.length === 0) {
      return {
        assistantText: '⚠️ Kein Gemini API-Key konfiguriert.',
        steps: this.steps
      };
    }

    this.activeModel = this.cfg.modelName || 'gemini-3.8-flash';
    const systemInstruction = buildAgentSystemPrompt(context);

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

    this.resolveStep(prefetchStep, `${compactStrips.length} Spuren ultra-kompakt bereitgestellt`);

    // ── Punkt 2: Deterministische Lokale Audition VOR dem ersten API-Call ─────
    const auditionIntent = parseAuditionIntent(userPrompt);
    let auditionExecuted = false;
    let detectedStartBar: number | undefined = auditionIntent?.startBar;
    let detectedEndBar: number | undefined = auditionIntent?.endBar;

    if (auditionIntent) {
      const { startBar, endBar, durationSeconds } = auditionIntent;
      const auditionStep = this.addStep('👂', `Wiedergabe Takt ${startBar} bis ${endBar} · ${durationSeconds}s`);
      try {
        await this.cfg.invokeTauri('audition_region', {
          startBar,
          endBar,
          durationSeconds
        });
        this.resolveStep(auditionStep, `Audition abgeschlossen (${durationSeconds}s) · Telemetrie erfasst`);
        auditionExecuted = true;
      } catch (err) {
        console.warn('⚠️ [AgentRunner] Lokale Audition fehlgeschlagen:', err);
        this.resolveStep(auditionStep, `Audition übersprungen (${String(err)})`);
      }
    }

    // Frische Telemetriedaten direkt nach lokalem Playback erfassen
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

    // ── Single-Turn API-Call Vorbereitung (Exakt 1 Request) ───────────────────
    const effectiveScope: TargetScope = context?.targetScope ?? 'mix_bus';
    const genreId: GenreProfileId = (context?.genre as GenreProfileId) || 'pop_radio';
    const targetProfile: TargetProfile = resolveTargetProfile(
      genreId,
      effectiveScope,
      context?.targetProfile
    );
    const activeTrack = context?.activeMeterTrack || (effectiveScope === 'mix_bus' ? 'Stereo Out' : 'Active Channel');
    const s = targetProfile.spectralTargets;

    const isSilentSignal = !compactTelemetry || compactTelemetry.lufs < -60;

    const initialUserText =
      `Engineer request: "${userPrompt}"\n\n` +
      `ACTIVE MONITORING POINT: Track '${activeTrack}' (Scope: ${effectiveScope})\n\n` +
      `SESSION CONTEXT (PREFETCHED):\n` +
      `- Active Target Corridor: ${targetProfile.name} (Scope: ${effectiveScope}, Target LUFS: ${targetProfile.targetIntegratedLufs.toFixed(1)} LUFS, Crest: ${targetProfile.crestFactorRange.min.toFixed(1)}-${targetProfile.crestFactorRange.max.toFixed(1)} dB)\n` +
      `- Target Spectral Offsets: Sub-Bass (${s.subBassDb >= 0 ? '+' : ''}${s.subBassDb} dB), Bass (${s.bassDb >= 0 ? '+' : ''}${s.bassDb} dB), Low-Mid (${s.lowMidDb >= 0 ? '+' : ''}${s.lowMidDb} dB), High-Mid (${s.highMidDb >= 0 ? '+' : ''}${s.highMidDb} dB), Air (${s.airDb >= 0 ? '+' : ''}${s.airDb} dB)\n` +
      `- Tracks & Inserts: ${JSON.stringify(compactStrips)}\n` +
      `- Measured Metrology: ${compactTelemetry ? JSON.stringify(compactTelemetry) : 'Standby / Low Signal'}\n\n` +
      `STRICT DIRECTIVE:\n` +
      (auditionExecuted
        ? `Audition has ALREADY been completed locally (playback of bars ${auditionIntent?.startBar} to ${auditionIntent?.endBar} for ${auditionIntent?.durationSeconds}s). Telemetry is attached above. You MUST respond with \`propose_mix_adjustment\` directly in this single response!`
        : isSilentSignal
        ? `Note: Measured audio telemetry indicates silence or standby (< -60 LUFS). ` +
          `Do NOT generate speculative or pro-forma \`propose_mix_adjustment\` ActionCards without real audio signal! ` +
          `Instead, answer the user constructively, acknowledge the track role, and politely prompt the engineer to start playback in the DAW (or ask "Höre Takt X bis Y") so you can measure actual acoustic dynamics before proposing mixing decisions.`
        : `Audition has ALREADY been completed locally. Telemetry is attached above. You MUST respond with \`propose_mix_adjustment\` in this single response!`);

    // Turn 1 (User): initial user request with measured telemetry
    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [{ text: initialUserText }]
      }
    ];

    let lastText = '';
    let finalProposal: MixActionProposal | undefined;
    const allWarnings: string[] = [];
    const maxTurns = 4;
    let totalToolCalls = 0;
    const MAX_TOOL_CALLS = 4;
    let isSilentPlayback = false;

    let promptTokens = 0;
    let candidatesTokens = 0;
    let totalTokens = 0;
    let turnsCount = 0;

    try {
      for (let iteration = 0; iteration < maxTurns; iteration++) {
        this.checkAborted(activeSignal);

        const response = await this.generateContentWithRetry(
          systemInstruction,
          contents,
          activeSignal
        );

        this.checkAborted(activeSignal);

        // Track token usage immediately into session state
        turnsCount++;
        if (response.usageMetadata) {
          const p = response.usageMetadata.promptTokenCount ?? 0;
          const c = response.usageMetadata.candidatesTokenCount ?? 0;
          promptTokens += p;
          candidatesTokens += c;
          totalTokens = promptTokens + candidatesTokens;

          AgentRunner.cumulativePromptTokens += p;
          AgentRunner.cumulativeCandidatesTokens += c;
          AgentRunner.cumulativeSessionTokens += (p + c);
          AgentRunner.cumulativeTurnsCount += 1;
        }

        const currentUsage: AgentUsageStats = {
          promptTokenCount: AgentRunner.cumulativePromptTokens,
          candidatesTokenCount: AgentRunner.cumulativeCandidatesTokens,
          totalTokenCount: AgentRunner.cumulativeSessionTokens,
          durationMs: Math.round(performance.now() - startTime),
          turnsCount: AgentRunner.cumulativeTurnsCount,
          model: this.activeModel,
          activeKeyCount: this.apiKeys.length,
          estimatedCostUsd:
            AgentRunner.cumulativePromptTokens * 0.000000075 +
            AgentRunner.cumulativeCandidatesTokens * 0.0000003
        };

        try {
          this.cfg.onUsageUpdate?.(currentUsage);
        } catch (e) {
          console.warn('onUsageUpdate error:', e);
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
            const sb = Number(args.startBar ?? 1);
            const eb = args.endBar !== undefined ? Number(args.endBar) : (sb + 4);
            detectedStartBar = sb;
            detectedEndBar = eb;
            toolResult = await this.executeAuditionRegion(
              sb,
              args.endBar !== undefined ? Number(args.endBar) : undefined,
              args.durationSeconds !== undefined ? Number(args.durationSeconds) : undefined,
              activeSignal,
              userPrompt
            );
            const liveTelem = this.cfg.getTelemetry?.() ?? telemetry;
            const currentLufs = liveTelem?.loudness?.momentaryLufs ?? -70.0;
            // Echter Stille-Pegel nur bei < -45 LUFS:
            if (currentLufs < -45.0) {
              isSilentPlayback = true;
              toolResult = JSON.stringify({
                success: true,
                momentaryLufs: currentLufs,
                notice: 'Signalpegel sehr niedrig (< -45 LUFS). Falls Voranhebung gewünscht, schlage ein Fader-Delta vor.'
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
            if (finalProposal) {
              const start = (args.startBar !== undefined ? Number(args.startBar) : undefined) ?? detectedStartBar;
              const end = (args.endBar !== undefined ? Number(args.endBar) : undefined) ?? detectedEndBar ?? (start !== undefined ? start + 4 : undefined);
              if (start !== undefined) {
                finalProposal.startBar = start;
                finalProposal.endBar = end;
              }
              if (args.description && typeof args.description === 'string') {
                finalProposal.description = args.description;
              }
            }
            if (!lastText && finalProposal) {
              lastText = finalProposal.rationale || finalProposal.title || 'Vorschlag erfolgreich generiert.';
            }
            // Nach 'propose_mix_adjustment' wird die Schleife SOFORT beendet
            break;
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

        if (finalProposal) {
          // Nach 'propose_mix_adjustment' wird die Schleife SOFORT beendet
          break;
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
      const fallbackUsage: AgentUsageStats = {
        promptTokenCount: AgentRunner.cumulativePromptTokens,
        candidatesTokenCount: AgentRunner.cumulativeCandidatesTokens,
        totalTokenCount: AgentRunner.cumulativeSessionTokens,
        durationMs: Math.round(performance.now() - startTime),
        turnsCount: AgentRunner.cumulativeTurnsCount,
        model: this.activeModel,
        activeKeyCount: this.apiKeys.length,
        estimatedCostUsd:
          AgentRunner.cumulativePromptTokens * 0.000000075 +
          AgentRunner.cumulativeCandidatesTokens * 0.0000003
      };
      try {
        this.cfg.onUsageUpdate?.(fallbackUsage);
      } catch {}

      if (activeSignal?.aborted || String(err).includes('Vom Benutzer abgebrochen')) {
        this.steps.forEach((s) => {
          if (s.status === 'running') {
            s.status = 'error';
            s.detail = s.detail ? `${s.detail} · Abgebrochen` : 'Abgebrochen';
          }
        });
        return {
          assistantText: '⏹ Vorgang vom Benutzer abgebrochen.',
          steps: this.steps,
          usage: fallbackUsage
        };
      }
      return {
        assistantText: `⚠️ Agent-Fehler: ${String(err)}`,
        steps: this.steps,
        usage: fallbackUsage
      };
    }

    const checkTelem = this.cfg.getTelemetry?.() ?? telemetry;
    if (auditionExecuted && (checkTelem?.loudness?.momentaryLufs ?? -70.0) < -45.0) {
      isSilentPlayback = true;
    }

    const warningText = allWarnings.length > 0 ? '\n\n' + allWarnings.join('\n') : '';
    const assistantText = (lastText.trim() || 'Agent hat die Analyse abgeschlossen.') + warningText;

    const durationMs = Math.round(performance.now() - startTime);
    const estimatedCostUsd =
      AgentRunner.cumulativePromptTokens * 0.000000075 +
      AgentRunner.cumulativeCandidatesTokens * 0.0000003;

    const usageStats: AgentUsageStats = {
      promptTokenCount: AgentRunner.cumulativePromptTokens,
      candidatesTokenCount: AgentRunner.cumulativeCandidatesTokens,
      totalTokenCount: AgentRunner.cumulativeSessionTokens,
      durationMs,
      turnsCount: AgentRunner.cumulativeTurnsCount,
      model: this.activeModel,
      activeKeyCount: this.apiKeys.length,
      estimatedCostUsd
    };

    try {
      this.cfg.onUsageUpdate?.(usageStats);
    } catch (e) {
      console.warn('onUsageUpdate error:', e);
    }

    if (finalProposal && finalProposal.startBar === undefined && detectedStartBar !== undefined) {
      finalProposal.startBar = detectedStartBar;
      finalProposal.endBar = detectedEndBar ?? (detectedStartBar + 4);
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

function buildAgentSystemPrompt(context?: MixAnalysisContext): string {
  const activeScope = context?.targetScope ?? 'mix_bus';
  const activeTrack = context?.activeMeterTrack || (activeScope === 'mix_bus' ? 'Stereo Out' : 'Active Channel');
  const isMaster = activeScope === 'mix_bus';

  const scopeSafeguards = isMaster
    ? `## ACTIVE MONITORING POINT & SCOPE SAFEGUARDS:\n` +
      `ACTIVE MONITORING POINT: Track '${activeTrack}' (Scope: ${activeScope})\n` +
      `- Das Signal ist der Summenmix (Master / Stereo Out).\n` +
      `- Bewerte spektrale Balance von Sub-Bass bis Air, Gesamtkompression und Ziel-LUFS (-12 bis -14 LUFS je nach Genre).\n` +
      `- Bewerte Wechselwirkungen zwischen Instrumenten (z. B. Maskierung zwischen Kick und Bass).\n`
    : `## ACTIVE MONITORING POINT & SCOPE SAFEGUARDS:\n` +
      `ACTIVE MONITORING POINT: Track '${activeTrack}' (Scope: ${activeScope})\n` +
      `- KRITISCHE REGEL: Du hörst aktuell NUR DIESES EINZELSIGNAL / DIESE SUBGRUPPE ('${activeTrack}')!\n` +
      `- Fordere NIEMALS Master-Mix-Lautheit (-12 LUFS) für Einzelsignale. Normale Spurpegel liegen gesund zwischen -18 und -28 LUFS.\n` +
      `- Rüge NIEMALS fehlende Frequenzbereiche, die für dieses Instrument unnatürlich wären (z. B. kein Sub-Bass auf Vocals, Keys oder Akustikgitarre; keine Höhen über 10 kHz auf Bass).\n` +
      `- Wenn der Nutzer nach dem Zusammenspiel mit anderen Spuren fragt: Erkläre präzise, wie dieses fokussierte Signal vorbereitet werden muss (z. B. gezielter EQ-Cut oder Sidechain-Ducking), um im Gesamtmix Platz zu schaffen.\n`;

  return (
    MIXING_BUDDY_SYSTEM_PROMPT +
    `\n\n` +
    scopeSafeguards +
    `\n## AGENTIC GOVERNOR & TURN RULES (STRICTLY ENFORCED)\n\n` +
    `1. TURN-BUDGET: You have a strict budget of maximum 4 turns (maxTurns = 4).\n` +
    `2. RECOMMENDED TURN SEQUENCE:\n` +
    `   - Turn 1: Capture session context & execute audition (if requested by user)\n` +
    `   - Turn 2: Inspect inserts/routing of target tracks\n` +
    `   - Turn 3: Generate final 'propose_mix_adjustment'\n` +
    `3. IMMEDIATELY TERMINATE: Once 'propose_mix_adjustment' is submitted, execution stops immediately.\n` +
    `4. Always use exact track names directly from the DAW UI (e.g. 'Studio Grand', 'Motown Revisited'). NEVER invent or abbreviate names.\n` +
    `5. FORMATTING REQUIREMENT (TYPOGRAPHY & RATIONALE):\n` +
    `   In 'rationale' and 'description', format explanations using concise bullet points instead of long blocks of text. Highlight key values clearly:\n` +
    `   - Spurnamen hervorheben (z.B. **Studio Grand**)\n` +
    `   - Frequenzen & Pegel präzise benennen (z.B. **+1.5 dB** bei **2.5 kHz**, Pan **-25%** L)\n` +
    `   - Keine endlosen Textblöcke ohne Zeilenumbrüche.\n`
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
