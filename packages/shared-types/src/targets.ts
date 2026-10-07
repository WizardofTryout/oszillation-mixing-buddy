import type { MetrologyTelemetryFrame } from './telemetry.js';

/**
 * Target Profiles and Crossover Data Models (Sprint 3)
 */

export type TargetScope =
  | 'mix_bus'
  | 'lead_vocal'
  | 'drum_bus'
  | 'sub_bass'
  | 'keys_synths'
  | 'acoustic';

export type GenreProfileId =
  | 'auto_detect'
  | 'hiphop_trap'
  | 'pop_radio'
  | 'rock_metal'
  | 'edm_club'
  | 'acoustic_jazz'
  | 'custom_crossover';

export interface SpectralZoneTargets {
  subBassDb: number; // 20 - 60 Hz
  bassDb: number;    // 60 - 250 Hz
  lowMidDb: number;  // 250 - 1000 Hz
  highMidDb: number; // 1 - 5 kHz
  airDb: number;     // 5 - 20 kHz
}

export interface TargetProfile {
  id: string;
  name: string;
  targetScope: TargetScope;
  genreProfile: GenreProfileId;
  isCustom?: boolean;
  customNotes?: string;
  targetIntegratedLufs: number;
  toleranceLufs: number;
  crestFactorRange: { min: number; max: number };
  maxTruePeakDb: number;
  recommendedHeadroomDb: number;
  spectralTargets: SpectralZoneTargets;
  typicalRemedies?: string[];
}

export interface ProjectContextSyncPayload {
  type: 'project_context_sync';
  targetScope: TargetScope;
  genreProfile: GenreProfileId;
  customNotes?: string;
  targetLufs?: number;
  targetProfile?: TargetProfile;
}

export interface ReferenceTrackProfile {
  id: string;
  name: string;
  fileName: string;
  fileFormat: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  integratedLufs: number;
  truePeakDb: number;
  crestFactorDb: number;
  frequencyBands: number[]; // 32 bands in dB (-70 to 0)
  chorusWindow?: { startSec: number; endSec: number };
  timestamp: number;
}

export interface ReferenceProfileSummary {
  id: string;
  name: string;
  fileName: string;
  fileFormat: string;
  durationSeconds: number;
  integratedLufs: number;
  truePeakDb: number;
  crestFactorDb: number;
  timestamp: number;
  filePath?: string;
}

export const STANDARD_GENRE_PROFILES: Record<string, TargetProfile> = {
  pop_radio: {
    id: 'pop_radio',
    name: 'Pop / Modern Radio',
    genreProfile: 'pop_radio',
    targetScope: 'mix_bus',
    targetIntegratedLufs: -12.0,
    toleranceLufs: 1.5,
    crestFactorRange: { min: 10.5, max: 13.0 },
    maxTruePeakDb: -1.0,
    recommendedHeadroomDb: 1.0,
    spectralTargets: {
      subBassDb: 0.0,
      bassDb: 0.5,
      lowMidDb: -0.5,
      highMidDb: 1.5,
      airDb: 2.5
    },
    typicalRemedies: [
      'Vocal presence & air boost at 12 kHz',
      'Gentle master bus dynamic glue',
      'Mono compatibility below 90 Hz'
    ]
  },
  hiphop_trap: {
    id: 'hiphop_trap',
    name: 'Hip-Hop / Trap / Drill',
    genreProfile: 'hiphop_trap',
    targetScope: 'mix_bus',
    targetIntegratedLufs: -8.0,
    toleranceLufs: 1.5,
    crestFactorRange: { min: 8.0, max: 10.5 },
    maxTruePeakDb: -0.5,
    recommendedHeadroomDb: 0.5,
    spectralTargets: {
      subBassDb: 3.5,
      bassDb: 1.0,
      lowMidDb: -1.5,
      highMidDb: 1.0,
      airDb: 1.5
    },
    typicalRemedies: [
      'Sub-bass priority (35-65 Hz dominant)',
      'Sidechain kick to 808 ducking',
      'Hard clipping for punch'
    ]
  },
  rock_metal: {
    id: 'rock_metal',
    name: 'Rock / Alternative / Metal',
    genreProfile: 'rock_metal',
    targetScope: 'mix_bus',
    targetIntegratedLufs: -10.0,
    toleranceLufs: 1.5,
    crestFactorRange: { min: 9.0, max: 12.0 },
    maxTruePeakDb: -0.8,
    recommendedHeadroomDb: 0.8,
    spectralTargets: {
      subBassDb: -1.5,
      bassDb: 1.0,
      lowMidDb: 1.5,
      highMidDb: 2.0,
      airDb: 0.5
    },
    typicalRemedies: [
      'Sub low cut (< 40 Hz)',
      'Dense guitar mid articulation (800 - 3500 Hz)',
      'Parallel aggressive drum compression'
    ]
  },
  edm_club: {
    id: 'edm_club',
    name: 'EDM / Club / Dance',
    genreProfile: 'edm_club',
    targetScope: 'mix_bus',
    targetIntegratedLufs: -6.5,
    toleranceLufs: 1.0,
    crestFactorRange: { min: 6.5, max: 9.0 },
    maxTruePeakDb: -0.3,
    recommendedHeadroomDb: 0.3,
    spectralTargets: {
      subBassDb: 4.0,
      bassDb: 2.0,
      lowMidDb: -2.0,
      highMidDb: 1.5,
      airDb: 2.0
    },
    typicalRemedies: [
      'Wide stereo imaging on lead synths',
      'Multi-stage brickwall limiting',
      'Tight mono sub bass (< 100 Hz)'
    ]
  },
  acoustic_jazz: {
    id: 'acoustic_jazz',
    name: 'Acoustic / Jazz / Classical',
    genreProfile: 'acoustic_jazz',
    targetScope: 'mix_bus',
    targetIntegratedLufs: -16.0,
    toleranceLufs: 2.0,
    crestFactorRange: { min: 14.0, max: 20.0 },
    maxTruePeakDb: -1.5,
    recommendedHeadroomDb: 2.0,
    spectralTargets: {
      subBassDb: -3.0,
      bassDb: 0.0,
      lowMidDb: 0.5,
      highMidDb: 0.0,
      airDb: 1.0
    },
    typicalRemedies: [
      'Unrestricted natural microdynamics',
      'Gentle optical leveling only',
      'Avoid hard digital peak limiting'
    ]
  }
};

