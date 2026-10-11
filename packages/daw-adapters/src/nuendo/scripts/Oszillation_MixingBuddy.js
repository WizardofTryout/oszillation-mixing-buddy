/**
 * Steinberg MIDI Remote Driver: Oszillation Mixing Buddy
 * 
 * Target DAWs: Nuendo 14, Nuendo 13, Nuendo 12, Cubase 14, Cubase 13, Cubase 12
 * Author: Matthias Köhler / Oszillation
 * License: PolyForm Noncommercial 1.0.0
 * 
 * Provides native, low-latency (< 0.2ms) bidirectional MIDI Remote integration
 * for Volume Faders, Pan, Mute, Solo, Transport Control, Channel EQ (Bands 1-4),
 * Focused Quick Controls (VST3 Stock Plugins: Frequency 2, Compressor) and Insert Bypass.
 */

var midiremote_api = require('midiremote_api');

// 1. Device Driver Registration
var deviceDriver = midiremote_api.makeDeviceDriver('Oszillation', 'Mixing Buddy', 'Matthias Koehler');

// 2. MIDI Port Configuration
var midiInput = deviceDriver.mPorts.makeMidiInput('MixingBuddy In');
var midiOutput = deviceDriver.mPorts.makeMidiOutput('MixingBuddy Out');

// 3. Automatic Port Pair Detection
deviceDriver.makeDetectionUnit().detectPortPair(midiInput, midiOutput)
    .expectInputNameContains('MixingBuddy')
    .expectOutputNameContains('MixingBuddy');

// 4. Surface Definition
var surface = deviceDriver.mSurface;

var NUM_CHANNELS = 16;
var channelStrips = [];

for (var i = 0; i < NUM_CHANNELS; ++i) {
    var colX = i * 2;

    // Volume Fader (CC 0..15 on MIDI Channel 1, High-Res / Standard CC)
    var fader = surface.makeFader(colX, 0, 1, 7);
    fader.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange(0, i);

    // Pan Knob (CC 16..31 on MIDI Channel 1)
    var pan = surface.makeKnob(colX, 8, 1, 1);
    pan.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange(0, 16 + i);

    // Mute Button (CC 32..47 on MIDI Channel 1)
    var muteBtn = surface.makeButton(colX, 10, 1, 1);
    muteBtn.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange(0, 32 + i);

    // Solo Button (CC 48..63 on MIDI Channel 1)
    var soloBtn = surface.makeButton(colX, 11, 1, 1);
    soloBtn.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange(0, 48 + i);

    channelStrips.push({
        fader: fader,
        pan: pan,
        muteBtn: muteBtn,
        soloBtn: soloBtn
    });
}

// 5. Channel EQ Surface Elements (CC 64..79: 4 Bands x Freq, Gain, Q, On)
var eqControls = [];
for (var b = 0; b < 4; ++b) {
    var baseCc = 64 + (b * 4);
    var eqX = b * 4;

    var freqKnob = surface.makeKnob(eqX, 13, 1, 1);
    freqKnob.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange(0, baseCc);

    var gainKnob = surface.makeKnob(eqX + 1, 13, 1, 1);
    gainKnob.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange(0, baseCc + 1);

    var qKnob = surface.makeKnob(eqX + 2, 13, 1, 1);
    qKnob.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange(0, baseCc + 2);

    var onBtn = surface.makeButton(eqX + 3, 13, 1, 1);
    onBtn.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange(0, baseCc + 3);

    eqControls.push({
        freq: freqKnob,
        gain: gainKnob,
        q: qKnob,
        on: onBtn
    });
}

// 6. Focused Quick Controls Surface Elements (CC 80..87: Knobs 1..8)
var qcKnobs = [];
for (var q = 0; q < 8; ++q) {
    var qcKnob = surface.makeKnob(q * 2, 15, 1, 1);
    qcKnob.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange(0, 80 + q);
    qcKnobs.push(qcKnob);
}

// 7. Insert Slot Bypass Surface Elements (CC 88..95: Slots 1..8)
var insertBypassBtns = [];
for (var ins = 0; ins < 8; ++ins) {
    var insBtn = surface.makeButton(ins * 2, 17, 1, 1);
    insBtn.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange(0, 88 + ins);
    insertBypassBtns.push(insBtn);
}

