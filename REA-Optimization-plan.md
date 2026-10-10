# 📋 REA-Optimization-Plan & Sprint-Roadmap
## Oszillation Mixing Buddy — Übernahme der Studio Buddy REA-Erkenntnisse

**Dokument-Version:** 1.0.0  
**Datum:** 10. Oktober 2026  
**Status:** Genehmigt zur schrittweisen Implementierung  
**Referenz-Dokumentation:** `/Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/Studio-Buddy-ai-demo/`

---

## 1. Executive Summary & Strategische Vision

Die Reverse-Engineering-Analyse (REA) von *Studio Buddy AI* (`com.studiobuddy.companion` v0.5.7) hat das System bis auf Maschinencode-Ebene offengelegt. Oszillation Mixing Buddy ist in seinen Kernbereichen **Säule 1 (The Ear)** und **Säule 4 (The Brain)** bereits weit überlegen (128-Band-FFT mit 30 fps vs. 500 ms HTTP-Polling; offener MCP-Standard Spec 2026 vs. geschlossene Vercel/Supabase-Cloud).

In **Säule 3 (The Hands / DAW Bridge)** liefert die REA jedoch vier essenzielle Hebel, die unsere Stabilität und Kompatibilität auf ein unvergleichliches Niveau heben:

1. **Synergie aus Plugin Vault & `ControlsViewFallback`**: Lösung des 3rd-Party-Plugin-Problems (echte DSP-Parameter statt Fenster-Buttons).
2. **`InputShield` (Kollisionsschutz)**: Transparentes `NSWindow` (Level 8) mit `0x53425544` ('SBUD') Event-Tagging und Not-Aus per Escape-Taste (`0x35`).
3. **Direkter Sidechain-Befehl**: `AXUIElementSetAttributeValue` auf `'Side Chain Source'` vor Menü-Traversierung.
4. **`SpeechVocabularyProvider`**: Dynamische Injizierung von Spurnamen in Apples On-Device Neural Engine (`Speech.framework`) für fehlerfreie Spracherkennung im Tonstudio.

---

## 2. Deep-Dive: Plugin Vault vs. ControlsViewFallback (Ergänzung statt Ersatz)

### Das identifizierte Problem im aktuellen Auto-Profiler
Wie der Screenshot des aktuellen Auto-Profilers beim Scannen von **ChromaVerb** beweist, liefert der reine Scan der Standard-Oberfläche (`Editor`):
- `Schließen`, `Symbolleiste`, `Link`, `Bypass`, `Vergleichen`, `Zurück`, `Weiter`
- ❌ **Keine echten Audio-Parameter** (wie `Attack`, `Size`, `Decay`, `Dry/Wet`), da Custom-UI-Engines (Metal/OpenGL) ihre Regler im `Editor`-Modus vor dem Accessibility-Baum verbergen.

### Die Lösung: Perfekte Symbiose beider Welten

| Komponente | Rolle im Gesamtsystem | Aufgabe |
|---|---|---|
| **Plugin Vault** (`~/.mixing-buddy/plugins/*.json`) | **Persistentes Gedächtnis** | Speichert gecachte Regler-Mappings, kalibrierte Log-Kurven (`rawMin`, `rawMax`, Einheiten) und individuelle Musiker-Präferenzen dauerhaft auf der SSD. Kein wiederholter Scan nötig! |
| **`ControlsViewFallback`** | **Scan- & Erkennungs-Engine** | Schaltet das Plugin-Fenster während des Profilens für 50 ms auf die native Logic-Ansicht **„Steuerung“ (Controls)** um. Apple rendert dort jeden echten DSP-Parameter als linearen Standard-`AXSlider` mit Label. |
| **Auto-Profiler Button** | **Manuelles Einlernen** | Der Musiker kann Plugins gezielt mit optischem Feedback anlernen; die Parameterliste ist nun zu 100 % vollständig. |
| **On-the-Fly Profiler** | **Autonomes Einlernen** | Stößt die KI im Mix auf ein noch unbekanntes Plugin, scannt sie es via Controls-Fallback in < 100 ms im Hintergrund und legt das JSON automatisch im Vault ab (**Zero-Setup-Experience**). |

---

