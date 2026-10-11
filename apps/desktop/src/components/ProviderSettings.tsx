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
  EyeOff,
  Settings,
  X,
  Download,
  Star
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { GeminiProvider } from '@mixing-buddy/ai-engine';

export type ProviderMode =
  | 'managed'
  | 'byok_claude'
  | 'byok_gemini'
  | 'byok_openai'
  | 'ollama'
  | 'mcp_external';

type McpModalTab = 'claude_desktop' | 'cursor' | 'vscode_custom';

interface ProviderSettingsProps {
  currentMode: ProviderMode;
  onSelectMode: (mode: ProviderMode) => void;
  defaultMode?: ProviderMode;
  onSetDefaultMode?: (mode: ProviderMode) => void;
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
  defaultMode,
  onSetDefaultMode,
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
  const getProviderLabel = (mode: ProviderMode): string => {
    switch (mode) {
      case 'managed':
        return 'Managed Cloud';
      case 'byok_claude':
        return 'Claude BYOK';
      case 'byok_gemini':
        return 'Gemini BYOK';
      case 'ollama':
        return 'Ollama Local';
      case 'mcp_external':
        return 'External MCP';
      default:
        return mode;
    }
  };

  const [internalDefaultMode, setInternalDefaultMode] = useState<ProviderMode>(() => {
    try {
      return (
        defaultMode ||
        (localStorage.getItem('omb_default_provider') as ProviderMode) ||
        (localStorage.getItem('omb_preferred_provider') as ProviderMode) ||
        'byok_gemini'
      );
    } catch {
      return 'byok_gemini';
    }
  });

  const effectiveDefaultMode = defaultMode ?? internalDefaultMode;

  const handleMakeDefault = (mode: ProviderMode, e: React.MouseEvent) => {
    e.stopPropagation();
    setInternalDefaultMode(mode);
    onSetDefaultMode?.(mode);
    try {
      localStorage.setItem('omb_default_provider', mode);
      localStorage.setItem('omb_preferred_provider', mode);
    } catch {}
  };
  const [copied, setCopied] = useState(false);
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
  const [mcpModalTab, setMcpModalTab] = useState<McpModalTab>('claude_desktop');
  const [customConfigPath, setCustomConfigPath] = useState('');
  const [installStatus, setInstallStatus] = useState<{
    status: 'idle' | 'installing' | 'success' | 'error';
    message: string;
  }>({ status: 'idle', message: '' });

  const [isTestingAll, setIsTestingAll] = useState(false);
  const [testSummary, setTestSummary] = useState<{
    status: 'idle' | 'valid' | 'invalid';
    message: string;
  }>({ status: 'idle', message: '' });

interface GeminiModelDef {
  id: string;
  name: string;
  description: string;
}

const DEFAULT_GEMINI_MODELS: GeminiModelDef[] = [
  { id: 'gemini-3.8-flash', name: 'gemini-3.8-flash ⚡', description: 'Neuestes Standardmodell für Mixing & Tool-Calling' },
  { id: 'gemini-3.5-flash-lite', name: 'gemini-3.5-flash-lite ⚡', description: 'Hochverfügbar, unempfindlich gegen Bursts' },
  { id: 'gemini-3.5-flash', name: 'gemini-3.5-flash ⚡', description: 'Stabiles Multimodal-Flash' },
  { id: 'gemini-3.1-pro', name: 'gemini-3.1-pro 🧠', description: 'Deep Reasoning & Komplexe Akustik' }
];

