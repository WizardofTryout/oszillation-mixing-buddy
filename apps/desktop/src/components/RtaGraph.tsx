import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type {
  MeterSpectrumData,
  ReferenceTrackProfile,
  ReferenceProfileSummary,
  MetrologyTelemetryFrame,
  MixActionProposal,
  TrackDescriptor
} from '@mixing-buddy/shared-types';
import {
  computeSpectralDifference,
  generateReferenceMatchProposal
} from '@mixing-buddy/ai-engine';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Music, ChevronDown, Check, Plus, Scale, X, Zap } from 'lucide-react';

export interface RtaGraphProps {
  /** 30 fps Live Telemetry spectrum from JUCE meter */
  spectrum?: MeterSpectrumData;
  /** Full live metrology frame if available */
  telemetry?: MetrologyTelemetryFrame | null;
  /** Live integrated or short-term LUFS if available for gain matching */
  liveLufs?: number;
  /** Currently active reference track profile */
  activeReference: ReferenceTrackProfile | null;
  /** Callback to set or clear active reference profile */
  onSelectReference: (profile: ReferenceTrackProfile | null) => void;
  /** Callback to open the full ReferenceTrackModal */
  onOpenReferenceModal: () => void;
  /** Callback when user clicks 'An Referenz anpassen' to inject proposal */
  onGenerateProposal?: (proposal: MixActionProposal) => void;
  /** Available DAW tracks for target assignment */
  availableTracks?: TrackDescriptor[];
}

const CENTER_FREQS = [
  '20', '25', '31.5', '40', '50', '63', '80', '100',
  '125', '160', '200', '250', '315', '400', '500', '630',
  '800', '1k', '1.2k', '1.6k', '2k', '2.5k', '3.1k', '4k',
  '5k', '6.3k', '8k', '10k', '12.5k', '16k', '18k', '20k'
];

