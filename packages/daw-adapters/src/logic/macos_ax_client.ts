import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { PluginMetadata, PluginParameter, TrackDescriptor } from '@mixing-buddy/shared-types';
import {
  type AXEditorCriteria,
  type PluginParameterSpec,
  type PluginSpecification,
  displayToRaw,
  findParameterSpecification,
  findPluginSpecification,
  formatDisplayValue,
  rawToDisplay
} from './transformers.js';

const execFileAsync = promisify(execFile);

export interface AccessibilityClientOptions {
  bundleIdentifier?: string;
  commandTimeoutMs?: number;
  bridgeBinaryPath?: string;
}

/**
 * In-memory representation of a macOS Accessibility (AXUIElement) tree node
 */
export interface AXElementNode {
  role: string;
  title?: string;
  description?: string;
  identifier?: string;
  help?: string;
  value?: number | string | boolean;
  valueDescription?: string;
  minValue?: number;
  maxValue?: number;
  path?: number[];
  children?: AXElementNode[];
}

export type AXSearchCriteria = AXEditorCriteria;

interface ScanWindowEntry {
  title: string;
  subrole: string;
  elementCount: number;
  pluginName?: string;
}

interface DumpWindowResponse {
  success: boolean;
  windowTitle?: string;
  pluginName?: string;
  controls?: AXElementNode[];
  error?: string;
}

interface ReadParamResponse {
  success: boolean;
  rawValue?: number;
  valueDescription?: string;
  error?: string;
}

interface SetParamResponse {
  success: boolean;
  newValue?: number;
  valueDescription?: string;
  error?: string;
}

// System dialog titles that are NOT plugin windows
const SYSTEM_DIALOG_TITLES = new Set([
  'speichern', 'sichern', 'öffnen', 'save', 'open', 'einstellungen',
  'preferences', 'settings', 'export', 'import', 'warning', 'alert',
  'error', 'fehler', 'info', 'help', 'hilfe', 'drucken', 'print',
  'about', 'über', 'quit', 'beenden', 'close', 'schließen'
]);

