# Nuendo AI Mixing Agent: Architecture & Autonomous Implementation Plan

## Executive Overview
This document specifies the complete system architecture, protocol definitions, tool contracts, and a structured multi-sprint implementation roadmap for an AI-powered mixing assistant designed for **Steinberg Nuendo** (and Cubase).

The system consists of four decoupled subsystems:
1. **The Audio Metering Plugin ("The Ear"):** A lightweight VST3 plugin written in C++ (JUCE) deployed on the Master/Monitor bus that calculates loudness (EBU R128), spectral FFT snapshots, dynamics, and stereo correlation, streaming telemetry via local IPC.
2. **The DAW Control Bridge ("The Hands"):** A Steinberg MIDI Remote JavaScript driver integrated with a virtual MIDI loopback bridge, exposing bidirectional control over mixer faders, track controls, and 3rd-party VST3 parameters.
3. **The Local Desktop Companion & Runner ("The Body"):** A cross-platform desktop application (Tauri v2 + Rust/TypeScript or Electron) handling local IPC, virtual MIDI routing, user authentication, and chat UI.
4. **The Mix Reasoning Cloud Engine ("The Brain"):** A structured-output LLM backend with strictly typed Tool Calling (Function Calling) that evaluates mix issues, formulates actionable parameter adjustments, and requests user approval before dispatch.

---

## 1. System Architecture & Data Flow

```
                      +------------------------------------------+
                      |         Steinberg Nuendo / Cubase        |
                      |                                          |
                      |  [Track 1..N]    [Inserts / 3rd Party]   |
                      |       ^                   ^              |
                      |       |                   |              |
                      |  +-------------------------------------+ |
                      |  |     MIDI Remote API (JS Script)     | |
                      +--+-----------------+-------------------+--+
                                           | Bidirectional MIDI / SysEx
                                           v
+--------------------------+     +-------------------------------+
| VST3 Metering Plugin     |     | Virtual MIDI Driver Bridge    |
| (JUCE / C++ on Master)   |     | (macOS CoreMIDI / Win loopMIDI|
+------------+-------------+     +---------------+---------------+
             | Local IPC                         | Local IPC
             | (WebSocket / IPC)                 | (WebSocket / IPC)
             v                                   v
+----------------------------------------------------------------+
|                   DESKTOP COMPANION APP                        |
|   (Tauri v2 / Rust Core + React/TypeScript UI + State Engine)  |
+--------------------------------+-------------------------------+
                                 | Secure HTTPS / WebSockets
                                 v
+----------------------------------------------------------------+
|                    AI MIX REASONING ENGINE                     |
|  - Real-time Telemetry Evaluator (LUFS, FFT, Crest Factor)     |
|  - Strict Function Calling / Tool Calling Orchestrator         |
|  - Human-in-the-Loop Confirmation Barrier                      |
+----------------------------------------------------------------+
```

---

## 2. Subsystem Technical Specifications

### Subsystem A: The VST3 Audio Metering Plugin (`plugins/meter-vst`)
* **Framework:** JUCE 7/8 (C++20).
* **Format:** VST3 (macOS Universal Binary: Apple Silicon + x86_64, Windows x64).
* **Responsibilities:**
  * Zero-latency passthrough of audio buffers.
  * Real-time calculation of:
    * Integrated, Short-term, and Momentary LUFS (EBU R128).
    * True Peak (dBTP) using $4\times$ oversampling.
    * 512/1024-point FFT frequency bin spectrum (downsampled to 30 fps).
    * Stereo Correlation coefficient ($-1.0$ to $+1.0$) and RMS energy.
  * **IPC Dispatcher:** Sends JSON/Binary telemetry packets every 100ms over local WebSocket (`ws://127.0.0.1:48123/meter`) or shared memory/Unix Domain Socket.

### Subsystem B: The DAW Control Bridge (`bridge/midi-remote`)
* **Technology:** Steinberg MIDI Remote API (JavaScript) running inside Nuendo/Cubase.
* **Location:** `<User>/Documents/Steinberg/Nuendo/MIDI Remote/Driver Scripts/Local/`.
* **Transport:** Bidirectional MIDI CC, 14-bit NRPN, and Custom SysEx strings routed through a dedicated virtual MIDI port pair:
  * In: `AI_Mix_Agent_To_Nuendo`
  * Out: `Nuendo_To_AI_Mix_Agent`
* **Driver Capabilities:**
  * Read/Write Track Volume (dB), Pan, Mute, Solo.
  * Focus selected track and step through active tracks.
  * Inspect and alter parameters of loaded VST3 insert plugins via Nuendo's Focused Quick Controls and Host Plugin Parameter slots.
  * Read track names and routing configurations.

