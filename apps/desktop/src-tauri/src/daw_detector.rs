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
