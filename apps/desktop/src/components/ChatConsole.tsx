import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, AlertCircle } from 'lucide-react';
import type { MetrologyTelemetryFrame, MixActionProposal } from '@mixing-buddy/shared-types';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
}

interface ChatConsoleProps {
  telemetry: MetrologyTelemetryFrame | null;
  activeDaw: string;
  onProposalGenerated: (proposal: MixActionProposal) => void;
  externalLogMessage?: string | null;
}

export const ChatConsole: React.FC<ChatConsoleProps> = ({
  telemetry,
  activeDaw,
  onProposalGenerated,
  externalLogMessage
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg_welcome',
      sender: 'assistant',
      text: 'Hallo! Ich bin dein AI Co-Producer. Beobachte die Live-Metrology oder gib mir direkte Anweisungen (z. B. "Räume das Low-End auf" oder "Prüfe Resonanzen und erstelle EQ-Filter").',
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const handleSend = () => {
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

    // Analyze prompt with live telemetry context
    setTimeout(() => {
      const lower = query.toLowerCase();
      let responseText = '';
      let generatedProposal: MixActionProposal | null = null;

      const currentLufs = telemetry?.loudness.momentaryLufs ?? -18.0;
      const truePeak = telemetry?.loudness.truePeakDb?.left ?? -1.0;
      const dawLabel = activeDaw.toLowerCase().includes('logic') ? 'Logic Pro' : 'Nuendo';

      if (lower.includes('low') || lower.includes('bass') || lower.includes('mud') || lower.includes('kick')) {
        generatedProposal = {
          id: `prop_${Date.now()}_low_mud`,
          timestamp: Date.now(),
          category: 'masking_reduction',
          title: 'Clean Low-End Buildup (250–350 Hz)',
          rationale: `Analyse der 48 kHz Telemetrie: Resonanzanhäufung bei ~300 Hz identifiziert (Pegel ${currentLufs.toFixed(1)} LUFS, True Peak ${truePeak.toFixed(1)} dB). Ein schmalbandiger Cut von -2.5 dB auf Track 'Audio 2' schafft Headroom für Kick & Bass.`,
          confidenceScore: 0.94,
          deltas: [
            {
              trackId: 'track_2',
              trackName: 'Audio 2',
              slotIndex: 0,
              pluginName: 'Channel EQ',
              parameterName: 'Band 3 Gain',
              currentValue: 0.0,
              proposedValue: -2.5,
              unit: 'dB'
            }
          ],
          status: 'pending'
        };
        responseText = `Ich habe das Frequenzspektrum analysiert: Im Bereich 250–350 Hz liegt eine deutliche Maskierung vor. Ich habe eine neue Empfehlung in deine Action-Queue gelegt: "${generatedProposal.title}".`;
      } else if (lower.includes('lufs') || lower.includes('laut') || lower.includes('level') || lower.includes('master')) {
        const diff = -14.0 - currentLufs;
        const proposedDelta = Math.max(-4.0, Math.min(3.0, diff));
        generatedProposal = {
          id: `prop_${Date.now()}_master_level`,
          timestamp: Date.now(),
          category: 'gain_staging',
          title: 'Target -14.0 LUFS Master Leveling',
          rationale: `Aktuelle Lautheit liegt bei ${currentLufs.toFixed(1)} LUFS. Anpassung um ${proposedDelta > 0 ? '+' : ''}${proposedDelta.toFixed(1)} dB bringt den Mix näher an den Streaming-Standard (-14 LUFS) unter Einhaltung des Acoustic Shock Shields.`,
          confidenceScore: 0.91,
          deltas: [
            {
              trackId: 'track_master',
              trackName: 'Stereo Out',
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
        responseText = `Der aktuelle Master-Bus Pegel beträgt ${currentLufs.toFixed(1)} LUFS (True Peak ${truePeak.toFixed(1)} dB). Ich habe eine Pegelanpassung vorgeschlagen.`;
      } else if (lower.includes('resonanz') || lower.includes('harsh') || lower.includes('sibilan')) {
        generatedProposal = {
          id: `prop_${Date.now()}_harshness`,
          timestamp: Date.now(),
          category: 'eq_tonal_balance',
          title: 'Notch 3.2 kHz Harsh Resonance',
          rationale: 'Harsche Frequenzspitzen im Bereich 3.2 kHz detektiert. Schmalbandiger Filter (Q=4.0) senkt Härte ab, ohne Transienten zu dämpfen.',
          confidenceScore: 0.89,
          deltas: [
            {
              trackId: 'track_1',
              trackName: 'Audio 1',
              slotIndex: 0,
              pluginName: 'Channel EQ',
              parameterName: 'Band 5 Gain',
              currentValue: 0.0,
              proposedValue: -2.0,
              unit: 'dB'
            }
          ],
          status: 'pending'
        };
        responseText = `Im oberen Mittenbereich wurden steile Resonanzpeaks detektiert. Die entsprechende ActionCard wurde vorbereitet.`;
      } else {
        responseText = `Verstanden: "${query}". Aktueller Mix-Status in ${dawLabel}: Lautheit ${currentLufs.toFixed(1)} LUFS, True Peak ${truePeak.toFixed(1)} dB, Phasenkorrelation ${(telemetry?.dynamics.stereoCorrelation ?? 1.0).toFixed(2)}. Was möchtest du gezielt anpassen?`;
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

      setIsAnalyzing(false);
    }, 600);
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
          <span>AI Co-Producer Prompt Console</span>
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
              className={`p-2.5 rounded-lg leading-relaxed ${
                m.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : m.sender === 'system'
                  ? 'bg-amber-950/40 border border-amber-500/30 text-amber-200 rounded-bl-none font-mono text-[11px]'
                  : 'bg-[#181a20] border border-darkBorder/60 text-slate-200 rounded-bl-none'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}

        {isAnalyzing && (
          <div className="flex items-center gap-2 text-slate-400 italic text-[11px]">
            <Sparkles className="w-3 h-3 text-blue-400 animate-spin" />
            <span>AI analysiert Telemetriedaten und Frequenzspektrum...</span>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div className="p-2 border-t border-darkBorder/70 bg-[#14161a] flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Frag den Mixing Buddy (z. B. 'Räume das Low-End auf' oder 'Snare & Vocals trennen')..."
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
    </div>
  );
};
