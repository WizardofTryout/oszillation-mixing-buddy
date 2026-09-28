# Nuendo & Logic Pro AI Mixing Agent: Modular Architecture & Autonomous Implementation Plan

## Executive Overview

This document specifies the complete system architecture, multi-DAW abstraction model, tool contracts, Model Context Protocol (MCP) server implementation, and a multi-sprint implementation blueprint for an AI-powered mixing assistant designed for **Steinberg Nuendo (and Cubase)** as well as **Apple Logic Pro**.

The system supports **Managed Cloud Inference**, **Bring-Your-Own-Key (BYOK)** (Anthropic, OpenAI, Google Gemini), **Local Offline Inference** (Ollama, LM Studio), and an **MCP Server Interface** allowing external autonomous agents (Claude Desktop, Gemini CLI, Cursor) to act as collaborative co-producers directly inside the sequencer.

To prevent context exhaustion, code drift, supply-chain vulnerabilities, and AI hallucination during autonomous agent implementation, the architecture enforces:
1. **Modular Adapter Pattern** for all DAW interactions.
2. **Strict File-Size Barrier (**$\le 3,000$ **lines of code per file)** across the entire monorepo.
3. **Hardened Node & Package Supply-Chain Sandbox:** Preemption of `preinstall`/`postinstall` arbitrary code execution via strict `.npmrc` configuration (`ignore-scripts=true`), curated dependency whitelists, and cryptographic lockfile audits.

## 1. Architectural Philosophy: Why Modularity, Size Limits & Security Directives Matter

### The Problem: Context Degradation, Agent Hallucination & Supply-Chain Drift

When autonomous AI developer agents (e.g., in VS Code, Cursor, or Antigravity) work on monoliths or unconstrained ecosystems:

1. **Attention Thinning:** The LLM misses subtle state interactions, edge cases, and type safety constraints.
2. **Silent Regressions:** Agents frequently drop existing helper methods or rewrite functioning code blocks when generating large files.
3. **Compounding Hallucinations:** As context size expands with repetitive boilerplate, the agent's probability of generating non-existent API bindings increases exponentially.
4. **Indiscriminate Dependency Ingestion:** Without explicit boundaries, autonomous agents frequently pull in obscure, unvetted npm micro-packages that introduce security vulnerabilities or execute rogue installation scripts.

### The Solution: Modular Boundary & Security Directives

* **Strict 3,000 LOC Upper Limit:** No single source file (`.ts`, `.rs`, `.cpp`, `.js`) may ever exceed 3,000 lines of code. Recommended target size is **200–600 LOC** per file.
* **Component Isolation:** Each subsystem communicates exclusively via strongly typed interfaces, IPC contracts, or event buses.
* **Decoupled Control Bridges:** Logic Pro specifics and Nuendo specifics reside in strictly segregated adapter packages that share a single common interface (`DAWDriver`).
* **Pluggable AI Backend:** The reasoning engine abstracts the model source (Cloud, Local, External MCP) behind a uniform protocol.
* **Hermetic Package Installation:** All package managers are configured to prohibit execution of arbitrary shell scripts during dependency resolution (`ignore-scripts=true`).

## 2. High-Level System Architecture

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
                 \________ Local IPC (WebSocket / Unix Socket) __________/
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
|   |                                                                                 |   |
|   |   +---------------------------+             +-------------------------------+   |   |
|   |   | NuendoDriver (MIDI/SysEx) |             | LogicProDriver (AXUIElement)  |   |   |   |
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

## 3. Subsystem Breakdown: Purpose, Scope & Limits

### Subsystem 1: The Unified Audio Metrology Plugin ("The Ear")

* **Directory:** `plugins/meter-audio/`
* **Technologies:** C++20, JUCE 7/8 (CMake build targeting both `VST3` and `AU`).
* **Purpose:** Acts as the sensory organ of the agent. Sits on the Master or Monitor bus to sample real-time session audio without altering sound.
* **Core Responsibilities:**
  * Zero-latency passthrough of audio buffers.
  * Real-time calculation of EBU R128 metrics (Momentary, Short-Term, Integrated LUFS).
  * True Peak ($4\times$ oversampled) calculation.
  * 1024-point FFT frequency bin snapshots (downsampled to 30 fps).
  * Stereo correlation coefficient ($-1.0$ to $+1.0$) and dynamic crest factor.
  * Streaming telemetry out via local WebSocket (`ws://127.0.0.1:48123/meter`).
