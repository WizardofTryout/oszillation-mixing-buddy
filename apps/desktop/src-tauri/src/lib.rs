pub mod daw_detector;
pub mod ipc_server;
pub mod licensing;
pub mod safety_guard;

use daw_detector::{DAWDetector, DetectedDAW};
use ipc_server::IPCServer;
use licensing::{LicenseGatekeeper, LicenseState};
use safety_guard::SafetyGuard;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub safety_guard: Mutex<SafetyGuard>,
    pub licensing: LicenseGatekeeper,
    pub daw_detector: Mutex<DAWDetector>,
    pub ipc_server: IPCServer,
}

#[tauri::command]
fn get_active_daw(state: State<'_, AppState>) -> DetectedDAW {
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
        .invoke_handler(tauri::generate_handler![
            get_active_daw,
            get_license_status,
            verify_license,
            validate_volume_adjustment
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Steinberg Mixing Buddy companion application");
}
