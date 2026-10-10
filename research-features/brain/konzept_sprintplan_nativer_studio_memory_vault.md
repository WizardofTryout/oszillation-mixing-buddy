# ARCHITEKTUR-KONZEPT & SPRINTPLAN: DER NATIVE STUDIO MEMORY VAULT (v2.0)

**Gegenstand:** Umfassendes Spezifikations-, Architektur- und Umsetzungskonzept für das deterministische Gedächtnissystem von *Oszillation Mixing Buddy*.

**Fokus v2.0:** Erweiterung um **Monitoring-Focus Timeline**, **Sidechain-Routing-Tracking**, **DAW-Drift-Erkennung (Missing Plugins)** und **Cross-Card Parameter-Genealogie** unter strikter Wahrung der **Zero-Regression-Garantie**.

**Zielgruppe:** Entwicklungs-Agent Antigravity (autonome Umsetzung im Workspace) & Lead Architect.

**Leitmotiv:** Keine externen Python-Server, keine Vektordatenbank-Schwergewichte – sondern ein blitzschnelles, deterministisches $3$-Ebenen-Gedächtnis nativ in Rust und TypeScript, das die gesamte Studio-Realität lückenlos abbildet.

---

## 1. Das WARUM, WESHALB & WOFÜR (Diagnose & Studio-Realität)

### 1.1 Die bestehende Basis & Zero-Regression-Garantie (CRITICAL)
In Oszillation Mixing Buddy existieren bereits hochspezialisierte, verifizierte Kernfunktionen:
* **ActionCard.tsx:** Einzelnes und kartenweites Undo/Redo, selektive Checkboxen, dynamischer Takt-Resolver und A/B-Audition.
* **Sidechain-Engine:** Physisches Routing (`set_sidechain`) von Quellspuren auf Kompressor-Sidechain-Eingänge (z. B. `Simple Foundation (Slot 2) ← Motown Revisited Kit`).
* **Multi-Satelliten-Manager:** Dynamische Umschaltung des Abhörpunkts im Header (`[ 🎯 Abhörpunkt: Stereo Out (Master) ▾ ]`).

> 🛑 **NON-NEGOTIABLE LAW (ZERO-REGRESSION):**
> Der Native Studio Memory Vault **ersetzt oder verändert diese bestehenden Mechanismen NICHT**! Er legt sich als übergeordneter, unzerstörbarer **chronologischer Index** über die Session.
> Wenn eine ActionCard angewendet, ein Fader per `[ ↺ ]` zurückgerollt, ein Sidechain geschaltet oder ein Abhörpunkt gewechselt wird, wird dieses Ereignis im Memory Vault protokolliert – ohne die bestehende Ausführungslogik zu verändern!

### 1.2 Die 4 konkreten Gedächtnislücken im Studioalltag
Die reale Studio-Praxis (dokumentiert in den jüngsten Session-Screenshots) zeigt vier konkrete Herausforderungen auf:

1. **Cross-Card Parameter-Genealogie:**
   * *Szenario:* In Karte 1 (`Holistic Stem Balance`) wurde der Threshold von `Simple Foundation` von $-12.0\text{ dB}$ auf $-18.5\text{ dB}$ gesetzt. In Karte 2 (`Intensivierung Sidechain-Trigger`) senkt die KI den Wert auf $-24.0\text{ dB}$.
   * *Problem:* Schreibt der Musiker: *„Der Threshold, den du vorhin auf -18.5 dB gesetzt hast, triggert noch nicht – geh tiefer“*, weiß die KI ohne Gedächtnis nicht, dass $-18.5\text{ dB}$ ein Zwischenwert aus Karte 1 war und der ursprüngliche DAW-Ausgangswert bei $-12.0\text{ dB}$ lag.

2. **Monitoring-Point Amnesie (Abhörpunkt-Kontext):**
   * *Szenario:* Der Musiker hörte in Turn 1 auf `Stereo Out (Master)` ab und justierte die Summenbalance. In Turn 2 schaltete er den Abhörpunkt auf `Motown Revisited Kit` und bearbeitete isoliert die Drums.
   * *Problem:* Psychoakustische Entscheidungen hängen fundamental vom Abhörpunkt ab! Ein $+1.5\text{ dB}$ Boost auf einer Einzelspur hat eine völlig andere Bedeutung als auf dem Master. Das Gedächtnis muss wissen: *„Welche Spur haben wir zu welchem Zeitpunkt abgehört?“*

