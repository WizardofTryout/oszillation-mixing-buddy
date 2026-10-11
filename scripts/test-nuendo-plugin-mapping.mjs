#!/usr/bin/env node

/**
 * Sprint 9 Verification Suite:
 * Tests Nuendo/Steinberg Plugin Parameter Normalization, Acoustic Shock Shield,
 * and MIDI Remote Driver parameter execution (Channel EQ, Frequency 2, Compressor).
 */

import {
  hzToNorm,
  normToHz,
  gainDbToNorm,
  normToGainDb,
  qToNorm,
  normToQ,
  ratioToNorm,
  normToRatio,
  msToNorm,
  normToMs,
  applyShockShieldGuard,
  resolveNuendoParameter,
  createNuendoDriver
} from '../packages/daw-adapters/dist/index.js';

console.log('🧪 Starting Sprint 9: Steinberg Plugin Parameter & Normalization Verification Suite...\n');

let passed = true;

function assert(condition, msg) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    passed = false;
  } else {
    console.log(`✓ ${msg}`);
  }
}

// ── 1. Transformation Mathematics ─────────────────────────────────────────────
console.log('--- 1. Bidirectional Mathematics & Curves ---');

// Frequency (20 Hz .. 20,000 Hz Logarithmic)
const fNorm = hzToNorm(1000);
const fBack = normToHz(fNorm);
assert(Math.abs(fBack - 1000) < 0.1, `Hz roundtrip: 1000 Hz -> ${fNorm.toFixed(4)} -> ${fBack.toFixed(1)} Hz`);

assert(Math.abs(hzToNorm(20)) < 0.001, '20 Hz maps to 0.0');
assert(Math.abs(hzToNorm(20000) - 1.0) < 0.001, '20,000 Hz maps to 1.0');

// Gain (-24 dB .. +24 dB Linear)
const gNorm = gainDbToNorm(0);
const gBack = normToGainDb(gNorm);
assert(Math.abs(gNorm - 0.5) < 0.001, '0 dB maps to 0.5 center');
assert(Math.abs(gBack - 0) < 0.001, `0 dB roundtrip: 0 dB -> ${gNorm.toFixed(2)} -> ${gBack.toFixed(1)} dB`);

// Q-Factor (0.5 .. 100.0 Logarithmic)
const qNorm = qToNorm(1.0);
const qBack = normToQ(qNorm);
assert(Math.abs(qBack - 1.0) < 0.01, `Q roundtrip: 1.0 -> ${qNorm.toFixed(4)} -> ${qBack.toFixed(2)}`);

// Ratio (1.0 .. 8.0 Linear)
const rNorm = ratioToNorm(4.0);
const rBack = normToRatio(rNorm);
assert(Math.abs(rBack - 4.0) < 0.01, `Ratio roundtrip: 4:1 -> ${rNorm.toFixed(4)} -> ${rBack.toFixed(2)}:1`);

// Time ms (Attack: 0.1ms .. 100ms Logarithmic)
const msNorm = msToNorm(20, 0.1, 100);
const msBack = normToMs(msNorm, 0.1, 100);
assert(Math.abs(msBack - 20) < 0.1, `Time ms roundtrip: 20 ms -> ${msNorm.toFixed(4)} -> ${msBack.toFixed(2)} ms`);

// ── 2. Acoustic Shock Shield Guard ────────────────────────────────────────────
console.log('\n--- 2. Acoustic Shock Shield Guard (+3.0 dB safety clamp) ---');

// Attenuation (Delta <= 0) passes 100%
const atten = applyShockShieldGuard(0.0, -6.0);
assert(atten === -6.0, `Attenuation passes freely (0.0 dB -> ${atten} dB)`);

// Moderate boost (+2.0 dB) passes freely
const safeBoost = applyShockShieldGuard(0.0, 2.0);
assert(safeBoost === 2.0, `Moderate boost +2.0 dB passes freely (0.0 dB -> ${safeBoost} dB)`);

// Dangerous boost (+6.0 dB) is strictly clamped to +3.0 dB
const dangerousBoost = applyShockShieldGuard(0.0, 6.0);
assert(dangerousBoost === 3.0, `Dangerous boost +6.0 dB clamped to +3.0 dB (${dangerousBoost} dB)`);

