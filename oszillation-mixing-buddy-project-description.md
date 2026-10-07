# Oszillation Mixing Buddy — Projekt- & Nutzen-Beschreibung
## Der erste universelle, native KI-Co-Producer für professionelle DAWs

---

## 1. Executive Summary & Produkt-Pitch

Der **Oszillation Mixing Buddy (OMB)** ist eine bahnbrechende Verbindung aus professioneller Audiotechnik, nativer Betriebssystem-Automation und modernster Künstlicher Intelligenz. Er fungiert als **virtueller Toningenieur und Co-Producer direkt am Mischpult des Nutzers** in führenden Digital Audio Workstations wie **Apple Logic Pro** und **Steinberg Nuendo / Cubase**.

### Der Kernunterschied zu bisherigen Tools:
* **Herkömmliche AI-Audio-Tools** erzeugen entweder fertiges Audio extern in einer Cloud (wie Suno oder Udio) oder sind starre One-Knob-Plugins, die als unbeeinflussbare Blackbox arbeiten.
* **Sprachmodelle wie ChatGPT oder Claude im Webbrowser** sind im Tonstudio taub und gelähmt: Sie können das laufende Projekt weder hören noch Fader und Regler in der DAW anfassen.
* **Der Oszillation Mixing Buddy schließt genau diese Lücke:** Er besitzt **echte Ohren** (ein bit-transparentes JUCE 8 Metering-Plugin), **echte Hände** (eine latenzfreie native Swift-Bridge mit direkter DAW-Steuerung) und **modernste Reasoning-Intelligenz** (Google Gemini, Anthropic Claude, OpenAI oder lokale Modelle).

Er ersetzt nicht den Menschen, sondern erweitert dessen Fähigkeiten: **Augmented Intelligence statt Blackbox-Automation.**

---

## 2. Die Realität im Tonstudio: Welches reale Problem lösen wir?

Im Produktionsalltag – vom Schlafzimmer-Produzenten bis zum High-End-Mischstudio – treten regelmäßig drei fundamentale Schmerzpunkte auf:

### Problem 1: Ermüdung des Gehörs & Frequenz-Maskierung
Nach stundenlangem Arbeiten an einem Song gewöhnen sich die menschlichen Ohren an klangliche Fehler („Ear Fatigue“). Kick-Drum und Bassline überlagern sich im Subbass-Bereich (Phasenprobleme, Mulm), Gesangsspuren ertrinken im dichten Arrangement, oder scharfe Frequenzen bei 3–5 kHz stechen unangenehm hervor.
* **Bisher:** Man probiert blind EQs und Kompressoren aus, zweifelt am Mix und vergleicht frustriert mit Fremdproduktionen.
* **Mit Mixing Buddy:** Das System analysiert mit 30 Bildern pro Sekunde das physikalische Signal, erkennt spektrale Verdeckungen und Resonanz-Buildups mathematisch präzise und schlägt gezielte Gegenmaßnahmen vor.

### Problem 2: Mangelnder musikalischer Kontext bei starren Analysetools
Ein Spektrumanalysator zeigt nur Kurven, weiß aber nicht, **was** er misst und **wohin** die Reise gehen soll.
* Ein Trap-Beat braucht massiven Subbass bei 40 Hz und eine Lautheit von $-8\text{ LUFS}$.
* Ein Jazz-Trio oder ein Akustik-Song wird bei diesen Werten komplett zerstört und erfordert $-16\text{ LUFS}$ mit offener Mikrodynamik ($> 14\text{ dB}$ Crest-Faktor).
* **Mit Mixing Buddy:** Über vordefinierte **Genre-Profile**, eine automatische KI-Stilerkennung (*Auto-Detect*) und die Definition des **Signal-Fokus** (*Master Bus*, *Lead Vocal*, *Drum Bus*) beurteilt das System das Signal immer im richtigen musikalischen Kontext.

