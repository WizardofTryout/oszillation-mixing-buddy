import channelEqJson from './plugins/ChannelEQ.json';
import compressorJson from './plugins/Compressor.json';

/**
 * Control point for piecewise-linear curve tables (e.g. Compressor Attack)
 */
export interface CurvePoint {
  raw: number;
  display: number;
}

/**
 * macOS Accessibility (AXUIElement) matching criteria for a plugin control
 */
export interface AXEditorCriteria {
  role?: string;
  title?: string;
  identifier?: string;
  helpPrefix?: string;
}

/**
 * Panel prerequisite that must be active before writing a parameter
 * (e.g. switching Compressor right panel to "output" or "side_chain")
 */
export interface WritePrereqSpec {
  parameterId: string;
  option: string;
}

/**
 * Option entry for selector / radio parameters
 */
export interface ParameterOptionSpec {
  id: string;
  label: string;
  editorAX: AXEditorCriteria;
}

/**
 * Full specification for a single plugin parameter
 */
export interface PluginParameterSpec {
  id: string;
  aliases?: string[];
  band?: number;
  bandType?: string;
  label: string;
  controlsLabel?: string;
  type: 'continuous' | 'toggle' | 'selector' | 'radio';
  hidden?: boolean;
  unit?: string;
  displayMin?: number;
  displayMax?: number;
  rawMin?: number;
  rawMax?: number;
  curve?: 'logarithmic' | 'linear' | 'piecewise_linear';
  curveTable?: CurvePoint[];
  editorAX?: AXEditorCriteria;
  options?: ParameterOptionSpec[];
  writePrereq?: WritePrereqSpec;
}

/**
 * Full specification for a Logic Pro plugin (e.g. Channel EQ, Compressor)
 */
export interface PluginSpecification {
  name: string;
  aliases?: string[];
  parameters: PluginParameterSpec[];
}

export const CHANNEL_EQ_SPEC: PluginSpecification = channelEqJson as unknown as PluginSpecification;
export const COMPRESSOR_SPEC: PluginSpecification = compressorJson as unknown as PluginSpecification;

export const LOGIC_PLUGIN_SPECS: PluginSpecification[] = [
  CHANNEL_EQ_SPEC,
  COMPRESSOR_SPEC
];

/**
 * 1. Logarithmic Transformation (Frequencies Hz, Ratio, Q-Factor)
 *
 * Forward: displayValue = displayMin * (displayMax / displayMin) ^ ((rawValue - rawMin) / (rawMax - rawMin))
 * Inverse: rawValue = rawMin + (rawMax - rawMin) * log(displayValue / displayMin) / log(displayMax / displayMin)
 */
export function rawToDisplayLog(
  rawValue: number,
  displayMin: number,
  displayMax: number,
  rawMax: number,
  rawMin: number = 0
): number {
  if (rawMax <= rawMin || displayMin <= 0 || displayMax <= displayMin) {
    return displayMin;
  }
  const clampedRaw = Math.max(rawMin, Math.min(rawMax, rawValue));
  const normalized = (clampedRaw - rawMin) / (rawMax - rawMin);
  return displayMin * Math.pow(displayMax / displayMin, normalized);
}

export function displayToRawLog(
  displayValue: number,
  displayMin: number,
  displayMax: number,
  rawMax: number,
  rawMin: number = 0
): number {
  if (rawMax <= rawMin || displayMin <= 0 || displayMax <= displayMin) {
    return rawMin;
  }
  const clampedDisplay = Math.max(displayMin, Math.min(displayMax, displayValue));
  const ratio = Math.log(clampedDisplay / displayMin) / Math.log(displayMax / displayMin);
  return rawMin + (rawMax - rawMin) * ratio;
}

/**
 * 2. Linear Transformation (Gain dB, Percentage, Slope, Knee)
 *
 * Forward: displayValue = displayMin + (displayMax - displayMin) * ((rawValue - rawMin) / (rawMax - rawMin))
 * Inverse: rawValue = rawMin + (rawMax - rawMin) * ((displayValue - displayMin) / (displayMax - displayMin))
 */
