use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeechTranscriptPayload {
    pub transcript: String,
    pub is_final: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeechStatusPayload {
    pub status: String,
    pub on_device: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeechErrorPayload {
    pub error: String,
}

pub struct SpeechManager {
    child_process: Arc<Mutex<Option<Child>>>,
}

impl SpeechManager {
    pub fn new() -> Self {
        Self {
            child_process: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start(
        &self,
        app_handle: AppHandle,
        vocabulary: Vec<String>,
        locale: Option<String>,
    ) -> Result<(), String> {
        self.stop();

        let bridge_path = crate::resolve_bridge_binary();
        if !bridge_path.exists() {
            return Err(format!(
                "Native logic-ax-bridge sidecar not found at {:?}",
                bridge_path
            ));
        }

        let vocab_arg = vocabulary.join(",");
        let loc_arg = locale.unwrap_or_else(|| "de-DE".to_string());

        let mut child = Command::new(&bridge_path)
            .arg("speech-recognize")
            .arg("--vocabulary")
            .arg(&vocab_arg)
            .arg("--locale")
            .arg(&loc_arg)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn logic-ax-bridge speech engine: {}", e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout of speech engine".to_string())?;

        let child_arc = self.child_process.clone();
        *child_arc.lock().map_err(|e| e.to_string())? = Some(child);

        // Spawn background reader thread to stream transcription lines to frontend
        let app = app_handle.clone();
        let child_arc_reader = child_arc.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line_res in reader.lines() {
                if let Ok(line) = line_res {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
                        let msg_type = json.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        match msg_type {
                            "partial" | "final" => {
                                let transcript = json
                                    .get("transcript")
                                    .and_then(|t| t.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let is_final = json
                                    .get("isFinal")
                                    .and_then(|f| f.as_bool())
                                    .unwrap_or(msg_type == "final");

                                let _ = app.emit(
                                    "speech-transcript",
                                    SpeechTranscriptPayload {
                                        transcript,
                                        is_final,
                                    },
                                );
                            }
                            "status" => {
                                let status = json
                                    .get("status")
                                    .and_then(|s| s.as_str())
                                    .unwrap_or("unknown")
                                    .to_string();
                                let on_device =
                                    json.get("onDevice").and_then(|od| od.as_bool());
                                let _ = app.emit(
                                    "speech-status",
                                    SpeechStatusPayload { status, on_device },
                                );
                            }
                            "error" => {
                                let error = json
                                    .get("error")
                                    .and_then(|e| e.as_str())
                                    .unwrap_or("Unknown speech error")
                                    .to_string();
                                let _ = app.emit("speech-error", SpeechErrorPayload { error });
                            }
                            "stopped" => {
                                let _ = app.emit(
                                    "speech-status",
                                    SpeechStatusPayload {
                                        status: "stopped".to_string(),
                                        on_device: None,
                                    },
                                );
                                break;
                            }
                            _ => {}
                        }
                    }
                } else {
                    break;
                }
            }

            // Cleanup when stream ends
            if let Ok(mut lock) = child_arc_reader.lock() {
                *lock = None;
            }
            let _ = app.emit(
                "speech-status",
                SpeechStatusPayload {
                    status: "stopped".to_string(),
                    on_device: None,
                },
            );
        });

        Ok(())
    }

    pub fn stop(&self) {
        if let Ok(mut lock) = self.child_process.lock() {
            if let Some(mut child) = lock.take() {
                // Try writing "stop\n" to stdin for graceful termination
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(b"stop\n");
                    let _ = stdin.flush();
                }
                // Short grace period before kill
                std::thread::sleep(std::time::Duration::from_millis(50));
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    pub fn is_active(&self) -> bool {
        if let Ok(lock) = self.child_process.lock() {
            lock.is_some()
        } else {
            false
        }
    }
}

// Global lazy singleton for managing active speech recognition session
static GLOBAL_SPEECH_MANAGER: std::sync::OnceLock<SpeechManager> = std::sync::OnceLock::new();

pub fn get_speech_manager() -> &'static SpeechManager {
    GLOBAL_SPEECH_MANAGER.get_or_init(SpeechManager::new)
}

#[tauri::command]
pub async fn start_speech_recognition(
    app: AppHandle,
    vocabulary: Vec<String>,
    locale: Option<String>,
) -> Result<(), String> {
    get_speech_manager().start(app, vocabulary, locale)
}

#[tauri::command]
pub async fn stop_speech_recognition(app: AppHandle) -> Result<(), String> {
    get_speech_manager().stop();
    let _ = app.emit(
        "speech-status",
        SpeechStatusPayload {
            status: "stopped".to_string(),
            on_device: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn is_speech_recognition_active() -> bool {
    get_speech_manager().is_active()
}