### Problem 3: Die Kluft zwischen Analyse und Ausführung
Selbst wenn ein Analyzer anzeigt, dass bei 430 Hz eine Resonanz vorliegt, muss der Musiker:
1. Das entsprechende Plugin auf der richtigen Spur öffnen.
2. Das Band auswählen.
3. Frequenz, Q-Faktor und Gain manuell einstellen.
4. Den Pegelsprung ausgleichen (Gain-Staging).
* **Mit Mixing Buddy:** Das System schlägt eine fertige **ActionCard** vor. Ein Klick auf *„Anwenden“* stellt Fader, Panorama und EQ-Bänder in der DAW in weniger als einer Millisekunde physisch ein!

---

## 3. Konkrete Usecases: Der greifbare Nutzen für Anwender

### Usecase A: Der Independent Producer / Beatmaker („Bedroom Producer“)
* **Situation:** Produziert moderne Hip-Hop-/Pop-Tracks allein im Homestudio mit Kopfhörern oder suboptimaler Raumakustik.
* **Herausforderung:** Unsicherheit bei Lautheit, Gain-Staging und Tiefenstaffelung.
* **Nutzen durch OMB:**
  * Sagt im Chat: *„Hör dir Takt 17 bis 33 an und mach die Vocals präsenter, ohne dass die Snare untergeht.“*
  * Der Mixing Buddy analysiert den Bereich, justiert den Channel EQ auf der Gesangsspur (Präsenz bei 3.2 kHz) und regelt die Snare im Panorama minimal nach außen.
  * Der Produzent drückt auf **[ A/B Listen ]**, hört 6 Sekunden lang den Vorher/Nachher-Unterschied und übernimmt die Änderung per Klick.

### Usecase B: Der professionelle Mixing- & Mastering-Engineer
* **Situation:** Hat täglich Deadlines für Alben, Podcasts oder Werbeproduktionen und muss strikte Industriestandards einhalten.
* **Herausforderung:** Zeitaufwändige Fleißarbeit (Kanal-Balancing, EBU R128 Broadcast-Compliance, Referenz-Track-Abgleich).
* **Nutzen durch OMB:**
  * **Referenz-Matching:** Zieht einen kommerziellen Referenz-Track per Drag & Drop in das HUD. Der Buddy analysiert dessen 32-Band-Spektrum und generiert sofort die passenden EQ-Kompensationskurven für den Master-Bus.
  * **Skill-System:** Aktiviert den Skill *„Tonmischmeister (EBU R128)“*. Die KI überwacht streng True-Peak-Grenzwerte ($-1.0\text{ dBTP}$) und Streaming-Normen ($-14\text{ LUFS}$).

### Usecase C: Der Live-Musiker & Komponist im kreativen Fluss
* **Situation:** Schreibt an einer Filmmusik oder einem Rocksong und möchte nicht aus dem kreativen Flow gerissen werden, um technische Mixing-Eingriffe vorzunehmen.
* **Nutzen durch OMB:** Die Einstellungen bleiben dank **DAW-Projekt-Persistenz** direkt in der `.logicx`- oder `.cpr`-Datei gespeichert. Öffnet der Musiker den Song Wochen später, weiß der Mixing Buddy sofort wieder, welches Genre, welcher Fokus und welche individuellen Crossover-Notizen aktiv waren.

---

## 4. Die Dual-Core-Architektur: Standalone Desktop-App (API-Key) vs. MCP-Server Mode

Ein einzigartiges Merkmal des Projekts ist seine **duale Architektur**. Das System kann wahlweise als **Standalone-Desktop-App** oder als **MCP-Server** betrieben werden. Beide Modi existieren aus gutem Grund und bedienen unterschiedliche Zielgruppen:

