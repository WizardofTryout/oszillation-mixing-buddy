import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSpectralDifference,
  generateReferenceMatchProposal
} from '../dist/index.js';

test('computeSpectralDifference detects excess in bass region > 2.5 dB', () => {
  const liveBands = new Array(32).fill(-30);
  const refBands = new Array(32).fill(-30);

  // Add +3.2 dB excess in bass region (80-140 Hz, bands 6 to 8)
  liveBands[6] = -26.8;
  liveBands[7] = -26.5;

  const analysis = computeSpectralDifference(liveBands, refBands, 0, 2.5);

  assert.ok(analysis.primaryDeviation !== null);
  assert.equal(analysis.primaryDeviation.isExcess, true);
  assert.ok(analysis.primaryDeviation.deltaDb >= 3.0);
  assert.match(analysis.primaryDeviation.label, /Überhang/);
});

test('computeSpectralDifference returns null primary deviation when within tolerance', () => {
  const liveBands = new Array(32).fill(-30);
  const refBands = new Array(32).fill(-31); // only 1 dB delta

  const analysis = computeSpectralDifference(liveBands, refBands, 0, 2.5);
  assert.equal(analysis.primaryDeviation, null);
  assert.equal(analysis.deviantZones.length, 0);
});

test('generateReferenceMatchProposal creates Channel EQ proposal', () => {
  const liveBands = new Array(32).fill(-30);
  const refBands = new Array(32).fill(-30);

  // Mud region excess (250 - 500 Hz, bands 12 to 14)
  liveBands[12] = -26.0;
  liveBands[13] = -25.5;

  const telemetry = {
    version: '1.0',
    sequenceNumber: 1,
    sampleRate: 44100,
    loudness: {
      momentaryLufs: -14.0,
      shortTermLufs: -14.0,
      integratedLufs: -14.0,
      loudnessRangeLu: 6.0,
      truePeakDb: { left: -1.0, right: -1.0 }
    },
    spectrum: {
      timestamp: Date.now(),
      frequencyBands: liveBands,
      centerFrequenciesHz: [],
      spectralResonances: []
    },
    dynamics: {
      stereoCorrelation: 0.9,
      crestFactorDb: 10.0,
      rmsDb: { left: -16.0, right: -16.0 }
    }
  };

  const reference = {
    id: 'test-ref',
    name: 'Dua Lipa - Levitating',
    fileName: 'levitating.wav',
    fileFormat: 'wav',
    durationSeconds: 203,
    sampleRate: 44100,
    channels: 2,
    integratedLufs: -11.5,
    truePeakDb: -0.3,
    crestFactorDb: 10.2,
    frequencyBands: refBands,
    timestamp: Date.now()
  };

  const tracks = [
    {
      id: 'track-master',
      name: 'Stereo Out',
      type: 'master',
      volume: 0.0,
      pan: 0.0,
      isMuted: false,
      isSoloed: false,
      plugins: []
    }
  ];

  const proposal = generateReferenceMatchProposal(telemetry, reference, tracks, 0, 2.5);

  assert.ok(proposal !== null);
  assert.equal(proposal.category, 'eq_tonal_balance');
  assert.match(proposal.title, /Levitating/);
  assert.ok(proposal.deltas.length >= 2);

  // Has gain cut delta
  const gainDelta = proposal.deltas.find((d) => d.parameterName.includes('gain'));
  assert.ok(gainDelta !== null);
  assert.ok(gainDelta.proposedValue < 0);
});
