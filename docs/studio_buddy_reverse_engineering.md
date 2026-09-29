# Studio Buddy — Reverse Engineering Analyse
## Ableitung der korrekten Logic Pro Integrations-Architektur für Oszillation Mixing Buddy

> **Zweck dieses Dokuments:** Studio Buddy v0.5.7 (`com.studiobuddy.companion`) ist eine fertig funktionierende Implementierung genau dessen, was wir mit Oszillation Mixing Buddy bauen. Diese Analyse extrahiert die Methoden, die Datenpfade und die exakten Mechanismen, die funktionieren – als verbindliche Referenz für unsere eigene Implementierung.

---

## 1. App-Architektur — Überblick

```
┌─────────────────────────────────────────────────────┐
│              Studio Buddy.app (Swift/AppKit)         │
│                                                      │
│  ┌─────────────────┐    ┌─────────────────────────┐  │
│  │  Chat UI        │    │  Logic Pro Driver       │  │
│  │  (SwiftUI)      │◄───│  (NSAccessibility API)  │  │
│  └─────────────────┘    └──────────┬──────────────┘  │
│                                    │                  │
│  ┌─────────────────┐    ┌──────────▼──────────────┐  │
│  │  AI Agent       │    │  Studio Buddy AU Plugin  │  │
│  │  (OpenAI / LLM) │◄───│  (Audio Unit — In-DAW)  │  │
│  └─────────────────┘    └──────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Kernprinzip:** Studio Buddy ist eine **Native macOS SwiftUI App** (kein Electron, kein Tauri, kein Web). Sie nutzt direkt die `NSAccessibility`-API (AXUIElement) aus Swift heraus, **ohne jeglichen osascript-Umweg**.

---

## 2. Der entscheidende Mechanismus: Das Audio Unit Plugin

### 2.1 Dual-Channel-Architektur

| Kanal | Methode | Zweck |
|-------|---------|-------|
| **Primär** | Eigenes **Audio Unit (AU) Plugin** | Echtzeit-Audiodaten (LUFS, Spektrum, Width, Phase) |
| **Sekundär** | **AXUIElement Accessibility API** | Track-/Plugin-Kontrolle (Lesen + Schreiben) |

Das **AU Plugin** (`Studio Buddy`) wird vom User **manuell** in die Inserts einer Logic-Spur gelegt. Es fungiert als Live-Metering-Tap und streamt die Audiodaten an die Companion-App.

```
Logic Pro Insert Chain:
[Channel EQ] → [Compressor] → [Studio Buddy AU ← tap] → Stereo Out
                                       │
                                 IPC (Mach Port /
                                  Local Socket)
                                       │
                              Studio Buddy.app
                            (LUFS, Spektrum, Crest,
                             Width, Phase Correlation)