### Subsystem C: Desktop Companion App (`apps/desktop`)
* **Stack:** **Tauri v2 (Rust + React/TypeScript)** for minimal memory footprint and native low-latency MIDI/IPC handling.
* **Rust Backend Responsibilities:**
  * Initialize and bind virtual MIDI ports (`midir` crate).
  * Host local IPC WebSocket server (`tokio-tungstenite`) receiving telemetry from Subsystem A.
  * Implement safety sanitization: Reject arbitrary command injections; enforce parameter bounding $[-96.0\text{ dB}, +6.0\text{ dB}]$.
* **Frontend UI Responsibilities:**
  * Chat panel with streaming responses and markdown rendering.
  * Real-time RTA spectrum analyzer and LUFS target gauge.
  * "Action Proposal Card" showing precise diffs (e.g., `Snare Channel EQ -> Band 3: 3.1 kHz, -2.5 dB, Q: 2.0`) with **[Apply]**, **[A/B Compare]**, and **[Reject]** buttons.

### Subsystem D: AI Engine & Tool Calling Schema (`services/ai-agent`)
* **Model:** Anthropic Claude 3.5 Sonnet / OpenAI GPT-4o / Custom Fine-Tuned Mix Agent.
* **Strict Tool Definition (JSON Schema):**
```json
{
  "name": "apply_mix_action",
  "description": "Applies a concrete mix modification to a designated track or plugin parameter in Nuendo.",
  "parameters": {
    "type": "object",
    "properties": {
      "target_track": { "type": "string", "description": "Exact name of the track" },
      "target_slot": { "type": "integer", "description": "Insert slot index (1-16) or 0 for channel strip" },
      "parameter_name": { "type": "string", "description": "Name of parameter, e.g. Frequency, Gain, Threshold" },
      "target_value": { "type": "number", "description": "Target normalized value [0.0 - 1.0] or engineering unit" },
      "unit": { "type": "string", "enum": ["dB", "Hz", "ms", "%", "ratio", "raw"] },
      "rationale": { "type": "string", "description": "Audio engineering explanation for the mix decision" }
    },
    "required": ["target_track", "parameter_name", "target_value", "rationale"]
  }
}
```

---

## 3. Git Strategy & Repository Structure

* **Repository:** Monorepo managed with `pnpm` (for frontend/JS) and `Cargo` (for Rust/Tauri).
* **Branching Strategy:**
  * `main`: Production-ready releases.
  * `develop`: Active integration branch.
  * `feature/*`: Specific sprint tasks (e.g., `feature/sprint-1-juce-meter`).
