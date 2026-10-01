# Oszillation Mixing Buddy — Umfassende System- & Feature-Dokumentation

> **Status:** Version 0.8.0 (Produktiv / Verifiziert / Phase 3 zu 100 % abgeschlossen — Sprints 1 bis 10)  
> **Zielgruppe:** Web-Frontend-Entwickler, UI/UX-Designer, Core-Entwickler & Stakeholder  
> **Repository:** `Steinberg-Mixing-Buddy` / `Oszillation Mixing Buddy`  
> **Code-Graph:** 2.165 Knoten, 4.380 Kanten, 185 Flows (GitNexus indiziert)  
> **Stand:** Oktober 2026 (Commit `fefba9f` / `bb202ae`)  

---

## 1. Produktvision & Leitbild

**Oszillation Mixing Buddy** ist der erste universelle, native **KI-Co-Producer für professionelle Digital Audio Workstations (DAWs)** — mit primärem Fokus auf **Apple Logic Pro** und **Steinberg Nuendo / Cubase**.

Im Gegensatz zu klassischen AI-Audio-Tools, die Audio extern generieren oder als isolierte Chatbots fungieren, agiert der Mixing Buddy als **virtueller Toningenieur direkt am Mischpult des Nutzers**:
- **Er hört mit:** Hochpräzise Echtzeit-Telemetrie direkt auf dem Master-Bus (EBU R128, ITU-R BS.1770-4 Dual-Gated, 32-Band FFT Spektrum, Stereokorrelation).
- **Er sieht alles:** Vollständige Echtzeit-Inspektion aller Kanalzüge, Fader, Panorama-Positionen und Insert-Plugins via Swift Mach-O Bridge.
- **Er greift ein:** Sub-Millisekunden native Steuerung von Fadern, Panning und Insert-Effekten (z. B. Logic Pro Channel EQ, StudioEQ).
- **Er schützt das Gehör:** Der integrierte *Acoustic Shock Shield* verhindert physikalisch gefährliche Lautstärkesprünge (asymmetrischer Schutz, max. +3.0 dB/Schritt).
- **Human-in-the-Loop:** Keine blinde Automatik — jede KI-Entscheidung wird als übersichtliche **ActionCard** vorgeschlagen, kann per **A/B-Audition 6 Sekunden lang vorgehört** und erst auf Bestätigung dauerhaft angewendet werden.
- **Maßgeschneiderte Klangwelten:** Vom EBU R128 Rundfunkstandard (*Tonmischmeister*) über Club/Trap-Mastering bis hin zu synthetisierten Custom-Skills mit 3-Zonen Prüf-Ampeln.

---

## 2. Entwickler-Quickstart (Lokale Umgebung & Start)

Für Web-Frontend- und UI-Entwickler, die das HUD oder Dashboards im Browser oder in der nativen Shell weiterentwickeln möchten:

### 2.1 Systemvoraussetzungen
- **Node.js:** $\ge 20.x$ (LTS empfohlen)
- **Paketmanager:** `pnpm` ($\ge 9.x$)
- **Rust & Cargo:** (erforderlich für den nativen Tauri v2 Desktop-Core)
- **macOS Build Tools:** Xcode Command Line Tools (`swiftc`, `clang`) für die native `logic-ax-bridge`

### 2.2 Lokaler Start der Entwicklungsumgebung
```bash
# 1. Abhängigkeiten im Monorepo installieren
pnpm install

# 2. Frontend im schnellen Browser-Entwicklungsmodus starten (Vite HMR)
pnpm --filter desktop dev
# -> Web-Interface verfügbar unter: http://localhost:1420

# 3. Vollständiges Desktop-HUD mit nativer macOS-Bridge & Gehörschutz starten
pnpm --filter desktop tauri dev

# 4. Native Swift-Bridge kompilieren (nur bei Änderungen an LogicAXBridge.swift)
pnpm --filter @mixing-buddy/daw-adapters run build:swift

# 5. Produktions-Release bauen (App & DMG Bundle)
pnpm --filter desktop tauri build --bundles app,dmg --no-sign
```

### 2.3 Netzwerk-Topologie & Aktive Ports
| Port | Protokoll | Komponente | Beschreibung |
| :--- | :--- | :--- | :--- |
| **`48123`** | HTTP / WebSocket | **Desktop Companion (Rust/Tauri)** | Zentraler IPC-Hub: REST-Endpoints (Project, Tracks, References, Skills, Vault) & 30 fps Audio-Telemetrie-Stream |
| **`48124`** | HTTP / SSE / Stdio | **MCP Server (Node.js/TS)** | Model Context Protocol Gateway (Spec 2026) für AI-Agenten (Claude, Gemini, Cursor) |
| **`1420`** | HTTP | **Vite Dev Server** | Hot Module Replacement (HMR) für das Musiker-HUD |

---

## 3. Die 4 System-Säulen (Architektur-Integrität)

Das Monorepo ruht strikt auf vier voneinander getrennten Schichten:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   SÄULE 4: THE BRAIN (MCP & AI GATEWAY)                 │
│   Model Context Protocol (Port 48124) • Gemini 3.8 / Claude 3.7 / Ollama│
│   Tools: propose_mix_adjustment, set_active_skill, learn_plugin, etc. │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ WebSocket / HTTP
┌───────────────────────────────────▼────────────────────────────────────┐
│              SÄULE 2: DESKTOP COMPANION & IPC HUB (TAURI v2)           │
│   Rust Core (Port 48123) • React 18 + Tailwind HUD (Musiker-Interface) │
│   Acoustic Shock Shield (Gehörschutz) • WebSocket Server               │
│   Reference Vault (~/.mixing-buddy/references/)                        │
│   Skill Vault (~/.mixing-buddy/skills/) & Plugin Vault                 │
└──────────────┬──────────────────────────────────────────┬──────────────┘
               │ Native Inter-Process                     │ Latenzfreier
               │ Communication                            │ Audio-Stream
