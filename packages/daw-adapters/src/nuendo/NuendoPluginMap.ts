/**
 * Steinberg Nuendo & Cubase Plugin Parameter Normalization & Canonical Mapping
 * 
 * Supports:
 * - Steinberg Channel EQ (4 bands: Low Shelf/Cut, Peak 1, Peak 2, High Shelf/Cut)
 * - Steinberg Frequency 2 (8 dynamic/linear bands: Low-Cut, Shelves, Bells, High-Cut)
 * - Steinberg Stock Compressor (Threshold, Ratio, Attack, Release, Makeup)
 * 
 * Implements strict bidirectional translation:
 * Real Studio Units (dB, Hz, ms, :1) <--> Normalized DAW values (0.0 .. 1.0)
 * Includes Acoustic Shock Shield (+3.0 dB safety guard per adjustment step).
 */

export interface NuendoParameterDefinition {
  id: string;
  name: string;
  canonicalId: string;
  category: 'eq' | 'dynamics' | 'utility';
  unit: string;
  minDisplay: number;
  maxDisplay: number;
  defaultValue: number;
  curve: 'linear' | 'logarithmic' | 'boolean';
  ccNumber?: number; // Dedicated MIDI Remote CC if bound
  qcIndex?: number;  // Quick Control index (0..7)
}

export interface NuendoPluginMapping {
  pluginName: string;
  aliases: string[];
  category: 'eq' | 'dynamics' | 'utility';
  parameters: NuendoParameterDefinition[];
}

// ── 1. Transformation Mathematics ─────────────────────────────────────────────

/**
 * Logarithmic mapping for Frequency in Hz (e.g. 20 Hz .. 20,000 Hz)
 */
export function hzToNorm(hz: number, minHz = 20, maxHz = 20000): number {
  const clamped = Math.max(minHz, Math.min(maxHz, hz));
  return Math.log10(clamped / minHz) / Math.log10(maxHz / minHz);
}

export function normToHz(norm: number, minHz = 20, maxHz = 20000): number {
  const clamped = Math.max(0.0, Math.min(1.0, norm));
  return minHz * Math.pow(maxHz / minHz, clamped);
}

/**
 * Linear mapping for Gain in dB (e.g. -24 dB .. +24 dB)
 */
export function gainDbToNorm(db: number, minDb = -24, maxDb = 24): number {
  const clamped = Math.max(minDb, Math.min(maxDb, db));
  return (clamped - minDb) / (maxDb - minDb);
}

export function normToGainDb(norm: number, minDb = -24, maxDb = 24): number {
  const clamped = Math.max(0.0, Math.min(1.0, norm));
  return minDb + clamped * (maxDb - minDb);
}

/**
 * Logarithmic mapping for Q-Factor / Bandwidth (e.g. 0.5 .. 100.0)
 */
export function qToNorm(q: number, minQ = 0.5, maxQ = 100.0): number {
  const clamped = Math.max(minQ, Math.min(maxQ, q));
  return Math.log10(clamped / minQ) / Math.log10(maxQ / minQ);
}

export function normToQ(norm: number, minQ = 0.5, maxQ = 100.0): number {
  const clamped = Math.max(0.0, Math.min(1.0, norm));
  return minQ * Math.pow(maxQ / minQ, clamped);
}

/**
 * Logarithmic mapping for Compressor Ratio (e.g. 1.0:1 .. 8.0:1)
 */
export function ratioToNorm(ratio: number, minRatio = 1.0, maxRatio = 8.0): number {
  const clamped = Math.max(minRatio, Math.min(maxRatio, ratio));
  return (clamped - minRatio) / (maxRatio - minRatio);
}

export function normToRatio(norm: number, minRatio = 1.0, maxRatio = 8.0): number {
  const clamped = Math.max(0.0, Math.min(1.0, norm));
  return minRatio + clamped * (maxRatio - minRatio);
}

/**
 * Logarithmic mapping for Time in ms (Attack: 0.1ms..100ms, Release: 10ms..1000ms)
 */
