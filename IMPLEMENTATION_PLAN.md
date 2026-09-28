# Nuendo & Logic Pro AI Mixing Agent: Modular Architecture & Implementation Plan

## Goal Description

The objective is to architect and implement an autonomous, modular, AI-powered mixing assistant ("Mixing Buddy") supporting both **Steinberg Nuendo (and Cubase)** and **Apple Logic Pro**, built **100% natively on macOS** using **Xcode, Clang, CMake, Rust, and Node/pnpm**.

The system provides:
1. **Sensory Metrology ("The Ear"):** Real-time audio analysis (EBU R128 LUFS, True Peak, 1024-bin FFT spectrum, stereo correlation) via a zero-latency JUCE C++20 plugin built for **VST3** and **AU (.component)** streaming over WebSocket IPC (`ws://127.0.0.1:48123/meter`). Validated natively using Apple's `auval` utility.
2. **Polymorphic Control ("The Hands"):** A unified `DAWDriver` interface in TypeScript with native macOS adapters:
   - **Nuendo / Cubase:** Bidirectional Steinberg MIDI Remote JavaScript driver + native CoreMIDI loopback.
   - **Logic Pro:** macOS Accessibility (`AXUIElement` via `macos_ax_client.ts`) parameter inspection + native Mackie Control Universal (MCU) driver over CoreMIDI.
3. **Desktop Companion, Licensing & MCP Bridge ("The Body"):** A native Tauri v2 (Rust + React/TypeScript) engineering HUD with safety bounds, licensing verification against `https://buddy.oszillation-studio.de/api/v1`, and an embedded Model Context Protocol (MCP) server over SSE and stdio.
4. **Pluggable Reasoning Engine ("The Brain"):** Support for Managed Cloud, BYOK (Claude, Gemini, OpenAI), Local LLMs (Ollama, LM Studio), and direct delegation to external MCP clients (Claude Desktop, Gemini CLI, Cursor).
5. **Hardened Supply-Chain & Host-Protection Directives:**
   - **No Docker:** All builds run natively on macOS for direct access to Xcode, Audio Unit bundles, CoreMIDI, and Accessibility APIs.
   - **Zero Unauthorized Installations:** The agent will **never** execute `brew install`, `sudo`, or global package installations. When tools are missing, the exact command is presented to the user for manual inspection and execution.
   - **Hermetic Package Supply-Chain Sandbox:** Root `.npmrc` enforcing `ignore-scripts=true` to preempt arbitrary code execution during `pnpm install`, cryptographic lockfile auditing, and curated dependency whitelists.
   - **Interactive Component Gateways:** After each component/sprint, work stops and a clear manual verification instruction is provided. Progress to the next step only occurs upon explicit user approval.
   - **Strict File-Size Barrier:** Every file is bounded to $\le 3,000$ LOC (target: 200–600 LOC).

