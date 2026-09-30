# Oszillation Mixing Buddy — Umfassende System- & Feature-Dokumentation

> **Status:** Version 0.2.0 (Produktiv / Verifiziert / Sprint 3 Ready)  
> **Zielgruppe:** Web-Frontend-Entwickler, UI/UX-Designer, Core-Entwickler & Stakeholder  
> **Repository:** `Steinberg-Mixing-Buddy` / `Oszillation Mixing Buddy`  
> **Stand:** Oktober 2026  

---

## 1. Produktvision & Leitbild

**Oszillation Mixing Buddy** ist der erste universelle, native **KI-Co-Producer für professionelle Digital Audio Workstations (DAWs)** — mit primärem Fokus auf **Apple Logic Pro** und **Steinberg Nuendo / Cubase**.

Im Gegensatz zu klassischen AI-Audio-Tools, die Audio extern generieren oder als isolierte Chatbots fungieren, agiert der Mixing Buddy als **virtueller Toningenieur direkt am Mischpult des Nutzers**:
- **Er hört mit:** Hochpräzise Echtzeit-Telemetrie direkt auf dem Master-Bus (EBU R128, ITU-R BS.1770-4, 32-Band FFT).
- **Er sieht alles:** Vollständige Echtzeit-Inspektion aller Kanalzüge, Fader, Panorama-Positionen und Insert-Plugins.
- **Er greift ein:** Sub-Millisekunden native Steuerung von Fadern, Panning und Insert-Effekten (z. B. Logic Pro Channel EQ).
- **Er schützt das Gehör:** Der integrierte *Acoustic Shock Shield* verhindert physikalisch gefährliche Lautstärkesprünge.
- **Human-in-the-Loop:** Keine blinde Automatik — jede KI-Entscheidung wird als übersichtliche **ActionCard** vorgeschlagen, kann per **A/B-Audition 6 Sekunden lang vorgehört** und erst auf Bestätigung dauerhaft angewendet werden.

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
# 1. Abhängigkeiten installieren
pnpm install

# 2. Frontend im schnellen Browser-Entwicklungsmodus starten (Vite HMR)
pnpm --filter desktop dev
# -> Web-Interface verfügbar unter: http://localhost:1420

# 3. Vollständiges Desktop-HUD mit nativer macOS-Bridge & Gehörschutz starten
pnpm --filter desktop tauri dev

# 4. (Optional) Native Swift-Bridge neu kompilieren (nur bei Änderungen an LogicAXBridge.swift)
pnpm --filter @mixing-buddy/daw-adapters run build:swift
```

### 2.3 Netzwerk-Topologie & Aktive Ports
| Port | Protokoll | Komponente | Beschreibung |
| :--- | :--- | :--- | :--- |
| **`48123`** | HTTP / WebSocket | **Desktop Companion (Rust/Tauri)** | Zentraler IPC-Hub: REST-Endpoints & 30 fps Audio-Telemetrie-Stream |
| **`48124`** | HTTP / SSE / Stdio | **MCP Server (Node.js/TS)** | Model Context Protocol Gateway für AI-Tools & Agenten |
| **`1420`** | HTTP | **Vite Dev Server** | Hot Module Replacement (HMR) für das Musiker-HUD |

---

## 3. Die 4 System-Säulen (Architektur-Integrität)

Das Monorepo ruht auf vier strikt voneinander getrennten Schichten:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   SÄULE 4: THE BRAIN (MCP & AI GATEWAY)                 │
│   Model Context Protocol (Port 48124) • Gemini 3.8 / Claude 3.7 / Ollama│
│   Tool Calling: propose_mix_adjustment, execute_mix_adjustment, ...   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ WebSocket / HTTP
┌───────────────────────────────────▼────────────────────────────────────┐
│              SÄULE 2: DESKTOP COMPANION & IPC HUB (TAURI v2)           │
│   Rust Core (Port 48123) • React 18 + Tailwind HUD (Musiker-Interface) │
│   Acoustic Shock Shield (Gehörschutz) • WebSocket Server               │
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
  - **32-Band Spectrum Analyzer:** FFT mit Blackman-Harris-Fensterung.
- **Streaming:** Sendet alle 33 ms (30 fps) Binär-/JSON-Frames an den lokalen WebSocket `ws://127.0.0.1:48123/meter`.