```
                      ┌───────────────────────────────────────────────┐
                      │             DAS INTELLIGENTE ZENTRUM          │
                      │         (Audio-Telemetrie & DAW-Bridges)      │
                      └───────┬───────────────────────────────┬───────┘
                              │                               │
         MODUS 1: STANDALONE DESKTOP-APP                      MODUS 2: MODEL CONTEXT PROTOCOL (MCP)
        ┌─────────────────────────────────────┐      ┌─────────────────────────────────────┐
        │        Musiker / Producer-HUD       │      │        AI-Agenten / Externe Tools   │
        │   • Direkte API-Key Eingabe         │      │   • Standardisierter Port 48124     │
        │   • Integrierter AgentRunner        │      │   • Claude Desktop, Cursor, n8n     │
        │   • Schicke UI mit Spektrum & Cards │      │   • 13 semantische Mixing-Tools     │
        │   • Kein Terminal, kein Programmieren│     │   • Headless-Studio-Automation      │
        └─────────────────────────────────────┘      └─────────────────────────────────────┘
```

### Modus 1: Standalone Desktop Companion (Direct API-Key Mode)
* **Für wen?** Den Musiker, Toningenieur und Produzenten im Studio-Alltag.
* **Wie es funktioniert:**
  * Der Nutzer startet die native Desktop-App (`Oszillation Mixing Buddy.app`).
  * In den Einstellungen hinterlegt er seinen eigenen Google Gemini, Anthropic Claude oder OpenAI API-Key (oder nutzt lokale Modelle via Ollama).
  * Die in Rust und TypeScript integrierte Reasoning-Engine (`AgentRunner`) steuert den Workflow vollständig autonom.
* **Vorteile:**
  * **Plug & Play:** Keine Entwicklerwerkzeuge, kein Terminal, keine externen AI-Clients erforderlich.
  * **Visuelle Ergonomie:** Echtzeit-RTA-Spektrum, farbige Frequenzbänder, A/B-Buttons und interaktive ActionCards direkt neben dem Logic-Fenster.
  * **Multi-Key Round-Robin:** Verwaltet mehrere API-Keys parallel, um Free-Tier-Limits clever zu umgehen und Ausfälle abzufangen.

### Modus 2: MCP-Server Mode (Model Context Protocol)
* **Für wen?** Entwickler, KI-Forscher, Automation-Power-User und Nutzer von Cursor, Claude Desktop, Antigravity oder n8n.
* **Wie es funktioniert:**
  * Der Mixing Buddy startet auf Port 48124 einen vollwertigen **Model Context Protocol (MCP)** Server nach offizieller Spezifikation (stdio & SSE).
  * Externe KI-Agenten können auf das gesamte Studio-System wie auf eine Funktionsbibliothek zugreifen.
* **Exponierte MCP-Tools:**
  * `mcp__get_mix_telemetry`: Liest LUFS, True-Peak, Stereokorrelation und 32-Band-FFT live aus der DAW.
  * `mcp__list_tracks`: Listet alle echten Spuren, Fader, Panoramen und Plugins des Projekts auf.
  * `mcp__propose_mix_adjustment`: Lässt das LLM eine begründete ActionCard mit Fader- und EQ-Schritten formulieren.
  * `mcp__execute_mix_adjustment`: Führt die gewünschten Änderungen physikalisch in der DAW aus.
  * `mcp__audition_region`: Spielt Taktbereiche für A/B-Hörtests in Logic ab.
  * `mcp__match_reference_spectrum`: Vergleicht den aktuellen Mix mit einer Audio-Referenzdatei.
  * `mcp__learn_plugin`: Scannt Menüs und Parameter neuer Dritthersteller-Plugins und speichert sie im Vault.
* **Vorteile:**
  * **Zukunftssicherheit:** Jedes neue Sprachmodell, das den MCP-Standard unterstützt, kann die DAW sofort steuern.
  * **Komplexe Automations-Ketten:** Ermöglicht vollautomatische Batch-Mixe, Multi-Agenten-Workflows oder nächtliche Qualitätsprüfungen großer Projekt-Archive.

> **Das Geniale daran:** Egal welcher Modus gewählt wird – beide greifen auf dasselbe Fundament zu: dieselbe bit-transparente Audio-Telemetrie, dieselbe latenzfreie DAW-Bridge und denselben Gehörschutz!