```

### 2.2 Der Plugin Stream

Das Plugin streamt **ca. alle 500ms** folgende Metriken pro Spur:
- `shortTermLufs` / `momentaryLufs`
- `peakDb` / `rmsDb` / `headroomDb` / `crestDb`
- Spektrale Band-Ratios: `subBandRatio`, `bassBandRatio`, `lowMidBandRatio`, `hiMidBandRatio`, `airBandRatio`
- `spectralTiltDb`
- `stereoWidth`
- `phaseCorrelation`

Der Stream erscheint intern im Kontext als:
```
[INTERNAL — Studio Buddy plugin stream, NOT pasted by the user.]
```

---

## 3. Die AX-Accessibility-Methoden (Kern der Logic-Integration)

### 3.1 Was Studio Buddy wirklich nutzt

Das Binary enthält folgende AX-Schlüssel direkt:

```
AXRole, AXValue, AXValueDescription, AXUIElement, AXPopUpButton,
AXMenuButton, AXMenuItem, AXDisclosureTriangle, AXElementIndex,
AXHorizontalOrientation, AXFocusedUIElement, AXPress
```

**Kritisch:** Studio Buddy nutzt **keinen AppleScript-Umweg**. Es kommuniziert **direkt mit der AXUIElement C-API** aus Swift (`import Accessibility`). Das ist der Grund, warum es funktioniert, während `osascript`-Ansätze versagen.

### 3.2 Das Plugin-Definitions-Schema (ChannelEQ.json / Compressor.json)

**Das ist der eigentliche Schlüssel.** Studio Buddy definiert jeden Logic-Plugin-Parameter in einer JSON-Datei mit exakten AX-Matching-Informationen:

```json
{
  "name": "Channel EQ",
  "parameters": [
    {
      "id": "low_cut_frequency",
      "label": "Low Cut Frequency",
      "type": "continuous",
      "unit": "Hz",
      "displayMin": 20, "displayMax": 20000,
      "rawMin": 0, "rawMax": 1100,
      "curve": "logarithmic",
      "editorAX": {
        "role": "AXSlider",
        "title": "Low Cut Frequency"
      }
    }
  ]
}
```

#### Matching-Strategien (aus ChannelEQ.json + Compressor.json):

| Strategie | Felder | Einsatz |
|-----------|--------|---------|
| **By Title** | `"title": "Low Cut Frequency"` | Channel EQ — alle Bänder |
| **By NS-Identifier** | `"identifier": "_NS:153"` | Compressor Threshold, Ratio, etc. |
| **By Help-Prefix** | `"helpPrefix": "Threshold knob"` | Compressor Knöpfe (sekundär) |
| **By AXButton Title** | `"role": "AXButton", "title": "ON"` | Toggle-Buttons (Limiter On/Off) |
| **By AXButton Radio** | `"role": "AXButton", "title": "Vintage\\u2028VCA"` | Circuit-Type-Auswahl |

**Der `_NS:153`-Identifikator** ist entscheidend: Studio Buddy sucht AX-Elemente nicht nur nach dem sichtbaren Titel, sondern auch nach dem **internen NS-Identifier**, der im AX-Tree verfügbar ist, auch wenn kein sichtbares Label existiert.

### 3.3 Vollständige Compressor-Parameter-Identifier

Aus `Compressor.json` (exakte `_NS:`-IDs als Goldstandard-Referenz):

```
Threshold:    _NS:153    helpPrefix: "Threshold knob"
Ratio:        _NS:157    helpPrefix: "Ratio knob"
Attack:       _NS:163    helpPrefix: "Attack knob"
Release:      _NS:169    helpPrefix: "Release knob"
Make Up:      _NS:160    helpPrefix: "Make Up knob"
Knee:         _NS:172    helpPrefix: "Knee knob"
Input Gain:   _NS:166    helpPrefix: "Input Gain knob"
Output Gain:  _NS:265    helpPrefix: "Output Gain knob"
Mix:          _NS:216    helpPrefix: "Mix knob"
Lim Thresh:   _NS:222    helpPrefix: "Limiter Threshold knob"
```

### 3.4 Warum Slider im Hauptfenster nicht funktionieren

Logic Pro rendert den Arrange-View (Spurenliste) als **Metal/AppKit-Canvas ohne zugänglichen AX-Tree**. Studio Buddy umgeht das komplett: Es liest Track-Namen **nicht aus dem Hauptfenster**, sondern aus:

1. **Mixer-Fenster AX-Tree** — über `list_tracks`
2. **Plugin-Fenster** (AXDialog/AXFloatingWindow) — für Parameter-Lesen/Schreiben

Das Binary selbst dokumentiert das:
```
"No single window holds every named track; still outside it: "
```

---

## 4. Die Tool-Architektur (vollständige Tool-Liste aus Binary)

### Read-Tools
| Tool | Funktion |
|------|----------|
| `list_tracks` | Alle Spuren inkl. Folder-Struktur, Mute/Solo |
| `get_track_details` | Plugin-Chain-Namen, Sends, Pan, Volume |
| `get_plugin_parameters` | Alle lesbaren Parameter eines Plugins via AX |
| `get_arrangement` | Regionsspannen, Song-Sections, Playhead |
| `get_audio_analysis` | LUFS/Spektrum aus AU Plugin Stream |
| `list_installed_plugins` | Alle installierten Plugins |
| `study_track` | Chain-Analyse ohne Live-Audio |

### Write-Tools (DAW-Kontrolle via AX)
| Tool | Funktion |
|------|----------|
| `set_plugin_parameter` | Einen Plugin-Parameter setzen |
| `set_plugin_parameters` | Mehrere Parameter in einem Aufruf |
| `set_plugin_bypass` | Plugin Ein-/Ausschalten |
| `set_plugin_sidechain` | Sidechain-Quelle setzen |
| `set_track_volume` | Fader-Wert setzen (in dB, `"-6db"`) |
| `set_track_pan` | Pan setzen |
| `set_track_mute` / `set_track_solo` | Mute/Solo |
| `set_send_level` | Send-Pegel (delta_db ODER target_db) |
| `set_folder_expanded` | Folder-Track aufklappen |
| `add_plugin` | Plugin an Slot-Index einfügen |
| `remove_plugin` | Plugin entfernen |
| `reorder_plugin` | Plugin-Reihenfolge ändern (kein Re-Add!) |
| `rename_track` | Spur umbenennen |

### Audio-Tools
| Tool | Funktion |
|------|----------|
| `listen_to_playback` | Playback + AU Plugin Audio-Erfassung |

### Bus/Master
| Tool | Funktion |
|------|----------|
| `ensure_bus_track` | Bus-Aux-Spur in Arrange-Liste exposen |
| `ensure_master_track` | Stereo Out als Track verfügbar machen |

### AI/Agent
| Tool | Funktion |
|------|----------|
| `respond` | EINZIGER Output-Kanal (prose + visual) |
| `update_user` | Mid-Turn Status-Bubble |
| `remember` / `forget` | Cross-Turn-Memory (4 Scopes) |
| `update_song_brief` | Song-Kontext speichern |
| `update_track_description` | Track-Kontext speichern |

---

## 5. Der exakte Ablauf: Von Track-Name zu Plugin-Parameter

```
1. list_tracks()
   └─► AXUIElement(Logic Pro) → Mixer-Fenster → AXGroup → AXStaticText
       → Gibt: ["Simple Foundation", "Stereo Out", ...]