### Säule 2: Desktop Companion & IPC Hub
- **Standort:** `apps/desktop/`
- **Technologie:** Tauri v2, Rust Backend (`src-tauri/`), React 18 + Tailwind CSS Frontend (`src/`).
- **Funktion:** Musiker-HUD (Head-Up-Display) und zentraler Router.
- **Acoustic Shock Shield (`safety_guard.rs`):**
  - Pegelreduktionen ($\le 0.0$ dB) sind **immer** uneingeschränkt zulässig.
  - Pegelanhebungen ($> 0.0$ dB) sind auf **maximal +3.0 dB pro Schritt** gedeckelt.
  - Absolutes Deckenlimit: Master-Kanal $\le 0.0$ dB, Einzelspuren $\le +6.0$ dB.
  - A/B-Restore-Garantie: Das Zurückstellen auf den Ursprungswert vor dem Vorhören wird niemals beschnitten.

### Säule 3: Native DAW-Bridges („The Hands“)
- **Standort:** `packages/daw-adapters/` (Swift Mach-O: `packages/daw-adapters/bin/logic-ax-bridge`).
- **Technologie:** Natives Swift mit Apple `ApplicationServices` (`AXUIElement`).
- **Verbot von AppleScript:** Kein träger `osascript`-Overhead; Ausführungszeit $< 0,1$ ms.
- **Befehle:**
  - `list-channel-strips`: Liest alle Kanalzüge samt Fader, Pan, Mute, Solo und allen belegten Insert-Plugin-Namen pro Slot aus.
  - `set-fader --track <name> --db <val>`: Fährt den Fader per logarithmischer Kennlinie und Textfeld auf den exakten dB-Wert.
  - `set-pan --track <name> --pan <val>`: 2-stufige präzise Panorama-Einstellung (-64 bis +63).
  - `open-insert --track <name> --slot <idx>`: Öffnet ein Plugin per GUI-Klick auf den Insert-Slot, falls das Fenster geschlossen ist.
  - `set-param --window <name> --description <param> --value <val>`: Setzt Regler, Frequenzen, Q-Faktoren und Gains in Plugins.
  - `toggle-bypass --window <name>`: Schaltet den Plugin-Bypass für blitzschnelle A/B-Vergleiche um.
  - `close-plugin-window --window <name>`: Schließt temporär geöffnete Plugin-Fenster nach getaner Arbeit sauber wieder.

### Säule 4: MCP-Server & AI-Gateway („The Brain“)
- **Standort:** `packages/mcp-server/` & `packages/ai-engine/`
- **Technologie:** Model Context Protocol (Spec 2026), Node.js / TypeScript, Stdio & SSE (Port 48124).
- **Die 7 Kern-Tools:**
  1. `mcp__get_project_info`: Liest DAW-Name, Projekttitel, Sample-Rate und Play-Status aus.
  2. `mcp__get_mix_telemetry`: Liefert aktuelle LUFS-, Peak- und Frequenzband-Messwerte.
  3. `mcp__list_tracks`: Liefert echte Kanalzüge mit Lautstärke, Pan und allen Insert-Effekten.
  4. `mcp__propose_mix_adjustment`: Erstellt eine strukturierte ActionCard für die Queue.
  5. `mcp__execute_mix_adjustment`: Direkte Ausführung nach Nutzerfreigabe.
  6. `mcp__audition_region`: Temporäres A/B-Vorhören.
  7. `mcp__learn_plugin`: 1-Click Auto-Profiler für Drittanbieter-Plugins.

---

## 4. Kern-Features & Workflows für das Web-Frontend

Diese Features müssen im Web-Frontend (Marketing-Page, Cloud-Dashboard oder Web-App) hervorgehoben und visualisiert werden:

### Feature 1: Real-Time Spectrum RTA & EBU R128 HUD
- **32-Band Frequenz-Visualizer:** 20 Hz bis 20 kHz mit logarithmischer Skalierung und Resonanz-Peak-Highlights.
- **EBU R128 Dynamik-Anzeige:** 
  - Integrated LUFS (Target-Marker bei -14 LUFS für Streaming wie Spotify/Apple Music).
  - Momentary LUFS & True Peak mit Farbcodierung (Grün = optimal, Gelb = Grenzbereich, Rot = Clipping-Gefahr).
  - Stereokorrelation (Phasentreue für Monokompatibilität).