## 3. Detaillierte Sprint-Roadmap

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ SPRINT 5: INPUTSHIELD & KOLLISIONSSCHUTZ (UI-Sicherheit)                       │
│ • Transparentes NSWindow (Level 8)                                              │
│ • CGEventTap mit Escape-Not-Aus (0x35)                                          │
│ • 0x53425544 ('SBUD') Event-Tagging für eigene KI-Klicks                       │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ SPRINT 6: CONTROLSVIEWFALLBACK & PLUGIN VAULT UPGRADE (DSP-Parameter)          │
│ • Umschalt-Logik: Editor ↔ Steuerung (Controls) in LogicAXPlugins.swift         │
│ • Profiler-Upgrade: Auslesen echter DSP-Slider (Attack, Decay, EQ-Freqs, etc.)  │
│ • Automatisches Vault-Caching in ~/.mixing-buddy/plugins/                       │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ SPRINT 7: SCHNELLES SIDECHAIN-ROUTING & SYSTEM-PROMPT REFINEMENT                │
│ • AXUIElementSetAttributeValue auf 'Side Chain Source'                          │
│ • Übernahme der kompakten Änderungsnotation (<vorher> → <nachher>)              │
│ • Bündelung von Mixer-Bulk-Operationen in logic-ax-bridge                       │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ SPRINT 8: ON-DEVICE SPRACHSTEUERUNG (Speech.framework)                          │
│ • Audio-Resampling von Studio-Sampleraten (48/96 kHz) auf 16 kHz                │
│ • SpeechVocabularyProvider: Dynamische Spurnamen-Injektion in Neural Engine    │
│ • Push-to-Talk / Toggle-to-Talk Button im Musiker-HUD                           │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### Sprint 5: InputShield & Notfall-Abbruch (Priorität 1)
*Ziel: Absoluter Schutz vor Mauskollisionen während laufender Automation in Logic Pro.*

* **Aufgabe 5.1:** Implementierung von `ShieldWindow.swift` in `packages/daw-adapters/src/logic/swift/`.
  - Rahmenloses, transparentes `NSWindow` auf `NSWindow.Level = 8` (`.modalPanel`).
  - Geometrie synchronisiert mit dem Logic Pro-Hauptfenster.
  - `setIgnoresMouseEvents(false)` während Automation aktiv ist.
* **Aufgabe 5.2:** Globaler `CGEventTap` für Tastatur-Events.
  - Abfangen von Keycode `0x35` (Escape-Taste).
  - Triggern eines sofortigen Abbruchs (`cancelNotification`) und A/B-Restore aller betroffenen Fader/Regler.
* **Aufgabe 5.3:** Event-Tagging (`0x53425544`).
  - Eigene synthetische `CGEvent`-Klicks der Bridge mit dem User-Data-Flag kennzeichnen, sodass sie den Shield ungehindert passieren.
* **Akzeptanzkriterium:** Klickt der Benutzer wild während eines Fader-Moves, passiert in Logic nichts. Drückt er Escape, bricht die Bridge sofort ab und stellt den Ausgangszustand her.

---

### Sprint 6: `ControlsViewFallback` & Plugin-Vault-Upgrade (Priorität 2)
*Ziel: Vollständige Erfassung aller Audio-DSP-Parameter bei 100 % aller Plugins (ChromaVerb, FabFilter, Waves, UAD).*

* **Aufgabe 6.1:** Views-Umschalter in `LogicAXPlugins.swift`.
  - Auffinden des Umschalt-Popups/Menüs oben links im Plugin-Fenster (`AXPopUpButton` mit Werten "Editor" / "Steuerung").
  - Schnelles Umschalten auf "Steuerung" (Controls).
* **Aufgabe 6.2:** Generischer Parameter-Harvester.
  - Traversierung aller `AXSlider` und zugehörigen `AXStaticText`-Labels in der Controls-Ansicht.
  - Auslesen von Minimum, Maximum, aktuellem Wert und Einheiten-String (`Hz`, `dB`, `%`, `ms`, `s`).
  - Schnelles Zurückschalten auf "Editor".