* **Commit Standard:** Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`).

```
nuendo-ai-agent/
├── .github/
│   └── workflows/
│       ├── test-plugin.yml       # Builds & tests JUCE VST3 on macOS/Windows
│       └── build-desktop.yml      # Builds Tauri app & packages DMG / MSI
├── apps/
│   └── desktop/                  # Tauri v2 Desktop App
│       ├── src-tauri/            # Rust native backend (MIDI, IPC, Local Server)
│       └── src/                  # React / Tailwind CSS UI
├── plugins/
│   └── meter-vst/                # C++ JUCE Audio Unit / VST3 plugin
│       ├── CMakeLists.txt
│       └── Source/
├── bridge/
│   └── midi-remote/              # Steinberg Nuendo MIDI Remote Script
│       └── ai_agent_driver.js
├── packages/
│   ├── shared-types/             # TypeScript definitions for IPC & Tool calls
│   └── audio-math/               # R128, FFT, and scaling utilities
├── Cargo.toml                    # Cargo workspace root
├── pnpm-workspace.yaml
└── README.md
```

---

## 4. Multi-Sprint Implementation Roadmap for Agents

### Sprint 0: Scaffolding, Environment & Toolchains
* **Goal:** Initialize monorepo, setup CI workflows, ensure Xcode and MSVC build tools compile clean templates.
* **Agent Instructions:**
  1. Initialize monorepo with `git init` and commit the repository structure.
  2. Setup `pnpm` workspace and root `Cargo.toml`.
  3. Validate macOS Xcode toolchain: Ensure `clang`, `cmake`, and `ninja` are functional.
  4. Create GitHub Actions CI workflow files building on `macos-14` and `windows-latest`.
  5. Commit with message: `chore: initialize monorepo structure and CI pipelines`.

### Sprint 1: VST3 Telemetry Plugin (The Ear)
* **Goal:** Implement the C++/JUCE VST3 metering plugin.
* **Agent Tasks:**
  1. Scaffold `plugins/meter-vst` using `CMakeLists.txt` pulling JUCE 7/8 via `FetchContent`.
  2. Implement an audio ring buffer reading blocks in `processBlock()`.
  3. Integrate `juce::dsp::FFT` for frequency bin extraction ($20\text{ Hz} - 20\text{ kHz}$).
  4. Implement an EBU R128 loudness detector calculating short-term (3s) and integrated LUFS.
  5. Add an embedded WebSocket client (or lightweight local TCP client) streaming JSON metrics at 10 Hz to `127.0.0.1:48123`.
  6. Build and verify the `.vst3` bundle on macOS using Xcode/Clang.
  7. Commit: `feat(plugin): implement VST3 real-time audio analysis engine`.

### Sprint 2: Steinberg MIDI Remote Bridge (The Hands)
* **Goal:** Build the JavaScript MIDI Remote script for Nuendo and the virtual MIDI transport.
* **Agent Tasks:**
  1. Create `bridge/midi-remote/ai_agent_driver.js` using Steinberg's `midiremote_api`.
  2. Map 16 virtual mixer strips: Volume faders, Pan, Mute, Solo, and 8 Focused Quick Controls for active plugins.
  3. Implement SysEx protocol for text-based track identification and parameter feedback.
  4. In `apps/desktop/src-tauri`, implement native virtual MIDI creation:
     * macOS: Create virtual endpoint via `coremidi`.
     * Windows: Connect to existing loopback interfaces (`loopMIDI`).
  5. Implement bidirectional validation tests: Verify that setting fader on Track 1 reflects in desktop app state.
  6. Commit: `feat(bridge): implement Nuendo MIDI Remote JS driver and virtual transport`.

### Sprint 3: Desktop Companion & IPC Layer (The Body)
* **Goal:** Create the local desktop application with Tauri v2 and React.
* **Agent Tasks:**
  1. Initialize Tauri v2 application in `apps/desktop`.
  2. Implement Rust local server receiving telemetry from Sprint 1 and MIDI from Sprint 2.
  3. Build React dashboard:
     * Interactive Frequency Spectrum Display (Canvas/WebGL).
     * Real-time Loudness Meter (LUFS Short-Term, Integrated, True Peak).
     * Connection status badges: `Nuendo Bridge [Connected]`, `Meter Plugin [Connected]`.
  4. Ensure graceful degradation if Nuendo or the plugin is closed.
  5. Commit: `feat(desktop): complete Tauri companion application with real-time HUD`.

### Sprint 4: AI Reasoning Engine & Safety Shield (The Brain)
* **Goal:** Implement the chat assistant, LLM function calling, and prompt injection defenses.
* **Agent Tasks:**
  1. Integrate LLM API client supporting structured output / tool calling.
  2. Define System Prompt establishing identity as a Senior Audio Mixing Engineer.
  3. Enforce **Human-in-the-Loop Barrier**: The model CANNOT execute changes directly. It generates an `action_proposal` schema.
  4. Implement UI "Action Approval Card": Shows exact delta (e.g. `Param: Threshold -18dB -> -22dB`).
  5. Add input sanitization: Treat all Nuendo track names and project notes as untrusted user data to neutralize indirect prompt injection.
  6. Commit: `feat(ai): integrate tool calling engine and confirmation gatekeeper`.

### Sprint 5: End-to-End Integration, Testing & Polishing
* **Goal:** Full system integration test with live Nuendo session.
* **Agent Tasks:**
  1. Test scenario: Insert plugin on Master in Nuendo, run playback, verify audio telemetry in Desktop UI.
  2. Ask AI: *"The kick and bass are clashing around 80 Hz, clean it up."*
  3. Verify AI identifies frequency overlap via FFT telemetry, formulates parametric EQ cut on Track "Bass", and renders the Proposal Card.
  4. Click `[Apply]` -> Confirm MIDI Remote script executes knob rotation in Nuendo without UI jitter.
  5. Implement A/B toggle logic: Store previous parameter state to enable instant rollback.
  6. Commit: `test(e2e): validate closed-loop diagnose-propose-execute cycle`.

### Sprint 6: Packaging, Signing & Distribution
* **Goal:** Automate notarized builds for macOS and installers for Windows.
* **Agent Tasks:**
  1. Configure macOS notarization using Apple Developer ID via Xcode command-line tools (`notarytool`).
  2. Setup Windows Inno Setup / MSI bundler via Tauri.
  3. Package installer that automatically copies the MIDI Remote script into the user's Steinberg directory:
     * Mac: `~/Documents/Steinberg/Nuendo/MIDI Remote/Driver Scripts/Local/`
     * Win: `%USERPROFILE%\Documents\Steinberg\Nuendo\MIDI Remote\Driver Scripts\Local\`
  4. Commit: `chore(release): configure automated packaging and installation hooks`.

---

## 5. Security & Isolation Directives for Autonomous Agents

1. **Strict Whitelist Execution:** The companion app MUST NEVER execute arbitrary shell commands (`bash`, `sh`, `PowerShell`). It only dispatches fixed, validated byte packets over the MIDI Remote interface.
2. **Value Clamping:** Every incoming parameter change must pass a strict min/max validator before reaching the DAW bridge (preventing accidental $+12\text{ dB}$ bursts).
3. **No Project File Serialization Direct Access:** The app operates purely at runtime via official DAW APIs; it never attempts to directly parse or write to binary `.npr` (Nuendo Project) files on disk to prevent project corruption.