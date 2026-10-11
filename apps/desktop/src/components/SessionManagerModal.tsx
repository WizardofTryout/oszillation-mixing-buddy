import React, { useState, useEffect } from 'react';
import {
  FolderArchive,
  Save,
  FolderOpen,
  FilePlus,
  Clock,
  Sparkles,
  X,
  CheckCircle2,
  AlertCircle,
  Copy,
  FolderTree
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export interface SessionVaultItem {
  session_uuid: string;
  session_name: string;
  file_path: string;
  updated_at: string;
  actions_count: number;
}

interface SessionManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionUuid: string;
  sessionName: string;
  onUpdateSessionName: (name: string) => void;
  onSaveSessionAs: () => Promise<void>;
  onLoadSessionFile: (path?: string) => Promise<void>;
  onNewSession: () => void;
  actionsCount?: number;
  recentTurnsCount?: number;
  lastSavedAt?: string;
}

export const SessionManagerModal: React.FC<SessionManagerModalProps> = ({
  isOpen,
  onClose,
  sessionUuid,
  sessionName,
  onUpdateSessionName,
  onSaveSessionAs,
  onLoadSessionFile,
  onNewSession,
  actionsCount = 0,
  recentTurnsCount = 0,
  lastSavedAt
}) => {
  const [localName, setLocalName] = useState<string>(sessionName);
  const [savedVaults, setSavedVaults] = useState<SessionVaultItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);
  const [copiedUuid, setCopiedUuid] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmNew, setConfirmNew] = useState<boolean>(false);

  useEffect(() => {
    setLocalName(sessionName);
  }, [sessionName]);

  useEffect(() => {
    if (isOpen) {
      loadVaultList();
      setConfirmNew(false);
      setStatusMessage(null);
    }
  }, [isOpen]);

  const loadVaultList = async () => {
    try {
      setIsLoadingList(true);
      const list = await invoke<SessionVaultItem[]>('list_session_vaults');
      setSavedVaults(list || []);
    } catch (err) {
      console.warn('[SessionManager] Fehler beim Laden der Vault-Liste:', err);
    } finally {
      setIsLoadingList(false);
    }
  };

  if (!isOpen) return null;

  const handleCopyUuid = () => {
    navigator.clipboard.writeText(sessionUuid);
    setCopiedUuid(true);
    setTimeout(() => setCopiedUuid(false), 2000);
  };

  const handleNameBlur = () => {
    const trimmed = localName.trim();
    if (trimmed && trimmed !== sessionName) {
      onUpdateSessionName(trimmed);
      setStatusMessage({ type: 'success', text: 'Session-Name aktualisiert.' });
    }
  };

  const handleSaveAs = async () => {
    try {
      setStatusMessage(null);
      await onSaveSessionAs();
      setStatusMessage({ type: 'success', text: 'Session erfolgreich auf Disk gespeichert.' });
      loadVaultList();
    } catch (err: unknown) {
      setStatusMessage({ type: 'error', text: `Speichern fehlgeschlagen: ${String(err)}` });
    }
  };

  const handleLoadFile = async (path?: string) => {
    try {
      setStatusMessage(null);
      await onLoadSessionFile(path);
      setStatusMessage({ type: 'success', text: 'Session erfolgreich geladen.' });
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: unknown) {
      setStatusMessage({ type: 'error', text: `Laden fehlgeschlagen: ${String(err)}` });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                Studio Session Vault
                <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                  *.omb-session.json
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Deterministischer Song-Zustand, ActionJournal & DAW Recall
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Status Message Banner */}
          {statusMessage && (
            <div
              className={`p-3 rounded-xl border flex items-center gap-2 text-xs transition-all ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Active Session Overview Card */}
          <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Aktiver Song / Session-Name
              </label>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                <span>UUID:</span>
                <span className="text-slate-300">{sessionUuid}</span>
                <button
                  onClick={handleCopyUuid}
                  className="p-1 hover:text-cyan-400 transition-colors"
                  title="UUID kopieren"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {copiedUuid && <span className="text-cyan-400 text-[10px]">Kopiert!</span>}
              </div>
            </div>

            <input
              type="text"
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              onBlur={handleNameBlur}
              placeholder="z. B. Summer Anthem - Final Mix"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/60 border border-slate-700 text-slate-100 text-sm font-medium focus:outline-none focus:border-cyan-500/80 transition-colors"
            />

            <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
                <div className="text-slate-500 text-[10px] uppercase tracking-wider">ActionJournal</div>
                <div className="text-slate-200 font-bold mt-0.5">{actionsCount} Aktionen</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
                <div className="text-slate-500 text-[10px] uppercase tracking-wider">Dialog-Gedächtnis</div>
                <div className="text-slate-200 font-bold mt-0.5">{recentTurnsCount} Turns (300t)</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
                <div className="text-slate-500 text-[10px] uppercase tracking-wider">Auto-Vault</div>
                <div className="text-emerald-400 font-medium mt-0.5 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {lastSavedAt ? lastSavedAt : 'Aktiv'}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleSaveAs}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs shadow-lg shadow-cyan-900/20 transition-all active:scale-[0.98]"
            >
              <Save className="w-4 h-4" />
              <span>Session speichern unter...</span>
            </button>

            <button
              onClick={() => handleLoadFile()}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600/70 text-slate-200 font-medium text-xs transition-all active:scale-[0.98]"
            >
              <FolderOpen className="w-4 h-4 text-cyan-400" />
              <span>Session-Datei öffnen...</span>
            </button>
          </div>

          {/* New Session inline trigger */}
          <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <FilePlus className="w-4 h-4 text-slate-500" />
              <span>Neue Session für einen neuen Song anlegen?</span>
            </div>
            {!confirmNew ? (
              <button
                onClick={() => setConfirmNew(true)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
              >
                Neue Session
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    onNewSession();
                    setConfirmNew(false);
                    setStatusMessage({ type: 'success', text: 'Neue Session gestartet.' });
                  }}
                  className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors"
                >
                  Ja, zurücksetzen
                </button>
                <button
                  onClick={() => setConfirmNew(false)}
                  className="px-2 py-1 rounded bg-slate-800 text-slate-400 text-xs"
                >
                  Abbrechen
                </button>
              </div>
            )}
          </div>

          {/* Local Vault History in ~/.mixing-buddy/projects/ */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-cyan-400" />
                <span>Gespeicherte Song-Vaults auf diesem Mac</span>
              </label>
              <span className="text-[11px] text-slate-500">
                ~/.mixing-buddy/projects/
              </span>
            </div>

            {isLoadingList ? (
              <div className="p-6 text-center text-xs text-slate-500">Lade Vault-Liste...</div>
            ) : savedVaults.length === 0 ? (
              <div className="p-6 text-center rounded-xl bg-slate-950/30 border border-slate-800/60 text-xs text-slate-500">
                Noch keine gespeicherten Song-Vaults vorhanden.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {savedVaults.map((vault) => (
                  <div
                    key={vault.session_uuid}
                    className="p-2.5 rounded-xl bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/40 flex items-center justify-between transition-colors group"
                  >
                    <div className="min-w-0 pr-3">
                      <div className="text-xs font-semibold text-slate-200 truncate flex items-center gap-1.5">
                        <span>{vault.session_name}</span>
                        {vault.session_uuid === sessionUuid && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300">
                            Aktiv
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {vault.updated_at ? new Date(vault.updated_at).toLocaleString() : 'Vor kurzem'}
                        </span>
                        <span>•</span>
                        <span>{vault.actions_count} Journal-Aktionen</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleLoadFile(vault.file_path)}
                      className="px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-cyan-600 hover:text-white text-slate-300 text-xs font-medium transition-all opacity-80 group-hover:opacity-100"
                    >
                      Laden
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Automatische Hintergrund-Synchronisation für Logic Pro & Nuendo</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
};