* **Modularity Rule:** Divided into independent files:
  * `PluginProcessor.cpp` (< 400 LOC): Audio lifecycle only.
  * `LoudnessMeter.cpp` (< 300 LOC): EBU R128 calculation only.
  * `SpectralAnalyzer.cpp` (< 350 LOC): FFT bin extraction.
  * `TelemetryClient.cpp` (< 250 LOC): IPC socket serialization.

### Subsystem 2: The Multi-DAW Control Layer ("The Hands")

* **Directory:** `packages/daw-adapters/`
* **Purpose:** Provides a unified, polymorphic programming interface to manipulate tracks, mixers, faders, and 3rd-party insert plugins across different DAWs.

#### A. The Shared Contract (`packages/daw-adapters/src/types.ts`)

```typescript
export interface DAWDriver {
  readonly dawName: 'nuendo' | 'logic_pro';
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  
  // Mixer & Track Level
  getTrackList(): Promise<TrackDescriptor[]>;
  setTrackVolume(trackId: string, volumeDb: number): Promise<void>;
  setTrackPan(trackId: string, pan: number): Promise<void>;
  setTrackMute(trackId: string, muted: boolean): Promise<void>;
  
  // Insert Plugin & Parameter Control
  inspectPluginSlot(trackId: string, slotIndex: number): Promise<PluginMetadata | null>;
  setPluginParameter(
    trackId: string,
    slotIndex: number,
    paramName: string,
    targetValue: number,
    unit: string
  ): Promise<void>;
  
  // Transport & Auditioning
  playRegion(startBar: number, endBar: number): Promise<void>;
  stop(): Promise<void>;
}
```

#### B. The Nuendo Adapter (`packages/daw-adapters/src/nuendo/`)
* **Mechanism:** Steinberg MIDI Remote JavaScript Driver running inside Nuendo + virtual bidirectional MIDI loopback.
* **Why this exists:** Provides native, millisecond-precise, cross-platform (macOS & Windows) mixer and VST3 parameter adjustments without fragile screen-scraping.
* **Location of JS driver:** `<User>/Documents/Steinberg/Nuendo/MIDI Remote/Driver Scripts/Local/`.

#### C. The Logic Pro Adapter (`packages/daw-adapters/src/logic/`)
* **Mechanism:** Hybrid macOS Accessibility (`AXUIElement`) + virtual Mackie Control Universal (MCU) driver.
* **Why this exists:** Logic Pro lacks an open user scripting engine like Nuendo. The accessibility engine reads track lists, navigates menus, and modifies Audio Unit parameters via Logic's native control surfaces.

### Subsystem 3: Desktop Companion, MCP Server & Runner ("The Body")

* **Directory:** `apps/desktop/`
* **Technologies:** Tauri v2 (Rust Backend + React/TypeScript UI).
* **Purpose:** Bridges local IPC, hosts DAW drivers, runs the local MCP Server, provides license validation against `buddy.oszillation-studio.de`, and displays the engineer HUD.

#### A. License & Anti-Abuse Guard (`src-tauri/src/licensing/`)
* **Endpoint:** `https://buddy.oszillation-studio.de/api/v1/license/verify`
* **Functionality:**
  * Validates user account, active trial token, or perpetual license key.
  * Issues cryptographic JWT stored in OS Secure Storage (macOS Keychain / Windows Credential Manager).
  * Enforces grace-period offline checks (up to 7 days offline before requiring re-check).
  * Hard-locks DAW control drivers and the MCP server if license state is invalid or expired.

#### B. Embedded Model Context Protocol (MCP) Server (`packages/mcp-server/`)
* Exposes standardized JSON-RPC tools over `stdio` and Server-Sent Events (`http://127.0.0.1:48124/sse`).
* **Available MCP Tools for External Agents:**
  * `mcp__get_mix_telemetry`: Returns current LUFS, dynamic range, and top 5 spectral resonance peaks.
  * `mcp__list_tracks`: Returns names, fader levels, and active insert plugins across all channels.
  * `mcp__propose_mix_adjustment`: Submits a proposed parameter delta to the HUD confirmation queue.
  * `mcp__execute_mix_adjustment`: Directly executes adjustment (if user has enabled "Auto-Apply" mode).
  * `mcp__audition_region`: Triggers DAW transport loop from `start_bar` to `end_bar` for A/B evaluation.

