use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubApp {
    pub name: String,
    pub description: String,
    pub version: String,
    pub manifest_url: String,
    pub repository: String,
    pub owner: String,
    pub categories: Vec<String>,
    pub permissions: Vec<String>,
    pub verified: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubRepository {
    pub name: String,
    pub description: String,
    pub html_url: String,
    pub owner: GitHubUser,
    pub latest_release: Option<GitHubRelease>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubUser {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub name: String,
    pub body: String,
    pub published_at: String,
    pub assets: Vec<GitHubAsset>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

pub struct GitHubStore {
    client: Client,
    token: Option<String>,
    base_url: String,
    cache: HashMap<String, GitHubRepository>,
}

impl GitHubStore {
    pub fn new(token: Option<String>) -> Self {
        GitHubStore {
            client: Client::new(),
            token,
            base_url: "https://api.github.com".to_string(),
            cache: HashMap::new(),
        }
    }

    async fn get_headers(&self) -> Result<reqwest::header::HeaderMap> {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::ACCEPT,
            "application/vnd.github.v3+json".parse().unwrap(),
        );
        
        if let Some(token) = &self.token {
            headers.insert(
                reqwest::header::AUTHORIZATION,
                format!("token {}", token).parse().unwrap(),
            );
        }

        Ok(headers)
    }

    pub async fn search_repositories(&self, query: &str) -> Result<Vec<GitHubRepository>> {
        let url = format!("{}/search/repositories?q={}&type=pwa", self.base_url, query);
        let headers = self.get_headers().await?;

        let response = self.client.get(&url)
            .headers(headers)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow!("Failed to search repositories"));
        }

        let body = response.json::<serde_json::Value>().await?;
        let items = body["items"].as_array()
            .ok_or_else(|| anyhow!("Invalid response format"))?;

        let mut repos = Vec::new();
        for item in items {
            let repo = GitHubRepository {
                name: item["name"].as_str().unwrap_or("".to_string()).to_string(),
                description: item["description"].as_str().unwrap_or("".to_string()).to_string(),
                html_url: item["html_url"].as_str().unwrap_or("".to_string()).to_string(),
                owner: GitHubUser {
                    login: item["owner"]["login"].as_str().unwrap_or("".to_string()).to_string(),
                    avatar_url: item["owner"]["avatar_url"].as_str().unwrap_or("".to_string()).to_string(),
                },
                latest_release: None,
            };
            repos.push(repo);
        }

        Ok(repos)
    }

    pub async fn get_repository(&self, owner: &str, repo: &str) -> Result<GitHubRepository> {
        if let Some(cached) = self.cache.get(&format!("{}-{}", owner, repo)) {
            return Ok(cached.clone());
        }

        let url = format!("{}/repos/{}/{}", self.base_url, owner, repo);
        let headers = self.get_headers().await?;

        let response = self.client.get(&url)
            .headers(headers)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow!("Failed to get repository"));
        }

        let body = response.json::<serde_json::Value>().await?;
        let repo = GitHubRepository {
            name: body["name"].as_str().unwrap_or("".to_string()).to_string(),
            description: body["description"].as_str().unwrap_or("".to_string()).to_string(),
            html_url: body["html_url"].as_str().unwrap_or("".to_string()).to_string(),
            owner: GitHubUser {
                login: body["owner"]["login"].as_str().unwrap_or("".to_string()).to_string(),
                avatar_url: body["owner"]["avatar_url"].as_str().unwrap_or("".to_string()).to_string(),
            },
            latest_release: None,
        };

        self.cache.insert(format!("{}-{}", owner, repo), repo.clone());
        Ok(repo)
    }

    pub async fn get_repository_releases(&self, owner: &str, repo: &str) -> Result<Vec<GitHubRelease>> {
        let url = format!("{}/repos/{}/{}/releases", self.base_url, owner, repo);
        let headers = self.get_headers().await?;

        let response = self.client.get(&url)
            .headers(headers)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow!("Failed to get releases"));
        }

        let body = response.json::<serde_json::Value>().await?;
        let releases = body.as_array()
            .ok_or_else(|| anyhow!("Invalid releases format"))?
            .iter()
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
            })
            .collect();

        Ok(releases)
    }

    pub async fn verify_app(&self, app: &GitHubApp) -> Result<bool> {
        // TODO: Implement proper verification
        Ok(app.verified)
    }
}