┌──────────────▼─────────────────────────┐  ┌─────────────▼──────────────┐
│  SÄULE 3: THE HANDS (NATIVE BRIDGES)   │  │   SÄULE 1: THE EAR         │
│  Swift Mach-O Binary (logic-ax-bridge) │  │   JUCE 8 / C++20 Plugin    │
│  macOS AXUIElement API (<0.1 ms)       │  │   EBU R128 Dual-Gate Meter │
│  Direkter Zugriff auf Mixer & Plugins  │  │   Streamt 30 fps an 48123  │
└────────────────────────────────────────┘  └────────────────────────────┘
```

### Säule 1: Audio-Telemetrie („The Ear“)
- **Standort:** `plugins/meter-audio/`
- **Technologie:** JUCE 8, C++20, CMake, AU/VST3 Plugin (`MixingBuddyMeter`).
- **Funktion:** Liegt bit-transparent auf dem Master-Out / Stereo-Out.
- **Messungen:**
  - **ITU-R BS.1770-4 / EBU R128:** Integrated LUFS (Dual-Gated, Ziel: -14 LUFS), Momentary LUFS (400 ms), Short-term LUFS (3 s).
  - **True Peak (dBTP):** 4x Oversampling Inter-Sample Peak Detektion.
  - **Stereokorrelation:** Phasen-Goniometer (-1.0 bis +1.0).
  - **Crest Factor / Dynamikbereich:** Verhältnis Peak zu RMS in dB.
  - **32-Band Spectrum Analyzer:** FFT mit Blackman-Harris-Fensterung (20 Hz bis 20 kHz).
- **Streaming:** Sendet alle 33 ms (30 fps) Binär-/JSON-Frames an den lokalen WebSocket `ws://127.0.0.1:48123/meter`.
- **JUCE-Handshake & Projekt-Lifecycle:**
  1. **DAW lädt Projekt (`.logicx` / `.cpr`):** Das Audio-Plugin liest Metadaten & XML-Chunk via `setStateInformation`.
  2. **WebSocket-Handshake:** Das Plugin öffnet eine Verbindung zu `ws://127.0.0.1:48123/meter` und sendet initial ein `project_context_sync`-Paket (Projektname, Sample-Rate, Transport).
  3. **HUD-State Synchronisation:** Der Desktop Companion aktualisiert seinen HUD-State (Target Scope, Genre, Custom Notes) automatisch.

### Säule 2: Desktop Companion & IPC Hub
- **Standort:** `apps/desktop/`
- **Technologie:** Tauri v2, Rust Backend (`src-tauri/`), React 18 + Tailwind CSS Frontend (`src/`).
- **Funktion:** Musiker-HUD (Head-Up-Display) und zentraler Router.
- **Acoustic Shock Shield (`safety_guard.rs`):**
  - Pegelreduktionen ($\le 0.0$ dB) sind **immer** uneingeschränkt zulässig.
  - Pegelanhebungen ($> 0.0$ dB) sind auf **maximal +3.0 dB pro Schritt** gedeckelt.
  - Absolutes Deckenlimit: Master-Kanal $\le 0.0$ dB, Einzelspuren $\le +6.0$ dB.
  - A/B-Restore-Garantie: Das Zurückstellen auf den Ursprungswert vor dem Vorhören wird niemals beschnitten.
- **Integrierte Vaults:**
  - **Plugin Vault (`~/.mixing-buddy/plugins/`):** Angelernte Regler/Knobs von Dritthersteller-Plugins.
  - **Reference Vault (`~/.mixing-buddy/references/`):** Offline-profilierte Audiospuren mit Spektral-Hüllkurven.
  - **Skill Vault (`~/.mixing-buddy/skills/`):** Maßgeschneiderte Mixing-Skills mit Versionshistorie & Prompts.

### Säule 3: Native DAW-Bridges („The Hands“)
- **Standort:** `packages/daw-adapters/` (Swift Mach-O: `packages/daw-adapters/bin/logic-ax-bridge`).
- **Technologie:** Natives Swift mit Apple `ApplicationServices` (`AXUIElement`).
- **Verbot von AppleScript:** Kein träger `osascript`-Overhead; Ausführungszeit $< 0,1$ ms.
- **Befehle (Vollständige Logic Pro Suite):**
  - `list-channel-strips`: Liest alle Kanalzüge samt Fader, Pan, Mute, Solo und allen belegten Insert-Plugin-Namen pro Slot aus.
  - `set-fader --track <name> --db <val>`: Fährt den Fader per logarithmischer Kennlinie und Textfeld auf den exakten dB-Wert.
  - `set-pan --track <name> --pan <val>`: 2-stufige präzise Panorama-Einstellung (-64 bis +63).
  - `open-insert --track <name> --slot <idx>`: Öffnet ein Plugin per GUI-Klick auf den Insert-Slot, falls das Fenster geschlossen ist.
  - `load-plugin --track <name> --slot <idx> --plugin <path>`: Adressiert freie/belegte Audio-FX-Slots und lädt Plugins (z. B. "EQ > Channel EQ" oder AU-Plugins) autonom via rekursiver `AXMenu`-Traversierung.
  - `set-send-routing --track <name> --slot <idx> --destination <dest>`: Belegt Sends-Slots und verdrahtet Busse ("Bus > Bus 1 (Reverb)", "Bus 2") inklusive automatischer Aux-Kanal-Generierung.
  - `set-send-level --track <name> --slot <idx> --db <val>`: Sub-Millimeter CGEvent-Drag-Steuerung für Send-Regler auf 0.1 dB genau.
  - `set-sidechain --track <name> --slot <idx> --source <source>`: Adressiert das Sidechain-Header-Menü (`AXPopUpButton`) in Dynamik-Plugins und verdrahtet Steuersignale ("Bus > Bus 1", "Audio > Kick", "Intern").
  - `get-sidechain --track <name> --slot <idx>`: Liest das aktuell gewählte Sidechain-Steuersignal aus.
  - `transport-play`, `transport-stop`, `transport-locate --bar <bar>`: Blitzschnelle Wiedergabesteuerung via macOS Accessibility & CoreMIDI MCU Fallback (Note 0x5E, 0x5D, 0x60).
  - `select-track --track <name>`: Wählt gezielt Spuren im Arranger an und fokussiert automatisch den linken Inspector.
  - `set-folder-expanded --track <name> --expanded <bool>`: Klappt Track Stacks / Ordner-Spuren im Arranger auf oder zu.
  - `set-param --window <name> --description <param> --value <val>`: Setzt Regler, Frequenzen, Q-Faktoren und Gains in Plugins.
  - `toggle-bypass --window <name>`: Schaltet den Plugin-Bypass für blitzschnelle A/B-Vergleiche um.
  - `close-plugin-window --window <name>`: Schließt temporär geöffnete Plugin-Fenster nach getaner Arbeit sauber wieder.
