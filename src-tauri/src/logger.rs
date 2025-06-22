// src-tauri/src/logger.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use thiserror::Error;
use tokio::sync::mpsc;

#[derive(Error, Debug)]
pub enum LoggerError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Channel error: {0}")]
    Channel(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl LogLevel {
    pub fn to_str(&self) -> &'static str {
        match self {
            LogLevel::Error => "ERROR",
            LogLevel::Warn => "WARN",
            LogLevel::Info => "INFO",
            LogLevel::Debug => "DEBUG",
            LogLevel::Trace => "TRACE",
        }
    }
    
    pub fn color(&self) -> &'static str {
        match self {
            LogLevel::Error => "\x1b[31m", // Red
            LogLevel::Warn => "\x1b[33m",  // Yellow
            LogLevel::Info => "\x1b[32m",  // Green
            LogLevel::Debug => "\x1b[36m", // Cyan
            LogLevel::Trace => "\x1b[37m", // White
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: DateTime<Utc>,
    pub level: LogLevel,
    pub target: String,
    pub message: String,
    pub module: Option<String>,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct LoggerConfig {
    pub level: LogLevel,
    pub log_to_file: bool,
    pub log_to_console: bool,
    pub file_path: PathBuf,
    pub max_file_size: u64,
    pub max_files: usize,
    pub buffer_size: usize,
    pub flush_interval: std::time::Duration,
    pub enable_colors: bool,
}

impl Default for LoggerConfig {
    fn default() -> Self {
        let log_dir = dirs::config_dir()
            .unwrap_or_else(|| std::env::temp_dir())
            .join("PWA-Marketplace")
            .join("logs");
        
        Self {
            level: LogLevel::Info,
            log_to_file: true,
            log_to_console: true,
            file_path: log_dir.join("pwa-marketplace.log"),
            max_file_size: 10 * 1024 * 1024, // 10MB
            max_files: 5,
            buffer_size: 1000,
            flush_interval: std::time::Duration::from_secs(5),
            enable_colors: true,
        }
    }
}

pub struct Logger {
    config: LoggerConfig,
    buffer: Arc<Mutex<VecDeque<LogEntry>>>,
    sender: mpsc::UnboundedSender<LogEntry>,
    _handle: tokio::task::JoinHandle<()>,
}

impl Logger {
    pub fn new(config: LoggerConfig) -> Result<Self, LoggerError> {
        // Ensure log directory exists
        if let Some(parent) = config.file_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        
        let buffer = Arc::new(Mutex::new(VecDeque::with_capacity(config.buffer_size)));
        let (sender, receiver) = mpsc::unbounded_channel();
        
        // Start background logging task
        let handle = Self::start_logging_task(config.clone(), buffer.clone(), receiver);
        
        Ok(Logger {
            config,
            buffer,
            sender,
            _handle: handle,
        })
    }
    
    fn start_logging_task(
        config: LoggerConfig,
        buffer: Arc<Mutex<VecDeque<LogEntry>>>,
        mut receiver: mpsc::UnboundedReceiver<LogEntry>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut flush_interval = tokio::time::interval(config.flush_interval);
            let mut pending_logs = Vec::new();
            
            loop {
                tokio::select! {
                    // Receive new log entries
                    log_entry = receiver.recv() => {
                        match log_entry {
                            Some(entry) => {
                                // Console logging
                                if config.log_to_console {
                                    Self::write_to_console(&entry, config.enable_colors);
                                }
                                
                                // Buffer for file logging
                                if config.log_to_file {
                                    pending_logs.push(entry.clone());
                                }
                                
                                // Add to in-memory buffer
                                let mut buffer_guard = buffer.lock().unwrap();
                                if buffer_guard.len() >= config.buffer_size {
                                    buffer_guard.pop_front();
                                }
                                buffer_guard.push_back(entry);
                            }
                            None => break, // Channel closed
                        }
                    }
                    
                    // Periodic flush to file
                    _ = flush_interval.tick() => {
                        if !pending_logs.is_empty() {
                            if let Err(e) = Self::flush_to_file(&config, &pending_logs).await {
                                eprintln!("Failed to flush logs to file: {}", e);
                            }
                            pending_logs.clear();
                        }
                    }
                }
            }
            
            // Final flush on shutdown
            if !pending_logs.is_empty() {
                let _ = Self::flush_to_file(&config, &pending_logs).await;
            }
        })
    }
    
    fn write_to_console(entry: &LogEntry, enable_colors: bool) {
        let timestamp = entry.timestamp.format("%Y-%m-%d %H:%M:%S%.3f");
        let level_str = entry.level.to_str();
        
        if enable_colors && atty::is(atty::Stream::Stdout) {
            let color = entry.level.color();
            let reset = "\x1b[0m";
            
            println!(
                "{}{} [{}] {}: {}{}", 
                color, timestamp, level_str, entry.target, entry.message, reset
            );
        } else {
            println!(
                "{} [{}] {}: {}", 
                timestamp, level_str, entry.target, entry.message
            );
        }
    }
    
    async fn flush_to_file(config: &LoggerConfig, entries: &[LogEntry]) -> Result<(), LoggerError> {
        // Check if we need to rotate log file
        if let Ok(metadata) = std::fs::metadata(&config.file_path) {
            if metadata.len() > config.max_file_size {
                Self::rotate_log_files(config)?;
            }
        }
        
        // Write entries to file
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&config.file_path)?;
        
        for entry in entries {
            let json_line = serde_json::to_string(entry)?;
            writeln!(file, "{}", json_line)?;
        }
        
        file.flush()?;
        Ok(())
    }
    
    fn rotate_log_files(config: &LoggerConfig) -> Result<(), LoggerError> {
        let base_path = &config.file_path;
        let base_name = base_path.file_stem().unwrap_or_default();
        let extension = base_path.extension().unwrap_or_default();
        let parent = base_path.parent().unwrap();
        
        // Rotate existing files
        for i in (1..config.max_files).rev() {
            let old_file = parent.join(format!(
                "{}.{}.{}", 
                base_name.to_string_lossy(), 
                i,
                extension.to_string_lossy()
            ));
            
            let new_file = parent.join(format!(
                "{}.{}.{}", 
                base_name.to_string_lossy(), 
                i + 1,
                extension.to_string_lossy()
            ));
            
            if old_file.exists() {
                let _ = std::fs::rename(old_file, new_file);
            }
        }
        
        // Move current file to .1
        if base_path.exists() {
            let backup_file = parent.join(format!(
                "{}.1.{}", 
                base_name.to_string_lossy(),
                extension.to_string_lossy()
            ));
            std::fs::rename(base_path, backup_file)?;
        }
        
        Ok(())
    }
    
    pub fn log(&self, level: LogLevel, target: &str, message: &str) {
        if !self.should_log(&level) {
            return;
        }
        
        let entry = LogEntry {
            timestamp: Utc::now(),
            level,
            target: target.to_string(),
            message: message.to_string(),
            module: None,
            file: None,
            line: None,
            metadata: None,
        };
        
        if let Err(_) = self.sender.send(entry) {
            eprintln!("Failed to send log entry to background task");
        }
    }
    
    pub fn log_with_metadata(
        &self, 
        level: LogLevel, 
        target: &str, 
        message: &str,
        metadata: serde_json::Value
    ) {
        if !self.should_log(&level) {
            return;
        }
        
        let entry = LogEntry {
            timestamp: Utc::now(),
            level,
            target: target.to_string(),
            message: message.to_string(),
            module: None,
            file: None,
            line: None,
            metadata: Some(metadata),
        };
        
        if let Err(_) = self.sender.send(entry) {
            eprintln!("Failed to send log entry to background task");
        }
    }
    
    pub fn error(&self, target: &str, message: &str) {
        self.log(LogLevel::Error, target, message);
    }
    
    pub fn warn(&self, target: &str, message: &str) {
        self.log(LogLevel::Warn, target, message);
    }
    
    pub fn info(&self, target: &str, message: &str) {
        self.log(LogLevel::Info, target, message);
    }
    
    pub fn debug(&self, target: &str, message: &str) {
        self.log(LogLevel::Debug, target, message);
    }
    
    pub fn trace(&self, target: &str, message: &str) {
        self.log(LogLevel::Trace, target, message);
    }
    
    fn should_log(&self, level: &LogLevel) -> bool {
        let current_level = match self.config.level {
            LogLevel::Error => 0,
            LogLevel::Warn => 1,
            LogLevel::Info => 2,
            LogLevel::Debug => 3,
            LogLevel::Trace => 4,
        };
        
        let message_level = match level {
            LogLevel::Error => 0,
            LogLevel::Warn => 1,
            LogLevel::Info => 2,
            LogLevel::Debug => 3,
            LogLevel::Trace => 4,
        };
        
        message_level <= current_level
    }
    
    pub fn get_recent_logs(&self, limit: usize) -> Vec<LogEntry> {
        let buffer = self.buffer.lock().unwrap();
        buffer.iter()
            .rev()
            .take(limit)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }
    
    pub fn get_logs_by_level(&self, level: LogLevel, limit: usize) -> Vec<LogEntry> {
        let buffer = self.buffer.lock().unwrap();
        buffer.iter()
            .filter(|entry| matches!(entry.level, level))
            .rev()
            .take(limit)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }
    
    pub fn clear_buffer(&self) {
        let mut buffer = self.buffer.lock().unwrap();
        buffer.clear();
    }
    
    pub async fn flush(&self) -> Result<(), LoggerError> {
        // Force flush by sending a dummy entry and waiting a bit
        tokio::time::sleep(self.config.flush_interval).await;
        Ok(())
    }
}

