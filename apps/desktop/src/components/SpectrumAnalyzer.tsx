import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type {
  MeterSpectrumData,
  ReferenceTrackProfile,
  ReferenceProfileSummary,
  MetrologyTelemetryFrame,
  MixActionProposal,
  TrackDescriptor,
  TargetProfile
} from '@mixing-buddy/shared-types';
import { calculateTargetCurve32Bands } from '@mixing-buddy/shared-types';
import {
  generateReferenceMatchProposal
} from '@mixing-buddy/ai-engine';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Music, ChevronDown, Check, Plus, Scale, X, Zap } from 'lucide-react';

export interface SpectrumAnalyzerProps {
  /** 30 fps Live Telemetry spectrum from JUCE meter */
  spectrum?: MeterSpectrumData;
  /** Full live metrology frame if available */
  telemetry?: MetrologyTelemetryFrame | null;
  /** Live integrated or short-term LUFS if available for gain matching */
  liveLufs?: number;
  /** Currently active reference track profile */
  activeReference?: ReferenceTrackProfile | null;
  /** 32-band reference spectrum override or fallback */
  referenceSpectrum?: number[];
  /** Active target profile */
  targetProfile?: TargetProfile | null;
  /** Callback to set or clear active reference profile */
  onSelectReference?: (profile: ReferenceTrackProfile | null) => void;
  /** Callback to open the full ReferenceTrackModal */
  onOpenReferenceModal?: () => void;
  /** Callback when user clicks 'An Referenz anpassen' to inject proposal */
  onGenerateProposal?: (proposal: MixActionProposal) => void;
  /** Available DAW tracks for target assignment */
  availableTracks?: TrackDescriptor[];
}

const CENTER_FREQ_LABELS = [
  '20', '25', '31.5', '40', '50', '63', '80', '100',
  '125', '160', '200', '250', '315', '400', '500', '630',
  '800', '1k', '1.2k', '1.6k', '2k', '2.5k', '3.1k', '4k',
  '5k', '6.3k', '8k', '10k', '12.5k', '16k', '18k', '20k'
];

interface PeakHoldState {
  db: number;
  holdFrames: number;
}