```
                                +-----------------------------------------------+
                                |               DAW HOST LAYER                  |
                                |                                               |
                                |   [Steinberg Nuendo]       [Apple Logic Pro]  |
                                |    (VST3 / MIDI Remote)     (AU / Accessibility)
                                +-------+--------------------------+------------+
                                        |                          |
               +------------------------+                          +------------------------+
               | Audio Metrology Bus                               | Audio Metrology Bus
               v                                                   v
+-------------------------------+                         +-------------------------------+
|  JUCE Meter Plugin (VST3)     |                         |   JUCE Meter Plugin (AU)      |
|  "The Ear" (C++20 Engine)     |                         |   "The Ear" (C++20 Engine)    |
+---------------+---------------+                         +---------------+---------------+
                \                                                         /
                 \________ Local IPC (WebSocket ws://127.0.0.1:48123) ___/
                                          |
                                          v
+-----------------------------------------------------------------------------------------+
|                              LOCAL COMPANION ENGINE ("The Body")                        |
|                                     (Tauri v2 / Rust)                                   |
|                                                                                         |
|   +---------------------------------------------------------------------------------+   |
|   |                       License & Entitlement Gatekeeper                          |   |
|   |   (Online verification against https://buddy.oszillation-studio.de/api/v1)     |   |
|   +---------------------------------------------------------------------------------+   |
|                                         |                                               |
|   +---------------------------------------------------------------------------------+   |
|   |                       Abstract DAW Control Bus (`DAWDriver`)                    |   |
|   |   +---------------------------+             +-------------------------------+   |   |
|   |   | NuendoDriver (MIDI/SysEx) |             | LogicProDriver (AXUIElement)  |   |   |   |
|   |   +---------------------------+             +-------------------------------+   |   |
|   +---------------------------------------------------------------------------------+   |
|                                         |                                               |
|   +-------------------------------------+-------------------------------------------+   |
|   |           Embedded Model Context Protocol (MCP) Server (SSE / Stdio)            |   |
|   |      (Allows Claude Desktop, Gemini CLI, & External Agents to Drive DAW)        |   |
|   +-------------------------------------+-------------------------------------------+   |
|                                         |                                               |
|   +-------------------------------------+-------------------------------------------+   |
|   |                     React / Tailwind Engineering HUD                            |   |
|   |            (RTA Spectrum, LUFS Gauges, Action Proposal & Diff Review)           |   |
|   +-------------------------------------+-------------------------------------------+   |
+-----------------------------------------|-----------------------------------------------+
                                          |
                    +---------------------+---------------------+
                    |                                           |
                    v (Internal AI Clients)                     v (External MCP Clients)
+---------------------------------------+   +---------------------------------------------+
|        PLUGGABLE REASONING ENGINE     |   |          EXTERNAL AI AGENTS                 |
|  - Managed: buddy.oszillation-studio  |   |  - Anthropic Claude Desktop                 |
|  - BYOK: Claude, Gemini, OpenAI       |   |  - Google Gemini MCP Client                 |
|  - Local: Ollama / LM Studio          |   |  - Cursor / Autonomous Coding Agents        |
+---------------------------------------+   +---------------------------------------------+
```

---

## Toolchain Prerequisites & Installation Guidelines

### Current System Status
- **macOS:** Darwin / macOS 26.7
- **Xcode:** 27.0 (`/usr/bin/xcodebuild`)
- **Compiler:** Apple Clang (`/usr/bin/clang`)
- **Version Control:** Git (`/usr/bin/git`)
- **AU Validation:** `auval` (`/usr/bin/auval`)
- **Python:** Python 3.9.6 (`/usr/bin/python3`)

### Required Tools for Sprint 0 & Sprint 1

To build the monorepo packages, JUCE C++20 VST3/AU plugins, and TypeScript drivers natively, the following tools are needed:

1. **Homebrew (macOS Package Manager)** *(if not already installed)*:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
2. **CMake & Ninja** (for JUCE 7/8 VST3 & AU native compilation):
   ```bash
   brew install cmake ninja
   ```
3. **Node.js 20+ & pnpm** (for the TypeScript monorepo, MCP server, and React HUD):
   ```bash
   brew install node pnpm
   ```
