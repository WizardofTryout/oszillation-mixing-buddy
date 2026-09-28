#include "PluginProcessor.h"
#include <juce_gui_basics/juce_gui_basics.h>

namespace mixing_buddy
{

/**
 * Lightweight native HUD editor showing metrology status and WebSocket telemetry state
 */
class PluginEditor : public juce::AudioProcessorEditor, private juce::Timer
{
public:
    explicit PluginEditor(PluginProcessor& p)
        : juce::AudioProcessorEditor(&p), processor(p)
    {
        setSize(420, 220);
        startTimerHz(30);
    }

    ~PluginEditor() override
    {
        stopTimer();
    }

    void paint(juce::Graphics& g) override
    {
        g.fillAll(juce::Colour(0xff121316));

        // Header
        g.setColour(juce::Colour(0xff22252a));
        g.fillRect(0, 0, getWidth(), 40);

        g.setColour(juce::Colours::white);
        g.setFont(juce::Font(16.0f, juce::Font::bold));
        g.drawText("OSZILLATION MIXING BUDDY — THE EAR", 15, 0, getWidth() - 30, 40, juce::Justification::centredLeft);

        // Connection badge
        bool isConnected = processor.isTelemetryConnected();
        juce::Colour badgeColour = isConnected ? juce::Colour(0xff22c55e) : juce::Colour(0xffeab308);
        g.setColour(badgeColour);
        g.fillEllipse(static_cast<float>(getWidth() - 30), 15.0f, 10.0f, 10.0f);

        g.setFont(juce::Font(11.0f, juce::Font::plain));
        g.drawText(isConnected ? "STREAMING" : "WAITING FOR BODY", getWidth() - 150, 0, 110, 40, juce::Justification::centredRight);

        // Metrics Display
        auto lufs = processor.getLoudnessSnapshot();
        auto spec = processor.getSpectralSnapshot();

        g.setColour(juce::Colour(0xff8e96a4));
        g.setFont(juce::Font(12.0f, juce::Font::plain));

        // Momentary LUFS
        g.drawText("MOMENTARY LUFS", 20, 55, 120, 20, juce::Justification::centredLeft);
        g.setColour(juce::Colours::white);
        g.setFont(juce::Font(24.0f, juce::Font::bold));
        g.drawText(juce::String(lufs.momentaryLufs, 1) + " LUFS", 20, 75, 150, 30, juce::Justification::centredLeft);

        // Integrated LUFS
        g.setColour(juce::Colour(0xff8e96a4));
        g.setFont(juce::Font(12.0f, juce::Font::plain));
        g.drawText("INTEGRATED LUFS", 200, 55, 120, 20, juce::Justification::centredLeft);
        g.setColour(juce::Colours::white);
        g.setFont(juce::Font(24.0f, juce::Font::bold));
        g.drawText(juce::String(lufs.integratedLufs, 1) + " LUFS", 200, 75, 150, 30, juce::Justification::centredLeft);

        // True Peak & Correlation
        g.setColour(juce::Colour(0xff8e96a4));
        g.setFont(juce::Font(12.0f, juce::Font::plain));
        g.drawText("TRUE PEAK", 20, 125, 120, 20, juce::Justification::centredLeft);
        g.drawText("STEREO CORRELATION", 200, 125, 140, 20, juce::Justification::centredLeft);

        g.setColour(juce::Colours::white);
        g.setFont(juce::Font(18.0f, juce::Font::bold));
        float maxPeak = std::max(lufs.truePeakLeftDb, lufs.truePeakRightDb);
        g.drawText(juce::String(maxPeak, 1) + " dBTP", 20, 145, 150, 25, juce::Justification::centredLeft);
        g.drawText(juce::String(spec.stereoCorrelation, 2), 200, 145, 150, 25, juce::Justification::centredLeft);

        // Footer
        g.setColour(juce::Colour(0xff555d6e));
        g.setFont(juce::Font(10.0f, juce::Font::plain));
        g.drawText("WebSocket Telemetry Bus: ws://127.0.0.1:48123/meter", 20, 190, getWidth() - 40, 20, juce::Justification::centredLeft);
    }

private:
    void timerCallback() override
    {
        repaint();
    }

    PluginProcessor& processor;
};

// ==============================================================================

PluginProcessor::PluginProcessor()
    : juce::AudioProcessor(BusesProperties()
                           .withInput("Input", juce::AudioChannelSet::stereo(), true)
                           .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

PluginProcessor::~PluginProcessor()
{
    telemetryClient.stopStreaming();
}

void PluginProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    const int numChannels = getTotalNumInputChannels();
    loudnessMeter.prepare(sampleRate, samplesPerBlock, numChannels);
    spectralAnalyzer.prepare(sampleRate, samplesPerBlock, numChannels);
    telemetryClient.startStreaming(sampleRate);
}

void PluginProcessor::releaseResources()
{
    telemetryClient.stopStreaming();
}

bool PluginProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    // Support mono or stereo transparent passthrough
    const auto& mainInput = layouts.getMainInputChannelSet();
    const auto& mainOutput = layouts.getMainOutputChannelSet();

    if (mainInput != mainOutput)
        return false;

    return mainInput == juce::AudioChannelSet::mono() || mainInput == juce::AudioChannelSet::stereo();
}

void PluginProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& /*midiMessages*/)
{
    juce::ScopedNoDenormals noDenormals;

    // Zero-latency passthrough: Audio samples are NOT altered
    loudnessMeter.processBlock(buffer);
    spectralAnalyzer.processBlock(buffer);

    // Update telemetry client with latest snapshots
    telemetryClient.updateMetrics(loudnessMeter.getSnapshot(), spectralAnalyzer.getSnapshot());
}

juce::AudioProcessorEditor* PluginProcessor::createEditor()
{
    return new PluginEditor(*this);
}

void PluginProcessor::getStateInformation(juce::MemoryBlock& /*destData*/)
{
    // Meter plugin has no persistent state
}

void PluginProcessor::setStateInformation(const void* /*data*/, int /*sizeInBytes*/)
{
}

} // namespace mixing_buddy

// ==============================================================================
// JUCE Plugin Filter Entrypoint
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new mixing_buddy::PluginProcessor();
}
