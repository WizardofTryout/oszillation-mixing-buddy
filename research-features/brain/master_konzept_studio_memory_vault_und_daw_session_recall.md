# MASTER-ARCHITEKTURKONZEPT & SPRINTPLAN: NATIVE STUDIO MEMORY ENGINE & DAW AUTO-RECALL (v3.1 – REALITY-CHECK)

**Dokument-Status:** Verbindliches, code-synchronisiertes Architektur- und Umsetzungskonzept  
**System:** *Oszillation Mixing Buddy (Universal AI Co-Producer)*  
**Ablagepfad:** `research-features/brain/master_konzept_studio_memory_vault_und_daw_session_recall.md`  
**Datum:** 11. Oktober 2026 (Stand nach Reality-Check Scan)  
**Ziel:** 100 % Code-Synchronizität mit der tatsächlichen Codebase vor Implementierungsbeginn von Sprint 1.

---

## 1. Executive Summary & Die Kernvision

Musiker und Toningenieure arbeiten nicht in isolierten Einzelschritten, sondern in **fortlaufenden, mehrtägigen Song-Sessions**. Aktuell verliert der AI Co-Producer seinen Gedächtniskontext, sobald die App neu gestartet wird oder eine neue Dialogrunde beginnt.

Mit diesem Master-Konzept erhält der *Oszillation Mixing Buddy* ein vollwertiges, deterministisches Gedächtnis auf zwei perfekt ineinandergreifenden Ebenen:

1. **Das In-Memory Gehirn (The Brain):**
   * Exaktes Verfolgen jeder Parameteränderung über mehrere ActionCards hinweg (Ausgangswert $\rightarrow$ Zwischenschritt $\rightarrow$ Endwert).
   * Verknüpfung von Sidechain-Topologien und Abhörpunkt-Kontext (Master vs. isolierte Subgruppen).
   * Rollierendes Dialog-Gedächtnis mit strikter Token-Diät ($\le 350$ Tokens im Prompt).
   * DAW-Drift Guard (Schutz vor "Regler nicht gefunden"-Fehlern bei verschobenen Plugins).

2. **Die Duale Persistierung & DAW Auto-Recall (The Memory Vault):**
   * **Manuell:** Ein intuitives *"Session speichern unter..."* / *"Session öffnen..."* im HUD als portable, lesbare Datei (`*.omb-session.json`).
   * **Automatisch (Der Geniestreich via JUCE-Plugin):** Unser Audio-Meter-Plugin (`MixingBuddyMeter` als AU/VST3) speichert eine eindeutige Session-ID direkt in der Song-Datei von Apple Logic Pro oder Steinberg Nuendo (`getStateInformation` / `setStateInformation`). Sobald der Musiker Tage später sein Logic-Projekt öffnet, synchronisiert das Plugin die ID beim ersten Playback-Frame – und das Mixing-Buddy HUD lädt **vollautomatisch und nahtlos die exakte Song-Historie**!

---

## 2. Reality-Check & Codebase Ground-Truth (Bestandsaufnahme)

Der code-gestützte Scan der bestehenden Codebase hat fundamentale Erkenntnisse geliefert, die im ursprünglichen Konzept noch als Neuentwicklung eingeplant waren:

### 2.1 Was bereits existiert (Vorarbeiten & bestehende Brücken)
1. **JUCE Host State Persistierung ist bereits vorbereitet:**
   * In `plugins/meter-audio/Source/PluginProcessor.cpp` (Z. 188–231) existieren bereits `getStateInformation` und `setStateInformation`! Sie serialisieren ein XML-Tag `MixingBuddyMeterSettings` mit `targetScope`, `genreProfile`, `customNotes` und `targetLufs`.
   * In `plugins/meter-audio/Source/TelemetryClient.cpp` (Z. 53–74) existiert bereits die Methode `sendProjectContextSync(...)`, die diese Werte per WebSocket als Nachricht `type: "project_context_sync"` an Port 48123 sendet.
   * In `apps/desktop/src-tauri/src/ipc_server.rs` (Z. 1231–1240) wird `project_context_sync` bereits abgefangen und als Tauri-Event `project-context-sync` an das React-HUD emittiert!
   * *Fazit:* **Die Brücke von Logic Pro $\leftrightarrow$ JUCE Plugin $\leftrightarrow$ Rust IPC $\leftrightarrow$ React HUD steht bereits zu 70 %!** Für den Auto-Recall müssen wir in Sprint 5 lediglich das Feld `sessionUuid` ergänzen.

