import React, { useState, useRef, useEffect } from 'react';
import { ShieldCheck, Radio, Cpu, CheckCircle2, AlertCircle, Wrench, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export interface DawStatusBadgeProps {
  activeDaw: string;
  isAudioConnected: boolean;
  onDeploySteinbergScript?: () => void;
  onSwitchDaw?: (daw: string) => void;
}

export const DawStatusBadge: React.FC<DawStatusBadgeProps> = ({
  activeDaw,
  isAudioConnected,
  onDeploySteinbergScript,
  onSwitchDaw
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const rawDaw = activeDaw.trim().toLowerCase();
  const isLogic = rawDaw.includes('logic');
  const isNuendo = rawDaw.includes('nuendo');
  const isCubase = rawDaw.includes('cubase');

  // DAW Branding & Formatting
  let dawTitle = 'Standalone';
  let dawIcon = '⚪';
  let badgeBorder = 'border-slate-700/80 bg-slate-800/80 text-slate-300';
  let glowColor = 'shadow-slate-900/40';
  let pluginFormat = isLogic ? 'AU' : isNuendo || isCubase ? 'VST3' : 'Meter';
  let controlBridge = isLogic ? 'macOS AX' : isNuendo || isCubase ? 'MIDI Remote' : 'Standby';

  if (isLogic) {
    dawTitle = 'Logic Pro';
    dawIcon = '🍎';
    badgeBorder = 'border-purple-500/40 bg-purple-950/40 text-purple-200 hover:border-purple-400/60';
    glowColor = 'shadow-purple-900/30';
  } else if (isNuendo) {
    dawTitle = 'Nuendo 14';
    dawIcon = '🟦';
    badgeBorder = 'border-sky-500/50 bg-sky-950/50 text-sky-200 hover:border-sky-400/70';
    glowColor = 'shadow-sky-900/40';
  } else if (isCubase) {
    dawTitle = 'Cubase 14';
    dawIcon = '🟥';
    badgeBorder = 'border-rose-500/50 bg-rose-950/50 text-rose-200 hover:border-rose-400/70';
    glowColor = 'shadow-rose-900/40';
  }

  const handleDeploy = async () => {
    setIsDeploying(true);
    setDeployResult(null);
    try {
      if (onDeploySteinbergScript) {
        onDeploySteinbergScript();
      } else {
        const paths = await invoke<string[]>('deploy_steinberg_remote_script');
        setDeployResult(`✓ Skript für ${paths.length} Steinberg-Versionen installiert.`);
      }
    } catch (err) {
      setDeployResult(`✕ Fehler: ${err}`);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="relative inline-block text-xs" ref={popoverRef}>
      {/* HUD Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-sans font-medium transition-all shadow-sm cursor-pointer ${badgeBorder} ${glowColor}`}
        title="Multi-DAW Status & Bridge-Diagnose öffnen"
      >
        <span className="text-xs leading-none">{dawIcon}</span>
        <span className="font-semibold tracking-tight">{dawTitle}</span>

        {/* Separator */}
        <span className="opacity-40">|</span>

        {/* Audio Ear (AU/VST3) Status */}
        <span className="flex items-center gap-1 font-mono text-[10px]">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isAudioConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)] animate-pulse' : 'bg-amber-400/80'
            }`}
          />
          <span className={isAudioConnected ? 'text-emerald-300 font-bold' : 'text-slate-400'}>
            {pluginFormat}
          </span>
        </span>

        {/* Control Bridge (AX / MIDI Remote) */}
        <span className="hidden sm:inline font-mono text-[9px] px-1 py-0.2 rounded bg-black/40 text-slate-300 border border-white/10">
          {controlBridge}
        </span>
      </button>

      {/* Floating Diagnostics Popover */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-2 w-80 sm:w-88 bg-slate-900/98 border border-slate-700/80 rounded-xl shadow-2xl p-3.5 backdrop-blur-xl z-50 text-slate-200 animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm">{dawIcon}</span>
              <div>
                <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                  <span>{dawTitle}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                    Multi-DAW v0.9.0
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">
                  {isLogic
                    ? 'Apple Logic Pro (AU & macOS AXUIElement)'
                    : isNuendo || isCubase
                    ? 'Steinberg MIDI Remote & VST3 High-Res'
                    : 'Warte auf aktive DAW-Session...'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded transition-colors cursor-pointer text-xs"
            >
              ✕
            </button>
          </div>

          {/* Subsystem Rows */}
          <div className="space-y-2 text-xs">
            {/* 1. The Ear: Audio Telemetrie */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-2 min-w-0">
                <Radio className={`w-3.5 h-3.5 shrink-0 ${isAudioConnected ? 'text-emerald-400' : 'text-amber-400'}`} />
                <div>
                  <div className="font-medium text-slate-200 flex items-center gap-1.5">
                    <span>Audio-Telemetrie („The Ear“)</span>
                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-300">
                      {pluginFormat}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    ITU-R BS.1770-4 / EBU R128 Dual-Gate
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                {isAudioConnected ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold font-mono">
                    <CheckCircle2 className="w-3 h-3" /> Live
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 font-mono">
                    <AlertCircle className="w-3 h-3" /> Port 48123
                  </span>
                )}
              </div>
            </div>

            {/* 2. The Hands: Steuerungs-Bridge */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-2 min-w-0">
                <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <div>
                  <div className="font-medium text-slate-200">
                    Steuerungs-Bridge („The Hands“)
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono truncate max-w-[190px]">
                    {isLogic
                      ? 'Swift Mach-O Binary (AXUIElement)'
                      : isNuendo || isCubase
                      ? 'Steinberg Virtual CoreMIDI Ports'
                      : 'Bereit für Lane-Dispatch'}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="text-[10px] font-mono text-cyan-300 font-semibold bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/40">
                  {controlBridge}
                </span>
              </div>
            </div>

            {/* 3. Safety Guard: Acoustic Shock Shield */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <div>
                  <div className="font-medium text-slate-200">
                    Acoustic Shock Shield
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    +3.0 dB Clamp & A/B-Restore Schutz
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="text-[10px] font-mono text-emerald-300 font-semibold bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                  Aktiv
                </span>
              </div>
            </div>
          </div>

          {/* Steinberg Remote Installer Action */}
          <div className="mt-2.5 pt-2 border-t border-slate-800/80 space-y-1.5">
            <button
              type="button"
              disabled={isDeploying}
              onClick={handleDeploy}
              className="w-full flex items-center justify-center gap-2 py-1.5 px-2.5 rounded-lg bg-blue-950/60 hover:bg-blue-900/70 border border-blue-500/40 text-blue-200 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              {isDeploying ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wrench className="w-3.5 h-3.5 text-blue-400" />
              )}
              <span>Steinberg MIDI Remote Skript installieren</span>
            </button>
            {deployResult && (
              <div className="text-[10px] font-mono text-center text-slate-300">
                {deployResult}
              </div>
            )}
          </div>

          {/* Quick Manual DAW Lane Selection (Hot-Switching Test) */}
          {onSwitchDaw && (
            <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Lane testen:</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSwitchDaw('logic_pro')}
                  className={`px-1.5 py-0.5 rounded font-mono cursor-pointer ${
                    isLogic ? 'bg-purple-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Logic
                </button>
                <button
                  type="button"
                  onClick={() => onSwitchDaw('nuendo')}
                  className={`px-1.5 py-0.5 rounded font-mono cursor-pointer ${
                    isNuendo ? 'bg-sky-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Nuendo
                </button>
                <button
                  type="button"
                  onClick={() => onSwitchDaw('cubase')}
                  className={`px-1.5 py-0.5 rounded font-mono cursor-pointer ${
                    isCubase ? 'bg-rose-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Cubase
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
