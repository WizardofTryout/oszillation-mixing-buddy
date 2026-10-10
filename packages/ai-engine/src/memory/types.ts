/**
 * Studio Memory Vault & Action Journal Types
 * Oszillation Mixing Buddy (Universal AI Co-Producer)
 */

import type { TargetScope } from '@mixing-buddy/shared-types';

export interface MonitoringContext {
  activeMeterTrack: string;
  targetScope: TargetScope;
}

export interface SidechainRoutingEntry {
  targetTrack: string;
  targetSlot: number;
  sourceTrack: string;
  status: 'active' | 'bypassed' | 'removed';
  timestamp: number;
}

export interface ParameterLineage {
  baseValue: number;
  oldValue: number;
  newValue: number;
  unit: string;
}

export interface JournalEntry {
  id: string;
  cardId?: string;
  cardTitle?: string;
  timestamp: number;
  track: string;
  pluginName?: string | null;
  slotIndex?: number | null;
  parameter: string;
  lineage: ParameterLineage;
  status: 'proposed' | 'applied' | 'rejected' | 'restored';
  monitoringContext: MonitoringContext;
  sidechainState?: SidechainRoutingEntry;
  rationaleSnippet?: string;
}