2. **Bestehende UI-Handler in `App.tsx` (Ground Truth):**
   * `handleApplyAction(id: string, selectedIndices?: number[])` (Z. 1009)
   * `handleRollbackSingleDelta(proposalId: string, deltaIndex: number)` (Z. 1134)
   * `handleRedoSingleDelta(proposalId: string, deltaIndex: number)` (Z. 1163)
   * `handleUndoCard(proposalId: string)` (Z. 1261) & `handleUndoLastAction()` (Z. 1204)
   * `handleAuditionAction(id: string)` (Z. 1374)
   * *State-Variablen:* `historyStack` (flüchtiger Undo-Stack in Z. 1099), `learnedTrackScopes` (in Z. 264 mit `localStorage`-Persistierung).

3. **Bestehende Typen in `@mixing-buddy/shared-types`:**
   * `MixActionProposal`: Beinhaltet bereits `sidechainRoute?: { trackName: string; slotIndex: number; sourcePath: string }` und `deltas: Array<{ trackName: string; pluginName?: string; slotIndex?: number; parameterName: string; currentValue: number; proposedValue: number; unit: string }>`.
   * `TargetScope`: `'mix_bus' | 'drum_bus' | 'bass' | 'vocal' | 'keys' | ...`

4. **Aktueller Zustand in `packages/ai-engine/`:**
   * Es existiert noch **kein** Verzeichnis `packages/ai-engine/src/memory/`. Die Module `ActionJournal.ts`, `DialogueMemory.ts` und `types.ts` werden in Sprint 1 völlig neu und modular angelegt.
   * `prompts.ts` exportiert `MIXING_BUDDY_SYSTEM_PROMPT` und `buildAnalysisUserPrompt`. Das Interface `MixAnalysisContext` besitzt bereits ein optionales Feld `recentMessages?: Array<{ sender: 'user' | 'assistant'; text: string }>`.
   * `AgentRunner.ts` assembliert den Prompt in `buildAgentSystemPrompt(context?: MixAnalysisContext)`.

---

## 3. Die Architektur des 3-Stufen-Gedächtnisses

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        OSZILLATION NATIVE STUDIO MEMORY VAULT                          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  [ EBENE 1: PHYSIKALISCHES ACTION-, ROUTING- & DRIFT-JOURNAL ] (Ground Truth)          │
│   • Speichert BaseValue (Original), OldValue (Vorher), NewValue (Jetzt).               │
│   • Speichert Sidechain-Graphen: Target (Slot) ← Source Track.                         │
│   • Speichert MonitoringContext: Auf welcher Spur wurde abgehört (Master vs. Stem)?    │
│   • DAW-Drift Guard: Gleicht Journal-Historie mit realen compactStrips ab.             │
│                                                                                        │
│  [ EBENE 2: ROLLING DIALOGUE & WORKING MEMORY ] (Kurzzeitgedächtnis)                   │
│   • Hält die letzten 3 Dialog-Turns als strukturierte Einzeiler.                       │
│   • Ältere Dialoge (> 3 Runden) werden deterministisch in 1-2 Sätze kondensiert.       │
│   • Token-Diät: Garantierte Obergrenze von ≤ 350 Tokens Zusatzlast im Prompt.          │
│                                                                                        │
│  [ EBENE 3: PERSISTENTER PROJEKT-VAULT & DAW AUTO-RECALL ] (Langzeitgedächtnis)        │
│   • Lokale Projekt-Ordner: ~/.mixing-buddy/projects/<session_uuid>/                    │
│   • Manuelle Export-Dateien: <Songname>.omb-session.json                               │
│   • Automatische Kopplung an DAW-Chunks via AudioUnit / VST3 getStateInformation.     │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Der DAW Auto-Recall Workflow (JUCE State Sync)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ SCHRITT A: BEIM ARBEITEN & SPEICHERN IM STUDIO                                  │
│ 1. Mixing Buddy generiert eine SessionUUID (z. B. "proj_summer_anthem_2026").    │
│ 2. Das Desktop HUD sendet via WebSocket (Port 48123) die SessionUUID an das     │
│    MixingBuddyMeter Plugin auf dem Master-Bus.                                  │
│ 3. Wenn der Musiker in Logic Pro "Cmd + S" drückt, ruft Logic die Methode       │
│    AudioProcessor::getStateInformation() unseres Plugins auf.                   │
│ 4. Logic speichert die SessionUUID fest im .logicx Song-Paket ab!               │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ 3 Tage vergehen...
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ SCHRITT B: BEIM WIEDERÖFFNEN DES SONGS IN DER DAW                               │
│ 1. Der Musiker öffnet "Summer_Anthem_FinalMix.logicx" in Logic Pro.             │
│ 2. Logic initialisiert das MixingBuddyMeter Plugin und ruft automatisch         │
│    AudioProcessor::setStateInformation() auf.                                   │
│ 3. Das Plugin liest die gespeicherte SessionUUID aus dem Chunk.                 │
│ 4. Beim ersten Telemetrie-Frame (alle 33 ms an Port 48123) sendet das Plugin:   │
│    { "type": "project_context_sync", "sessionUuid": "proj_summer_anthem_2026" }  │
│ 5. Das Mixing Buddy HUD empfängt das Event 'project-context-sync' in App.tsx:   │
│    - Lädt automatisch den zugehörigen Session-Vault                             │
│    - Stellt ActionCards, Parameter-Genealogie, Chat und Notizen wieder her!     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Vollständige Datenstrukturen (TypeScript-Spezifikation)