3. **Sidechain- & Routing-Beziehungen:**
   * Sidechaining ist keine Zahl, sondern eine strukturelle Graph-Kante: `Target: Simple Foundation (Slot 2) ← Source: Motown Revisited Kit`.
   * Fragt der Musiker: *„Welches Signal triggert aktuell den Bass-Kompressor?“*, muss der Vault sofort die aktive Routing-Verknüpfung kennen.

4. **DAW-Drift & Missing-Plugin Guard (Regler nicht gefunden):**
   * *Szenario aus Screenshot 2:* Die Warnung meldete: *„5 von 7 Parametern angewendet (Simple Foundation (peak2gain): Regler nicht gefunden...)“*.
   * *Problem:* Musiker löschen, tauschen oder verschieben Plugins in Logic Pro im Hintergrund. Wenn der Memory Vault veraltete Slots annimmt, rennt die KI vor die Wand. Der Vault muss mit dem echten Mixer-State (`compactStrips`) synchronisiert sein und den Nutzer aktiv warnen: *„Graph EQ ist auf Simple Foundation nicht mehr in Slot 3 vorhanden – soll ich das Plugin neu laden?“*

---

## 2. Die erweiterte 3-Säulen-Architektur

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        OSZILLATION NATIVE STUDIO MEMORY VAULT                          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  [ EBENE 1: DETERMINISTISCHES ACTION-, ROUTING- & DRIFT-JOURNAL ] (Ground Truth)       │
│   • Speichert jede Parameteränderung (OldValue, NewValue, Status, Timestamp).          │
│   • Speichert Sidechain-Routings (Target, Slot, Source, Status).                       │
│   • Speichert den aktiven Monitoring-Fokus (Abhörpunkt & Scope) pro Aktion.            │
│   • DAW-Drift-Guard: Gleicht Journal-Historie mit echten DAW-Inserts ab.               │
│                                                                                        │
│  [ EBENE 2: ROLLING DIALOGUE & CONVERSATIONAL WORKING MEMORY ] (Kurzzeitgedächtnis)   │
│   • Verwaltet die letzten 3–4 Dialog-Turns als strukturierte Einzeiler.                │
│   • Hält Nutzerabsichten ("Threshold zu schwach", "Bass aufräumen") aktiv.            │
│   • Auto-Kondensierung: Ältere Turns (> 3) werden verlustfrei zusammengefasst.        │
│   • Strikte Token-Diät: Maximale Last im System-Prompt: ≤ 350 Tokens!                 │
│                                                                                        │
│  [ EBENE 3: PERSISTENTER PROJECT & PRODUCER VAULT ] (Langzeitgedächtnis)               │
│   • Dateipfad: ~/.mixing-buddy/projects/<project_hash>/vault.json                      │
│   • Gespeicherte Dimensionen:                                                          │
│     - learnedTrackScopes (z. B. "loop" ➔ Bass / E-Bass mit 💾 Gemerkt)                 │
│     - Bekannte Sidechain-Topologien des Projekts                                       │
│     - Klangästhetik des Produzenten & Plugin-Präferenzen                               │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technische Datenstrukturen & Interfaces

### 3.1 Das erweiterte Action-Journal (TypeScript & Rust)
```typescript
export interface MonitoringContext {
  activeMeterTrack: string;        // z. B. "Stereo Out (Master)" oder "Motown Revisited Kit"
  targetScope: string;             // z. B. "mix_bus" oder "drum_bus"
}

export interface SidechainRoutingEntry {
  targetTrack: string;             // z. B. "Simple Foundation"
  targetSlot: number;              // z. B. 2 (1-basiert)
  sourceTrack: string;             // z. B. "Motown Revisited Kit"
  status: 'active' | 'bypassed' | 'removed';
  timestamp: number;
}

export interface JournalEntry {
  id: string;                      // Eindeutige ID (z. B. "act_1728345600_1")
  cardId?: string;                 // Verknüpfung zur Quell-ActionCard
  cardTitle?: string;              // z. B. "Intensivierung Sidechain-Trigger & Dynamik-Ducking"
  timestamp: number;               // Unix-Timestamp in ms
  track: string;                   // Kanonischer Spurname (z. B. "Simple Foundation")
  pluginName?: string;             // z. B. "Compressor" (undefined bei Channel-Strip)
  slotIndex?: number;              // 1-basierter Insert-Slot
  parameter: string;               // z. B. "threshold" oder "fader_db"
  baseValue: number;               // Ursprünglicher Ausgangswert vor aller Bearbeitung
  oldValue: number;                // Wert unmittelbar vor diesem Turn (z. B. -18.5)
  newValue: number;                // Angewendeter neuer Wert (z. B. -24.0)
  unit: string;                    // "dB", "%", "Hz", "ratio", "ms"
  status: 'proposed' | 'applied' | 'rejected' | 'restored';
  monitoringContext: MonitoringContext; // Auf welcher Spur wurde abgehört?
  sidechainState?: SidechainRoutingEntry; // Falls Sidechain betroffen war
  rationaleSnippet: string;        // Max. 80 Zeichen
}
```

