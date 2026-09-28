import React, { useState } from 'react';
import { Cpu, Server, Key, Radio, ShieldCheck, Copy, Check, Sparkles } from 'lucide-react';

export type ProviderMode =
  | 'managed'
  | 'byok_claude'
  | 'byok_gemini'
  | 'byok_openai'
  | 'ollama'
  | 'mcp_external';

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
  const [copied, setCopied] = useState(false);

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        'steinberg-mixing-buddy': {
          command: 'node',
          args: [
            '/Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/packages/mcp-server/dist/index.js',
            '--stdio'
          ]
        }
      }
    },
    null,
    2
  );

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(claudeDesktopConfig);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="bg-darkSurface border border-darkBorder rounded-lg p-4 shadow-lg flex flex-col gap-4">
      {/* System Status Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-darkBorder/60">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-300">
            <span
              className={`w-2 h-2 rounded-full ${isAudioConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}
            />
            Audio: <span className="font-mono font-bold">{isAudioConnected ? 'Live (48123)' : 'Waiting...'}</span>
          </span>

          <span className="text-slate-600">|</span>

          <span className="text-xs text-slate-300">
            DAW: <span className="font-semibold text-blue-400 capitalize">{activeDaw}</span>
          </span>

          <span className="text-slate-600">|</span>

          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            License: <span className="font-semibold">{isLicenseActive ? 'Active' : 'Offline Grace'}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono bg-blue-950/80 border border-blue-500/30 text-blue-300 px-2.5 py-0.5 rounded flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            MCP: Active on SSE 48124 / stdio ({mcpClientsCount} client{mcpClientsCount === 1 ? '' : 's'})
          </span>
        </div>
      </div>

      {/* Provider Selector */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Reasoning Engine & AI Backend:
          </label>
          <button
            onClick={copyConfig}
            className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 bg-blue-950/40 hover:bg-blue-900/40 border border-blue-500/20 px-2 py-0.5 rounded transition-all"
            title="Copy Claude Desktop configuration JSON"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Config Copied!' : 'Copy Claude Desktop Config'}
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {/* Managed Cloud */}
          <button
            onClick={() => onSelectMode('managed')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all ${
              currentMode === 'managed'
                ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Server className="w-3.5 h-3.5" /> Managed Cloud
            </div>
            <span className="text-[10px] text-slate-500">buddy.oszillation-studio</span>
          </button>

          {/* BYOK Anthropic */}
          <button
            onClick={() => onSelectMode('byok_claude')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all ${
              currentMode === 'byok_claude'
                ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Key className="w-3.5 h-3.5" /> Claude 3.5
            </div>
            <span className="text-[10px] text-slate-500">Anthropic BYOK</span>
          </button>

          {/* BYOK Gemini */}
          <button
            onClick={() => onSelectMode('byok_gemini')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all ${
              currentMode === 'byok_gemini'
                ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5" /> Gemini 1.5
            </div>
            <span className="text-[10px] text-slate-500">Google AI BYOK</span>
          </button>

          {/* Local Ollama */}
          <button
            onClick={() => onSelectMode('ollama')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all ${
              currentMode === 'ollama'
                ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Cpu className="w-3.5 h-3.5" /> Ollama Local
            </div>
            <span className="text-[10px] text-slate-500">localhost:11434</span>
          </button>

          {/* External MCP */}
          <button
            onClick={() => onSelectMode('mcp_external')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all ${
              currentMode === 'mcp_external'
                ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Radio className="w-3.5 h-3.5" /> Claude Desktop
            </div>
            <span className="text-[10px] text-slate-500">via stdio MCP</span>
          </button>
        </div>
      </div>
    </div>
  );
};