export function msToNorm(ms: number, minMs: number, maxMs: number): number {
  const clamped = Math.max(minMs, Math.min(maxMs, ms));
  return Math.log10(clamped / minMs) / Math.log10(maxMs / minMs);
}

export function normToMs(norm: number, minMs: number, maxMs: number): number {
  const clamped = Math.max(0.0, Math.min(1.0, norm));
  return minMs * Math.pow(maxMs / minMs, clamped);
}

// ── 2. Acoustic Shock Shield Guard ────────────────────────────────────────────

/**
 * Ensures any volume or gain boost is clamped to a maximum delta of +3.0 dB per step.
 * All attenuations (delta <= 0.0 dB) pass unconstrained.
 */
export function applyShockShieldGuard(
  currentDb: number,
  proposedDb: number,
  isRestore = false
): number {
  // A/B-Restore or attenuation is always 100% permitted
  if (isRestore || proposedDb <= currentDb) {
    return proposedDb;
  }
  const delta = proposedDb - currentDb;
  if (delta > 3.0) {
    return currentDb + 3.0;
  }
  return proposedDb;
}

// ── 3. Canonical Parameter Mappings ───────────────────────────────────────────

/**
 * Steinberg Channel EQ (4-Band Channel Strip EQ)
 */
export const STEINBERG_CHANNEL_EQ_SPEC: NuendoPluginMapping = {
  pluginName: 'Channel EQ',
  aliases: ['channel eq', 'channeleq', 'chan eq', 'eq', 'studioeq'],
  category: 'eq',
  parameters: [
    // Band 1 (Low Shelf / Cut)
    { id: 'eq1_freq', name: 'Band 1 Frequency', canonicalId: 'hp_filter_freq', category: 'eq', unit: 'Hz', minDisplay: 20, maxDisplay: 2000, defaultValue: 80, curve: 'logarithmic', ccNumber: 64 },
    { id: 'eq1_gain', name: 'Band 1 Gain', canonicalId: 'low_shelf_gain', category: 'eq', unit: 'dB', minDisplay: -24, maxDisplay: 24, defaultValue: 0, curve: 'linear', ccNumber: 65 },
    { id: 'eq1_q', name: 'Band 1 Q', canonicalId: 'low_shelf_q', category: 'eq', unit: 'Q', minDisplay: 0.5, maxDisplay: 12, defaultValue: 1.0, curve: 'logarithmic', ccNumber: 66 },

    // Band 2 (Low-Mid Bell)
    { id: 'eq2_freq', name: 'Band 2 Frequency', canonicalId: 'low_mid_freq', category: 'eq', unit: 'Hz', minDisplay: 20, maxDisplay: 20000, defaultValue: 250, curve: 'logarithmic', ccNumber: 68 },
    { id: 'eq2_gain', name: 'Band 2 Gain', canonicalId: 'low_mid_gain', category: 'eq', unit: 'dB', minDisplay: -24, maxDisplay: 24, defaultValue: 0, curve: 'linear', ccNumber: 69 },
    { id: 'eq2_q', name: 'Band 2 Q', canonicalId: 'low_mid_q', category: 'eq', unit: 'Q', minDisplay: 0.5, maxDisplay: 12, defaultValue: 1.0, curve: 'logarithmic', ccNumber: 70 },

    // Band 3 (High-Mid Bell)
    { id: 'eq3_freq', name: 'Band 3 Frequency', canonicalId: 'high_mid_freq', category: 'eq', unit: 'Hz', minDisplay: 20, maxDisplay: 20000, defaultValue: 2500, curve: 'logarithmic', ccNumber: 72 },
    { id: 'eq3_gain', name: 'Band 3 Gain', canonicalId: 'high_mid_gain', category: 'eq', unit: 'dB', minDisplay: -24, maxDisplay: 24, defaultValue: 0, curve: 'linear', ccNumber: 73 },
    { id: 'eq3_q', name: 'Band 3 Q', canonicalId: 'high_mid_q', category: 'eq', unit: 'Q', minDisplay: 0.5, maxDisplay: 12, defaultValue: 1.0, curve: 'logarithmic', ccNumber: 74 },

    // Band 4 (High Shelf / Cut)
    { id: 'eq4_freq', name: 'Band 4 Frequency', canonicalId: 'high_shelf_freq', category: 'eq', unit: 'Hz', minDisplay: 200, maxDisplay: 20000, defaultValue: 8000, curve: 'logarithmic', ccNumber: 76 },
    { id: 'eq4_gain', name: 'Band 4 Gain', canonicalId: 'high_shelf_gain', category: 'eq', unit: 'dB', minDisplay: -24, maxDisplay: 24, defaultValue: 0, curve: 'linear', ccNumber: 77 },
    { id: 'eq4_q', name: 'Band 4 Q', canonicalId: 'high_shelf_q', category: 'eq', unit: 'Q', minDisplay: 0.5, maxDisplay: 12, defaultValue: 1.0, curve: 'logarithmic', ccNumber: 78 }
  ]
};

