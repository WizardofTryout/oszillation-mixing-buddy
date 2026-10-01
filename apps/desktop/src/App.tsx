import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  type MetrologyTelemetryFrame,
  type MixActionProposal,
  type TrackDescriptor,
  type TargetProfile,
  type TargetScope,
  type GenreProfileId,
  type ReferenceTrackProfile,
  resolveTargetProfile,
  detectGenreFromTelemetry
} from '@mixing-buddy/shared-types';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { SpectrumRTA } from './components/SpectrumRTA.js';
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
import { Sliders, Headphones, Inbox, Sparkles, Database, Target, BarChart2 } from 'lucide-react';

export const App: React.FC = () => {
  const [telemetry, setTelemetry] = useState<MetrologyTelemetryFrame | null>(null);
  const [isAudioConnected, setIsAudioConnected] = useState<boolean>(false);
  const [providerMode, setProviderMode] = useState<ProviderMode>('managed');
  const [activeDaw, setActiveDaw] = useState<string>('none');
  const [modelName, setModelName] = useState<string>('gemini-3.8-flash');
  const [apiKey, setApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('mixing_buddy_gemini_api_key') || '';
    } catch {
      return '';
    }
  });
  const [proposals, setProposals] = useState<MixActionProposal[]>([]);
  const [chatLog, setChatLog] = useState<string | null>(null);
  const [mcpClientsCount, setMcpClientsCount] = useState<number>(0);
  const [cardFilter, setCardFilter] = useState<'all' | 'pinned'>('all');

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

  const effectiveGenre = genreProfile === 'auto_detect' ? (detectedGenre || 'pop_radio') : genreProfile;
  const activeTargetProfile = useMemo(() => {
    return resolveTargetProfile(effectiveGenre, targetScope, customProfile);
  }, [effectiveGenre, targetScope, customProfile]);

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
        const res = await fetch('http://127.0.0.1:48123/api/tracks');
        if (res.ok) {
          const json = await res.json();
          const tracks: TrackDescriptor[] = Array.isArray(json.tracks)
            ? json.tracks
            : Array.isArray(json)
            ? json
            : [];
          if (tracks.length > 0) {
            setLiveTracks(tracks);
            setLastTrackFetch(Date.now());
          }
        }
      } catch {
        // IPC server not yet running — silently wait
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
          if (data.targetScope) setTargetScope(data.targetScope);
          if (data.genreProfile) setGenreProfile(data.genreProfile);
          if (data.customNotes !== undefined) setCustomNotes(data.customNotes);
          if (data.targetProfile) setCustomProfile(data.targetProfile);
          setChatLog(`🔄 DAW-Projekt-Persistenz geladen: Scope "${data.targetScope}", Genre "${data.genreProfile}"`);
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
              if (data.targetScope) setTargetScope(data.targetScope);
              if (data.genreProfile) setGenreProfile(data.genreProfile);
              if (data.customNotes !== undefined) setCustomNotes(data.customNotes);
              if (data.targetProfile) setCustomProfile(data.targetProfile);
              setChatLog(`🔄 DAW-Projekt-Persistenz geladen: Scope "${data.targetScope}", Genre "${data.genreProfile}"`);
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

  // 3. Wired Action Handlers
  const handleApplyAction = async (id: string) => {
    const proposal = proposals.find((p) => p.id === id);
    if (!proposal) return;

    const isLogic = activeDaw.toLowerCase().includes('logic');
    const dawLabel = isLogic ? 'Logic Pro' : activeDaw === 'none' ? 'Standalone' : 'Nuendo';

    // Validate volume adjustments through Acoustic Shock Shield
    for (const delta of proposal.deltas) {
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
    for (const delta of proposal.deltas) {
      ensureProposalTrackExists(delta.trackId, delta.trackName);
    }

    try {
      for (const delta of proposal.deltas) {
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

      setProposals((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'applied' } : p))
      );
      setChatLog(`✅ Anpassung angewendet: "${proposal.title}" erfolgreich an ${dawLabel} gesendet.`);
    } catch (err: unknown) {
      setChatLog(`❌ Fehler beim Anwenden: ${String(err)}`);
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

    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'auditioning' } : p))
    );

    try {
      if (previousStatus === 'applied') {
        setChatLog(`🎧 A/B Audition aktiv für: "${prop.title}". Plugin-Bypass in ${dawLabel} umgeschaltet...`);
        for (const delta of prop.deltas) {
          const targetTrack = delta.trackName || (isLogic ? 'Stereo Out' : 'Channel 1');
          await invoke('toggle_plugin_bypass', {
            trackName: targetTrack,
            slotIndex: delta.slotIndex ?? 0
          });
        }
      } else {
        setChatLog(`🎧 A/B Audition aktiv für: "${prop.title}" (${prop.deltas.length} Änderungen) für 6s in ${dawLabel} aktiviert...`);
        for (const delta of prop.deltas) {
          const targetTrack = delta.trackName || (isLogic ? 'Stereo Out' : 'Channel 1');
          await invoke('apply_daw_action', {
            trackName: targetTrack,
            parameter: delta.parameterName || 'EQ',
            value: delta.proposedValue ?? 0.0,
            currentValue: delta.currentValue ?? 0.0,
            isRestore: false,
            unit: delta.unit ?? 'dB',
            isMaster: targetTrack.toLowerCase().includes('master') || targetTrack.toLowerCase().includes('stereo'),
            pluginName: delta.pluginName || null,
            slotIndex: typeof delta.slotIndex === 'number' && delta.slotIndex > 0 ? delta.slotIndex : null
          });
        }
      }
    } catch (err: unknown) {
      setProposals((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: previousStatus } : p))
      );
      setChatLog(`❌ Fehler bei A/B Audition: ${String(err)}`);
      return;
    }

    // Auto-restore after 6 seconds of audition
    setTimeout(async () => {
      try {
        if (previousStatus === 'applied') {
          for (const delta of prop.deltas) {
            const targetTrack = delta.trackName || (isLogic ? 'Stereo Out' : 'Channel 1');
            await invoke('toggle_plugin_bypass', {
              trackName: targetTrack,
              slotIndex: delta.slotIndex ?? 0
            });
          }
        } else {
          for (const delta of prop.deltas) {
            const targetTrack = delta.trackName || (isLogic ? 'Stereo Out' : 'Channel 1');
            await invoke('apply_daw_action', {
              trackName: targetTrack,
              parameter: delta.parameterName || 'EQ',
              value: delta.currentValue ?? 0.0,
              currentValue: delta.currentValue ?? 0.0,
              isRestore: true,
              unit: delta.unit ?? 'dB',
              isMaster: targetTrack.toLowerCase().includes('master') || targetTrack.toLowerCase().includes('stereo'),
              pluginName: delta.pluginName || null,
              slotIndex: typeof delta.slotIndex === 'number' && delta.slotIndex > 0 ? delta.slotIndex : null
            });
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

  useEffect(() => {
    refreshVaultPlugins();
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
      <header className="h-12 border-b border-darkBorder bg-[#14161a] px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-6 rounded bg-blue-600 flex items-center justify-center font-bold text-xs text-white">
            OMB
          </div>
          <span className="font-bold text-sm tracking-wide text-slate-100">OSZILLATION MIXING BUDDY</span>
          <span className="text-xs text-blue-400 font-mono ml-2">v0.1.0</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Sprint 3: Target Scope & Genre Selectors */}
          <div className="flex items-center bg-slate-800/90 border border-slate-700/80 rounded px-2.5 py-1 text-xs">
            <Target className="w-3.5 h-3.5 text-cyan-400 mr-1" />
            <span className="text-gray-400 mr-1.5 font-medium">Bus:</span>
            <select
              value={targetScope}
              onChange={(e) => handleTargetScopeChange(e.target.value as TargetScope)}
              className="bg-transparent text-cyan-300 font-semibold focus:outline-none cursor-pointer"
            >
              <option value="mix_bus" className="bg-[#1a1c23] text-white">Master / Mix Bus</option>
              <option value="lead_vocal" className="bg-[#1a1c23] text-white">Lead Vocal</option>
              <option value="drum_bus" className="bg-[#1a1c23] text-white">Drum Bus / Rhythm</option>
              <option value="sub_bass" className="bg-[#1a1c23] text-white">Sub Bass / 808</option>
              <option value="keys_synths" className="bg-[#1a1c23] text-white">Keys & Synths</option>
              <option value="acoustic" className="bg-[#1a1c23] text-white">Acoustic / Guitars</option>
            </select>
          </div>

          <div className="flex items-center bg-slate-800/90 border border-slate-700/80 rounded px-2.5 py-1 text-xs">
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
            className="flex items-center gap-1.5 bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-indigo-300 hover:text-white font-medium transition-all shadow-sm"
            title="Referenz-Track laden und analysieren"
          >
            <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Referenz-Track</span>
            {activeReferenceProfile && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" title={`Aktiv: ${activeReferenceProfile.name}`} />
            )}
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleLearnActivePlugin}
            className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300 hover:text-white bg-emerald-950/60 hover:bg-emerald-800/70 border border-emerald-500/40 px-2.5 py-1 rounded transition-all shadow-sm"
            title="Scannt das aktuell in der DAW geöffnete Plugin-Fenster und speichert dessen Regler im Plugin Vault"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>✨ Plugin anlernen</span>
          </button>

          <button
            type="button"
            onClick={handleOpenVaultDrawer}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-darkBorder px-2.5 py-1 rounded transition-all"
            title="Plugin Vault (Bibliothek der angelernten Plugins öffnen)"
          >
            <Database className="w-3.5 h-3.5 text-blue-400" />
            <span>Plugin Vault ({vaultPlugins.length})</span>
          </button>

          <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded">
            <Headphones className={`w-3.5 h-3.5 ${telemetry ? 'text-emerald-400' : isAudioConnected ? 'text-yellow-400' : 'text-slate-500'}`} />
            <span className={telemetry ? 'text-emerald-400 font-medium' : ''}>
              Master Bus: {telemetry ? `Online (${telemetry.sampleRate / 1000} kHz)` : isAudioConnected ? 'Streaming' : 'Offline'}
            </span>
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

      {/* Main Studio Workspace */}
      <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* System Settings & Provider Status */}
        <ProviderSettings
          currentMode={providerMode}
          onSelectMode={setProviderMode}
          activeDaw={activeDaw}
          isAudioConnected={isAudioConnected}
          isLicenseActive={true}
          mcpClientsCount={mcpClientsCount}
          modelName={modelName}
          onModelNameChange={setModelName}
          apiKey={apiKey}
          onApiKeyChange={handleApiKeyChange}
        />

        {/* Meters Grid: Spectrum RTA + EBU R128 HUD + Chat Console */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <SpectrumRTA
              spectrum={telemetry?.spectrum}
              telemetry={telemetry}
              liveLufs={telemetry?.loudness?.integratedLufs}
              activeReference={activeReferenceProfile}
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
              targetProfile={activeTargetProfile}
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

        {/* Action Proposals Section */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold tracking-wider text-slate-300 uppercase flex items-center gap-2">
              <Sliders className="w-4 h-4 text-blue-400" />
              AI Mix Recommendations & Proposals
            </h3>
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

          {proposals.length === 0 ? (
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
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

