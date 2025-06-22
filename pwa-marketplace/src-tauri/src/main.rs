use tauri::generate_context;
use tauri::generate_handler;
use tauri::CustomMenuItem;
use tauri::Menu;
use tauri::MenuItem;
use tauri::Submenu;
use tauri::SystemTray;
use tauri::SystemTrayEvent;
use tauri::SystemTrayMenu;
use tauri::SystemTrayMenuItem;
use tauri::WindowBuilder;
use tauri::WindowUrl;

mod mcp_bridge;
mod password_manager;
mod github_integration;

#[tauri::command]
fn init_system_tray() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn main() {
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");
    let hide = CustomMenuItem::new("hide".to_string(), "Hide");
    let tray_menu = SystemTrayMenu::new()
        .add_item(hide)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);

    let tray = SystemTray::new().with_menu(tray_menu);

    // Initialize components
    let mcp_bridge = mcp_bridge::init().expect("Failed to initialize MCP bridge");
    let password_manager = password_manager::init("./passwords.json".to_string())
        .expect("Failed to initialize password manager");
    let github_integration = github_integration::init("./github.json".to_string())
        .expect("Failed to initialize GitHub integration");

    tauri::Builder::default()
        .manage(mcp_bridge)
        .manage(password_manager)
        .manage(github_integration)
        .setup(|app| {
            let window = WindowBuilder::new(app, "main", WindowUrl::App("index.html".into()))
                .title("PWA Marketplace")
                .inner_size(1024.0, 768.0)
                .build()?
                .with_title("PWA Marketplace");

            Ok(())
        })
        .system_tray(tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                let window = app.get_window("main").unwrap();
                window.show().unwrap();
                window.set_focus().unwrap();
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "quit" => {
                    std::process::exit(0);
                }
                "hide" => {
                    let window = app.get_window("main").unwrap();
                    window.hide().unwrap();
                }
                _ => {}
            },
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            init_system_tray,
            get_app_version,
            mcp_bridge::mcp_connect,
            mcp_bridge::mcp_send,
            mcp_bridge::mcp_disconnect,
            password_manager::password_add,
            password_manager::password_get,
            password_manager::password_update,
            password_manager::password_delete,
            github_integration::github_search_repositories,
            github_integration::github_get_repository,
            github_integration::github_get_repository_releases,
            github_integration::github_set_token,
            github_integration::github_get_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