/**
 * Steinberg Frequency 2 (8-Band Precision Dynamic / Linear EQ)
 */
export const STEINBERG_FREQUENCY_2_SPEC: NuendoPluginMapping = {
  pluginName: 'Frequency 2',
  aliases: ['frequency 2', 'frequency', 'freq 2', 'freq'],
  category: 'eq',
  parameters: [
    // Band 1: Low Cut / Sub
    { id: 'band1_freq', name: 'Band 1 Frequency', canonicalId: 'hp_filter_freq', category: 'eq', unit: 'Hz', minDisplay: 20, maxDisplay: 2000, defaultValue: 30, curve: 'logarithmic', qcIndex: 0 },
    { id: 'band1_q', name: 'Band 1 Q', canonicalId: 'hp_filter_slope', category: 'eq', unit: 'Q', minDisplay: 0.5, maxDisplay: 24, defaultValue: 1.0, curve: 'logarithmic' },

    // Band 2: Low Shelf
    { id: 'band2_freq', name: 'Band 2 Frequency', canonicalId: 'low_shelf_freq', category: 'eq', unit: 'Hz', minDisplay: 20, maxDisplay: 2000, defaultValue: 100, curve: 'logarithmic' },
    { id: 'band2_gain', name: 'Band 2 Gain', canonicalId: 'low_shelf_gain', category: 'eq', unit: 'dB', minDisplay: -24, maxDisplay: 24, defaultValue: 0, curve: 'linear', qcIndex: 1 },

    // Band 3: Low-Mid Bell (Mud Cut)
    { id: 'band3_freq', name: 'Band 3 Frequency', canonicalId: 'low_mid_freq', category: 'eq', unit: 'Hz', minDisplay: 50, maxDisplay: 4000, defaultValue: 350, curve: 'logarithmic' },
    { id: 'band3_gain', name: 'Band 3 Gain', canonicalId: 'low_mid_gain', category: 'eq', unit: 'dB', minDisplay: -24, maxDisplay: 24, defaultValue: 0, curve: 'linear', qcIndex: 2 },
    { id: 'band3_q', name: 'Band 3 Q', canonicalId: 'low_mid_q', category: 'eq', unit: 'Q', minDisplay: 0.5, maxDisplay: 100, defaultValue: 2.0, curve: 'logarithmic' },

    // Band 4: Mid Bell (Body / Harshness)
    { id: 'band4_freq', name: 'Band 4 Frequency', canonicalId: 'mid_freq', category: 'eq', unit: 'Hz', minDisplay: 100, maxDisplay: 10000, defaultValue: 1000, curve: 'logarithmic' },
    { id: 'band4_gain', name: 'Band 4 Gain', canonicalId: 'mid_gain', category: 'eq', unit: 'dB', minDisplay: -24, maxDisplay: 24, defaultValue: 0, curve: 'linear', qcIndex: 3 },
    { id: 'band4_q', name: 'Band 4 Q', canonicalId: 'mid_q', category: 'eq', unit: 'Q', minDisplay: 0.5, maxDisplay: 100, defaultValue: 2.0, curve: 'logarithmic' },

    // Band 5: High-Mid Bell (Presence / Bite)
    { id: 'band5_freq', name: 'Band 5 Frequency', canonicalId: 'high_mid_freq', category: 'eq', unit: 'Hz', minDisplay: 200, maxDisplay: 20000, defaultValue: 3500, curve: 'logarithmic' },
    { id: 'band5_gain', name: 'Band 5 Gain', canonicalId: 'high_mid_gain', category: 'eq', unit: 'dB', minDisplay: -24, maxDisplay: 24, defaultValue: 0, curve: 'linear', qcIndex: 4 },
    { id: 'band5_q', name: 'Band 5 Q', canonicalId: 'high_mid_q', category: 'eq', unit: 'Q', minDisplay: 0.5, maxDisplay: 100, defaultValue: 2.0, curve: 'logarithmic' },

    // Band 7: High Shelf (Air)
    { id: 'band7_freq', name: 'Band 7 Frequency', canonicalId: 'high_shelf_freq', category: 'eq', unit: 'Hz', minDisplay: 1000, maxDisplay: 20000, defaultValue: 10000, curve: 'logarithmic' },
    { id: 'band7_gain', name: 'Band 7 Gain', canonicalId: 'high_shelf_gain', category: 'eq', unit: 'dB', minDisplay: -24, maxDisplay: 24, defaultValue: 0, curve: 'linear', qcIndex: 5 },

    // Band 8: High Cut (LPF)
    { id: 'band8_freq', name: 'Band 8 Frequency', canonicalId: 'lp_filter_freq', category: 'eq', unit: 'Hz', minDisplay: 2000, maxDisplay: 20000, defaultValue: 18000, curve: 'logarithmic' }
  ]
};