### Feature 2: Live DAW Auto-Discovery
- Erkennt automatisch, welche DAW im Studio geöffnet ist (Apple Logic Pro, Steinberg Nuendo, Cubase).
- Zeigt im HUD sofort den aktuellen Projektstatus, Abtastrate und Verbindungszustand an.
- **Strikte Anti-Mock-Garantie:** Es werden niemals Scheindaten angezeigt — läuft keine DAW, meldet das System ehrlich den Standalone-Status.

### Feature 3: AI Co-Producer Prompt Console
- Der Nutzer kann in natürlicher Musikersprache Anweisungen eingeben:
  - *„Räume das Low-End auf den Drums auf und ziehe die Snare etwas nach vorn.“*
  - *„Beseitige die Mittenmaskierung zwischen Bass und Gitarre.“*
  - *„Passe das Mastering psychoakustisch an -14 LUFS an.“*
- Unterstützt Multi-LLM-Gateways: Google Gemini 3.8 Flash, Anthropic Claude 3.7 Sonnet, OpenAI GPT-4o sowie lokale Offline-Modelle via Ollama.

### Feature 4: Human-in-the-Loop ActionCards
Vorschläge der KI werden nicht heimlich im Projekt angewendet, sondern als interaktive Karten präsentiert:
- **Header:** Titel, psychoakustische Kategorie (`eq_tonal_balance`, `masking_reduction`, etc.) und statistischer Confidence-Score.
- **Begründung (Rationale):** Musikalische und akustische Erklärung basierend auf echten Messwerten (z. B. gemessene Frequenzüberlagerung bei 430 Hz).
- **Before/After Parameter-Diff:**
  - Jede Modifikation listet Spur, Insert-Plugin, Reglername, Ausgangswert (durchgestrichen) und Zielwert (hervorgehoben in Smaragdgrün).
  - Beispiel: `Motown Revisited Kit › Channel EQ › High Cut Frequency: 20000 Hz → 8000 Hz`.

### Feature 5: Multi-Parameter A/B Audition (Vorhören)
- Klick auf **„A/B Listen“**:
  - Alle Parameter der Karte (egal ob 1 oder 10 Schritte gleichzeitig) werden live in Logic Pro / Nuendo gesetzt.
  - Das HUD wechselt in den Zustand `auditioning` mit aktivem Gehör-Indikator.
  - Ein 6-Sekunden-Countdown ermöglicht den direkten akustischen Vorher-Nachher-Vergleich.
  - Nach 6 Sekunden stellt das System vollautomatisch alle Regler exakt auf den Ausgangszustand zurück.

### Feature 6: 1-Click Apply (Anwenden)
- Klick auf **„Anwenden“**:
  - Alle Werte werden endgültig in das DAW-Projekt übertragen.
  - Die Karte wird als `applied` markiert und in der Session protokolliert.

### Feature 7: ActionCard Pinning & Persistenz (📌)
- **Problem:** Bei neuen Prompt-Versuchen oder App-Neustarts gingen wertvolle Referenzkarten bisher verloren.
- **Lösung:**
  - Jede Karte hat oben rechts einen **Pin-Button (📌)**.
  - Angepinnte Karten erhalten einen edlen Bernsteinglanz (`border-amber-500/60`), ein Badge `[📌 Gespeichert]` und werden persistent im `localStorage` gesichert.
  - **Intelligente Queue:** Der Button *„Queue leeren“* löscht nur flüchtige Karten — gespeicherte Standard-Karten bleiben dauerhaft erhalten.
  - **Filter-Tabs:** Umschalten zwischen `[ Alle (N) ]` und `[ 📌 Angepinnt (M) ]`.
- > [!IMPORTANT]
  > **Architektur-Hinweis (Persistenz-Evolution in Sprint 3):**  
  > Die Session- und Genre-Targets (Sprint 3) werden künftig projektgebunden über das JUCE-Master-Plugin synchronisiert (`getStateInformation` / `setStateInformation` in der `.logicx`- bzw. `.cpr`-Projektdatei). Der `localStorage` der Webview dient primär als lokaler UI-Cache für temporär oder standardmäßig gepinnte Test-Presets.

