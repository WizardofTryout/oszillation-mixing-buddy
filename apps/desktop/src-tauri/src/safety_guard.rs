use std::collections::HashMap;
use std::time::{Duration, Instant};

pub struct SafetyGuard {
    pub master_max_db: f32,
    pub track_max_db: f32,
    pub fader_min_db: f32,
    pub max_step_jump_db: f32,
    last_volumes: HashMap<String, f32>,
    original_volumes: HashMap<String, f32>,
    last_action_times: HashMap<String, Instant>,
}

impl Default for SafetyGuard {
    fn default() -> Self {
        Self {
            master_max_db: 0.0,
            track_max_db: 6.0,
            fader_min_db: -96.0,
            max_step_jump_db: 3.0,
            last_volumes: HashMap::new(),
            original_volumes: HashMap::new(),
            last_action_times: HashMap::new(),
        }
    }
}

impl SafetyGuard {
    pub fn new() -> Self {
        Self::default()
    }

    /// Explicitly register or update baseline volume for A/B restore operations.
    pub fn register_baseline(&mut self, track_id: &str, original_db: f32) {
        self.original_volumes.insert(track_id.to_string(), original_db);
        self.last_volumes.insert(track_id.to_string(), original_db);
    }

    /// Validates and clamps a proposed volume change.
    /// Returns Ok(clamped_db) or Err(reason) if rejected by the acoustic safety shield.
    pub fn sanitize_volume_with_restore(
        &mut self,
        track_id: &str,
        is_master: bool,
        proposed_db: f32,
        is_restore: bool,
    ) -> Result<f32, String> {
        let max_ceiling = if is_master {
            self.master_max_db
        } else {
            self.track_max_db
        };

        // 1. Hard clamp boundaries
        let clamped = proposed_db.clamp(self.fader_min_db, max_ceiling);

        // 2. Asymmetrischer Lautstärke-Schutz (Acoustic Shock Shield)
        if let Some(&previous_db) = self.last_volumes.get(track_id) {
            let delta = clamped - previous_db;

            // Jede Pegelreduktion (Delta <= 0.0 dB) ist IMMER zulässig
            if delta > 0.0 {
                // Ausnahme A/B Restore: Entweder explizit als Restore geflaggt,
                // oder Rückkehr auf registrierten Ausgangswert oder sicheres Studio-Level (<= 0.0 dB)
                let is_safe_restore = is_restore
                    || (clamped <= 0.0 && previous_db < clamped)
                    || self.original_volumes.get(track_id)
                        .map(|&orig| (clamped - orig).abs() < 0.25 || (clamped <= orig && previous_db < orig))
                        .unwrap_or(false);

                if !is_safe_restore && delta > self.max_step_jump_db {
                    return Err(format!(
                        "Acoustic Shield: Blocked dangerous volume jump of +{:.1} dB on '{}' (max allowed: +{:.1} dB)",
                        delta, track_id, self.max_step_jump_db
                    ));
                }
            }
        } else {
            // First time this track is encountered: record current level as baseline (unless restoring)
            if !is_restore {
                self.original_volumes.insert(track_id.to_string(), clamped);
            }
        }

        // 3. Rate-limiting parameter bursts (min 5ms between modifications per track)
        let now = Instant::now();
        if !is_restore {
            if let Some(&last_time) = self.last_action_times.get(track_id) {
                if now.duration_since(last_time) < Duration::from_millis(5) {
                    return Err(format!(
                        "Rate Limiter: Parameter burst detected on track '{}'. Throttling.",
                        track_id
                    ));
                }
            }
        }

        self.last_volumes.insert(track_id.to_string(), clamped);
        self.last_action_times.insert(track_id.to_string(), now);

        Ok(clamped)
    }

    pub fn sanitize_volume(
        &mut self,
        track_id: &str,
        is_master: bool,
        proposed_db: f32,
    ) -> Result<f32, String> {
        self.sanitize_volume_with_restore(track_id, is_master, proposed_db, false)
    }

    /// Reset tracked track state
    pub fn reset_track(&mut self, track_id: &str) {
        self.last_volumes.remove(track_id);
        self.original_volumes.remove(track_id);
        self.last_action_times.remove(track_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_volume_clamping() {
        let mut guard = SafetyGuard::new();

        // Master clamp at 0 dB
        let master = guard.sanitize_volume("master", true, 4.0).unwrap();
        assert_eq!(master, 0.0);

        // Track clamp at +6 dB
        let track = guard.sanitize_volume("track_1", false, 12.0).unwrap();
        assert_eq!(track, 6.0);

        // Floor clamp at -96 dB
        let floor = guard.sanitize_volume("track_2", false, -120.0).unwrap();
        assert_eq!(floor, -96.0);
    }

    #[test]
    fn test_asymmetric_reduction_and_boost() {
        let mut guard = SafetyGuard::new();
        // Initial baseline 0.0 dB
        guard.sanitize_volume("track_1", false, 0.0).unwrap();

        std::thread::sleep(std::time::Duration::from_millis(10));

        // Pegelreduktion: Jede Absenkung (z.B. -12.0 dB) ist IMMER zulässig
        let dropped = guard.sanitize_volume("track_1", false, -12.0);
        assert!(dropped.is_ok());
        assert_eq!(dropped.unwrap(), -12.0);

        std::thread::sleep(std::time::Duration::from_millis(10));

        // A/B Restore: Rückkehr auf original_value (0.0 dB, Delta = +12.0 dB) darf NIEMALS blockiert werden
        let restored = guard.sanitize_volume("track_1", false, 0.0);
        assert!(restored.is_ok());
        assert_eq!(restored.unwrap(), 0.0);

        std::thread::sleep(std::time::Duration::from_millis(10));

        // Normale Anhebung > +3.0 dB über Baseline ohne Restore wird geblockt
        let dangerous_boost = guard.sanitize_volume("track_1", false, 4.5);
        assert!(dangerous_boost.is_err());
        assert!(dangerous_boost.unwrap_err().contains("Acoustic Shield"));

        std::thread::sleep(std::time::Duration::from_millis(10));

        // Sichere Anhebung <= +3.0 dB ist erlaubt
        let safe_boost = guard.sanitize_volume("track_1", false, 2.5);
        assert!(safe_boost.is_ok());
    }

    #[test]
    fn test_ab_audition_drop_and_restore_flow() {
        let mut guard = SafetyGuard::new();
        // Track starts at 0.0 dB (nominal)
        guard.register_baseline("Lead Vocals", 0.0);

        std::thread::sleep(std::time::Duration::from_millis(10));

        // Audition start: Fader drop to -8.0 dB
        let dropped = guard.sanitize_volume_with_restore("Lead Vocals", false, -8.0, false);
        assert!(dropped.is_ok());
        assert_eq!(dropped.unwrap(), -8.0);

        std::thread::sleep(std::time::Duration::from_millis(10));

        // Audition restore: Fader returns to 0.0 dB (+8.0 dB jump) with is_restore = true
        let restored = guard.sanitize_volume_with_restore("Lead Vocals", false, 0.0, true);
        assert!(restored.is_ok());
        assert_eq!(restored.unwrap(), 0.0);
    }

    #[test]
    fn test_rate_limiter() {
        let mut guard = SafetyGuard::new();
        guard.sanitize_volume("track_1", false, -10.0).unwrap();

        // Immediate subsequent call without delay (< 5ms) -> Rate limit error
        let burst = guard.sanitize_volume("track_1", false, -11.0);
        assert!(burst.is_err());
        assert!(burst.unwrap_err().contains("Rate Limiter"));
    }
}