/**
 * Steinberg Compressor (Stock Channel & Insert Compressor)
 */
export const STEINBERG_COMPRESSOR_SPEC: NuendoPluginMapping = {
  pluginName: 'Compressor',
  aliases: ['compressor', 'comp', 'vst compressor'],
  category: 'dynamics',
  parameters: [
    { id: 'threshold', name: 'Threshold', canonicalId: 'comp_threshold', category: 'dynamics', unit: 'dB', minDisplay: -60, maxDisplay: 0, defaultValue: -20, curve: 'linear', qcIndex: 0 },
    { id: 'ratio', name: 'Ratio', canonicalId: 'comp_ratio', category: 'dynamics', unit: ':1', minDisplay: 1.0, maxDisplay: 8.0, defaultValue: 4.0, curve: 'linear', qcIndex: 1 },
    { id: 'attack', name: 'Attack', canonicalId: 'comp_attack', category: 'dynamics', unit: 'ms', minDisplay: 0.1, maxDisplay: 100, defaultValue: 20, curve: 'logarithmic', qcIndex: 2 },
    { id: 'release', name: 'Release', canonicalId: 'comp_release', category: 'dynamics', unit: 'ms', minDisplay: 10, maxDisplay: 1000, defaultValue: 100, curve: 'logarithmic', qcIndex: 3 },
    { id: 'makeup', name: 'Make-up', canonicalId: 'comp_makeup', category: 'dynamics', unit: 'dB', minDisplay: 0, maxDisplay: 24, defaultValue: 0, curve: 'linear', qcIndex: 4 },
    { id: 'softclip', name: 'Soft Clip', canonicalId: 'comp_softclip', category: 'dynamics', unit: '', minDisplay: 0, maxDisplay: 1, defaultValue: 0, curve: 'boolean' }
  ]
};

export const STEINBERG_SPECS: NuendoPluginMapping[] = [
  STEINBERG_CHANNEL_EQ_SPEC,
  STEINBERG_FREQUENCY_2_SPEC,
  STEINBERG_COMPRESSOR_SPEC
];

/**
 * Resolves a proposed parameter name against a Steinberg plugin mapping
 * and returns the normalized (0.0 .. 1.0) control value and target definition.
 */
