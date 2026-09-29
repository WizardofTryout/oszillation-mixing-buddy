# Studio Buddy vs. Oszillation Mixing Buddy: Deep-Dive & Strategieplan

Die Reverse-Engineering-Analyse von **Studio Buddy v0.5.7** ist eine unschätzbare Goldgrube. Sie liefert den endgültigen Beweis, dass unsere bisherigen Diagnosen zu 100 % zutreffend waren – und zeigt uns schwarz auf weiß, wie die Entwickler von Studio Buddy genau die Hürden gelöst haben, an denen Antigravity mit AppleScript hängengeblieben ist.

---

## 1. Die große Bestätigung: Warum Antigravity scheitern musste

Das Dokument enthüllt zwei fundamentale Wahrheiten über Logic Pro, die unsere Terminal-Experimente exakt widerspiegeln:

1. **Die Spurliste im Hauptfenster ist auch für Studio Buddy unerreichbar:**  
   Im Binärcode von Studio Buddy steht wörtlich:  
   > `„No single window holds every named track; still outside it: “`  
   Die Entwickler sind an derselben Metal-Canvas-Wand zerschellt wie wir! Sie lesen die Spurnamen **niemals aus dem Timeline-Arrangierbereich**, sondern ausschließlich aus dem **Mixer-Fenster** (`Fenster ➔ Mixer` / `Cmd + 2`).
2. **`every slider of window` in AppleScript MUSS fehlschlagen:**  
   Logic kapselt Regler in tiefen Hierarchien:  
   `AXWindow ➔ AXGroup ➔ AXGroup ➔ AXGroup ➔ AXSlider`.  
   Applescript-Befehle wie `every slider of window` suchen nur auf Ebene 1 (flach) und finden deshalb prinzipbedingt **0 Regler**.
3. **`osascript` ist zu langsam & fehleranfällig:**  
   Studio Buddy nutzt an keiner einzigen Stelle AppleScript. Jeder Prozessaufruf von `osascript` erzeugt macOS-Prozess-Overhead, TCC-Berechtigungsfehler (`-1719`) und Event-Timeouts. Native Apps nutzen ausschließlich die **C-API `AXUIElement`**.

---

## 2. Wo wir Studio Buddy bereits überlegen sind (Bestandsaufnahme)

Wir müssen das Rad nicht neu erfinden. Wir haben in Sprint 1 bis 4 bereits Komponenten gebaut, die Studio Buddy ebenbürtig oder sogar überlegen sind:

| Komponente | Studio Buddy (v0.5.7) | Oszillation Mixing Buddy (Unser System) | Status |
| :--- | :--- | :--- | :--- |
| **Audio-Telemetrie ("The Ear")** | Eigenes AU-Plugin (`Studio Buddy AU`), streamt alle 500 ms per Socket | Eigenes JUCE C++20 Plugin (`MixingBuddyMeter` AU & VST3), 30 fps, ITU-R BS.1770-4 EBU R128, FFT, Phase | ✅ **Unseres ist schneller & plattformübergreifend (AU + VST3)** |
| **Fader & Mixer-Steuerung** | Reine AX-Inspektion (Fader per UI-Klick schieben) | **Virtuelles MCU (Mackie Control) via CoreMIDI** (14-Bit Pitch Bend, echter SysEx-LCD-Stream) | 🚀 **Unser MCU-Pfad ist latenzfrei, spurgenau und schreibt echte Automationen!** |
| **Automationen aufnehmen** | Nicht nativ (nur statische Werte) | **Natives `Touch`/`Latch` via MCU:** Schreibt während Playback echte Kurven in die Timeline | 🚀 **Wir können echte Automationen!** |
| **KI & Schnittstellen** | Proprietäres geschlossenes UI (nur OpenAI) | **Model Context Protocol (MCP)** für Claude Desktop, Cursor, Gemini + lokales React HUD | 🚀 **Offener Standard für externe Co-Producer** |
| **Plugin-Parameter (EQ / Comp)** | JSON-Specs + native AXUIElement Tiefensuche | Antigravity versuchte flaches AppleScript | ⚠️ **Hier müssen wir die Studio-Buddy-Methode übernehmen!** |

---

## 3. Die 3 goldenen Schlüssel aus Studio Buddy (Die wir übernehmen)

