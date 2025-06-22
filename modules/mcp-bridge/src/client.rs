use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::mpsc::{channel, Sender, Receiver};
use std::thread;
use std::time::Duration;

use futures::channel::mpsc;
use futures::sink::SinkExt;
use futures::stream::StreamExt;
use tokio::net::TcpStream;
use tokio::sync::broadcast;

pub struct MCPClient {
    connection: TcpStream,
    protocols: HashMap<String, Arc<dyn MCPProtocolHandler + Send + Sync>>,
    tx: Sender<Vec<u8>>,
    rx: Receiver<Vec<u8>>,
    shutdown: broadcast::Receiver<()>,
}

pub trait MCPProtocolHandler {
    fn handle(&self, message: Vec<u8>) -> Vec<u8>;
}

impl MCPClient {
    pub async fn connect(addr: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let connection = TcpStream::connect(addr).await?;
        let (tx, rx) = mpsc::channel(100);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);

        Ok(MCPClient {
            connection,
            protocols: HashMap::new(),
            tx,
            rx,
            shutdown: shutdown_rx,
        })
    }

    pub fn register_protocol<H: MCPProtocolHandler + Send + Sync + 'static>(
        &mut self,
        name: String,
        handler: H,
    ) {
        self.protocols.insert(name, Arc::new(handler));
    }

    pub async fn send(&self, message: Vec<u8>) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        self.tx.clone().send(message).await?;
        Ok(self.rx.clone().next().await.unwrap())
    }

    pub async fn start(&self) -> Result<(), Box<dyn std::error::Error>> {
        let mut buffer = [0; 1024];
        let mut connection = self.connection.clone();

        while let Ok(bytes_read) = connection.read(&mut buffer).await {
            if bytes_read == 0 {
                break;
            }

            let message = &buffer[..bytes_read];
            if let Some(handler) = self.protocols.get("storage") {
                let response = handler.handle(message.to_vec());
                connection.write_all(&response).await?;
            }
        }

        Ok(())
    }

    pub fn shutdown(&self) {
        let _ = self.shutdown.send(());
    }
}