#### C. Rust Native Core (`src-tauri/`)
* Auto-detects running DAWs (`Nuendo.exe`, `Nuendo.app`, `Logic Pro.app`).
* Enforces the **Safety Shield**: Bounds parameter ranges (clamps faders to $[-96.0\text{ dB}, +6.0\text{ dB}]$; prevents rapid volume spikes).
* Manages local virtual MIDI ports via native OS bindings (`coremidi` on macOS, `midir` loopback on Windows).

#### D. Frontend HUD (`src/`)
* RTA real-time spectrum display (WebGL/HTML5 Canvas).
* LUFS target meter with headroom warnings.
* Provider Selector: [Managed Cloud | BYOK (Claude/Gemini/OpenAI) | Local (Ollama) | External MCP].
* **Interactive Action Diff Card:** Displays precise changes before execution (e.g., `Snare Channel EQ -> Band 3: 3.1 kHz, -2.5 dB, Q: 2.0`) with **[Apply]**, **[A/B Listen]**, and **[Reject]** buttons.

### Subsystem 4: Pluggable AI Reasoning Engine ("The Brain")

* **Directory:** `packages/ai-engine/`
* **Supported Backends:**
  1. **Managed Service:** Authenticated proxy via `https://buddy.oszillation-studio.de/api/v1/agent`.
  2. **BYOK Anthropic / OpenAI / Google Gemini:** Direct HTTPS SDK requests using user-supplied API keys stored securely in local OS Keychain.
  3. **Local LLMs:** OpenAI-compatible API connector targeting `http://localhost:11434/v1` (Ollama) or `http://localhost:1234/v1` (LM Studio).
  4. **MCP Mode:** Internal AI is placed on standby; control is delegated to external agents (e.g., Claude Desktop, Gemini CLI).

## 4. Monorepo Structure & File-Length Guardrails

```
mix-agent-monorepo/
├── .github/
│   └── workflows/
│       ├── lint-file-size.yml     # Enforces < 3000 LOC limit across all PRs
│       ├── security-audit.yml     # Runs pnpm audit & dependency checks
│       ├── test-plugin.yml        # Compiles JUCE VST3 + AU on macOS & Win
│       └── build-desktop.yml      # Packages Tauri DMG (Mac) and MSI (Win)
├── .npmrc                         # ignore-scripts=true (Supply-chain protection)
├── apps/
│   └── desktop/                   # Tauri v2 Desktop App
│       ├── src-tauri/             # Rust Native Core (< 500 LOC per file)
│       │   ├── src/
│       │   │   ├── main.rs
│       │   │   ├── ipc_server.rs
│       │   │   ├── midi_bridge.rs
│       │   │   ├── safety_guard.rs
│       │   │   ├── licensing.rs   # Auth & License validation
│       │   │   └── daw_detector.rs
│       └── src/                   # React Frontend (< 350 LOC per component)
│           ├── components/
│           │   ├── SpectrumRTA.tsx
│           │   ├── LoudnessHUD.tsx
│           │   ├── ActionCard.tsx
│           │   ├── ProviderSettings.tsx
│           │   └── ChatConsole.tsx
│           └── hooks/
├── plugins/
│   └── meter-audio/               # JUCE Dual-Target Plugin (VST3 + AU)
│       ├── CMakeLists.txt
│       └── Source/
│           ├── PluginProcessor.cpp
│           ├── LoudnessMeter.cpp
│           ├── SpectralAnalyzer.cpp
│           └── TelemetryClient.cpp
├── packages/
│   ├── mcp-server/                # Model Context Protocol Bridge (< 400 LOC per file)
│   │   ├── src/
│   │   │   ├── server.ts          # MCP Server definition & SSE transport
│   │   │   ├── tools.ts           # Tool schemas (telemetry, fader, EQ)
│   │   │   └── handlers.ts        # Tool routing to DAWDriver
│   ├── daw-adapters/              # Decoupled DAW Control Engines
│   │   ├── src/
│   │   │   ├── types.ts           # Central DAWDriver Interface
│   │   │   ├── nuendo/            # Steinberg MIDI Remote Bridge
│   │   │   └── logic/             # Logic Pro Accessibility / MCU Bridge
│   ├── ai-engine/                 # Multi-Provider AI Orchestrator
│   │   ├── src/
│   │   │   ├── providers/         # Anthropic, Gemini, OpenAI, Ollama
│   │   │   └── prompts.ts         # Psychoacoustic mixing prompts
│   ├── audio-math/                # LUFS, FFT, and curve calculation utilities
│   └── shared-types/              # Common IPC, Action, and Licensing schemas
├── bridge-scripts/
│   └── nuendo/
│       └── ai_agent_driver.js     # Steinberg MIDI Remote Driver Script
├── Cargo.toml
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── README.md
```