### Feature 8: Acoustic Shock Shield (Eingebauter Gehörschutz)
- Verhindert laute Feedback-Schleifen oder versehentliche Max-Volume-Sprünge im Kontrollraum.
- Blockiert Sprünge von mehr als +3 dB oder Spuren über +6 dB automatisch und warnt den Toningenieur im HUD.

---

## 5. REST- & WebSocket-Schnittstellen (Routing-Tabelle)

Für externe Web-Clients, alternative Frontends und Desktop-Komponenten stellt der Desktop-Companion (Port `48123`) sowie der MCP-Server (Port `48124`) standardisierte Endpunkte bereit:

### 5.1 Desktop Companion Routing (Port 48123)

| Endpunkt | Methode | Payload / Parameter | Antwort | Beschreibung |
| :--- | :---: | :--- | :--- | :--- |
| **`/api/project`** | `GET` | – | `{ daw: string, project: string, sampleRate: number, isPlaying: boolean }` | Liefert die aktuell erkannte DAW, den Projektnamen und den Wiedergabestatus. |
| **`/api/tracks`** | `GET` | – | `Array<{ id: string, name: string, volumeDb: number, pan: number, inserts: string[] }>` | Liste aller aktiven Kanalzüge samt Fader, Pan und belegten Plugins. |
| **`/api/proposals`** | `POST` | `MixActionProposal` (JSON) | `{ success: boolean, proposalId: string }` | Liefert eine neu generierte ActionCard in die HUD-Queue ein. |
| **`/api/execute-action`** | `POST` | `{ proposalId: string, isAudition: boolean, isRestore?: boolean }` | `{ success: boolean, executedDeltas: number }` | Führt `[Anwenden]`, `[A/B Listen]` oder die Wiederherstellung aus. |
| **`/meter`** | `WS` | WebSocket Connect | 30 fps JSON-Stream (`AudioTelemetryFrame`) | Kontinuierlicher Telemetrie-Stream direkt aus dem JUCE-Master-Plugin. |

### 5.2 MCP AI-Gateway Routing (Port 48124)

| Endpunkt | Methode | Payload / Parameter | Antwort | Beschreibung |
| :--- | :---: | :--- | :--- | :--- |
| **`/health`** | `GET` | – | `{ status: "ok", version: "2026.1", pluginsCount: number }` | Health-Check und Status des lokalen AI-Gateways. |
| **`/sse`** | `GET` | EventSource Connect | Server-Sent Events (MCP Protocol 2026) | Streaming-Schnittstelle für KI-Agenten (Claude, Gemini, Cursor). |
| **`/api/ax-bridge`** | `POST` | `{ command: string, args: Record<string, any> }` | `{ success: boolean, data: any }` | Direkter Tunnel zur nativen macOS Swift-Bridge. |

---

## 6. Datenmodelle & TypeScript-Definitionen

### `MixActionProposal` (Die ActionCard)
```typescript
export interface MixActionProposal {
  id: string;                     // Eindeutige ID (z. B. "prop_1790810661241_ssvkj")
  timestamp: number;              // UNIX-Timestamp
  category: ActionCategory;       // 'gain_staging' | 'eq_tonal_balance' | 'dynamic_control' | 'stereo_width' | 'masking_reduction'
  title: string;                  // Aussagekräftige Überschrift
  rationale: string;              // Psychoakustische Erklärung mit Messbezug
  confidenceScore: number;        // Wahrscheinlichkeit des Erfolgs (0.0 bis 1.0)
  deltas: ParameterDelta[];       // Liste aller auszuführenden Änderungen
  status: 'pending' | 'applied' | 'rejected' | 'auditioning';
  isPinned?: boolean;             // Dauerhafte Speicherung via localStorage
}
```

