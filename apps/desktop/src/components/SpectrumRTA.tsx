import React, { useRef, useEffect } from 'react';
import type { MeterSpectrumData } from '@mixing-buddy/shared-types';

interface SpectrumRTAProps {
  spectrum?: MeterSpectrumData;
}

const CENTER_FREQS = [
  '20', '25', '31.5', '40', '50', '63', '80', '100',
  '125', '160', '200', '250', '315', '400', '500', '630',
  '800', '1k', '1.2k', '1.6k', '2k', '2.5k', '3.1k', '4k',
  '5k', '6.3k', '8k', '10k', '12.5k', '16k', '18k', '20k'
];

export const SpectrumRTA: React.FC<SpectrumRTAProps> = ({ spectrum }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear background
    ctx.fillStyle = '#121418';
    ctx.fillRect(0, 0, width, height);

    // Draw dB grid lines (-12, -24, -36, -48 dB)
    ctx.strokeStyle = '#22262e';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px sans-serif';

    const dbSteps = [-12, -24, -36, -48, -60];
    for (const db of dbSteps) {
      // Map dB (-70 to 0) to Y
      const y = ((0 - db) / 70.0) * (height - 30);
      ctx.beginPath();
      ctx.moveTo(35, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillText(`${db} dB`, 2, y + 3);
    }

    const bands = spectrum?.frequencyBands ?? new Array(32).fill(-70);
    const numBands = bands.length;
    const plotWidth = width - 45;
    const barWidth = Math.max(2, (plotWidth / numBands) - 3);

    // Draw Frequency Bars
    for (let i = 0; i < numBands; i++) {
      const db = Math.max(-70, Math.min(0, bands[i]));
      const norm = (db + 70) / 70; // 0.0 to 1.0
      const barHeight = norm * (height - 30);
      const x = 40 + i * (plotWidth / numBands);
      const y = height - 25 - barHeight;

      // Gradient for RTA bars
      const grad = ctx.createLinearGradient(0, height - 25, 0, 10);
      grad.addColorStop(0, '#1d4ed8');   // Deep blue bottom
      grad.addColorStop(0.6, '#3b82f6'); // Bright blue mid
      grad.addColorStop(0.9, '#38bdf8'); // Cyan high
      grad.addColorStop(1.0, '#f43f5e'); // Red peak threshold

      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barWidth, barHeight);

      // Peak hold indicator cap
      ctx.fillStyle = '#93c5fd';
      ctx.fillRect(x, y, barWidth, 2);

      // Draw frequency labels at bottom (every 4th band)
      if (i % 4 === 0 && i < CENTER_FREQS.length) {
        ctx.fillStyle = '#64748b';
        ctx.fillText(CENTER_FREQS[i], x - 4, height - 8);
      }
    }

    // Draw Spectral Resonances if detected
    if (spectrum?.spectralResonances && spectrum.spectralResonances.length > 0) {
      for (const res of spectrum.spectralResonances) {
        // Approximate x from frequency (20Hz to 20kHz logarithmic)
        const logMin = Math.log10(20);
        const logMax = Math.log10(20000);
        const logFreq = Math.log10(Math.max(20, Math.min(20000, res.frequencyHz)));
        const xRatio = (logFreq - logMin) / (logMax - logMin);
        const x = 40 + xRatio * plotWidth;

        // Draw warning marker
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(x, 18, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`${Math.round(res.frequencyHz)} Hz`, x - 18, 30);
      }
    }
  }, [spectrum]);

  return (
    <div className="bg-darkSurface border border-darkBorder rounded-lg p-4 shadow-lg flex flex-col">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-semibold tracking-wider text-slate-300 uppercase">
          Real-Time Spectrum (RTA — 32 Bands)
        </h3>
        <span className="text-xs text-slate-500 font-mono">1024-FFT Blackman-Harris</span>
      </div>
      <canvas
        ref={canvasRef}
        width={680}
        height={220}
        className="w-full h-auto rounded border border-darkBorder/60 bg-[#121418]"
      />
    </div>
  );
};