export const RtaGraph: React.FC<RtaGraphProps> = ({
  spectrum,
  telemetry,
  liveLufs,
  activeReference,
  onSelectReference,
  onOpenReferenceModal,
  onGenerateProposal,
  availableTracks
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Reference persistence state
  const [savedReferences, setSavedReferences] = useState<ReferenceProfileSummary[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [isLoadingReferences, setIsLoadingReferences] = useState<boolean>(false);
  const [isAdapting, setIsAdapting] = useState<boolean>(false);

  // Gain matching (Pegel-Normalisierung)
  const [isGainMatchEnabled, setIsGainMatchEnabled] = useState<boolean>(true);
  const [displayGainOffset, setDisplayGainOffset] = useState<number>(0);
  const smoothedGainOffsetRef = useRef<number>(0);

  // Fetch list of saved profiles from Rust vault (~/.mixing-buddy/references/)
  const loadSavedProfiles = useCallback(async () => {
    try {
      setIsLoadingReferences(true);
      const list = await invoke<ReferenceProfileSummary[]>('list_reference_profiles');
      setSavedReferences(list || []);
    } catch (err) {
      console.warn('Could not load saved references for RTA dropdown', err);
    } finally {
      setIsLoadingReferences(false);
    }
  }, []);

  useEffect(() => {
    loadSavedProfiles();

    // Listen to vault updates from Tauri
    let unlistenFn: (() => void) | undefined;
    listen('reference-vault-updated', () => {
      loadSavedProfiles();
    }).then((unsub) => {
      unlistenFn = unsub;
    }).catch((e) => {
      console.warn('Failed to register reference-vault-updated listener', e);
    });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [loadSavedProfiles]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isDropdownOpen]);

  // Handle selecting a reference from dropdown
  const handleSelectProfile = async (summary: ReferenceProfileSummary | null) => {
    setIsDropdownOpen(false);
    if (!summary) {
      onSelectReference(null);
      return;
    }
    try {
      const fullProfile = await invoke<ReferenceTrackProfile>('get_reference_profile', { id: summary.id });
      onSelectReference(fullProfile);
    } catch (err) {
      console.error('Failed to load full reference profile', err);
    }
  };

  // Canvas RTA Rendering (30 fps dual graph)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // 1. Clear background
    ctx.fillStyle = '#101317';
    ctx.fillRect(0, 0, width, height);

    // 2. Draw dB grid lines (-12, -24, -36, -48, -60 dB)
    ctx.strokeStyle = '#1e242d';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#475569';
    ctx.font = '10px "JetBrains Mono", monospace';

    const dbSteps = [-12, -24, -36, -48, -60];
    for (const db of dbSteps) {
      const y = ((0 - db) / 70.0) * (height - 30);
      ctx.beginPath();
      ctx.moveTo(35, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillText(`${db} dB`, 2, y + 3);
    }

    const liveBands = spectrum?.frequencyBands ?? new Array(32).fill(-70);
    const numBands = 32;
    const plotWidth = width - 45;
    const barWidth = Math.max(2, (plotWidth / numBands) - 3);

    // 3. Compute Gain Matching Offset for Reference Curve
    let currentTargetOffset = 0;
    if (activeReference && activeReference.frequencyBands) {
      // Find active live bands with signal above noise floor (-65 dB)
      const activeLiveBands: number[] = [];
      const correspondingRefBands: number[] = [];

      for (let i = 0; i < Math.min(liveBands.length, activeReference.frequencyBands.length); i++) {
        if (liveBands[i] > -65) {
          activeLiveBands.push(liveBands[i]);
          correspondingRefBands.push(activeReference.frequencyBands[i]);
        }
      }

      if (activeLiveBands.length >= 4) {
        const liveMean = activeLiveBands.reduce((a, b) => a + b, 0) / activeLiveBands.length;
        const refMean = correspondingRefBands.reduce((a, b) => a + b, 0) / correspondingRefBands.length;
        currentTargetOffset = liveMean - refMean;
      } else if (liveLufs !== undefined && liveLufs > -50 && activeReference.integratedLufs) {
        currentTargetOffset = liveLufs - activeReference.integratedLufs;
      } else {
        // Fallback: mix is silent/stopped, retain previous offset or 0
        currentTargetOffset = smoothedGainOffsetRef.current;
      }

      // Clamp offset to sensible range [-24 dB, +24 dB]
      currentTargetOffset = Math.max(-24, Math.min(24, currentTargetOffset));

      // Smooth offset (low-pass filter to prevent rapid jitter during transients)
      smoothedGainOffsetRef.current += (currentTargetOffset - smoothedGainOffsetRef.current) * 0.12;
      setDisplayGainOffset(smoothedGainOffsetRef.current);
    }

    const effectiveGainOffset = isGainMatchEnabled ? smoothedGainOffsetRef.current : 0;

    // 4. Pfad 1: 30 fps Live-Telemetrie aus dem JUCE-Plugin (Türkis / Balken)
    for (let i = 0; i < numBands; i++) {
      const db = Math.max(-70, Math.min(0, liveBands[i] ?? -70));
      const norm = (db + 70) / 70; // 0.0 to 1.0
      const barHeight = norm * (height - 30);
      const x = 40 + i * (plotWidth / numBands);
      const y = height - 25 - barHeight;

      // Vivid turquoise gradient for live RTA bars
      const grad = ctx.createLinearGradient(0, height - 25, 0, 10);
      grad.addColorStop(0, '#042f2e');   // Deep teal base
      grad.addColorStop(0.3, '#0d9488'); // Vibrant teal
      grad.addColorStop(0.7, '#14b8a6'); // Bright turquoise
      grad.addColorStop(0.95, '#2dd4bf'); // Electric turquoise
      grad.addColorStop(1.0, '#a5f3fc'); // Cyan highlight

      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barWidth, barHeight);

      // Turquoise peak cap
      ctx.fillStyle = '#67e8f9';
      ctx.fillRect(x, y, barWidth, 1.5);

      // Frequency label at bottom
      if (i % 4 === 0 && i < CENTER_FREQS.length) {
        ctx.fillStyle = '#475569';
        ctx.fillText(CENTER_FREQS[i], x - 4, height - 8);
      }
    }

    // 5. Pfad 2: Gespeicherte 32-Band-Spektralkurve der aktiven Referenz (Rosa gestrichelt / Linie mit Glow)
    if (activeReference && activeReference.frequencyBands && activeReference.frequencyBands.length > 0) {
      const refBands = activeReference.frequencyBands;
      const points: Array<{ x: number; y: number }> = [];

      for (let i = 0; i < numBands; i++) {
        const rawDb = refBands[i] ?? -70;
        const adjustedDb = Math.max(-70, Math.min(0, rawDb + effectiveGainOffset));
        const norm = (adjustedDb + 70) / 70;
        const x = 40 + i * (plotWidth / numBands) + barWidth / 2;
        const y = height - 25 - norm * (height - 30);
        points.push({ x, y });
      }

      if (points.length > 1) {
        // Glow pass (soft magenta/rose blur under the dashed line)
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#f43f5e';
        ctx.shadowBlur = 10;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.restore();

        // Crisp dashed stroke (bright rose line)
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.strokeStyle = '#fb7185'; // Tailwind rose-400
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.restore();

        // Node points on key frequencies for clear reference readouts
        ctx.fillStyle = '#f43f5e';
        for (let i = 0; i < points.length; i++) {
          ctx.beginPath();
          ctx.arc(points[i].x, points[i].y, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 6. Spectral Resonances if detected in live audio
    if (spectrum?.spectralResonances && spectrum.spectralResonances.length > 0) {
      for (const res of spectrum.spectralResonances) {
        const logMin = Math.log10(20);
        const logMax = Math.log10(20000);
        const logFreq = Math.log10(Math.max(20, Math.min(20000, res.frequencyHz)));
        const xRatio = (logFreq - logMin) / (logMax - logMin);
        const x = 40 + xRatio * plotWidth;

        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(x, 18, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`${Math.round(res.frequencyHz)} Hz`, x - 16, 30);
      }
    }
  }, [spectrum, activeReference, isGainMatchEnabled, liveLufs]);

  // Real-time spectral difference analysis (Delta(f) = Live(f) - Reference(f))
  const deviationZone = useMemo(() => {
    if (!activeReference || !spectrum?.frequencyBands) return null;
    const effectiveOffset = isGainMatchEnabled ? displayGainOffset : 0;
    const analysis = computeSpectralDifference(
      spectrum.frequencyBands,
      activeReference.frequencyBands,
      effectiveOffset,
      2.5
    );
    return analysis.primaryDeviation;
  }, [activeReference, spectrum?.frequencyBands, isGainMatchEnabled, displayGainOffset]);

  const handleAdaptToReference = () => {
    if (!activeReference || !onGenerateProposal) return;
    setIsAdapting(true);

    const effectiveOffset = isGainMatchEnabled ? displayGainOffset : 0;
    const telemetryFrame: MetrologyTelemetryFrame = telemetry || {
      version: '1.0',
      sequenceNumber: 1,
      sampleRate: 44100,
      loudness: {
        momentaryLufs: liveLufs ?? -14.0,
        shortTermLufs: liveLufs ?? -14.0,
        integratedLufs: liveLufs ?? -14.0,
        loudnessRangeLu: 6.0,
        truePeakDb: { left: -1.0, right: -1.0 }
      },
      spectrum: spectrum || {
        timestamp: Date.now(),
        frequencyBands: new Array(32).fill(-70),
        centerFrequenciesHz: [],
        spectralResonances: []
      },
      dynamics: {
        stereoCorrelation: 0.9,
        crestFactorDb: 10.0,
        rmsDb: { left: -16.0, right: -16.0 }
      }
    };

    const proposal = generateReferenceMatchProposal(
      telemetryFrame,
      activeReference,
      availableTracks || [],
      effectiveOffset,
      2.5
    );

    if (proposal) {
      onGenerateProposal(proposal);
    }

    setTimeout(() => {
      setIsAdapting(false);
    }, 1200);
  };

  return (
    <div className="bg-darkSurface border border-darkBorder rounded-lg p-4 shadow-lg flex flex-col">
      {/* RTA Header Toolbar */}
      <div className="flex flex-wrap justify-between items-center gap-2 mb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold tracking-wider text-slate-300 uppercase">
            Real-Time Spectrum (RTA — 32 Bands)
          </h3>
          <span className="text-[10px] bg-teal-950/70 border border-teal-500/40 text-teal-300 px-1.5 py-0.5 rounded font-mono font-bold">
            30 FPS LIVE
          </span>
          {activeReference && (
            <span className="text-[10px] bg-rose-950/70 border border-rose-500/40 text-rose-300 px-1.5 py-0.5 rounded font-mono font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
              A/B REF
            </span>
          )}

          {/* Spectral Difference Badge (> 2.5 dB deviation) with Action Button */}
          {activeReference && deviationZone && (
            <div className="flex items-center gap-1.5 bg-amber-950/70 border border-amber-500/60 px-2.5 py-1 rounded shadow-sm text-xs animate-in fade-in duration-200">
              <span className="text-amber-300 font-mono text-[11px] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="font-semibold">{deviationZone.label}</span>
              </span>
              <button
                type="button"
                onClick={handleAdaptToReference}
                disabled={isAdapting}
                className="flex items-center gap-1 bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 font-bold px-2.5 py-0.5 rounded text-xs transition-all shadow active:scale-95 ml-1 disabled:opacity-50 cursor-pointer"
                title="Klick generiert eine Channel EQ Filter-Gain ActionCard, um das Frequenzbild an die Referenz anzunähern"
              >
                <Zap className="w-3 h-3 text-slate-950 fill-current" />
                <span>{isAdapting ? 'Erzeugt...' : '⚡ An Referenz anpassen'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Controls: Gain Match + Reference Dropdown */}
        <div className="flex items-center gap-2">
          {/* Pegel-Normalisierung (Gain Matching) Button */}
          {activeReference && (
            <button
              type="button"
              onClick={() => setIsGainMatchEnabled(!isGainMatchEnabled)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-all border ${
                isGainMatchEnabled
                  ? 'bg-rose-950/40 border-rose-500/50 text-rose-300 shadow-sm'
                  : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200'
              }`}
              title="Pegel-Normalisierung: Passt die Gesamtenergie der Referenzkurve optisch an den aktuellen Mix an für einen fairen A/B-Blick"
            >
              <Scale className="w-3 h-3 text-rose-400" />
              <span>Gain Match</span>
              {isGainMatchEnabled && (
                <span className="text-[10px] font-bold text-rose-300 ml-0.5 bg-rose-900/50 px-1 rounded">
                  {displayGainOffset >= 0 ? `+${displayGainOffset.toFixed(1)}` : displayGainOffset.toFixed(1)} dB
                </span>
              )}
            </button>
          )}

          {/* Quick Reference Selector Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-1.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-slate-200 transition-all shadow-sm max-w-[220px]"
              title="Referenz-Track wählen oder neue Referenz analysieren"
            >
              <Music className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="truncate">
                {activeReference ? activeReference.name : 'Referenz: Keine'}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400 shrink-0 ml-0.5" />
            </button>

            {/* Dropdown Popover */}
            {isDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-72 bg-[#13171e] border border-slate-700/90 rounded-lg shadow-2xl py-1.5 z-50 text-xs">
                <div className="px-3 py-1 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Referenzkurve im HUD
                </div>

                {/* Option: Keine Referenz */}
                <button
                  type="button"
                  onClick={() => handleSelectProfile(null)}
                  className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-slate-800/80 transition-colors ${
                    !activeReference ? 'text-teal-400 font-semibold bg-slate-800/40' : 'text-slate-300'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <X className="w-3 h-3 text-slate-400" />
                    Keine Referenz (Aus)
                  </span>
                  {!activeReference && <Check className="w-3.5 h-3.5 text-teal-400" />}
                </button>

                <div className="border-t border-slate-800 my-1" />

                {/* List of saved references in Vault */}
                <div className="px-3 py-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider flex justify-between items-center">
                  <span>Vault ({savedReferences.length})</span>
                  {isLoadingReferences && <span className="animate-spin text-slate-400">⏳</span>}
                </div>

                <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/50">
                  {savedReferences.length === 0 ? (
                    <div className="px-3 py-3 text-center text-slate-500 text-xs italic">
                      Noch keine Referenzen im Vault gesichert.
                    </div>
                  ) : (
                    savedReferences.map((summary) => {
                      const isSelected = activeReference?.id === summary.id;
                      return (
                        <button
                          key={summary.id}
                          type="button"
                          onClick={() => handleSelectProfile(summary)}
                          className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-800/80 transition-colors ${
                            isSelected ? 'bg-rose-950/30 text-rose-300 font-medium' : 'text-slate-200'
                          }`}
                        >
                          <div className="flex flex-col truncate pr-2">
                            <span className="truncate text-xs">{summary.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
                              <span className="uppercase text-slate-500 font-semibold">{summary.fileFormat}</span>
                              <span>•</span>
                              <span className="text-emerald-400">{summary.integratedLufs.toFixed(1)} LUFS</span>
                              <span>•</span>
                              <span>{Math.round(summary.durationSeconds)}s</span>
                            </span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="border-t border-slate-800 my-1" />

                {/* Action: Open modal to upload/analyze new track */}
                <button
                  type="button"
                  onClick={() => {
                    setIsDropdownOpen(false);
                    onOpenReferenceModal();
                  }}
                  className="w-full text-left px-3 py-2 flex items-center gap-1.5 text-indigo-300 hover:text-white hover:bg-indigo-950/40 transition-colors font-medium"
                >
                  <Plus className="w-3.5 h-3.5 text-indigo-400" />
                  <span>+ Neue Referenz analysieren...</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 32-Band Canvas Graph */}
      <canvas
        ref={canvasRef}
        width={680}
        height={225}
        className="w-full h-auto rounded border border-darkBorder/60 bg-[#101317]"
      />

      {/* Legend & Visual Readout Footer */}
      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 mt-2 px-1">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-t from-teal-600 to-teal-300" />
            <span className="font-mono text-slate-300">Live Mix (Türkis / Balken)</span>
          </div>

          {activeReference && (
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-t-2 border-dashed border-rose-400" />
              <span className="font-mono text-rose-300 truncate max-w-[240px]">
                {activeReference.name}
              </span>
              {isGainMatchEnabled && (
                <span className="text-[10px] text-rose-400 font-mono">
                  ({displayGainOffset >= 0 ? `+${displayGainOffset.toFixed(1)}` : displayGainOffset.toFixed(1)} dB Gain Match)
                </span>
              )}
            </div>
          )}
        </div>

        <div className="text-slate-500 font-mono text-[10px]">
          1024-FFT Blackman-Harris • ITU-R BS.1770
        </div>
      </div>
    </div>
  );
};
