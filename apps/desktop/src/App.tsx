import React, { useState, useEffect } from 'react';
import type { MetrologyTelemetryFrame, MixActionProposal } from '@mixing-buddy/shared-types';
import { SpectrumRTA } from './components/SpectrumRTA.js';
import { LoudnessHUD } from './components/LoudnessHUD.js';
import { ActionCard } from './components/ActionCard.js';
import { ProviderSettings, type ProviderMode } from './components/ProviderSettings.js';
import { Sliders, Headphones } from 'lucide-react';

export const App: React.FC = () => {
  const [telemetry, setTelemetry] = useState<MetrologyTelemetryFrame | null>(null);
  const [isAudioConnected, setIsAudioConnected] = useState<boolean>(false);
  const [providerMode, setProviderMode] = useState<ProviderMode>('managed');
  const [activeDaw] = useState<string>('nuendo');

  // Sample proposal card for testing
  const [proposals, setProposals] = useState<MixActionProposal[]>([
    {
      id: 'prop_snare_eq_1',
      timestamp: Date.now(),
      category: 'masking_reduction',
      title: 'Tame Mud Resonance on Snare Track',
      rationale: 'Detected 350 Hz buildup conflicting with Low Vocal fundamentals. Cutting 2.5 dB on Band 2 restores vocal clarity.',
      confidenceScore: 0.92,
      deltas: [
        {
          trackId: 'track_2',
          trackName: 'Snare Top',
          slotIndex: 0,
          pluginName: 'StudioEQ',
          parameterName: 'Band 2 Gain',
          currentValue: 0.0,
          proposedValue: -2.5,
          unit: 'dB'
        }
      ],
      status: 'pending'
    }
  ]);

  // Connect to local WebSocket IPC stream (ws://127.0.0.1:48123/meter)
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: NodeJS.Timeout;

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
    };
  }, []);

  const handleApplyAction = (id: string) => {
    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'applied' } : p))
    );
  };

  const handleRejectAction = (id: string) => {
    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'rejected' } : p))
    );
  };

  const handleAuditionAction = (id: string) => {
    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'auditioning' } : p))
    );
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-darkBg text-slate-100">
      {/* Top Navbar */}
      <header className="h-12 border-b border-darkBorder bg-[#14161a] px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center font-bold text-xs text-white">
            MB
          </div>
          <span className="font-bold text-sm tracking-wide text-slate-100">STEINBERG MIXING BUDDY</span>
          <span className="text-xs text-blue-400 font-mono ml-2">v0.1.0</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded">
            <Headphones className="w-3.5 h-3.5 text-blue-400" />
            <span>Master Bus: {telemetry ? `${telemetry.sampleRate / 1000} kHz` : 'Offline'}</span>
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
        />

        {/* Meters Grid: Spectrum RTA + EBU R128 HUD */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <SpectrumRTA spectrum={telemetry?.spectrum} />
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
        </section>
      </main>
    </div>
  );
};
