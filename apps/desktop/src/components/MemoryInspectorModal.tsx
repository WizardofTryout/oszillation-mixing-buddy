import React, { useState, useMemo } from 'react';
import {
  Brain,
  RotateCcw,
  Clock,
  ArrowRight,
  Search,
  Filter,
  X,
  Layers,
  ShieldCheck,
  CheckCircle2,
  Volume2
} from 'lucide-react';
import type { MixActionProposal } from '@mixing-buddy/shared-types';
import type { ActionJournalManager, JournalEntry } from '@mixing-buddy/ai-engine';

export interface MemoryInspectorModalProps {
  sessionName: string;
  actionJournal: ActionJournalManager;
  onRestoreProposal: (proposal: MixActionProposal) => void;
}

export const MemoryInspectorModal: React.FC<MemoryInspectorModalProps> = ({
  sessionName,
  actionJournal,
  onRestoreProposal
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [trackFilter, setTrackFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [restoredEntryIds, setRestoredEntryIds] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const allEntries = actionJournal.getAllEntries();

  // Unique tracks list for filtering
  const uniqueTracks = useMemo(() => {
    const set = new Set<string>();
    allEntries.forEach((e) => {
      if (e.track) set.add(e.track);
    });
    return Array.from(set).sort();
  }, [allEntries]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return allEntries.filter((entry) => {
      if (trackFilter !== 'all' && entry.track !== trackFilter) {
        return false;
      }
      if (statusFilter !== 'all' && entry.status !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTrack = entry.track.toLowerCase().includes(q);
        const matchParam = entry.parameter.toLowerCase().includes(q);
        const matchPlugin = (entry.pluginName || '').toLowerCase().includes(q);
        const matchTitle = (entry.cardTitle || '').toLowerCase().includes(q);
        const matchRationale = (entry.rationaleSnippet || '').toLowerCase().includes(q);
        if (!matchTrack && !matchParam && !matchPlugin && !matchTitle && !matchRationale) {
          return false;
        }
      }
      return true;
    });
  }, [allEntries, trackFilter, statusFilter, searchQuery]);

  const handleRestore = (entry: JournalEntry) => {
    // Erstelle eine deterministische MixActionProposal Aktionskarte
    const proposal: MixActionProposal = {
      id: `restore-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      category: 'dynamic_control',
      title: `Restore: ${entry.track} (${entry.parameter})`,
      rationale: `Wiederherstellung aus dem Studio Memory Journal: Ursprünglicher Ausgangswert ${entry.lineage.baseValue} ${entry.lineage.unit} (vorheriger Stand: ${entry.lineage.newValue} ${entry.lineage.unit}).`,
      confidenceScore: 1.0,
      status: 'pending',
      deltas: [
        {
          trackId: entry.track,
          trackName: entry.track,
          slotIndex: typeof entry.slotIndex === 'number' && entry.slotIndex > 0 ? entry.slotIndex : undefined,
          pluginName: entry.pluginName || undefined,
          parameterName: entry.parameter,
          currentValue: entry.lineage.newValue,
          proposedValue: entry.lineage.baseValue,
          unit: entry.lineage.unit
        }
      ]
    };

    onRestoreProposal(proposal);
    setRestoredEntryIds((prev) => new Set(prev).add(entry.id));
    setToastMessage(`Wiederherstellungs-Karte für '${entry.track}' angelegt!`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const formatTimestamp = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <>
      {/* HUD Header Toolbar Badge Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 text-xs font-medium text-purple-300 hover:text-white bg-purple-950/50 hover:bg-purple-900/60 border border-purple-500/40 px-2.5 py-1 rounded transition-all shadow-sm cursor-pointer shrink-0"
        title={`Studio Memory & Action Journal: ${allEntries.length} Aktionen`}
      >
        <Brain className="w-3.5 h-3.5 text-purple-400" />
        <span className="truncate max-w-[130px]">
          🧠 {sessionName} ({allEntries.length})
        </span>
      </button>

      {/* Studio-Dark Memory Inspector Modal Dialog */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900/95 border border-purple-500/40 rounded-xl shadow-2xl max-w-4xl w-full max-h-[88vh] flex flex-col overflow-hidden text-slate-100">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-950/60 border border-purple-500/30 text-purple-400">
                  <Brain className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-white tracking-wide">
                      Studio Memory & Action Journal
                    </h2>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-500/30">
                      Session: {sessionName}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Lückenlose chronologische Zeitleiste aller DAW-Parameteränderungen & Abhörpunkt-Kontexte
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title="Schließen"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sub-Header: Search & Filter Toolbar */}
            <div className="px-6 py-3 border-b border-slate-800/80 bg-slate-900/50 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                <div className="relative w-full">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Suche nach Spur, Parameter, Plugin oder Begründung..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-800/80 border border-slate-700/60 rounded-md pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-purple-500 transition-colors"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Track Filter */}
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={trackFilter}
                    onChange={(e) => setTrackFilter(e.target.value)}
                    className="bg-slate-800 border border-slate-700/70 text-slate-200 text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    <option value="all">Alle Spuren ({uniqueTracks.length})</option>
                    {uniqueTracks.map((trk) => (
                      <option key={trk} value={trk}>
                        {trk}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Filter */}
                <div className="flex items-center bg-slate-800/80 border border-slate-700/70 rounded p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`px-2 py-1 rounded transition-colors ${
                      statusFilter === 'all'
                        ? 'bg-purple-600 text-white font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Alle ({allEntries.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('applied')}
                    className={`px-2 py-1 rounded transition-colors ${
                      statusFilter === 'applied'
                        ? 'bg-purple-600 text-white font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Angewendet
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('restored')}
                    className={`px-2 py-1 rounded transition-colors ${
                      statusFilter === 'restored'
                        ? 'bg-purple-600 text-white font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Restored
                  </button>
                </div>
              </div>
            </div>

            {/* Toast Notification Banner */}
            {toastMessage && (
              <div className="px-6 py-2 bg-emerald-950/80 border-b border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{toastMessage}</span>
              </div>
            )}

            {/* Timeline Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {filteredEntries.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
                    <Clock className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-medium text-slate-300">Keine Aktionen gefunden</h3>
                  <p className="text-xs text-slate-400 max-w-sm mt-1">
                    {allEntries.length === 0
                      ? 'In dieser Session wurden noch keine Misch-Empfehlungen angewendet. Sobald du Vorschläge akzeptierst, wird jede Nuance hier chronologisch festgehalten.'
                      : 'Keine Einträge entsprechen deinen aktuellen Filtern.'}
                  </p>
                </div>
              ) : (
                <div className="relative border-l-2 border-purple-900/60 ml-4 pl-6 space-y-4">
                  {filteredEntries.map((entry) => {
                    const isRestored = restoredEntryIds.has(entry.id);
                    const deltaValue = entry.lineage.newValue - entry.lineage.oldValue;
                    const deltaSign = deltaValue > 0 ? '+' : '';

                    return (
                      <div key={entry.id} className="relative group">
                        {/* Timeline Bullet Node */}
                        <div
                          className={`absolute -left-[31px] top-3.5 w-3.5 h-3.5 rounded-full border-2 bg-slate-950 transition-all ${
                            entry.status === 'restored' || isRestored
                              ? 'border-cyan-400 bg-cyan-950'
                              : entry.status === 'applied'
                              ? 'border-emerald-400 bg-emerald-950'
                              : 'border-purple-400 bg-purple-950'
                          }`}
                        />

                        {/* Entry Box */}
                        <div className="bg-slate-850/80 border border-slate-750/70 hover:border-purple-500/50 rounded-xl p-4 transition-all shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2 mb-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              {/* Track Pill */}
                              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-indigo-950/70 text-indigo-300 border border-indigo-500/40">
                                {entry.track}
                              </span>

                              {/* Plugin Name if present */}
                              {entry.pluginName && (
                                <span className="px-2 py-0.5 rounded text-[11px] bg-slate-800 text-slate-300 border border-slate-700">
                                  {entry.pluginName}
                                  {typeof entry.slotIndex === 'number' && entry.slotIndex > 0
                                    ? ` (Slot ${entry.slotIndex})`
                                    : ''}
                                </span>
                              )}

                              {/* Parameter Name */}
                              <span className="text-xs font-medium text-slate-200">
                                {entry.parameter}
                              </span>

                              {/* Status Badge */}
                              <span
                                className={`text-[10px] font-mono px-2 py-0.2 rounded border ${
                                  entry.status === 'applied'
                                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                                    : entry.status === 'restored'
                                    ? 'bg-cyan-950/60 text-cyan-300 border-cyan-500/40'
                                    : 'bg-slate-800 text-slate-400 border-slate-700'
                                }`}
                              >
                                {entry.status}
                              </span>
                            </div>

                            {/* Timestamp */}
                            <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>{formatTimestamp(entry.timestamp)}</span>
                            </div>
                          </div>

                          {/* Lineage & Values Row */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-900/60 border border-slate-800/80 rounded-lg p-2.5 my-2.5 text-xs">
                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-mono">
                                Original Basiswert
                              </span>
                              <span className="font-semibold text-slate-300">
                                {entry.lineage.baseValue.toFixed(1)} {entry.lineage.unit}
                              </span>
                            </div>

                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-mono">
                                Übergang
                              </span>
                              <div className="flex items-center gap-1.5 font-medium">
                                <span className="text-slate-400">
                                  {entry.lineage.oldValue.toFixed(1)}
                                </span>
                                <ArrowRight className="w-3 h-3 text-purple-400" />
                                <span className="text-white font-semibold">
                                  {entry.lineage.newValue.toFixed(1)} {entry.lineage.unit}
                                </span>
                              </div>
                            </div>

                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-mono">
                                Delta
                              </span>
                              <span
                                className={`font-semibold ${
                                  deltaValue > 0
                                    ? 'text-amber-400'
                                    : deltaValue < 0
                                    ? 'text-emerald-400'
                                    : 'text-slate-400'
                                }`}
                              >
                                {deltaSign}
                                {deltaValue.toFixed(1)} {entry.lineage.unit}
                              </span>
                            </div>
                          </div>

                          {/* Context & Rationale */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
                            <div className="flex flex-wrap items-center gap-3">
                              {entry.monitoringContext && (
                                <div className="flex items-center gap-1">
                                  <Volume2 className="w-3 h-3 text-slate-400" />
                                  <span>
                                    Abhörpunkt:{' '}
                                    <strong className="text-slate-300">
                                      {entry.monitoringContext.activeMeterTrack}
                                    </strong>{' '}
                                    ({entry.monitoringContext.targetScope})
                                  </span>
                                </div>
                              )}
                              {entry.sidechainState && (
                                <div className="flex items-center gap-1 text-cyan-300 font-mono text-[10px]">
                                  <Layers className="w-3 h-3" />
                                  <span>
                                    Sidechain: {entry.sidechainState.sourceTrack} ➔{' '}
                                    {entry.sidechainState.targetTrack}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* One-Click Restore Action Button */}
                            <button
                              type="button"
                              onClick={() => handleRestore(entry)}
                              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all shadow-sm cursor-pointer ${
                                isRestored
                                  ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-purple-600 hover:bg-purple-500 text-white hover:shadow-purple-500/20'
                              }`}
                              title={`Ausgangswert ${entry.lineage.baseValue} ${entry.lineage.unit} als Karte im HUD bereitstellen`}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>
                                {isRestored ? 'Restore-Karte aktiv' : 'Ausgangswert restoren'}
                              </span>
                            </button>
                          </div>

                          {/* Rationale Snippet if present */}
                          {entry.rationaleSnippet && (
                            <p className="text-[11px] text-slate-400 italic mt-2 border-t border-slate-800/80 pt-1.5 line-clamp-2">
                              „{entry.rationaleSnippet}“
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/70 text-xs">
              <div className="flex items-center gap-1.5 text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>
                  Acoustic Shock Shield aktiv: Alle Restores sind bei Anhebungen auf max. +3.0 dB
                  gedeckelt.
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors cursor-pointer"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
