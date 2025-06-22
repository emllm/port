// src-tauri/src/auto_updater.rs
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use thiserror::Error;
use tokio::time::sleep;

#[derive(Error, Debug)]
pub enum UpdateError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON parsing failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Update validation failed: {0}")]
    Validation(String),
    #[error("Download failed: {0}")]
    Download(String),
    #[error("Installation failed: {0}")]
    Installation(String),
    #[error("No update available")]
    NoUpdate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub name: String,
    pub notes: String,
    pub pub_date: String,
    pub platforms: Vec<PlatformUpdate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformUpdate {
    pub platform: String,
    pub arch: String,
    pub url: String,
    pub signature: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgress {
    pub stage: UpdateStage,
    pub progress: f64,
    pub message: String,
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum UpdateStage {
    Checking,
    Downloading,
    Verifying,
    Installing,
    Complete,
    Error,
}

pub struct AutoUpdater {
    app_handle: AppHandle,
    http_client: HttpClient,
    config: UpdateConfig,
    current_version: String,
}

#[derive(Debug, Clone)]
pub struct UpdateConfig {
    pub check_interval: Duration,
    pub endpoints: Vec<String>,
    pub public_key: String,
    pub download_dir: PathBuf,
    pub auto_install: bool,
    pub check_on_startup: bool,
    pub beta_channel: bool,
}

impl Default for UpdateConfig {
    fn default() -> Self {
        Self {
            check_interval: Duration::from_secs(24 * 60 * 60), // 24 hours
            endpoints: vec![
                "https://api.github.com/repos/your-org/pwa-marketplace/releases/latest".to_string()
            ],
            public_key: "YOUR_PUBLIC_KEY_HERE".to_string(), // Would be replaced with actual key
            download_dir: dirs::cache_dir()
                .unwrap_or_else(|| std::env::temp_dir())
                .join("pwa-marketplace-updates"),
            auto_install: false,
            check_on_startup: true,
            beta_channel: false,
        }
    }
}

impl AutoUpdater {
    pub fn new(app_handle: AppHandle, config: UpdateConfig) -> Self {
        let current_version = app_handle.package_info().version.to_string();
        
        let http_client = HttpClient::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(format!("PWA-Marketplace/{}", current_version))
            .build()
            .expect("Failed to create HTTP client");
        
        Self {
            app_handle,
            http_client,
            config,
            current_version,
        }
    }
    
    /// Start the auto-updater service
    pub async fn start(&self) -> Result<(), UpdateError> {
        log::info!("Starting auto-updater service");
        
        // Create download directory
        std::fs::create_dir_all(&self.config.download_dir)?;
        
        // Check for updates on startup if enabled
        if self.config.check_on_startup {
            if let Err(e) = self.check_for_updates().await {
                log::warn!("Startup update check failed: {}", e);
            }
        }
        
        // Start periodic update checks
        self.start_periodic_checks().await;
        
        Ok(())
    }
    
    /// Start periodic update checking
    async fn start_periodic_checks(&self) {
        let app_handle = self.app_handle.clone();
        let config = self.config.clone();
        let http_client = self.http_client.clone();
        let current_version = self.current_version.clone();
        
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(config.check_interval);
            
            loop {
                interval.tick().await;
                
                let updater = AutoUpdater {
                    app_handle: app_handle.clone(),
                    http_client: http_client.clone(),
                    config: config.clone(),
                    current_version: current_version.clone(),
                };
                
                if let Err(e) = updater.check_for_updates().await {
                    log::warn!("Periodic update check failed: {}", e);
                }
            }
        });
    }
    
    /// Check for available updates
    pub async fn check_for_updates(&self) -> Result<Option<UpdateInfo>, UpdateError> {
        self.emit_progress(UpdateStage::Checking, 0.0, "Checking for updates...".to_string()).await;
        
        log::info!("Checking for updates, current version: {}", self.current_version);
        
        let mut latest_update: Option<UpdateInfo> = None;
        
        // Try each endpoint until we find an update or exhaust all options
        for endpoint in &self.config.endpoints {
            match self.fetch_update_info(endpoint).await {
                Ok(update_info) => {
                    if self.is_newer_version(&update_info.version) {
                        log::info!("Found update: {} -> {}", self.current_version, update_info.version);
                        latest_update = Some(update_info);
                        break;
                    } else {
                        log::debug!("No newer version found at {}", endpoint);
                    }
                }
                Err(e) => {
                    log::warn!("Failed to check endpoint {}: {}", endpoint, e);
                    continue;
                }
            }
        }
        
        match &latest_update {
            Some(update) => {
                // Emit update available event
                self.app_handle.emit_all("update-available", update)
                    .map_err(|e| UpdateError::Validation(e.to_string()))?;
                
                // Auto-install if enabled
                if self.config.auto_install {
                    log::info!("Auto-installing update");
                    self.download_and_install_update(update).await?;
                } else {
                    self.emit_progress(UpdateStage::Complete, 100.0, "Update available".to_string()).await;
                }
            }
            None => {
                log::info!("No updates available");
                self.emit_progress(UpdateStage::Complete, 100.0, "No updates available".to_string()).await;
            }
        }
        
        Ok(latest_update)
    }
    
    /// Fetch update information from endpoint
    async fn fetch_update_info(&self, endpoint: &str) -> Result<UpdateInfo, UpdateError> {
        log::debug!("Fetching update info from: {}", endpoint);
        
        let response = self.http_client
            .get(endpoint)
            .send()
            .await?;
        
        if !response.status().is_success() {
            return Err(UpdateError::Http(reqwest::Error::from(
                reqwest::Error::from(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("HTTP {}", response.status())
                ))
            )));
        }
        
        // Parse GitHub release format
        let github_release: serde_json::Value = response.json().await?;
        
        let update_info = self.parse_github_release(github_release)?;
        
        Ok(update_info)
    }
    
    /// Parse GitHub release JSON to UpdateInfo
    fn parse_github_release(&self, release: serde_json::Value) -> Result<UpdateInfo, UpdateError> {
        let version = release["tag_name"]
            .as_str()
            .ok_or_else(|| UpdateError::Validation("Missing tag_name".to_string()))?
            .trim_start_matches('v')
            .to_string();
        
        let name = release["name"]
            .as_str()
            .unwrap_or(&version)
            .to_string();
        
        let notes = release["body"]
            .as_str()
            .unwrap_or("")
            .to_string();
        
        let pub_date = release["published_at"]
            .as_str()
            .unwrap_or("")
            .to_string();
        
        let assets = release["assets"]
            .as_array()
            .ok_or_else(|| UpdateError::Validation("No assets found".to_string()))?;
        
        let mut platforms = Vec::new();
        
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            let download_url = asset["browser_download_url"].as_str().unwrap_or("");
            let size = asset["size"].as_u64().unwrap_or(0);
            
            // Determine platform and architecture from filename
            let (platform, arch) = self.parse_platform_from_filename(name);
            
            if !platform.is_empty() && !download_url.is_empty() {
                platforms.push(PlatformUpdate {
                    platform,
                    arch,
                    url: download_url.to_string(),
                    signature: "".to_string(), // Would be populated from .sig files
                    size,
                });
            }
        }
        
        Ok(UpdateInfo {
            version,
            name,
            notes,
            pub_date,
            platforms,
        })
    }
    
    /// Parse platform and architecture from filename
    fn parse_platform_from_filename(&self, filename: &str) -> (String, String) {
        let filename_lower = filename.to_lowercase();
        
        let platform = if filename_lower.contains("windows") || filename_lower.contains(".exe") || filename_lower.contains(".msi") {
            "windows"
        } else if filename_lower.contains("macos") || filename_lower.contains("darwin") || filename_lower.contains(".dmg") {
            "darwin"
        } else if filename_lower.contains("linux") || filename_lower.contains(".appimage") || filename_lower.contains(".deb") {
            "linux"
        } else {
            return ("".to_string(), "".to_string());
        };
        
        let arch = if filename_lower.contains("x64") || filename_lower.contains("x86_64") || filename_lower.contains("amd64") {
            "x86_64"
        } else if filename_lower.contains("arm64") || filename_lower.contains("aarch64") {
            "aarch64"
        } else if filename_lower.contains("x86") || filename_lower.contains("i386") {
            "i686"
        } else {
            "x86_64" // Default assumption
        };
        
        (platform.to_string(), arch.to_string())
    }
    
    /// Check if version is newer than current
    fn is_newer_version(&self, new_version: &str) -> bool {
        // Simple semver comparison
        let current_parts: Vec<u32> = self.current_version
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect();
        
        let new_parts: Vec<u32> = new_version
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect();
        
        // Compare major.minor.patch
        for i in 0..3 {
            let current = current_parts.get(i).unwrap_or(&0);
            let new = new_parts.get(i).unwrap_or(&0);
            
            if new > current {
                return true;
            } else if new < current {
                return false;
            }
        }
        
        false // Versions are equal
    }
    
    /// Download and install update
    pub async fn download_and_install_update(&self, update_info: &UpdateInfo) -> Result<(), UpdateError> {
        // Find platform-specific update
        let current_platform = self.get_current_platform();
        let current_arch = self.get_current_arch();
        
        let platform_update = update_info.platforms
            .iter()
            .find(|p| p.platform == current_platform && p.arch == current_arch)
            .ok_or_else(|| UpdateError::Validation(
                format!("No update available for platform: {}-{}", current_platform, current_arch)
            ))?;
        
        // Download update
        let download_path = self.download_update(platform_update).await?;
        
        // Verify download
        self.verify_download(&download_path, platform_update).await?;
        
        // Install update
        self.install_update(&download_path, platform_update).await?;
        
        Ok(())
    }
    
    /// Download update file
    async fn download_update(&self, platform_update: &PlatformUpdate) -> Result<PathBuf, UpdateError> {
        let filename = platform_update.url
            .split('/')
            .last()
            .ok_or_else(|| UpdateError::Download("Invalid download URL".to_string()))?;
        
        let download_path = self.config.download_dir.join(filename);
        
        self.emit_progress(
            UpdateStage::Downloading, 
            0.0, 
            format!("Downloading {}", filename)
        ).await;
        
        log::info!("Downloading update from: {}", platform_update.url);
        
        let response = self.http_client
            .get(&platform_update.url)
            .send()
            .await?;
        
        if !response.status().is_success() {
            return Err(UpdateError::Download(
                format!("Download failed with status: {}", response.status())
            ));
        }
        
        let total_size = response.content_length().unwrap_or(platform_update.size);
        let mut downloaded = 0u64;
        let mut file = tokio::fs::File::create(&download_path).await?;
        let mut stream = response.bytes_stream();
        
        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;
        
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| UpdateError::Download(e.to_string()))?;
            downloaded += chunk.len() as u64;
            
            file.write_all(&chunk).await?;
            
            // Update progress
            let progress = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };
            
            self.emit_progress(
                UpdateStage::Downloading,
                progress,
                format!("Downloaded {} / {} bytes", downloaded, total_size)
            ).await;
        }
        
        file.sync_all().await?;
        
        log::info!("Download completed: {}", download_path.display());
        
        Ok(download_path)
    }
    
    /// Verify downloaded file
    async fn verify_download(&self, file_path: &PathBuf, platform_update: &PlatformUpdate) -> Result<(), UpdateError> {
        self.emit_progress(UpdateStage::Verifying, 0.0, "Verifying download...".to_string()).await;
        
        // Check file size
        let metadata = tokio::fs::metadata(file_path).await?;
        if metadata.len() != platform_update.size {
            return Err(UpdateError::Validation(
                format!("File size mismatch: expected {}, got {}", platform_update.size, metadata.len())
            ));
        }
        
        // TODO: Verify signature if available
        if !platform_update.signature.is_empty() {
            log::info!("Signature verification would be performed here");
            // This would use the public key to verify the signature
        }
        
        self.emit_progress(UpdateStage::Verifying, 100.0, "Verification complete".to_string()).await;
        
        Ok(())
    }
    
    /// Install update
    async fn install_update(&self, file_path: &PathBuf, platform_update: &PlatformUpdate) -> Result<(), UpdateError> {
        self.emit_progress(UpdateStage::Installing, 0.0, "Installing update...".to_string()).await;
        
        log::info!("Installing update from: {}", file_path.display());
        
        match platform_update.platform.as_str() {
            "windows" => self.install_windows_update(file_path).await?,
            "darwin" => self.install_macos_update(file_path).await?,
            "linux" => self.install_linux_update(file_path).await?,
            _ => return Err(UpdateError::Installation("Unsupported platform".to_string())),
        }
        
        self.emit_progress(UpdateStage::Complete, 100.0, "Update installed successfully".to_string()).await;
        
        // Emit installation complete event
        self.app_handle.emit_all("update-installed", ())
            .map_err(|e| UpdateError::Installation(e.to_string()))?;
        
        Ok(())
    }
    
    /// Install Windows update
    async fn install_windows_update(&self, file_path: &PathBuf) -> Result<(), UpdateError> {
        let extension = file_path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("");
        
        match extension {
            "exe" => {
                // Run installer
                let output = std::process::Command::new(file_path)
                    .args(&["/S"]) // Silent install
                    .output()
                    .map_err(|e| UpdateError::Installation(e.to_string()))?;
                
                if !output.status.success() {
                    return Err(UpdateError::Installation(
                        String::from_utf8_lossy(&output.stderr).to_string()
                    ));
                }
            }
            "msi" => {
                // Run MSI installer
                let output = std::process::Command::new("msiexec")
                    .args(&["/i", file_path.to_str().unwrap(), "/quiet", "/norestart"])
                    .output()
                    .map_err(|e| UpdateError::Installation(e.to_string()))?;
                
                if !output.status.success() {
                    return Err(UpdateError::Installation(
                        String::from_utf8_lossy(&output.stderr).to_string()
                    ));
                }
            }
            _ => {
                return Err(UpdateError::Installation(
                    format!("Unsupported Windows installer format: {}", extension)
                ));
            }
        }
        
        Ok(())
    }
    
    /// Install macOS update
    async fn install_macos_update(&self, file_path: &PathBuf) -> Result<(), UpdateError> {
        let extension = file_path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("");
        
        match extension {
            "dmg" => {
                // Mount DMG and copy app
                let mount_output = std::process::Command::new("hdiutil")
                    .args(&["attach", file_path.to_str().unwrap(), "-nobrowse", "-quiet"])
                    .output()
                    .map_err(|e| UpdateError::Installation(e.to_string()))?;
                
                if !mount_output.status.success() {
                    return Err(UpdateError::Installation("Failed to mount DMG".to_string()));
                }
                
                // Find mounted volume
                let mount_info = String::from_utf8_lossy(&mount_output.stdout);
                let volume_path = mount_info.lines()
                    .find(|line| line.contains("/Volumes/"))
                    .and_then(|line| line.split_whitespace().last())
                    .ok_or_else(|| UpdateError::Installation("Could not find mounted volume".to_string()))?;
                
                // Copy app to Applications
                let copy_output = std::process::Command::new("cp")
                    .args(&["-R", &format!("{}/PWA Marketplace.app", volume_path), "/Applications/"])
                    .output()
                    .map_err(|e| UpdateError::Installation(e.to_string()))?;
                
                // Unmount DMG
                let _ = std::process::Command::new("hdiutil")
                    .args(&["detach", volume_path, "-quiet"])
                    .output();
                
                if !copy_output.status.success() {
                    return Err(UpdateError::Installation("Failed to copy application".to_string()));
                }
            }
            _ => {
                return Err(UpdateError::Installation(
                    format!("Unsupported macOS installer format: {}", extension)
                ));
            }
        }
        
        Ok(())
    }
    
    /// Install Linux update
    async fn install_linux_update(&self, file_path: &PathBuf) -> Result<(), UpdateError> {
        let extension = file_path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("");
        
        match extension {
            "AppImage" => {
                // Make executable and move to applications directory
                let app_dir = dirs::home_dir()
                    .ok_or_else(|| UpdateError::Installation("Could not find home directory".to_string()))?
                    .join(".local/share/applications");
                
                std::fs::create_dir_all(&app_dir)?;
                
                let dest_path = app_dir.join("PWA-Marketplace.AppImage");
                
                // Copy file
                tokio::fs::copy(file_path, &dest_path).await?;
                
                // Make executable
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let mut perms = tokio::fs::metadata(&dest_path).await?.permissions();
                    perms.set_mode(0o755);
                    tokio::fs::set_permissions(&dest_path, perms).await?;
                }
            }
            "deb" => {
                // Install DEB package
                let output = std::process::Command::new("dpkg")
                    .args(&["-i", file_path.to_str().unwrap()])
                    .output()
                    .map_err(|e| UpdateError::Installation(e.to_string()))?;
                
                if !output.status.success() {
                    return Err(UpdateError::Installation(
                        String::from_utf8_lossy(&output.stderr).to_string()
                    ));
                }
            }
            _ => {
                return Err(UpdateError::Installation(
                    format!("Unsupported Linux installer format: {}", extension)
                ));
            }
        }
        
        Ok(())
    }
    
    /// Get current platform
    fn get_current_platform(&self) -> String {
        std::env::consts::OS.to_string()
    }
    
    /// Get current architecture
    fn get_current_arch(&self) -> String {
        std::env::consts::ARCH.to_string()
    }
    
    /// Emit progress update
    async fn emit_progress(&self, stage: UpdateStage, progress: f64, message: String) {
        let progress_info = UpdateProgress {
            stage,
            progress,
            message,
            bytes_downloaded: 0,
            total_bytes: 0,
        };
        
        if let Err(e) = self.app_handle.emit_all("update-progress", &progress_info) {
            log::warn!("Failed to emit progress: {}", e);
        }
    }
    
    /// Clean up old update files
    pub async fn cleanup_old_updates(&self) -> Result<(), UpdateError> {
        let mut read_dir = tokio::fs::read_dir(&self.config.download_dir).await?;
        
        while let Some(entry) = read_dir.next_entry().await? {
            let metadata = entry.metadata().await?;
            
            // Remove files older than 7 days
            if let Ok(modified) = metadata.modified() {
                if let Ok(elapsed) = modified.elapsed() {
                    if elapsed > Duration::from_secs(7 * 24 * 60 * 60) {
                        if let Err(e) = tokio::fs::remove_file(entry.path()).await {
                            log::warn!("Failed to remove old update file: {}", e);
                        } else {
                            log::info!("Removed old update file: {}", entry.path().display());
                        }
                    }
                }
            }
        }
        
        Ok(())
    }
}

