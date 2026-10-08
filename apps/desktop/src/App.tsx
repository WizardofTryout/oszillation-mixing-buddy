import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  type MetrologyTelemetryFrame,
  type MeterSatellite,
  type MixActionProposal,
  type TrackDescriptor,
  type TargetProfile,
  type TargetScope,
  type GenreProfileId,
  type ReferenceTrackProfile,
  type MixingSkill,
  type MixingSkillSummary,
  resolveTargetProfile,
  detectGenreFromTelemetry,
  resolveScopeFromTrackName
} from '@mixing-buddy/shared-types';
import {
  isAmbiguousTrackName,
  classifySignalAcoustically,
  type AcousticTelemetrySnapshot
} from '@mixing-buddy/ai-engine';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { SpectrumAnalyzer } from './components/SpectrumAnalyzer.js';
import { LoudnessHUD } from './components/LoudnessHUD.js';
import { ActionCard } from './components/ActionCard.js';
import { ProviderSettings, type ProviderMode } from './components/ProviderSettings.js';
import { ChatConsole } from './components/ChatConsole.js';
import { CrossoverModal } from './components/CrossoverModal.js';
import { ReferenceTrackModal } from './components/ReferenceTrackModal.js';
import {
  PluginVaultModal,
  type LearnedPluginSpec,
  type PluginSummaryItem
} from './components/PluginVaultModal.js';
import { SkillManagerModal } from './components/SkillManagerModal.js';
import { SkillWizardModal } from './components/SkillWizardModal.js';
import { Sliders, Inbox, Sparkles, Database, Target, BarChart2, Star, ChevronDown, ChevronUp, Cpu, Search } from 'lucide-react';