export function resolveNuendoParameter(
  pluginOrCategory: string,
  paramQuery: string,
  targetValue: number,
  currentValue = 0.0
): {
  definition: NuendoParameterDefinition;
  normalizedValue: number;
  clampedDisplayValue: number;
  pluginSpec: NuendoPluginMapping;
} | null {
  const query = paramQuery.trim().toLowerCase();
  const plugQuery = pluginOrCategory.trim().toLowerCase();

  // Find best matching plugin specification
  let spec = STEINBERG_SPECS.find((s) => {
    return (
      s.pluginName.toLowerCase() === plugQuery ||
      s.aliases.some((a) => a.toLowerCase() === plugQuery)
    );
  });

  if (!spec) {
    if (plugQuery.includes('frequency') || plugQuery.includes('freq')) {
      spec = STEINBERG_FREQUENCY_2_SPEC;
    } else if (plugQuery.includes('channel') || plugQuery.includes('strip')) {
      spec = STEINBERG_CHANNEL_EQ_SPEC;
    } else if (plugQuery.includes('comp') || plugQuery.includes('dynamics')) {
      spec = STEINBERG_COMPRESSOR_SPEC;
    } else if (/\beq\b/i.test(plugQuery)) {
      spec = STEINBERG_FREQUENCY_2_SPEC;
    } else {
      spec = STEINBERG_FREQUENCY_2_SPEC;
    }
  }

  // Find parameter by exact ID, exact canonicalId, exact name, or fallback includes
  let def =
    spec.parameters.find((p) => p.id.toLowerCase() === query) ||
    spec.parameters.find((p) => p.canonicalId.toLowerCase() === query) ||
    spec.parameters.find((p) => p.name.toLowerCase() === query) ||
    spec.parameters.find((p) => query.includes(p.id.toLowerCase())) ||
    spec.parameters.find((p) => query.includes(p.name.toLowerCase()));

  // Cross-spec fallback if not found in target plugin
  if (!def) {
    for (const altSpec of STEINBERG_SPECS) {
      if (altSpec === spec) continue;
      const altDef =
        altSpec.parameters.find((p) => p.id.toLowerCase() === query) ||
        altSpec.parameters.find((p) => p.canonicalId.toLowerCase() === query) ||
        altSpec.parameters.find((p) => p.name.toLowerCase() === query) ||
        altSpec.parameters.find((p) => query.includes(p.id.toLowerCase())) ||
        altSpec.parameters.find((p) => query.includes(p.name.toLowerCase()));
      if (altDef) {
        spec = altSpec;
        def = altDef;
        break;
      }
    }
  }

  if (!def) return null;


  // Apply Acoustic Shock Shield if dealing with gain/volume
  let safeValue = targetValue;
  if (def.unit === 'dB' && (def.id.includes('gain') || def.canonicalId.includes('gain') || def.id.includes('makeup'))) {
    safeValue = applyShockShieldGuard(currentValue, targetValue);
  }

  // Calculate normalized 0.0 .. 1.0 value based on curve
  let norm = 0.0;
  if (def.curve === 'logarithmic') {
    if (def.unit === 'Hz') {
      norm = hzToNorm(safeValue, def.minDisplay, def.maxDisplay);
    } else if (def.unit === 'Q') {
      norm = qToNorm(safeValue, def.minDisplay, def.maxDisplay);
    } else if (def.unit === 'ms') {
      norm = msToNorm(safeValue, def.minDisplay, def.maxDisplay);
    } else {
      norm = Math.max(0.0, Math.min(1.0, safeValue / def.maxDisplay));
    }
  } else if (def.curve === 'boolean') {
    norm = safeValue > 0 ? 1.0 : 0.0;
  } else {
    // Linear
    if (def.unit === ':1') {
      norm = ratioToNorm(safeValue, def.minDisplay, def.maxDisplay);
    } else {
      norm = gainDbToNorm(safeValue, def.minDisplay, def.maxDisplay);
    }
  }

  return {
    definition: def,
    normalizedValue: Math.max(0.0, Math.min(1.0, norm)),
    clampedDisplayValue: safeValue,
    pluginSpec: spec
  };
}
