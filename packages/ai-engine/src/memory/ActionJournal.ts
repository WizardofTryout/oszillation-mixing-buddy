/**
 * ActionJournal.ts – Deterministisches Session Action- & Routing-Journal (v1.0)
 * Oszillation Mixing Buddy (Universal AI Co-Producer)
 *
 * Verwaltet ein 50-Elemente In-Memory Ringpuffer-Journal aller angewendeten,
 * zurückgesetzten oder wiederhergestellten Parameteränderungen sowie
 * aktiver Sidechain-Verknüpfungen und Abhörpunkt-Kontexte.
 */

import type {
  JournalEntry,
  MonitoringContext,
  ParameterLineage,
  SidechainRoutingEntry
} from './types.js';

export class ActionJournalManager {
  private static instance: ActionJournalManager | null = null;

  private readonly maxEntries: number = 50;
  private entries: JournalEntry[] = [];
  private activeSidechains: Map<string, SidechainRoutingEntry> = new Map();
  private baseValueRegistry: Map<string, number> = new Map();

  constructor(maxEntries: number = 50) {
    this.maxEntries = maxEntries;
  }

  /**
   * Singleton-Instanz für globale Session-Verfügbarkeit
   */
  public static getInstance(): ActionJournalManager {
    if (!ActionJournalManager.instance) {
      ActionJournalManager.instance = new ActionJournalManager();
    }
    return ActionJournalManager.instance;
  }

  /**
   * Erzeugt einen deterministischen Key für die Basiswert-Registrierung
   */
  private makeParamKey(track: string, parameter: string, pluginName?: string | null): string {
    const p = (pluginName || 'strip').trim().toLowerCase();
    return `${track.trim().toLowerCase()}::${p}::${parameter.trim().toLowerCase()}`;
  }

  /**
   * Erzeugt einen Key für Sidechain-Routing-Einträge
   */
  private makeSidechainKey(targetTrack: string, targetSlot: number): string {
    return `${targetTrack.trim().toLowerCase()}::slot_${targetSlot}`;
  }

  /**
   * Protokolliert ein angewendetes Delta aus einer ActionCard
   */
  public recordAppliedDelta(params: {
    cardId?: string;
    cardTitle?: string;
    track: string;
    pluginName?: string | null;
    slotIndex?: number | null;
    parameter: string;
    previousValue: number;
    appliedValue: number;
    unit?: string;
    monitoringContext: MonitoringContext;
    rationaleSnippet?: string;
  }): JournalEntry {
    const key = this.makeParamKey(params.track, params.parameter, params.pluginName);

    // Initialer Ausgangswert: falls dieser Parameter noch nie modifiziert wurde,
    // ist previousValue der unberührte DAW-Originalzustand (baseValue)!
    if (!this.baseValueRegistry.has(key)) {
      this.baseValueRegistry.set(key, params.previousValue);
    }
    const baseValue = this.baseValueRegistry.get(key) ?? params.previousValue;

    const entryId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const lineage: ParameterLineage = {
      baseValue,
      oldValue: params.previousValue,
      newValue: params.appliedValue,
      unit: params.unit ?? 'dB'
    };

    const entry: JournalEntry = {
      id: entryId,
      cardId: params.cardId,
      cardTitle: params.cardTitle,
      timestamp: Date.now(),
      track: params.track,
      pluginName: params.pluginName ?? null,
      slotIndex: params.slotIndex ?? null,
      parameter: params.parameter,
      lineage,
      status: 'applied',
      monitoringContext: params.monitoringContext,
      rationaleSnippet: params.rationaleSnippet?.slice(0, 80)
    };

    this.entries.unshift(entry);

    // Ringpuffer-Beschränkung
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }

