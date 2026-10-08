import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  CheckCircle2,
  Trash2,
  X,
  Database,
  Sliders,
  Lock,
  FolderOpen,
  Search,
  Plus,
  Tag
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

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
  tags?: string[];
  slug?: string;
  filePath?: string;
  parameters: LearnedPluginParam[];
}

export interface PluginSummaryItem {
  slug: string;
  pluginName: string;
  category: string;
  tags: string[];
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
  onTagsUpdated?: (slug: string, tags: string[]) => void;
}

function getTagStyle(tag: string): string {
  const t = tag.toUpperCase();
  if (t === 'EQ')          return 'bg-blue-950/70 text-blue-300 border-blue-500/40';
  if (t === 'DYNAMICS')    return 'bg-amber-950/70 text-amber-300 border-amber-500/40';
  if (t === 'COMPRESSOR')  return 'bg-amber-900/60 text-amber-200 border-amber-400/40';
  if (t === 'LIMITER')     return 'bg-orange-950/70 text-orange-300 border-orange-500/40';
  if (t === 'SATURATION')  return 'bg-rose-950/70 text-rose-300 border-rose-500/40';
  if (t === 'COLOR')       return 'bg-red-950/70 text-red-300 border-red-500/40';
  if (t === 'REVERB')      return 'bg-purple-950/70 text-purple-300 border-purple-500/40';
  if (t === 'DELAY')       return 'bg-cyan-950/70 text-cyan-300 border-cyan-500/40';
  if (t === 'MODULATION')  return 'bg-pink-950/70 text-pink-300 border-pink-500/40';
  if (t === 'STOCK')       return 'bg-slate-800/80 text-slate-400 border-slate-600/40';
  if (t === 'UTILITY')     return 'bg-slate-800/60 text-slate-400 border-slate-600/30';
  return 'bg-indigo-950/60 text-indigo-300 border-indigo-500/30';
}

function collectAllTags(plugins: PluginSummaryItem[]): string[] {
  const set = new Set<string>();
  for (const p of plugins) {
    for (const t of (p.tags ?? [])) set.add(t.toUpperCase());
  }
  return Array.from(set).sort();
}

interface TagEditorProps {
  slug: string;
  tags: string[];
  isBuiltIn: boolean;
  onTagsChange: (slug: string, newTags: string[]) => void;
}