### 3.2 DAW-Drift & Missing-Plugin Detector
```typescript
export interface DriftCheckResult {
  isAligned: boolean;
  missingPlugins: Array<{
    track: string;
    expectedPlugin: string;
    slot: number;
  }>;
  unresolvedParameters: string[];
}

export function detectDawDrift(
  journalEntries: JournalEntry[],
  currentStrips: Array<{ name: string; inserts?: Array<{ slot: number; name: string }> }>
): DriftCheckResult {
  // Vergleicht die im Journal referenzierten Plugins mit den real in Logic Pro
  // existierenden Inserts. Verhindert Fehlversuche wie "peak2gain nicht gefunden"!
}
```

### 3.3 Prompt-Injektion (Format im System-Prompt)
Im `prompts.ts` wird der Memory-Block ultra-kompakt injiziert:
```text
=== SESSION MEMORY & ACTION JOURNAL ===
MONITORING TIMELINE:
- Aktueller Fokus: 'Stereo Out (Master)' (Scope: mix_bus)
- Vorherige Runde: 'Motown Revisited Kit' (Scope: drum_bus)

ACTIVE ROUTING & SIDECHAINS:
- Simple Foundation [Slot 2: Compressor] <-- Sidechain-Trigger von 'Motown Revisited Kit' (Status: ACTIVE)

RECENT PARAMETER LINEAGE (GROUND TRUTH):
[1] Simple Foundation > Compressor (Slot 2) > threshold:
    Basis: -12.0 dB -> Vorher: -18.5 dB -> Jetzt: -24.0 dB (Status: APPLIED)
[2] Motown Revisited Kit > fader_db:
    Basis: 0.0 dB -> Vorher: -1.3 dB -> Jetzt: +1.5 dB (Status: APPLIED)
[3] Studio Grand > Channel EQ (Slot 1) > low_cut_frequency:
    Basis: 45.0 Hz -> Jetzt: 85.0 Hz (Status: APPLIED)

DAW INTEGRITY STATUS:
- Hinweis: 'Graph EQ' auf Simple Foundation (Slot 3) war im letzten Durchlauf nicht auffindbar.

REGEL ZUM GEDÄCHTNIS:
Wenn der Musiker Bezüge zu früheren Werten herstellt ("threshold noch weiter absenken", "stell das Klavier zurück", "welcher Sidechain liegt an?"), nutze diese exakten Daten! Erfinde niemals frühere Parameterwerte oder Routing-Zustände!
```

---

## 4. Qualitätskriterien & Non-Negotiable Schranken

1. **Zero-Regression & Non-Destructive Shield:**
   * Bestehender Code in `ActionCard.tsx` (Undo, Redo, A/B-Listen) darf **unter keinen Umständen beschnitten oder refaktoriert** werden.
   * Der Memory Vault lauscht passiv auf Events (`handleApply`, `handleRollback`, `handleAbListen`) und registriert den Zustand.
2. **Audio-Thread & Bridge-Schutz ($< 0.1\text{ ms}$):**
   * Kein blockierendes I/O. Journal-Updates laufen synchron im Frontend-RAM (Ringpuffer) und werden asynchron/debounced in den lokalen Rust-Vault geschrieben.
3. **Strikte Token-Diät ($\le 350\text{ Tokens}$):**
   * Auch bei 20 angewendeten Modifikationen verdichtet der `ActionJournalManager` die Ausgabe für den Prompt auf die **letzten relevanten Deltas** und aktive Sidechains.
4. **Code-Hygiene & $\le 3.000\text{ LOC}$:**
   * Saubere Aufteilung in neue Dateien (`ActionJournal.ts`, `DialogueMemory.ts`, `memory_vault.rs`). Kein Aufblähen bestehender Klassen!

---