/**
 * Resolves a target profile based on genre and optional scope modifications
 */
export function resolveTargetProfile(
  genre: GenreProfileId,
  scope: TargetScope = 'mix_bus',
  customProfile?: Partial<TargetProfile>
): TargetProfile {
  if (genre === 'custom_crossover' && customProfile) {
    return {
      id: 'custom_crossover',
      name: customProfile.name ?? 'Individuell / Crossover',
      genreProfile: 'custom_crossover',
      targetScope: scope,
      isCustom: true,
      customNotes: customProfile.customNotes,
      targetIntegratedLufs: customProfile.targetIntegratedLufs ?? -12.0,
      toleranceLufs: customProfile.toleranceLufs ?? 1.5,
      crestFactorRange: customProfile.crestFactorRange ?? { min: 9.0, max: 13.0 },
      maxTruePeakDb: customProfile.maxTruePeakDb ?? -1.0,
      recommendedHeadroomDb: customProfile.recommendedHeadroomDb ?? 1.0,
      spectralTargets: customProfile.spectralTargets ?? {
        subBassDb: 0.0,
        bassDb: 0.0,
        lowMidDb: 0.0,
        highMidDb: 0.0,
        airDb: 0.0
      },
      typicalRemedies: customProfile.typicalRemedies
    };
  }

  const base = STANDARD_GENRE_PROFILES[genre] ?? STANDARD_GENRE_PROFILES['pop_radio'];
  const profile: TargetProfile = {
    ...base,
    targetScope: scope
  };

  // Adjust targets depending on track scope
  if (scope === 'lead_vocal') {
    profile.spectralTargets = {
      subBassDb: -12.0, // High-pass filtering on vocals
      bassDb: -2.0,
      lowMidDb: -1.0,
      highMidDb: +3.0,  // Vocal intelligibility 2-5 kHz
      airDb: +3.5       // Vocal air 10-16 kHz
    };
    profile.crestFactorRange = { min: 10.0, max: 15.0 };
  } else if (scope === 'drum_bus') {
    profile.spectralTargets = {
      subBassDb: +2.0,
      bassDb: +3.0,
      lowMidDb: -1.0,
      highMidDb: +2.0,
      airDb: +1.0
    };
    profile.crestFactorRange = { min: 8.0, max: 12.0 };
  } else if (scope === 'sub_bass') {
    profile.spectralTargets = {
      subBassDb: +5.0,
      bassDb: +1.0,
      lowMidDb: -6.0,
      highMidDb: -12.0,
      airDb: -20.0
    };
    profile.crestFactorRange = { min: 4.0, max: 8.0 };
  } else if (scope === 'keys_synths') {
    profile.spectralTargets = {
      subBassDb: -10.0, // Low-cut below 80 Hz for Keys/Synths to leave room for Kick & Bass
      bassDb: -1.0,
      lowMidDb: 0.0,
      highMidDb: +1.5,
      airDb: +2.0
    };
    profile.crestFactorRange = { min: 8.0, max: 14.0 };
  } else if (scope === 'acoustic') {
    profile.spectralTargets = {
      subBassDb: -12.0, // Low-cut below 80-100 Hz for acoustic guitars & instruments
      bassDb: -1.5,
      lowMidDb: +0.5,
      highMidDb: +2.0,
      airDb: +3.0
    };
    profile.crestFactorRange = { min: 12.0, max: 18.0 };
  }

  return profile;
}

