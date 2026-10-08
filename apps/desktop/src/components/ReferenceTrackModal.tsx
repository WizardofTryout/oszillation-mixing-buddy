import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  Check,
  Bookmark,
  Trash2,
  Save,
  FolderHeart,
  RefreshCw,
  Music
} from 'lucide-react';
import type { ReferenceTrackProfile, ReferenceProfileSummary } from '@mixing-buddy/shared-types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { analyzeAudioBuffer, CENTER_FREQUENCIES } from '../utils/audioProfiler.js';

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
  // Tab Navigation: 'analyze' vs 'saved'
  const [activeTab, setActiveTab] = useState<'analyze' | 'saved'>('analyze');
  const [savedReferences, setSavedReferences] = useState<ReferenceProfileSummary[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisProgress, setAnalysisProgress] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Loaded candidate profile
  const [candidateProfile, setCandidateProfile] = useState<ReferenceTrackProfile | null>(activeProfile);

  // Web Audio Playback & Realtime Analyser State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const decodedBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Initialize or reset candidate profile when opening modal
  useEffect(() => {
    if (isOpen && activeProfile && !candidateProfile) {
      setCandidateProfile(activeProfile);
    }
  }, [isOpen, activeProfile, candidateProfile]);

  // Load saved references from ~/.mixing-buddy/references/ via Tauri IPC
  const loadSavedReferences = useCallback(async () => {
    try {
      setIsLoadingSaved(true);
      const list = await invoke<ReferenceProfileSummary[]>('list_reference_profiles');
      setSavedReferences(list || []);
    } catch (err) {
      console.warn('Failed to load saved reference profiles', err);
    } finally {
      setIsLoadingSaved(false);
    }
  }, []);

  // Save current candidate profile to ~/.mixing-buddy/references/<slug>.json
  const handleSaveProfile = async () => {
    if (!candidateProfile) return;
    try {
      setIsSaving(true);
      await invoke('save_reference_profile', { profile: candidateProfile });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      await loadSavedReferences();
    } catch (err: unknown) {
      console.error('Failed to save reference profile', err);
      setErrorMessage(err instanceof Error ? err.message : 'Fehler beim Speichern der Referenz');
    } finally {
      setIsSaving(false);
    }
  };

  // Load saved reference from vault into candidateProfile for inspecting 32-band curve & listening
  const handleLoadSavedReference = async (summary: ReferenceProfileSummary) => {
    try {
      const fullProfile = await invoke<ReferenceTrackProfile>('get_reference_profile', { id: summary.id });
      setCandidateProfile(fullProfile);
      setDuration(fullProfile.durationSeconds);
      setCurrentTime(0);
      setActiveTab('analyze');
    } catch (err) {
      console.error('Failed to load saved reference', err);
      setErrorMessage('Profil konnte nicht vollständig geladen werden.');
    }
  };

  // Activate directly into HUD
  const handleActivateSavedReference = async (summary: ReferenceProfileSummary) => {
    try {
      const fullProfile = await invoke<ReferenceTrackProfile>('get_reference_profile', { id: summary.id });
      onApplyReference(fullProfile);
      onClose();
    } catch (err) {
      console.error('Failed to activate saved reference', err);
      setErrorMessage('Referenz konnte nicht aktiviert werden.');
    }
  };

  // Delete saved reference from ~/.mixing-buddy/references/
  const handleDeleteSavedReference = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke('delete_reference_profile', { id });
      await loadSavedReferences();
    } catch (err) {
      console.error('Failed to delete saved reference', err);
    }
  };

  // Load saved references on modal open & listen for backend vault updates
  useEffect(() => {
    if (!isOpen) return;
    loadSavedReferences();

    let unlisten: (() => void) | undefined;
    try {
      listen('reference-vault-updated', () => {
        loadSavedReferences();
      }).then((cleanup) => {
        unlisten = cleanup;
      }).catch((err) => {
        console.warn('listen reference-vault-updated error', err);
      });
    } catch (e) {
      console.warn('listen not available', e);
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, [isOpen, loadSavedReferences]);

  // Stop playback on modal close
  useEffect(() => {
    if (!isOpen) {
      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.stop(); } catch {}
        sourceNodeRef.current.disconnect();
        sourceNodeRef.current = null;
      }
      setIsPlaying(false);
    }
  }, [isOpen]);

  // Clean up Web Audio resources on unmount
  useEffect(() => {
    return () => {
      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.stop(); } catch {}
        sourceNodeRef.current.disconnect();
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Draw static 32-band target envelope on canvas
  const drawStaticEnvelope = useCallback(() => {
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

  // Draw live dynamic 32-band spectrum while playing
  const drawLiveSpectrum = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserNodeRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#0f1217';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#1e2430';
    ctx.lineWidth = 1;
    [-12, -24, -36, -48].forEach((db) => {
      const y = ((0 - db) / 70.0) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    });

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);

    const sampleRate = audioCtxRef.current?.sampleRate || 44100;
    const fftSize = analyser.fftSize;
    const numBands = CENTER_FREQUENCIES.length;
    const barWidth = Math.max(2, (w / numBands) - 2);

    for (let i = 0; i < numBands; i++) {
      const fc = CENTER_FREQUENCIES[i];
      const bin = Math.min(
        freqData.length - 1,
        Math.max(1, Math.round((fc * fftSize) / sampleRate))
      );
      const val = freqData[bin] / 255.0; // 0.0 to 1.0
      const barHeight = Math.max(3, val * h);
      const x = i * (w / numBands) + 1;
      const y = h - barHeight;

      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, '#10b981');
      grad.addColorStop(0.5, '#06b6d4');
      grad.addColorStop(1, '#a855f7');

      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barWidth, barHeight);

      // Glowing peak cap
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(x, y, barWidth, 2);
    }
  }, []);

  // Update canvas on initial profile load or when paused
  useEffect(() => {
    if (!isPlaying) {
      drawStaticEnvelope();
    }
  }, [isPlaying, candidateProfile, drawStaticEnvelope]);

  // Real-time animation loop for live playhead & animated RTA analyser
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    const loop = () => {
      const ctx = audioCtxRef.current;
      const buffer = decodedBufferRef.current;
      if (ctx && buffer) {
        const cur = ctx.currentTime - startTimeRef.current;
        if (cur >= buffer.duration) {
          setIsPlaying(false);
          pauseOffsetRef.current = 0;
          setCurrentTime(0);
          drawStaticEnvelope();
          return;
        }
        setCurrentTime(cur);
        pauseOffsetRef.current = cur;
      }

      drawLiveSpectrum();
      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isPlaying, drawLiveSpectrum, drawStaticEnvelope]);

  // Web Audio Playback Controls
  const playAudio = async (startFromSec?: number) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const buffer = decodedBufferRef.current;
    if (!buffer) return;

    // Disconnect old source node if playing
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch {}
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    const offset = typeof startFromSec === 'number' ? startFromSec : pauseOffsetRef.current;
    const clampedOffset = Math.max(0, Math.min(buffer.duration - 0.05, offset));

    // Create live analyser node
    if (!analyserNodeRef.current) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;
      analyserNodeRef.current = analyser;
      analyser.connect(ctx.destination);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyserNodeRef.current);

    source.onended = () => {
      // Natural end of track
      const cur = ctx.currentTime - startTimeRef.current;
      if (cur >= buffer.duration - 0.1) {
        setIsPlaying(false);
        pauseOffsetRef.current = 0;
        setCurrentTime(0);
      }
    };

    source.start(0, clampedOffset);
    sourceNodeRef.current = source;
    startTimeRef.current = ctx.currentTime - clampedOffset;
    pauseOffsetRef.current = clampedOffset;
    setCurrentTime(clampedOffset);
    setIsPlaying(true);
  };

  const pauseAudio = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch {}
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    pauseOffsetRef.current = currentTime;
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (isPlaying) {
      pauseAudio();
    } else {
      playAudio();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = parseFloat(e.target.value);
    pauseOffsetRef.current = targetTime;
    setCurrentTime(targetTime);
    if (isPlaying) {
      playAudio(targetTime);
    }
  };

  const jumpToChorus = () => {
    if (candidateProfile?.chorusWindow) {
      const target = candidateProfile.chorusWindow.startSec;
      pauseOffsetRef.current = target;
      setCurrentTime(target);
      playAudio(target);
    }
  };

  // Audio file processor using Web Audio API
  const processAudioFile = async (file: File) => {
    setIsAnalyzing(true);
    setErrorMessage(null);
    setAnalysisProgress('Lese Datei...');

    // Stop current playback
    pauseAudio();

    try {
      const arrayBuffer = await file.arrayBuffer();
      setAnalysisProgress('Decodiere PCM Audio...');

      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const audioCtx = audioCtxRef.current;
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      decodedBufferRef.current = audioBuffer;
      setDuration(audioBuffer.duration);
      setCurrentTime(0);
      pauseOffsetRef.current = 0;

      setAnalysisProgress('Berechne Metrologie & 32-Band Hüllkurve...');
      const analyzed = analyzeAudioBuffer(audioBuffer, file.name);

      const profile: ReferenceTrackProfile = {
        ...analyzed,
        id: `ref_${Date.now()}`,
        timestamp: Date.now()
      };

      setCandidateProfile(profile);
      setAnalysisProgress('');
    } catch (err: unknown) {
      console.error('Error analyzing reference audio', err);
      setErrorMessage(
        err instanceof Error ? err.message : 'Audio konnte nicht decodiert werden. Unterstützte Formate: WAV, MP3, AIFF, FLAC.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const processFilePath = async (filePath: string) => {
    const validExtensions = ['.wav', '.mp3', '.aiff', '.aif', '.flac'];
    const lower = filePath.toLowerCase();
    const hasValidExt = validExtensions.some((ext) => lower.endsWith(ext));
    if (!hasValidExt) {
      setErrorMessage('Bitte eine gültige Audiodatei ablegen (.wav, .mp3, .aiff, .flac).');
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage(null);
    setAnalysisProgress('Lade Datei von Finder...');

    try {
      const bytes = await invoke<number[]>('read_audio_file', { path: filePath });
      const u8 = new Uint8Array(bytes);
      const fileName = filePath.split('/').pop() || 'reference_audio';
      const ext = fileName.split('.').pop()?.toLowerCase() || 'wav';
      const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'flac' ? 'audio/flac' : 'audio/wav';
      const blob = new Blob([u8], { type: mime });
      const file = new File([blob], fileName, { type: mime });
      await processAudioFile(file);
    } catch (err: unknown) {
      console.error('Error reading dropped file from path', err);
      setErrorMessage(
        err instanceof Error ? err.message : 'Datei konnte nicht vom Dateisystem gelesen werden.'
      );
      setIsAnalyzing(false);
    }
  };

  // Tauri native drag & drop listener (intercepts macOS Finder drops)
  useEffect(() => {
    if (!isOpen) return;

    let unlisten: (() => void) | undefined;
    try {
      getCurrentWebview()
        .onDragDropEvent(async (event) => {
          if (event.payload.type === 'over' || event.payload.type === 'enter') {
            setIsDragging(true);
          } else if (event.payload.type === 'leave') {
            setIsDragging(false);
          } else if (event.payload.type === 'drop') {
            setIsDragging(false);
            const paths = event.payload.paths;
            if (paths && paths.length > 0) {
              await processFilePath(paths[0]);
            }
          }
        })
        .then((cleanup) => {
          unlisten = cleanup;
        })
        .catch((err) => {
          console.warn('Tauri onDragDropEvent listener error', err);
        });
    } catch (e) {
      console.warn('getCurrentWebview not available', e);
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, [isOpen]);

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
                Referenz-Track Profiler & Vault
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-700/50 text-indigo-300">
                  Sprint 4.2
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Audiodatei analysieren, Metrologie berechnen und in ~/.mixing-buddy/references/ speichern
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

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 bg-[#14171f] px-6 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('analyze')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition cursor-pointer ${
              activeTab === 'analyze'
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            <span>Referenz analysieren</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('saved')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition cursor-pointer ${
              activeTab === 'saved'
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bookmark className="w-4 h-4" />
            <span>Gespeicherte Referenzen</span>
            {savedReferences.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-900/80 text-indigo-300 font-mono">
                {savedReferences.length}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* TAB 1: Analyse & Dropzone */}
          {activeTab === 'analyze' && (
            <>
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

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    disabled={isSaving}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg bg-indigo-950/70 hover:bg-indigo-900/80 border border-indigo-500/40 text-indigo-300 hover:text-white transition disabled:opacity-50 cursor-pointer shadow-sm"
                    title="Referenz-Profil dauerhaft in ~/.mixing-buddy/references speichern"
                  >
                    {saveSuccess ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Gespeichert</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{isSaving ? 'Speichern...' : 'In Vault sichern'}</span>
                      </>
                    )}
                  </button>

                  {activeProfile?.id === candidateProfile.id && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Aktiv
                    </span>
                  )}
                </div>
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
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">True Peak</div>
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
                    {isPlaying
                      ? 'Live RTA Spektrum (Web Audio Playback)'
                      : '32-Band Hüllkurve (Lautestes 10s Chorus-Fenster)'}
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

              {/* Mini Audio Player (Pure Web Audio API) */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition shadow cursor-pointer"
                    title={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>

                  <div className="flex-1 flex flex-col gap-1">
                    <input
                      type="range"
                      min={0}
                      max={duration || candidateProfile.durationSeconds || 1}
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
                      className="flex items-center gap-1 text-[11px] font-semibold text-purple-300 hover:text-white bg-purple-950/60 hover:bg-purple-900/60 border border-purple-600/40 px-2.5 py-1 rounded transition cursor-pointer"
                      title="Springe direkt zum lautesten 10s Chorus-Abschnitt"
                    >
                      <Flame className="w-3 h-3 text-purple-400" />
                      <span>Chorus</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* TAB 2: Gespeicherte Referenzen aus ~/.mixing-buddy/references/ */}
      {activeTab === 'saved' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-indigo-400" />
                Persistente Referenz-Bibliothek
              </h3>
              <p className="text-xs text-slate-400">
                Gespeicherte Profile in <code className="text-indigo-300 font-mono text-[11px]">~/.mixing-buddy/references/</code>
              </p>
            </div>
            <button
              type="button"
              onClick={loadSavedReferences}
              disabled={isLoadingSaved}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition cursor-pointer"
              title="Bibliothek neu laden"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSaved ? 'animate-spin' : ''}`} />
              <span>Aktualisieren</span>
            </button>
          </div>

          {savedReferences.length === 0 ? (
            <div className="bg-[#171a21] border border-slate-800/90 rounded-xl p-8 text-center flex flex-col items-center justify-center gap-3">
              <div className="w-12 h-12 rounded-full bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-slate-500">
                <FolderHeart className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-300">Noch keine Referenzen gespeichert</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  Wechsle auf den Tab "Referenz analysieren", lege einen Track ab und klicke auf "In Vault sichern", um ihn dauerhaft zu speichern.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('analyze')}
                className="mt-1 px-3 py-1.5 text-xs font-semibold text-indigo-300 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/50 rounded-lg transition cursor-pointer"
              >
                Track analysieren
              </button>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
              {savedReferences.map((item) => {
                const isCurrentActive = activeProfile?.id === item.id;
                const isCandidate = candidateProfile?.id === item.id;

                return (
                  <div
                    key={item.id}
                    className={`bg-[#171a21] border rounded-xl p-4 transition-all duration-200 flex items-center justify-between gap-4 ${
                      isCurrentActive
                        ? 'border-emerald-500/60 bg-emerald-950/20 shadow-md'
                        : isCandidate
                        ? 'border-indigo-500/50 bg-indigo-950/10'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* Track Info */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`p-2.5 rounded-lg border shrink-0 ${
                        isCurrentActive
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                      }`}>
                        <Music className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white truncate" title={item.name}>
                            {item.name}
                          </h4>
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 uppercase">
                            {item.fileFormat}
                          </span>
                          {isCurrentActive && (
                            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold bg-emerald-950/80 border border-emerald-500/40 px-1.5 py-0.5 rounded">
                              <CheckCircle2 className="w-3 h-3" />
                              Aktiv
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                          <span className="font-mono text-cyan-400">{item.integratedLufs.toFixed(1)} LUFS</span>
                          <span>•</span>
                          <span className="font-mono text-emerald-400">{item.truePeakDb.toFixed(1)} dBTP</span>
                          <span>•</span>
                          <span className="font-mono text-amber-400">CF {item.crestFactorDb.toFixed(1)} dB</span>
                          <span>•</span>
                          <span>{formatTime(item.durationSeconds)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLoadSavedReference(item)}
                        className="px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700/80 transition cursor-pointer"
                        title="32-Band Spektrum im Profiler laden"
                      >
                        Hüllkurve
                      </button>

                      <button
                        type="button"
                        onClick={() => handleActivateSavedReference(item)}
                        className="flex items-center gap-1 px-3 py-1 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition shadow-sm cursor-pointer"
                        title="Direkt als HUD-Referenzziel aktivieren"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Aktivieren
                      </button>

                      <button
                        type="button"
                        onClick={(e) => handleDeleteSavedReference(item.id, e)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition cursor-pointer"
                        title="Aus Festplatten-Vault löschen"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
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
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition shadow-md cursor-pointer"
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
