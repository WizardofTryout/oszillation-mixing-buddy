# MISSION ALIGNMENT & ARBEITSPROTOKOLL: OSZILLATION MIXING BUDDY

**Dokument-Status:** Verbindliche System-Richtlinie & Architektur-Kompass  
**Zielgruppe:** Antigravity (Autonomous Senior Software Engineer) & Lead Architect  
**Projekt:** Oszillation Mixing Buddy (Universal AI Co-Producer for DAWs)

---

## 1. Wer wir sind & Was wir bauen (Die Vision)

Der **Oszillation Mixing Buddy** ist kein generischer Chatbot und kein starres Preset-Tool.  
Es ist ein **autonomer, latenzfreier AI-Mischtoningenieur und Co-Producer** auf Profi-Niveau, der Musiker im Tonstudio direkt in ihrer gewohnten DAW (Apple Logic Pro, Steinberg Nuendo/Cubase) assistiert.

### Das Closed-Loop-Prinzip (Die 5 Sinne des Systems):
1. **Hören (`The Ear`):** Bit-transparentes JUCE C++20 Plugin auf dem Master-Bus misst in Echtzeit LUFS (EBU R128), True Peak, Phasenkorrelation und 32-Band-FFT.
2. **Sehen (`DAW Drivers & AX`):** Liest die Session-Struktur aus (Spurnamen, Fader, Pan, belegte Inserts).
3. **Denken (`AI Engine / MCP`):** Claude 3.7/3.5, Gemini 3.8/Flash oder lokale LLMs analysieren das Audiosignal und formulieren psychoakustisch begründete Vorschläge.
4. **Vorschlagen (`Human-in-the-Loop HUD`):** Generiert interaktive ActionCards mit A/B-Vorhören (`[A/B Listen]`) und Freigabe (`[Anwenden]`).
5. **Handeln (`The Hands`):** Native Swift-Bridge (`logic-ax-bridge`) und MCU steuern Fader, Panorama und Plugins im Sub-Millisekunden-Bereich direkt in der DAW.

---

## 2. Die 4 Schichten unserer System-Architektur

Verliere dich niemals in isolierten Skripten. Das gesamte Monorepo ruht auf genau vier klar voneinander getrennten Säulen:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DIE 4 SYSTEM-SÄULEN                             │
└────────────────────────────────────────────────────────────────────────┘

SÄULE 1: AUDIO-TELEMETRIE ("The Ear")
────────────────────────────────────
• Pfad: 'plugins/meter-audio/'
• Tech: JUCE 8, C++20, CMake, ITU-R BS.1770-4 / EBU R128 Dual-Gate
• Auslieferung: AU ('~/Library/Audio/Plug-Ins/Components/') & VST3
• Aufgabe: Streamt alle 33 ms (30 fps) Binär-/JSON-Frames an Port 48123.

SÄULE 2: DESKTOP COMPANION & IPC HUB
─────────────────────────────────────
• Pfad: 'apps/desktop/' ('src-tauri/' [Rust] + 'src/' [React / Tailwind])
• Tech: Tauri v2, CoreMIDI Virtual Ports, TCP/WebSocket Server (48123)
• Aufgabe:
  - Hostet das Musiker-HUD (RTA-Graph, LUFS-Meter, ActionCards, Chat).
  - Verwaltet den 'Acoustic Shock Shield' (Gehörschutz).
  - Routet Befehle an die native Swift-Bridge.

SÄULE 3: NATIVE DAW-BRIDGES ("The Hands")
────────────────────────────────────────
• Pfad: 'packages/daw-adapters/'
• Tech: Swift Mach-O Binary ('packages/daw-adapters/bin/logic-ax-bridge')
• Aufgabe:
  - Direkter Speicherzugriff via macOS 'ApplicationServices' / 'AXUIElement'.
  - Steuerbefehle: 'list-channel-strips', 'set-fader', 'set-pan',
    'open-insert', 'close-plugin-window', 'profile-plugin'.
  - Keine osascript/AppleScript-Umwege! Latenz < 0,1 ms.

SÄULE 4: MCP-SERVER & AI-GATEWAY ("The Brain")
─────────────────────────────────────────────
• Pfad: 'packages/mcp-server/' & 'packages/ai-engine/'
• Tech: Model Context Protocol (Spec 2026 / stdio & SSE 48124), Node.js/TS
• Aufgabe:
  - Exponiert genau 7 Kern-Tools für externe KIs (Claude Desktop, Cursor)
    und den integrierten HUD-Chat.
  - Verwaltet den persistenten 'Plugin Vault' ('~/.mixing-buddy/plugins/').
