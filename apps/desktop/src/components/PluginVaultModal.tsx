import React from 'react';
import {
  Sparkles,
  CheckCircle2,
  Trash2,
  X,
  Database,
  Sliders,
  Lock,
  FolderOpen
} from 'lucide-react';

export interface LearnedPluginParam {
  id: string;
  name: string;
  role: string;
  identifier?: string;
  description?: string;
  rawMin: number;
  rawMax: number;
  displayMin: number;
  displayMax: number;
  unit: string;
  valueDescription?: string;
}

export interface LearnedPluginSpec {
  schemaVersion: string;
  pluginName: string;
  windowTitle?: string;
  category: string;
  slug?: string;
  filePath?: string;
  parameters: LearnedPluginParam[];
}

export interface PluginSummaryItem {
  slug: string;
  pluginName: string;
  category: string;
  parameterCount: number;
  isBuiltIn: boolean;
  filePath?: string;
}

interface PluginVaultModalProps {
  isOpen: boolean;
  mode: 'confirm_learn' | 'vault_drawer';
  learnedSpec: LearnedPluginSpec | null;
  vaultPlugins: PluginSummaryItem[];
  isLearning: boolean;
  learnError: string | null;
  onClose: () => void;
  onConfirmSave: () => void;
  onDeletePlugin: (slug: string) => void;
  onTriggerLearnNew: () => void;
}

export const PluginVaultModal: React.FC<PluginVaultModalProps> = ({
  isOpen,
  mode,
  learnedSpec,
  vaultPlugins,
  isLearning,
  learnError,
  onClose,
  onConfirmSave,
  onDeletePlugin,
  onTriggerLearnNew
}) => {
  if (!isOpen) return null;

  const getCategoryBadge = (cat: string) => {
    const c = cat.toLowerCase();
    if (c === 'eq') {
      return 'bg-blue-950/70 text-blue-300 border-blue-500/30';
    }
    if (c === 'dynamics') {
      return 'bg-amber-950/70 text-amber-300 border-amber-500/30';
    }
    if (c === 'saturation') {
      return 'bg-rose-950/70 text-rose-300 border-rose-500/30';
    }
    return 'bg-slate-800 text-slate-300 border-slate-600/40';
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#14161d] border border-darkBorder rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-darkBorder flex items-center justify-between bg-[#181b24]">
          <div className="flex items-center gap-2">
            {mode === 'confirm_learn' ? (
              <Sparkles className="w-4 h-4 text-emerald-400" />
            ) : (
              <Database className="w-4 h-4 text-blue-400" />
            )}
            <h3 className="text-sm font-bold text-slate-100">
              {mode === 'confirm_learn'
                ? '✨ Plugin-Auto-Profiler — Scan-Ergebnis'
                : 'Plugin Vault (Benutzer-Bibliothek)'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-4 text-xs select-text">
          {mode === 'confirm_learn' ? (
            <>
              {isLearning && (
                <div className="p-6 flex flex-col items-center justify-center gap-3 text-center">
                  <Sparkles className="w-7 h-7 text-blue-400 animate-spin" />
                  <div className="text-sm font-semibold text-slate-200">
                    Scanne geöffnetes Plugin-Fenster in Logic Pro...
                  </div>
                  <p className="text-slate-400 text-xs max-w-md">
                    Die native Swift AXUIElement-Bridge analysiert alle Regler, Buttons und Wertebereiche in Echtzeit.
                  </p>
                </div>
              )}

              {!isLearning && learnError && (
                <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-200 flex flex-col gap-2">
                  <div className="font-bold text-xs">Scan fehlgeschlagen</div>
                  <p className="font-mono text-[11px]">{learnError}</p>
                </div>
              )}

              {!isLearning && learnedSpec && (
                <div className="flex flex-col gap-3">
                  <div className="p-3.5 rounded-lg bg-emerald-950/30 border border-emerald-500/40 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                      <div>
                        <div className="text-sm font-bold text-white">
                          {learnedSpec.pluginName}
                        </div>
                        <div className="text-[11px] text-emerald-300 font-medium">
                          {learnedSpec.parameters.length} Parameter erfasst • Kategorie:{' '}
                          <span className="uppercase">{learnedSpec.category}</span>
                        </div>
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase border ${getCategoryBadge(
                        learnedSpec.category
                      )}`}
                    >
                      {learnedSpec.category}
                    </span>
                  </div>

                  {learnedSpec.filePath && (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono bg-[#0d0f14] px-3 py-1.5 rounded border border-darkBorder/60">
                      <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span>Gespeichert unter: {learnedSpec.filePath}</span>
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <span className="text-slate-400 font-semibold">
                      Erkannte Steuer-Parameter ({learnedSpec.parameters.length}):
                    </span>
                    <div className="max-h-60 overflow-y-auto border border-darkBorder/70 rounded-lg divide-y divide-darkBorder/40 bg-[#0d0f14]">
                      {learnedSpec.parameters.map((param) => (
                        <div
                          key={param.id}
                          className="px-3 py-2 flex items-center justify-between text-[11px]"
                        >
                          <div className="flex items-center gap-2">
                            <Sliders className="w-3 h-3 text-blue-400 shrink-0" />
                            <span className="font-semibold text-slate-200">{param.name}</span>
                            {param.identifier && (
                              <span className="font-mono text-[10px] text-slate-500">
                                ({param.identifier})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 font-mono text-[10px] text-slate-400">
                            <span>{param.role}</span>
                            <span className="text-slate-600">•</span>
                            <span className="text-emerald-400">
                              {param.displayMin}..{param.displayMax} {param.unit}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-slate-400 text-xs">
                  Alle hier gespeicherten Plugins (`~/.mixing-buddy/plugins/`) stehen dem AI Co-Producer und MCP-Server dauerhaft zur Verfügung.
                </p>
                <button
                  type="button"
                  onClick={onTriggerLearnNew}
                  disabled={isLearning}
                  className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors shadow"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>✨ Aktives Plugin scannen</span>
                </button>
              </div>

              <div className="border border-darkBorder/80 rounded-lg divide-y divide-darkBorder/50 bg-[#0d0f14]">
                {vaultPlugins.map((item) => (
                  <div
                    key={item.slug}
                    className="p-3 flex items-center justify-between hover:bg-[#141720] transition-colors"
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-100 text-xs">
                          {item.pluginName}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${getCategoryBadge(
                            item.category
                          )}`}
                        >
                          {item.category}
                        </span>
                        {item.isBuiltIn && (
                          <span className="flex items-center gap-1 text-[10px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded">
                            <Lock className="w-2.5 h-2.5" /> Stock Preset
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {item.parameterCount} Parameter registriert
                        {item.filePath ? ` • ${item.filePath}` : ''}
                      </div>
                    </div>

                    {!item.isBuiltIn && (
                      <button
                        type="button"
                        onClick={() => onDeletePlugin(item.slug)}
                        title="Plugin aus der Bibliothek löschen"
                        className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-darkBorder bg-[#101218] flex items-center justify-end gap-2">
          {mode === 'confirm_learn' && learnedSpec && !isLearning ? (
            <button
              type="button"
              onClick={onConfirmSave}
              className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Dauerhaft speichern</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
};
