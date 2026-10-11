# Changelog

All notable changes to the **Oszillation Mixing Buddy** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.9.0] - 2026-10-11 (Multi-DAW Expansion & Steinberg Nuendo 14 / Cubase 14)

### 🚀 Highlights & Features
* **Multi-DAW Support & Steinberg MIDI Remote Driver:**
  - Nativer Steinberg MIDI Remote JavaScript Treiber (`Oszillation_MixingBuddy.js`) für Nuendo 14, Cubase 14 (sowie Nuendo/Cubase 12 & 13).
  - 16-Kanal-Mixer-Steuerung: Lautstärke-Fader (14-Bit hochauflösend), Pan (Balance & Stereo Panner), Mute, Solo und Transport-Automation (Play, Stop, Cycle, Locate).
  - Automatisierter 1-Klick Script-Installer im Desktop HUD Hamburger-Menü und REST/Tauri API.
* **Plugin-Normalisierung & Stock Processing:**
  - Volle bidirektionale Parameter-Normalisierung für Steinberg Channel EQ (Bänder 1–4 mit Frequency, Gain, Q, Filtertypen), Frequency 2 und Steinberg Compressor.
  - Skalierung zwischen standardisierten AI Studio-Einheiten (Hz, dB, ms, Ratio) und DAW-spezifischen 0.0–1.0 Wertebereichen.
  - Asymmetrischer Acoustic Shock Shield Schutz (+3.0 dB Begrenzung & A/B-Restore) für alle Steinberg Strip- und Insert-Operationen.
* **Studio Memory Vault & DAW Auto-Recall:**
  - Lückenlose Session-Historie (`*.omb-session.json`), In-Memory Ringpuffer und automatischer DAW-Recall via JUCE Plugin State (`sessionUuid`).
  - Interaktiver Session Manager und Memory Inspector im Desktop HUD.
* **Multi-DAW HUD & Nahtloses Heiß-Switching (Hot-Switching):**
  - Neues modulares `DawStatusBadge.tsx` mit Farbkodierung (🍎 Logic Pro, 🟦 Nuendo 14, 🟥 Cubase 14).
  - Anzeige des Satelliten-Metrology-Status (AU / VST3) und der Steuerungs-Bridge (Apple AX vs. Steinberg MIDI Remote).
  - Laufzeit-Umschaltung ohne Neustart der Desktop-App und ohne Datenverlust im Vault.
* **100 % Lane-Isolation (Zero-Regression für Apple Logic Pro):**
  - Die native Swift Mach-O Binary (`logic-ax-bridge`) und alle Logic-Adapter blieben zu exakt 0 Zeilen verändert.
* **Adaptive Modularity Governance:**
  - Einhaltung des 2-Zonen-Modells (`scripts/lint-loc.sh`) für nachhaltige Code-Hygiene und strikte Architektur-Schranken.

---

## [0.8.0] - 2026-10-11 (Studio Memory Vault & DAW Session Recall)

### 🚀 Highlights & Features
* **Automated DAW Session Recall & Plugin State Handshake:**
  - JUCE meter plugin (`MixingBuddyMeter`) serializes `sessionUuid` and DAW session metadata directly into the DAW project state chunk (`getStateInformation` / `setStateInformation`).
  - Automatic TCP/IPC handshake synchronizes session identity with the Desktop Companion on project open (`project-context-sync` on port 48123).
* **Studio Memory Vault & Action Timeline:**
  - Persistent multi-session memory vault tracking AI mix decisions, parameter modifications, and A/B adjustments.
  - Interactive Session Manager modal with active session switching, renaming, archiving, and JSON session export.
  - Interactive Memory Inspector modal displaying chronologically ordered action histories, before/after parameter delta badges, and instant replay capabilities.
  - Deep integration into the top navigation toolbar and hamburger menu.
* **Adaptive Modularity & Elastic LOC Governance:**
  - Implemented 2-Zone modularity model (`scripts/lint-loc.sh`) preventing both premature fragmentation and unmanaged God-files.
  - Strict AST and line-of-code compliance gates across all monorepo packages.

---

## [0.7.0] - 2026-10-11 (Beta Preview)

### 🚀 Highlights & Features
* **On-Device Neural Voice Control (Push-to-Talk):** Local, zero-latency speech recognition running entirely on the Apple Neural Engine. Automatically resamples studio audio interface sample rates (44.1 kHz–192 kHz) and dynamically injects DAW track names and audio engineering terminology into the recognition vocabulary.
* **Precision Parameter Routing & Dynamics Disambiguation:** Instant popover-free sidechain bus routing and exact parameter targeting (cleanly separating compressor threshold from limiter threshold in multi-stage dynamics processors).
* **Automated GUI Preservation:** High-speed parameter synchronization with immediate, automatic restoration of native plugin editor windows.
* **Studio-Grade Safety & Input Shielding:** Transparent modal protection during automated macro adjustments with instant emergency abort (`Esc`) alongside the Acoustic Shock Shield (+3 dB monitoring protection).
* **Professional Mix Co-Producer Heuristics:** Advanced decision rules ensuring track-level surgery over master-bus masking, aux-send discipline, and quantitative mix-health analysis.
* **1-Click Pre-Built Distribution:** macOS DMG app bundles and AU / VST3 meter satellite plugins with automated 1-click installation scripts.

---

## [0.6.3] - 2026-10-07

### Added
* **ITU-R BS.1770-4 Dual-Gate Telemetry ("The Ear"):**
  - Multi-satellite meter plugins streaming 30 FPS binary telemetry.
  - Integrated LUFS, Momentary LUFS (400 ms), True Peak (dBTP), and Crest Factor.
* **Acoustic Shock Shield:**
  - Asymmetric monitoring protection: unconstrained attenuation ($\le 0.0\text{ dB}$), gain boosts clamped at $+3.0\text{ dB}$ per increment.
  - Non-destructive A/B volume restoration.
* **Hardware-Grade RTA Visualization:**
  - 32-LED vintage rack with floating peak caps.
  - 128-needle high-res spectral analyzer with dynamic psychoacoustic target curves.
* **Direct Native DAW Accessibility Bridge:**
  - Sub-millisecond direct memory accessibility engine for Apple Logic Pro.
