/**
 * DawDriftGuard.ts – DAW Session Drift Detection
 * Oszillation Mixing Buddy (Universal AI Co-Producer)
 *
 * Compares insert plugins and tracks recorded in the ActionJournal
 * against the current live DAW session state.
 *
 * Prevents AI from hallucinating or attempting to modify plugins
 * that were deleted, moved, or replaced in the DAW.
 */

import type { JournalEntry } from './types.js';

export interface DriftWarning {
  type: 'missing_track' | 'missing_plugin';
  track: string;
  pluginName?: string | null;
  slotIndex?: number | null;
  message: string;
}

export interface DriftCheckResult {
  hasDrift: boolean;
  warnings: DriftWarning[];
  summaryText: string;
}

export interface ChannelStripSummary {
  t?: string;
  trackName?: string;
  fx?: string[];
  inserts?: Array<{ name: string; slotIndex?: number }>;
}

export class DawDriftGuard {
  /**
   * Compares journal entries against currently available channel strips / tracks.
   * Detects deleted tracks or removed/swapped insert plugins.
   */
  public static checkDrift(
    journalEntries: JournalEntry[],
    currentStrips: ChannelStripSummary[]
  ): DriftCheckResult {
    const warnings: DriftWarning[] = [];
    if (!journalEntries || journalEntries.length === 0 || !currentStrips || currentStrips.length === 0) {
      return { hasDrift: false, warnings: [], summaryText: '' };
    }

    // Build a map of current tracks and their lowercase insert plugin names
    const currentTrackMap = new Map<string, Set<string>>();
    for (const strip of currentStrips) {
      const rawName = strip.t || strip.trackName;
      if (!rawName) continue;
      const normalizedName = rawName.trim().toLowerCase();
      const plugins = new Set<string>();

      if (Array.isArray(strip.fx)) {
        for (const f of strip.fx) {
          if (f) plugins.add(f.trim().toLowerCase());
        }
      }
      if (Array.isArray(strip.inserts)) {
        for (const ins of strip.inserts) {
          if (ins?.name) plugins.add(ins.name.trim().toLowerCase());
        }
      }
      currentTrackMap.set(normalizedName, plugins);
    }

    // Check unique (track, plugin) combinations from applied journal entries
    const checkedCombinations = new Set<string>();

    for (const entry of journalEntries) {
      if (entry.status !== 'applied') continue;

      const rawTrack = entry.track || '';
      const trackKey = rawTrack.trim().toLowerCase();
      const rawPlugin = entry.pluginName || '';
      const comboKey = `${trackKey}::${rawPlugin}::${entry.slotIndex || 0}`;

      if (checkedCombinations.has(comboKey)) continue;
      checkedCombinations.add(comboKey);

      const existingPlugins = currentTrackMap.get(trackKey);
      if (!existingPlugins) {
        warnings.push({
          type: 'missing_track',
          track: rawTrack,
          message: `Spur '${rawTrack}' wurde in der DAW umbenannt oder gelöscht.`
        });
        continue;
      }

      if (rawPlugin) {
        const plugKey = rawPlugin.trim().toLowerCase();
        // Check if plugin is still on the track (fuzzy check)
        let found = false;
        for (const p of existingPlugins) {
          if (p.includes(plugKey) || plugKey.includes(p)) {
            found = true;
            break;
          }
        }
        if (!found) {
          const slotLabel = typeof entry.slotIndex === 'number' && entry.slotIndex > 0 ? ` (Slot ${entry.slotIndex})` : '';
          warnings.push({
            type: 'missing_plugin',
            track: rawTrack,
            pluginName: rawPlugin,
            slotIndex: entry.slotIndex,
            message: `Plugin '${rawPlugin}' auf Spur '${rawTrack}'${slotLabel} wurde in der DAW entfernt oder ausgetauscht.`
          });
        }
      }
    }

    const hasDrift = warnings.length > 0;
    let summaryText = '';
    if (hasDrift) {
      summaryText =
        `⚠️ DAW DRIFT WARNING (Session state modified since previous actions):\n` +
        warnings.map((w) => `- ${w.message} Greife NICHT blind auf diesen Regler zu!`).join('\n') +
        `\n`;
    }

    return { hasDrift, warnings, summaryText };
  }
}
