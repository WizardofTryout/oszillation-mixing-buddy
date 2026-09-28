# Mixing Buddy: Finaler Implementierungsplan & Änderungsübersicht

Dieses Dokument fasst den **final abgestimmten Gesamtplan**, sämtliche **Architektur- und Sicherheits-Ergänzungen aus Dokument (3)** sowie die **verbindlichen Arbeits- und Testregeln** übersichtlich zusammen.

---

## 1. Was ist das Ziel des Projekts?

Ein autonomer, modularer AI-Mixing-Assistent (**Steinberg Mixing Buddy**) für **Steinberg Nuendo / Cubase** sowie **Apple Logic Pro**, der komplett **nativ auf macOS** (Xcode, Apple Clang, CMake, Rust/Tauri v2, TypeScript/pnpm) entwickelt wird.

### Die 4 Subsysteme im Überblick:
```
+-----------------------------------------------------------------------------------------+
|                                    DAW HOST LAYER                                       |
|               [Steinberg Nuendo / Cubase]                [Apple Logic Pro]              |
|                   (VST3 / MIDI Remote)                  (AU / Accessibility)            |
+----------------------------+-------------------------------------+----------------------+
                             | Audio Bus                           | Audio Bus
                             v                                     v
+-----------------------------------------------------------------------------------------+
| SUBSYSTEM 1: "The Ear" (Audio Metrology Plugin in C++20 / JUCE 7/8)                     |
| - Zero-Latency Passthrough auf Master- / Stereo-Out-Bus                                 |
| - EBU R128 / ITU-R BS.1770-4 LUFS (Momentary, Short-Term, Integrated) + 4x True Peak    |
| - 1024-Point FFT Spektrumanalyse (32 logarithmische Bänder, 30 fps)                     |
| - Stereokorrelation (-1.0 bis +1.0) & Dynamic Crest Factor                               |
| - Formate: VST3 (.vst3) & Audio Unit (.component), validiert mit Apple 'auval'          |
| - Lokaler Telemetrie-Stream: WebSocket ws://127.0.0.1:48123/meter                       |
+-----------------------------------------------------------------------------------------+
                                             |
                                             v WebSocket
+-----------------------------------------------------------------------------------------+
| SUBSYSTEM 3: "The Body" (Desktop Companion in Tauri v2 / Rust + React HUD)              |
| - Rust Core: IPC Server (Port 48123), DAW-Erkennung (Nuendo/Logic)                      |
| - Acoustic Safety Shield: Hard-Clamp [-96 dB, +6 dB], Einzelschritt-Limit max +3 dB     |
| - Lizenz-Gatekeeper: Online-Check (https://buddy.oszillation-studio.de/api/v1),         |
|   macOS Keychain JWT-Speicherung, 7-Tage-Offline-Grace-Period                           |
| - React HUD: 60 fps RTA-Spektrum (Canvas/WebGL), LUFS-Balken, Human-in-the-Loop Diff    |
|   Cards mit [Apply], [A/B Listen], [Reject]                                             |
+------------------------------------+----------------------------------------------------+
                                     |
    +--------------------------------+--------------------------------+
    |                                                                 |
    v                                                                 v
+---------------------------------------+   +---------------------------------------------+
| SUBSYSTEM 2: "The Hands" (DAWDriver)  |   | SUBSYSTEM 4: "The Brain" & MCP Server       |
| Polymorphes TypeScript-Interface      |   | - Pluggable AI: Managed Cloud Proxy,        |
| - NuendoDriver: Steinberg MIDI Remote |   |   BYOK (Claude, Gemini, GPT-4o), Ollama     |
|   JS Driver + virtueller MIDI-Loopback|   | - Standalone Model Context Protocol Server  |
|   (14-bit Fader, Quick Controls)      |   |   (stdio + SSE auf Port 48124)              |
| - LogicProDriver: CoreMIDI MCU-Fader  |   |   für externe Agenten (Claude Desktop,      |
|   + native macOS Accessibility        |   |   Gemini CLI, Cursor)                       |
|   (AXUIElement via macos_ax_client.ts)|   | - 5 MCP Tools (Telemetrie, Tracks,          |
|   für Menüs & Plugin-Inspektion       |   |   Proposals, Execution, Loop-Audition)      |
+---------------------------------------+   +---------------------------------------------+
```

