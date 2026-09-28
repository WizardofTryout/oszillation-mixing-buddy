#pragma once

#include <juce_core/juce_core.h>
#include "LoudnessMeter.h"
#include "SpectralAnalyzer.h"
#include <atomic>
#include <mutex>

namespace mixing_buddy
{

/**
 * Non-blocking background WebSocket client streaming metrology JSON frames to ws://127.0.0.1:48123/meter
 */
class TelemetryClient : public juce::Thread
{
public:
    TelemetryClient();
    ~TelemetryClient() override;

    void startStreaming(double sampleRate = 44100.0);
    void stopStreaming();

    void updateMetrics(const LoudnessSnapshot& loudness, const SpectralSnapshot& spectral);
    bool isConnected() const noexcept { return connected.load(); }

    void run() override;

private:
    bool attemptConnect();
    bool sendWebSocketHandshake();
    bool sendWebSocketTextFrame(const juce::String& text);
    juce::String buildJsonPayload(uint64_t seq);

    std::atomic<bool> shouldStop { false };
    std::atomic<bool> connected { false };
    std::atomic<double> currentSampleRate { 44100.0 };

    juce::StreamingSocket socket;

    mutable std::mutex dataMutex;
    LoudnessSnapshot latestLoudness;
    SpectralSnapshot latestSpectral;

    uint64_t sequenceNumber { 0 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(TelemetryClient)
};

} // namespace mixing_buddy
