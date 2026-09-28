# Schnellstart- & Setup-Leitfaden: Nativer Host vs. VirtualBuddy

## Klare Empfehlung: Bleibe unbedingt auf dem nativen Mac (kein VirtualBuddy!)

Dass aktuell weder `brew`, `cmake` noch `node` installiert sind, ist bei einem frischen oder für Musikproduktion genutzten Mac der **Normalzustand**. Du solltest das Projekt dennoch **nicht** in einer virtuellen Maschine (VirtualBuddy) aufsetzen.

### Warum VirtualBuddy hier zu schweren Problemen führen würde:

1. **Kein UI-Zugriff auf Logic Pro (Showstopper):**
   Das Agent-System steuert Logic Pro über die native macOS Accessibility API (`AXUIElement`). Eine VM hat aus Sicherheitsgründen keinen Zugriff auf die Benutzeroberfläche von Programmen, die auf deinem Host-Mac laufen. Du müsstest Logic Pro mitsamt Content und Lizenzen in die VM verlegen.

2. **Keine CoreMIDI-Loopbacks:**
   Die Ansteuerung von Nuendo erfolgt über interne virtuelle MIDI-Ports. Virtuelle Maschinen können macOS-interne MIDI-Busse nicht ohne erhebliche Latenzen und komplexe Netzwerk-Routings ansprechen.

3. **Plugin-Validierung (`auval`):**
   Dein JUCE-Meter-Plugin (`.component` / `.vst3`) muss direkt von deinen auf dem Host installierten DAWs geladen und getestet werden.

4. **Homebrew ist 100 % sicher für deinen Mac:**
   Auf modernen Apple-Silicon-Macs installiert sich Homebrew isoliert unter `/opt/homebrew`. Es verändert **keine** macOS-Systemdateien (`/System` bleibt schreibgeschützt) und kann bei Bedarf jederzeit mit einem einzigen Befehl rückstandslos gelöscht werden.

---

## 3-Schritte-Einrichtung auf deinem Host-Mac (Dauer: ca. 3–5 Minuten)

### Schritt 1: Xcode Command Line Tools & Homebrew installieren

Öffne dein **Terminal** (unter *Programme -> Dienstprogramme -> Terminal*) und führe folgenden Befehl aus:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

*Hinweise während der Installation:*
* Falls macOS nach den **Command Line Tools (Apple Clang/Git)** fragt, bestätige mit Enter / Passwort.
* **Wichtig bei Apple Silicon (M1/M2/M3/M4):** Am Ende der Installation zeigt Homebrew dir zwei Zeilen unter **"Next steps"** an, um Homebrew in deinen Pfad aufzunehmen. Führe diese zwei Befehle bitte direkt im Terminal aus (sie sehen in etwa so aus):

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### Schritt 2: Die benötigten Werkzeuge mit einem Befehl installieren

Führe danach einfach diese Zeile im Terminal aus:

```bash
brew install cmake ninja node pnpm
```

*(Optional für Sprint 3 – Rust für die Desktop-App):*

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

### Schritt 3: Status-Check & Startsignal an deinen Agenten

Prüfe kurz, ob alles greift:

```bash
which brew cmake ninja node pnpm
```

Wenn jetzt für jedes Tool ein Pfad (z. B. `/opt/homebrew/bin/...`) erscheint, kopiere die folgende Nachricht in den Chat deines autonomen Agenten (Antigravity):

```text
Alle Voraussetzungen sind nativ auf meinem Mac installiert und verifiziert:
- Homebrew: einsatzbereit (/opt/homebrew)
- CMake & Ninja: installiert
- Node.js & pnpm: installiert
- Xcode CLI Tools: aktiv

Du hast die Freigabe für Sprint 0 unter folgenden verbindlichen Sicherheits- und Architekturregeln:

1. Monorepo-Scaffolding & File-Size-Schranke:
   - Initialisiere das pnpm-Monorepo und das Cargo-Workspace-Setup gemäß Architekturplan.
   - Richte GitHub Actions CI mit der strikten <3000 LOC File-Size-Schranke ein.

2. Strikter Node/npm Supply-Chain-Schutz:
   - Erstelle im Projekt-Root eine `.npmrc` mit 'ignore-scripts=true', damit Pakete beim Installieren keine unkontrollierten preinstall/postinstall-Skripte ausführen können.
   - Verwende für die Frontend-App ausschließlich offizielle Industriestandards (Vite, React, Tailwind CSS, TypeScript, Lucide) und absolut keine obskuren Drittanbieter-Micro-Packages.
   - Halte das pnpm-lock.yaml synchron und binde einen automatisierten 'pnpm audit'-Check in den CI-Workflow ein.

3. Interaktiver Test-Stopp:
   - Melde dich nach Fertigstellung von Sprint 0 mit dem Statusbericht für den ersten Freigabe-Check. Installiere keine weiteren globalen Host-Tools ohne vorherige Rücksprache.
```