---

## 2. Zusammenfassung aller Änderungen & Ergänzungen

### A. Aus deinen Nutzer-Vorgaben (Host-Schutz & Native macOS):
1. **Kein Docker mehr:** Vollständig gestrichen. Alle Builds laufen nativ auf deinem Mac (direkter Zugriff auf Xcode, Apple Clang, Audio Unit Bundles, CoreMIDI und macOS Accessibility).
2. **Strikte Installations-Schranke:** Ich führe **weder im Hintergrund noch eigenständig** `brew install`, `sudo` oder globale Paketinstallationen aus. Fehlt ein Tool, nenne ich dir den exakten Befehl zur manuellen Ausführung.
3. **Interaktive Stop-and-Test Zyklen:** Nach Fertigstellung jedes Moduls (Sprint 0, 1, 2, ...) stoppe ich, gebe dir eine exakte Testanweisung und warte auf deine Freigabe.
4. **Striktes Dateigrößen-Limit:** Keine Quellcodedatei darf jemals 3.000 Zeilen überschreiten (Zielgröße: 200–600 LOC).

### B. Neu hinzugekommen aus Dokument (3) (`nuendo_logic_pro_ai_mixing_agent_architecture (3).md`):
1. **`.npmrc`-Supply-Chain-Sandbox (`ignore-scripts=true`):**
   - In der Monorepo-Root wird eine `.npmrc` angelegt, die jegliche `preinstall`- und `postinstall`-Skripte bei `pnpm install` blockiert. Damit kann kein Drittanbieter-Paket unbemerkt Shell-Befehle auf deinem System ausführen.
2. **Kuratierte Dependency-Whitelist & Lockfile-Audit:**
   - Ausschließlich geprüfte Standardpakete (React, Vite, Tailwind, Lucide, TypeScript). Keine obskuren Micro-Packages.
   - `pnpm-lock.yaml` mit SHA-512 Hashes wird fest versioniert.
   - CI-Workflow `.github/workflows/security-audit.yml` führt automatisch `pnpm audit --audit-level=high` durch.
3. **Detaillierte Kapselung für Logic Pro (`macos_ax_client.ts`):**
   - Das macOS Accessibility Interface für Logic Pro wird als dediziertes Modul `packages/daw-adapters/src/logic/macos_ax_client.ts` isoliert.
4. **Natives Apple Audio Unit Testing (`auval`):**
   - In Sprint 1 wird vor dem manuellen DAW-Test das native macOS-Tool `auval -v aufx ...` ausgeführt, um sicherzustellen, dass die AU-Komponente von macOS und Logic Pro vollständig als valide eingestuft wird.

---

## 3. Geplante Monorepo-Dateistruktur

