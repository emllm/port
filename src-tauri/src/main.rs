// src-tauri/src/main.rs
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{
    CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, 
    SystemTrayMenuItem, Window, WindowBuilder, WindowUrl, App
};
use std::sync::Mutex;
use tokio::sync::mpsc;

mod system_tray;
mod docker_manager;
mod password_manager;
mod github_auth;
mod folder_selector;
mod auto_updater;
mod logger;

use system_tray::{create_system_tray, handle_system_tray_event};
use docker_manager::DockerManager;
use password_manager::PasswordManager;

#[derive(Default)]
pub struct AppState {
    docker_manager: Mutex<Option<DockerManager>>,
    password_manager: Mutex<Option<PasswordManager>>,
    is_first_run: Mutex<bool>,
    marketplace_url: Mutex<String>,
}

// Tauri commands (callable from frontend)
#[tauri::command]
async fn is_first_run(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let first_run = state.is_first_run.lock().unwrap();
    Ok(*first_run)
}

#[tauri::command]
async fn complete_setup(
    master_password: String,
    apps_folder: String,
    data_folder: String,
    github_token: Option<String>,
    state: tauri::State<'_, AppState>
) -> Result<(), String> {
    // Initialize password manager with master password
    let password_manager = PasswordManager::new(&master_password)
        .map_err(|e| format!("Failed to initialize password manager: {}", e))?;
    
    // Store GitHub token if provided
    if let Some(token) = github_token {
        password_manager.store_github_token(&token)
            .map_err(|e| format!("Failed to store GitHub token: {}", e))?;
    }
    
    // Initialize Docker manager
    let docker_manager = DockerManager::new(&apps_folder, &data_folder);
    
    // Start marketplace services
    docker_manager.start_marketplace_services().await
        .map_err(|e| format!("Failed to start services: {}", e))?;
    
    // Update app state
    *state.docker_manager.lock().unwrap() = Some(docker_manager);
    *state.password_manager.lock().unwrap() = Some(password_manager);
    *state.is_first_run.lock().unwrap() = false;
    *state.marketplace_url.lock().unwrap() = "http://localhost:3000".to_string();
    
    Ok(())
}

#[tauri::command]
async fn open_marketplace(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let url = state.marketplace_url.lock().unwrap().clone();
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", &url])
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
async fn select_folder() -> Result<Option<String>, String> {
    folder_selector::select_folder()
        .map_err(|e| format!("Failed to select folder: {}", e))
}

#[tauri::command]
async fn generate_github_token(
    username: String,
    state: tauri::State<'_, AppState>
) -> Result<String, String> {
    let password_manager_guard = state.password_manager.lock().unwrap();
    
    if let Some(password_manager) = password_manager_guard.as_ref() {
        github_auth::generate_token(&username, password_manager).await
            .map_err(|e| format!("Failed to generate GitHub token: {}", e))
    } else {
        Err("Password manager not initialized".to_string())
    }
}

#[tauri::command]
async fn get_marketplace_status(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let docker_manager_guard = state.docker_manager.lock().unwrap();
    
    if let Some(docker_manager) = docker_manager_guard.as_ref() {
        match docker_manager.get_services_status().await {
            Ok(status) => Ok(status),
            Err(e) => Ok(format!("Error: {}", e))
        }
    } else {
        Ok("Not initialized".to_string())
    }
}

#[tauri::command]
async fn shutdown_services(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let docker_manager_guard = state.docker_manager.lock().unwrap();
    
    if let Some(docker_manager) = docker_manager_guard.as_ref() {
        docker_manager.shutdown_services().await
            .map_err(|e| format!("Failed to shutdown services: {}", e))?;
    }
    
    Ok(())
}

fn create_setup_window(app: &App) -> tauri::Result<Window> {
    WindowBuilder::new(
        app,
        "setup",
        WindowUrl::App("setup.html".into())
    )
    .title("PWA Marketplace Setup")
    .inner_size(800.0, 600.0)
    .center()
    .resizable(false)
    .maximizable(false)
    .build()
}

fn create_main_window(app: &App) -> tauri::Result<Window> {
    WindowBuilder::new(
        app,
        "main",
        WindowUrl::App("index.html".into())
    )
    .title("PWA Marketplace")
    .inner_size(1200.0, 800.0)
    .center()
    .build()
}

#[tokio::main]
async fn main() {
    // Initialize logger
    logger::init().expect("Failed to initialize logger");
    
    let app_state = AppState {
        is_first_run: Mutex::new(true), // Will be determined during startup
        ..Default::default()
    };
    
    tauri::Builder::default()
        .manage(app_state)
        .system_tray(create_system_tray())
        .on_system_tray_event(handle_system_tray_event)
        .setup(|app| {
            // Check if this is first run
            let is_first_run = check_first_run();
            
            if is_first_run {
                // Show setup wizard
                create_setup_window(app)?;
            } else {
                // Initialize existing configuration
                initialize_existing_config(app);
            }
            
            // Start background services
            start_background_services(app.handle());
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            is_first_run,
            complete_setup,
            open_marketplace,
            select_folder,
            generate_github_token,
            get_marketplace_status,
            shutdown_services
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn check_first_run() -> bool {
    // Check if config file exists
    let config_path = get_config_path();
    !config_path.exists()
}

fn get_config_path() -> std::path::PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    path.push("PWA-Marketplace");
    path.push("config.json");
    path
}

fn initialize_existing_config(app: &App) {
    // Load existing configuration
    if let Ok(config) = load_existing_config() {
        // Initialize services with existing config
        tokio::spawn(async move {
            // Initialize Docker manager
            // Initialize password manager
            // Start services
        });
    }
}

fn load_existing_config() -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let config_path = get_config_path();
    let config_content = std::fs::read_to_string(config_path)?;
    let config: serde_json::Value = serde_json::from_str(&config_content)?;
    Ok(config)
}

fn start_background_services(app_handle: tauri::AppHandle) {
    tokio::spawn(async move {
        // Auto-updater check
        if let Err(e) = auto_updater::check_for_updates(&app_handle).await {
            log::error!("Auto-updater error: {}", e);
        }
        
        // Health monitoring
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            
            // Check Docker services health
            // Check marketplace availability
            // Update system tray status
        }
    });
}