use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::RwLock;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::thread;
use std::time::Duration;

use futures::channel::mpsc;
use futures::sink::SinkExt;
use futures::stream::StreamExt;
use tokio::net::TcpListener;
use tokio::sync::broadcast;

pub struct MCPProtocol {
    pub id: usize,
    pub name: String,
    pub version: String,
    pub description: String,
    pub handler: Box<dyn Fn(Vec<u8>) -> Vec<u8> + Send + Sync>,
}

pub struct MCPBridge {
    protocols: RwLock<HashMap<String, Arc<MCPProtocol>>>,
    connections: RwLock<HashMap<usize, Sender<Vec<u8>>>>,
    next_connection_id: AtomicUsize,
    shutdown: broadcast::Sender<()>,
}

impl MCPBridge {
    pub fn new() -> Self {
        let (shutdown_tx, _) = broadcast::channel(1);
        MCPBridge {
            protocols: RwLock::new(HashMap::new()),
            connections: RwLock::new(HashMap::new()),
            next_connection_id: AtomicUsize::new(0),
            shutdown: shutdown_tx,
        }
    }

    pub fn register_protocol(&self, protocol: MCPProtocol) {
        let mut protocols = self.protocols.write().unwrap();
        protocols.insert(protocol.name.clone(), Arc::new(protocol));
    }

    pub async fn start(&self, addr: &str) -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(addr).await?;
        println!("MCP Bridge listening on {}", addr);

        while let Ok((stream, _)) = listener.accept().await {
            let (tx, rx) = mpsc::channel(100);
            let connection_id = self.next_connection_id.fetch_add(1, Ordering::SeqCst);
            {
                let mut connections = self.connections.write().unwrap();
                connections.insert(connection_id, tx.clone());
            }

            tokio::spawn(async move {
                let (mut reader, mut writer) = stream.into_split();
                let mut buffer = [0; 1024];

                while let Ok(bytes_read) = reader.read(&mut buffer).await {
                    if bytes_read == 0 {
                        break;
                    }

                    let message = &buffer[..bytes_read];
                    if let Ok(mut tx) = tx.clone().send(message.to_vec()).await {
                        if let Ok(response) = rx.next().await {
                            writer.write_all(&response).await.unwrap();
                        }
                    }
                }

                // Clean up connection
                let mut connections = self.connections.write().unwrap();
                connections.remove(&connection_id);
            });
        }

        Ok(())
    }

    pub fn handle_message(&self, connection_id: usize, message: Vec<u8>) -> Vec<u8> {
        // TODO: Implement message handling with protocol routing
        vec![]
    }

    pub fn shutdown(&self) {
        let _ = self.shutdown.send(());
    }
}
