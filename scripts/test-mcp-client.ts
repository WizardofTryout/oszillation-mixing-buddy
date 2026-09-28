#!/usr/bin/env npx tsx
/**
 * Test script simulating an external MCP Client (e.g. Claude Desktop, Gemini CLI)
 * interacting with Steinberg Mixing Buddy's Model Context Protocol server.
 */

import { MixingToolHandlers } from '../packages/mcp-server/src/handlers.js';
import { MixingBuddyMCPServer } from '../packages/mcp-server/src/server.js';
import { AIEngine } from '../packages/ai-engine/src/index.js';

async function runMCPTest() {
  console.log('🧪 Starting Steinberg Mixing Buddy MCP Client Simulation...\n');

  // 1. Initialize Handlers & Server
  const handlers = new MixingToolHandlers();
  const server = new MixingBuddyMCPServer(handlers);

  console.log('1️⃣  Testing Tool: mcp__get_mix_telemetry');
  const telemetryResult = await handlers.getMixTelemetry({});
  console.log(`   - Integrated Loudness: ${telemetryResult.telemetry.loudness.integratedLufs.toFixed(1)} LUFS`);
  console.log(`   - True Peak (Max): ${Math.max(telemetryResult.telemetry.loudness.truePeakDb.left, telemetryResult.telemetry.loudness.truePeakDb.right).toFixed(1)} dBTP`);
  console.log(`   - Stereo Correlation: ${telemetryResult.telemetry.dynamics.stereoCorrelation.toFixed(2)}`);
  console.log(`   - Top Resonance Detected: ${telemetryResult.topResonances[0]?.frequencyHz} Hz (${telemetryResult.topResonances[0]?.character}) at ${telemetryResult.topResonances[0]?.magnitudeDb} dB`);
  console.log('   ✅ mcp__get_mix_telemetry passed.\n');

  console.log('2️⃣  Testing Tool: mcp__list_tracks');
  const tracksResult = await handlers.listTracks({});
  console.log(`   - Tracks Retrieved: ${tracksResult.tracks.length}`);
  for (const t of tracksResult.tracks) {
    console.log(`     * [${t.id}] "${t.name}" | Vol: ${t.volumeDb} dB | Plugins: ${t.insertSlots.map(p => p?.pluginName).filter(Boolean).join(', ') || 'None'}`);
  }
  console.log('   ✅ mcp__list_tracks passed.\n');

  console.log('3️⃣  Testing AI Engine & Tool: mcp__propose_mix_adjustment');
  const aiEngine = new AIEngine('mock');
  const aiProposal = await aiEngine.analyzeMix(telemetryResult.telemetry, tracksResult.tracks);
  console.log(`   - AI Generated Proposal: "${aiProposal.title}"`);
  console.log(`   - Category: ${aiProposal.category} | Confidence: ${(aiProposal.confidenceScore * 100).toFixed(0)}%`);
  console.log(`   - Rationale: ${aiProposal.rationale}`);
  for (const delta of aiProposal.deltas) {
    console.log(`     * Delta on "${delta.trackName}": ${delta.parameterName} ${delta.currentValue} -> ${delta.proposedValue} ${delta.unit}`);
  }

  const proposeResult = await handlers.proposeMixAdjustment({
    category: aiProposal.category,
    title: aiProposal.title,
    rationale: aiProposal.rationale,
    confidenceScore: aiProposal.confidenceScore,
    deltas: aiProposal.deltas
  });
  console.log(`   - Proposal ID: ${proposeResult.proposal.id} (Status: ${proposeResult.proposal.status})`);
  console.log(`   - Acoustic Shield Gate: ${proposeResult.shieldStatus}`);
  console.log('   ✅ mcp__propose_mix_adjustment passed.\n');

  console.log('4️⃣  Testing Tool: mcp__execute_mix_adjustment (Safe Adjustment)');
  const safeExecution = await handlers.executeMixAdjustment({
    trackId: 'track_1',
    parameterName: 'fader_db',
    value: -4.5,
    isMaster: false
  });
  console.log(`   - Safe Volume Trim Result: ${safeExecution.message}`);
  console.log('   ✅ Safe execution passed.\n');

  console.log('5️⃣  Testing Acoustic Shock Shield Protection (Dangerous Jump)');
  try {
    // Attempt sudden +6.0 dB volume jump (must be blocked by safety shield!)
    await handlers.executeMixAdjustment({
      trackId: 'track_1',
      parameterName: 'fader_db',
      value: +1.5, // previous was -4.5 dB -> jump is +6.0 dB!
      isMaster: false
    });
    console.error('   ❌ ERROR: Acoustic Shield failed to block dangerous volume jump!');
    process.exit(1);
  } catch (shieldError: any) {
    console.log(`   - Shield Successfully Blocked Dangerous Jump: "${shieldError.message}"`);
    console.log('   ✅ Acoustic Shock Shield verification passed.\n');
  }

  console.log('6️⃣  Testing Tool: mcp__audition_region');
  const auditionResult = await handlers.auditionRegion({
    startBar: 16,
    endBar: 24,
    autoPlay: true
  });
  console.log(`   - Loop cycle set: Bars ${auditionResult.startBar} to ${auditionResult.endBar} (Playing: ${auditionResult.auditioning})`);
  console.log('   ✅ mcp__audition_region passed.\n');

  console.log('🎉 All 5 MCP Tools & AI Engine integration tests passed successfully!');
}

runMCPTest().catch((err) => {
  console.error('Fatal MCP test error:', err);
  process.exit(1);
});