    return entry;
  }

  /**
   * Protokolliert ein physisches Sidechain-Routing
   */
  public recordSidechain(routing: {
    targetTrack: string;
    targetSlot: number;
    sourceTrack: string;
    status?: 'active' | 'bypassed' | 'removed';
  }): SidechainRoutingEntry {
    const scKey = this.makeSidechainKey(routing.targetTrack, routing.targetSlot);
    const isDisconnected =
      routing.sourceTrack.toLowerCase() === 'none' ||
      routing.status === 'removed';

    const entry: SidechainRoutingEntry = {
      targetTrack: routing.targetTrack,
      targetSlot: routing.targetSlot,
      sourceTrack: routing.sourceTrack,
      status: isDisconnected ? 'removed' : (routing.status ?? 'active'),
      timestamp: Date.now()
    };

    if (isDisconnected) {
      this.activeSidechains.delete(scKey);
    } else {
      this.activeSidechains.set(scKey, entry);
    }

    return entry;
  }

  /**
   * Aktualisiert den Status aller Aktionen einer bestimmten Karte (z. B. bei Undo oder Rollback)
   */
  public recordStatusChange(cardId: string, status: JournalEntry['status']): void {
    for (const entry of this.entries) {
      if (entry.cardId === cardId) {
        entry.status = status;
      }
    }
  }

  /**
   * Aktualisiert den Status eines einzelnen Parameters (z. B. Rollback/Redo eines einzelnen Deltas)
   */
  public recordDeltaStatus(
    cardId: string,
    track: string,
    parameter: string,
    status: JournalEntry['status']
  ): void {
    const entry = this.entries.find(
      (e) =>
        e.cardId === cardId &&
        e.track.toLowerCase() === track.toLowerCase() &&
        e.parameter.toLowerCase() === parameter.toLowerCase()
    );
    if (entry) {
      entry.status = status;
    }
  }

  /**
   * Ermittelt die exakte Wert-Historie (Base, Old, New) für eine Spur und einen Parameter
   */
  public findLineage(
    track: string,
    parameter: string,
    pluginName?: string | null
  ): ParameterLineage | null {
    const key = this.makeParamKey(track, parameter, pluginName);
    const baseValue = this.baseValueRegistry.get(key);

    const latestApplied = this.entries.find(
      (e) =>
        e.track.toLowerCase() === track.toLowerCase() &&
        e.parameter.toLowerCase() === parameter.toLowerCase() &&
        e.status === 'applied'
    );

    if (!latestApplied && baseValue === undefined) {
      return null;
    }

    return {
      baseValue: baseValue ?? latestApplied?.lineage.baseValue ?? 0,
      oldValue: latestApplied ? latestApplied.lineage.oldValue : (baseValue ?? 0),
      newValue: latestApplied ? latestApplied.lineage.newValue : (baseValue ?? 0),
      unit: latestApplied?.lineage.unit ?? 'dB'
    };
  }

  /**
   * Liefert alle aktiven Sidechain-Routings
   */
  public getActiveSidechains(): SidechainRoutingEntry[] {
    return Array.from(this.activeSidechains.values()).filter(
      (s) => s.status === 'active'
    );
  }

  /**
   * Liefert die letzten Aktionen (chronologisch absteigend)
   */
  public getRecentActions(limit: number = 10): JournalEntry[] {
    return this.entries.slice(0, limit);
  }

  /**
   * Liefert das gesamte Journal
   */
  public getAllEntries(): JournalEntry[] {
    return [...this.entries];
  }

  /**
   * Löscht das Journal für eine neue Session
   */
  public clear(): void {
    this.entries = [];
    this.activeSidechains.clear();
    this.baseValueRegistry.clear();
  }

  /**
   * Stellt das Journal aus einem gespeicherten Session-Snapshot wieder her
   */
  public restoreFromSnapshot(
    entries: JournalEntry[],
    sidechains?: SidechainRoutingEntry[]
  ): void {
    this.clear();
    this.entries = [...entries].slice(0, this.maxEntries);

    // Basiswerte aus der Historie rekonstruieren
    for (const e of [...entries].reverse()) {
      const key = this.makeParamKey(e.track, e.parameter, e.pluginName);
      if (!this.baseValueRegistry.has(key)) {
        this.baseValueRegistry.set(key, e.lineage.baseValue);
      }
    }

    if (sidechains) {
      for (const sc of sidechains) {
        if (sc.status === 'active') {
          this.activeSidechains.set(this.makeSidechainKey(sc.targetTrack, sc.targetSlot), sc);
        }
      }
    }
  }

  /**
   * Serialisiert das gesamte Journal inklusive aktiver Sidechains
   */
  public serialize(): { entries: JournalEntry[]; sidechains: SidechainRoutingEntry[] } {
    return {
      entries: this.getAllEntries(),
      sidechains: this.getActiveSidechains()
    };
  }

  /**
   * Deserialisiert ein gespeichertes Journal
   */
  public deserialize(data: { entries: JournalEntry[]; sidechains?: SidechainRoutingEntry[] }): void {
    this.restoreFromSnapshot(data.entries || [], data.sidechains || []);
  }

  /**
   * Erzeugt eine ultra-kompakte Zusammenfassung (≤ 150 Tokens) für den KI-System-Prompt
   */
  public toCompactPromptSummary(): string {
    const applied = this.entries.filter((e) => e.status === 'applied');
    const sidechains = this.getActiveSidechains();

    if (applied.length === 0 && sidechains.length === 0) {
      return '';
    }

    const lines: string[] = ['### SESSION ACTION JOURNAL (GROUND TRUTH):'];

    if (sidechains.length > 0) {
      lines.push('Active Sidechain Routings:');
      for (const sc of sidechains) {
        lines.push(`- ${sc.targetTrack} (Slot ${sc.targetSlot}) ← Trigger: ${sc.sourceTrack}`);
      }
    }

    if (applied.length > 0) {
      lines.push('Recent Parameter Adjustments:');
      // Zeige die letzten max. 6 angewendeten Modifikationen
      for (const item of applied.slice(0, 6)) {
        const plug = item.pluginName ? `${item.pluginName} > ` : '';
        const lin = item.lineage;
        lines.push(
          `- ${item.track} > ${plug}${item.parameter}: ` +
          `Original: ${lin.baseValue.toFixed(1)}${lin.unit} → ` +
          `Vorher: ${lin.oldValue.toFixed(1)}${lin.unit} → ` +
          `Jetzt: ${lin.newValue.toFixed(1)}${lin.unit}`
        );
      }
    }

    return lines.join('\n');
  }
}

export const actionJournal = ActionJournalManager.getInstance();
