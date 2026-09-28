#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "LoudnessMeter.h"
#include "SpectralAnalyzer.h"
#include "TelemetryClient.h"

namespace mixing_buddy
{

/**
 * MixingBuddyMeter Audio Processor ("The Ear")
 * Provides zero-latency, transparent audio metrology for VST3 and AudioUnit (AU)
 */
class PluginProcessor : public juce::AudioProcessor
{
public:
    PluginProcessor();
    ~PluginProcessor() override;

    // Audio lifecycle methods
    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages) override;

    // Processor configuration
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "MixingBuddyMeter"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    // Programs & Presets
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    // State serialization
    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    // Metrology readouts
    LoudnessSnapshot getLoudnessSnapshot() const { return loudnessMeter.getSnapshot(); }
    SpectralSnapshot getSpectralSnapshot() const { return spectralAnalyzer.getSnapshot(); }
    bool isTelemetryConnected() const noexcept { return telemetryClient.isConnected(); }

private:
    LoudnessMeter loudnessMeter;
    SpectralAnalyzer spectralAnalyzer;
    TelemetryClient telemetryClient;
    juce::AudioBuffer<float> scratchBuffer;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginProcessor)
};

} // namespace mixing_buddy
