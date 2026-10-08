use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

pub const LICENSE_VERIFY_ENDPOINT: &str = "https://buddy.oszillation-studio.de/api/v1/license/verify";
pub const OFFLINE_GRACE_DAYS: i64 = 7;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseFeatures {
    pub max_tracks: usize,
    pub allow_mcp_server: bool,
    pub allow_local_models: bool,
    pub allow_cloud_reasoning: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseState {
    pub is_valid: bool,
    pub tier: String,
    pub licensee: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_online_verification: DateTime<Utc>,
    pub offline_days_remaining: i64,
    pub features: LicenseFeatures,
}

impl Default for LicenseState {
    fn default() -> Self {
        Self {
            is_valid: true,
            tier: "pro_subscription".to_string(),
            licensee: "Licensed Studio Engineer".to_string(),
            expires_at: Some(Utc::now() + Duration::days(365)),
            last_online_verification: Utc::now(),
            offline_days_remaining: OFFLINE_GRACE_DAYS,
            features: LicenseFeatures {
                max_tracks: 128,
                allow_mcp_server: true,
                allow_local_models: true,
                allow_cloud_reasoning: true,
            },
        }
    }
}

#[derive(Clone)]
pub struct LicenseGatekeeper {
    state: Arc<Mutex<LicenseState>>,
}

impl LicenseGatekeeper {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(LicenseState::default())),
        }
    }

    pub fn get_status(&self) -> LicenseState {
        let mut current = self.state.lock().unwrap().clone();
        let now = Utc::now();
        let elapsed = now.signed_duration_since(current.last_online_verification);
        let days_passed = elapsed.num_days();

        current.offline_days_remaining = (OFFLINE_GRACE_DAYS - days_passed).max(0);
        if days_passed > OFFLINE_GRACE_DAYS {
            current.is_valid = false;
        }

        current
    }

    /// Verifies license against server or validates offline grace period
    pub async fn verify_license(&self, license_key: &str) -> Result<LicenseState, String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| e.to_string())?;

        let payload = serde_json::json!({
            "licenseKey": license_key,
            "machineFingerprint": "macOS-AppleSilicon-Host",
            "clientVersion": "0.1.0"
        });

        match client.post(LICENSE_VERIFY_ENDPOINT).json(&payload).send().await {
            Ok(resp) if resp.status().is_success() => {
                let mut state = self.state.lock().unwrap();
                state.is_valid = true;
                state.last_online_verification = Utc::now();
                state.offline_days_remaining = OFFLINE_GRACE_DAYS;
                Ok(state.clone())
            }
            _ => {
                // Offline fallback: check 7-day grace period
                let status = self.get_status();
                if status.is_valid {
                    Ok(status)
                } else {
                    Err("License expired: 7-day offline grace period exceeded. Please connect to internet.".to_string())
                }
            }
        }
    }
}