// Global logger instance
static GLOBAL_LOGGER: std::sync::OnceLock<Logger> = std::sync::OnceLock::new();

pub fn init() -> Result<(), LoggerError> {
    let config = LoggerConfig::default();
    init_with_config(config)
}

pub fn init_with_config(config: LoggerConfig) -> Result<(), LoggerError> {
    let logger = Logger::new(config)?;
    
    if GLOBAL_LOGGER.set(logger).is_err() {
        return Err(LoggerError::Channel("Logger already initialized".to_string()));
    }
    
    Ok(())
}

pub fn get_logger() -> Option<&'static Logger> {
    GLOBAL_LOGGER.get()
}

// Convenience macros
#[macro_export]
macro_rules! log_error {
    ($target:expr, $($arg:tt)*) => {
        if let Some(logger) = $crate::logger::get_logger() {
            logger.error($target, &format!($($arg)*));
        }
    };
}

#[macro_export]
macro_rules! log_warn {
    ($target:expr, $($arg:tt)*) => {
        if let Some(logger) = $crate::logger::get_logger() {
            logger.warn($target, &format!($($arg)*));
        }
    };
}

#[macro_export]
macro_rules! log_info {
    ($target:expr, $($arg:tt)*) => {
        if let Some(logger) = $crate::logger::get_logger() {
            logger.info($target, &format!($($arg)*));
        }
    };
}

