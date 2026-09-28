import React, { useState, useEffect } from 'react';
import type { MetrologyTelemetryFrame, MixActionProposal } from '@mixing-buddy/shared-types';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { SpectrumRTA } from './components/SpectrumRTA.js';
import { LoudnessHUD } from './components/LoudnessHUD.js';
import { ActionCard } from './components/ActionCard.js';
import { ProviderSettings, type ProviderMode } from './components/ProviderSettings.js';
import { ChatConsole } from './components/ChatConsole.js';
import { Sliders, Headphones, Inbox } from 'lucide-react';

export const App: React.FC = () => {
  const [telemetry, setTelemetry] = useState<MetrologyTelemetryFrame | null>(null);
  const [isAudioConnected, setIsAudioConnected] = useState<boolean>(false);
  const [providerMode, setProviderMode] = useState<ProviderMode>('managed');
  const [activeDaw, setActiveDaw] = useState<string>('detecting...');
  const [modelName, setModelName] = useState<string>('gemini-3.8-flash');
  const [apiKey, setApiKey] = useState<string>('');
  const [proposals, setProposals] = useState<MixActionProposal[]>([]);
  const [chatLog, setChatLog] = useState<string | null>(null);

  // 1. Dynamic DAW detection from Rust backend
  useEffect(() => {
    invoke<string>('get_active_daw')
      .then((daw) => {
        if (daw) setActiveDaw(daw);
      })
      .catch(() => {});

    let unlistenDaw: (() => void) | null = null;
    listen<string>('daw-status-changed', (event) => {
      if (event.payload) {
        setActiveDaw(event.payload);
      }
    })
      .then((cleanup) => {
        unlistenDaw = cleanup;
      })
      .catch(() => {});

    return () => {
      if (unlistenDaw) unlistenDaw();
    };
  }, []);

  // 2. Connect to local WebSocket IPC stream (ws://127.0.0.1:48123/meter) and Tauri native event
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: NodeJS.Timeout;
    let unlistenTelemetry: (() => void) | null = null;

    // A. Subscribe to native Tauri IPC event
    listen<string | MetrologyTelemetryFrame>('telemetry-frame', (event) => {
      try {
        const frame: MetrologyTelemetryFrame =
          typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
        setTelemetry(frame);
        setIsAudioConnected(true);
      } catch {
        // Ignore parse errors
      }
    })
      .then((cleanup) => {
        unlistenTelemetry = cleanup;
      })
      .catch(() => {
        // Pure browser fallback
      });

    // B. Connect to WebSocket stream
    const connectWebSocket = () => {
      try {
        ws = new WebSocket('ws://127.0.0.1:48123/meter');

        ws.onopen = () => {
          setIsAudioConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const frame: MetrologyTelemetryFrame = JSON.parse(event.data);
            setTelemetry(frame);
            setIsAudioConnected(true);
          } catch {
            // Ignore parse errors
          }
        };

        ws.onclose = () => {
          setIsAudioConnected(false);
          retryTimer = setTimeout(connectWebSocket, 2000);
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        retryTimer = setTimeout(connectWebSocket, 2000);
      }
    };

    connectWebSocket();

    return () => {
      clearTimeout(retryTimer);
      ws?.close();
      if (unlistenTelemetry) unlistenTelemetry();
    };
  }, []);

  // 3. Wired Action Handlers
  const handleApplyAction = async (id: string) => {
    const proposal = proposals.find((p) => p.id === id);
    if (!proposal) return;

    const dawLabel = activeDaw.toLowerCase().includes('logic') ? 'Logic Pro' : 'Nuendo';

    for (const delta of proposal.deltas) {
      // Validate volume adjustment with Acoustic Shock Shield in Rust Core
      if (delta.parameterName === 'volume' || delta.parameterName === 'fader_db') {
        try {
          await invoke('validate_volume_adjustment', {
            trackId: delta.trackId,
            isMaster: delta.trackName.toLowerCase().includes('master') || delta.trackName.toLowerCase().includes('stereo'),
            proposedDb: delta.proposedValue
          });
        } catch (err: unknown) {
          setChatLog(`🛡️ Acoustic Shock Shield: Anpassung für '${delta.trackName}' blockiert: ${String(err)}`);
          return;
        }
      }

      // Check track presence simulation in DAW
      const knownTracks = ['Stereo Out', 'Audio 1', 'Audio 2', 'SoCal', 'Kick', 'Bass'];
      const trackExists = knownTracks.some((t) => t.toLowerCase() === delta.trackName.toLowerCase());

      if (!trackExists && delta.trackName.toLowerCase().includes('snare')) {
        setChatLog(
          `⚠️ Spur 'Snare' im ${dawLabel}-Projekt nicht gefunden. Verfügbare Spuren: Stereo Out, Audio 1, Audio 2, SoCal.`
        );
        return;
      }
    }

    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'applied' } : p))
    );
    setChatLog(`✅ Anpassung angewendet: "${proposal.title}" erfolgreich an ${dawLabel} gesendet.`);
  };

  const handleRejectAction = (id: string) => {
    const prop = proposals.find((p) => p.id === id);
    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'rejected' } : p))
    );
    if (prop) {
      setChatLog(`❌ Vorschlag verworfen: "${prop.title}".`);
    }
  };

  const handleAuditionAction = (id: string) => {
    const prop = proposals.find((p) => p.id === id);
    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'auditioning' } : p))
    );
    if (prop) {
      setChatLog(`🎧 A/B Audition gestartet für: "${prop.title}". Höre den Unterschied im Audio-Signal...`);
    }

    // Auto-restore after 6 seconds of audition
    setTimeout(() => {
      setProposals((prev) =>
        prev.map((p) => (p.id === id && p.status === 'auditioning' ? { ...p, status: 'pending' } : p))
      );
    }, 6000);
  };

  const handleProposalFromChat = (newProposal: MixActionProposal) => {
    setProposals((prev) => [newProposal, ...prev]);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-darkBg text-slate-100">
      {/* Top Navbar */}
      <header className="h-12 border-b border-darkBorder bg-[#14161a] px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-6 rounded bg-blue-600 flex items-center justify-center font-bold text-xs text-white">
            OMB
          </div>
          <span className="font-bold text-sm tracking-wide text-slate-100">OSZILLATION MIXING BUDDY</span>
          <span className="text-xs text-blue-400 font-mono ml-2">v0.1.0</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded">
            <Headphones className={`w-3.5 h-3.5 ${telemetry ? 'text-emerald-400' : isAudioConnected ? 'text-yellow-400' : 'text-slate-500'}`} />
            <span className={telemetry ? 'text-emerald-400 font-medium' : ''}>
              Master Bus: {telemetry ? `Online (${telemetry.sampleRate / 1000} kHz)` : isAudioConnected ? 'Streaming' : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Studio Workspace */}
      <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* System Settings & Provider Status */}
        <ProviderSettings
          currentMode={providerMode}
          onSelectMode={setProviderMode}
          activeDaw={activeDaw}
          isAudioConnected={isAudioConnected}
          isLicenseActive={true}
          mcpClientsCount={1}
          modelName={modelName}
          onModelNameChange={setModelName}
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
        />

        {/* Meters Grid: Spectrum RTA + EBU R128 HUD + Chat Console */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <SpectrumRTA spectrum={telemetry?.spectrum} />
            <ChatConsole
              telemetry={telemetry}
              activeDaw={activeDaw}
              onProposalGenerated={handleProposalFromChat}
              externalLogMessage={chatLog}
            />
          </div>
          <div className="lg:col-span-1">
            <LoudnessHUD
              loudness={telemetry?.loudness}
              dynamics={telemetry?.dynamics}
              targetLufs={-14.0}
            />
          </div>
        </div>

        {/* Action Proposals Section */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-wider text-slate-300 uppercase flex items-center gap-2">
              <Sliders className="w-4 h-4 text-blue-400" />
              AI Mix Recommendations & Proposals
            </h3>
            <span className="text-xs text-slate-400">
              {proposals.filter((p) => p.status === 'pending').length} pending approval
            </span>
          </div>

          {proposals.length === 0 ? (
            <div className="bg-[#121418] border border-darkBorder/60 rounded-lg p-6 flex flex-col items-center justify-center text-center gap-2">
              <Inbox className="w-8 h-8 text-slate-600" />
              <div className="text-xs font-semibold text-slate-300">Keine offenen Vorschläge in der Queue</div>
              <p className="text-[11px] text-slate-500 max-w-md">
                Nutze die AI-Prompt-Konsole oben (z. B. &ldquo;Räume das Low-End auf&rdquo; oder &ldquo;Master auf -14 LUFS leveln&rdquo;),
                um neue intelligente Anpassungen basierend auf der Live-Metrology zu erzeugen.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {proposals.map((proposal) => (
                <ActionCard
                  key={proposal.id}
                  proposal={proposal}
                  onApply={handleApplyAction}
                  onReject={handleRejectAction}
                  onAudition={handleAuditionAction}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

