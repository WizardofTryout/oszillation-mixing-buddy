#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Steinberg Mixing Buddy: Studio Quick-Setup Script
# Sets up dependencies, builds packages, and ensures plugins are linked.
# ==============================================================================

echo "🎛️  Initializing Steinberg Mixing Buddy Environment..."

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"

# 1. Monorepo dependencies
echo "📦 Installing workspace packages (Hermetic Supply-Chain Sandbox)..."
pnpm install

# 2. Build TypeScript Packages & HUD
echo "🔨 Compiling shared packages, DAW adapters, AI engine & HUD..."
pnpm -r run build

# 3. Verify Plugin Installation Paths
VST3_DIR="$HOME/Library/Audio/Plug-Ins/VST3"
AU_DIR="$HOME/Library/Audio/Plug-Ins/Components"
mkdir -p "$VST3_DIR" "$AU_DIR"

if [ -d "plugins/meter-audio/build/MixingBuddyMeter_artefacts/Release/VST3/MixingBuddyMeter.vst3" ]; then
  echo "🔌 Linking VST3 Plugin to $VST3_DIR..."
  cp -R "plugins/meter-audio/build/MixingBuddyMeter_artefacts/Release/VST3/MixingBuddyMeter.vst3" "$VST3_DIR/"
fi

if [ -d "plugins/meter-audio/build/MixingBuddyMeter_artefacts/Release/AU/MixingBuddyMeter.component" ]; then
  echo "🔌 Linking Audio Unit Plugin to $AU_DIR..."
  cp -R "plugins/meter-audio/build/MixingBuddyMeter_artefacts/Release/AU/MixingBuddyMeter.component" "$AU_DIR/"
fi

# 4. MIDI Remote Script for Nuendo
NUENDO_MIDI_DIR="$HOME/Documents/Steinberg/Nuendo/MIDI Remote/Driver Scripts/Local/Steinberg/MixingBuddy"
mkdir -p "$NUENDO_MIDI_DIR"
if [ -f "bridge-scripts/nuendo/ai_agent_driver.js" ]; then
  echo "🎹 Installing Steinberg MIDI Remote script for Nuendo..."
  cp "bridge-scripts/nuendo/ai_agent_driver.js" "$NUENDO_MIDI_DIR/"
fi

echo ""
echo "✅ Setup Complete!"
echo "👉 Run 'pnpm --filter desktop dev' to launch the Desktop Companion HUD."
echo "👉 Read STUDIO_DEPLOYMENT.md for DAW & Claude Desktop connection instructions."
