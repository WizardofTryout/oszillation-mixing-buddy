use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

/// SysEx Header for Mackie Control Universal (MCU)
/// F0 00 00 66 14 12 <offset> <ASCII text...> F7
pub const MCU_SYSEX_HEADER: [u8; 5] = [0xF0, 0x00, 0x00, 0x66, 0x14];
pub const MCU_CMD_LCD_WRITE: u8 = 0x12;

// ── Transport & Navigation Notes (Channel 1) ──────────────────────────────────
pub const MCU_NOTE_PLAY: u8 = 0x5E; // 94
pub const MCU_NOTE_STOP: u8 = 0x5D; // 93
pub const MCU_NOTE_REWIND: u8 = 0x5B; // 91
pub const MCU_NOTE_FAST_FORWARD: u8 = 0x5C; // 92
pub const MCU_NOTE_RECORD: u8 = 0x5F; // 95
pub const MCU_NOTE_CYCLE: u8 = 0x56; // 86

// ── Cursor & Navigation (Channel 1) ───────────────────────────────────────────
pub const MCU_NOTE_CURSOR_UP: u8 = 0x60; // 96
pub const MCU_NOTE_CURSOR_DOWN: u8 = 0x61; // 97
pub const MCU_NOTE_CURSOR_LEFT: u8 = 0x62; // 98
pub const MCU_NOTE_CURSOR_RIGHT: u8 = 0x63; // 99
pub const MCU_NOTE_ZOOM_TOGGLE: u8 = 0x64; // 100
pub const MCU_NOTE_SCRUB: u8 = 0x65; // 101

// ── Banking & Channel Navigation (Channel 1) ──────────────────────────────────
pub const MCU_NOTE_BANK_LEFT: u8 = 0x2E; // 46
pub const MCU_NOTE_BANK_RIGHT: u8 = 0x2F; // 47
pub const MCU_NOTE_CHANNEL_LEFT: u8 = 0x30; // 48
pub const MCU_NOTE_CHANNEL_RIGHT: u8 = 0x31; // 49
pub const MCU_NOTE_FLIP: u8 = 0x32; // 50
pub const MCU_NOTE_GLOBAL_VIEW: u8 = 0x33; // 51

// ── Channel Strip Control Base Notes (Channels 1–8 / idx 0..7) ────────────────
pub const MCU_NOTE_REC_BASE: u8 = 0x00; // 0..7
pub const MCU_NOTE_SOLO_BASE: u8 = 0x08; // 8..15
pub const MCU_NOTE_MUTE_BASE: u8 = 0x10; // 16..23
pub const MCU_NOTE_SELECT_BASE: u8 = 0x18; // 24..31
pub const MCU_NOTE_VPOT_CLICK_BASE: u8 = 0x20; // 32..39

// ── Touch Sensors (Capacitive Fader Touch) ─────────────────────────────────────
pub const MCU_NOTE_TOUCH_BASE: u8 = 0x68; // 104..111 (Channels 1–8)
pub const MCU_NOTE_TOUCH_MASTER: u8 = 0x70; // 112 (Master Fader)

// ── Utilities & Global Commands (Channel 1) ───────────────────────────────────
pub const MCU_NOTE_SAVE: u8 = 0x50; // 80
pub const MCU_NOTE_UNDO: u8 = 0x51; // 81
pub const MCU_NOTE_CANCEL: u8 = 0x52; // 82
pub const MCU_NOTE_ENTER: u8 = 0x53; // 83
pub const MCU_NOTE_MARKER: u8 = 0x54; // 84
pub const MCU_NOTE_NUDGE: u8 = 0x55; // 85
pub const MCU_NOTE_DROP: u8 = 0x57; // 87
pub const MCU_NOTE_REPLACE: u8 = 0x58; // 88
pub const MCU_NOTE_CLICK: u8 = 0x59; // 89
pub const MCU_NOTE_SOLO_CLEAR: u8 = 0x5A; // 90

// ── Automation Modes (Channel 1) ──────────────────────────────────────────────
pub const MCU_NOTE_AUTO_READ: u8 = 0x4A; // 74 (Read / Off)
pub const MCU_NOTE_AUTO_WRITE: u8 = 0x4B; // 75 (Write)
pub const MCU_NOTE_AUTO_TRIM: u8 = 0x4C; // 76 (Trim)
pub const MCU_NOTE_AUTO_TOUCH: u8 = 0x4D; // 77 (Touch)
pub const MCU_NOTE_AUTO_LATCH: u8 = 0x4E; // 78 (Latch)
pub const MCU_NOTE_AUTO_GROUP: u8 = 0x4F; // 79 (Group)

/// Automation Modes mapped to MCU Button Notes (Channel 1, Note On)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationMode {
    Read,  // Note 74 (0x4A)
    Off,   // Note 74 (0x4A)
    Write, // Note 75 (0x4B)
    Trim,  // Note 76 (0x4C)
    Touch, // Note 77 (0x4D)
    Latch, // Note 78 (0x4E)
    Group, // Note 79 (0x4F)
}