/** Returns true if the window title looks like a system dialog, not a plugin */
function isSystemDialog(title: string): boolean {
  const lower = title.toLowerCase();
  for (const kw of SYSTEM_DIALOG_TITLES) {
    if (lower === kw || lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the compiled native Swift AXUIElement sidecar binary (`logic-ax-bridge`)
 */
function resolveBridgeBinaryPath(): string {
  try {
    if (typeof __dirname !== 'undefined') {
      // From dist/logic or src/logic -> ../../bin/logic-ax-bridge
      const candidate = resolve(__dirname, '../../bin/logic-ax-bridge');
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Fallback below
  }

  const workspaceCandidate =
    '/Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/packages/daw-adapters/bin/logic-ax-bridge';
  if (existsSync(workspaceCandidate)) {
    return workspaceCandidate;
  }

  return resolve(process.cwd(), 'packages/daw-adapters/bin/logic-ax-bridge');
}

/**
 * Normalizes German/European decimal commas ("240,0" -> "240.0") before numeric parsing
 */
export function parseLocaleFloat(rawStr: string | number | boolean | undefined): number {
  if (typeof rawStr === 'number') return rawStr;
  if (typeof rawStr === 'boolean') return rawStr ? 1 : 0;
  if (!rawStr) return NaN;
  const trimmed = String(rawStr).trim();
  if (trimmed.toLowerCase() === 'true') return 1;
  if (trimmed.toLowerCase() === 'false') return 0;
  const normalized = trimmed.replace(/,/g, '.');
  return Number(normalized);
}

/**
 * Recursive depth-first search through an AXElementNode hierarchy (descending through AXGroup containers).
 *
 * Matching Priority Order:
 *   1. Exact NS-Identifier (e.g. "_NS:153")
 *   2. Visible title / label / description (e.g. "Low Cut Frequency", "Peak 3 Gain")
 *   3. Help-Prefix (e.g. "Threshold knob")
 */
export function findAXElement(
  rootElement: AXElementNode,
  criteria: AXSearchCriteria
): AXElementNode | null {
  // Pass 1: Match by exact NS-Identifier (highest priority)
  if (criteria.identifier) {
    const byId = findAXElementByPass(rootElement, criteria.role, (node) =>
      node.identifier === criteria.identifier
    );
    if (byId) return byId;
  }

  // Pass 2: Match by visible title / label / description
  if (criteria.title) {
    const targetTitle = criteria.title.toLowerCase();
    const byTitle = findAXElementByPass(rootElement, criteria.role, (node) =>
      node.title?.toLowerCase() === targetTitle ||
      node.description?.toLowerCase() === targetTitle
    );
    if (byTitle) return byTitle;
  }

  // Pass 3: Match by Help-Prefix
  if (criteria.helpPrefix) {
    const targetHelp = criteria.helpPrefix.toLowerCase();
    const byHelp = findAXElementByPass(rootElement, criteria.role, (node) =>
      Boolean(node.help && node.help.toLowerCase().startsWith(targetHelp))
    );
    if (byHelp) return byHelp;
  }

  return null;
}

function findAXElementByPass(
  node: AXElementNode,
  expectedRole: string | undefined,
  predicate: (n: AXElementNode) => boolean
): AXElementNode | null {
  const roleMatches = !expectedRole || node.role === expectedRole;
  if (roleMatches && predicate(node)) {
    return node;
  }

  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      const found = findAXElementByPass(child, expectedRole, predicate);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Maps a Channel EQ band number (1..8) to its AXCheckBox description so the band is automatically enabled when adjusted.
 */
function getChannelEQBandCheckboxName(band?: number): string | undefined {
  switch (band) {
    case 1:
      return 'Low Cut';
    case 2:
      return 'Low Shelf';
    case 3:
      return 'Peak 1';
    case 4:
      return 'Peak 2';
    case 5:
      return 'Peak 3';
    case 6:
      return 'Peak 4';
    case 7:
      return 'High Shelf';
    case 8:
      return 'High Cut';
    default:
      return undefined;
  }
}

/**
 * Native macOS Accessibility Framework (AXUIElement) client for Apple Logic Pro.
 * Executes sub-millisecond queries and atomic parameter updates via the compiled Swift sidecar (`logic-ax-bridge`).
 */
export class MacOSAccessibilityClient {
  private readonly timeoutMs: number;
  private readonly bridgeBin: string;

  constructor(options: AccessibilityClientOptions = {}) {
    this.timeoutMs = options.commandTimeoutMs ?? 3000;
    this.bridgeBin = options.bridgeBinaryPath ?? resolveBridgeBinaryPath();
  }

  /** Expose recursive element search on the client instance as well */
  public findAXElement(
    rootElement: AXElementNode,
    criteria: AXSearchCriteria
  ): AXElementNode | null {
    return findAXElement(rootElement, criteria);
  }

  /** Execute the native Swift `logic-ax-bridge` CLI and parse its JSON response */
  private async runBridge<T>(args: string[]): Promise<T | null> {
    try {
      const { stdout } = await execFileAsync(this.bridgeBin, args, {
        timeout: this.timeoutMs
      });
      const trimmed = stdout.trim();
      if (!trimmed) return null;
      return JSON.parse(trimmed) as T;
    } catch {
      return null;
    }
  }

  /** Check whether Logic Pro is running and accessible via native AXUIElement */
  public async checkPermissions(): Promise<boolean> {
    const windows = await this.runBridge<ScanWindowEntry[]>(['scan-windows']);
    return Array.isArray(windows);
  }

  /**
   * Reads a single plugin parameter from a Logic Pro plugin window using native AXUIElement traversal
   * and transforms its raw AXValue into the real engineering displayValue (Hz, dB, ms, :1).
   */
  public async readPluginParameter(
    windowTitle: string,
    paramSpec: PluginParameterSpec
  ): Promise<{ rawValue: number; displayValue: number; formatted: string } | null> {
    const criteria = paramSpec.editorAX;
    if (!criteria) return null;

    const rawFromBridge = await this.queryRawValueFast(windowTitle, criteria);
    if (rawFromBridge === null) return null;

    const displayValue = rawToDisplay(rawFromBridge, paramSpec);
    const formatted = formatDisplayValue(displayValue, paramSpec.unit ?? '', paramSpec.type);
    return { rawValue: rawFromBridge, displayValue, formatted };
  }

  /**
   * Writes an engineering displayValue (e.g. 440 Hz or -2.5 dB) to a Logic Pro plugin parameter:
   * 1. Executes any panel prerequisite (writePrereq, e.g. switching Compressor right panel to Output/Side Chain)
   * 2. Transforms displayValue -> rawValue using the parameter's mathematical curve (log, linear, curveTable)
   * 3. Locates the control via native Swift AXUIElement DFS (priority: _NS: identifier -> description/title -> helpPrefix)
   * 4. Atomically sets kAXValueAttribute (and auto-enables the EQ band checkbox if adjusting an inactive EQ band)
   */
  public async writePluginParameter(
    windowTitle: string,
    paramSpec: PluginParameterSpec,
    displayValue: number,
    pluginSpec?: PluginSpecification | null
  ): Promise<{ success: boolean; rawValue: number; displayValue: number }> {
    const criteria = paramSpec.editorAX;
    const rawValue = displayToRaw(displayValue, paramSpec);

    if (!criteria) {
      return { success: false, rawValue, displayValue };
    }

    // 1. Handle panel prerequisite if defined (e.g. Compressor right_panel_view -> "output" or "side_chain")
    if (paramSpec.writePrereq) {
      const parentSpec = pluginSpec ?? findPluginSpecification(windowTitle);
      const prereqParam = parentSpec?.parameters.find(
        (p) => p.id === paramSpec.writePrereq?.parameterId
      );
      const prereqOption = prereqParam?.options?.find(
        (o) => o.id === paramSpec.writePrereq?.option
      );
      if (prereqOption?.editorAX) {
        await this.pressAXButtonFast(windowTitle, prereqOption.editorAX);
      }
    }

    // 2. Auto-enable the Channel EQ band if modifying a band's Gain/Frequency/Slope
    const enableBand =
      paramSpec.type !== 'toggle' ? getChannelEQBandCheckboxName(paramSpec.band) : undefined;

    // 3. Write rawValue via native Swift AXUIElement sidecar
    const applied = await this.setRawValueFast(
      windowTitle,
      criteria,
      rawValue,
      paramSpec.type,
      enableBand
    );
    return { success: applied, rawValue, displayValue };
  }

  /**
   * Sub-millisecond native extraction of the AXElementNode tree for a Logic Pro plugin window
   * via `logic-ax-bridge dump-window`.
   */
  public async fetchWindowAXTree(windowTitle: string): Promise<AXElementNode | null> {
    const res = await this.runBridge<DumpWindowResponse>([
      'dump-window',
      '--window',
      windowTitle
    ]);

    if (!res || !res.success || !Array.isArray(res.controls)) {
      return null;
    }

    return {
      role: 'AXWindow',
      title: res.windowTitle ?? windowTitle,
      children: [
        {
          role: 'AXGroup',
          children: res.controls
        }
      ]
    };
  }

  /**
   * Native Swift `logic-ax-bridge read-param` reader following the 3-step priority:
   * 1. Exact NS-Identifier ("_NS:153")
   * 2. Visible Title / Description ("Low Cut Frequency", "Peak 3 Gain")
   * 3. Help-Prefix ("Threshold knob")
   */
  public async queryRawValueFast(
    windowTitle: string,
    criteria: AXSearchCriteria
  ): Promise<number | null> {
    const args: string[] = ['read-param', '--window', windowTitle];
    if (criteria.role) {
      args.push('--role', criteria.role);
    }
    if (criteria.identifier) {
      args.push('--identifier', criteria.identifier);
    }
    if (criteria.title) {
      args.push('--description', criteria.title);
    }
    if (criteria.helpPrefix) {
      args.push('--help', criteria.helpPrefix);
    }

    const res = await this.runBridge<ReadParamResponse>(args);
    if (!res || !res.success || typeof res.rawValue !== 'number') {
      return null;
    }
    return res.rawValue;
  }

  /**
   * Native Swift `logic-ax-bridge set-param` writer following the 3-step priority:
   * 1. Exact NS-Identifier ("_NS:153")
   * 2. Visible Title / Description ("Low Cut Frequency", "Peak 3 Gain")
   * 3. Help-Prefix ("Threshold knob")
   */
  public async setRawValueFast(
    windowTitle: string,
    criteria: AXSearchCriteria,
    rawValue: number,
    _paramType: PluginParameterSpec['type'] = 'continuous',
    enableBand?: string
  ): Promise<boolean> {
    const numericVal = Number.isFinite(rawValue) ? rawValue : 0;
    const args: string[] = [
      'set-param',
      '--window',
      windowTitle,
      '--value',
      String(numericVal)
    ];

    if (criteria.role) {
      args.push('--role', criteria.role);
    }
    if (criteria.identifier) {
      args.push('--identifier', criteria.identifier);
    }
    if (criteria.title) {
      args.push('--description', criteria.title);
    }
    if (criteria.helpPrefix) {
      args.push('--help', criteria.helpPrefix);
    }
    if (enableBand) {
      args.push('--enable-band', enableBand);
    }

    const res = await this.runBridge<SetParamResponse>(args);
    return Boolean(res?.success);
  }

  private async pressAXButtonFast(
    windowTitle: string,
    criteria: AXSearchCriteria
  ): Promise<boolean> {
    return this.setRawValueFast(
      windowTitle,
      { ...criteria, role: criteria.role ?? 'AXButton' },
      1,
      'toggle'
    );
  }

  /**
   * Discovers every open plugin window in Logic Pro via `logic-ax-bridge scan-windows`
   * and extracts its parameters via native AXUIElement tree traversal.
   */
  public async scanOpenPluginWindows(): Promise<
    Array<{ trackName?: string; plugin: PluginMetadata }>
  > {
    const rawWindows = await this.runBridge<ScanWindowEntry[]>(['scan-windows']);
    if (!Array.isArray(rawWindows) || rawWindows.length === 0) {
      return [];
    }

    const pluginWindows = rawWindows.filter(
      (w) =>
        (w.subrole === 'AXDialog' || w.subrole === 'AXFloatingWindow') &&
        w.title &&
        w.title.trim().length > 0 &&
        !isSystemDialog(w.title.trim())
    );

    const results: Array<{ trackName?: string; plugin: PluginMetadata }> = [];

    for (const win of pluginWindows) {
      const windowTitle = win.title.trim();
      const pluginName =
        win.pluginName && win.pluginName.trim().length > 0
          ? win.pluginName.trim()
          : windowTitle;

      const params = await this.extractPluginParameters(windowTitle, pluginName);

      results.push({
        trackName: windowTitle,
        plugin: {
          slotIndex: 0,
          pluginName,
          vendor: 'Apple / Audio Unit',
          format: 'au',
          isBypassed: false,
          parameters: params
        }
      });
    }

    return results;
  }

  /**
   * Extracts parameters from an open plugin window using the native Swift `dump-window` tree
   * and matching against the Plugin Specification Database (ChannelEQ.json / Compressor.json).
   */
  public async extractPluginParameters(
    windowTitle: string,
    pluginName: string = windowTitle
  ): Promise<PluginParameter[]> {
    const tree = await this.fetchWindowAXTree(windowTitle);
    if (!tree) return [];

    const pluginSpec =
      findPluginSpecification(pluginName) ?? findPluginSpecification(windowTitle);

    if (pluginSpec) {
      const parameters: PluginParameter[] = [];
      for (const paramSpec of pluginSpec.parameters) {
        if (paramSpec.hidden || !paramSpec.editorAX) continue;
        const node = this.findAXElement(tree, paramSpec.editorAX);
        if (!node || node.value === undefined) continue;

        const rawValue = parseLocaleFloat(node.value);
        if (Number.isNaN(rawValue)) continue;

        const currentValue = Math.round(rawToDisplay(rawValue, paramSpec) * 100) / 100;
        const displayValue =
          node.valueDescription ||
          formatDisplayValue(currentValue, paramSpec.unit ?? '', paramSpec.type);

        parameters.push({
          id: paramSpec.id,
          name: paramSpec.label,
          currentValue,
          minValue: paramSpec.displayMin ?? 0,
          maxValue: paramSpec.displayMax ?? 1,
          displayValue,
          unit: paramSpec.unit ?? ''
        });
      }
      if (parameters.length > 0) {
        return parameters;
      }
    }

    // Fallback for 3rd-party AU plugins: collect all slider/checkbox nodes from the native dump
    const leafNodes = tree.children?.[0]?.children ?? [];
    const genericParams: PluginParameter[] = [];
    for (const node of leafNodes) {
      const label = node.title || node.description || node.help || node.identifier;
      if (!label) continue;
      const rawVal = parseLocaleFloat(node.value);
      const numericVal = Number.isNaN(rawVal) ? 0 : rawVal;

      genericParams.push({
        id: (node.identifier || `param_${label}`).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        name: label,
        currentValue: numericVal,
        minValue: node.minValue ?? 0,
        maxValue: node.maxValue ?? 1,
        displayValue: node.valueDescription || `${numericVal}`,
        unit: ''
      });
    }

    return genericParams;
  }

  /**
   * Inspect a specific plugin slot in a named track's plugin window.
   */
  public async inspectPluginWindow(
    trackName: string,
    slotIndex: number,
    expectedPluginName?: string
  ): Promise<PluginMetadata | null> {
    try {
      const allPlugins = await this.scanOpenPluginWindows();
      const match =
        allPlugins.find(
          (p) =>
            p.trackName?.toLowerCase() === trackName.toLowerCase() &&
            (!expectedPluginName ||
              p.plugin.pluginName.toLowerCase().includes(expectedPluginName.toLowerCase()))
        ) ??
        allPlugins.find(
          (p) =>
            expectedPluginName &&
            p.plugin.pluginName.toLowerCase().includes(expectedPluginName.toLowerCase())
        ) ??
        allPlugins.find((p) => p.trackName?.toLowerCase() === trackName.toLowerCase()) ??
        allPlugins[slotIndex] ??
        allPlugins[0];

      if (!match) return null;
      return { ...match.plugin, slotIndex };
    } catch {
      return null;
    }
  }

  /**
   * High-level parameter setter that resolves the plugin specification (Channel EQ / Compressor)
   * and delegates to writePluginParameter with curve transformation.
   */
  public async setPluginParameter(
    trackName: string,
    _slotIndex: number,
    paramNameOrId: string,
    displayValue: number,
    pluginNameHint?: string
  ): Promise<boolean> {
    const pluginSpec = pluginNameHint ? findPluginSpecification(pluginNameHint) : null;
    const paramSpec = findParameterSpecification(paramNameOrId, pluginSpec);

    const windowQuery = trackName || pluginNameHint || pluginSpec?.name || 'Channel EQ';

    if (paramSpec) {
      const res = await this.writePluginParameter(windowQuery, paramSpec, displayValue, pluginSpec);
      if (res.success) return true;
      if (pluginSpec?.name && windowQuery !== pluginSpec.name) {
        const retry = await this.writePluginParameter(pluginSpec.name, paramSpec, displayValue, pluginSpec);
        return retry.success;
      }
      return false;
    }

    return this.setRawValueFast(
      windowQuery,
      { role: 'AXSlider', title: paramNameOrId, helpPrefix: paramNameOrId },
      displayValue
    );
  }

  /**
   * Query track names from Logic Pro's open windows via native Swift bridge
   */
  public async queryMixerChannels(): Promise<Partial<TrackDescriptor>[]> {
    const tracks = await this.scanLogicTracks();
    return tracks.map((t) => ({
      id: t.id,
      name: t.name,
      index: t.index
    }));
  }

  /**
   * Scan Logic Pro track names via native Swift `logic-ax-bridge scan-tracks`.
   */
  public async scanLogicTracks(): Promise<TrackDescriptor[]> {
    const names = await this.runBridge<string[]>(['scan-tracks']);
    if (!Array.isArray(names) || names.length === 0) {
      return [];
    }

    return names
      .filter((name) => name && !isSystemDialog(name))
      .map((name, i) => {
        const isMaster =
          name.toLowerCase().includes('stereo out') || name.toLowerCase().includes('master');
        return {
          id: isMaster ? 'track_master' : `logic_track_${i + 1}`,
          index: isMaster ? 0 : i + 1,
          name,
          type: isMaster ? ('master' as const) : ('audio' as const),
          volumeDb: 0.0,
          pan: 0.0,
          isMuted: false,
          isSoloed: false,
          isSelected: !isMaster && i === 0,
          insertSlots: []
        };
      });
  }

  /**
   * Create a new track in Apple Logic Pro
   */
  public async createTrack(_type: 'audio' | 'instrument' = 'audio', _name?: string): Promise<boolean> {
    return false;
  }

  /**
   * Toggle the bypass state of a plugin window's bypass button via native Swift bridge.
   */
  public async togglePluginBypass(trackName: string, _slotIndex: number): Promise<boolean> {
    const res = await this.runBridge<SetParamResponse>([
      'toggle-bypass',
      '--window',
      trackName
    ]);
    return Boolean(res?.success);
  }

  /**
   * Ensure the Logic Pro Channel EQ is opened for a track
   */
  public async ensureChannelEQLoaded(trackName: string): Promise<boolean> {
    const windows = await this.runBridge<ScanWindowEntry[]>(['scan-windows']);
    if (!Array.isArray(windows)) return false;
    return windows.some(
      (w) =>
        w.title.toLowerCase().includes(trackName.toLowerCase()) ||
        (w.pluginName ?? '').toLowerCase().includes('channel eq')
    );
  }

  /**
   * Profiles the currently open floating plugin window in Logic Pro via `logic-ax-bridge profile-plugin`
   */
  public async profileActivePlugin(
    windowTitle?: string
  ): Promise<import('./PluginRegistry.js').ProfiledPluginSpec | null> {
    const args = ['profile-plugin'];
    if (windowTitle && windowTitle.trim()) {
      args.push('--window', windowTitle.trim());
    }
    const res = await this.runBridge<
      import('./PluginRegistry.js').ProfiledPluginSpec & { success?: boolean; error?: string }
    >(args);
    if (!res || res.success === false || !res.pluginName) {
      return null;
    }
    return {
      schemaVersion: res.schemaVersion || '1.0',
      pluginName: res.pluginName,
      windowTitle: res.windowTitle,
      category: res.category || 'utility',
      parameters: Array.isArray(res.parameters) ? res.parameters : []
    };
  }
}