* **Aufgabe 6.3:** Integration in den Auto-Profiler (`App.tsx` & Rust Backend).
  - Der Profiler speichert die vollständige DSP-Parameterliste in `~/.mixing-buddy/plugins/<plugin_id>.json`.
  - Bei ChromaVerb werden nun `Attack`, `Size`, `Density`, `Decay`, `Dry`, `Wet`, `Predelay` korrekt erfasst.
* **Aufgabe 6.4:** On-the-Fly Vault-Erweiterung.
  - Erkennt die Bridge beim Mixen ein unprofiliertes Plugin, führt sie den 50 ms-Scan autonom im Hintergrund aus.
* **Akzeptanzkriterium:** Beim Klick auf "Plugin anlernen" für ChromaVerb werden alle 8 Klangparameter statt Fenster-Buttons im Scan-Dialog angezeigt.

---

### Sprint 7: Express-Sidechain & System-Prompt-Veredelung (Priorität 3)
*Ziel: Latenzfreie Kompressor-Sidechain-Verdrahtung und schlankere, prägnantere KI-Antworten.*

* **Aufgabe 7.1:** Direkter Sidechain-Attribut-Schreibvorgang.
  - In `LogicAXPlugins.swift` zuerst `AXUIElementSetAttributeValue(pluginElement, "Side Chain Source", targetBusAX)` testen.
  - Erst wenn dieser Aufruf fehlschlägt, auf den bestehenden Menü-Traversierungs-Code zurückfallen.
* **Aufgabe 7.2:** Bulk-Mixer-Befehle in `logic-ax-bridge`.
  - Zusammenfassung mehrerer Fader/Pan-Befehle in einen einzigen Bridge-Aufruf zur Eliminierung von IPC-Overhead.
* **Aufgabe 7.3:** System-Prompt-Optimierung im MCP-Server.
  - Übernahme der strikten Toningenieur-Regeln: Verbot geschwätziger Einleitungen, Notation im kompakten Format:
    ```text
    High Shelf Gain: +10 dB → +4 dB
    Low Cut Frequency: 20 Hz → 80 Hz
    ```
* **Akzeptanzkriterium:** Sidechain-Setzen benötigt unter 100 ms statt 800 ms.

---

### Sprint 8: On-Device Spracherkennung & Studio-Vokabular (Priorität 4)
*Ziel: Freihändiges Diktieren im Studio ohne Cloud-Latenz und mit 100 % Trefferquote bei Spurnamen.*

* **Aufgabe 8.1:** Native `Speech.framework`-Anbindung in Swift/Rust.
  - Nutzung des modernen `SpeechAnalyzer` (macOS 14+) auf der Apple Silicon Neural Engine.
  - Audio-Konverter für Studio-Interfaces: Resampling von 44.1 / 48 / 96 kHz Live-Audio auf 16 kHz Mono.
* **Aufgabe 8.2:** `SpeechVocabularyProvider`.
  - Beim Öffnen des Projekts und bei Spuränderungen werden alle Spurnamen (`Lead Vocals`, `Kick In`, `Snare Top`) und aktiven Plugin-Namen aus Logic ausgelesen und als `contextualStrings` an den Spracherkenner übergeben.
* **Aufgabe 8.3:** Push-to-Talk HUD-Integration.
  - Mikrofon-Icon in der Prompt Console; Diktat streamt in Echtzeit direkt in das Eingabefeld.
* **Akzeptanzkriterium:** Der Musiker sagt *"Senke auf Spur Snare Top die Mitten um zwei dB"* und der Text steht in < 200 ms ohne Tastaturberührung im Chatfeld.

---

## 4. Qualitätsschranken & Architektur-Garantien

1. **LOC-Limit ($\le 3.000$ Zeilen):** Jedes neue Swift- oder Rust-Modul (`ShieldWindow.swift`, `ControlsViewFallback.swift`, `SpeechEngine.swift`) wird als eigenständige Datei angelegt. Vor jedem Commit läuft `./scripts/lint-loc.sh`.
2. **Zero-Regression:** Das bestehende 128-Band-RTA-Streaming (30 fps) und der `safety_guard.rs` (Acoustic Shock Shield) bleiben unangetastet.
3. **Codesign-Pflicht:** Jedes Desktop-Bundle wird nach Ergänzung der Swift-Module zwingend mit `MixingBuddyDev` signiert, um macOS TCC-Accessibility-Rechte dauerhaft zu behalten.
