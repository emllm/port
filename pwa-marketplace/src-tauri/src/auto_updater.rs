use std::sync::Mutex;
use std::sync::Arc;
use std::path::PathBuf;
use std::fs;
use std::io;
use std::time::Duration;
use std::thread;
use tauri::api::http::Client;
use tauri::api::updater::Release;
use tauri::api::updater::Updater;
use tauri::api::updater::UpdaterConfig;
use tauri::State;

pub struct AutoUpdater {
    updater: Updater,
    last_check: Mutex<Option<chrono::DateTime<chrono::Local>>>,
    check_interval: Duration,
}

impl AutoUpdater {
    pub fn new(config: UpdaterConfig, check_interval: Duration) -> Arc<Self> {
        Arc::new(AutoUpdater {
            updater: Updater::new(config),
            last_check: Mutex::new(None),
            check_interval,
        })
    }

    pub fn check_for_updates(&self) -> Result<Option<Release>, String> {
        let mut last_check = self.last_check.lock().unwrap();
        
        // Check if we should skip update check
        if let Some(last) = *last_check {
            if chrono::Local::now() - last < self.check_interval {
                return Ok(None);
            }
        }

        // Perform update check
        match self.updater.check() {
            Ok(release) => {
                *last_check = Some(chrono::Local::now());
                Ok(Some(release))
            }
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn download_update(&self, release: &Release) -> Result<PathBuf, String> {
        let client = Client::new();
        let url = release.assets[0].browser_download_url.clone();
        
        match client.download_file(&url) {
            Ok(path) => Ok(path),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn install_update(&self, path: &PathBuf) -> Result<(), String> {
        // Backup current installation
        let backup_path = path.with_extension("backup");
        if let Err(e) = fs::copy(path, &backup_path) {
            return Err(format!("Failed to create backup: {}", e));
        }

        // Install new version
        if let Err(e) = fs::copy(path, path) {
            // Restore backup on failure
            if let Err(_) = fs::copy(&backup_path, path) {
                return Err(format!("Failed to restore backup: {}", e));
            }
            return Err(format!("Failed to install update: {}", e));
        }

        // Clean up backup
        if let Err(e) = fs::remove_file(&backup_path) {
            return Err(format!("Failed to clean up backup: {}", e));
        }

        Ok(())
    }

    pub fn start_auto_check(&self) {
        thread::spawn({
            let updater = self.clone();
            move || loop {
                if let Ok(Some(release)) = updater.check_for_updates() {
                    // TODO: Notify UI about available update
                    println!("New update available: {}", release.version);
                }
                thread::sleep(updater.check_interval);
            }
        });
    }
}

#[tauri::command]
fn check_for_updates(
    updater: State<'_, Arc<AutoUpdater>>,
) -> Result<Option<String>, String> {
    Ok(updater.check_for_updates()?
        .map(|r| serde_json::to_string(&r).unwrap()))
}

#[tauri::command]
fn download_update(
    release: String,
    updater: State<'_, Arc<AutoUpdater>>,
) -> Result<String, String> {
    let release: Release = serde_json::from_str(&release).map_err(|e| e.to_string())?;
    let path = updater.download_update(&release)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn install_update(
    path: String,
    updater: State<'_, Arc<AutoUpdater>>,
) -> Result<(), String> {
    updater.install_update(&PathBuf::from(path))
}

#[tauri::command]
fn start_auto_check(
    updater: State<'_, Arc<AutoUpdater>>,
) {
    updater.start_auto_check()
}

pub fn init(config: UpdaterConfig, check_interval: Duration) -> Arc<AutoUpdater> {
    let updater = AutoUpdater::new(config, check_interval);

    tauri::Builder::default()
        .manage(updater.clone())
        .invoke_handler(tauri::generate_handler![
            check_for_updates,
            download_update,
            install_update,
            start_auto_check
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    updater
}
