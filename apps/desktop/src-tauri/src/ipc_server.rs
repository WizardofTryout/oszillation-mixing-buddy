use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use crate::daw_detector::{DAWDetector, DetectedDAW};
use crate::mcu_bridge::{AssignmentMode, McuBridge};

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub struct IPCServer {
    port: u16,
    tx: broadcast::Sender<String>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    shared_tracks: Arc<Mutex<Vec<serde_json::Value>>>,
    last_telemetry_ms: Arc<AtomicU64>,
    is_streaming: Arc<AtomicBool>,
    pub mcu_bridge: Arc<McuBridge>,
}

impl IPCServer {
    pub fn new(port: u16) -> Self {
        let (tx, _) = broadcast::channel(100);
        let mcu_bridge = Arc::new(McuBridge::new());
        Self {
            port,
            tx,
            app_handle: Arc::new(Mutex::new(None)),
            shared_tracks: Arc::new(Mutex::new(Vec::new())),
            last_telemetry_ms: Arc::new(AtomicU64::new(0)),
            is_streaming: Arc::new(AtomicBool::new(false)),
            mcu_bridge,
        }
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        if let Ok(mut guard) = self.app_handle.lock() {
            *guard = Some(handle);
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }

    /// Spawns the local WebSocket server and 1.5s audio heartbeat watchdog on a dedicated Tokio runtime thread
    pub fn start(&self) {
        if let Err(e) = self.mcu_bridge.start() {
            eprintln!("⚠️ [MCU Bridge] Warning during start: {}", e);
        }

        let port = self.port;
        let tx = self.tx.clone();
        let app_handle = self.app_handle.clone();
        let shared_tracks = self.shared_tracks.clone();
        let last_telemetry_ms = self.last_telemetry_ms.clone();
        let is_streaming = self.is_streaming.clone();
        let mcu_bridge = self.mcu_bridge.clone();

        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("Failed to build Tokio runtime for IPC server");

            rt.block_on(async {
                let addr = SocketAddr::from(([127, 0, 0, 1], port));
                let listener = match TcpListener::bind(addr).await {
                    Ok(l) => {
                        println!("📡 IPC Server listening on ws://{} and http://{}/api", addr, addr);
                        l
                    }
                    Err(e) => {
                        eprintln!("⚠️ Failed to bind IPC server on {}: {}", addr, e);
                        return;
                    }
                };

                // Heartbeat Watchdog: if no telemetry frame arrives within > 1,500 ms, mark streaming: false
                let watchdog_handle = app_handle.clone();
                let watchdog_last_ms = last_telemetry_ms.clone();
                let watchdog_streaming = is_streaming.clone();
                tokio::spawn(async move {
                    let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(500));
                    loop {
                        interval.tick().await;
                        let last = watchdog_last_ms.load(Ordering::Relaxed);
                        let now = now_millis();
                        let active = last > 0 && now.saturating_sub(last) <= 1500;
                        let prev = watchdog_streaming.swap(active, Ordering::Relaxed);
                        if prev != active {
                            if let Ok(guard) = watchdog_handle.lock() {
                                if let Some(ref handle) = *guard {
                                    let _ = handle.emit(
                                        "audio-streaming-status",
                                        serde_json::json!({ "streaming": active }),
                                    );
                                }
                            }
                        }
                    }
                });

                while let Ok((stream, peer_addr)) = listener.accept().await {
                    let tx_clone = tx.clone();
                    let app_handle_clone = app_handle.clone();
                    let tracks_clone = shared_tracks.clone();
                    let last_ms_clone = last_telemetry_ms.clone();
                    let streaming_clone = is_streaming.clone();
                    let mcu_clone = mcu_bridge.clone();
                    tokio::spawn(async move {
                        handle_connection(
                            stream,
                            peer_addr,
                            tx_clone,
                            app_handle_clone,
                            tracks_clone,
                            last_ms_clone,
                            streaming_clone,
                            mcu_clone,
                        )
                        .await;
                    });
                }
            });
        });
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    peer_addr: SocketAddr,
    tx: broadcast::Sender<String>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    shared_tracks: Arc<Mutex<Vec<serde_json::Value>>>,
    last_telemetry_ms: Arc<AtomicU64>,
    is_streaming: Arc<AtomicBool>,
    mcu_bridge: Arc<McuBridge>,
) {
    let mut peek_buf = [0u8; 1024];
    let n = match stream.peek(&mut peek_buf).await {
        Ok(n) => n,
        Err(e) => {
            eprintln!("⚠️ Socket peek error from {}: {}", peer_addr, e);
            return;
        }
    };

    if n > 0 {
        let peek_str = String::from_utf8_lossy(&peek_buf[..n]);

        // 1. GET /api/project
        if peek_str.starts_with("GET /api/project") {
            let mut detector = crate::daw_detector::DAWDetector::new();
            let daw = detector.detect_active_daw();
            let project_name = detector.detect_project_name(&daw).unwrap_or_else(|| "Unbenanntes Projekt".to_string());
            let is_connected = daw != crate::daw_detector::DetectedDAW::None;
            let body = serde_json::json!({
                "daw": daw.display_name(),
                "dawId": daw,
                "projectName": project_name,
                "sampleRate": 48000,
                "isPlaying": is_connected,
                "connected": is_connected
            }).to_string();

            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes()).await;
            let _ = stream.flush().await;
            return;
        }

        // 1b. GET /api/vault/plugins
        if peek_str.starts_with("GET /api/vault/plugins") {
            let plugins = crate::list_learned_plugins_sync().unwrap_or_default();
            let body = serde_json::json!({
                "plugins": plugins
            }).to_string();

            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes()).await;
            let _ = stream.flush().await;
            return;
        }

        // 2. GET /api/tracks
        if peek_str.starts_with("GET /api/tracks") {
            // Priority 1: Live MCU SysEx LCD Stream from Logic Pro
            let mcu_tracks = mcu_bridge.get_tracks();
            let track_list = if !mcu_tracks.is_empty() {
                mcu_tracks
            } else {
                let mut detector = DAWDetector::new();
                let daw = detector.detect_active_daw();
                if daw == DetectedDAW::LogicPro {
                    let scanned = detector.scan_logic_pro_tracks();
                    if !scanned.is_empty() {
                        scanned
                    } else {
                        shared_tracks.lock().map(|g| g.clone()).unwrap_or_default()
                    }
                } else {
                    shared_tracks.lock().map(|g| g.clone()).unwrap_or_default()
                }
            };

            let body = serde_json::json!({
                "tracks": track_list
            }).to_string();

            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes()).await;
            let _ = stream.flush().await;
            return;
        }

        // 3. GET /api/channel-strips — live Mixer/Inspector channel strips via logic-ax-bridge
        if peek_str.starts_with("GET /api/channel-strips") {
            let body = {
                #[cfg(target_os = "macos")]
                {
                    let bridge_path = crate::resolve_bridge_path();
                    if bridge_path.exists() {
                        match crate::execute_logic_ax_bridge(&bridge_path, &["list-channel-strips".to_string()]) {
                            Ok(val) => val.to_string(),
                            Err(e) => serde_json::json!({"success": false, "error": e, "channelStrips": []}).to_string(),
                        }
                    } else {
                        serde_json::json!({"success": false, "error": "Bridge not found", "channelStrips": []}).to_string()
                    }
                }
                #[cfg(not(target_os = "macos"))]
                {
                    serde_json::json!({"success": true, "channelStrips": []}).to_string()
                }
            };
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(), body
            );
            let _ = stream.write_all(resp.as_bytes()).await;
            let _ = stream.flush().await;
            return;
        }

        // 4. POST requests
        if peek_str.starts_with("POST ") {
            let mut req_bytes = Vec::with_capacity(4096);
            let mut temp_buf = [0u8; 2048];
            loop {
                let bytes_read = match stream.read(&mut temp_buf).await {
                    Ok(0) => break,
                    Ok(b) => b,
                    Err(_) => break,
                };
                req_bytes.extend_from_slice(&temp_buf[..bytes_read]);

                if let Some(pos) = req_bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let header_str = String::from_utf8_lossy(&req_bytes[..pos]);
                    let content_len = header_str
                        .lines()
                        .find(|l| l.to_lowercase().starts_with("content-length:"))
                        .and_then(|l| l.split(':').nth(1))
                        .and_then(|v| v.trim().parse::<usize>().ok())
                        .unwrap_or(0);

                    let body_start = pos + 4;
                    if req_bytes.len() >= body_start + content_len {
                        break;
                    }
                }
            }

            let (path, body_str) = if let Some(pos) = req_bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let header_str = String::from_utf8_lossy(&req_bytes[..pos]);
                let req_line = header_str.lines().next().unwrap_or("");
                let req_path = req_line.split_whitespace().nth(1).unwrap_or("");
                let body = String::from_utf8_lossy(&req_bytes[pos + 4..]).to_string();
                (req_path.to_string(), body)
            } else {
                (String::new(), String::new())
            };

            if path.contains("/api/tracks") {
                // Live track synchronization from DAW driver
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body_str) {
                    if let Some(arr) = val.get("tracks").and_then(|t| t.as_array()) {
                        if let Ok(mut guard) = shared_tracks.lock() {
                            *guard = arr.clone();
                        }
                    } else if let Some(arr) = val.as_array() {
                        if let Ok(mut guard) = shared_tracks.lock() {
                            *guard = arr.clone();
                        }
                    }
                }
                let resp = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{\"status\":\"ok\"}";
                let _ = stream.write_all(resp.as_bytes()).await;
                let _ = stream.flush().await;
                return;
            } else if path.contains("/api/execute") {
                // Execute DAW command from MCP server
                if !body_str.trim().is_empty() {
                    let _ = tx.send(body_str.clone());
                    if let Ok(guard) = app_handle.lock() {
                        if let Some(ref handle) = *guard {
                            let _ = handle.emit("execute-daw-action", body_str.as_str());
                        }
                    }

                    // Directly dispatch via MCU virtual CoreMIDI bridge
                    if let Ok(exec_val) = serde_json::from_str::<serde_json::Value>(&body_str) {
                        let action_type = exec_val.get("actionType")
                            .or_else(|| exec_val.get("type"))
                            .or_else(|| exec_val.get("parameterName"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if action_type.contains("volume") || action_type.contains("fader") {
                            let ch = exec_val.get("trackIndex").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
                            let target_db = exec_val.get("proposedValue")
                                .or_else(|| exec_val.get("targetValue"))
                                .or_else(|| exec_val.get("value"))
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0) as f32;
                            let _ = mcu_bridge.apply_fader_delta_with_automation(ch, target_db);
                        } else if action_type.contains("eq") {
                            let ch = exec_val.get("trackIndex").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
                            let delta = exec_val.get("delta").and_then(|v| v.as_i64()).unwrap_or(1) as i8;
                            let _ = mcu_bridge.set_assignment_mode(AssignmentMode::EQ);
                            let _ = mcu_bridge.send_vpot_delta(ch, delta);
                        }
                    }
                }
                let resp = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 30\r\nConnection: close\r\n\r\n{\"status\":\"ok\",\"executed\":true}";
                let _ = stream.write_all(resp.as_bytes()).await;
                let _ = stream.flush().await;
                return;
            } else if path.contains("/api/vault/learn") {
                let win_title = serde_json::from_str::<serde_json::Value>(&body_str)
                    .ok()
                    .and_then(|v| v.get("windowTitle").and_then(|w| w.as_str()).map(|s| s.to_string()));
                let (status_line, body) = match crate::learn_active_plugin_sync(win_title) {
                    Ok(spec) => ("HTTP/1.1 200 OK", spec.to_string()),
                    Err(err) => (
                        "HTTP/1.1 400 Bad Request",
                        serde_json::json!({ "error": err }).to_string(),
                    ),
                };
                let resp = format!(
                    "{}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status_line,
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
                let _ = stream.flush().await;
                return;
            } else if path.contains("/api/vault/delete") {
                let slug = serde_json::from_str::<serde_json::Value>(&body_str)
                    .ok()
                    .and_then(|v| v.get("slug").and_then(|w| w.as_str()).map(|s| s.to_string()))
                    .unwrap_or_default();
                let (status_line, body) = match crate::delete_learned_plugin_sync(slug) {
                    Ok(msg) => (
                        "HTTP/1.1 200 OK",
                        serde_json::json!({ "status": "ok", "message": msg }).to_string(),
                    ),
                    Err(err) => (
                        "HTTP/1.1 400 Bad Request",
                        serde_json::json!({ "error": err }).to_string(),
                    ),
                };
                let resp = format!(
                    "{}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status_line,
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
                let _ = stream.flush().await;
                return;
            } else if path.contains("/api/vault/tags") {
                // Update tags for a vault plugin: { "slug": "chromaglow", "tags": ["SATURATION","COLOR"] }
                let slug = serde_json::from_str::<serde_json::Value>(&body_str)
                    .ok()
                    .and_then(|v| v.get("slug").and_then(|w| w.as_str()).map(|s| s.to_string()))
                    .unwrap_or_default();
                let tags: Vec<String> = serde_json::from_str::<serde_json::Value>(&body_str)
                    .ok()
                    .and_then(|v| v.get("tags").and_then(|t| t.as_array()).map(|arr| {
                        arr.iter().filter_map(|t| t.as_str().map(|s| s.to_string())).collect()
                    }))
                    .unwrap_or_default();
                let (status_line, body) = match crate::update_plugin_tags_sync(slug, tags) {
                    Ok(updated) => ("HTTP/1.1 200 OK", updated.to_string()),
                    Err(err) => (
                        "HTTP/1.1 400 Bad Request",
                        serde_json::json!({ "error": err }).to_string(),
                    ),
                };
                let resp = format!(
                    "{}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status_line,
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
                let _ = stream.flush().await;
                return;
            } else {
                // Action proposal sync (e.g. /api/proposals)
                if !body_str.trim().is_empty() {
                    let _ = tx.send(body_str.clone());
                    if let Ok(guard) = app_handle.lock() {
                        if let Some(ref handle) = *guard {
                            let _ = handle.emit("new-action-proposal", body_str.as_str());
                        }
                    }
                }

                let resp = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{\"status\":\"ok\"}";
                let _ = stream.write_all(resp.as_bytes()).await;
                let _ = stream.flush().await;
                return;
            }
        } else if peek_str.starts_with("OPTIONS ") {
            let resp = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(resp.as_bytes()).await;
            let _ = stream.flush().await;
            return;
        }
    }

    let ws_stream = match accept_async(stream).await {
        Ok(ws) => {
            println!("🔗 WebSocket client connected: {}", peer_addr);
            ws
        }
        Err(e) => {
            eprintln!("⚠️ WebSocket handshake error from {}: {}", peer_addr, e);
            return;
        }
    };

    let (mut write, mut read) = ws_stream.split();
    let mut rx = tx.subscribe();

    // Spawn task to forward broadcasted messages to connected UI clients
    let forward_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if write.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Read incoming frames from the JUCE audio plugin or MCP clients and broadcast them
    while let Some(Ok(message)) = read.next().await {
        match message {
            Message::Text(text) => {
                let _ = tx.send(text.to_string());
                let is_proposal = text.contains("\"deltas\"") || text.contains("\"action_proposal\"") || text.contains("\"proposal\"");
                let is_execute = text.contains("\"execute\"") || text.contains("\"parameterName\"");
                if !is_proposal && !is_execute {
                    last_telemetry_ms.store(now_millis(), Ordering::Relaxed);
                    is_streaming.store(true, Ordering::Relaxed);
                }
                if let Ok(guard) = app_handle.lock() {
                    if let Some(ref handle) = *guard {
                        if is_proposal {
                            let _ = handle.emit("new-action-proposal", text.as_str());
                        } else if is_execute {
                            let _ = handle.emit("execute-daw-action", text.as_str());
                        } else {
                            let _ = handle.emit("telemetry-frame", text.as_str());
                        }
                    }
                }
            }
            Message::Binary(bin) => {
                last_telemetry_ms.store(now_millis(), Ordering::Relaxed);
                is_streaming.store(true, Ordering::Relaxed);
                if let Ok(text) = String::from_utf8(bin.to_vec()) {
                    let _ = tx.send(text.clone());
                    if let Ok(guard) = app_handle.lock() {
                        if let Some(ref handle) = *guard {
                            if text.contains("\"deltas\"") || text.contains("\"action_proposal\"") || text.contains("\"proposal\"") {
                                let _ = handle.emit("new-action-proposal", text.as_str());
                            } else if text.contains("\"execute\"") || text.contains("\"parameterName\"") {
                                let _ = handle.emit("execute-daw-action", text.as_str());
                            } else {
                                let _ = handle.emit("telemetry-frame", text.as_str());
                            }
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    forward_task.abort();
    println!("🔌 Client disconnected: {}", peer_addr);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::connect_async;

    #[tokio::test]
    async fn test_ipc_server_handshake_and_broadcast() {
        let server = IPCServer::new(48199);
        server.start();

        // Allow server runtime to bind
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

        // Connect client 1 (Receiver, e.g. HUD Webview)
        let (rx_ws, _) = connect_async("ws://127.0.0.1:48199/meter")
            .await
            .expect("Failed to connect receiver client");
        let (_, mut rx_read) = rx_ws.split();

        // Connect client 2 (Sender, e.g. JUCE Audio Plugin)
        let (tx_ws, _) = connect_async("ws://127.0.0.1:48199/meter")
            .await
            .expect("Failed to connect sender client");
        let (mut tx_write, _) = tx_ws.split();

        let payload = r#"{"version":"1.0","sampleRate":48000,"loudness":{"momentaryLufs":-14.2}}"#;
        tx_write
            .send(Message::Text(payload.into()))
            .await
            .expect("Failed to send frame");

        // Receiver must get the broadcasted frame
        if let Some(Ok(Message::Text(received))) = rx_read.next().await {
            assert_eq!(received.as_str(), payload);
        } else {
            panic!("Expected text message on receiver");
        }
    }

    #[tokio::test]
    async fn test_ipc_server_http_post_proposals() {
        let server = IPCServer::new(48198);
        server.start();

        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

        let mut sub = server.subscribe();

        let client = reqwest::Client::new();
        let proposal_body = r#"{"id":"prop_123","deltas":[{"trackId":"track_1","trackName":"SoCal","parameterName":"fader_db","currentValue":-3.5,"proposedValue":-1.5}]}"#;

        let res = client
            .post("http://127.0.0.1:48198/api/proposals")
            .header("Content-Type", "application/json")
            .body(proposal_body)
            .send()
            .await
            .expect("Failed to post proposal");

        assert_eq!(res.status(), 200);

        let received = sub.recv().await.expect("Expected broadcasted proposal");
        assert!(received.contains("prop_123"));
    }

    #[tokio::test]
    async fn test_ipc_server_http_project_and_tracks() {
        let server = IPCServer::new(48197);
        server.start();

        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

        let client = reqwest::Client::new();

        // 1. GET /api/project
        let res_proj = client
            .get("http://127.0.0.1:48197/api/project")
            .send()
            .await
            .expect("Failed to get project");
        assert_eq!(res_proj.status(), 200);
        let proj_json: serde_json::Value = res_proj.json().await.unwrap();
        assert!(proj_json.get("daw").is_some());
        assert!(proj_json.get("projectName").is_some());

        // 2. GET /api/tracks (initially empty)
        let res_tracks = client
            .get("http://127.0.0.1:48197/api/tracks")
            .send()
            .await
            .expect("Failed to get tracks");
        assert_eq!(res_tracks.status(), 200);
        let tracks_json: serde_json::Value = res_tracks.json().await.unwrap();
        assert_eq!(tracks_json["tracks"].as_array().unwrap().len(), 0);

        // 3. POST /api/tracks (sync live scanned tracks)
        let new_tracks = serde_json::json!({
            "tracks": [
                {
                    "id": "trk_01",
                    "index": 0,
                    "name": "Live Vocals",
                    "type": "audio",
                    "volumeDb": -1.5,
                    "pan": 0.0,
                    "muted": false,
                    "plugins": []
                }
            ]
        });
        let res_post = client
            .post("http://127.0.0.1:48197/api/tracks")
            .header("Content-Type", "application/json")
            .body(new_tracks.to_string())
            .send()
            .await
            .expect("Failed to post tracks");
        assert_eq!(res_post.status(), 200);

        // 4. GET /api/tracks now returns synced track
        let res_tracks2 = client
            .get("http://127.0.0.1:48197/api/tracks")
            .send()
            .await
            .expect("Failed to get tracks after sync");
        let tracks2_json: serde_json::Value = res_tracks2.json().await.unwrap();
        assert_eq!(tracks2_json["tracks"].as_array().unwrap().len(), 1);
        assert_eq!(tracks2_json["tracks"][0]["name"], "Live Vocals");

        // 5. POST /api/execute
        let exec_payload = serde_json::json!({
            "trackId": "trk_01",
            "parameterName": "volume",
            "value": -3.0
        });
        let res_exec = client
            .post("http://127.0.0.1:48197/api/execute")
            .header("Content-Type", "application/json")
            .body(exec_payload.to_string())
            .send()
            .await
            .expect("Failed to post execute");
        assert_eq!(res_exec.status(), 200);
    }
}