### `ParameterDelta` (Die Stellschraube)
```typescript
export interface ParameterDelta {
  trackId: string;                // DAW-Spur-Identifier (z. B. "track_1")
  trackName: string;              // Spur-Name (z. B. "Motown Revisited Kit" oder "MoReKi")
  slotIndex?: number;             // Insert-Slot (1-basiert in Logic Pro, 1 bis 15)
  pluginName?: string;            // Plugin-Name (z. B. "Channel EQ", "Compressor", "Limiter")
  parameterName: string;          // Reglername (z. B. "fader_db", "pan", "low_cut_frequency", "peak_2_gain")
  currentValue: number;           // Ursprungswert vor der Änderung
  proposedValue: number;          // Vorgeschlagener Zielwert
  unit: string;                   // Einheit ("dB", "Hz", "%", "ms")
}
```

### `AudioTelemetryFrame` (Der Audio-Feed)
```typescript
export interface AudioTelemetryFrame {
  timestamp: number;
  sampleRate: number;
  loudness: {
    momentaryLufs: number;        // Momentane Lautheit (400 ms)
    shortTermLufs: number;        // Kurzzeit-Lautheit (3 s)
    integratedLufs: number;       // EBU R128 Gesamt-Lautheit (Target: -14.0 LUFS)
    loudnessRangeLu: number;      // LRA (Dynamikumfang in LU)
  };
  dynamics: {
    truePeakDbtp: number;         // Inter-Sample Peak in dBTP
    crestFactorDb: number;        // Dynamikverhältnis Peak/RMS
    correlation: number;          // Phasenkorrelation (-1.0 bis +1.0)
  };
  spectrum: number[];             // 32 logarithmische FFT-Energiebänder (dBFS)
}
```

---

## 7. Sprint 3 Architektur-Vorausschau: Genre- & Crossover-Targets

Im anstehenden **Sprint 3** wird der Oszillation Mixing Buddy um **musikalische Kontext-Sensitivität** und **DAW-Projekt-Persistenz** erweitert. Web-Entwickler sollten folgende Strukturen bei UI-Entwürfen berücksichtigen:

### 7.1 Die Ziel-Selektoren im HUD
Im Kopfbereich des Musiker-HUDs werden zwei Kontext-Dropdowns integriert:
1. **Signal-Typ (`targetScope`):**
   - `mix_bus` (Standard Master-Out)
   - `lead_vocal` (Fokus auf De-Essing, Präsenz 3–5 kHz)
   - `drum_bus` (Fokus auf Transienten, Crest-Factor 8–10 dB)
   - `sub_bass` (Fokus auf Mono-Kompatibilität $<80$ Hz)
   - `keys_synths` & `acoustic`
2. **Genre-Profil (`genreProfile`):**
   - `hiphop_trap`: Hohe Sub-Bass-Toleranz ($+3\text{ bis }+4$ dB bei 35–65 Hz), Ziel: $-9\text{ bis }-7$ LUFS.
   - `pop_radio`: Ausgewogenes Low-End, hoher Air-Glanz ($>10$ kHz), Ziel: $-14\text{ bis }-10$ LUFS.
   - `rock_metal`: Dichte Mitten (800–3.500 Hz), gezähmte Sub-Bässe ($<40$ Hz Low Cut).
   - `edm_club`: Maximale Lautheit, Ziel: $-7\text{ bis }-5$ LUFS.
   - `acoustic_jazz`: Natürliche Dynamik, Crest Factor $\ge 14$ dB, kein Brickwall-Limiting.
   - `custom_crossover`: Individuelle Kombination mit Freitext-Notizen (`customNotes`).

### 7.2 Sprint 3 Datenmodell (`TargetProfile`)
```typescript
export interface TargetProfile {
  targetScope: 'mix_bus' | 'lead_vocal' | 'drum_bus' | 'sub_bass' | 'keys_synths' | 'acoustic';
  genreProfile: 'auto_detect' | 'hiphop_trap' | 'pop_radio' | 'rock_metal' | 'edm_club' | 'acoustic_jazz' | 'custom_crossover';
  customNotes?: string;             // z. B. "Trap Sub-Bass mit 90er Grunge Mitten"
  targetLufs: number;               // z. B. -14.0 LUFS
  targetCrestFactorRange: [number, number]; // [min, max] in dB
  spectralEnvelopeTarget: {         // 5-Zonen Energiekorridor
    subBassOffsetDb: number;        // 20 - 60 Hz
    bassOffsetDb: number;           // 60 - 250 Hz
    lowMidOffsetDb: number;         // 250 - 1000 Hz
    highMidOffsetDb: number;        // 1 - 5 kHz
    airOffsetDb: number;            // 5 - 20 kHz
  };
}
```

