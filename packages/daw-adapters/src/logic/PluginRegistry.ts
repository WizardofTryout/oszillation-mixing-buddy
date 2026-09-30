import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CHANNEL_EQ_SPEC,
  COMPRESSOR_SPEC,
  type PluginParameterSpec,
  type PluginSpecification
} from './transformers.js';

export interface ProfiledParameterItem {
  id: string;
  name: string;
  role: string;
  identifier?: string;
  description?: string;
  help?: string;
  rawMin: number;
  rawMax: number;
  displayMin: number;
  displayMax: number;
  currentRawValue?: number;
  valueDescription?: string;
  unit: string;
}

export interface ProfiledPluginSpec {
  schemaVersion: string;
  pluginName: string;
  windowTitle?: string;
  category: string;
  /** Auto-generated or user-edited tag array, e.g. ["SATURATION", "COLOR"] */
  tags?: string[];
  parameters: ProfiledParameterItem[];
}

export interface PluginSummary {
  slug: string;
  pluginName: string;
  category: string;
  /** Resolved tags (always present; falls back to [category.toUpperCase()] if absent in JSON) */
  tags: string[];
  parameterCount: number;
  isBuiltIn: boolean;
  filePath?: string;
}

/**
 * Derives a sensible default tag list from a category string when no explicit tags are stored.
 */
export function inferTagsFromCategory(category: string): string[] {
  const c = category.toLowerCase();
  if (c === 'eq') return ['EQ'];
  if (c === 'dynamics') return ['DYNAMICS'];
  if (c === 'saturation') return ['SATURATION'];
  if (c === 'reverb') return ['REVERB'];
  if (c === 'delay') return ['DELAY'];
  if (c === 'modulation') return ['MODULATION'];
  return [category.toUpperCase()];
}

/**
 * Returns the persistent Plugin Vault directory: `~/.mixing-buddy/plugins`
 */
