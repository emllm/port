# PWA Marketplace

**User-friendly PWA Marketplace with GitHub integration, built-in password manager, and secure sandboxing.**

---

## 🏁 Quick Start

### For End Users
1. **Download** the installer for your system from [GitHub Releases](https://github.com/your-org/pwa-marketplace/releases):
   - Windows: `PWA-Marketplace-Setup.exe`
   - macOS: `PWA-Marketplace-Setup.dmg`
   - Linux: `PWA-Marketplace-Setup.AppImage`
2. **Run the installer** (double-click, or `chmod +x` for Linux).
3. **Follow the 5-step setup wizard**.
4. **Done!** The app icon appears in your system tray, access the marketplace via your browser at [http://localhost:8080](http://localhost:8080).

### For Developers
1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-org/pwa-marketplace.git
   cd pwa-marketplace
   ```
2. **Start all services (Docker):**
   ```bash
   docker compose up --build -d
   ```
3. **Access the app:**
   - [http://localhost:8080](http://localhost:8080)
   - [https://localhost:8443](https://localhost:8443) (if SSL configured)

---

## 📚 Documentation Index
- [User-Friendly Deployment](user_friendly_deployment.md) – deployment strategies, user experience
- [Modular Architecture](modular_pwa_marketplace.md) – technical & modular overview
- [Project Plan](project_plan.md) – roadmap & progress

---

## 📝 Main Features
- Secure PWA management with GitHub integration
- Built-in password manager (AES-256 encrypted)
- Desktop app (Tauri/Electron/Wails) and Docker support
- Resource isolation, permission dialogs, audit logs
- Auto-updates, system tray integration

---

## 🛠️ For Developers
- **Frontend:** React + Vite + TypeScript
- **Backend:** Rust (Tauri), Node.js modules
- **Infrastructure:** Docker, Nginx, system bridge
- **Build scripts:** see `/scripts` and Makefile
- **Configuration:** see `/config` for security, permissions, sources

### Useful Commands
- Build frontend: `npm run build`
- Build backend (Rust): `cargo build --release`
- Build Docker images: `docker compose build`
- Run in development: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`

---

## 🚀 Getting Started (User Instructions)

### Windows
1. Download `PWA-Marketplace-Setup.exe`
2. Double-click to install
3. Follow the setup wizard
4. Start browsing PWA apps!

### macOS
1. Download `PWA-Marketplace-Setup.dmg`
2. Drag to Applications
3. Open and follow the wizard
4. Grant permissions

### Linux
1. Download `PWA-Marketplace-Setup.AppImage`
2. `chmod +x PWA-Marketplace-Setup.AppImage`
3. Double-click to run
4. Follow the setup wizard

**Result:** Anyone can install and use PWA Marketplace in under 5 minutes! 🎉

---

## 🐳 Docker Compose Services
- `nginx` (8080/8443): reverse proxy
- `mcp-bridge` (3000): system integration
- `resource-controller` (3001): permission management

---

## 🧩 Architecture Overview
- See [modular_pwa_marketplace.md](modular_pwa_marketplace.md) for full details
- Desktop wrapper (Tauri/Electron)
- Docker backend (MCP, password manager)
- Modular JS/Rust components

---

## ❓ FAQ & Troubleshooting

### Nothing loads at http://localhost:8080
- Make sure Docker is running and all containers are healthy (`docker compose ps`)
- Check logs: `docker compose logs`

### Desktop app won’t start
- Ensure you downloaded the correct installer for your OS
- On Linux, check executable permissions (`chmod +x`)

### Where is my data stored?
- All sensitive data is encrypted and stored locally. No data leaves your machine by default.

### I need more help!
- See [user_friendly_deployment.md](user_friendly_deployment.md) or open an issue on GitHub.

---

## 📎 Related Docs
- [user_friendly_deployment.md](user_friendly_deployment.md)
- [modular_pwa_marketplace.md](modular_pwa_marketplace.md)
- [project_plan.md](project_plan.md)

---

## 🏷️ License
MIT

## 📦 Architektura Deployment

### Stack Technologiczny
```
┌─────────────────────────────────────────────────────┐
│                 Desktop Wrapper                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   Tauri     │  │   Electron  │  │    Wails    │ │
│  │ (Rust+Web)  │  │(Node+Chrome)│  │  (Go+Web)   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────┐
│              Docker Backend (Hidden)                │
│  ┌─────────────────────────────────────────────────┐│
│  │  PWA Marketplace + MCP + Password Manager      ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### Rekomendacja: **Tauri** (Rust + Web)
**Zalety:**
- Najmniejszy rozmiar pliku (~10MB vs 120MB Electron)
- Najlepsza wydajność i bezpieczeństwo
- Natywny dostęp do systemu
- Crossplatform
- Wbudowany auto-updater

## 🛠️ Struktura Projektu Desktop App

```
pwa-marketplace-desktop/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                # Main Tauri app
│   │   ├── docker_manager.rs      # Docker integration
│   │   ├── password_manager.rs    # Local password storage
│   │   ├── github_auth.rs         # GitHub OAuth flow
│   │   ├── folder_selector.rs     # Native folder dialogs
│   │   ├── system_tray.rs         # System tray management
│   │   └── auto_updater.rs        # Auto-update functionality
│   ├── Cargo.toml                 # Rust dependencies
│   ├── tauri.conf.json           # Tauri configuration
│   ├── build.rs                   # Build script
│   └── icons/                     # App icons
├── src/                           # Frontend (React/Vue/Vanilla)
│   ├── setup-wizard/              # Setup wizard UI
│   ├── marketplace/               # Main marketplace UI
│   ├── password-manager/          # Password manager UI
│   └── settings/                  # Settings UI
├── docker/                        # Docker configuration
│   ├── Dockerfile.embedded        # Lightweight Docker image
│   ├── docker-compose.embedded.yml
│   └── init-scripts/              # Auto-setup scripts
├── installers/                    # Platform-specific installers
│   ├── windows/                   # Windows MSI/NSIS
│   ├── macos/                     # macOS DMG/PKG
│   └── linux/                     # AppImage/DEB/RPM
└── scripts/
    ├── build-all.sh              # Cross-platform build
    ├── package-installers.sh     # Create installers
    └── release.sh                # GitHub release automation
```

## 🔐 Wbudowany Password Manager

### Rust Implementation (src-tauri/src/password_manager.rs)
```rust
use serde::{Deserialize, Serialize};
use keyring::Entry;
use sqlcipher::Connection;
use aes_gcm::{Aes256Gcm, Key, Nonce};

#[derive(Serialize, Deserialize)]
pub struct PasswordEntry {
    pub id: String,
    pub title: String,
    pub username: String,
    pub encrypted_password: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct PasswordManager {
    db: Connection,
    master_key: Vec<u8>,
}

impl PasswordManager {
    pub fn new(master_password: &str) -> Result<Self, Box<dyn std::error::Error>> {
        // Generate encryption key from master password
        let master_key = Self::derive_key(master_password)?;
        
        // Open encrypted SQLite database
        let db = Connection::open_encrypted(
            Self::get_db_path()?,
            master_password
        )?;
        
        // Initialize database schema
        Self::init_schema(&db)?;
        
        Ok(PasswordManager { db, master_key })
    }
    
    pub fn store_password(&self, entry: &PasswordEntry) -> Result<(), Box<dyn std::error::Error>> {
        // Encrypt password before storing
        let encrypted_password = self.encrypt_data(&entry.encrypted_password)?;
        
        self.db.execute(
            "INSERT OR REPLACE INTO passwords (id, title, username, encrypted_password, url, notes, created_at, updated_at) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                entry.id,
                entry.title,
                entry.username,
                encrypted_password,
                entry.url,
                entry.notes,
                entry.created_at,
                entry.updated_at
            ],
        )?;
        
        Ok(())
    }
    
    pub fn get_password(&self, id: &str) -> Result<Option<PasswordEntry>, Box<dyn std::error::Error>> {
        let mut stmt = self.db.prepare(
            "SELECT id, title, username, encrypted_password, url, notes, created_at, updated_at 
             FROM passwords WHERE id = ?1"
        )?;
        
        let password_iter = stmt.query_map([id], |row| {
            let encrypted_password: String = row.get(3)?;
            let decrypted_password = self.decrypt_data(&encrypted_password)?;
            
            Ok(PasswordEntry {
                id: row.get(0)?,
                title: row.get(1)?,
                username: row.get(2)?,
                encrypted_password: decrypted_password,
                url: row.get(4)?,
                notes: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        
        for password in password_iter {
            return Ok(Some(password?));
        }
        
        Ok(None)
    }
    
    pub fn generate_github_token(&self, username: &str) -> Result<String, Box<dyn std::error::Error>> {
        // Implement GitHub OAuth flow for token generation
        let auth_url = format!(
            "https://github.com/login/oauth/authorize?client_id={}&scope=repo,user:email&state={}",
            self.get_github_client_id(),
            self.generate_state_token()
        );
        
        // Open browser and handle OAuth callback
        self.open_browser(&auth_url)?;
        
        // Wait for OAuth callback and extract token
        let token = self.handle_oauth_callback()?;
        
        // Store token securely
        self.store_password(&PasswordEntry {
            id: "github_token".to_string(),
            title: "GitHub API Token".to_string(),
            username: username.to_string(),
            encrypted_password: token.clone(),
            url: Some("https://github.com".to_string()),
            notes: Some("Auto-generated for PWA Marketplace".to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        })?;
        
        Ok(token)
    }
}
```

## 🚀 Automatyczna Instalacja Docker

### Docker Manager (src-tauri/src/docker_manager.rs)
```rust
use std::process::Command;
use std::path::PathBuf;

pub struct DockerManager {
    docker_path: Option<PathBuf>,
    embedded_mode: bool,
}

impl DockerManager {
    pub fn new() -> Self {
        let docker_path = Self::find_docker_installation();
        let embedded_mode = docker_path.is_none();
        
        DockerManager {
            docker_path,
            embedded_mode,
        }
    }
    
    pub async fn ensure_docker_available(&self) -> Result<(), Box<dyn std::error::Error>> {
        if self.embedded_mode {
            // Install Docker Desktop automatically
            self.install_docker_desktop().await?;
        } else {
            // Check if existing Docker is running
            self.check_docker_running()?;
        }
        
        Ok(())
    }
    
    async fn install_docker_desktop(&self) -> Result<(), Box<dyn std::error::Error>> {
        let os = std::env::consts::OS;
        
        match os {
            "windows" => {
                // Download and install Docker Desktop for Windows
                self.download_and_install_windows_docker().await?;
            },
            "macos" => {
                // Download and install Docker Desktop for macOS
                self.download_and_install_macos_docker().await?;
            },
            "linux" => {
                // Install Docker Engine on Linux
                self.install_linux_docker().await?;
            },
            _ => return Err("Unsupported operating system".into()),
        }
        
        // Wait for Docker to start
        self.wait_for_docker_ready().await?;
        
        Ok(())
    }
    
    pub async fn start_pwa_marketplace(&self) -> Result<(), Box<dyn std::error::Error>> {
        // Copy embedded Docker compose and configs
        self.extract_embedded_configs()?;
        
        // Start PWA Marketplace services
        let output = Command::new("docker-compose")
            .arg("-f")
            .arg(self.get_compose_file_path())
            .arg("up")
            .arg("-d")
            .output()?;
            
        if !output.status.success() {
            return Err(format!("Failed to start services: {}", 
                String::from_utf8_lossy(&output.stderr)).into());
        }
        
        // Wait for services to be ready
        self.wait_for_services_ready().await?;
        
        Ok(())
    }
}
```

## 📱 System Tray Integration

### System Tray Manager (src-tauri/src/system_tray.rs)
```rust
use tauri::{CustomMenuItem, SystemTray, SystemTrayMenu, SystemTrayEvent, AppHandle, Manager};

pub fn create_system_tray() -> SystemTray {
    let open = CustomMenuItem::new("open".to_string(), "Open PWA Marketplace");
    let password_manager = CustomMenuItem::new("passwords".to_string(), "Password Manager");
    let settings = CustomMenuItem::new("settings".to_string(), "Settings");
    let separator = CustomMenuItem::new("separator".to_string(), "").disabled();
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");
    
    let tray_menu = SystemTrayMenu::new()
        .add_item(open)
        .add_item(password_manager)
        .add_item(settings)
        .add_native_item(separator)
        .add_item(quit);
    
    SystemTray::new().with_menu(tray_menu)
}

pub fn handle_system_tray_event(app: &AppHandle, event: SystemTrayEvent) {
    match event {
        SystemTrayEvent::MenuItemClick { id, .. } => {
            match id.as_str() {
                "open" => {
                    // Open main marketplace window
                    open_marketplace_window(app);
                },
                "passwords" => {
                    // Open password manager
                    open_password_manager_window(app);
                },
                "settings" => {
                    // Open settings window
                    open_settings_window(app);
                },
                "quit" => {
                    // Gracefully shutdown Docker services
                    shutdown_services(app);
                    app.exit(0);
                },
                _ => {}
            }
        }
        SystemTrayEvent::DoubleClick { .. } => {
            // Double-click opens main marketplace
            open_marketplace_window(app);
        }
        _ => {}
    }
}

fn open_marketplace_window(app: &AppHandle) {
    // Open browser to localhost:3000
    let url = "http://localhost:3000";
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", url])
            .spawn()
            .expect("Failed to open browser");
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .expect("Failed to open browser");
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .expect("Failed to open browser");
    }
}
```

## 🎨 Proces Instalacji dla Użytkownika

### Krok 1: Download & Install
```
1. User idzie na: https://github.com/your-org/pwa-marketplace/releases
2. Wybiera: PWA-Marketplace-Setup.exe (Windows)
3. Double-click → Standardowy installer Windows
4. Next → Next → Install → Finish
5. Ikona pojawia się w system tray
```

### Krok 2: First Run Setup (automatyczny)
```
1. Tray icon pokazuje: "Setting up..."
2. App sprawdza czy Docker jest zainstalowany
   - Jeśli nie: automatycznie instaluje Docker Desktop
   - Jeśli tak: sprawdza czy działa
3. Uruchamia setup wizard w przeglądarce
4. User przechodzi przez 5 kroków (jak w UI)
5. System automatycznie:
   - Tworzy foldery
   - Szyfruje i zapisuje ustawienia
   - Uruchamia Docker services
   - Pokazuje "Ready!" notification
```

### Krok 3: Daily Usage
```
1. User klika tray icon → "Open PWA Marketplace"
2. Otwiera się przeglądarka na localhost:3000
3. User ma dostęp do:
   - GitHub PWA store
   - Password manager
   - Installed apps
   - Settings
```

## 🔧 Auto-Update System

### Auto-Updater (src-tauri/src/auto_updater.rs)
```rust
use tauri_update::Update;

pub struct AutoUpdater {
    current_version: String,
    update_endpoint: String,
}

impl AutoUpdater {
    pub fn new() -> Self {
        AutoUpdater {
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            update_endpoint: "https://api.github.com/repos/your-org/pwa-marketplace/releases/latest".to_string(),
        }
    }
    
    pub async fn check_for_updates(&self) -> Result<Option<UpdateInfo>, Box<dyn std::error::Error>> {
        let client = reqwest::Client::new();
        let response: serde_json::Value = client
            .get(&self.update_endpoint)
            .header("User-Agent", "PWA-Marketplace-Desktop")
            .send()
            .await?
            .json()
            .await?;
        
        let latest_version = response["tag_name"].as_str().unwrap_or("");
        
        if self.is_newer_version(latest_version) {
            Ok(Some(UpdateInfo {
                version: latest_version.to_string(),
                download_url: self.get_platform_download_url(&response)?,
                changelog: response["body"].as_str().unwrap_or("").to_string(),
            }))
        } else {
            Ok(None)
        }
    }
    
    pub async fn download_and_install_update(&self, update_info: &UpdateInfo) -> Result<(), Box<dyn std::error::Error>> {
        // Download update in background
        let update_file = self.download_update(&update_info.download_url).await?;
        
        // Show user notification
        self.show_update_notification(&update_info)?;
        
        // Install update (restart required)
        self.install_update(&update_file)?;
        
        Ok(())
    }
}
```

## 📋 Porównanie Opcji Deployment

| Opcja | Rozmiar | Instalacja | Maintenance | User Experience |
|-------|---------|------------|-------------|-----------------|
| **Tauri Desktop** | ~15MB | ✅ Double-click | ✅ Auto-update | ⭐⭐⭐⭐⭐ |
| **Electron Desktop** | ~120MB | ✅ Double-click | ✅ Auto-update | ⭐⭐⭐⭐ |
| **Docker Compose** | ~500MB | ❌ CLI commands | ❌ Manual | ⭐⭐ |
| **Web Installer** | ~50MB | ⭐ Web-based | ⭐ Semi-auto | ⭐⭐⭐ |

## 🎯 Rekomendowana Strategia

### **Opcja 1: Tauri Desktop App (Primary)**
- **Target**: 90% użytkowników nietechnicznych
- **Benefits**: Najmniejszy rozmiar, native feel, auto-updates
- **Installation**: Double-click installer
- **Maintenance**: Automatic background updates

### **Opcja 2: Web Installer (Fallback)**
- **Target**: Users without admin rights
- **Benefits**: No admin privileges required
- **Installation**: Web-based setup wizard
- **Maintenance**: Manual updates through web interface

### **Opcja 3: Portable Version**
- **Target**: Enterprise/restricted environments
- **Benefits**: No installation required
- **Installation**: Extract and run
- **Maintenance**: Manual updates

## 🔐 Security & Privacy Features

### Encrypted Local Storage
```
✅ Master password protects all data
✅ GitHub tokens encrypted with AES-256
✅ App data isolated per sandbox
✅ No data sent to external servers
✅ Local-only password manager
✅ Audit log of all file access
```

### Permission System
```
✅ Explicit folder access requests
✅ Per-app permission management
✅ Real-time permission dialogs
✅ Revokable permissions
✅ Sandbox isolation
✅ Network access control
```

## 🚀 Getting Started (User Instructions)

### Windows Users
1. Download `PWA-Marketplace-Setup.exe`
2. Double-click to install
3. Follow the 5-step setup wizard
4. Start browsing PWA apps!

### macOS Users
1. Download `PWA-Marketplace-Setup.dmg`
2. Drag to Applications folder
3. Open and follow setup wizard
4. Grant necessary permissions when prompted

### Linux Users
1. Download `PWA-Marketplace-Setup.AppImage`
2. Make executable: `chmod +x PWA-Marketplace-Setup.AppImage`
3. Double-click to run
4. Follow setup wizard

**Result**: Każdy użytkownik, niezależnie od wiedzy technicznej, może zainstalować i używać PWA Marketplace w ciągu 5 minut! 🎉