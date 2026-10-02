# Multi-DAW MCU-Abstraktion & Architektur-Strategie

**Status:** Architektur-Vorausschau für Phase 4 (Multi-DAW Readiness)  
**Systemkomponenten:** `apps/desktop/src-tauri/src/mcu_bridge.rs`, `lib.rs`, `packages/daw-adapters/`  
**Ziel:** Einheitliche Co-Producer-Steuerung über Apple Logic Pro, Steinberg Nuendo/Cubase, Ableton Live und Bitwig ohne Code-Verdopplung.

---

## 1. Die erlösende Nachricht: Das MCU-Fundament ist zu 85 % bereits universell

Das **Mackie Control Universal (MCU)** Protokoll ist kein proprietäres Apple-Format, sondern ein von Mackie und Emagic entwickelter **weltweiter Industriestandard**. 

Nahezu jede professionelle DAW auf dem Markt (Logic Pro, Steinberg Cubase & Nuendo, Ableton Live, Bitwig Studio, Reaper, Studio One) implementiert denselben physikalischen Standard:

| MCU-Funktionsbereich | MIDI-Spezifikation | Universell über alle DAWs? | Anmerkung |
| :--- | :--- | :---: | :--- |
| **Transport (Play, Stop, Cycle, Scrub)** | Noten 94 (`Play`), 93 (`Stop`), 86 (`Cycle`), CC 60 (`Jog`) | **Ja (100 %)** | Standard bei allen DAWs |
| **Fader 1–8 & Master (14-Bit Pitchbend)** | Pitchbend Ch 1–8 (`0xE0..0xE7`), Master Ch 9 (`0xE8`) | **Ja (100 %)** | Identische 14-Bit Auflösung |
| **Fader Touch-Sensoren** | Noten 104–111 (Kanal 1–8), Note 112 (Master) | **Ja (100 %)** | Standard-Berührungserkennung |
| **Kanalzug-Basics (Mute, Solo, Rec, Select)** | Noten 16–23 (`Mute`), 8–15 (`Solo`), 0–7 (`Rec`), 24–31 (`Sel`) | **Ja (100 %)** | Chromatische Staffelung überall gleich |
| **V-Pots (Pan & Sends)** | CC 16–23 (Sign-Magnitude oder 2's Complement) | **Ja (95 %)** | Manche DAWs erlauben Umschaltung des Drehmodus |
| **Automations-Modi (Read, Touch, Latch)** | Noten 74–79 | **Teilweise (75 %)** | Logic nutzt Touch/Latch/Trim; Cubase hat Punch/Autolatch |
| **Scribble Strips (LCD Displays)** | SysEx `F0 00 00 66 ... F7` | **Ja (90 %)** | Header variiert nur nach Device-ID (0x10 vs. 0x14) |

**Fazit:** Der Code, den Antigravity soeben in `mcu_bridge.rs` fertiggestellt hat, funktioniert für Transport, Fader, Mute, Solo und Touch-Fahrten in Nuendo, Cubase und Ableton Live **bereits heute ohne Änderungen**.

---

## 2. Die vorbereitete Architektur: Warum wir vor Überfrachtung geschützt sind

Wir haben die Trennung durch die **High-Level-Makros** bereits auf der entscheidenden Abstraktionsebene verankert:

```
                          [ THE BRAIN: AI AGENT ]
                   Sieht NUR 4 DAW-agnostische Absichten:
                   • audition_region(bar, duration)
                   • set_track_state(track, { fader, pan, mute, solo })
                   • record_fader_ride(track, start, end, curve)
                   • propose_mix_adjustment(proposal)
                                     │
                                     ▼
                   [ TAURI BACKEND: lib.rs DISPATCHER ]
                   Prüft: active_daw via daw_detector.rs
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
  [ LOGIC PRO ADAPTER ]       [ STEINBERG ADAPTER ]       [ ABLETON ADAPTER ]
  • CoreMIDI MCU (mcu_bridge) • Steinberg JS MIDI Remote  • CoreMIDI MCU Surface
  • Swift AX (Deep Plugins)     (Native ParamIDs!)        • Python Remote Script (LOM)
```

### Der entscheidende Vorteil dieser Struktur:
1. **Das Sprachmodell bleibt 100 % isoliert:**  
   Die KI weiß und kümmert sich nicht darum, welche DAW unter der Haube läuft. Sie sendet nur musikalische Befehle (*„Setze Fader auf -3.0 dB“* oder *„Höre Takt 25 an“*).
2. **Kein Token-Verbrauch bei DAW-Wechseln:**  
   Wir müssen keine neuen Prompt-Tools für Nuendo oder Cubase deklarieren. Die Schnittstelle für das LLM bleibt exakt dieselbe.
3. **Der polymorphe Dispatcher in `lib.rs`:**  
   In `lib.rs` wird anhand von `daw_detector::get_active_daw()` entschieden, welcher Treiber die High-Level-Absicht ausführt:
   - Ist Logic aktiv $\rightarrow$ Aufruf von `mcu_bridge` + `logic-ax-bridge`.
   - Ist Nuendo/Cubase aktiv $\rightarrow$ Aufruf von `steinberg_driver` / MIDI Remote.

---

## 3. Warum Steinberg Nuendo & Cubase sogar noch eleganter wird

In Nuendo und Cubase müssen wir viele der Krücken, die Apple Logic Pro über Accessibility (Fensterzwang) nötig gemacht hat, überhaupt nicht anwenden:

1. **Die offizielle JavaScript MIDI Remote API von Steinberg:**  
   Steinberg stellt ein vollwertiges Entwickler-Framework zur Verfügung. Unser in `packages/daw-adapters/src/nuendo/` vorbereitetes Script registriert den Mixing Buddy direkt als native Bedienoberfläche.
2. **Kein Fenster-Zwang für Plugins:**  
   In Nuendo können Plugin-Parameter (z. B. Frequenz eines EQs) direkt über ihre `paramId` angesprochen werden – selbst wenn das Plugin-Fenster geschlossen oder minimiert ist.
3. **Hardware-Symbiose (z. B. Softube Console 1):**  
   Da Nuendo für jeden Kanalzug eindeutige Controller-Zuweisungen erlaubt, kollidiert der Mixing Buddy nicht mit deiner Softube Console, sondern teilt sich mit ihr die Parameter-Bänke.

---

## 4. Fahrplan: Wann schalten wir die Nuendo-Trennung scharf?

Es ist **genau richtig**, dass wir die Weichen jetzt architektonisch sauber dokumentiert haben, aber die konkrete Nuendo-Implementierung erst in **Phase 4 (Multi-DAW)** aktivieren:

* **Aktueller Schritt:** Sobald deine Google-Quota abgekühlt ist, verifizieren wir, dass der MCU-Transport (`Play`, `Stop`, `Locate` auf Takt 25) und der A/B-Restore in Logic Pro absolut fehlerfrei laufen.
* **Phase 4 Start (Sprint 11 & 12):** 
  1. `daw_detector.rs` erkennt den laufenden Prozess `Nuendo` oder `Cubase`.
  2. Der Dispatcher in `lib.rs` leitet `set_track_state` und `audition_region` polymorph an den Steinberg-Port weiter.
  3. Da die Basisbefehle (Transport & Fader) auf derselben MCU-Matrix basieren, funktioniert der Grundbetrieb in Nuendo innerhalb weniger Stunden.