- **Polymorphes DAWDriver-Interface & Dispatcher-Architektur:**
  Um neben Logic Pro auch Steinberg Nuendo, Cubase und Ableton Live nahtlos einzubinden, ruht Säule 3 auf einem einheitlichen Treiber-Vertrag:
  ```typescript
  export interface DAWDriverAdapter {
    id: 'logic' | 'nuendo' | 'cubase' | 'ableton';
    getChannelStrips(): Promise<TrackDescriptor[]>;
    setFader(trackName: string, db: number): Promise<boolean>;
    setPan(trackName: string, pan: number): Promise<boolean>;
    setParameter(target: ParameterTarget): Promise<boolean>;
    openInsertSlot?(trackName: string, slotIndex: number): Promise<boolean>;
    loadPlugin?(trackName: string, slotIndex: number, pluginPath: string): Promise<boolean>;
    setSend?(trackName: string, slotIndex: number, destination: string, levelDb?: number): Promise<boolean>;
    setSidechain?(trackName: string, slotIndex: number, sourcePath: string): Promise<boolean>;
    transportPlay?(): Promise<boolean>;
    transportStop?(): Promise<boolean>;
    transportLocate?(bar: number): Promise<boolean>;
  }
  ```
  - **Dispatcher-Prinzip:** `lib.rs` und der Desktop Companion sprechen künftig nicht mehr über hardcodierte Einzellogiken, sondern leiten Steuerungsbefehle polymorph an den Treiber weiter, der zur zur Laufzeit erkannten DAW passt (`LogicAXBridge` via macOS Accessibility, Steinberg MIDI Remote Script für Nuendo/Cubase, Ableton Remote Script).

### Säule 4: MCP-Server & AI-Gateway („The Brain“)
- **Standort:** `packages/mcp-server/` & `packages/ai-engine/`
- **Technologie:** Model Context Protocol (Spec 2026), Node.js / TypeScript, Stdio & SSE (Port 48124).
- **Die 12 Kern-Tools:**
  1. `mcp__get_project_info`: Liest DAW-Name, Projekttitel, Sample-Rate, Play-Status und den **aktiven Mixing-Skill** aus.
  2. `mcp__get_mix_telemetry`: Liefert aktuelle LUFS-, Peak-, Dynamik- und Frequenzband-Messwerte.
  3. `mcp__list_tracks`: Liefert echte Kanalzüge mit Lautstärke, Pan und allen Insert-Effekten.
  4. `mcp__propose_mix_adjustment`: Erstellt eine strukturierte ActionCard für die Queue.
  5. `mcp__execute_mix_adjustment`: Direkte Ausführung nach Nutzerfreigabe.
  6. `mcp__audition_region`: 8-Sekunden synchrones A/B-Vorhören mit integrierter Telemetrie-Messung.
  7. `mcp__learn_plugin`: 1-Click Auto-Profiler für Drittanbieter-Plugins.
  8. `mcp__set_active_skill`: Aktiviert zur Laufzeit einen Mixing-Skill (`tonmischmeister`, Custom-Skills oder `none`).
  9. `mcp__match_reference_spectrum`: Berechnet $\Delta(f)$ gegen gespeicherte Referenzkurven und erzeugt Channel EQ Vorschläge.
  10. `mcp__load_plugin`: Lädt autonom Plugins in freie oder belegte Audio-FX Slots.
  11. `mcp__set_send`: Belegt Sends-Slots und stellt Send-Pegel präzise in dB ein.
  12. `mcp__route_sidechain`: Verdrahtet Sidechain-Quellen direkt im Header von Dynamik-Plugins.

---

## 4. Kern-Features & Workflows im Musiker-HUD

### Feature 1: Real-Time Spectrum RTA & Dual-Graph Referenz-Linie
- **32-Band Frequenz-Visualizer:** 20 Hz bis 20 kHz mit logarithmischer Skalierung und Resonanz-Peak-Highlights.
- **Dual-Graph Rendering:**
  - **Pfad 1 (Türkis / Balken):** 30 fps Live-Telemetrie aus dem Master-Bus.
  - **Pfad 2 (Rosa gestrichelt / Linie mit Glow):** Spektralkurve der aktiven Referenz.
  - **Gain Matching:** Normalisiert die Referenzkurve optisch auf das aktuelle Energie-Niveau für fairen A/B-Blick.
  - **Auto-Delta Badge:** Bei Abweichungen $> 2.5$ dB erscheint im RTA sofort der Button `[ ⚡ An Referenz anpassen ]`.

