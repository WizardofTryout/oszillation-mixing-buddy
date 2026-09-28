pub mod daw_detector;
pub mod ipc_server;
pub mod licensing;
pub mod safety_guard;

use daw_detector::{DAWDetector, DetectedDAW};
use ipc_server::IPCServer;
use licensing::{LicenseGatekeeper, LicenseState};
use safety_guard::SafetyGuard;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

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
fn get_detected_daw(state: State<'_, AppState>) -> DetectedDAW {
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

#[tauri::command]
async fn apply_daw_action(
    track_name: String,
    parameter: String,
    value: f32,
    unit: String,
    is_master: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let sanitized_value = {
        let mut guard = state.safety_guard.lock().unwrap();
        guard.sanitize_volume(&track_name, is_master, value)?
    };

    let active_daw = {
        let mut detector = state.daw_detector.lock().unwrap();
        detector.detect_active_daw()
    };

    println!(
        "🎛️ Applied to {}: Track '{}' -> {} = {:.1} {}",
        active_daw.display_name(),
        track_name,
        parameter,
        sanitized_value,
        unit
    );

    Ok(format!(
        "Parameter '{}' auf '{}' auf {:.1} {} gesetzt ({})",
        parameter,
        track_name,
        sanitized_value,
        unit,
        active_daw.display_name()
    ))
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
        .setup(|app| {
            let state = app.state::<AppState>();
            state.ipc_server.set_app_handle(app.handle().clone());

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut detector = DAWDetector::new();
                let mut last_detected = None;
                loop {
                    let detected = detector.detect_active_daw();
                    if last_detected.as_ref() != Some(&detected) {
                        let _ = handle.emit("daw-status-changed", &detected);
                        last_detected = Some(detected);
                    }
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_active_daw,
            get_detected_daw,
            get_license_status,
            verify_license,
            validate_volume_adjustment,
            apply_daw_action
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Oszillation Mixing Buddy companion application");
}
