import type { ReferenceTrackProfile } from '@mixing-buddy/shared-types';

export const CENTER_FREQUENCIES = [
  20, 25, 31.5, 40, 50, 63, 80, 100,
  125, 160, 200, 250, 315, 400, 500, 630,
  800, 1000, 1200, 1600, 2000, 2500, 3150, 4000,
  5000, 6300, 8000, 10000, 12500, 16000, 18000, 20000
];

/**
 * Analyzes decoded Web Audio AudioBuffer and extracts metrology, loudest 10s Chorus window,
 * and 32-band FFT frequency envelope.
 */
export function analyzeAudioBuffer(
  audioBuffer: AudioBuffer,
  fileName: string
): Omit<ReferenceTrackProfile, 'id' | 'timestamp'> {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const durationSec = audioBuffer.duration;

  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = numChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
  const totalSamples = ch0.length;

  // 1. True Peak / Peak dBFS & RMS computation in 100ms blocks
  let maxAbs = 0;
  let sumSquares = 0;

  const blockSize = Math.max(1, Math.floor(sampleRate * 0.1));
  const numBlocks = Math.floor(totalSamples / blockSize);
  const blockPowers: number[] = new Array(numBlocks);

  for (let b = 0; b < numBlocks; b++) {
    let blockSum = 0;
    const start = b * blockSize;
    const end = Math.min(start + blockSize, totalSamples);
    const count = end - start;

    for (let i = start; i < end; i++) {
      const s0 = ch0[i];
      const s1 = ch1[i];
      const abs0 = Math.abs(s0);
      const abs1 = Math.abs(s1);
      if (abs0 > maxAbs) maxAbs = abs0;
      if (abs1 > maxAbs) maxAbs = abs1;

      // Mono average power
      const mono = (s0 + s1) * 0.5;
      const sq = mono * mono;
      blockSum += sq;
      sumSquares += sq;
    }

    blockPowers[b] = blockSum / Math.max(1, count);
  }

  const peakDb = 20 * Math.log10(Math.max(1e-5, maxAbs));
  const overallRms = Math.sqrt(sumSquares / Math.max(1, totalSamples));
  const rmsDb = 20 * Math.log10(Math.max(1e-5, overallRms));

  // ITU-R BS.1770 gating approximation: discard blocks below -70 LUFS
  const absThreshold = Math.pow(10, (-70 + 0.691) / 10);
  let gatedSum = 0;
  let gatedCount = 0;

  for (let b = 0; b < numBlocks; b++) {
    if (blockPowers[b] >= absThreshold) {
      gatedSum += blockPowers[b];
      gatedCount++;
    }
  }

  const integratedLufs = gatedCount > 0
    ? -0.691 + 10 * Math.log10(Math.max(1e-7, gatedSum / gatedCount))
    : rmsDb;

  const crestFactorDb = Math.max(3.0, Math.min(24.0, peakDb - rmsDb));

  // 2. Loudest 10-second window (Chorus Detection)
  const blocksIn10Sec = Math.max(1, Math.floor(10.0 / 0.1));
  let maxWindowSum = 0;
  let bestWindowBlockIndex = 0;

  let currentWindowSum = 0;
  for (let b = 0; b < Math.min(blocksIn10Sec, numBlocks); b++) {
    currentWindowSum += blockPowers[b];
  }
  maxWindowSum = currentWindowSum;

  for (let b = blocksIn10Sec; b < numBlocks; b++) {
    currentWindowSum += blockPowers[b] - blockPowers[b - blocksIn10Sec];
    if (currentWindowSum > maxWindowSum) {
      maxWindowSum = currentWindowSum;
      bestWindowBlockIndex = b - blocksIn10Sec + 1;
    }
  }

  const chorusStartSec = bestWindowBlockIndex * 0.1;
  const chorusEndSec = Math.min(durationSec, chorusStartSec + 10.0);

  // 3. Compute 32-Band FFT-Hüllkurve across the Chorus window
  const frequencyBands = calculate32BandEnvelope(
    ch0,
    ch1,
    sampleRate,
    chorusStartSec,
    chorusEndSec
  );

  const ext = fileName.split('.').pop()?.toUpperCase() ?? 'AUDIO';
  const cleanName = fileName.replace(/\.[^/.]+$/, '');

  return {
    name: cleanName,
    fileName,
    fileFormat: ext,
    durationSeconds: durationSec,
    sampleRate,
    channels: numChannels,
    integratedLufs: Math.round(integratedLufs * 10) / 10,
    truePeakDb: Math.round(peakDb * 10) / 10,
    crestFactorDb: Math.round(crestFactorDb * 10) / 10,
    frequencyBands,
    chorusWindow: {
      startSec: Math.round(chorusStartSec * 10) / 10,
      endSec: Math.round(chorusEndSec * 10) / 10
    }
  };
}

/**
 * Calculates 32-band energy envelope across the 10-second Chorus segment
 */
