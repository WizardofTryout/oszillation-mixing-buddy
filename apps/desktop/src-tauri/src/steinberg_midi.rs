use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};

/// Embedded source of the Steinberg MIDI Remote script for deployment
pub const EMBEDDED_SCRIPT_JS: &str = include_str!("../../../../packages/daw-adapters/src/nuendo/scripts/Oszillation_MixingBuddy.js");

static INSTANCE: OnceLock<Arc<SteinbergMidiEngine>> = OnceLock::new();

/// Represents live channel state monitored via MIDI Remote
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SteinbergChannelState {
    pub index: u8,
    pub volume_db: f32,
    pub pan: f32,
    pub is_muted: bool,
    pub is_soloed: bool,
}

/// Steinberg MIDI Engine: Native virtual MIDI port provider for Nuendo 14 and Cubase 14.
/// Opens CoreMIDI virtual endpoints on macOS:
/// - VirtualSource: "MixingBuddy Out" (Nuendo connects as MIDI In)
/// - VirtualDestination: "MixingBuddy In" (Nuendo sends feedback to this MIDI Out)
pub struct SteinbergMidiEngine {
    #[cfg(target_os = "macos")]
    virtual_source: Mutex<Option<coremidi::VirtualSource>>,
    #[cfg(target_os = "macos")]
    _virtual_destination: Mutex<Option<coremidi::VirtualDestination>>,
    #[cfg(target_os = "macos")]
    _client: Mutex<Option<coremidi::Client>>,

    pub channel_volumes: Mutex<[f32; 16]>,
    pub channel_pans: Mutex<[f32; 16]>,
    pub channel_mutes: Mutex<[bool; 16]>,
    pub channel_solos: Mutex<[bool; 16]>,

    pub is_playing: AtomicBool,
    pub is_cycle: AtomicBool,
    pub is_connected: AtomicBool,
}

