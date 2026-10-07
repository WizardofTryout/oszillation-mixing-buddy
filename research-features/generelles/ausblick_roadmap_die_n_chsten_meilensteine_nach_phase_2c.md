# AUSBLICK & ROADMAP: DIE NÄCHSTEN MEILENSTEINE NACH PHASE 2C

## 1. Arbeitsweise & Rollenverteilung (Bestätigung)

Die Arbeitsteilung bleibt genau so bestehen:

* **Unsere Rolle (Architektur & technischer Lead):**
  * System-Design, Fehler-Diagnose, Token-Schutz und präzise Kopiervorlagen für Antigravity.
  * Ich generiere keinen Code für dein lokales Repository im Chat, sondern formuliere klare Spezifikationen und Verifikations-Befehle.
* **Antigravitys Rolle (Lokaler Entwickler & Executor):**
  * Liest den Workspace, setzt den Code direkt auf der Festplatte um, führt Linting, Rust-/Tauri-Builds und Signierungen durch und committet auf Git.
* **Vorteil:** Keine doppelten Token-Kosten, kein Code-Wildwuchs und saubere Versionskontrolle.

---

## 2. Erreichter Stand mit Abschluss von Phase 2C

Mit **v0.5.5 (Phase 2C)** ist die **Einzelspur- und Signal-Intelligenz** vollständig abgeschlossen:
1. **Name eindeutig:** Text-Heuristik greift sofort (`Kit` $\rightarrow$ Drums, `Grand` $\rightarrow$ Keys).
2. **Name kryptisch (`Audio 1`, `Loop01`):** Akustische Klassifikation über FFT-Schwerpunkt und Crest-Faktor ordnet das Signal autonom ein.
3. **Signal unklar:** Der Co-Producer stellt keine blinden Vermutungen an, sondern fragt im Chat aktiv über Quick-Chips nach.
4. **Transport & Safety:** Takt-Sprünge, 1-Turn-API-Calls, Fader-Restores und Gehörschutz (`MixingBuddyDev`) arbeiten verlässlich.

---

## 3. Die nächsten 3 Meilensteine

Sobald v0.5.5 verifiziert ist, stehen folgende Meilensteine auf dem Programm:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ NÄCHSTE SCHRITTE                                                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [ Meilenstein 1: Visuelle Maskierungs-Heatmap & Spektrales Matching ]          │
│   ├── Visuelle Kollisions-Anzeige im 32-Band-RTA (z. B. Kick vs. Bass)          │
│   └── Präzises Referenz-Kurven-Overlay im HUD                                   │
│                                                                                 │
│  [ Meilenstein 2: Phase 3 – Multi-Instanz Satelliten-Manager ]                  │
│   ├── Mehrere "The Ear"-Plugins auf verschiedenen Spuren gleichzeitig           │
│   └── Umschalten des Abhörpunkts im HUD per Dropdown ohne DAW-Fensterwechsel    │
│                                                                                 │
│  [ Meilenstein 3: Phase 4 – Multi-DAW Support (Steinberg Nuendo / Cubase) ]     │
│   ├── Aktivierung des daw_detector für Steinberg-Prozesse                       │
│   └── Direkte Steuerung über Steinberg JavaScript MIDI Remote                   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Meilenstein 1: Visuelle Maskierungs-Heatmap & Spektrales Matching (HUD & RTA)
* **Ziel:** Das RTA-Display zeigt dem Musiker nicht nur eine nüchterne Kurve, sondern hebt Problemzonen visuell hervor.
* **Funktionen:**
  * **Kollisions-Färbung:** Überlagern sich Frequenzen zweier Spuren (z. B. Bass und Kick bei 60–120 Hz) oder weicht das Signal stark vom Referenz-Track ab, färben sich die betroffenen 32-Band-Balken dezent bernsteinfarben oder rot.
  * **Referenz-Kurve:** Der geladene Referenz-Track wird als dünne Ziellinie über das Live-Spektrum gelegt.

### Meilenstein 2: Phase 3 – Multi-Instanz Satelliten-Manager (Großprojekt-Skalierung)
* **Ziel:** In Arrangements mit 40+ Spuren muss der Musiker nicht mehr das Plugin von Spur zu Spur verschieben.
* **Funktionen:**
  * Mehrere Instanzen von `MixingBuddyMeter` können gleichzeitig aktiv sein (z. B. auf *Stereo Out*, *Drum Bus* und *Lead Vocal*).
  * Jede Instanz streamt eine eigene `instanceId` und ihren Spurnamen über WebSocket.
  * Im Header des HUDs wählt der Musiker im Dropdown:
    `[ 🎯 Abhörpunkt: Drum Bus ▾ ]`
    $\rightarrow$ RTA, ActionCards und Dialog schalten sofort auf die gewählte Gruppe um.

### Meilenstein 3: Phase 4 – Multi-DAW Integration (Steinberg Nuendo / Cubase)
* **Ziel:** Dieselbe Co-Producer-Logik für Steinberg-Nutzer bereitstellen.
* **Funktionen:**
  * Unser in Rust vorbereiteter MCU- und Dispatcher-Layer greift direkt in Nuendo/Cubase.
  * Da Steinberg keine Fenster-Tricks via Accessibility benötigt, läuft die Parameter-Steuerung über die offizielle MIDI Remote API noch direkter und latenzfreier als in Logic Pro.