### 5.1 Das Journal- & Parameter-Modell (`packages/ai-engine/src/memory/types.ts`)

```typescript
import type { TargetScope } from '@mixing-buddy/shared-types';

export interface MonitoringContext {
  activeMeterTrack: string;        // z. B. "Stereo Out" oder "Motown Revisited Kit"
  targetScope: TargetScope;        // z. B. "mix_bus" oder "drum_bus"
}

export interface SidechainRoutingEntry {
  targetTrack: string;             // z. B. "Simple Foundation"
  targetSlot: number;              // 1-basierter Insert-Slot
  sourceTrack: string;             // z. B. "Motown Revisited Kit" (oder "None")
  status: 'active' | 'bypassed' | 'removed';
  timestamp: number;
}

export interface ParameterLineage {
  baseValue: number;               // Ursprünglicher DAW-Ausgangswert vor erster Modifikation
  oldValue: number;                // Wert unmittelbar vor dieser Karte
  newValue: number;                // Neuer gesetzter Zielwert
  unit: string;                    // "dB", "%", "Hz", "ratio", "ms"
}

export interface JournalEntry {
  id: string;                      // Eindeutige Aktions-ID (z. B. "act_1728345600_1")
  cardId?: string;                 // Verknüpfung zur Quell-ActionCard
  cardTitle?: string;              // Titel der Aktionskarte
  timestamp: number;               // Unix-Zeit in ms
  track: string;                   // Kanonischer Spurname (z. B. "Simple Foundation")
  pluginName?: string | null;      // Plugin-Name (null bei Channel-Strip Fader/Pan)
  slotIndex?: number | null;       // 1-basierter Insert-Slot
  parameter: string;               // Parameter-Identifikator (z. B. "threshold", "peak_2_gain")
  lineage: ParameterLineage;       // Exakte Wertkette (Base -> Old -> New)
  status: 'proposed' | 'applied' | 'rejected' | 'restored';
  monitoringContext: MonitoringContext;
  sidechainState?: SidechainRoutingEntry;
  rationaleSnippet: string;        // Kurze Begründung (max. 80 Zeichen)
}
```

### 5.2 Das Dialog-Modell

