#pragma once

#include "LoudnessMeter.h"
#include "SpectralAnalyzer.h"
#include "TelemetryClient.h"
#include <juce_audio_processors/juce_audio_processors.h>

namespace mixing_buddy {

/**
 * MixingBuddyMeter Audio Processor ("The Ear")
 * Provides zero-latency, transparent audio metrology for VST3 and AudioUnit
 * (AU)
 */
class PluginProcessor : public juce::AudioProcessor {
public:
  PluginProcessor();
  ~PluginProcessor() override;

  // Audio lifecycle methods
  void prepareToPlay(double sampleRate, int samplesPerBlock) override;
  void releaseResources() override;
  void processBlock(juce::AudioBuffer<float> &buffer,
                    juce::MidiBuffer &midiMessages) override;

  // Processor configuration
  bool isBusesLayoutSupported(const BusesLayout &layouts) const override;
  juce::AudioProcessorEditor *createEditor() override;
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
  void changeProgramName(int, const juce::String &) override {}

  // State serialization
  void getStateInformation(juce::MemoryBlock &destData) override;
  void setStateInformation(const void *data, int sizeInBytes) override;

  // Project context & DAW session persistence (Sprint 3)
  void setProjectContext(const juce::String &scope, const juce::String &genre,
                         const juce::String &notes, double lufs);
  juce::String getTargetScope() const;
  juce::String getGenreProfile() const;
  juce::String getCustomNotes() const;
  double getTargetLufs() const;
  // Track identity & DAW integration (Phase 3 Multi-Instance)
  void updateTrackProperties(const TrackProperties &properties) override;
  juce::String getInstanceId() const noexcept { return mInstanceId; }
  juce::String getTrackName() const noexcept { return mTrackName; }

  // Metrology readouts
  LoudnessSnapshot getLoudnessSnapshot() const {
    return loudnessMeter.getSnapshot();
  }
  SpectralSnapshot getSpectralSnapshot() const {
    return spectralAnalyzer.getSnapshot();
  }
  bool isTelemetryConnected() const noexcept {
    return telemetryClient.isConnected();
  }

private:
  LoudnessMeter loudnessMeter;
  SpectralAnalyzer spectralAnalyzer;
  TelemetryClient telemetryClient;
  juce::AudioBuffer<float> scratchBuffer;

  mutable std::mutex contextMutex;
  juce::String currentTargetScope { "mix_bus" };
  juce::String currentGenreProfile { "pop_radio" };
  juce::String currentCustomNotes { "" };
  double currentTargetLufs { -12.0 };

  juce::String mInstanceId;
  juce::String mTrackName { "Track" };

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginProcessor)
};

} // namespace mixing_buddy
