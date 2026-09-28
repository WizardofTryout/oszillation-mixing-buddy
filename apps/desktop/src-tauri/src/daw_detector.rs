use serde::{Deserialize, Serialize};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

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
                RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()),
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
        self.system.refresh_processes(ProcessesToUpdate::All, true);

        for (_pid, process) in self.system.processes() {
            let name = process.name().to_string_lossy().to_lowercase();
            let exe = process
                .exe()
                .map(|p| p.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            if name.contains("logic") || exe.contains("logic pro") || name.contains("auhosting") {
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
