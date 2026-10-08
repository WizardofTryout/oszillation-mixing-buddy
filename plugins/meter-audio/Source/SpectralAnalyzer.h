#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>
#include <vector>
#include <array>
#include <mutex>

namespace mixing_buddy
{

struct SpectralResonance
{
    float frequencyHz { 0.0f };
    float magnitudeDb { -100.0f };
    float qEstimate { 1.0f };
};

struct SpectralSnapshot
{
    std::array<float, 32> frequencyBands;       // 32 1/3-octave bands (-100 dB to 0 dB)
    std::array<float, 128> spectrum128Bands;    // 128 high-res log bands (-90 dB to 0 dB)
    std::array<float, 32> centerFrequenciesHz;  // Center frequencies in Hz
    std::vector<SpectralResonance> resonances;  // Top detected resonance peaks
    float stereoCorrelation { 1.0f };           // -1.0 (anti-phase) to +1.0 (mono)
    float crestFactorDb { 0.0f };               // Peak-to-RMS dynamic crest factor
    float rmsLeftDb { -100.0f };
    float rmsRightDb { -100.0f };
};

/**
 * 1024-Point FFT Spectral Analyzer with 32-band Logarithmic Binning and Stereo Dynamics
 */
class SpectralAnalyzer
{
public:
    static constexpr int fftOrder = 10;
    static constexpr int fftSize = 1 << fftOrder; // 1024 points

    SpectralAnalyzer();
    ~SpectralAnalyzer() = default;

    void prepare(double sampleRate, int samplesPerBlock, int numChannels);
    void reset();
    void processBlock(const juce::AudioBuffer<float>& buffer);

    SpectralSnapshot getSnapshot() const;

private:
    void performFFT();
    void binSpectrum();
    void findResonances();

    double currentSampleRate { 44100.0 };
    int channels { 2 };

    // JUCE DSP FFT & Windowing
    juce::dsp::FFT forwardFFT;
    juce::dsp::WindowingFunction<float> windowFunction;

    // Circular input buffer for 1024 samples
    std::array<float, fftSize> fifoBuffer {};
    int fifoIndex { 0 };

    // FFT processing buffers
    std::array<float, fftSize * 2> fftData {};
    std::array<float, fftSize / 2> magnitudeSpectrum {};

    // Standard 32 1/3-octave center frequencies (Hz)
    static const std::array<float, 32> standardFrequencies;

    // Smoothed logarithmic band magnitudes
    std::array<float, 32> smoothedBands {};
    std::array<float, 128> smoothed128Bands {};

    // Correlation & dynamics accumulators
    double sumL2 { 0.0 };
    double sumR2 { 0.0 };
    double sumLR { 0.0 };
    float peakValue { 0.0f };
    int sampleAccumulator { 0 };

    mutable std::mutex snapshotMutex;
    SpectralSnapshot latestSnapshot;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SpectralAnalyzer)
};

} // namespace mixing_buddy
