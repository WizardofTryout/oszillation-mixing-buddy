/**
 * Metrology frame emitted by "The Ear" JUCE Meter Plugin over WebSocket (ws://127.0.0.1:48123/meter)
 */

export interface MeterLoudnessData {
  /** Momentary loudness (400 ms sliding rectangular window) in LUFS */
  momentaryLufs: number;
  /** Short-term loudness (3 s sliding rectangular window) in LUFS */
  shortTermLufs: number;
  /** Integrated loudness (EBU R128 gated measurement) in LUFS */
  integratedLufs: number;
  /** Loudness Range (LRA) in LU */
  loudnessRangeLu: number;
  /** 4x oversampled true peak in dBTP (L/R) */
  truePeakDb: {
    left: number;
    right: number;
  };
}

export interface MeterSpectrumData {
  /** Timestamp of FFT snapshot (epoch ms) */
  timestamp: number;
  /** 32 logarithmic frequency bin magnitudes (-100 dB to 0 dB) */
  frequencyBands: number[];
  /** Center frequencies for the 32 bands in Hz */
  centerFrequenciesHz: number[];
  /** Top detected spectral resonance peaks */
  spectralResonances: Array<{
    frequencyHz: number;
    magnitudeDb: number;
    qEstimate: number;
  }>;
}

export interface MeterDynamicsData {
  /** Stereo correlation coefficient (-1.0 to +1.0) */
  stereoCorrelation: number;
  /** Peak-to-RMS dynamic crest factor in dB */
  crestFactorDb: number;
  /** RMS power level in dBFS */
  rmsDb: {
    left: number;
    right: number;
  };
}

export interface MetrologyTelemetryFrame {
  version: '1.0';
  sequenceNumber: number;
  sampleRate: number;
  loudness: MeterLoudnessData;
  spectrum: MeterSpectrumData;
  dynamics: MeterDynamicsData;
}
