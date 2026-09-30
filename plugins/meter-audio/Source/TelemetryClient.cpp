#include "TelemetryClient.h"
#include <random>

#if JUCE_MAC
#include <sys/socket.h>
#include <signal.h>
#endif

namespace mixing_buddy
{

TelemetryClient::TelemetryClient()
    : juce::Thread("MixingBuddyTelemetryClient")
{
}

TelemetryClient::~TelemetryClient()
{
    stopStreaming();
}

void TelemetryClient::startStreaming(double sampleRate)
{
    currentSampleRate.store(sampleRate);
    shouldStop.store(false);
    startThread(juce::Thread::Priority::normal);
}

void TelemetryClient::stopStreaming()
{
    shouldStop.store(true);
    connected.store(false);
    signalThreadShouldExit();
    notify();
    if (socket.isConnected())
        socket.close();
    stopThread(1000);
}

void TelemetryClient::updateMetrics(const LoudnessSnapshot& loudness, const SpectralSnapshot& spectral)
{
    std::lock_guard<std::mutex> lock(dataMutex);
    latestLoudness = loudness;
    latestSpectral = spectral;
}

bool TelemetryClient::attemptConnect()
{
    if (socket.isConnected())
        socket.close();

    // Connect to local companion engine on port 48123 (timeout 300ms)
    if (!socket.connect("127.0.0.1", 48123, 300))
        return false;

#if JUCE_MAC
    int handle = socket.getRawSocketHandle();
    if (handle >= 0)
    {
        int set = 1;
        setsockopt(handle, SOL_SOCKET, SO_NOSIGPIPE, &set, sizeof(set));
    }
    signal(SIGPIPE, SIG_IGN);
#endif

    if (!sendWebSocketHandshake())
    {
        socket.close();
        return false;
    }

    return true;
}

bool TelemetryClient::sendWebSocketHandshake()
{
    juce::String request =
        "GET /meter HTTP/1.1\r\n"
        "Host: 127.0.0.1:48123\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n";

    if (socket.write(request.toRawUTF8(), request.getNumBytesAsUTF8()) <= 0)
        return false;

    // Wait for handshake response (timeout up to 2000ms)
    juce::String response;
    const int64_t deadline = juce::Time::currentTimeMillis() + 2000;
    while (juce::Time::currentTimeMillis() < deadline)
    {
        int ready = socket.waitUntilReady(true, 100);
        if (ready > 0)
        {
            char chunk[1024] {};
            int bytesRead = socket.read(chunk, sizeof(chunk) - 1, false);
            if (bytesRead > 0)
            {
                response += juce::String::fromUTF8(chunk, bytesRead);
                if (response.contains("101 Switching Protocols"))
                    return true;
            }
        }
        else if (ready < 0)
        {
            return false;
        }
    }

    return response.contains("101 Switching Protocols");
}

bool TelemetryClient::sendWebSocketTextFrame(const juce::String& text)
{
    const juce::CharPointer_UTF8 utf8 = text.toUTF8();
    const size_t payloadLen = static_cast<size_t>(text.getNumBytesAsUTF8());

    juce::MemoryBlock frame;
    // Byte 0: FIN (0x80) | Text Opcode (0x01) = 0x81
    frame.append(&"\x81", 1);

    // Client frames must be masked (bit 7 set)
    if (payloadLen < 126)
    {
        uint8_t lenByte = static_cast<uint8_t>(payloadLen | 0x80);
        frame.append(&lenByte, 1);
    }
    else if (payloadLen <= 0xFFFF)
    {
        uint8_t header[3] = {
            static_cast<uint8_t>(126 | 0x80),
            static_cast<uint8_t>((payloadLen >> 8) & 0xFF),
            static_cast<uint8_t>(payloadLen & 0xFF)
        };
        frame.append(header, 3);
    }
    else
    {
        return false; // Metrics frames are < 64KB
    }

    // Generate 4-byte random masking key
    static std::mt19937 rng(1337);
    uint32_t maskKey = rng();
    uint8_t maskBytes[4] = {
        static_cast<uint8_t>(maskKey & 0xFF),
        static_cast<uint8_t>((maskKey >> 8) & 0xFF),
        static_cast<uint8_t>((maskKey >> 16) & 0xFF),
        static_cast<uint8_t>((maskKey >> 24) & 0xFF)
    };
    frame.append(maskBytes, 4);

    // Apply mask to payload and append
    juce::HeapBlock<char> maskedPayload(payloadLen);
    for (size_t i = 0; i < payloadLen; ++i)
    {
        maskedPayload[static_cast<int>(i)] = static_cast<char>(utf8[static_cast<int>(i)] ^ maskBytes[i % 4]);
    }
    frame.append(maskedPayload.getData(), payloadLen);

    if (!socket.isConnected())
        return false;

    int written = socket.write(frame.getData(), static_cast<int>(frame.getSize()));
    return written == static_cast<int>(frame.getSize());
}

juce::String TelemetryClient::buildJsonPayload(uint64_t seq)
{
    LoudnessSnapshot l;
    SpectralSnapshot s;
    {
        std::lock_guard<std::mutex> lock(dataMutex);
        l = latestLoudness;
        s = latestSpectral;
    }

    juce::String json = "{";
    json += "\"version\":\"1.0\",";
    json += "\"sequenceNumber\":" + juce::String(seq) + ",";
    json += "\"sampleRate\":" + juce::String(currentSampleRate.load()) + ",";

    // Loudness block
    json += "\"loudness\":{";
    json += "\"momentaryLufs\":" + juce::String(l.momentaryLufs, 1) + ",";
    json += "\"shortTermLufs\":" + juce::String(l.shortTermLufs, 1) + ",";
    json += "\"integratedLufs\":" + juce::String(l.integratedLufs, 1) + ",";
    json += "\"loudnessRangeLu\":" + juce::String(l.loudnessRangeLu, 1) + ",";
    json += "\"truePeakDb\":{\"left\":" + juce::String(l.truePeakLeftDb, 1) + ",\"right\":" + juce::String(l.truePeakRightDb, 1) + "}";
    json += "},";

    // Spectrum block
    json += "\"spectrum\":{";
    json += "\"timestamp\":" + juce::String(juce::Time::currentTimeMillis()) + ",";
    json += "\"frequencyBands\":[";
    for (size_t i = 0; i < 32; ++i)
    {
        json += juce::String(s.frequencyBands[i], 1);
        if (i < 31) json += ",";
    }
    json += "],";
    json += "\"spectralResonances\":[";
    for (size_t i = 0; i < s.resonances.size(); ++i)
    {
        const auto& r = s.resonances[i];
        json += "{\"frequencyHz\":" + juce::String(r.frequencyHz, 0) + ",\"magnitudeDb\":" + juce::String(r.magnitudeDb, 1) + ",\"qEstimate\":4.0}";
        if (i + 1 < s.resonances.size()) json += ",";
    }
    json += "]},";

    // Dynamics block
    json += "\"dynamics\":{";
    json += "\"stereoCorrelation\":" + juce::String(s.stereoCorrelation, 2) + ",";
    json += "\"crestFactorDb\":" + juce::String(s.crestFactorDb, 1) + ",";
    json += "\"rmsDb\":{\"left\":" + juce::String(s.rmsLeftDb, 1) + ",\"right\":" + juce::String(s.rmsRightDb, 1) + "}";
    json += "}}";

    return json;
}

void TelemetryClient::run()
{
#if JUCE_MAC
    signal(SIGPIPE, SIG_IGN);
#endif

    while (!threadShouldExit() && !shouldStop.load())
    {
        if (!connected.load())
        {
            if (attemptConnect())
            {
                connected.store(true);
            }
            else
            {
                // Wait safely in small increments so we can exit immediately if requested
                for (int i = 0; i < 30 && !threadShouldExit() && !shouldStop.load(); ++i)
                {
                    wait(50);
                }
                continue;
            }
        }

        // Stream frame at ~25 Hz (40 ms period)
        sequenceNumber++;
        juce::String payload = buildJsonPayload(sequenceNumber);

        if (!sendWebSocketTextFrame(payload))
        {
            connected.store(false);
            if (socket.isConnected())
                socket.close();

            for (int i = 0; i < 20 && !threadShouldExit() && !shouldStop.load(); ++i)
            {
                wait(50);
            }
        }
        else
        {
            wait(40);
        }
    }

    if (socket.isConnected())
        socket.close();
    connected.store(false);
}

} // namespace mixing_buddy