2. get_track_details(track_names: ["Simple Foundation"])
   └─► Öffnet/fokussiert Plugin-Fenster in Logic
       → { plugins: ["Channel EQ", "Compressor"], pan: 0, volume: -6 }

3. get_plugin_parameters("Simple Foundation", "Channel EQ")
   └─► Lookup: ChannelEQ.json → editorAX-Spec für "Low Cut Frequency"
       AX: sucht AXSlider mit title="Low Cut Frequency" (rekursiv!)
       AXValue lesen → rawValue = 523
       Transform: displayValue = 20 * (20000/20)^(523/1100) = ~440 Hz
       → { id: "low_cut_frequency", rawValue: 523, displayValue: "440 Hz" }

4. set_plugin_parameter("Simple Foundation", "Channel EQ",
                        "low_cut_frequency", "200 Hz")
   └─► Inverser Transform: rawValue = 1100 * log(200/20) / log(20000/20) = ~369
       AX: set AXValue of AXSlider where title="Low Cut Frequency" to 369
```

### Raw-zu-Display-Transforms

**Logarithmisch** (Frequenzen, Ratios):
```
displayValue = displayMin × (displayMax/displayMin)^(rawValue/rawMax)
Inverse: rawValue = rawMax × log(display/displayMin) / log(displayMax/displayMin)
```

**Linear** (Gains in dB, Prozent):
```
displayValue = displayMin + (displayMax - displayMin) × (rawValue / rawMax)
Inverse: rawValue = rawMax × (display - displayMin) / (displayMax - displayMin)
```

**Curve Table** (Attack des Compressors — piecewise linear):
```json
"curveTable": [
  { "raw": 0,   "display": 0 },
  { "raw": 11,  "display": 5 },
  { "raw": 56,  "display": 50 },
  { "raw": 100, "display": 200 }
]
```
→ Interpolation zwischen den Stützpunkten

---

## 6. Warum `every slider of window` in osascript versagt

Studio Buddy nutzt **nicht** `every slider of window` (flache Suche). Es nutzt die AXUIElement-C-API mit **Tiefensuche durch alle AXGroup-Container**:

```swift
// Pseudocode der tatsächlichen Implementierung
func findElement(in element: AXUIElement,
                 role: String,
                 title: String? = nil,
                 identifier: String? = nil,
                 helpPrefix: String? = nil) -> AXUIElement? {
    // 1. Check self
    guard element.role == role else { goto children }
    if let t = title, element.title != t { goto children }
    if let id = identifier, element.identifier != id { goto children }
    if let hp = helpPrefix, !element.help.hasPrefix(hp) { goto children }
    return element  // ← Match!
    
    // 2. Recurse
    children:
    for child in element.children ?? [] {
        if let found = findElement(in: child, role: role, title: title,
                                   identifier: identifier, helpPrefix: helpPrefix) {
            return found
        }
    }
    return nil
}
```

Logic Pro Plugin-Fenster verschachteln Sliders in: `AXWindow → AXGroup → AXGroup → AXGroup → AXSlider`. Die osascript-Funktion `every slider of window` findet nur direkte Kinder — daher gibt sie immer ein leeres Array zurück.

---

## 7. `listen_to_playback` — Implementierungsablauf

```
listen_to_playback(start_bar: 17, duration_seconds: 8, tracks: "Simple Foundation")