---

## 4. Die 4 Säulen der System-Architektur

Das Monorepo ruht strikt auf vier voneinander getrennten, robusten Schichten:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   SÄULE 4: THE BRAIN (MCP & AI GATEWAY)                 │
│   Model Context Protocol (Port 48124) • Gemini 3.8 / Claude 3.7 / Ollama│
│   Tools: propose_mix_adjustment, set_active_skill, learn_plugin, etc. │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ WebSocket / HTTP
┌───────────────────────────────────▼────────────────────────────────────┐
│              SÄULE 2: DESKTOP COMPANION & IPC HUB (TAURI v2)           │
│   Rust Core (Port 48123) • React 18 + Tailwind HUD (Musiker-Interface) │
│   Acoustic Shock Shield (Gehörschutz) • WebSocket Server               │
│   Reference Vault (~/.mixing-buddy/references/)                        │
│   Skill Vault (~/.mixing-buddy/skills/) & Plugin Vault                 │
└──────────────┬──────────────────────────────────────────┬──────────────┘
               │ Native Inter-Process                     │ Latenzfreier
               │ Communication                            │ Audio-Stream
┌──────────────▼─────────────────────────┐  ┌─────────────▼──────────────┐
│  SÄULE 3: THE HANDS (NATIVE BRIDGES)   │  │   SÄULE 1: THE EAR         │
│  Swift Mach-O Binary (logic-ax-bridge) │  │   JUCE 8 / C++20 Plugin    │
│  macOS AXUIElement API (<0.1 ms)       │  │   EBU R128 Dual-Gate Meter │
│  Direkter Zugriff auf Mixer & Plugins  │  │   Streamt 30 fps an 48123  │
└────────────────────────────────────────┘  └────────────────────────────┘
```

1. **Säule 1: Audio-Telemetrie („The Ear“)** (`plugins/meter-audio/`)
   * C++20 / JUCE 8 VST3- und AU-Plugin (`MixingBuddyMeter`).
   * Mischt sich bit-transparent auf den Master-Bus oder Sub-Kanal.
   * Berechnet ITU-R BS.1770-4 / EBU R128 Dual-Gated LUFS, True-Peak mit 4x Oversampling, Stereokorrelation und ein 32-Band FFT-Spektrum.
   * Sendet 30 Mess-Frames pro Sekunde über lokalen WebSocket (Port 48123). Latenz $\le 0.1\text{ ms}$.

2. **Säule 2: Desktop Companion & IPC Hub** (`apps/desktop/`)
   * Ultraleichte Desktop-App auf Basis von Tauri v2 (Rust Backend + React 18 HUD).
   * Verwaltet den Gehörschutz (*Acoustic Shock Shield*), speichert Plugin-Definitionen im persistenten *Vault* und hostet den lokalen Kommunikations-Hub.

3. **Säule 3: Native DAW-Bridges („The Hands“)** (`packages/daw-adapters/`)
   * Kompiliertes Swift Mach-O Binary (`logic-ax-bridge`).
   * Nutzt direkte macOS `ApplicationServices` und die `AXUIElement` Accessibility API.
   * **Kein AppleScript/osascript:** Wo AppleScript 100–300 ms benötigt und die DAW blockieren kann, arbeitet die native Swift-Bridge im Sub-Millisekunden-Bereich ($< 0.1\text{ ms}$).

4. **Säule 4: AI Gateway & Reasoning („The Brain“)** (`packages/ai-engine/` & `packages/mcp-server/`)
   * Orchestriert System-Prompts, Validierungen, Spektral-Kompensationen und tool-basierte Aktionsvorschläge.

---

## 5. Sicherheit, Gehörschutz & Vertrauen

In professionellen Tonstudios wird oft mit hohem Abhörpegel gearbeitet. Ein fehlerhafter KI-Befehl, der einen Fader unkontrolliert auf $+10\text{ dB}$ reißt, könnte teure Studio-Monitore zerstören oder das Gehör des Toningenieurs irreparabel schädigen. 

Deshalb besitzt der Mixing Buddy ein **striktes Sicherheitsfundament**:

1. **Acoustic Shock Shield (Asymmetrischer Lautstärke-Schutz):**
   * **Leiserstellen (Pegelabsenkung $\le 0.0\text{ dB}$):** Immer ohne Einschränkung zulässig.
   * **Lauterdrehen (Pegelanhebung $> 0.0\text{ dB}$):** Physisch im Rust-Core auf maximal **$+3.0\text{ dB}$ pro Einzelschritt** gedeckelt.
2. **6-Sekunden A/B-Listen (Nicht-destruktives Vorhören):**
   * Bei Klick auf *„A/B Listen“* wendet das System die vorgeschlagenen Werte temporär an, startet die DAW-Wiedergabe an der passenden Stelle, zählt 6 Sekunden herunter und **stellt danach garantiert den exakten Ausgangszustand wieder her**.
3. **Granulares Undo & Redo pro Zeile:**
   * Jede einzelne Fader- oder EQ-Änderung innerhalb einer ActionCard kann isoliert rückgängig gemacht oder wiederhergestellt werden.
4. **Schutz der DAW-Automation:**
   * Es werden keine blinden MIDI/MCU-Fader-Befehle gefeuert, die Spuren ungewollt von *Read* auf *Touch* schalten und bestehende Lautstärkeverläufe ruinieren würden.

---

## 6. Der direkte Vergleich

| Kriterium | Traditionelle Mixing-Plugins (z. B. iZotope, FabFilter) | Web-KI (ChatGPT, Claude, Copilot) | **Oszillation Mixing Buddy** |
| :--- | :--- | :--- | :--- |
| **Hört das Projekt live mit?** | Ja (isoliert im eigenen Fenster) | ❌ Nein (völlig taub) | **✅ Ja (30 fps Live-Telemetrie nach EBU R128 & FFT)** |
| **Kennt alle Spuren & Plugins?** | ❌ Nein (sieht nur den eigenen Kanal) | ❌ Nein | **✅ Ja (Live-Inspektion aller Mixer-Kanäle & Inserts)** |
| **Kann DAW-Regler physisch bewegen?** | ❌ Nein (nur eigene Plugin-Regler) | ❌ Nein (nur Text-Ratschläge) | **✅ Ja (native Swift-Bridge, Fader, Pan & Inserts)** |
| **Versteht musikalischen Kontext?** | Teilweise (starre Genre-Presets) | Ja (theoretisch, aber ohne Messwerte) | **✅ Ja (dynamische Zielkorridore + Auto-Detect)** |
| **Gehörschutz (Acoustic Shock Shield)?** | ❌ Nein | ❌ Nicht anwendbar | **✅ Ja (asymmetrischer Max +3 dB Schutz)** |
| **Steuerbar über AI-Agenten (MCP)?** | ❌ Nein | ❌ Nein | **✅ Ja (MCP-Spezifikation 2026 integriert)** |

---

## 7. Fazit: Warum das Projekt so besonders ist

Der **Oszillation Mixing Buddy** ist nicht bloß ein weiteres Plugin und kein theoretisches KI-Spielzeug. Er ist die **erste funktionierende Brücke zwischen kognitiver KI-Intelligenz und der haptischen Realität einer Digital Audio Workstation**.

* Er spart Musikern und Tonmeistern Stunden ermüdender Routinearbeit.
* Er garantiert durch mathematische Messkorridore und Referenz-Matching gleichbleibend hohe Produktionsqualität.
* Er schützt den Menschen im Studio durch strenge Sicherheitsguardrails.
* Und er ist dank seiner **Dual-Core-Architektur** sowohl für den Musiker, der einfach nur Musik machen will, als auch für die modernsten Entwicklungs- und Automations-Agenten der Welt sofort einsatzbereit.
