# MCU (Mackie Control Universal) & Hybrid DAW Architecture Specification

## 1. Executive Summary & Purpose

This document serves as the permanent technical architecture reference for the **Oszillation Mixing Buddy** DAW control plane.

When interacting with DAWs that encapsulate their arrangement interfaces within non-standard, custom-rendered UI canvases (such as Apple Logic Pro's AppKit/Metal timeline headers, which yield `missing value` to OS-level accessibility inspectors), the system does **not** rely on fragile screen-scraping.

Instead, the system utilizes the industry-standard **Mackie Control Universal (MCU)** protocol combined with targeted accessibility inspection (**Hybrid Architecture**).

---

## 2. Universal DAW Applicability

While developed to resolve Apple Logic Pro's UI encapsulation, the MCU specification is universally supported by:
* **Apple Logic Pro** (Native deep integration since Logic 5 / eMagic Logic Control)
* **Steinberg Nuendo & Cubase** (Native Mackie Control remote devices)
* **Bitwig Studio** (Native Mackie MCU controller extension)
* **PreSonus Studio One, Cockos Reaper, Ableton Live** (Native MCU profiles)

In the Oszillation Mixing Buddy polymorphic driver model:
* **Nuendo / Cubase:** Primary driver is high-resolution JavaScript MIDI Remote; fallback is MCU.
* **Logic Pro:** Primary driver is Virtual MCU + Cocoa Accessibility for 3rd-party plugin windows.
* **Bitwig / Other DAWs:** MCU acts as the zero-configuration universal adapter.

---

## 3. Technical Protocol Specification (Mackie Control over Virtual MIDI)

Communication occurs over a virtual CoreMIDI loopback port pair (`MixingBuddy_MCU_In` / `MixingBuddy_MCU_Out`).

### 3.1. Two-Line LCD Display Protocol (SysEx)
The MCU LCD display consists of 2 lines of 55 characters (divided into 8 channel strips of 7 characters each, plus padding). Logic Pro broadcasts track names, parameter labels, and values via SysEx:

```text
F0 00 00 66 14 12 <offset> <ASCII text...> F7
```
* `F0 00 00 66 14`: Mackie Manufacturer & MCU Device ID header.
* `12`: Write LCD Display command.
* `<offset>`:
  * `0x00 – 0x37` (0–55): **Line 1 (Upper line):** Track names, EQ bands, plugin parameter labels.
  * `0x38 – 0x6F` (56–111): **Line 2 (Lower line):** Parameter values, fader levels, panning positions.
* `F7`: End of Exclusive (EOX).

**Parsing Rule:**
The driver parses the 8 blocks of 7 ASCII characters across offset `0x00–0x37` to extract the live track list without requesting UI access from the OS.

---

### 3.2. 10-Bit Motorized Fader Control & Automation Modes
Fader volume is transmitted as High-Resolution 14-bit/10-bit MIDI Pitch Bend across MIDI channels 1–8 (channels 1–8) and channel 9 (master):

* **Channel 1–8 Fader:** `0xE0` to `0xE7` followed by `LSB (0–127)` and `MSB (0–127)`.
* **Master Fader:** `0xE8` followed by `LSB` and `MSB`.
* **Touch Sensitivity (Capacitive Sensing):**
  * Fader Touch On: `0x90` (Note On), Note `0x68 + channel_index`, Velocity `0x7F`.
  * Fader Touch Off: `0x80` (Note Off), Note `0x68 + channel_index`, Velocity `0x00`.

#### Automation Modes (MIDI Channel 1, Note On):
To write automation curves into Logic Pro during playback:
| Automation Mode | MCU Button Note | Hex | Action Taken by Agent |
| :--- | :---: | :---: | :--- |
| **Read** | Note 74 | `0x4A` | Safe audition mode. Logic plays back existing curves. |
| **Write** | Note 75 | `0x4B` | Overwrites entire automation pass. |
| **Touch** | Note 77 | `0x4D` | **Preferred Agent Mode:** Agent sends Touch On (`0x90 0x68`), moves fader, then sends Touch Off (`0x80 0x68`). Logic writes curves only during active movement. |
| **Latch** | Note 78 | `0x4E` | Overwrites values from initial touch until playback stops. |

---

### 3.3. Channel Strip Functions & Assignment Modes
The 6 main Assignment Buttons toggle the function of the 8 Rotary Encoders (V-Pots):

| Assignment Mode | Note Number | Hex | What Logic Pro maps to the 8 V-Pots |
| :--- | :---: | :---: | :--- |
| **Track** | Note 40 | `0x28` | Default Pan / Balance across channels 1–8. |
| **Send** | Note 43 | `0x2B` | Send 1–8 levels for selected track. |
| **EQ** | Note 42 | `0x2A` | **Channel EQ Mode:** V-Pots map directly to Band Frequency, Gain, and Q. |
| **Plug-in** | Note 44 | `0x2C` | **Insert FX Mode:** Select and edit Audio Unit insert slots 1–15. |
| **Instrument** | Note 45 | `0x2D` | Software Instrument parameters. |

#### Rotary Encoders (V-Pots):
* Parameter Changes: MIDI CC `0x10 – 0x17` (Channels 1–8).
* Encoded as 2's Complement relative delta:
  * Clockwise turn (increment): `0x01 – 0x3F` (+1 to +63).
  * Counter-clockwise turn (decrement): `0x41 – 0x7F` (-1 to -63).

---

## 4. The Hybrid Architecture: Logic Internal vs. 3rd-Party Plugins

```
                                  [ OSZILLATION MIXING BUDDY ]
                                                │
                      ┌─────────────────────────┴─────────────────────────┐
                      │                                                   │
               1. Virtual MCU Port                                 2. Cocoa AX Engine
               (High-Speed Bidirectional MIDI)                     (macOS Accessibility)
                      │                                                   │
                      ▼                                                   ▼
            [ LOGIC PRO ENGINE ]                               [ FOCUSED PLUGIN WINDOW ]
         • Instant Track Names & Routing                    • FabFilter, Waves, iZotope, UAD
         • 10-Bit Fader & Pan Control                       • Full parameter tree inspection
         • Touch / Latch / Write Automation                 • Slider manipulation via Cocoa AX
         • Logic Channel EQ & Native Dynamics               • NO main window scraping needed!
```

### 4.1. Fast-Path: Logic Pro Internal Tools (Channel EQ & Compressor)
* Handled **100 % via MCU**.
* Switching to Assignment `EQ` (`0x90 0x2A 0x7F`) automatically maps the 8 V-Pots to Channel EQ bands.
* Zero latency, zero dependency on macOS accessibility permissions, operates while Logic Pro is minimized or in background.

### 4.2. Deep-Path: 3rd-Party Plugins (FabFilter, iZotope, Soundtoys, Waves)
* When an ActionCard targets an external Audio Unit plugin (e.g. `FabFilter Pro-Q 3` on Track 1):
  1. The agent selects the track via MCU: `0x90 (0x18 + index) 0x7F`.
  2. The agent issues the Logic key command or MCU command to open the plugin window.
  3. The agent targets the plugin window directly by window title:
     `tell application "System Events" to tell process "Logic Pro" to tell (first window whose name contains "Pro-Q")`.
  4. Individual plugin windows are standard Cocoa `NSWindow` containers and do not suffer from the AppKit canvas encapsulation of the main timeline.