export function rawToDisplayLinear(
  rawValue: number,
  displayMin: number,
  displayMax: number,
  rawMax: number,
  rawMin: number = 0
): number {
  if (rawMax <= rawMin) {
    return displayMin;
  }
  const clampedRaw = Math.max(rawMin, Math.min(rawMax, rawValue));
  const normalized = (clampedRaw - rawMin) / (rawMax - rawMin);
  return displayMin + (displayMax - displayMin) * normalized;
}

export function displayToRawLinear(
  displayValue: number,
  displayMin: number,
  displayMax: number,
  rawMax: number,
  rawMin: number = 0
): number {
  if (displayMax <= displayMin || rawMax <= rawMin) {
    return rawMin;
  }
  const clampedDisplay = Math.max(displayMin, Math.min(displayMax, displayValue));
  const normalized = (clampedDisplay - displayMin) / (displayMax - displayMin);
  return rawMin + (rawMax - rawMin) * normalized;
}

/**
 * 3. Piecewise Linear / Curve Table Transformation (Compressor Attack / Release)
 *
 * Performs linear interpolation between adjacent control points { raw, display }.
 */
export function rawToDisplayPiecewise(
  rawValue: number,
  curveTable: CurvePoint[]
): number {
  if (curveTable.length === 0) return rawValue;
  const sorted = [...curveTable].sort((a, b) => a.raw - b.raw);

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (rawValue <= first.raw) return first.display;
  if (rawValue >= last.raw) return last.display;

  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[i]!;
    const p1 = sorted[i + 1]!;
    if (rawValue >= p0.raw && rawValue <= p1.raw) {
      const span = p1.raw - p0.raw;
      if (span <= 0) return p0.display;
      const t = (rawValue - p0.raw) / span;
      return p0.display + t * (p1.display - p0.display);
    }
  }
  return last.display;
}

export function displayToRawPiecewise(
  displayValue: number,
  curveTable: CurvePoint[]
): number {
  if (curveTable.length === 0) return displayValue;
  const sorted = [...curveTable].sort((a, b) => a.display - b.display);

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (displayValue <= first.display) return first.raw;
  if (displayValue >= last.display) return last.raw;

  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[i]!;
    const p1 = sorted[i + 1]!;
    if (displayValue >= p0.display && displayValue <= p1.display) {
      const span = p1.display - p0.display;
      if (span <= 0) return p0.raw;
      const t = (displayValue - p0.display) / span;
      return p0.raw + t * (p1.raw - p0.raw);
    }
  }
  return last.raw;
}

/**
 * Unified Raw -> Display dispatcher using a parameter specification
 */
export function rawToDisplay(rawValue: number, spec: PluginParameterSpec): number {
  if (spec.type === 'toggle') {
    return rawValue !== 0 ? 1 : 0;
  }

  if (spec.curveTable && spec.curveTable.length > 0) {
    return rawToDisplayPiecewise(rawValue, spec.curveTable);
  }

  const displayMin = spec.displayMin ?? 0;
  const displayMax = spec.displayMax ?? 1;
  const rawMin = spec.rawMin ?? 0;
  const rawMax = spec.rawMax ?? 1;

  if (spec.curve === 'logarithmic') {
    return rawToDisplayLog(rawValue, displayMin, displayMax, rawMax, rawMin);
  }

  return rawToDisplayLinear(rawValue, displayMin, displayMax, rawMax, rawMin);
}

/**
 * Unified Display -> Raw dispatcher using a parameter specification
 */
export function displayToRaw(displayValue: number, spec: PluginParameterSpec): number {
  if (spec.type === 'toggle') {
    return displayValue !== 0 ? 1 : 0;
  }

  if (spec.curveTable && spec.curveTable.length > 0) {
    return Math.round(displayToRawPiecewise(displayValue, spec.curveTable));
  }

  const displayMin = spec.displayMin ?? 0;
  const displayMax = spec.displayMax ?? 1;
  const rawMin = spec.rawMin ?? 0;
  const rawMax = spec.rawMax ?? 1;

  if (spec.curve === 'logarithmic') {
    return Math.round(displayToRawLog(displayValue, displayMin, displayMax, rawMax, rawMin));
  }

  return Math.round(displayToRawLinear(displayValue, displayMin, displayMax, rawMax, rawMin));
}

