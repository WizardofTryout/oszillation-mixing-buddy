cmake_minimum_required(VERSION 3.22)

project(MixingBuddyMeter VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Fetch JUCE framework securely via CMake FetchContent
include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.6
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

# Dual-format target: VST3 (Nuendo/Cubase) and AU (Logic Pro)
juce_add_plugin(MixingBuddyMeter
    COMPANY_NAME "OszillationStudio"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE
    PLUGIN_MANUFACTURER_CODE Oszi
    PLUGIN_CODE MbMt
    FORMATS VST3 AU
    PRODUCT_NAME "MixingBuddyMeter"
    BUNDLE_ID "de.oszillation-studio.mixingbuddymeter"
)

target_sources(MixingBuddyMeter PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginProcessor.h
    Source/LoudnessMeter.cpp
    Source/LoudnessMeter.h
    Source/SpectralAnalyzer.cpp
    Source/SpectralAnalyzer.h
    Source/TelemetryClient.cpp
    Source/TelemetryClient.h
)

target_compile_definitions(MixingBuddyMeter PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    DONT_SET_USING_JUCE_NAMESPACE=1
)

target_link_libraries(MixingBuddyMeter PRIVATE
    juce::juce_audio_utils
    juce::juce_dsp
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)