impl AutomationMode {
    pub fn note_number(&self) -> u8 {
        match self {
            Self::Read | Self::Off => MCU_NOTE_AUTO_READ,
            Self::Write => MCU_NOTE_AUTO_WRITE,
            Self::Trim => MCU_NOTE_AUTO_TRIM,
            Self::Touch => MCU_NOTE_AUTO_TOUCH,
            Self::Latch => MCU_NOTE_AUTO_LATCH,
            Self::Group => MCU_NOTE_AUTO_GROUP,
        }
    }
}

/// Assignment Modes mapped to MCU Buttons (Rotary V-Pot assignment)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssignmentMode {
    Track,      // Note 40 (0x28) - Pan / Balance
    Send,       // Note 43 (0x2B) - Send 1-8
    EQ,         // Note 42 (0x2A) - Channel EQ Direct Mapping
    Plugin,     // Note 44 (0x2C) - Insert FX Mode
    Instrument, // Note 45 (0x2D) - Instrument Parameters
}

impl AssignmentMode {
    pub fn note_number(&self) -> u8 {
        match self {
            Self::Track => 0x28,
            Self::Send => 0x2B,
            Self::EQ => 0x2A,
            Self::Plugin => 0x2C,
            Self::Instrument => 0x2D,
        }
    }
}

/// State of the MCU LCD Screen (2 lines of 56 characters each)
#[derive(Debug, Clone)]
pub struct McuLcdState {
    pub line1: [u8; 56],
    pub line2: [u8; 56],
}

impl Default for McuLcdState {
    fn default() -> Self {
        Self {
            line1: [b' '; 56],
            line2: [b' '; 56],
        }
    }
}

impl McuLcdState {
    /// Clears both lines of the LCD buffer to spaces
    pub fn clear(&mut self) {
        self.line1 = [b' '; 56];
        self.line2 = [b' '; 56];
    }

    /// Updates the LCD buffer from an incoming MCU SysEx payload
    pub fn update_from_sysex(&mut self, payload: &[u8]) -> bool {
        // Minimum SysEx: F0 00 00 66 14 12 <offset> <at least 1 char> F7 (length >= 8)
        if payload.len() < 8 {
            return false;
        }
        if &payload[0..5] != MCU_SYSEX_HEADER || payload[5] != MCU_CMD_LCD_WRITE {
            return false;
        }

        let offset = payload[6] as usize;
        // Strip trailing F7 if present
        let data = if payload.last() == Some(&0xF7) {
            &payload[7..payload.len() - 1]
        } else {
            &payload[7..]
        };

        // When starting from offset 0, reset line1 so old ghost tracks from previous projects are purged
        if offset == 0 {
            self.line1 = [b' '; 56];
        } else if offset == 56 {
            self.line2 = [b' '; 56];
        }

        for (i, &byte) in data.iter().enumerate() {
            if byte == 0xF7 {
                break;
            }
            let pos = offset + i;
            if pos < 56 {
                self.line1[pos] = byte;
            } else if pos < 112 {
                self.line2[pos - 56] = byte;
            }
        }
        true
    }

    /// Extracts track names from Line 1 (8 channels * 7 characters each)
    pub fn extract_track_names(&self) -> Vec<String> {
        let mut names = Vec::new();
        for ch in 0..8 {
            let start = ch * 7;
            let end = start + 7;
            let slice = &self.line1[start..end];
            let name_str = String::from_utf8_lossy(slice).trim().to_string();
            if !name_str.is_empty() {
                names.push(name_str);
            }
        }
        names
    }

    /// Extracts parameter labels from Line 2
    pub fn extract_parameters(&self) -> Vec<String> {
        let mut params = Vec::new();
        for ch in 0..8 {
            let start = ch * 7;
            let end = start + 7;
            let slice = &self.line2[start..end];
            let param_str = String::from_utf8_lossy(slice).trim().to_string();
            if !param_str.is_empty() {
                params.push(param_str);
            }
        }
        params
    }
}

/// Shared bridge state between MIDI callback and the rest of the application
#[derive(Clone)]
pub struct McuBridge {
    lcd_state: Arc<Mutex<McuLcdState>>,
    discovered_tracks: Arc<Mutex<Vec<serde_json::Value>>>,
    pub is_cycle_active: Arc<AtomicBool>,
    /// VirtualSource: Mixing Buddy → Logic Pro (outgoing MIDI commands)
    #[cfg(target_os = "macos")]
    virtual_source: Arc<Mutex<Option<coremidi::VirtualSource>>>,
    /// VirtualDestination: Logic Pro → Mixing Buddy (incoming MCU feedback)
    /// Held alive so the callback keeps firing; never explicitly accessed.
    #[cfg(target_os = "macos")]
    _virtual_destination: Arc<Mutex<Option<coremidi::VirtualDestination>>>,
    /// Client must outlive both ports
    #[cfg(target_os = "macos")]
    _client: Arc<Mutex<Option<coremidi::Client>>>,
}

impl McuBridge {
    pub fn new() -> Self {
        Self {
            lcd_state: Arc::new(Mutex::new(McuLcdState::default())),
            discovered_tracks: Arc::new(Mutex::new(Vec::new())),
            is_cycle_active: Arc::new(AtomicBool::new(false)),
            #[cfg(target_os = "macos")]
            virtual_source: Arc::new(Mutex::new(None)),
            #[cfg(target_os = "macos")]
            _virtual_destination: Arc::new(Mutex::new(None)),
            #[cfg(target_os = "macos")]
            _client: Arc::new(Mutex::new(None)),
        }
    }

