# 🎙️ Oszillation Mixing Buddy — Studio Deployment Guide (v0.9.0)

Dieser Leitfaden führt dich in 4 einfachen Schritten durch das Setup deines **Oszillation Mixing Buddy** Systems auf deinem Studio-Mac (mit installiertem **Steinberg Nuendo 14 / Cubase 14** oder **Apple Logic Pro**).

---

## 📋 Voraussetzungen auf dem Studio-Mac
- **macOS** 13.0+ (Apple Silicon M1/M2/M3/M4 empfohlen, Intel unterstützt)
- **Node.js 20+** & **pnpm 9+** (`brew install node pnpm`)
- **Steinberg Nuendo 14 / Cubase 14** (auch 12 & 13) und/oder **Apple Logic Pro 10.8 / 11+**
- **Claude Desktop** (oder Gemini CLI / Cursor)

---

## 🚀 Schritt 1: Klonen & 1-Klick-Setup ausführen

Klone das Repository auf deinem Studio-Mac und starte das automatisierte Setup:

```bash
git clone https://github.com/WizardofTryout/Steinberg-Mixing-Buddy.git
cd Steinberg-Mixing-Buddy

# Führt Installation, Build und Plugin-Verlinkung automatisch aus
./setup.sh
```

Anschließend startest du das Desktop Companion HUD:

```bash
pnpm --filter desktop dev
```

*Alternativ:* Du kannst auch direkt die fertig kompilierte und permanent mit `MixingBuddyDev` signierte macOS-App starten:
`/Applications/Oszillation Mixing Buddy.app` (oder die `.dmg`-Datei aus `dist-release/v0.9.0/` installieren).

---

## 🔌 Schritt 2: Audio Metrology Plugin ("The Ear") in der DAW laden

Das JUCE C++20 Plugin wurde bereits automatisch in deine nativen macOS-Plugin-Verzeichnisse kopiert:

| DAW | Plugin-Format | Pfad auf dem Mac |
| :--- | :--- | :--- |
| **Steinberg Nuendo 14 / Cubase 14** | VST3 | `~/Library/Audio/Plug-Ins/VST3/MixingBuddyMeter.vst3` |
| **Apple Logic Pro** | Audio Unit (AU) | `~/Library/Audio/Plug-Ins/Components/MixingBuddyMeter.component` |

### Aktivierung in der DAW:
1. Öffne dein Projekt in Nuendo oder Logic Pro.
2. Füge das Plugin **`MixingBuddyMeter`** auf dem **Master Bus / Stereo Out** im letzten Insert-Slot ein (hinter allen Mix-Plugins, vor dem Monitoring).
3. Starte die Wiedergabe in der DAW:
   - Das Plugin überträgt die Telemetrie (EBU R128 LUFS, True Peak, 32-Band FFT) automatisch und latenzfrei über WebSocket an `ws://127.0.0.1:48123/meter`.
   - Im Desktop HUD leuchtet das neue Multi-DAW Badge (`DawStatusBadge`) sofort auf **"Live (48123)"** und schaltet automatisch auf die aktive DAW um.
   - Der integrierte **Session Recall** überträgt die `sessionUuid` direkt in das Desktop HUD und stellt den zugehörigen Mix-Zustand wieder her!

---

## 🎹 Schritt 3: Steinberg MIDI Remote Script in Nuendo 14 / Cubase 14 aktivieren

Das native JavaScript-Remote-Skript liegt in:
`~/Documents/Steinberg/Nuendo 14/MIDI Remote/Driver Scripts/Local/Oszillation/MixingBuddy/Oszillation_MixingBuddy.js`

### 1-Klick Installation via Desktop HUD:
1. Öffne das Hamburger-Menü im Desktop HUD oben rechts.
2. Klicke unter **„Werkzeuge & Vault“** auf **„🎹 Steinberg MIDI Remote Installieren“**.
3. Das Skript wird vollautomatisch in die Pfade für Nuendo 14, Cubase 14 sowie ältere Versionen geschrieben!

### Aktivierung in Nuendo 14 / Cubase 14:
1. Öffne in Nuendo das untere Panel und klicke auf den Tab **„MIDI Remote“**.
2. Wähle aus der Liste **„Oszillation - Mixing Buddy“**.
3. Nuendo synchronisiert nun 16-Kanal-Fader, Pan, Mute, Solo, Channel EQ, Frequency 2 und Transport bidirektional!

*(Hinweis für Apple Logic Pro: Die Steuerung läuft vollkommen isoliert und regressionsfrei über die native Swift Mach-O Binary `logic-ax-bridge` und macOS Accessibility `AXUIElement`.)*

---

## 🗄️ Studio Memory Vault & Memory Inspector
- Im Desktop HUD findest du unter **„Session Vault“** den interaktiven **Session Manager** zum Verwalten deiner Projekthistorie.
- Der **Memory Inspector** erlaubt das Durchblättern aller AI-Misch-Entscheidungen mit vorher/nachher Parameter-Deltas und Instant-Replay.

## 🤖 Schritt 4: Claude Desktop als Co-Producer verknüpfen

1. Öffne die Konfigurationsdatei von Claude Desktop auf deinem Mac:
   `~/Library/Application Support/Claude/claude_desktop_config.json`

2. Füge den Mixing Buddy MCP-Server hinzu:

```json
{
  "mcpServers": {
    "steinberg-mixing-buddy": {
      "command": "/opt/homebrew/bin/node",
      "args": [
        "/Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/packages/mcp-server/dist/index.js",
        "--stdio"
      ],
      "env": {
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
      }
    }
  }
}
```

3. Starte **Claude Desktop** neu.
4. Unten rechts im Chat-Fenster siehst du nun den Schraubenschlüssel mit den 5 Mixing-Tools:
   - `mcp__get_mix_telemetry`
   - `mcp__list_tracks`
   - `mcp__propose_mix_adjustment`
   - `mcp__execute_mix_adjustment`
   - `mcp__audition_region`

### 💬 Beispiel-Prompts für Claude Desktop im Studio:
- *„Höre dir die aktuelle Telemetrie aus Nuendo an. Wie ist unsere Integrated Loudness und haben wir True-Peak-Clipping?“*
- *„Gibt es Frequenzmaskierungen zwischen den Spuren im Bereich von 60 bis 120 Hz? Wenn ja, erstelle einen Vorschlag zur Absenkung.“*
- *„Schlage mir eine Korrektur vor und markiere die Takte 17 bis 25 zum A/B-Vorhören.“*

Sobald Claude einen Vorschlag sendet, erscheint im **Desktop HUD** sofort eine interaktive **Diff-Card**. Du kannst per Klick auf **[Anwenden]** die Änderung über den integrierten **Acoustic Shock Shield** (Master $\le 0\text{ dB}$, Einzelschritte $\le +3\text{ dB}$) direkt und sicher in die DAW schreiben lassen!