```
Steinberg-Mixing-Buddy/
├── .github/
│   └── workflows/
│       ├── lint-file-size.yml     # Prüft LOC <= 3000 pro Datei
│       ├── security-audit.yml     # Führt pnpm audit --audit-level=high aus
│       ├── test-plugin.yml        # Baut JUCE VST3 + AU auf macOS
│       └── build-desktop.yml      # Baut Tauri App-Bundle
├── .npmrc                         # ignore-scripts=true (Supply-Chain Schutz)
├── packages/
│   ├── shared-types/              # Telemetrie-, Action- und Lizenz-Schemas
│   ├── audio-math/                # LUFS-, FFT- und Filter-Mathematik
│   ├── daw-adapters/              # Polymorphe Treiber (Nuendo + Logic)
│   │   ├── src/
│   │   │   ├── types.ts           # Central DAWDriver Interface
│   │   │   ├── nuendo/            # MIDI Remote Bridge (14-bit CC / SysEx)
│   │   │   └── logic/             # MCU Bridge + macos_ax_client.ts (AXUIElement)
│   ├── mcp-server/                # Standalone MCP Server (stdio + SSE)
│   └── ai-engine/                 # Pluggable Reasoning (Managed, BYOK, Ollama)
├── plugins/
│   └── meter-audio/               # JUCE 7/8 C++20 Dual-Target Plugin (VST3 + AU)
│       ├── CMakeLists.txt
│       └── Source/
│           ├── PluginProcessor.h / .cpp  (< 400 LOC, Audio Lifecycle)
│           ├── LoudnessMeter.h / .cpp    (< 300 LOC, EBU R128 LUFS & True Peak)
│           ├── SpectralAnalyzer.h / .cpp (< 350 LOC, 1024-FFT, Correlation)
│           └── TelemetryClient.h / .cpp  (< 250 LOC, WebSocket IPC Stream)
├── apps/
│   └── desktop/                   # Tauri v2 Desktop Companion (Rust + React HUD)
│       ├── src-tauri/
│       └── src/
├── bridge-scripts/
│   └── nuendo/
│       └── ai_agent_driver.js     # Steinberg MIDI Remote JavaScript Skript
├── pnpm-workspace.yaml
├── package.json
├── pnpm-lock.yaml
├── Cargo.toml
└── README.md
```

---

## 4. Die 6 Sprints mit interaktiven Test-Checkpoints

### Sprint 0: Scaffolding, Toolchains & Security Guardrails
- **Aufgaben:**
  1. Root `package.json`, `pnpm-workspace.yaml` und `.npmrc` (`ignore-scripts=true`) anlegen.
  2. `packages/shared-types` mit TypeScript-Config aufsetzen.
  3. `scripts/lint-loc.sh` und `.github/workflows/lint-file-size.yml` einrichten ($\le 3.000$ LOC Check).
  4. `.github/workflows/security-audit.yml` einrichten.
- **🛑 Checkpoint 0 (Stopp & Freigabe):**
  - *Prüfung:* `pnpm install` läuft fehlerfrei ohne Lifecycle-Skripte durch; `scripts/lint-loc.sh` validiert alle Dateien.

---

### Sprint 1: Duales VST3/AU Metering Plugin ("The Ear")
- **Aufgaben:**
  1. `plugins/meter-audio/CMakeLists.txt` mit JUCE 7/8 für VST3 und AU konfigurieren.
  2. `SpectralAnalyzer.cpp` (1024-FFT, Blackman-Harris, 32 Bänder, Korrelation).
  3. `LoudnessMeter.cpp` (EBU R128 Momentary/Short/Integrated LUFS + 4x True Peak).
  4. `TelemetryClient.cpp` (WebSocket-Client sendet JSON an `ws://127.0.0.1:48123/meter` mit 20 Hz).
  5. Native Kompilierung via CMake + Xcode/Clang.
  6. AU-Validierung via `auval -v aufx ...`.
- **🛑 Checkpoint 1 (Stopp & Freigabe):**
  - *Testanweisung für dich:*
    1. Lade `MixingBuddyMeter.vst3` in Nuendo auf den Master-Bus bzw. `MixingBuddyMeter.component` in Logic Pro auf Stereo Out.
    2. Starte die Audiowiedergabe.
    3. Führe den mitgelieferten Empfangstest aus und prüfe, ob Live-LUFS und FFT-Werte auf Port 48123 ankommen.

---

### Sprint 2: Polymorphe DAW-Steuerung ("The Hands")
- **Aufgaben:**
  1. Kanonisches `DAWDriver`-Interface in `packages/daw-adapters/src/types.ts`.
  2. Steinberg MIDI Remote Script `bridge-scripts/nuendo/ai_agent_driver.js`.
  3. `NuendoDriver.ts` mit CoreMIDI-Anbindung (14-Bit Fader, Pan, Quick Controls).
  4. `LogicProDriver.ts` mit MCU-Protokoll & `macos_ax_client.ts` (`AXUIElement`).