### Feature 2: EBU R128 Dynamik-HUD & Gehörschutz-Status
- Integrated LUFS, Momentary LUFS, True Peak (dBTP), Crest Factor und Stereokorrelation.
- Farbleitsystem: Grün (Zielkorridor), Gelb (Warnung), Rot (Gefahr / Clipping).
- Visuelle Indikation des aktiven Acoustic Shock Shield.

### Feature 3: Kontext-Sensitivität (Genre & Target Bus)
- **Target Bus:** `mix_bus`, `lead_vocal`, `drum_bus`, `sub_bass`, `keys_synths`, `acoustic`.
- **Genre-Profile:** `auto_detect` (KI-Klassifikation), `pop_radio`, `hiphop_trap`, `rock_metal`, `edm_club`, `acoustic_jazz`, `custom_crossover`.
- **CrossoverModal:** Individuelle 5-Zonen Zielkorridore mit Notizen für den Co-Producer.
- **Projekt-Lifecycle & Kontext-Sync (3-Schritt-Sequenz):**
  1. **DAW lädt Projekt (`.logicx` / `.cpr`):** Das JUCE-Plugin liest den Projekt-State und XML-Chunk via `setStateInformation`.
  2. **WebSocket-Sync:** Das Plugin verbindet zu `ws://127.0.0.1:48123/meter` und sendet initial `project_context_sync`.
  3. **HUD-Reaktion:** Der Desktop Companion übernimmt sofort den Target Scope, das Genre-Profil und verknüpfte Mixing-Notizen.

### Feature 4: Human-in-the-Loop ActionCards mit 6-Sekunden A/B-Audition
- Strukturierte Karten mit Rationale, Vorher-/Nachher-Parameter-Diffs und Konfidenz-Score.
- **A/B-Audition:** 6-Sekunden synchrones Setzen aller Parameter mit automatischem Restore.
- **Pinning (📌):** Dauerhaftes Merken wertvoller Vorschläge im `localStorage`.

### Feature 5: Offline-Referenz-Track Profiler (`ReferenceTrackModal`)
- Drag & Drop Dropzone für `.wav`, `.mp3`, `.aiff`, `.flac`.
- Client-seitige Analyse via Web Audio API (`OfflineAudioContext`):
  - Berechnet Integrated LUFS, Peak, Crest Factor und gemitteltes 32-Band FFT-Spektrum.
- Persistenz im Rust Vault (`~/.mixing-buddy/references/<slug>.json`).
- Tab „Gespeicherte Referenzen“ mit 1-Klick-Aktivierung und -Löschung.

### Feature 6: Custom Mixing Skill Manager (`SkillManagerModal`)
- Kachel-Übersicht im edlen Legal Studio Design.
- Kacheln mit Kategoriemarkierung, Metrologie-Badges (LUFS, Crest, True Peak, Headroom) und belegten Slots.
- Umschaltbare Prompts: `[ 🚀 Schnellstart ]` und `[ 🛠️ Werkstatt ]` inkl. One-Click-Copy.
- Aufklappbare Revisions-Historie (`▼ Version: vX.X`).
- Favoriten-Stern `⭐` zum schnellen Pinnen.
- Sofort-Suche und Filterchips: `[ ✨ Alle Skills ]`, `[ ⭐ Favoriten ]`, `[ ⚡ Eigene Versionen ]`.

### Feature 7: 5-Schritte-Synthese-Wizard (`SkillWizardModal`)
- **Schritt 1 (Disziplin & Fokus):** Master, Vocals, Drums, 808/Bass, Akustik samt Name und Intention.
- **Schritt 2 (Targets):** Schieberegler für LUFS, Toleranz, Crest-Korridor, True Peak Ceiling und Headroom.
- **Schritt 3 (Tools & Ästhetik):** Stock- vs. Vault-Plugins, Saturation-Charakter (Clean, Warm Tape, Tube Clipper, Console).
- **Schritt 4 (Audit-Methodik & Prüf-Ampel):**
  - 🟢 **Optimal:** Bedingungen für fehlerfreien Mix.
  - 🟡 **Aufmerksamkeit:** Frühwarnkriterien (Mittenmaskierung, De-Essing-Bedarf).
  - 🔴 **Dringender Eingriff:** Schwellenüberschreitungen (Intersample-Clipping, Phasenauslöschung).
- **Schritt 5 (KI-Synthese & Vorschau):**
  - Generiert vollständige `MixingSkill`-Definition via Gemini BYOK oder Studio-Fallback.
  - Vorschau in Kachel-, Markdown- und JSON-Ansicht.
  - Button `[ 💾 Neuen Skill speichern & aktivieren ]`.

### Feature 8: Laufzeit-Injektion & Prompt Console Integration
- Dropdown in der Prompt Console Toolbar: `[ 🎛️ Skill: Tonmischmeister (v1.0) ▼ ]`.
- Der Quickstart-Prompt des aktiven Skills wird als primäre Leitplanke (`--- ACTIVE MIXING SKILL DIRECTIVE ---`) an die AI-Engine übergeben.
- Metrologie-Ziele des Skills überschreiben Standard-Grenzwerte bei ActionCard-Generierung.

### Feature 9: Transport-Steuerung & 8-Sekunden Audition-Loop (Sprint 6)
- **AX-First Transport mit MCU MIDI Fallback:**
  - `transport-play`, `transport-stop`, `transport-locate --bar <bar>` steuern Logic Pro verzögerungsfrei über macOS Accessibility (`AXPress` auf Play/Stop-Buttons im Control Bar).
  - Falls Accessibility temporär verdeckt ist, springt der integrierte **CoreMIDI Mackie Control Universal (MCU) Fallback** ein (Notes `0x5E` Play, `0x5D` Stop, `0x60` Cycle).
