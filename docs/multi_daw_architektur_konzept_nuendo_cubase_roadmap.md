# Master-Konzept & Architektur-Roadmap: Multi-DAW Integration

**Dokument-Status:** Verbindliche Architektur-Spezifikation (v1.0.0)  
**Ziel-Meilenstein:** Multi-DAW Expansion (Phase 4 / Sprints 7–10)  
**Fokus:** Steinberg Nuendo 12/13 & Cubase 12/13 Integration bei 100 % Zero-Regression für Apple Logic Pro  

---

## 1. Executive Summary & Problemstellung

Im bisherigen Projektverlauf (v0.1.0 bis v0.8.0) lag der primäre Fokus auf **Apple Logic Pro**. Logic Pro bot durch sein strikt geschlossenes Ökosystem (keine offizielle Scripting-API, kein OSC, kein WebSocket-Server) die härteste technologische Herausforderung. Um Millisekunden-Reaktionszeiten und verlässliche Mixer- und Insert-Manipulationen zu erreichen, wurde ein hochspezialisiertes System entwickelt:
- Die native Swift Mach-O Binary [`packages/daw-adapters/bin/logic-ax-bridge`](file:///Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/packages/daw-adapters/bin/logic-ax-bridge) mit direktem macOS `ApplicationServices`/`AXUIElement`-Speicherzugriff.
- Vollständige GUI-Wiederherstellung (Preservation), dynamische Popover-Traversierung für Sidechains, Kanal-Inspector-Auslesung und Automation-Guards.
- Audio-Telemetrie und Session-Recall über das JUCE AudioUnit Plugin.

### Die Herausforderung beim Übergang zu Multi-DAW:
Wenn nun Unterstützung für **Steinberg Nuendo**, **Cubase**, und später **Studio One**, **Ableton Live** oder **Bitwig** integriert wird, besteht die akute Gefahr von:
1. **Regressions-Kollateralschäden:** Durch das Vermischen von Logikpfaden könnten fein abgestimmte Logic-Pro-Spezialbehandlungen (wie Sub-Window-Traversierung oder AX-Slider-Skalierungen) versehentlich aufgeweicht oder zerstört werden.
2. **Kognitiver Überlastung (God-File-Gefahr):** Werden DAW-Verzweigungen (`if (isLogic) ... else if (isNuendo) ...`) direkt in `lib.rs`, `ipc_server.rs` oder `App.tsx` gestreut, explodiert die Code-Komplexität und verletzt die 3.000-LOC-Grenze der *Adaptive Modularity Governance*.
3. **Konzeptionellem Paradigmen-Mismatch:** Steinberg Nuendo steuert man **nicht** über Screen-Scraping oder Accessibility-Pfade, sondern über die moderne, bidirektionale **Steinberg MIDI Remote JavaScript API**, die direkt in der Audio-Engine der DAW läuft.

### Das Kern-Dogma dieses Konzepts:
> **„Das Logic-Pro-Subsystem bleibt unberührt, isoliert und bit-stabil. Jede neue DAW erhält einen autarken Treiber, der denselben standardisierten Vertrag (`DAWDriver`) erfüllt. Der Wechsel zwischen den DAWs erfolgt vollautomatisch zur Laufzeit über einen zentralen `DAWRouter`.“**

---

## 2. Status Quo Analyse: Wo DAW-Kopplung heute existiert

Eine detaillierte Codebase- und AST-Analyse via GitNexus und Code Review Graph offenbart folgende Verteilung der DAW-Logik im Monorepo:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ IST-ZUSTAND v0.8.0                                                                     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  [ Säule 1: Audio-Telemetrie ]         [ Säule 2: Desktop IPC Hub ]                   │
│   • plugins/meter-audio/                 • apps/desktop/src-tauri/src/                 │
│     - Baut VST3 & AU                       - daw_detector.rs: Scannt Nuendo, Cubase,   │
│     - getStateInformation serialisiert       Logic Pro Prozesse (pgrep -x / sysinfo)   │
│       sessionUuid & sessionName            - lib.rs & ipc_server.rs: Direkte Aufrufe   │
│     - STATUS: Bereits Multi-DAW-fähig!       von execute_logic_ax_bridge(...)!         │
│                                            - STATUS: Stark an Logic Pro gekoppelt!     │
│                                                                                        │
│  [ Säule 3: Native DAW-Bridges ]       [ Säule 4: AI & MCP-Server ]                   │
│   • packages/daw-adapters/               • packages/mcp-server/src/handlers.ts         │
│     - types.ts: Definiert DAWDriver        - Ruft DAWDriver oder HTTP-Port 48123 auf   │
│     - logic/LogicProDriver.ts: AX-Bridge   - PluginRegistry: Definiert Channel EQ      │
│     - nuendo/NuendoDriver.ts: Entwurf        und Compressor (Logic-Parameter)          │
│     - STATUS: Abstraktion vorbereitet!     - STATUS: Parameter-Mappings müssen         │
│                                              DAW-agnostisch normalisiert werden!       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Die Schwachstellen der aktuellen Kopplung:
1. **`apps/desktop/src-tauri/src/lib.rs`:**
   In `apply_daw_action`, `set_sidechain`, `inspect_channel_strip` wird `resolve_bridge_binary()` aufgerufen, was fest auf `logic-ax-bridge` verweist. Wenn Nuendo läuft, schlagen diese Befehle fehl oder laufen in unpassende Fallbacks.
2. **`apps/desktop/src-tauri/src/ipc_server.rs`:**
   Die HTTP-Routen `/api/channel-strips` und `/api/plugins/inspect` führen hart `crate::execute_logic_ax_bridge` aus.
3. **`apps/desktop/src/App.tsx`:**
   Enthält an 7 Stellen manuelle Prüfungen wie `const isLogic = activeDaw.toLowerCase().includes('logic')`.

---

## 3. Die Multi-DAW Taxonomie: Wie verschiedene DAWs gesteuert werden

Jede professionelle DAW besitzt eine grundlegend andere Schnittstellen-Philosophie. Ein naiver „One-Size-Fits-All“-Ansatz scheitert in der Praxis.

| DAW | Primäre Steuerungs-Architektur | Latenz | Berechtigungen | Stärken & Besonderheiten |
|---|---|---|---|---|
| **Apple Logic Pro** | **macOS Accessibility (`AXUIElement`) + Virtual MCU** via native Swift Binary | $< 0.1\text{ ms}$ | macOS TCC (Accessibility) | Vollständiger UI-Zugriff auf alle Parameter, Plugin-Fenster & Routing ohne DAW-Modifikation. |
| **Steinberg Nuendo 12/13 & Cubase 12/13** | **Steinberg MIDI Remote API (JavaScript)** + Bidirektionale MIDI/SysEx Bridge | $< 0.5\text{ ms}$ | **Keine TCC nötig!** Rein intern über MIDI. | Native Objekt-API von Steinberg (`midiremote_api`); Zugriff auf Kanal-EQ (Frequency 2), Sends, Pan, Volume (dB), Plugins & Selektion. Cross-Platform (macOS & Windows). |
| **Ableton Live 11/12** | **Live Object Model (LOM)** via Python Remote Script + UDP/OSC (`AbletonOSC`) | $\approx 1\text{–}2\text{ ms}$ | Keine | Direkter Zugriff auf Song-, Track-, Device- und Clip-Hierarchien; JSON-RPC über lokalen UDP-Port. |
| **PreSonus Studio One 6/7** | **Control Link / Dawson Protocol** + PreSonus Extension SDK | $< 1\text{ ms}$ | Keine | Bidirektionale Parameter-Rückmeldung mit exakter dB-/Hz-Skalierung. |
| **Bitwig Studio** | **Bitwig Controller API (Java/JS)** + WebSocket | $< 0.5\text{ ms}$ | Keine | Extrem offenes Modulations- und Controller-System; nativer WebSocket-Stream. |
| **Cockos Reaper** | **ReaScript (Python/Lua)** + Reaper Web Remote API | $< 0.5\text{ ms}$ | Keine | Vollständiger API-Zugriff über lokalen HTTP/WebSocket Server. |

---

## 4. Die Soll-Architektur: Das DAW-Driver-Abstraction-Layer (DDAL)

Um vollständige Entkopplung und absolute Regressionssicherheit zu gewährleisten, führen wir das **DAW-Driver-Abstraction-Layer (DDAL)** ein:

```
                                    +-----------------------------------------+
                                    |        React / Tailwind HUD (App.tsx)   |
                                    |    Status: activeDaw / sessionContext   |
                                    +--------------------+--------------------+
                                                         | Tauri Invoke
                                                         v
+-----------------------------------------------------------------------------------------------------+
│                                   TAURI RUST CORE (apps/desktop/src-tauri)                          │
│                                                                                                     │
│   +─────────────────────────────+                 +─────────────────────────────────────────────+   │
│   │       DAW Detector          │                 │        Audio Telemetry Satellite ("Ear")    │   │
│   │   (Process scan: pgrep)     │                 │   (JUCE VST3/AU Chunk: sessionUuid + Host)  │   │
│   +──────────────┬──────────────+                 +──────────────────────┬──────────────────────+   │
│                  │                                                       │                          │
│                  └───────────────────────┬───────────────────────────────┘                          │
│                                          v                                                          │
│                      +────────────────────────────────────────+                                     │
│                      │         DAW DISPATCHER (Router)        │                                     │
│                      │      (State-Machine: Active DAW)       │                                     │
│                      +───────────────────┬────────────────────+                                     │
│                                          │                                                          │
│                 ┌────────────────────────┴────────────────────────┐                                 │
│                 ▼                                                 ▼                                 │
│   +───────────────────────────+                     +───────────────────────────+                   │
│   │   LogicProAdapter         │                     │   SteinbergNuendoAdapter  │                   │
│   │   (Sub-Process Execution) │                     │   (Virtual MIDI / SysEx)  │                   │
│   +─────────────┬─────────────+                     +─────────────┬─────────────+                   │
+─────────────────┼─────────────────────────────────────────────────┼─────────────────────────────────+
                  │                                                 │
                  v                                                 v
  ┌───────────────────────────────┐                 ┌───────────────────────────────┐
  │   Apple Logic Pro (macOS)     │                 │ Steinberg Nuendo / Cubase     │
  │   • logic-ax-bridge (Swift)   │                 │ • OszillationMixingBuddy.js   │
  │   • Direct AXUIElement        │                 │   (MIDI Remote API Script)    │
  │   • Popover & GUI Preservation│                 │ • Virtual MIDI Port Pair      │
  │   • AudioUnit Meter Plugin    │                 │ • VST3 Meter Plugin           │
  └───────────────────────────────┘                 └───────────────────────────────┘
```

### Die 3 Kernkomponenten des DDAL:

### 1. Physische Host-Erkennung (Dual-Channel Ground-Truth)
Anstatt sich auf ein flüchtiges In-Memory-Flag zu verlassen, bestimmt der `DAWDispatcher` die aktive DAW über zwei orthogonale Quellen:
1. **Kanal A: OS-Prozess-Sensor (`daw_detector.rs`):**
   - Prüft fortlaufend (`pgrep -x "Logic Pro"` vs. `pgrep -x "Nuendo"` vs. `pgrep -x "Cubase"`).
2. **Kanal B: JUCE Plugin-Host-Telemetrie:**
   - Wenn das Meter-Plugin in der DAW instanziiert wird, ermittelt JUCE über `juce::PluginHostType` exakt den Host (`hostType.isNuendo()`, `hostType.isLogic()`, `hostType.isCubase()`).
   - Das Plugin meldet das Host-Flag im ersten Frame an Port 48123:
     `{"type":"project_context_sync", "dawHost":"Nuendo 13", "sessionUuid":"..."}`.
- **Ergebnis:** Der Dispatcher schaltet vollautomatisch und verzögerungsfrei auf den richtigen Treiber um, sobald ein Projekt in einer DAW geöffnet wird!

---

### 2. Der unantastbare Treiber-Kontrakt (`packages/daw-adapters/src/types.ts`)

Jeder DAW-Treiber implementiert dieselben Methoden. Weder das Frontend noch der AI-Reasoning-Core müssen wissen, *wie* eine DAW den Befehl intern umsetzt:

```typescript
export interface DAWDriver {
  readonly dawName: SupportedDAW; // 'logic_pro' | 'nuendo' | 'cubase' | 'studio_one' | 'ableton_live'
  readonly isConnected: boolean;

  connect(): Promise<boolean>;
  disconnect(): Promise<void>;

  // --- Mixer & Channel Strip Steuerung ---
  getTrackList(): Promise<TrackDescriptor[]>;
  setTrackVolume(trackId: string, volumeDb: number): Promise<void>;
  setTrackPan(trackId: string, pan: number): Promise<void>;
  setTrackMute(trackId: string, muted: boolean): Promise<void>;
  setTrackSolo(trackId: string, solo: boolean): Promise<void>;

  // --- Insert Plugins & Parameter ---
  inspectPluginSlot(trackId: string, slotIndex: number): Promise<PluginMetadata | null>;
  setPluginParameter(
    trackId: string,
    slotIndex: number,
    paramName: string,
    targetValue: number,
    unit?: string
  ): Promise<void>;
  togglePluginBypass(trackId: string, slotIndex: number): Promise<boolean>;

  // --- Routing (Sends & Sidechain) ---
  routeSend?(trackId: string, sendIndex: number, busName: string, gainDb: number): Promise<void>;
  routeSidechain?(targetTrackId: string, slotIndex: number, sourceTrackName: string): Promise<void>;

  // --- Transport & Auditioning ---
  playRegion(startBar: number, endBar: number): Promise<void>;
  locateBar(bar: number): Promise<void>;
  play(): Promise<void>;
  stop(): Promise<void>;
}
```

---

### 3. Treiber-Isolierung (Lane-Isolation-Modell)

Um **Zero-Regression** für Logic Pro zu garantieren, werden die Treiber in vollständig getrennten Modulen geführt:

```
packages/daw-adapters/
├── src/
│   ├── types.ts                     # Gemeinsamer DAWDriver Kontrakt
│   ├── index.ts                     # Factory & Dispatcher
│   ├── common/                      # Geteilte Hilfsfunktionen & Normalisierung
│   │   ├── ParameterNormalizer.ts   # Skaliert 0.0-1.0 auf echte Einheiten (dB, Hz, ms)
│   │   └── GenericPluginMap.ts      # Standardisierte EQ- & Kompressor-Typen
│   ├── logic/                       # 🛑 ISOLIERTE ZONE 1: APPLE LOGIC PRO
│   │   ├── LogicProDriver.ts        # Orchestriert Swift Sidecar
│   │   ├── macos_ax_client.ts       # macOS Accessibility
│   │   ├── transformers.ts          # Logic-spezifische Koordinaten & Slider-Deltas
│   │   ├── PluginRegistry.ts        # Channel EQ, Vintage Compressor
│   │   └── swift/                   # Swift Mach-O Quellcode
│   │       ├── LogicAXBridge.swift
│   │       ├── LogicAXInspect.swift
│   │       ├── LogicAXPlugin.swift
│   │       └── LogicAXSidechain.swift
│   └── nuendo/                      # 🆕 ISOLIERTE ZONE 2: STEINBERG NUENDO & CUBASE
│       ├── NuendoDriver.ts          # Bidirektionaler MIDI/SysEx Orchestrator
│       ├── SteinbergMidiRemote.ts   # Virtuelle MIDI-Port-Kommunikation
│       ├── NuendoPluginMap.ts       # Frequency 2, StudioEQ, Compressor
│       └── scripts/                 # Steinberg MIDI Remote API Scripts (JavaScript)
│           └── Oszillation_MixingBuddy.js
```

---

## 5. Steinberg Nuendo & Cubase: Technische Realisierung im Detail

### 1. Wie Steinberg MIDI Remote funktioniert
Seit Cubase 12 und Nuendo 12 bietet Steinberg eine offene JavaScript-basierte Remote-API:
- Ein Skript namens `Oszillation_MixingBuddy.js` wird im Steinberg-Benutzerordner platziert:
  `~/Documents/Steinberg/Nuendo/MIDI Remote/Driver Scripts/Local/Oszillation/MixingBuddy/` (macOS)
  bzw. `%USERPROFILE%\Documents\Steinberg\Nuendo\MIDI Remote\Driver Scripts\Local\Oszillation\MixingBuddy\` (Windows).
- Beim Start bindet Nuendo dieses Skript an ein virtuelles MIDI-Port-Paar (`MixingBuddy In` / `MixingBuddy Out`).
- Das Skript nutzt die globale Steinberg-API `midiremote_api`:
  ```javascript
  // Steinberg MIDI Remote Driver Definition
  var midiremote_api = require('midiremote_api');
  var deviceDriver = midiremote_api.makeDeviceDriver('Oszillation', 'Mixing Buddy', 'Matthias Koehler');
  var midiInput = deviceDriver.mPorts.makeMidiInput();
  var midiOutput = deviceDriver.mPorts.makeMidiOutput();
  ```

### 2. Was Nuendo nativ exponiert (ohne Bildschirmerkennung!):
1. **Mixer Console:**
   - Volume Fader (mit exaktem dB-Wert Rückmeldung).
   - Pan (Stereo Panner / Balance Panner).
   - Mute, Solo, Record Arm, Listen (AFL/PFL).
2. **Channel EQ:**
   - Steinberg bindet den Kanal-EQ direkt an Remote-Objekte: Band 1–4 Frequenz, Gain, Q, Bypass und Filtertypen!
3. **Insert Slots & VST3 Parameter:**
   - Focused Quick Controls oder Insert Parameter Bänke erlauben es, bis zu 16 VST3-Parameter direkt per CC oder SysEx anzusprechen und zu lesen.
4. **Transport & Marker:**
   - Position in Bars/Beats, Cycle-Bereich (Left/Right Locator), Play, Stop, Punch-In.

### 3. Das Kommunikations-Protokoll zwischen Mixing Buddy & Nuendo:
- Zur Übertragung strukturierter Daten (z. B. Spurlisten, Plugin-Namen und mehrstufige Parameter-Werte) wird eine schlanke **JSON-over-SysEx**-Nachricht verwendet:
  - Header: `F0 7D (Universal Educational/Experimental) 4F 4D 42 (OMB)`
  - Payload: UTF-8 JSON String (Base64 oder gepackt)
  - Terminator: `F7`
- Für latenzkritische kontinuierliche Fader- und Pan-Änderungen: Standard 14-Bit MIDI CC (NRPN / High-Res Control Change) mit $< 0.2\text{ ms}$ Latenz.

---

## 6. Plugin-Parameter-Normalisierung (Mapping-Architektur)

Ein Kernproblem im Multi-DAW-Betrieb ist die unterschiedliche Benennung und Struktur von Standard-Werkzeugen. Die AI Engine darf keine DAW-spezifischen Parameternamen hardcodieren müssen.

### Die Canonical Parameter Representation (CPR):
Die AI schlägt immer standardisierte Aktionen vor:

```json
{
  "category": "eq",
  "trackName": "Lead Vocal",
  "parameter": "band_3_gain",
  "value": -2.5,
  "unit": "dB"
}
```

Die Normalisierungs-Schicht übersetzt dies automatisch für die jeweilige Ziel-DAW:

```
                            [ AI PROPOSAL: EQ Band 3 Cut -2.5 dB ]
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
          [ LogicProAdapter ]                             [ NuendoAdapter ]
   • Plugin: Channel EQ                             • Plugin: Frequency 2 oder Channel EQ
   • AX-Pfad: Plugin Window -> Slider "Gain 3"      • MIDI Remote: hostTrack.mChannelEQ.mBand3.mGain
   • Skalierung: -2.5 dB                            • Skalierung: 0.354 (normalisiert auf 0..1)
   • Übertragung: AXUIElementSetValue               • Übertragung: SysEx / NRPN CC #103
```

### Parameter-Mapping Matrix der DAW-Stock-Plugins:

| Funktion | Canonical ID | Apple Logic Pro (Channel EQ / Comp) | Steinberg Nuendo (Frequency 2 / Compressor) |
|---|---|---|---|
| **Low-Cut / HPF** | `hp_filter_freq` | `Highpass Frequency` (Hz) | `Band 1: Low Cut Frequency` (Hz) |
| **Low Shelf Gain** | `low_shelf_gain` | `Low Shelf Gain` (dB) | `Band 2: Gain` (dB) |
| **Mid Bell Freq** | `mid_freq` | `Bell 1 Frequency` (Hz) | `Band 4: Frequency` (Hz) |
| **Mid Bell Gain** | `mid_gain` | `Bell 1 Gain` (dB) | `Band 4: Gain` (dB) |
| **High Shelf Gain**| `high_shelf_gain`| `High Shelf Gain` (dB) | `Band 7: High Shelf Gain` (dB) |
| **Comp Threshold** | `comp_threshold` | `Threshold` (dB) | `Threshold` (dB) |
| **Comp Ratio** | `comp_ratio` | `Ratio` (z. B. 4:1) | `Ratio` (1.0 : 1 bis 8.0 : 1) |
| **Comp Attack** | `comp_attack` | `Attack` (ms) | `Attack` (ms) |
| **Comp Release** | `comp_release` | `Release` (ms) | `Release` (ms) |

---

## 7. Zero-Regression Schutz-Mechanismen für Logic Pro

Damit die bestehende Stabilität von Logic Pro zu 100 % erhalten bleibt, gelten folgende Implementierungs-Garantien:

1. **Keine Änderungen an `LogicProDriver.ts`, `macos_ax_client.ts` oder `LogicAX*.swift`:**
   Die Swift Mach-O Binary und ihre TypeScript-Wrapper werden als *versiegelte Module* behandelt. Anpassungen finden ausschließlich in Adaptern oder Dispatchern statt.
2. **Feature-Flagging & Dynamisches Routing:**
   Im Rust-Backend (`apps/desktop/src-tauri/`):
   ```rust
   match active_daw {
       DetectedDAW::LogicPro => {
           // 100 % unveränderter, bewährter Ausführungspfad via logic-ax-bridge
           execute_logic_ax_bridge(&bridge_path, &args)
       },
       DetectedDAW::Nuendo | DetectedDAW::Cubase => {
           // Neuer, autarker Steinberg-Ausführungspfad
           execute_steinberg_remote(&nuendo_client, &args)
       },
       DetectedDAW::None => {
           Err("Keine unterstützte DAW aktiv".to_string())
       }
   }
   ```
3. **Physische Ground-Truth vor Vermutungen:**
   Wenn sowohl Logic Pro als auch Nuendo auf demselben Rechner laufen, priorisiert das System die DAW, von der das JUCE Meter-Plugin aktuell Audio-Telemetrie streamt.
4. **Automatisierte E2E-Regressionstests:**
   Vor jedem Meilenstein-Merge wird der bestehende Test `scripts/test-e2e-closed-loop.ts` gegen Logic Pro ausgeführt, um sicherzustellen, dass Latenzen, Popover-Handling und Gehörschutz unverändert funktionieren.

---

## 8. Phasen-Roadmap zur Umsetzung (Sprints 7 bis 10)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ROADMAP: MULTI-DAW EXPANSION                                                           │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  [ SPRINT 7: DDAL Core & Architecture Decoupling ]                                     │
│   • Erstellung des Rust-seitigen `daw_dispatcher.rs` im Desktop Companion              │
│   • Umleitung der Tauri Commands von harten Logic-Aufrufen auf den Dispatcher          │
│   • 100 % Regressionsprüfung: Logic Pro muss unverändert funktionieren                 │
│                                                                                        │
│  [ SPRINT 8: Steinberg MIDI Remote Driver & Virtual Port Engine ]                      │
│   • Implementierung des JS-Drivers `Oszillation_MixingBuddy.js` für Nuendo             │
│   • Einrichtung der virtuellen MIDI-Ports (CoreMIDI auf macOS, midir auf Win)          │
│   • Anbindung von Volume, Pan, Mute, Solo und Transport an Nuendo 12/13                │
│                                                                                        │
│  [ SPRINT 9: Nuendo Stock Plugins & Parameter-Normalisierung ]                         │
│   • Mapping für Nuendo Channel EQ, Frequency 2 und Steinberg Compressor               │
│   • Test der Action-Card-Ausführung direkt in Nuendo Insert-Slots                      │
│                                                                                        │
│  [ SPRINT 10: Multi-DAW HUD & Nahtloses Switching ]                                   │
│   • Live-Status im HUD: Anzeige von Nuendo/Cubase inkl. VST3-Satelliten-Indikation     │
│   • Nahtloser Heiß-Wechsel: Wechsel von Logic-Projekt zu Nuendo-Projekt ohne Neustart  │
│   • Verifikations-Release v0.9.0                                                       │
│                                                                                        │
│  [ SPRINT 11+: Ableton Live & Studio One ]                                             │
│   • Anbindung von AbletonOSC (Python LOM) und PreSonus Control Link                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Zusammenfassung & Nächste Schritte

Mit dieser Architektur wird das Dilemma zwischen **„Wachstum zu Multi-DAW“** und **„Schutz der Logic-Pro-Stabilität“** vollständig aufgelöst:
1. **Logic Pro bleibt unberührt und sicher:** Kein einziger funktionierender Swift- oder AX-Pfade wird modifiziert.
2. **Nuendo erhält eine native Spitzenlösung:** Durch die Nutzung der Steinberg MIDI Remote API arbeitet der Buddy in Nuendo noch schneller, stabiler und plattformunabhängiger als über Screen-Scraping.
3. **Der Code bleibt schlank und wartbar:** Jeder Adapter residiert in seinem eigenen Modul ($\le 600\text{ LOC}$), voll im Einklang mit der *Adaptive Modularity Governance*.

*Dokument bereit für den Start von Sprint 7 (DDAL Core & Architecture Decoupling).*
