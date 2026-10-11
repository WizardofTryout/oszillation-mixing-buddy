import type {
  MetrologyTelemetryFrame,
  MixActionProposal,
  ParameterDelta,
  ReferenceTrackProfile,
  TrackDescriptor
} from '@mixing-buddy/shared-types';

export interface FrequencyDeviationZone {
  zoneIndex: number;
  startHz: number;
  endHz: number;
  centerHz: number;
  deltaDb: number;
  label: string;
  isExcess: boolean; // true if live mix is louder than reference (needs cut)
}

export interface SpectralDifferenceAnalysis {
  deltas: number[]; // 32 bands: Live - (Ref + GainOffset)
  maxAbsDeviationDb: number;
  deviantZones: FrequencyDeviationZone[];
  primaryDeviation: FrequencyDeviationZone | null;
}

// 32-band ISO center frequencies
const ISO_CENTER_FREQS = [
  20, 25, 31.5, 40, 50, 63, 80, 100,
  125, 160, 200, 250, 315, 400, 500, 630,
  800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
  5000, 6300, 8000, 10000, 12500, 16000, 18000, 20000
];

/**
 * 5 Musical Frequency Regions for grouped acoustic matching
 */
const MUSICAL_REGIONS = [
  { name: 'Sub-Bass', startHz: 20, endHz: 60, bandStart: 0, bandEnd: 4, eqParam: 'low_shelf_gain', eqFreq: 'low_shelf_frequency', defaultFreq: 45 },
  { name: 'Bass & Kick', startHz: 60, endHz: 250, bandStart: 5, bandEnd: 11, eqParam: 'peak_1_gain', eqFreq: 'peak_1_frequency', defaultFreq: 110 },
  { name: 'Low-Mid / Mud', startHz: 250, endHz: 800, bandStart: 12, bandEnd: 16, eqParam: 'peak_2_gain', eqFreq: 'peak_2_frequency', defaultFreq: 350 },
  { name: 'High-Mid / Presence', startHz: 800, endHz: 5000, bandStart: 17, bandEnd: 24, eqParam: 'peak_3_gain', eqFreq: 'peak_3_frequency', defaultFreq: 3000 },
  { name: 'Highs / Air', startHz: 5000, endHz: 20000, bandStart: 25, bandEnd: 31, eqParam: 'high_shelf_gain', eqFreq: 'high_shelf_frequency', defaultFreq: 10000 }
];

/**
 * Computes band-by-band and regional spectral deltas:
 * Delta(f) = Live_Mix(f) - (Reference(f) + GainOffset)
 */
export function computeSpectralDifference(
  liveBands: number[],
  refBands: number[],
  gainOffsetDb: number = 0,
  thresholdDb: number = 2.5
): SpectralDifferenceAnalysis {
  const numBands = Math.min(32, liveBands.length, refBands.length);
  const deltas: number[] = new Array(numBands).fill(0);

  // Check if live audio has actual signal (at least 3 bands > -65 dB)
  const activeBandsCount = liveBands.filter((b) => b > -65).length;
  if (activeBandsCount < 3) {
    return {
      deltas,
      maxAbsDeviationDb: 0,
      deviantZones: [],
      primaryDeviation: null
    };
  }

  for (let i = 0; i < numBands; i++) {
    const live = liveBands[i] ?? -70;
    const ref = (refBands[i] ?? -70) + gainOffsetDb;
    deltas[i] = live - ref;
  }

  // Evaluate musical regions
  const deviantZones: FrequencyDeviationZone[] = [];

  MUSICAL_REGIONS.forEach((region, index) => {
    let sumDelta = 0;
    let count = 0;
    let maxDeltaInRegion = 0;
    let peakBandIdx = region.bandStart;

    for (let b = region.bandStart; b <= Math.min(region.bandEnd, numBands - 1); b++) {
      // Only consider if live signal is reasonably active in this band
      if ((liveBands[b] ?? -70) > -65) {
        const d = deltas[b];
        sumDelta += d;
        count++;
        if (Math.abs(d) > Math.abs(maxDeltaInRegion)) {
          maxDeltaInRegion = d;
          peakBandIdx = b;
        }
      }
    }

    if (count > 0) {
      const avgDelta = sumDelta / count;
      if (Math.abs(avgDelta) >= thresholdDb || Math.abs(maxDeltaInRegion) >= thresholdDb) {
        const peakFreq = ISO_CENTER_FREQS[peakBandIdx] ?? region.defaultFreq;
        const deltaToReport = Math.abs(maxDeltaInRegion) > Math.abs(avgDelta) ? maxDeltaInRegion : avgDelta;
        const isExcess = deltaToReport > 0;

        deviantZones.push({
          zoneIndex: index,
          startHz: region.startHz,
          endHz: region.endHz,
          centerHz: peakFreq,
          deltaDb: Math.round(deltaToReport * 10) / 10,
          label: `${region.startHz}-${region.endHz >= 1000 ? `${(region.endHz / 1000).toFixed(0)}k` : region.endHz} Hz: ${
            isExcess ? `+${deltaToReport.toFixed(1)} dB Überhang` : `${deltaToReport.toFixed(1)} dB Defizit`
          }`,
          isExcess
        });
      }
    }
  });

  // Sort zones by magnitude of deviation descending
  deviantZones.sort((a, b) => Math.abs(b.deltaDb) - Math.abs(a.deltaDb));

  const maxAbsDeviationDb = deviantZones.length > 0 ? Math.abs(deviantZones[0].deltaDb) : 0;
  const primaryDeviation = deviantZones.length > 0 ? deviantZones[0] : null;

  return {
    deltas,
    maxAbsDeviationDb,
    deviantZones,
    primaryDeviation
  };
}

