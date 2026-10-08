#include "LoudnessMeter.h"
#include <cmath>
#include <algorithm>

namespace mixing_buddy
{

LoudnessMeter::LoudnessMeter()
{
}

void LoudnessMeter::prepare(double sampleRate, int samplesPerBlock, int numChannels)
{
    currentSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
    channels = std::max(1, numChannels);

    updateFilters(currentSampleRate);

    // 400 ms momentary window
    momentaryWindowLengthSamples = static_cast<int>(currentSampleRate * 0.4);
    momentaryRingBuffer.assign(std::max(1, momentaryWindowLengthSamples), 0.0);
    momentaryRingIndex = 0;
    momentarySum = 0.0;

    // 3000 ms short-term window
    shortTermWindowLengthSamples = static_cast<int>(currentSampleRate * 3.0);
    shortTermRingBuffer.assign(std::max(1, shortTermWindowLengthSamples), 0.0);
    shortTermRingIndex = 0;
    shortTermSum = 0.0;

    // 100 ms blocks for integrated gating
    samplesPer100ms = static_cast<int>(currentSampleRate * 0.1);
    integratedAccumulatorSamples = 0;
    integratedBlockPowerSum = 0.0;
    integratedGatingBlocks.clear();
    integratedGatingBlocks.reserve(36000); // Up to 1 hour of 100ms blocks

    // 4x oversampler for True Peak
    oversampler = std::make_unique<juce::dsp::Oversampling<float>>(
        channels, 2, juce::dsp::Oversampling<float>::filterHalfBandPolyphaseIIR, true, false
    );
    oversampler->initProcessing(static_cast<size_t>(samplesPerBlock));
    filteredBuffer.setSize(std::max(1, channels), samplesPerBlock);

    reset();
}

void LoudnessMeter::reset()
{
    for (auto& f : stage1Filters) f.reset();
    for (auto& f : stage2Filters) f.reset();

    std::fill(momentaryRingBuffer.begin(), momentaryRingBuffer.end(), 0.0);
    momentaryRingIndex = 0;
    momentarySum = 0.0;

    std::fill(shortTermRingBuffer.begin(), shortTermRingBuffer.end(), 0.0);
    shortTermRingIndex = 0;
    shortTermSum = 0.0;

    integratedAccumulatorSamples = 0;
    silentBlockCount = 0;
    integratedBlockPowerSum = 0.0;
    integratedGatingBlocks.clear();

    if (oversampler)
        oversampler->reset();

    currentTruePeakL = -100.0f;
    currentTruePeakR = -100.0f;

    std::lock_guard<std::mutex> lock(snapshotMutex);
    latestSnapshot = LoudnessSnapshot{};
}

void LoudnessMeter::updateFilters(double sampleRate)
{
    stage1Filters.resize(static_cast<size_t>(channels));
    stage2Filters.resize(static_cast<size_t>(channels));

    // Stage 1: High shelf filter (+4 dB at 1681 Hz, Q = 0.7071)
    auto stage1Coeffs = IIRCoefficients::makeHighShelf(sampleRate, 1681.0f, 0.7071f, 1.58489f);
    // Stage 2: High pass RLB filter (38 Hz, Q = 0.5)
    auto stage2Coeffs = IIRCoefficients::makeHighPass(sampleRate, 38.0f, 0.5f);

    for (int ch = 0; ch < channels; ++ch)
    {
        stage1Filters[static_cast<size_t>(ch)].coefficients = stage1Coeffs;
        stage2Filters[static_cast<size_t>(ch)].coefficients = stage2Coeffs;
    }
}

float LoudnessMeter::powerToLufs(double power)
{
    if (power <= 1e-10) return -100.0f;
    return static_cast<float>(-0.691 + 10.0 * std::log10(power));
}

void LoudnessMeter::processBlock(const juce::AudioBuffer<float>& buffer)
{
    const int numSamples = buffer.getNumSamples();
    if (numSamples == 0 || channels == 0) return;

    // 1. Calculate 4x True Peak
    if (oversampler)
    {
        juce::dsp::AudioBlock<const float> block(buffer);
        auto oversampledBlock = oversampler->processSamplesUp(block);

        float peakL = 0.0f;
        float peakR = 0.0f;

        const float* leftData = oversampledBlock.getChannelPointer(0);
        const float* rightData = channels > 1 ? oversampledBlock.getChannelPointer(1) : leftData;
        const size_t osSamples = oversampledBlock.getNumSamples();

        for (size_t i = 0; i < osSamples; ++i)
        {
            peakL = std::max(peakL, std::abs(leftData[i]));
            peakR = std::max(peakR, std::abs(rightData[i]));
        }

        currentTruePeakL = peakL > 1e-5f ? 20.0f * std::log10(peakL) : -100.0f;
        currentTruePeakR = peakR > 1e-5f ? 20.0f * std::log10(peakR) : -100.0f;
    }

    // 2. K-Weighting filter processing on dedicated internal buffer copy
    filteredBuffer.setSize(channels, numSamples, false, false, true);
    for (int ch = 0; ch < channels; ++ch)
    {
        filteredBuffer.copyFrom(ch, 0, buffer.getReadPointer(ch), numSamples);
    }
    for (int ch = 0; ch < channels; ++ch)
    {
        float* channelData = filteredBuffer.getWritePointer(ch);
        auto& s1 = stage1Filters[static_cast<size_t>(ch)];
        auto& s2 = stage2Filters[static_cast<size_t>(ch)];

        for (int i = 0; i < numSamples; ++i)
        {
            float s = s1.processSample(channelData[i]);
            channelData[i] = s2.processSample(s);
        }
    }

    // 3. Accumulate weighted mean square power per sample across channels
    for (int i = 0; i < numSamples; ++i)
    {
        double sampleSquareSum = 0.0;
        for (int ch = 0; ch < channels; ++ch)
        {
            const float sample = filteredBuffer.getSample(ch, i);
            sampleSquareSum += static_cast<double>(sample * sample);
        }

        // Momentary sliding window
        if (!momentaryRingBuffer.empty())
        {
            momentarySum -= momentaryRingBuffer[static_cast<size_t>(momentaryRingIndex)];
            momentaryRingBuffer[static_cast<size_t>(momentaryRingIndex)] = sampleSquareSum;
            momentarySum += sampleSquareSum;
            momentaryRingIndex = (momentaryRingIndex + 1) % momentaryWindowLengthSamples;
        }

        // Short-term sliding window
        if (!shortTermRingBuffer.empty())
        {
            shortTermSum -= shortTermRingBuffer[static_cast<size_t>(shortTermRingIndex)];
            shortTermRingBuffer[static_cast<size_t>(shortTermRingIndex)] = sampleSquareSum;
            shortTermSum += sampleSquareSum;
            shortTermRingIndex = (shortTermRingIndex + 1) % shortTermWindowLengthSamples;
        }

        // 100ms gating block accumulation for integrated loudness (5s rolling gated window)
        integratedBlockPowerSum += sampleSquareSum;
        integratedAccumulatorSamples++;

        if (integratedAccumulatorSamples >= samplesPer100ms && samplesPer100ms > 0)
        {
            double blockMeanPower = integratedBlockPowerSum / static_cast<double>(samplesPer100ms);
            const double absoluteThresholdPower = std::pow(10.0, (-70.0 + 0.691) / 10.0);

            if (blockMeanPower <= absoluteThresholdPower)
            {
                silentBlockCount++;
                // Auto-clear after 1.5s of silence so next playback pass starts fresh
                if (silentBlockCount >= 15)
                {
                    integratedGatingBlocks.clear();
                }
            }
            else
            {
                silentBlockCount = 0;
                integratedGatingBlocks.push_back(blockMeanPower);
                // Rolling window of 50 blocks (5.0s) so real-time mix adjustments are reflected
                if (integratedGatingBlocks.size() > 50)
                {
                    integratedGatingBlocks.erase(integratedGatingBlocks.begin());
                }
            }

            integratedBlockPowerSum = 0.0;
            integratedAccumulatorSamples = 0;
        }
    }

    // 4. Compute LUFS snapshots
    double momentaryPower = momentarySum / static_cast<double>(std::max(1, momentaryWindowLengthSamples));
    double shortTermPower = shortTermSum / static_cast<double>(std::max(1, shortTermWindowLengthSamples));

    float momentaryLufs = powerToLufs(momentaryPower);
    float shortTermLufs = powerToLufs(shortTermPower);

    // Integrated loudness with EBU R128 gating
    float integratedLufs = -100.0f;
    if (!integratedGatingBlocks.empty())
    {
        // Absolute threshold: -70 LKFS -> power ~ 10^(-7.0691)
        const double absoluteThresholdPower = std::pow(10.0, (-70.0 + 0.691) / 10.0);
        double unweightedSum = 0.0;
        int unweightedCount = 0;

        for (double blockPower : integratedGatingBlocks)
        {
            if (blockPower > absoluteThresholdPower)
            {
                unweightedSum += blockPower;
                unweightedCount++;
            }
        }

        if (unweightedCount > 0)
        {
            double meanGatedPower = unweightedSum / static_cast<double>(unweightedCount);
            // Relative threshold: -10 LU below unweighted mean
            double relativeThresholdPower = meanGatedPower * std::pow(10.0, -10.0 / 10.0);

            double finalSum = 0.0;
            int finalCount = 0;

            for (double blockPower : integratedGatingBlocks)
            {
                if (blockPower > relativeThresholdPower)
                {
                    finalSum += blockPower;
                    finalCount++;
                }
            }

            if (finalCount > 0)
            {
                integratedLufs = powerToLufs(finalSum / static_cast<double>(finalCount));
            }
        }
    }

    // Update thread-safe latest snapshot
    std::lock_guard<std::mutex> lock(snapshotMutex);
    latestSnapshot.momentaryLufs = momentaryLufs;
    latestSnapshot.shortTermLufs = shortTermLufs;
    latestSnapshot.integratedLufs = integratedLufs;
    latestSnapshot.truePeakLeftDb = currentTruePeakL;
    latestSnapshot.truePeakRightDb = currentTruePeakR;
}

LoudnessSnapshot LoudnessMeter::getSnapshot() const
{
    std::lock_guard<std::mutex> lock(snapshotMutex);
    return latestSnapshot;
}

} // namespace mixing_buddy
