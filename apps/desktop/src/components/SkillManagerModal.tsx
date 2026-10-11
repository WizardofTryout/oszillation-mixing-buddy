import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  MixingSkill,
  MixingSkillSummary,
  SkillCategory,
  SlotType
} from '@mixing-buddy/shared-types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Star,
  Sparkles,
  Plus,
  Search,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  X,
  Activity,
  Wrench,
  Rocket,
  Layers,
  History,
  CheckCircle2
} from 'lucide-react';

interface SkillManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSkill?: (skill: MixingSkill) => void;
  onStartSynthesisWizard?: () => void;
}

const CATEGORY_COLORS: Record<SkillCategory, { badge: string; border: string; text: string }> = {
  master: {
    badge: 'bg-purple-950/70 border-purple-500/40 text-purple-300',
    border: 'hover:border-purple-500/50',
    text: 'text-purple-400'
  },
  vocal: {
    badge: 'bg-rose-950/70 border-rose-500/40 text-rose-300',
    border: 'hover:border-rose-500/50',
    text: 'text-rose-400'
  },
  drums: {
    badge: 'bg-amber-950/70 border-amber-500/40 text-amber-300',
    border: 'hover:border-amber-500/50',
    text: 'text-amber-400'
  },
  bass: {
    badge: 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300',
    border: 'hover:border-emerald-500/50',
    text: 'text-emerald-400'
  },
  general: {
    badge: 'bg-slate-800/80 border-slate-600/40 text-slate-300',
    border: 'hover:border-slate-500/50',
    text: 'text-slate-400'
  }
};

const SLOT_TYPE_LABELS: Record<SlotType, { label: string; color: string }> = {
  utility: { label: 'Utility', color: 'bg-slate-800 text-slate-300 border-slate-700' },
  eq: { label: 'EQ', color: 'bg-blue-950/80 text-blue-300 border-blue-600/40' },
  dynamics: { label: 'Dynamics', color: 'bg-amber-950/80 text-amber-300 border-amber-600/40' },
  saturation: { label: 'Saturation', color: 'bg-rose-950/80 text-rose-300 border-rose-600/40' },
  space: { label: 'Space', color: 'bg-purple-950/80 text-purple-300 border-purple-600/40' }
};