/**
 * Intelligent Genre Detection based on telemetry fingerprint (LUFS, Crest Factor, Sub/Mid Ratio)
 */
export function detectGenreFromTelemetry(telemetry: MetrologyTelemetryFrame): GenreProfileId {
  const lufs = telemetry.loudness?.integratedLufs ?? -14.0;
  const crest = telemetry.dynamics?.crestFactorDb ?? 10.0;
  const bands = telemetry.spectrum?.frequencyBands ?? [];

  if (bands.length < 24) return 'pop_radio';

  // Sub bass energy (bands 0-3: 20-60 Hz) vs high-mid energy (bands 16-24: 1-5 kHz)
  const subEnergy = ((bands[0] ?? -50) + (bands[1] ?? -50) + (bands[2] ?? -50) + (bands[3] ?? -50)) / 4;
  const midEnergy = ((bands[16] ?? -50) + (bands[18] ?? -50) + (bands[20] ?? -50) + (bands[22] ?? -50)) / 4;

  if (lufs > -8.5 && crest < 9.0) {
    if (subEnergy > -30) return 'edm_club';
    return 'hiphop_trap';
  }

  if (crest > 13.5 && lufs < -14.5) {
    return 'acoustic_jazz';
  }

  if (midEnergy > subEnergy && lufs > -12.0) {
    return 'rock_metal';
  }

  return 'pop_radio';
}

/**
 * Plausibility check: alerts if current audio measurements deviate strongly from the selected genre
 */
export function validateMixPlausibility(
  telemetry: MetrologyTelemetryFrame,
  target: TargetProfile
): { isPlausible: boolean; advisory?: string } {
  if (target.genreProfile === 'auto_detect' || target.genreProfile === 'custom_crossover') {
    return { isPlausible: true };
  }

  const currentLufs = telemetry.loudness?.integratedLufs ?? -14.0;
  const currentCrest = telemetry.dynamics?.crestFactorDb ?? 10.0;

  // Check 1: Extreme compression / loudness mismatch (e.g. Jazz selected but -7 LUFS)
  if (target.genreProfile === 'acoustic_jazz' && currentLufs > -10.0 && currentCrest < 9.0) {
    return {
      isPlausible: false,
      advisory: `Deine aktuellen Messwerte zeigen eine extrem dichte Kompression (${currentLufs.toFixed(1)} LUFS, Crest ${currentCrest.toFixed(1)} dB), was eher für Club/EDM oder Trap spricht als für Acoustic/Jazz. Mischt du einen Crossover-Track oder möchtest du das Ziel anpassen?`
    };
  }

  // Check 2: Undercompressed high-energy genre (e.g. EDM or Trap selected but -18 LUFS with > 15 dB Crest)
  if ((target.genreProfile === 'edm_club' || target.genreProfile === 'hiphop_trap') && currentLufs < -16.0 && currentCrest > 14.0) {
    return {
      isPlausible: false,
      advisory: `Für ${target.name} ist das Signal aktuell sehr dynamisch und leise (${currentLufs.toFixed(1)} LUFS, Crest ${currentCrest.toFixed(1)} dB). Die ActionCards werden aggressive Dynamik- und Gain-Staging-Schritte vorschlagen, um den Genre-Korridor zu erreichen.`
    };
  }

  return { isPlausible: true };
}

/**
 * Heuristische Zuordnung von Spurnamen zu TargetScope (Sprint Phase 2A)
 */
export function resolveScopeFromTrackName(trackName: string): TargetScope {
  const lower = trackName.toLowerCase();

  // Master / Gesamtmix
  if (
    lower.includes('stereo out') ||
    lower.includes('master') ||
    lower.includes('mix') ||
    lower.includes('print')
  ) {
    return 'mix_bus';
  }
  // Vocals
  if (
    lower.includes('vox') ||
    lower.includes('vocal') ||
    lower.includes('lead') ||
    lower.includes('voice')
  ) {
    return 'lead_vocal';
  }
  // Drums / Percussion
  if (
    lower.includes('drum') ||
    lower.includes('kit') ||
    lower.includes('snare') ||
    lower.includes('kick') ||
    lower.includes('beat') ||
    lower.includes('perc')
  ) {
    return 'drum_bus';
  }
  // Bass / Low End
  if (lower.includes('bass') || lower.includes('808') || lower.includes('sub')) {
    return 'sub_bass';
  }
  // Keys & Synths
  if (
    lower.includes('grand') ||
    lower.includes('piano') ||
    lower.includes('key') ||
    lower.includes('synth') ||
    lower.includes('organ') ||
    lower.includes('pad')
  ) {
    return 'keys_synths';
  }
  // Akustik & Saiten
  if (
    lower.includes('git') ||
    lower.includes('acoustic') ||
    lower.includes('string') ||
    lower.includes('horn') ||
    lower.includes('brass')
  ) {
    return 'acoustic';
  }

  return 'mix_bus'; // Konservativer Fallback
}