```typescript
export interface DialogueTurn {
  turnIndex: number;
  timestamp: number;
  userPrompt: string;              // Originale Benutzereingabe
  aiSummary: string;               // Kompakte 1-Satz-Zusammenfassung der KI-Reaktion
  appliedActionIds: string[];      // IDs der in diesem Turn angewendeten Aktionen
  monitoringTrack: string;
}

export interface RollingDialogueState {
  recentTurns: DialogueTurn[];     // Maximal 3 Turns im Direkt-Zugriff
  condensedHistorySummary: string; // 1-2 Sätze Zusammenfassung aller älteren Turns
}
```

### 5.3 Das vollständige Session-File-Format (`*.omb-session.json`)

```typescript
export interface OmbSessionFile {
  schemaVersion: '1.0.0';
  sessionUuid: string;             // Eindeutige UUID (mit DAW-Plugin verknüpft)
  sessionName: string;             // z. B. "Summer Anthem - Radio Mix"
  daw: 'logic_pro' | 'nuendo' | 'generic';
  createdAt: string;
  updatedAt: string;
  actionJournal: JournalEntry[];
  dialogueHistory: RollingDialogueState;
  activeSidechains: SidechainRoutingEntry[];
  learnedTrackScopes: Record<string, TargetScope>;
  targetProfile: string;           // z. B. "Pop/Radio Modern"
  monitoringTimeline: Array<{ timestamp: number; track: string; scope: TargetScope }>;
}
```

---

## 6. Detaillierter 6-Sprint-Umsetzungsplan (Reality-Checked)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       ÜBERSICHT: DIE 6 SPRINT-MEILENSTEINE                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [ SPRINT 1: Action-Journal, Sidechain- & Monitoring-Recorder ]                 │
│   • Neue Module: packages/ai-engine/src/memory/ (types.ts, ActionJournal.ts)    │
│   • Ringpuffer für 50 Aktionen mit getLineage(track, param)                     │
│   • Additives Event-Hooking in App.tsx (handleApplyAction, Rollback, Redo, Undo)│
│   • ZERO-REGRESSION: ActionCard.tsx bleibt 100 % unangetastet!                  │
│                                                                                 │
│  [ SPRINT 2: Rolling Dialogue Memory & Kondensierungs-Logik ]                   │
│   • Neues Modul: packages/ai-engine/src/memory/DialogueMemory.ts                │
│   • Sliding Window (3 Turns) + deterministischer 2-Zeilen-Summary-Block         │
│   • Strikte Token-Diät: Maximal 350 Tokens im System-Prompt                     │
│                                                                                 │
│  [ SPRINT 3: DAW-Drift Guard, Prompt-Injektion & 'restore_action' Tool ]        │
│   • Abgleich des Journals gegen reale Mixer-Inserts in AgentRunner.ts           │
│   • Injektion des Memory-Blocks in prompts.ts & buildAgentSystemPrompt          │
│   • Bereitstellung des deterministischen Restore-Tools für die KI               │
│                                                                                 │
│  [ SPRINT 4: Manuelle Session-Verwaltung ("Speichern unter..." / "Laden") ]     │
│   • Export & Import von *.omb-session.json im Desktop HUD                       │
│   • Native Datei-Dialoge in Tauri v2 (Rust Backend: session_vault.rs)           │
│   • Nahtlose Wiederherstellung des gesamten HUD-Zustands                        │
│                                                                                 │
│  [ SPRINT 5: Automatischer DAW-Recall via JUCE Plugin State ]                   │
│   • Erweiterung von PluginProcessor.cpp (getState/setState) um sessionUuid      │
│   • Erweiterung von TelemetryClient.cpp sendProjectContextSync                  │
│   • App.tsx lauscht auf project-context-sync und wechselt Session automatisch   │
│                                                                                 │
│  [ SPRINT 6: HUD Memory-Transparenz, End-to-End Verifikation & Release ]       │
│   • HUD-Header-Badge "Gedächtnis: 8 Aktionen" mit interaktivem Verlaufs-Popover│
│   • Studio-Stresstest mit Logic Pro & Nuendo                                    │
│   • LOC-Audit (≤ 3000 LOC), TCC Codesign mit MixingBuddyDev & Commit            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### SPRINT 1: Action-Journal, Sidechain- & Monitoring-Recorder (Maßgeschneidert)