4. **Rust & Cargo** (needed starting in Sprint 3 for the Tauri v2 desktop companion):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
   ```

> [!IMPORTANT]
> **Host-Schutz Regel:** Der Agent wird keine dieser Befehle selbst ausführen. Bitte installiere die benötigten Tools (mindestens `cmake`, `node` und `pnpm` für Sprint 0 & 1) und bestätige, sobald sie bereitstehen.

---

## User Review Required

> [!IMPORTANT]
> **macOS Accessibility Permissions for Logic Pro:**
> When the Logic Pro driver operates via `AXUIElement`, macOS requires Accessibility permission for the running process (Terminal / IDE / Companion App) under:
> `System Settings -> Privacy & Security -> Accessibility`.

> [!NOTE]
> **Native Plugin Deployment Paths:**
> - VST3: `~/Library/Audio/Plug-Ins/VST3/MixingBuddyMeter.vst3`
> - Audio Unit (AU): `~/Library/Audio/Plug-Ins/Components/MixingBuddyMeter.component`
> - Nuendo MIDI Remote Script: `~/Documents/Steinberg/Nuendo/MIDI Remote/Driver Scripts/Local/OszillationStudio/MixingBuddy/`

---

## Proposed Monorepo Structure

```
Steinberg-Mixing-Buddy/
├── .github/
│   └── workflows/
│       ├── lint-file-size.yml     # Enforces <= 3000 LOC across all PRs
│       ├── security-audit.yml     # Runs pnpm audit & dependency checks
│       ├── test-plugin.yml        # Compiles JUCE VST3 + AU on macOS & Win
│       └── build-desktop.yml      # Packages Tauri DMG (Mac) and MSI (Win)
├── .npmrc                         # ignore-scripts=true (Supply-chain protection)
├── packages/
│   ├── shared-types/              # Telemetry, Action, and Licensing schemas
│   ├── audio-math/                # LUFS calculation, FFT smoothing, crest factor
│   ├── daw-adapters/              # Polymorphic DAW control (Nuendo + Logic)
│   │   ├── src/
│   │   │   ├── types.ts           # Central DAWDriver Interface
│   │   │   ├── nuendo/            # Steinberg MIDI Remote Bridge
│   │   │   └── logic/             # Logic Pro Accessibility (macos_ax_client.ts) + MCU
│   ├── mcp-server/                # Model Context Protocol stdio + SSE server
│   └── ai-engine/                 # Pluggable reasoning engine (Managed, BYOK, Ollama)
├── plugins/
│   └── meter-audio/               # JUCE 7/8 C++20 Dual-Target Plugin (VST3 + AU)
│       ├── CMakeLists.txt
│       └── Source/
│           ├── PluginProcessor.h / .cpp
│           ├── LoudnessMeter.h / .cpp
│           ├── SpectralAnalyzer.h / .cpp
│           └── TelemetryClient.h / .cpp
├── apps/
│   └── desktop/                   # Tauri v2 Desktop Companion (Rust + React HUD)
│       ├── src-tauri/
│       └── src/
├── bridge-scripts/
│   └── nuendo/
│       └── ai_agent_driver.js     # Steinberg MIDI Remote JavaScript script
├── pnpm-workspace.yaml
├── package.json
├── pnpm-lock.yaml
├── Cargo.toml
└── README.md
```

---

## Multi-Sprint Implementation Roadmap & Interactive Test Checkpoints

### Sprint 0: Native Scaffolding, Toolchains & Security Guardrails
- **Objective:** Establish the modular monorepo, `.npmrc` sandbox, TypeScript workspace, root build configs, and automated LOC checker.
- **Tasks:**
  1. Initialize `pnpm-workspace.yaml` and root `package.json`.
  2. Create root `.npmrc` with `ignore-scripts=true` to block arbitrary lifecycle scripts (`preinstall`/`postinstall`).
  3. Setup `packages/shared-types` with TypeScript build configs.
  4. Create `scripts/lint-loc.sh` and `.github/workflows/lint-file-size.yml` enforcing $\le 3,000$ LOC per file.
  5. Create `.github/workflows/security-audit.yml` to automate `pnpm audit --audit-level=high`.
- **Interactive Checkpoint 0:**
  - *Agent action:* Runs local `pnpm install` (with script blocking active) and `pnpm lint:loc`.
  - *User verification:* Check that monorepo structure is created and linting/audit passes without errors.

---

### Sprint 1: Dual VST3/AU Audio Metrology Plugin ("The Ear")
- **Objective:** Build the C++20/JUCE audio metrology engine targeting both Steinberg Nuendo (VST3) and Apple Logic Pro (AU).
- **Tasks:**
  1. Scaffold `plugins/meter-audio/CMakeLists.txt` configured with JUCE 7/8 for native macOS VST3 and AU targets (`MixingBuddyMeter`).
  2. Implement `SpectralAnalyzer.cpp` (1024-point FFT, Blackman-Harris window, 32 frequency bands, stereo correlation).
  3. Implement `LoudnessMeter.cpp` (ITU-R BS.1770-4 / EBU R128 Momentary, Short-Term, Integrated LUFS + $4\times$ oversampled True Peak).
  4. Implement `TelemetryClient.cpp` (lightweight WebSocket client streaming JSON to `ws://127.0.0.1:48123/meter` at 20 Hz).
  5. Build native `.vst3` and `.component` bundles and install to `~/Library/Audio/Plug-Ins/`.
  6. Run native Apple AU validation check: `auval -v aufx ...` to confirm Logic Pro compatibility.