/**
 * Generates an actionable MixActionProposal to adapt the frequency balance to the reference
 */
export function generateReferenceMatchProposal(
  telemetry: MetrologyTelemetryFrame,
  reference: ReferenceTrackProfile,
  tracks: TrackDescriptor[],
  gainOffsetDb: number = 0,
  thresholdDb: number = 2.5
): MixActionProposal | null {
  const liveBands = telemetry.spectrum?.frequencyBands ?? [];
  const refBands = reference.frequencyBands ?? [];

  const analysis = computeSpectralDifference(liveBands, refBands, gainOffsetDb, thresholdDb);
  if (!analysis.primaryDeviation || analysis.deviantZones.length === 0) {
    return null;
  }

  // Resolve target track (prefer Master / Mix Bus / Stereo Out, otherwise tracks[0])
  const targetTrack =
    tracks.find((t) => {
      const n = t.name.toLowerCase();
      return n.includes('master') || n.includes('mix') || n.includes('bus') || n.includes('stereo');
    }) ??
    tracks[0] ?? {
      id: 'master_bus',
      name: 'Stereo Out',
      type: 'master',
      volume: 0.0,
      pan: 0.0,
      isMuted: false,
      isSoloed: false,
      plugins: []
    };

  const deltas: ParameterDelta[] = [];
  const rationalePoints: string[] = [];

  // Limit to top 2 most critical corrective zones to prevent over-processing
  const zonesToCorrect = analysis.deviantZones.slice(0, 2);

  for (const zone of zonesToCorrect) {
    const regionDef = MUSICAL_REGIONS[zone.zoneIndex];
    if (!regionDef) continue;

    // Corrective gain: inverse of the deviation, clamped to safe maximum single-step (+3.0 dB max boost, -6.0 dB max cut)
    let correctiveGain = -zone.deltaDb;
    if (correctiveGain > 3.0) correctiveGain = 3.0;
    if (correctiveGain < -6.0) correctiveGain = -6.0;
    correctiveGain = Math.round(correctiveGain * 10) / 10;

    // Gain delta
    deltas.push({
      trackId: targetTrack.id,
      trackName: targetTrack.name,
      slotIndex: 0,
      pluginName: 'Channel EQ',
      parameterName: regionDef.eqParam,
      currentValue: 0.0,
      proposedValue: correctiveGain,
      unit: 'dB'
    });

    // Frequency center delta
    deltas.push({
      trackId: targetTrack.id,
      trackName: targetTrack.name,
      slotIndex: 0,
      pluginName: 'Channel EQ',
      parameterName: regionDef.eqFreq,
      currentValue: regionDef.defaultFreq,
      proposedValue: zone.centerHz,
      unit: 'Hz'
    });

    rationalePoints.push(
      `${regionDef.name} (${zone.startHz}-${zone.endHz} Hz): ${zone.isExcess ? '+' : ''}${zone.deltaDb} dB Abweichung → ${
        correctiveGain >= 0 ? `+${correctiveGain}` : correctiveGain
      } dB ${correctiveGain < 0 ? 'Cut' : 'Boost'} bei ${zone.centerHz} Hz`
    );
  }

  const primary = analysis.primaryDeviation;
  const title = `Spektral-Anpassung an Referenz: "${reference.name}"`;
  const rationale = `Der spektrale Vergleich zur Referenz "${reference.name}" zeigt eine signifikante Diskrepanz (${primary.label}). ${rationalePoints.join('. ')}. Ziel ist eine balancierte Annäherung an das Frequenzprofil der Referenz ohne Phasenverfälschungen.`;

  return {
    id: `prop_${Date.now()}_ref_match`,
    timestamp: Date.now(),
    category: 'eq_tonal_balance',
    title,
    rationale,
    confidenceScore: 0.96,
    deltas,
    status: 'pending'
  };
}
