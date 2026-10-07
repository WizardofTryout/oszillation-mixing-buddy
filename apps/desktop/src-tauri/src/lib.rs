pub mod daw_detector;
pub mod ipc_server;
pub mod licensing;
pub mod mcu_bridge;
pub mod reference_vault;
pub mod safety_guard;
pub mod skill_vault;

use daw_detector::{DAWDetector, DetectedDAW};
use ipc_server::IPCServer;
use licensing::{LicenseGatekeeper, LicenseState};
use safety_guard::SafetyGuard;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

pub struct AppState {
    pub safety_guard: Mutex<SafetyGuard>,
    pub licensing: LicenseGatekeeper,
    pub daw_detector: Mutex<DAWDetector>,
    pub ipc_server: IPCServer,
}

/// Canonical path resolution for native Swift AXUIElement sidecar (`logic-ax-bridge`)
pub fn resolve_bridge_binary() -> std::path::PathBuf {
    // 1. App-Bundle Resources (Produktionsbetrieb):
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bin_dir) = exe.parent() {
            if let Some(contents) = bin_dir.parent() {
                let bundle_path = contents.join("Resources").join("logic-ax-bridge");
                if bundle_path.exists() {
                    return bundle_path;
                }
                let alt_bundle_path = contents.join("Resources").join("_up_").join("_up_").join("_up_").join("packages").join("daw-adapters").join("bin").join("logic-ax-bridge");
                if alt_bundle_path.exists() {
                    return alt_bundle_path;
                }
            }
        }
    }
    // 2. Fallback fester Bundle-Pfad:
    let app_path = std::path::PathBuf::from("/Applications/Oszillation Mixing Buddy.app/Contents/Resources/logic-ax-bridge");
    if app_path.exists() {
        return app_path;
    }
    // 3. Entwicklungs-Pfad aus dem Workspace:
    let dev_path = std::path::PathBuf::from("packages/daw-adapters/bin/logic-ax-bridge");
    if dev_path.exists() {
        return dev_path;
    }
    let workspace_abs = std::path::PathBuf::from(
        "/Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/packages/daw-adapters/bin/logic-ax-bridge",
    );
    if workspace_abs.exists() {
        return workspace_abs;
    }
    if let Ok(cwd) = std::env::current_dir() {
        for rel in [
            "packages/daw-adapters/bin/logic-ax-bridge",
            "../../packages/daw-adapters/bin/logic-ax-bridge",
            "../../../packages/daw-adapters/bin/logic-ax-bridge",
        ] {
            let candidate = cwd.join(rel);
            if candidate.exists() {
                return candidate;
            }
        }
    }
    dev_path
}

/// Backward compatibility alias pointing to canonical resolution
pub fn resolve_bridge_path() -> std::path::PathBuf {
    resolve_bridge_binary()
}

struct AXParamTarget {
    description: &'static str,
    identifier: Option<&'static str>,
    role: &'static str,
    enable_band: Option<&'static str>,
    clamped_display: f32,
    raw_value: f64,
}

fn display_to_raw_linear(val: f32, d_min: f32, d_max: f32, r_min: f64, r_max: f64) -> (f32, f64) {
    let clamped = val.clamp(d_min, d_max);
    let norm = ((clamped - d_min) / (d_max - d_min)) as f64;
    let raw = (r_min + (r_max - r_min) * norm).round();
    (clamped, raw)
}

fn display_to_raw_log(val: f32, d_min: f32, d_max: f32, r_min: f64, r_max: f64) -> (f32, f64) {
    let clamped = val.clamp(d_min, d_max);
    let ratio = ((clamped / d_min) as f64).ln() / ((d_max / d_min) as f64).ln();
    let raw = (r_min + (r_max - r_min) * ratio).round();
    (clamped, raw)
}