    /// Initializes virtual CoreMIDI ports on macOS.
    /// - Output port (Mixing Buddy Out) → Logic Pro reads this as a control surface input
    /// - Input  port (Mixing Buddy In)  → receives LCD SysEx / meter data from Logic
    pub fn start(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            println!("🎹 [MCU Bridge] Initializing virtual CoreMIDI ports…");

            let client = coremidi::Client::new("Oszillation Mixing Buddy")
                .map_err(|e| format!("CoreMIDI Client creation failed: OSStatus {}", e))?;

            // --- Virtual Source: Mixing Buddy → Logic Pro --------------------------
            let virtual_src = client
                .virtual_source("Oszillation Mixing Buddy Out")
                .map_err(|e| format!("VirtualSource creation failed: OSStatus {}", e))?;

            // --- Virtual Destination: Logic Pro → Mixing Buddy (MCU feedback) ------
            let lcd_ref = Arc::clone(&self.lcd_state);
            let tracks_ref = Arc::clone(&self.discovered_tracks);
            let cycle_ref = Arc::clone(&self.is_cycle_active);

            let virtual_dst = client
                .virtual_destination("Oszillation Mixing Buddy In", move |packet_list| {
                    let mut lcd = match lcd_ref.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };

                    for packet in packet_list.iter() {
                        let data = packet.data();
                        let mut i = 0;
                        while i < data.len() {
                            let status = data[i];
                            if (status == 0x90 || status == 0x80) && i + 2 < data.len() {
                                let note = data[i + 1];
                                let vel = data[i + 2];
                                if note == MCU_NOTE_CYCLE {
                                    let active = status == 0x90 && vel > 0;
                                    cycle_ref.store(active, Ordering::SeqCst);
                                    println!("🔁 [MCU Bridge] Logic Cycle feedback: {}", active);
                                }
                                i += 3;
                            } else if status == 0xF0 {
                                if lcd.update_from_sysex(&data[i..]) {
                                    let mut track_names = lcd.extract_track_names();
                                    if !track_names.is_empty() {
                                        println!(
                                            "🎛️ [MCU Bridge] Live tracks from Logic LCD: {:?}",
                                            track_names
                                        );
                                        let updated = build_track_list(&track_names);
                                        if let Ok(mut tr) = tracks_ref.lock() {
                                            *tr = updated;
                                        }
                                    } else {
                                        track_names.clear();
                                        if let Ok(mut tr) = tracks_ref.lock() {
                                            tr.clear();
                                        }
                                    }
                                }
                                break;
                            } else {
                                i += 1;
                            }
                        }
                    }
                })
                .map_err(|e| format!("VirtualDestination creation failed: OSStatus {}", e))?;

            println!("✅ [MCU Bridge] Virtual CoreMIDI ports created:");
            println!("   - Output: 'Oszillation Mixing Buddy Out'  (→ Logic Pro)");
            println!("   - Input:  'Oszillation Mixing Buddy In'   (← Logic Pro)");

            // Store everything so the ports and client are kept alive
            if let Ok(mut g) = self.virtual_source.lock() {
                *g = Some(virtual_src);
            }
            if let Ok(mut g) = self._virtual_destination.lock() {
                *g = Some(virtual_dst);
            }
            if let Ok(mut g) = self._client.lock() {
                *g = Some(client);
            }

