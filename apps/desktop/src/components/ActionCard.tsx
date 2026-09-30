import React from 'react';
import type { MixActionProposal } from '@mixing-buddy/shared-types';
import { Check, X, Volume2, Sparkles } from 'lucide-react';

interface ActionCardProps {
  proposal: MixActionProposal;
  onApply: (id: string) => void;
  onReject: (id: string) => void;
  onAudition: (id: string) => void;
}

export const ActionCard: React.FC<ActionCardProps> = ({
  proposal,
  onApply,
  onReject,
  onAudition
}) => {
  return (
    <div className="bg-darkSurface border border-blue-500/40 rounded-lg p-4 shadow-xl flex flex-col gap-3">
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
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
            {proposal.status}
          </span>
          <button
            onClick={() => onReject(proposal.id)}
            className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
            title="Karte verwerfen & entfernen"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Rationale */}
      <p className="text-xs text-slate-300 leading-relaxed bg-[#121418] p-2.5 rounded border border-darkBorder/60">
        {proposal.rationale}
      </p>

      {/* Parameter Deltas Diff */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
          Proposed Modifications:
        </span>
        <div className="space-y-1">
          {proposal.deltas.map((delta, idx) => (
            <div
              key={idx}
              className="flex justify-between items-center text-xs bg-slate-900/60 px-2.5 py-1.5 rounded border border-darkBorder/40 font-mono"
            >
              <div className="flex items-center gap-1.5 text-slate-200">
                <span className="font-semibold text-blue-300">{delta.trackName}</span>
                {delta.pluginName && <span className="text-slate-500">› {delta.pluginName}</span>}
                <span className="text-slate-400">› {delta.parameterName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 line-through">
                  {delta.currentValue.toFixed(1)} {delta.unit}
                </span>
                <span className="text-slate-400">→</span>
                <span className="text-emerald-400 font-bold">
                  {delta.proposedValue.toFixed(1)} {delta.unit}
                </span>
              </div>
            </div>
          ))}
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
          onClick={() => onApply(proposal.id)}
          className="px-3.5 py-1.5 rounded text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 transition-colors shadow-md shadow-blue-900/30"
        >
          <Check className="w-3.5 h-3.5" />
          Anwenden
        </button>
      </div>
    </div>
  );
};
