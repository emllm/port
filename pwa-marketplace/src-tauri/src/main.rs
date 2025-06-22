use tauri::{
    CustomMenuItem,
    Menu,
    MenuItem,
    Submenu,
    SystemTray,
    SystemTrayEvent,
    SystemTrayMenu,
    SystemTrayMenuItem,
    WindowBuilder,
    WindowUrl,
};

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

    tauri::Builder::default()
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
        .invoke_handler(tauri::generate_handler![init_system_tray, get_app_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
