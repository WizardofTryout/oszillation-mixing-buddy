import React, { useState } from 'react';
import {
  Cpu,
  Server,
  Key,
  Radio,
  ShieldCheck,
  Copy,
  Check,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ListPlus
} from 'lucide-react';
import { GeminiProvider } from '@mixing-buddy/ai-engine';

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
  modelName?: string;
  onModelNameChange?: (name: string) => void;
  apiKey?: string;
  onApiKeyChange?: (key: string) => void;
  apiKeys?: string[];
  onApiKeysChange?: (keys: string[]) => void;
}

export const ProviderSettings: React.FC<ProviderSettingsProps> = ({
  currentMode,
  onSelectMode,
  activeDaw,
  isAudioConnected,
  isLicenseActive,
  mcpClientsCount,
  modelName = 'gemini-3.8-flash',
  onModelNameChange,
  apiKey = '',
  onApiKeyChange,
  onApiKeysChange
}) => {
  const [copied, setCopied] = useState(false);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'valid' | 'invalid';
    message: string;
    details?: string[];
  }>({ status: 'idle', message: '' });
  const [isExpandedTextarea, setIsExpandedTextarea] = useState(false);

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        'oszillation-mixing-buddy': {
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

  const getEffectiveDawLabel = (daw: string) => {
    if (daw.toLowerCase().includes('logic')) return 'Logic Pro';
    if (daw.toLowerCase().includes('nuendo')) return 'Nuendo';
    if (daw.toLowerCase().includes('cubase')) return 'Cubase';
    return daw === 'none' ? 'None (Standalone)' : daw;
  };

  const parsedKeys = apiKey
    ? apiKey
        .split(/[\n,;]+/)
        .map((k) => k.trim())
        .filter((k) => k.length > 5)
    : [];

  const handleKeyInputChange = (val: string) => {
    onApiKeyChange?.(val);
    const keys = val
      .split(/[\n,;]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 5);
    onApiKeysChange?.(keys);
    setTestResult({ status: 'idle', message: '' });
  };

  const handleTestKeys = async () => {
    if (!apiKey || parsedKeys.length === 0) {
      setTestResult({
        status: 'invalid',
        message: 'Kein API-Key hinterlegt. Bitte mindestens einen Key eintragen.'
      });
      return;
    }

    setIsTestingKey(true);
    setTestResult({ status: 'idle', message: 'Prüfe Key(s)...' });

    try {
      if (currentMode === 'byok_gemini') {
        const results = await Promise.all(
          parsedKeys.map((k) => GeminiProvider.validateKey(k, modelName))
        );

        const validCount = results.filter((r) => r.valid).length;
        const invalidResults = results.filter((r) => !r.valid);

        if (validCount === results.length) {
          setTestResult({
            status: 'valid',
            message:
              results.length === 1
                ? '🟢 API-Key aktiv & bereit'
                : `🟢 ${results.length} API-Keys aktiv & bereit (Round-Robin aktiv)`
          });
        } else if (validCount > 0) {
          setTestResult({
            status: 'valid',
            message: `🟡 ${validCount} von ${results.length} Keys bereit (${invalidResults.length} fehlerhaft)`,
            details: invalidResults.map((r) => `${r.keySnippet}: ${r.error}`)
          });
        } else {
          setTestResult({
            status: 'invalid',
            message: `🔴 Ungültiger Key oder Quota überschritten (${invalidResults[0]?.error || 'Fehler'})`,
            details: invalidResults.map((r) => `${r.keySnippet}: ${r.error}`)
          });
        }
      } else {
        if (apiKey.startsWith('sk-ant-') && apiKey.length > 20) {
          setTestResult({
            status: 'valid',
            message: '🟢 Anthropic API-Key Format gültig & bereit'
          });
        } else {
          setTestResult({
            status: 'invalid',
            message: '🔴 Ungültiger API-Key: Muss mit sk-ant- beginnen'
          });
        }
      }
    } catch (err: unknown) {
      setTestResult({
        status: 'invalid',
        message: `🔴 Fehler bei Validierung: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setIsTestingKey(false);
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
            DAW: <span className="font-semibold text-blue-400">{getEffectiveDawLabel(activeDaw)}</span>
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
              <Key className="w-3.5 h-3.5" /> Claude 3.7 / 3.5
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
              <Sparkles className="w-3.5 h-3.5" /> Gemini 3.8
            </div>
            <span className="text-[10px] text-slate-500">Google AI (Multi-Key)</span>
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

        {/* Dynamic Model & Multi-API-Key Config Bar */}
        {(currentMode === 'byok_gemini' || currentMode === 'byok_claude') && (
          <div className="mt-2 p-3 rounded bg-[#101216] border border-darkBorder/80 flex flex-col gap-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 min-w-[220px]">
                <span className="text-slate-400 font-medium">Model ID:</span>
                <input
                  type="text"
                  value={modelName}
                  onChange={(e) => onModelNameChange?.(e.target.value)}
                  placeholder={currentMode === 'byok_gemini' ? 'gemini-3.8-flash' : 'claude-3-7-sonnet-20250219'}
                  className="bg-[#1a1c23] border border-darkBorder px-2.5 py-1 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-blue-500 w-44"
                />
              </div>

              <div className="flex items-center gap-2 flex-1 min-w-[280px]">
                <span className="text-slate-400 font-medium whitespace-nowrap">
                  {currentMode === 'byok_gemini' ? 'API-Keys (Multi/Round-Robin):' : 'API Key:'}
                </span>

                <div className="flex-1 flex items-center gap-1.5">
                  {!isExpandedTextarea ? (
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => handleKeyInputChange(e.target.value)}
                      placeholder={
                        currentMode === 'byok_gemini'
                          ? 'Key 1, Key 2... (kommagetrennt oder mehrzeilig)'
                          : 'sk-ant-...'
                      }
                      className="flex-1 bg-[#1a1c23] border border-darkBorder px-2.5 py-1 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-blue-500"
                    />
                  ) : null}

                  {currentMode === 'byok_gemini' && (
                    <button
                      type="button"
                      onClick={() => setIsExpandedTextarea(!isExpandedTextarea)}
                      className="p-1 rounded bg-[#1f222e] hover:bg-[#282c3c] text-slate-300 border border-darkBorder text-[11px] flex items-center gap-1"
                      title={isExpandedTextarea ? 'Kompaktansicht' : 'Mehrzeilige Eingabe für Multi-Keys'}
                    >
                      <ListPlus className="w-3.5 h-3.5 text-blue-400" />
                      <span>{isExpandedTextarea ? 'Kompakt' : `Mehrere (${parsedKeys.length})`}</span>
                    </button>
                  )}
                </div>

                {/* Key Prüfen Button */}
                <button
                  type="button"
                  onClick={handleTestKeys}
                  disabled={isTestingKey || !apiKey.trim()}
                  className="flex items-center gap-1.5 px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-xs transition-all shadow-sm"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingKey ? 'animate-spin' : ''}`} />
                  <span>{isTestingKey ? 'Prüfe...' : 'Key Prüfen'}</span>
                </button>
              </div>
            </div>

            {/* Expandable Textarea for Multiple API Keys */}
            {isExpandedTextarea && currentMode === 'byok_gemini' && (
              <div className="flex flex-col gap-1 mt-1">
                <div className="flex justify-between items-center text-[11px] text-slate-400">
                  <span>Trage einen Key pro Zeile ein (oder kommagetrennt). Automatische Round-Robin-Rotation & 60s Cooldown bei 503/429:</span>
                  <span className="font-mono text-blue-400">{parsedKeys.length} Key{parsedKeys.length === 1 ? '' : 's'} aktiv</span>
                </div>
                <textarea
                  rows={3}
                  value={apiKey}
                  onChange={(e) => handleKeyInputChange(e.target.value)}
                  placeholder="AIzaSyKey1...&#10;AIzaSyKey2...&#10;AIzaSyKey3..."
                  className="w-full bg-[#1a1c23] border border-darkBorder p-2 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            {/* Visual Validation Status Indicator */}
            {testResult.status !== 'idle' && (
              <div
                className={`p-2 rounded border flex flex-col gap-1 text-xs transition-all ${
                  testResult.status === 'valid'
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                }`}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  {testResult.status === 'valid' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span>{testResult.message}</span>
                </div>
                {testResult.details && testResult.details.length > 0 && (
                  <ul className="list-disc list-inside text-[11px] text-slate-400 pl-1">
                    {testResult.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