1. Falls Studio Buddy Plugin noch nicht auf der Spur:
   add_plugin("Studio Buddy", slot: -1)  ← via AX

2. Logic Playhead auf Bar 17 setzen
   AX: set AXValue of transport position field

3. Logic Play starten
   AX: AXPress on Play-Button im Transport

4. AU Plugin streamt Audiodaten via Mach-Port/Local Socket:
   500ms-Intervall → LUFS, Spektrum, Width, Phase

5. Nach 8 Sekunden: Logic Stop
   AX: AXPress on Stop-Button

6. Playhead-Position restaurieren
7. Studio Buddy Plugin-Daten aggregieren → return AnalysisResult
```

**Konsequenz:** Echter Audio-Analyse-Pfad erfordert ein eigenes **Audio Unit Plugin** das wir in Xcode bauen müssen.

---

## 8. `writePrereq` — Conditional Parameter Writes

Der Compressor hat Panel-abhängige Parameter:

```json
{
  "id": "output_gain",
  "writePrereq": { "parameterId": "right_panel_view", "option": "output" }
}
```

Das bedeutet: Bevor `output_gain` gesetzt werden kann, muss der `Output`-Button geklickt sein (Panel auf `output` schalten). Studio Buddy erledigt das automatisch vor dem eigentlichen Write.

Gleiches gilt für Side-Chain-Parameter: erst `right_panel_view` auf `side_chain` schalten.

---

## 9. Das AI-Agent-Modell

### Einziger Antwort-Kanal: `respond`

```
Jeder Turn MUSS mit GENAU EINEM `respond`-Aufruf enden.
- prose (required): 1-3 Sätze, casual, kein Markdown-Overhead
- visual (optional): { type, tracks, metric }
```

### Visual-Typen
| Type | Wann |
|------|------|
| `stereo_field` | Width / Mono-Kompatibilität |
| `freq_curve` | Einzelspur-Ton |
| `freq_compare` | Masking zwischen Spuren |
| `levels_compare` | Lautstärke-Balance |
| `before_after` | Nach einer Änderung (braucht 2 listens!) |

### Memory-System (4 Scopes)
```
master   — Benutzer-Präferenzen, projektübergreifend
song     — Aktuelles Logic-Projekt-Kontext
plugin   — Plugin-spezifische Regeln
track    — Track-spezifische Entscheidungen
```

---

## 10. Permissions-Analyse

Aus `Info.plist` (v0.5.7):
```xml
<key>NSMicrophoneUsageDescription</key>  ← Voice Input
<key>NSSpeechRecognitionUsageDescription</key>  ← STT

