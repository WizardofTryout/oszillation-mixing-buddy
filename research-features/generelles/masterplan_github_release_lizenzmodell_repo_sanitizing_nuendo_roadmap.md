# MASTERPLAN: GITHUB-RELEASE, LIZENZ-MODELL, REPO-HYGIENE & MULTI-DAW ROADMAP

**Status:** Strategische Weichenstellung für Version v0.6.3 / v0.7.0  
**Projekt:** Oszillation Mixing Buddy (Universal AI Co-Producer for DAWs)

---

## 1. Die strategische Weggabelung: GitHub-Release jetzt vs. Nuendo/Cubase zuerst?

Wir stehen an einer klassischen Schnittstelle in der Software-Evolution:

```
                          [ STAND JETZT: v0.6.3 ]
     Vollwertiger Logic Pro Co-Producer · 30 fps Telemetrie · Multi-Satelliten
     High-End RTA (128 Nadeln) · Session-Manager mit Live-Metern · Safety Shield
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
   [ WEG 1: PUBLIC SHOWCASE (v0.6.3/v0.7.0) ]        [ WEG 2: FIRST MULTI-DAW (v0.8.0) ]
   • GitHub-Veröffentlichung als "Logic Edition"     • Zuerst Nuendo & Cubase einbinden
   • Sofortiges Feedback & Branchen-Aufmerksamkeit   • Erst veröffentlichen, wenn Steinberg
   • Klare Lizenzschranke gegen Trittbrettfahrer       vollständig nativ läuft
```

### Empfehlung: WEG 1 (Public Showcase & Community-Validierung zuerst)

**Warum ein Release zum jetzigen Zeitpunkt ideal ist:**
1. **In sich geschlossenes Produkt:** Version v0.6.3 ist kein wackeliger Prototyp mehr, sondern ein visuell und funktional beeindruckendes Werkzeug für Apple Logic Pro.
2. **Aufmerksamkeits-Vorteil:** Entwickler und Audio-Engineers können das Projekt ausprobieren, Feedback zur Usability geben und die Leistungsfähigkeit der JUCE-Tauri-Architektur bestaunen.
3. **Steinberg-Architektur profitiert:** Wenn das Basis-Repository sauber strukturiert, bereinigt und lizenziert ist, wird die nachfolgende Einbindung des Steinberg MIDI-Remote-Treibers wesentlich aufgeräumter und standardisierter ablaufen.

---

## 2. Das Lizenz-Dilemma: Maximale Aufmerksamkeit bei 100 % kommerziellem Schutz

Um ein Projekt öffentlich auf GitHub zu präsentieren, ohne dass etablierte DAW-Hersteller oder Konkurrenten den Code kopieren, schließen und kommerziell verwerten, scheiden klassische Permissive-Lizenzen (MIT, Apache 2.0, BSD) aus.

### Die drei in der Industrie bewährten Lizenzmodelle:

| Lizenzmodell | Funktionsweise | Geeignet für uns? |
|---|---|---|
| **MIT / Apache 2.0** | Jeder darf den Code kopieren, modifizieren und kommerziell verkaufen, ohne Lizenzgebühren zu zahlen. | **NEIN (Hohes Ausbeutungsrisiko)** |
| **GPL / AGPL v3** | Strenges Copyleft; jeder Abkömmling muss Open Source sein. Erschwert spätere proprietäre Verwertung. | **NEIN (Schränkt eigene Kommerzialisierung ein)** |
| **Business Source License (BSL 1.1) / Fair Source** | Quellcode ist auf GitHub 100 % öffentlich einsehbar, kompilierbar und für Privatnutzer/Evaluation frei. **Jegliche kommerzielle Nutzung oder Integration in kommerzielle Produkte ist lizenzpflichtig.** Wandelt sich nach z. B. 3–4 Jahren automatisch in Open Source um. (Standard bei Sentry, MariaDB, CockroachDB). | **SEHR EMPFOHLEN ⭐** |
| **PolyForm Noncommercial 1.0.0** | Einfache, unmissverständliche Rechtssprache: Erlaubt persönliche, nicht-kommerzielle Nutzung und Forschung. Verhindert jede gewerbliche Ausbeutung ohne Lizenzvertrag. | **EMPFOHLEN (Sehr rechtssicher)** |

### Konkrete Lizenz-Empfehlung: **BSL 1.1 (Business Source License) oder PolyForm Noncommercial**
* **Vorteil:** Musiker und Entwickler können das Projekt auf GitHub forken, mit eigenem API-Key ausführen und Code-Beiträge leisten.
* **Schutz:** Niemand darf Oszillation Mixing Buddy als Konkurrenzprodukt paketieren, im App Store verkaufen oder die proprietären Algorithmen (Acoustic Shock Shield, Reverse-Engineering-Bridges) gewerblich nutzen.

---

## 3. Repo-Sanitizing & Zero-Leak-Protokoll (Sicherheit VOR dem Public Push)

> ⚠️ **HÖCHSTE VORSICHT BEI GIT-HISTORIEN:**  
> Ein einfaches Löschen einer Datei im letzten Commit reicht **nicht** aus! Wenn jemals ein API-Key in einem Commit aus Sprint 1–4 stand, liegt er dauerhaft in den `.git`-Objekten und wird von GitHub-Scannern binnen Sekunden indiziert.

