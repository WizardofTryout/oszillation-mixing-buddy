use std::collections::HashMap;
use std::time::{Duration, Instant};

pub struct SafetyGuard {
    pub master_max_db: f32,
    pub track_max_db: f32,
    pub fader_min_db: f32,
    pub max_step_jump_db: f32,
    last_volumes: HashMap<String, f32>,
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
            last_action_times: HashMap::new(),
        }
    }
}

impl SafetyGuard {
    pub fn new() -> Self {
        Self::default()
    }

    /// Validates and clamps a proposed volume change.
    /// Returns Ok(clamped_db) or Err(reason) if rejected by the acoustic safety shield.
    pub fn sanitize_volume(
        &mut self,
        track_id: &str,
        is_master: bool,
        proposed_db: f32,
    ) -> Result<f32, String> {
        let max_ceiling = if is_master {
            self.master_max_db
        } else {
            self.track_max_db
        };

        // 1. Hard clamp boundaries
        let clamped = proposed_db.clamp(self.fader_min_db, max_ceiling);

        // 2. Single-step sudden jump check (Acoustic Shock Shield)
        if let Some(&previous_db) = self.last_volumes.get(track_id) {
            let delta = clamped - previous_db;
            if delta > self.max_step_jump_db {
                return Err(format!(
                    "Acoustic Shield: Blocked dangerous volume jump of +{:.1} dB on '{}' (max allowed: +{:.1} dB)",
                    delta, track_id, self.max_step_jump_db
                ));
            }
        }

        // 3. Rate-limiting parameter bursts (min 5ms between modifications per track)
        let now = Instant::now();
        if let Some(&last_time) = self.last_action_times.get(track_id) {
            if now.duration_since(last_time) < Duration::from_millis(5) {
                return Err(format!(
                    "Rate Limiter: Parameter burst detected on track '{}'. Throttling.",
                    track_id
                ));
            }
        }

        self.last_volumes.insert(track_id.to_string(), clamped);
        self.last_action_times.insert(track_id.to_string(), now);

        Ok(clamped)
    }

    /// Reset tracked track state
    pub fn reset_track(&mut self, track_id: &str) {
        self.last_volumes.remove(track_id);
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
    fn test_jump_limiter() {
        let mut guard = SafetyGuard::new();
        guard.sanitize_volume("track_1", false, -10.0).unwrap();

        // Sleep to avoid rate limiter trip
        std::thread::sleep(std::time::Duration::from_millis(10));

        // Safe jump (+2.5 dB)
        assert!(guard.sanitize_volume("track_1", false, -7.5).is_ok());

        // Sleep to avoid rate limiter trip
        std::thread::sleep(std::time::Duration::from_millis(10));

        // Dangerous jump (+5.0 dB) -> Rejected!
        let result = guard.sanitize_volume("track_1", false, -2.5);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Acoustic Shield"));
    }

    #[test]
    fn test_rate_limiter() {
        let mut guard = SafetyGuard::new();
        guard.sanitize_volume("track_1", false, -10.0).unwrap();

        // Immediate subsequent call without delay (< 5ms) -> Rate limit error
        let burst = guard.sanitize_volume("track_1", false, -9.0);
        assert!(burst.is_err());
        assert!(burst.unwrap_err().contains("Rate Limiter"));
    }
}