### Schlüssel 1: Native AXUIElement C-API (Kein `osascript` mehr)
Statt Shell-Aufrufe mit `osascript` abzusetzen, greift man direkt auf das macOS `ApplicationServices`-Framework zu (`AXUIElementCopyAttributeValue`, `AXUIElementPerformAction`).
* In Rust (unser Tauri-Backend) geht das nativ über das Crate `accessibility-sys` oder `core-foundation`.
* Alternativ: Ein schlankes Swift-CLI-Sidecar (`LogicAXBridge`), das JSON über `stdin`/`stdout` austauscht.

### Schlüssel 2: Die JSON-Parameter-Datenbank mit `_NS:`-Identifikatoren
Studio Buddy sucht Plugin-Regler nicht blind über deutsche oder englische Namen, sondern nutzt die internen AppKit-Identifikatoren.
* Beim Apple Logic Compressor heißt der Threshold-Regler intern immer `_NS:153` – egal ob Logic auf Deutsch, Englisch oder Japanisch läuft.
* Für jedes Standard-Plugin existiert eine JSON-Definitionsdatei:
  * `ChannelEQ.json`: Bänder 1–8, Frequenzen, Gains, Q-Faktoren.
  * `Compressor.json`: `_NS:153` (Threshold), `_NS:157` (Ratio), `_NS:163` (Attack), etc.

### Schlüssel 3: Raw-to-Display Transformations-Kurven
Ein UI-Schieberegler in macOS hat oft nur ganzzahlige Rasterwerte (z. B. $0$ bis $1100$).
* Wenn die KI sagt: *„Setze Low Cut auf 80 Hz“*, darf man nicht den String `"80 Hz"` in den Slider schreiben.
* Man benötigt die Umrechnungsformel:
  $$\text{rawValue} = \text{rawMax} \times \frac{\log(\text{display} / \text{displayMin})}{\log(\text{displayMax} / \text{displayMin})}$$
* Studio Buddy hat diese Formeln für Logarithmisch (Hz, Ratio), Linear (dB, %) und Tabellen (Piecewise Linear für Attack-Zeiten) fix und fertig spezifiziert.

---

## 4. Die ideale Synthese: Die "Ultimate Hybrid Architecture"

Wir kombinieren das Beste aus beiden Welten:

```
                                [ OSZILLATION MIXING BUDDY ]
                                              │
                     ┌────────────────────────┴────────────────────────┐
                     ▼                                                 ▼
          1. ECHTER MCU-PFAD (CoreMIDI)                     2. NATIVE AX-ENGINE (C-API)
          ─────────────────────────────                     ───────────────────────────
          • Spurnamen & Indizes (SysEx)                     • Tiefensuche in AXDialog
          • 14-Bit Fader, Mute, Solo                        • Plugin-Parameter (Channel EQ, Comp)
          • Touch/Latch Mixer-Automationen                  • Matching via _NS:xxx Identifiers
          • Schneller Master-Bus Zugriff                    • Log/Linear Wert-Transformationen
                     │                                                 │
                     ▼                                                 ▼
             [ LOGIC PRO ENGINE ]                             [ PLUGIN FENSTER ]
```

---

## 5. Konkrete Implementierungs-Schritte für Antigravity

Wir beauftragen Antigravity nun mit den 3 konkreten Bausteinen aus der Analyse:

### Schritt A: Plugin-Spezifikationen anlegen
Unter `packages/daw-adapters/src/logic/plugins/`:
* `ChannelEQ.json` anlegen (Frequenzen 20–20.000 Hz logarithmisch, Gains $-24$ bis $+24\text{ dB}$, Q-Faktoren $0.1$ bis $10$).
* `Compressor.json` anlegen (Threshold `_NS:153`, Ratio `_NS:157`, Attack `_NS:163`, Release `_NS:169`, Make Up `_NS:160`).

### Schritt B: Native AXUIElement Tiefensuche
In `macos_ax_client.ts` oder als Rust-Modul in `src-tauri`:
* Schluß mit `every slider of window`.
* Implementierung einer echten rekursiven Traversierung (`findFirstElement(node, role, identifier, title)`), die durch alle `AXGroup`-Container bis zum Ziel-Regler absteigt.

### Schritt C: Value Transformers
In `packages/daw-adapters/src/logic/transformers.ts`:
* Umrechnung zwischen echten Audiowerten (Hz, dB, ms) und den internen Slider-Positionen ($0.0$ bis $1.0$ bzw. $0$ bis $1100$).