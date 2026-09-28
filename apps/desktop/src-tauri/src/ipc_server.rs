use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

pub struct IPCServer {
    port: u16,
    tx: broadcast::Sender<String>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl IPCServer {
    pub fn new(port: u16) -> Self {
        let (tx, _) = broadcast::channel(100);
        Self {
            port,
            tx,
            app_handle: Arc::new(Mutex::new(None)),
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

    /// Spawns the local WebSocket server on a dedicated Tokio runtime thread
    pub fn start(&self) {
        let port = self.port;
        let tx = self.tx.clone();
        let app_handle = self.app_handle.clone();

        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("Failed to build Tokio runtime for IPC server");

            rt.block_on(async {
                let addr = SocketAddr::from(([127, 0, 0, 1], port));
                let listener = match TcpListener::bind(addr).await {
                    Ok(l) => {
                        println!("📡 IPC Server listening for JUCE plugin & MCP on ws://{} and http://{}/api/proposals", addr, addr);
                        l
                    }
                    Err(e) => {
                        eprintln!("⚠️ Failed to bind IPC server on {}: {}", addr, e);
                        return;
                    }
                };

                while let Ok((stream, peer_addr)) = listener.accept().await {
                    let tx_clone = tx.clone();
                    let app_handle_clone = app_handle.clone();
                    tokio::spawn(async move {
                        handle_connection(stream, peer_addr, tx_clone, app_handle_clone).await;
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
        if peek_str.starts_with("POST ") {
            // Read entire HTTP POST request (e.g. /api/proposals from MCP Server)
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

            let body_str = if let Some(pos) = req_bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                String::from_utf8_lossy(&req_bytes[pos + 4..]).to_string()
            } else {
                String::new()
            };

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
                if let Ok(guard) = app_handle.lock() {
                    if let Some(ref handle) = *guard {
                        if text.contains("\"deltas\"") || text.contains("\"action_proposal\"") || text.contains("\"proposal\"") {
                            let _ = handle.emit("new-action-proposal", text.as_str());
                        } else {
                            let _ = handle.emit("telemetry-frame", text.as_str());
                        }
                    }
                }
            }
            Message::Binary(bin) => {
                if let Ok(text) = String::from_utf8(bin.to_vec()) {
                    let _ = tx.send(text.clone());
                    if let Ok(guard) = app_handle.lock() {
                        if let Some(ref handle) = *guard {
                            if text.contains("\"deltas\"") || text.contains("\"action_proposal\"") || text.contains("\"proposal\"") {
                                let _ = handle.emit("new-action-proposal", text.as_str());
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
        let proposal_body = r#"{"id":"prop_123","deltas":[{"trackId":"track_1","trackName":"Kick Drum","parameterName":"fader_db","currentValue":-3.5,"proposedValue":-1.5}]}"#;

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
}

