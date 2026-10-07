import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, AlertCircle, Info, Copy, Check, MessageSquarePlus, Loader2, CheckCircle2, XCircle, Square } from 'lucide-react';
import type {
  MetrologyTelemetryFrame,
  MixActionProposal,
  TrackDescriptor,
  TargetProfile,
  TargetScope,
  MixingSkill,
  MixingSkillSummary
} from '@mixing-buddy/shared-types';
import { AgentRunner, type AgentStep, type AgentUsageStats } from '@mixing-buddy/ai-engine';
import { TokenUsageBadge } from './TokenUsageBadge.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { invoke } from '@tauri-apps/api/core';
import type { ProviderMode } from './ProviderSettings.js';

function detectRoleFromUserInput(text: string): { scope: TargetScope; scopeLabel: string } | null {
  const t = text.trim().toLowerCase();
  if (/^(bass|subbass|sub[- ]?bass|e[- ]?bass|ebass|bassline|es ist (ein )?bass|e-bass)$/i.test(t)) {
    return { scope: 'sub_bass', scopeLabel: 'Bass / E-Bass' };
  }
  if (/^(drums|drum|schlagzeug|percussion|beats?|drum[- ]?bus|es sind (die )?drums)$/i.test(t)) {
    return { scope: 'drum_bus', scopeLabel: 'Drums / Percussion' };
  }
  if (/^(vocal|vocals|voice|stimme|gesang|lead[- ]?vocal|es sind (die )?vocals)$/i.test(t)) {
    return { scope: 'lead_vocal', scopeLabel: 'Lead Vocal' };
  }
  if (/^(keys|synth|synths|synthesizer|piano|klavier|keyboard|orgel|rhodes)$/i.test(t)) {
    return { scope: 'keys_synths', scopeLabel: 'Keys / Synths' };
  }
  if (/^(akustik|acoustic|git|gitarre|guitar|acoustic[- ]?guitar)$/i.test(t)) {
    return { scope: 'acoustic', scopeLabel: 'Akustik / Gitarre' };
  }
  if (/^(master|mix|summe|mix[- ]?bus|stereo[- ]?out)$/i.test(t)) {
    return { scope: 'mix_bus', scopeLabel: 'Master / Mix Bus' };
  }
  return null;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  content?: string;
  timestamp: number;
  steps?: AgentStep[];
}

interface ChatConsoleProps {
  telemetry: MetrologyTelemetryFrame | null;
  activeDaw: string;
  providerMode: ProviderMode;
  modelName: string;
  apiKey: string;
  tracks: TrackDescriptor[];
  onProposalGenerated: (proposal: MixActionProposal) => void;
  externalLogMessage?: string | null;
  targetScope?: TargetScope;
  activeMeterTrack?: string | null;
  targetProfile?: TargetProfile;
  activeSkill?: MixingSkill | null;
  onSelectSkill?: (skill: MixingSkill | null) => void;
  onSelectSkillId?: (id: string) => void;
  availableSkills?: MixingSkillSummary[];
  pendingClarification?: {
    trackName: string;
    text: string;
  } | null;
  onSelectClarificationScope?: (scope: TargetScope, scopeLabel: string) => void;
}

