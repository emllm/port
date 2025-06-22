// src-tauri/src/docker_manager.rs
use bollard::{Docker, API_DEFAULT_VERSION};
use bollard::container::{
    Config, CreateContainerOptions, StartContainerOptions, 
    StopContainerOptions, RemoveContainerOptions, ListContainersOptions
};
use bollard::image::{CreateImageOptions, ListImagesOptions};
use bollard::service::{ContainerSummary, HostConfig, PortBinding};
use bollard::network::{CreateNetworkOptions, ListNetworksOptions};
use futures::stream::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use thiserror::Error;
use tokio::time::{sleep, Duration};

#[derive(Error, Debug)]
pub enum DockerError {
    #[error("Docker daemon not running")]
    DaemonNotRunning,
    #[error("Docker not installed")]
    NotInstalled,
    #[error("Docker API error: {0}")]
    Api(#[from] bollard::errors::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Container not found: {0}")]
    ContainerNotFound(String),
    #[error("Network error: {0}")]
    Network(String),
    #[error("Configuration error: {0}")]
    Config(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub name: String,
    pub status: String,
    pub health: String,
    pub ports: Vec<String>,
    pub uptime: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerInfo {
    pub version: String,
    pub api_version: String,
    pub containers_running: usize,
    pub containers_total: usize,
    pub images_total: usize,
    pub memory_total: u64,
}

pub struct DockerManager {
    docker: Docker,
    apps_folder: PathBuf,
    data_folder: PathBuf,
    network_name: String,
}

impl DockerManager {
    pub fn new(apps_folder: &str, data_folder: &str) -> Self {
        let docker = Docker::connect_with_local_defaults()
            .unwrap_or_else(|_| Docker::connect_with_http_defaults().unwrap());
        
        DockerManager {
            docker,
            apps_folder: PathBuf::from(apps_folder),
            data_folder: PathBuf::from(data_folder),
            network_name: "pwa-marketplace".to_string(),
        }
    }
    
    pub async fn check_docker_available(&self) -> Result<bool, DockerError> {
        match self.docker.ping().await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }
    
    pub async fn install_docker_if_needed(&self) -> Result<(), DockerError> {
        if self.check_docker_available().await? {
            return Ok(());
        }
        
        #[cfg(target_os = "windows")]
        {
            self.install_docker_desktop_windows().await?;
        }
        
        #[cfg(target_os = "macos")]
        {
            self.install_docker_desktop_macos().await?;
        }
        
        #[cfg(target_os = "linux")]
        {
            self.install_docker_engine_linux().await?;
        }
        
        // Wait for Docker to start
        self.wait_for_docker_ready().await?;
        
        Ok(())
    }
    
    pub async fn start_marketplace_services(&self) -> Result<(), DockerError> {
        // Ensure Docker is available
        self.install_docker_if_needed().await?;
        
        // Create network if it doesn't exist
        self.ensure_network_exists().await?;
        
        // Pull required images
        self.pull_marketplace_images().await?;
        
        // Start core services
        self.start_marketplace_container().await?;
        self.start_mcp_bridge_container().await?;
        self.start_resource_controller_container().await?;
        
        // Wait for services to be ready
        self.wait_for_services_ready().await?;
        
        Ok(())
    }
    
    pub async fn stop_marketplace_services(&self) -> Result<(), DockerError> {
        let containers = ["pwa-marketplace", "mcp-bridge", "resource-controller"];
        
        for container_name in &containers {
            if let Err(e) = self.stop_container(container_name).await {
                log::warn!("Failed to stop container {}: {}", container_name, e);
            }
        }
        
        Ok(())
    }
    
    pub async fn get_services_status(&self) -> Result<Vec<ServiceStatus>, DockerError> {
        let mut statuses = Vec::new();
        let containers = ["pwa-marketplace", "mcp-bridge", "resource-controller"];
        
        for container_name in &containers {
            let status = self.get_container_status(container_name).await?;
            statuses.push(status);
        }
        
        Ok(statuses)
    }
    
    pub async fn get_docker_info(&self) -> Result<DockerInfo, DockerError> {
        let info = self.docker.info().await?;
        let version = self.docker.version().await?;
        
        Ok(DockerInfo {
            version: version.version.unwrap_or_default(),
            api_version: version.api_version.unwrap_or_default(),
            containers_running: info.containers_running.unwrap_or(0) as usize,
            containers_total: info.containers.unwrap_or(0) as usize,
            images_total: info.images.unwrap_or(0) as usize,
            memory_total: info.mem_total.unwrap_or(0),
        })
    }
    
    pub async fn shutdown_services(&self) -> Result<(), DockerError> {
        self.stop_marketplace_services().await?;
        
        // Remove containers
        let containers = ["pwa-marketplace", "mcp-bridge", "resource-controller"];
        for container_name in &containers {
            if let Err(e) = self.remove_container(container_name).await {
                log::warn!("Failed to remove container {}: {}", container_name, e);
            }
        }
        
        Ok(())
    }
    
    // Private implementation methods
    
    async fn ensure_network_exists(&self) -> Result<(), DockerError> {
        let networks = self.docker.list_networks(None::<ListNetworksOptions<String>>).await?;
        
        let network_exists = networks.iter()
            .any(|network| network.name.as_ref() == Some(&self.network_name));
        
        if !network_exists {
            let options = CreateNetworkOptions {
                name: self.network_name.clone(),
                driver: "bridge".to_string(),
                ..Default::default()
            };
            
            self.docker.create_network(options).await?;
            log::info!("Created Docker network: {}", self.network_name);
        }
        
        Ok(())
    }
    
    async fn pull_marketplace_images(&self) -> Result<(), DockerError> {
        let images = [
            "pwa-marketplace:latest",
            "mcp-bridge:latest", 
            "resource-controller:latest"
        ];
        
        for image in &images {
            log::info!("Pulling Docker image: {}", image);
            
            let options = Some(CreateImageOptions {
                from_image: image.to_string(),
                ..Default::default()
            });
            
            let mut stream = self.docker.create_image(options, None, None);
            
            while let Some(result) = stream.next().await {
                match result {
                    Ok(info) => {
                        if let Some(status) = info.status {
                            log::debug!("Pull progress: {}", status);
                        }
                    }
                    Err(e) => {
                        log::error!("Failed to pull image {}: {}", image, e);
                        return Err(DockerError::Api(e));
                    }
                }
            }
        }
        
        Ok(())
    }
    
    async fn start_marketplace_container(&self) -> Result<(), DockerError> {
        let container_name = "pwa-marketplace";
        
        // Stop and remove existing container if it exists
        let _ = self.stop_container(container_name).await;
        let _ = self.remove_container(container_name).await;
        
        let mut port_bindings = HashMap::new();
        port_bindings.insert(
            "3000/tcp".to_string(),
            Some(vec![PortBinding {
                host_ip: Some("127.0.0.1".to_string()),
                host_port: Some("3000".to_string()),
            }]),
        );
        
        let host_config = HostConfig {
            port_bindings: Some(port_bindings),
            network_mode: Some(self.network_name.clone()),
            binds: Some(vec![
                format!("{}:/app/storage/apps", self.apps_folder.display()),
                format!("{}:/app/storage/data", self.data_folder.display()),
            ]),
            ..Default::default()
        };
        
        let config = Config {
            image: Some("pwa-marketplace:latest"),
            env: Some(vec![
                "NODE_ENV=production",
                "MCP_BRIDGE_URL=http://mcp-bridge:3001",
                "RESOURCE_CONTROLLER_URL=http://resource-controller:3002",
            ]),
            host_config: Some(host_config),
            ..Default::default()
        };
        
        let options = CreateContainerOptions {
            name: container_name,
            platform: None,
        };
        
        self.docker.create_container(Some(options), config).await?;
        
        let options = StartContainerOptions { detach_keys: None };
        self.docker.start_container(container_name, Some(options)).await?;
        
        log::info!("Started PWA Marketplace container");
        Ok(())
    }
    
    async fn start_mcp_bridge_container(&self) -> Result<(), DockerError> {
        let container_name = "mcp-bridge";
        
        // Stop and remove existing container if it exists
        let _ = self.stop_container(container_name).await;
        let _ = self.remove_container(container_name).await;
        
        let host_config = HostConfig {
            network_mode: Some(self.network_name.clone()),
            binds: Some(vec![
                format!("{}:/app/storage/data", self.data_folder.display()),
            ]),
            ..Default::default()
        };
        
        let config = Config {
            image: Some("mcp-bridge:latest"),
            env: Some(vec![
                "NODE_ENV=production",
                "MCP_PORT=3001",
                "STORAGE_PATH=/app/storage/data",
            ]),
            host_config: Some(host_config),
            ..Default::default()
        };
        
        let options = CreateContainerOptions {
            name: container_name,
            platform: None,
        };
        
        self.docker.create_container(Some(options), config).await?;
        
        let options = StartContainerOptions { detach_keys: None };
        self.docker.start_container(container_name, Some(options)).await?;
        
        log::info!("Started MCP Bridge container");
        Ok(())
    }
    
    async fn start_resource_controller_container(&self) -> Result<(), DockerError> {
        let container_name = "resource-controller";
        
        // Stop and remove existing container if it exists
        let _ = self.stop_container(container_name).await;
        let _ = self.remove_container(container_name).await;
        
        let host_config = HostConfig {
            network_mode: Some(self.network_name.clone()),
            binds: Some(vec![
                format!("{}:/app/storage/apps", self.apps_folder.display()),
                format!("{}:/app/storage/data", self.data_folder.display()),
                "/tmp:/host/tmp".to_string(), // For temporary file operations
            ]),
            ..Default::default()
        };
        
        let config = Config {
            image: Some("resource-controller:latest"),
            env: Some(vec![
                "NODE_ENV=production",
                "CONTROLLER_PORT=3002",
                "APPS_PATH=/app/storage/apps",
                "DATA_PATH=/app/storage/data",
            ]),
            host_config: Some(host_config),
            ..Default::default()
        };
        
        let options = CreateContainerOptions {
            name: container_name,
            platform: None,
        };
        
        self.docker.create_container(Some(options), config).await?;
        
        let options = StartContainerOptions { detach_keys: None };
        self.docker.start_container(container_name, Some(options)).await?;
        
        log::info!("Started Resource Controller container");
        Ok(())
    }
    
    async fn stop_container(&self, name: &str) -> Result<(), DockerError> {
        let options = StopContainerOptions { t: 10 };
        self.docker.stop_container(name, Some(options)).await?;
        Ok(())
    }
    
    async fn remove_container(&self, name: &str) -> Result<(), DockerError> {
        let options = RemoveContainerOptions {
            force: true,
            ..Default::default()
        };
        self.docker.remove_container(name, Some(options)).await?;
        Ok(())
    }
    
    async fn get_container_status(&self, name: &str) -> Result<ServiceStatus, DockerError> {
        let options = ListContainersOptions::<String> {
            all: true,
            filters: {
                let mut filters = HashMap::new();
                filters.insert("name".to_string(), vec![name.to_string()]);
                filters
            },
            ..Default::default()
        };
        
        let containers = self.docker.list_containers(Some(options)).await?;
        
        if let Some(container) = containers.first() {
            let status = container.status.as_deref().unwrap_or("unknown");
            let health = self.determine_health_status(container).await;
            let ports = container.ports.as_ref()
                .map(|ports| {
                    ports.iter()
                        .filter_map(|port| {
                            port.public_port.map(|p| format!("{}:{}", 
                                port.ip.as_deref().unwrap_or("0.0.0.0"), p))
                        })
                        .collect()
                })
                .unwrap_or_default();
            
            Ok(ServiceStatus {
                name: name.to_string(),
                status: status.to_string(),
                health,
                ports,
                uptime: container.status.clone(),
            })
        } else {
            Err(DockerError::ContainerNotFound(name.to_string()))
        }
    }
    
    async fn determine_health_status(&self, container: &ContainerSummary) -> String {
        // Check if container is running
        if let Some(state) = &container.state {
            if state != "running" {
                return "unhealthy".to_string();
            }
        }
        
        // Additional health checks could be implemented here
        // For now, assume running = healthy
        "healthy".to_string()
    }
    
    async fn wait_for_services_ready(&self) -> Result<(), DockerError> {
        let services = ["pwa-marketplace", "mcp-bridge", "resource-controller"];
        let max_attempts = 30; // 30 seconds timeout
        
        for service in &services {
            log::info!("Waiting for {} to be ready...", service);
            
            for attempt in 1..=max_attempts {
                match self.get_container_status(service).await {
                    Ok(status) if status.status.contains("running") => {
                        log::info!("{} is ready", service);
                        break;
                    }
                    Ok(_) => {
                        if attempt == max_attempts {
                            return Err(DockerError::Config(
                                format!("Service {} failed to start within timeout", service)
                            ));
                        }
                        sleep(Duration::from_secs(1)).await;
                    }
                    Err(e) => {
                        if attempt == max_attempts {
                            return Err(e);
                        }
                        sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        }
        
        // Additional readiness check - try to connect to marketplace
        self.wait_for_marketplace_endpoint().await?;
        
        Ok(())
    }
    
    async fn wait_for_marketplace_endpoint(&self) -> Result<(), DockerError> {
        let client = reqwest::Client::new();
        let url = "http://localhost:3000/health";
        let max_attempts = 20;
        
        for attempt in 1..=max_attempts {
            match client.get(url).send().await {
                Ok(response) if response.status().is_success() => {
                    log::info!("Marketplace endpoint is ready");
                    return Ok(());
                }
                _ => {
                    if attempt == max_attempts {
                        return Err(DockerError::Network(
                            "Marketplace endpoint not responding".to_string()
                        ));
                    }
                    sleep(Duration::from_secs(1)).await;
                }
            }
        }
        
        Ok(())
    }
    
    async fn wait_for_docker_ready(&self) -> Result<(), DockerError> {
        let max_attempts = 60; // 1 minute timeout
        
        for attempt in 1..=max_attempts {
            if self.check_docker_available().await? {
                log::info!("Docker is ready");
                return Ok(());
            }
            
            if attempt == max_attempts {
                return Err(DockerError::DaemonNotRunning);
            }
            
            sleep(Duration::from_secs(1)).await;
        }
        
        Ok(())
    }
    
    #[cfg(target_os = "windows")]
    async fn install_docker_desktop_windows(&self) -> Result<(), DockerError> {
        log::info!("Installing Docker Desktop for Windows...");
        
        // Download Docker Desktop installer
        let url = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe";
        let installer_path = std::env::temp_dir().join("DockerDesktopInstaller.exe");
        
        self.download_file(url, &installer_path).await?;
        
        // Run installer
        let output = std::process::Command::new(&installer_path)
            .args(&["install", "--quiet"])
            .output()?;
        
        if !output.status.success() {
            return Err(DockerError::Config(
                "Failed to install Docker Desktop".to_string()
            ));
        }
        
        log::info!("Docker Desktop installation completed");
        Ok(())
    }
    
    #[cfg(target_os = "macos")]
    async fn install_docker_desktop_macos(&self) -> Result<(), DockerError> {
        log::info!("Installing Docker Desktop for macOS...");
        
        // Check if Homebrew is available
        if std::process::Command::new("brew").arg("--version").output().is_ok() {
            // Install via Homebrew
            let output = std::process::Command::new("brew")
                .args(&["install", "--cask", "docker"])
                .output()?;
                
            if !output.status.success() {
                return Err(DockerError::Config(
                    "Failed to install Docker via Homebrew".to_string()
                ));
            }
        } else {
            // Download and install manually
            let url = "https://desktop.docker.com/mac/main/amd64/Docker.dmg";
            let dmg_path = std::env::temp_dir().join("Docker.dmg");
            
            self.download_file(url, &dmg_path).await?;
            
            // Mount DMG and install
            std::process::Command::new("hdiutil")
                .args(&["attach", dmg_path.to_str().unwrap()])
                .output()?;
                
            std::process::Command::new("cp")
                .args(&["-R", "/Volumes/Docker/Docker.app", "/Applications/"])
                .output()?;
                
            std::process::Command::new("hdiutil")
                .args(&["detach", "/Volumes/Docker"])
                .output()?;
        }
        
        log::info!("Docker Desktop installation completed");
        Ok(())
    }
    
    #[cfg(target_os = "linux")]
    async fn install_docker_engine_linux(&self) -> Result<(), DockerError> {
        log::info!("Installing Docker Engine for Linux...");
        
        // Install via package manager
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg("curl -fsSL https://get.docker.com | sh")
            .output()?;
            
        if !output.status.success() {
            return Err(DockerError::Config(
                "Failed to install Docker Engine".to_string()
            ));
        }
        
        // Start Docker service
        std::process::Command::new("sudo")
            .args(&["systemctl", "start", "docker"])
            .output()?;
            
        // Enable Docker service
        std::process::Command::new("sudo")
            .args(&["systemctl", "enable", "docker"])
            .output()?;
        
        log::info!("Docker Engine installation completed");
        Ok(())
    }
    
    async fn download_file(&self, url: &str, path: &std::path::Path) -> Result<(), DockerError> {
        let client = reqwest::Client::new();
        let response = client.get(url).send().await
            .map_err(|e| DockerError::Network(e.to_string()))?;
            
        let bytes = response.bytes().await
            .map_err(|e| DockerError::Network(e.to_string()))?;
            
        std::fs::write(path, bytes)?;
        
        Ok(())
    }
}