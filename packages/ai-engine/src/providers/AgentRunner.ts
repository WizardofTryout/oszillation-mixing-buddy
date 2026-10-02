/**
 * AgentRunner.ts – Gemini ReAct Tool-Calling Loop
 *
 * Implements the multi-step agentic loop:
 *   User Prompt → Gemini → Tool Call → Tool Result → Gemini → … → Proposal
 *
 * Tools exposed to Gemini:
 *   1. list_tracks          – fetch live channel strips + inserts from DAW
 *   2. get_track_details    – get insert slots for a specific track
 *   3. audition_region      – locate to bar, play N seconds, stop
 *   4. propose_mix_adjustment – final output: a validated MixActionProposal
 */

import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from '@google/generative-ai';
import type { MixActionProposal, TrackDescriptor, MetrologyTelemetryFrame } from '@mixing-buddy/shared-types';
import { MIXING_BUDDY_SYSTEM_PROMPT, buildAnalysisUserPrompt, type MixAnalysisContext } from '../prompts.js';
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
  apiKey: string;
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
    'Only call this AFTER you have verified the plugin slots with list_tracks or get_track_details.',
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

  constructor(config: AgentRunnerConfig) {
    this.cfg = config;
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
              (ins) => ins.name.toLowerCase().includes('comp') || ins.name.toLowerCase().includes('compressor')
            );
            const paramName = (delta.parameterName as string).toLowerCase();
            const isEqParam =
              paramName.includes('freq') || paramName.includes('gain') || paramName.includes('shelf') ||
              paramName.includes('peak') || paramName.includes('cut') || paramName.includes('band');
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

  // ── Main Run Loop ─────────────────────────────────────────────────────────

  async run(
    userPrompt: string,
    telemetry: MetrologyTelemetryFrame | null,
    tracks: TrackDescriptor[],
    context?: MixAnalysisContext
  ): Promise<AgentRunResult> {
    this.steps = [];
    this.fetchedStrips = null;

    if (!this.cfg.apiKey || this.cfg.apiKey.trim().length <= 5) {
      return {
        assistantText: '⚠️ Kein Gemini API-Key konfiguriert.',
        steps: this.steps
      };
    }

    const modelName = this.cfg.modelName || 'gemini-2.5-flash';
    const genAI = new GoogleGenerativeAI(this.cfg.apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: buildAgentSystemPrompt(tracks),
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

    const telemetrySummary = telemetry
      ? JSON.stringify({
          lufs: telemetry.loudness.momentaryLufs,
          truePeak: telemetry.loudness.truePeakDb,
          correlation: telemetry.dynamics.stereoCorrelation,
          frequencyBands32: telemetry.spectrum.frequencyBands
        })
      : 'No live telemetry.';

    const chat = model.startChat({ history: [] });
    const initialMessage =
      `Engineer request: "${userPrompt}"\n\nLive telemetry:\n${telemetrySummary}\n\n` +
      `Instructions: First call list_tracks to inspect the DAW session, then optionally audition_region ` +
      `to listen to a section, then propose_mix_adjustment with ONLY plugins that actually exist on the tracks.`;

    let lastText = '';
    let finalProposal: MixActionProposal | undefined;
    const allWarnings: string[] = [];
    const MAX_ITERATIONS = 8;

    try {
      let result = await chat.sendMessage(initialMessage);

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const response = result.response;

        const textParts =
          response.candidates?.[0]?.content?.parts?.filter(
            (p: { text?: string }) => typeof p.text === 'string' && p.text.trim().length > 0
          ) ?? [];
        if (textParts.length > 0) {
          lastText = textParts.map((p: { text?: string }) => p.text ?? '').join('');
        }

        const calls = response.functionCalls();
        if (!calls || calls.length === 0) {
          break;
        }

        const toolResults: Array<{ functionResponse: { name: string; response: unknown } }> = [];

        for (const call of calls) {
          const args = (call.args ?? {}) as Record<string, unknown>;

          if (call.name === 'list_tracks') {
            const res = await this.executeListTracks();
            toolResults.push({ functionResponse: { name: 'list_tracks', response: { result: res } } });
          } else if (call.name === 'get_track_details') {
            const res = await this.executeGetTrackDetails(String(args.trackName ?? ''));
            toolResults.push({ functionResponse: { name: 'get_track_details', response: { result: res } } });
          } else if (call.name === 'audition_region') {
            const res = await this.executeAuditionRegion(
              Number(args.startBar ?? 1),
              Number(args.durationSeconds ?? 8)
            );
            toolResults.push({ functionResponse: { name: 'audition_region', response: { result: res } } });
          } else if (call.name === 'propose_mix_adjustment') {
            const { proposal, warnings } = this.validateProposalAgainstStrips(args, tracks);
            allWarnings.push(...warnings);
            const normalized = normalizeProposal(proposal, tracks);
            finalProposal = normalized;
            toolResults.push({
              functionResponse: {
                name: 'propose_mix_adjustment',
                response: { result: 'Proposal received and validated. Please provide a brief musical explanation.' }
              }
            });
          }
        }

        result = await chat.sendMessage(toolResults as any);

        if (finalProposal) {
          const finalResponse = result.response;
          const finalParts =
            finalResponse.candidates?.[0]?.content?.parts?.filter(
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
        `- "${t.name}" (${t.type}): ${t.insertSlots.filter(Boolean).map((s) => s!.pluginName).join(', ') || 'no inserts'}`
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
// Internal types for channel strip data from Tauri
// --------------------------------------------------------------------------

interface InsertInfo {
  slot: number;
  name: string;
}

interface ChannelStrip {
  trackName: string;
  inserts?: InsertInfo[];
}