- **Automatischer 8-Sekunden A/B-Audit:**
  - `mcp__audition_region` positioniert den Playhead taktgenau, aktiviert die Wiedergabe für exakt 8 Sekunden, sammelt synchron Echtzeit-LUFS und Crest-Faktor und stellt den Ursprungszustand automatisch wieder her.

### Feature 10: Arranger-Navigation & Track-Stack / Folder-Expansion (Sprint 7)
- **Dynamische Arranger-Spur-Interaktion:**
  - `select-track`: Selektiert Spuren im Haupt-Arranger von Logic Pro direkt über deren Spurtitel (`AXRow` / `AXCell`).
  - **Automatischer Inspector-Fokus:** Durch die Spuranwahl aktualisiert Logic Pro sofort den linken Inspector-Kanalzug – Fader, Pan und Inserts stehen dem Mixing Buddy unmittelbar zur Verfügung.
- **Track-Stack / Ordner-Expansion (`set-folder-expanded`):**
  - Erkennt Disclosure-Dreiecke von Gruppen- und Ordnerspuren (z. B. "Drums", "Vocals") und klappt diese gezielt auf oder zu, um Unterspuren (z. B. "Snare 2", "Kick In") für die Bearbeitung freizulegen.

### Feature 11: Autonomes Plugin-Laden aus Audio-FX-Menüs (Sprint 8)
- **Rekursive AXMenu-Traversierung:**
  - `mcp__load_plugin` bzw. `load-plugin` adressiert jeden der 15 Audio-FX-Slots auf dem gewählten Kanalzug.
  - Öffnet das native Logic-PopUp-Menü und navigiert hierarchisch durch Untermenüs (z. B. `["EQ", "Channel EQ"]`, `["Dynamics", "Compressor"]` oder `["Audio Units", "FabFilter", "Pro-Q 3"]`).
  - Unterscheidet zuverlässig zwischen leeren Slots (`SlotButton`) und bereits belegten Slots (`MenuButton`).
  - Schützt vor falschen Mausklicks auf Trennlinien oder deaktivierte Menüeinträge.

### Feature 12: Bus-Sends, Submixe & Send-Pegel-Automation (Sprint 9)
- **Bus-Routing & Aux-Verdrahtung:**
  - `mcp__set_send` bzw. `set-send-routing` belegt freie oder bestehende Sends-Slots (1 bis 8) mit Zielbussen (z. B. `"Bus > Bus 1 (Reverb)"` oder `"Bus > Bus 3 (Drum Bus)"`).
  - Logic Pro erzeugt bzw. verknüpft dabei automatisch den zugehörigen Aux-Return-Kanalzug.
- **Sub-Millimeter CGEvent Send-Pegelregelung:**
  - Send-Regler in Logic besitzen oft kein direktes Eingabefeld. Die Bridge ermittelt die exakten Bildschirmkoordinaten des Drehreglers und vollzieht hochpräzise `CGEvent`-Maus-Drags (vertikal/horizontal skaliert) auf $\pm 0.1$ dB genau.

### Feature 13: Sidechain-Header-Routing & Ducking-Automation (Sprint 10)
- **Header-Inspektion im Plugin-Fenster:**
  - Adressiert zielsicher den `AXPopUpButton` im oberen Header-Bereich von Dynamik-Plugins (lokalisierte Suche nach „Side Chain“).
  - Traversiert das Sidechain-Menü und verdrahtet Quellspuren oder Busse (z. B. `"Bus > Bus 1"`, `"Audio > Kick"` oder `"Intern"` zum Deaktivieren).
- **Ducking ActionCards mit dualer Ausführung:**
  - Bei Erkennung von Frequenzkollisionen im Sub-Bass (z. B. Kick vs. Bass) fasst die AI-Engine sowohl das Sidechain-Routing als auch die chirurgischen Kompressor-Parameter (Threshold -18.0 dB, Ratio 4:1, Attack 15 ms, Release 80 ms) in einer einzigen Karte zusammen.
  - Das Musiker-HUD zeigt das Routing transparent an (`🔗 Sidechain: Bass (Slot 1) ← Audio > Kick`) und führt beim Klick auf *Anwenden* beide Schritte atomar aus.

---

## 5. REST- & WebSocket-Schnittstellen (Routing-Tabelle)

### 5.1 Desktop Companion Routing (Port 48123)

