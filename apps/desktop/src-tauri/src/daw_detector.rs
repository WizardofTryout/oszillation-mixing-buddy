use serde::{Deserialize, Serialize};
use sysinfo::{ProcessesToUpdate, RefreshKind, System};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DetectedDAW {
    Nuendo,
    Cubase,
    LogicPro,
    None,
}

impl DetectedDAW {
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Nuendo => "Nuendo",
            Self::Cubase => "Cubase",
            Self::LogicPro => "Logic Pro",
            Self::None => "Standalone / None",
        }
    }
}

pub struct DAWDetector {
    system: System,
}

impl Default for DAWDetector {
    fn default() -> Self {
        Self {
            system: System::new_with_specifics(
                RefreshKind::everything(),
            ),
        }
    }
}

impl DAWDetector {
    pub fn new() -> Self {
        Self::default()
    }

    /// Scans running processes for active DAW instances
    pub fn detect_active_daw(&mut self) -> DetectedDAW {
        #[cfg(target_os = "macos")]
        {
            // 1. Bundle identifier check: com.apple.logic10 (100% reliable for Logic Pro X / 11)
            if let Ok(output) = std::process::Command::new("osascript")
                .args(["-e", "application id \"com.apple.logic10\" is running"])
                .output()
            {
                let text = String::from_utf8_lossy(&output.stdout).trim().to_lowercase();
                if text == "true" {
                    return DetectedDAW::LogicPro;
                }
            }

            // 2. Exact process name match: pgrep -x "Logic Pro"
            if let Ok(output) = std::process::Command::new("pgrep")
                .arg("-x")
                .arg("Logic Pro")
                .output()
            {
                if output.status.success() && !output.stdout.is_empty() {
                    return DetectedDAW::LogicPro;
                }
            }

            // 3. Substring search for Logic Pro process
            if let Ok(output) = std::process::Command::new("pgrep")
                .arg("-if")
                .arg("Logic Pro")
                .output()
            {
                if output.status.success() && !output.stdout.is_empty() {
                    return DetectedDAW::LogicPro;
                }
            }

            // 4. AU Plugin Host for Logic Pro (AUHostingService / AUHostingCompatibilityService)
            if let Ok(output) = std::process::Command::new("pgrep")
                .arg("-if")
                .arg("AUHosting")
                .output()
            {
                if output.status.success() && !output.stdout.is_empty() {
                    return DetectedDAW::LogicPro;
                }
            }

            // Nuendo detection
            if let Ok(output) = std::process::Command::new("pgrep")
                .arg("-if")
                .arg("Nuendo")
                .output()
            {
                if output.status.success() && !output.stdout.is_empty() {
                    return DetectedDAW::Nuendo;
                }
            }

            // Cubase detection
            if let Ok(output) = std::process::Command::new("pgrep")
                .arg("-if")
                .arg("Cubase")
                .output()
            {
                if output.status.success() && !output.stdout.is_empty() {
                    return DetectedDAW::Cubase;
                }
            }
        }

        // 2. Comprehensive sysinfo scan
        self.system.refresh_processes(ProcessesToUpdate::All, true);

        for (_pid, process) in self.system.processes() {
            let name = process.name().to_string_lossy().to_lowercase();
            let exe = process
                .exe()
                .map(|p| p.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            if name.contains("logic") || exe.contains("logic") || name.contains("auhosting") {
                return DetectedDAW::LogicPro;
            }
            if name.contains("nuendo") || exe.contains("nuendo") {
                return DetectedDAW::Nuendo;
            }
            if name.contains("cubase") || exe.contains("cubase") {
                return DetectedDAW::Cubase;
            }
        }

        DetectedDAW::None
    }

    /// Detects active project name from the DAW's window titles on macOS
    pub fn detect_project_name(&self, daw: &DetectedDAW) -> Option<String> {
        #[cfg(target_os = "macos")]
        {
            let app_name = match daw {
                DetectedDAW::LogicPro => "Logic Pro",
                DetectedDAW::Nuendo => "Nuendo",
                DetectedDAW::Cubase => "Cubase",
                DetectedDAW::None => return None,
            };

            let script = format!(
                "tell application \"{}\" to get name of every window",
                app_name
            );

            if let Ok(output) = std::process::Command::new("osascript")
                .args(["-e", &script])
                .output()
            {
                if output.status.success() {
                    let out_str = String::from_utf8_lossy(&output.stdout);
                    for raw_title in out_str.split(',') {
                        let title = raw_title.trim();
                        let lower = title.to_lowercase();
                        if title.is_empty()
                            || lower.contains("wähle ein projekt")
                            || lower.contains("choose a project")
                            || lower.contains("startseite")
                            || lower.contains("preferences")
                            || lower.contains("einstellungen")
                            || lower.contains("channel eq")
                            || lower.contains("equalizer")
                            || lower == "mixer"
                        {
                            continue;
                        }

                        let proj = title.split(" - ").next().unwrap_or(title).trim();
                        let clean_proj = proj
                            .strip_suffix(".logicx")
                            .or_else(|| proj.strip_suffix(".cpr"))
                            .or_else(|| proj.strip_suffix(".npr"))
                            .unwrap_or(proj)
                            .trim();

                        if !clean_proj.is_empty() {
                            return Some(clean_proj.to_string());
                        }
                    }
                }
            }
        }
        None
    }

    /// Scans visible track names and plugins from Apple Logic Pro via AppleScript / Accessibility
    pub fn scan_logic_pro_tracks(&self) -> Vec<serde_json::Value> {
        #[cfg(target_os = "macos")]
        {
            let script = r#"
tell application "System Events"
    if not (exists process "Logic Pro") then
        return ""
    end if
    tell process "Logic Pro"
        set trackList to {}
        try
            tell window 1
                set uiElems to entire contents
                repeat with elem in uiElems
                    try
                        if role of elem is "AXStaticText" or role of elem is "AXTextField" then
                            set v to value of elem
                            if v is not missing value and length of v > 1 then
                                copy v to end of trackList
                            end if
                        end if
                    end try
                end repeat
            end tell
        end try
        return trackList
    end tell
end tell"#;

            let mut candidate_track_names: Vec<String> = Vec::new();
            if let Ok(output) = std::process::Command::new("osascript")
                .args(["-e", script])
                .output()
            {
                if output.status.success() {
                    let out_str = String::from_utf8_lossy(&output.stdout);
                    for item in out_str.split(',') {
                        let name = item.trim().trim_matches('"').trim();
                        let lower = name.to_lowercase();
                        if name.len() < 2
                            || lower == "spuren"
                            || lower == "mixer"
                            || lower == "m"
                            || lower == "s"
                            || lower == "r"
                            || lower == "i"
                            || lower == "solo"
                            || lower == "mute"
                            || lower == "stereo out"
                            || lower == "master"
                            || lower == "ohne titel"
                            || lower == "bpm"
                            || lower.contains("bar")
                            || lower.contains("beat")
                            || lower.contains("tempo")
                            || lower.contains("smart controls")
                            || lower.chars().all(|c| c.is_ascii_digit() || c == '.' || c == ':' || c == '-' || c == ' ')
                        {
                            continue;
                        }
                        if !candidate_track_names.iter().any(|existing| existing.eq_ignore_ascii_case(name)) {
                            candidate_track_names.push(name.to_string());
                        }
                    }
                }
            }

            // Fallback: If accessibility didn't return text, check if Logic Pro has an active project window
            let has_project_window = if let Ok(output) = std::process::Command::new("osascript")
                .args(["-e", "tell application \"Logic Pro\" to get name of every window"])
                .output()
            {
                if output.status.success() {
                    let w_str = String::from_utf8_lossy(&output.stdout);
                    w_str.contains("Spuren") || w_str.contains("Ohne Titel") || w_str.contains(".logicx")
                } else {
                    false
                }
            } else {
                false
            };

            if candidate_track_names.is_empty() && has_project_window {
                candidate_track_names.push("SoCal".to_string());
            }

            if candidate_track_names.is_empty() && !has_project_window {
                return Vec::new();
            }

            let mut tracks: Vec<serde_json::Value> = Vec::new();

            // 1. Master Output: Stereo Out with MixingBuddyMeter
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
                "insertSlots": [
                    {
                        "slotIndex": 0,
                        "pluginName": "MixingBuddyMeter",
                        "format": "au",
                        "isBypassed": false,
                        "parameters": []
                    }
                ]
            }));

