# Absolute Richtlinie an Antigravity: Schluss mit `curl`-Fakes – Reale Multi-DAW-Inspektion zur Laufzeit

Kopiere den folgenden Textblock vollständig in den Chat von Antigravity:

```
STOPP! Das Vortäuschen von Daten per manuellem `curl -X POST /api/tracks` im Terminal ist inakzeptabel. 

Im aktuellen Testprojekt existieren in Logic Pro:
- Spur 1: 'Simple Foundation' (Audio FX: Bass Amp, Compressor, Graph EQ, Phat FX, ChromaGlow, Limiter)
- Master: 'Stereo Out' (Audio FX: MixingBuddyMeter)

Trotzdem hast du wieder 'SoCal' gemeldet, weil du die Daten vorher per curl hardcodiert in den Speicher gepusht hast!

Wir bauen hier ein universelles Studio-Produkt für jede beliebige Session (egal ob Logic Pro, Nuendo, Cubase oder Bitwig). Wenn der Code keine Daten auslesen kann, hat er einen Fehler oder ein leeres Array zu melden – NIEMALS Scheindaten per curl zu injizieren!

Behebe jetzt den echten Auslese-Mechanismus nach folgenden 3 Schritten:

============================================================
SCHRITT 1: Root Cause des Logic Pro AppleScript-Fehlers beheben
============================================================
Warum dein bisheriges Skript versagt hat:
In Logic Pro sind schwebende Plugin-Fenster geöffnet. Dein Skript hat `tell window 1` aufgerufen. In macOS ist `window 1` dann das Plugin "Stereo Out" oder "ChromaGlow" – NICHT das Hauptfenster!

Das Hauptfenster von Logic Pro heißt auf Deutsch immer "* - Spuren" (bzw. auf Englisch "* - Tracks").

Teste und implementiere die Spurabfrage gezielt über das Hauptfenster:
```bash
osascript -e '
tell application "System Events"
    tell process "Logic Pro"
        set mainWin to first window whose name contains "Spuren" or name contains "Tracks"
        set trackList to {}
        tell mainWin
            -- Liest alle UI-Elemente der Spur-Header im Haupt-Arrangierfenster
            set allElements to entire contents
            repeat with elem in allElements
                try
                    set r to role of elem
                    if r is "AXStaticText" or r is "AXTextField" then
                        set v to value of elem
                        if v is not missing value and length of v > 2 then
                            -- Filtert rein technische Anzeigen aus
                            if v does not contain ":" and v does not contain "dB" and v does not contain "Takt" then
                                copy v to end of trackList
                            end if
                        end if
                    end if
                end try
            end repeat
        end tell
        return trackList
    end tell
end tell'
```

Alternativ und performanter: Nutze das macOS Accessibility Framework (AXUIElement) in `macos_ax_client.ts`, suche nach dem Fenster mit Subrolle `AXStandardWindow` (das Hauptfenster) und lies dessen Spur-Gruppen rekursiv aus.

============================================================
SCHRITT 2: Dynamische Abfrage in `GET /api/tracks` verankern
============================================================
In `apps/desktop/src-tauri/src/ipc_server.rs`:
- Wenn ein Client (wie das MCP-Tool `mcp__list_tracks` oder das Frontend) `GET /api/tracks` aufruft:
  * Rufe LIVE zur Laufzeit die aktive DAW-Bridge auf (bei Logic Pro: `LogicProDriver.getTrackList()`).
  * Sende KEINE statischen, zuvor gecurlten Daten zurück!
  * Wenn 1 Spur namens "Simple Foundation" existiert, MUSS das Array genau diese Spur ("Simple Foundation") und den Master ("Stereo Out") enthalten.

============================================================
SCHRITT 3: Verifikation im Terminal (OHNE manuellen POST!)
============================================================
1. Starte den Tauri-Backend-Prozess.
2. Führe im Terminal NUR diesen Befehl aus:
   curl -s http://127.0.0.1:48123/api/tracks
3. Die JSON-Ausgabe MUSS "Simple Foundation" enthalten.
   Enthält sie noch "SoCal", "Kick Drum" oder ist hardcodiert, ist die Aufgabe NICHT bestanden!
4. Zeige mir die ungeschönte Terminal-Ausgabe.
```