| Endpunkt | Methode | Payload / Parameter | Antwort | Beschreibung |
| :--- | :---: | :--- | :--- | :--- |
| **`/api/project`** | `GET` | – | `{ daw, projectName, sampleRate, isPlaying, connected }` | Liefert DAW-Status und aktive Session-Metadaten. |
| **`/api/tracks`** | `GET` | – | `{ tracks: TrackDescriptor[] }` | Liste aller aktiven Kanalzüge samt Fader, Pan und Insert-Namen. |
| **`/api/tracks/select`** | `POST` | `{ track: string }` | `{ success: boolean, track: string }` | Selektiert Spur im Arranger und fokussiert linken Inspector. |
| **`/api/tracks/folder-expanded`**| `POST` | `{ track: string, expanded: boolean }` | `{ success: boolean }` | Klappt Track-Stack/Ordner im Arranger auf oder zu. |
| **`/api/channel-strips`** | `GET` | – | `{ channelStrips: any[] }` | Direkte Inspektion der Logic Pro Inspector/Mixer-Streifen via Swift-Bridge. |
| **`/api/plugins/load`** | `POST` | `{ track: string, slot: number, plugin: string }` | `{ success: boolean, track, slot, plugin }` | Lädt ein Plugin autonom in einen Audio-FX-Slot (1–15). |
| **`/api/plugins/sidechain`** | `POST` | `{ track: string, slot: number, source: string }` | `{ success: boolean, track, slot, sidechain }` | Verdrahtet die Sidechain-Quelle im Plugin-Header. |
| **`/api/sends/route`** | `POST` | `{ track: string, slot: number, destination: string }` | `{ success: boolean, track, slot, destination }` | Weist einem Send-Slot einen Bus zu (erzeugt Aux-Kanal). |
| **`/api/sends/level`** | `POST` | `{ track: string, slot: number, db: number }` | `{ success: boolean, track, slot, db }` | Stellt den Send-Pegel via CGEvent auf 0.1 dB genau ein. |
| **`/api/transport/play`** | `POST` | – | `{ success: boolean }` | Startet DAW-Wiedergabe (AX-First & MCU Fallback). |
| **`/api/transport/stop`** | `POST` | – | `{ success: boolean }` | Stoppt DAW-Wiedergabe (AX-First & MCU Fallback). |
| **`/api/transport/locate`** | `POST` | `{ bar: number }` | `{ success: boolean, bar: number }` | Positioniert den Playhead auf Takt x. |
| **`/api/proposals`** | `POST` | `MixActionProposal` (JSON) | `{ success: boolean, proposalId: string }` | Liefert eine neu generierte ActionCard in die HUD-Queue ein. |
| **`/api/execute-action`** | `POST` | `{ proposalId, isAudition, isRestore? }` | `{ success: boolean, executedDeltas: number, shieldInterventions: [...], errorCode: string \| null }` | Führt `[Anwenden]`, `[A/B Listen]` oder die Wiederherstellung aus. |
| **`/api/vault/plugins`** | `GET` | – | `{ plugins: PluginSummaryItem[] }` | Liefert alle im Plugin Vault gespeicherten Drittanbieter-Plugins. |
| **`/api/vault/learn`** | `POST` | `{ windowTitle: string \| null }` | `LearnedPluginSpec` | Triggert den 1-Click Auto-Profiler für das geöffnete Plugin-Fenster. |
| **`/api/vault/delete`** | `POST` | `{ slug: string }` | `{ success: boolean }` | Löscht ein Plugin aus dem Plugin Vault. |
| **`/api/references`** | `GET` | `?id=<slug>` (optional) | `{ references: [...] }` \| `ReferenceTrackProfile` | Listet alle Referenzen auf oder liefert ein vollständiges Profil. |
| **`/api/references`** | `POST` | `ReferenceTrackProfile` (JSON) | `{ success: boolean }` | Speichert ein Referenz-Profil dauerhaft in `~/.mixing-buddy/references/`. |
| **`/api/references/delete`**| `POST` | `{ id: string }` | `{ success: boolean }` | Löscht eine gespeicherte Referenz. |
| **`/api/skills`** | `GET` | `?id=<slug>` (optional) | `{ skills: [...] }` \| `MixingSkill` | Listet alle Mixing-Skills auf oder liefert eine Detaildefinition. |
| **`/api/skills`** | `POST` | `MixingSkill` (JSON) | `{ success: boolean }` | Speichert einen Skill dauerhaft in `~/.mixing-buddy/skills/`. |
| **`/api/skills/delete`** | `POST` | `{ id: string }` | `{ success: boolean }` | Löscht einen benutzerdefinierten Mixing-Skill. |
| **`/meter`** | `WS` | WebSocket Connect | 30 fps JSON-Stream (`MetrologyTelemetryFrame`) | Kontinuierlicher Telemetrie-Stream direkt aus dem JUCE-Master-Plugin. |

#### Strukturierte Shield- & Fehler-Rückmeldung (`POST /api/execute-action`)
Um im Frontend maximale Transparenz und Gehörschutz-Sicherheit zu gewährleisten, liefert der Endpoint detaillierte Telemetrie über eingreifende Schutzmechanismen und Multi-DAW-Status:
```json
{
  "success": true,
  "executedDeltas": 3,
  "shieldInterventions": [
    {
      "parameter": "fader_db",
      "requested": 5.0,
      "clampedTo": 3.0,
      "reason": "ACOUSTIC_SHOCK_SHIELD_MAX_BOOST"
    }
  ],
  "errorCode": null
}
```
**Frontend-Relevanz:**
- **Visuelle Warnung bei Pegeldrosselung:** Das Musiker-HUD warnt optisch, wenn ein Vorschlag vom *Acoustic Shock Shield* gekappt wurde (z. B. Begrenzung auf maximal $+3.0$ dB pro Schritt).
- **Multi-DAW-Fehlerdiagnose:** Falls in heterogenen Umgebungen (z. B. Nuendo vs. Logic) eine adressierte Spur oder ein Plugin-Parameter nicht existiert oder verriegelt ist, wird ein präziser `errorCode` geliefert, statt stillschweigend Scheinerfolge zu melden.

### 5.2 MCP AI-Gateway Routing (Port 48124 & Stdio)

