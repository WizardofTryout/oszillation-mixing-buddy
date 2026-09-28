import React, { useState, useEffect } from 'react';
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
  Plus,
  Trash2,
  Eye,
  EyeOff
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

interface KeyRow {
  id: string;
  value: string;
  show: boolean;
  status: 'idle' | 'checking' | 'valid' | 'invalid';
  error?: string;
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
  apiKeys,
  onApiKeysChange
}) => {
  const [copied, setCopied] = useState(false);
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [testSummary, setTestSummary] = useState<{
    status: 'idle' | 'valid' | 'invalid';
    message: string;
  }>({ status: 'idle', message: '' });

  const [availableModels, setAvailableModels] = useState<string[]>([
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro'
  ]);
  const [isCustomModel, setIsCustomModel] = useState(false);

  // Initialize structured key rows from props
  const [keyRows, setKeyRows] = useState<KeyRow[]>(() => {
    const rawList = apiKeys && apiKeys.length > 0
      ? apiKeys
      : apiKey ? apiKey.split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean) : [];

    if (rawList.length === 0) {
      return [{ id: 'k_1', value: '', show: false, status: 'idle' }];
    }
    return rawList.map((val, idx) => ({
      id: `k_${idx + 1}`,
      value: val,
      show: false,
      status: 'idle'
    }));
  });

  // Sync if external apiKey prop changes drastically
  useEffect(() => {
    if (!apiKey && (!apiKeys || apiKeys.length === 0) && keyRows.length === 1 && keyRows[0].value === '') {
      return;
    }
    const currentValues = keyRows.map((r) => r.value.trim()).filter(Boolean);
    const incoming = apiKeys ?? (apiKey ? apiKey.split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean) : []);
    if (incoming.length > 0 && incoming.join(',') !== currentValues.join(',')) {
      setKeyRows(
        incoming.map((val, idx) => ({
          id: `k_${idx + 1}`,
          value: val,
          show: false,
          status: 'idle'
        }))
      );
    }
  }, [apiKey, apiKeys]);

  const notifyParent = (rows: KeyRow[]) => {
    const validKeys = rows.map((r) => r.value.trim()).filter((v) => v.length > 0);
    onApiKeysChange?.(validKeys);
    onApiKeyChange?.(validKeys.join(','));
  };

  const handleKeyChange = (id: string, newVal: string) => {
    const updated = keyRows.map((row) => (row.id === id ? { ...row, value: newVal, status: 'idle' as const } : row));
    setKeyRows(updated);
    notifyParent(updated);
    setTestSummary({ status: 'idle', message: '' });
  };

  const handleToggleShow = (id: string) => {
    setKeyRows((prev) => prev.map((row) => (row.id === id ? { ...row, show: !row.show } : row)));
  };

  const handleAddKey = () => {
    const newRow: KeyRow = {
      id: `k_${Date.now()}`,
      value: '',
      show: false,
      status: 'idle'
    };
    const updated = [...keyRows, newRow];
    setKeyRows(updated);
    notifyParent(updated);
  };

  const handleDeleteKey = (id: string) => {
    if (keyRows.length <= 1) {
      const reset = [{ id: 'k_1', value: '', show: false, status: 'idle' as const }];
      setKeyRows(reset);
      notifyParent(reset);
      return;
    }
    const filtered = keyRows.filter((r) => r.id !== id);
    setKeyRows(filtered);
    notifyParent(filtered);
  };

  const handleValidateAll = async () => {
    const activeRows = keyRows.filter((r) => r.value.trim().length > 5);
    if (activeRows.length === 0) {
      setTestSummary({
        status: 'invalid',
        message: 'Kein gültiger API-Key eingetragen. Bitte trage mindestens einen Key ein.'
      });
      return;
    }

    setIsTestingAll(true);
    setTestSummary({ status: 'idle', message: 'Prüfe Keys und lade verfügbare Modelle...' });

    // Mark active rows as checking
    setKeyRows((prev) =>
      prev.map((r) => (r.value.trim().length > 5 ? { ...r, status: 'checking', error: undefined } : r))
    );

    try {
      const discoveredModelSet = new Set<string>();
      let allValid = true;

      const updatedRows = await Promise.all(
        keyRows.map(async (row) => {
          if (row.value.trim().length <= 5) return row;
          const result = await GeminiProvider.validateKey(row.value.trim(), modelName);
          if (result.availableModels && result.availableModels.length > 0) {
            for (const m of result.availableModels) discoveredModelSet.add(m);
          }
          if (!result.valid) allValid = false;
          return {
            ...row,
            status: (result.valid ? 'valid' : 'invalid') as 'valid' | 'invalid',
            error: result.error
          };
        })
      );

      setKeyRows(updatedRows);

      if (discoveredModelSet.size > 0) {
        const sorted = Array.from(discoveredModelSet).sort((a, b) => {
          const aFlash = a.includes('flash') ? 0 : 1;
          const bFlash = b.includes('flash') ? 0 : 1;
          return aFlash - bFlash;
        });
        setAvailableModels(sorted);
        if (!sorted.includes(modelName)) {
          onModelNameChange?.(sorted[0]);
        }
      }

      const validCount = updatedRows.filter((r) => r.status === 'valid').length;
      if (allValid && validCount > 0) {
        setTestSummary({
          status: 'valid',
          message:
            validCount === 1
              ? '🟢 API-Key aktiv & bereit (Modelle aktualisiert)'
              : `🟢 ${validCount} API-Keys aktiv & bereit (Round-Robin & Fallback aktiv)`
        });
      } else if (validCount > 0) {
        setTestSummary({
          status: 'valid',
          message: `🟡 ${validCount} von ${activeRows.length} Keys aktiv (${activeRows.length - validCount} fehlerhaft)`
        });
      } else {
        setTestSummary({
          status: 'invalid',
          message: '🔴 Alle geprüften API-Keys sind ungültig oder Quota überschritten.'
        });
      }
    } catch (err: unknown) {
      setTestSummary({
        status: 'invalid',
        message: `🔴 Fehler bei der Prüfung: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setIsTestingAll(false);
    }
  };

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
              <Sparkles className="w-3.5 h-3.5" /> Gemini Flash / Pro
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

        {/* Structured Multi-Key Management & Dynamic Model Selector Bar */}
        {(currentMode === 'byok_gemini' || currentMode === 'byok_claude') && (
          <div className="mt-2 p-3 rounded bg-[#101216] border border-darkBorder/80 flex flex-col gap-3 text-xs">
            {/* Top row: Model Selector Dropdown & Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-darkBorder/50">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-medium">Modell:</span>
                {currentMode === 'byok_gemini' ? (
                  <div className="flex items-center gap-2">
                    {!isCustomModel ? (
                      <select
                        value={modelName}
                        onChange={(e) => {
                          if (e.target.value === '__custom__') {
                            setIsCustomModel(true);
                          } else {
                            onModelNameChange?.(e.target.value);
                          }
                        }}
                        className="bg-[#1a1c23] border border-darkBorder px-2.5 py-1 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-blue-500"
                      >
                        {availableModels.map((m) => (
                          <option key={m} value={m}>
                            {m} {m.includes('flash') ? '⚡' : '🧠'}
                          </option>
                        ))}
                        <option value="__custom__">+ Manuelles Modell...</option>
                      </select>
                    ) : (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={modelName}
                          onChange={(e) => onModelNameChange?.(e.target.value)}
                          placeholder="gemini-3.8-flash"
                          className="bg-[#1a1c23] border border-darkBorder px-2 py-1 rounded text-slate-200 font-mono text-xs w-40"
                        />
                        <button
                          type="button"
                          onClick={() => setIsCustomModel(false)}
                          className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                        >
                          Liste
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => onModelNameChange?.(e.target.value)}
                    placeholder="claude-3-7-sonnet-20250219"
                    className="bg-[#1a1c23] border border-darkBorder px-2.5 py-1 rounded text-slate-200 font-mono text-xs w-52"
                  />
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddKey}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#1c1f2b] hover:bg-[#252a3b] text-blue-300 border border-blue-500/30 text-xs font-medium transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Key hinzufügen</span>
                </button>

                <button
                  type="button"
                  onClick={handleValidateAll}
                  disabled={isTestingAll || keyRows.every((r) => r.value.trim().length <= 5)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-xs transition-all shadow-sm"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingAll ? 'animate-spin' : ''}`} />
                  <span>{isTestingAll ? 'Prüfe...' : 'Keys Prüfen & Modelle laden'}</span>
                </button>
              </div>
            </div>

            {/* Structured Key Rows */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] text-slate-400 font-medium">
                {currentMode === 'byok_gemini'
                  ? 'API-Keys (Standardmäßig maskiert • Automatische Round-Robin-Rotation & 60s Cooldown bei 503/429):'
                  : 'Anthropic API-Key:'}
              </span>

              {keyRows.map((row, idx) => (
                <div key={row.id} className="flex items-center gap-2 bg-[#14161f] border border-darkBorder/70 p-1.5 rounded">
                  <span className="text-[11px] font-mono text-slate-400 w-14 shrink-0 pl-1">
                    Key #{idx + 1}:
                  </span>

                  {/* Masked Password Input */}
                  <input
                    type={row.show ? 'text' : 'password'}
                    value={row.value}
                    onChange={(e) => handleKeyChange(row.id, e.target.value)}
                    placeholder={currentMode === 'byok_gemini' ? 'AIzaSy...' : 'sk-ant-...'}
                    className="flex-1 bg-[#1a1c26] border border-darkBorder px-2 py-1 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-blue-500 tracking-wider"
                  />

                  {/* Toggle Show/Hide Eye Icon */}
                  <button
                    type="button"
                    onClick={() => handleToggleShow(row.id)}
                    className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
                    title={row.show ? 'Key maskieren' : 'Key im Klartext anzeigen'}
                  >
                    {row.show ? <EyeOff className="w-4 h-4 text-amber-400" /> : <Eye className="w-4 h-4" />}
                  </button>

                  {/* Delete Button */}
                  <button
                    type="button"
                    onClick={() => handleDeleteKey(row.id)}
                    className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-all"
                    title="Diesen Key entfernen"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  {/* Per-Key Status Icon */}
                  <div className="w-6 flex items-center justify-center shrink-0">
                    {row.status === 'checking' && <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />}
                    {row.status === 'valid' && (
                      <span title="Key ist gültig und einsatzbereit">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      </span>
                    )}
                    {row.status === 'invalid' && (
                      <span title={row.error || 'Ungültiger Key oder Quota überschritten'}>
                        <AlertCircle className="w-4 h-4 text-rose-400" />
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Validation Summary Banner */}
            {testSummary.status !== 'idle' && (
              <div
                className={`p-2 rounded border flex items-center gap-2 text-xs transition-all ${
                  testSummary.status === 'valid'
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                }`}
              >
                {testSummary.status === 'valid' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{testSummary.message}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};


