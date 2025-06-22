use std::sync::Mutex;
use std::sync::Arc;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use serde_json;
use tauri::State;
use reqwest;
use oauth2;
use url::Url;

pub struct GitHubIntegration {
    client: reqwest::Client,
    token: Mutex<Option<String>>,
    config: Mutex<HashMap<String, String>>,
    path: String,
}

impl GitHubIntegration {
    pub fn new(path: String) -> Result<Arc<Self>, String> {
        let client = reqwest::Client::new();
        let config = if Path::new(&path).exists() {
            let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            serde_json::from_str(&data).map_err(|e| e.to_string())?
        } else {
            HashMap::new()
        };

        Ok(Arc::new(GitHubIntegration {
            client,
            token: Mutex::new(None),
            config: Mutex::new(config),
            path,
        }))
    }

    fn save_config(&self) -> Result<(), String> {
        let config = self.config.lock().unwrap();
        let json = serde_json::to_string(&*config).map_err(|e| e.to_string())?;
        fs::write(&self.path, json).map_err(|e| e.to_string())
    }

    pub fn set_token(&self, token: String) -> Result<(), String> {
        let mut token_lock = self.token.lock().unwrap();
        *token_lock = Some(token);
        self.save_config()
    }

    pub fn get_token(&self) -> Result<Option<String>, String> {
        Ok(self.token.lock().unwrap().clone())
    }

    async fn request(&self, url: &str) -> Result<reqwest::Response, String> {
        let token = self.token.lock().unwrap();
        let client = self.client.clone();

        if let Some(token) = &*token {
            client.get(url)
                .header("Authorization", format!("token {}", token))
                .send()
                .await
                .map_err(|e| e.to_string())
        } else {
            Err("No GitHub token set".to_string())
        }
    }

    pub async fn search_repositories(&self, query: &str) -> Result<Vec<GitHubRepo>, String> {
        let url = format!("https://api.github.com/search/repositories?q={}&type=pwa", query);
        let response = self.request(&url).await?;
        
        if !response.status().is_success() {
            return Err("GitHub API request failed".to_string());
        }

        let body = response.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
        let items = body["items"].as_array()
            .ok_or_else(|| "Invalid response format".to_string())?;

        let repos = items.iter()
            .map(|item| GitHubRepo {
                name: item["name"].as_str().unwrap_or("".to_string()).to_string(),
                description: item["description"].as_str().unwrap_or("".to_string()).to_string(),
                html_url: item["html_url"].as_str().unwrap_or("".to_string()).to_string(),
                owner: GitHubUser {
                    login: item["owner"]["login"].as_str().unwrap_or("".to_string()).to_string(),
                    avatar_url: item["owner"]["avatar_url"].as_str().unwrap_or("".to_string()).to_string(),
                },
                latest_release: None,
            })
            .collect();

        Ok(repos)
    }

    pub async fn get_repository(&self, owner: &str, repo: &str) -> Result<GitHubRepo, String> {
        let url = format!("https://api.github.com/repos/{}/{}", owner, repo);
        let response = self.request(&url).await?;

        if !response.status().is_success() {
            return Err("GitHub API request failed".to_string());
        }

        let body = response.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
        Ok(GitHubRepo {
            name: body["name"].as_str().unwrap_or("".to_string()).to_string(),
            description: body["description"].as_str().unwrap_or("".to_string()).to_string(),
            html_url: body["html_url"].as_str().unwrap_or("".to_string()).to_string(),
            owner: GitHubUser {
                login: body["owner"]["login"].as_str().unwrap_or("".to_string()).to_string(),
                avatar_url: body["owner"]["avatar_url"].as_str().unwrap_or("".to_string()).to_string(),
            },
            latest_release: None,
        })
    }

    pub async fn get_repository_releases(&self, owner: &str, repo: &str) -> Result<Vec<GitHubRelease>, String> {
        let url = format!("https://api.github.com/repos/{}/{}/releases", owner, repo);
        let response = self.request(&url).await?;

        if !response.status().is_success() {
            return Err("GitHub API request failed".to_string());
        }

        let body = response.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
        let releases = body.as_array()
            .map(|releases| releases.iter()
                .map(|release| GitHubRelease {
                    tag_name: release["tag_name"].as_str().unwrap_or("".to_string()).to_string(),
                    name: release["name"].as_str().unwrap_or("".to_string()).to_string(),
                    body: release["body"].as_str().unwrap_or("".to_string()).to_string(),
                    published_at: release["published_at"].as_str().unwrap_or("".to_string()).to_string(),
                    assets: release["assets"].as_array()
                        .map(|assets| assets.iter()
                            .map(|asset| GitHubAsset {
                                name: asset["name"].as_str().unwrap_or("".to_string()).to_string(),
                                browser_download_url: asset["browser_download_url"].as_str().unwrap_or("".to_string()).to_string(),
                                size: asset["size"].as_u64().unwrap_or(0),
                            }).collect())
                        .unwrap_or_default(),
                }).collect())
            .unwrap_or_default();

        Ok(releases)
    }
}

#[derive(Debug, Clone)]
pub struct GitHubUser {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone)]
pub struct GitHubRepo {
    pub name: String,
    pub description: String,
    pub html_url: String,
    pub owner: GitHubUser,
    pub latest_release: Option<GitHubRelease>,
}

#[derive(Debug, Clone)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub name: String,
    pub body: String,
    pub published_at: String,
    pub assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[tauri::command]
async fn github_search_repositories(
    query: String,
    integration: State<'_, Arc<GitHubIntegration>>,
) -> Result<Vec<GitHubRepo>, String> {
    integration.search_repositories(&query).await
}

#[tauri::command]
async fn github_get_repository(
    owner: String,
    repo: String,
    integration: State<'_, Arc<GitHubIntegration>>,
) -> Result<GitHubRepo, String> {
    integration.get_repository(&owner, &repo).await
}

#[tauri::command]
async fn github_get_repository_releases(
    owner: String,
    repo: String,
    integration: State<'_, Arc<GitHubIntegration>>,
) -> Result<Vec<GitHubRelease>, String> {
    integration.get_repository_releases(&owner, &repo).await
}

#[tauri::command]
fn github_set_token(
    token: String,
    integration: State<'_, Arc<GitHubIntegration>>,
) -> Result<(), String> {
    integration.set_token(token)
}

#[tauri::command]
fn github_get_token(
    integration: State<'_, Arc<GitHubIntegration>>,
) -> Result<Option<String>, String> {
    integration.get_token()
}

pub fn init(path: String) -> Result<Arc<GitHubIntegration>, String> {
    let integration = GitHubIntegration::new(path)?;

    // Register commands
    tauri::Builder::default()
        .manage(integration.clone())
        .invoke_handler(tauri::generate_handler![
            github_search_repositories,
            github_get_repository,
            github_get_repository_releases,
            github_set_token,
            github_get_token
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    Ok(integration)
}