- **Interactive Checkpoint 1 (Stopp & Testanweisung):**
  - *Anweisung für den Benutzer:*
    1. Lade `MixingBuddyMeter.vst3` in Nuendo auf den Master-Bus bzw. `MixingBuddyMeter.component` in Logic Pro auf den Stereo Out.
    2. Starte die Wiedergabe eines Tracks.
    3. Führe im Terminal `nc -l 48123` oder das mitgelieferte Test-Skript aus, um zu überprüfen, ob JSON-Telemetrie (LUFS-Werte und FFT-Bins) empfangen wird.
  - *Warten auf Benutzer-Freigabe.*

---

### Sprint 2: Polymorphic DAW Control Abstraction ("The Hands")
- **Objective:** Implement the `DAWDriver` interface and individual driver adapters for Nuendo and Logic Pro.
- **Tasks:**
  1. Define canonical `DAWDriver` contract in `packages/daw-adapters/src/types.ts`.
  2. Build `bridge-scripts/nuendo/ai_agent_driver.js` for Steinberg MIDI Remote API.
  3. Implement `NuendoDriver.ts` (CoreMIDI communication, 14-bit fader controls, Quick Controls).
  4. Implement `LogicProDriver.ts` (MCU protocol fader/mute control + `packages/daw-adapters/src/logic/macos_ax_client.ts` for macOS `AXUIElement` channel/plugin inspection).
- **Interactive Checkpoint 2 (Stopp & Testanweisung):**
  - *Anweisung für den Benutzer:*
    1. Kopiere `ai_agent_driver.js` in das Nuendo MIDI Remote Skript-Verzeichnis.
    2. Führe das Adapter-Testskript aus: Verändere per Skript den Fader von Track 1 auf $-3.5\text{ dB}$.
    3. Überprüfe, ob sich der Fader in Nuendo / Logic Pro synchron bewegt.
  - *Warten auf Benutzer-Freigabe.*

---

### Sprint 3: Desktop Companion & License Activation ("The Body") [COMPLETED]
- **Objective:** Build the native Tauri v2 desktop application with safety bounds, licensing verification, and the engineering HUD.
- **Tasks:**
  1. Initialize Tauri v2 in `apps/desktop` with Vite, Tailwind CSS, Lucide Icons, and React.
  2. Implement `safety_guard.rs` (parameter clamping $[-96.0\text{ dB}, +6.0\text{ dB}]$, maximum single-step increase $+3.0\text{ dB}$, burst rate limiter).
  3. Implement `licensing.rs` (verify against `https://buddy.oszillation-studio.de/api/v1/license/verify`, macOS Keychain token storage, 7-day grace period).
  4. Implement `daw_detector.rs` (live detection of active Nuendo / Logic Pro processes).
  5. Implement `ipc_server.rs` (WebSocket server on port 48123 receiving JUCE telemetry and broadcasting to React HUD at 30 fps).
  6. Implement React HUD: 60 fps Canvas-based RTA Spectrum (`SpectrumRTA.tsx`), Dual-bar EBU R128 LUFS gauge (`LoudnessHUD.tsx`), Action Diff Review Card (`ActionCard.tsx`), and Provider Settings modal (`ProviderSettings.tsx`).
- **Interactive Checkpoint 3 (Stopp & Testanweisung):**
  - *Anweisung für den Benutzer:*
    1. Starte die Desktop-App mit `pnpm --filter desktop dev` (oder `cargo tauri dev`).
    2. Prüfe das RTA-Spektrum und die LUFS-Anzeige bei aktiver Wiedergabe in Nuendo oder Logic Pro.
    3. Teste den Safety Shield: Versuche manuell einen $+6\text{ dB}$ Sprung zu triggern und prüfe, ob der Guard den Sprung abfängt.
  - *Status:* Erfolgreich kompiliert, alle Rust-Tests bestanden, LOC $\le 3000$ verifiziert und auf GitHub gepusht.

