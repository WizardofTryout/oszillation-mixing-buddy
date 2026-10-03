import React, { useState } from 'react';
import type { MixActionProposal } from '@mixing-buddy/shared-types';
import { Check, X, Volume2, Sparkles, Pin, RotateCcw, RotateCw } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ActionCardProps {
  proposal: MixActionProposal;
  onApply: (id: string, selectedIndices?: number[]) => void;
  onReject: (id: string) => void;
  onAudition: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onRollbackDelta?: (proposalId: string, deltaIndex: number) => Promise<void> | void;
  onRedoDelta?: (proposalId: string, deltaIndex: number) => Promise<void> | void;
}

export const ActionCard: React.FC<ActionCardProps> = ({
  proposal,
  onApply,
  onReject,
  onAudition,
  onTogglePin,
  onRollbackDelta,
  onRedoDelta
}) => {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() =>
    new Set(proposal.deltas.map((_, i) => i))
  );
  const [rolledBackIndices, setRolledBackIndices] = useState<Set<number>>(new Set());

  const isApplied = proposal.status === 'applied';

  const toggleIndex = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  return (
    <div
      className={`bg-darkSurface rounded-lg p-4 shadow-xl flex flex-col gap-3 transition-all ${
        proposal.isPinned
          ? 'border-2 border-amber-500/60 shadow-amber-950/20'
          : 'border border-blue-500/40'
      }`}
    >
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-md bg-blue-500/10 text-blue-400">
            <Sparkles className="w-4 h-4" />
          </span>
          <div>
            <h4 className="text-sm font-bold text-slate-100">{proposal.title}</h4>
            <span className="text-[11px] text-blue-400 uppercase tracking-wide">
              {proposal.category.replace('_', ' ')} • {(proposal.confidenceScore * 100).toFixed(0)}% Confidence
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {proposal.isPinned && (
            <span className="text-[10px] uppercase font-bold font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
              <span>📌</span> Gespeichert
            </span>
          )}
          <span
            className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded ${
              isApplied ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {proposal.status}
          </span>
          {onTogglePin && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(proposal.id);
              }}
              className={`p-1 rounded transition-colors ${
                proposal.isPinned
                  ? 'text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20'
                  : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/80'
              }`}
              title={proposal.isPinned ? 'Vom Merkzettel lösen' : 'Karte dauerhaft anpinnen'}
            >
              <Pin className={`w-3.5 h-3.5 ${proposal.isPinned ? 'fill-amber-400' : ''}`} />
            </button>
          )}
          <button
            onClick={() => onReject(proposal.id)}
            className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
            title="Karte verwerfen & entfernen"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Rationale – collapsible accordion with markdown rendering */}
      {(() => {
        const [rationaleOpen, setRationaleOpen] = React.useState(false);
        const fullContent = (proposal as any).description || proposal.rationale || '';
        const shortRationale = fullContent.length > 140
          ? fullContent.slice(0, 140).replace(/\s\S*$/, '') + '…'
          : fullContent;

        return (
          <div className="bg-[#121418] rounded border border-darkBorder/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setRationaleOpen((o) => !o)}
              className="w-full flex items-start justify-between gap-2 px-2.5 py-2 text-left hover:bg-slate-800/40 transition-colors"
            >
              <div className="text-xs text-slate-300 leading-relaxed space-y-1 flex-1">
                <MarkdownRenderer content={rationaleOpen ? fullContent : shortRationale} />
              </div>
              <span className="text-slate-500 text-[10px] mt-0.5 shrink-0 select-none">
                {rationaleOpen ? '▲' : '▼'}
              </span>
            </button>
          </div>
        );
      })()}

      {/* Sidechain Routing Header Strip */}
      {proposal.sidechainRoute && (
        <div className="flex items-center justify-between text-xs bg-indigo-950/50 border border-indigo-500/40 px-2.5 py-1.5 rounded font-mono">
          <div className="flex items-center gap-1.5 text-indigo-300">
            <span className="font-semibold text-indigo-200">🔗 Sidechain:</span>
            <span>{proposal.sidechainRoute.trackName} (Slot {proposal.sidechainRoute.slotIndex})</span>
          </div>
          <div className="text-indigo-400 font-bold">
            ← {proposal.sidechainRoute.sourcePath}
          </div>
        </div>
      )}

      {/* Parameter Deltas Diff */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
          Proposed Modifications:
        </span>
        <div className="space-y-1">
          {proposal.deltas.map((delta, idx) => {
            const isRolledBack = rolledBackIndices.has(idx);
            const isChecked = selectedIndices.has(idx);

            return (
              <div
                key={idx}
                className={`flex justify-between items-center text-xs px-2.5 py-1.5 rounded border font-mono transition-colors ${
                  isRolledBack
                    ? 'bg-amber-950/20 border-amber-500/30 opacity-75'
                    : !isApplied && !isChecked
                    ? 'bg-slate-900/30 border-darkBorder/20 opacity-50'
                    : 'bg-slate-900/60 border-darkBorder/40'
                }`}
              >
                <div className="flex items-center gap-2 text-slate-200">
                  {/* Vor dem Anwenden: Checkbox */}
                  {!isApplied && (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleIndex(idx)}
                      className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-0 cursor-pointer accent-blue-500"
                      title={isChecked ? 'Auswahl aufheben' : 'Zum Anwenden auswählen'}
                    />
                  )}
                  <span className="font-semibold text-blue-300">{delta.trackName}</span>
                  {delta.pluginName && <span className="text-slate-500">› {delta.pluginName}</span>}
                  <span className="text-slate-400">› {delta.parameterName}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-slate-500 line-through">
                    {delta.currentValue.toFixed(1)} {delta.unit}
                  </span>
                  <span className="text-slate-400">→</span>
                  <span
                    className={`font-bold ${
                      isRolledBack ? 'text-amber-400 line-through' : 'text-emerald-400'
                    }`}
                  >
                    {delta.proposedValue.toFixed(1)} {delta.unit}
                  </span>

                  {/* Nach dem Anwenden: Granularer Rollback-Button (Undo) oder Wiederherstellen (Redo) */}
                  {isApplied && (
                    isRolledBack ? (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (onRedoDelta) {
                            await onRedoDelta(proposal.id, idx);
                          }
                          setRolledBackIndices((prev) => {
                            const next = new Set(prev);
                            next.delete(idx);
                            return next;
                          });
                        }}
                        className="flex items-center gap-1 text-[10px] text-emerald-300 hover:text-emerald-200 font-sans px-2 py-0.5 rounded bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/40 ml-1 transition-colors shadow-sm"
                        title="Diesen Wert erneut in der DAW anwenden (Redo)"
                      >
                        <RotateCw className="w-3 h-3" />
                        <span>Wiederherstellen</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (onRollbackDelta) {
                            await onRollbackDelta(proposal.id, idx);
                            setRolledBackIndices((prev) => new Set([...prev, idx]));
                          }
                        }}
                        className="p-1 rounded text-amber-400 hover:text-amber-300 hover:bg-slate-800 transition-colors ml-1"
                        title="Diesen Parameter einzeln zurücksetzen (Undo)"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-darkBorder/60">
        <button
          onClick={() => onAudition(proposal.id)}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 transition-colors"
          title="Loop and A/B compare"
        >
          <Volume2 className="w-3.5 h-3.5 text-amber-400" />
          A/B Listen
        </button>

        <button
          onClick={() => onReject(proposal.id)}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-red-950/40 hover:bg-red-900/50 text-red-300 flex items-center gap-1.5 transition-colors border border-red-800/40"
        >
          <X className="w-3.5 h-3.5" />
          Verwerfen
        </button>

        <button
          onClick={() => onApply(proposal.id, Array.from(selectedIndices))}
          disabled={isApplied || selectedIndices.size === 0}
          className={`px-3.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-md ${
            isApplied
              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/40 cursor-default'
              : selectedIndices.size === 0
              ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-400'
              : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'
          }`}
        >
          <Check className="w-3.5 h-3.5" />
          {isApplied ? 'Angewendet' : 'Anwenden'}
        </button>
      </div>
    </div>
  );
};
