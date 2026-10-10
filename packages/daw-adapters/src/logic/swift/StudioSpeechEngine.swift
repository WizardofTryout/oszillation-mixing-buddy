import Foundation
import Speech
import AVFoundation

private func emitSpeechJSON(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let str = String(data: data, encoding: .utf8) {
        print(str)
        fflush(stdout)
    }
}

public class StudioSpeechEngine {
    private let audioEngine = AVAudioEngine()
    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var converter: AVAudioConverter?
    private var targetFormat: AVAudioFormat?
    private var isRunning = false
    private var hasInstalledTap = false
    private let lock = NSLock()

    public init(localeIdentifier: String = "de-DE") {
        let loc = Locale(identifier: localeIdentifier)
        self.speechRecognizer = SFSpeechRecognizer(locale: loc) ?? SFSpeechRecognizer(locale: Locale(identifier: "de-DE")) ?? SFSpeechRecognizer()
    }

    public func start(vocabulary: [String] = []) {
        lock.lock()
        guard !isRunning else {
            lock.unlock()
            return
        }
        lock.unlock()

        guard let recognizer = speechRecognizer else {
            emitSpeechJSON(["type": "error", "error": "Speech recognizer could not be initialized for locale"])
            exit(1)
        }

        SFSpeechRecognizer.requestAuthorization { [weak self] authStatus in
            guard let self = self else { return }
            switch authStatus {
            case .authorized:
                DispatchQueue.main.async {
                    self.startAudioRecognition(recognizer: recognizer, vocabulary: vocabulary)
                }
            case .denied:
                emitSpeechJSON(["type": "error", "error": "Speech recognition authorization denied by user"])
                exit(1)
            case .restricted:
                emitSpeechJSON(["type": "error", "error": "Speech recognition is restricted on this device"])
                exit(1)
            case .notDetermined:
                emitSpeechJSON(["type": "error", "error": "Speech recognition authorization not determined"])
                exit(1)
            @unknown default:
                emitSpeechJSON(["type": "error", "error": "Unknown authorization status"])
                exit(1)
            }
        }
    }

    private func startAudioRecognition(recognizer: SFSpeechRecognizer, vocabulary: [String]) {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation

        // Prioritize Apple Silicon Neural Engine (macOS On-Device Recognition)
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }

        // Sprint 8.2: SpeechVocabularyProvider - Inject studio mixing baseline & session tracks
        let baselineStudioVocabulary: [String] = [
            "Fader", "Lautstärke", "Pan", "Panorama", "Mute", "Solo", "Bypass",
            "dB", "Dezibel", "Hz", "Hertz", "kHz", "Kilohertz",
            "EQ", "Equalizer", "Kompressor", "Compressor", "Limiter", "Gate",
            "Threshold", "Ratio", "Attack", "Release", "Gain", "Makeup", "Knee",
            "Low Cut", "High Cut", "Low Shelf", "High Shelf", "Bell", "Q-Faktor",
            "Mitten", "Bässe", "Höhen", "Präsenz", "Subbass", "Air Band",
            "ChromaVerb", "Reverb", "Hall", "Delay", "Echo", "Decay", "Predelay",
            "Sidechain", "Bus", "Send", "Aux", "Stereo Out", "Master",
            "Absenken", "Anheben", "Senke", "Hebe", "Cut", "Boost", "Räume auf",
            "Spur", "Kanal", "Plugin", "Slot", "Insert", "Track"
        ]