* **Ziel:** Das In-Memory Journal erfasst jede Benutzerinteraktion lückenlos und deterministisch.
* **Dateien:**
  * Neu: `packages/ai-engine/src/memory/types.ts`
  * Neu: `packages/ai-engine/src/memory/ActionJournal.ts`
  * Edit: `apps/desktop/src/App.tsx` (ausschließlich additives Event-Logging)
* **Exakte Schnittstellen & Zero-Regression-Garantie:**
  1. `ActionCard.tsx` wird in Sprint 1 **NICHT berührt** (0 Zeilen Änderung), da alle Aktionen bereits über die Props an `App.tsx` durchgereicht werden!
  2. In `App.tsx` klinkt sich das Journal **ausschließlich passiv** am Ende bestehender, erfolgreicher Handler ein:
     * In `handleApplyAction(id, selectedIndices)` (nach Z. 1120):
       Für jedes erfolgreich angewendete Delta wird `actionJournal.recordAppliedDelta(...)` aufgerufen.
       Falls `proposal.sidechainRoute` vorhanden ist: `actionJournal.recordSidechain(...)`.
     * In `handleRollbackSingleDelta(proposalId, deltaIndex)` (nach Z. 1157):
       `actionJournal.recordDeltaStatus(proposalId, deltaIndex, 'restored')`.
     * In `handleRedoSingleDelta(proposalId, deltaIndex)` (nach Z. 1198):
       `actionJournal.recordDeltaStatus(proposalId, deltaIndex, 'applied')`.
     * In `handleUndoCard(proposalId)` (nach Z. 1338):
       `actionJournal.recordCardStatus(proposalId, 'restored')`.
  3. Kein bestehender Code für Fader-Anpassungen, A/B-Listen oder das Acoustic Shock Shield wird verändert!

---

### SPRINT 2: Rolling Dialogue Memory & Kondensierungs-Logik

* **Ziel:** Die KI versteht sprachliche Rückbezüge auf die letzten Runden, ohne das Token-Budget zu sprengen.
* **Dateien:**
  * Neu: `packages/ai-engine/src/memory/DialogueMemory.ts`
  * Edit: `packages/ai-engine/src/providers/AgentRunner.ts`
* **Funktionsweise:**
  * Die letzten 3 Dialog-Runden werden mit Benutzerfrage und 1-Satz-Zusammenfassung im RAM gehalten.
  * Erreicht der Dialog Runde 4, wird Runde 1 deterministisch in den `condensedHistorySummary`-Block übertragen.
  * Token-Bremse: Selbst bei 20 Dialogrunden belegt das Gedächtnis im Prompt **niemals mehr als 350 Tokens**.

---

### SPRINT 3: DAW-Drift Guard, Prompt-Injektion & 'restore_action' Tool

* **Ziel:** Die KI erhält vollen Zugriff auf die Ground Truth und wird vor gelöschten/verschobenen Plugins geschützt.
* **Dateien:**
  * Edit: `packages/ai-engine/src/prompts.ts`
  * Edit: `packages/ai-engine/src/providers/AgentRunner.ts`
  * Edit: `packages/mcp-server/src/tools.ts` & `handlers.ts`
* **Funktionsweise:**
  * Vor jedem KI-Aufruf prüft der `DawDriftGuard`, ob die im Journal referenzierten Plugins in den aktuellen `compactStrips` von Logic Pro noch existieren. Fehlt ein Plugin (z. B. gelöschter Equalizer), erhält die KI eine Warnung und versucht nicht blind, tote Regler zu bewegen.
  * Injektion des kompakten Blocks `=== SESSION MEMORY & ACTION JOURNAL ===` in den System-Prompt via `buildAgentSystemPrompt`.
  * Neues MCP-Tool `mcp__restore_previous_action`: Erlaubt der KI, einen früheren Parameterstand auf Zuruf (*„mach das Klavier wie ganz am Anfang“*) deterministisch über eine ActionCard wiederherzustellen.

---

### SPRINT 4: Manuelle Session-Verwaltung ("Speichern unter..." / "Session öffnen")

