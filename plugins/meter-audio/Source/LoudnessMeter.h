#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>
#include <vector>
#include <mutex>

namespace mixing_buddy
{

struct LoudnessSnapshot
{
    float momentaryLufs { -100.0f };
    float shortTermLufs { -100.0f };
    float integratedLufs { -100.0f };
    float loudnessRangeLu { 0.0f };
    float truePeakLeftDb { -100.0f };
    float truePeakRightDb { -100.0f };
};

/**
 * Real-time EBU R128 / ITU-R BS.1770-4 Loudness Meter
 * Calculates Momentary (400ms), Short-Term (3s), Integrated LUFS, and 4x True Peak
 */
class LoudnessMeter
{
public:
    LoudnessMeter();
    ~LoudnessMeter() = default;

    void prepare(double sampleRate, int samplesPerBlock, int numChannels);
    void reset();
    void processBlock(const juce::AudioBuffer<float>& buffer);

    LoudnessSnapshot getSnapshot() const;

private:
    void updateFilters(double sampleRate);
    static float powerToLufs(double power);

    double currentSampleRate { 44100.0 };
    int channels { 2 };

    // K-Weighting filter stages (Stage 1: Pre-filter high-shelf, Stage 2: RLB high-pass)
    using IIRFilter = juce::dsp::IIR::Filter<float>;
    using IIRCoefficients = juce::dsp::IIR::Coefficients<float>;

    std::vector<IIRFilter> stage1Filters;
    std::vector<IIRFilter> stage2Filters;

    // Sliding window buffers for 400ms (momentary) and 3s (short-term)
    std::vector<double> momentaryRingBuffer;
    int momentaryRingIndex { 0 };
    int momentaryWindowLengthSamples { 0 };
    double momentarySum { 0.0 };

    std::vector<double> shortTermRingBuffer;
    int shortTermRingIndex { 0 };
    int shortTermWindowLengthSamples { 0 };
    double shortTermSum { 0.0 };

    // Integrated loudness gating blocks (100ms blocks according to BS.1770)
    int samplesPer100ms { 0 };
    int integratedAccumulatorSamples { 0 };
    int silentBlockCount { 0 };
    double integratedBlockPowerSum { 0.0 };
    std::vector<double> integratedGatingBlocks;

    // 4x True Peak detector using juce::dsp::Oversampling
    std::unique_ptr<juce::dsp::Oversampling<float>> oversampler;
    float currentTruePeakL { -100.0f };
    float currentTruePeakR { -100.0f };

    mutable std::mutex snapshotMutex;
    LoudnessSnapshot latestSnapshot;

    juce::AudioBuffer<float> filteredBuffer;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(LoudnessMeter)
};

} // namespace mixing_buddy