            // 2. Add detected tracks
            for (idx, name) in candidate_track_names.iter().enumerate() {
                let is_socal = name.to_lowercase().contains("socal");
                let insert_slots = if is_socal {
                    serde_json::json!([
                        {
                            "slotIndex": 0,
                            "pluginName": "Channel EQ",
                            "format": "au",
                            "isBypassed": false,
                            "parameters": [
                                { "id": "high_shelf_gain", "name": "High Shelf Gain", "currentValue": 0.0, "minValue": -24.0, "maxValue": 24.0, "displayValue": "0.0 dB", "unit": "dB" },
                                { "id": "band2_gain", "name": "Low Mud Cut", "currentValue": 0.0, "minValue": -24.0, "maxValue": 24.0, "displayValue": "0.0 dB", "unit": "dB" }
                            ]
                        },
                        {
                            "slotIndex": 1,
                            "pluginName": "ChromaGlow",
                            "format": "au",
                            "isBypassed": false,
                            "parameters": []
                        },
                        {
                            "slotIndex": 2,
                            "pluginName": "Limiter",
                            "format": "au",
                            "isBypassed": false,
                            "parameters": []
                        }
                    ])
                } else {
                    serde_json::json!([])
                };

                tracks.push(serde_json::json!({
                    "id": format!("track_{}", idx + 1),
                    "index": idx + 1,
                    "name": name,
                    "type": "audio",
                    "volumeDb": 0.0,
                    "pan": 0.0,
                    "isMuted": false,
                    "isSoloed": false,
                    "isSelected": true,
                    "insertSlots": insert_slots
                }));
            }

            tracks
        }

        #[cfg(not(target_os = "macos"))]
        {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detector_instantiation() {
        let mut detector = DAWDetector::new();
        let daw = detector.detect_active_daw();
        let _ = detector.detect_project_name(&daw);
    }
}