export function calculate32BandEnvelope(
  ch0: Float32Array,
  ch1: Float32Array,
  sampleRate: number,
  startSec: number,
  endSec: number
): number[] {
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(ch0.length, Math.floor(endSec * sampleRate));
  const segmentLength = endSample - startSample;

  if (segmentLength <= 0) {
    return new Array(32).fill(-70);
  }

  const factor = Math.pow(2, 1 / 6);
  const bandLimits = CENTER_FREQUENCIES.map((fc) => ({
    low: fc / factor,
    high: fc * factor
  }));

  const fftSize = 4096;
  const numSlices = 20;
  const step = Math.max(1, Math.floor((segmentLength - fftSize) / numSlices));

  const bandEnergies = new Float64Array(32);
  let validSlices = 0;

  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);

  for (let s = 0; s < numSlices; s++) {
    const offset = startSample + s * step;
    if (offset + fftSize > ch0.length) break;

    // Apply Hann window and combine stereo to mono
    for (let i = 0; i < fftSize; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
      const mono = (ch0[offset + i] + ch1[offset + i]) * 0.5;
      real[i] = mono * w;
      imag[i] = 0;
    }

    computeFFT(real, imag);

    for (let b = 0; b < 32; b++) {
      const { low, high } = bandLimits[b];
      const minBin = Math.max(1, Math.floor((low * fftSize) / sampleRate));
      const maxBin = Math.min(fftSize / 2 - 1, Math.ceil((high * fftSize) / sampleRate));

      let bandSum = 0;
      let binCount = 0;

      for (let k = minBin; k <= maxBin; k++) {
        const mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
        bandSum += mag;
        binCount++;
      }

      if (binCount > 0) {
        bandEnergies[b] += bandSum / binCount;
      }
    }

    validSlices++;
  }

  const result: number[] = new Array(32);
  const scale = 2.0 / (fftSize * Math.max(1, validSlices));

  for (let b = 0; b < 32; b++) {
    const avgMag = bandEnergies[b] * scale;
    const db = 20 * Math.log10(Math.max(1e-5, avgMag));
    result[b] = Math.round(Math.max(-70, Math.min(0, db)) * 10) / 10;
  }

  return result;
}

/**
 * Standard Radix-2 In-place Cooley-Tukey Fast Fourier Transform
 */
export function computeFFT(real: Float64Array, imag: Float64Array) {
  const n = real.length;

  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wr = 1.0;
      let wi = 0.0;
      for (let k = 0; k < half; k++) {
        const uR = real[i + k];
        const uI = imag[i + k];
        const vR = real[i + k + half] * wr - imag[i + k + half] * wi;
        const vI = real[i + k + half] * wi + imag[i + k + half] * wr;

        real[i + k] = uR + vR;
        imag[i + k] = uI + vI;
        real[i + k + half] = uR - vR;
        imag[i + k + half] = uI - vI;

        const nextWr = wr * wStepR - wi * wStepI;
        wi = wr * wStepI + wi * wStepR;
        wr = nextWr;
      }
    }
  }
}

export function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function drawStaticEnvelope(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bands: number[]
) {
  ctx.fillStyle = '#0f1217';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#1e2430';
  ctx.lineWidth = 1;
  [-12, -24, -36, -48].forEach((db) => {
    const y = ((0 - db) / 70.0) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });

  const numBands = bands.length;
  const barWidth = Math.max(2, w / numBands - 2);

  for (let i = 0; i < numBands; i++) {
    const db = Math.max(-70, Math.min(0, bands[i]));
    const barHeight = ((db + 70) / 70.0) * h;
    const x = i * (w / numBands) + 1;
    const y = h - barHeight;

    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, '#3b82f6');
    grad.addColorStop(0.7, '#60a5fa');
    grad.addColorStop(1, '#a855f7');

    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barWidth, barHeight);

    ctx.fillStyle = '#c084fc';
    ctx.fillRect(x, y, barWidth, 2);
  }
}

export function drawLiveSpectrum(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  analyser: AnalyserNode,
  sampleRate: number
) {
  ctx.fillStyle = '#0f1217';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#1e2430';
  ctx.lineWidth = 1;
  [-12, -24, -36, -48].forEach((db) => {
    const y = ((0 - db) / 70.0) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });

  const freqData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqData);

  const fftSize = analyser.fftSize;
  const numBands = CENTER_FREQUENCIES.length;
  const barWidth = Math.max(2, w / numBands - 2);

  for (let i = 0; i < numBands; i++) {
    const fc = CENTER_FREQUENCIES[i];
    const bin = Math.min(
      freqData.length - 1,
      Math.max(1, Math.round((fc * fftSize) / sampleRate))
    );
    const val = freqData[bin] / 255.0;
    const barHeight = Math.max(3, val * h);
    const x = i * (w / numBands) + 1;
    const y = h - barHeight;

    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, '#10b981');
    grad.addColorStop(0.5, '#06b6d4');
    grad.addColorStop(1, '#a855f7');

    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barWidth, barHeight);

    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(x, y, barWidth, 2);
  }
}
