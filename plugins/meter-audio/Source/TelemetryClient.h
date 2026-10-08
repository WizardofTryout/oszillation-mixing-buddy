#pragma once

#include <juce_core/juce_core.h>
#include "LoudnessMeter.h"
#include "SpectralAnalyzer.h"
#include <atomic>
#include <mutex>
#include <functional>

namespace mixing_buddy
{

/**
 * Non-blocking background WebSocket client streaming metrology JSON frames to ws://127.0.0.1:48123/meter
 * and synchronizing session target profiles with the DAW project.
 */
class TelemetryClient : public juce::Thread
{
public:
    using ContextCallback = std::function<void(const juce::String&, const juce::String&, const juce::String&, double)>;

    TelemetryClient();
    ~TelemetryClient() override;

    void startStreaming(double sampleRate = 44100.0);
    void stopStreaming();

    void updateMetrics(const LoudnessSnapshot& loudness, const SpectralSnapshot& spectral);
    bool isConnected() const noexcept { return connected.load(); }

    void sendProjectContextSync(const juce::String& scope, const juce::String& genre, const juce::String& notes, double lufs);
    void setContextReceivedCallback(ContextCallback cb);

    // Phase 3 Multi-Instance Identity
    void setTrackIdentity(const juce::String& instanceId, const juce::String& trackName);
    void sendInstanceUnregistered(const juce::String& instanceId);

    void run() override;

private:
    bool attemptConnect();
    bool sendWebSocketHandshake();
    bool sendWebSocketTextFrame(const juce::String& text);
    juce::String buildJsonPayload(uint64_t seq);
    void processIncomingWebSocketData();
    void parseIncomingMessage(const juce::String& msg);

    std::atomic<bool> shouldStop { false };
    std::atomic<bool> connected { false };
    std::atomic<double> currentSampleRate { 44100.0 };

    juce::StreamingSocket socket;

    mutable std::mutex identityMutex;
    juce::String currentInstanceId;
    juce::String currentTrackName { "Track" };

    mutable std::mutex dataMutex;
    LoudnessSnapshot latestLoudness;
    SpectralSnapshot latestSpectral;

    std::mutex syncMutex;
    juce::String pendingContextSync;
    std::atomic<bool> hasPendingSync { false };
    ContextCallback onContextReceived;

    uint64_t sequenceNumber { 0 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(TelemetryClient)
};

} // namespace mixing_buddy
