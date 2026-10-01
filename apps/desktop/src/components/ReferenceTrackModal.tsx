import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  Play,
  Pause,
  CheckCircle2,
  BarChart2,
  FileAudio,
  X,
  Activity,
  Sparkles,
  Flame,
  Check
} from 'lucide-react';
import type { ReferenceTrackProfile } from '@mixing-buddy/shared-types';
import { analyzeAudioBuffer } from '../utils/audioProfiler.js';

interface ReferenceTrackModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProfile: ReferenceTrackProfile | null;
  onApplyReference: (profile: ReferenceTrackProfile) => void;
}

export const ReferenceTrackModal: React.FC<ReferenceTrackModalProps> = ({
  isOpen,
  onClose,
  activeProfile,
  onApplyReference
}) => {
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisProgress, setAnalysisProgress] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Loaded candidate profile
  const [candidateProfile, setCandidateProfile] = useState<ReferenceTrackProfile | null>(activeProfile);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);

  // Audio player state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Reset or initialize candidate profile when opening modal
  useEffect(() => {
    if (isOpen && activeProfile && !candidateProfile) {
      setCandidateProfile(activeProfile);
    }
  }, [isOpen, activeProfile, candidateProfile]);

  // Clean up audio blob URL on unmount or file change
  useEffect(() => {
    return () => {
      if (audioBlobUrl) {
        URL.revokeObjectURL(audioBlobUrl);
      }
    };
  }, [audioBlobUrl]);

  // Audio playback event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(audio.duration);
    const onEnded = () => setIsPlaying(false);
    const onPause = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('play', onPlay);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('play', onPlay);
    };
  }, [audioBlobUrl]);

  // Pause playback when modal is closed
  useEffect(() => {
    if (!isOpen && audioRef.current && isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [isOpen, isPlaying]);

  // Draw 32-band mini spectrum preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !candidateProfile) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#0f1217';
    ctx.fillRect(0, 0, w, h);

    // Draw reference line grid (-12, -24, -36, -48 dB)
    ctx.strokeStyle = '#1e2430';
    ctx.lineWidth = 1;
    [-12, -24, -36, -48].forEach((db) => {
      const y = ((0 - db) / 70.0) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    });

    const bands = candidateProfile.frequencyBands;
    const numBands = bands.length;
    const barWidth = Math.max(2, (w / numBands) - 2);

    for (let i = 0; i < numBands; i++) {
      const db = Math.max(-70, Math.min(0, bands[i]));
      const barHeight = ((db + 70) / 70.0) * h;
      const x = i * (w / numBands) + 1;
      const y = h - barHeight;

      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, '#3b82f6');
      grad.addColorStop(0.7, '#60a5fa');
      grad.addColorStop(1, '#a855f7');

      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barWidth, barHeight);

      ctx.fillStyle = '#c084fc';
      ctx.fillRect(x, y, barWidth, 2);
    }
  }, [candidateProfile]);

  // Audio file processor using Web Audio API
  const processAudioFile = async (file: File) => {
    setIsAnalyzing(true);
    setErrorMessage(null);
    setAnalysisProgress('Lese Datei...');

    try {
      if (audioBlobUrl) {
        URL.revokeObjectURL(audioBlobUrl);
      }
      const newUrl = URL.createObjectURL(file);
      setAudioBlobUrl(newUrl);

      const arrayBuffer = await file.arrayBuffer();
      setAnalysisProgress('Decodiere PCM Audio...');

      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      setAnalysisProgress('Berechne Metrologie & 32-Band Hüllkurve...');
      const analyzed = analyzeAudioBuffer(audioBuffer, file.name);

      const profile: ReferenceTrackProfile = {
        ...analyzed,
        id: `ref_${Date.now()}`,
        timestamp: Date.now()
      };

      setCandidateProfile(profile);
      setAnalysisProgress('');
      await audioCtx.close();
    } catch (err: unknown) {
      console.error('Error analyzing reference audio', err);
      setErrorMessage(
        err instanceof Error ? err.message : 'Audio konnte nicht decodiert werden. Unterstützte Formate: WAV, MP3, AIFF, FLAC.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (isValidAudioFile(file)) {
        processAudioFile(file);
      } else {
        setErrorMessage('Bitte eine gültige Audiodatei ablegen (.wav, .mp3, .aiff, .flac).');
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (isValidAudioFile(file)) {
        processAudioFile(file);
      } else {
        setErrorMessage('Bitte eine gültige Audiodatei wählen (.wav, .mp3, .aiff, .flac).');
      }
    }
  };

  const isValidAudioFile = (file: File) => {
    const validExtensions = ['.wav', '.mp3', '.aiff', '.aif', '.flac'];
    const name = file.name.toLowerCase();
    return validExtensions.some((ext) => name.endsWith(ext)) || file.type.startsWith('audio/');
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch((e) => console.error('Playback error', e));
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const jumpToChorus = () => {
    if (candidateProfile?.chorusWindow && audioRef.current) {
      audioRef.current.currentTime = candidateProfile.chorusWindow.startSec;
      if (!isPlaying) {
        audioRef.current.play().catch(() => {});
      }
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#121418] border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#171a21]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                Referenz-Track Profiler
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-700/50 text-indigo-300">
                  Sprint 4.1
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Audiodatei analysieren, Metrologie berechnen und Spektrum als Zielkurve nutzen
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-2.5 ${
              isDragging
                ? 'border-indigo-400 bg-indigo-950/30 scale-[0.99]'
                : 'border-slate-700 hover:border-slate-500 bg-slate-900/40 hover:bg-slate-900/60'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.wav,.mp3,.aiff,.aif,.flac"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <UploadCloud className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">
                Referenz-Track hier ablegen oder <span className="text-indigo-400 underline">auswählen</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                WAV, MP3, AIFF, FLAC • Direkte Offline-Analyse via Web Audio API
              </p>
            </div>
          </div>

          {/* Loading / Status */}
          {isAnalyzing && (
            <div className="p-4 rounded-lg bg-indigo-950/40 border border-indigo-600/30 flex items-center gap-3">
              <Activity className="w-5 h-5 text-indigo-400 animate-spin" />
              <div className="flex-1">
                <div className="text-xs font-semibold text-indigo-200">{analysisProgress}</div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
                  <div className="bg-indigo-500 h-full animate-pulse w-3/4 rounded-full" />
                </div>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3.5 rounded-lg bg-rose-950/50 border border-rose-600/40 text-rose-200 text-xs flex items-center justify-between">
              <span>⚠️ {errorMessage}</span>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-rose-400 hover:text-rose-100 ml-2 font-bold"
              >
                ✕
              </button>
            </div>
          )}

          {/* Analysis Result Card */}
          {candidateProfile && !isAnalyzing && (
            <div className="bg-[#171a21] border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
              {/* File Info Title */}
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2.5 truncate mr-2">
                  <FileAudio className="w-5 h-5 text-indigo-400 shrink-0" />
                  <div className="truncate">
                    <h3 className="text-sm font-bold text-white truncate" title={candidateProfile.fileName}>
                      {candidateProfile.name}
                    </h3>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                      <span className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-300 font-mono">
                        {candidateProfile.fileFormat}
                      </span>
                      <span>{formatTime(candidateProfile.durationSeconds)}</span>
                      <span>•</span>
                      <span>{candidateProfile.sampleRate} Hz</span>
                      <span>•</span>
                      <span>{candidateProfile.channels === 2 ? 'Stereo' : 'Mono'}</span>
                    </div>
                  </div>
                </div>

                {activeProfile?.id === candidateProfile.id && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Aktiv
                  </span>
                )}
              </div>

              {/* Metrology Badges Grid */}
              <div className="grid grid-cols-4 gap-2.5 text-center">
                <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Integrated</div>
                  <div className="text-sm font-black text-cyan-400 mt-0.5 font-mono">
                    {candidateProfile.integratedLufs.toFixed(1)} <span className="text-[10px] text-slate-400">LUFS</span>
                  </div>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                  <div className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">True Peak</div>
                  <div className="text-sm font-black text-emerald-400 mt-0.5 font-mono">
                    {candidateProfile.truePeakDb.toFixed(1)} <span className="text-[10px] text-slate-400">dBTP</span>
                  </div>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Crest Factor</div>
                  <div className="text-sm font-black text-amber-400 mt-0.5 font-mono">
                    {candidateProfile.crestFactorDb.toFixed(1)} <span className="text-[10px] text-slate-400">dB</span>
                  </div>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-lg">
                  <div className="text-[10px] uppercase font-bold text-purple-400 tracking-wider flex items-center justify-center gap-1">
                    <Flame className="w-3 h-3 text-purple-400" />
                    Chorus
                  </div>
                  <div className="text-xs font-bold text-purple-300 mt-1 font-mono">
                    {candidateProfile.chorusWindow
                      ? `${formatTime(candidateProfile.chorusWindow.startSec)} - ${formatTime(candidateProfile.chorusWindow.endSec)}`
                      : 'N/A'}
                  </div>
                </div>
              </div>

              {/* 32-Band Envelope Preview Graph */}
              <div>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    32-Band Hüllkurve (Lautestes 10s Chorus-Fenster)
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">20 Hz – 20 kHz</span>
                </div>
                <canvas
                  ref={canvasRef}
                  width={560}
                  height={80}
                  className="w-full h-20 rounded-lg border border-slate-800 bg-[#0f1217]"
                />
              </div>

              {/* Mini Audio Player */}
              {audioBlobUrl && (
                <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-2">
                  <audio ref={audioRef} src={audioBlobUrl} />

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition shadow"
                    >
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                    </button>

                    <div className="flex-1 flex flex-col gap-1">
                      <input
                        type="range"
                        min={0}
                        max={duration || candidateProfile.durationSeconds}
                        step={0.1}
                        value={currentTime}
                        onChange={handleSeek}
                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-400"
                      />
                      <div className="flex justify-between text-[11px] font-mono text-slate-400">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration || candidateProfile.durationSeconds)}</span>
                      </div>
                    </div>

                    {candidateProfile.chorusWindow && (
                      <button
                        type="button"
                        onClick={jumpToChorus}
                        className="flex items-center gap-1 text-[11px] font-semibold text-purple-300 hover:text-white bg-purple-950/60 hover:bg-purple-900/60 border border-purple-600/40 px-2.5 py-1 rounded transition"
                        title="Springe direkt zum lautesten 10s Chorus-Abschnitt"
                      >
                        <Flame className="w-3 h-3 text-purple-400" />
                        <span>Chorus</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-[#171a21] flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {candidateProfile ? 'Bereit zur Verwendung im HUD' : 'Wähle einen Referenz-Track aus'}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
            >
              Abbrechen
            </button>

            <button
              type="button"
              disabled={!candidateProfile || isAnalyzing}
              onClick={() => {
                if (candidateProfile) {
                  onApplyReference(candidateProfile);
                  onClose();
                }
              }}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition shadow-md"
            >
              <Check className="w-4 h-4" />
              <span>Als Referenz aktivieren</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
