use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
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
                        println!("📡 IPC Server listening for JUCE plugin on ws://{}", addr);
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
    stream: TcpStream,
    peer_addr: SocketAddr,
    tx: broadcast::Sender<String>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
) {
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

    // Read incoming frames from the JUCE audio plugin and broadcast them
    while let Some(Ok(message)) = read.next().await {
        match message {
            Message::Text(text) => {
                let _ = tx.send(text.to_string());
                if let Ok(guard) = app_handle.lock() {
                    if let Some(ref handle) = *guard {
                        let _ = handle.emit("telemetry-frame", text.as_str());
                    }
                }
            }
            Message::Binary(bin) => {
                if let Ok(text) = String::from_utf8(bin.to_vec()) {
                    let _ = tx.send(text.clone());
                    if let Ok(guard) = app_handle.lock() {
                        if let Some(ref handle) = *guard {
                            let _ = handle.emit("telemetry-frame", text.as_str());
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
}