export function getPluginVaultDir(): string {
  const dir = join(homedir(), '.mixing-buddy', 'plugins');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Converts a plugin name (e.g. "FabFilter Pro-Q 3") into a clean file slug ("fabfilter_pro_q_3")
 */
export function toPluginSlug(pluginName: string): string {
  return pluginName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'custom_plugin';
}

/**
 * Converts a `ProfiledPluginSpec` from `logic-ax-bridge profile-plugin` into a runtime `PluginSpecification`
 */
export function convertProfiledToRuntimeSpec(profiled: ProfiledPluginSpec): PluginSpecification {
  const params: PluginParameterSpec[] = (profiled.parameters ?? []).map((p) => {
    const isToggle = p.role === 'AXCheckBox' || p.role === 'AXButton';
    const isLog = p.unit === 'Hz' || p.unit === 'Q' || p.unit === ':1';
    return {
      id: p.id,
      label: p.name,
      type: isToggle ? 'toggle' : 'continuous',
      unit: p.unit || '',
      displayMin: p.displayMin,
      displayMax: p.displayMax,
      rawMin: p.rawMin,
      rawMax: p.rawMax,
      curve: isLog ? 'logarithmic' : 'linear',
      editorAX: {
        role: p.role,
        identifier: p.identifier || undefined,
        title: p.description || p.name,
        helpPrefix: p.help || undefined
      }
    };
  });

  return {
    name: profiled.pluginName,
    aliases: [profiled.pluginName.toLowerCase(), toPluginSlug(profiled.pluginName)],
    parameters: params
  };
}

/**
 * Saves a `ProfiledPluginSpec` into `~/.mixing-buddy/plugins/<PluginNameSlug>.json`
 */
export function saveLearnedPluginToVault(spec: ProfiledPluginSpec): {
  slug: string;
  filePath: string;
  spec: ProfiledPluginSpec;
} {
  const vaultDir = getPluginVaultDir();
  const slug = toPluginSlug(spec.pluginName);
  const filePath = join(vaultDir, `${slug}.json`);
  const resolvedTags =
    Array.isArray(spec.tags) && spec.tags.length > 0
      ? spec.tags
      : inferTagsFromCategory(spec.category || 'utility');
  const payload: ProfiledPluginSpec = {
    schemaVersion: spec.schemaVersion || '1.0',
    pluginName: spec.pluginName,
    windowTitle: spec.windowTitle,
    category: spec.category || 'utility',
    tags: resolvedTags,
    parameters: spec.parameters || []
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { slug, filePath, spec: payload };
}

/**
 * Overwrites the `tags` field on an existing vault JSON and returns the updated spec.
 * Throws if the file does not exist.
 */
export function updatePluginTags(slug: string, tags: string[]): ProfiledPluginSpec {
  const vaultDir = getPluginVaultDir();
  const filePath = join(vaultDir, `${slug}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`Plugin-Datei '${filePath}' nicht gefunden.`);
  }
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as ProfiledPluginSpec;
  parsed.tags = tags.map((t) => t.trim().toUpperCase()).filter(Boolean);
  writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  return parsed;
}

/**
 * Loads all user-learned `ProfiledPluginSpec` files from `~/.mixing-buddy/plugins/`
 */
export function loadVaultPluginSpecs(): Array<{
  slug: string;
  filePath: string;
  profiled: ProfiledPluginSpec;
  runtime: PluginSpecification;
}> {
  const vaultDir = getPluginVaultDir();
  if (!existsSync(vaultDir)) return [];

  const entries: Array<{
    slug: string;
    filePath: string;
    profiled: ProfiledPluginSpec;
    runtime: PluginSpecification;
  }> = [];

  try {
    const files = readdirSync(vaultDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const fullPath = join(vaultDir, file);
      try {
        const raw = readFileSync(fullPath, 'utf8');
        const parsed = JSON.parse(raw) as ProfiledPluginSpec;
        if (parsed && parsed.pluginName && Array.isArray(parsed.parameters)) {
          const slug = file.replace(/\.json$/i, '');
          entries.push({
            slug,
            filePath: fullPath,
            profiled: parsed,
            runtime: convertProfiledToRuntimeSpec(parsed)
          });
        }
      } catch {
        // Ignore malformed files
      }
    }
  } catch {
    // Directory read failed
  }

  return entries;
}

/**
 * Lists all plugins (both built-in stock presets and user-learned plugins from `~/.mixing-buddy/plugins/`)
 */
export function listAllRegisteredPlugins(): PluginSummary[] {
  const summaries: PluginSummary[] = [
    {
      slug: 'channel_eq',
      pluginName: CHANNEL_EQ_SPEC.name,
      category: 'eq',
      tags: ['EQ', 'STOCK'],
      parameterCount: CHANNEL_EQ_SPEC.parameters.filter((p) => !p.hidden).length,
      isBuiltIn: true
    },
    {
      slug: 'compressor',
      pluginName: COMPRESSOR_SPEC.name,
      category: 'dynamics',
      tags: ['DYNAMICS', 'COMPRESSOR', 'STOCK'],
      parameterCount: COMPRESSOR_SPEC.parameters.filter((p) => !p.hidden).length,
      isBuiltIn: true
    }
  ];

  const vaultItems = loadVaultPluginSpecs();
  for (const item of vaultItems) {
    const rawTags = Array.isArray(item.profiled.tags) && item.profiled.tags.length > 0
      ? item.profiled.tags
      : inferTagsFromCategory(item.profiled.category || 'utility');
    summaries.push({
      slug: item.slug,
      pluginName: item.profiled.pluginName,
      category: item.profiled.category || 'utility',
      tags: rawTags,
      parameterCount: item.profiled.parameters.length,
      isBuiltIn: false,
      filePath: item.filePath
    });
  }

  return summaries;
}

/**
 * Deletes a user-learned plugin from `~/.mixing-buddy/plugins/`
 */
export function deleteVaultPlugin(slugOrName: string): boolean {
  const vaultDir = getPluginVaultDir();
  const slug = toPluginSlug(slugOrName);
  const candidate = join(vaultDir, `${slug}.json`);
  if (existsSync(candidate)) {
    unlinkSync(candidate);
    return true;
  }
  return false;
}