### Automated File-Size Barrier (`.github/workflows/lint-file-size.yml`)

The repository includes an automatic CI check ensuring no developer or agent creates bloated files:

```yaml
name: Enforce File Size Constraints
on: [push, pull_request]
jobs:
  check-loc:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Verify LOC <= 3000 per source file
        run: |
          find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.rs" -o -name "*.cpp" -o -name "*.h" -o -name "*.js" \) \
          ! -path "*/node_modules/*" ! -path "*/target/*" ! -path "*/build/*" | while read file; do
            lines=$(wc -l < "$file")
            if [ "$lines" -gt 3000 ]; then
              echo "Error: $file has $lines lines (exceeds 3000 LOC limit)"
              exit 1
            fi
          done
```

## 5. Multi-Sprint Implementation Roadmap for Autonomous Agents

### Sprint 0: Scaffolding, Toolchains & Security Guardrails

* **Objective:** Establish the multi-package monorepo with CI file-size barriers, `.npmrc` script restrictions, and dual-platform build scripts.
* **Agent Directives:**
  1. Initialize `pnpm` monorepo workspace and Cargo workspace root.
  2. **Mandatory Security Rule:** Place `.npmrc` in root with `ignore-scripts=true` to block unverified lifecycle scripts (`preinstall`/`postinstall`).
  3. Implement GitHub Actions CI with file-length enforcement (`lint-file-size.yml`) and vulnerability audit (`security-audit.yml`).
  4. Validate macOS toolchains (`clang`, `cmake`, `ninja`, Xcode CLI tools).
  5. Commit: `chore(repo): scaffold modular monorepo, .npmrc sandbox, and CI guardrails`.

### Sprint 1: Dual VST3/AU Metering Plugin ("The Ear")

* **Objective:** Build the C++/JUCE audio metrology engine targeting both Steinberg Nuendo (VST3) and Apple Logic Pro (AU).
* **Agent Directives:**
  1. Scaffold `plugins/meter-audio/CMakeLists.txt` enabling `FORMATS VST3 AU`.
  2. Implement `SpectralAnalyzer.cpp` using `juce::dsp::FFT` (1024 bins, Blackman-Harris window).
  3. Implement `LoudnessMeter.cpp` calculating momentary (400ms), short-term (3s), and integrated EBU R128 LUFS.
  4. Stream data at 20 Hz via `TelemetryClient.cpp` to local WebSocket `127.0.0.1:48123`.
  5. Compile and test on macOS: Validate that both `.vst3` and `.component` (AU) bundles pass validation (`auval -v aufx ...`).
  6. Commit: `feat(plugin): implement dual VST3 and AU real-time telemetry engine`.

### Sprint 2: Polymorphic DAW Control Abstraction ("The Hands")

* **Objective:** Implement the `DAWDriver` interface and individual driver adapters for Nuendo and Logic Pro.
* **Agent Directives:**
  1. Create `packages/daw-adapters/src/types.ts` defining standard driver contracts.
  2. **Nuendo Driver (`packages/daw-adapters/src/nuendo/`):**
     * Build `bridge-scripts/nuendo/ai_agent_driver.js` using Steinberg MIDI Remote API.
     * Implement virtual MIDI port binding to pass volume, pan, and Focused Quick Controls.
  3. **Logic Pro Driver (`packages/daw-adapters/src/logic/`):**
     * Implement `macos_ax_client.ts` using macOS Accessibility bindings to query track lists and inspect plugin windows.
     * Implement standard MCU channel-strip mappings for fader and mute states.
  4. Commit: `feat(adapters): build polymorphic driver engines for Nuendo and Logic Pro`.