export const SkillManagerModal: React.FC<SkillManagerModalProps> = ({
  isOpen,
  onClose,
  onSelectSkill,
  onStartSynthesisWizard
}) => {
  // Vault state
  const [skills, setSkills] = useState<MixingSkill[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'favorites' | 'custom' | SkillCategory>('all');

  // UI interaction state
  const [expandedHistories, setExpandedHistories] = useState<Record<string, boolean>>({});
  const [activePromptTab, setActivePromptTab] = useState<Record<string, 'quickstart' | 'workshop'>>({});
  const [copiedSkillId, setCopiedSkillId] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  // Edit / Create state
  const [editingSkill, setEditingSkill] = useState<MixingSkill | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);

  // Load all skills from Rust vault
  const loadSkills = useCallback(async () => {
    try {
      setIsLoading(true);
      const summaries = await invoke<MixingSkillSummary[]>('list_mixing_skills');
      if (Array.isArray(summaries)) {
        // Fetch full definitions for rich card rendering
        const fullSkills = await Promise.all(
          summaries.map(async (s) => {
            try {
              return await invoke<MixingSkill>('get_mixing_skill', { id: s.id });
            } catch {
              return null;
            }
          })
        );
        setSkills(fullSkills.filter((s): s is MixingSkill => s !== null));
      }
    } catch (err) {
      console.error('Failed to load mixing skills from vault', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadSkills();
    }

    let unlisten: (() => void) | undefined;
    listen('skill-vault-updated', () => {
      loadSkills();
    }).then((unsub) => {
      unlisten = unsub;
    }).catch(console.warn);

    return () => {
      if (unlisten) unlisten();
    };
  }, [isOpen, loadSkills]);

  // Toggle favorite star
  const handleToggleFavorite = async (skill: MixingSkill, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated: MixingSkill = {
        ...skill,
        isFavorite: !skill.isFavorite,
        updatedAt: Date.now()
      };
      await invoke('save_mixing_skill', { skill: updated });
      await loadSkills();
    } catch (err) {
      console.error('Failed to toggle favorite', err);
    }
  };

  // Delete skill
  const handleDeleteSkill = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Skill '${id}' wirklich unwiderruflich löschen?`)) {
      return;
    }
    try {
      await invoke('delete_mixing_skill', { id });
      setNotification(`Skill '${id}' gelöscht.`);
      setTimeout(() => setNotification(null), 3000);
      await loadSkills();
    } catch (err) {
      console.error('Failed to delete skill', err);
    }
  };

  // Copy prompt text
  const handleCopyPrompt = (skillId: string, text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedSkillId(skillId);
    setTimeout(() => setCopiedSkillId(null), 2000);
  };

  // Toggle revision history view
  const toggleHistory = (skillId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedHistories((prev) => ({
      ...prev,
      [skillId]: !prev[skillId]
    }));
  };

  // Open editor for a new or existing skill
  const handleOpenEditor = (skill?: MixingSkill) => {
    if (skill) {
      setEditingSkill(JSON.parse(JSON.stringify(skill)));
    } else {
      // New Skill Template
      setEditingSkill({
        id: `custom-skill-${Date.now().toString().slice(-4)}`,
        name: 'Neuer Custom Mixing Skill',
        category: 'general',
        isFavorite: false,
        version: 'v1.0',
        revisionHistory: [
          {
            version: 'v1.0',
            timestamp: new Date().toISOString(),
            comment: 'Initialer Entwurf'
          }
        ],
        metrologyTargets: {
          integratedLufs: -14.0,
          toleranceLufs: 1.0,
          crestFactor: { min: 9.0, max: 12.0 },
          maxTruePeakDb: -1.0,
          recommendedHeadroomDb: 1.5
        },
        preferredChain: [
          {
            slotType: 'eq',
            preferredPluginHint: 'Channel EQ',
            typicalRules: ['Sub-Bass Clean Cut bei 30 Hz', 'Präsenz-Anhebung bei 3 kHz']
          },
          {
            slotType: 'dynamics',
            preferredPluginHint: 'Compressor',
            typicalRules: ['Sanfte 2:1 Kompression für gleichmäßige Dynamik']
          }
        ],
        prompts: {
          quickstart: 'Optimiere den Mix nach modernem Studio-Standard mit präzisem EQ und transparenter Dynamikkontrolle.',
          workshop: 'Führe eine gründliche akustische Analyse durch: Prüfe Maskierungseffekte, Crest-Faktor und Phasenkorrelation.'
        },
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
    setIsEditorOpen(true);
  };

  // Save edited skill
  const handleSaveEditor = async () => {
    if (!editingSkill) return;
    try {
      await invoke('save_mixing_skill', { skill: editingSkill });
      setIsEditorOpen(false);
      setEditingSkill(null);
      setNotification(`Skill '${editingSkill.name}' erfolgreich im Vault gespeichert.`);
      setTimeout(() => setNotification(null), 3500);
      await loadSkills();
    } catch (err) {
      console.error('Failed to save skill', err);
      alert(`Fehler beim Speichern des Skills: ${err}`);
    }
  };

  // Filter & Search Logic
  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      // Search
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        skill.name.toLowerCase().includes(q) ||
        skill.id.toLowerCase().includes(q) ||
        skill.category.toLowerCase().includes(q) ||
        skill.preferredChain.some((c) =>
          (c.preferredPluginHint || '').toLowerCase().includes(q) ||
          c.typicalRules.some((r) => r.toLowerCase().includes(q))
        );

      if (!matchesSearch) return false;

      // Filter chips
      if (activeFilter === 'all') return true;
      if (activeFilter === 'favorites') return skill.isFavorite;
      if (activeFilter === 'custom') return skill.id !== 'tonmischmeister';
      return skill.category === activeFilter;
    });
  }, [skills, searchQuery, activeFilter]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-[#12151b] border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col w-full max-w-6xl max-h-[92vh] overflow-hidden">
        {/* Header Toolbar */}
        <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 bg-[#151922]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Star className="w-5 h-5 fill-amber-400/20" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100 tracking-wide uppercase">
                  Mixing Skill Vault & Manager
                </h2>
                <span className="text-xs bg-slate-800 border border-slate-700 text-slate-400 font-mono px-2 py-0.5 rounded-full">
                  {skills.length} {skills.length === 1 ? 'Skill' : 'Skills'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Maßgeschneiderte Klangphilosophien, Target-Kurven & psychoakustische Regelketten
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => handleOpenEditor()}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs px-3 py-1.5 rounded-lg transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Neuen Skill erstellen</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (onStartSynthesisWizard) {
                  onStartSynthesisWizard();
                } else {
                  setNotification('🚀 KI-Skill-Synthese Wizard startet in Step 5.3!');
                  setTimeout(() => setNotification(null), 3000);
                }
              }}
              className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-500/40 text-amber-300 font-medium text-xs px-3 py-1.5 rounded-lg transition-all shadow-sm active:scale-95 cursor-pointer"
              title="Generiert automatisch einen neuen Skill aus deinen DAW-Aktionen und Live-Telemetrien"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>🚀 KI-Skill-Synthese Wizard</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Notification Toast */}
        {notification && (
          <div className="bg-amber-950/80 border-b border-amber-500/40 px-6 py-2 text-xs text-amber-200 flex items-center justify-between animate-in fade-in duration-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-amber-400" />
              <span>{notification}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotification(null)}
              className="text-amber-400 hover:text-amber-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Filter Bar & Search */}
        <div className="px-6 py-3 border-b border-slate-800/80 bg-[#13161e] flex flex-wrap items-center justify-between gap-3">
          {/* Filter Chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                activeFilter === 'all'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              ✨ Alle Skills ({skills.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('favorites')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                activeFilter === 'favorites'
                  ? 'bg-amber-500/20 border border-amber-500/50 text-amber-300 shadow-sm'
                  : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Star className="w-3 h-3 text-amber-400 fill-amber-400/40" />
              <span>Favoriten ({skills.filter((s) => s.isFavorite).length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('custom')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                activeFilter === 'custom'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              ⚡ Eigene Versionen ({skills.filter((s) => s.id !== 'tonmischmeister').length})
            </button>

            <span className="text-slate-700 mx-1">|</span>

            {(['master', 'vocal', 'drums', 'bass', 'general'] as SkillCategory[]).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveFilter(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium uppercase text-[10px] tracking-wider transition-all ${
                  activeFilter === cat
                    ? CATEGORY_COLORS[cat].badge
                    : 'bg-slate-800/40 text-slate-400 hover:text-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[240px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Skill, Plugin oder Regel suchen..."
              className="w-full bg-[#181d27] border border-slate-700/80 rounded-lg pl-9 pr-3 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#0f1217]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <span className="animate-spin text-3xl mb-3">⏳</span>
              <p className="text-xs">Lade Mixing Skills aus dem Vault...</p>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-800 rounded-xl p-8">
              <Sparkles className="w-10 h-10 text-slate-600 mb-3" />
              <h3 className="text-sm font-semibold text-slate-300">Keine Skills gefunden</h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">
                Passe deine Filterkriterien an oder erstelle einen neuen individuellen Mixing Skill.
              </p>
              <button
                type="button"
                onClick={() => handleOpenEditor()}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs px-3 py-1.5 rounded-lg shadow"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Jetzt ersten eigenen Skill erstellen</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSkills.map((skill) => {
                const colors = CATEGORY_COLORS[skill.category] || CATEGORY_COLORS.general;
                const isHistoryExpanded = !!expandedHistories[skill.id];
                const currentPromptTab = activePromptTab[skill.id] || 'quickstart';
                const promptContent =
                  currentPromptTab === 'quickstart' ? skill.prompts.quickstart : skill.prompts.workshop;

                return (
                  <div
                    key={skill.id}
                    className={`bg-[#151922] border border-slate-800 rounded-xl p-4.5 transition-all shadow-lg flex flex-col justify-between hover:shadow-xl hover:border-slate-700/80 ${colors.border} relative group`}
                  >
                    {/* Top Row: Category, Title & Favorite */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${colors.badge}`}
                        >
                          {skill.category}
                        </span>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => handleToggleFavorite(skill, e)}
                            className="p-1 text-slate-500 hover:text-amber-400 rounded transition-colors"
                            title={skill.isFavorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
                          >
                            <Star
                              className={`w-4 h-4 ${
                                skill.isFavorite
                                  ? 'text-amber-400 fill-amber-400'
                                  : 'text-slate-600 hover:text-amber-300'
                              }`}
                            />
                          </button>

                          {skill.id !== 'tonmischmeister' && (
                            <button
                              type="button"
                              onClick={(e) => handleDeleteSkill(skill.id, e)}
                              className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors opacity-40 group-hover:opacity-100"
                              title="Skill löschen"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <h3 className="text-sm font-bold text-slate-100 leading-snug">
                        {skill.name}
                      </h3>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        ID: {skill.id}
                      </div>

                      {/* Metrology Target Badges */}
                      <div className="grid grid-cols-2 gap-1.5 my-3">
                        <div className="bg-[#10131a] border border-slate-800 rounded p-1.5 flex flex-col">
                          <span className="text-[9px] uppercase font-bold text-slate-500">Target LUFS</span>
                          <span className="text-xs font-mono font-bold text-teal-300">
                            {skill.metrologyTargets.integratedLufs.toFixed(1)} LUFS
                            <span className="text-[10px] text-slate-500 font-normal ml-0.5">
                              (±{skill.metrologyTargets.toleranceLufs})
                            </span>
                          </span>
                        </div>

                        <div className="bg-[#10131a] border border-slate-800 rounded p-1.5 flex flex-col">
                          <span className="text-[9px] uppercase font-bold text-slate-500">Crest Factor</span>
                          <span className="text-xs font-mono font-bold text-amber-300">
                            {skill.metrologyTargets.crestFactor.min}–{skill.metrologyTargets.crestFactor.max} dB
                          </span>
                        </div>

                        <div className="bg-[#10131a] border border-slate-800 rounded p-1.5 flex flex-col">
                          <span className="text-[9px] uppercase font-bold text-slate-500">Max True Peak</span>
                          <span className="text-xs font-mono font-bold text-rose-300">
                            {skill.metrologyTargets.maxTruePeakDb.toFixed(1)} dBTP
                          </span>
                        </div>

                        <div className="bg-[#10131a] border border-slate-800 rounded p-1.5 flex flex-col">
                          <span className="text-[9px] uppercase font-bold text-slate-500">Headroom</span>
                          <span className="text-xs font-mono font-bold text-indigo-300">
                            {skill.metrologyTargets.recommendedHeadroomDb.toFixed(1)} dB
                          </span>
                        </div>
                      </div>

                      {/* Preferred Chain Slots */}
                      <div className="mb-3">
                        <div className="text-[10px] uppercase font-bold text-slate-400 mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1">
                            <Layers className="w-3 h-3 text-slate-500" />
                            Kette ({skill.preferredChain.length} Slots)
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-1">
                          {skill.preferredChain.map((slot, sIdx) => {
                            const badge = SLOT_TYPE_LABELS[slot.slotType] || SLOT_TYPE_LABELS.utility;
                            return (
                              <span
                                key={sIdx}
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${badge.color}`}
                                title={slot.typicalRules.join(' | ')}
                              >
                                {slot.preferredPluginHint ? `${badge.label}: ${slot.preferredPluginHint}` : badge.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Prompt Tabs: Schnellstart vs Werkstatt */}
                      <div className="bg-[#0f1218] border border-slate-800/80 rounded-lg p-2.5 mb-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1 bg-slate-900 rounded p-0.5 border border-slate-800">
                            <button
                              type="button"
                              onClick={() =>
                                setActivePromptTab((prev) => ({ ...prev, [skill.id]: 'quickstart' }))
                              }
                              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                                currentPromptTab === 'quickstart'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              <Rocket className="w-2.5 h-2.5" />
                              <span>🚀 Schnellstart</span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setActivePromptTab((prev) => ({ ...prev, [skill.id]: 'workshop' }))
                              }
                              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                                currentPromptTab === 'workshop'
                                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              <Wrench className="w-2.5 h-2.5" />
                              <span>🛠️ Werkstatt</span>
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => handleCopyPrompt(skill.id, promptContent, e)}
                            className="text-slate-500 hover:text-slate-200 text-[10px] flex items-center gap-1"
                            title="Prompt in Zwischenablage kopieren"
                          >
                            {copiedSkillId === skill.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Kopiert!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Kopieren</span>
                              </>
                            )}
                          </button>
                        </div>

                        <p className="text-[11px] text-slate-400 line-clamp-3 italic">
                          "{promptContent}"
                        </p>
                      </div>

                      {/* Revisions-Historie (aufklappbar) */}
                      <div className="border-t border-slate-800/80 pt-2 mb-2">
                        <button
                          type="button"
                          onClick={(e) => toggleHistory(skill.id, e)}
                          className="flex items-center justify-between w-full text-[11px] text-slate-400 hover:text-slate-200 py-0.5"
                        >
                          <span className="flex items-center gap-1 font-mono font-medium">
                            <History className="w-3 h-3 text-slate-500" />
                            Version: {skill.version} ({skill.revisionHistory.length} Revisions)
                          </span>
                          {isHistoryExpanded ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                        </button>

                        {isHistoryExpanded && (
                          <div className="mt-1.5 space-y-1.5 bg-[#0e1117] p-2 rounded border border-slate-800/80 text-[10px] font-mono">
                            {skill.revisionHistory.map((rev, rIdx) => (
                              <div key={rIdx} className="border-b border-slate-800/50 pb-1 last:border-none last:pb-0">
                                <div className="flex justify-between text-slate-300 font-bold">
                                  <span>{rev.version}</span>
                                  <span className="text-slate-500 font-normal">
                                    {new Date(rev.timestamp).toLocaleDateString()}
                                  </span>
                                </div>
                                <div className="text-slate-400 text-[9px] mt-0.5">{rev.comment}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card Footer Actions */}
                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => handleOpenEditor(skill)}
                        className="flex-1 flex items-center justify-center gap-1 bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-medium text-xs py-1.5 rounded-lg transition-all"
                      >
                        <Edit3 className="w-3 h-3 text-slate-400" />
                        <span>✏️ Bearbeiten</span>
                      </button>

                      {onSelectSkill && (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectSkill(skill);
                            onClose();
                          }}
                          className="flex-1 flex items-center justify-center gap-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-medium text-xs py-1.5 rounded-lg transition-all"
                        >
                          <Check className="w-3 h-3" />
                          <span>Aktivieren</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-[#13161e] border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Storage Vault: ~/.mixing-buddy/skills/</span>
          </div>
          <div>
            Drücke <kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 font-mono text-[10px]">ESC</kbd> zum Schließen
          </div>
        </div>
      </div>

      {/* Editor Drawer / Overlay for Creating or Editing a Skill */}
      {isEditorOpen && editingSkill && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="bg-[#141822] border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-[#171c28]">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-slate-200">
                  {editingSkill.id === 'tonmischmeister' ? 'Standard-Skill duplizieren / anpassen' : 'Mixing Skill bearbeiten'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs text-slate-300">
              {/* Basic Details */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Skill Name
                  </label>
                  <input
                    type="text"
                    value={editingSkill.name}
                    onChange={(e) => setEditingSkill({ ...editingSkill, name: e.target.value })}
                    className="w-full bg-[#1b212e] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Slug ID
                  </label>
                  <input
                    type="text"
                    value={editingSkill.id}
                    onChange={(e) => setEditingSkill({ ...editingSkill, id: e.target.value })}
                    className="w-full bg-[#1b212e] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Kategorie
                  </label>
                  <select
                    value={editingSkill.category}
                    onChange={(e) =>
                      setEditingSkill({ ...editingSkill, category: e.target.value as SkillCategory })
                    }
                    className="w-full bg-[#1b212e] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-400"
                  >
                    <option value="master">Master</option>
                    <option value="vocal">Vocal</option>
                    <option value="drums">Drums</option>
                    <option value="bass">Bass</option>
                    <option value="general">General</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Version
                  </label>
                  <input
                    type="text"
                    value={editingSkill.version}
                    onChange={(e) => setEditingSkill({ ...editingSkill, version: e.target.value })}
                    className="w-full bg-[#1b212e] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div className="flex items-center gap-2 pt-4">
                  <input
                    type="checkbox"
                    id="favoriteCheckbox"
                    checked={editingSkill.isFavorite}
                    onChange={(e) => setEditingSkill({ ...editingSkill, isFavorite: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-0"
                  />
                  <label htmlFor="favoriteCheckbox" className="text-xs text-slate-300 font-medium">
                    Als Favorit anpinnen
                  </label>
                </div>
              </div>

              {/* Metrology Targets */}
              <div className="border-t border-slate-800 pt-3">
                <h4 className="text-[10px] uppercase font-bold text-slate-400 mb-2 flex items-center gap-1">
                  <Activity className="w-3 h-3 text-teal-400" />
                  EBU R128 & Dynamik-Vorgaben
                </h4>
                <div className="grid grid-cols-4 gap-2.5 font-mono">
                  <div>
                    <label className="block text-[9px] text-slate-500 mb-0.5">Target LUFS</label>
                    <input
                      type="number"
                      step="0.5"
                      value={editingSkill.metrologyTargets.integratedLufs}
                      onChange={(e) =>
                        setEditingSkill({
                          ...editingSkill,
                          metrologyTargets: {
                            ...editingSkill.metrologyTargets,
                            integratedLufs: parseFloat(e.target.value) || -14.0
                          }
                        })
                      }
                      className="w-full bg-[#1b212e] border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] text-slate-500 mb-0.5">Toleranz (LU)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={editingSkill.metrologyTargets.toleranceLufs}
                      onChange={(e) =>
                        setEditingSkill({
                          ...editingSkill,
                          metrologyTargets: {
                            ...editingSkill.metrologyTargets,
                            toleranceLufs: parseFloat(e.target.value) || 1.0
                          }
                        })
                      }
                      className="w-full bg-[#1b212e] border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] text-slate-500 mb-0.5">Crest Min (dB)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={editingSkill.metrologyTargets.crestFactor.min}
                      onChange={(e) =>
                        setEditingSkill({
                          ...editingSkill,
                          metrologyTargets: {
                            ...editingSkill.metrologyTargets,
                            crestFactor: {
                              ...editingSkill.metrologyTargets.crestFactor,
                              min: parseFloat(e.target.value) || 9.0
                            }
                          }
                        })
                      }
                      className="w-full bg-[#1b212e] border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] text-slate-500 mb-0.5">Crest Max (dB)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={editingSkill.metrologyTargets.crestFactor.max}
                      onChange={(e) =>
                        setEditingSkill({
                          ...editingSkill,
                          metrologyTargets: {
                            ...editingSkill.metrologyTargets,
                            crestFactor: {
                              ...editingSkill.metrologyTargets.crestFactor,
                              max: parseFloat(e.target.value) || 12.0
                            }
                          }
                        })
                      }
                      className="w-full bg-[#1b212e] border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Prompts */}
              <div className="border-t border-slate-800 pt-3 space-y-3">
                <h4 className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                  <Rocket className="w-3 h-3 text-amber-400" />
                  KI-Prompts
                </h4>

                <div>
                  <label className="block text-[9px] text-slate-500 mb-0.5">
                    🚀 Schnellstart-Prompt (für kompakte HUD-ActionCards)
                  </label>
                  <textarea
                    rows={2}
                    value={editingSkill.prompts.quickstart}
                    onChange={(e) =>
                      setEditingSkill({
                        ...editingSkill,
                        prompts: { ...editingSkill.prompts, quickstart: e.target.value }
                      })
                    }
                    className="w-full bg-[#1b212e] border border-slate-700 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-[9px] text-slate-500 mb-0.5">
                    🛠️ Werkstatt-Prompt (für ausführliche Diagnose)
                  </label>
                  <textarea
                    rows={3}
                    value={editingSkill.prompts.workshop}
                    onChange={(e) =>
                      setEditingSkill({
                        ...editingSkill,
                        prompts: { ...editingSkill.prompts, workshop: e.target.value }
                      })
                    }
                    className="w-full bg-[#1b212e] border border-slate-700 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-400"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-800 bg-[#171c28] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 bg-slate-800"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleSaveEditor}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow"
              >
                💾 Skill im Vault sichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
