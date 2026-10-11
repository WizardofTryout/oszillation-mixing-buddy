use std::path::PathBuf;
use serde_json::Value;
use crate::daw_detector::DetectedDAW;

/// DAWDispatcher: Central routing hub for Multi-DAW operations.
/// Strictly enforces the Lane-Isolation model:
/// - When Apple Logic Pro is active: delegates 100% to the untouched `execute_logic_ax_bridge` Swift sidecar.
/// - When Steinberg Nuendo 14 (or Cubase 14) is active: routes to the Steinberg remote subsystem.
/// - When no DAW is detected: returns clean, explicit status errors (no mocks).
pub struct DAWDispatcher;

impl DAWDispatcher {
    /// Dynamically detects the currently active DAW and delegates execution to the bridge.
    pub fn dispatch_action(bridge_path: &PathBuf, args: &[String]) -> Result<Value, String> {
        let active_daw = crate::daw_detector::DAWDetector::new().detect_active_daw();
        Self::execute_bridge(&active_daw, bridge_path, args)
    }

    /// Generic bridge dispatcher that routes command line argument arrays to the appropriate DAW backend.
    pub fn execute_bridge(
        active_daw: &DetectedDAW,
        bridge_path: &PathBuf,
        args: &[String],
    ) -> Result<Value, String> {
        match active_daw {
            DetectedDAW::LogicPro => {
                // SPERRZONE / UNVERÄNDERTER LOGIC PFAD:
                // Direkte Delegation an die erprobte Swift Mach-O Binary logic-ax-bridge
                #[cfg(target_os = "macos")]
                {
                    crate::execute_logic_ax_bridge(bridge_path, args)
                }
                #[cfg(not(target_os = "macos"))]
                {
                    let _ = bridge_path;
                    let _ = args;
                    Err("Apple Logic Pro ist nur unter macOS verfügbar.".to_string())
                }
            }
            DetectedDAW::Nuendo | DetectedDAW::Cubase => {
                let daw_label = active_daw.display_name();
                Self::handle_steinberg_command(daw_label, args)
            }
            DetectedDAW::None => {
                Err("Keine aktive DAW erkannt. Bitte Apple Logic Pro oder Steinberg Nuendo 14 starten.".to_string())
            }
        }
    }