            Ok(())
        }

        #[cfg(not(target_os = "macos"))]
        {
            println!("ℹ️ [MCU Bridge] Non-macOS platform — CoreMIDI virtual ports stubbed.");
            Ok(())
        }
    }

    /// Returns the currently discovered tracks (populated by live MCU LCD SysEx stream).
    /// Returns an empty Vec when Logic Pro has not yet sent any LCD data.
    pub fn get_tracks(&self) -> Vec<serde_json::Value> {
        self.discovered_tracks
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    /// Explicitly clears the track buffer and resets LCD state to purge ghost tracks.
    pub fn clear_tracks(&self) {
        if let Ok(mut tr) = self.discovered_tracks.lock() {
            tr.clear();
        }
        if let Ok(mut lcd) = self.lcd_state.lock() {
            lcd.clear();
        }
        println!("🧹 [MCU Bridge] Discovered tracks and LCD buffer purged");
    }

    /// Sends raw MIDI bytes to Logic Pro via the virtual source port.
    pub fn send_midi(&self, bytes: &[u8]) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let guard = self
                .virtual_source
                .lock()
                .map_err(|e| format!("Lock poisoned: {:?}", e))?;

            if let Some(ref src) = *guard {
                let packet_buf = coremidi::PacketBuffer::new(0, bytes);
                src.received(&packet_buf)
                    .map_err(|e| format!("MIDIReceived OSStatus: {}", e))?;
                return Ok(());
            }
            Err("Virtual CoreMIDI source not initialized".to_string())
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = bytes;
            Ok(())
        }
    }

    // -----------------------------------------------------------------------
    // High-Level MCU Control Methods
    // -----------------------------------------------------------------------

    /// Sends a Note On (0x90) on MIDI Channel 1, holds for `hold_ms` milliseconds,
    /// then sends a Note Off (0x80) with velocity 0.
    pub fn send_note_pulse(&self, note: u8, hold_ms: u64) -> Result<(), String> {
        self.send_midi(&[0x90, note, 0x7F])?;
        if hold_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(hold_ms));
        }
        self.send_midi(&[0x80, note, 0x00])
    }

    // ── Transport & Navigation (Note-On / Note-Off mit 50ms Hold) ───────────

    /// Play: Note 94 (0x5E)
    pub fn send_transport_play(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_PLAY, 50)
    }

    /// Stop: Note 93 (0x5D)
    pub fn send_transport_stop(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_STOP, 50)
    }

    /// Rewind: Note 91 (0x5B)
    pub fn send_transport_rewind(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_REWIND, 50)
    }

    /// Fast Forward: Note 92 (0x5C)
    pub fn send_transport_fast_forward(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_FAST_FORWARD, 50)
    }

    /// Cycle: Note 86 (0x56)
    pub fn send_transport_cycle(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_CYCLE, 50)
    }

    /// Deaktiviert den Cycle-Modus im In-Memory Status.
    /// Kein blinder Note-86-Toggle (da Note 86 ein Toggle ist und einen inaktiven Cycle ungewollt einschalten würde).
    /// Die deterministische Deaktivierung erfolgt zwingend über den verifizierten Status-Pfad in Swift ('LogicAXBridge.swift').
    pub fn ensure_cycle_off(&self) -> Result<(), String> {
        self.is_cycle_active.store(false, Ordering::SeqCst);
        println!("🔁 [MCU Bridge] ensure_cycle_off: Blind Note 86 toggle suppressed. Managed deterministically via Swift.");
        Ok(())
    }


    /// Cursor UP: Note 96 (0x60)
    pub fn send_cursor_up(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_CURSOR_UP, 50)
    }

    /// Cursor DOWN: Note 97 (0x61)
    pub fn send_cursor_down(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_CURSOR_DOWN, 50)
    }

    /// Cursor LEFT: Note 98 (0x62)
    pub fn send_cursor_left(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_CURSOR_LEFT, 50)
    }

    /// Cursor RIGHT: Note 99 (0x63)
    pub fn send_cursor_right(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_CURSOR_RIGHT, 50)
    }

    /// Zoom Toggle: Note 100 (0x64)
    pub fn send_zoom_toggle(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_ZOOM_TOGGLE, 50)
    }

    /// Scrub: Note 101 (0x65)
    pub fn send_scrub(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_SCRUB, 50)
    }

    // ── Banking & Channel-Navigation (Channel 1) ───────────────────────────

    /// Fader Bank Left: Note 46 (0x2E)
    pub fn bank_left(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_BANK_LEFT, 50)
    }

    /// Fader Bank Right: Note 47 (0x2F)
    pub fn bank_right(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_BANK_RIGHT, 50)
    }

    /// Channel Left: Note 48 (0x30)
    pub fn channel_left(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_CHANNEL_LEFT, 50)
    }

    /// Channel Right: Note 49 (0x31)
    pub fn channel_right(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_CHANNEL_RIGHT, 50)
    }

    /// Flip (Fader <-> V-Pot): Note 50 (0x32)
    pub fn flip(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_FLIP, 50)
    }

    /// Global View: Note 51 (0x33)
    pub fn global_view(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_GLOBAL_VIEW, 50)
    }

    /// Locates the playhead to the given bar using MCU Rewind / RTZ and Jog Wheel scrubbing.
    pub fn send_transport_locate(&self, bar: u32) -> Result<(), String> {
        if bar <= 1 {
            // RTZ / Rewind pulse
            return self.send_note_pulse(MCU_NOTE_REWIND, 50);
        }
        // First: return to start
        self.send_note_pulse(MCU_NOTE_REWIND, 50)?;
        std::thread::sleep(std::time::Duration::from_millis(60));

        // Use MCU Jog wheel (CC 0x3C / 60) for scrubbing to target bar
        let ticks = (bar.saturating_sub(1) * 4).min(500);
        for _ in 0..ticks {
            self.send_midi(&[0xB0, 0x3C, 0x01])?;
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        Ok(())
    }

    // ── Kanalzug-Steuerung (Kanäle 1–8 / idx 0..7) ──────────────────────────

    /// Rec Ready: Noten 0–7 (0x00..0x07)
    pub fn set_channel_rec(&self, channel_idx: u8) -> Result<(), String> {
        if channel_idx > 7 {
            return Err("MCU channel index must be 0..7".to_string());
        }
        self.send_note_pulse(MCU_NOTE_REC_BASE + channel_idx, 50)
    }

    /// Solo: Noten 8–15 (0x08..0x0F)
    pub fn set_channel_solo(&self, channel_idx: u8) -> Result<(), String> {
        if channel_idx > 7 {
            return Err("MCU channel index must be 0..7".to_string());
        }
        self.send_note_pulse(MCU_NOTE_SOLO_BASE + channel_idx, 50)
    }

    /// Mute: Noten 16–23 (0x10..0x17)
    pub fn set_channel_mute(&self, channel_idx: u8) -> Result<(), String> {
        if channel_idx > 7 {
            return Err("MCU channel index must be 0..7".to_string());
        }
        self.send_note_pulse(MCU_NOTE_MUTE_BASE + channel_idx, 50)
    }

    /// Select: Noten 24–31 (0x18..0x1F)
    pub fn select_channel(&self, channel_idx: u8) -> Result<(), String> {
        if channel_idx > 7 {
            return Err("MCU channel index must be 0..7".to_string());
        }
        self.send_note_pulse(MCU_NOTE_SELECT_BASE + channel_idx, 50)
    }

    /// V-Pot Click: Noten 32–39 (0x20..0x27)
    pub fn click_vpot(&self, channel_idx: u8) -> Result<(), String> {
        if channel_idx > 7 {
            return Err("MCU channel index must be 0..7".to_string());
        }
        self.send_note_pulse(MCU_NOTE_VPOT_CLICK_BASE + channel_idx, 50)
    }

    // ── Fader-Level (14-Bit Pitchbend) ──────────────────────────────────────

    /// Moves a motorized fader to a target dB value using 14-bit pitchbend.
    /// - Channels 1–8: Pitchbend auf MIDI-Kanälen 1–8 (0xE0..0xE7)
    /// - Masterfader: Pitchbend auf MIDI-Kanal 9 (0xE8)
    /// - Calibration: 0.0 dB = 10240 (0x2800), -6.0 dB = 8192, +6.0 dB = 16383, -inf dB = 0.
    pub fn set_fader_volume(&self, channel_idx: u8, volume_db: f32) -> Result<(), String> {
        let ch = channel_idx.min(8); // 0..7 = Kanäle 1-8, 8 = Masterfader
        let val_14bit = db_to_mcu_pitchbend(volume_db);
        let lsb = (val_14bit & 0x7F) as u8;
        let msb = ((val_14bit >> 7) & 0x7F) as u8;
        self.send_midi(&[0xE0 + ch, lsb, msb])
    }

    /// Simulates capacitive fader touch (needed for Touch-mode automation).
    /// - Touch Kanäle 1–8: Noten 104 bis 111 (0x68 bis 0x6F)
    /// - Touch Master: Note 112 (0x70)
    pub fn set_fader_touch(&self, channel_index: u8, touched: bool) -> Result<(), String> {
        let note = if channel_index < 8 {
            MCU_NOTE_TOUCH_BASE + channel_index
        } else if channel_index == 8 {
            MCU_NOTE_TOUCH_MASTER
        } else {
            return Err("Channel index must be 0..8 (0..7 = tracks, 8 = master)".to_string());
        };

        if touched {
            self.send_midi(&[0x90, note, 0x7F])
        } else {
            self.send_midi(&[0x80, note, 0x00])
        }
    }

    /// Switches Logic Pro Track Automation Mode via string (Read / Off, Write, Trim, Touch, Latch, Group).
    pub fn set_automation_mode(&self, mode: &str) -> Result<(), String> {
        let note = match mode.to_lowercase().trim() {
            "read" | "off" => MCU_NOTE_AUTO_READ,
            "write" => MCU_NOTE_AUTO_WRITE,
            "trim" => MCU_NOTE_AUTO_TRIM,
            "touch" => MCU_NOTE_AUTO_TOUCH,
            "latch" => MCU_NOTE_AUTO_LATCH,
            "group" => MCU_NOTE_AUTO_GROUP,
            _ => {
                return Err(format!(
                    "Unbekannter Automationsmodus '{}'. Erlaubt: read, off, write, trim, touch, latch, group",
                    mode
                ))
            }
        };
        self.send_note_pulse(note, 50)
    }

    /// Switches Logic Pro Track Automation Mode via enum.
    pub fn set_automation_mode_enum(&self, mode: AutomationMode) -> Result<(), String> {
        self.send_note_pulse(mode.note_number(), 50)
    }

    /// Switches Rotary Encoder V-Pot Assignment Mode.
    pub fn set_assignment_mode(&self, mode: AssignmentMode) -> Result<(), String> {
        self.send_note_pulse(mode.note_number(), 50)
    }

    /// Sends a relative delta to a V-Pot via Sign-Magnitude (CC 16..23).
    /// - Rechtsdrehung: 0x01..0x3F (+1..+63)
    /// - Linksdrehung:  0x41..0x7F (-1..-63)
    pub fn send_vpot_turn(&self, channel_index: u8, delta: i8) -> Result<(), String> {
        if channel_index > 7 {
            return Err("MCU channel index must be 0..7 for V-Pots".to_string());
        }
        if delta == 0 {
            return Ok(());
        }
        let cc_num = 0x10 + channel_index;
        let val: u8 = if delta > 0 {
            (delta as u8).min(0x3F)
        } else {
            0x40 | ((-delta) as u8).min(0x3F)
        };
        self.send_midi(&[0xB0, cc_num, val])
    }

    /// Alias for backwards compatibility with existing callers.
    pub fn send_vpot_delta(&self, channel_idx: u8, delta: i8) -> Result<(), String> {
        self.send_vpot_turn(channel_idx, delta)
    }

    /// Sets LCD Scribble Strip text for a channel via SysEx (F0 00 00 66 14 12 <offset> <ASCII> F7).
    /// Top row offset: 0x00..0x37 (7 chars per channel)
    /// Bottom row offset: 0x38..0x6F (7 chars per channel)
    pub fn set_lcd_text(&self, channel_index: u8, top: &str, bottom: &str) -> Result<(), String> {
        if channel_index > 7 {
            return Err("MCU channel index must be 0..7 for LCD text".to_string());
        }
        let format_7 = |s: &str| -> [u8; 7] {
            let mut buf = [b' '; 7];
            let bytes = s.as_bytes();
            let len = bytes.len().min(7);
            for i in 0..len {
                buf[i] = if bytes[i] < 128 { bytes[i] } else { b'?' };
            }
            buf
        };

        let top_bytes = format_7(top);
        let bottom_bytes = format_7(bottom);

        let offset_top = channel_index * 7;
        let mut sysex_top = Vec::with_capacity(15);
        sysex_top.extend_from_slice(&MCU_SYSEX_HEADER);
        sysex_top.push(MCU_CMD_LCD_WRITE);
        sysex_top.push(offset_top);
        sysex_top.extend_from_slice(&top_bytes);
        sysex_top.push(0xF7);
        self.send_midi(&sysex_top)?;

        let offset_bottom = 0x38 + channel_index * 7;
        let mut sysex_bottom = Vec::with_capacity(15);
        sysex_bottom.extend_from_slice(&MCU_SYSEX_HEADER);
        sysex_bottom.push(MCU_CMD_LCD_WRITE);
        sysex_bottom.push(offset_bottom);
        sysex_bottom.extend_from_slice(&bottom_bytes);
        sysex_bottom.push(0xF7);
        self.send_midi(&sysex_bottom)
    }

    /// Atomic fader move with Touch Automation Guard:
    /// 1. Fader Touch On
    /// 2. Move fader to target_db via Pitchbend
    /// 3. Fader Touch Off
    pub fn apply_fader_delta_with_automation(
        &self,
        channel_idx: u8,
        target_db: f32,
    ) -> Result<(), String> {
        let ch = channel_idx.min(8);
        self.set_fader_touch(ch, true)?;
        self.set_fader_volume(ch, target_db)?;
        self.set_fader_touch(ch, false)?;
        Ok(())
    }

    // ── Utilities & Globale Befehle ─────────────────────────────────────────

    /// Save: Note 80 (0x50)
    pub fn utility_save(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_SAVE, 50)
    }

    /// Undo: Note 81 (0x51)
    pub fn utility_undo(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_UNDO, 50)
    }

    /// Cancel: Note 82 (0x52)
    pub fn utility_cancel(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_CANCEL, 50)
    }

    /// Enter: Note 83 (0x53)
    pub fn utility_enter(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_ENTER, 50)
    }

    /// Marker: Note 84 (0x54)
    pub fn utility_marker(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_MARKER, 50)
    }

    /// Nudge: Note 85 (0x55)
    pub fn utility_nudge(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_NUDGE, 50)
    }

    /// Drop: Note 87 (0x57)
    pub fn utility_drop(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_DROP, 50)
    }

    /// Replace: Note 88 (0x58)
    pub fn utility_replace(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_REPLACE, 50)
    }

    /// Click: Note 89 (0x59)
    pub fn utility_click(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_CLICK, 50)
    }

    /// Solo Clear: Note 90 (0x5A)
    pub fn utility_solo_clear(&self) -> Result<(), String> {
        self.send_note_pulse(MCU_NOTE_SOLO_CLEAR, 50)
    }
}