/**
 * Formats a numeric audio display value with its engineering unit
 */
export function formatDisplayValue(
  displayValue: number,
  unit: string = '',
  type: PluginParameterSpec['type'] = 'continuous'
): string {
  if (type === 'toggle') {
    return displayValue !== 0 ? 'On' : 'Off';
  }
  const u = unit.trim();
  if (u === 'Hz') {
    return displayValue >= 100 ? `${Math.round(displayValue)} Hz` : `${displayValue.toFixed(1)} Hz`;
  }
  if (u === 'dB') {
    return `${displayValue.toFixed(1)} dB`;
  }
  if (u === ':1') {
    return `${displayValue.toFixed(1)}:1`;
  }
  if (u === 'ms') {
    return displayValue >= 10 ? `${Math.round(displayValue)} ms` : `${displayValue.toFixed(1)} ms`;
  }
  if (u === '%') {
    return `${Math.round(displayValue)}%`;
  }
  if (u === 'Q') {
    return `${displayValue.toFixed(2)}`;
  }
  return u ? `${displayValue.toFixed(2)} ${u}` : `${displayValue.toFixed(2)}`;
}

/**
 * Normalizes a name or identifier for fuzzy lookup
 */
function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Returns all built-in + user-learned plugin specifications from `~/.mixing-buddy/plugins/`
 */
export function getAllPluginSpecifications(): PluginSpecification[] {
  try {
    // Dynamic import check or synchronous fs read via PluginRegistry
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadVaultPluginSpecs } = require('./PluginRegistry.js') as typeof import('./PluginRegistry.js');
    const customSpecs = loadVaultPluginSpecs().map((item) => item.runtime);
    return [...LOGIC_PLUGIN_SPECS, ...customSpecs];
  } catch {
    return LOGIC_PLUGIN_SPECS;
  }
}

/**
 * Looks up a PluginSpecification by plugin name or window title (searches both built-in and ~/.mixing-buddy/plugins/)
 */
export function findPluginSpecification(pluginNameOrWindowTitle: string): PluginSpecification | null {
  const target = normalizeKey(pluginNameOrWindowTitle);
  const allSpecs = getAllPluginSpecifications();
  for (const spec of allSpecs) {
    if (normalizeKey(spec.name) === target || target.includes(normalizeKey(spec.name))) {
      return spec;
    }
    if (spec.aliases?.some((alias) => normalizeKey(alias) === target || target.includes(normalizeKey(alias)))) {
      return spec;
    }
  }
  return null;
}

/**
 * Looks up a PluginParameterSpec inside a PluginSpecification (or across all specs)
 * matching by id, label, alias, or _NS: identifier.
 */
export function findParameterSpecification(
  paramNameOrId: string,
  pluginSpec?: PluginSpecification | null
): PluginParameterSpec | null {
  const targetNorm = normalizeKey(paramNameOrId);
  const specsToSearch = pluginSpec ? [pluginSpec] : getAllPluginSpecifications();

  for (const spec of specsToSearch) {
    for (const param of spec.parameters) {
      if (
        param.id.toLowerCase() === paramNameOrId.toLowerCase() ||
        normalizeKey(param.id) === targetNorm ||
        normalizeKey(param.label) === targetNorm ||
        param.editorAX?.identifier?.toLowerCase() === paramNameOrId.toLowerCase() ||
        param.editorAX?.title?.toLowerCase() === paramNameOrId.toLowerCase()
      ) {
        return param;
      }
      if (param.aliases?.some((a) => normalizeKey(a) === targetNorm)) {
        return param;
      }
    }
  }
  return null;
}
