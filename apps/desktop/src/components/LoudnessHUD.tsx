import React, { useEffect, useRef, useState } from 'react';
import type { MeterLoudnessData, MeterDynamicsData } from '@mixing-buddy/shared-types';
import { Activity, AlertTriangle, RotateCcw } from 'lucide-react';

interface LoudnessHUDProps {
  loudness?: MeterLoudnessData;
  dynamics?: MeterDynamicsData;
  targetLufs?: number;
}

export const LoudnessHUD: React.FC<LoudnessHUDProps> = ({
  loudness,
  dynamics,
  targetLufs = -14.0
}) => {
  const mom = loudness?.momentaryLufs ?? -70.0;
  const rawIntLufs = loudness?.integratedLufs ?? -70.0;
  const shortTerm = loudness?.shortTermLufs ?? mom;
  const peakL = loudness?.truePeakDb.left ?? -70.0;
  const peakR = loudness?.truePeakDb.right ?? -70.0;
  const maxPeak = Math.max(peakL, peakR);
  const correlation = dynamics?.stereoCorrelation ?? 1.0;
  const crest = dynamics?.crestFactorDb ?? 0.0;

  // Rolling EBU R128 Dual-Gated window (75 frames ≈ 3-5s rolling program window)
  // Prevents Integrated LUFS from freezing after minutes of looping in the DAW
  const gatedPowerWindowRef = useRef<number[]>([]);
  const silentFramesRef = useRef<number>(0);
  const [rollingIntLufs, setRollingIntLufs] = useState<number>(-70.0);

  useEffect(() => {
    if (!loudness) {
      gatedPowerWindowRef.current = [];
      silentFramesRef.current = 0;
      setRollingIntLufs(-70.0);
      return;
    }

    const m = loudness.momentaryLufs;
    if (m <= -68.0) {
      silentFramesRef.current += 1;
      // Auto-reset rolling window after ~1.5s of silence so next playback pass starts fresh
      if (silentFramesRef.current > 35) {
        gatedPowerWindowRef.current = [];
      }
      return;
    }

    silentFramesRef.current = 0;
    const blockPower = Math.pow(10, (m + 0.691) / 10);
    const windowArr = gatedPowerWindowRef.current;
    windowArr.push(blockPower);
    if (windowArr.length > 75) {
      windowArr.shift();
    }

    // EBU R128 Absolute Gate (-70 LUFS) + Relative Gate (-10 LU)
    const absGatePower = Math.pow(10, (-70.0 + 0.691) / 10);
    const aboveAbs = windowArr.filter((p) => p > absGatePower);
    if (aboveAbs.length === 0) {
      setRollingIntLufs(rawIntLufs);
      return;
    }

    const meanPower = aboveAbs.reduce((acc, v) => acc + v, 0) / aboveAbs.length;
    const relGatePower = meanPower * 0.1; // -10 LU below ungated mean
    const aboveRel = aboveAbs.filter((p) => p >= relGatePower);
    if (aboveRel.length > 0) {
      const gatedMean = aboveRel.reduce((acc, v) => acc + v, 0) / aboveRel.length;
      const computedLufs = -0.691 + 10 * Math.log10(gatedMean);
      setRollingIntLufs(computedLufs);
    } else {
      setRollingIntLufs(rawIntLufs);
    }
  }, [loudness, rawIntLufs]);

  const handleResetIntegrated = () => {
    gatedPowerWindowRef.current = [];
    setRollingIntLufs(mom > -65 ? mom : -70.0);
  };

  const intLufs = rollingIntLufs > -65 ? rollingIntLufs : rawIntLufs;

  // Convert LUFS to percentage (-60 to 0)
  const lufsToPercent = (val: number) => {
    const clamped = Math.max(-60, Math.min(0, val));
    return ((clamped + 60) / 60) * 100;
  };

  const isClipping = maxPeak > 0.0;
  const isNearLimit = maxPeak > -0.5 && !isClipping;

  return (
    <div className="bg-darkSurface border border-darkBorder rounded-lg p-4 shadow-lg flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold tracking-wider text-slate-300 uppercase flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" />
          EBU R128 Metrology & Dynamics
        </h3>
        <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
          Target: {targetLufs} LUFS
        </span>
      </div>

      {/* Dual Meters */}
      <div className="grid grid-cols-2 gap-4">
        {/* Momentary */}
        <div className="bg-[#121418] border border-darkBorder/60 p-3 rounded flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 uppercase font-medium">Momentary (400ms)</span>
            <span className="text-[10px] text-slate-500 font-mono">
              ST: {shortTerm > -65 ? `${shortTerm.toFixed(1)}` : '-INF'}
            </span>
          </div>
          <div className="text-2xl font-bold font-mono my-1 text-slate-100">
            {mom > -65 ? `${mom.toFixed(1)} LUFS` : '-INF'}
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden mt-1">
            <div
              className="h-full bg-blue-500 transition-all duration-75"
              style={{ width: `${lufsToPercent(mom)}%` }}
            />
          </div>
        </div>

        {/* Integrated */}
        <div className="bg-[#121418] border border-darkBorder/60 p-3 rounded flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 uppercase font-medium">Integrated (Gated)</span>
            <button
              type="button"
              onClick={handleResetIntegrated}
              title="Integrated Gated LUFS Messung zurücksetzen"
              className="text-slate-500 hover:text-slate-200 transition-colors p-0.5 rounded"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
          <div className="text-2xl font-bold font-mono my-1 text-emerald-400">
            {intLufs > -65 ? `${intLufs.toFixed(1)} LUFS` : '-INF'}
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden mt-1 relative">
            <div
              className="h-full bg-emerald-500 transition-all duration-150"
              style={{ width: `${lufsToPercent(intLufs)}%` }}
            />
            {/* Target line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-amber-400 shadow-sm"
              style={{ left: `${lufsToPercent(targetLufs)}%` }}
              title={`Target ${targetLufs} LUFS`}
            />
          </div>
        </div>
      </div>

      {/* True Peak & Stereo Correlation */}
      <div className="grid grid-cols-3 gap-3 text-center">
        {/* True Peak */}
        <div className={`p-2 rounded border ${isClipping ? 'bg-red-950/40 border-red-500 text-red-400' : isNearLimit ? 'bg-amber-950/40 border-amber-500 text-amber-400' : 'bg-[#121418] border-darkBorder/60 text-slate-200'}`}>
          <div className="text-[10px] text-slate-400 uppercase">Max True Peak</div>
          <div className="text-sm font-bold font-mono flex items-center justify-center gap-1 mt-0.5">
            {isClipping && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
            {maxPeak > -65 ? `${maxPeak.toFixed(1)} dBTP` : '-INF'}
          </div>
        </div>

        {/* Stereo Correlation */}
        <div className="bg-[#121418] border border-darkBorder/60 p-2 rounded text-slate-200">
          <div className="text-[10px] text-slate-400 uppercase">Correlation</div>
          <div className={`text-sm font-bold font-mono mt-0.5 ${correlation < 0 ? 'text-red-400' : 'text-slate-200'}`}>
            {correlation.toFixed(2)}
          </div>
        </div>

        {/* Crest Factor */}
        <div className="bg-[#121418] border border-darkBorder/60 p-2 rounded text-slate-200">
          <div className="text-[10px] text-slate-400 uppercase">Crest Factor</div>
          <div className="text-sm font-bold font-mono mt-0.5 text-slate-200">
            {crest.toFixed(1)} dB
          </div>
        </div>
      </div>
    </div>
  );
};