        var combinedVocabulary = baselineStudioVocabulary
        for term in vocabulary {
            let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty && !combinedVocabulary.contains(trimmed) {
                combinedVocabulary.append(trimmed)
            }
        }
        request.contextualStrings = combinedVocabulary
        self.recognitionRequest = request

        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)

        guard inputFormat.sampleRate > 0 && inputFormat.channelCount > 0 else {
            emitSpeechJSON(["type": "error", "error": "No audio input available or invalid hardware sample rate"])
            exit(1)
        }

        // Studio Interface Resampling: standard Speech 16kHz Float32 mono format
        guard let targetFmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000.0, channels: 1, interleaved: false) else {
            emitSpeechJSON(["type": "error", "error": "Failed to create 16kHz target audio format"])
            exit(1)
        }
        self.targetFormat = targetFmt

        let needsResampling = (inputFormat.sampleRate != 16000.0 || inputFormat.channelCount != 1)
        if needsResampling {
            guard let conv = AVAudioConverter(from: inputFormat, to: targetFmt) else {
                emitSpeechJSON(["type": "error", "error": "Failed to create audio converter for \(inputFormat.sampleRate)Hz -> 16000Hz"])
                exit(1)
            }
            self.converter = conv
        }

        // Tap microphone input stream
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] (buffer, when) in
            guard let self = self, let req = self.recognitionRequest else { return }

            if let conv = self.converter, let tgtFmt = self.targetFormat {
                let ratio = 16000.0 / buffer.format.sampleRate
                let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 256
                if let convertedBuffer = AVAudioPCMBuffer(pcmFormat: tgtFmt, frameCapacity: capacity) {
                    var error: NSError?
                    var haveData = true
                    let status = conv.convert(to: convertedBuffer, error: &error) { inNumPackets, outStatus in
                        if haveData {
                            haveData = false
                            outStatus.pointee = .haveData
                            return buffer
                        } else {
                            outStatus.pointee = .noDataNow
                            return nil
                        }
                    }
                    if status != .error && convertedBuffer.frameLength > 0 {
                        req.append(convertedBuffer)
                    }
                }
            } else {
                req.append(buffer)
            }
        }
        self.hasInstalledTap = true

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            emitSpeechJSON(["type": "error", "error": "Failed to start AVAudioEngine: \(error.localizedDescription)"])
            exit(1)
        }

        self.lock.lock()
        self.isRunning = true
        self.lock.unlock()

        emitSpeechJSON(["type": "status", "status": "listening", "onDevice": recognizer.supportsOnDeviceRecognition])

        // Start recognition task
        self.recognitionTask = recognizer.recognitionTask(with: request) { [weak self] (result, error) in
            guard let self = self else { return }

            if let res = result {
                let text = res.bestTranscription.formattedString
                let isFinal = res.isFinal
                emitSpeechJSON([
                    "type": isFinal ? "final" : "partial",
                    "transcript": text,
                    "isFinal": isFinal
                ])
                if isFinal {
                    self.stop()
                }
            }

            if let err = error {
                let nsErr = err as NSError
                // Filter normal cancellation error (code 216)
                if nsErr.domain == "kAFAssistantErrorDomain" && nsErr.code == 216 {
                    return
                }
                emitSpeechJSON(["type": "error", "error": err.localizedDescription])
                self.stop()
            }
        }

        // Start stdin reader thread for "stop" commands or pipe closure
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            while let line = readLine() {
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if trimmed == "stop" || trimmed == "exit" || trimmed == "q" {
                    self?.stop()
                    return
                }
            }
            // EOF reached on stdin
            Thread.sleep(forTimeInterval: 0.1)
            self?.stop()
        }

        // Failsafe auto-stop timer after 60 seconds
        DispatchQueue.global(qos: .background).asyncAfter(deadline: .now() + 60.0) { [weak self] in
            self?.stop()
        }
    }

    public func stop() {
        lock.lock()
        guard isRunning else {
            lock.unlock()
            exit(0)
        }
        isRunning = false
        lock.unlock()

        if audioEngine.isRunning {
            audioEngine.stop()
        }
        if hasInstalledTap {
            audioEngine.inputNode.removeTap(onBus: 0)
            hasInstalledTap = false
        }

        recognitionRequest?.endAudio()
        recognitionTask?.finish()

        emitSpeechJSON(["type": "stopped"])
        exit(0)
    }
}

public func runStudioSpeechRecognition(vocabulary: [String], locale: String) {
    let engine = StudioSpeechEngine(localeIdentifier: locale)
    engine.start(vocabulary: vocabulary)
    RunLoop.main.run()
}
