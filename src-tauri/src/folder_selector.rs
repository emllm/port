// src-tauri/src/folder_selector.rs
use std::path::PathBuf;
use tauri::api::dialog::blocking::FileDialogBuilder;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FolderSelectorError {
    #[error("No folder selected")]
    NoSelection,
    #[error("Invalid folder path")]
    InvalidPath,
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("Folder does not exist: {0}")]
    FolderNotExists(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub struct FolderSelector {
    default_paths: FolderDefaults,
}

#[derive(Debug, Clone)]
pub struct FolderDefaults {
    pub apps_folder: PathBuf,
    pub data_folder: PathBuf,
    pub documents_folder: PathBuf,
    pub downloads_folder: PathBuf,
}

#[derive(Debug, Clone)]
pub struct FolderSelectionOptions {
    pub title: String,
    pub default_path: Option<PathBuf>,
    pub create_if_missing: bool,
    pub validate_permissions: bool,
}

impl Default for FolderSelectionOptions {
    fn default() -> Self {
        Self {
            title: "Select Folder".to_string(),
            default_path: None,
            create_if_missing: true,
            validate_permissions: true,
        }
    }
}

impl FolderSelector {
    pub fn new() -> Result<Self, FolderSelectorError> {
        let default_paths = Self::get_default_paths()?;
        
        Ok(FolderSelector {
            default_paths,
        })
    }
    
    /// Select a folder using native OS dialog
    pub fn select_folder(&self, options: FolderSelectionOptions) -> Result<PathBuf, FolderSelectorError> {
        let mut dialog = FileDialogBuilder::new()
            .set_title(&options.title);
            
        // Set default directory
        if let Some(default_path) = &options.default_path {
            if default_path.exists() {
                dialog = dialog.set_directory(default_path);
            }
        } else {
            dialog = dialog.set_directory(&self.default_paths.documents_folder);
        }
        
        // Show folder picker dialog
        let selected_path = dialog.pick_folder()
            .ok_or(FolderSelectorError::NoSelection)?;
            
        // Validate the selected path
        self.validate_folder_selection(&selected_path, &options)?;
        
        // Create folder if it doesn't exist and option is enabled
        if options.create_if_missing && !selected_path.exists() {
            self.create_folder_with_parents(&selected_path)?;
        }
        
        Ok(selected_path)
    }
    
    /// Select apps folder with appropriate defaults
    pub fn select_apps_folder(&self) -> Result<PathBuf, FolderSelectorError> {
        let options = FolderSelectionOptions {
            title: "Select Apps Folder - Where PWA applications will be stored".to_string(),
            default_path: Some(self.default_paths.apps_folder.clone()),
            create_if_missing: true,
            validate_permissions: true,
        };
        
        self.select_folder(options)
    }
    
    /// Select data folder with appropriate defaults
    pub fn select_data_folder(&self) -> Result<PathBuf, FolderSelectorError> {
        let options = FolderSelectionOptions {
            title: "Select Data Folder - Where application data will be stored".to_string(),
            default_path: Some(self.default_paths.data_folder.clone()),
            create_if_missing: true,
            validate_permissions: true,
        };
        
        self.select_folder(options)
    }
    
    /// Select any custom folder for app-specific access
    pub fn select_custom_folder(&self, app_name: &str) -> Result<PathBuf, FolderSelectorError> {
        let options = FolderSelectionOptions {
            title: format!("Select folder for {} access", app_name),
            default_path: Some(self.default_paths.documents_folder.clone()),
            create_if_missing: false, // Don't auto-create for security
            validate_permissions: true,
        };
        
        self.select_folder(options)
    }
    
    /// Get multiple folders for batch selection
    pub fn select_multiple_folders(&self, titles: Vec<String>) -> Result<Vec<PathBuf>, FolderSelectorError> {
        let mut selected_folders = Vec::new();
        
        for title in titles {
            let options = FolderSelectionOptions {
                title,
                default_path: Some(self.default_paths.documents_folder.clone()),
                create_if_missing: false,
                validate_permissions: true,
            };
            
            match self.select_folder(options) {
                Ok(path) => selected_folders.push(path),
                Err(FolderSelectorError::NoSelection) => {
                    // User cancelled, break the loop
                    break;
                }
                Err(e) => return Err(e),
            }
        }
        
        if selected_folders.is_empty() {
            Err(FolderSelectorError::NoSelection)
        } else {
            Ok(selected_folders)
        }
    }
    
    /// Validate if the folder is suitable for our use
    fn validate_folder_selection(&self, path: &PathBuf, options: &FolderSelectionOptions) -> Result<(), FolderSelectorError> {
        // Check if path exists (if required)
        if !options.create_if_missing && !path.exists() {
            return Err(FolderSelectorError::FolderNotExists(path.display().to_string()));
        }
        
        // Check permissions if validation is enabled
        if options.validate_permissions {
            self.check_folder_permissions(path)?;
        }
        
        // Security checks
        self.check_security_restrictions(path)?;
        
        Ok(())
    }
    
    /// Check if we have read/write permissions to the folder
    fn check_folder_permissions(&self, path: &PathBuf) -> Result<(), FolderSelectorError> {
        if path.exists() {
            // Test write permission by creating a temporary file
            let test_file = path.join(".pwa_marketplace_test");
            
            match std::fs::write(&test_file, "test") {
                Ok(_) => {
                    // Clean up test file
                    let _ = std::fs::remove_file(test_file);
                    Ok(())
                }
                Err(e) => Err(FolderSelectorError::PermissionDenied(format!(
                    "Cannot write to folder {}: {}", path.display(), e
                )))
            }
        } else {
            // Check if parent directory is writable
            if let Some(parent) = path.parent() {
                self.check_folder_permissions(&parent.to_path_buf())
            } else {
                Err(FolderSelectorError::InvalidPath)
            }
        }
    }
    
    /// Check for security restrictions on folder selection
    fn check_security_restrictions(&self, path: &PathBuf) -> Result<(), FolderSelectorError> {
        let path_str = path.to_string_lossy().to_lowercase();
        
        // Forbidden system directories
        let forbidden_paths = [
            "/system", "/sys", "/proc", "/dev",  // Linux
            "c:\\windows", "c:\\program files", "c:\\system",  // Windows
            "/system", "/library/system", "/usr/bin",  // macOS
        ];
        
        for forbidden in &forbidden_paths {
            if path_str.starts_with(&forbidden.to_lowercase()) {
                return Err(FolderSelectorError::PermissionDenied(
                    "Cannot select system directory for security reasons".to_string()
                ));
            }
        }
        
        // Warn about potentially sensitive directories
        let sensitive_paths = [
            ".ssh", "ssh", "credentials", "passwords", "keychain"
        ];
        
        for sensitive in &sensitive_paths {
            if path_str.contains(sensitive) {
                log::warn!("User selected potentially sensitive directory: {}", path.display());
                // Could show a warning dialog here in the future
            }
        }
        
        Ok(())
    }
    
    /// Create folder with parent directories
    fn create_folder_with_parents(&self, path: &PathBuf) -> Result<(), FolderSelectorError> {
        std::fs::create_dir_all(path)
            .map_err(|e| FolderSelectorError::Io(e))?;
            
        log::info!("Created folder: {}", path.display());
        Ok(())
    }
    
    /// Get platform-specific default paths
    fn get_default_paths() -> Result<FolderDefaults, FolderSelectorError> {
        let home_dir = dirs::home_dir()
            .ok_or(FolderSelectorError::InvalidPath)?;
            
        let documents_dir = dirs::document_dir()
            .unwrap_or_else(|| home_dir.join("Documents"));
            
        let downloads_dir = dirs::download_dir()
            .unwrap_or_else(|| home_dir.join("Downloads"));
        
        // Create PWA-specific default paths
        let apps_folder = documents_dir.join("PWA-Apps");
        let data_folder = documents_dir.join("PWA-Data");
        
        Ok(FolderDefaults {
            apps_folder,
            data_folder,
            documents_folder: documents_dir,
            downloads_folder: downloads_dir,
        })
    }
    
    /// Get default folder suggestions for the user
    pub fn get_suggested_folders(&self) -> Vec<(String, PathBuf)> {
        vec![
            ("Documents/PWA-Apps".to_string(), self.default_paths.apps_folder.clone()),
            ("Documents/PWA-Data".to_string(), self.default_paths.data_folder.clone()),
            ("Documents".to_string(), self.default_paths.documents_folder.clone()),
            ("Downloads".to_string(), self.default_paths.downloads_folder.clone()),
        ]
    }
    
    /// Check if a path is safe for app data storage
    pub fn is_safe_app_folder(&self, path: &PathBuf) -> bool {
        // Basic safety checks
        if !path.is_absolute() {
            return false;
        }
        
        // Check against forbidden paths
        if self.check_security_restrictions(path).is_err() {
            return false;
        }
        
        // Check if writable
        if self.check_folder_permissions(path).is_err() {
            return false;
        }
        
        true
    }
    
    /// Resolve relative paths to absolute
    pub fn resolve_path(&self, path: &str) -> Result<PathBuf, FolderSelectorError> {
        let path_buf = PathBuf::from(path);
        
        if path_buf.is_absolute() {
            return Ok(path_buf);
        }
        
        // Handle special path prefixes
        if path.starts_with("~/") {
            if let Some(home) = dirs::home_dir() {
                return Ok(home.join(&path[2..]));
            }
        }
        
        if path.starts_with("$DOCUMENTS/") {
            return Ok(self.default_paths.documents_folder.join(&path[11..]));
        }
        
        if path.starts_with("$DOWNLOADS/") {
            return Ok(self.default_paths.downloads_folder.join(&path[11..]));
        }
        
        // Default to documents directory for relative paths
        Ok(self.default_paths.documents_folder.join(path))
    }
    
    /// Get folder info for display
    pub fn get_folder_info(&self, path: &PathBuf) -> FolderInfo {
        let mut info = FolderInfo {
            path: path.clone(),
            exists: path.exists(),
            readable: false,
            writable: false,
            size_mb: 0,
            file_count: 0,
            error: None,
        };
        
        if info.exists {
            // Check permissions
            info.readable = path.read_dir().is_ok();
            info.writable = self.check_folder_permissions(path).is_ok();
            
            // Get folder size and file count (basic implementation)
            if let Ok(entries) = std::fs::read_dir(path) {
                let mut total_size = 0u64;
                let mut count = 0;
                
                for entry in entries {
                    if let Ok(entry) = entry {
                        count += 1;
                        if let Ok(metadata) = entry.metadata() {
                            total_size += metadata.len();
                        }
                    }
                }
                
                info.size_mb = (total_size / 1024 / 1024) as usize;
                info.file_count = count;
            }
        }
        
        info
    }
}

#[derive(Debug, Clone)]
pub struct FolderInfo {
    pub path: PathBuf,
    pub exists: bool,
    pub readable: bool,
    pub writable: bool,
    pub size_mb: usize,
    pub file_count: usize,
    pub error: Option<String>,
}

// Tauri commands for frontend integration
#[tauri::command]
pub async fn select_folder_dialog(
    title: Option<String>,
    default_path: Option<String>
) -> Result<String, String> {
    let selector = FolderSelector::new()
        .map_err(|e| e.to_string())?;
    
    let default_path_buf = if let Some(path_str) = default_path {
        Some(selector.resolve_path(&path_str).map_err(|e| e.to_string())?)
    } else {
        None
    };
    
    let options = FolderSelectionOptions {
        title: title.unwrap_or_else(|| "Select Folder".to_string()),
        default_path: default_path_buf,
        create_if_missing: true,
        validate_permissions: true,
    };
    
    let selected_path = selector.select_folder(options)
        .map_err(|e| e.to_string())?;
    
    Ok(selected_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn select_apps_folder_dialog() -> Result<String, String> {
    let selector = FolderSelector::new()
        .map_err(|e| e.to_string())?;
    
    let selected_path = selector.select_apps_folder()
        .map_err(|e| e.to_string())?;
    
    Ok(selected_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn select_data_folder_dialog() -> Result<String, String> {
    let selector = FolderSelector::new()
        .map_err(|e| e.to_string())?;
    
    let selected_path = selector.select_data_folder()
        .map_err(|e| e.to_string())?;
    
    Ok(selected_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_folder_suggestions() -> Result<Vec<(String, String)>, String> {
    let selector = FolderSelector::new()
        .map_err(|e| e.to_string())?;
    
    let suggestions = selector.get_suggested_folders()
        .into_iter()
        .map(|(name, path)| (name, path.to_string_lossy().to_string()))
        .collect();
    
    Ok(suggestions)
}

#[tauri::command]
pub async fn validate_folder_path(path: String) -> Result<FolderInfo, String> {
    let selector = FolderSelector::new()
        .map_err(|e| e.to_string())?;
    
    let path_buf = selector.resolve_path(&path)
        .map_err(|e| e.to_string())?;
    
    Ok(selector.get_folder_info(&path_buf))
}

#[tauri::command]
pub async fn create_folder_if_missing(path: String) -> Result<bool, String> {
    let selector = FolderSelector::new()
        .map_err(|e| e.to_string())?;
    
    let path_buf = selector.resolve_path(&path)
        .map_err(|e| e.to_string())?;
    
    if !path_buf.exists() {
        selector.create_folder_with_parents(&path_buf)
            .map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

// Integration tests
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    
    #[test]
    fn test_folder_selector_creation() {
        let selector = FolderSelector::new();
        assert!(selector.is_ok());
    }
    
    #[test]
    fn test_default_paths() {
        let defaults = FolderSelector::get_default_paths().unwrap();
        assert!(defaults.documents_folder.is_absolute());
        assert!(defaults.apps_folder.is_absolute());
        assert!(defaults.data_folder.is_absolute());
    }
    
    #[test]
    fn test_path_resolution() {
        let selector = FolderSelector::new().unwrap();
        
        // Test absolute path
        let abs_path = "/tmp/test";
        let resolved = selector.resolve_path(abs_path).unwrap();
        assert_eq!(resolved, PathBuf::from(abs_path));
        
        // Test relative path
        let rel_path = "test_folder";
        let resolved = selector.resolve_path(rel_path).unwrap();
        assert!(resolved.is_absolute());
    }
    
    #[test]
    fn test_security_restrictions() {
        let selector = FolderSelector::new().unwrap();
        
        // Test forbidden system paths
        let system_path = PathBuf::from("/system");
        assert!(selector.check_security_restrictions(&system_path).is_err());
        
        // Test safe user path
        let temp_dir = TempDir::new().unwrap();
        let safe_path = temp_dir.path().to_path_buf();
        assert!(selector.check_security_restrictions(&safe_path).is_ok());
    }
    
    #[test]
    fn test_folder_info() {
        let selector = FolderSelector::new().unwrap();
        let temp_dir = TempDir::new().unwrap();
        
        let info = selector.get_folder_info(&temp_dir.path().to_path_buf());
        assert!(info.exists);
        assert!(info.readable);
        assert!(info.writable);
    }
}