  const [availableModels, setAvailableModels] = useState<GeminiModelDef[]>(DEFAULT_GEMINI_MODELS);
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
        const filtered = Array.from(discoveredModelSet)
          .filter((m) => !m.includes('2.5') && !m.includes('1.5') && !m.includes('2.0'))
          .sort((a, b) => {
            const aFlash = a.includes('flash') ? 0 : 1;
            const bFlash = b.includes('flash') ? 0 : 1;
            return aFlash - bFlash;
          });
        const updatedList: GeminiModelDef[] = filtered.map((id) => {
          const known = DEFAULT_GEMINI_MODELS.find((dm) => dm.id === id);
          if (known) return known;
          return {
            id,
            name: `${id} ${id.includes('flash') ? '⚡' : '🧠'}`,
            description: id.includes('flash') ? 'Hochperformantes Flash-Modell' : 'Reasoning Pro-Modell'
          };
        });
        setAvailableModels(updatedList.length > 0 ? updatedList : DEFAULT_GEMINI_MODELS);
        if (!filtered.includes(modelName)) {
          onModelNameChange?.(filtered[0] || 'gemini-3.8-flash');
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

  const nodeBinaryPath = '/opt/homebrew/bin/node';
  const mcpServerDistPath =
    '/Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/packages/mcp-server/dist/index.js';

  const getMcpConfigBlock = (tab: McpModalTab): { fileHint: string; json: string } => {
    if (tab === 'claude_desktop') {
      return {
        fileHint: '~/Library/Application Support/Claude/claude_desktop_config.json',
        json: JSON.stringify(
          {
            mcpServers: {
              'oszillation-mixing-buddy': {
                command: nodeBinaryPath,
                args: [mcpServerDistPath, '--stdio']
              }
            }
          },
          null,
          2
        )
      };
    }
    if (tab === 'cursor') {
      return {
        fileHint: '~/.cursor/mcp.json',
        json: JSON.stringify(
          {
            mcpServers: {
              'oszillation-mixing-buddy': {
                command: nodeBinaryPath,
                args: [mcpServerDistPath, '--stdio']
              }
            }
          },
          null,
          2
        )
      };
    }
    return {
      fileHint: '~/.gemini/config/mcp_config.json oder ~/Library/Application Support/Code/User/mcp.json',
      json: JSON.stringify(
        {
          mcpServers: {
            'oszillation-mixing-buddy': {
              command: nodeBinaryPath,
              args: [mcpServerDistPath, '--stdio'],
              sseEndpoint: 'http://127.0.0.1:48124/sse'
            }
          }
        },
        null,
        2
      )
    };
  };

  const currentMcpBlock = getMcpConfigBlock(mcpModalTab);

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(currentMcpBlock.json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleInstallMcpConfig = async () => {
    setInstallStatus({ status: 'installing', message: 'Schreibe Konfiguration...' });
    try {
      const msg = await invoke<string>('install_mcp_client_config', {
        clientType: mcpModalTab,
        customPath: mcpModalTab === 'vscode_custom' && customConfigPath.trim() ? customConfigPath.trim() : null
      });
      setInstallStatus({ status: 'success', message: msg });
    } catch (err: unknown) {
      setInstallStatus({
        status: 'error',
        message: `Fehler beim Installieren: ${String(err)}`
      });
    }
  };

  const getEffectiveDawLabel = (daw: string) => {
    const d = daw.toLowerCase();
    if (d.includes('logic')) return 'Logic Pro';
    if (d.includes('nuendo')) return 'Nuendo';
    if (d.includes('cubase')) return 'Cubase';
    return d === 'none' || d.includes('detecting') || !d.trim() ? 'Keine / Standalone' : daw;
  };

  const isMcpConnected = mcpClientsCount > 0;

  return (
    <div className="bg-darkSurface border border-darkBorder rounded-lg p-4 shadow-lg flex flex-col gap-4">
      {/* System Status Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-darkBorder/60">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-300">
            <span
              className={`w-2 h-2 rounded-full ${isAudioConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`}
            />
            Audio: <span className="font-mono font-bold">{isAudioConnected ? 'Live (48123)' : 'Offline'}</span>
          </span>

          <span className="text-slate-600">|</span>

          <span className="text-xs text-slate-300">
            DAW: <span className={`font-semibold ${activeDaw === 'none' ? 'text-slate-400' : 'text-blue-400'}`}>{getEffectiveDawLabel(activeDaw)}</span>
          </span>

          <span className="text-slate-600">|</span>

          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            License: <span className="font-semibold">{isLicenseActive ? 'Active' : 'Offline Grace'}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`text-[11px] font-mono px-2.5 py-0.5 rounded flex items-center gap-1.5 border ${
              isMcpConnected
                ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-300'
                : 'bg-slate-900/80 border-slate-700 text-slate-400'
            }`}
          >
            {isMcpConnected ? '🟢 Verbunden (stdio / SSE 48124)' : '⚪ Wartet auf MCP-Client'}
          </span>
        </div>
      </div>

      {/* Provider Selector */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Reasoning Engine & AI Backend:
            </label>
            <span
              className="text-[11px] text-amber-400 flex items-center gap-1 font-medium bg-amber-950/40 border border-amber-500/30 px-2.5 py-0.5 rounded shadow-sm"
              title="Aktiver Standard-Provider (beim App-Start automatisch aktiv)"
            >
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span>Standard: {getProviderLabel(effectiveDefaultMode)}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setInstallStatus({ status: 'idle', message: '' });
              setIsMcpModalOpen(true);
            }}
            className="flex items-center gap-1.5 text-[11px] text-blue-300 hover:text-white bg-blue-950/50 hover:bg-blue-900/60 border border-blue-500/30 px-2.5 py-1 rounded transition-all font-medium"
            title="Universellen MCP-Konfigurationsdialog für Claude Desktop, Cursor oder VS Code öffnen"
          >
            <Settings className="w-3.5 h-3.5 text-blue-400" />
            <span>⚙️ MCP Client verbinden...</span>
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {/* Managed Cloud */}
          <button
            onClick={() => onSelectMode('managed')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all relative group ${
              currentMode === 'managed'
                ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 text-xs font-bold truncate">
                <Server className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Managed Cloud</span>
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => handleMakeDefault('managed', e)}
                onKeyDown={(e) => e.key === 'Enter' && handleMakeDefault('managed', e as any)}
                title={effectiveDefaultMode === 'managed' ? 'Aktueller Standard-Provider' : 'Als Standard festlegen'}
                className="p-0.5 rounded hover:bg-slate-800 transition-transform hover:scale-125 shrink-0 cursor-pointer"
              >
                <Star
                  className={`w-3.5 h-3.5 transition-colors ${
                    effectiveDefaultMode === 'managed'
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-slate-600 group-hover:text-slate-400 hover:!text-amber-400'
                  }`}
                />
              </span>
            </div>
            <span className="text-[10px] text-slate-500">buddy.oszillation-studio</span>
          </button>

          {/* BYOK Anthropic */}
          <button
            onClick={() => onSelectMode('byok_claude')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all relative group ${
              currentMode === 'byok_claude'
                ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 text-xs font-bold truncate">
                <Key className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Claude 3.7 / 3.5</span>
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => handleMakeDefault('byok_claude', e)}
                onKeyDown={(e) => e.key === 'Enter' && handleMakeDefault('byok_claude', e as any)}
                title={effectiveDefaultMode === 'byok_claude' ? 'Aktueller Standard-Provider' : 'Als Standard festlegen'}
                className="p-0.5 rounded hover:bg-slate-800 transition-transform hover:scale-125 shrink-0 cursor-pointer"
              >
                <Star
                  className={`w-3.5 h-3.5 transition-colors ${
                    effectiveDefaultMode === 'byok_claude'
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-slate-600 group-hover:text-slate-400 hover:!text-amber-400'
                  }`}
                />
              </span>
            </div>
            <span className="text-[10px] text-slate-500">Anthropic BYOK</span>
          </button>

          {/* BYOK Gemini */}
          <button
            onClick={() => onSelectMode('byok_gemini')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all relative group ${
              currentMode === 'byok_gemini'
                ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 text-xs font-bold truncate">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Gemini Flash / Pro</span>
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => handleMakeDefault('byok_gemini', e)}
                onKeyDown={(e) => e.key === 'Enter' && handleMakeDefault('byok_gemini', e as any)}
                title={effectiveDefaultMode === 'byok_gemini' ? 'Aktueller Standard-Provider' : 'Als Standard festlegen'}
                className="p-0.5 rounded hover:bg-slate-800 transition-transform hover:scale-125 shrink-0 cursor-pointer"
              >
                <Star
                  className={`w-3.5 h-3.5 transition-colors ${
                    effectiveDefaultMode === 'byok_gemini'
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-slate-600 group-hover:text-slate-400 hover:!text-amber-400'
                  }`}
                />
              </span>
            </div>
            <span className="text-[10px] text-slate-500">Google AI (Multi-Key)</span>
          </button>

          {/* Local Ollama */}
          <button
            onClick={() => onSelectMode('ollama')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all relative group ${
              currentMode === 'ollama'
                ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 text-xs font-bold truncate">
                <Cpu className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Ollama Local</span>
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => handleMakeDefault('ollama', e)}
                onKeyDown={(e) => e.key === 'Enter' && handleMakeDefault('ollama', e as any)}
                title={effectiveDefaultMode === 'ollama' ? 'Aktueller Standard-Provider' : 'Als Standard festlegen'}
                className="p-0.5 rounded hover:bg-slate-800 transition-transform hover:scale-125 shrink-0 cursor-pointer"
              >
                <Star
                  className={`w-3.5 h-3.5 transition-colors ${
                    effectiveDefaultMode === 'ollama'
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-slate-600 group-hover:text-slate-400 hover:!text-amber-400'
                  }`}
                />
              </span>
            </div>
            <span className="text-[10px] text-slate-500">localhost:11434</span>
          </button>

          {/* External MCP Client (Universal MCP) */}
          <button
            onClick={() => onSelectMode('mcp_external')}
            className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all relative group ${
              currentMode === 'mcp_external'
                ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                : 'bg-[#121418] border-darkBorder/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 text-xs font-bold truncate">
                <Radio className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">External MCP</span>
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => handleMakeDefault('mcp_external', e)}
                onKeyDown={(e) => e.key === 'Enter' && handleMakeDefault('mcp_external', e as any)}
                title={effectiveDefaultMode === 'mcp_external' ? 'Aktueller Standard-Provider' : 'Als Standard festlegen'}
                className="p-0.5 rounded hover:bg-slate-800 transition-transform hover:scale-125 shrink-0 cursor-pointer"
              >
                <Star
                  className={`w-3.5 h-3.5 transition-colors ${
                    effectiveDefaultMode === 'mcp_external'
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-slate-600 group-hover:text-slate-400 hover:!text-amber-400'
                  }`}
                />
              </span>
            </div>
            <span className={`text-[10px] ${isMcpConnected ? 'text-emerald-400 font-medium' : 'text-slate-500'}`}>
              {isMcpConnected ? '🟢 Verbunden' : '⚪ Wartet auf Client'}
            </span>
          </button>
        </div>

        {/* Universal MCP Client Configuration Modal */}
        {isMcpModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#14161d] border border-darkBorder rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
              {/* Modal Header */}
              <div className="px-4 py-3 border-b border-darkBorder flex items-center justify-between bg-[#181b24]">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-bold text-slate-100">
                    Universal MCP Client verbinden (stdio & SSE 48124)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMcpModalOpen(false)}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Tabs */}
              <div className="px-4 pt-3 border-b border-darkBorder/70 bg-[#12141a] flex gap-2">
                {[
                  { id: 'claude_desktop' as const, label: 'Claude Desktop' },
                  { id: 'cursor' as const, label: 'Cursor IDE' },
                  { id: 'vscode_custom' as const, label: 'VS Code / Custom JSON' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setMcpModalTab(tab.id);
                      setInstallStatus({ status: 'idle', message: '' });
                    }}
                    className={`px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-all ${
                      mcpModalTab === tab.id
                        ? 'border-blue-500 text-blue-300 bg-[#181b24]'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Modal Body */}
              <div className="p-4 flex flex-col gap-3 text-xs">
                <div className="flex flex-col gap-1">
                  <span className="text-slate-400">Ziel-Konfigurationsdatei:</span>
                  <code className="text-[11px] font-mono text-blue-300 bg-[#0d0f14] px-2.5 py-1.5 rounded border border-darkBorder/60 select-text">
                    {currentMcpBlock.fileHint}
                  </code>
                </div>

                {mcpModalTab === 'vscode_custom' && (
                  <div className="flex flex-col gap-1">
                    <span className="text-slate-400">Optionaler eigener Dateipfad für Direkt-Installation:</span>
                    <input
                      type="text"
                      value={customConfigPath}
                      onChange={(e) => setCustomConfigPath(e.target.value)}
                      placeholder="~/.gemini/config/mcp_config.json oder ~/Library/Application Support/Code/User/mcp.json"
                      className="bg-[#0d0f14] border border-darkBorder px-2.5 py-1.5 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">JSON-Konfigurationsblock:</span>
                    <button
                      type="button"
                      onClick={copyConfig}
                      className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'JSON kopiert!' : 'JSON kopieren'}</span>
                    </button>
                  </div>
                  <pre className="bg-[#0b0d12] border border-darkBorder/80 rounded-lg p-3 font-mono text-[11px] text-emerald-300 overflow-x-auto select-text">
                    {currentMcpBlock.json}
                  </pre>
                </div>

                {installStatus.status !== 'idle' && (
                  <div
                    className={`p-2.5 rounded border flex items-center gap-2 text-xs select-text ${
                      installStatus.status === 'success'
                        ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                        : installStatus.status === 'error'
                        ? 'bg-rose-950/50 border-rose-500/40 text-rose-200'
                        : 'bg-blue-950/40 border-blue-500/30 text-blue-200'
                    }`}
                  >
                    {installStatus.status === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : installStatus.status === 'error' ? (
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    ) : (
                      <RefreshCw className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                    )}
                    <span>{installStatus.message}</span>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-4 py-3 border-t border-darkBorder bg-[#101218] flex items-center justify-between">
                <button
                  type="button"
                  onClick={copyConfig}
                  className="px-3 py-1.5 rounded border border-darkBorder bg-[#1a1d26] hover:bg-[#232733] text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Kopiert!' : 'In Zwischenablage kopieren'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleInstallMcpConfig}
                    disabled={installStatus.status === 'installing'}
                    className="px-3.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>In Datei installieren</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsMcpModalOpen(false)}
                    className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                  >
                    Schließen
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

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
                      <div className="flex items-center gap-2">
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
                            <option key={m.id} value={m.id} title={m.description}>
                              {m.name}
                            </option>
                          ))}
                          <option value="__custom__">+ Manuelles Modell...</option>
                        </select>
                        {(() => {
                          const activeDesc = availableModels.find((m) => m.id === modelName)?.description;
                          return activeDesc ? (
                            <span className="text-[11px] text-slate-400 font-sans hidden md:inline-block max-w-[280px] truncate" title={activeDesc}>
                              {activeDesc}
                            </span>
                          ) : null;
                        })()}
                      </div>
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


