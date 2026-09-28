# Nuendo & Logic Pro AI Mixing Agent: Modular Architecture & Autonomous Implementation Plan

## Executive Overview

This document specifies the complete system architecture, multi-DAW abstraction model, tool contracts, and a multi-sprint implementation blueprint for an AI-powered mixing assistant designed for **Steinberg Nuendo (and Cubase)** as well as **Apple Logic Pro**.

To prevent context exhaustion, code drift, and AI hallucination during autonomous agent implementation, the architecture enforces a **Modular Adapter Pattern** and a **Strict File-Size Barrier ($\le 3,000$ lines of code per file)** across the entire monorepo.

---

## 1. Architectural Philosophy: Why Modularity & Size Limits Matter

### The Problem: Context Degradation & Agent Hallucination
When autonomous AI developer agents (e.g., in VS Code, Cursor, or Antigravity) work on monoliths or files exceeding 2,000–3,000 lines, several catastrophic failure modes emerge:
1. **Attention Thinning:** The LLM misses subtle state interactions, edge cases, and type safety constraints.
2. **Silent Regressions:** Agents frequently drop existing helper methods or rewrite functioning code blocks when generating large files.
3. **Compounding Hallucinations:** As context size expands with repetitive boilerplate, the agent's probability of generating non-existent API bindings increases exponentially.

### The Solution: Modular Boundary Directives
* **Strict 3,000 LOC Upper Limit:** No single source file (`.ts`, `.rs`, `.cpp`, `.js`) may ever exceed 3,000 lines of code. Recommended target size is **200–600 LOC** per file.
* **Component Isolation:** Each subsystem communicates exclusively via strongly typed interfaces, IPC contracts, or event buses.
* **Decoupled Control Bridges:** Logic Pro specifics and Nuendo specifics reside in strictly segregated adapter packages that share a single common interface (`DAWDriver`).

---

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
|   |                       Abstract DAW Control Bus (`DAWDriver`)                    |   |
|   |                                                                                 |   |
|   |   +---------------------------+             +-------------------------------+   |   |
|   |   | NuendoDriver (MIDI/SysEx) |             | LogicProDriver (AXUIElement)  |   |   |   |
|   |   +---------------------------+             +-------------------------------+   |   |
|   +---------------------------------------------------------------------------------+   |
|                                         |                                               |
|   +-------------------------------------+-------------------------------------------+   |
|   |                     React / Tailwind Engineering HUD                            |   |
|   |            (RTA Spectrum, LUFS Gauges, Action Proposal & Diff Review)           |   |
|   +-------------------------------------+-------------------------------------------+   |
+-----------------------------------------|-----------------------------------------------+
                                          | Secure HTTPS / WebSockets (Typed Tool Schema)
                                          v
