# 🎙️ Steinberg Mixing Buddy — Studio Deployment Guide

Dieser Leitfaden führt dich in 4 einfachen Schritten durch das Setup deines **Steinberg Mixing Buddy** Systems auf deinem Studio-Mac (mit installiertem **Steinberg Nuendo / Cubase** oder **Apple Logic Pro**).

---

## 📋 Voraussetzungen auf dem Studio-Mac
- **macOS** (Apple Silicon M1/M2/M3/M4 empfohlen)
- **Node.js 20+** & **pnpm 12+** (`brew install node pnpm`)
- **Steinberg Nuendo 12/13+** (oder Cubase Pro) und/oder **Apple Logic Pro 10.8/11+**
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

*Alternativ:* Du kannst auch direkt die fertig kompilierte macOS-App starten:
`/Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/target/release/bundle/macos/Steinberg Mixing Buddy.app` (oder die `.dmg`-Datei im `bundle/dmg/`-Ordner installieren).

---

## 🔌 Schritt 2: Audio Metrology Plugin ("The Ear") in der DAW laden

Das JUCE C++20 Plugin wurde bereits automatisch in deine nativen macOS-Plugin-Verzeichnisse kopiert:

| DAW | Plugin-Format | Pfad auf dem Mac |
| :--- | :--- | :--- |
| **Steinberg Nuendo / Cubase** | VST3 | `~/Library/Audio/Plug-Ins/VST3/MixingBuddyMeter.vst3` |
| **Apple Logic Pro** | Audio Unit (AU) | `~/Library/Audio/Plug-Ins/Components/MixingBuddyMeter.component` |

### Aktivierung in der DAW:
1. Öffne dein Projekt in Nuendo oder Logic Pro.
2. Füge das Plugin **`MixingBuddyMeter`** auf dem **Master Bus / Stereo Out** im letzten Insert-Slot ein (hinter allen Mix-Plugins, vor dem Monitoring).
3. Starte die Wiedergabe in der DAW:
   - Das Plugin überträgt die Telemetrie (EBU R128 LUFS, True Peak, 32-Band FFT) automatisch und latenzfrei über WebSocket an `ws://127.0.0.1:48123/meter`.
   - Im Desktop HUD leuchtet die Anzeige sofort auf **"Audio: Live (48123)"** und das Spektrum schlägt live aus.

---

## 🎹 Schritt 3: Steinberg MIDI Remote Script in Nuendo aktivieren

Das Skript zur 14-Bit-Fader- und Insert-Steuerung liegt in:
`~/Documents/Steinberg/Nuendo/MIDI Remote/Driver Scripts/Local/Steinberg/MixingBuddy/ai_agent_driver.js`

### Aktivierung in Nuendo (1 Klick):
1. Öffne in Nuendo das untere Panel und klicke auf den Tab **„MIDI Remote“**.
2. Klicke auf das **„+“** (Neuen Controller hinzufügen) oder wähle aus der Liste **„Steinberg Mixing Buddy (AI Agent)“**.
3. Wähle als MIDI-Ports deinen virtuellen CoreMIDI-Loopback (z. B. *IAC-Treiber Bus 1* oder *MixingBuddy Virtuell*).
4. **Fertig!** Nuendo synchronisiert nun Fader-Lautstärken in 14-Bit-Präzision und Quick Controls bidirektional mit dem Mixing Buddy.

*(Hinweis für Logic Pro: Die Steuerung läuft automatisch über das Mackie Control Universal (MCU) Protokoll und macOS Accessibility `AXUIElement`.)*

---

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
- *„Gibt es Frequenzmaskierungen zwischen Kick Drum und Bass Guitar im Bereich von 60 bis 120 Hz? Wenn ja, erstelle einen Vorschlag zur Absenkung.“*
- *„Schlage mir eine Korrektur vor und markiere die Takte 17 bis 25 zum A/B-Vorhören.“*

Sobald Claude einen Vorschlag sendet, erscheint im **Desktop HUD** sofort eine interaktive **Diff-Card**. Du kannst per Klick auf **[Anwenden]** die Änderung über den integrierten **Acoustic Shock Shield** (Master $\le 0\text{ dB}$, Einzelschritte $\le +3\text{ dB}$) direkt und sicher in die DAW schreiben lassen!