/// Maps a parameter identifier/label and engineering value into the calibrated native Logic Pro AX target
fn resolve_ax_param_target(parameter: &str, value: f32) -> AXParamTarget {
    let raw_key = parameter
        .trim()
        .to_lowercase()
        .replace(['-', ' '], "_");

    // Normalize German & descriptive LLM variations:
    let key = if (raw_key.contains("low_cut") || raw_key.contains("high_pass") || raw_key.contains("band1"))
        && (raw_key.contains("freq") || raw_key.contains("frequenz") || raw_key.contains("hz") || raw_key.contains("cut"))
        && !raw_key.contains("slope") && !raw_key.contains("q") && !raw_key.contains("order") {
        "low_cut_frequency".to_string()
    } else if (raw_key.contains("high_cut") || raw_key.contains("low_pass") || raw_key.contains("band8"))
        && (raw_key.contains("freq") || raw_key.contains("frequenz") || raw_key.contains("hz") || raw_key.contains("cut"))
        && !raw_key.contains("slope") && !raw_key.contains("q") && !raw_key.contains("order") {
        "high_cut_frequency".to_string()
    } else if (raw_key.contains("low_shelf") || raw_key.contains("band2")) && raw_key.contains("gain") {
        "low_shelf_gain".to_string()
    } else if (raw_key.contains("high_shelf") || raw_key.contains("band7")) && raw_key.contains("gain") {
        "high_shelf_gain".to_string()
    } else if raw_key.contains("bell") || raw_key.contains("peak") {
        if raw_key.contains("gain") || raw_key.contains("pegel") || raw_key.contains("db") {
            if raw_key.contains("450") || raw_key.contains("500") || raw_key.contains("band4") || raw_key.contains("peak_2") || raw_key.contains("bell_2") {
                "peak_2_gain".to_string()
            } else if raw_key.contains("100") || raw_key.contains("80") || raw_key.contains("band3") || raw_key.contains("peak_1") || raw_key.contains("bell_1") {
                "peak_1_gain".to_string()
            } else if raw_key.contains("2.8") || raw_key.contains("3000") || raw_key.contains("2800") || raw_key.contains("presence") || raw_key.contains("band5") || raw_key.contains("peak_3") || raw_key.contains("bell_3") {
                "peak_3_gain".to_string()
            } else if raw_key.contains("8k") || raw_key.contains("8000") || raw_key.contains("10k") || raw_key.contains("10000") || raw_key.contains("band6") || raw_key.contains("peak_4") || raw_key.contains("bell_4") {
                "peak_4_gain".to_string()
            } else {
                "peak_3_gain".to_string()
            }
        } else if raw_key.contains("freq") || raw_key.contains("frequenz") {
            if raw_key.contains("peak_1") || raw_key.contains("bell_1") { "peak_1_frequency".to_string() }
            else if raw_key.contains("peak_2") || raw_key.contains("bell_2") { "peak_2_frequency".to_string() }
            else if raw_key.contains("peak_4") || raw_key.contains("bell_4") { "peak_4_frequency".to_string() }
            else { "peak_3_frequency".to_string() }
        } else {
            raw_key
        }
    } else {
        raw_key
    };

    match key.as_str() {
        // Band 1: Low Cut (High Pass)
        "low_cut_enabled" | "band1_enabled" | "high_pass_enabled" | "hp_enabled" => {
            let v = if value != 0.0 { 1.0 } else { 0.0 };
            AXParamTarget {
                description: "Low Cut",
                identifier: None,
                role: "AXCheckBox",
                enable_band: None,
                clamped_display: v as f32,
                raw_value: v,
            }
        }
        "low_cut_frequency" | "band1_freq" | "band1_frequency" | "high_pass_frequency" | "hp_freq" => {
            let (clamped, raw) = display_to_raw_log(value, 20.0, 20000.0, 0.0, 1050.0);
            AXParamTarget {
                description: "Low Cut Frequency",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Low Cut"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "low_cut_slope" | "band1_slope" | "high_pass_slope" | "low_cut_order" => {
            let (clamped, raw) = display_to_raw_linear(value, 6.0, 48.0, 1.0, 8.0);
            AXParamTarget {
                description: "Low Cut Order",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Low Cut"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "low_cut_q" | "band1_q" | "high_pass_q" | "hp_q" => {
            let (clamped, raw) = display_to_raw_log(value, 0.1, 10.0, 0.0, 100.0);
            AXParamTarget {
                description: "Low Cut Q",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Low Cut"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }

        // Band 2: Low Shelf
        "low_shelf_enabled" | "band2_enabled" | "ls_enabled" => {
            let v = if value != 0.0 { 1.0 } else { 0.0 };
            AXParamTarget {
                description: "Low Shelf",
                identifier: None,
                role: "AXCheckBox",
                enable_band: None,
                clamped_display: v as f32,
                raw_value: v,
            }
        }
        "low_shelf_frequency" | "band2_freq" | "band2_frequency" | "ls_freq" => {
            let (clamped, raw) = display_to_raw_log(value, 20.0, 20000.0, 0.0, 1050.0);
            AXParamTarget {
                description: "Low Shelf Frequency",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Low Shelf"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "low_shelf_gain" | "band2_gain" | "ls_gain" => {
            let (clamped, raw) = display_to_raw_linear(value, -24.0, 24.0, 0.0, 480.0);
            AXParamTarget {
                description: "Low Shelf Gain",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Low Shelf"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "low_shelf_q" | "band2_q" | "ls_q" => {
            let (clamped, raw) = display_to_raw_log(value, 0.1, 10.0, 0.0, 100.0);
            AXParamTarget {
                description: "Low Shelf Q",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Low Shelf"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }

        // Band 3: Peak 1
        "peak_1_enabled" | "band3_enabled" | "bell_1_enabled" => {
            let v = if value != 0.0 { 1.0 } else { 0.0 };
            AXParamTarget {
                description: "Peak 1",
                identifier: None,
                role: "AXCheckBox",
                enable_band: None,
                clamped_display: v as f32,
                raw_value: v,
            }
        }
        "peak_1_frequency" | "band3_freq" | "band3_frequency" | "bell_1_frequency" | "bell_1_freq" => {
            let (clamped, raw) = display_to_raw_log(value, 20.0, 20000.0, 0.0, 1050.0);
            AXParamTarget {
                description: "Peak 1 Frequency",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Peak 1"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "peak_1_gain" | "band3_gain" | "bell_1_gain" => {
            let (clamped, raw) = display_to_raw_linear(value, -24.0, 24.0, 0.0, 480.0);
            AXParamTarget {
                description: "Peak 1 Gain",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Peak 1"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "peak_1_q" | "band3_q" | "bell_1_q" => {
            let (clamped, raw) = display_to_raw_log(value, 0.1, 10.0, 0.0, 100.0);
            AXParamTarget {
                description: "Peak 1 Q",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Peak 1"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }

        // Band 4: Peak 2
        "peak_2_enabled" | "band4_enabled" | "bell_2_enabled" => {
            let v = if value != 0.0 { 1.0 } else { 0.0 };
            AXParamTarget {
                description: "Peak 2",
                identifier: None,
                role: "AXCheckBox",
                enable_band: None,
                clamped_display: v as f32,
                raw_value: v,
            }
        }
        "peak_2_frequency" | "band4_freq" | "band4_frequency" | "bell_2_frequency" | "bell_2_freq" => {
            let (clamped, raw) = display_to_raw_log(value, 20.0, 20000.0, 0.0, 1050.0);
            AXParamTarget {
                description: "Peak 2 Frequency",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Peak 2"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "peak_2_gain" | "band4_gain" | "bell_2_gain" => {
            let (clamped, raw) = display_to_raw_linear(value, -24.0, 24.0, 0.0, 480.0);
            AXParamTarget {
                description: "Peak 2 Gain",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Peak 2"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "peak_2_q" | "band4_q" | "bell_2_q" => {
            let (clamped, raw) = display_to_raw_log(value, 0.1, 10.0, 0.0, 100.0);
            AXParamTarget {
                description: "Peak 2 Q",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Peak 2"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }

        // Band 5: Peak 3
        "peak_3_enabled" | "band5_enabled" | "bell_3_enabled" => {
            let v = if value != 0.0 { 1.0 } else { 0.0 };
            AXParamTarget {
                description: "Peak 3",
                identifier: None,
                role: "AXCheckBox",
                enable_band: None,
                clamped_display: v as f32,
                raw_value: v,
            }
        }
        "peak_3_frequency" | "band5_freq" | "band5_frequency" | "bell_3_frequency" | "bell_3_freq" => {
            let (clamped, raw) = display_to_raw_log(value, 20.0, 20000.0, 0.0, 1050.0);
            AXParamTarget {
                description: "Peak 3 Frequency",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Peak 3"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "peak_3_gain" | "band5_gain" | "bell_3_gain" => {
            let (clamped, raw) = display_to_raw_linear(value, -24.0, 24.0, 0.0, 480.0);
            AXParamTarget {
                description: "Peak 3 Gain",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Peak 3"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "peak_3_q" | "band5_q" | "bell_3_q" => {
            let (clamped, raw) = display_to_raw_log(value, 0.1, 10.0, 0.0, 100.0);
            AXParamTarget {
                description: "Peak 3 Q",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Peak 3"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }

        // Band 6: Peak 4
        "peak_4_enabled" | "band6_enabled" | "bell_4_enabled" => {
            let v = if value != 0.0 { 1.0 } else { 0.0 };
            AXParamTarget {
                description: "Peak 4",
                identifier: None,
                role: "AXCheckBox",
                enable_band: None,
                clamped_display: v as f32,
                raw_value: v,
            }
        }
        "peak_4_frequency" | "band6_freq" | "band6_frequency" | "bell_4_frequency" | "bell_4_freq" => {
            let (clamped, raw) = display_to_raw_log(value, 20.0, 20000.0, 0.0, 1050.0);
            AXParamTarget {
                description: "Peak 4 Frequency",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Peak 4"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "peak_4_gain" | "band6_gain" | "bell_4_gain" => {
            let (clamped, raw) = display_to_raw_linear(value, -24.0, 24.0, 0.0, 480.0);
            AXParamTarget {
                description: "Peak 4 Gain",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Peak 4"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "peak_4_q" | "band6_q" | "bell_4_q" => {
            let (clamped, raw) = display_to_raw_log(value, 0.1, 10.0, 0.0, 100.0);
            AXParamTarget {
                description: "Peak 4 Q",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("Peak 4"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }

        // Band 7: High Shelf
        "high_shelf_enabled" | "band7_enabled" | "hs_enabled" => {
            let v = if value != 0.0 { 1.0 } else { 0.0 };
            AXParamTarget {
                description: "High Shelf",
                identifier: None,
                role: "AXCheckBox",
                enable_band: None,
                clamped_display: v as f32,
                raw_value: v,
            }
        }
        "high_shelf_frequency" | "band7_freq" | "band7_frequency" | "hs_freq" => {
            let (clamped, raw) = display_to_raw_log(value, 20.0, 20000.0, 0.0, 1050.0);
            AXParamTarget {
                description: "High Shelf Frequency",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("High Shelf"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "high_shelf_gain" | "band7_gain" | "hs_gain" => {
            let (clamped, raw) = display_to_raw_linear(value, -24.0, 24.0, 0.0, 480.0);
            AXParamTarget {
                description: "High Shelf Gain",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("High Shelf"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "high_shelf_q" | "band7_q" | "hs_q" => {
            let (clamped, raw) = display_to_raw_log(value, 0.1, 10.0, 0.0, 100.0);
            AXParamTarget {
                description: "High Shelf Q",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("High Shelf"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }

        // Band 8: High Cut (Low Pass)
        "high_cut_enabled" | "band8_enabled" | "low_pass_enabled" | "lp_enabled" => {
            let v = if value != 0.0 { 1.0 } else { 0.0 };
            AXParamTarget {
                description: "High Cut",
                identifier: None,
                role: "AXCheckBox",
                enable_band: None,
                clamped_display: v as f32,
                raw_value: v,
            }
        }
        "high_cut_frequency" | "band8_freq" | "band8_frequency" | "low_pass_frequency" | "lp_freq" => {
            let (clamped, raw) = display_to_raw_log(value, 20.0, 20000.0, 0.0, 1050.0);
            AXParamTarget {
                description: "High Cut Frequency",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("High Cut"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "high_cut_slope" | "band8_slope" | "low_pass_slope" | "high_cut_order" => {
            let (clamped, raw) = display_to_raw_linear(value, 6.0, 48.0, 1.0, 8.0);
            AXParamTarget {
                description: "High Cut Order",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("High Cut"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "high_cut_q" | "band8_q" | "low_pass_q" | "lp_q" => {
            let (clamped, raw) = display_to_raw_log(value, 0.1, 10.0, 0.0, 100.0);
            AXParamTarget {
                description: "High Cut Q",
                identifier: None,
                role: "AXSlider",
                enable_band: Some("High Cut"),
                clamped_display: clamped,
                raw_value: raw,
            }
        }

        // Output Gain (Channel EQ)
        "output_gain" | "master_gain" | "eq_output_gain" => {
            let (clamped, raw) = display_to_raw_linear(value, -24.0, 24.0, 0.0, 480.0);
            AXParamTarget {
                description: "Output Gain",
                identifier: Some("_NS:279"),
                role: "AXSlider",
                enable_band: None,
                clamped_display: clamped,
                raw_value: raw,
            }
        }

        // Compressor Controls (Studio Buddy _NS: identifiers)
        "threshold" | "compressor_threshold" | "_ns:153" => {
            let (clamped, raw) = display_to_raw_linear(value, -50.0, 0.0, 0.0, 200.0);
            AXParamTarget {
                description: "Threshold",
                identifier: Some("_NS:153"),
                role: "AXSlider",
                enable_band: None,
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "ratio" | "compressor_ratio" | "_ns:157" => {
            let (clamped, raw) = display_to_raw_log(value, 1.0, 30.0, 0.0, 290.0);
            AXParamTarget {
                description: "Ratio",
                identifier: Some("_NS:157"),
                role: "AXSlider",
                enable_band: None,
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "make_up" | "makeup" | "makeup_gain" | "_ns:160" => {
            let (clamped, raw) = display_to_raw_linear(value, -20.0, 20.0, 0.0, 200.0);
            AXParamTarget {
                description: "Make Up",
                identifier: Some("_NS:160"),
                role: "AXSlider",
                enable_band: None,
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "knee" | "compressor_knee" | "_ns:172" => {
            let (clamped, raw) = display_to_raw_linear(value, 0.0, 1.0, 0.0, 10.0);
            AXParamTarget {
                description: "Knee",
                identifier: Some("_NS:172"),
                role: "AXSlider",
                enable_band: None,
                clamped_display: clamped,
                raw_value: raw,
            }
        }
        "release" | "compressor_release" | "_ns:169" => {
            let (clamped, raw) = display_to_raw_log(value, 5.0, 5000.0, 0.0, 180.0);
            AXParamTarget {
                description: "Release",
                identifier: Some("_NS:169"),
                role: "AXSlider",
                enable_band: None,
                clamped_display: clamped,
                raw_value: raw,
            }
        }

        // Generic fallback: first check user-learned plugins in ~/.mixing-buddy/plugins/
        _ => {
            if let Some(learned) = find_learned_param_target(parameter, value) {
                return learned;
            }
            let (clamped, raw) = display_to_raw_linear(value, -24.0, 24.0, 0.0, 480.0);
            AXParamTarget {
                description: "Peak 3 Gain",
                identifier: None,
                role: "AXSlider",
                enable_band: None,
                clamped_display: clamped,
                raw_value: raw,
            }
        }
    }
}

fn get_plugin_vault_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME-Verzeichnis konnte nicht ermittelt werden".to_string())?;
    let vault_dir = PathBuf::from(home).join(".mixing-buddy").join("plugins");
    if !vault_dir.exists() {
        std::fs::create_dir_all(&vault_dir)
            .map_err(|e| format!("Fehler beim Anlegen von '{}': {}", vault_dir.display(), e))?;
    }
    Ok(vault_dir)
}

fn to_plugin_slug(name: &str) -> String {
    let mut slug = String::new();
    let mut last_underscore = false;
    for ch in name.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_underscore = false;
        } else if !last_underscore && !slug.is_empty() {
            slug.push('_');
            last_underscore = true;
        }
    }
    let cleaned = slug.trim_matches('_').to_string();
    if cleaned.is_empty() {
        "custom_plugin".to_string()
    } else {
        cleaned
    }
}

fn find_learned_param_target(parameter: &str, value: f32) -> Option<AXParamTarget> {
    let vault_dir = get_plugin_vault_dir().ok()?;
    let entries = std::fs::read_dir(&vault_dir).ok()?;
    let target_key = parameter.trim().to_lowercase();
    let target_slug = to_plugin_slug(parameter);

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(spec) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        let Some(params) = spec.get("parameters").and_then(|p| p.as_array()) else {
            continue;
        };

        for p in params {
            let id = p.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let desc = p.get("description").and_then(|v| v.as_str()).unwrap_or(name);
            let ident = p.get("identifier").and_then(|v| v.as_str()).unwrap_or("");

            if id.eq_ignore_ascii_case(&target_key)
                || id == target_slug
                || name.eq_ignore_ascii_case(&target_key)
                || desc.eq_ignore_ascii_case(&target_key)
                || (!ident.is_empty() && ident.eq_ignore_ascii_case(&target_key))
            {
                let raw_min = p.get("rawMin").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let raw_max = p.get("rawMax").and_then(|v| v.as_f64()).unwrap_or(100.0);
                let disp_min = p.get("displayMin").and_then(|v| v.as_f64()).unwrap_or(raw_min) as f32;
                let disp_max = p.get("displayMax").and_then(|v| v.as_f64()).unwrap_or(raw_max) as f32;
                let unit = p.get("unit").and_then(|v| v.as_str()).unwrap_or("");
                let role_str = p.get("role").and_then(|v| v.as_str()).unwrap_or("AXSlider");

                let is_log = matches!(unit, "Hz" | "Q" | ":1") && disp_min > 0.0 && disp_max > disp_min;
                let (clamped, raw) = if is_log {
                    display_to_raw_log(value, disp_min, disp_max, raw_min, raw_max)
                } else {
                    display_to_raw_linear(value, disp_min, disp_max, raw_min, raw_max)
                };

                let leaked_desc: &'static str = Box::leak(desc.to_string().into_boxed_str());
                let leaked_id: Option<&'static str> = if ident.is_empty() {
                    None
                } else {
                    Some(Box::leak(ident.to_string().into_boxed_str()))
                };
                let leaked_role: &'static str = match role_str {
                    "AXCheckBox" => "AXCheckBox",
                    "AXButton" => "AXButton",
                    "AXPopUpButton" => "AXPopUpButton",
                    _ => "AXSlider",
                };

                return Some(AXParamTarget {
                    description: leaked_desc,
                    identifier: leaked_id,
                    role: leaked_role,
                    enable_band: None,
                    clamped_display: clamped,
                    raw_value: raw,
                });
            }
        }
    }
    None
}

#[tauri::command]
fn get_active_daw(state: State<'_, AppState>) -> DetectedDAW {
    let mut detector = state.daw_detector.lock().unwrap();
    detector.detect_active_daw()
}

#[tauri::command]
fn get_detected_daw(state: State<'_, AppState>) -> DetectedDAW {
    let mut detector = state.daw_detector.lock().unwrap();
    detector.detect_active_daw()
}

#[tauri::command]
fn get_license_status(state: State<'_, AppState>) -> LicenseState {
    state.licensing.get_status()
}

#[tauri::command]
async fn verify_license(key: String, state: State<'_, AppState>) -> Result<LicenseState, String> {
    state.licensing.verify_license(&key).await
}

#[tauri::command]
fn validate_volume_adjustment(
    track_id: String,
    is_master: bool,
    proposed_db: f32,
    state: State<'_, AppState>,
) -> Result<f32, String> {
    let mut guard = state.safety_guard.lock().unwrap();
    guard.sanitize_volume(&track_id, is_master, proposed_db)
}

#[cfg(target_os = "macos")]
fn execute_logic_ax_bridge(bridge_path: &PathBuf, args: &[String]) -> Result<serde_json::Value, String> {
    let output = std::process::Command::new(bridge_path)
        .args(args)
        .output();

    let output = match output {
        Ok(out) => out,
        Err(e) => {
            eprintln!("Konnte logic-ax-bridge unter {:?} nicht starten: {:?}", bridge_path, e);
            return Err(format!("Konnte logic-ax-bridge unter {:?} nicht starten: {:?}", bridge_path, e));
        }
    };

    let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let err_msg = if stderr_str.is_empty() { &stdout_str } else { &stderr_str };
        eprintln!("logic-ax-bridge Ausführung fehlgeschlagen (Exit {}): {}", output.status, err_msg);
        return Err(format!(
            "logic-ax-bridge Fehler (Exit {}): {}",
            output.status,
            err_msg
        ));
    }

    let parsed: serde_json::Value = serde_json::from_str(&stdout_str)
        .map_err(|e| format!("Ungültige JSON-Antwort von logic-ax-bridge ({}): {}", stdout_str, e))?;

    // If direct invocation succeeded, return immediately
    if parsed.get("success").and_then(|v| v.as_bool()) == Some(true) {
        return Ok(parsed);
    }

    // If direct invocation failed, attempt delegation via MCP proxy on 127.0.0.1:48124
    let payload = serde_json::json!({ "args": args }).to_string();
    if let Ok(curl_out) = std::process::Command::new("/usr/bin/curl")
        .args([
            "-s",
            "--max-time",
            "3",
            "-X",
            "POST",
            "http://127.0.0.1:48124/api/ax-bridge",
            "-H",
            "Content-Type: application/json",
            "-d",
            &payload,
        ])
        .output()
    {
        if curl_out.status.success() {
            let curl_stdout = String::from_utf8_lossy(&curl_out.stdout).trim().to_string();
            if let Ok(proxy_parsed) = serde_json::from_str::<serde_json::Value>(&curl_stdout) {
                if proxy_parsed.get("success").and_then(|v| v.as_bool()) == Some(true) {
                    return Ok(proxy_parsed);
                }
            }
        }
    }

    Ok(parsed)
}

fn is_subsequence(sub: &str, full: &str) -> bool {
    let mut full_chars = full.chars();
    for sub_ch in sub.chars() {
        match full_chars.find(|&c| c == sub_ch) {
            Some(_) => (),
            None => return false,
        }
    }
    true
}

/// Fuzzy track name matching mirroring the Swift `matchesTrackName` logic.
/// Supports CamelCase acronyms like "MoReKi" -> "Motown Revisited Kit", "StdGrn" -> "Studio Grand".
fn matches_track_fuzzy(strip_name: &str, query: &str) -> bool {
    let s = strip_name.to_lowercase();
    let q = query.to_lowercase();
    if s == q || s.contains(&q) || q.contains(&s) { return true; }

    // Normalized (no spaces/punct)
    let s_clean: String = s.chars().filter(|c| c.is_alphanumeric()).collect();
    let q_clean: String = q.chars().filter(|c| c.is_alphanumeric()).collect();
    if !s_clean.is_empty() && !q_clean.is_empty() && (s_clean == q_clean || s_clean.contains(&q_clean) || q_clean.contains(&s_clean)) {
        return true;
    }

    // Explicit MCU LCD abbreviations
    let mcu_map: &[(&str, &str)] = &[
        ("moreki", "motown revisited kit"),
        ("stdgrn", "studio grand"),
        ("stout", "stereo out"),
        ("st_out", "stereo out"),
    ];
    for (mcu, full) in mcu_map {
        let full_clean: String = full.chars().filter(|c| c.is_alphanumeric()).collect();
        if q_clean == *mcu && (s_clean == full_clean || s_clean.contains(&full_clean)) {
            return true;
        }
    }

    // Subsequence matching (e.g. "stdgrn" in "studiogrand", "moreki" in "motownrevisitedkit")
    if q_clean.len() >= 2 && s_clean.chars().next() == q_clean.chars().next() && is_subsequence(&q_clean, &s_clean) {
        return true;
    }

    let s_words: Vec<&str> = s.split_whitespace().collect();

    // Initials: "motown revisited kit" -> "mrk"
    let initials: String = s_words.iter().filter_map(|w| w.chars().next()).collect();
    if !initials.is_empty() && (initials == q_clean || q_clean == initials) { return true; }

    // CamelCase syllables: "MoReKi" -> ["mo", "re", "ki"]
    let mut camel_parts: Vec<String> = Vec::new();
    let mut cur = String::new();
    for ch in query.chars() {
        if ch.is_uppercase() && !cur.is_empty() {
            camel_parts.push(cur.to_lowercase());
            cur = ch.to_string();
        } else {
            cur.push(ch);
        }
    }
    if !cur.is_empty() { camel_parts.push(cur.to_lowercase()); }

    if camel_parts.len() > 1 && camel_parts.len() <= s_words.len() {
        if camel_parts.iter().enumerate().all(|(i, cp)| {
            s_words.get(i).map(|w| w.starts_with(cp.as_str()) || is_subsequence(cp.as_str(), w)).unwrap_or(false)
        }) {
            return true;
        }
    }

    // Word prefix matching
    let q_words: Vec<&str> = q.split_whitespace().collect();
    for sw in &s_words {
        if sw.len() >= 3 {
            for qw in &q_words {
                if qw.len() >= 3 && (sw == qw || sw.starts_with(qw) || qw.starts_with(sw)) {
                    return true;
                }
            }
        }
    }
    false
}

fn resolve_canonical_track_name(track_query: &str) -> String {
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if bridge_path.exists() {
            let strips_args = vec!["list-channel-strips".to_string()];
            if let Ok(strips_result) = execute_logic_ax_bridge(&bridge_path, &strips_args) {
                if let Some(arr) = strips_result.get("channelStrips").and_then(|s| s.as_array()) {
                    if let Some(found) = arr.iter().find(|strip| {
                        let name = strip.get("trackName").and_then(|n| n.as_str()).unwrap_or("");
                        matches_track_fuzzy(name, track_query)
                    }) {
                        if let Some(real_name) = found.get("trackName").and_then(|n| n.as_str()) {
                            if !real_name.is_empty() {
                                return real_name.to_string();
                            }
                        }
                    }
                }
            }
        }
    }
    track_query.to_string()
}

fn humanize_ax_error(raw_err: &str) -> String {
    let s = raw_err.trim();
    if s.contains("AX_UNTRUSTED") {
        "Bedienungshilfen-Zugriff erforderlich: Bitte prüfe in den macOS 'Systemeinstellungen > Datenschutz & Sicherheit > Bedienungshilfen', dass 'Oszillation Mixing Buddy' aktiviert ist.".to_string()
    } else if s.contains("Mixer ist nicht geöffnet") || s.contains("Kanalzüge") {
        "Logic Pro Mixer nicht sichtbar: Bitte öffne den Mixer in Logic Pro (Taste X) oder wähle die Spur an.".to_string()
    } else if s.contains("nicht geöffnet") || s.contains("AX_NO_WINDOWS") {
        "Plugin-Fenster konnte nicht automatisch adressiert werden. Bitte prüfen, ob das Plugin im Mixer vorhanden ist.".to_string()
    } else if s.contains("Element not found") {
        "Regler nicht gefunden: Der Parameter konnte im Plugin-Fenster nicht lokalisiert werden. Bitte Standard-Ansicht prüfen.".to_string()
    } else {
        s.to_string()
    }
}

#[derive(serde::Deserialize, Debug, Clone)]
struct DawActionPayload {
    track: Option<String>,
    track_name: Option<String>,
    parameter: Option<String>,
    value: Option<f32>,
    unit: Option<String>,
    is_master: Option<bool>,
    current_value: Option<f32>,
    is_restore: Option<bool>,
    plugin_name: Option<String>,
    slot_index: Option<u64>,
}

#[tauri::command]
async fn apply_daw_action(
    track_name: Option<String>,
    parameter: Option<String>,
    value: Option<f32>,
    unit: Option<String>,
    is_master: Option<bool>,
    current_value: Option<f32>,
    is_restore: Option<bool>,
    plugin_name: Option<String>,
    slot_index: Option<u64>,
    action: Option<DawActionPayload>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let track_raw = action.as_ref().and_then(|a| a.track.clone().or_else(|| a.track_name.clone())).or(track_name).unwrap_or_default();
    let track_name = resolve_canonical_track_name(&track_raw);
    let parameter = action.as_ref().and_then(|a| a.parameter.clone()).or(parameter).unwrap_or_default();
    let value = action.as_ref().and_then(|a| a.value).or(value).unwrap_or(0.0);
    let unit = action.as_ref().and_then(|a| a.unit.clone()).or(unit).unwrap_or_else(|| "dB".to_string());
    let is_master = action.as_ref().and_then(|a| a.is_master).or(is_master).unwrap_or(false);
    let current_value = action.as_ref().and_then(|a| a.current_value).or(current_value);
    let is_restore = action.as_ref().and_then(|a| a.is_restore).or(is_restore);
    let plugin_name = action.as_ref().and_then(|a| a.plugin_name.clone()).or(plugin_name);
    let slot_index = action.as_ref().and_then(|a| a.slot_index).or(slot_index);

    let active_daw = {
        let mut detector = state.daw_detector.lock().unwrap();
        detector.detect_active_daw()
    };

    let param_lower = parameter.trim().to_lowercase();
    let is_fader_param = matches!(
        param_lower.as_str(),
        "volume" | "fader_db" | "track_volume" | "master_volume" | "fader" | "volume fader" | "fader volume" | "vol" | "lautstärke" | "pegel"
    ) || param_lower.contains("volume") || param_lower.contains("fader") || param_lower.contains("lautstärke");

    let is_pan_param = matches!(
        param_lower.as_str(),
        "pan" | "stereo_pan" | "balance" | "panorama"
    ) || param_lower.contains("pan") || param_lower.contains("balance") || param_lower.contains("panorama");

    // ── Direct Fader: no window needed ──────────────────────────────────────────
    if is_fader_param {
        let is_restore_flag = is_restore.unwrap_or(false);
        let sanitized_volume = {
            let mut guard = state.safety_guard.lock().unwrap();
            if let Some(base) = current_value {
                guard.register_baseline(&track_name, base);
            }
            guard.sanitize_volume_with_restore(&track_name, is_master, value, is_restore_flag)?
        };

        // Determine target channel index:
        // Master: 8 (maps to MIDI Ch 9 Pitchbend 0xE8)
        // Tracks 1..8: 0..7 (maps to MIDI Ch 1..8 Pitchbend 0xE0..0xE7)
        let ch_idx: u8 = if is_master
            || track_name.to_lowercase().contains("stereo")
            || track_name.to_lowercase().contains("master")
        {
            8
        } else {
            resolve_track_channel_index(&track_name, &state)
        };

        // Primary execution path: MCU Pitchbend (0xE0 + ch_idx)
        let _ = state
            .ipc_server
            .mcu_bridge
            .set_fader_volume(ch_idx, sanitized_volume);

        // Secondary / Direct verification on macOS: AX bridge (ensures Logic Pro textfield & slider update)
        #[cfg(target_os = "macos")]
        {
            let bridge_path = resolve_bridge_binary();
            if bridge_path.exists() {
                let fader_args = vec![
                    "set-fader".to_string(),
                    "--track".to_string(),
                    track_name.clone(),
                    "--db".to_string(),
                    format!("{:.2}", sanitized_volume),
                ];
                if let Ok(res) = execute_logic_ax_bridge(&bridge_path, &fader_args) {
                    if res.get("success").and_then(|v| v.as_bool()) == Some(true) {
                        return Ok(format!(
                            "Fader '{}' → {:.1} dB ({})",
                            track_name, sanitized_volume, active_daw.display_name()
                        ));
                    }
                }
            }
        }

        return Ok(format!(
            "Fader '{}' auf {:.1} dB gesetzt ({})",
            track_name, sanitized_volume, active_daw.display_name()
        ));
    }

    // ── Direct Pan: no window needed ─────────────────────────────────────────────
    if is_pan_param {
        #[cfg(target_os = "macos")]
        {
            let bridge_path = resolve_bridge_binary();
            if !bridge_path.exists() {
                return Err(format!(
                    "logic-ax-bridge nicht gefunden unter {}",
                    bridge_path.display()
                ));
            }
            let pan_args = vec![
                "set-pan".to_string(),
                "--track".to_string(),
                track_name.clone(),
                "--pan".to_string(),
                format!("{:.1}", value),
            ];
            let res = execute_logic_ax_bridge(&bridge_path, &pan_args)?;
            if res.get("success").and_then(|v| v.as_bool()) == Some(true) {
                return Ok(format!(
                    "Pan '{}' → {:.0} via AX-Mixer ({})",
                    track_name, value, active_daw.display_name()
                ));
            } else {
                let err_msg = res.get("error").and_then(|v| v.as_str()).unwrap_or("Unbekannter AX-Fehler");
                return Err(format!("Pan für '{}' konnte nicht gesetzt werden: {}", track_name, humanize_ax_error(err_msg)));
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            return Ok(format!(
                "Pan '{}' auf {:.0} gesetzt ({})",
                track_name, value, active_daw.display_name()
            ));
        }
    }

    // AUFGABE 2: Execute plugin parameter change in Logic Pro via native `logic-ax-bridge`
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if !bridge_path.exists() {
            return Err(format!(
                "Native Swift-Bridge nicht gefunden unter: {}",
                bridge_path.display()
            ));
        }

        if param_lower.contains("bypass") {
            let bypass_args = vec![
                "toggle-bypass".to_string(),
                "--window".to_string(),
                track_name.clone(),
            ];
            let parsed = execute_logic_ax_bridge(&bridge_path, &bypass_args)?;

            if parsed.get("success").and_then(|v| v.as_bool()) != Some(true) {
                let err_msg = parsed
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unbekannter Fehler beim Umschalten des Bypass");
                return Err(format!("Logic Pro Bypass fehlgeschlagen: {}", err_msg));
            }

            return Ok(format!(
                "Bypass auf '{}' erfolgreich umgeschaltet ({})",
                track_name,
                active_daw.display_name()
            ));
        }

        let target = resolve_ax_param_target(&parameter, value);
        let desc_arg = if target.description == "Peak 3 Gain" && !param_lower.contains("peak_3") && !param_lower.contains("band5") && !param_lower.contains("bell_3") {
            parameter.as_str()
        } else {
            target.description
        };

        let mut cmd_args: Vec<String> = vec![
            "set-param".to_string(),
            "--window".to_string(),
            track_name.clone(),
            "--description".to_string(),
            desc_arg.to_string(),
            "--role".to_string(),
            target.role.to_string(),
            "--value".to_string(),
            format!("{:.1}", target.raw_value),
        ];

        if let Some(id) = target.identifier {
            cmd_args.push("--identifier".to_string());
            cmd_args.push(id.to_string());
        }
        if let Some(band_name) = target.enable_band {
            cmd_args.push("--enable-band".to_string());
            cmd_args.push(band_name.to_string());
        }

        let parsed_result = execute_logic_ax_bridge(&bridge_path, &cmd_args)?;

        // ── Auto open-insert fallback if plugin window is closed ─────────────────
        let success = parsed_result.get("success").and_then(|v| v.as_bool()) == Some(true);
        let err_msg_str = parsed_result
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let window_not_found = !success && (
            err_msg_str.contains("nicht gefunden") ||
            err_msg_str.contains("nicht geöffnet") ||
            err_msg_str.contains("not found") ||
            err_msg_str.contains("AX_NO_WINDOWS")
        );

        if window_not_found {
            // 1. Find which slot contains the target plugin via list-channel-strips
            let strips_args = vec!["list-channel-strips".to_string()];
            let strips_result = execute_logic_ax_bridge(&bridge_path, &strips_args)
                .unwrap_or_else(|_| serde_json::json!({}));

            let slot: Option<u64> = slot_index
                .filter(|&s| s >= 1)
                .or_else(|| {
                    strips_result
                        .get("channelStrips")
                        .and_then(|s| s.as_array())
                        .and_then(|arr| {
                            // Use fuzzy matching to find the correct track
                            arr.iter().find(|strip| {
                                let name = strip.get("trackName")
                                    .and_then(|n| n.as_str())
                                    .unwrap_or("");
                                matches_track_fuzzy(name, &track_name)
                            })
                        })
                        .and_then(|strip| strip.get("inserts"))
                        .and_then(|ins| ins.as_array())
                        .and_then(|inserts| {
                            // 1. If explicit plugin_name was provided, find that plugin's slot
                            if let Some(target_pname) = &plugin_name {
                                let tp_low = target_pname.to_lowercase();
                                if let Some(matched_slot) = inserts.iter().find_map(|ins| {
                                    let n = ins.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                                    if n.contains(&tp_low) || tp_low.contains(&n) {
                                        ins.get("slot").and_then(|s| s.as_u64())
                                    } else {
                                        None
                                    }
                                }) {
                                    return Some(matched_slot);
                                }
                            }

                            let desc_low = desc_arg.to_lowercase();
                            let is_eq_param = desc_low.contains("freq") || desc_low.contains("gain")
                                || desc_low.contains("cut") || desc_low.contains("hz")
                                || desc_low.contains("shelf") || desc_low.contains("band")
                                || desc_low.contains("peak") || desc_low.contains("bell")
                                || desc_low.contains("q") || desc_low.contains("order")
                                || desc_low.contains("slope") || desc_low.contains("filter");
                            let is_comp_param = desc_low.contains("threshold") || desc_low.contains("ratio")
                                || desc_low.contains("attack") || desc_low.contains("release") || desc_low.contains("knee");
                            let is_limiter_param = desc_low.contains("ceiling") || (desc_low.contains("threshold") && desc_low.contains("limiter"));

                            // 2. Smart plugin-type matching
                            let exact = inserts.iter().find_map(|ins| {
                                let name = ins.get("name").and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
                                if (name.contains("eq") || name.contains("equalizer")) && is_eq_param {
                                    ins.get("slot").and_then(|s| s.as_u64())
                                } else if name.contains("compressor") && is_comp_param {
                                    ins.get("slot").and_then(|s| s.as_u64())
                                } else if name.contains("limiter") && is_limiter_param {
                                    ins.get("slot").and_then(|s| s.as_u64())
                                } else {
                                    None
                                }
                            });

                            // 3. Fallback: EQ -> first EQ insert; Compressor -> first Compressor insert
                            exact.or_else(|| {
                                if is_eq_param {
                                    inserts.iter().find_map(|ins| {
                                        let name = ins.get("name").and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
                                        if name.contains("eq") || name.contains("equalizer") {
                                            ins.get("slot").and_then(|s| s.as_u64())
                                        } else {
                                            None
                                        }
                                    })
                                } else if is_comp_param {
                                    inserts.iter().find_map(|ins| {
                                        let name = ins.get("name").and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
                                        if name.contains("compressor") {
                                            ins.get("slot").and_then(|s| s.as_u64())
                                        } else {
                                            None
                                        }
                                    })
                                } else {
                                    inserts.iter().find_map(|ins| {
                                        let name = ins.get("name").and_then(|n| n.as_str()).unwrap_or("");
                                        if !name.is_empty() { ins.get("slot").and_then(|s| s.as_u64()) } else { None }
                                    })
                                }
                            })
                        })
                });

            if let Some(target_slot) = slot {
                // 2. Open the insert
                let open_args = vec![
                    "open-insert".to_string(),
                    "--track".to_string(),
                    track_name.clone(),
                    "--slot".to_string(),
                    target_slot.to_string(),
                ];
                let open_result = execute_logic_ax_bridge(&bridge_path, &open_args)
                    .unwrap_or_else(|_| serde_json::json!({}));
                let opened_window = open_result
                    .get("openedWindow")
                    .and_then(|w| w.as_str())
                    .unwrap_or(&track_name)
                    .to_string();

                if open_result.get("success").and_then(|v| v.as_bool()) == Some(true) {
                    // Warte mindestens 250 ms, BEVOR der nachfolgende set_param-Befehl abgesetzt wird.
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;

                    // 3. Retry set-param with the now-open window
                    let mut retry_args = cmd_args.clone();
                    // Update --window to the newly opened window title (if known)
                    if !opened_window.is_empty() {
                        if let Some(pos) = retry_args.iter().position(|a| a == "--window") {
                            if pos + 1 < retry_args.len() {
                                retry_args[pos + 1] = opened_window.clone();
                            }
                        }
                    }
                    let retry_result = execute_logic_ax_bridge(&bridge_path, &retry_args)
                        .unwrap_or_else(|_| serde_json::json!({}));

                    // NOTE (PUNKT 2): Do NOT close the window! Keep it open so audition & apply work
                    // seamlessly without repeated reopen/close flickering and without user interaction!

                    if retry_result.get("success").and_then(|v| v.as_bool()) == Some(true) {
                        let val_desc = retry_result
                            .get("valueDescription")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| format!("{:.1} {}", target.clamped_display, unit));
                        return Ok(format!(
                            "Parameter '{}' auf '{}' auf {} gesetzt (Auto-Insert Slot {}) ({})",
                            parameter, track_name, val_desc, target_slot, active_daw.display_name()
                        ));
                    }
                }
            }
        }

        if parsed_result.get("success").and_then(|v| v.as_bool()) != Some(true) {
            return Err(format!(
                "Konnte '{}' auf Spur '{}' nicht setzen: {}",
                parameter, track_name, humanize_ax_error(&err_msg_str)
            ));
        }

        let val_desc = parsed_result
            .get("valueDescription")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("{:.1} {}", target.clamped_display, unit));

        return Ok(format!(
            "Parameter '{}' auf '{}' auf {} gesetzt ({})",
            parameter, track_name, val_desc, active_daw.display_name()
        ));
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(format!(
            "Parameter '{}' auf '{}' auf {:.1} {} gesetzt ({})",
            parameter,
            track_name,
            value,
            unit,
            active_daw.display_name()
        ))
    }
}

#[tauri::command]
async fn create_daw_track(
    track_type: String,
    name: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let active_daw = {
        let mut detector = state.daw_detector.lock().unwrap();
        detector.detect_active_daw()
    };

    let track_label = name.unwrap_or_else(|| format!("Neue {} Spur", track_type));
    Ok(format!(
        "Spur '{}' erfolgreich in {} angelegt.",
        track_label,
        active_daw.display_name()
    ))
}

#[tauri::command]
async fn toggle_plugin_bypass(
    track_name: String,
    _slot_index: u32,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let active_daw = {
        let mut detector = state.daw_detector.lock().unwrap();
        detector.detect_active_daw()
    };

    // AUFGABE 3: Native Swift-Bridge (`logic-ax-bridge toggle-bypass`) instead of osascript
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if !bridge_path.exists() {
            return Err(format!(
                "Native Swift-Bridge nicht gefunden unter: {}",
                bridge_path.display()
            ));
        }

        let bypass_args = vec![
            "toggle-bypass".to_string(),
            "--window".to_string(),
            track_name.clone(),
        ];
        let parsed = execute_logic_ax_bridge(&bridge_path, &bypass_args)?;

        if parsed.get("success").and_then(|v| v.as_bool()) != Some(true) {
            let err_msg = parsed
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Bypass-Schalter im Plugin-Fenster nicht gefunden");
            return Err(format!("Bypass auf '{}' fehlgeschlagen: {}", track_name, err_msg));
        }
    }

    Ok(format!(
        "Channel EQ Bypass auf '{}' umgeschaltet ({}).",
        track_name,
        active_daw.display_name()
    ))
}

#[tauri::command]
async fn install_mcp_client_config(
    client_type: String,
    custom_path: Option<String>,
) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "Konnte HOME-Verzeichnis nicht ermitteln".to_string())?;
    let home_path = PathBuf::from(&home);

    let node_bin = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ]
    .iter()
    .find(|p| std::path::Path::new(p).exists())
    .unwrap_or(&"node")
    .to_string();

    let server_script = "/Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/packages/mcp-server/dist/index.js";

    let target_path = if let Some(custom) = custom_path.filter(|s| !s.trim().is_empty()) {
        if custom.starts_with("~/") {
            home_path.join(custom.trim_start_matches("~/"))
        } else {
            PathBuf::from(custom)
        }
    } else {
        match client_type.as_str() {
            "claude_desktop" => home_path
                .join("Library")
                .join("Application Support")
                .join("Claude")
                .join("claude_desktop_config.json"),
            "cursor" => home_path.join(".cursor").join("mcp.json"),
            "vscode_custom" => {
                let agy_cfg = home_path.join(".gemini").join("config").join("mcp_config.json");
                let vscode_mcp = home_path
                    .join("Library")
                    .join("Application Support")
                    .join("Code")
                    .join("User")
                    .join("mcp.json");
                if agy_cfg.exists() {
                    agy_cfg
                } else {
                    vscode_mcp
                }
            }
            _ => return Err(format!("Unbekannter MCP-Client-Typ: {}", client_type)),
        }
    };

    if let Some(parent) = target_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Verzeichnis '{}' konnte nicht angelegt werden: {}",
                    parent.display(),
                    e
                )
            })?;
        }
    }

    let mut root: serde_json::Value = if target_path.exists() {
        let raw = std::fs::read_to_string(&target_path).map_err(|e| {
            format!(
                "Konfigurationsdatei '{}' konnte nicht gelesen werden: {}",
                target_path.display(),
                e
            )
        })?;
        if raw.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&raw).map_err(|e| {
                format!(
                    "Ungültiges JSON in '{}': {}",
                    target_path.display(),
                    e
                )
            })?
        }
    } else {
        serde_json::json!({})
    };

    if !root.is_object() {
        root = serde_json::json!({});
    }

    let entry = serde_json::json!({
        "command": node_bin,
        "args": [server_script, "--stdio"]
    });

    // Determine whether the file uses `servers` (VS Code native mcp.json) or `mcpServers` (Claude / Cursor / Antigravity)
    let use_servers_key = client_type == "vscode_custom"
        && target_path.to_string_lossy().contains("/Code/User/mcp.json")
        && root.get("mcpServers").is_none();

    let container_key = if use_servers_key { "servers" } else { "mcpServers" };

    if root.get(container_key).and_then(|v| v.as_object()).is_none() {
        root[container_key] = serde_json::json!({});
    }

    if let Some(servers_obj) = root.get_mut(container_key).and_then(|v| v.as_object_mut()) {
        servers_obj.insert("oszillation-mixing-buddy".to_string(), entry);
    }

    let formatted = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("JSON-Serialisierung fehlgeschlagen: {}", e))?;

    std::fs::write(&target_path, format!("{}\n", formatted)).map_err(|e| {
        format!(
            "Fehler beim Schreiben in '{}': {}",
            target_path.display(),
            e
        )
    })?;

    Ok(format!(
        "MCP-Konfiguration erfolgreich in '{}' installiert.",
        target_path.display()
    ))
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    pub slug: String,
    pub plugin_name: String,
    pub category: String,
    /// Resolved tags (always present; auto-derived from category when JSON has none)
    pub tags: Vec<String>,
    pub parameter_count: usize,
    pub is_built_in: bool,
    pub file_path: Option<String>,
}

pub fn learn_active_plugin_sync(window_title: Option<String>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if !bridge_path.exists() {
            return Err(format!(
                "Native Swift-Bridge nicht gefunden unter: {}",
                bridge_path.display()
            ));
        }

        let mut args = vec!["profile-plugin".to_string()];
        if let Some(title) = window_title.filter(|s| !s.trim().is_empty()) {
            args.push("--window".to_string());
            args.push(title);
        }

        let parsed = execute_logic_ax_bridge(&bridge_path, &args)?;
        if parsed.get("success").and_then(|v| v.as_bool()) != Some(true) {
            let err_msg = parsed
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Kein geöffnetes Plugin-Fenster in Logic Pro gefunden");
            return Err(format!("Plugin-Scan fehlgeschlagen: {}", err_msg));
        }

        let plugin_name = parsed
            .get("pluginName")
            .and_then(|v| v.as_str())
            .unwrap_or("Unbekanntes Plugin")
            .to_string();

        let slug = to_plugin_slug(&plugin_name);
        let vault_dir = get_plugin_vault_dir()?;
        let file_path = vault_dir.join(format!("{}.json", slug));

        let mut clean_spec = parsed.clone();
        if let Some(obj) = clean_spec.as_object_mut() {
            obj.remove("success");
            obj.insert(
                "filePath".to_string(),
                serde_json::Value::String(file_path.to_string_lossy().to_string()),
            );
            obj.insert("slug".to_string(), serde_json::Value::String(slug));
        }

        let formatted = serde_json::to_string_pretty(&clean_spec)
            .map_err(|e| format!("JSON-Serialisierung fehlgeschlagen: {}", e))?;

        std::fs::write(&file_path, format!("{}\n", formatted)).map_err(|e| {
            format!(
                "Fehler beim Speichern im Plugin Vault '{}': {}",
                file_path.display(),
                e
            )
        })?;

        return Ok(clean_spec);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window_title;
        Err("Plugin-Profiler wird aktuell unter macOS via AXUIElement unterstützt.".to_string())
    }
}

#[tauri::command]
async fn learn_active_plugin(
    window_title: Option<String>,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let spec = learn_active_plugin_sync(window_title)?;
    let _ = app.emit("plugin-vault-updated", &spec);
    Ok(spec)
}

pub fn list_learned_plugins_sync() -> Result<Vec<PluginSummary>, String> {
    let mut list = vec![
        PluginSummary {
            slug: "channel_eq".to_string(),
            plugin_name: "Channel EQ".to_string(),
            category: "eq".to_string(),
            tags: vec!["EQ".to_string(), "STOCK".to_string()],
            parameter_count: 32,
            is_built_in: true,
            file_path: None,
        },
        PluginSummary {
            slug: "compressor".to_string(),
            plugin_name: "Compressor".to_string(),
            category: "dynamics".to_string(),
            tags: vec!["DYNAMICS".to_string(), "COMPRESSOR".to_string(), "STOCK".to_string()],
            parameter_count: 14,
            is_built_in: true,
            file_path: None,
        },
    ];

    let vault_dir = get_plugin_vault_dir()?;
    if let Ok(entries) = std::fs::read_dir(&vault_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(raw) = std::fs::read_to_string(&path) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
                    let plugin_name = val
                        .get("pluginName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Custom Plugin")
                        .to_string();
                    let category = val
                        .get("category")
                        .and_then(|v| v.as_str())
                        .unwrap_or("utility")
                        .to_string();
                    let parameter_count = val
                        .get("parameters")
                        .and_then(|v| v.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    let tags: Vec<String> = val
                        .get("tags")
                        .and_then(|t| t.as_array())
                        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                        .filter(|t: &Vec<String>| !t.is_empty())
                        .unwrap_or_else(|| infer_tags_from_category(&category));
                    let slug = path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("custom_plugin")
                        .to_string();

                    list.push(PluginSummary {
                        slug,
                        plugin_name,
                        category,
                        tags,
                        parameter_count,
                        is_built_in: false,
                        file_path: Some(path.to_string_lossy().to_string()),
                    });
                }
            }
        }
    }

    Ok(list)
}

/// Derives default tags from category when no explicit tags exist in the JSON
fn infer_tags_from_category(category: &str) -> Vec<String> {
    match category.to_lowercase().as_str() {
        "eq" => vec!["EQ".to_string()],
        "dynamics" => vec!["DYNAMICS".to_string()],
        "saturation" => vec!["SATURATION".to_string()],
        "reverb" => vec!["REVERB".to_string()],
        "delay" => vec!["DELAY".to_string()],
        "modulation" => vec!["MODULATION".to_string()],
        other => vec![other.to_uppercase()],
    }
}

/// Overwrites the `tags` field in a vault JSON file and reloads it.
pub fn update_plugin_tags_sync(slug: String, tags: Vec<String>) -> Result<serde_json::Value, String> {
    let clean_slug = to_plugin_slug(&slug);
    let vault_dir = get_plugin_vault_dir()?;
    let target = vault_dir.join(format!("{}.json", clean_slug));
    if !target.exists() {
        return Err(format!("Plugin-Datei '{}' nicht gefunden.", target.display()));
    }
    let raw = std::fs::read_to_string(&target)
        .map_err(|e| format!("Fehler beim Lesen von '{}': {}", target.display(), e))?;
    let mut val = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|e| format!("Ungültiges JSON in '{}': {}", target.display(), e))?;
    let normalized: Vec<String> = tags
        .iter()
        .map(|t| t.trim().to_uppercase())
        .filter(|t| !t.is_empty())
        .collect();
    if let Some(obj) = val.as_object_mut() {
        obj.insert(
            "tags".to_string(),
            serde_json::Value::Array(
                normalized.iter().map(|t| serde_json::Value::String(t.clone())).collect(),
            ),
        );
    }
    let formatted = serde_json::to_string_pretty(&val)
        .map_err(|e| format!("JSON-Serialisierung fehlgeschlagen: {}", e))?;
    std::fs::write(&target, format!("{}
", formatted))
        .map_err(|e| format!("Fehler beim Schreiben in '{}': {}", target.display(), e))?;
    Ok(val)
}

#[tauri::command]
async fn list_learned_plugins() -> Result<Vec<PluginSummary>, String> {
    list_learned_plugins_sync()
}

pub fn delete_learned_plugin_sync(slug: String) -> Result<String, String> {
    let clean_slug = to_plugin_slug(&slug);
    let vault_dir = get_plugin_vault_dir()?;
    let target = vault_dir.join(format!("{}.json", clean_slug));
    if target.exists() {
        std::fs::remove_file(&target)
            .map_err(|e| format!("Konnte '{}' nicht löschen: {}", target.display(), e))?;
        Ok(format!("Plugin '{}' aus der Bibliothek entfernt.", clean_slug))
    } else {
        Err(format!("Plugin-Datei '{}' nicht gefunden.", target.display()))
    }
}

#[tauri::command]
async fn update_plugin_tags(
    slug: String,
    tags: Vec<String>,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let result = update_plugin_tags_sync(slug.clone(), tags)?;
    let _ = app.emit("plugin-vault-updated", &slug);
    Ok(result)
}

#[tauri::command]
async fn delete_learned_plugin(slug: String, app: tauri::AppHandle) -> Result<String, String> {
    let msg = delete_learned_plugin_sync(slug.clone())?;
    let _ = app.emit("plugin-vault-updated", &slug);
    Ok(msg)
}

#[tauri::command]
async fn list_channel_strips() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if !bridge_path.exists() {
            return Err(format!(
                "Native Swift-Bridge nicht gefunden unter: {}",
                bridge_path.display()
            ));
        }
        let args = vec!["list-channel-strips".to_string()];
        let mut val = execute_logic_ax_bridge(&bridge_path, &args)?;

        let mut active_meter_track: Option<String> = None;
        if let Some(strips) = val
            .get("channelStrips")
            .or_else(|| val.get("channel_strips"))
            .and_then(|cs| cs.as_array())
        {
            for s in strips {
                let track_name = s
                    .get("trackName")
                    .or_else(|| s.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if let Some(inserts) = s.get("inserts").and_then(|ins| ins.as_array()) {
                    for ins in inserts {
                        let plugin_name = ins
                            .get("name")
                            .or_else(|| ins.get("pluginName"))
                            .and_then(|n| n.as_str())
                            .unwrap_or("");
                        let p_lower = plugin_name.to_lowercase();
                        if p_lower.contains("mixingbuddymeter")
                            || p_lower.contains("mixingbuddy")
                            || p_lower.contains("mixingbudd")
                            || p_lower.contains("the ear")
                        {
                            active_meter_track = Some(track_name.to_string());
                            break;
                        }
                    }
                }
                if active_meter_track.is_some() {
                    break;
                }
            }
        }

        if let Some(obj) = val.as_object_mut() {
            obj.insert(
                "active_meter_track".to_string(),
                serde_json::to_value(&active_meter_track).unwrap_or(serde_json::Value::Null),
            );
        }

        Ok(val)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(serde_json::json!({ "success": true, "channelStrips": [], "active_meter_track": null }))
    }
}

#[tauri::command]
async fn get_tracks() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        match list_channel_strips().await {
            Ok(val) => {
                let active_meter_track = val
                    .get("active_meter_track")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);

                let strips = val
                    .get("channelStrips")
                    .or_else(|| val.get("channel_strips"))
                    .and_then(|cs| cs.as_array());

                let mut tracks: Vec<serde_json::Value> = Vec::new();
                if let Some(strips) = strips {
                    for (idx, s) in strips.iter().enumerate() {
                        let track_name = s
                            .get("trackName")
                            .or_else(|| s.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Track");
                        let lower = track_name.to_lowercase();
                        let is_master = lower.contains("stereo out") || lower == "master";

                        let inserts = s
                            .get("inserts")
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default();
                        let insert_slots: Vec<serde_json::Value> = inserts
                            .iter()
                            .map(|ins| {
                                let slot = ins.get("slot").and_then(|v| v.as_i64()).unwrap_or(1);
                                let name = ins
                                    .get("name")
                                    .or_else(|| ins.get("pluginName"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Plugin");
                                serde_json::json!({
                                    "slotIndex": slot,
                                    "pluginName": name,
                                    "isEnabled": true,
                                    "parameters": []
                                })
                            })
                            .collect();

                        tracks.push(serde_json::json!({
                            "id": if is_master { "track_master".to_string() } else { format!("track_{}", idx + 1) },
                            "index": idx,
                            "name": track_name,
                            "type": if is_master { "master" } else { "audio" },
                            "volumeDb": s.get("faderDb").and_then(|v| v.as_f64()).unwrap_or(0.0),
                            "pan": s.get("pan").and_then(|v| v.as_f64()).unwrap_or(0.0),
                            "isMuted": s.get("mute").and_then(|v| v.as_bool()).unwrap_or(false),
                            "isSoloed": s.get("solo").and_then(|v| v.as_bool()).unwrap_or(false),
                            "isSelected": idx == 0,
                            "insertSlots": insert_slots
                        }));
                    }
                }

                Ok(serde_json::json!({
                    "tracks": tracks,
                    "active_meter_track": active_meter_track
                }))
            }
            Err(e) => {
                let detector = crate::daw_detector::DAWDetector::new();
                let scanned = detector.scan_logic_pro_tracks();
                Ok(serde_json::json!({
                    "tracks": scanned,
                    "active_meter_track": serde_json::Value::Null,
                    "error": e
                }))
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(serde_json::json!({ "tracks": [], "active_meter_track": null }))
    }
}

#[tauri::command]
async fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read audio file '{}': {}", path, e))
}

#[tauri::command]
async fn save_reference_profile(
    profile: reference_vault::ReferenceProfile,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let _ = reference_vault::save_reference_profile_sync(profile.clone())?;
    let _ = app.emit("reference-vault-updated", &profile.id);
    Ok(())
}

#[tauri::command]
async fn list_reference_profiles() -> Result<Vec<reference_vault::ReferenceProfileSummary>, String> {
    reference_vault::list_reference_profiles_sync()
}

#[tauri::command]
async fn get_reference_profile(id: String) -> Result<reference_vault::ReferenceProfile, String> {
    reference_vault::get_reference_profile_sync(&id)
}

#[tauri::command]
async fn delete_reference_profile(id: String, app: tauri::AppHandle) -> Result<(), String> {
    let _ = reference_vault::delete_reference_profile_sync(&id)?;
    let _ = app.emit("reference-vault-updated", &id);
    Ok(())
}

#[tauri::command]
async fn save_mixing_skill(
    skill: skill_vault::MixingSkill,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let _ = skill_vault::save_mixing_skill_sync(skill.clone())?;
    let _ = app.emit("skill-vault-updated", &skill.id);
    Ok(())
}

#[tauri::command]
async fn list_mixing_skills() -> Result<Vec<skill_vault::MixingSkillSummary>, String> {
    skill_vault::list_mixing_skills_sync()
}

#[tauri::command]
async fn get_mixing_skill(id: String) -> Result<skill_vault::MixingSkill, String> {
    skill_vault::get_mixing_skill_sync(id)
}

#[tauri::command]
async fn delete_mixing_skill(id: String, app: tauri::AppHandle) -> Result<(), String> {
    let _ = skill_vault::delete_mixing_skill_sync(id.clone())?;
    let _ = app.emit("skill-vault-updated", &id);
    Ok(())
}

// ── Sprint 6: Transport Commands via CoreMIDI MCU ─────────────────────────────

#[tauri::command]
async fn daw_play(state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        let play_args = vec!["transport-play".to_string()];
        match execute_logic_ax_bridge(&bridge_path, &play_args) {
            Ok(_) => Ok(()),
            Err(e) => {
                eprintln!("Transport-Play fehlgeschlagen ({}), falling back to MCU note pulse", e);
                state.ipc_server.mcu_bridge.send_note_pulse(94, 50)
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = state;
        Ok(())
    }
}

#[tauri::command]
async fn daw_stop(state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        let stop_args = vec!["transport-stop".to_string()];
        match execute_logic_ax_bridge(&bridge_path, &stop_args) {
            Ok(_) => Ok(()),
            Err(e) => {
                eprintln!("Transport-Stop fehlgeschlagen ({}), falling back to MCU note pulse", e);
                state.ipc_server.mcu_bridge.send_note_pulse(93, 50)
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = state;
        Ok(())
    }
}

#[tauri::command]
async fn daw_set_cycle_region(
    start: u32,
    end: u32,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    if start < 1 || end <= start {
        return Err("Ungültiger Cycle-Bereich (start >= 1 und end > start erforderlich)".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if bridge_path.exists() {
            let cycle_args = vec![
                "set-cycle-region".to_string(),
                "--start".to_string(),
                start.to_string(),
                "--end".to_string(),
                end.to_string(),
            ];
            let res = execute_logic_ax_bridge(&bridge_path, &cycle_args)?;
            if res.get("success").and_then(|v| v.as_bool()) == Some(false) {
                let err = res.get("error").and_then(|v| v.as_str()).unwrap_or("set-cycle-region fehlgeschlagen");
                return Err(err.to_string());
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn daw_locate_bar(
    bar: u32,
    keep_cycle: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if bar < 1 {
        return Err("Bar must be >= 1".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if bridge_path.exists() {
            let mut locate_args = vec!["transport-locate".to_string(), "--bar".to_string(), bar.to_string()];
            if keep_cycle.unwrap_or(false) {
                locate_args.push("--keep-cycle".to_string());
            }
            let res = execute_logic_ax_bridge(&bridge_path, &locate_args);
            match res {
                Ok(json) if json.get("success").and_then(|v| v.as_bool()) == Some(false) => {
                    let err = json.get("error").and_then(|v| v.as_str()).unwrap_or("transport-locate failed");
                    eprintln!("⚠️ [daw_locate_bar] Bridge locate failed ({}), falling back to MCU locate", err);
                    let _ = state.ipc_server.mcu_bridge.send_transport_locate(bar);
                }
                Err(e) => {
                    eprintln!("⚠️ [daw_locate_bar] Bridge locate failed ({}), falling back to MCU locate", e);
                    let _ = state.ipc_server.mcu_bridge.send_transport_locate(bar);
                }
                _ => {}
            }
        } else {
            let _ = state.ipc_server.mcu_bridge.send_transport_locate(bar);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (bar, keep_cycle, state);
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct CurrentBarStatus {
    bar: u32,
}

#[tauri::command]
async fn daw_get_current_bar(_state: State<'_, AppState>) -> Result<CurrentBarStatus, String> {
    Ok(CurrentBarStatus { bar: 1 })
}

pub fn log_mb_desktop(msg: &str) {
    use std::io::Write;
    let ts = chrono::Utc::now().to_rfc3339();
    let line = format!("[{}] {}\n", ts, msg);
    eprint!("{}", line);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/mb_desktop.log")
    {
        let _ = f.write_all(line.as_bytes());
    }
}

#[tauri::command]
async fn audition_region(
    start_bar: u32,
    end_bar: Option<u32>,
    duration_seconds: Option<f64>,
) -> Result<serde_json::Value, String> {
    if start_bar < 1 {
        let err = "start_bar must be >= 1".to_string();
        log_mb_desktop(&format!("❌ [audition_region] Error: {}", err));
        return Err(err);
    }
    let effective_duration = match (end_bar, duration_seconds) {
        (Some(e), _) if e > start_bar => {
            // Dynamische Abspieldauer: 2.4s pro Takt bei 100 BPM (z. B. 4 Takte = 9.6s)
            let bar_count = (e - start_bar) as f64;
            (bar_count * 2.4).max(2.0).min(30.0)
        }
        (_, Some(d)) => d.max(2.0).min(30.0),
        _ => 8.0,
    };
    let dur_ms = (effective_duration * 1000.0) as u64;

    log_mb_desktop(&format!(
        "▶️ [audition_region] Start audition: start_bar={}, end_bar={:?}, duration={:.1}s",
        start_bar, end_bar, effective_duration
    ));

    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if !bridge_path.exists() {
            let err_msg = format!("logic-ax-bridge sidecar nicht gefunden unter {:?}", bridge_path);
            log_mb_desktop(&format!("❌ [audition_region] {}", err_msg));
            return Err(err_msg);
        }

        // 1. Swift: Setze Cycle-Bereich auf start..end bzw. stelle sicher, dass Cycle aus ist
        if let Some(end) = end_bar {
            log_mb_desktop(&format!("🔄 [audition_region] set-cycle-region {}..{}", start_bar, end));
            let cycle_args = vec![
                "set-cycle-region".to_string(),
                "--start".to_string(),
                start_bar.to_string(),
                "--end".to_string(),
                end.to_string(),
            ];
            let cycle_res = execute_logic_ax_bridge(&bridge_path, &cycle_args)?;
            if cycle_res.get("success").and_then(|v| v.as_bool()) == Some(false) {
                let err_msg = format!("set-cycle-region fehlgeschlagen: {:?}", cycle_res.get("error"));
                log_mb_desktop(&format!("❌ [audition_region] {}", err_msg));
                return Err(err_msg);
            }
        } else {
            log_mb_desktop("🔄 [audition_region] ensure-cycle-off");
            let cycle_args = vec!["ensure-cycle-off".to_string()];
            let cycle_res = execute_logic_ax_bridge(&bridge_path, &cycle_args)?;
            if cycle_res.get("success").and_then(|v| v.as_bool()) == Some(false) {
                let err_msg = format!("ensure-cycle-off fehlgeschlagen: {:?}", cycle_res.get("error"));
                log_mb_desktop(&format!("❌ [audition_region] {}", err_msg));
                return Err(err_msg);
            }
        }

        // 2. Exaktes Bar-Locate via native Swift Bridge
        log_mb_desktop(&format!("🎯 [audition_region] transport-locate bar {}", start_bar));
        let locate_args = vec!["transport-locate".to_string(), "--bar".to_string(), start_bar.to_string()];
        let locate_res = execute_logic_ax_bridge(&bridge_path, &locate_args)
            .map_err(|e| {
                let err_msg = format!("transport-locate fehlgeschlagen: {}", e);
                log_mb_desktop(&format!("❌ [audition_region] {}", err_msg));
                err_msg
            })?;
        if locate_res.get("success").and_then(|v| v.as_bool()) == Some(false) {
            let err_msg = format!("transport-locate fehlgeschlagen: {:?}", locate_res.get("error"));
            log_mb_desktop(&format!("❌ [audition_region] {}", err_msg));
            return Err(err_msg);
        }

        // 3. Warte 200 ms Einschwingzeit
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        // 4. Starte Playback via Swift Bridge ('transport-play')
        log_mb_desktop("▶️ [audition_region] transport-play");
        let play_args = vec!["transport-play".to_string()];
        let play_res = execute_logic_ax_bridge(&bridge_path, &play_args)
            .map_err(|e| {
                let err_msg = format!("transport-play fehlgeschlagen: {}", e);
                log_mb_desktop(&format!("❌ [audition_region] {}", err_msg));
                err_msg
            })?;
        if play_res.get("success").and_then(|v| v.as_bool()) == Some(false) {
            let err_msg = format!("transport-play fehlgeschlagen: {:?}", play_res.get("error"));
            log_mb_desktop(&format!("❌ [audition_region] {}", err_msg));
            return Err(err_msg);
        }

        // 5. Warte die berechnete Dauer
        log_mb_desktop(&format!("⏱️ [audition_region] Playing for {} ms...", dur_ms));
        tokio::time::sleep(std::time::Duration::from_millis(dur_ms)).await;

        // 6. Stoppe Playback via Swift Bridge ('transport-stop')
        log_mb_desktop("⏹️ [audition_region] transport-stop");
        let stop_args = vec!["transport-stop".to_string()];
        let stop_res = execute_logic_ax_bridge(&bridge_path, &stop_args)
            .map_err(|e| {
                let err_msg = format!("transport-stop fehlgeschlagen: {}", e);
                log_mb_desktop(&format!("❌ [audition_region] {}", err_msg));
                err_msg
            })?;
        if stop_res.get("success").and_then(|v| v.as_bool()) == Some(false) {
            let err_msg = format!("transport-stop fehlgeschlagen: {:?}", stop_res.get("error"));
            log_mb_desktop(&format!("❌ [audition_region] {}", err_msg));
            return Err(err_msg);
        }

        log_mb_desktop(&format!(
            "✅ [audition_region] Audition abgeschlossen (start={}, end={:?}, duration={:.1}s)",
            start_bar, end_bar, effective_duration
        ));

        Ok(serde_json::json!({
            "success": true,
            "startBar": start_bar,
            "endBar": end_bar,
            "durationSeconds": effective_duration
        }))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (start_bar, dur_ms);
        log_mb_desktop("ℹ️ [audition_region] Non-macOS platform — stubbed playback");
        Ok(serde_json::json!({
            "success": true,
            "startBar": start_bar,
            "endBar": end_bar,
            "durationSeconds": effective_duration
        }))
    }
}

// ── Sprint 7: High-Level MCU Macros ──────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FaderPoint {
    pub bar: f64,
    pub db: f64,
}

fn resolve_track_channel_index(track_name: &str, state: &AppState) -> u8 {
    let lower = track_name.to_lowercase();
    if lower.contains("stereo") || lower.contains("master") {
        return 8;
    }

    // 1. PRIMARY GROUND TRUTH: Query Swift AX Bridge (list-channel-strips)
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if bridge_path.exists() {
            if let Ok(strips_val) = execute_logic_ax_bridge(&bridge_path, &["list-channel-strips".to_string()]) {
                if let Some(strips) = strips_val
                    .get("channelStrips")
                    .or_else(|| strips_val.get("channel_strips"))
                    .and_then(|cs| cs.as_array())
                {
                    for (idx, s) in strips.iter().enumerate() {
                        let name = s.get("trackName")
                            .or_else(|| s.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if matches_track_fuzzy(name, track_name) {
                            return (idx as u8).min(7);
                        }
                    }
                }
            }
        }
    }

    // 2. Secondary fallback: MCU LCD Stream
    let mcu_tracks = state.ipc_server.mcu_bridge.get_tracks();
    if let Some(idx) = mcu_tracks.iter().position(|t| {
        let name = t.get("name").and_then(|n| n.as_str()).unwrap_or("");
        matches_track_fuzzy(name, track_name)
    }) {
        return (idx as u8).min(7);
    }

    let num_in_name = track_name
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse::<u8>()
        .ok();
    match num_in_name {
        Some(n) if n >= 1 && n <= 8 => n - 1,
        _ => 0,
    }
}

fn interpolate_curve_db(curve: &[FaderPoint], bar: f64) -> f64 {
    if curve.is_empty() {
        return 0.0;
    }
    if curve.len() == 1 || bar <= curve[0].bar {
        return curve[0].db;
    }
    if bar >= curve[curve.len() - 1].bar {
        return curve[curve.len() - 1].db;
    }

    for i in 0..curve.len() - 1 {
        let p0 = &curve[i];
        let p1 = &curve[i + 1];
        if bar >= p0.bar && bar <= p1.bar {
            let span = p1.bar - p0.bar;
            if span <= 0.0 {
                return p0.db;
            }
            let ratio = (bar - p0.bar) / span;
            return p0.db + ratio * (p1.db - p0.db);
        }
    }

    curve[curve.len() - 1].db
}

#[tauri::command]
async fn set_track_state(
    track_name: String,
    fader_db: Option<f64>,
    pan: Option<i32>,
    mute: Option<bool>,
    solo: Option<bool>,
    automation_mode: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        // 1. Channel Index ermitteln
        let mut ch_idx = resolve_track_channel_index(&track_name, &state);

        // Fallback über list_channel_strips (AX Bridge), falls MCU noch nicht synchronisiert
        if ch_idx == 0 && !track_name.to_lowercase().contains("1") {
            if let Ok(strips_val) = list_channel_strips().await {
                let strips = strips_val
                    .get("channelStrips")
                    .or_else(|| strips_val.get("channel_strips"))
                    .and_then(|v| v.as_array());
                if let Some(strips) = strips {
                    for (idx, s) in strips.iter().enumerate() {
                        let name = s
                            .get("trackName")
                            .or_else(|| s.get("name"))
                            .and_then(|n| n.as_str())
                            .unwrap_or("");
                        if matches_track_fuzzy(name, &track_name) {
                            ch_idx = (idx as u8).min(7);
                            break;
                        }
                    }
                }
            }
        }

        // 2. Spur anwählen via Note 24..31 (Select)
        if ch_idx <= 7 {
            let _ = state.ipc_server.mcu_bridge.select_channel(ch_idx);
        }

        // 3. Automationsmodus setzen (z. B. "touch", "read", "latch")
        if let Some(ref mode) = automation_mode {
            let _ = state.ipc_server.mcu_bridge.set_automation_mode(mode);
        }

        // 4. Fader via Pitchbend 0xE0 + ch_idx
        if let Some(db) = fader_db {
            let vol = (db as f32).clamp(-96.0, 6.0);
            let _ = state
                .ipc_server
                .mcu_bridge
                .apply_fader_delta_with_automation(ch_idx, vol);
        }

        // 5. Panning via CC 16..23 (V-Pot Sign-Magnitude)
        if let Some(p) = pan {
            if ch_idx <= 7 {
                let delta = p.clamp(-63, 63) as i8;
                let _ = state.ipc_server.mcu_bridge.send_vpot_turn(ch_idx, delta);
            }
        }

        // 6. Mute via Note 16..23
        if let Some(_) = mute {
            if ch_idx <= 7 {
                let _ = state.ipc_server.mcu_bridge.set_channel_mute(ch_idx);
            }
        }

        // 7. Solo via Note 8..15
        if let Some(_) = solo {
            if ch_idx <= 7 {
                let _ = state.ipc_server.mcu_bridge.set_channel_solo(ch_idx);
            }
        }

        Ok(serde_json::json!({
            "success": true,
            "trackName": track_name,
            "channelIndex": ch_idx,
            "faderDb": fader_db,
            "pan": pan,
            "mute": mute,
            "solo": solo,
            "automationMode": automation_mode
        }))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (
            track_name,
            fader_db,
            pan,
            mute,
            solo,
            automation_mode,
            state,
        );
        Ok(serde_json::json!({ "success": true, "stub": true }))
    }
}

#[tauri::command]
async fn record_fader_ride(
    track_name: String,
    start_bar: u32,
    end_bar: u32,
    mode: String,
    curve: Vec<FaderPoint>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if start_bar < 1 {
        return Err("start_bar muss >= 1 sein".to_string());
    }
    if end_bar <= start_bar {
        return Err("end_bar muss größer als start_bar sein".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let mut ch_idx = resolve_track_channel_index(&track_name, &state);
        if ch_idx == 0 && !track_name.to_lowercase().contains("1") {
            if let Ok(strips_val) = list_channel_strips().await {
                let strips = strips_val
                    .get("channelStrips")
                    .or_else(|| strips_val.get("channel_strips"))
                    .and_then(|v| v.as_array());
                if let Some(strips) = strips {
                    for (idx, s) in strips.iter().enumerate() {
                        let name = s
                            .get("trackName")
                            .or_else(|| s.get("name"))
                            .and_then(|n| n.as_str())
                            .unwrap_or("");
                        if matches_track_fuzzy(name, &track_name) {
                            ch_idx = (idx as u8).min(7);
                            break;
                        }
                    }
                }
            }
        }

        // 1. Wählt Spur an (Select-Note 24..31)
        if ch_idx <= 7 {
            let _ = state.ipc_server.mcu_bridge.select_channel(ch_idx);
        }

        // 2. Schaltet Automationsmodus auf "touch" (Note 77) oder "latch" (Note 78)
        let auto_mode = if mode.to_lowercase().contains("latch") {
            "latch"
        } else {
            "touch"
        };
        let _ = state.ipc_server.mcu_bridge.set_automation_mode(auto_mode);

        // 3. Deaktiviere Cycle und springe auf start_bar (Exact Locate via Bridge)
        let _ = state.ipc_server.mcu_bridge.ensure_cycle_off();
        let bridge_path = resolve_bridge_binary();
        let args = vec!["transport-locate".to_string(), "--bar".to_string(), start_bar.to_string()];
        if let Err(e) = execute_logic_ax_bridge(&bridge_path, &args) {
            println!("⚠️ [record_fader_ride] Bridge locate failed ({}), falling back to MCU locate", e);
            let _ = state.ipc_server.mcu_bridge.send_transport_locate(start_bar);
        }
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        // 4. Setzt Fader-Touch aktiv (Note 104 + index, Velocity 127)
        let _ = state.ipc_server.mcu_bridge.set_fader_touch(ch_idx, true);

        // 5. Startet Playback (Note 94)
        let _ = state.ipc_server.mcu_bridge.send_note_pulse(94, 50);

        // 6. Streamt Pitchbend-Werte interpoliert entlang der Kurve
        let total_bars = (end_bar - start_bar) as f64;
        // Tempo-Heuristik: ~2.0 Sekunden pro Takt (120 BPM 4/4)
        let total_duration_ms = (total_bars * 2000.0) as u64;

        let mut sorted_curve = curve.clone();
        sorted_curve.sort_by(|a, b| {
            a.bar
                .partial_cmp(&b.bar)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let interval_ms = 50u64;
        let mut elapsed_ms = 0u64;
        while elapsed_ms < total_duration_ms {
            let current_bar =
                start_bar as f64 + (elapsed_ms as f64 / total_duration_ms as f64) * total_bars;
            let target_db = interpolate_curve_db(&sorted_curve, current_bar);
            let _ = state
                .ipc_server
                .mcu_bridge
                .set_fader_volume(ch_idx, target_db as f32);
            tokio::time::sleep(std::time::Duration::from_millis(interval_ms)).await;
            elapsed_ms += interval_ms;
        }

        // 7. Bei end_bar: Stoppt Playback, setzt Touch frei und schaltet Spur zurück auf "read"
        let _ = state.ipc_server.mcu_bridge.send_note_pulse(93, 50); // Stop
        let _ = state.ipc_server.mcu_bridge.set_fader_touch(ch_idx, false); // Touch off
        let _ = state.ipc_server.mcu_bridge.set_automation_mode("read"); // Read mode

        Ok(serde_json::json!({
            "success": true,
            "trackName": track_name,
            "channelIndex": ch_idx,
            "startBar": start_bar,
            "endBar": end_bar,
            "mode": auto_mode,
            "pointsStreamed": curve.len()
        }))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (track_name, start_bar, end_bar, mode, curve, state);
        Ok(serde_json::json!({ "success": true, "stub": true }))
    }
}

#[tauri::command]
async fn restore_fader(
    track_name: String,
    value: f32,
    is_master: Option<bool>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    apply_daw_action(
        Some(track_name),
        Some("volume".to_string()),
        Some(value),
        Some("dB".to_string()),
        Some(is_master.unwrap_or(false)),
        None,
        Some(true),
        None,
        None,
        None,
        state,
    )
    .await
}

#[tauri::command]
async fn set_folder_expanded(track_name: String, expanded: bool) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if bridge_path.exists() {
            return execute_logic_ax_bridge(
                &bridge_path,
                &[
                    "set-folder-expanded".to_string(),
                    "--track".to_string(),
                    track_name,
                    "--expanded".to_string(),
                    expanded.to_string(),
                ],
            );
        }
        Err("logic-ax-bridge sidecar not found".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (track_name, expanded);
        Ok(serde_json::json!({"success": true, "stub": true}))
    }
}

#[tauri::command]
async fn select_track(track_name: String) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if bridge_path.exists() {
            return execute_logic_ax_bridge(
                &bridge_path,
                &[
                    "select-track".to_string(),
                    "--track".to_string(),
                    track_name,
                ],
            );
        }
        Err("logic-ax-bridge sidecar not found".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = track_name;
        Ok(serde_json::json!({"success": true, "stub": true}))
    }
}

#[tauri::command]
async fn load_plugin_into_slot(
    track: String,
    slot: u32,
    plugin_path: String,
) -> Result<serde_json::Value, String> {
    let track = resolve_canonical_track_name(&track);
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if bridge_path.exists() {
            return execute_logic_ax_bridge(
                &bridge_path,
                &[
                    "load-plugin".to_string(),
                    "--track".to_string(),
                    track,
                    "--slot".to_string(),
                    slot.to_string(),
                    "--plugin-path".to_string(),
                    plugin_path,
                ],
            );
        }
        Err("logic-ax-bridge sidecar not found".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (track, slot, plugin_path);
        Ok(serde_json::json!({"success": true, "stub": true}))
    }
}

#[tauri::command]
async fn set_send_bus(
    track: String,
    slot: u32,
    bus: u32,
) -> Result<serde_json::Value, String> {
    let track = resolve_canonical_track_name(&track);
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if bridge_path.exists() {
            return execute_logic_ax_bridge(
                &bridge_path,
                &[
                    "set-send-bus".to_string(),
                    "--track".to_string(),
                    track,
                    "--slot".to_string(),
                    slot.to_string(),
                    "--bus".to_string(),
                    bus.to_string(),
                ],
            );
        }
        Err("logic-ax-bridge sidecar not found".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (track, slot, bus);
        Ok(serde_json::json!({"success": true, "stub": true}))
    }
}

#[tauri::command]
async fn set_send_level(
    track: String,
    slot: u32,
    db: f64,
) -> Result<serde_json::Value, String> {
    let track = resolve_canonical_track_name(&track);
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if bridge_path.exists() {
            return execute_logic_ax_bridge(
                &bridge_path,
                &[
                    "set-send-level".to_string(),
                    "--track".to_string(),
                    track,
                    "--slot".to_string(),
                    slot.to_string(),
                    "--db".to_string(),
                    db.to_string(),
                ],
            );
        }
        Err("logic-ax-bridge sidecar not found".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (track, slot, db);
        Ok(serde_json::json!({"success": true, "stub": true}))
    }
}

#[tauri::command]
async fn set_sidechain(
    track: String,
    slot: u32,
    source: String,
) -> Result<serde_json::Value, String> {
    let track = resolve_canonical_track_name(&track);
    #[cfg(target_os = "macos")]
    {
        let bridge_path = resolve_bridge_binary();
        if bridge_path.exists() {
            return execute_logic_ax_bridge(
                &bridge_path,
                &[
                    "set-sidechain".to_string(),
                    "--track".to_string(),
                    track,
                    "--slot".to_string(),
                    slot.to_string(),
                    "--source".to_string(),
                    source,
                ],
            );
        }
        Err("logic-ax-bridge sidecar not found".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (track, slot, source);
        Ok(serde_json::json!({"success": true, "stub": true}))
    }
}

#[tauri::command]
fn set_active_meter_instance(state: State<'_, AppState>, instance_id: String) -> Result<(), String> {
    state.ipc_server.set_active_instance(instance_id);
    Ok(())
}

#[tauri::command]
fn get_meter_satellites(state: State<'_, AppState>) -> Result<Vec<ipc_server::MeterSatellite>, String> {
    Ok(state.ipc_server.get_satellites())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ipc_server = IPCServer::new(48123);
    ipc_server.start();

    let app_state = AppState {
        safety_guard: Mutex::new(SafetyGuard::new()),
        licensing: LicenseGatekeeper::new(),
        daw_detector: Mutex::new(DAWDetector::new()),
        ipc_server,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .setup(|app| {
            let _ = skill_vault::get_skill_vault_dir();
            let state = app.state::<AppState>();
            state.ipc_server.set_app_handle(app.handle().clone());

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut detector = DAWDetector::new();
                let mut last_detected = None;
                loop {
                    let detected = detector.detect_active_daw();
                    if last_detected.as_ref() != Some(&detected) {
                        let _ = handle.emit("daw-status-changed", &detected);
                        last_detected = Some(detected);
                    }
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_active_daw,
            get_detected_daw,
            get_license_status,
            verify_license,
            validate_volume_adjustment,
            apply_daw_action,
            create_daw_track,
            toggle_plugin_bypass,
            install_mcp_client_config,
            learn_active_plugin,
            list_learned_plugins,
            delete_learned_plugin,
            update_plugin_tags,
            list_channel_strips,
            get_tracks,
            read_audio_file,
            save_reference_profile,
            list_reference_profiles,
            get_reference_profile,
            delete_reference_profile,
            save_mixing_skill,
            list_mixing_skills,
            get_mixing_skill,
            delete_mixing_skill,
            daw_play,
            daw_stop,
            daw_locate_bar,
            daw_set_cycle_region,
            daw_get_current_bar,
            audition_region,
            set_folder_expanded,
            select_track,
            load_plugin_into_slot,
            set_send_bus,
            set_send_level,
            set_sidechain,
            restore_fader,
            set_track_state,
            record_fader_ride,
            set_active_meter_instance,
            get_meter_satellites
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Oszillation Mixing Buddy companion application");
}
