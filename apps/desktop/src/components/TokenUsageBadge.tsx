import React, { useState, useRef, useEffect } from 'react';
import { BarChart3, RotateCcw, ChevronDown, ChevronUp, Zap, Key, Clock, Sparkles, Layers } from 'lucide-react';
import type { AgentUsageStats } from '@mixing-buddy/ai-engine';

export interface TokenUsageBadgeProps {
  usage?: AgentUsageStats | null;
  activeKeysCount?: number;
  modelName?: string;
  onReset?: () => void;
}

export const TokenUsageBadge: React.FC<TokenUsageBadgeProps> = ({
  usage,
  activeKeysCount = 1,
  modelName = 'gemini-3.8-flash',
  onReset
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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

  const formatTokens = (n: number) => {
    if (n >= 1000) {
      return `${(n / 1000).toFixed(1)}k`;
    }
    return n.toString();
  };

  const totalTokens = usage?.totalTokenCount ?? 0;
  const promptTokens = usage?.promptTokenCount ?? 0;
  const candidateTokens = usage?.candidatesTokenCount ?? 0;
  const turns = usage?.turnsCount ?? 0;
  const durationSec = usage?.durationMs ? (usage.durationMs / 1000).toFixed(1) : '0.0';
  const effectiveKeys = usage?.activeKeyCount ?? activeKeysCount;
  const effectiveModel = usage?.model ?? modelName;

  const costDisplay =
    usage && usage.estimatedCostUsd > 0.0001
      ? `$${usage.estimatedCostUsd.toFixed(4)}`
      : '< $0.0001 (Free Tier)';

  return (
    <div className="relative inline-block font-sans" ref={containerRef}>
      {/* Badge Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono transition-all duration-150 border shadow-sm cursor-pointer select-none bg-slate-800/80 hover:bg-slate-800 border-slate-700/80 hover:border-blue-500/50 text-slate-300 hover:text-white"
        title="Token-Verbrauch & Latenz-Monitor öffnen"
      >
        <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
        <span className="font-semibold text-blue-300">
          {totalTokens > 0 ? `${formatTokens(totalTokens)} Tokens` : '0 Tokens'}
        </span>
        <span className="text-slate-500 font-normal">·</span>
        <span className="text-slate-300">{turns > 0 ? `${turns} Turns` : 'Ready'}</span>
        <span className="text-slate-500 font-normal">·</span>
        <span className="text-emerald-400 font-medium">{totalTokens > 0 ? `${durationSec}s` : '0s'}</span>
        {isOpen ? (
          <ChevronUp className="w-3 h-3 text-slate-400 ml-0.5" />
        ) : (
          <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
        )}
      </button>

      {/* Popover Card */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-2 w-80 bg-slate-900/95 border border-slate-700/80 rounded-xl shadow-2xl p-4 z-50 backdrop-blur-md text-xs select-none animate-in fade-in zoom-in-95 duration-100">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-800">
            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>Token- & Quota-Monitor</span>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-950/80 text-blue-300 border border-blue-800/50">
              HUD Telemetry
            </span>
          </div>

          {/* Metrics Grid */}
          <div className="space-y-2 font-mono text-[11px]">
            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-slate-500" />
                Input Tokens:
              </span>
              <span className="font-semibold text-slate-200">{promptTokens.toLocaleString()}</span>
            </div>

            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-amber-500" />
                Output Tokens:
              </span>
              <span className="font-semibold text-slate-200">{candidateTokens.toLocaleString()}</span>
            </div>

            <div className="flex items-center justify-between py-0.5 border-t border-slate-800/60 pt-1">
              <span className="text-slate-400 flex items-center gap-1.5">
                <BarChart3 className="w-3 h-3 text-blue-400" />
                Total Session Tokens:
              </span>
              <span className="font-bold text-blue-300">{totalTokens.toLocaleString()}</span>
            </div>

            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-emerald-400" />
                Laufzeit / Turns:
              </span>
              <span className="text-emerald-400 font-semibold">
                {durationSec}s ({turns} Turns)
              </span>
            </div>

            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-400">Modell:</span>
              <span className="text-slate-300 font-sans truncate max-w-[130px]" title={effectiveModel}>
                {effectiveModel}
              </span>
            </div>

            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Key className="w-3 h-3 text-emerald-400" />
                Aktive Keys im Pool:
              </span>
              <span className="flex items-center gap-1 text-slate-200 font-semibold">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {effectiveKeys} (🟢 Bereit)
              </span>
            </div>

            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-400">Geschätzte Kosten:</span>
              <span className="text-emerald-300 font-semibold">{costDisplay}</span>
            </div>
          </div>

          {/* Reset Action */}
          <div className="mt-3 pt-2.5 border-t border-slate-800 flex justify-end">
            <button
              type="button"
              onClick={() => {
                onReset?.();
                setIsOpen(false);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-medium transition-all"
            >
              <RotateCcw className="w-3 h-3 text-slate-400" />
              <span>Token-Zähler zurücksetzen</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