### Sprint 3: Desktop Companion & License Activation ("The Body")

* **Objective:** Build the Tauri v2 cross-platform desktop application with license verification.
* **Agent Directives:**
  1. Initialize Tauri v2 application in `apps/desktop`.
  2. Implement `licensing.rs` to verify license tokens against `https://buddy.oszillation-studio.de/api/v1/license/verify` and store signed JWTs in OS Keyring.
  3. In `src-tauri`, write `daw_detector.rs` to automatically identify whether Nuendo or Logic Pro is running.
  4. Build Rust WebSocket receiver for the JUCE meter telemetry stream.
  5. Build React engineering HUD:
     * Interactive Frequency Spectrum Display (Canvas/WebGL).
     * Dual LUFS Short-Term and Integrated bar meters with peak indicators.
     * Connection status badges: `Audio Engine: Connected`, `Active DAW: Nuendo / Logic Pro`, `License: Active`.
  6. Commit: `feat(desktop): complete Tauri companion application with licensing client`.

### Sprint 4: Multi-Provider AI Engine & Model Context Protocol (MCP) Server

* **Objective:** Implement the pluggable AI engine (BYOK, Ollama) and the standalone MCP Server.
* **Agent Directives:**
  1. Build `packages/ai-engine/` supporting Anthropic, Google Gemini, OpenAI, and Ollama/LM Studio endpoints.
  2. Build `packages/mcp-server/`:
     * Implement Model Context Protocol SDK server exposing `stdio` and SSE transport (`http://127.0.0.1:48124/sse`).
     * Register tools: `mcp__get_mix_telemetry`, `mcp__list_tracks`, `mcp__propose_mix_adjustment`.
     * Bridge tool invocations directly into `DAWDriver`.
  3. Generate exportable Claude Desktop configuration snippet (`claude_desktop_config.json`) in the HUD UI.
  4. Render the **Action Proposal Card** in React showing precise parameter deltas with Human-in-the-Loop approval.
  5. Commit: `feat(mcp): complete MCP server and multi-provider AI engine`.

### Sprint 5: End-to-End Validation Across Both DAWs & MCP Clients

* **Objective:** Verify closed-loop mix diagnostics in live sessions of both Nuendo and Logic Pro, as well as via external Claude Desktop MCP.
* **Agent Directives:**
  1. **Nuendo Native Validation:** Test frequency masking analysis and EQ adjustment via Steinberg MIDI Remote.
  2. **Logic Pro Native Validation:** Test vocal compression parameter adjustments via AU/Accessibility.
  3. **External MCP Co-Producer Validation:** Connect Claude Desktop to local MCP server; ask Claude to balance kick and bass; confirm parameter delta updates in DAW.
  4. Verify that all single source files remain under the 3,000 LOC ceiling.
  5. Commit: `test(e2e): verify multi-DAW and MCP closed-loop operations`.

## 6. Security, Isolation & Safety Directives

1. **Parameter Clamping & Velocity Limiting:** The desktop bridge must reject any volume increase exceeding $+3\text{ dB}$ in a single step and hard-clamp master outputs to prevent acoustic shock.
2. **Untrusted Metadata Handling:** Track names, project notes, and plugin names read from Nuendo or Logic must be treated as untrusted strings and sanitized to neutralize indirect prompt injection attacks.
3. **Keychain Key Storage:** All user-provided API keys (Anthropic, Gemini, OpenAI) must be encrypted via the OS native credential store (macOS Keychain, Windows DPAPI) and never stored in plaintext config files.
4. **No Raw Shell Access:** The AI reasoning model and MCP tools must possess zero access to OS shell execution tools (`bash`, `zsh`, `cmd`, `PowerShell`).
5. **Node & npm Supply-Chain Lockdown:**
   * A root `.npmrc` file with `ignore-scripts=true` must be committed to completely block execution of arbitrary shell scripts during `pnpm install`.
   * Only curated, industry-standard frontend dependencies (React, Vite, Tailwind CSS, Lucide, TypeScript) may be used. Obscure micro-packages and unvetted third-party utility libraries are prohibited.
   * `pnpm-lock.yaml` must be committed to lock cryptographic SHA-512 hashes for all transitive dependencies.
   * Automated dependency audit (`pnpm audit --audit-level=high`) must pass in CI on every push.