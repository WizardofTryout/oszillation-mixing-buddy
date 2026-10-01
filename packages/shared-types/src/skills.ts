/**
 * Custom Mixing Skill Data Models
 * Sprint 5: Custom Mixing Skill Editor & Wizard
 */

export type SkillCategory = 'vocal' | 'drums' | 'master' | 'bass' | 'general';
export type SlotType = 'utility' | 'eq' | 'dynamics' | 'saturation' | 'space';

export interface RevisionHistoryItem {
  version: string;
  timestamp: string;
  comment: string;
}

export interface SkillMetrologyTargets {
  integratedLufs: number;
  toleranceLufs: number;
  crestFactor: { min: number; max: number };
  maxTruePeakDb: number;
  recommendedHeadroomDb: number;
}

export interface SkillChainSlot {
  slotType: SlotType;
  preferredPluginHint?: string;
  typicalRules: string[];
}

export interface SkillPrompts {
  /** Kompakter Prompt für HUD ActionCards */
  quickstart: string;
  /** Ausführlicher Diagnose-Prompt für Chat/Workshop */
  workshop: string;
}

export interface MixingSkill {
  /** Eindeutiger Slug, z. B. "tonmischmeister" */
  id: string;
  /** Anzeigename, z. B. "Tonmischmeister" */
  name: string;
  category: SkillCategory;
  isFavorite: boolean;
  /** Versionsnummer, z. B. "v1.0" */
  version: string;
  revisionHistory: RevisionHistoryItem[];
  metrologyTargets: SkillMetrologyTargets;
  preferredChain: SkillChainSlot[];
  prompts: SkillPrompts;
  createdAt: number;
  updatedAt: number;
}

export interface MixingSkillSummary {
  id: string;
  name: string;
  category: SkillCategory;
  isFavorite: boolean;
  version: string;
  chainSlotsCount: number;
  updatedAt: number;
  filePath?: string;
}

export const TONMISCHMEISTER_SEED_SKILL: MixingSkill = {
  id: 'tonmischmeister',
  name: 'Tonmischmeister',
  category: 'master',
  isFavorite: true,
  version: 'v1.0',
  revisionHistory: [
    {
      version: 'v1.0',
      timestamp: '2026-10-01T00:00:00.000Z',
      comment: 'Initialer deutscher Broadcast & Mastering Studio Standard'
    }
  ],
  metrologyTargets: {
    integratedLufs: -14.0,
    toleranceLufs: 1.0,
    crestFactor: { min: 9.0, max: 12.0 },
    maxTruePeakDb: -1.0,
    recommendedHeadroomDb: 1.5
  },
  preferredChain: [
    {
      slotType: 'utility',
      preferredPluginHint: 'Gain / Mono-Maker',
      typicalRules: [
        'Mono-Kompatibilität unterhalb von 90 Hz erzwingen',
        'Headroom vor Dynamikbearbeitung auf -18 dBFS kalibrieren'
      ]
    },
    {
      slotType: 'eq',
      preferredPluginHint: 'Channel EQ / Linear Phase EQ',
      typicalRules: [
        'High-Pass bei 28 Hz (18 dB/Okt)',
        'Resonanz-Absenkung bei 250-400 Hz (Mumpf-Kompensation)',
        'Sanfter Air-Boost bei 12 kHz'
      ]
    },
    {
      slotType: 'dynamics',
      preferredPluginHint: 'Master Bus Compressor',
      typicalRules: [
        'Maximal 1.5 bis 2.5 dB Gain Reduction (Glue)',
        'Attack > 30 ms zum Erhalt der Transienten',
        'Auto-Release oder 100 ms'
      ]
    },
    {
      slotType: 'saturation',
      preferredPluginHint: 'Tape / Tube Saturator',
      typicalRules: [
        'Feine ungeradzahlige Obertöne für Dichte und Wärme',
        'Kein hörbares Clipping'
      ]
    },
    {
      slotType: 'space',
      preferredPluginHint: 'Stereo Widener / Imager',
      typicalRules: [
        'Stereo-Korrelationskoeffizient stets > +0.6 halten',
        'Kein Reverb auf dem Sub-Bass'
      ]
    }
  ],
  prompts: {
    quickstart:
      'Du bist ein erfahrener deutscher Tonmischmeister. Analysiere das Spektrum und die EBU R128 Lautheit präzise, halte Headroom ein und erzeuge minimale, musikalische EQ- und Dynamik-Deltas mit transparentem Klangbild.',
    workshop:
      'Du agierst als Meister des Tonmisch-Handwerks. Führe eine ganzheitliche psychoakustische Diagnose durch: Prüfe Maskierungseffekte im Bass- und Tiefmittenbereich, Phasenkorrelation bei Stereoverbreiterung, Crest-Faktor für Dynamikerhalt und die Einhaltung des maximalen True Peak von -1.0 dBTP.'
  },
  createdAt: 1759276800000,
  updatedAt: 1759276800000
};
