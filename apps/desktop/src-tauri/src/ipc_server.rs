use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

pub struct IPCServer {
    port: u16,
    tx: broadcast::Sender<String>,
}

impl IPCServer {
    pub fn new(port: u16) -> Self {
        let (tx, _) = broadcast::channel(100);
        Self { port, tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }

    /// Spawns the local WebSocket server on a background Tokio task
    pub fn start(&self) {
        let port = self.port;
        let tx = self.tx.clone();

        tokio::spawn(async move {
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
                tokio::spawn(async move {
                    handle_connection(stream, peer_addr, tx_clone).await;
                });
            }
        });
    }
}

async fn handle_connection(
    stream: TcpStream,
    peer_addr: SocketAddr,
    tx: broadcast::Sender<String>,
) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => {
            println!("🔗 Meter Plugin connected from: {}", peer_addr);
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
            }
            Message::Binary(bin) => {
                if let Ok(text) = String::from_utf8(bin.to_vec()) {
                    let _ = tx.send(text);
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    forward_task.abort();
    println!("🔌 Meter Plugin disconnected: {}", peer_addr);
}