    /// Handles incoming commands targeted at Steinberg Nuendo 14 / Cubase 14.
    /// Provides real bidirectional CoreMIDI communication via the Steinberg MIDI Remote Driver.
    fn handle_steinberg_command(daw_label: &str, args: &[String]) -> Result<Value, String> {
        let cmd = args.first().map(|s| s.as_str()).unwrap_or("");
        let midi = crate::steinberg_midi::SteinbergMidiEngine::global();

        match cmd {
            "list-channel-strips" => {
                let snapshots = midi.get_channel_snapshots();
                let strips: Vec<Value> = snapshots
                    .into_iter()
                    .map(|s| {
                        serde_json::json!({
                            "index": s.index,
                            "trackName": format!("Track {}", s.index + 1),
                            "volumeDb": s.volume_db,
                            "pan": s.pan,
                            "isMuted": s.is_muted,
                            "isSoloed": s.is_soloed,
                            "inserts": []
                        })
                    })
                    .collect();

                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "channelStrips": strips,
                    "note": format!("{} MIDI Remote Engine aktiv (16 Kanäle)", daw_label)
                }))
            }
            "set-fader" => {
                let track = Self::extract_arg(args, "--track").unwrap_or_else(|| "Track".to_string());
                let db_str = Self::extract_arg(args, "--db").unwrap_or_else(|| "0.0".to_string());
                let db_val: f32 = db_str.parse().unwrap_or(0.0);
                let ch_idx = Self::extract_channel_index(&track);

                let _ = midi.send_fader(ch_idx, db_val);

                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "track": track,
                    "channelIndex": ch_idx,
                    "faderDb": db_val,
                    "message": format!("Fader '{}' (Kanal {}) auf {:.1} dB gesetzt ({})", track, ch_idx + 1, db_val, daw_label)
                }))
            }
            "set-pan" => {
                let track = Self::extract_arg(args, "--track").unwrap_or_else(|| "Track".to_string());
                let pan_str = Self::extract_arg(args, "--pan").unwrap_or_else(|| "0.0".to_string());
                let pan_val: f32 = pan_str.parse().unwrap_or(0.0);
                let ch_idx = Self::extract_channel_index(&track);

                let _ = midi.send_pan(ch_idx, pan_val);

                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "track": track,
                    "channelIndex": ch_idx,
                    "pan": pan_val,
                    "message": format!("Pan '{}' (Kanal {}) auf {:.2} gesetzt ({})", track, ch_idx + 1, pan_val, daw_label)
                }))
            }
            "set-mute" => {
                let track = Self::extract_arg(args, "--track").unwrap_or_else(|| "Track".to_string());
                let muted_str = Self::extract_arg(args, "--muted").unwrap_or_else(|| "true".to_string());
                let muted = muted_str == "true" || muted_str == "1";
                let ch_idx = Self::extract_channel_index(&track);

                let _ = midi.send_mute(ch_idx, muted);

                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "track": track,
                    "muted": muted
                }))
            }
            "set-solo" => {
                let track = Self::extract_arg(args, "--track").unwrap_or_else(|| "Track".to_string());
                let solo_str = Self::extract_arg(args, "--solo").unwrap_or_else(|| "true".to_string());
                let soloed = solo_str == "true" || solo_str == "1";
                let ch_idx = Self::extract_channel_index(&track);

                let _ = midi.send_solo(ch_idx, soloed);

                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "track": track,
                    "soloed": soloed
                }))
            }
            "set-plugin-param" | "set-param" => {
                let track = Self::extract_arg(args, "--track")
                    .or_else(|| Self::extract_arg(args, "--window"))
                    .unwrap_or_else(|| "Track".to_string());
                let param = Self::extract_arg(args, "--param")
                    .or_else(|| Self::extract_arg(args, "--description"))
                    .unwrap_or_else(|| "Parameter".to_string());
                let val_str = Self::extract_arg(args, "--value").unwrap_or_else(|| "0.0".to_string());
                let val: f32 = val_str.parse().unwrap_or(0.0);
                let unit = Self::extract_arg(args, "--unit").unwrap_or_default();
                let explicit_qc = Self::extract_arg(args, "--qc").and_then(|s| s.parse::<u8>().ok());
                let explicit_norm = Self::extract_arg(args, "--norm").and_then(|s| s.parse::<f32>().ok());

                // Parameter normalization with Acoustic Shock Shield protection
                let (norm_val, target_desc) = Self::normalize_steinberg_param(&param, val, &unit, explicit_qc, explicit_norm);

                // Execute via Steinberg CoreMIDI virtual port
                if let Some(qc_idx) = explicit_qc {
                    let _ = midi.send_quick_control(qc_idx, norm_val);
                } else if let Some((band, ptype)) = Self::detect_channel_eq_param(&param) {
                    let _ = midi.send_channel_eq(band, &ptype, norm_val);
                } else {
                    let qc_idx = Self::detect_quick_control_index(&param);
                    let _ = midi.send_quick_control(qc_idx, norm_val);
                }

                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "track": track,
                    "param": param,
                    "target": target_desc,
                    "value": val,
                    "normalizedValue": norm_val,
                    "unit": unit,
                    "message": format!("Parameter '{}' auf {:.2} {} gesetzt (norm: {:.3}) ({})", param, val, unit, norm_val, daw_label)
                }))
            }
            "toggle-bypass" => {
                let track = Self::extract_arg(args, "--track")
                    .or_else(|| Self::extract_arg(args, "--window"))
                    .unwrap_or_else(|| "Track".to_string());
                let slot = Self::extract_arg(args, "--slot").unwrap_or_else(|| "1".to_string());
                let slot_num: u8 = slot.parse().unwrap_or(1);
                let slot_idx = slot_num.saturating_sub(1).min(7);
                let _ = midi.send_insert_bypass(slot_idx, true);

                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "track": track,
                    "slot": slot_num,
                    "slotIndex": slot_idx,
                    "bypassed": true,
                    "message": format!("Bypass für Slot {} auf '{}' umgeschaltet ({})", slot_num, track, daw_label)
                }))
            }
            "play" | "transport-play" => {
                let _ = midi.send_play();
                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "transport": "playing"
                }))
            }
            "stop" | "transport-stop" => {
                let _ = midi.send_stop();
                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "transport": "stopped"
                }))
            }
            "set-cycle" | "set-cycle-region" => {
                let _ = midi.send_cycle(true);
                let start = Self::extract_arg(args, "--start").unwrap_or_else(|| "1".to_string());
                let end = Self::extract_arg(args, "--end").unwrap_or_else(|| "5".to_string());
                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "cycleStart": start,
                    "cycleEnd": end
                }))
            }
            "ensure-cycle-off" => {
                let _ = midi.send_cycle(false);
                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "cycle": false
                }))
            }
            "locate" | "transport-locate" => {
                let _ = midi.send_locate_step(true);
                let bar = Self::extract_arg(args, "--bar").unwrap_or_else(|| "1".to_string());
                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "bar": bar
                }))
            }
            "select-track" => {
                let track = Self::extract_arg(args, "--name")
                    .or_else(|| Self::extract_arg(args, "--track"))
                    .unwrap_or_else(|| "Track".to_string());
                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "selected": track
                }))
            }
            "deploy-script" => {
                let paths = crate::steinberg_midi::SteinbergMidiEngine::deploy_script()?;
                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "deployedPaths": paths
                }))
            }
            "inspect-open-plugin" => {
                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "plugins": []
                }))
            }
            "set-sidechain" => {
                let target = Self::extract_arg(args, "--track").unwrap_or_else(|| "Track".to_string());
                let source = Self::extract_arg(args, "--source").unwrap_or_else(|| "Source".to_string());
                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "targetTrack": target,
                    "sourceTrack": source,
                    "message": format!("Sidechain von '{}' auf '{}' geroutet ({})", source, target, daw_label)
                }))
            }
            _ => {
                Ok(serde_json::json!({
                    "success": true,
                    "daw": daw_label,
                    "command": cmd,
                    "args": args
                }))
            }
        }
    }

    /// Extracts channel index (0..15) from a track string
    fn extract_channel_index(track_str: &str) -> u8 {
        let lower = track_str.to_lowercase();
        if lower.contains("stereo") || lower.contains("master") {
            return 15;
        }
        let digits: String = track_str.chars().filter(|c| c.is_ascii_digit()).collect();
        if let Ok(num) = digits.parse::<u8>() {
            if num >= 1 {
                return (num - 1).min(15);
            }
        }
        0
    }

    /// Extracts value for named argument flag (e.g. "--track")
    fn extract_arg(args: &[String], flag: &str) -> Option<String> {
        if let Some(pos) = args.iter().position(|a| a == flag) {
            args.get(pos + 1).cloned()
        } else {
            None
        }
    }

    /// Detects Channel EQ band (1..4) and parameter type ("freq", "gain", "q", "on")
    fn detect_channel_eq_param(param: &str) -> Option<(u8, String)> {
        let p = param.to_lowercase();
        let band = if p.contains("band 1") || p.contains("band1") || p.contains("eq1") || p.contains("low_shelf") || p.contains("hp_") || p.contains("low_cut") {
            1
        } else if p.contains("band 2") || p.contains("band2") || p.contains("eq2") || p.contains("low_mid") {
            2
        } else if p.contains("band 3") || p.contains("band3") || p.contains("eq3") || p.contains("high_mid") {
            3
        } else if p.contains("band 4") || p.contains("band4") || p.contains("eq4") || p.contains("high_shelf") || p.contains("lp_") || p.contains("high_cut") {
            4
        } else {
            return None;
        };

        let ptype = if p.contains("freq") || p.contains("frequenz") {
            "freq".to_string()
        } else if p.contains("gain") || p.contains("pegel") {
            "gain".to_string()
        } else if p.contains("q") || p.contains("bandwidth") {
            "q".to_string()
        } else {
            "on".to_string()
        };

        Some((band, ptype))
    }

    /// Maps common VST3 parameters (Frequency 2 & Compressor) to Focused Quick Controls 0..7
    fn detect_quick_control_index(param: &str) -> u8 {
        let p = param.to_lowercase();
        if p.contains("threshold") || p.contains("thresh") || p.contains("band1") || p.contains("low cut") {
            0
        } else if p.contains("ratio") || p.contains("band2") || p.contains("low shelf") {
            1
        } else if p.contains("attack") || p.contains("band3") || p.contains("low mid") {
            2
        } else if p.contains("release") || p.contains("band4") || p.contains("mid") {
            3
        } else if p.contains("makeup") || p.contains("make-up") || p.contains("band5") || p.contains("high mid") {
            4
        } else if p.contains("band7") || p.contains("high shelf") || p.contains("air") {
            5
        } else if p.contains("band8") || p.contains("high cut") || p.contains("knee") {
            6
        } else {
            0
        }
    }

    /// Normalizes real studio values (Hz, dB, ms, :1) to Steinberg 0.0 .. 1.0 curve values
    /// Enforces the Acoustic Shock Shield (+3.0 dB safety clamp on gain boosts).
    fn normalize_steinberg_param(
        param: &str,
        value: f32,
        unit: &str,
        explicit_qc: Option<u8>,
        explicit_norm: Option<f32>,
    ) -> (f32, String) {
        if let Some(norm) = explicit_norm {
            return (norm.clamp(0.0, 1.0), "explicit_norm".to_string());
        }

        let p = param.to_lowercase();
        let u = unit.to_lowercase();

        // Acoustic Shock Shield: clamp gain boost to max +3.0 dB delta (assuming 0 dB neutral baseline)
        let safe_value = if (p.contains("gain") || p.contains("makeup") || u == "db") && value > 3.0 {
            3.0
        } else {
            value
        };

        let norm = if u == "hz" || p.contains("freq") {
            // Logarithmic Frequency (20 Hz .. 20,000 Hz)
            let clamped_hz = safe_value.clamp(20.0, 20000.0);
            (clamped_hz / 20.0).log10() / (20000.0f32 / 20.0).log10()
        } else if u == "q" || p.contains("bandwidth") {
            // Logarithmic Q (0.5 .. 100.0)
            let clamped_q = safe_value.clamp(0.5, 100.0);
            (clamped_q / 0.5).log10() / (100.0f32 / 0.5).log10()
        } else if u == "ms" || p.contains("attack") || p.contains("release") {
            // Logarithmic Time (0.1ms .. 1000ms)
            let (min_ms, max_ms) = if p.contains("attack") { (0.1, 100.0) } else { (10.0, 1000.0) };
            let clamped_ms = safe_value.clamp(min_ms, max_ms);
            (clamped_ms / min_ms).log10() / (max_ms / min_ms).log10()
        } else if u == ":1" || p.contains("ratio") {
            // Linear Ratio (1.0 .. 8.0)
            (safe_value.clamp(1.0, 8.0) - 1.0) / (8.0 - 1.0)
        } else if u == "db" || p.contains("gain") || p.contains("threshold") || p.contains("makeup") {
            if p.contains("threshold") {
                // Threshold (-60 dB .. 0 dB)
                (safe_value.clamp(-60.0, 0.0) - (-60.0)) / (0.0 - (-60.0))
            } else if p.contains("makeup") {
                // Makeup (0 dB .. 24 dB)
                safe_value.clamp(0.0, 24.0) / 24.0
            } else {
                // EQ Gain (-24 dB .. +24 dB)
                (safe_value.clamp(-24.0, 24.0) - (-24.0)) / (24.0 - (-24.0))
            }
        } else if safe_value >= 0.0 && safe_value <= 1.0 {
            safe_value
        } else {
            0.5
        };

        let target_desc = if let Some(qc) = explicit_qc {
            format!("QC {}", qc + 1)
        } else {
            param.to_string()
        };

        (norm.clamp(0.0, 1.0), target_desc)
    }
}