export const SpectrumAnalyzer: React.FC<SpectrumAnalyzerProps> = ({
  spectrum,
  telemetry,
  liveLufs,
  activeReference = null,
  referenceSpectrum,
  targetProfile,
  onSelectReference = () => {},
  onOpenReferenceModal = () => {},
  onGenerateProposal,
  availableTracks
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Display toggles
  const [viewMode, setViewMode] = useState<'led' | 'highres' | 'spline'>('led');
  const [showTargetEnvelope, setShowTargetEnvelope] = useState<boolean>(true);
  const [showReference, setShowReference] = useState<boolean>(true);
  const [isLegendOpen, setIsLegendOpen] = useState<boolean>(false);
  const legendRef = useRef<HTMLDivElement | null>(null);

  // Reference persistence state
  const [savedReferences, setSavedReferences] = useState<ReferenceProfileSummary[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [isAdapting, setIsAdapting] = useState<boolean>(false);

  // Gain matching (Pegel-Normalisierung)
  const [isGainMatchEnabled, setIsGainMatchEnabled] = useState<boolean>(true);
  const [displayGainOffset, setDisplayGainOffset] = useState<number>(0);
  const smoothedGainOffsetRef = useRef<number>(0);

  // Peak-Hold State across 32 bands
  const peaksRef = useRef<PeakHoldState[]>(
    Array.from({ length: 32 }, () => ({ db: -70, holdFrames: 0 }))
  );

  // Peak-Hold State across 128 high-res bands
  const highResPeaksRef = useRef<PeakHoldState[]>(
    Array.from({ length: 128 }, () => ({ db: -90, holdFrames: 0 }))
  );

  // Latest live data references for high-speed animation loop
  const latestSpectrumRef = useRef<number[]>(new Array(32).fill(-70));
  const latest128BandsRef = useRef<number[]>(new Array(128).fill(-90));

  useEffect(() => {
    if (spectrum?.frequencyBands && spectrum.frequencyBands.length > 0) {
      latestSpectrumRef.current = spectrum.frequencyBands;
    }

    // Direct 128-band telemetry frame or smooth interpolation fallback from 32 bands
    const raw128 = telemetry?.spectrum128Bands ?? telemetry?.spectrum?.spectrum128Bands;
    if (raw128 && raw128.length === 128) {
      latest128BandsRef.current = raw128;
    } else {
      const src32 = spectrum?.frequencyBands ?? latestSpectrumRef.current;
      if (src32 && src32.length > 0) {
        const interp: number[] = new Array(128);
        for (let j = 0; j < 128; j++) {
          const t = (j / 127.0) * 31.0;
          const idx = Math.floor(t);
          const frac = t - idx;
          const v0 = src32[idx] ?? -90;
          const v1 = src32[Math.min(31, idx + 1)] ?? -90;
          interp[j] = v0 + frac * (v1 - v0);
        }
        latest128BandsRef.current = interp;
      }
    }
  }, [spectrum, telemetry]);

  // Target Curve calculation for 32 bands
  const targetCurve32 = useMemo<number[]>(() => {
    if (!targetProfile) {
      return calculateTargetCurve32Bands('pop_radio', 'mix_bus');
    }
    return calculateTargetCurve32Bands(targetProfile.genreProfile, targetProfile.targetScope);
  }, [targetProfile]);

  // Effective reference spectrum (from prop or activeReference)
  const effectiveRefBands = useMemo<number[] | null>(() => {
    if (referenceSpectrum && referenceSpectrum.length > 0) {
      return referenceSpectrum;
    }
    if (activeReference?.frequencyBands && activeReference.frequencyBands.length > 0) {
      return activeReference.frequencyBands;
    }
    return null;
  }, [referenceSpectrum, activeReference]);

  // Fetch list of saved profiles from Rust vault (~/.mixing-buddy/references/)
  const loadSavedProfiles = useCallback(async () => {
    try {
      const list = await invoke<ReferenceProfileSummary[]>('list_reference_profiles');
      setSavedReferences(list || []);
    } catch (err) {
      console.warn('Could not load saved references for RTA dropdown', err);
    }
  }, []);

  useEffect(() => {
    loadSavedProfiles();

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
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (legendRef.current && !legendRef.current.contains(e.target as Node)) {
        setIsLegendOpen(false);
      }
    };
    if (isDropdownOpen || isLegendOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen, isLegendOpen]);

  const handleSelectSummary = async (summary: ReferenceProfileSummary) => {
    setIsDropdownOpen(false);
    if (activeReference?.id === summary.id) {
      return;
    }
    try {
      const fullProfile = await invoke<ReferenceTrackProfile>('get_reference_profile', { id: summary.id });
      onSelectReference(fullProfile);
    } catch (err) {
      console.error('Failed to load full reference profile', err);
    }
  };

  // 60 fps Animation & Physics Loop for Canvas RTA
  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animId = requestAnimationFrame(render);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animId = requestAnimationFrame(render);
        return;
      }

      const width = canvas.width;
      const height = canvas.height;

      // 1. Clear background
      ctx.fillStyle = '#101317';
      ctx.fillRect(0, 0, width, height);

      // 2. Grid & Scale setup
      const minDb = -70;
      const maxDb = 0;
      const baselineY = height - 26;
      const topY = 16;
      const plotHeight = baselineY - topY;
      const plotLeft = 38;
      const plotWidth = width - plotLeft - 10;
      const numBands = 32;
      const bandSlotWidth = plotWidth / numBands;
      const barWidth = Math.max(3, bandSlotWidth - 2.5);

      // dB horizontal grid lines (-12, -24, -36, -48, -60 dB)
      ctx.strokeStyle = '#1e242d';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#475569';
      ctx.font = '10px "JetBrains Mono", monospace';

      const dbSteps = [-12, -24, -36, -48, -60];
      for (const db of dbSteps) {
        const norm = (0 - db) / (0 - minDb);
        const y = topY + norm * plotHeight;
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(width - 8, y);
        ctx.stroke();
        ctx.fillText(`${db} dB`, 2, y + 3);
      }

      const liveBands = latestSpectrumRef.current;

      // 3. Gain-Matching Computation for Reference Curve
      let currentTargetOffset = 0;
      if (effectiveRefBands && effectiveRefBands.length > 0) {
        const activeLiveBands: number[] = [];
        const correspondingRefBands: number[] = [];

        for (let i = 0; i < Math.min(liveBands.length, effectiveRefBands.length); i++) {
          if (liveBands[i] > -65) {
            activeLiveBands.push(liveBands[i]);
            correspondingRefBands.push(effectiveRefBands[i]);
          }
        }

        if (activeLiveBands.length >= 4) {
          const liveMean = activeLiveBands.reduce((a, b) => a + b, 0) / activeLiveBands.length;
          const refMean = correspondingRefBands.reduce((a, b) => a + b, 0) / correspondingRefBands.length;
          currentTargetOffset = liveMean - refMean;
        } else if (liveLufs !== undefined && liveLufs > -50 && activeReference?.integratedLufs) {
          currentTargetOffset = liveLufs - activeReference.integratedLufs;
        } else {
          currentTargetOffset = smoothedGainOffsetRef.current;
        }

        currentTargetOffset = Math.max(-24, Math.min(24, currentTargetOffset));
        smoothedGainOffsetRef.current += (currentTargetOffset - smoothedGainOffsetRef.current) * 0.12;
      }
      const effectiveGainOffset = isGainMatchEnabled ? smoothedGainOffsetRef.current : 0;

      // 4. Update Peak-Hold Gravity Physics for each band
      // Rule:
      // if currentDb > peak.db: peak.db = currentDb; peak.holdFrames = 15;
      // else if peak.holdFrames > 0: peak.holdFrames--;
      // else: peak.db -= 1.2;
      for (let i = 0; i < numBands; i++) {
        const currentDb = Math.max(minDb, Math.min(maxDb, liveBands[i] ?? minDb));
        const peak = peaksRef.current[i];
        if (currentDb > peak.db) {
          peak.db = currentDb;
          peak.holdFrames = 15;
        } else if (peak.holdFrames > 0) {
          peak.holdFrames--;
        } else {
          peak.db = Math.max(minDb, peak.db - 1.2);
        }
      }

      // 5. Render Target Envelope Overlay (Sollkurve: Halbtransparente cyanblaue Konturlinie mit Glow)
      if (showTargetEnvelope && targetCurve32.length === 32) {
        const targetPoints: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < numBands; i++) {
          const tDb = targetCurve32[i];
          const norm = Math.max(0, Math.min(1, (tDb - minDb) / (maxDb - minDb)));
          const x = plotLeft + i * bandSlotWidth + barWidth / 2;
          const y = baselineY - norm * plotHeight;
          targetPoints.push({ x, y });
        }

        if (targetPoints.length > 1) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(targetPoints[0].x, targetPoints[0].y);
          for (let i = 0; i < targetPoints.length - 1; i++) {
            const xc = (targetPoints[i].x + targetPoints[i + 1].x) / 2;
            const yc = (targetPoints[i].y + targetPoints[i + 1].y) / 2;
            ctx.quadraticCurveTo(targetPoints[i].x, targetPoints[i].y, xc, yc);
          }
          ctx.lineTo(targetPoints[targetPoints.length - 1].x, targetPoints[targetPoints.length - 1].y);

          ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
          ctx.lineWidth = 1.75;
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = 6;
          ctx.setLineDash([5, 3]);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 6. Render Reference Track Overlay (Zarte lila Konturlinie #c084fc mit Glow)
      if (showReference && effectiveRefBands && effectiveRefBands.length > 0) {
        const refPoints: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < numBands; i++) {
          const rawDb = effectiveRefBands[i] ?? minDb;
          const adjustedDb = Math.max(minDb, Math.min(maxDb, rawDb + effectiveGainOffset));
          const norm = Math.max(0, Math.min(1, (adjustedDb - minDb) / (maxDb - minDb)));
          const x = plotLeft + i * bandSlotWidth + barWidth / 2;
          const y = baselineY - norm * plotHeight;
          refPoints.push({ x, y });
        }

        if (refPoints.length > 1) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(refPoints[0].x, refPoints[0].y);
          for (let i = 0; i < refPoints.length - 1; i++) {
            const xc = (refPoints[i].x + refPoints[i + 1].x) / 2;
            const yc = (refPoints[i].y + refPoints[i + 1].y) / 2;
            ctx.quadraticCurveTo(refPoints[i].x, refPoints[i].y, xc, yc);
          }
          ctx.lineTo(refPoints[refPoints.length - 1].x, refPoints[refPoints.length - 1].y);

          ctx.strokeStyle = '#c084fc';
          ctx.lineWidth = 1.75;
          ctx.shadowColor = '#c084fc';
          ctx.shadowBlur = 6;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 7. RTA Live Signal Render: LED Mode vs Spline Mode
      if (viewMode === 'led') {
        // SEGMENTED LED MODE (Vintage Hardware / HiFi Rack EQ Look)
        // Segment height: 3px, gap: 1px -> step: 4px
        const segmentHeight = 3;
        const segmentStep = 4;
        const totalSegments = Math.floor(plotHeight / segmentStep);

        for (let i = 0; i < numBands; i++) {
          const currentDb = Math.max(minDb, Math.min(maxDb, liveBands[i] ?? minDb));
          const targetDb = targetCurve32[i] ?? -30;
          const deltaDb = currentDb - targetDb;

          const norm = Math.max(0, Math.min(1, (currentDb - minDb) / (maxDb - minDb)));
          const activeSegments = Math.round(norm * totalSegments);
          const x = plotLeft + i * bandSlotWidth;

          // Heatmap Color Selection:
          // Default: Cyan/Emerald (#06b6d4 to #0891b2)
          // If deltaDb > 2.0 dB: Amber (#f59e0b)
          // If deltaDb > 3.5 dB: Red/Rose (#f43f5e)
          let activeColor: string;
          if (deltaDb > 3.5) {
            activeColor = '#f43f5e';
          } else if (deltaDb > 2.0) {
            activeColor = '#f59e0b';
          } else {
            activeColor = '#06b6d4';
          }

          // Render segments from bottom to top
          for (let s = 0; s < totalSegments; s++) {
            const segY = baselineY - (s + 1) * segmentStep;

            if (s < activeSegments) {
              // Active illuminated LED segment
              if (deltaDb <= 2.0) {
                // Subtle gradient towards brighter cyan at the top of the column
                const sRatio = s / Math.max(1, activeSegments);
                ctx.fillStyle = sRatio > 0.8 ? '#22d3ee' : sRatio > 0.4 ? '#06b6d4' : '#0891b2';
              } else {
                ctx.fillStyle = activeColor;
              }
              ctx.fillRect(x, segY, barWidth, segmentHeight);
            } else {
              // Inactive ghost LED (Hardware VFD/LED Rack Matrix feeling)
              ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
              ctx.fillRect(x, segY, barWidth, segmentHeight);
            }
          }

          // Peak-Hold Floating Segment Cap (3px height)
          const peak = peaksRef.current[i];
          if (peak.db > minDb + 3) {
            const peakNorm = Math.max(0, Math.min(1, (peak.db - minDb) / (maxDb - minDb)));
            const peakSeg = Math.min(totalSegments - 1, Math.max(0, Math.round(peakNorm * totalSegments)));
            const peakY = baselineY - (peakSeg + 1) * segmentStep;
            const peakDelta = peak.db - targetDb;

            ctx.fillStyle = peakDelta > 3.5 ? '#f43f5e' : '#f59e0b';
            ctx.fillRect(x, peakY, barWidth, segmentHeight);
          }

          // Subtle Floor Reflection below baseline (opacity 0.2 -> 0.0 over 15px)
          if (activeSegments > 0) {
            const reflH = Math.min(15, activeSegments * 1.5);
            ctx.save();
            const reflectGrad = ctx.createLinearGradient(0, baselineY, 0, baselineY + reflH);
            reflectGrad.addColorStop(0, 'rgba(6, 182, 212, 0.20)');
            reflectGrad.addColorStop(1, 'rgba(6, 182, 212, 0.00)');
            ctx.fillStyle = reflectGrad;
            ctx.fillRect(x, baselineY + 1, barWidth, reflH);
            ctx.restore();
          }
        }
      } else if (viewMode === 'highres') {
        // [ ⚡ High-Res ] MODE (AudioMotion Minimal Ästhetik — 128 Nadeln)
        const live128 = latest128BandsRef.current;
        const paddingLeft = plotLeft;
        const usableWidth = plotWidth;
        const needleWidth = Math.max(1.5, Math.min(2.0, (usableWidth / 128) - 1.0));

        // Create vertical needle gradient from baselineY (-60 dB) to topY (0 dB)
        // Unten: Gesundes Neon-Grün (#22c55e)
        // Mitte (-24 dB bis -12 dB): Warmes Gelb/Bernstein (#eab308 bis #f59e0b)
        // Spitze (> -6 dB): Signal-Rot (#ef4444)
        const needleGrad = ctx.createLinearGradient(0, baselineY, 0, topY);
        needleGrad.addColorStop(0.0, '#22c55e');   // -60 dB (Neon-Grün)
        needleGrad.addColorStop(0.5, '#4ade80');   // -30 dB (Grün-Hell)
        needleGrad.addColorStop(0.60, '#eab308');  // -24 dB (Warmes Gelb)
        needleGrad.addColorStop(0.80, '#f59e0b');  // -12 dB (Bernstein)
        needleGrad.addColorStop(0.90, '#ef4444');  // -6 dB (Signal-Rot)
        needleGrad.addColorStop(1.0, '#dc2626');   // 0 dB (Tiefrot)

        // Phosphor Glow-Effekt
        ctx.save();
        ctx.shadowBlur = 3;
        ctx.shadowColor = '#22c55e';
        ctx.fillStyle = needleGrad;

        for (let i = 0; i < 128; i++) {
          const currentDb = Math.max(-60, Math.min(0, live128[i] ?? -60));
          const norm = (currentDb - (-60)) / 60.0;
          const needleHeight = norm * plotHeight;
          const x = paddingLeft + (i / 127.0) * usableWidth;
          const needleY = baselineY - needleHeight;

          ctx.fillRect(x - needleWidth / 2, needleY, needleWidth, needleHeight);
        }
        ctx.restore();

        // Peak-Hold Sparkle Dots (128 schwebende Nadelköpfe)
        // Bei neuem Maximalwert: peak.db = currentDb; peak.holdFrames = 12;
        // Nach Haltezeit: Absinken mit 1.5 dB pro Frame
        for (let i = 0; i < 128; i++) {
          const currentDb = Math.max(-60, Math.min(0, live128[i] ?? -60));
          const peak = highResPeaksRef.current[i];
          if (currentDb > peak.db) {
            peak.db = currentDb;
            peak.holdFrames = 12;
          } else if (peak.holdFrames > 0) {
            peak.holdFrames--;
          } else {
            peak.db = Math.max(-60, peak.db - 1.5);
          }

          if (peak.db > -58) {
            const peakNorm = (peak.db - (-60)) / 60.0;
            const peakY = baselineY - peakNorm * plotHeight;
            const x = paddingLeft + (i / 127.0) * usableWidth;

            ctx.save();
            ctx.shadowBlur = 4;
            ctx.shadowColor = peak.db > -6 ? '#ef4444' : peak.db > -18 ? '#f59e0b' : '#22c55e';
            ctx.fillStyle = peak.db > -6 ? '#fca5a5' : peak.db > -18 ? '#fef08a' : '#ffffff';
            ctx.fillRect(x - 1, peakY - 2, 2, 2);
            ctx.restore();
          }
        }

        // Boden-Reflexion: Feine, nach unten invertierte Nadel-Reflexion (10 px Höhe mit abfallender Deckkraft 0.25 -> 0.0)
        ctx.save();
        const reflGrad = ctx.createLinearGradient(0, baselineY, 0, baselineY + 10);
        reflGrad.addColorStop(0.0, 'rgba(34, 197, 94, 0.25)');
        reflGrad.addColorStop(1.0, 'rgba(34, 197, 94, 0.00)');
        ctx.fillStyle = reflGrad;

        for (let i = 0; i < 128; i++) {
          const currentDb = Math.max(-60, Math.min(0, live128[i] ?? -60));
          const norm = (currentDb - (-60)) / 60.0;
          if (norm > 0.05) {
            const reflH = Math.min(10, norm * 10);
            const x = paddingLeft + (i / 127.0) * usableWidth;
            ctx.fillRect(x - needleWidth / 2, baselineY + 1, needleWidth, reflH);
          }
        }
        ctx.restore();
      } else {
        // MODERN SPLINE MODE (FabFilter Smooth Bezier Curve with Translucent Fill)
        const splinePoints: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < numBands; i++) {
          const currentDb = Math.max(minDb, Math.min(maxDb, liveBands[i] ?? minDb));
          const norm = Math.max(0, Math.min(1, (currentDb - minDb) / (maxDb - minDb)));
          const x = plotLeft + i * bandSlotWidth + barWidth / 2;
          const y = baselineY - norm * plotHeight;
          splinePoints.push({ x, y });
        }

        if (splinePoints.length > 1) {
          // Fill path under spline
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(splinePoints[0].x, baselineY);
          ctx.lineTo(splinePoints[0].x, splinePoints[0].y);
          for (let i = 0; i < splinePoints.length - 1; i++) {
            const xc = (splinePoints[i].x + splinePoints[i + 1].x) / 2;
            const yc = (splinePoints[i].y + splinePoints[i + 1].y) / 2;
            ctx.quadraticCurveTo(splinePoints[i].x, splinePoints[i].y, xc, yc);
          }
          ctx.lineTo(splinePoints[splinePoints.length - 1].x, splinePoints[splinePoints.length - 1].y);
          ctx.lineTo(splinePoints[splinePoints.length - 1].x, baselineY);
          ctx.closePath();

          const fillGrad = ctx.createLinearGradient(0, topY, 0, baselineY);
          fillGrad.addColorStop(0, 'rgba(6, 182, 212, 0.40)');
          fillGrad.addColorStop(0.5, 'rgba(13, 148, 136, 0.20)');
          fillGrad.addColorStop(1, 'rgba(4, 47, 46, 0.02)');
          ctx.fillStyle = fillGrad;
          ctx.fill();

          // Spline Contour Stroke with Glow
          ctx.beginPath();
          ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
          for (let i = 0; i < splinePoints.length - 1; i++) {
            const xc = (splinePoints[i].x + splinePoints[i + 1].x) / 2;
            const yc = (splinePoints[i].y + splinePoints[i + 1].y) / 2;
            ctx.quadraticCurveTo(splinePoints[i].x, splinePoints[i].y, xc, yc);
          }
          ctx.lineTo(splinePoints[splinePoints.length - 1].x, splinePoints[splinePoints.length - 1].y);
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 2;
          ctx.shadowColor = '#06b6d4';
          ctx.shadowBlur = 8;
          ctx.stroke();
          ctx.restore();

          // Peak-Hold needle indicators for Spline mode
          for (let i = 0; i < numBands; i++) {
            const peak = peaksRef.current[i];
            if (peak.db > minDb + 3) {
              const peakNorm = Math.max(0, Math.min(1, (peak.db - minDb) / (maxDb - minDb)));
              const peakY = baselineY - peakNorm * plotHeight;
              const x = plotLeft + i * bandSlotWidth;
              const targetDb = targetCurve32[i] ?? -30;
              const peakDelta = peak.db - targetDb;

              ctx.fillStyle = peakDelta > 3.5 ? '#f43f5e' : '#f59e0b';
              ctx.fillRect(x, peakY, barWidth, 2);
            }
          }
        }
      }

      // 8. Frequency Axis Labels at the bottom
      ctx.fillStyle = '#64748b';
      ctx.font = '9px "JetBrains Mono", monospace';
      for (let i = 0; i < numBands; i++) {
        if (i % 4 === 0 || i === numBands - 1) {
          const x = plotLeft + i * bandSlotWidth;
          ctx.fillText(CENTER_FREQ_LABELS[i] ?? '', x - 2, height - 8);
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [viewMode, showTargetEnvelope, showReference, targetCurve32, effectiveRefBands, isGainMatchEnabled, liveLufs, activeReference]);

  // Keep display gain offset state updated
  useEffect(() => {
    setDisplayGainOffset(smoothedGainOffsetRef.current);
  }, [smoothedGainOffsetRef.current]);

  // Handle adaptation proposal generation
  const handleAdaptToReference = () => {
    if (!activeReference || !onGenerateProposal) return;
    setIsAdapting(true);
    try {
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
          frequencyBands: latestSpectrumRef.current,
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
    } catch (err) {
      console.error('Failed to generate reference match proposal', err);
    } finally {
      setIsAdapting(false);
    }
  };

  const hasReference = Boolean(effectiveRefBands && effectiveRefBands.length > 0);

  return (
    <div className="bg-[#12151a] border border-[#1e242d] rounded-xl p-4 shadow-xl flex flex-col gap-3">
      {/* Header with Title, Reference Selector and View Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1e242d] pb-2.5">
        {/* Title & Badge */}
        <div className="flex items-center gap-2 shrink-0">
          <Music className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
            {viewMode === 'highres' ? 'Real-Time Spectrum (FFT — 128 Needles)' : 'Real-Time Spectrum (RTA — 32 Bands)'}
          </span>
          <span className="text-[10px] bg-cyan-950/60 text-cyan-300 border border-cyan-800/50 px-1.5 py-0.5 rounded font-mono font-bold">
            30 FPS LIVE
          </span>
        </div>

        {/* Action Controls & Toggles */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* 3-Tab View Mode Toggle: 32 LED / High-Res / Spline */}
          <div className="flex items-center bg-[#0d1117] p-0.5 rounded-lg border border-[#21262d]">
            <button
              type="button"
              onClick={() => setViewMode('led')}
              className={`px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-xs font-mono font-medium rounded transition-all flex items-center gap-1 sm:gap-1.5 ${
                viewMode === 'led'
                  ? 'bg-[#161b22] text-cyan-400 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Segmentierte Hardware-LED Matrix (32 Bänder)"
            >
              <span>▦</span> 32 LED
            </button>
            <button
              type="button"
              onClick={() => setViewMode('highres')}
              className={`px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-xs font-mono font-medium rounded transition-all flex items-center gap-1 sm:gap-1.5 ${
                viewMode === 'highres'
                  ? 'bg-[#161b22] text-emerald-400 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="High-Resolution FFT Spektrum (128 Nadeln mit Phosphor-Glow)"
            >
              <span>⚡</span> High-Res
            </button>
            <button
              type="button"
              onClick={() => setViewMode('spline')}
              className={`px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-xs font-mono font-medium rounded transition-all flex items-center gap-1 sm:gap-1.5 ${
                viewMode === 'spline'
                  ? 'bg-[#161b22] text-cyan-400 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Glatte Studio-Spline Kurve"
            >
              <span>〰</span> Spline
            </button>
          </div>

          {/* Target Envelope Toggle */}
          <button
            type="button"
            onClick={() => setShowTargetEnvelope(!showTargetEnvelope)}
            className={`px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-xs font-mono font-medium rounded-lg border transition-all flex items-center gap-1 sm:gap-1.5 ${
              showTargetEnvelope
                ? 'bg-sky-950/40 text-sky-300 border-sky-500/50 shadow-[0_0_10px_rgba(56,189,248,0.2)]'
                : 'bg-[#0d1117] text-slate-500 border-[#21262d] hover:text-slate-300'
            }`}
            title="Soll-Hüllkurve ein/ausblenden"
          >
            <span>🎯</span> Soll-Kurve
          </button>

          {/* Reference Curve Toggle */}
          <button
            type="button"
            disabled={!hasReference}
            onClick={() => setShowReference(!showReference)}
            className={`px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-xs font-mono font-medium rounded-lg border transition-all flex items-center gap-1 sm:gap-1.5 ${
              !hasReference
                ? 'bg-[#0d1117] text-slate-600 border-[#21262d] opacity-50 cursor-not-allowed'
                : showReference
                ? 'bg-purple-950/40 text-purple-300 border-purple-500/50 shadow-[0_0_10px_rgba(192,132,252,0.2)]'
                : 'bg-[#0d1117] text-slate-500 border-[#21262d] hover:text-slate-300'
            }`}
            title={hasReference ? 'Referenzkurve ein/ausblenden' : 'Keine Referenz geladen'}
          >
            <span>📊</span> Referenz
          </button>

          {/* Legende Button & Popover */}
          <div className="relative" ref={legendRef}>
            <button
              type="button"
              onClick={() => setIsLegendOpen(!isLegendOpen)}
              className={`px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-xs rounded-lg border transition-all flex items-center gap-1 sm:gap-1.5 cursor-pointer ${
                isLegendOpen 
                  ? 'bg-slate-700 text-cyan-300 border-cyan-500/50 shadow-sm' 
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
              title="Farblegende und Analyse-Erklärung öffnen"
            >
              <span>ℹ️</span>
              <span>Legende</span>
              <span className="text-[10px] text-slate-400">{isLegendOpen ? '▲' : '▼'}</span>
            </button>

            {isLegendOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 md:w-96 bg-slate-900/95 border border-slate-700 rounded-xl shadow-2xl p-4 text-xs backdrop-blur-md space-y-3 z-50 text-slate-200">
                {/* Kopfbereich */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2 font-semibold text-slate-100 text-sm">
                    <span className="text-cyan-400">📊</span>
                    <span>Spektral- & Heatmap-Legende</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsLegendOpen(false)}
                    className="p-1 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
                    title="Schließen"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Sektion 1: 32 LED & Spline Heatmap */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">
                    32 LED & Spline Heatmap
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-2">
                      <span className="w-3 h-3 rounded-full bg-[#06b6d4] shadow-[0_0_8px_rgba(6,182,212,0.7)] shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-cyan-300">Cyan: </span>
                        <span>Sollbereich / Ausgewogen (innerhalb Zielkorridor)</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-3 h-3 rounded-full bg-[#f59e0b] shadow-[0_0_8px_rgba(245,158,11,0.7)] shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-amber-300">Bernstein: </span>
                        <span>+2.0 dB über Soll (leichte Überhöhung / Dichte)</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-3 h-3 rounded-full bg-[#f43f5e] shadow-[0_0_8px_rgba(244,63,94,0.7)] shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-rose-300">Signal-Rot: </span>
                        <span>&gt; +3.5 dB über Soll (Kritische Maskierung / Resonanz)</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-3 h-1.5 rounded-full bg-amber-400 border border-rose-500 shadow-[0_0_6px_rgba(251,191,36,0.7)] shrink-0 mt-1.5" />
                      <div>
                        <span className="font-semibold text-amber-200">Schwebende Kappe: </span>
                        <span>Spitzenpegel (Peak-Hold mit 500 ms Fall)</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-3 h-3 rounded-full bg-white/5 border border-white/10 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-slate-400">Dunkelgrau: </span>
                        <span>Inaktive Geister-LEDs (Display-Headroom)</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sektion 2: High-Res Modus (128 Nadeln) */}
                <div className="space-y-1.5 border-t border-slate-800/80 pt-2">
                  <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">
                    High-Res Modus (128 Nadeln)
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-2">
                      <span className="w-3 h-3 rounded-full bg-gradient-to-t from-emerald-500 via-amber-500 to-rose-500 shrink-0 mt-0.5 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                      <div>
                        <span className="font-semibold text-emerald-300">Grün → Bernstein → Rot: </span>
                        <span>Vertikaler Pegelgradient (-60 dB bis 0 dB)</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-2 h-2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)] shrink-0 ml-0.5 mt-1" />
                      <div>
                        <span className="font-semibold text-slate-100">Sparkle Dots: </span>
                        <span>Schwebende Transienten-Spitzen</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sektion 3: Overlays */}
                <div className="space-y-1.5 border-t border-slate-800/80 pt-2">
                  <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">
                    Overlays
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-2">
                      <span className="w-3.5 h-0.5 bg-sky-400 border-b border-dashed border-sky-300 shadow-[0_0_6px_rgba(56,189,248,0.8)] shrink-0 mt-2" />
                      <div>
                        <span className="font-semibold text-sky-300">Cyan gestrichelt: </span>
                        <span>
                          Soll-Envelope (Genre: {targetProfile?.name ?? 'Pop / Modern Radio'} / Scope: {targetProfile?.targetScope ?? 'Master'})
                        </span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-3 h-3 rounded-full bg-[#c084fc] shadow-[0_0_8px_rgba(192,132,252,0.7)] shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-purple-300">Lila Linie: </span>
                        <span>Referenz-Track Spektrum</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Reference Track Dropdown Selector */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-1 sm:gap-1.5 bg-[#161b22] hover:bg-[#1f242c] border border-[#2d333b] px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg text-[11px] sm:text-xs font-mono text-slate-300 transition-colors"
            >
              <span className="truncate max-w-[120px]">
                {activeReference ? activeReference.name : 'Keine Referenz'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 mt-1 w-64 bg-[#161b22] border border-[#2d333b] rounded-lg shadow-2xl z-50 py-1 font-mono text-xs max-h-60 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => {
                    onSelectReference(null);
                    setIsDropdownOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#1f242c] text-slate-400 hover:text-slate-200 flex items-center justify-between"
                >
                  <span>Keine Referenz</span>
                  {!activeReference && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                </button>

                {savedReferences.length > 0 && <div className="border-t border-[#2d333b] my-1" />}

                {savedReferences.map((summary) => (
                  <button
                    key={summary.id}
                    type="button"
                    onClick={() => handleSelectSummary(summary)}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#1f242c] text-slate-300 hover:text-white flex items-center justify-between group"
                  >
                    <div className="truncate pr-2">
                      <div className="font-medium truncate">{summary.name}</div>
                      <div className="text-[10px] text-slate-500">
                        {summary.integratedLufs.toFixed(1)} LUFS · Crest {summary.crestFactorDb.toFixed(1)} dB
                      </div>
                    </div>
                    {activeReference?.id === summary.id && (
                      <Check className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                    )}
                  </button>
                ))}

                <div className="border-t border-[#2d333b] my-1" />
                <button
                  type="button"
                  onClick={() => {
                    setIsDropdownOpen(false);
                    onOpenReferenceModal();
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-cyan-950/40 text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 font-sans font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Referenz importieren...</span>
                </button>
              </div>
            )}
          </div>

          {/* Gain Matching Toggle & Action Buttons */}
          {activeReference && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsGainMatchEnabled(!isGainMatchEnabled)}
                className={`p-1.5 rounded-lg border transition-colors ${
                  isGainMatchEnabled
                    ? 'bg-cyan-950/40 text-cyan-400 border-cyan-800/60'
                    : 'bg-[#161b22] text-slate-500 border-[#2d333b]'
                }`}
                title={`Gain-Matching (Pegelanpassung): ${
                  isGainMatchEnabled
                    ? `Aktiv (${displayGainOffset >= 0 ? '+' : ''}${displayGainOffset.toFixed(1)} dB)`
                    : 'Inaktiv'
                }`}
              >
                <Scale className="w-3.5 h-3.5" />
              </button>

              {onGenerateProposal && (
                <button
                  type="button"
                  onClick={handleAdaptToReference}
                  disabled={isAdapting}
                  className="flex items-center gap-1 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white font-medium px-2 py-1 rounded-lg text-xs shadow-md transition-all disabled:opacity-50"
                  title="Erzeuge EQ-Vorschlag zur spektralen Anpassung an die Referenz"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>Anpassen</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onSelectReference(null)}
                className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                title="Referenz abwählen"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* HTML5 Canvas RTA */}
      <div className="relative w-full aspect-[28/9] min-h-[200px] max-h-[320px]">
        <canvas
          ref={canvasRef}
          width={840}
          height={270}
          className="w-full h-full block rounded-lg bg-[#101317] border border-[#1b2028]"
        />
      </div>

      {/* Legend & Telemetry Metadata Footer */}
      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-mono pt-1 px-1">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-sm ${
              viewMode === 'highres'
                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.6)]'
                : 'bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.6)]'
            }`} />
            <span>{viewMode === 'highres' ? '128 FFT Nadeln' : 'Live Mix (30 fps)'}</span>
          </div>

          {showTargetEnvelope && (
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
              <span className="text-sky-300">
                Soll-Envelope ({targetProfile?.name ?? 'Standard'})
              </span>
            </div>
          )}

          {hasReference && showReference && (
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 bg-purple-400 shadow-[0_0_6px_rgba(192,132,252,0.8)]" />
              <span className="text-purple-300">
                Referenz: {activeReference?.name ?? 'Custom'}
                {isGainMatchEnabled && (
                  <span className="text-slate-500 text-[10px] ml-1">
                    ({displayGainOffset >= 0 ? '+' : ''}
                    {displayGainOffset.toFixed(1)} dB Offset)
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        <div className="text-[10px] text-slate-500 font-mono">
          {viewMode === 'highres' ? '128 Log-Bänder (20 Hz - 20 kHz) · Phosphor Glow' : 'ISO 1/3 Octave (20 Hz - 20 kHz)'}
        </div>
      </div>
    </div>
  );
};