---

### Sprint 4: Pluggable AI Engine & Model Context Protocol (MCP) Server [COMPLETED]
- **Objective:** Implement the pluggable AI engine (BYOK, Ollama) and standalone Model Context Protocol server.
- **Tasks:**
  1. Implement `packages/ai-engine/` supporting Anthropic (`AnthropicProvider.ts`), Gemini (`GeminiProvider.ts`), OpenAI (`OpenAIProvider.ts`), Ollama (`LocalOllamaProvider.ts`), and Managed Cloud/Rule-Based mock.
  2. Implement `packages/mcp-server/` with dual-transport: native `stdio` (for Claude Desktop / Cursor) and SSE transport on `http://127.0.0.1:48124/sse`.
  3. Register 5 core MCP tools with complete Zod schemas and typed handlers:
     - `mcp__get_mix_telemetry`
     - `mcp__list_tracks`
     - `mcp__propose_mix_adjustment`
     - `mcp__execute_mix_adjustment`
     - `mcp__audition_region`
  4. Render exportable `claude_desktop_config.json` 1-click copy snippet and live MCP status in the HUD.
  5. Verified with automated test script `scripts/test-mcp-client.ts` testing all 5 tools and safety shield parameter clamping.
- **Interactive Checkpoint 4 (Stopp & Testanweisung):**
  - *Anweisung für den Benutzer:*
    1. Binde den Mixing Buddy Server in Claude Desktop ein (`claude_desktop_config.json`).
    2. Frage Claude Desktop: *"Analysiere den Mix und schlage einen Fader-Pegel für den Bass vor"*.
    3. Prüfe, ob die Proposal Card im HUD erscheint und mit [Apply] in der DAW übernommen werden kann.
  - *Status:* Erfolgreich gebaut, getestet und auf GitHub gepusht.

---

### Sprint 5: End-to-End Validation Across Both DAWs & MCP Clients
- **Objective:** Complete closed-loop multi-DAW production testing.
- **Tasks:**
  1. Live session validation in Steinberg Nuendo (frequency masking & EQ via MIDI Remote).
  2. Live session validation in Apple Logic Pro (vocal compression & level adjustments via AU/Accessibility).
  3. External MCP Co-Producer validation (Claude Desktop balancing kick and bass via local MCP).
  4. Final LOC audit ($\le 3,000$ LOC across all files).
- **Final Sign-Off.**

---

## Security, Isolation & Safety Directives

1. **Parameter Clamping & Velocity Limiting:** The desktop bridge must reject any volume increase exceeding $+3\text{ dB}$ in a single step and hard-clamp master outputs to prevent acoustic shock.
2. **Untrusted Metadata Handling:** Track names, project notes, and plugin names read from Nuendo or Logic must be treated as untrusted strings and sanitized to neutralize indirect prompt injection attacks.
3. **Keychain Key Storage:** All user-provided API keys (Anthropic, Gemini, OpenAI) must be encrypted via the OS native credential store (macOS Keychain) and never stored in plaintext config files.
4. **No Raw Shell Access:** The AI reasoning model and MCP tools must possess zero access to OS shell execution tools (`bash`, `zsh`, etc.).
5. **Node & npm Supply-Chain Lockdown:**
   - A root `.npmrc` file with `ignore-scripts=true` must be committed to completely block execution of arbitrary shell scripts during `pnpm install`.
   - Only curated, industry-standard frontend dependencies (React, Vite, Tailwind CSS, Lucide, TypeScript) may be used. Obscure micro-packages and unvetted third-party utility libraries are prohibited.
   - `pnpm-lock.yaml` must be committed to lock cryptographic SHA-512 hashes for all transitive dependencies.
   - Automated dependency audit (`pnpm audit --audit-level=high`) must pass in CI on every push via `.github/workflows/security-audit.yml`.