/// Converts dB (-96.0 dB .. +6.0 dB) to 14-bit MCU Pitchbend value (0 .. 16383).
/// Calibrated against Logic Pro Automation Reference piecewise fader curve:
/// - +6.0 dB (Max): 16383 (LSB 0x7F, MSB 0x7F)
/// - 0.0 dB (Unity Gain): 10240 (0x2800 -> LSB 0x00, MSB 0x50)
/// - -6.0 dB: 8192 (0x2000 -> LSB 0x00, MSB 0x40)
/// - -inf (<= -96.0 dB): 0 (LSB 0x00, MSB 0x00)
pub fn db_to_mcu_pitchbend(volume_db: f32) -> u16 {
    if volume_db <= -96.0 {
        return 0;
    }
    if volume_db >= 6.0 {
        return 16383;
    }

    // Piecewise calibration lookup table from Logic Pro Automation Reference
    const CALIBRATION: &[(f32, u16)] = &[
        (6.0, 16383),
        (3.0, 13311),
        (0.0, 10240),
        (-3.0, 9180),
        (-6.0, 8192),
        (-10.0, 6848),
        (-15.0, 5450),
        (-20.0, 4352),
        (-30.0, 2560),
        (-40.0, 1280),
        (-50.0, 576),
        (-60.0, 320),
        (-96.0, 0),
    ];

    for i in 0..CALIBRATION.len() - 1 {
        let (db_high, val_high) = CALIBRATION[i];
        let (db_low, val_low) = CALIBRATION[i + 1];

        if volume_db <= db_high && volume_db >= db_low {
            let span_db = db_high - db_low;
            if span_db <= 0.0 {
                return val_high;
            }
            let ratio = (volume_db - db_low) / span_db;
            let interpolated = val_low as f32 + ratio * ((val_high - val_low) as f32);
            return interpolated.round().clamp(0.0, 16383.0) as u16;
        }
    }

    0
}


