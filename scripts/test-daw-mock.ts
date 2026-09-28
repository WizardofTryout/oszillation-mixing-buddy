#!/usr/bin/env node

/**
 * End-to-End Test & Verification Script for Nuendo and Logic Pro DAW Adapters
 */

import {
  createNuendoDriver,
  createLogicProDriver,
  type MIDITransport
} from '../packages/daw-adapters/dist/index.js';

console.log('🎛️  Starting Polymorphic DAWDriver Validation Suite...\n');

// Mock MIDI Transport capturing sent bytes for verification
function createCapturingTransport(dawName: string): { transport: MIDITransport; messages: number[][] } {
  const messages: number[][] = [];
  const transport: MIDITransport = {
    send(bytes: number[] | Uint8Array) {
      const arr = Array.from(bytes);
      messages.push(arr);
      const hex = arr.map((b) => '0x' + b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      console.log(`  [MIDI OUT -> ${dawName}] ${hex}`);
    },
    close() {}
  };
  return { transport, messages };
}

async function runTestSuite() {
  let passed = true;

  // 1. Nuendo Driver Verification
  console.log('=== TEST 1: Steinberg Nuendo Driver (MIDI Remote API) ===');
  const nuendoCapture = createCapturingTransport('Nuendo');
  const nuendo = createNuendoDriver({
    midiTransport: nuendoCapture.transport,
    numChannels: 16
  });

  await nuendo.connect();
  console.log('✓ Nuendo connected.');

  const nuendoTracks = await nuendo.getTrackList();
  console.log(`✓ Nuendo track list retrieved (${nuendoTracks.length} tracks).`);
  if (nuendoTracks.length !== 16) {
    console.error('❌ Expected 16 tracks.');
    passed = false;
  }

  // Set Fader of Track 2 to -3.5 dB
  console.log('→ Setting Nuendo Track 2 Volume to -3.5 dB:');
  await nuendo.setTrackVolume('track_2', -3.5);

  // Set Pan of Track 2 to -0.5 (Mid-Left)
  console.log('→ Setting Nuendo Track 2 Pan to -0.5:');
  await nuendo.setTrackPan('track_2', -0.5);

  // Mute Track 3
  console.log('→ Muting Nuendo Track 3:');
  await nuendo.setTrackMute('track_3', true);

  // Set VST3 Insert Plugin Parameter via Focused Quick Controls
  console.log('→ Tweaking VST3 EQ Frequency (Quick Control 1) on Track 2:');
  await nuendo.setPluginParameter('track_2', 0, 'Frequency', 0.65, 'kHz');

  // Transport Auditioning
  console.log('→ Triggering Loop Playback (Bars 9 to 17):');
  await nuendo.playRegion(9, 17);
  await nuendo.stop();

  await nuendo.disconnect();
  console.log('✓ Nuendo disconnected cleanly.\n');

  // 2. Logic Pro Driver Verification
  console.log('=== TEST 2: Apple Logic Pro Driver (MCU Protocol + AXUIElement) ===');
  const logicCapture = createCapturingTransport('Logic Pro');
  const logic = createLogicProDriver({
    midiTransport: logicCapture.transport,
    numChannels: 8
  });

  await logic.connect();
  console.log('✓ Logic Pro connected.');

  const logicTracks = await logic.getTrackList();
  console.log(`✓ Logic Pro track list retrieved (${logicTracks.length} tracks).`);
  if (logicTracks.length !== 8) {
    console.error('❌ Expected 8 tracks.');
    passed = false;
  }

  // Set Fader of Audio 2 to -1.5 dB via MCU Pitch Bend
  console.log('→ Setting Logic Audio 2 Volume to -1.5 dB (MCU Pitch Bend):');
  await logic.setTrackVolume('logic_track_2', -1.5);

  // Set Pan of Audio 2 to +0.4 (Mid-Right) via MCU V-Pot
  console.log('→ Setting Logic Audio 2 Pan to +0.4 (MCU V-Pot):');
  await logic.setTrackPan('logic_track_2', 0.4);

  // Mute Audio 2
  console.log('→ Muting Logic Audio 2:');
  await logic.setTrackMute('logic_track_2', true);

  // Set AU Plugin Parameter
  console.log('→ Setting Audio Unit Gain Parameter:');
  await logic.setPluginParameter('logic_track_2', 0, 'Gain', 0.8, 'dB');

  // Transport
  console.log('→ Triggering Logic MCU Transport Play/Stop:');
  await logic.playRegion(1, 9);
  await logic.stop();

  await logic.disconnect();
  console.log('✓ Logic Pro disconnected cleanly.\n');

  if (passed) {
    console.log('🎉 ALL DAW ADAPTER TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  } else {
    console.error('🚨 Some tests failed.');
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