// A/B Restore passes even if jumping > 3.0 dB
const restoreJump = applyShockShieldGuard(-6.0, 0.0, true);
assert(restoreJump === 0.0, `A/B restore passes without clamp (-6.0 dB -> ${restoreJump} dB)`);

// ── 3. Canonical Parameter Resolution ─────────────────────────────────────────
console.log('\n--- 3. Canonical Parameter Resolution (Frequency 2, Channel EQ, Compressor) ---');

// Channel EQ Band 1 Gain
const eqRes = resolveNuendoParameter('Channel EQ', 'Band 1 Gain', -3.0, 0.0);
assert(eqRes !== null, 'Resolved Channel EQ Band 1 Gain');
assert(eqRes?.definition.ccNumber === 65, 'Channel EQ Band 1 Gain has CC 65');
assert(eqRes?.clampedDisplayValue === -3.0, 'Value preserved (-3.0 dB)');

// Frequency 2 High-Mid Gain (with Acoustic Shock Shield)
const freqRes = resolveNuendoParameter('Frequency 2', 'high_mid_gain', 6.0, 0.0);
assert(freqRes !== null, 'Resolved Frequency 2 high_mid_gain');
assert(freqRes?.definition.qcIndex === 4, 'Frequency 2 high_mid_gain has Quick Control index 4');
assert(freqRes?.clampedDisplayValue === 3.0, 'Frequency 2 gain clamped by Shock Shield to +3.0 dB');

// Compressor Threshold & Ratio
const compThresh = resolveNuendoParameter('Compressor', 'threshold', -24.0);
assert(compThresh !== null && compThresh.definition.qcIndex === 0, 'Compressor Threshold has Quick Control 0');
const compRatio = resolveNuendoParameter('Compressor', 'ratio', 4.0);
assert(compRatio !== null && compRatio.definition.qcIndex === 1, 'Compressor Ratio has Quick Control 1');

// ── 4. NuendoDriver MIDI Remote Execution ─────────────────────────────────────
console.log('\n--- 4. NuendoDriver MIDI Remote Execution ---');

const sentMessages = [];
const mockTransport = {
  send(bytes) {
    sentMessages.push(Array.from(bytes));
  },
  close() {}
};

const nuendo = createNuendoDriver({ midiTransport: mockTransport });
await nuendo.connect();

// Test Channel EQ Parameter setting via CC 65
await nuendo.setPluginParameter('track_1', 0, 'Band 1 Gain', -3.0, 'dB');
const lastMsg = sentMessages[sentMessages.length - 1];
assert(lastMsg[0] === 0xb0 && lastMsg[1] === 65, `Channel EQ CC 65 emitted: [0x${lastMsg[0].toString(16)}, ${lastMsg[1]}, ${lastMsg[2]}]`);

// Test Focused Quick Control (Frequency 2 High Mid Gain -> QC 4 -> CC 84)
await nuendo.setPluginParameter('track_1', 0, 'high_mid_gain', 2.0, 'dB');
const qcMsg = sentMessages[sentMessages.length - 1];
assert(qcMsg[0] === 0xb0 && qcMsg[1] === 84, `Quick Control CC 84 emitted: [0x${qcMsg[0].toString(16)}, ${qcMsg[1]}, ${qcMsg[2]}]`);

// Test Insert Bypass on Slot 0 -> CC 88
await nuendo.togglePluginBypass('track_1', 0);
const bypassMsg = sentMessages[sentMessages.length - 1];
assert(bypassMsg[0] === 0xb0 && bypassMsg[1] === 88, `Insert Bypass CC 88 emitted: [0x${bypassMsg[0].toString(16)}, ${bypassMsg[1]}, ${bypassMsg[2]}]`);

await nuendo.disconnect();

if (passed) {
  console.log('\n🎉 ALL SPRINT 9 TESTS PASSED WITH 100% SUCCESS!');
  process.exit(0);
} else {
  console.error('\n🚨 Sprint 9 verification encountered failures.');
  process.exit(1);
}
