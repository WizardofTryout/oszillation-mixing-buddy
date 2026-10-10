# Changelog

All notable changes to the **Oszillation Mixing Buddy** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.7.0] - 2026-10-11

### 🚀 Highlights & Major Innovations
* **Sprint 8: On-Device Studio Speech Assistant:** Local, zero-latency speech recognition engine running on Apple Neural Engine with hardware audio resampling and dynamic session vocabulary injection.
* **Elite REA Studio Mixing Directives:** Prompt architecture upgraded with industry-grade co-producer rules (single-element surgery vs. summing bus separation, send-knob discipline, quantitative mix-health heuristics).
* **Express Sidechain & Disambiguation (Sprint 7):** Instant popover-free sidechain bus routing and exact parameter disambiguation (Compressor Threshold vs. Limiter Threshold).
* **ControlsViewFallback & GUI Auto-Restore (Sprint 6):** 50 ms DSP parameter harvesting with automatic GUI editor view restoration and calibrated compressor scales.
* **InputShield Safety Layer (Sprint 5):** Studio-grade input shielding with emergency Escape abort during automated DAW macro adjustments.

---

### Added
* **On-Device Speech Recognition Engine (`StudioSpeechEngine.swift`):**
  - Native macOS `Speech.framework` and `AVFoundation` integration via Swift Mach-O.
  - Offline transcription running entirely on the Apple Neural Engine without cloud roundtrips or internet dependency.
  - Built-in hardware audio converter supporting studio interface sample rates (44.1 kHz, 48 kHz, 96 kHz, 192 kHz) downsampled to 16 kHz Float32 mono.
  - Dynamic vocabulary injection (`contextualStrings`) derived from active session tracks, bus names, and audio engineering keywords (`sidechain`, `ducking`, `threshold`, `gain-staging`, `Q-factor`).
  - Embedded Mach-O TCC Info.plist (`NSSpeechRecognitionUsageDescription`, `NSMicrophoneUsageDescription`).
* **Tauri Desktop Speech Bridge (`speech_service.rs`):**
  - Robust child-process lifecycle management with graceful shutdown (`SIGTERM` / `SIGKILL`).
  - Event streaming bridge forwarding partial and final transcripts to the React HUD via `speech://partial-transcript` and `speech://final-transcript`.
* **Push-to-Talk HUD Interface (`ChatConsole.tsx`):**
  - Dedicated microphone Push-to-Talk button with audio activity wave animation.
  - Auto-injection of recognized speech into the active AI chat prompt.
* **Elite REA Studio Directives (`prompts.ts` & `AgentRunner.ts`):**
  - **Rule 18 (Bus vs. Element Separation):** Never modify the stereo master or summing bus to correct a problem localized to an individual child stem.
  - **Rule 19 (Smart Folder Expansion):** Verify and expand track folders before attempting channel strip modifications.
  - **Rule 20 (Send vs. Return Discipline):** Modulate the track's aux send level, keeping return faders calibrated to nominal studio unity ($0.0\text{ dB}$).
  - **Rule 21 (Format & Notation):** Backtick formatting for numeric parameters and exact dB values on action cards.
  - **Rule 22 (Minimum Viable Intervention):** Surgical dynamic and spectral corrections prioritized over heavy cumulative coloration.
* **Plugin Vault & Layout Cache (`~/.mixing-buddy/plugins/`):**
  - Persistent caching of plugin parameter IDs and layout hierarchies across DAW restarts.

### Changed
* **Compressor & Dynamics Disambiguation (`LogicAXPlugins.swift`):**
  - Fixed parameter collision where compressor threshold was applied to limiter threshold.
  - Enforced exact parameter matching (`Limiter Threshold` vs. `Threshold` / `Compressor Threshold`).
* **Automatic GUI Editor Restoration:**
  - Resolved issue where plugins remained in Controls/Fader view after parameter harvesting. The GUI editor window view is automatically re-engaged after read/write cycles.
* **Version Bumps:**
  - Synchronized monorepo root `package.json`, `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, and `App.tsx` badges to `v0.7.0`.

---

## [0.6.3] - 2026-10-07

### Added
* **ITU-R BS.1770-4 Dual-Gate Telemetry ("The Ear"):**
  - Multi-satellite C++20 / JUCE 8 meter plugins streaming 30 FPS binary telemetry to port 48123.
  - Integrated LUFS, Momentary LUFS (400 ms), Short-term LUFS, True Peak (dBTP), and Crest Factor.
* **Acoustic Shock Shield (`safety_guard.rs`):**
  - Asymmetric monitoring protection: unconstrained gain attenuation ($\le 0.0\text{ dB}$), gain boosts clamped at $+3.0\text{ dB}$ per increment.
  - Unconditional A/B listening volume restoration.
* **Vintage & Modern RTA Visualizer:**
  - 32-LED vintage rack with floating peak caps.
  - 128-needle high-res spectral analyzer with dynamic psychoacoustic target curves.
* **Direct AXUIElement DAW Bridge (`logic-ax-bridge`):**
  - Native Swift binary bypassing AppleScript for sub-millisecond execution.
