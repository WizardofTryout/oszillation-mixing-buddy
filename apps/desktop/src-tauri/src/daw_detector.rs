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
            // 1. Exact process name match: pgrep -x "Logic Pro"
            if let Ok(output) = std::process::Command::new("pgrep")
                .arg("-x")
                .arg("Logic Pro")
                .output()
            {
                if output.status.success() && !output.stdout.is_empty() {
                    return DetectedDAW::LogicPro;
                }
            }

            // 2. Substring search for Logic Pro process
            if let Ok(output) = std::process::Command::new("pgrep")
                .arg("-if")
                .arg("Logic Pro")
                .output()
            {
                if output.status.success() && !output.stdout.is_empty() {
                    return DetectedDAW::LogicPro;
                }
            }

            // 3. AU Plugin Host for Logic Pro (AUHostingService / AUHostingCompatibilityService)
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

    /// Detects active project name from the DAW's window titles on macOS via native Swift bridge
    pub fn detect_project_name(&self, daw: &DetectedDAW) -> Option<String> {
        #[cfg(target_os = "macos")]
        {
            if *daw == DetectedDAW::LogicPro {
                let bridge = crate::resolve_bridge_path();
                if let Ok(output) = std::process::Command::new(&bridge)
                    .arg("scan-windows")
                    .output()
                {
                    if output.status.success() {
                        if let Ok(arr) = serde_json::from_slice::<Vec<serde_json::Value>>(&output.stdout) {
                            for win in arr {
                                let subrole = win.get("subrole").and_then(|v| v.as_str()).unwrap_or("");
                                let title = win.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
                                if subrole == "AXStandardWindow" && !title.is_empty() {
                                    let proj = title.split(" - ").next().unwrap_or(title).trim();
                                    let clean_proj = proj.strip_suffix(".logicx").unwrap_or(proj).trim();
                                    if !clean_proj.is_empty() {
                                        return Some(clean_proj.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        let _ = daw;
        None
    }

    /// Scans visible track names and open plugin windows from Apple Logic Pro via native `logic-ax-bridge`
    pub fn scan_logic_pro_tracks(&self) -> Vec<serde_json::Value> {
        #[cfg(target_os = "macos")]
        {
            let bridge = crate::resolve_bridge_path();
            let mut candidate_track_names: Vec<String> = Vec::new();

            if let Ok(output) = std::process::Command::new(&bridge)
                .arg("scan-tracks")
                .output()
            {
                if output.status.success() {
                    if let Ok(names) = serde_json::from_slice::<Vec<String>>(&output.stdout) {
                        for raw_name in names {
                            let name = raw_name.trim();
                            let lower = name.to_lowercase();
                            if name.len() < 2
                                || lower == "stereo out"
                                || lower == "master"
                                || lower == "mixer"
                                || lower == "spuren"
                                || lower == "tracks"
                            {
                                continue;
                            }
                            if !candidate_track_names.iter().any(|existing| existing.eq_ignore_ascii_case(name)) {
                                candidate_track_names.push(name.to_string());
                            }
                        }
                    }
                }
            }

            if candidate_track_names.is_empty() {
                return Vec::new();
            }

            let mut tracks: Vec<serde_json::Value> = Vec::new();

            // 1. Master Output: Stereo Out
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

            // 2. Dynamically discovered tracks (no static mock plugins or parameters)
            for (idx, name) in candidate_track_names.iter().enumerate() {
                tracks.push(serde_json::json!({
                    "id": format!("track_{}", idx + 1),
                    "index": idx + 1,
                    "name": name,
                    "type": "audio",
                    "volumeDb": 0.0,
                    "pan": 0.0,
                    "isMuted": false,
                    "isSoloed": false,
                    "isSelected": idx == 0,
                    "insertSlots": []
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
