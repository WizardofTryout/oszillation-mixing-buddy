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