impl SteinbergMidiEngine {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "macos")]
            virtual_source: Mutex::new(None),
            #[cfg(target_os = "macos")]
            _virtual_destination: Mutex::new(None),
            #[cfg(target_os = "macos")]
            _client: Mutex::new(None),

            channel_volumes: Mutex::new([0.0; 16]),
            channel_pans: Mutex::new([0.0; 16]),
            channel_mutes: Mutex::new([false; 16]),
            channel_solos: Mutex::new([false; 16]),

            is_playing: AtomicBool::new(false),
            is_cycle: AtomicBool::new(false),
            is_connected: AtomicBool::new(false),
        }
    }

    /// Global singleton instance
    pub fn global() -> Arc<Self> {
        INSTANCE
            .get_or_init(|| {
                let engine = Arc::new(Self::new());
                let _ = engine.start();
                engine
            })
            .clone()
    }

    /// Initializes CoreMIDI virtual ports for bidirectional Steinberg communication
    pub fn start(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            println!("🎹 [Steinberg MIDI] Initializing virtual CoreMIDI ports for Nuendo 14 / Cubase…");

            let client = coremidi::Client::new("Oszillation Mixing Buddy Steinberg")
                .map_err(|e| format!("CoreMIDI Client creation failed: OSStatus {}", e))?;

            // VirtualSource: Mixing Buddy → Nuendo 14 (Nuendo's MIDI Input)
            let virtual_src = client
                .virtual_source("MixingBuddy Out")
                .map_err(|e| format!("VirtualSource 'MixingBuddy Out' creation failed: OSStatus {}", e))?;

            // VirtualDestination: Nuendo 14 → Mixing Buddy (Nuendo's MIDI Output / Feedback)
            let volumes_ref = Arc::new(Mutex::new([0.0f32; 16]));
            let pans_ref = Arc::new(Mutex::new([0.0f32; 16]));
            let mutes_ref = Arc::new(Mutex::new([false; 16]));
            let solos_ref = Arc::new(Mutex::new([false; 16]));

            let virtual_dst = client
                .virtual_destination("MixingBuddy In", move |packet_list| {
                    for packet in packet_list.iter() {
                        let data = packet.data();
                        let mut i = 0;
                        while i + 2 < data.len() {
                            let status = data[i];
                            let cc = data[i + 1];
                            let val = data[i + 2];

                            if (status & 0xF0) == 0xB0 {
                                // CC on MIDI Channel 1..16
                                if cc < 16 {
                                    // Fader feedback (CC 0..15)
                                    let norm = val as f32 / 127.0;
                                    let db = if norm > 0.001 {
                                        (norm / 0.75).log10() * 40.0
                                    } else {
                                        -96.0
                                    };
                                    if let Ok(mut v) = volumes_ref.lock() {
                                        v[cc as usize] = db;
                                    }
                                } else if cc >= 16 && cc < 32 {
                                    // Pan feedback (CC 16..31)
                                    let pan = ((val as f32 / 127.0) * 2.0) - 1.0;
                                    if let Ok(mut p) = pans_ref.lock() {
                                        p[(cc - 16) as usize] = pan;
                                    }
                                } else if cc >= 32 && cc < 48 {
                                    // Mute feedback (CC 32..47)
                                    if let Ok(mut m) = mutes_ref.lock() {
                                        m[(cc - 32) as usize] = val > 63;
                                    }
                                } else if cc >= 48 && cc < 64 {
                                    // Solo feedback (CC 48..63)
                                    if let Ok(mut s) = solos_ref.lock() {
                                        s[(cc - 48) as usize] = val > 63;
                                    }
                                }
                            }
                            i += 3;
                        }
                    }
                })
                .map_err(|e| format!("VirtualDestination 'MixingBuddy In' creation failed: OSStatus {}", e))?;

            println!("✅ [Steinberg MIDI] Virtual CoreMIDI ports created:");
            println!("   - Virtual Source:      'MixingBuddy Out' (Nuendo Input)");
            println!("   - Virtual Destination: 'MixingBuddy In'  (Nuendo Output)");

            if let Ok(mut g) = self.virtual_source.lock() {
                *g = Some(virtual_src);
            }
            if let Ok(mut g) = self._virtual_destination.lock() {
                *g = Some(virtual_dst);
            }
            if let Ok(mut g) = self._client.lock() {
                *g = Some(client);
            }

            self.is_connected.store(true, Ordering::SeqCst);
            Ok(())
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.is_connected.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    /// Sends raw MIDI bytes to Nuendo 14 via the virtual source
    pub fn send_bytes(&self, bytes: &[u8]) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let guard = self
                .virtual_source
                .lock()
                .map_err(|_| "Mutex poisoned".to_string())?;

            if let Some(ref src) = *guard {
                let packet_buf = coremidi::PacketBuffer::new(0, bytes);
                src.received(&packet_buf)
                    .map_err(|e| format!("CoreMIDI send failed: OSStatus {}", e))?;
                Ok(())
            } else {
                Err("Steinberg MIDI VirtualSource not initialized".to_string())
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = bytes;
            Ok(())
        }
    }

    /// Sets Volume Fader for track channel (0..15) with standard DAW logarithmic dB scaling
    pub fn send_fader(&self, channel: u8, db: f32) -> Result<(), String> {
        let ch = channel.min(15);
        let clamped_db = db.clamp(-96.0, 6.0);

        // Update internal cache
        if let Ok(mut vols) = self.channel_volumes.lock() {
            vols[ch as usize] = clamped_db;
        }

        // dB to normalized fader curve (0 dB at 0.75, +6 dB at 1.0, -96 dB at 0.0)
        let normalized = if clamped_db <= -96.0 {
            0.0f32
        } else {
            10.0f32.powf(clamped_db / 40.0) * 0.75
        }
        .clamp(0.0, 1.0);

        let midi_val_14bit = (normalized * 16383.0).round() as u16;
        let msb = ((midi_val_14bit >> 7) & 0x7F) as u8;
        let lsb = (midi_val_14bit & 0x7F) as u8;

        // Send 14-bit CC on MIDI Channel 1 (0xB0): CC ch (MSB) + CC ch+32 (LSB)
        self.send_bytes(&[0xB0, ch, msb])?;
        self.send_bytes(&[0xB0, ch + 32, lsb])?;
        Ok(())
    }

    /// Sets Stereo Pan for track channel (0..15) with -1.0 (L) .. 0.0 (C) .. +1.0 (R)
    pub fn send_pan(&self, channel: u8, pan: f32) -> Result<(), String> {
        let ch = channel.min(15);
        let clamped_pan = pan.clamp(-1.0, 1.0);

        if let Ok(mut pans) = self.channel_pans.lock() {
            pans[ch as usize] = clamped_pan;
        }

        // Convert -1.0..+1.0 to 0..127 (Center = 64)
        let midi_val = (((clamped_pan + 1.0) / 2.0) * 127.0).round().clamp(0.0, 127.0) as u8;
        self.send_bytes(&[0xB0, 16 + ch, midi_val])
    }

    /// Sets Mute state for track channel (0..15)
    pub fn send_mute(&self, channel: u8, muted: bool) -> Result<(), String> {
        let ch = channel.min(15);
        if let Ok(mut mutes) = self.channel_mutes.lock() {
            mutes[ch as usize] = muted;
        }
        let val = if muted { 127 } else { 0 };
        self.send_bytes(&[0xB0, 32 + ch, val])
    }

    /// Sets Solo state for track channel (0..15)
    pub fn send_solo(&self, channel: u8, soloed: bool) -> Result<(), String> {
        let ch = channel.min(15);
        if let Ok(mut solos) = self.channel_solos.lock() {
            solos[ch as usize] = soloed;
        }
        let val = if soloed { 127 } else { 0 };
        self.send_bytes(&[0xB0, 48 + ch, val])
    }

    /// Starts Playback in Nuendo 14 / Cubase 14 (CC 114)
    pub fn send_play(&self) -> Result<(), String> {
        self.is_playing.store(true, Ordering::SeqCst);
        self.send_bytes(&[0xB0, 114, 127])
    }

    /// Stops Playback in Nuendo 14 / Cubase 14 (CC 115)
    pub fn send_stop(&self) -> Result<(), String> {
        self.is_playing.store(false, Ordering::SeqCst);
        self.send_bytes(&[0xB0, 115, 127])
    }

    /// Sets Cycle / Loop mode (CC 116)
    pub fn send_cycle(&self, active: bool) -> Result<(), String> {
        self.is_cycle.store(active, Ordering::SeqCst);
        let val = if active { 127 } else { 0 };
        self.send_bytes(&[0xB0, 116, val])
    }

    /// Locates to previous/next marker or step (CC 117 / 118)
    pub fn send_locate_step(&self, forward: bool) -> Result<(), String> {
        let cc = if forward { 118 } else { 117 };
        self.send_bytes(&[0xB0, cc, 127])
    }

    /// Sets Channel EQ parameter (Band 1..4: freq, gain, q, on) via CC 64..79
    pub fn send_channel_eq(&self, band: u8, param_type: &str, val_norm: f32) -> Result<(), String> {
        let b = band.clamp(1, 4);
        let base_cc = 64 + (b - 1) * 4;
        let offset = match param_type {
            "freq" | "frequency" => 0,
            "gain" => 1,
            "q" => 2,
            _ => 3, // "on" / "bypass"
        };
        let val = (val_norm.clamp(0.0, 1.0) * 127.0).round() as u8;
        self.send_bytes(&[0xB0, base_cc + offset, val])
    }

    /// Controls Focused Quick Controls (0..7) for VST3 plugins (e.g. Frequency 2, Compressor) via CC 80..87
    pub fn send_quick_control(&self, qc_idx: u8, val_norm: f32) -> Result<(), String> {
        let qc = qc_idx.min(7);
        let val = (val_norm.clamp(0.0, 1.0) * 127.0).round() as u8;
        self.send_bytes(&[0xB0, 80 + qc, val])
    }

    /// Toggles Insert Slot Bypass (Slot 0..7) on the selected channel via CC 88..95
    pub fn send_insert_bypass(&self, slot_idx: u8, bypassed: bool) -> Result<(), String> {
        let slot = slot_idx.min(7);
        let val = if bypassed { 127 } else { 0 };
        self.send_bytes(&[0xB0, 88 + slot, val])
    }


    /// Retrieves snapshot of all 16 monitored channels
    pub fn get_channel_snapshots(&self) -> Vec<SteinbergChannelState> {
        let vols = self.channel_volumes.lock().map(|v| *v).unwrap_or([0.0; 16]);
        let pans = self.channel_pans.lock().map(|p| *p).unwrap_or([0.0; 16]);
        let mutes = self.channel_mutes.lock().map(|m| *m).unwrap_or([false; 16]);
        let solos = self.channel_solos.lock().map(|s| *s).unwrap_or([false; 16]);

        (0..16)
            .map(|i| SteinbergChannelState {
                index: i as u8,
                volume_db: vols[i],
                pan: pans[i],
                is_muted: mutes[i],
                is_soloed: solos[i],
            })
            .collect()
    }

    /// Deploys the native MIDI Remote Driver Script into the Steinberg User directory
    /// for Nuendo 14, Nuendo 13, Nuendo 12 and Cubase 14, Cubase 13, Cubase 12.
    pub fn deploy_script() -> Result<Vec<String>, String> {
        let home_dir = std::env::var("HOME")
            .map(std::path::PathBuf::from)
            .map_err(|_| "HOME environment variable not found".to_string())?;

        let targets = [
            "Nuendo 14",
            "Nuendo 13",
            "Nuendo 12",
            "Cubase 14",
            "Cubase 13",
            "Cubase 12",
        ];

        let mut deployed_paths = Vec::new();

        for app_name in targets {
            let driver_dir = home_dir
                .join("Documents")
                .join("Steinberg")
                .join(app_name)
                .join("MIDI Remote")
                .join("Driver Scripts")
                .join("Local")
                .join("Oszillation")
                .join("MixingBuddy");

            if let Err(e) = std::fs::create_dir_all(&driver_dir) {
                eprintln!("Could not create driver dir {:?}: {:?}", driver_dir, e);
                continue;
            }

            let script_path = driver_dir.join("Oszillation_MixingBuddy.js");
            if let Err(e) = std::fs::write(&script_path, EMBEDDED_SCRIPT_JS) {
                eprintln!("Could not write script to {:?}: {:?}", script_path, e);
                continue;
            }

            println!("✅ Deployed Steinberg MIDI Remote script to {:?}", script_path);
            deployed_paths.push(script_path.display().to_string());
        }

        if deployed_paths.is_empty() {
            Err("Konnte Steinberg MIDI Remote Skript in kein Zielverzeichnis schreiben.".to_string())
        } else {
            Ok(deployed_paths)
        }
    }
}