FEHLT: NSAppleEventsUsageDescription
```

Kein AppleScript. Accessibility über Standard-AX-Berechtigung (Systemeinstellungen → Datenschutz → Bedienungshilfen).

---

## 11. Implementierungsplan für Oszillation Mixing Buddy

### Phase 1: Plugin-Datenbank (2-3 Tage)

Verzeichnis anlegen:
```
packages/daw-adapters/src/logic/plugins/
  ChannelEQ.json       ← Von Studio Buddy kopieren ✅
  Compressor.json      ← Von Studio Buddy kopieren ✅
  ChromaGlow.json      ← Per AX-Scan erstellen
  Limiter.json         ← Per AX-Scan erstellen
  PhatFX.json
  BassAmp.json
  GraphEQ.json
  Multipressor.json
  SpaceDesigner.json
```

### Phase 2: Swift AX-Sidecar (3-5 Tage)

```
apps/desktop/src-swift/LogicAXBridge/
  Sources/
    main.swift          ← JSON I/O via stdin/stdout
    AXClient.swift      ← AXUIElement native queries
    PluginManager.swift ← Plugin-JSON laden + resolven
    Transformer.swift   ← Raw ↔ Display Umrechnung
  Package.swift
```

Protokoll (stdin/stdout JSON-Lines):
```jsonc
// Request
{"cmd": "list_tracks"}
{"cmd": "get_plugin_parameters", "track": "Simple Foundation", "plugin": "Channel EQ"}
{"cmd": "set_plugin_parameter", "track": "...", "plugin": "...", "paramId": "...", "rawValue": 400}

// Response
{"ok": true, "tracks": [...]}
{"ok": true, "parameters": [...]}
{"ok": true, "newRawValue": 400}
```

### Phase 3: MCP-Server erweitern (1-2 Tage)

```typescript
// tools.ts — neue/erweiterte Tools
mcp__get_plugin_parameters(track, plugin)
  → calls Swift sidecar → returns PluginParameter[]

mcp__execute_mix_adjustment(trackName, plugin, paramId, displayValue)
  → transform displayValue → rawValue
  → calls Swift sidecar → AX write
```

### Phase 4: Audio Unit Plugin (für Live-Audio-Analyse)

```
apps/desktop/StudioBuddyMeter/   ← AUv3 Audio Unit
  StudioBuddyMeter.swift          ← Audio-Analyse, Mach-Port IPC
  Info.plist                      ← AudioComponent-Registration
```

---

## 12. Kritische Erkenntnisse — Zusammenfassung

| Befund | Konsequenz |
|--------|------------|
| `osascript` für Plugin-Parameter schlägt fehl | Swift/C AXUIElement ist **Pflicht** |
| Hauptfenster-Canvas ist nicht zugänglich | Nur **Mixer + Plugin-Fenster** per AX |
| Slider sitzen tief in AXGroup-Trees | **Rekursive** Suche, keine flache API |
| Jedes Plugin braucht eine AX-Spec-Datei | Plugin-JSON-Datenbank erstellen |
| Raw ↔ Display braucht Kurven-Transformation | log/linear/curveTable implementieren |
| AU Plugin für Echtzeitaudio nötig | Separate Xcode-Komponente |
| `_NS:123` als primärer Identifier | Immer als erste Matching-Option, vor `title` |
| `writePrereq` für Panel-abhängige Parameter | UI-State vor Writes setzen |
| MCU liefert abgekürzte Spurnamen | Full-Name-Reconciliation mit Mixer-AX nötig |

---

*Analyse: 2026-09-29 | Quelle: Studio Buddy v0.5.7 (com.studiobuddy.companion, Build 64)*
*Analysierte Dateien: ChannelEQ.json (323 Zeilen), Compressor.json (253 Zeilen), SystemPrompt.md (464 Zeilen), Binary strings*
