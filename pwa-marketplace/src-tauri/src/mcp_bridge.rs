use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::Arc;
use std::sync::mpsc::{channel, Sender};
use std::thread;
use std::time::Duration;

use serde_json::json;
use tauri::State;

pub struct MCPBridge {
    connections: Mutex<HashMap<String, Sender<String>>>,
    next_id: Mutex<u32>,
}

impl MCPBridge {
    pub fn new() -> Arc<Self> {
        Arc::new(MCPBridge {
            connections: Mutex::new(HashMap::new()),
            next_id: Mutex::new(0),
        })
    }

    pub fn register(&self, name: String) -> String {
        let mut id = self.next_id.lock().unwrap();
        *id += 1;
        let connection_id = format!("{}-{}", name, *id);

        let (tx, rx) = channel();
        self.connections.lock().unwrap().insert(connection_id.clone(), tx);

        // Start message handler
        thread::spawn(move || {
            while let Ok(message) = rx.recv() {
                // TODO: Implement message handling
                println!("Received message: {}", message);
            }
        });

        connection_id
    }

    pub fn send(&self, id: &str, message: String) -> Result<(), String> {
        if let Some(tx) = self.connections.lock().unwrap().get(id) {
            tx.send(message).map_err(|e| e.to_string())
        } else {
            Err("Connection not found".to_string())
        }
    }

    pub fn disconnect(&self, id: &str) {
        self.connections.lock().unwrap().remove(id);
    }
}

#[tauri::command]
fn mcp_connect(
    name: String,
    bridge: State<'_, Arc<MCPBridge>>,
) -> Result<String, String> {
    Ok(bridge.register(name))
}

#[tauri::command]
fn mcp_send(
    id: String,
    message: String,
    bridge: State<'_, Arc<MCPBridge>>,
) -> Result<(), String> {
    bridge.send(&id, message)
}

#[tauri::command]
fn mcp_disconnect(
    id: String,
    bridge: State<'_, Arc<MCPBridge>>,
) {
    bridge.disconnect(&id)
}

pub fn init() -> Arc<MCPBridge> {
    let bridge = MCPBridge::new();

    // Register commands
    tauri::Builder::default()
        .manage(bridge.clone())
        .invoke_handler(tauri::generate_handler![
            mcp_connect,
            mcp_send,
            mcp_disconnect
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    bridge
}