| Tool / Endpunkt | Typ | Payload / Parameter | Beschreibung |
| :--- | :---: | :--- | :--- |
| **`mcp__get_project_info`** | Tool | `{}` | Liefert DAW-Status und **`activeSkill`** (ID, Targets, Quickstart-Direktive). |
| **`mcp__get_mix_telemetry`** | Tool | `{ durationMs?: number }` | Liefert 30 fps Master-Bus Telemetrie & Resonanz-Peaks. |
| **`mcp__list_tracks`** | Tool | `{ includePlugins?: boolean }` | Echte Kanalzüge mit Pegel, Pan und belegten Effekten. |
| **`mcp__propose_mix_adjustment`**| Tool | `ProposeMixAdjustmentInput` | Erstellt eine ActionCard unter Beachtung des Gehörschutzes. |
| **`mcp__execute_mix_adjustment`**| Tool | `ExecuteMixAdjustmentInput` | Direkte DAW-Parameterausführung nach Genehmigung. |
| **`mcp__audition_region`** | Tool | `{ startBar, endBar, autoPlay }` | Startet 8-Sekunden DAW-Cycle-Wiedergabe zum Vorhören mit Telemetrie. |
| **`mcp__learn_plugin`** | Tool | `{ windowTitle?: string }` | Auto-Profiler für das geöffnete Plugin-Fenster. |
| **`mcp__set_active_skill`** | Tool | `{ skillId: string }` | Aktiviert einen Mixing-Skill (`tonmischmeister`, Custom-Skill oder `none`). |
| **`mcp__match_reference_spectrum`**| Tool | `{ referenceId, thresholdDb? }` | Berechnet Spektraldifferenz und schlägt EQ-Deltas vor. |
| **`mcp__load_plugin`** | Tool | `{ trackName, slotIndex, pluginPath }` | Lädt autonom Plugins aus Menühierarchien in Audio-FX-Slots. |
| **`mcp__set_send`** | Tool | `{ trackName, slotIndex, destination, levelDb? }` | Belegt Sends-Slots und regelt Send-Pegel präzise in dB. |
| **`mcp__route_sidechain`** | Tool | `{ trackName, slotIndex, sourcePath }` | Verdrahtet Sidechain-Quellen direkt im Header von Dynamik-Plugins. |
| **`/health`** | HTTP | – | Status, Versionsnummer und Anzahl gelernter Plugins. |
| **`/sse`** | HTTP | Server-Sent Events | Standard MCP SSE-Transport für Cursor & Claude Desktop. |

---

## 6. Datenmodelle & TypeScript-Definitionen

### `MixingSkill` (Custom Co-Producer Skill)
```typescript
export interface MixingSkill {
  id: string;                         // Slug (z. B. "tonmischmeister")
  name: string;                       // z. B. "Tonmischmeister"
  category: 'vocal' | 'drums' | 'master' | 'bass' | 'general';
  isFavorite: boolean;
  version: string;                    // z. B. "v1.0"
  revisionHistory: {
    version: string;
    timestamp: string;
    comment: string;
  }[];
  metrologyTargets: {
    integratedLufs: number;           // z. B. -14.0 LUFS
    toleranceLufs: number;            // z. B. ±1.0 LU
    crestFactor: { min: number; max: number }; // z. B. 9.0 bis 12.0 dB
    maxTruePeakDb: number;            // z. B. -1.0 dBTP
    recommendedHeadroomDb: number;    // z. B. 1.5 dB
  };
  preferredChain: {
    slotType: 'utility' | 'eq' | 'dynamics' | 'saturation' | 'space';
    preferredPluginHint?: string;     // z. B. "Channel EQ" oder "FabFilter Pro-Q 3"
    typicalRules: string[];
  }[];
  prompts: {
    quickstart: string;               // Primäre Leitplanke für HUD ActionCards
    workshop: string;                 // Ausführliche Diagnose-Leitlinie für Chat/Sessions
  };
  createdAt: number;
  updatedAt: number;
}
```

### `ReferenceTrackProfile` (Gespeicherte Referenzkurve)
```typescript
export interface ReferenceTrackProfile {
  id: string;                         // Slug (z. B. "dua-lipa-levitating")
  name: string;
  fileName: string;
  durationSeconds: number;
  integratedLufs: number;             // EBU R128 Gesamtpegel
  crestFactorDb: number;              // Dynamikumfang
  truePeakDb: number;
  spectrum32Bands: number[];          // 32-Band FFT Energiekurve (dBFS)
  createdAt: number;
  filePath?: string;
}
```

### `SidechainRoute` (Ducking- & Sidechain-Routing)
```typescript
export interface SidechainRoute {
  trackName: string;                  // Zielspur des Plugins (z. B. "Bass")
  slotIndex: number;                  // Audio-FX Slot (1 bis 15)
  sourcePath: string;                 // z. B. "Bus > Bus 1" oder "Audio > Motown Revisited Kit"
}
```

### `MixActionProposal` (Die ActionCard)
```typescript
export interface MixActionProposal {
  id: string;                         // Eindeutige ID (z. B. "prop_1790810661241_ssvkj")
  timestamp: number;
  category: 'gain_staging' | 'eq_tonal_balance' | 'dynamic_control' | 'stereo_width' | 'masking_reduction';
  title: string;
  rationale: string;                  // Psychoakustische Erklärung mit Mess- und Skillbezug
  confidenceScore: number;            // 0.0 bis 1.0
  deltas: ParameterDelta[];
  status: 'pending' | 'applied' | 'rejected' | 'auditioning';
  isPinned?: boolean;
  sidechainRoute?: SidechainRoute;    // Optional: Ducking- & Sidechain-Header-Verdrahtung
}
```

---

## 7. Aktueller Status Quo & Release-Matrix