impl Default for McuBridge {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Helper: Build a structured track list from raw MCU track name strings
// ---------------------------------------------------------------------------
fn build_track_list(track_names: &[String]) -> Vec<serde_json::Value> {
    let mut tracks: Vec<serde_json::Value> = track_names
        .iter()
        .enumerate()
        .map(|(idx, name)| {
            let is_master = name.to_lowercase().contains("stereo")
                || name.to_lowercase().contains("master");
            serde_json::json!({
                "id": format!("track_{}", idx + 1),
                "index": idx + 1,
                "name": name,
                "type": if is_master { "master" } else { "audio" },
                "volumeDb": 0.0,
                "pan": 0.0,
                "isMuted": false,
                "isSoloed": false,
                "isSelected": idx == 0,
                "insertSlots": []
            })
        })
        .collect();

    // Ensure Stereo Out is always present as the last entry if not already included
    let has_master = tracks.iter().any(|t| {
        t.get("type")
            .and_then(|v| v.as_str())
            .map(|s| s == "master")
            .unwrap_or(false)
    });

    if !has_master {
        tracks.push(serde_json::json!({
            "id": "track_master",
            "index": 0,
            "name": "Stereo Out",
            "type": "master",
            "volumeDb": 0.0,
            "pan": 0.0,
            "isMuted": false,
            "isSoloed": false,
            "isSelected": false,
            "insertSlots": []
        }));
    }

    tracks
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcu_lcd_sysex_parsing() {
        let mut lcd = McuLcdState::default();

        // Simulate Logic Pro broadcasting 8 track names on Line 1
        // Each slot is exactly 7 chars: "Audio 1", "Drums  ", "Bass   ", …
        let mut sysex = vec![0xF0, 0x00, 0x00, 0x66, 0x14, 0x12, 0x00];
        let text = b"Audio 1Drums  Bass   Guitar Keys   Vox    Pad    StereoO";
        sysex.extend_from_slice(text);
        sysex.push(0xF7);

        assert!(lcd.update_from_sysex(&sysex));
        let tracks = lcd.extract_track_names();

        assert_eq!(tracks.len(), 8);
        assert_eq!(tracks[0], "Audio 1");
        assert_eq!(tracks[1], "Drums");
        assert_eq!(tracks[2], "Bass");
        assert_eq!(tracks[7], "StereoO");
    }

    #[test]
    fn test_automation_and_assignment_notes() {
        assert_eq!(AutomationMode::Read.note_number(), 0x4A);
        assert_eq!(AutomationMode::Off.note_number(), 0x4A);
        assert_eq!(AutomationMode::Write.note_number(), 0x4B);
        assert_eq!(AutomationMode::Trim.note_number(), 0x4C);
        assert_eq!(AutomationMode::Touch.note_number(), 0x4D);
        assert_eq!(AutomationMode::Latch.note_number(), 0x4E);
        assert_eq!(AutomationMode::Group.note_number(), 0x4F);

        assert_eq!(AssignmentMode::EQ.note_number(), 0x2A);
        assert_eq!(AssignmentMode::Track.note_number(), 0x28);
    }

    #[test]
    fn test_build_track_list_adds_master_if_missing() {
        let names = vec!["Audio 1".to_string(), "Bass".to_string()];
        let tracks = build_track_list(&names);
        assert!(tracks
            .iter()
            .any(|t| t["type"].as_str() == Some("master")));
    }

    #[test]
    fn test_build_track_list_no_duplicate_master() {
        let names = vec!["Audio 1".to_string(), "Stereo Out".to_string()];
        let tracks = build_track_list(&names);
        let master_count = tracks
            .iter()
            .filter(|t| t["type"].as_str() == Some("master"))
            .count();
        assert_eq!(master_count, 1);
    }

    #[test]
    fn test_mcu_command_matrix_notes() {
        assert_eq!(MCU_NOTE_PLAY, 94);
        assert_eq!(MCU_NOTE_STOP, 93);
        assert_eq!(MCU_NOTE_REWIND, 91);
        assert_eq!(MCU_NOTE_FAST_FORWARD, 92);
        assert_eq!(MCU_NOTE_CYCLE, 86);
        assert_eq!(MCU_NOTE_RECORD, 95);

        assert_eq!(MCU_NOTE_CURSOR_UP, 96);
        assert_eq!(MCU_NOTE_CURSOR_DOWN, 97);
        assert_eq!(MCU_NOTE_CURSOR_LEFT, 98);
        assert_eq!(MCU_NOTE_CURSOR_RIGHT, 99);
        assert_eq!(MCU_NOTE_ZOOM_TOGGLE, 100);
        assert_eq!(MCU_NOTE_SCRUB, 101);

        assert_eq!(MCU_NOTE_BANK_LEFT, 46);
        assert_eq!(MCU_NOTE_BANK_RIGHT, 47);
        assert_eq!(MCU_NOTE_CHANNEL_LEFT, 48);
        assert_eq!(MCU_NOTE_CHANNEL_RIGHT, 49);
        assert_eq!(MCU_NOTE_FLIP, 50);
        assert_eq!(MCU_NOTE_GLOBAL_VIEW, 51);

        assert_eq!(MCU_NOTE_REC_BASE, 0);
        assert_eq!(MCU_NOTE_SOLO_BASE, 8);
        assert_eq!(MCU_NOTE_MUTE_BASE, 16);
        assert_eq!(MCU_NOTE_SELECT_BASE, 24);
        assert_eq!(MCU_NOTE_VPOT_CLICK_BASE, 32);

        assert_eq!(MCU_NOTE_TOUCH_BASE, 104);
        assert_eq!(MCU_NOTE_TOUCH_MASTER, 112);

        assert_eq!(MCU_NOTE_SAVE, 80);
        assert_eq!(MCU_NOTE_UNDO, 81);
        assert_eq!(MCU_NOTE_CANCEL, 82);
        assert_eq!(MCU_NOTE_ENTER, 83);
        assert_eq!(MCU_NOTE_MARKER, 84);
        assert_eq!(MCU_NOTE_NUDGE, 85);
        assert_eq!(MCU_NOTE_DROP, 87);
        assert_eq!(MCU_NOTE_REPLACE, 88);
        assert_eq!(MCU_NOTE_CLICK, 89);
        assert_eq!(MCU_NOTE_SOLO_CLEAR, 90);

        assert_eq!(MCU_NOTE_AUTO_READ, 74);
        assert_eq!(MCU_NOTE_AUTO_WRITE, 75);
        assert_eq!(MCU_NOTE_AUTO_TRIM, 76);
        assert_eq!(MCU_NOTE_AUTO_TOUCH, 77);
        assert_eq!(MCU_NOTE_AUTO_LATCH, 78);
        assert_eq!(MCU_NOTE_AUTO_GROUP, 79);
    }

    #[test]
    fn test_db_to_mcu_pitchbend_calibration() {
        // 0.0 dB should calibrate to exactly 10240 (0x2800)
        assert_eq!(db_to_mcu_pitchbend(0.0), 10240);

        // -6.0 dB should calibrate to exactly 8192 (0x2000)
        assert_eq!(db_to_mcu_pitchbend(-6.0), 8192);

        // -inf / <= -96.0 dB should calibrate to 0
        assert_eq!(db_to_mcu_pitchbend(-96.0), 0);
        assert_eq!(db_to_mcu_pitchbend(-100.0), 0);

        // +6.0 dB should calibrate to 16383 (0x3FFF)
        assert_eq!(db_to_mcu_pitchbend(6.0), 16383);
        assert_eq!(db_to_mcu_pitchbend(10.0), 16383);

        // Verify MSB/LSB for 0.0 dB
        let pb = db_to_mcu_pitchbend(0.0);
        let lsb = (pb & 0x7F) as u8;
        let msb = ((pb >> 7) & 0x7F) as u8;
        assert_eq!(lsb, 0x00);
        assert_eq!(msb, 0x50); // 80 * 128 = 10240

        // Verify MSB/LSB for -6.0 dB
        let pb_neg6 = db_to_mcu_pitchbend(-6.0);
        let lsb_neg6 = (pb_neg6 & 0x7F) as u8;
        let msb_neg6 = ((pb_neg6 >> 7) & 0x7F) as u8;
        assert_eq!(lsb_neg6, 0x00);
        assert_eq!(msb_neg6, 0x40); // 64 * 128 = 8192
    }

    #[test]
    fn test_vpot_turn_encoding() {
        let bridge = McuBridge::new();
        let _ = bridge.start();
        // Delta 0 is a no-op
        assert!(bridge.send_vpot_turn(0, 0).is_ok());
        // Invalid channel index (> 7) returns Err
        assert!(bridge.send_vpot_turn(8, 1).is_err());
        // If virtual CoreMIDI is active on macOS, sending delta succeeds
        #[cfg(target_os = "macos")]
        if bridge.virtual_source.lock().map(|g| g.is_some()).unwrap_or(false) {
            assert!(bridge.send_vpot_turn(0, 5).is_ok());
            assert!(bridge.send_vpot_turn(0, -5).is_ok());
        }
    }

    #[test]
    fn test_lcd_text_and_touch() {
        let bridge = McuBridge::new();
        let _ = bridge.start();
        // Invalid channel indices return Err
        assert!(bridge.set_lcd_text(8, "Fail", "Fail").is_err());
        assert!(bridge.set_fader_touch(9, true).is_err());

        #[cfg(target_os = "macos")]
        if bridge.virtual_source.lock().map(|g| g.is_some()).unwrap_or(false) {
            assert!(bridge.set_lcd_text(0, "Vocal", "-3.5dB").is_ok());
            assert!(bridge.set_fader_touch(0, true).is_ok());
            assert!(bridge.set_fader_touch(8, false).is_ok());
        }
    }
}