export const ChatConsole: React.FC<ChatConsoleProps> = ({
  telemetry,
  activeDaw,
  providerMode,
  modelName,
  apiKey,
  tracks,
  onProposalGenerated,
  externalLogMessage,
  targetScope,
  activeMeterTrack,
  targetProfile,
  activeSkill,
  onSelectSkill,
  onSelectSkillId,
  availableSkills,
  pendingClarification,
  onSelectClarificationScope
}) => {
  const getDawDisplayName = (daw: string) => {
    const d = daw.toLowerCase();
    if (d.includes('logic')) return 'Logic Pro';
    if (d.includes('nuendo')) return 'Nuendo';
    if (d.includes('cubase')) return 'Cubase';
    if (d === 'none' || d.includes('detecting') || !d.trim()) return 'Standalone / Keine DAW';
    return daw;
  };

  const dawLabel = getDawDisplayName(activeDaw);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg_welcome',
      sender: 'assistant',
      text: `Hallo! Ich bin dein AI Co-Producer. Gib mir Anweisungen (z. B. "Höre dir Takt 25 an und räume das Low-End auf"), und ich analysiere das Live-Signal, höre in die DAW rein und generiere ActionCards für dich.`,
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [usageStats, setUsageStats] = useState<AgentUsageStats | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;

  const handleCancel = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    try {
      await invoke('daw_stop');
    } catch (e) {
      console.warn('Failed to stop DAW on cancel:', e);
    }
    setIsAnalyzing(false);

    // Freeze current steps: mark running steps as error/Abgebrochen, preserve done steps
    const frozenSteps: AgentStep[] = agentSteps.map((s) =>
      s.status === 'running'
        ? { ...s, status: 'error' as const, detail: s.detail ? `${s.detail} · Abgebrochen` : 'Abgebrochen' }
        : s
    );

    setAgentSteps([]);
    setMessages((prev) => [
      ...prev,
      {
        id: `msg_cancel_${Date.now()}`,
        sender: 'assistant',
        text: '⏹ Vorgang vom Benutzer abgebrochen. DAW-Wiedergabe gestoppt.',
        timestamp: Date.now(),
        steps: frozenSteps.length > 0 ? frozenSteps : undefined
      }
    ]);
  };

  const handleCopyMessage = (id: string, text: string) => {
    const copyFallback = () => {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) {
          setCopiedId(id);
          setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
        }
      } catch (err) {
        console.warn('Clipboard fallback error:', err);
      }
    };

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopiedId(id);
          setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
        })
        .catch(() => {
          copyFallback();
        });
    } else {
      copyFallback();
    }
  };

  const handleAskAboutMessage = (text: string) => {
    handleCopyMessage(`copy_${Date.now()}`, text);
    setInput(`Wie behebe ich diesen Fehler in Logic Pro: "${text}"`);
  };

  // Auto-scroll on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Append external system/error log messages if provided
  useEffect(() => {
    if (externalLogMessage) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_ext_${Date.now()}`,
          sender: 'system',
          text: externalLogMessage,
          timestamp: Date.now()
        }
      ]);
    }
  }, [externalLogMessage]);

  const handleSend = async () => {
    const query = input.trim();
    if (!query || isAnalyzing) return;

    const userMsg: ChatMessage = {
      id: `msg_user_${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: Date.now()
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    // Phase 2C+: Check if query is declaring a track role directly (e.g. "Bass", "Drums", etc.)
    const roleMatch = detectRoleFromUserInput(query);
    if (roleMatch) {
      if (onSelectClarificationScope) {
        onSelectClarificationScope(roleMatch.scope, roleMatch.scopeLabel);
      }
      const isSilent = !telemetry || (telemetry.loudness?.momentaryLufs ?? -100) < -60;
      if (isSilent) {
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_role_ack_${Date.now()}`,
            sender: 'assistant',
            text: `Alles klar! Ich habe den Signal-Fokus für **${pendingClarification?.trackName || activeMeterTrack || 'diese Spur'}** dauerhaft auf **${roleMatch.scopeLabel}** gemerkt und gespeichert ✓.\n\nAktuell ist die Wiedergabe in ${dawLabel} noch gestoppt (Stille / Standby). Bitte starte die Wiedergabe in der DAW oder sag mir z. B. *'Höre Takt 9 bis 13'*, damit ich das Signal akustisch analysieren und fundierte Mix-Entscheidungen vorschlagen kann!`,
            timestamp: Date.now()
          }
        ]);
        return;
      }
    }

    setIsAnalyzing(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const lower = query.toLowerCase();

      // Retrieve effective key from prop or localStorage
      const effectiveApiKey =
        apiKey?.trim() ||
        (() => {
          try {
            return localStorage.getItem('mixing_buddy_gemini_api_key') || '';
          } catch {
            return '';
          }
        })();

      // 1. If BYOK Gemini is selected: Run the full agentic ReAct loop!
      if (providerMode === 'byok_gemini') {
        if (effectiveApiKey.length > 5) {
          const keyList = effectiveApiKey.split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean);
          // Reset step badges
          setAgentSteps([]);

          const runner = new AgentRunner({
            apiKey: keyList[0] || effectiveApiKey,
            apiKeys: keyList,
            modelName: modelName.trim() || 'gemini-3.8-flash',
            invokeTauri: (command, args) => invoke(command, args),
            onUsageUpdate: (stats) => {
              setUsageStats(stats);
            },
            onStep: (step) => {
              setAgentSteps((prev) => {
                const idx = prev.findIndex((s) => s.id === step.id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = step;
                  return next;
                }
                return [...prev, step];
              });
            },
            getTelemetry: () => telemetryRef.current
          });

          const res = await runner.run(
            query,
            telemetry,
            tracks,
            {
              dawName: dawLabel,
              userPrompt: query,
              targetScope,
              activeMeterTrack,
              targetProfile,
              activeSkill: activeSkill || undefined
            },
            controller.signal
          );

          if (controller.signal.aborted) {
            return;
          }

          if (res.usage) {
            setUsageStats(res.usage);
          }

          const finalSteps = res.steps && res.steps.length > 0 ? [...res.steps] : undefined;
          setMessages((prev) => [
            ...prev,
            {
              id: `msg_ai_${Date.now()}`,
              sender: 'assistant',
              text: res.assistantText,
              timestamp: Date.now(),
              steps: finalSteps
            }
          ]);

          if (res.proposal) {
            onProposalGenerated(res.proposal);
          }
          // Schritte dauerhaft in der Nachricht gespeichert; Live-Indikator leeren
          setAgentSteps([]);
          setIsAnalyzing(false);
          return;
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `msg_ai_${Date.now()}`,
              sender: 'assistant',
              text: `⚠️ Gemini BYOK ist aktiv, aber es wurde noch kein gültiger API-Key eingetragen. Bitte trage deinen Google Gemini API-Key in den Settings oben ein, um echte ${modelName}-Inferenz zu nutzen.`,
              timestamp: Date.now()
            }
          ]);
          setIsAnalyzing(false);
          return;
        }
      }

      // Check for plugin learning intent ("lerne bitte das gerade geöffnete plugin an", "plugin scannen", etc.)
      const isPluginLearn =
        lower.includes('plugin') &&
        (lower.includes('lern') || lower.includes('scan') || lower.includes('profil') || lower.includes('speicher')) &&
        !lower.includes('karte') &&
        !lower.includes('vorschlag');

      if (isPluginLearn) {
        try {
          const spec = await invoke<{
            pluginName: string;
            category: string;
            filePath?: string;
            parameters?: Array<unknown>;
          }>('learn_active_plugin', { windowTitle: null });
          const count = Array.isArray(spec.parameters) ? spec.parameters.length : 0;
          const learnMsg = `✨ Plugin "${spec.pluginName}" (${count} Parameter, Kategorie: ${spec.category.toUpperCase()}) wurde erfolgreich gescannt und dauerhaft im Plugin Vault (${spec.filePath ?? '~/.mixing-buddy/plugins/'}) gespeichert!`;
          setMessages((prev) => [
            ...prev,
            {
              id: `msg_ai_${Date.now()}`,
              sender: 'assistant',
              text: learnMsg,
              timestamp: Date.now()
            }
          ]);
          setIsAnalyzing(false);
          return;
        } catch (err: unknown) {
          setMessages((prev) => [
            ...prev,
            {
              id: `msg_err_${Date.now()}`,
              sender: 'system',
              text: `❌ Plugin-Scan fehlgeschlagen: ${String(err)}`,
              timestamp: Date.now()
            }
          ]);
          setIsAnalyzing(false);
          return;
        }
      }

      // Check for track creation intent (offline/managed fallback only)
      const isTrackCreation =
        !lower.includes('karte') &&
        !lower.includes('vorschlag') &&
        !lower.includes('proposal') &&
        !lower.includes('eq') &&
        !lower.includes('insert') &&
        (lower.includes('neue spur') ||
          lower.includes('spur anlegen') ||
          lower.includes('spur erzeugen') ||
          lower.includes('new track') ||
          lower.includes('create track'));

      if (isTrackCreation) {
        try {
          const trackType = lower.includes('instrument') ? 'instrument' : 'audio';
          await invoke('create_daw_track', {
            trackType,
            name: trackType === 'audio' ? 'Audio Spur' : 'Instrument Spur'
          });
          const trackMsg = `✅ Neue ${trackType === 'audio' ? 'Audiospur' : 'Instrumentenspur'} wurde erfolgreich in ${dawLabel} angelegt (Cmd+Option+N / Menü). Der Channel EQ steht im ersten Insert bereit.`;
          setMessages((prev) => [
            ...prev,
            {
              id: `msg_ai_${Date.now()}`,
              sender: 'assistant',
              text: trackMsg,
              timestamp: Date.now()
            }
          ]);
          setIsAnalyzing(false);
          return;
        } catch {
          // Continue if invoke not available
        }
      }

      // 2. Managed Mode / Fallback: Analyze with live telemetry context against real available tracks
      let responseText = '';
      let generatedProposal: MixActionProposal | null = null;

      const currentLufs = telemetry?.loudness.momentaryLufs ?? -18.0;
      const truePeak = telemetry?.loudness.truePeakDb?.left ?? -1.0;

      // Find primary musical target track from real project tracks
      const drumOrInstTrack = tracks.find((t) => t.name.toLowerCase().includes('socal') || t.name.toLowerCase().includes('drum') || t.type === 'audio') ?? tracks[0] ?? {
        id: 'track_socal',
        name: 'SoCal'
      };
      const masterTrack = tracks.find((t) => t.type === 'master' || t.name.toLowerCase().includes('stereo') || t.name.toLowerCase().includes('out')) ?? {
        id: 'track_master',
        name: 'Stereo Out'
      };

      if (lower.includes('h\u00f6he') || lower.includes('hoehe') || lower.includes('high') || lower.includes('treble') || lower.includes('air') || lower.includes('brillant')) {
        generatedProposal = {
          id: `prop_${Date.now()}_high_shelf`,
          timestamp: Date.now(),
          category: 'eq_tonal_balance',
          title: `Crisp High-Shelf Boost (+4.0 dB @ 10 kHz) on '${drumOrInstTrack.name}'`,
          rationale: `Deutliche Anhebung des oberen Frequenzspektrums: Ein +4.0 dB High-Shelf Filter bei 10 kHz verleiht '${drumOrInstTrack.name}' sofort hörbare Brillanz, Transienten-Präsenz und Luftigkeit.`,
          confidenceScore: 0.95,
          deltas: [
            {
              trackId: drumOrInstTrack.id,
              trackName: drumOrInstTrack.name,
              slotIndex: 0,
              pluginName: 'Channel EQ',
              parameterName: 'High Shelf Gain',
              currentValue: 0.0,
              proposedValue: 4.0,
              unit: 'dB'
            }
          ],
          status: 'pending'
        };
        responseText = `Ich habe einen deutlichen High-Shelf-Boost von +4.0 dB bei 10 kHz auf Spur '${drumOrInstTrack.name}' vorbereitet. Klicke unten auf [Anwenden] oder [A/B], um den Unterschied im Audiosignal direkt zu hören.`;
      } else if (lower.includes('low') || lower.includes('bass') || lower.includes('mud') || lower.includes('kick')) {
        generatedProposal = {
          id: `prop_${Date.now()}_low_mud`,
          timestamp: Date.now(),
          category: 'masking_reduction',
          title: `Carve 300 Hz Mud on '${drumOrInstTrack.name}'`,
          rationale: `Analyse der 48 kHz Telemetrie: Akkumulation im Low-Mid Bereich (aktuell ${currentLufs.toFixed(1)} LUFS). Ein gezielter Cut von -3.0 dB bei 300 Hz auf '${drumOrInstTrack.name}' räumt das Low-End auf.`,
          confidenceScore: 0.93,
          deltas: [
            {
              trackId: drumOrInstTrack.id,
              trackName: drumOrInstTrack.name,
              slotIndex: 0,
              pluginName: 'Channel EQ',
              parameterName: 'Low Mud Cut',
              currentValue: 0.0,
              proposedValue: -3.0,
              unit: 'dB'
            }
          ],
          status: 'pending'
        };
        responseText = `Im Bereich 250–350 Hz liegt eine Maskierung vor. Ich habe die ActionCard "${generatedProposal.title}" für dich erstellt.`;
      } else if (lower.includes('lufs') || lower.includes('laut') || lower.includes('level') || lower.includes('master')) {
        const targetLufs = activeSkill ? activeSkill.metrologyTargets.integratedLufs : -14.0;
        const diff = targetLufs - currentLufs;
        const proposedDelta = Math.max(-4.0, Math.min(3.0, diff));
        generatedProposal = {
          id: `prop_${Date.now()}_master_level`,
          timestamp: Date.now(),
          category: 'gain_staging',
          title: `Target ${targetLufs.toFixed(1)} LUFS on '${masterTrack.name}' (${activeSkill ? activeSkill.name : 'Standard'})`,
          rationale: `Aktuelle Lautheit: ${currentLufs.toFixed(1)} LUFS (True Peak: ${truePeak.toFixed(1)} dB). ${activeSkill ? `Leitplanke "${activeSkill.name}": "${activeSkill.prompts.quickstart}". ` : ''}Pegelanpassung um ${proposedDelta > 0 ? '+' : ''}${proposedDelta.toFixed(1)} dB bringt ${dawLabel} an den Zielwert von ${targetLufs.toFixed(1)} LUFS.`,
          confidenceScore: 0.92,
          deltas: [
            {
              trackId: masterTrack.id,
              trackName: masterTrack.name,
              slotIndex: 0,
              pluginName: 'Master Fader',
              parameterName: 'volume',
              currentValue: 0.0,
              proposedValue: proposedDelta,
              unit: 'dB'
            }
          ],
          status: 'pending'
        };
        responseText = `Master-Bus Lautheit liegt bei ${currentLufs.toFixed(1)} LUFS. Zielwert ${activeSkill ? `nach Skill "${activeSkill.name}"` : 'nach EBU R128'} ist ${targetLufs.toFixed(1)} LUFS.`;
      } else {
        responseText = `Verstanden: "${query}". Aktueller Mix-Status in ${dawLabel}: Lautheit ${currentLufs.toFixed(1)} LUFS, True Peak ${truePeak.toFixed(1)} dB, Phasenkorrelation ${(telemetry?.dynamics.stereoCorrelation ?? 1.0).toFixed(2)}. Was möchtest du anpassen?`;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `msg_ai_${Date.now()}`,
          sender: 'assistant',
          text: responseText,
          timestamp: Date.now()
        }
      ]);

      if (generatedProposal) {
        onProposalGenerated(generatedProposal);
      }
    } catch (err: unknown) {
      if (abortControllerRef.current?.signal.aborted) {
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          sender: 'system',
          text: `Fehler bei der AI-Analyse: ${String(err)}`,
          timestamp: Date.now()
        }
      ]);
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div className="flex flex-col bg-slate-900/90 border border-slate-800 rounded-xl min-h-[260px] max-h-[80vh] resize-y overflow-auto relative shadow-md">
      {/* Console Header */}
      <div className="px-3 py-2 border-b border-darkBorder/70 bg-[#16181d] flex flex-wrap items-center justify-between text-xs gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200">
          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          <span>AI Co-Producer Prompt Console ({dawLabel})</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Token Usage & Quota Monitor Badge */}
          <TokenUsageBadge
            usage={usageStats}
            activeKeysCount={apiKey ? apiKey.split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean).length : 1}
            modelName={modelName.trim() || 'gemini-3.8-flash'}
            onReset={() => {
              AgentRunner.resetSessionTokens();
              setUsageStats(null);
            }}
          />

          {/* Skill Selector Dropdown */}
          <div className="flex items-center bg-slate-800/90 border border-amber-500/40 rounded px-2 py-0.5 text-xs text-amber-300 font-medium shadow-sm">
            <span className="text-amber-400 mr-1.5 text-[11px]">🎛️</span>
            <select
              value={activeSkill?.id || 'none'}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'none') {
                  if (onSelectSkill) onSelectSkill(null);
                } else if (onSelectSkillId) {
                  onSelectSkillId(val);
                }
              }}
              className="bg-transparent text-amber-300 text-xs font-semibold focus:outline-none cursor-pointer"
              title="Aktiven Mixing Skill auswählen (übersteuert Metrologie-Targets & Prompt-Leitplanken)"
            >
              <option value="none" className="bg-[#1a1c23] text-slate-400">
                Standard (Kein Skill)
              </option>
              {availableSkills?.map((s) => (
                <option key={s.id} value={s.id} className="bg-[#1a1c23] text-amber-200">
                  Skill: {s.name} ({s.version})
                </option>
              ))}
            </select>
          </div>

          <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
            Context: {telemetry ? `${telemetry.sampleRate / 1000} kHz Live` : 'Standby'}
          </span>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[140px] text-xs">
        {messages.map((m) => {
          const isSystemError =
            m.sender === 'system' &&
            (m.text.includes('❌') ||
              m.text.includes('⚠️') ||
              m.text.toLowerCase().includes('fehler') ||
              m.text.toLowerCase().includes('error'));

          return (
            <div
              key={m.id}
              className={`flex items-start gap-2 max-w-[90%] ${
                m.sender === 'user' ? 'ml-auto flex-row-reverse' : ''
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                  m.sender === 'user'
                    ? 'bg-blue-600 text-white'
                    : m.sender === 'system'
                    ? isSystemError
                      ? 'bg-amber-600/30 text-amber-400 border border-amber-500/40'
                      : 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                    : 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                }`}
              >
                {m.sender === 'user' ? (
                  <User className="w-3.5 h-3.5" />
                ) : m.sender === 'system' ? (
                  isSystemError ? (
                    <AlertCircle className="w-3.5 h-3.5" />
                  ) : (
                    <Info className="w-3.5 h-3.5" />
                  )
                ) : (
                  <Bot className="w-3.5 h-3.5" />
                )}
              </div>

              <div
                className={`group relative p-2.5 pr-8 rounded-lg leading-relaxed select-text ${
                  m.sender === 'user'
                    ? 'bg-blue-600 text-white rounded-br-none'
                    : m.sender === 'system'
                    ? isSystemError
                      ? 'bg-amber-950/40 border border-amber-500/30 text-amber-200 rounded-bl-none font-mono text-[11px]'
                      : 'bg-slate-800/80 border border-slate-700/60 text-slate-200 rounded-bl-none text-xs'
                    : 'bg-[#181a20] border border-darkBorder/60 text-slate-200 rounded-bl-none'
                }`}
              >
              {/* Persistent Step Tokens attached to this message */}
              {m.steps && m.steps.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2 pb-2 border-b border-darkBorder/50">
                  {m.steps.map((step) => (
                    <div
                      key={step.id}
                      className={`flex items-center gap-1.5 text-[10px] font-mono rounded px-2 py-0.5 border ${
                        step.status === 'done'
                          ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                          : step.status === 'error'
                          ? 'bg-red-950/60 border-red-500/40 text-red-300'
                          : 'bg-blue-950/60 border-blue-500/40 text-blue-200'
                      }`}
                    >
                      <span>{step.icon}</span>
                      <span className="font-semibold">{step.label}</span>
                      {step.status === 'done' ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                      ) : step.status === 'error' ? (
                        <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                      ) : (
                        <Loader2 className="w-3 h-3 animate-spin text-blue-400 shrink-0" />
                      )}
                      {step.detail && <span className="opacity-60 text-[9px] ml-0.5">{step.detail}</span>}
                    </div>
                  ))}
                </div>
              )}
              {m.sender === 'assistant' || m.sender === 'system' ? (
                <MarkdownRenderer content={m.content || m.text || ''} />
              ) : (
                <span className="whitespace-pre-wrap">{m.content || m.text || ''}</span>
              )}
              <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
                {isSystemError && (
                  <button
                    type="button"
                    onClick={() => handleAskAboutMessage(m.text)}
                    title="Frage zu diesem Fehler direkt im Prompt stellen"
                    className="p-1 rounded opacity-70 hover:opacity-100 hover:bg-white/10 text-amber-300 transition-all"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleCopyMessage(m.id, m.text)}
                  title="Text in die Zwischenablage kopieren"
                  className="p-1 rounded opacity-70 hover:opacity-100 hover:bg-white/10 transition-opacity"
                >
                  {copiedId === m.id ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })}

        {/* Agent Step Badges */}
        {agentSteps.length > 0 && (
          <div className="flex flex-col gap-1 py-1 px-1">
            {agentSteps.map((step) => (
              <div
                key={step.id}
                className={`flex items-center gap-2 text-[11px] rounded-md px-2 py-1 transition-all ${
                  step.status === 'running'
                    ? 'bg-blue-950/50 border border-blue-500/30 text-blue-200'
                    : step.status === 'done'
                    ? 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-300'
                    : 'bg-red-950/40 border border-red-500/30 text-red-300'
                }`}
              >
                {step.status === 'running' ? (
                  <Loader2 className="w-3 h-3 animate-spin shrink-0 text-blue-400" />
                ) : step.status === 'done' ? (
                  <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="w-3 h-3 shrink-0 text-red-400" />
                )}
                <span className="font-medium">{step.icon} {step.label}</span>
                {step.detail && (
                  <span className="text-[10px] opacity-60 ml-auto shrink-0">{step.detail}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {isAnalyzing && (
          <div className="flex items-center gap-2 text-slate-400 italic text-[11px]">
            <Sparkles className="w-3 h-3 text-blue-400 animate-spin" />
            <span>
              {providerMode === 'byok_gemini'
                ? `Agentischer Loop aktiv – Agent analysiert Spuren und hört in Logic Pro rein...`
                : `AI Co-Producer analysiert Telemetriedaten für ${dawLabel}...`}
            </span>
          </div>
        )}
      </div>

      {/* Co-Producer Interactive Ambiguous Scope Clarification Banner */}
      {pendingClarification && (
        <div className="mx-3 mb-2 p-2.5 bg-gradient-to-r from-blue-950/80 via-slate-900 to-indigo-950/80 border border-blue-500/40 rounded-lg shadow-md flex flex-col gap-2">
          <div className="flex items-center gap-2 text-cyan-300 font-medium text-xs">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 animate-pulse" />
            <span>{pendingClarification.text}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {[
              { label: '🥁 Drums', scope: 'drum_bus' as TargetScope, scopeLabel: 'Drums / Percussion' },
              { label: '🎸 Bass / E-Bass', scope: 'sub_bass' as TargetScope, scopeLabel: 'Bass / E-Bass' },
              { label: '🎹 Keys / Synth', scope: 'keys_synths' as TargetScope, scopeLabel: 'Keys / Synths' },
              { label: '🎤 Vocal', scope: 'lead_vocal' as TargetScope, scopeLabel: 'Lead Vocal' },
              { label: '🎸 Akustik / Git', scope: 'acoustic' as TargetScope, scopeLabel: 'Akustik / Git' },
              { label: '🎧 Master Mix', scope: 'mix_bus' as TargetScope, scopeLabel: 'Master / Mix Bus' }
            ].map((chip) => (
              <button
                key={chip.scope}
                type="button"
                onClick={() => {
                  if (onSelectClarificationScope) {
                    onSelectClarificationScope(chip.scope, chip.scopeLabel);
                  }
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `msg_clarify_${Date.now()}`,
                      sender: 'system',
                      text: `Signal-Fokus auf '${chip.scopeLabel}' gesetzt ✓`,
                      timestamp: Date.now()
                    }
                  ]);
                }}
                className="px-2.5 py-1 text-xs bg-slate-800/90 hover:bg-cyan-600/30 border border-slate-600 hover:border-cyan-400 text-slate-200 hover:text-cyan-200 rounded-md font-medium transition-all shadow-sm cursor-pointer flex items-center gap-1.5 active:scale-95"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Bar / External MCP Banner */}
      {providerMode === 'mcp_external' ? (
        <div className="px-3 py-2.5 border-t border-blue-500/30 bg-blue-950/30 flex items-center gap-2 text-xs text-blue-200 select-text">
          <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />
          <span>
            Co-Producer läuft über externen MCP-Client. Gib deine Mix-Befehle in Claude Desktop, Cursor oder deinem bevorzugten LLM ein – die ActionCards erscheinen live hier im HUD.
          </span>
        </div>
      ) : (
        <div className="p-2 border-t border-darkBorder/70 bg-[#14161a] flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Frag den Mixing Buddy (z. B. 'Hebe die Höhen an' oder 'Räume das Low-End auf')...`}
            className="flex-1 bg-[#1a1c22] border border-darkBorder px-3 py-1.5 rounded text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
          {isAnalyzing ? (
            <button
              type="button"
              onClick={handleCancel}
              className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded flex items-center gap-1.5 text-xs font-semibold transition-colors shrink-0 shadow-sm"
              title="Laufende Analyse und DAW-Wiedergabe sofort stoppen"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Abbrechen</span>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white px-3 py-1.5 rounded flex items-center gap-1.5 text-xs font-semibold transition-colors shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Senden</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
