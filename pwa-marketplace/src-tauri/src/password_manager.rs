use std::sync::Mutex;
use std::sync::Arc;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use serde_json;
use ring::aead::{Aead, Algorithm, KeyInit, NonceSequence, Tag, UnboundKey};
use ring::aead::quic::HeaderProtectionKey;
use ring::rand::SystemRandom;
use ring::digest;
use tauri::State;

pub struct PasswordManager {
    entries: Mutex<HashMap<String, String>>,
    key: [u8; 32], // 256-bit key
    salt: [u8; 32], // 256-bit salt
    path: String,
}

impl PasswordManager {
    pub fn new(path: String) -> Result<Arc<Self>, String> {
        let mut rng = SystemRandom::new();
        let mut key = [0u8; 32];
        let mut salt = [0u8; 32];

        // Generate secure key and salt
        rng.fill(&mut key).map_err(|_| "Failed to generate key")?;
        rng.fill(&mut salt).map_err(|_| "Failed to generate salt")?;

        // Create directory if it doesn't exist
        let dir = Path::new(&path).parent().ok_or("Invalid path")?;
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;

        // Load existing entries
        let entries = if Path::new(&path).exists() {
            let data = fs::read(&path).map_err(|e| e.to_string())?;
            let encrypted = String::from_utf8(data).map_err(|e| e.to_string())?;
            Self::decrypt(&encrypted, &key, &salt)?
        } else {
            HashMap::new()
        };

        Ok(Arc::new(PasswordManager {
            entries: Mutex::new(entries),
            key,
            salt,
            path,
        }))
    }

    fn encrypt(data: &str, key: &[u8], salt: &[u8]) -> Result<String, String> {
        let key = UnboundKey::new(&ring::aead::AES_256_GCM, key)
            .map_err(|_| "Failed to create encryption key")?;

        let mut nonce = [0u8; 12]; // 96-bit nonce
        let rng = SystemRandom::new();
        rng.fill(&mut nonce).map_err(|_| "Failed to generate nonce")?;

        let aad = ring::aead::Aad::empty();
        let mut in_out = Vec::from(data.as_bytes());
        let tag = key.encrypt(&nonce.into(), aad, &mut in_out)
            .map_err(|_| "Encryption failed")?;

        // Combine nonce, ciphertext, and tag
        let mut result = Vec::new();
        result.extend_from_slice(&nonce);
        result.extend_from_slice(&in_out);
        result.extend_from_slice(tag.as_ref());

        Ok(base64::encode(result))
    }

    fn decrypt(encrypted: &str, key: &[u8], salt: &[u8]) -> Result<HashMap<String, String>, String> {
        let data = base64::decode(encrypted).map_err(|_| "Invalid base64")?;
        
        if data.len() < 12 + 16 { // nonce (12) + tag (16)
            return Err("Invalid encrypted data".to_string());
        }

        let nonce = &data[..12];
        let ciphertext = &data[12..data.len()-16];
        let tag = &data[data.len()-16..];

        let key = UnboundKey::new(&ring::aead::AES_256_GCM, key)
            .map_err(|_| "Failed to create decryption key")?;

        let aad = ring::aead::Aad::empty();
        let mut in_out = Vec::from(ciphertext);
        key.decrypt(nonce.into(), aad, &mut in_out, tag)
            .map_err(|_| "Decryption failed")?;

        let json = String::from_utf8(in_out).map_err(|e| e.to_string())?;
        serde_json::from_str(&json).map_err(|e| e.to_string())
    }

    pub fn add_entry(
        &self,
        name: String,
        password: String,
    ) -> Result<(), String> {
        let mut entries = self.entries.lock().unwrap();
        entries.insert(name.clone(), password);

        // Save to disk
        let json = serde_json::to_string(&*entries).map_err(|e| e.to_string())?;
        let encrypted = Self::encrypt(&json, &self.key, &self.salt)?;
        fs::write(&self.path, encrypted).map_err(|e| e.to_string())
    }

    pub fn get_entry(&self, name: &str) -> Result<Option<String>, String> {
        let entries = self.entries.lock().unwrap();
        Ok(entries.get(name).cloned())
    }

    pub fn update_entry(
        &self,
        name: String,
        password: String,
    ) -> Result<(), String> {
        let mut entries = self.entries.lock().unwrap();
        if entries.contains_key(&name) {
            entries.insert(name.clone(), password);
            // Save to disk
            let json = serde_json::to_string(&*entries).map_err(|e| e.to_string())?;
            let encrypted = Self::encrypt(&json, &self.key, &self.salt)?;
            fs::write(&self.path, encrypted).map_err(|e| e.to_string())
        } else {
            Err("Entry not found".to_string())
        }
    }

    pub fn delete_entry(&self, name: &str) -> Result<(), String> {
        let mut entries = self.entries.lock().unwrap();
        if entries.remove(name).is_some() {
            // Save to disk
            let json = serde_json::to_string(&*entries).map_err(|e| e.to_string())?;
            let encrypted = Self::encrypt(&json, &self.key, &self.salt)?;
            fs::write(&self.path, encrypted).map_err(|e| e.to_string())
        } else {
            Err("Entry not found".to_string())
        }
    }
}

#[tauri::command]
fn password_add(
    name: String,
    password: String,
    manager: State<'_, Arc<PasswordManager>>,
) -> Result<(), String> {
    manager.add_entry(name, password)
}

#[tauri::command]
fn password_get(
    name: String,
    manager: State<'_, Arc<PasswordManager>>,
) -> Result<Option<String>, String> {
    manager.get_entry(&name)
}

#[tauri::command]
fn password_update(
    name: String,
    password: String,
    manager: State<'_, Arc<PasswordManager>>,
) -> Result<(), String> {
    manager.update_entry(name, password)
}

#[tauri::command]
fn password_delete(
    name: String,
    manager: State<'_, Arc<PasswordManager>>,
) -> Result<(), String> {
    manager.delete_entry(&name)
}

pub fn init(path: String) -> Result<Arc<PasswordManager>, String> {
    let manager = PasswordManager::new(path)?;

    // Register commands
    tauri::Builder::default()
        .manage(manager.clone())
        .invoke_handler(tauri::generate_handler![
            password_add,
            password_get,
            password_update,
            password_delete
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    Ok(manager)
}
