use serde::{Deserialize, Serialize};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DetectedDAW {
    Nuendo,
    Cubase,
    LogicPro,
    None,
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

            if name.contains("nuendo") {
                return DetectedDAW::Nuendo;
            }
            if name.contains("cubase") {
                return DetectedDAW::Cubase;
            }
            if name.contains("logic pro") {
                return DetectedDAW::LogicPro;
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