```

---

## 3. Aktueller System-Status: Was steht bereits zu 100 %?

Bevor du Code anfasst, mache dir bewusst, welche riesigen Meilensteine bereits stabil im Produktivbetrieb laufen:

| Komponente | Status | Details |
| :--- | :---: | :--- |
| **Audio-Stream ("The Ear")** | ✅ **Fertig** | Rolling 5s Gated EBU-R128 LUFS, True Peak, FFT & Reset-Button (`↺`). |
| **DAW-Erkennung** | ✅ **Fertig** | Präziser Prozess-Check via `pgrep -x "Logic Pro"`, keine Phantom-Logs mehr. |
| **Tauri v2 ACL / Capabilities** | ✅ **Fertig** | Berechtigungen in `capabilities/default.json` aktiv; IPC-Calls laufen flüssig. |
| **Plugin Vault & Auto-Profiler** | ✅ **Fertig** | 1-Klick-Scan (`profile-plugin`), JSON-Speicher in `~/.mixing-buddy/plugins/`, Tags & Filter im Modal. |
| **Mixer-Traversierung im Hauptfenster** | ✅ **Fertig** | Channel-Strips werden direkt in `AXStandardWindow` ("* - Spuren") gefunden. |
| **Asymmetrischer Safety-Guard** | ✅ **Fertig** | Minus-Deltas (Leiserstellen) unbegrenzt, A/B-Restore freigegeben. |
| **Universal MCP-Manager** | ✅ **Fertig** | Dynamischer Status (🟢/⚪), Config-Installer für Claude, Cursor, VS Code. |

---

## 4. Strikte Git-Hygiene & Sicherheits-Vorgaben

Ab sofort gelten für Antigravity folgende nicht-verhandelbare Arbeitsregeln:

### 1. Atomare Commits & GitHub Push nach jedem gelösten Meilenstein
* Sobald ein Bug behoben oder ein Feature erfolgreich getestet wurde, führe **sofort** folgenden Zyklus aus:
  ```bash
  ./scripts/lint-loc.sh
  git add -A
  git commit -m "feat(<scope>): prägnante Beschreibung" # bzw. fix(...)
  git push origin main
  ```
* **Niemals** ungesicherte Änderungen über mehrere Aufgaben hinweg im Workspace liegen lassen!

### 2. Die strikte 3.000 LOC-Regel
* Keine Datei im gesamten Repository darf $3.000$ Zeilen Code überschreiten (`./scripts/lint-loc.sh`).
* Droht eine Datei diese Grenze zu erreichen, lagere Hilfsfunktionen modular in neue Dateien aus.

### 3. Absolutes Verbot von Mocks & Scheindaten
* Wenn eine DAW nicht läuft oder ein Element nicht existiert, liefert das System ein leeres Array (`[]`) oder einen echten Fehler.
* **Niemals** Scheindaten (`"SoCal"`, `"Kick Drum"`, feste Mock-Frequenzen) in den Code schreiben oder per `curl` simulieren.

### 4. Keine isolierten Shell-Experimente ohne Rückbau
* Temporäre Test-Skripte dürfen nach der Verifikation nicht als Datenmüll im Root-Verzeichnis verbleiben.
* Nach Tests immer den Workspace bereinigen (`git status -s`).

---

## 5. Leitfaden zur Problemlösung (Anti-Loop-Protokoll)

Wenn ein Befehl oder Test nicht das gewünschte Ergebnis liefert:

```
[ FEHLER TRITT AUF ]
         │
         ▼
[ SCHRITT 1: STOPPEN ] ──────► Keine hektischen Blindänderungen an 5 Dateien gleichzeitig!
         │
         ▼
[ SCHRITT 2: ISOLIEREN ] ────► Teste das Problem mit EINEM EINZIGEN CLI-Befehl im Terminal
         │                     (z. B. './packages/daw-adapters/bin/logic-ax-bridge ...').
         ▼
[ SCHRITT 3: URSACHE ] ──────► Ist es ein UI-Attribut? Eine Datentyp-Fehlinterpretation?
         │                     Oder eine macOS-Berechtigung?
         ▼
[ SCHRITT 4: MINIMALER FIX ] ─► Repariere exakt die gefundene Zeile in der zuständigen Datei.
         │
         ▼
[ SCHRITT 5: VERIFIKATION ] ──► Führe den isolierten Testbefehl erneut aus.
         │
         ▼
[ SCHRITT 6: COMMIT & PUSH ] ─► Baue neu, prüfe LOC, committe und pushe auf GitHub.
```

---

## 6. Aktueller Fokus: Die nächsten 3 Prioritäten

Sobald du dieses Dokument verinnerlicht hast, konzentriere dich strikt auf folgende Reihenfolge:

1. **Priorität 1: Pan & Fader 2-Stufen-Verifikation abschließen**
   * Verifiziere, dass Pan auf exakt `+50` springt (via Grobschritte `AXIncrement` + Feinticks).
   * Verifiziere, dass Fader via dB-Textfeld sichtbar auf `-8.0 dB` abfällt.
   * Sofort committen & pushen!

2. **Priorität 2: Vault Tagging & Elastische Suche im Frontend**
   * Auto-Kategorisierung (Saturation, Reverb, Delay, Modulation etc.).
   * User-editierbare Tags mit `[+ Tag]` und `[×]`.
   * Sofort committen & pushen!

3. **Priorität 3: HUD-Chat endgültig mit AI-Engine verdrahten**
   * Letzte statische Canned Responses entfernen.
   * Eingehende Prompts im HUD erzeugen echte Live-ActionCards in der Queue.
   * Sofort committen & pushen!

---

*Ende der Richtlinie. Halte dich exakt an diesen Rahmen – das Fundament ist exzellent gebaut, jetzt bringen wir die Präzision zur Vollendung.*