+-----------------------------------------------------------------------------------------+
|                                AI REASONING ENGINE ("The Brain")                        |
|      - Real-Time Psychoacoustic Evaluator (FFT Clashing, Spectral Masking, LUFS)        |
|      - Deterministic Function Calling & Human-in-the-Loop Confirmation Barrier          |
+-----------------------------------------------------------------------------------------+
```

---

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

---

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
  
  // Transport
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

---

### Subsystem 3: Desktop Companion & Runner ("The Body")
* **Directory:** `apps/desktop/`
* **Technologies:** Tauri v2 (Rust Backend + React/TypeScript UI).
* **Purpose:** Bridges local IPC, hosts DAW drivers, provides security validation, and displays the engineer HUD.
* **Rust Native Layer (`src-tauri/`):**
  * Auto-detects running DAWs (`Nuendo.exe`, `Nuendo.app`, `Logic Pro.app`).
  * Enforces the **Safety Shield**: Bounds parameter ranges (clamps faders to $[-96.0\text{ dB}, +6.0\text{ dB}]$; prevents rapid volume spikes).
  * Manages local virtual MIDI ports via native OS bindings (`coremidi` on macOS, `midir` loopback on Windows).
* **Frontend HUD (`src/`):**
  * RTA real-time spectrum display (WebGL/HTML5 Canvas).
  * LUFS target meter with headroom warnings.
  * **Interactive Action Diff Card:** Displays precise changes before execution (e.g., `Snare Channel EQ -> Band 3: 3.1 kHz, -2.5 dB, Q: 2.0`) with **[Apply]**, **[A/B Listen]**, and **[Reject]** buttons.

---

### Subsystem 4: AI Reasoning Engine ("The Brain")
* **Directory:** `services/ai-agent/`
* **Technologies:** Node.js / Rust LLM orchestrator connecting to frontier models (Claude 3.5 Sonnet / GPT-4o).
* **Purpose:** Ingests audio telemetry, parses engineer requests, reasons about acoustic masking and mix balance, and outputs typed parameter deltas.
* **Tool Calling Contract:** The LLM cannot execute system commands or raw scripts. It can only emit structured tool invocations:
```json
{
  "name": "propose_mix_adjustment",
  "description": "Proposes a mix modification across track volumes or insert plugin parameters.",
  "parameters": {
    "type": "object",
    "properties": {
      "target_track": { "type": "string", "description": "Exact name of the track" },
      "target_slot": { "type": "integer", "description": "Insert slot (1-16) or 0 for channel fader" },
      "target_plugin": { "type": "string", "description": "Plugin name (e.g. Channel EQ, Pro-Q 3, CL 1B)" },
      "parameter_name": { "type": "string", "description": "Exact parameter name (e.g. Frequency, Gain, Ratio)" },
      "current_value": { "type": "number", "description": "Current value prior to adjustment" },
      "target_value": { "type": "number", "description": "Target value proposed" },
      "unit": { "type": "string", "enum": ["dB", "Hz", "ms", "%", "ratio", "raw"] },
      "psychoacoustic_rationale": { "type": "string", "description": "Audio engineering explanation" }
    },
    "required": ["target_track", "parameter_name", "target_value", "psychoacoustic_rationale"]
  }
}
```

---

## 4. Monorepo Structure & File-Length Guardrails

```
mix-agent-monorepo/
├── .github/
│   └── workflows/
│       ├── lint-file-size.yml     # Enforces < 3000 LOC limit across all PRs
│       ├── test-plugin.yml        # Compiles JUCE VST3 + AU on macOS & Win
│       └── build-desktop.yml      # Packages Tauri DMG (Mac) and MSI (Win)
├── apps/
│   └── desktop/                   # Tauri v2 Desktop App
│       ├── src-tauri/             # Rust Native Core (< 500 LOC per file)
│       │   ├── src/
│       │   │   ├── main.rs
│       │   │   ├── ipc_server.rs
│       │   │   ├── midi_bridge.rs
│       │   │   ├── safety_guard.rs
│       │   │   └── daw_detector.rs
│       └── src/                   # React Frontend (< 350 LOC per component)
│           ├── components/
│           │   ├── SpectrumRTA.tsx
│           │   ├── LoudnessHUD.tsx
│           │   ├── ActionCard.tsx
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
│   ├── daw-adapters/              # Decoupled DAW Control Engines
│   │   ├── src/
│   │   │   ├── types.ts           # Central DAWDriver Interface
│   │   │   ├── nuendo/            # Steinberg MIDI Remote Bridge
│   │   │   │   ├── index.ts
│   │   │   │   └── midi_remote_spec.ts
│   │   │   └── logic/             # Logic Pro Accessibility / MCU Bridge
│   │   │       ├── index.ts
│   │   │       └── macos_ax_client.ts
│   ├── audio-math/                # LUFS, FFT, and curve calculation utilities
│   └── shared-types/              # Common IPC & Action schemas
├── bridge-scripts/
│   └── nuendo/
│       └── ai_agent_driver.js     # Steinberg MIDI Remote Driver Script
├── Cargo.toml
├── pnpm-workspace.yaml
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