| Komponente / Meilenstein | Plattform | Status | Besonderheiten |
| :--- | :--- | :---: | :--- |
| **MixingBuddyMeter** (AU/VST3) | macOS (ARM64/x86) | ✅ Fertig | ITU-R BS.1770-4, 32-Band FFT, Port 48123 |
| **Logic AX Bridge** (Swift) | macOS | ✅ Fertig | Native Mach-O Binary, Fader/Pan/EQ/Inserts gesteuert |
| **Acoustic Shock Shield** | Rust (Tauri) | ✅ Fertig | Asymmetrischer Gehörschutz, max +3 dB/Schritt |
| **Multi-Parameter A/B-Loop** | Desktop HUD | ✅ Fertig | Synchroner 6s-Audition-Zyklus mit automatischem Restore |
| **ActionCard Pinning (📌)** | Desktop HUD | ✅ Fertig | Persistenz in `localStorage`, gefilterte Queue |
| **Logic Insert Auto-Opener** | Rust / Swift | ✅ Fertig | Öffnet geschlossene Plugins slot-genau |
| **Plugin Vault & Auto-Profiler** | Rust / Swift / TS | ✅ Fertig | Speichert Plugin-Knobs in `~/.mixing-buddy/plugins/` |
| **Genre- & Crossover-Targets** (Sprint 3) | Desktop / JUCE | ✅ Fertig | 5-Zonen FFT, CrossoverModal, Projektkontext-Sync |
| **Reference Track Profiler** (Sprint 4) | Desktop / WebAudio | ✅ Fertig | Drag & Drop Offline-Profiler, Reference Vault |
| **Dual-Graph RTA & Delta-Matching** (Sprint 4)| Desktop / AI-Engine | ✅ Fertig | Türkis (Live) vs. Rosa (Referenz), ActionCard bei $\Delta > 2.5$ dB |
| **Custom Mixing Skill Vault** (Sprint 5.1/5.2)| Rust / Desktop HUD | ✅ Fertig | Legal Studio Kachelmanager, Favoriten ⭐, Revisions-Historie |
| **5-Schritte-Synthese-Wizard** (Sprint 5.3) | AI-Engine / Desktop | ✅ Fertig | Disziplin, Targets, Ästhetik, Ampel 🟢🟡🔴, KI-Synthese |
| **Runtime Skill Injection** (Sprint 5.4) | HUD / MCP Server | ✅ Fertig | Dropdown in Prompt Console, `mcp__set_active_skill` Tool |
| **Transport & 8s-Audition-Loop** (Sprint 6) | macOS (AX + CoreMIDI) | ✅ Fertig | AX Transport, MCU Note 0x5E/5D/60 Fallback, 8s Audit |
| **Arranger & Folder-Expansion** (Sprint 7) | macOS (Swift AX) | ✅ Fertig | Track-Stacks auf/zuklappen, Inspector Auto-Fokus |
| **Audio-FX Plugin Loading** (Sprint 8) | macOS (Swift AX) | ✅ Fertig | Rekursive AXMenu-Traversierung, freie & belegte Slots |
| **Bus-Sends & Submixe** (Sprint 9) | macOS (Swift AX) | ✅ Fertig | Sends 1–8 verdrahten, Aux-Erzeugung, 0.1 dB CGEvent-Drag |
| **Sidechain & Ducking-Automation** (Sprint 10) | macOS / AI-Engine | ✅ Fertig | AX Header PopUp, Bus/Audio Routing, Ducking ActionCards |
| **Packaging & App Installation** | macOS | ✅ Fertig | Installiert unter `/Applications/Oszillation Mixing Buddy.app` |

### 7.1 System-Status-Quo im Überblick

| Domäne | Komponente | Status | Anmerkung |
| :--- | :--- | :---: | :--- |
| **Audio-Telemetrie** | `MixingBuddyMeter` (AU/VST3) | 🟢 100 % | 30 fps Stream, EBU R128 Dual-Gate, True Peak, FFT |
| **Desktop Companion** | Tauri v2 + React 18 HUD | 🟢 100 % | RTA Dual-Graph, Card Pinning, Crossover-Modal, Sidechain-Badge |
| **Musikalische KI** | AI Engine & Vaults | 🟢 100 % | Targets, Referenzen, Custom Skills & Wizard, Ducking-Automation |
| **Logic Pro Steuerung** | Swift AX Bridge + MCU | 🟢 100 % | Transport, Arranger, Inserts, Sends, Sidechains (Vollautonomie) |
| **Steinberg Nuendo / Cubase** | MIDI Remote Adapter | 🟡 40 % | VST3-Plugin läuft, JS-Script-Grundgerüst vorhanden |
| **Ableton Live** | Remote Surface / MCU | ⚪ 15 % | MCU-Transport läuft, Deep LOM Script offen |

---

## 8. Ausblick: Phase 4 (Multi-DAW Readiness – Steinberg Nuendo & Cubase)

Da Apple Logic Pro mit Phase 3 nun zu 100 % beherrscht wird, steht der Weg frei für die Multi-DAW-Architektur. Das Entscheidende daran: **Steinberg Nuendo und Cubase sind dank der offiziellen JavaScript MIDI Remote API wesentlich sauberer, deterministischer und schneller anzubinden als Logic Pro.**

### Warum Nuendo & Cubase die nächste Stufe zünden:
1. **Kein Fenster-Zwang:** In Nuendo müssen Plugin-Fenster für Parameter-Änderungen gar nicht geöffnet sein; Parameter werden direkt über ihre `paramId` bzw. Parameter-Bänke angesprochen.
2. **Native 14-Bit Auflösung:** Keine Maus-Drag-Schleifen für Regler – exakte Werteübergabe in Mikrosekunden.
3. **Plattform-Vorteil:** Unser C++20 Plugin `MixingBuddyMeter` liegt bereits als natives VST3 vor und sendet identische Telemetriedaten.

### Geplanter Phasen-Ablauf für Steinberg:
- **Sprint 11:** Steinberg Auto-Discovery & Dispatcher-Aktivierung in `lib.rs`
- **Sprint 12:** Steinberg JavaScript MIDI Remote Script (Fader, Pan, Mute/Solo, Sends)
- **Sprint 13:** VST3 Insert-Parameter-Steuerung via MIDI Remote Parameter-Bänke
- **Sprint 14:** Cross-DAW Verifikation (Logic Pro ↔ Nuendo 13/14 Parallelbetrieb)

---

*Dokumentation gepflegt nach den Richtlinien des Universal AI Co-Producer Monorepos. Stand: Oktober 2026.*
