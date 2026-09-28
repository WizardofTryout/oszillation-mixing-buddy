/**
 * Steinberg MIDI Remote API Driver Script for Nuendo & Cubase 12+
 * Manufacturer: OszillationStudio
 * Device: MixingBuddy
 * 
 * Provides native 14-bit bidirectional control over mixer faders, pans, mutes,
 * Focused Quick Controls (VST3 parameters), and transport.
 */

var midiremote_api = require('midiremote_api_v1');

var deviceDriver = midiremote_api.makeDeviceDriver('OszillationStudio', 'MixingBuddy', 'AI Mixing Assistant');

// Define virtual MIDI port pair
var midiInput = deviceDriver.mPorts.makePortPair('AI_Mix_Agent_To_Nuendo', 'Nuendo_To_AI_Mix_Agent').mInput;
var midiOutput = deviceDriver.mPorts.makePortPair('AI_Mix_Agent_To_Nuendo', 'Nuendo_To_AI_Mix_Agent').mOutput;

// Port pair detection rules (supports both custom virtual ports and standard macOS IAC Bus)
deviceDriver.makeDetectionUnit().detectPortPairRequest(midiInput, midiOutput)
    .expectInputNameEquals('AI_Mix_Agent_To_Nuendo')
    .expectOutputNameEquals('Nuendo_To_AI_Mix_Agent');

deviceDriver.makeDetectionUnit().detectPortPairRequest(midiInput, midiOutput)
    .expectInputNameEquals('IAC-Treiber Bus 1')
    .expectOutputNameEquals('IAC-Treiber Bus 1');

deviceDriver.makeDetectionUnit().detectPortPairRequest(midiInput, midiOutput)
    .expectInputNameEquals('IAC Driver Bus 1')
    .expectOutputNameEquals('IAC Driver Bus 1');

var surface = deviceDriver.mSurface;

// Create 16 14-bit Mixer Channels per bank
var NUM_CHANNELS = 16;
var faders = [];
var pans = [];
var mutes = [];

for (var i = 0; i < NUM_CHANNELS; ++i) {
    // 14-Bit High-Resolution Volume Faders: CC 0-15 (MSB) + CC 32-47 (LSB)
    var fader = surface.makeFader(i * 2, 0, 2, 8);
    fader.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange14Bit(0, i, i + 32);
    faders.push(fader);

    // Pan Pots: CC 16-31
    var pan = surface.makeKnob(i * 2, 9, 2, 2);
    pan.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange(0, 16 + i);
    pans.push(pan);

    // Mute Buttons: Note On 16-31
    var mute = surface.makeButton(i * 2, 12, 2, 2);
    mute.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToNote(0, 16 + i);
    mutes.push(mute);
}

// 8 Focused Quick Controls for active VST3 Insert Plugin tweaking: CC 48-55 (MSB) + CC 80-87 (LSB)
var quickControls = [];
for (var q = 0; q < 8; ++q) {
    var qc = surface.makeKnob(q * 4, 15, 3, 3);
    qc.mSurfaceValue.mMidiBinding
        .setInputPort(midiInput)
        .setOutputPort(midiOutput)
        .bindToControlChange14Bit(0, 48 + q, 80 + q);
    quickControls.push(qc);
}

// Transport Buttons (Play: CC 114, Stop: CC 115, Cycle: CC 116)
var btnPlay = surface.makeButton(0, 19, 3, 2);
btnPlay.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(0, 114);

var btnStop = surface.makeButton(4, 19, 3, 2);
btnStop.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(0, 115);

var btnCycle = surface.makeButton(8, 19, 3, 2);
btnCycle.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(0, 116);

// Mapping Page
var page = deviceDriver.mMapping.makePage('Mixing Buddy Main Page');
var mixerBank = page.mHostAccess.mMixConsole.makeMixerBankZone('MixingBuddyMixerBank');
mixerBank.excludeStereoOut(false);

for (var ch = 0; ch < NUM_CHANNELS; ++ch) {
    var channel = mixerBank.makeMixerBankChannel();
    page.makeValueBinding(faders[ch].mSurfaceValue, channel.mValue.mVolume);
    page.makeValueBinding(pans[ch].mSurfaceValue, channel.mValue.mPan);
    page.makeValueBinding(mutes[ch].mSurfaceValue, channel.mValue.mMute);
}

// Bind Focused Quick Controls
var hostQC = page.mHostAccess.mFocusedQuickControls;
for (var k = 0; k < 8; ++k) {
    page.makeValueBinding(quickControls[k].mSurfaceValue, hostQC.getByIndex(k));
}

// Bind Transport Controls
var hostTransport = page.mHostAccess.mTransport;
page.makeValueBinding(btnPlay.mSurfaceValue, hostTransport.mValue.mStart);
page.makeValueBinding(btnStop.mSurfaceValue, hostTransport.mValue.mStop);
page.makeValueBinding(btnCycle.mSurfaceValue, hostTransport.mValue.mCycleActive);
