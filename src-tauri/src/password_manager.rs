// src-tauri/src/password_manager.rs
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce, Key
};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::{rand_core::RngCore, SaltString}};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePool, Row};
use std::path::PathBuf;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PasswordManagerError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Encryption error: {0}")]
    Encryption(String),
    #[error("Invalid master password")]
    InvalidMasterPassword,
    #[error("Entry not found")]
    EntryNotFound,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordEntry {
    pub id: String,
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub folder: Option<String>,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_used: Option<DateTime<Utc>>,
    pub is_favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecureNote {
    pub id: String,
    pub title: String,
    pub content: String,
    pub folder: Option<String>,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct PasswordManager {
    pool: SqlitePool,
    master_key: Vec<u8>,
    cipher: Aes256Gcm,
}

impl PasswordManager {
    pub async fn new(master_password: &str) -> Result<Self, PasswordManagerError> {
        let db_path = Self::get_database_path()?;
        
        // Ensure directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        
        // Generate master key from password
        let master_key = Self::derive_master_key(master_password)?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&master_key));
        
        // Connect to database
        let database_url = format!("sqlite:{}", db_path.display());
        let pool = SqlitePool::connect(&database_url).await?;
        
        let manager = PasswordManager {
            pool,
            master_key,
            cipher,
        };
        
        // Initialize database schema
        manager.init_database().await?;
        
        Ok(manager)
    }
    
    pub async fn verify_master_password(&self, password: &str) -> Result<bool, PasswordManagerError> {
        // Get stored hash from database
        let row = sqlx::query("SELECT master_password_hash FROM master_config WHERE id = 1")
            .fetch_optional(&self.pool)
            .await?;
            
        if let Some(row) = row {
            let stored_hash: String = row.get("master_password_hash");
            let parsed_hash = PasswordHash::new(&stored_hash)
                .map_err(|e| PasswordManagerError::Encryption(e.to_string()))?;
                
            Ok(Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_ok())
        } else {
            // First time setup
            self.store_master_password_hash(password).await?;
            Ok(true)
        }
    }
    
    async fn store_master_password_hash(&self, password: &str) -> Result<(), PasswordManagerError> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| PasswordManagerError::Encryption(e.to_string()))?
            .to_string();
            
        sqlx::query("INSERT OR REPLACE INTO master_config (id, master_password_hash) VALUES (1, ?)")
            .bind(&password_hash)
            .execute(&self.pool)
            .await?;
            
        Ok(())
    }
    
    pub async fn store_password(&self, entry: &PasswordEntry) -> Result<(), PasswordManagerError> {
        let encrypted_password = self.encrypt_data(&entry.password)?;
        let encrypted_notes = entry.notes.as_ref()
            .map(|notes| self.encrypt_data(notes))
            .transpose()?;
        let tags_json = serde_json::to_string(&entry.tags)
            .map_err(|e| PasswordManagerError::Encryption(e.to_string()))?;
            
        sqlx::query(
            r#"
            INSERT OR REPLACE INTO password_entries 
            (id, title, username, encrypted_password, url, encrypted_notes, folder, tags, 
             created_at, updated_at, last_used, is_favorite)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(&entry.id)
        .bind(&entry.title)
        .bind(&entry.username)
        .bind(&encrypted_password)
        .bind(&entry.url)
        .bind(&encrypted_notes)
        .bind(&entry.folder)
        .bind(&tags_json)
        .bind(&entry.created_at)
        .bind(&entry.updated_at)
        .bind(&entry.last_used)
        .bind(&entry.is_favorite)
        .execute(&self.pool)
        .await?;
        
        Ok(())
    }
    
    pub async fn get_password(&self, id: &str) -> Result<Option<PasswordEntry>, PasswordManagerError> {
        let row = sqlx::query(
            r#"
            SELECT id, title, username, encrypted_password, url, encrypted_notes, folder, tags,
                   created_at, updated_at, last_used, is_favorite
            FROM password_entries WHERE id = ?
            "#
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        
        if let Some(row) = row {
            let encrypted_password: String = row.get("encrypted_password");
            let password = self.decrypt_data(&encrypted_password)?;
            
            let encrypted_notes: Option<String> = row.get("encrypted_notes");
            let notes = encrypted_notes
                .map(|enc| self.decrypt_data(&enc))
                .transpose()?;
                
            let tags_json: String = row.get("tags");
            let tags: Vec<String> = serde_json::from_str(&tags_json)
                .map_err(|e| PasswordManagerError::Encryption(e.to_string()))?;
            
            Ok(Some(PasswordEntry {
                id: row.get("id"),
                title: row.get("title"),
                username: row.get("username"),
                password,
                url: row.get("url"),
                notes,
                folder: row.get("folder"),
                tags,
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                last_used: row.get("last_used"),
                is_favorite: row.get("is_favorite"),
            }))
        } else {
            Ok(None)
        }
    }
    
    pub async fn list_passwords(&self, folder: Option<&str>) -> Result<Vec<PasswordEntry>, PasswordManagerError> {
        let rows = if let Some(folder) = folder {
            sqlx::query(
                r#"
                SELECT id, title, username, encrypted_password, url, encrypted_notes, folder, tags,
                       created_at, updated_at, last_used, is_favorite
                FROM password_entries WHERE folder = ? ORDER BY title
                "#
            )
            .bind(folder)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(
                r#"
                SELECT id, title, username, encrypted_password, url, encrypted_notes, folder, tags,
                       created_at, updated_at, last_used, is_favorite
                FROM password_entries ORDER BY title
                "#
            )
            .fetch_all(&self.pool)
            .await?
        };
        
        let mut entries = Vec::new();
        for row in rows {
            let encrypted_password: String = row.get("encrypted_password");
            let password = self.decrypt_data(&encrypted_password)?;
            
            let encrypted_notes: Option<String> = row.get("encrypted_notes");
            let notes = encrypted_notes
                .map(|enc| self.decrypt_data(&enc))
                .transpose()?;
                
            let tags_json: String = row.get("tags");
            let tags: Vec<String> = serde_json::from_str(&tags_json)
                .map_err(|e| PasswordManagerError::Encryption(e.to_string()))?;
            
            entries.push(PasswordEntry {
                id: row.get("id"),
                title: row.get("title"),
                username: row.get("username"),
                password,
                url: row.get("url"),
                notes,
                folder: row.get("folder"),
                tags,
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                last_used: row.get("last_used"),
                is_favorite: row.get("is_favorite"),
            });
        }
        
        Ok(entries)
    }
    
    pub async fn delete_password(&self, id: &str) -> Result<bool, PasswordManagerError> {
        let result = sqlx::query("DELETE FROM password_entries WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
            
        Ok(result.rows_affected() > 0)
    }
    
    pub async fn search_passwords(&self, query: &str) -> Result<Vec<PasswordEntry>, PasswordManagerError> {
        let search_pattern = format!("%{}%", query);
        
        let rows = sqlx::query(
            r#"
            SELECT id, title, username, encrypted_password, url, encrypted_notes, folder, tags,
                   created_at, updated_at, last_used, is_favorite
            FROM password_entries 
            WHERE title LIKE ? OR username LIKE ? OR url LIKE ?
            ORDER BY title
            "#
        )
        .bind(&search_pattern)
        .bind(&search_pattern)
        .bind(&search_pattern)
        .fetch_all(&self.pool)
        .await?;
        
        let mut entries = Vec::new();
        for row in rows {
            let encrypted_password: String = row.get("encrypted_password");
            let password = self.decrypt_data(&encrypted_password)?;
            
            let encrypted_notes: Option<String> = row.get("encrypted_notes");
            let notes = encrypted_notes
                .map(|enc| self.decrypt_data(&enc))
                .transpose()?;
                
            let tags_json: String = row.get("tags");
            let tags: Vec<String> = serde_json::from_str(&tags_json)
                .map_err(|e| PasswordManagerError::Encryption(e.to_string()))?;
            
            entries.push(PasswordEntry {
                id: row.get("id"),
                title: row.get("title"),
                username: row.get("username"),
                password,
                url: row.get("url"),
                notes,
                folder: row.get("folder"),
                tags,
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                last_used: row.get("last_used"),
                is_favorite: row.get("is_favorite"),
            });
        }
        
        Ok(entries)
    }
    
    pub fn generate_password(&self, length: usize, include_symbols: bool) -> String {
        use rand::Rng;
        
        let mut chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".chars().collect::<Vec<_>>();
        
        if include_symbols {
            chars.extend("!@#$%^&*()_+-=[]{}|;:,.<>?".chars());
        }
        
        let mut rng = rand::thread_rng();
        (0..length)
            .map(|_| chars[rng.gen_range(0..chars.len())])
            .collect()
    }
    
    pub async fn store_github_token(&self, token: &str) -> Result<(), PasswordManagerError> {
        let entry = PasswordEntry {
            id: "github_api_token".to_string(),
            title: "GitHub API Token".to_string(),
            username: "api".to_string(),
            password: token.to_string(),
            url: Some("https://github.com".to_string()),
            notes: Some("Auto-generated for PWA Marketplace".to_string()),
            folder: Some("System".to_string()),
            tags: vec!["api".to_string(), "github".to_string()],
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_used: None,
            is_favorite: false,
        };
        
        self.store_password(&entry).await
    }
    
    pub async fn get_github_token(&self) -> Result<Option<String>, PasswordManagerError> {
        if let Some(entry) = self.get_password("github_api_token").await? {
            Ok(Some(entry.password))
        } else {
            Ok(None)
        }
    }
    
    // Private helper methods
    
    fn get_database_path() -> Result<PathBuf, PasswordManagerError> {
        let mut path = dirs::config_dir()
            .ok_or_else(|| PasswordManagerError::Io(
                std::io::Error::new(std::io::ErrorKind::NotFound, "Config directory not found")
            ))?;
        path.push("PWA-Marketplace");
        path.push("passwords.db");
        Ok(path)
    }
    
    fn derive_master_key(password: &str) -> Result<Vec<u8>, PasswordManagerError> {
        let salt = b"pwa_marketplace_salt"; // In production, this should be randomly generated and stored
        let mut key = [0u8; 32];
        
        argon2::Argon2::default()
            .hash_password_into(password.as_bytes(), salt, &mut key)
            .map_err(|e| PasswordManagerError::Encryption(e.to_string()))?;
            
        Ok(key.to_vec())
    }
    
    fn encrypt_data(&self, data: &str) -> Result<String, PasswordManagerError> {
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        let ciphertext = self.cipher
            .encrypt(nonce, data.as_bytes())
            .map_err(|e| PasswordManagerError::Encryption(e.to_string()))?;
            
        let mut result = nonce_bytes.to_vec();
        result.extend_from_slice(&ciphertext);
        
        Ok(base64::encode(result))
    }
    
    fn decrypt_data(&self, encrypted_data: &str) -> Result<String, PasswordManagerError> {
        let data = base64::decode(encrypted_data)
            .map_err(|e| PasswordManagerError::Encryption(e.to_string()))?;
            
        if data.len() < 12 {
            return Err(PasswordManagerError::Encryption("Invalid encrypted data".to_string()));
        }
        
        let (nonce_bytes, ciphertext) = data.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);
        
        let plaintext = self.cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| PasswordManagerError::Encryption(e.to_string()))?;
            
        String::from_utf8(plaintext)
            .map_err(|e| PasswordManagerError::Encryption(e.to_string()))
    }
    
    async fn init_database(&self) -> Result<(), PasswordManagerError> {
        // Create master config table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS master_config (
                id INTEGER PRIMARY KEY,
                master_password_hash TEXT NOT NULL
            )
            "#
        )
        .execute(&self.pool)
        .await?;
        
        // Create password entries table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS password_entries (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                username TEXT NOT NULL,
                encrypted_password TEXT NOT NULL,
                url TEXT,
                encrypted_notes TEXT,
                folder TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                last_used DATETIME,
                is_favorite BOOLEAN NOT NULL DEFAULT FALSE
            )
            "#
        )
        .execute(&self.pool)
        .await?;
        
        // Create secure notes table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS secure_notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                encrypted_content TEXT NOT NULL,
                folder TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
            "#
        )
        .execute(&self.pool)
        .await?;
        
        // Create indexes for better performance
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_password_entries_title ON password_entries(title)")
            .execute(&self.pool)
            .await?;
            
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_password_entries_folder ON password_entries(folder)")
            .execute(&self.pool)
            .await?;
        
        Ok(())
    }
}