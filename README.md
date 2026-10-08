# Oszillation Mixing Buddy (Universal AI Co-Producer)

[![Version](https://img.shields.io/badge/version-v0.7.0-blue.svg)](https://github.com/WizardofTryout/oszillation-mixing-buddy)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-amber.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS-lightgrey.svg)]()

> **Modular AI Mixing Assistant & Telemetry HUD for Apple Logic Pro & Steinberg Nuendo.**  
> Real-time ITU-R BS.1770-4 / EBU R128 audio metrology, 128-band hardware-style RTA, multi-satellite monitoring, and zero-latency DAW automation.

---

## 🏛️ System Architecture

Oszillation Mixing Buddy is engineered as a clean 4-pillar monorepo:

1. **Säule 1: Audio Metrology ("The Ear")** (`plugins/meter-audio/`)
   - JUCE 8, C++20, ITU-R BS.1770-4 / EBU R128 Dual-Gate metering.
   - Low-latency real-time telemetry streaming (30 fps) at $\le 0.1$ ms internal latency.
   - 128-band logarithmic FFT spectrum analysis.

2. **Säule 2: Desktop Companion & IPC Hub** (`apps/desktop/`)
   - Tauri v2 (Rust backend + React / Tailwind CSS musician HUD).
   - WebSocket/TCP IPC telemetry hub.
   - **Acoustic Shock Shield**: Asymmetrical hearing protection (+3.0 dB safety limiter per step with instant safe A/B restoration).

3. **Säule 3: Native DAW Bridges ("The Hands")** (`packages/daw-adapters/`)
   - High-performance native Swift Mach-O accessibility binary (`logic-ax-bridge`).
   - Direct macOS `ApplicationServices` / `AXUIElement` inspection and control ($< 0.1$ ms latency, no AppleScript).
   - Logic Pro mixer and plugin automation with track awareness.

4. **Säule 4: MCP Server & AI Gateway ("The Brain")** (`packages/mcp-server/` & `packages/ai-engine/`)
   - Model Context Protocol (MCP) specification 2026.
   - Multi-provider AI engine (Claude / Anthropic, Gemini, OpenAI, local Ollama).
   - Persistent Plugin Vault for learned equalizer and dynamics plugins.

---

## 🚀 Quick Start

### Prerequisites
- macOS 13.0+ (Apple Silicon or Intel)
- Node.js $\ge 20$ & `pnpm` $\ge 9$
- Rust toolchain (`cargo`, `rustc`)
- CMake $\ge 3.25$ & Xcode (for native JUCE & Swift builds)

### Build & Run
```bash
# Clone the repository
git clone https://github.com/WizardofTryout/oszillation-mixing-buddy.git
cd oszillation-mixing-buddy

# Install dependencies and build TypeScript packages
pnpm install
pnpm -r run build

# Launch Desktop App in Development Mode
pnpm --filter desktop tauri dev
```

---

## 🛡️ Acoustic Shock Shield

To protect studio monitoring systems and human hearing, all automated volume and gain changes pass through an asymmetrical guard:
- **Level reductions ($\le 0.0$ dB):** Always allowed without delay.
- **Level boosts ($> 0.0$ dB):** Capped at max $+3.0$ dB per adjustment step.
- **A/B Restore Guarantee:** Restoring to initial base level is never blocked.

---

## 📜 License

This project is licensed under the **PolyForm Noncommercial License 1.0.0**.  
See [LICENSE](LICENSE) for details. Noncommercial personal evaluation and open-source contributions are welcome. For commercial licensing, contact Oszillation Studio.
