#include "SpectralAnalyzer.h"
#include <cmath>
#include <algorithm>

namespace mixing_buddy
{

const std::array<float, 32> SpectralAnalyzer::standardFrequencies = {
    20.0f, 25.0f, 31.5f, 40.0f, 50.0f, 63.0f, 80.0f, 100.0f,
    125.0f, 160.0f, 200.0f, 250.0f, 315.0f, 400.0f, 500.0f, 630.0f,
    800.0f, 1000.0f, 1250.0f, 1600.0f, 2000.0f, 2500.0f, 3150.0f, 4000.0f,
    5000.0f, 6300.0f, 8000.0f, 10000.0f, 12500.0f, 16000.0f, 18000.0f, 20000.0f
};

SpectralAnalyzer::SpectralAnalyzer()
    : forwardFFT(fftOrder),
      windowFunction(fftSize, juce::dsp::WindowingFunction<float>::blackmanHarris)
{
    smoothedBands.fill(-100.0f);
    latestSnapshot.frequencyBands.fill(-100.0f);
    latestSnapshot.centerFrequenciesHz = standardFrequencies;
}

void SpectralAnalyzer::prepare(double sampleRate, int /*samplesPerBlock*/, int numChannels)
{
    currentSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
    channels = std::max(1, numChannels);
    reset();
}

void SpectralAnalyzer::reset()
{
    fifoBuffer.fill(0.0f);
    fifoIndex = 0;
    fftData.fill(0.0f);
    magnitudeSpectrum.fill(-100.0f);
    smoothedBands.fill(-100.0f);
    smoothed128Bands.fill(-90.0f);

    sumL2 = 0.0;
    sumR2 = 0.0;
    sumLR = 0.0;
    peakValue = 0.0f;
    sampleAccumulator = 0;

    std::lock_guard<std::mutex> lock(snapshotMutex);
    latestSnapshot.frequencyBands.fill(-100.0f);
    latestSnapshot.spectrum128Bands.fill(-90.0f);
    latestSnapshot.centerFrequenciesHz = standardFrequencies;
    latestSnapshot.resonances.clear();
    latestSnapshot.stereoCorrelation = 1.0f;
    latestSnapshot.crestFactorDb = 0.0f;
    latestSnapshot.rmsLeftDb = -100.0f;
    latestSnapshot.rmsRightDb = -100.0f;
}

void SpectralAnalyzer::processBlock(const juce::AudioBuffer<float>& buffer)
{
    const int numSamples = buffer.getNumSamples();
    if (numSamples == 0) return;

    const float* leftData = buffer.getReadPointer(0);
    const float* rightData = channels > 1 ? buffer.getReadPointer(1) : leftData;

    for (int i = 0; i < numSamples; ++i)
    {
        const float l = leftData[i];
        const float r = rightData[i];
        const float mono = 0.5f * (l + r);

        // Feed circular FFT buffer
        fifoBuffer[static_cast<size_t>(fifoIndex)] = mono;
        fifoIndex++;

        if (fifoIndex >= fftSize)
        {
            fifoIndex = 0;
            performFFT();
        }

        // Stereo dynamics accumulator
        sumL2 += static_cast<double>(l * l);
        sumR2 += static_cast<double>(r * r);
        sumLR += static_cast<double>(l * r);
        peakValue = std::max(peakValue, std::max(std::abs(l), std::abs(r)));
        sampleAccumulator++;
    }

    // Update dynamics every ~2048 samples (~46ms at 44.1kHz)
    if (sampleAccumulator >= 2048)
    {
        float correlation = 1.0f;
        const double denom = std::sqrt(sumL2 * sumR2);
        if (denom > 1e-9)
        {
            correlation = static_cast<float>(std::clamp(sumLR / denom, -1.0, 1.0));
        }

        const double meanL2 = sumL2 / static_cast<double>(sampleAccumulator);
        const double meanR2 = sumR2 / static_cast<double>(sampleAccumulator);
        const double totalRmsPower = 0.5 * (meanL2 + meanR2);
        const float totalRms = static_cast<float>(std::sqrt(std::max(0.0, totalRmsPower)));

        float crestFactorDb = 0.0f;
        if (totalRms > 1e-6f && peakValue > 1e-6f)
        {
            crestFactorDb = 20.0f * std::log10(peakValue / totalRms);
        }

        const float rmsL = meanL2 > 1e-10 ? static_cast<float>(10.0 * std::log10(meanL2)) : -100.0f;
        const float rmsR = meanR2 > 1e-10 ? static_cast<float>(10.0 * std::log10(meanR2)) : -100.0f;

        {
            std::lock_guard<std::mutex> lock(snapshotMutex);
            latestSnapshot.stereoCorrelation = correlation;
            latestSnapshot.crestFactorDb = crestFactorDb;
            latestSnapshot.rmsLeftDb = rmsL;
            latestSnapshot.rmsRightDb = rmsR;
        }

        sumL2 = 0.0;
        sumR2 = 0.0;
        sumLR = 0.0;
        peakValue = 0.0f;
        sampleAccumulator = 0;
    }
}

void SpectralAnalyzer::performFFT()
{
    // Copy into 2x sized buffer for in-place complex FFT
    std::copy(fifoBuffer.begin(), fifoBuffer.end(), fftData.begin());
    std::fill(fftData.begin() + fftSize, fftData.end(), 0.0f);

    // Apply Blackman-Harris window
    windowFunction.multiplyWithWindowingTable(fftData.data(), fftSize);

    // Compute FFT
    forwardFFT.performFrequencyOnlyForwardTransform(fftData.data());

    // Extract magnitudes in dB normalized to 0 dBFS
    const float normalizer = 2.0f / static_cast<float>(fftSize);
    for (size_t i = 0; i < fftSize / 2; ++i)
    {
        const float mag = fftData[i] * normalizer;
        magnitudeSpectrum[i] = mag > 1e-5f ? 20.0f * std::log10(mag) : -100.0f;
    }

    binSpectrum();
    findResonances();
}

void SpectralAnalyzer::binSpectrum()
{
    const float binWidthHz = static_cast<float>(currentSampleRate) / static_cast<float>(fftSize);
    std::array<float, 32> currentBands {};

    for (size_t b = 0; b < 32; ++b)
    {
        const float centerHz = standardFrequencies[b];
        // 1/3-octave frequency band edges: f_low = fc / 2^(1/6), f_high = fc * 2^(1/6)
        const float fLow = centerHz * 0.8908987f;
        const float fHigh = centerHz * 1.1224620f;

        int binStart = std::max(1, static_cast<int>(std::floor(fLow / binWidthHz)));
        int binEnd = std::min(fftSize / 2 - 1, static_cast<int>(std::ceil(fHigh / binWidthHz)));
        if (binEnd < binStart) binEnd = binStart;

        float maxMag = -100.0f;
        for (int i = binStart; i <= binEnd; ++i)
        {
            maxMag = std::max(maxMag, magnitudeSpectrum[static_cast<size_t>(i)]);
        }

        // Temporal exponential smoothing (attack 0.6, decay 0.2)
        if (maxMag > smoothedBands[b])
            smoothedBands[b] = 0.6f * maxMag + 0.4f * smoothedBands[b];
        else
            smoothedBands[b] = 0.2f * maxMag + 0.8f * smoothedBands[b];

        currentBands[b] = smoothedBands[b];
    }

    // 128 Logarithmically spaced high-resolution bands (20 Hz to 20 kHz)
    std::array<float, 128> current128Bands {};
    for (size_t i = 0; i < 128; ++i)
    {
        const float fLow = 20.0f * std::pow(1000.0f, static_cast<float>(i) / 127.0f);
        const float fHigh = 20.0f * std::pow(1000.0f, static_cast<float>(i + 1) / 127.0f);

        int binStart = std::clamp(static_cast<int>(std::floor(fLow / binWidthHz)), 1, (fftSize / 2) - 1);
        int binEnd = std::clamp(static_cast<int>(std::ceil(fHigh / binWidthHz)), 1, (fftSize / 2) - 1);
        if (binEnd < binStart) binEnd = binStart;

        float maxMag = -100.0f;
        for (int k = binStart; k <= binEnd; ++k)
        {
            maxMag = std::max(maxMag, magnitudeSpectrum[static_cast<size_t>(k)]);
        }

        const float valDb = std::clamp(maxMag, -90.0f, 0.0f);
        if (valDb > smoothed128Bands[i])
            smoothed128Bands[i] = 0.6f * valDb + 0.4f * smoothed128Bands[i];
        else
            smoothed128Bands[i] = 0.2f * valDb + 0.8f * smoothed128Bands[i];

        current128Bands[i] = smoothed128Bands[i];
    }

    std::lock_guard<std::mutex> lock(snapshotMutex);
    latestSnapshot.frequencyBands = currentBands;
    latestSnapshot.spectrum128Bands = current128Bands;
    latestSnapshot.centerFrequenciesHz = standardFrequencies;
}

void SpectralAnalyzer::findResonances()
{
    // Find up to 5 local spectral peaks with prominence
    std::vector<SpectralResonance> peaks;
    const float binWidthHz = static_cast<float>(currentSampleRate) / static_cast<float>(fftSize);

    for (size_t i = 2; i < (fftSize / 2) - 2; ++i)
    {
        const float cur = magnitudeSpectrum[i];
        if (cur > -40.0f &&
            cur > magnitudeSpectrum[i - 1] && cur > magnitudeSpectrum[i + 1] &&
            cur > magnitudeSpectrum[i - 2] && cur > magnitudeSpectrum[i + 2])
        {
            SpectralResonance res;
            res.frequencyHz = static_cast<float>(i) * binWidthHz;
            res.magnitudeDb = cur;
            res.qEstimate = 4.0f; // Standard resonant peak estimate
            peaks.push_back(res);
        }
    }

    // Sort by magnitude descending and keep top 5
    std::sort(peaks.begin(), peaks.end(), [](const SpectralResonance& a, const SpectralResonance& b) {
        return a.magnitudeDb > b.magnitudeDb;
    });

    if (peaks.size() > 5)
        peaks.resize(5);

    std::lock_guard<std::mutex> lock(snapshotMutex);
    latestSnapshot.resonances = std::move(peaks);
}

SpectralSnapshot SpectralAnalyzer::getSnapshot() const
{
    std::lock_guard<std::mutex> lock(snapshotMutex);
    return latestSnapshot;
}

} // namespace mixing_buddy
