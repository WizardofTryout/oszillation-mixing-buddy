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
            // 1. First priority: Fast and infallible native macOS process search via pgrep
            if let Ok(output) = std::process::Command::new("pgrep")
                .arg("-if")
                .arg("Logic Pro")
                .output()
            {
                if output.status.success() && !output.stdout.is_empty() {
                    return DetectedDAW::LogicPro;
                }
            }
            if let Ok(output) = std::process::Command::new("pgrep")
                .arg("-il")
                .arg("Logic")
                .output()
            {
                if output.status.success() && !output.stdout.is_empty() {
                    return DetectedDAW::LogicPro;
                }
            }
            if let Ok(output) = std::process::Command::new("pgrep")
                .arg("-if")
                .arg("Nuendo")
                .output()
            {
                if output.status.success() && !output.stdout.is_empty() {
                    return DetectedDAW::Nuendo;
                }
            }
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detector_instantiation() {
        let mut detector = DAWDetector::new();
        let _ = detector.detect_active_daw();
    }
}
