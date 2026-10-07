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
        g.drawText("OSZILLATION MIXING BUDDY - THE EAR", 15, 0, getWidth() - 30, 40, juce::Justification::centredLeft);

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
    // Phase 3: Unique Satellite Instance ID & default identity
    juce::Uuid instanceUuid;
    mInstanceId = instanceUuid.toString();
    mTrackName = "Track";
    telemetryClient.setTrackIdentity(mInstanceId, mTrackName);

    // Register listener for project context changes from the Desktop HUD
    telemetryClient.setContextReceivedCallback([this](const juce::String& scope, const juce::String& genre, const juce::String& notes, double lufs) {
        std::lock_guard<std::mutex> lock(contextMutex);
        currentTargetScope = scope;
        currentGenreProfile = genre;
        currentCustomNotes = notes;
        currentTargetLufs = lufs;
    });
}

PluginProcessor::~PluginProcessor()
{
    telemetryClient.sendInstanceUnregistered(mInstanceId);
    telemetryClient.stopStreaming();
}

void PluginProcessor::updateTrackProperties(const TrackProperties& properties)
{
    if (properties.name.has_value() && properties.name->isNotEmpty())
    {
        mTrackName = *properties.name;
        telemetryClient.setTrackIdentity(mInstanceId, mTrackName);
    }
}

void PluginProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    const int numChannels = getTotalNumInputChannels();
    scratchBuffer.setSize(std::max(1, numChannels), samplesPerBlock);
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

    const int numChannels = buffer.getNumChannels();
    const int numSamples = buffer.getNumSamples();
    if (numChannels == 0 || numSamples == 0)
        return;

    // 100% BIT-TRANSPARENT PASS-THROUGH:
    // Audio samples in the host buffer are NEVER altered or mutated.
    // Metrology operates strictly on an isolated scratch copy.
    scratchBuffer.setSize(numChannels, numSamples, false, false, true);
    for (int ch = 0; ch < numChannels; ++ch)
    {
        scratchBuffer.copyFrom(ch, 0, buffer.getReadPointer(ch), numSamples);
    }

    loudnessMeter.processBlock(scratchBuffer);
    spectralAnalyzer.processBlock(scratchBuffer);

    // Update telemetry client with latest snapshots
    telemetryClient.updateMetrics(loudnessMeter.getSnapshot(), spectralAnalyzer.getSnapshot());
}

juce::AudioProcessorEditor* PluginProcessor::createEditor()
{
    return new PluginEditor(*this);
}

void PluginProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    // DAW Project Persistence (Sprint 3)
    // Saved into .logicx or .cpr project file when user saves in DAW (Cmd + S)
    juce::XmlElement xml("MixingBuddyMeterSettings");
    xml.setAttribute("version", 1);
    {
        std::lock_guard<std::mutex> lock(contextMutex);
        xml.setAttribute("targetScope", currentTargetScope);
        xml.setAttribute("genreProfile", currentGenreProfile);
        xml.setAttribute("customNotes", currentCustomNotes);
        xml.setAttribute("targetLufs", currentTargetLufs);
    }
    copyXmlToBinary(xml, destData);
}

void PluginProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    // Restored automatically by DAW host when opening a project file
    std::unique_ptr<juce::XmlElement> xmlState(getXmlFromBinary(data, sizeInBytes));
    if (xmlState != nullptr && xmlState->hasTagName("MixingBuddyMeterSettings"))
    {
        juce::String scope;
        juce::String genre;
        juce::String notes;
        double lufs = -12.0;

        {
            std::lock_guard<std::mutex> lock(contextMutex);
            currentTargetScope = xmlState->getStringAttribute("targetScope", "mix_bus");
            currentGenreProfile = xmlState->getStringAttribute("genreProfile", "pop_radio");
            currentCustomNotes = xmlState->getStringAttribute("customNotes", "");
            currentTargetLufs = xmlState->getDoubleAttribute("targetLufs", -12.0);

            scope = currentTargetScope;
            genre = currentGenreProfile;
            notes = currentCustomNotes;
            lufs = currentTargetLufs;
        }

        // Broadcast restored context to the Desktop Companion HUD
        telemetryClient.sendProjectContextSync(scope, genre, notes, lufs);
    }
}

void PluginProcessor::setProjectContext(const juce::String& scope, const juce::String& genre, const juce::String& notes, double lufs)
{
    {
        std::lock_guard<std::mutex> lock(contextMutex);
        currentTargetScope = scope;
        currentGenreProfile = genre;
        currentCustomNotes = notes;
        currentTargetLufs = lufs;
    }
    telemetryClient.sendProjectContextSync(scope, genre, notes, lufs);
}

juce::String PluginProcessor::getTargetScope() const
{
    std::lock_guard<std::mutex> lock(contextMutex);
    return currentTargetScope;
}

juce::String PluginProcessor::getGenreProfile() const
{
    std::lock_guard<std::mutex> lock(contextMutex);
    return currentGenreProfile;
}

juce::String PluginProcessor::getCustomNotes() const
{
    std::lock_guard<std::mutex> lock(contextMutex);
    return currentCustomNotes;
}

double PluginProcessor::getTargetLufs() const
{
    std::lock_guard<std::mutex> lock(contextMutex);
    return currentTargetLufs;
}

} // namespace mixing_buddy

// ==============================================================================
// JUCE Plugin Filter Entrypoint
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new mixing_buddy::PluginProcessor();
}