### 7.3 Dual-Persistenz-Prinzip
- **Session-Targets (Projektgebunden):** Werden im JUCE-Plugin via `getStateInformation()` direkt in der Songdatei (`.logicx` / `.cpr`) gespeichert. Beim Wiederöffnen des Songs stehen alle Zielkurven sofort wieder bereit.
- **Lokale Presets & Pin-Cards:** Verbleiben im `localStorage` des Browsers/Webviews als Arbeits-Pinwand des Musikers.

---

## 8. Leitfaden für das Web-Frontend & Design-System

Für die Darstellung der Features im Web (Landing Page, Musiker-Dashboard oder SaaS-Portal) gelten folgende Richtlinien:

1. **Ästhetik: Dark Studio Aesthetic**
   - Hintergrund: Tiefes Studio-Dunkel (`#0b0c10`, `#121418`, `#1a1c23`).
   - Akzentfarben mit klarer Signalwirkung:
     - **Cyan / Electric Blue (`#3b82f6` / `#06b6d4`):** Telemetrie, FFT, DAW-Verbindung.
     - **Amber / Gold (`#f59e0b`):** A/B Audition, angepinnte Karten (📌), Warnhinweise.
     - **Emerald Green (`#10b981`):** Zielwerte in Diffs, erfolgreiches Anwenden, sichere Pegel.
     - **Crimson Red (`#ef4444`):** Verwerfen-Buttons, Clipping-Alarm, Shield-Blockade.
2. **Animationen & Micro-Interactions:**
   - FFT-Balken mit weicher Interpolation (Spring-Physik oder `requestAnimationFrame`).
   - Pulse-Effekt auf dem Status-Badge während des 6-Sekunden A/B-Listenings.
   - Pinned-Badge mit dezentem Leuchten (`box-shadow: 0 0 12px rgba(245, 158, 11, 0.25)`).
3. **Wording für Musiker:**
   - Fachbegriffe wie `AXUIElement`, `IPC`, `Child Process` oder `Regex` gehören **nicht** ins UI.
   - Stattdessen verständliche Tonstudio-Terminologie: *„Kanalzug“*, *„Insert-Slot“*, *„Band 2 Gain“*, *„Mono-Kompatibilität“*, *„Lautheitsfenster (-14 LUFS)“*, *„Mixer öffnen (Taste X)“*.

---

## 9. Aktueller Status Quo & Release-Matrix

| Komponente | Plattform | Status | Besonderheiten |
| :--- | :--- | :---: | :--- |
| **MixingBuddyMeter** (AU/VST3) | macOS (ARM64/x86) | ✅ Fertig | ITU-R BS.1770-4, 32-Band FFT, Port 48123 |
| **Logic AX Bridge** (Swift) | macOS | ✅ Fertig | Sub-Millisekunden, Fader/Pan/EQ/Inserts gesteuert |
| **Acoustic Shock Shield** | Rust (Tauri) | ✅ Fertig | Asymmetrischer Schutz, max +3 dB/Schritt |
| **Multi-Parameter A/B-Loop** | Desktop HUD | ✅ Fertig | Durchläuft alle Deltas synchron mit Auto-Restore |
| **ActionCard Pinning (📌)** | Desktop HUD | ✅ Fertig | Persistenz in `localStorage`, gefilterte Queue |
| **Logic Insert Auto-Opener** | Rust / Swift | ✅ Fertig | Öffnet geschlossene Plugins slot-genau |
| **MCP Server (7 Tools)** | Node.js / TS | ✅ Fertig | Volle Integration in IDE, Stdio & SSE (Port 48124) |
| **Genre- & Target-Profiles** | TS / JUCE / Rust | 🟡 Geplant (Sprint 3) | 5-Zonen FFT, Crossover-Notizen, DAW-Persistenz |
| **Steinberg Nuendo Bridge** | macOS / Windows | 🟡 In Arbeit | MCU-Fallback aktiv, native VST-Bridge in Phase 2 |

---

*Dieses Dokument wird bei jeder architektonischen Erweiterung kontinuierlich fortgeschrieben.*