### Die 4 Phasen der Bereinigung:

### Phase 1: Was darf NICHT ins öffentliche Repository?
1. **API-Keys & Secrets:** `.env`, `credentials.json`, Token-Konfigurationen in `localStorage`-Dumps oder Config-Dateien.
2. **Interne Gesprächsprotokolle & Chat-Verläufe:** `docs/chat_history/`, ungefilterte Prompt-Brainstormings.
3. **Persönliche System-Pfade:** Lokale Benutzerverzeichnisse (`/Users/...`, `/Volumes/Spacestation/...`).
4. **Entwickler-Zertifikate:** Lokale Schlüsselbund-Referenzen (außer generische Namen wie `MixingBuddyDev` in Build-Skripten).

### Phase 2: Git-Historie auditieren
Vor dem Umschalten auf `public` muss die Git-Historie automatisiert geprüft werden:
```bash
# Automatische Erkennung von geleakten Keys im gesamten Verlauf:
docker run -v "$PWD:/path" zricethezav/gitleaks:latest detect --source="/path" -v
```
Falls Keys in alten Commits gefunden werden: Bereinigung via `git-filter-repo` oder Erstellung eines frischen Public-Release-Branches (`git checkout --orphan public-main`).

### Phase 3: Trennung von interner Dokumentation und Public Docs
* **Intern (im `.gitignore` geschützt oder in privatem Submodul):**
  * `docs/internal/` (Rechtliche Tactic-Sheets, Rohnotizen, unfertige Patente).
* **Öffentlich:**
  * `docs/architecture/` (Säulen 1–4, Audio-Telemetrie BS.1770-4, IPC-Protokoll).
  * `docs/guides/` (Installationsanleitung, Logic Pro Setup).

---

## 4. Die Anatomie einer High-End GitHub `README.md`

Eine professionelle README muss sofort die visuelle und technische Exzellenz widerspiegeln.

### Aufbau der README:
1. **Header-Banner & Badges:**
   * Logo, Versions-Badge (`v0.6.3`), Plattform (`macOS Apple Silicon`), DAW-Support (`Apple Logic Pro · Nuendo coming soon`), Lizenz (`BSL 1.1`).
2. **Hero-GIF / Screenshot:**
   * Der Split-Screen: Logic Pro links, der Mixing Buddy mit RTA (128 Nadeln) und Session-Manager rechts.
3. **Die Kernvision (In 3 Sätzen):**
   * Kein statischer Fader-Verschieber, sondern ein autonomer, gehörgeschützter AI-Co-Producer, der Audio in Echtzeit (30 fps) psychoakustisch analysiert und direkt über native Accessibility-Bridges in die DAW eingreift.
4. **Key Features Matrix:**
   * ⚡ **The Ear (JUCE 8 Satellit):** Bit-transparente ITU-R BS.1770-4 Telemetrie.
   * 🎛️ **The Hands (Swift Mach-O Bridge):** Latenzfreie UI-Steuerung ohne AppleScript.
   * 🛡️ **Acoustic Shock Shield:** Asymmetrischer Schutz vor Lautstärkesprüngen.
   * 📊 **High-Res Canvas RTA:** 128 Spektralnadeln mit Phosphor-Glow und Dynamic Envelope Matching.
5. **Quick-Start & Setup-Guide:**
   * Schritt-für-Schritt: Plugin nach `~/Library/Audio/Plug-Ins/` kopieren, Tauri-App starten, DAW-Accessibility aktivieren.

---

## 5. Der priorisierte Fahrplan (Wie wir jetzt vorgehen)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ FAHRPLAN BIS ZUM ÖFFENTLICHEN LAUNCH                                             │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  [ SCHRITT 1: v0.6.3 Fertigstellung ]                                            │
│   • Satelliten-Suchfilter & Live-Peak-Meter abschließen                              │
│                                                                                  │
│  [ SCHRITT 2: Repo-Hygiene & Secret-Sanitizing ]                                 │
│   • Gitleaks-Audit über das gesamte Repository                                   │
│   • Säuberung von .gitignore (Schutz interner Research-Dokumente)                │
│                                                                                  │
│  [ SCHRITT 3: Lizenzierung & README-Gestaltung ]                                 │
│   • LICENSE Datei anlegen (BSL 1.1 oder PolyForm Noncommercial)                  │
│   • Stylische README.md mit Architektur-Grafiken und Screenshots                 │
│                                                                                  │
│  [ SCHRITT 4: Public GitHub Launch (Milestone 1) ]                               │
│   • Release-Tag 'v0.7.0 - The Logic Pro Showcase'                                │
│                                                                                  │
│  [ SCHRITT 5: Phase 4 – Steinberg Nuendo & Cubase Integration ]                 │
│   • Aktivierung des nativen Steinberg MIDI-Remote Treibers                       │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Nächste konkrete Aktion

1. Lass Antigravity die aktuelle Aufgabe **v0.6.3 (Satelliten-Suchfilter & Live-Pegel)** zu Ende bauen und testen.
2. Sobald v0.6.3 läuft, erstellen wir gemeinsam die **Bereinigungs-Direktive (Secret-Scan & `.gitignore`)** und die offizielle **README.md & LICENSE**, um das Repository bereit für den ersten öffentlichen Auftritt zu machen.