const TagEditor: React.FC<TagEditorProps> = ({ slug, tags, isBuiltIn, onTagsChange }) => {
  const [addMode, setAddMode] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  const persist = async (nextTags: string[]) => {
    setSaving(true);
    try {
      try {
        await invoke('update_plugin_tags', { slug, tags: nextTags });
      } catch {
        await fetch('http://127.0.0.1:48123/api/vault/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, tags: nextTags })
        });
      }
      onTagsChange(slug, nextTags);
    } catch (err) {
      console.error('Tag update failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const removeTag = (tag: string) => {
    if (isBuiltIn) return;
    persist((tags ?? []).filter((t) => t !== tag));
  };

  const addTag = () => {
    const trimmed = newTagInput.trim().toUpperCase();
    if (!trimmed || (tags ?? []).includes(trimmed)) {
      setNewTagInput('');
      setAddMode(false);
      return;
    }
    persist([...(tags ?? []), trimmed]);
    setNewTagInput('');
    setAddMode(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {(tags ?? []).map((tag) => (
        <span
          key={tag}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${getTagStyle(tag)} ${saving ? 'opacity-50' : ''}`}
        >
          {tag}
          {!isBuiltIn && (
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="ml-0.5 opacity-60 hover:opacity-100 hover:text-rose-400 transition-opacity"
              title={`Tag "${tag}" entfernen`}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </span>
      ))}
      {!isBuiltIn && (
        addMode ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTag();
                if (e.key === 'Escape') { setAddMode(false); setNewTagInput(''); }
              }}
              placeholder="TAG"
              className="w-20 bg-[#1a1c22] border border-blue-500/60 rounded px-1.5 py-0.5 text-[10px] text-slate-100 font-mono uppercase focus:outline-none"
            />
            <button type="button" onClick={addTag} className="p-0.5 rounded text-emerald-400 hover:text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => { setAddMode(false); setNewTagInput(''); }} className="p-0.5 rounded text-slate-400 hover:text-slate-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAddMode(true)}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-slate-500 border border-slate-700/60 hover:border-blue-500/50 hover:text-blue-400 transition-colors"
          >
            <Plus className="w-2.5 h-2.5" />
            <span>Tag</span>
          </button>
        )
      )}
    </div>
  );
};

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
  onTriggerLearnNew,
  onTagsUpdated
}) => {
  // ── ALL HOOKS MUST BE BEFORE ANY CONDITIONAL RETURN ──
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilterTag, setActiveFilterTag] = useState<string | null>(null);
  const [tagOverrides, setTagOverrides] = useState<Record<string, string[]>>({});

  const enrichedPlugins: PluginSummaryItem[] = useMemo(
    () =>
      vaultPlugins.map((p) => ({
        ...p,
        tags: tagOverrides[p.slug] ?? p.tags ?? []
      })),
    [vaultPlugins, tagOverrides]
  );

  const allTags = useMemo(() => collectAllTags(enrichedPlugins), [enrichedPlugins]);

  const filteredPlugins = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return enrichedPlugins.filter((p) => {
      const matchesSearch =
        !q ||
        p.pluginName.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.tags ?? []).some((t) => t.toLowerCase().includes(q));
      const matchesTag =
        !activeFilterTag || (p.tags ?? []).some((t) => t.toUpperCase() === activeFilterTag);
      return matchesSearch && matchesTag;
    });
  }, [enrichedPlugins, searchQuery, activeFilterTag]);

  // ── CONDITIONAL RENDER AFTER ALL HOOKS ──
  if (!isOpen) return null;

  const handleTagsChange = (slug: string, newTags: string[]) => {
    setTagOverrides((prev) => ({ ...prev, [slug]: newTags }));
    onTagsUpdated?.(slug, newTags);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#14161d] border border-darkBorder rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[88vh]">

        {/* Header */}
        <div className="px-4 py-3 border-b border-darkBorder flex items-center justify-between bg-[#181b24] shrink-0">
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
          <button type="button" onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search + Filter chips (vault mode only) */}
        {mode === 'vault_drawer' && (
          <div className="px-4 pt-3 pb-2 border-b border-darkBorder/60 bg-[#161820] flex flex-col gap-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Plugins nach Name, Tag oder Kategorie suchen..."
                className="w-full bg-[#1a1c22] border border-darkBorder rounded pl-8 pr-8 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/60 transition-colors"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setActiveFilterTag(null)}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
                  activeFilterTag === null
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-transparent text-slate-400 border-slate-600/50 hover:border-blue-500/50 hover:text-blue-400'
                }`}
              >
                Alle ({enrichedPlugins.length})
              </button>
              {allTags.map((tag) => {
                const count = enrichedPlugins.filter((p) => (p.tags ?? []).some((t) => t.toUpperCase() === tag)).length;
                const isActive = activeFilterTag === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setActiveFilterTag(isActive ? null : tag)}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold border uppercase transition-all ${getTagStyle(tag)} ${isActive ? 'ring-1 ring-white/30 opacity-100' : 'opacity-60 hover:opacity-100'}`}
                  >
                    {tag} ({count})
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-4 text-xs select-text">
          {mode === 'confirm_learn' ? (
            <>
              {isLearning && (
                <div className="p-6 flex flex-col items-center justify-center gap-3 text-center">
                  <Sparkles className="w-7 h-7 text-blue-400 animate-spin" />
                  <div className="text-sm font-semibold text-slate-200">Scanne geöffnetes Plugin-Fenster in Logic Pro...</div>
                  <p className="text-slate-400 text-xs max-w-md">Die native Swift AXUIElement-Bridge analysiert alle Regler, Buttons und Wertebereiche in Echtzeit.</p>
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
                        <div className="text-sm font-bold text-white">{learnedSpec.pluginName}</div>
                        <div className="text-[11px] text-emerald-300 font-medium">
                          {learnedSpec.parameters.length} Parameter • Kategorie: <span className="uppercase">{learnedSpec.category}</span>
                        </div>
                        {learnedSpec.tags && learnedSpec.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {learnedSpec.tags.map((tag) => (
                              <span key={tag} className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${getTagStyle(tag)}`}>{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase border ${getTagStyle(learnedSpec.category)}`}>
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
                    <span className="text-slate-400 font-semibold">Erkannte Steuer-Parameter ({learnedSpec.parameters.length}):</span>
                    <div className="max-h-60 overflow-y-auto border border-darkBorder/70 rounded-lg divide-y divide-darkBorder/40 bg-[#0d0f14]">
                      {learnedSpec.parameters.map((param) => (
                        <div key={param.id} className="px-3 py-2 flex items-center justify-between text-[11px]">
                          <div className="flex items-center gap-2">
                            <Sliders className="w-3 h-3 text-blue-400 shrink-0" />
                            <span className="font-semibold text-slate-200">{param.name}</span>
                            {param.identifier && <span className="font-mono text-[10px] text-slate-500">({param.identifier})</span>}
                          </div>
                          <div className="flex items-center gap-2 font-mono text-[10px] text-slate-400">
                            <span>{param.role}</span>
                            <span className="text-slate-600">•</span>
                            <span className="text-emerald-400">{param.displayMin}..{param.displayMax} {param.unit}</span>
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
                <p className="text-slate-400 text-xs">Alle hier gespeicherten Plugins stehen dem AI Co-Producer dauerhaft zur Verfügung.</p>
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

              {filteredPlugins.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-slate-500">
                  <Tag className="w-6 h-6 opacity-30" />
                  <span className="text-xs">
                    {searchQuery || activeFilterTag ? 'Keine Plugins gefunden für diesen Filter.' : 'Noch keine Plugins im Vault.'}
                  </span>
                </div>
              )}

              <div className="border border-darkBorder/80 rounded-lg divide-y divide-darkBorder/50 bg-[#0d0f14]">
                {filteredPlugins.map((item) => (
                  <div key={item.slug} className="p-3 flex items-start justify-between hover:bg-[#141720] transition-colors gap-3">
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-100 text-xs">{item.pluginName}</span>
                        {item.isBuiltIn && (
                          <span className="flex items-center gap-1 text-[10px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded">
                            <Lock className="w-2.5 h-2.5" /> Stock Preset
                          </span>
                        )}
                      </div>
                      <TagEditor slug={item.slug} tags={item.tags ?? []} isBuiltIn={item.isBuiltIn} onTagsChange={handleTagsChange} />
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {item.parameterCount} Parameter{item.filePath ? ` • ${item.filePath}` : ''}
                      </div>
                    </div>
                    {!item.isBuiltIn && (
                      <button
                        type="button"
                        onClick={() => onDeletePlugin(item.slug)}
                        title="Plugin aus der Bibliothek löschen"
                        className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors shrink-0 mt-0.5"
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
        <div className="px-4 py-3 border-t border-darkBorder bg-[#101218] flex items-center justify-end gap-2 shrink-0">
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