---

## 5. Multi-Sprint Implementation Roadmap for Autonomous Agents

### Sprint 0: Scaffolding, Toolchains & Lint Enforcement
* **Objective:** Establish the multi-package monorepo with CI file-size barriers and dual-platform build scripts.
* **Agent Directives:**
  1. Initialize `pnpm` monorepo workspace and Cargo workspace root.
  2. Implement GitHub Actions CI with file-length enforcement (`lint-file-size.yml`).
  3. Validate macOS toolchains (`clang`, `cmake`, `ninja`, Xcode CLI tools).
  4. Commit: `chore(repo): scaffold modular monorepo and CI safety guardrails`.

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

### Sprint 3: Desktop Companion & DAW Detection Engine ("The Body")
* **Objective:** Build the Tauri v2 cross-platform desktop application.
* **Agent Directives:**
  1. Initialize Tauri v2 application in `apps/desktop`.
  2. In `src-tauri`, write `daw_detector.rs` to automatically identify whether Nuendo or Logic Pro is running and bind the appropriate adapter.
  3. Build Rust WebSocket receiver for the JUCE meter telemetry stream.
  4. Build React engineering HUD:
     * Interactive Frequency Spectrum Display (Canvas/WebGL).
     * Dual LUFS Short-Term and Integrated bar meters with peak indicators.
     * Connection status badges: `Audio Engine: Connected`, `Active DAW: Nuendo / Logic Pro`.
  5. Commit: `feat(desktop): complete Tauri companion application with dynamic DAW binding`.

### Sprint 4: AI Reasoning Engine & Action Proposal Card ("The Brain")
* **Objective:** Implement LLM function calling and the Human-in-the-Loop review system.
* **Agent Directives:**
  1. Configure LLM client with structured tool calling (`propose_mix_adjustment`).
  2. Implement the **Human-in-the-Loop Barrier**: The agent is strictly read-only until user confirmation.
  3. Render the **Action Proposal Card** in React showing precise parameter deltas.
  4. Implement an A/B audition toggle: Snapshot parameter states prior to application to allow instant 1-click rollback.
  5. Commit: `feat(ai): integrate tool calling engine and confirmation gatekeeper`.

### Sprint 5: End-to-End Validation Across Both DAWs
* **Objective:** Verify closed-loop mix diagnostics in live sessions of both Nuendo and Logic Pro.
* **Agent Directives:**
  1. **Nuendo Validation:**
     * Load VST3 meter on Master.
     * Issue command: *"Clean up muddiness in the 250 Hz range on Acoustic Guitar."*
     * Confirm proposal generates, user clicks **[Apply]**, and Nuendo's EQ adjusts via MIDI Remote.
  2. **Logic Pro Validation:**
     * Load AU meter on Stereo Out.
     * Issue command: *"Compress the vocal track to tame 6 dB peaks."*
     * Confirm proposal generates, user clicks **[Apply]**, and Logic Pro adjusts the Channel Compressor.
  3. Verify that all single source files remain under the 3,000 LOC ceiling.
  4. Commit: `test(e2e): verify automated diagnose-propose-execute cycle on Nuendo and Logic`.

---

## 6. Security, Isolation & Safety Directives

1. **Parameter Clamping & Velocity Limiting:** The desktop bridge must reject any volume increase exceeding $+3\text{ dB}$ in a single step and hard-clamp master outputs to prevent acoustic shock.
2. **Untrusted Metadata Handling:** Track names, project notes, and plugin names read from Nuendo or Logic must be treated as untrusted strings and sanitized to neutralize indirect prompt injection attacks.
3. **No Raw Shell Access:** The AI reasoning model must possess zero access to OS shell execution tools (`bash`, `zsh`, `cmd`, `PowerShell`).