- **🛑 Checkpoint 2 (Stopp & Freigabe):**
  - *Testanweisung für dich:*
    1. Kopiere das Skript in Nuendos MIDI Remote Ordner bzw. starte den Logic-Bridge-Test.
    2. Führe das Testskript aus, das Kanal 1 um $-3.5\text{ dB}$ absenkt.
    3. Prüfe, ob sich der Regler in Nuendo/Logic Pro physisch bewegt.

---

### Sprint 3: Desktop Companion & Lizenz-Aktivierung ("The Body")
- **Aufgaben:**
  1. Tauri v2 App in `apps/desktop` initialisieren.
  2. `safety_guard.rs` (Hard-Clamp $[-96\text{ dB}, +6\text{ dB}]$, max. $+3\text{ dB}$ Einzelschritt-Sprung).
  3. `licensing.rs` (Online-Verifikation `buddy.oszillation-studio.de`, Keychain-Storage, 7-Tage Grace Period).
  4. `ipc_server.rs` (WebSocket-Server auf Port 48123 für Plugin-Telemetrie).
  5. React HUD (60 fps Canvas RTA-Spektrum, LUFS-Bars, Action Cards mit [Apply]/[Reject]).
- **🛑 Checkpoint 3 (Stopp & Freigabe):**
  - *Testanweisung für dich:*
    1. Starte `pnpm dev` in `apps/desktop`.
    2. Sieh dir das RTA-Spektrum live während des DAW-Playbacks an.
    3. Triggere einen Test-Lautstärkesprung und verifiziere, dass der Safety Shield den Sprung abfängt.

---

### Sprint 4: Pluggable AI Engine & Model Context Protocol (MCP) Server
- **Aufgaben:**
  1. `packages/ai-engine/` mit Providern: Anthropic, Google Gemini, OpenAI, Ollama, Managed Cloud.
  2. `packages/mcp-server/` mit Dual-Transport (`stdio` und SSE auf Port 48124).
  3. 5 MCP-Tools registrieren (`get_mix_telemetry`, `list_tracks`, `propose_mix_adjustment`, `execute_mix_adjustment`, `audition_region`).
  4. `claude_desktop_config.json` Snippet-Export im HUD.
- **🛑 Checkpoint 4 (Stopp & Freigabe):**
  - *Testanweisung für dich:*
    1. Konfiguriere Claude Desktop mit dem lokalen MCP-Server.
    2. Frage Claude: *"Prüfe die Lautheit und senke die Snare um 1.5 dB"*.
    3. Prüfe, ob der Vorschlag im Companion HUD erscheint und per Klick in der DAW angewendet wird.

---

### Sprint 5: End-to-End DAW Validierung & Abschluss-Audit
- **Aufgaben:**
  1. Praxis-Mix in Nuendo (Frequenz-Maskierung Kick/Bass & EQ-Korrektur).
  2. Praxis-Mix in Logic Pro (Vocal-Kompression & Pegelanpassung).
  3. Gesamter Code-Audit: Bestätigung, dass alle Dateien $\le 3.000$ Zeilen einhalten.
- **🛑 Finaler Sign-Off.**

---

## 5. Vorbereitung: Welche Tools musst du lokal installieren?

Dein Mac hat bereits:
- **Xcode 27.0** (`/usr/bin/xcodebuild`)
- **Apple Clang** (`/usr/bin/clang`)
- **Git** (`/usr/bin/git`)
- **AU Validation Tool** (`/usr/bin/auval`)

### Befehle für dein Terminal:

#### Schritt 1: Homebrew (falls noch nicht auf deinem Mac vorhanden)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### Schritt 2: Für Sprint 0 & Sprint 1 zwingend benötigt:
```bash
brew install cmake ninja node pnpm
```

#### Schritt 3: Für Sprint 3 (Tauri v2 Desktop Companion – kann auch später installiert werden):
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

Sobald du Schritt 2 ausgeführt hast, gib mir einfach Bescheid – dann beginnen wir mit **Sprint 0**!