#[macro_export]
macro_rules! log_debug {
    ($target:expr, $($arg:tt)*) => {
        if let Some(logger) = $crate::logger::get_logger() {
            logger.debug($target, &format!($($arg)*));
        }
    };
}

#[macro_export]
macro_rules! log_trace {
    ($target:expr, $($arg:tt)*) => {
        if let Some(logger) = $crate::logger::get_logger() {
            logger.trace($target, &format!($($arg)*));
        }
    };
}

// Tauri commands for frontend integration
#[tauri::command]
pub async fn get_recent_logs(limit: usize) -> Result<Vec<LogEntry>, String> {
    if let Some(logger) = get_logger() {
        Ok(logger.get_recent_logs(limit))
    } else {
        Err("Logger not initialized".to_string())
    }
}

#[tauri::command]
pub async fn get_logs_by_level(level_str: String, limit: usize) -> Result<Vec<LogEntry>, String> {
    let level = match level_str.to_lowercase().as_str() {
        "error" => LogLevel::Error,
        "warn" => LogLevel::Warn,
        "info" => LogLevel::Info,
        "debug" => LogLevel::Debug,
        "trace" => LogLevel::Trace,
        _ => return Err("Invalid log level".to_string()),
    };
    
    if let Some(logger) = get_logger() {
        Ok(logger.get_logs_by_level(level, limit))
    } else {
        Err("Logger not initialized".to_string())
    }
}

#[tauri::command]
pub async fn clear_log_buffer() -> Result<(), String> {
    if let Some(logger) = get_logger() {
        logger.clear_buffer();
        Ok(())
    } else {
        Err("Logger not initialized".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    
    #[tokio::test]
    async fn test_logger_creation() {
        let temp_dir = TempDir::new().unwrap();
        let config = LoggerConfig {
            file_path: temp_dir.path().join("test.log"),
            ..Default::default()
        };
        
        let logger = Logger::new(config).unwrap();
        logger.info("test", "Test message");
        
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        
        let logs = logger.get_recent_logs(10);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].message, "Test message");
    }
    
    #[tokio::test]
    async fn test_log_levels() {
        let temp_dir = TempDir::new().unwrap();
        let config = LoggerConfig {
            file_path: temp_dir.path().join("test.log"),
            level: LogLevel::Warn,
            ..Default::default()
        };
        
        let logger = Logger::new(config).unwrap();
        
        logger.debug("test", "Debug message"); // Should be filtered out
        logger.warn("test", "Warning message"); // Should be logged
        logger.error("test", "Error message"); // Should be logged
        
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        
        let logs = logger.get_recent_logs(10);
        assert_eq!(logs.len(), 2); // Only warn and error
    }
    
    #[test]
    fn test_log_level_ordering() {
        let config = LoggerConfig {
            level: LogLevel::Info,
            ..Default::default()
        };
        
        let logger = Logger::new(config).unwrap();
        
        assert!(logger.should_log(&LogLevel::Error));
        assert!(logger.should_log(&LogLevel::Warn));
        assert!(logger.should_log(&LogLevel::Info));
        assert!(!logger.should_log(&LogLevel::Debug));
        assert!(!logger.should_log(&LogLevel::Trace));
    }
}