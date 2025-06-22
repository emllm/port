use std::sync::Mutex;
use std::sync::Arc;
use std::fs;
use std::path::{Path, PathBuf};
use std::io::Write;
use chrono;
use log;
use tauri::State;

pub struct Logger {
    log_file: Mutex<PathBuf>,
    level: log::LevelFilter,
}

impl Logger {
    pub fn new(log_file: PathBuf, level: log::LevelFilter) -> Arc<Self> {
        // Initialize log file
        if !log_file.exists() {
            if let Some(parent) = log_file.parent() {
                fs::create_dir_all(parent).expect("Failed to create log directory");
            }
            fs::File::create(&log_file).expect("Failed to create log file");
        }

        // Initialize global logger
        log::set_max_level(level);
        log::set_boxed_logger(Box::new(Self {
            log_file: Mutex::new(log_file),
            level,
        })).expect("Failed to set logger");

        Arc::new(Logger {
            log_file: Mutex::new(log_file),
            level,
        })
    }

    fn log_message(&self, level: log::Level, message: &str) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let log_line = format!("[{}] [{}] {}\n", timestamp, level, message);

        if let Ok(mut file) = fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(self.log_file.lock().unwrap().as_path())
        {
            if let Err(e) = file.write_all(log_line.as_bytes()) {
                eprintln!("Failed to write log: {}", e);
            }
        }
    }
}

impl log::Log for Logger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= self.level
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            self.log_message(record.level(), record.args().to_string());
        }
    }

    fn flush(&self) {
        // No-op since we're writing directly to file
    }
}

#[tauri::command]
fn log_info(
    message: String,
    logger: State<'_, Arc<Logger>>,
) {
    log::info!("{}", message);
}

#[tauri::command]
fn log_error(
    message: String,
    logger: State<'_, Arc<Logger>>,
) {
    log::error!("{}", message);
}

#[tauri::command]
fn log_warning(
    message: String,
    logger: State<'_, Arc<Logger>>,
) {
    log::warn!("{}", message);
}

#[tauri::command]
fn log_debug(
    message: String,
    logger: State<'_, Arc<Logger>>,
) {
    log::debug!("{}", message);
}

#[tauri::command]
fn log_trace(
    message: String,
    logger: State<'_, Arc<Logger>>,
) {
    log::trace!("{}", message);
}

#[tauri::command]
fn set_log_level(
    level: String,
    logger: State<'_, Arc<Logger>>,
) -> Result<(), String> {
    let level = match level.to_lowercase().as_str() {
        "trace" => log::LevelFilter::Trace,
        "debug" => log::LevelFilter::Debug,
        "info" => log::LevelFilter::Info,
        "warn" => log::LevelFilter::Warn,
        "error" => log::LevelFilter::Error,
        _ => return Err("Invalid log level".to_string()),
    };

    log::set_max_level(level);
    Ok(())
}

pub fn init(log_file: PathBuf, level: log::LevelFilter) -> Arc<Logger> {
    let logger = Logger::new(log_file, level);

    tauri::Builder::default()
        .manage(logger.clone())
        .invoke_handler(tauri::generate_handler![
            log_info,
            log_error,
            log_warning,
            log_debug,
            log_trace,
            set_log_level
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    logger
}
