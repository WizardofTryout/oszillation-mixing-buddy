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

export interface DialogueTurn {
  turnIndex: number;
  timestamp: number;
  userPrompt: string;
  aiSummary: string;
  appliedActionIds?: string[];
  monitoringTrack?: string;
}

export interface RollingDialogueState {
  recentTurns: DialogueTurn[];
  condensedHistorySummary: string;
}

export interface OmbSessionFile {
  schemaVersion: '1.0.0';
  sessionUuid: string;
  sessionName: string;
  daw: 'logic_pro' | 'nuendo' | 'generic';
  createdAt: string;
  updatedAt: string;
  actionJournal: JournalEntry[];
  dialogueHistory: RollingDialogueState;
  activeSidechains: SidechainRoutingEntry[];
  learnedTrackScopes: Record<string, TargetScope>;
  targetProfile?: string;
  customNotes?: string;
  monitoringTimeline?: Array<{ timestamp: number; track: string; scope: TargetScope }>;
}

/**
 * Validiert und migriert ein eingelesenes Session-Objekt.
 * Wirft verständliche Fehler bei defektem Format oder inkompatibler Version (>= 2.x).
 */
export function validateAndMigrateSession(raw: unknown): OmbSessionFile {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Ungültiges Session-Dateiformat: Datei enthält kein gültiges JSON-Objekt.');
  }

  const obj = raw as Record<string, any>;

  // Schema-Versionsprüfung
  const schemaVersion = obj.schemaVersion;
  if (typeof schemaVersion === 'string') {
    const major = parseInt(schemaVersion.split('.')[0] || '1', 10);
    if (major > 1) {
      throw new Error(
        `Nicht unterstützte Schema-Version '${schemaVersion}'. Diese Version von Mixing Buddy unterstützt bis Version 1.x.x. Bitte aktualisiere die App.`
      );
    }
  }

  // Validierung Pflichtfelder
  if (obj.actionJournal !== undefined && !Array.isArray(obj.actionJournal)) {
    throw new Error('Ungültiges Session-Dateiformat: "actionJournal" muss ein Array sein.');
  }

  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0.0',
    sessionUuid: typeof obj.sessionUuid === 'string' && obj.sessionUuid ? obj.sessionUuid : `proj_${Date.now()}`,
    sessionName: typeof obj.sessionName === 'string' && obj.sessionName ? obj.sessionName : 'Unbenannte Session',
    daw: obj.daw === 'nuendo' || obj.daw === 'generic' ? obj.daw : 'logic_pro',
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : now,
    updatedAt: now,
    actionJournal: Array.isArray(obj.actionJournal) ? obj.actionJournal : [],
    dialogueHistory: obj.dialogueHistory && typeof obj.dialogueHistory === 'object'
      ? {
          recentTurns: Array.isArray(obj.dialogueHistory.recentTurns) ? obj.dialogueHistory.recentTurns : [],
          condensedHistorySummary: typeof obj.dialogueHistory.condensedHistorySummary === 'string' ? obj.dialogueHistory.condensedHistorySummary : ''
        }
      : { recentTurns: [], condensedHistorySummary: '' },
    activeSidechains: Array.isArray(obj.activeSidechains) ? obj.activeSidechains : [],
    learnedTrackScopes: obj.learnedTrackScopes && typeof obj.learnedTrackScopes === 'object' ? obj.learnedTrackScopes : {},
    targetProfile: typeof obj.targetProfile === 'string' ? obj.targetProfile : undefined,
    customNotes: typeof obj.customNotes === 'string' ? obj.customNotes : undefined,
    monitoringTimeline: Array.isArray(obj.monitoringTimeline) ? obj.monitoringTimeline : []
  };
}

