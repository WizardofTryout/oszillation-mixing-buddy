import React from 'react';
import { Cpu, Server, Key, Radio, ShieldCheck } from 'lucide-react';

export type ProviderMode = 'managed' | 'byok_claude' | 'byok_gemini' | 'byok_openai' | 'ollama' | 'mcp_external';

interface ProviderSettingsProps {
  currentMode: ProviderMode;
  onSelectMode: (mode: ProviderMode) => void;
  activeDaw: string;
  isAudioConnected: boolean;
  isLicenseActive: boolean;
  mcpClientsCount: number;
}

export const ProviderSettings: React.FC<ProviderSettingsProps> = ({
  currentMode,
  onSelectMode,
  activeDaw,
  isAudioConnected,
  isLicenseActive,
  mcpClientsCount
}) => {
  return (
    <div className="bg-darkSurface border border-darkBorder rounded-lg p-4 shadow-lg flex flex-col gap-4">
      {/* System Status Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-darkBorder/60">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-300">
            <span className={`w-2 h-2 rounded-full ${isAudioConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            Audio Engine: <span className="font-mono font-bold">{isAudioConnected ? 'Connected (48123)' : 'Waiting...'}</span>
          </span>

          <span className="text-slate-600">|</span>

          <span className="text-xs text-slate-300">
            DAW: <span className="font-semibold text-blue-400 capitalize">{activeDaw}</span>
          </span>

          <span className="text-slate-600">|</span>

          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            License: <span className="font-semibold">{isLicenseActive ? 'Active' : 'Unverified'}</span>
          </span>
        </div>

        <span className="text-xs font-mono bg-slate-800 text-blue-300 px-2 py-0.5 rounded">
          MCP Server: {mcpClientsCount} Active Client(s)
        </span>
      </div>

      {/* Provider Selector */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Reasoning Engine & AI Backend:
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {/* Managed Cloud */}
          <button
            onClick={() => onSelectMode('managed')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all ${currentMode === 'managed' ? 'bg-blue-600/20 border-blue-500 text-blue-200' : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'}`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Server className="w-3.5 h-3.5" /> Managed Cloud
            </div>
            <span className="text-[10px] text-slate-500">buddy.oszillation-studio</span>
          </button>

          {/* BYOK Anthropic */}
          <button
            onClick={() => onSelectMode('byok_claude')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all ${currentMode === 'byok_claude' ? 'bg-blue-600/20 border-blue-500 text-blue-200' : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'}`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Key className="w-3.5 h-3.5" /> BYOK Claude 3.5
            </div>
            <span className="text-[10px] text-slate-500">Direct Anthropic API</span>
          </button>

          {/* Local Ollama */}
          <button
            onClick={() => onSelectMode('ollama')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all ${currentMode === 'ollama' ? 'bg-blue-600/20 border-blue-500 text-blue-200' : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'}`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Cpu className="w-3.5 h-3.5" /> Local Ollama
            </div>
            <span className="text-[10px] text-slate-500">localhost:11434 (Offline)</span>
          </button>

          {/* External MCP */}
          <button
            onClick={() => onSelectMode('mcp_external')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all ${currentMode === 'mcp_external' ? 'bg-blue-600/20 border-blue-500 text-blue-200' : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'}`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Radio className="w-3.5 h-3.5" /> External MCP
            </div>
            <span className="text-[10px] text-slate-500">Claude Desktop / Cursor</span>
          </button>
        </div>
      </div>
    </div>
  );
};
