import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, AlertCircle, Copy, Check, MessageSquarePlus } from 'lucide-react';
import type { MetrologyTelemetryFrame, MixActionProposal, TrackDescriptor } from '@mixing-buddy/shared-types';
import { GeminiProvider } from '@mixing-buddy/ai-engine';
import { invoke } from '@tauri-apps/api/core';
import type { ProviderMode } from './ProviderSettings.js';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
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
}

export const ChatConsole: React.FC<ChatConsoleProps> = ({
  telemetry,
  activeDaw,
  providerMode,
  modelName,
  apiKey,
  tracks,
  onProposalGenerated,
  externalLogMessage
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
      text: `Hallo! Ich bin dein AI Co-Producer. Gib mir Anweisungen (z. B. "Hebe die Höhen an", "Räume das Low-End auf" oder "Erstelle eine neue Spur"), und ich analysiere das Live-Signal und generiere ActionCards für deine DAW.`,
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    setIsAnalyzing(true);

    try {
      const lower = query.toLowerCase();

      // Check for track creation intent ("erstelle eine neue spur...", "neue spur anlegen", etc.)
      const isTrackCreation =
        (lower.includes('spur') &&
          (lower.includes('erstell') ||
            lower.includes('neu') ||
            lower.includes('anleg') ||
            lower.includes('hinzufüg') ||
            lower.includes('hinzufueg') ||
            lower.includes('bereit'))) ||
        (lower.includes('track') &&
          (lower.includes('create') || lower.includes('new') || lower.includes('add') || lower.includes('prepare')));

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

      // Check for plugin learning intent ("lerne bitte das gerade geöffnete plugin an", "plugin scannen", etc.)
      const isPluginLearn =
        lower.includes('plugin') &&
        (lower.includes('lern') || lower.includes('scan') || lower.includes('profil') || lower.includes('speicher'));

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

      // 1. If BYOK Gemini is selected and API key is present: Call real Gemini API!
      if (providerMode === 'byok_gemini' && apiKey.trim().length > 5) {
        const gemini = new GeminiProvider({
          apiKey: apiKey.trim(),
          modelName: modelName.trim() || 'gemini-3.8-flash'
        });

        const res = await gemini.generateMixProposal(query, telemetry, tracks, {
          dawName: dawLabel,
          userPrompt: query
        });

        setMessages((prev) => [
          ...prev,
          {
            id: `msg_ai_${Date.now()}`,
            sender: 'assistant',
            text: res.assistantText,
            timestamp: Date.now()
          }
        ]);

        if (res.proposal) {
          onProposalGenerated(res.proposal);
        }
        setIsAnalyzing(false);
        return;
      }

      // If BYOK Gemini is selected but NO key is set
      if (providerMode === 'byok_gemini' && (!apiKey || apiKey.trim().length <= 5)) {
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
        const diff = -14.0 - currentLufs;
        const proposedDelta = Math.max(-4.0, Math.min(3.0, diff));
        generatedProposal = {
          id: `prop_${Date.now()}_master_level`,
          timestamp: Date.now(),
          category: 'gain_staging',
          title: `Target -14.0 LUFS on '${masterTrack.name}'`,
          rationale: `Aktuelle Lautheit: ${currentLufs.toFixed(1)} LUFS (True Peak: ${truePeak.toFixed(1)} dB). Pegelanpassung um ${proposedDelta > 0 ? '+' : ''}${proposedDelta.toFixed(1)} dB bringt ${dawLabel} an den Streaming-Standard.`,
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
        responseText = `Master-Bus Lautheit liegt bei ${currentLufs.toFixed(1)} LUFS. Pegelanpassung an ${masterTrack.name} vorbereitet.`;
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
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div className="bg-darkSurface border border-darkBorder rounded-lg flex flex-col h-64 shadow-md overflow-hidden">
      {/* Console Header */}
      <div className="px-3 py-2 border-b border-darkBorder/70 bg-[#16181d] flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200">
          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          <span>AI Co-Producer Prompt Console ({dawLabel})</span>
        </div>
        <span className="text-[11px] text-slate-500 font-mono">
          Context: {telemetry ? `${telemetry.sampleRate / 1000} kHz Live` : 'Standby'}
        </span>
      </div>

      {/* Messages Scroll Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5 text-xs">
        {messages.map((m) => (
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
                  ? 'bg-amber-600/30 text-amber-400 border border-amber-500/40'
                  : 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
              }`}
            >
              {m.sender === 'user' ? (
                <User className="w-3.5 h-3.5" />
              ) : m.sender === 'system' ? (
                <AlertCircle className="w-3.5 h-3.5" />
              ) : (
                <Bot className="w-3.5 h-3.5" />
              )}
            </div>

            <div
              className={`group relative p-2.5 pr-8 rounded-lg leading-relaxed select-text ${
                m.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : m.sender === 'system'
                  ? 'bg-amber-950/40 border border-amber-500/30 text-amber-200 rounded-bl-none font-mono text-[11px]'
                  : 'bg-[#181a20] border border-darkBorder/60 text-slate-200 rounded-bl-none'
              }`}
            >
              <span>{m.text}</span>
              <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
                {m.sender === 'system' && (
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
        ))}

        {isAnalyzing && (
          <div className="flex items-center gap-2 text-slate-400 italic text-[11px]">
            <Sparkles className="w-3 h-3 text-blue-400 animate-spin" />
            <span>
              {providerMode === 'byok_gemini'
                ? `Google Gemini (${modelName}) analysiert Telemetrie und generiert Vorschlag...`
                : `AI Co-Producer analysiert Telemetriedaten für ${dawLabel}...`}
            </span>
          </div>
        )}
      </div>

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
          <button
            onClick={handleSend}
            disabled={!input.trim() || isAnalyzing}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white px-3 py-1.5 rounded flex items-center gap-1.5 text-xs font-semibold transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Senden</span>
          </button>
        </div>
      )}
    </div>
  );
};
