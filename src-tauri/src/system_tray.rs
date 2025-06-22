// src-tauri/src/system_tray.rs
use tauri::{
    AppHandle, CustomMenuItem, Manager, SystemTray, SystemTrayEvent, 
    SystemTrayMenu, SystemTrayMenuItem, Window
};
use crate::AppState;

pub fn create_system_tray() -> SystemTray {
    let open_marketplace = CustomMenuItem::new("open_marketplace".to_string(), "Open PWA Marketplace")
        .accelerator("Cmd+M");
    
    let password_manager = CustomMenuItem::new("password_manager".to_string(), "Password Manager")
        .accelerator("Cmd+P");
    
    let settings = CustomMenuItem::new("settings".to_string(), "Settings");
    
    let status = CustomMenuItem::new("status".to_string(), "Status: Initializing...")
        .disabled();
    
    let separator1 = SystemTrayMenuItem::Separator;
    let separator2 = SystemTrayMenuItem::Separator;
    
    let about = CustomMenuItem::new("about".to_string(), "About PWA Marketplace");
    
    let check_updates = CustomMenuItem::new("check_updates".to_string(), "Check for Updates");
    
    let quit = CustomMenuItem::new("quit".to_string(), "Quit")
        .accelerator("Cmd+Q");
    
    let tray_menu = SystemTrayMenu::new()
        .add_item(status)
        .add_native_item(separator1)
        .add_item(open_marketplace)
        .add_item(password_manager)
        .add_item(settings)
        .add_native_item(separator2)
        .add_item(about)
        .add_item(check_updates)
        .add_item(quit);
    
    SystemTray::new().with_menu(tray_menu)
}

pub fn handle_system_tray_event(app: &AppHandle, event: SystemTrayEvent) {
    match event {
        SystemTrayEvent::LeftClick {
            position: _,
            size: _,
            ..
        } => {
            // Left click opens marketplace
            open_marketplace_window(app);
        }
        
        SystemTrayEvent::RightClick {
            position: _,
            size: _,
            ..
        } => {
            // Right click shows context menu (automatic)
        }
        
        SystemTrayEvent::DoubleClick {
            position: _,
            size: _,
            ..
        } => {
            // Double click opens marketplace
            open_marketplace_window(app);
        }
        
        SystemTrayEvent::MenuItemClick { id, .. } => {
            handle_menu_item_click(app, &id);
        }
        
        _ => {}
    }
}

fn handle_menu_item_click(app: &AppHandle, id: &str) {
    match id {
        "open_marketplace" => {
            open_marketplace_window(app);
        }
        
        "password_manager" => {
            open_password_manager_window(app);
        }
        
        "settings" => {
            open_settings_window(app);
        }
        
        "about" => {
            show_about_dialog(app);
        }
        
        "check_updates" => {
            check_for_updates(app);
        }
        
        "quit" => {
            quit_application(app);
        }
        
        _ => {}
    }
}

fn open_marketplace_window(app: &AppHandle) {
    // Check if marketplace is ready
    let state = app.state::<AppState>();
    let marketplace_url = state.marketplace_url.lock().unwrap().clone();
    
    if marketplace_url.is_empty() {
        // Marketplace not ready, show status window
        show_notification(app, "PWA Marketplace is starting up...", "Please wait");
        return;
    }
    
    // Open in default browser
    if let Err(e) = open_url_in_browser(&marketplace_url) {
        log::error!("Failed to open marketplace: {}", e);
        show_notification(app, "Error", &format!("Failed to open marketplace: {}", e));
    }
}

fn open_password_manager_window(app: &AppHandle) {
    let window_label = "password_manager";
    
    // Check if window already exists
    if let Some(window) = app.get_window(window_label) {
        if let Err(e) = window.set_focus() {
            log::error!("Failed to focus password manager window: {}", e);
        }
        return;
    }
    
    // Create new password manager window
    match tauri::WindowBuilder::new(
        app,
        window_label,
        tauri::WindowUrl::App("password-manager.html".into())
    )
    .title("Password Manager")
    .inner_size(900.0, 700.0)
    .center()
    .resizable(true)
    .minimizable(true)
    .maximizable(true)
    .build()
    {
        Ok(window) => {
            if let Err(e) = window.set_focus() {
                log::error!("Failed to focus new password manager window: {}", e);
            }
        }
        Err(e) => {
            log::error!("Failed to create password manager window: {}", e);
            show_notification(app, "Error", &format!("Failed to open password manager: {}", e));
        }
    }
}

fn open_settings_window(app: &AppHandle) {
    let window_label = "settings";
    
    // Check if window already exists
    if let Some(window) = app.get_window(window_label) {
        if let Err(e) = window.set_focus() {
            log::error!("Failed to focus settings window: {}", e);
        }
        return;
    }
    
    // Create new settings window
    match tauri::WindowBuilder::new(
        app,
        window_label,
        tauri::WindowUrl::App("settings.html".into())
    )
    .title("Settings")
    .inner_size(700.0, 500.0)
    .center()
    .resizable(false)
    .minimizable(true)
    .maximizable(false)
    .build()
    {
        Ok(window) => {
            if let Err(e) = window.set_focus() {
                log::error!("Failed to focus new settings window: {}", e);
            }
        }
        Err(e) => {
            log::error!("Failed to create settings window: {}", e);
            show_notification(app, "Error", &format!("Failed to open settings: {}", e));
        }
    }
}

fn show_about_dialog(app: &AppHandle) {
    let version = app.package_info().version.to