const SatelliteMiniMeter: React.FC<{ lufs?: number }> = ({ lufs }) => {
  const level = lufs ?? -100;
  const isSilent = level < -55;
  const pct = Math.max(0, Math.min(100, ((level + 60) / 60) * 100));

  let barColor = 'bg-emerald-500';
  if (level > -6) {
    barColor = 'bg-rose-500';
  } else if (level > -18) {
    barColor = 'bg-amber-400';
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0" title={isSilent ? 'Kein Signal' : `${level.toFixed(1)} LUFS`}>
      <div className="w-10 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700/60 flex">
        {!isSilent && (
          <div
            className={`h-full ${barColor} transition-[width] duration-75 ease-out rounded-full`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <span className="text-[9px] font-mono w-9 text-right text-slate-400">
        {isSilent ? 'off' : `${level.toFixed(1)}`}
      </span>
    </div>
  );
};

export const App: React.FC = () => {
  const [telemetry, setTelemetry] = useState<MetrologyTelemetryFrame | null>(null);
  const [isAudioConnected, setIsAudioConnected] = useState<boolean>(false);
  const [defaultProvider, setDefaultProvider] = useState<ProviderMode>(() => {
    try {
      const saved = (localStorage.getItem('omb_default_provider') ||
        localStorage.getItem('omb_preferred_provider')) as ProviderMode;
      if (
        saved &&
        ['managed', 'byok_claude', 'byok_gemini', 'byok_openai', 'ollama', 'mcp_external'].includes(saved)
      ) {
        return saved;
      }
    } catch {}
    return 'byok_gemini';
  });

  const [providerMode, setProviderMode] = useState<ProviderMode>(() => {
    try {
      const saved = (localStorage.getItem('omb_default_provider') ||
        localStorage.getItem('omb_preferred_provider')) as ProviderMode;
      if (
        saved &&
        ['managed', 'byok_claude', 'byok_gemini', 'byok_openai', 'ollama', 'mcp_external'].includes(saved)
      ) {
        return saved;
      }
    } catch {}
    return 'byok_gemini';
  });
  const [activeDaw, setActiveDaw] = useState<string>('none');
  const [modelName, setModelName] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('omb_preferred_model');
      if (saved && saved.trim() && !saved.includes('2.5') && !saved.includes('1.5')) return saved.trim();
    } catch {}
    return 'gemini-3.8-flash';
  });
  const [apiKey, setApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('mixing_buddy_gemini_api_key') || '';
    } catch {
      return '';
    }
  });

  const handleSelectProviderMode = (mode: ProviderMode) => {
    setProviderMode(mode);
    try {
      localStorage.setItem('omb_preferred_provider', mode);
    } catch {}
  };

  const handleSetDefaultProvider = (mode: ProviderMode) => {
    setDefaultProvider(mode);
    try {
      localStorage.setItem('omb_default_provider', mode);
      localStorage.setItem('omb_preferred_provider', mode);
    } catch {}
  };

  const handleModelNameChange = (name: string) => {
    setModelName(name);
    try {
      localStorage.setItem('omb_preferred_model', name);
    } catch {}
  };
  const [proposals, setProposals] = useState<MixActionProposal[]>([]);
  const [chatLog, setChatLog] = useState<string | null>(null);
  const [mcpClientsCount, setMcpClientsCount] = useState<number>(0);
  const [cardFilter, setCardFilter] = useState<'all' | 'pinned'>('all');
  const [historyStack, setHistoryStack] = useState<Array<{
    id: string;
    proposalId?: string;
    timestamp: number;
    description: string;
    snapshot: Array<{
      track: string;
      parameter: string;
      previousValue: number;
      appliedValue: number;
      unit?: string;
      isMaster?: boolean;
      pluginName?: string | null;
      slotIndex?: number | null;
    }>;
    /** Optional: Sidechain-Routing-Undo. Falls gefüllt, wird beim Rückgängig-Machen
     *  set_sidechain mit source='None' aufgerufen, um das Routing wieder aufzuheben. */
    sidechainUndo?: {
      track: string;
      slot: number;
    };
  }>>([]);

  // Accordion UI state for cleaner layout
  const [isAiConfigOpen, setIsAiConfigOpen] = useState<boolean>(false);
  const [isRecommendationsOpen, setIsRecommendationsOpen] = useState<boolean>(true);

  // Sprint 3: Target Bus & Genre Profile State (DAW Session Persistent)
  const [targetScope, setTargetScope] = useState<TargetScope>('mix_bus');
  const [genreProfile, setGenreProfile] = useState<GenreProfileId>('pop_radio');
  const [customNotes, setCustomNotes] = useState<string>('');
  const [customProfile, setCustomProfile] = useState<TargetProfile | undefined>(undefined);
  const [detectedGenre, setDetectedGenre] = useState<GenreProfileId | null>(null);
  const [isCrossoverModalOpen, setIsCrossoverModalOpen] = useState<boolean>(false);
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState<boolean>(false);
  const [activeReferenceProfile, setActiveReferenceProfile] = useState<ReferenceTrackProfile | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Phase 2A, 2C & Learning: Active Meter Track, Auto-Scope & Acoustic Classification State
  const [activeMeterTrack, setActiveMeterTrack] = useState<string | null>(null);
  const [isManualScopeOverride, setIsManualScopeOverride] = useState<boolean>(false);
  const [scopeDetectionSource, setScopeDetectionSource] = useState<'text' | 'audio' | 'manual' | 'learned'>('text');
  const [pendingClarification, setPendingClarification] = useState<{
    trackName: string;
    text: string;
  } | null>(null);
  const prevMeterTrackRef = useRef<string | null>(null);
  const activeMeterTrackRef = useRef<string | null>(null);
  const askedClarificationTrackRef = useRef<string | null>(null);

  useEffect(() => {
    activeMeterTrackRef.current = activeMeterTrack;
  }, [activeMeterTrack]);

  // Phase 3: Multi-Instance Satellites State & Router
  const [satellites, setSatellites] = useState<MeterSatellite[]>([]);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const activeInstanceIdRef = useRef<string | null>(null);
  const [isSatelliteDropdownOpen, setIsSatelliteDropdownOpen] = useState<boolean>(false);
  const satelliteDropdownRef = useRef<HTMLDivElement | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeInstanceIdRef.current = activeInstanceId;
  }, [activeInstanceId]);

  // Fetch initial satellites and listen for satellite registry updates
  useEffect(() => {
    invoke<MeterSatellite[]>('get_meter_satellites')
      .then((sats) => {
        if (Array.isArray(sats)) {
          setSatellites(sats);
        }
      })
      .catch(() => {});

  let unlisten: (() => void) | null = null;
    listen<MeterSatellite[]>('meter_instances_changed', (event) => {
      if (Array.isArray(event.payload)) {
        setSatellites(event.payload);
      }
    }).then((un) => {
      unlisten = un;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Click-outside listener for satellite dropdown & mobile hamburger menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (satelliteDropdownRef.current && !satelliteDropdownRef.current.contains(e.target as Node)) {
        setIsSatelliteDropdownOpen(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setIsMobileMenuOpen(false);
      }
    };
    if (isSatelliteDropdownOpen || isMobileMenuOpen) {
      window.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSatelliteDropdownOpen, isMobileMenuOpen]);

  const handleSelectSatellite = async (sat: MeterSatellite) => {
    setActiveInstanceId(sat.instance_id);
    activeInstanceIdRef.current = sat.instance_id;
    setActiveMeterTrack(sat.track_name);
    activeMeterTrackRef.current = sat.track_name;
    setIsSatelliteDropdownOpen(false);
    setIsMobileMenuOpen(false);
    try {
      await invoke('set_active_meter_instance', { instanceId: sat.instance_id });
    } catch (e) {
      console.error('Failed to set active meter instance', e);
    }
  };

  // Persistent map of user-confirmed track roles across sessions and plugin movements
  const [learnedTrackScopes, setLearnedTrackScopes] = useState<Record<string, TargetScope>>(() => {
    try {
      const saved = localStorage.getItem('mixing_buddy_learned_track_scopes');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const rememberTrackScope = (trackName: string, scope: TargetScope) => {
    const key = trackName.trim().toLowerCase();
    setLearnedTrackScopes((prev) => {
      const next = { ...prev, [key]: scope };
      try {
        localStorage.setItem('mixing_buddy_learned_track_scopes', JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save learned track scope', e);
      }
      return next;
    });
  };

  const unlearnTrackScope = (trackName: string) => {
    const key = trackName.trim().toLowerCase();
    setLearnedTrackScopes((prev) => {
      const next = { ...prev };
      delete next[key];
      try {
        localStorage.setItem('mixing_buddy_learned_track_scopes', JSON.stringify(next));
      } catch (e) {
        console.error('Failed to unlearn track scope', e);
      }
      return next;
    });
  };

  // Satellite search filter state & client-side filtered list
  const [satelliteSearchQuery, setSatelliteSearchQuery] = useState<string>('');

  const filteredSatellites = useMemo(() => {
    if (!satelliteSearchQuery.trim()) return satellites;
    const q = satelliteSearchQuery.toLowerCase();
    return satellites.filter((sat) => {
      const nameMatch = sat.track_name.toLowerCase().includes(q);
      const roleMatch = (learnedTrackScopes[sat.track_name.trim().toLowerCase()] || '').toLowerCase().includes(q);
      return nameMatch || roleMatch;
    });
  }, [satellites, satelliteSearchQuery, learnedTrackScopes]);

  const effectiveGenre = genreProfile === 'auto_detect' ? (detectedGenre || 'pop_radio') : genreProfile;
  const activeTargetProfile = useMemo(() => {
    return resolveTargetProfile(effectiveGenre, targetScope, customProfile);
  }, [effectiveGenre, targetScope, customProfile]);

  // Phase 2A, 2C & Learning: Auto-Scope & Acoustic Telemetry Detection when activeMeterTrack changes
  useEffect(() => {
    if (activeMeterTrack) {
      const trackKey = activeMeterTrack.trim().toLowerCase();
      if (prevMeterTrackRef.current && prevMeterTrackRef.current !== activeMeterTrack) {
        setIsManualScopeOverride(false);
        askedClarificationTrackRef.current = null;
        setPendingClarification(null);
      }
      prevMeterTrackRef.current = activeMeterTrack;

      // 1. Höchste Priorität: Haben wir uns die Rolle für diese Spur bereits gemerkt?
      const savedScope = learnedTrackScopes[trackKey];
      if (savedScope) {
        setScopeDetectionSource('learned');
        setPendingClarification(null);
        if (savedScope !== targetScope) {
          setTargetScope(savedScope);
          const updated = resolveTargetProfile(effectiveGenre, savedScope, customProfile);
          syncContextToPlugin(savedScope, genreProfile, customNotes, updated.targetIntegratedLufs, updated);
        }
        return;
      }

      if (!isManualScopeOverride) {
        // Prüfe ob der Spurname mehrdeutig / generisch ist (z. B. "Audio 1", "Spur 2", "Loop")
        if (isAmbiguousTrackName(activeMeterTrack)) {
          const snapshot: AcousticTelemetrySnapshot = {
            spectrum32Bands: telemetry?.spectrum?.frequencyBands,
            crestFactorDb: telemetry?.dynamics?.crestFactorDb,
            integratedLufs: telemetry?.loudness?.integratedLufs,
            momentaryLufs: telemetry?.loudness?.momentaryLufs
          };
          const acousticResult = classifySignalAcoustically(snapshot, activeMeterTrack);

          if (acousticResult.confidence >= 0.75) {
            setScopeDetectionSource('audio');
            if (pendingClarification) {
              setPendingClarification({
                trackName: activeMeterTrack,
                text: `Akustisch erkannt als ${acousticResult.scope.replace('_', ' ').toUpperCase()} (${Math.round(acousticResult.confidence * 100)}%). Bestätigen oder Rolle wählen:`
              });
            }
            if (acousticResult.scope !== targetScope) {
              setTargetScope(acousticResult.scope);
              const updated = resolveTargetProfile(effectiveGenre, acousticResult.scope, customProfile);
              syncContextToPlugin(acousticResult.scope, genreProfile, customNotes, updated.targetIntegratedLufs, updated);
            }
          } else {
            // Signal unklar (confidence < 0.75): Interaktive System-Rückfrage im Chat anbieten
            if (askedClarificationTrackRef.current !== activeMeterTrack) {
              askedClarificationTrackRef.current = activeMeterTrack;
              setPendingClarification({
                trackName: activeMeterTrack,
                text: `Ich höre auf der Spur '${activeMeterTrack}' ein dynamisches Signal, das nicht eindeutig benannt ist. Welche Rolle hat diese Spur?`
              });
            }
          }
        } else {
          // Eindeutiger Text-Name (z. B. "Studio Grand", "Kick", "Lead Vocal")
          const autoScope = resolveScopeFromTrackName(activeMeterTrack);
          setScopeDetectionSource('text');
          setPendingClarification(null);
          if (autoScope !== targetScope) {
            setTargetScope(autoScope);
            const updated = resolveTargetProfile(effectiveGenre, autoScope, customProfile);
            syncContextToPlugin(autoScope, genreProfile, customNotes, updated.targetIntegratedLufs, updated);
          }
        }
      }
    }
  }, [activeMeterTrack, isManualScopeOverride, effectiveGenre, genreProfile, customNotes, customProfile, targetScope, telemetry, learnedTrackScopes]);

  const handleSelectClarificationScope = (scope: TargetScope) => {
    setIsManualScopeOverride(true);
    setScopeDetectionSource('learned');
    setPendingClarification(null);
    if (activeMeterTrack) {
      rememberTrackScope(activeMeterTrack, scope);
    }
    setTargetScope(scope);
    const updated = resolveTargetProfile(effectiveGenre, scope, customProfile);
    syncContextToPlugin(scope, genreProfile, customNotes, updated.targetIntegratedLufs, updated);
  };

  const syncContextToPlugin = (
    scope: TargetScope,
    genre: GenreProfileId,
    notes: string,
    lufs: number,
    profile?: TargetProfile
  ) => {
    const payload = {
      type: 'set_project_context',
      targetScope: scope,
      genreProfile: genre,
      customNotes: notes,
      targetLufs: lufs,
      targetProfile: profile
    };
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  };

  const handleTargetScopeChange = (newScope: TargetScope) => {
    setTargetScope(newScope);
    if (activeMeterTrack) {
      rememberTrackScope(activeMeterTrack, newScope);
      setScopeDetectionSource('learned');
    }
    const updated = resolveTargetProfile(effectiveGenre, newScope, customProfile);
    syncContextToPlugin(newScope, genreProfile, customNotes, updated.targetIntegratedLufs, updated);
  };

  const handleGenreProfileChange = (newGenre: GenreProfileId) => {
    setGenreProfile(newGenre);
    if (newGenre === 'custom_crossover') {
      setIsCrossoverModalOpen(true);
    }
    const eff = newGenre === 'auto_detect' ? (detectedGenre || 'pop_radio') : newGenre;
    const updated = resolveTargetProfile(eff, targetScope, customProfile);
    syncContextToPlugin(targetScope, newGenre, customNotes, updated.targetIntegratedLufs, updated);
  };

  const handleSaveCrossoverProfile = (updatedProfile: TargetProfile) => {
    setCustomProfile(updatedProfile);
    setGenreProfile('custom_crossover');
    setCustomNotes(updatedProfile.customNotes || '');
    syncContextToPlugin(targetScope, 'custom_crossover', updatedProfile.customNotes || '', updatedProfile.targetIntegratedLufs, updatedProfile);
    setChatLog(`💾 Crossover-Ziele "${updatedProfile.name}" im DAW-Projekt gesichert.`);
  };

  const handleApplyReferenceProfile = (profile: ReferenceTrackProfile) => {
    setActiveReferenceProfile(profile);
    setChatLog(`📊 Referenz-Track "${profile.name}" aktiviert (${profile.integratedLufs.toFixed(1)} LUFS, Crest ${profile.crestFactorDb.toFixed(1)} dB).`);
  };

  // Load pinned cards from localStorage on initial mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('mixing_buddy_pinned_cards');
      if (raw) {
        const saved = JSON.parse(raw) as MixActionProposal[];
        if (Array.isArray(saved) && saved.length > 0) {
          setProposals((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const uniqueSaved = saved
              .filter((p) => !existingIds.has(p.id))
              .map((p) => ({ ...p, isPinned: true }));
            return [...uniqueSaved, ...prev];
          });
        }
      }
    } catch (e) {
      console.error('Failed to load pinned cards from localStorage', e);
    }
  }, []);

  const handleTogglePin = (id: string) => {
    setProposals((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, isPinned: !p.isPinned } : p));
      const pinned = next.filter((p) => p.isPinned);
      try {
        localStorage.setItem('mixing_buddy_pinned_cards', JSON.stringify(pinned));
      } catch (e) {
        console.error('Failed to save pinned cards to localStorage', e);
      }
      return next;
    });
  };

  // Plugin Vault & 1-Click Auto-Profiler state
  const [isVaultOpen, setIsVaultOpen] = useState<boolean>(false);
  const [vaultMode, setVaultMode] = useState<'confirm_learn' | 'vault_drawer'>('vault_drawer');
  const [learnedSpec, setLearnedSpec] = useState<LearnedPluginSpec | null>(null);
  const [vaultPlugins, setVaultPlugins] = useState<PluginSummaryItem[]>([]);
  const [isLearningPlugin, setIsLearningPlugin] = useState<boolean>(false);
  const [learnError, setLearnError] = useState<string | null>(null);

  // Sprint 5: Custom Mixing Skills state
  const [isSkillModalOpen, setIsSkillModalOpen] = useState<boolean>(false);
  const [isSkillWizardOpen, setIsSkillWizardOpen] = useState<boolean>(false);
  const [skillsCount, setSkillsCount] = useState<number>(1);
  const [activeSkill, setActiveSkill] = useState<MixingSkill | null>(null);
  const [availableSkills, setAvailableSkills] = useState<MixingSkillSummary[]>([]);

  const handleApiKeyChange = (key: string) => {
    setApiKey(key);
    try {
      localStorage.setItem('mixing_buddy_gemini_api_key', key);
    } catch {}
  };

  // Poll MCP server health on port 48124 every 3 seconds to detect active stdio / SSE MCP server
  useEffect(() => {
    let mcpTimer: NodeJS.Timeout;

    const checkMcpHealth = async () => {
      try {
        const res = await fetch('http://127.0.0.1:48124/health');
        if (res.ok) {
          const data = await res.json();
          const sessions = typeof data.sessions === 'number' ? data.sessions : 0;
          setMcpClientsCount(Math.max(1, sessions));
        } else {
          setMcpClientsCount(0);
        }
      } catch {
        setMcpClientsCount(0);
      }
      mcpTimer = setTimeout(checkMcpHealth, 3000);
    };

    checkMcpHealth();
    return () => clearTimeout(mcpTimer);
  }, []);

  // Live track state — populated exclusively from GET /api/tracks (no static fallbacks)
  const [liveTracks, setLiveTracks] = useState<TrackDescriptor[]>([]);
  const [lastTrackFetch, setLastTrackFetch] = useState<number>(0);

  // Poll /api/tracks every 2 seconds + on window-focus for live plugin data
  useEffect(() => {
    let timer: NodeJS.Timeout;

    const fetchTracks = async () => {
      try {
        let json: any = null;
        try {
          // 1. Native Tauri IPC: get_tracks
          json = await invoke('get_tracks');
        } catch (ipcErr) {
          console.warn('[App] Native get_tracks failed:', ipcErr);
        }

        if (!json || (!json.tracks?.length && !json.active_meter_track)) {
          try {
            // 2. Native Tauri IPC fallback: list_channel_strips
            const rawStrips: any = await invoke('list_channel_strips');
            if (rawStrips && (rawStrips.channelStrips || rawStrips.active_meter_track)) {
              const strips = rawStrips.channelStrips || [];
              const tracks = strips.map((s: any, idx: number) => ({
                id: `track_${idx + 1}`,
                index: idx,
                name: s.trackName || `Track ${idx + 1}`,
                type: (s.trackName || '').toLowerCase().includes('stereo out') ? 'master' : 'audio',
                volumeDb: s.faderDb || 0,
                pan: s.pan || 0,
                isMuted: !!s.mute,
                isSoloed: !!s.solo,
                isSelected: idx === 0,
                insertSlots: (s.inserts || []).map((ins: any) => ({
                  slotIndex: ins.slot || 1,
                  pluginName: ins.name || 'Plugin',
                  isEnabled: true,
                })),
              }));
              json = {
                tracks,
                active_meter_track: rawStrips.active_meter_track,
              };
            }
          } catch (stripErr) {
            console.warn('[App] Native list_channel_strips fallback failed:', stripErr);
          }
        }

        if (!json || (!json.tracks?.length && !json.active_meter_track)) {
          try {
            // 3. HTTP Fallback
            const res = await fetch('http://127.0.0.1:48123/api/tracks');
            if (res.ok) {
              json = await res.json();
            }
          } catch {
            // Silently wait if IPC is starting up
          }
        }

        if (json) {
          const tracks: TrackDescriptor[] = Array.isArray(json.tracks)
            ? json.tracks
            : Array.isArray(json)
            ? json
            : [];
          if (tracks.length > 0) {
            setLiveTracks(tracks);
            setLastTrackFetch(Date.now());
          }

          let meterTrack: string | null = json.active_meter_track || null;
          if (!meterTrack && tracks.length > 0) {
            for (const t of tracks) {
              if (
                t.insertSlots &&
                t.insertSlots.some((s) => {
                  const p = (s?.pluginName || '').toLowerCase();
                  return (
                    p.includes('mixingbuddymeter') ||
                    p.includes('mixingbuddy') ||
                    p.includes('mixingbudd') ||
                    p.includes('the ear')
                  );
                })
              ) {
                meterTrack = t.name;
                break;
              }
            }
          }
          // Phase 3 Multi-Instance Protection:
          // Nie einen bestehenden aktiven Abhörpunkt überschreiben!
          // Der Abhörpunkt wird primär über die echten 30-fps Telemetrie-Frames und den Satelliten-Manager gesteuert.
          if (meterTrack && !activeMeterTrackRef.current) {
            setActiveMeterTrack((current) => current || meterTrack);
          }
        }
      } catch {
        // Silently wait
      }
      timer = setTimeout(fetchTracks, 2000);
    };

    fetchTracks();

    const onFocus = () => fetchTracks();
    window.addEventListener('focus', onFocus);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // availableTracks is the live feed — never static
  const availableTracks: TrackDescriptor[] = liveTracks;
  // Expose lastTrackFetch to suppress lint warning
  void lastTrackFetch;


  // 1. Dynamic DAW detection from Rust backend (updates immediately when DAW opens or closes)
  useEffect(() => {
    let dawPollTimer: NodeJS.Timeout;

    const checkActiveDaw = async () => {
      let resolvedDaw: string | null = null;
      try {
        const daw = await invoke<string>('get_active_daw');
        if (daw) {
          resolvedDaw = daw;
        }
      } catch {
        // Fallback to HTTP endpoint on IPC server (127.0.0.1:48123)
      }

      if (!resolvedDaw) {
        try {
          const res = await fetch('http://127.0.0.1:48123/api/project');
          if (res.ok) {
            const data = await res.json();
            if (typeof data.dawId === 'string') {
              resolvedDaw = data.dawId;
            } else if (typeof data.daw === 'string') {
              const lower = data.daw.toLowerCase();
              resolvedDaw = lower.includes('logic')
                ? 'logic_pro'
                : lower.includes('nuendo')
                ? 'nuendo'
                : lower.includes('cubase')
                ? 'cubase'
                : 'none';
            }
          }
        } catch {
          // Ignore HTTP error
        }
      }

      const nextDaw = resolvedDaw || 'none';
      setActiveDaw(nextDaw);
      if (nextDaw.toLowerCase().includes('none')) {
        setLiveTracks([]);
      }

      dawPollTimer = setTimeout(checkActiveDaw, 2000);
    };

    checkActiveDaw();

    const onWindowFocus = () => {
      clearTimeout(dawPollTimer);
      checkActiveDaw();
    };
    window.addEventListener('focus', onWindowFocus);

    let unlistenDaw: (() => void) | null = null;
    listen<string>('daw-status-changed', (event) => {
      const nextDaw = event.payload || 'none';
      setActiveDaw(nextDaw);
      if (nextDaw.toLowerCase().includes('none')) {
        setLiveTracks([]);
      }
    })
      .then((cleanup) => {
        unlistenDaw = cleanup;
      })
      .catch(() => {});

    return () => {
      clearTimeout(dawPollTimer);
      window.removeEventListener('focus', onWindowFocus);
      if (unlistenDaw) unlistenDaw();
    };
  }, []);

  // 2. Connect to local WebSocket IPC stream (ws://127.0.0.1:48123/meter) and Tauri native events
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: NodeJS.Timeout;
    let streamWatchdogTimer: NodeJS.Timeout;
    let unlistenTelemetry: (() => void) | null = null;
    let unlistenStreamingStatus: (() => void) | null = null;
    let unlistenProposal: (() => void) | null = null;
    let unlistenExecute: (() => void) | null = null;
    let unlistenProjectSync: (() => void) | null = null;

    const resetStreamWatchdog = () => {
      clearTimeout(streamWatchdogTimer);
      streamWatchdogTimer = setTimeout(() => {
        setIsAudioConnected(false);
        setTelemetry(null);
      }, 1500);
    };

    // A. Subscribe to native Tauri IPC telemetry event
    listen<string | MetrologyTelemetryFrame>('telemetry-frame', (event) => {
      try {
        const frame: MetrologyTelemetryFrame =
          typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
        if (frame && frame.loudness) {
          setTelemetry(frame);
          setIsAudioConnected(true);
          resetStreamWatchdog();

          if (frame.instanceId && !activeInstanceIdRef.current) {
            setActiveInstanceId(frame.instanceId);
            activeInstanceIdRef.current = frame.instanceId;
          }
          if (frame.trackName && (!activeMeterTrackRef.current || activeInstanceIdRef.current === frame.instanceId)) {
            if (activeMeterTrackRef.current !== frame.trackName) {
              setActiveMeterTrack(frame.trackName);
              activeMeterTrackRef.current = frame.trackName;
            }
          }

          if (genreProfile === 'auto_detect') {
            const detected = detectGenreFromTelemetry(frame);
            setDetectedGenre(detected);
          }
        }
      } catch {
        // Ignore parse errors
      }
    })
      .then((cleanup) => {
        unlistenTelemetry = cleanup;
      })
      .catch(() => {});

    // A2. Subscribe to DAW project context sync event (from JUCE plugin setStateInformation)
    listen<string>('project-context-sync', (event) => {
      try {
        const raw = event.payload;
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (data.type === 'project_context_sync') {
          if (!activeMeterTrackRef.current && data.targetScope) {
            setTargetScope(data.targetScope);
          }
          if (data.genreProfile) setGenreProfile(data.genreProfile);
          if (data.customNotes !== undefined) setCustomNotes(data.customNotes);
          if (data.targetProfile) setCustomProfile(data.targetProfile);
          console.log(`[OMB] DAW-Projekt-Persistenz synchronisiert: Scope "${data.targetScope}", Genre "${data.genreProfile}"`);
        }
      } catch (err) {
        console.error('Error handling project-context-sync', err);
      }
    })
      .then((cleanup) => {
        unlistenProjectSync = cleanup;
      })
      .catch(() => {});

    // A2. Subscribe to Rust backend 1.5s heartbeat watchdog event
    listen<{ streaming: boolean }>('audio-streaming-status', (event) => {
      if (event.payload && event.payload.streaming === false) {
        setIsAudioConnected(false);
        setTelemetry(null);
      }
    })
      .then((cleanup) => {
        unlistenStreamingStatus = cleanup;
      })
      .catch(() => {});

    // B. Subscribe to native Tauri IPC proposal event (from MCP server or external agents)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listen<any>('new-action-proposal', (event) => {
      try {
        const raw = event.payload;
        let p: MixActionProposal | null = null;
        if (typeof raw === 'string') {
          const parsed = JSON.parse(raw);
          p = parsed.proposal || (parsed.deltas ? parsed : null);
        } else if (raw && typeof raw === 'object') {
          p = raw.proposal || (raw.deltas ? raw : null);
        }

        if (p && p.id && Array.isArray(p.deltas)) {
          setProposals((prev) => {
            const exists = prev.findIndex((item) => item.id === p!.id);
            if (exists >= 0) {
              const copy = [...prev];
              copy[exists] = p!;
              return copy;
            }
            return [p!, ...prev];
          });
        }
      } catch (err) {
        console.error('Error handling new-action-proposal', err);
      }
    })
      .then((cleanup) => {
        unlistenProposal = cleanup;
      })
      .catch(() => {});

    // C. Subscribe to external DAW execution command
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listen<any>('execute-daw-action', async (event) => {
      try {
        const raw = event.payload;
        const cmd = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (cmd && cmd.parameterName) {
          const isLogicLocal = activeDaw.toLowerCase().includes('logic');
          await invoke('apply_daw_action', {
            trackName: cmd.trackName || cmd.trackId || (isLogicLocal ? 'Stereo Out' : 'Channel 1'),
            parameter: cmd.parameterName,
            value: typeof cmd.value === 'number' ? cmd.value : 0.0,
            unit: cmd.unit || 'dB',
            isMaster: cmd.isMaster ?? false,
            pluginName: cmd.pluginName || null,
            slotIndex: typeof cmd.slotIndex === 'number' && cmd.slotIndex > 0 ? cmd.slotIndex : null
          });
          setChatLog(`⚡ Externer MCP-Befehl ausgeführt: ${cmd.parameterName} auf ${cmd.value}`);
        }
      } catch (e) {
        console.error('Error executing DAW action from external trigger', e);
      }
    })
      .then((cleanup) => {
        unlistenExecute = cleanup;
      })
      .catch(() => {});

    // D. Connect to WebSocket stream (only set isAudioConnected=true when real telemetry frames arrive)
    const connectWebSocket = () => {
      try {
        ws = new WebSocket('ws://127.0.0.1:48123/meter');
        wsRef.current = ws;

        ws.onopen = () => {
          syncContextToPlugin(targetScope, genreProfile, customNotes, activeTargetProfile.targetIntegratedLufs, activeTargetProfile);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            // Sprint 3: Handle project context sync from JUCE plugin
            if (data.type === 'project_context_sync') {
              if (!activeMeterTrackRef.current && data.targetScope) {
                setTargetScope(data.targetScope);
              }
              if (data.genreProfile) setGenreProfile(data.genreProfile);
              if (data.customNotes !== undefined) setCustomNotes(data.customNotes);
              if (data.targetProfile) setCustomProfile(data.targetProfile);
              console.log(`[OMB] DAW-Projekt-Persistenz synchronisiert: Scope "${data.targetScope}", Genre "${data.genreProfile}"`);
              return;
            }

            // Handle incoming MCP action proposal
            if (data.type === 'action_proposal' && data.proposal) {
              const p = data.proposal as MixActionProposal;
              setProposals((prev) => {
                const idx = prev.findIndex((item) => item.id === p.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = p;
                  return copy;
                }
                return [p, ...prev];
              });
              return;
            }

            if (data.deltas && data.title) {
              const p = data as MixActionProposal;
              setProposals((prev) => {
                const idx = prev.findIndex((item) => item.id === p.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = p;
                  return copy;
                }
                return [p, ...prev];
              });
              return;
            }

            // Normal audio telemetry frame from "The Ear" plugin
            if (data && data.loudness) {
              const frame: MetrologyTelemetryFrame = data;
              setTelemetry(frame);
              setIsAudioConnected(true);
              resetStreamWatchdog();

              if (genreProfile === 'auto_detect') {
                const detected = detectGenreFromTelemetry(frame);
                setDetectedGenre(detected);
              }
            }
          } catch {
            // Ignore parse errors
          }
        };

        ws.onclose = () => {
          setIsAudioConnected(false);
          setTelemetry(null);
          retryTimer = setTimeout(connectWebSocket, 2000);
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        retryTimer = setTimeout(connectWebSocket, 2000);
      }
    };

    connectWebSocket();

    return () => {
      clearTimeout(retryTimer);
      clearTimeout(streamWatchdogTimer);
      ws?.close();
      if (unlistenTelemetry) unlistenTelemetry();
      if (unlistenStreamingStatus) unlistenStreamingStatus();
      if (unlistenProposal) unlistenProposal();
      if (unlistenExecute) unlistenExecute();
      if (unlistenProjectSync) unlistenProjectSync();
    };
  }, []);

  // When a proposal references a track not yet in liveTracks, add it dynamically
  const ensureProposalTrackExists = (trackId: string, trackName: string) => {
    if (!liveTracks.some((t) => t.name.toLowerCase() === trackName.toLowerCase() || t.id === trackId)) {
      setLiveTracks((prev) => [
        ...prev,
        {
          id: trackId || `track_${Date.now()}`,
          index: prev.length,
          name: trackName,
          type: (trackName.toLowerCase().includes('master') || trackName.toLowerCase().includes('stereo'))
            ? 'master'
            : 'audio',
          volumeDb: 0.0,
          pan: 0.0,
          isMuted: false,
          isSoloed: false,
          isSelected: false,
          insertSlots: []
        }
      ]);
    }
  };

  const handleApplyAction = async (id: string, selectedIndices?: number[]) => {
    const proposal = proposals.find((p) => p.id === id);
    if (!proposal) return;

    const isLogic = activeDaw.toLowerCase().includes('logic');
    const dawLabel = isLogic ? 'Logic Pro' : activeDaw === 'none' ? 'Standalone' : 'Nuendo';

    // Filtere nach ausgewählten Checkboxen falls übergeben
    const deltasToApply = selectedIndices !== undefined
      ? proposal.deltas.filter((_, idx) => selectedIndices.includes(idx))
      : proposal.deltas;

    if (deltasToApply.length === 0) {
      setChatLog(`⚠️ Keine Parameter zum Anwenden ausgewählt.`);
      return;
    }

    // Validate volume adjustments through Acoustic Shock Shield
    for (const delta of deltasToApply) {
      if (delta.parameterName === 'volume' || delta.parameterName === 'fader_db') {
        try {
          await invoke('validate_volume_adjustment', {
            trackId: delta.trackId,
            isMaster: delta.trackName.toLowerCase().includes('master') || delta.trackName.toLowerCase().includes('stereo'),
            proposedDb: delta.proposedValue
          });
        } catch (err: unknown) {
          setChatLog(`🛡️ Acoustic Shock Shield: Anpassung für '${delta.trackName}' blockiert: ${String(err)}`);
          return;
        }
      }
    }

    // Ensure all referenced tracks exist in liveTracks
    for (const delta of deltasToApply) {
      ensureProposalTrackExists(delta.trackId, delta.trackName);
    }

    // Snapshot for Undo-Stack
    const snapshot = deltasToApply.map((delta) => ({
      track: delta.trackName || (isLogic ? 'Stereo Out' : 'Channel 1'),
      parameter: delta.parameterName || 'EQ',
      previousValue: delta.currentValue ?? 0.0,
      appliedValue: delta.proposedValue ?? 0.0,
      unit: delta.unit ?? 'dB',
      isMaster: delta.trackName.toLowerCase().includes('master') || delta.trackName.toLowerCase().includes('stereo'),
      pluginName: delta.pluginName || null,
      slotIndex: typeof delta.slotIndex === 'number' && delta.slotIndex > 0 ? delta.slotIndex : null
    }));

    try {
      // 1. Physisches Sidechain-Routing (vor den Parameteränderungen verdrahten)
      if (proposal.sidechainRoute) {
        await invoke('set_sidechain', {
          track: proposal.sidechainRoute.trackName,
          slot: proposal.sidechainRoute.slotIndex,
          source: proposal.sidechainRoute.sourcePath
        });
        setChatLog(`🔗 Sidechain verdrahtet: ${proposal.sidechainRoute.sourcePath} → ${proposal.sidechainRoute.trackName} Slot ${proposal.sidechainRoute.slotIndex}`);
      }

      // 2. Parameter-Änderungen an die DAW senden
      for (const delta of deltasToApply) {
        await invoke('apply_daw_action', {
          trackName: delta.trackName || (isLogic ? 'Stereo Out' : 'Channel 1'),
          parameter: delta.parameterName || 'EQ',
          value: delta.proposedValue ?? 0.0,
          currentValue: delta.currentValue ?? 0.0,
          isRestore: false,
          unit: delta.unit ?? 'dB',
          isMaster: delta.trackName.toLowerCase().includes('master') || delta.trackName.toLowerCase().includes('stereo'),
          pluginName: delta.pluginName || null,
          slotIndex: typeof delta.slotIndex === 'number' && delta.slotIndex > 0 ? delta.slotIndex : null
        });
      }

      // 3. Undo-Stack-Eintrag (inkl. optionalem Sidechain-Undo)
      const historyItem = {
        id: `hist_${Date.now()}`,
        proposalId: id,
        timestamp: Date.now(),
        description: proposal.title,
        snapshot,
        // Sidechain-Undo: source wird auf 'None' gesetzt, um Routing aufzuheben
        ...(proposal.sidechainRoute
          ? {
              sidechainUndo: {
                track: proposal.sidechainRoute.trackName,
                slot: proposal.sidechainRoute.slotIndex
              }
            }
          : {})
      };
      setHistoryStack((prev) => [historyItem, ...prev]);

      setProposals((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'applied' } : p))
      );
      setChatLog(`✅ Anpassung angewendet: "${proposal.title}" (${deltasToApply.length} Parameter) erfolgreich an ${dawLabel} gesendet.`);
    } catch (err: unknown) {
      setChatLog(`❌ Fehler beim Anwenden: ${String(err)}`);
    }
  };

  const handleRollbackSingleDelta = async (proposalId: string, deltaIndex: number) => {
    const proposal = proposals.find((p) => p.id === proposalId);
    if (!proposal) return;
    const delta = proposal.deltas[deltaIndex];
    if (!delta) return;

    const isLogic = activeDaw.toLowerCase().includes('logic');
    const dawLabel = isLogic ? 'Logic Pro' : activeDaw === 'none' ? 'Standalone' : 'Nuendo';

    try {
      setChatLog(`↩ Rollback (${dawLabel}): Setze ${delta.trackName} › ${delta.parameterName} auf ${delta.currentValue} zurück...`);
      await invoke('apply_daw_action', {
        trackName: delta.trackName || (isLogic ? 'Stereo Out' : 'Channel 1'),
        parameter: delta.parameterName || 'EQ',
        value: delta.currentValue ?? 0.0,
        currentValue: delta.proposedValue ?? 0.0,
        isRestore: true,
        unit: delta.unit ?? 'dB',
        isMaster: delta.trackName.toLowerCase().includes('master') || delta.trackName.toLowerCase().includes('stereo'),
        pluginName: delta.pluginName || null,
        slotIndex: typeof delta.slotIndex === 'number' && delta.slotIndex > 0 ? delta.slotIndex : null
      });

      setChatLog(`✅ Rollback erfolgreich: ${delta.parameterName} auf ${delta.currentValue} ${delta.unit ?? 'dB'} zurückgesetzt.`);
    } catch (err: unknown) {
      setChatLog(`❌ Fehler beim Rollback: ${String(err)}`);
    }
  };

  const handleRedoSingleDelta = async (proposalId: string, deltaIndex: number) => {
    const proposal = proposals.find((p) => p.id === proposalId);
    if (!proposal) return;
    const delta = proposal.deltas[deltaIndex];
    if (!delta) return;

    const isLogic = activeDaw.toLowerCase().includes('logic');
    const dawLabel = isLogic ? 'Logic Pro' : activeDaw === 'none' ? 'Standalone' : 'Nuendo';

    try {
      setChatLog(`↷ Wiederherstellen (${dawLabel}): Wende ${delta.trackName} › ${delta.parameterName} erneut an (${delta.proposedValue} ${delta.unit ?? 'dB'})...`);
      await invoke('apply_daw_action', {
        action: {
          track: delta.trackName,
          trackName: delta.trackName,
          parameter: delta.parameterName || 'EQ',
          value: delta.proposedValue ?? 0.0,
          currentValue: delta.currentValue ?? 0.0,
          isRestore: false,
          unit: delta.unit ?? 'dB',
          isMaster: delta.trackName.toLowerCase().includes('master') || delta.trackName.toLowerCase().includes('stereo'),
          pluginName: delta.pluginName || null,
          slotIndex: typeof delta.slotIndex === 'number' && delta.slotIndex > 0 ? delta.slotIndex : null
        },
        trackName: delta.trackName || (isLogic ? 'Stereo Out' : 'Channel 1'),
        parameter: delta.parameterName || 'EQ',
        value: delta.proposedValue ?? 0.0,
        currentValue: delta.currentValue ?? 0.0,
        isRestore: false,
        unit: delta.unit ?? 'dB',
        isMaster: delta.trackName.toLowerCase().includes('master') || delta.trackName.toLowerCase().includes('stereo'),
        pluginName: delta.pluginName || null,
        slotIndex: typeof delta.slotIndex === 'number' && delta.slotIndex > 0 ? delta.slotIndex : null
      });

      setChatLog(`✅ Wiederhergestellt: ${delta.parameterName} erneut auf ${delta.proposedValue} ${delta.unit ?? 'dB'} gesetzt.`);
    } catch (err: unknown) {
      setChatLog(`❌ Fehler beim Wiederherstellen: ${String(err)}`);
    }
  };

  const handleUndoLastAction = async () => {
    if (historyStack.length === 0) return;
    const [actionToUndo, ...remainingStack] = historyStack;
    const isLogic = activeDaw.toLowerCase().includes('logic');
    const dawLabel = isLogic ? 'Logic Pro' : activeDaw === 'none' ? 'Standalone' : 'Nuendo';

    try {
      setChatLog(`↩ Rückgängig: "${actionToUndo.description}" wird in ${dawLabel} zurückgesetzt...`);

      // Parameter-Rollback
      for (const item of actionToUndo.snapshot) {
        await invoke('apply_daw_action', {
          trackName: item.track,
          parameter: item.parameter,
          value: item.previousValue,
          currentValue: item.appliedValue,
          isRestore: true,
          unit: item.unit ?? 'dB',
          isMaster: !!item.isMaster,
          pluginName: item.pluginName ?? null,
          slotIndex: item.slotIndex ?? null
        });
      }

      // Sidechain-Routing aufheben (source='None' trennt die Verdrahtung)
      if (actionToUndo.sidechainUndo) {
        try {
          await invoke('set_sidechain', {
            track: actionToUndo.sidechainUndo.track,
            slot: actionToUndo.sidechainUndo.slot,
            source: 'None'
          });
          setChatLog(`🔗 Sidechain-Routing aufgehoben: ${actionToUndo.sidechainUndo.track} Slot ${actionToUndo.sidechainUndo.slot} → None`);
        } catch (scErr) {
          console.warn('Sidechain-Undo fehlgeschlagen:', scErr);
        }
      }

      setHistoryStack(remainingStack);
      // Status der Karte zurücksetzen auf 'pending'
      setProposals((prev) =>
        prev.map((p) => {
          if (actionToUndo.proposalId && p.id === actionToUndo.proposalId) {
            return { ...p, status: 'pending' };
          }
          if (p.title === actionToUndo.description && p.status === 'applied') {
            return { ...p, status: 'pending' };
          }
          return p;
        })
      );
      setChatLog(`✅ Rückgängig erfolgreich: "${actionToUndo.description}" auf Ausgangswerte zurückgesetzt.`);
    } catch (err: unknown) {
      setChatLog(`❌ Fehler beim Rückgängig-Machen: ${String(err)}`);
    }
  };


  const handleRejectAction = (id: string) => {
    const prop = proposals.find((p) => p.id === id);
    setProposals((prev) => {
      const next = prev.filter((p) => p.id !== id);
      const pinned = next.filter((p) => p.isPinned);
      try {
        localStorage.setItem('mixing_buddy_pinned_cards', JSON.stringify(pinned));
      } catch (e) {
        console.error('Failed to update pinned cards in localStorage', e);
      }
      return next;
    });
    if (prop) {
      setChatLog(`❌ Vorschlag entfernt: "${prop.title}".`);
    }
  };

  const handleClearQueue = () => {
    setProposals((prev) => {
      const kept = prev.filter((p) => p.isPinned);
      const removedCount = prev.length - kept.length;
      if (removedCount > 0) {
        setChatLog(`🧹 ${removedCount} nicht-angepinnte Karte(n) aus der Queue entfernt.`);
      } else if (kept.length > 0) {
        setChatLog(`ℹ️ Alle ${kept.length} verbleibenden Karten sind dauerhaft angepinnt.`);
      }
      return kept;
    });
  };

  const handleAuditionAction = async (id: string) => {
    const prop = proposals.find((p) => p.id === id);
    if (!prop || !prop.deltas || prop.deltas.length === 0) return;

    const isLogic = activeDaw.toLowerCase().includes('logic');
    const dawLabel = isLogic ? 'Logic Pro' : 'Nuendo';
    const previousStatus = prop.status;

    // Dynamischer Bar-Resolver für A/B Listen (kein hardcoded Takt 9!)
    let startBar: number | undefined = (prop as any).startBar;

    // Fallback A: Suche im Kartentitel oder der Beschreibung nach Taktangaben ("ab Takt 17", "Takt 25")
    if (!startBar) {
      const match = prop.title?.match(/(?:ab\s+Takt|Takt)\s+(\d+)/i) || 
                    (prop as any).description?.match(/(?:ab\s+Takt|Takt)\s+(\d+)/i) ||
                    prop.rationale?.match(/(?:ab\s+Takt|Takt)\s+(\d+)/i);
      if (match && match[1]) {
        startBar = parseInt(match[1], 10);
      }
    }

    // Fallback B: Falls immer noch undefined, hole aktuellen Playhead aus Logic Pro
    // oder nutze 1 als Default (NIEMALS hardcoded 9!)
    if (!startBar) {
      try {
        const status: any = await invoke('daw_get_current_bar');
        startBar = status?.bar ?? 1;
      } catch (_) {
        startBar = 1;
      }
    }
    const effectiveStartBar: number = startBar ?? 1;
    const endBar: number = (prop as any).endBar ?? (effectiveStartBar + 4);

    // Snapshot aller Parameter vor dem Umschalten zur deterministischen Wiederherstellung
    const auditionSnapshot = prop.deltas.map((delta) => ({
      track: delta.trackName || (isLogic ? 'Stereo Out' : 'Channel 1'),
      parameter: delta.parameterName || 'EQ',
      previousValue: delta.currentValue ?? 0.0,
      proposedValue: delta.proposedValue ?? 0.0,
      pluginName: delta.pluginName || null,
      slotIndex: typeof delta.slotIndex === 'number' && delta.slotIndex > 0 ? delta.slotIndex : null,
      unit: delta.unit ?? 'dB',
      isMaster: (delta.trackName || '').toLowerCase().includes('master') || (delta.trackName || '').toLowerCase().includes('stereo'),
    }));

    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'auditioning' } : p))
    );

    try {
      if (previousStatus === 'applied') {
        // ── A/B via Plugin-Bypass (bereits angewendete Karte) ──────────────
        setChatLog(`🎧 A/B Audition: "${prop.title}" – Plugin-Bypass in ${dawLabel} umgeschaltet...`);

        // 1. Cycle-Bereich auf den Ziel-Takt setzen, Playhead positionieren und abspielen:
        try {
          await invoke('daw_set_cycle_region', { start: effectiveStartBar, end: endBar });
        } catch (_) {}
        try {
          await invoke('daw_locate_bar', { bar: effectiveStartBar, keepCycle: true });
          await invoke('daw_play');
        } catch (playErr) {
          console.warn('[A/B] Playback-Start fehlgeschlagen:', playErr);
        }

        for (const delta of prop.deltas) {
          try {
            const targetTrack = delta.trackName || (isLogic ? 'Stereo Out' : 'Channel 1');
            await invoke('toggle_plugin_bypass', {
              trackName: targetTrack,
              slotIndex: delta.slotIndex ?? 0
            });
          } catch (bypassErr) {
            console.warn('[A/B] toggle_plugin_bypass fehlgeschlagen:', bypassErr);
          }
        }
      } else {
        // ── A/B via Parameter-Preview (noch nicht angewendete Karte) ───────
        setChatLog(`🎧 A/B Audition: "${prop.title}" (${prop.deltas.length} Änderungen) – 6s Vorschau in ${dawLabel} (Takt ${effectiveStartBar}-${endBar})...`);

        // 1. Cycle-Bereich auf den Ziel-Takt setzen, Playhead positionieren und abspielen:
        try {
          await invoke('daw_set_cycle_region', { start: effectiveStartBar, end: endBar });
        } catch (_) {}
        try {
          await invoke('daw_locate_bar', { bar: effectiveStartBar, keepCycle: true });
          await invoke('daw_play');
        } catch (playErr) {
          console.warn('[A/B] Playback-Start fehlgeschlagen:', playErr);
        }

        // 2. Temporäres Sidechain-Routing (falls vorhanden)
        if (prop.sidechainRoute) {
          try {
            await invoke('set_sidechain', {
              track: prop.sidechainRoute.trackName,
              slot: prop.sidechainRoute.slotIndex,
              source: prop.sidechainRoute.sourcePath
            });
          } catch (scErr) {
            console.warn('[A/B] Temporäres Sidechain-Routing fehlgeschlagen:', scErr);
          }
        }

        // 3. Testwerte in die DAW schreiben
        for (const mod of auditionSnapshot) {
          try {
            await invoke('apply_daw_action', {
              action: {
                track: mod.track,
                trackName: mod.track,
                parameter: mod.parameter,
                value: mod.proposedValue,
                currentValue: mod.previousValue,
                pluginName: mod.pluginName,
                slotIndex: mod.slotIndex,
                isRestore: false,
                unit: mod.unit,
                isMaster: mod.isMaster
              },
              trackName: mod.track,
              parameter: mod.parameter,
              value: mod.proposedValue,
              currentValue: mod.previousValue,
              isRestore: false,
              unit: mod.unit,
              isMaster: mod.isMaster,
              pluginName: mod.pluginName,
              slotIndex: mod.slotIndex
            });
          } catch (applyErr) {
            console.warn(`[A/B] Fehler beim Vorhören von ${mod.track} -> ${mod.parameter}:`, applyErr);
          }
        }
      }
    } catch (err: unknown) {
      // Playback sicherheitshalber stoppen bei Fehler
      await invoke('daw_stop').catch(() => {});
      // Falls bereits Regler verstellt wurden, Snapshot zurückrollen
      for (const mod of auditionSnapshot) {
        try {
          await invoke('apply_daw_action', {
            action: {
              track: mod.track,
              trackName: mod.track,
              parameter: mod.parameter,
              value: mod.previousValue,
              currentValue: mod.proposedValue,
              pluginName: mod.pluginName,
              slotIndex: mod.slotIndex,
              isRestore: true,
              unit: mod.unit,
              isMaster: mod.isMaster
            },
            trackName: mod.track,
            parameter: mod.parameter,
            value: mod.previousValue,
            currentValue: mod.proposedValue,
            isRestore: true,
            unit: mod.unit,
            isMaster: mod.isMaster,
            pluginName: mod.pluginName,
            slotIndex: mod.slotIndex
          });
        } catch (_) {}
      }
      setProposals((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: previousStatus } : p))
      );
      setChatLog(`❌ Fehler bei A/B Audition: ${String(err)}`);
      return;
    }

    // Auto-Restore nach 6 Sekunden
    setTimeout(async () => {
      try {
        // 1. Playback stoppen (A/B Restore Garantie: isRestore=true, darf NIEMALS blockiert werden)
        await invoke('daw_stop').catch((stopErr) => {
          console.warn('[A/B] daw_stop fehlgeschlagen:', stopErr);
        });

        if (previousStatus === 'applied') {
          // Bypass wieder zurückschalten
          for (const delta of prop.deltas) {
            try {
              const targetTrack = delta.trackName || (isLogic ? 'Stereo Out' : 'Channel 1');
              await invoke('toggle_plugin_bypass', {
                trackName: targetTrack,
                slotIndex: delta.slotIndex ?? 0
              });
            } catch (bErr) {
              console.error(`[Restore] Fehler beim Bypass-Rücksetzen für ${delta.trackName}:`, bErr);
            }
          }
        } else {
          // 2. Testwerte isoliert pro Parameter zurücksetzen (isRestore: true)
          // Verhindert, dass ein Einzelfehler das Zurücksetzen anderer Regler/Fader blockiert!
          for (const mod of auditionSnapshot) {
            try {
              await invoke('apply_daw_action', {
                action: {
                  track: mod.track,
                  trackName: mod.track,
                  parameter: mod.parameter,
                  value: mod.previousValue,
                  currentValue: mod.proposedValue,
                  pluginName: mod.pluginName,
                  slotIndex: mod.slotIndex,
                  isRestore: true,
                  unit: mod.unit,
                  isMaster: mod.isMaster
                },
                trackName: mod.track,
                parameter: mod.parameter,
                value: mod.previousValue,
                currentValue: mod.proposedValue,
                isRestore: true,
                unit: mod.unit,
                isMaster: mod.isMaster,
                pluginName: mod.pluginName,
                slotIndex: mod.slotIndex
              });
            } catch (err) {
              console.error(`[Restore] Fehler beim Zurücksetzen von ${mod.track} -> ${mod.parameter}:`, err);
            }
          }

          // 3. Temporäres Sidechain-Routing wieder aufheben
          if (prop.sidechainRoute) {
            try {
              await invoke('set_sidechain', {
                track: prop.sidechainRoute.trackName,
                slot: prop.sidechainRoute.slotIndex,
                source: 'None'
              });
            } catch (scErr) {
              console.warn('[A/B] Sidechain-Restore fehlgeschlagen:', scErr);
            }
          }
        }

        setChatLog(`🎧 A/B Audition beendet. Vorheriger Zustand in ${dawLabel} wiederhergestellt.`);
      } catch (err: unknown) {
        setChatLog(`❌ Fehler beim Wiederherstellen nach A/B Audition: ${String(err)}`);
      }

      setProposals((prev) =>
        prev.map((p) => (p.id === id && p.status === 'auditioning' ? { ...p, status: previousStatus } : p))
      );
    }, 6000);
  };

  const handleProposalFromChat = (newProposal: MixActionProposal) => {
    setProposals((prev) => [newProposal, ...prev]);
  };

  const refreshVaultPlugins = async () => {
    try {
      const list = await invoke<PluginSummaryItem[]>('list_learned_plugins');
      if (Array.isArray(list)) {
        setVaultPlugins(list);
        return;
      }
    } catch {
      // Fallback to HTTP endpoint on 127.0.0.1:48123
    }

    try {
      const res = await fetch('http://127.0.0.1:48123/api/vault/plugins');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.plugins)) {
          setVaultPlugins(data.plugins);
        }
      }
    } catch {
      // Ignore
    }
  };

  const refreshSkillsCount = async () => {
    try {
      const list = await invoke<MixingSkillSummary[]>('list_mixing_skills');
      if (Array.isArray(list)) {
        setSkillsCount(list.length);
        setAvailableSkills(list);

        // Auto-select first/default skill if none selected yet
        if (!activeSkill && list.length > 0) {
          try {
            const first = await invoke<MixingSkill>('get_mixing_skill', { id: list[0].id });
            if (first) {
              setActiveSkill(first);
            }
          } catch {}
        }
        return;
      }
    } catch {
      // Fallback to HTTP endpoint on 127.0.0.1:48123
    }

    try {
      const res = await fetch('http://127.0.0.1:48123/api/skills');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.skills)) {
          setSkillsCount(data.skills.length);
          setAvailableSkills(data.skills);
        }
      }
    } catch {
      // Ignore
    }
  };

  const handleSelectSkillById = async (id: string) => {
    try {
      try {
        const skill = await invoke<MixingSkill>('get_mixing_skill', { id });
        if (skill) {
          setActiveSkill(skill);
          setChatLog(
            `⭐ Mixing Skill "${skill.name}" aktiviert (${skill.metrologyTargets.integratedLufs.toFixed(1)} LUFS, Kategorie: ${skill.category}).`
          );
          return;
        }
      } catch {}

      const res = await fetch(`http://127.0.0.1:48123/api/skills?id=${encodeURIComponent(id)}`);
      if (res.ok) {
        const skill = (await res.json()) as MixingSkill;
        if (skill && skill.id) {
          setActiveSkill(skill);
          setChatLog(
            `⭐ Mixing Skill "${skill.name}" aktiviert (${skill.metrologyTargets.integratedLufs.toFixed(1)} LUFS, Kategorie: ${skill.category}).`
          );
        }
      }
    } catch (err) {
      console.warn('Failed to switch active skill', err);
    }
  };

  useEffect(() => {
    refreshVaultPlugins();
    refreshSkillsCount();

    let unlisten: (() => void) | undefined;
    listen('skill-vault-updated', () => {
      refreshSkillsCount();
    }).then((unsub) => {
      unlisten = unsub;
    }).catch(console.warn);

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleLearnActivePlugin = async () => {
    setVaultMode('confirm_learn');
    setIsVaultOpen(true);
    setIsLearningPlugin(true);
    setLearnError(null);
    setLearnedSpec(null);

    try {
      let spec: LearnedPluginSpec | null = null;
      try {
        spec = await invoke<LearnedPluginSpec>('learn_active_plugin', {
          windowTitle: null
        });
      } catch {
        const res = await fetch('http://127.0.0.1:48123/api/vault/learn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ windowTitle: null })
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        spec = data as LearnedPluginSpec;
      }

      if (spec) {
        setLearnedSpec(spec);
        await refreshVaultPlugins();
        setChatLog(
          `✨ Plugin "${spec.pluginName}" (${spec.parameters?.length ?? 0} Parameter, Kategorie: ${spec.category}) erfolgreich gescannt und im Plugin Vault gespeichert.`
        );
      }
    } catch (err: unknown) {
      setLearnError(String(err));
      setChatLog(`❌ Fehler beim Plugin-Scan: ${String(err)}`);
    } finally {
      setIsLearningPlugin(false);
    }
  };

  const handleOpenVaultDrawer = async () => {
    await refreshVaultPlugins();
    setVaultMode('vault_drawer');
    setIsVaultOpen(true);
  };

  const handleDeleteVaultPlugin = async (slug: string) => {
    try {
      try {
        await invoke<string>('delete_learned_plugin', { slug });
      } catch {
        const res = await fetch('http://127.0.0.1:48123/api/vault/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
      }
      await refreshVaultPlugins();
      setChatLog(`🗑️ Plugin "${slug}" aus dem Plugin Vault entfernt.`);
    } catch (err: unknown) {
      setChatLog(`❌ Fehler beim Löschen aus dem Plugin Vault: ${String(err)}`);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-darkBg text-slate-100">
      {/* Top Navbar */}
      <header className="h-12 border-b border-darkBorder bg-[#14161a] px-3 sm:px-4 flex items-center justify-between relative">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-6 rounded bg-blue-600 flex items-center justify-center font-bold text-xs text-white shrink-0">
            OMB
          </div>
          <span className="font-bold text-xs sm:text-sm tracking-wide text-slate-100 hidden sm:inline">
            OSZILLATION MIXING BUDDY
          </span>
          <span className="text-xs text-blue-400 font-mono ml-1 sm:ml-2">v0.6.3</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Desktop Toolbar (>= 1280px xl:flex) */}
          <div className="hidden xl:flex items-center gap-2 shrink-0">
            {/* Phase 2A, 2C & Learning: Signal-Fokus mit Auto- / Audio-Detect / Gemerkt Badge */}
            <div
              className="flex items-center bg-slate-800/90 border border-slate-700/80 rounded px-2.5 py-1 text-xs shrink-0"
              title="Bestimmt die spektrale Zielschablone (Master, Vocal, Drums etc.) für die Analyse des ankommenden Meter-Signals."
            >
              <Target className="w-3.5 h-3.5 text-cyan-400 mr-1" />
              <span className="text-gray-400 mr-1.5 font-medium">Signal-Fokus:</span>
              {learnedTrackScopes[activeMeterTrack?.trim().toLowerCase() || ''] ? (
                <button
                  type="button"
                  onClick={() => {
                    if (activeMeterTrack) {
                      unlearnTrackScope(activeMeterTrack);
                      setIsManualScopeOverride(false);
                      const autoScope = resolveScopeFromTrackName(activeMeterTrack);
                      setTargetScope(autoScope);
                      const updated = resolveTargetProfile(effectiveGenre, autoScope, customProfile);
                      syncContextToPlugin(autoScope, genreProfile, customNotes, updated.targetIntegratedLufs, updated);
                    }
                  }}
                  className="mr-1.5 px-1.5 py-0.5 text-[10px] bg-emerald-950/80 hover:bg-slate-700/80 border border-emerald-500/50 hover:border-slate-500 text-emerald-300 hover:text-white rounded font-mono font-medium transition-colors cursor-pointer"
                  title={`Spur-Rolle für "${activeMeterTrack}" ist dauerhaft gemerkt. Klicken um Zuweisung zu vergessen und Auto-Erkennung neu zu starten`}
                >
                  💾 Gemerkt ↺
                </button>
              ) : !isManualScopeOverride && activeMeterTrack ? (
                <span
                  className="mr-1.5 px-1.5 py-0.5 text-[10px] bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 rounded font-mono font-medium"
                  title={
                    scopeDetectionSource === 'audio'
                      ? `Akustisch erkannt von Signal auf Spur "${activeMeterTrack}"`
                      : `Automatisch erkannt von Spur "${activeMeterTrack}"`
                  }
                >
                  {scopeDetectionSource === 'audio' ? '⚡ Audio-Detect' : '⚡ Auto'}
                </span>
              ) : isManualScopeOverride && activeMeterTrack ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsManualScopeOverride(false);
                    const autoScope = resolveScopeFromTrackName(activeMeterTrack);
                    setTargetScope(autoScope);
                    const updated = resolveTargetProfile(effectiveGenre, autoScope, customProfile);
                    syncContextToPlugin(autoScope, genreProfile, customNotes, updated.targetIntegratedLufs, updated);
                  }}
                  className="mr-1.5 px-1.5 py-0.5 text-[10px] bg-slate-700/80 hover:bg-cyan-950/80 border border-slate-600 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-300 rounded font-mono transition-colors cursor-pointer"
                  title={`Klicken um Auto-Fokus für "${activeMeterTrack}" wieder zu aktivieren`}
                >
                  ⚡ Auto reaktivieren
                </button>
              ) : null}
              <select
                value={
                  !isManualScopeOverride && activeMeterTrack && !learnedTrackScopes[activeMeterTrack.trim().toLowerCase()]
                    ? '__auto__'
                    : targetScope
                }
                onChange={(e) => {
                  if (e.target.value === '__auto__' && activeMeterTrack) {
                    unlearnTrackScope(activeMeterTrack);
                    setIsManualScopeOverride(false);
                    const autoScope = resolveScopeFromTrackName(activeMeterTrack);
                    setTargetScope(autoScope);
                    const updated = resolveTargetProfile(effectiveGenre, autoScope, customProfile);
                    syncContextToPlugin(autoScope, genreProfile, customNotes, updated.targetIntegratedLufs, updated);
                  } else {
                    setIsManualScopeOverride(true);
                    handleTargetScopeChange(e.target.value as TargetScope);
                  }
                }}
                className="bg-transparent text-cyan-300 font-semibold focus:outline-none cursor-pointer"
              >
                {activeMeterTrack && (
                  <option value="__auto__" className="bg-[#1a1c23] text-cyan-400 font-bold">
                    ⚡ Auto ({activeMeterTrack}{learnedTrackScopes[activeMeterTrack.trim().toLowerCase()] ? ' - Gemerkt' : ''})
                  </option>
                )}
                <option value="mix_bus" className="bg-[#1a1c23] text-white">Master / Mix Bus</option>
                <option value="lead_vocal" className="bg-[#1a1c23] text-white">Lead Vocal</option>
                <option value="drum_bus" className="bg-[#1a1c23] text-white">Drum Bus / Rhythm</option>
                <option value="sub_bass" className="bg-[#1a1c23] text-white">Bass / E-Bass</option>
                <option value="keys_synths" className="bg-[#1a1c23] text-white">Keys & Synths</option>
                <option value="acoustic" className="bg-[#1a1c23] text-white">Acoustic / Guitars</option>
              </select>
            </div>

            <div className="flex items-center bg-slate-800/90 border border-slate-700/80 rounded px-2.5 py-1 text-xs shrink-0">
              <span className="text-gray-400 mr-1.5 font-medium">🎵 Genre:</span>
              <select
                value={genreProfile}
                onChange={(e) => handleGenreProfileChange(e.target.value as GenreProfileId)}
                className="bg-transparent text-amber-300 font-semibold focus:outline-none cursor-pointer"
              >
                <option value="auto_detect" className="bg-[#1a1c23] text-white">
                  ✨ Auto-Detect {detectedGenre ? `(${detectedGenre})` : '(KI)'}
                </option>
                <option value="pop_radio" className="bg-[#1a1c23] text-white">Pop / Radio</option>
                <option value="hiphop_trap" className="bg-[#1a1c23] text-white">Hip-Hop / Trap</option>
                <option value="rock_metal" className="bg-[#1a1c23] text-white">Rock / Metal</option>
                <option value="edm_club" className="bg-[#1a1c23] text-white">EDM / Club</option>
                <option value="acoustic_jazz" className="bg-[#1a1c23] text-white">Acoustic / Jazz</option>
                <option value="custom_crossover" className="bg-[#1a1c23] text-white">⚙️ Individuell / Crossover...</option>
              </select>
              {genreProfile === 'custom_crossover' && (
                <button
                  type="button"
                  onClick={() => setIsCrossoverModalOpen(true)}
                  className="ml-1.5 text-[11px] text-cyan-400 hover:text-cyan-200 underline font-medium"
                  title="Crossover-Details bearbeiten"
                >
                  Edit
                </button>
              )}
            </div>

            {/* Sprint 4.1: Referenz-Track Button */}
            <button
              type="button"
              onClick={() => setIsReferenceModalOpen(true)}
              className="flex items-center gap-1.5 bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-indigo-300 hover:text-white font-medium transition-all shadow-sm shrink-0 cursor-pointer"
              title="Referenz-Track laden und analysieren"
            >
              <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>Referenz-Track</span>
              {activeReferenceProfile && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" title={`Aktiv: ${activeReferenceProfile.name}`} />
              )}
            </button>

            <button
              type="button"
              onClick={handleLearnActivePlugin}
              className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300 hover:text-white bg-emerald-950/60 hover:bg-emerald-800/70 border border-emerald-500/40 px-2.5 py-1 rounded transition-all shadow-sm shrink-0 cursor-pointer"
              title="Scannt das aktuell in der DAW geöffnete Plugin-Fenster und speichert dessen Regler im Plugin Vault"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>✨ Plugin anlernen</span>
            </button>

            <button
              type="button"
              onClick={handleOpenVaultDrawer}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-darkBorder px-2.5 py-1 rounded transition-all shrink-0 cursor-pointer"
              title="Plugin Vault (Bibliothek der angelernten Plugins öffnen)"
            >
              <Database className="w-3.5 h-3.5 text-blue-400" />
              <span>Plugin Vault ({vaultPlugins.length})</span>
            </button>

            {/* Sprint 5.2: Mixing Skills Toolbar Button */}
            <button
              type="button"
              onClick={() => setIsSkillModalOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-amber-300 hover:text-white bg-amber-950/50 hover:bg-amber-900/60 border border-amber-500/40 px-2.5 py-1 rounded transition-all shadow-sm cursor-pointer shrink-0"
              title="Mixing Skill Vault (Tonmischmeister, Custom Chains & Prompts)"
            >
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400/30" />
              <span>Skills ({skillsCount})</span>
            </button>
          </div>

          {/* Pinned Abhörpunkt-Garantie & Satelliten-Manager */}
          <div className="relative shrink-0" ref={satelliteDropdownRef}>
            {/* Desktop Full Button (>= 1280px) */}
            <button
              type="button"
              onClick={() => setIsSatelliteDropdownOpen(!isSatelliteDropdownOpen)}
              className={`hidden xl:flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded transition-all cursor-pointer border ${
                telemetry || satellites.length > 0
                  ? 'bg-slate-800/90 hover:bg-slate-700/90 text-emerald-400 border-emerald-500/30 hover:border-emerald-500/50 shadow-sm'
                  : isAudioConnected
                  ? 'bg-slate-800/90 text-yellow-400 border-yellow-500/30'
                  : 'bg-slate-800/60 text-rose-400 border-rose-500/20'
              }`}
              title="Aktiver Abhörpunkt / Meter-Plugin Satelliten-Manager"
            >
              <Target className={`w-3.5 h-3.5 shrink-0 ${telemetry || satellites.length > 0 ? 'text-emerald-400' : isAudioConnected ? 'text-yellow-400' : 'text-rose-400'}`} />
              <span>
                {telemetry || satellites.length > 0 ? (
                  <>
                    <span className="text-slate-300 font-normal">Abhörpunkt: </span>
                    <span className="font-semibold text-emerald-300">
                      {activeMeterTrack
                        ? (activeMeterTrack.toLowerCase().includes('stereo out') || activeMeterTrack.toLowerCase() === 'master'
                            ? `${activeMeterTrack} (Master)`
                            : activeMeterTrack)
                        : satellites[0]?.track_name || 'Master Bus'}
                    </span>
                    {telemetry && (
                      <span className="text-slate-400 text-[11px] font-normal ml-1">
                        · {(telemetry.sampleRate / 1000).toFixed(1)} kHz
                      </span>
                    )}
                  </>
                ) : isAudioConnected ? (
                  'Streaming...'
                ) : (
                  'Telemetrie: Offline'
                )}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 ml-0.5 text-slate-400 transition-transform duration-150 ${
                  isSatelliteDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Immer sichtbare Abhörpunkt-Pille für Schmal-/Mittel-Bildschirme (< 1280px) */}
            <button
              type="button"
              onClick={() => setIsSatelliteDropdownOpen(!isSatelliteDropdownOpen)}
              className="flex xl:hidden px-2.5 py-1 text-xs rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 items-center gap-1.5 hover:bg-emerald-900/50 transition shrink-0 cursor-pointer"
              title="Aktiver Abhörpunkt (Mess-Satellit) auswählen"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="font-medium truncate max-w-[110px] sm:max-w-[160px]">
                {activeMeterTrack
                  ? (activeMeterTrack.toLowerCase().includes('stereo out') || activeMeterTrack.toLowerCase() === 'master'
                      ? `${activeMeterTrack} (Master)`
                      : activeMeterTrack)
                  : satellites[0]?.track_name || 'Stereo Out'}
              </span>
              <span className="text-[10px] text-emerald-400/70">▾</span>
            </button>

            {/* Dropdown Menu für Satelliten */}
            {isSatelliteDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-84 bg-[#16181d] border border-slate-700/90 rounded-lg shadow-2xl z-50 overflow-hidden backdrop-blur-md">
                <div className="px-3 py-2 bg-slate-800/60 border-b border-slate-700/60 flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-300 uppercase tracking-wider text-[10px]">
                    Mess-Satelliten ({satellites.length})
                  </span>
                  <span className="flex items-center gap-1.5 text-emerald-400 text-[10px] font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    30 fps Live
                  </span>
                </div>

                {/* Suchfilter für Satelliten */}
                <div className="p-2 border-b border-slate-800 bg-slate-900/60">
                  <div className="relative flex items-center">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                    <input
                      type="text"
                      value={satelliteSearchQuery}
                      onChange={(e) => setSatelliteSearchQuery(e.target.value)}
                      placeholder="Spur oder Rolle suchen..."
                      className="w-full bg-slate-950/80 border border-slate-700/80 rounded pl-8 pr-7 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                    {satelliteSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setSatelliteSearchQuery('')}
                        className="absolute right-2 text-slate-400 hover:text-white text-xs cursor-pointer"
                        title="Suche zurücksetzen"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/80">
                  {filteredSatellites.length > 0 ? (
                    filteredSatellites.map((sat) => {
                      const isActive =
                        sat.instance_id === activeInstanceId ||
                        (!activeInstanceId && (sat.track_name === activeMeterTrack || sat === satellites[0]));
                      const isMaster =
                        sat.track_name.toLowerCase().includes('stereo out') ||
                        sat.track_name.toLowerCase() === 'master';
                      const label = isMaster ? `${sat.track_name} (Master)` : sat.track_name;
                      const learned = learnedTrackScopes[sat.track_name.trim().toLowerCase()];

                      return (
                        <button
                          key={sat.instance_id}
                          type="button"
                          onClick={() => handleSelectSatellite(sat)}
                          className={`w-full text-left px-3 py-2.5 flex items-center justify-between transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-emerald-950/40 hover:bg-emerald-950/60 text-white'
                              : 'hover:bg-slate-800/60 text-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 pr-2">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isActive ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-emerald-500/60'
                              }`}
                            />
                            <div className="truncate">
                              <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                                <span className={isActive ? 'text-emerald-300' : 'text-slate-200'}>
                                  {label}
                                </span>
                                {learned && (
                                  <span className="text-[10px] text-amber-300/90 font-mono bg-amber-950/60 px-1 py-0.2 rounded border border-amber-600/30">
                                    💾 {learned}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                {(sat.sample_rate / 1000).toFixed(1)} kHz · ID: {sat.instance_id.slice(0, 8)}…
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <SatelliteMiniMeter lufs={sat.momentary_lufs} />
                            {isActive && (
                              <span className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                                Fokus
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })
                  ) : satellites.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-slate-400">
                      {isAudioConnected ? (
                        <span>Keine Multi-Instanz Satelliten erkannt.<br />Plugin auf Einzelspur aktiv.</span>
                      ) : (
                        <span>Kein 'MixingBuddyMeter' Plugin verbunden.<br />Bitte Plugin in Logic Pro laden.</span>
                      )}
                    </div>
                  ) : (
                    <div className="px-3 py-4 text-center text-xs text-slate-400 space-y-1">
                      <div>Keine Satelliten für „{satelliteSearchQuery}“ gefunden.</div>
                      <button
                        type="button"
                        onClick={() => setSatelliteSearchQuery('')}
                        className="text-cyan-400 hover:underline text-[11px] cursor-pointer"
                      >
                        Filter zurücksetzen
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Adaptives Hamburger- & Overflow-Menü (< 1280px xl:hidden) */}
          <div className="relative shrink-0 xl:hidden" ref={mobileMenuRef}>
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className={`px-2.5 py-1 text-xs rounded-lg border flex items-center gap-1.5 transition shrink-0 cursor-pointer ${
                isMobileMenuOpen
                  ? 'bg-slate-700 text-cyan-300 border-cyan-500/50 shadow-sm'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
              title="HUD-Menü und Session-Tools öffnen"
            >
              <span className="text-sm">☰</span>
              <span className="hidden sm:inline font-medium">Menü</span>
              <span className="text-[10px] text-slate-400">{isMobileMenuOpen ? '▲' : '▼'}</span>
            </button>

            {/* Schwebendes Hamburger-Panel (Floating Glassmorphism Card) */}
            {isMobileMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-84 sm:w-96 bg-slate-900/98 border border-slate-700/80 rounded-2xl shadow-2xl p-4 text-xs backdrop-blur-xl space-y-4 z-50 text-slate-200">
                {/* Kopfbereich */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <div className="flex items-center gap-2 font-semibold text-slate-100 text-sm">
                    <span className="text-cyan-400">🎛️</span>
                    <span>HUD & Session Manager</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="p-1 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
                    title="Schließen"
                  >
                    ✕
                  </button>
                </div>

                {/* Sektion 1: Aktiver Abhörpunkt (Mess-Satelliten) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Mess-Satelliten ({satellites.length})</span>
                    </span>
                    {telemetry && (
                      <span className="text-emerald-400 text-[10px] font-mono flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        30 fps Live
                      </span>
                    )}
                  </div>

                  {/* Suchfilter für Satelliten */}
                  <div className="relative flex items-center">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                    <input
                      type="text"
                      value={satelliteSearchQuery}
                      onChange={(e) => setSatelliteSearchQuery(e.target.value)}
                      placeholder="Spur oder Rolle suchen..."
                      className="w-full bg-slate-950/80 border border-slate-700/80 rounded pl-8 pr-7 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                    {satelliteSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setSatelliteSearchQuery('')}
                        className="absolute right-2 text-slate-400 hover:text-white text-xs cursor-pointer"
                        title="Suche zurücksetzen"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-800/80 rounded-lg bg-slate-950/60 border border-slate-800">
                    {filteredSatellites.length > 0 ? (
                      filteredSatellites.map((sat) => {
                        const isActive =
                          sat.instance_id === activeInstanceId ||
                          (!activeInstanceId && (sat.track_name === activeMeterTrack || sat === satellites[0]));
                        const isMaster =
                          sat.track_name.toLowerCase().includes('stereo out') ||
                          sat.track_name.toLowerCase() === 'master';
                        const label = isMaster ? `${sat.track_name} (Master)` : sat.track_name;
                        const learned = learnedTrackScopes[sat.track_name.trim().toLowerCase()];

                        return (
                          <button
                            key={sat.instance_id}
                            type="button"
                            onClick={() => {
                              handleSelectSatellite(sat);
                              setIsMobileMenuOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-emerald-950/40 text-white'
                                : 'hover:bg-slate-800/60 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 pr-2">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  isActive ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-emerald-500/60'
                                }`}
                              />
                              <div className="truncate">
                                <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                                  <span className={isActive ? 'text-emerald-300' : 'text-slate-200'}>
                                    {label}
                                  </span>
                                  {learned && (
                                    <span className="text-[10px] text-amber-300/90 font-mono bg-amber-950/60 px-1 rounded border border-amber-600/30">
                                      💾 Gemerkt
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono">
                                  {(sat.sample_rate / 1000).toFixed(1)} kHz
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <SatelliteMiniMeter lufs={sat.momentary_lufs} />
                              {isActive && (
                                <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                                  Aktiv
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    ) : satellites.length === 0 ? (
                      <div className="px-3 py-3 text-center text-xs text-slate-400">
                        {isAudioConnected ? 'Plugin auf Einzelspur aktiv' : 'Kein Meter-Plugin verbunden'}
                      </div>
                    ) : (
                      <div className="px-3 py-3 text-center text-xs text-slate-400 space-y-1">
                        <div>Keine Treffer für „{satelliteSearchQuery}“</div>
                        <button
                          type="button"
                          onClick={() => setSatelliteSearchQuery('')}
                          className="text-cyan-400 hover:underline text-[11px] cursor-pointer"
                        >
                          Zurücksetzen
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Sektion 2: Akustischer Fokus & Genre */}
                <div className="space-y-2 border-t border-slate-800/80 pt-2.5">
                  <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Akustischer Fokus & Genre</span>
                  </div>

                  {/* Signal-Fokus Select */}
                  <div className="flex items-center justify-between bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-2">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Target className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Fokus:</span>
                    </div>
                    <select
                      value={
                        !isManualScopeOverride && activeMeterTrack && !learnedTrackScopes[activeMeterTrack.trim().toLowerCase()]
                          ? '__auto__'
                          : targetScope
                      }
                      onChange={(e) => {
                        if (e.target.value === '__auto__' && activeMeterTrack) {
                          unlearnTrackScope(activeMeterTrack);
                          setIsManualScopeOverride(false);
                          const autoScope = resolveScopeFromTrackName(activeMeterTrack);
                          setTargetScope(autoScope);
                          const updated = resolveTargetProfile(effectiveGenre, autoScope, customProfile);
                          syncContextToPlugin(autoScope, genreProfile, customNotes, updated.targetIntegratedLufs, updated);
                        } else {
                          setIsManualScopeOverride(true);
                          handleTargetScopeChange(e.target.value as TargetScope);
                        }
                      }}
                      className="bg-slate-900 border border-slate-700 text-cyan-300 text-xs font-semibold rounded px-2 py-1 focus:outline-none cursor-pointer max-w-[170px]"
                    >
                      {activeMeterTrack && (
                        <option value="__auto__" className="bg-[#1a1c23] text-cyan-400 font-bold">
                          ⚡ Auto ({activeMeterTrack})
                        </option>
                      )}
                      <option value="mix_bus" className="bg-[#1a1c23] text-white">Master / Mix Bus</option>
                      <option value="lead_vocal" className="bg-[#1a1c23] text-white">Lead Vocal</option>
                      <option value="drum_bus" className="bg-[#1a1c23] text-white">Drum Bus / Rhythm</option>
                      <option value="sub_bass" className="bg-[#1a1c23] text-white">Bass / E-Bass</option>
                      <option value="keys_synths" className="bg-[#1a1c23] text-white">Keys & Synths</option>
                      <option value="acoustic" className="bg-[#1a1c23] text-white">Acoustic / Guitars</option>
                    </select>
                  </div>

                  {/* Genre Select */}
                  <div className="flex items-center justify-between bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-2">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <span>🎵 Genre:</span>
                    </div>
                    <select
                      value={genreProfile}
                      onChange={(e) => handleGenreProfileChange(e.target.value as GenreProfileId)}
                      className="bg-slate-900 border border-slate-700 text-amber-300 text-xs font-semibold rounded px-2 py-1 focus:outline-none cursor-pointer max-w-[170px]"
                    >
                      <option value="auto_detect" className="bg-[#1a1c23] text-white">
                        ✨ Auto-Detect {detectedGenre ? `(${detectedGenre})` : '(KI)'}
                      </option>
                      <option value="pop_radio" className="bg-[#1a1c23] text-white">Pop / Radio</option>
                      <option value="hiphop_trap" className="bg-[#1a1c23] text-white">Hip-Hop / Trap</option>
                      <option value="rock_metal" className="bg-[#1a1c23] text-white">Rock / Metal</option>
                      <option value="edm_club" className="bg-[#1a1c23] text-white">EDM / Club</option>
                      <option value="acoustic_jazz" className="bg-[#1a1c23] text-white">Acoustic / Jazz</option>
                      <option value="custom_crossover" className="bg-[#1a1c23] text-white">⚙️ Individuell / Crossover...</option>
                    </select>
                  </div>

                  {/* Referenz-Track Wähler / Lader */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsReferenceModalOpen(true);
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-between bg-slate-950/60 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/50 rounded-lg px-2.5 py-2 text-indigo-300 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="font-medium">Referenz-Track</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <span className="truncate max-w-[120px]">{activeReferenceProfile ? activeReferenceProfile.name : 'Keine Referenz'}</span>
                      <span className="text-indigo-400">➔</span>
                    </div>
                  </button>
                </div>

                {/* Sektion 3: Werkzeuge & Vault */}
                <div className="space-y-1.5 border-t border-slate-800/80 pt-2.5">
                  <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">
                    Werkzeuge & Vault
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      handleLearnActivePlugin();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/30 text-emerald-300 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      <span>✨ Plugin anlernen</span>
                    </div>
                    <span className="text-[10px] text-emerald-400/80 font-mono">DAW Scan</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      handleOpenVaultDrawer();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950/60 hover:bg-slate-800 border border-slate-800 text-slate-200 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <Database className="w-3.5 h-3.5 text-blue-400" />
                      <span>🗄️ Plugin Vault</span>
                    </div>
                    <span className="text-[11px] font-mono text-blue-400 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-600/30">
                      {vaultPlugins.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsSkillModalOpen(true);
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-amber-950/40 hover:bg-amber-900/50 border border-amber-500/30 text-amber-300 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400/30" />
                      <span>⭐ Mixing Skills</span>
                    </div>
                    <span className="text-[11px] font-mono text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-600/30">
                      {skillsCount}
                    </span>
                  </button>
                </div>

                {/* Fußzeile: Status & Version */}
                <div className="border-t border-slate-800/80 pt-2 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>DAW: {activeDaw === 'none' ? 'Apple Logic Pro (Bereit)' : activeDaw}</span>
                  <span className="text-blue-400 font-bold">v0.6.3</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <PluginVaultModal
        isOpen={isVaultOpen}
        mode={vaultMode}
        learnedSpec={learnedSpec}
        vaultPlugins={vaultPlugins}
        isLearning={isLearningPlugin}
        learnError={learnError}
        onClose={() => setIsVaultOpen(false)}
        onConfirmSave={() => {
          setVaultMode('vault_drawer');
        }}
        onDeletePlugin={handleDeleteVaultPlugin}
        onTriggerLearnNew={handleLearnActivePlugin}
      />

      <CrossoverModal
        isOpen={isCrossoverModalOpen}
        onClose={() => setIsCrossoverModalOpen(false)}
        currentProfile={activeTargetProfile}
        currentScope={targetScope}
        onSave={handleSaveCrossoverProfile}
      />

      <ReferenceTrackModal
        isOpen={isReferenceModalOpen}
        onClose={() => setIsReferenceModalOpen(false)}
        activeProfile={activeReferenceProfile}
        onApplyReference={handleApplyReferenceProfile}
      />

      <SkillManagerModal
        isOpen={isSkillModalOpen}
        onClose={() => {
          setIsSkillModalOpen(false);
          refreshSkillsCount();
        }}
        onSelectSkill={(skill) => {
          setActiveSkill(skill);
          setChatLog(`⭐ Mixing Skill "${skill.name}" aktiviert (${skill.metrologyTargets.integratedLufs} LUFS, Kategorie: ${skill.category}).`);
        }}
        onStartSynthesisWizard={() => {
          setIsSkillModalOpen(false);
          setIsSkillWizardOpen(true);
        }}
      />

      <SkillWizardModal
        isOpen={isSkillWizardOpen}
        onClose={() => {
          setIsSkillWizardOpen(false);
          refreshSkillsCount();
        }}
        onSkillCreatedAndActivated={(skill) => {
          setActiveSkill(skill);
          setChatLog(
            `🚀 Neuer KI-synthetisierter Skill "${skill.name}" (${skill.metrologyTargets.integratedLufs.toFixed(1)} LUFS, Kategorie: ${skill.category}) erfolgreich gespeichert & im Studio aktiviert.`
          );
          refreshSkillsCount();
        }}
        apiKey={apiKey}
        modelName={modelName}
      />

      {/* Main Studio Workspace */}
      <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* System Settings & Provider Status (Collapsible Accordion) */}
        {!isAiConfigOpen ? (
          <div className="bg-[#14161a] border border-darkBorder/70 rounded-lg px-3.5 py-2 flex items-center justify-between shadow-sm transition-all">
            <div className="flex items-center gap-2.5">
              <Cpu className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-semibold text-slate-300">Provider:</span>
              <span className="text-xs text-blue-300 font-mono bg-blue-950/50 border border-blue-500/30 px-2 py-0.5 rounded">
                {providerMode === 'byok_gemini'
                  ? `Google AI Multi-Key (${apiKey ? apiKey.split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean).length : 0} Keys aktiv) · ${modelName}`
                  : providerMode === 'managed'
                  ? 'Managed Studio Buddy Cloud'
                  : providerMode === 'mcp_external'
                  ? `Externer MCP-Server (:48124) · ${mcpClientsCount} Clients`
                  : providerMode}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsAiConfigOpen(true)}
              className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-darkBorder px-2.5 py-1 rounded transition-colors shadow-sm"
              title="Reasoning Engine & Provider-Einstellungen aufklappen"
            >
              <span>⚙️ Reasoning Engine & Provider</span>
              <ChevronDown className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[11px] text-blue-400 underline font-medium ml-0.5">[Bearbeiten]</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 bg-[#121418] border border-darkBorder/80 rounded-lg p-2.5 shadow-md">
            <div className="flex items-center justify-between px-1 pb-1 border-b border-darkBorder/60">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Cpu className="w-4 h-4 text-blue-400" />
                <span>⚙️ REASONING ENGINE & AI BACKEND</span>
              </div>
              <button
                type="button"
                onClick={() => setIsAiConfigOpen(false)}
                className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded border border-darkBorder transition-colors"
                title="Reasoning Engine zuklappen"
              >
                <span>⚙️ Reasoning Engine & Provider</span>
                <ChevronUp className="w-3.5 h-3.5 text-blue-400" />
              </button>
            </div>
            <ProviderSettings
              currentMode={providerMode}
              onSelectMode={handleSelectProviderMode}
              defaultMode={defaultProvider}
              onSetDefaultMode={handleSetDefaultProvider}
              activeDaw={activeDaw}
              isAudioConnected={isAudioConnected}
              isLicenseActive={true}
              mcpClientsCount={mcpClientsCount}
              modelName={modelName}
              onModelNameChange={handleModelNameChange}
              apiKey={apiKey}
              onApiKeyChange={handleApiKeyChange}
            />
          </div>
        )}

        {/* Meters Grid: Spectrum RTA + EBU R128 HUD + Chat Console */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <SpectrumAnalyzer
              spectrum={telemetry?.spectrum}
              telemetry={telemetry}
              liveLufs={telemetry?.loudness?.integratedLufs}
              activeReference={activeReferenceProfile}
              referenceSpectrum={activeReferenceProfile?.frequencyBands ?? (activeReferenceProfile as any)?.spectrum32Bands}
              targetProfile={activeTargetProfile}
              onSelectReference={setActiveReferenceProfile}
              onOpenReferenceModal={() => setIsReferenceModalOpen(true)}
              onGenerateProposal={handleProposalFromChat}
              availableTracks={availableTracks}
            />
            <ChatConsole
              telemetry={telemetry}
              activeDaw={activeDaw}
              providerMode={providerMode}
              modelName={modelName}
              apiKey={apiKey}
              tracks={availableTracks}
              onProposalGenerated={handleProposalFromChat}
              externalLogMessage={chatLog}
              targetScope={targetScope}
              activeMeterTrack={activeMeterTrack}
              targetProfile={activeTargetProfile}
              activeSkill={activeSkill}
              onSelectSkill={setActiveSkill}
              onSelectSkillId={handleSelectSkillById}
              availableSkills={availableSkills}
              pendingClarification={pendingClarification}
              onSelectClarificationScope={handleSelectClarificationScope}
            />
          </div>
          <div className="lg:col-span-1">
            <LoudnessHUD
              loudness={telemetry?.loudness}
              dynamics={telemetry?.dynamics}
              targetLufs={activeTargetProfile.targetIntegratedLufs}
            />
          </div>
        </div>

        {/* Action Proposals Section (Collapsible Accordion) */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setIsRecommendationsOpen((prev) => !prev)}
              className="text-sm font-semibold tracking-wider text-slate-300 uppercase flex items-center gap-2 hover:text-white transition-colors cursor-pointer group"
              title={isRecommendationsOpen ? "Empfehlungen zuklappen" : "Empfehlungen aufklappen"}
            >
              <Sliders className="w-4 h-4 text-blue-400" />
              <span>AI Mix Recommendations & Proposals ({proposals.length})</span>
              {isRecommendationsOpen ? (
                <ChevronUp className="w-4 h-4 text-slate-400 group-hover:text-white" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-white" />
              )}
            </button>
            <div className="flex items-center gap-3">
              {/* Filter Tabs */}
              <div className="flex items-center bg-slate-900 border border-slate-800 rounded p-0.5 text-xs">
                <button
                  onClick={() => setCardFilter('all')}
                  className={`px-2.5 py-1 rounded transition-colors text-xs ${
                    cardFilter === 'all'
                      ? 'bg-blue-600/30 text-blue-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Alle ({proposals.length})
                </button>
                <button
                  onClick={() => setCardFilter('pinned')}
                  className={`px-2.5 py-1 rounded transition-colors text-xs flex items-center gap-1 ${
                    cardFilter === 'pinned'
                      ? 'bg-amber-500/30 text-amber-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>📌</span> Angepinnt ({proposals.filter((p) => p.isPinned).length})
                </button>
              </div>

              <span className="text-xs text-slate-400">
                {proposals.filter((p) => p.status === 'pending').length} pending approval
              </span>
              {/* Permanenter Undo-Button */}
              <button
                type="button"
                onClick={handleUndoLastAction}
                disabled={historyStack.length === 0}
                className={`px-2.5 py-1 text-xs rounded flex items-center gap-1.5 transition-all shadow-sm ${
                  historyStack.length === 0
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-400 border border-slate-700'
                    : 'hover:bg-slate-700 text-amber-300 border border-amber-500/40 cursor-pointer bg-slate-800'
                }`}
                title={
                  historyStack.length > 0
                    ? `Zuletzt angewendete Aktion rückgängig machen: "${historyStack[0]?.description}"`
                    : 'Keine Aktionen im Verlauf'
                }
              >
                <span>↩</span>
                <span className="font-semibold">
                  Letzte Aktion rückgängig ({historyStack.length})
                </span>
              </button>

              {proposals.length > 0 && (
                <button
                  onClick={handleClearQueue}
                  className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                  title="Nicht-angepinnte Karten entfernen (angepinnte bleiben erhalten)"
                >
                  Queue leeren
                </button>
              )}
            </div>
          </div>

          {isRecommendationsOpen && (
            proposals.length === 0 ? (
              <div className="bg-[#121418] border border-darkBorder/60 rounded-lg p-6 flex flex-col items-center justify-center text-center gap-2">
                <Inbox className="w-8 h-8 text-slate-600" />
                <div className="text-xs font-semibold text-slate-300">Keine offenen Vorschläge in der Queue</div>
                <p className="text-[11px] text-slate-500 max-w-md">
                  Nutze die AI-Prompt-Konsole oben (z. B. &ldquo;Räume das Low-End auf&rdquo; oder &ldquo;Master auf -14 LUFS leveln&rdquo;),
                  um neue intelligente Anpassungen basierend auf der Live-Metrology zu erzeugen.
                </p>
              </div>
            ) : cardFilter === 'pinned' && proposals.filter((p) => p.isPinned).length === 0 ? (
              <div className="bg-[#121418] border border-darkBorder/60 rounded-lg p-6 flex flex-col items-center justify-center text-center gap-2">
                <span className="text-2xl">📌</span>
                <div className="text-xs font-semibold text-slate-300">Keine angepinnten Karten vorhanden</div>
                <p className="text-[11px] text-slate-500 max-w-md">
                  Klicke auf das 📌-Symbol oben rechts in einer beliebigen Karte, um sie dauerhaft für spätere Tests zu sichern.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(cardFilter === 'pinned' ? proposals.filter((p) => p.isPinned) : proposals).map((proposal) => (
                  <ActionCard
                    key={proposal.id}
                    proposal={proposal}
                    onApply={handleApplyAction}
                    onReject={handleRejectAction}
                    onAudition={handleAuditionAction}
                    onTogglePin={handleTogglePin}
                    onRollbackDelta={handleRollbackSingleDelta}
                    onRedoDelta={handleRedoSingleDelta}
                  />
                ))}
              </div>
            )
          )}
        </section>
      </main>
    </div>
  );
};

