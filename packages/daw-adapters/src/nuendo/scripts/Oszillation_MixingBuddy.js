/**
 * Steinberg MIDI Remote Driver: Oszillation Mixing Buddy
 * 
 * Target DAWs: Nuendo 14, Nuendo 13, Nuendo 12, Cubase 14, Cubase 13, Cubase 12
 * Author: Matthias Köhler / Oszillation
 * License: PolyForm Noncommercial 1.0.0
 * 
 * Provides native, low-latency (< 0.2ms) bidirectional MIDI Remote integration
 * for Volume Faders, Pan, Mute, Solo and Transport Control without screen scraping.
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

// 5. Transport Controls
// Play (CC 114)
var playBtn = surface.makeButton(0, 13, 2, 1);
playBtn.mSurfaceValue.mMidiBinding
    .setInputPort(midiInput)
    .setOutputPort(midiOutput)
    .bindToControlChange(0, 114);

// Stop (CC 115)
var stopBtn = surface.makeButton(2, 13, 2, 1);
stopBtn.mSurfaceValue.mMidiBinding
    .setInputPort(midiInput)
    .setOutputPort(midiOutput)
    .bindToControlChange(0, 115);

// Cycle / Loop (CC 116)
var cycleBtn = surface.makeButton(4, 13, 2, 1);
cycleBtn.mSurfaceValue.mMidiBinding
    .setInputPort(midiInput)
    .setOutputPort(midiOutput)
    .bindToControlChange(0, 116);

// Rewind / Prev Marker (CC 117)
var prevBtn = surface.makeButton(6, 13, 2, 1);
prevBtn.mSurfaceValue.mMidiBinding
    .setInputPort(midiInput)
    .setOutputPort(midiOutput)
    .bindToControlChange(0, 117);

// Fast Forward / Next Marker (CC 118)
var nextBtn = surface.makeButton(8, 13, 2, 1);
nextBtn.mSurfaceValue.mMidiBinding
    .setInputPort(midiInput)
    .setOutputPort(midiOutput)
    .bindToControlChange(0, 118);

// 6. Host Mapping Page
var page = deviceDriver.mMapping.makePage('Oszillation Mixing Buddy');
var hostMixerBankZone = page.mHostAccess.mMixerBankZone.makeMixerBankChannelZone();

for (var ch = 0; ch < NUM_CHANNELS; ++ch) {
    var hostChannel = hostMixerBankZone.makeBankChannel();
    var strip = channelStrips[ch];

    // Volume with standard DAW dB scaling
    page.makeValueBinding(strip.fader.mSurfaceValue, hostChannel.mValue.mVolume);

    // Pan (-1.0 Left .. 0.0 Center .. +1.0 Right)
    page.makeValueBinding(strip.pan.mSurfaceValue, hostChannel.mValue.mPan);

    // Mute
    page.makeValueBinding(strip.muteBtn.mSurfaceValue, hostChannel.mValue.mMute);

    // Solo
    page.makeValueBinding(strip.soloBtn.mSurfaceValue, hostChannel.mValue.mSolo);
}

// Transport Mapping
page.makeValueBinding(playBtn.mSurfaceValue, page.mHostAccess.mTransport.mValue.mStart);
page.makeValueBinding(stopBtn.mSurfaceValue, page.mHostAccess.mTransport.mValue.mStop);
page.makeValueBinding(cycleBtn.mSurfaceValue, page.mHostAccess.mTransport.mValue.mCycle);
page.makeValueBinding(prevBtn.mSurfaceValue, page.mHostAccess.mTransport.mValue.mPrevMarker);
page.makeValueBinding(nextBtn.mSurfaceValue, page.mHostAccess.mTransport.mValue.mNextMarker);