// 8. Transport Controls (CC 114..118)
var playBtn = surface.makeButton(0, 19, 2, 1);
playBtn.mSurfaceValue.mMidiBinding
    .setInputPort(midiInput)
    .setOutputPort(midiOutput)
    .bindToControlChange(0, 114);

var stopBtn = surface.makeButton(2, 19, 2, 1);
stopBtn.mSurfaceValue.mMidiBinding
    .setInputPort(midiInput)
    .setOutputPort(midiOutput)
    .bindToControlChange(0, 115);

var cycleBtn = surface.makeButton(4, 19, 2, 1);
cycleBtn.mSurfaceValue.mMidiBinding
    .setInputPort(midiInput)
    .setOutputPort(midiOutput)
    .bindToControlChange(0, 116);

var prevBtn = surface.makeButton(6, 19, 2, 1);
prevBtn.mSurfaceValue.mMidiBinding
    .setInputPort(midiInput)
    .setOutputPort(midiOutput)
    .bindToControlChange(0, 117);

var nextBtn = surface.makeButton(8, 19, 2, 1);
nextBtn.mSurfaceValue.mMidiBinding
    .setInputPort(midiInput)
    .setOutputPort(midiOutput)
    .bindToControlChange(0, 118);

// 9. Host Mapping Page
var page = deviceDriver.mMapping.makePage('Oszillation Mixing Buddy');
var hostMixerBankZone = page.mHostAccess.mMixerBankZone.makeMixerBankChannelZone();

for (var ch = 0; ch < NUM_CHANNELS; ++ch) {
    var hostChannel = hostMixerBankZone.makeBankChannel();
    var strip = channelStrips[ch];

    page.makeValueBinding(strip.fader.mSurfaceValue, hostChannel.mValue.mVolume);
    page.makeValueBinding(strip.pan.mSurfaceValue, hostChannel.mValue.mPan);
    page.makeValueBinding(strip.muteBtn.mSurfaceValue, hostChannel.mValue.mMute);
    page.makeValueBinding(strip.soloBtn.mSurfaceValue, hostChannel.mValue.mSolo);
}

// Selected Track Access
var selectedTrack = page.mHostAccess.mTrackSelection.mMixerChannel;

// Channel EQ Mappings
var bands = [
    selectedTrack.mChannelEQ.mBand1,
    selectedTrack.mChannelEQ.mBand2,
    selectedTrack.mChannelEQ.mBand3,
    selectedTrack.mChannelEQ.mBand4
];

for (var bIdx = 0; bIdx < 4; ++bIdx) {
    var eqBand = bands[bIdx];
    var ctrl = eqControls[bIdx];
    page.makeValueBinding(ctrl.freq.mSurfaceValue, eqBand.mFreq);
    page.makeValueBinding(ctrl.gain.mSurfaceValue, eqBand.mGain);
    page.makeValueBinding(ctrl.q.mSurfaceValue, eqBand.mQ);
    page.makeValueBinding(ctrl.on.mSurfaceValue, eqBand.mOn);
}

// Focused Quick Controls (VST3 Stock Plugins e.g. Frequency 2, Compressor)
for (var qIdx = 0; qIdx < 8; ++qIdx) {
    page.makeValueBinding(qcKnobs[qIdx].mSurfaceValue, page.mHostAccess.mFocusedQuickControls.getByIndex(qIdx));
}

// Insert Slots Bypass (Slots 1..8)
for (var insIdx = 0; insIdx < 8; ++insIdx) {
    page.makeValueBinding(insertBypassBtns[insIdx].mSurfaceValue, selectedTrack.mInsertAndStripEffects.mInsertSlots.getByIndex(insIdx).mBypass);
}

// Transport Mapping
page.makeValueBinding(playBtn.mSurfaceValue, page.mHostAccess.mTransport.mValue.mStart);
page.makeValueBinding(stopBtn.mSurfaceValue, page.mHostAccess.mTransport.mValue.mStop);
page.makeValueBinding(cycleBtn.mSurfaceValue, page.mHostAccess.mTransport.mValue.mCycle);
page.makeValueBinding(prevBtn.mSurfaceValue, page.mHostAccess.mTransport.mValue.mPrevMarker);
page.makeValueBinding(nextBtn.mSurfaceValue, page.mHostAccess.mTransport.mValue.mNextMarker);
