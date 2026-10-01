# SPRINT-PLAN PHASE 3: VOLLSTÄNDIGE SESSION- & ROUTING-AUTONOMIE (LOGIC PRO)

## Verbindliches Stop-and-Go-Protokoll für Antigravity

**Ziel:** Vollständige Umsetzung des Studio-Buddy-Workflows in Apple Logic Pro (Transport, Menü-Plugin-Laden, Track Stacks & Sidechaining).

---

## 📌 SPRINT 6: TRANSPORT-AUTOMATION & 8-SEKUNDEN AUDITION-LOOP

*Ziel: Der Buddy kann die Wiedergabe an beliebigen Taktpositionen starten/stoppen, 8 Sekunden lang analysieren und Solo-Sweeps durchführen.*

### Step 6.1: Swift- & MCU-Transport-Steuerung
- **Dateien:** `packages/daw-adapters/src/logic/swift/LogicAXBridge.swift`, `apps/desktop/src-tauri/src/midi_bridge.rs`
- **Befehle:**
  - `logic-ax-bridge transport-play`, `transport-stop`, `transport-locate --bar <Int>`
  - MCU MIDI Fallback via CoreMIDI: Note `0x5E` (Play), `0x5D` (Stop), `0x56` (Cycle).
- **Tauri Commands:** `daw_play()`, `daw_stop()`, `daw_locate_bar(bar: u32)`.

### Step 6.2: MCP-Tool `mcp__audition_region` & 8-Sekunden Audit-Kette
- **Dateien:** `packages/mcp-server/src/tools.ts`, `packages/mcp-server/src/handlers.ts`
- **Ablauf:**
  1. KI springt zu Takt X (z. B. Takt 21).
  2. Startet Playback für $N$ Sekunden (Standard: 8s).
  3. Liest währenddessen die 30 fps Telemetrie von *„The Ear“* ein.
  4. Stoppt Playback und generiert Diagnose.

---

## 📌 SPRINT 7: ARRANGER-NAVIGATION, SPUR-FOKUS & FOLDER-EXPANSION

*Ziel: Ordner und Track Stacks (z. B. „Drums“) im Arrangement auf- und zuklappen sowie Spuren im Inspector gezielt anwählen.*

### Step 7.1: Folder-Expansion (`set-folder-expanded`)
- **Dateien:** `packages/daw-adapters/src/logic/swift/LogicAXBridge.swift`
- **Ablauf:**
  - Sucht im Track-Header nach Track Stacks (`Drums`, `Keys`, etc.).
  - Führt `AXPress` auf das Aufklapp-Dreieck (`AXDisclosureTriangle` oder Chevron) aus.
  - Befehl: `logic-ax-bridge set-folder-expanded --track "Drums" --expanded true|false`.

### Step 7.2: Spur-Selektion & Inspector-Sync
- **Ablauf:**
  - Klick auf Track `Snare 2` in der Spurliste.
  - Der linke Inspector zeigt sofort den Kanalzug von `Snare 2` an.
  - MCP-Tool: `mcp__select_track(trackName: string)`.

---

## 📌 SPRINT 8: DYNAMISCHES PLUGIN-LADEN VIA LOGIC-MENÜS (AUDIO FX)

*Ziel: Klick auf einen freien oder belegten Audio-FX-Slot, Menü-Traversierung und Laden neuer Plugins.*

### Step 8.1: Menü-Klick auf Audio-FX-Slots
- **Dateien:** `packages/daw-adapters/src/logic/swift/LogicAXBridge.swift`
- **Ablauf:**
  - Findet den Ziel-Slot unter „Audio FX“ (Slot 1–15).
  - Führt `AXPress` aus $\rightarrow$ natives Logic `AXMenu` öffnet sich.
  - Liest Menüeinträge (`AXMenuItem`) aus.

### Step 8.2: Hierarchische Menü-Auswahl & Insert-Laden
- **Ablauf:**
  - Befehl: `logic-ax-bridge load-plugin --track "Snare 2" --slot 2 --plugin-path "EQ > Channel EQ"`
  - Navigiert durch Untermenüs (`Dynamics > Compressor` oder `Audio Units > FabFilter > Pro-Q 3`).
  - Bestätigt per `AXPress` auf das Ziel-Item.
- **MCP-Tool:** `mcp__load_plugin_into_slot`.

---

## 📌 SPRINT 9: BUS-SENDS, SUBMIXE & TRACK STACKS

*Ziel: Zuweisen von Sends auf Bus-Kanäle und Auspegeln von Hall-/Delay- oder Subgruppen.*

### Step 9.1: Bus-Send Zuweisung
- **Ablauf:**
  - Klick auf freien `Sends`-Slot im Inspector.
  - Menü-Auswahl: `Bus > Bus 1 (Reverb)` oder `Bus > Bus 2 (Drum Sub)`.
  - Befehl: `logic-ax-bridge set-send-bus --track "Snare 2" --slot 1 --bus 1`.

### Step 9.2: Send-Pegel regeln
- Regelt den runden Send-Regler neben dem Bus-Slot auf den gewünschten dB-Wert (z. B. $-6.0\text{ dB}$).

---

## 📌 SPRINT 10: SIDECHAIN-ROUTING & DUCKING-AUTOMATION

*Ziel: Den Sidechain-Eingang von Kompressoren mit Quell-Spuren (Kick Drum, Vocals) verdrahten.*

### Step 10.1: Plugin-Header Sidechain Dropdown adressieren
- **Dateien:** `packages/daw-adapters/src/logic/swift/LogicAXBridge.swift`
- **Ablauf:**
  - Öffnet das Kompressor-Fenster auf der Zielspur (z. B. `Bass`).
  - Klickt oben rechts im Plugin-Header auf das PopUp-Menü `Sidechain:` (`AXPopUpButton`).
  - Wählt aus dem Menü: `Audio > Audio 1 (Kick)` oder `Bus > Bus 1`.
  - Befehl: `logic-ax-bridge set-sidechain --window "Bass" --source-type "Audio" --source-name "Kick 1"`.

### Step 10.2: Sidechain-Ducking ActionCard
- Die AI-Engine generiert die fertige Ducking-Karte:
  - Verbindet Kick mit Bass-Kompressor.
  - Stellt Threshold auf $-18\text{ dB}$, Ratio auf $4:1$, Attack auf $10\text{ ms}$, Release auf $80\text{ ms}$.