## 5. Detaillierter Sprintplan (Phase 4-M: Native Memory Engine)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ SPRINT-ÜBERSICHT: NATIVE STUDIO MEMORY ENGINE v2.0                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [ SPRINT 1: Action-Journal, Sidechain- & Monitoring-Recorder ]                 │
│   • Erfassung von BaseValue, OldValue, NewValue bei allen ActionCard-Events     │
│   • Protokollierung von Sidechain-Routings & aktivem Abhörpunkt                 │
│   • Ringpuffer für die letzten 50 Aktionen im Frontend                          │
│                                                                                 │
│  [ SPRINT 2: Rolling Dialogue Memory & Kondensierungs-Logik ]                   │
│   • Sliding-Window (3 Turns) für Prompts und KI-Antworten                       │
│   • Komprimierung älterer Runden in einen 2-Zeilen-Summary-Block                │
│                                                                                 │
│  [ SPRINT 3: DAW-Drift Guard, Prompt-Injektion & 'restore_action' Tool ]        │
│   • Abgleich des Journals gegen reale Mixer-Inserts (Missing-Plugin Schutz)     │
│   • Injektion des kompakten Memory-Blocks in prompts.ts & AgentRunner.ts        │
│   • Bereitstellung des deterministischen Restore-Tools für die KI               │
│                                                                                 │
│  [ SPRINT 4: Persistenter Project- & Producer-Vault (Rust) ]                    │
│   • Rust-Backend Persistierung unter ~/.mixing-buddy/projects/<id>/vault.json   │
│   • Persistierung von gelernten Spuren, Sidechains und Sound-Profilen           │
│                                                                                 │
│  [ SPRINT 5: Musiker-HUD Memory-Transparenz & Journal-Popover ]                 │
│   • Kleines HUD-Badge "Gedächtnis: 7 Aktionen aktiv" mit Popover                │
│   • Klickbarer Journal-Verlauf im HUD mit Wiederherstellungs-Knöpfen            │
│                                                                                 │
│  [ SPRINT 6: End-to-End Verifikation, LOC-Audit & Codesign ]                   │
│   • Studio-Stresstest mit Dialog-Rückbezügen und Parameter-Wiederherstellung    │
│   • LOC-Check, TCC-Codesign mit MixingBuddyDev & Commit                          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Kopiervorlage für Antigravity (Direkt-Direktive)