* **Ziel:** Der Musiker kann seine Song-Session manuell archivieren, teilen oder zu einem späteren Zeitpunkt fortsetzen.
* **Dateien:**
  * Neu: `apps/desktop/src-tauri/src/session_vault.rs`
  * Edit: `apps/desktop/src-tauri/src/lib.rs` (Tauri Commands: `save_session_file`, `load_session_file`)
  * Edit: `apps/desktop/src/components/SessionManagerModal.tsx`
  * Edit: `apps/desktop/src/App.tsx` (Menüpunkt in der Kopfzeile)
* **Funktionsweise:**
  * `[ 💾 Session speichern unter... ]`: Öffnet den nativen macOS-Speicherdialog und schreibt eine formatierte `.omb-session.json`.
  * `[ 📂 Session öffnen... ]`: Lädt eine bestehende Datei, stellt alle ActionCards, das Journal, die Dialoghistorie und die gemerkten Spurtypen im HUD wieder her.
  * Schnellspeichern: Automatische Hintergrund-Sicherung unter `~/.mixing-buddy/projects/<uuid>/vault.json`.

---

### SPRINT 5: Automatischer DAW-Recall via JUCE Plugin State

* **Ziel:** Vollautomatische Wiedererkennung des Songs direkt beim Öffnen in Logic Pro oder Nuendo.
* **Dateien:**
  * Edit: `plugins/meter-audio/Source/PluginProcessor.cpp` & `.h`
  * Edit: `plugins/meter-audio/Source/TelemetryClient.cpp` & `.h`
  * Edit: `apps/desktop/src/App.tsx` (Lauscht auf Event `project-context-sync`)
* **Funktionsweise:**
  * Das bestehende `PluginProcessor::getStateInformation` wird um das Attribut `xml.setAttribute("sessionUuid", currentSessionUuid)` erweitert.
  * In `PluginProcessor::setStateInformation` wird die `sessionUuid` eingelesen und über das bestehende `telemetryClient.sendProjectContextSync(...)` verschickt.
  * `ipc_server.rs` leitet dies über das bereits vorhandene Event `project-context-sync` an das Frontend weiter.
  * `App.tsx` fängt das Event ab und schaltet automatisch auf die zugehörige Session um.

---

### SPRINT 6: HUD Memory-Transparenz, End-to-End Verifikation & Release

* **Ziel:** Sichtbare Kontrolle für den Produzenten, End-to-End Test im Studio und Release-Vorbereitung.
* **Dateien:**
  * Edit: `apps/desktop/src/App.tsx` (Memory-Badge im Header)
  * Neu: `apps/desktop/src/components/MemoryInspectorModal.tsx` (Visuelle Zeitleiste)
* **Funktionsweise:**
  * Ein kleines, dezentes Badge im HUD-Header: `[ 🧠 Session: Sommerhit (12 Aktionen) ]`.
  * Klick darauf öffnet die Zeitleiste: Musiker sieht chronologisch jede EQ-Absenkung, jeden Kompressor-Schritt und jedes Sidechain-Routing mit Zeitstempel und einem Ein-Klick-Wiederherstellen-Knopf.
* **Qualitäts-Gate vor Abschluss:**
  1. Monorepo Build (`pnpm -r run build`) fehlerfrei.
  2. LOC-Audit (`./scripts/lint-loc.sh`) fehlerfrei ($\le 3000$ Zeilen).
  3. Desktop App kompilieren, bündeln und mit `MixingBuddyDev` permanent signieren.
  4. Git Commit & Push auf `origin/main`.

---

## 7. Zusammenfassung der Qualitäts-Garantien

1. **Kein externer Server-Ballast:** 100 % lokal, Rust, C++ (JUCE 8) und TypeScript. Null Python, null Vektordatenbanken.
2. **Bit-Transparenz & Studio-Sicherheit:** Das Meter-Plugin bleibt bit-transparent; State-Synchronisation findet außerhalb des Audio-Echtzeit-Threads statt.
3. **Zero-Regression:** Bestehende Funktionen (Acoustic Shock Shield, A/B-Listen, Fader-Deltas) bleiben unangetastet.
4. **Maximale Ergonomie:** Wahlfreiheit zwischen manuellem Datei-Management und vollautomatischem DAW-Recall!
