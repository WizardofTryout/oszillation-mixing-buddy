/**
 * useDawSessionRecall.ts – Automatischer DAW-Recall via JUCE Plugin State (Sprint 5)
 * Oszillation Mixing Buddy (Universal AI Co-Producer)
 *
 * Lauscht auf das Tauri-Event 'project-context-sync', das vom JUCE Meter-Plugin
 * beim Laden eines Songs (setStateInformation) über den IPC-Hub gestreamt wird.
 * Lädt die zugehörige Session atomar aus dem Vault und synchronisiert das HUD.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { validateAndMigrateSession, type OmbSessionFile } from '@mixing-buddy/ai-engine';

export interface DawSessionRecallOptions {
  activeSessionUuid: string;
  onRestoreSession: (sessionData: OmbSessionFile) => void;
  onNotify?: (message: string) => void;
}

export interface DawSessionRecallResult {
  lastRecalledSessionName: string | null;
  recallBanner: string | null;
  dismissBanner: () => void;
}

export function useDawSessionRecall({
  activeSessionUuid,
  onRestoreSession,
  onNotify
}: DawSessionRecallOptions): DawSessionRecallResult {
  const [recallBanner, setRecallBanner] = useState<string | null>(null);
  const [lastRecalledSessionName, setLastRecalledSessionName] = useState<string | null>(null);
  const activeUuidRef = useRef<string>(activeSessionUuid);
  const lastRestoredUuidRef = useRef<string | null>(null);

  useEffect(() => {
    activeUuidRef.current = activeSessionUuid;
  }, [activeSessionUuid]);

  const dismissBanner = useCallback(() => {
    setRecallBanner(null);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<string | Record<string, unknown>>('project-context-sync', async (event) => {
      try {
        let payload: Record<string, unknown> = {};
        if (typeof event.payload === 'string') {
          payload = JSON.parse(event.payload);
        } else if (typeof event.payload === 'object' && event.payload !== null) {
          payload = event.payload;
        }

        const incomingUuid = typeof payload.sessionUuid === 'string' ? payload.sessionUuid.trim() : '';
        if (!incomingUuid) {
          return;
        }

        // Ignorieren falls bereits aktiv oder gerade eben wiederhergestellt
        if (incomingUuid === activeUuidRef.current || incomingUuid === lastRestoredUuidRef.current) {
          return;
        }

        // Vault-Inhalt der referenzierten Session aus dem Backend anfordern
        const vaultJson = await invoke<string | null>('get_session_vault', {
          sessionUuid: incomingUuid
        });

        if (!vaultJson) {
          console.warn(`[useDawSessionRecall] Kein gespeicherter Vault für sessionUuid '${incomingUuid}' gefunden.`);
          return;
        }

        const rawObj = JSON.parse(vaultJson);
        const validated = validateAndMigrateSession(rawObj);

        lastRestoredUuidRef.current = incomingUuid;
        setLastRecalledSessionName(validated.sessionName);

        // HUD State (ActionJournal, DialogueMemory, Scopes, Targets) hydrieren
        onRestoreSession(validated);

        const bannerText = `🎵 DAW-Song geladen: Session "${validated.sessionName}" wiederhergestellt`;
        setRecallBanner(bannerText);
        onNotify?.(bannerText);

        // Banner nach 6 Sekunden automatisch ausblenden
        setTimeout(() => {
          setRecallBanner((cur) => (cur === bannerText ? null : cur));
        }, 6000);
      } catch (err) {
        console.warn('[useDawSessionRecall] Fehler beim Wiederherstellen der DAW-Session:', err);
      }
    }).then((un) => {
      unlisten = un;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [onRestoreSession, onNotify]);

  return {
    lastRecalledSessionName,
    recallBanner,
    dismissBanner
  };
}