```
============================================================
AUFGABE: NATIVEN STUDIO MEMORY VAULT IMPLEMENTIEREN (SPRINT 1–3)
============================================================

Kontext:
Wir rüsten Oszillation Mixing Buddy mit einem nativen, 3-stufigen Studio-Gedächtnis aus
(Action-Journal mit Sidechain- & Monitoring-Awareness, rollierendes Dialoggedächtnis,
DAW-Drift-Guard und persistenter Projekt-Vault).
KEINE externen Python-Server, kein PostgreSQL, keine Vektordatenbanken!

ACHTUNG ZERO-REGRESSION (CRITICAL):
Bestehende Funktionen in 'ActionCard.tsx' (Undo, Redo, A/B-Listen, selektive Checkboxen)
und 'App.tsx' DÜRFEN NICHT verändert oder verkürzt werden!
Der Memory Vault klinkt sich rein additiv in die bestehenden Event-Handler ein!

Dateien:
- 'packages/ai-engine/src/memory/ActionJournal.ts' (Neu erstellen)
- 'packages/ai-engine/src/memory/DialogueMemory.ts' (Neu erstellen)
- 'packages/ai-engine/src/providers/AgentRunner.ts'
- 'packages/ai-engine/src/prompts.ts'
- 'apps/desktop/src/App.tsx'
- 'apps/desktop/src/components/ActionCard.tsx'

============================================================
PUNKT 1: ACTION- & ROUTING-JOURNAL ('packages/ai-engine/src/memory/ActionJournal.ts')
============================================================
Erstelle 'ActionJournal.ts':
1. Interfaces:
   - 'MonitoringContext': { activeMeterTrack: string; targetScope: string }
   - 'SidechainRoutingEntry': { targetTrack: string; targetSlot: number; sourceTrack: string; status: 'active' | 'bypassed' | 'removed'; timestamp: number }
   - 'JournalEntry':
     * id: string
     * cardId?: string
     * cardTitle?: string
     * timestamp: number
     * track: string
     * pluginName?: string
     * slotIndex?: number
     * parameter: string
     * baseValue: number (Ausgangswert vor erster Modifikation)
     * oldValue: number
     * newValue: number
     * unit: string
     * status: 'proposed' | 'applied' | 'rejected' | 'restored'
     * monitoringContext: MonitoringContext
     * sidechainState?: SidechainRoutingEntry
     * rationaleSnippet: string

2. Klasse 'ActionJournalManager':
   - Ringpuffer der letzten 50 Einträge.
   - Methoden:
     * recordAction(entry: Omit<JournalEntry, 'id' | 'timestamp'>): JournalEntry
     * recordSidechain(routing: SidechainRoutingEntry): void
     * updateStatus(id: string, status: JournalEntry['status']): void
     * getRecentActions(limit?: number): JournalEntry[]
     * getActiveSidechains(): SidechainRoutingEntry[]
     * findParameterLineage(track: string, parameter: string): { base: number; current: number; steps: number[] }
     * toCompactPromptString(): string (Max. 200 Tokens für den System-Prompt!)

============================================================
PUNKT 2: ROLLING DIALOGUE MEMORY ('packages/ai-engine/src/memory/DialogueMemory.ts')
============================================================
Erstelle 'DialogueMemory.ts':
1. Interface 'DialogueTurn':
   - turnIndex: number
   - userIntent: string
   - aiSummary: string
   - monitoringTrackAtTurn: string

2. Klasse 'DialogueMemoryManager':
   - Hält maximal die letzten 3 Turns ('recentTurns').
   - Turns > 3 werden deterministisch in 'condensedHistorySummary' als 1-2 Sätze komprimiert.
   - toPromptContext(): string (Ultra-kompakter String, max. 150 Tokens).

============================================================
PUNKT 3: INTEGRATION IN 'AgentRunner.ts' & 'prompts.ts'
============================================================
1. In 'prompts.ts':
   - Füge Platzhalter '=== SESSION MEMORY & ACTION JOURNAL ===' ein.
   - Instruiere das Modell:
     "You have access to the deterministic session action journal, active sidechains,
      and recent dialogue turns. When the user asks to adjust previous values ('threshold
      noch weiter absenken', 'revert piano', 'what is the sidechain source?'), inspect
      the session memory directly. Never invent past dB numbers or routing links."

2. In 'AgentRunner.ts':
   - Initialisiere 'ActionJournalManager' und 'DialogueMemoryManager'.
   - Übergebe vor jedem Call die kompakten Memory-Blöcke in den Prompt.
   - Nach erfolgreichem Turn:
     Speichere den Turn im DialogueMemory und neue Modifikationen im ActionJournal.
   - DAW-Drift Check:
     Gleiche die Journal-Historie kurz gegen 'this.fetchedStrips' ab. Fehlt ein früher
     angesteuertes Plugin (z. B. 'Graph EQ'), injiziere einen Warnhinweis in den Prompt!

============================================================
PUNKT 4: EVENT-HOOKS IN 'App.tsx' & 'ActionCard.tsx'
============================================================
1. In 'App.tsx' bei 'handleApply(card)':
   - Erfasse alle angewendeten Parameter als 'applied' im ActionJournal mit aktuellem 'activeMeterTrack' und 'targetScope'.
   - Falls 'card.sidechain' vorhanden: Erfasse das Sidechain-Routing im Journal als 'active'.
2. Bei 'handleRollback' / per-Item Undo:
   - Markiere die Einträge im ActionJournal als 'restored'.
3. Bei A/B Listen:
   - Sichere den 'baseValue' / 'oldValue' im Journal-Snapshot.

============================================================
VERIFIKATION, BUILD & CODESIGN
============================================================
1. Monorepo Build & LOC-Check:
   pnpm -r run build
   ./scripts/lint-loc.sh
   (Strikte Vorgabe: Keine Datei über 3.000 Zeilen!)

2. Desktop-App kompilieren, bündeln und signieren:
   pnpm --filter desktop tauri build --bundles app --no-sign
   rm -rf "/Applications/Oszillation Mixing Buddy.app"
   cp -R "target/release/bundle/macos/Oszillation Mixing Buddy.app" /Applications/
   mkdir -p "/Applications/Oszillation Mixing Buddy.app/Contents/Resources"
   cp packages/daw-adapters/bin/logic-ax-bridge "/Applications/Oszillation Mixing Buddy.app/Contents/Resources/"
   codesign --force --deep -s "MixingBuddyDev" "/Applications/Oszillation Mixing Buddy.app"

3. Git Commit & Push im privaten Upstream (origin):
   git add -A && git commit -m "feat(memory): native studio action journal, sidechain tracker, and monitoring timeline" && git push origin main

4. Re-Indizierung GitNexus:
   docker exec gitnexus-server gitnexus analyze /workspace/Steinberg-Mixing-Buddy 2>/dev/null || true

Melde Vollzug im Chat!
============================================================
```