// Tauri commands for frontend integration
#[tauri::command]
pub async fn check_for_updates(
    app_handle: tauri::AppHandle
) -> Result<Option<UpdateInfo>, String> {
    let config = UpdateConfig::default();
    let updater = AutoUpdater::new(app_handle, config);
    
    updater.check_for_updates().await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_and_install_update(
    update_info: UpdateInfo,
    app_handle: tauri::AppHandle
) -> Result<(), String> {
    let config = UpdateConfig::default();
    let updater = AutoUpdater::new(app_handle, config);
    
    updater.download_and_install_update(&update_info).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restart_app(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Save any pending data
    app_handle.emit_all("app-restarting", ())
        .map_err(|e| e.to_string())?;
    
    // Wait a bit for cleanup
    sleep(Duration::from_secs(2)).await;
    
    // Restart the application
    app_handle.restart();
}

// Public function for main.rs integration
pub async fn check_for_updates(app_handle: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let config = UpdateConfig::default();
    let updater = AutoUpdater::new(app_handle.clone(), config);
    
    updater.start().await?;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_version_comparison() {
        let updater = AutoUpdater {
            app_handle: tauri::test::mock_app().handle(),
            http_client: HttpClient::new(),
            config: UpdateConfig::default(),
            current_version: "1.0.0".to_string(),
        };
        
        assert!(updater.is_newer_version("1.0.1"));
        assert!(updater.is_newer_version("1.1.0"));
        assert!(updater.is_newer_version("2.0.0"));
        assert!(!updater.is_newer_version("1.0.0"));
        assert!(!updater.is_newer_version("0.9.9"));
    }
    
    #[test]
    fn test_platform_parsing() {
        let updater = AutoUpdater {
            app_handle: tauri::test::mock_app().handle(),
            http_client: HttpClient::new(),
            config: UpdateConfig::default(),
            current_version: "1.0.0".to_string(),
        };
        
        assert_eq!(
            updater.parse_platform_from_filename("app-1.0.0-windows-x64.exe"),
            ("windows".to_string(), "x86_64".to_string())
        );
        
        assert_eq!(
            updater.parse_platform_from_filename("app-1.0.0-macos-arm64.dmg"),
            ("darwin".to_string(), "aarch64".to_string())
        );
        
        assert_eq!(
            updater.parse_platform_from_filename("app-1.0.0-linux-x86_64.AppImage"),
            ("linux".to_string(), "x86_64".to_string())
        );
    }
}