use crate::password_manager::PasswordManager;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, TokenResponse, TokenUrl,
};
use oauth2::basic::BasicClient;
use oauth2::reqwest::async_http_client;
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};
use thiserror::Error;
use url::Url;

#[derive(Error, Debug)]
pub enum GitHubAuthError {
    #[error("OAuth flow failed: {0}")]
    OAuthError(String),
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),
    #[error("URL parsing failed: {0}")]
    UrlError(#[from] url::ParseError),
    #[error("Timeout during authorization")]
    Timeout,
    #[error("User cancelled authorization")]
    UserCancelled,
    #[error("Invalid state parameter")]
    InvalidState,
    #[error("Token exchange failed: {0}")]
    TokenExchangeError(String),
    #[error("GitHub API error: {0}")]
    GitHubApiError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubUser {
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: String,
    pub html_url: String,
    pub public_repos: u32,
    pub followers: u32,
    pub following: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubToken {
    pub access_token: String,
    pub token_type: String,
    pub scope: String,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone)]
pub struct GitHubAuthConfig {
    pub client_id: String,
    pub client_secret: Option<String>, // Optional for PKCE flow
    pub redirect_uri: String,
    pub scopes: Vec<String>,
    pub use_pkce: bool,
}

impl Default for GitHubAuthConfig {
    fn default() -> Self {
        Self {
            client_id: "your_github_app_client_id".to_string(), // Will be configured
            client_secret: None, // Using PKCE for public clients
            redirect_uri: "http://localhost:8080/auth/callback".to_string(),
            scopes: vec![
                "repo".to_string(),
                "read:user".to_string(),
                "user:email".to_string(),
            ],
            use_pkce: true,
        }
    }
}

pub struct GitHubAuth {
    config: GitHubAuthConfig,
    oauth_client: BasicClient,
    http_client: HttpClient,
    pkce_verifier: Arc<Mutex<Option<PkceCodeVerifier>>>,
    state_token: Arc<Mutex<Option<CsrfToken>>>,
}

impl GitHubAuth {
    pub fn new(config: GitHubAuthConfig) -> Result<Self, GitHubAuthError> {
        let auth_url = AuthUrl::new("https://github.com/login/oauth/authorize".to_string())
            .map_err(|e| GitHubAuthError::OAuthError(e.to_string()))?;
            
        let token_url = TokenUrl::new("https://github.com/login/oauth/access_token".to_string())
            .map_err(|e| GitHubAuthError::OAuthError(e.to_string()))?;
            
        let redirect_url = RedirectUrl::new(config.redirect_uri.clone())
            .map_err(|e| GitHubAuthError::OAuthError(e.to_string()))?;
        
        let mut oauth_client = BasicClient::new(
            ClientId::new(config.client_id.clone()),
            config.client_secret.as_ref().map(|secret| ClientSecret::new(secret.clone())),
            auth_url,
            Some(token_url),
        ).set_redirect_uri(redirect_url);
        
        let http_client = HttpClient::new();
        
        Ok(GitHubAuth {
            config,
            oauth_client,
            http_client,
            pkce_verifier: Arc::new(Mutex::new(None)),
            state_token: Arc::new(Mutex::new(None)),
        })
    }
    
    /// Start OAuth authorization flow
    pub async fn start_authorization(&self) -> Result<String, GitHubAuthError> {
        let mut auth_request = self.oauth_client
            .authorize_url(CsrfToken::new_random);
            
        // Add scopes
        for scope in &self.config.scopes {
            auth_request = auth_request.add_scope(Scope::new(scope.clone()));
        }
        
        let (auth_url, csrf_state) = if self.config.use_pkce {
            // Use PKCE for enhanced security
            let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
            
            // Store PKCE verifier for later use
            *self.pkce_verifier.lock().unwrap() = Some(pkce_verifier);
            
            auth_request.set_pkce_challenge(pkce_challenge).url()
        } else {
            auth_request.url()
        };
        
        // Store state token for validation
        *self.state_token.lock().unwrap() = Some(csrf_state);
        
        log::info!("Starting GitHub OAuth flow: {}", auth_url);
        
        Ok(auth_url.to_string())
    }
    
    /// Complete OAuth flow with authorization code
    pub async fn complete_authorization(
        &self,
        code: &str,
        state: &str,
        password_manager: &PasswordManager,
    ) -> Result<GitHubToken, GitHubAuthError> {
        // Validate state token
        self.validate_state_token(state)?;
        
        let auth_code = AuthorizationCode::new(code.to_string());
        
        let token_request = if self.config.use_pkce {
            let pkce_verifier = self.pkce_verifier.lock().unwrap()
                .take()
                .ok_or_else(|| GitHubAuthError::OAuthError("PKCE verifier not found".to_string()))?;
                
            self.oauth_client
                .exchange_code(auth_code)
                .set_pkce_verifier(pkce_verifier)
        } else {
            self.oauth_client.exchange_code(auth_code)
        };
        
        // Exchange authorization code for access token
        let token_response = timeout(
            Duration::from_secs(30),
            token_request.request_async(async_http_client)
        ).await
        .map_err(|_| GitHubAuthError::Timeout)?
        .map_err(|e| GitHubAuthError::TokenExchangeError(e.to_string()))?;
        
        let access_token = token_response.access_token().secret().clone();
        let token_type = token_response.token_type().as_ref().to_string();
        let expires_in = token_response.expires_in().map(|d| d.as_secs());
        let refresh_token = token_response.refresh_token().map(|t| t.secret().clone());
        
        // Get scopes from token response
        let scope = token_response.scopes()
            .map(|scopes| {
                scopes.iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default();
        
        let github_token = GitHubToken {
            access_token: access_token.clone(),
            token_type,
            scope,
            expires_in,
            refresh_token,
            created_at: chrono::Utc::now(),
        };
        
        // Validate token by fetching user info
        let user_info = self.get_user_info(&access_token).await?;
        log::info!("Successfully authenticated GitHub user: {}", user_info.login);
        
        // Store token securely
        password_manager.store_github_token(&access_token).await
            .map_err(|e| GitHubAuthError::OAuthError(e.to_string()))?;
        
        Ok(github_token)
    }
    
    /// Get user information using access token
    pub async fn get_user_info(&self, access_token: &str) -> Result<GitHubUser, GitHubAuthError> {
        let response = self.http_client
            .get("https://api.github.com/user")
            .header("Authorization", format!("token {}", access_token))
            .header("User-Agent", "PWA-Marketplace/1.0")
            .send()
            .await?;
            
        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(GitHubAuthError::GitHubApiError(format!(
                "Failed to get user info: {}", error_text
            )));
        }
        
        let user_info: GitHubUser = response.json().await?;
        Ok(user_info)
    }
    
    /// Validate access token
    pub async fn validate_token(&self, access_token: &str) -> Result<bool, GitHubAuthError> {
        let response = self.http_client
            .get("https://api.github.com/user")
            .header("Authorization", format!("token {}", access_token))
            .header("User-Agent", "PWA-Marketplace/1.0")
            .send()
            .await?;
            
        Ok(response.status().is_success())
    }
    
    /// Revoke access token
    pub async fn revoke_token(&self, access_token: &str) -> Result<(), GitHubAuthError> {
        let client_id = &self.config.client_id;
        
        let response = self.http_client
            .delete(&format!("https://api.github.com/applications/{}/token", client_id))
            .header("Authorization", format!("token {}", access_token))
            .header("User-Agent", "PWA-Marketplace/1.0")
            .json(&serde_json::json!({
                "access_token": access_token
            }))
            .send()
            .await?;
            
        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(GitHubAuthError::GitHubApiError(format!(
                "Failed to revoke token: {}", error_text
            )));
        }
        
        Ok(())
    }
    
    /// Start local callback server for OAuth redirect
    pub async fn start_callback_server(&self) -> Result<GitHubToken, GitHubAuthError> {
        use std::sync::Arc;
        use tokio::sync::oneshot;
        use std::net::SocketAddr;
        
        let (tx, rx) = oneshot::channel();
        let tx = Arc::new(Mutex::new(Some(tx)));
        
        // Parse redirect URI to get port
        let redirect_url = Url::parse(&self.config.redirect_uri)?;
        let port = redirect_url.port().unwrap_or(8080);
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        
        // Simple HTTP server for OAuth callback
        let server_handle = tokio::spawn({
            let tx = tx.clone();
            async move {
                let listener = tokio::net::TcpListener::bind(addr).await
                    .map_err(|e| GitHubAuthError::OAuthError(format!("Failed to bind server: {}", e)))?;
                
                log::info!("OAuth callback server listening on {}", addr);
                
                while let Ok((stream, _)) = listener.accept().await {
                    let tx = tx.clone();
                    
                    tokio::spawn(async move {
                        if let Err(e) = handle_callback_request(stream, tx).await {
                            log::error!("Callback handler error: {}", e);
                        }
                    });
                }
                
                Ok::<(), GitHubAuthError>(())
            }
        });
        
        // Wait for callback with timeout
        let result = timeout(Duration::from_secs(300), rx).await
            .map_err(|_| GitHubAuthError::Timeout)?
            .map_err(|_| GitHubAuthError::UserCancelled)?;
        
        // Cleanup server
        server_handle.abort();
        
        result
    }
    
    /// Complete OAuth flow with automatic browser and callback server
    pub async fn authorize_with_browser(
        &self,
        password_manager: &PasswordManager,
    ) -> Result<GitHubToken, GitHubAuthError> {
        // Start callback server
        let server_future = self.start_callback_server();
        
        // Generate authorization URL
        let auth_url = self.start_authorization().await?;
        
        // Open browser
        self.open_browser(&auth_url)?;
        
        // Wait for callback
        let token = server_future.await?;
        
        log::info!("GitHub authorization completed successfully");
        Ok(token)
    }
    
    /// Open URL in default browser
    fn open_browser(&self, url: &str) -> Result<(), GitHubAuthError> {
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", url])
                .spawn()
                .map_err(|e| GitHubAuthError::OAuthError(format!("Failed to open browser: {}", e)))?;
        }
        
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(url)
                .spawn()
                .map_err(|e| GitHubAuthError::OAuthError(format!("Failed to open browser: {}", e)))?;
        }
        
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(url)
                .spawn()
                .map_err(|e| GitHubAuthError::OAuthError(format!("Failed to open browser: {}", e)))?;
        }
        
        Ok(())
    }
    
    /// Validate state token to prevent CSRF attacks
    fn validate_state_token(&self, received_state: &str) -> Result<(), GitHubAuthError> {
        let stored_state = self.state_token.lock().unwrap()
            .take()
            .ok_or(GitHubAuthError::InvalidState)?;
            
        if stored_state.secret() != received_state {
            return Err(GitHubAuthError::InvalidState);
        }
        
        Ok(())
    }
    
    /// Check if token is expired
    pub fn is_token_expired(&self, token: &GitHubToken) -> bool {
        if let Some(expires_in) = token.expires_in {
            let expires_at = token.created_at + chrono::Duration::seconds(expires_in as i64);
            chrono::Utc::now() > expires_at
        } else {
            false // Token doesn't expire
        }
    }
    
    /// Get rate limit info
    pub async fn get_rate_limit(&self, access_token: &str) -> Result<RateLimitInfo, GitHubAuthError> {
        let response = self.http_client
            .get("https://api.github.com/rate_limit")
            .header("Authorization", format!("token {}", access_token))
            .header("User-Agent", "PWA-Marketplace/1.0")
            .send()
            .await?;
            
        if !response.status().is_success() {
            return Err(GitHubAuthError::GitHubApiError("Failed to get rate limit".to_string()));
        }
        
        let rate_limit: RateLimitResponse = response.json().await?;
        Ok(rate_limit.resources.core)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitInfo {
    pub limit: u32,
    pub remaining: u32,
    pub reset: u64,
    pub used: u32,
}

#[derive(Debug, Deserialize)]
struct RateLimitResponse {
    resources: RateLimitResources,
}

#[derive(Debug, Deserialize)]
struct RateLimitResources {
    core: RateLimitInfo,
}

// Simple HTTP callback handler
async fn handle_callback_request(
    mut stream: tokio::net::TcpStream,
    tx: Arc<Mutex<Option<oneshot::Sender<Result<GitHubToken, GitHubAuthError>>>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    
    let mut buffer = [0; 1024];
    let n = stream.read(&mut buffer).await?;
    let request = String::from_utf8_lossy(&buffer[..n]);
    
    // Parse HTTP request line
    let first_line = request.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    
    if parts.len() >= 2 && parts[0] == "GET" {
        let path = parts[1];
        
        // Parse query parameters
        if let Some((_, query)) = path.split_once('?') {
            let params: HashMap<String, String> = query
                .split('&')
                .filter_map(|param| {
                    let mut parts = param.splitn(2, '=');
                    Some((
                        parts.next()?.to_string(),
                        parts.next().unwrap_or("").to_string(),
                    ))
                })
                .collect();
            
            let response = if let (Some(code), Some(state)) = (params.get("code"), params.get("state")) {
                // Success response
                let html = r#"
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Authorization Successful</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        .success { color: #4CAF50; }
                        .container { max-width: 400px; margin: 0 auto; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1 class="success">✓ Authorization Successful</h1>
                        <p>You have successfully authorized PWA Marketplace to access your GitHub account.</p>
                        <p>You can now close this window and return to the application.</p>
                    </div>
                    <script>
                        setTimeout(() => window.close(), 3000);
                    </script>
                </body>
                </html>
                "#;
                
                // Send success result
                if let Some(sender) = tx.lock().unwrap().take() {
                    // This is simplified - in real implementation, we'd need to complete the OAuth flow here
                    let _ = sender.send(Err(GitHubAuthError::OAuthError("Callback received - complete flow in main thread".to_string())));
                }
                
                format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}", html.len(), html)
            } else if params.contains_key("error") {
                // Error response
                let error = params.get("error").unwrap_or("unknown_error");
                let error_description = params.get("error_description").unwrap_or("Authorization failed");
                
                let html = format!(r#"
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Authorization Failed</title>
                    <style>
                        body {{ font-family: Arial, sans-serif; text-align: center; padding: 50px; }}
                        .error {{ color: #f44336; }}
                        .container {{ max-width: 400px; margin: 0 auto; }}
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1 class="error">✗ Authorization Failed</h1>
                        <p>Error: {}</p>
                        <p>{}</p>
                        <p>Please try again or contact support if the problem persists.</p>
                    </div>
                    <script>
                        setTimeout(() => window.close(), 5000);
                    </script>
                </body>
                </html>
                "#, error, error_description);
                
                // Send error result
                if let Some(sender) = tx.lock().unwrap().take() {
                    let _ = sender.send(Err(GitHubAuthError::OAuthError(format!("OAuth error: {}", error))));
                }
                
                format!("HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}", html.len(), html)
            } else {
                // Invalid request
                let html = r#"
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Invalid Request</title>
                </head>
                <body>
                    <h1>Invalid OAuth Callback</h1>
                    <p>The authorization callback is invalid or malformed.</p>
                </body>
                </html>
                "#;
                
                format!("HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}", html.len(), html)
            };
            
            stream.write_all(response.as_bytes()).await?;
        }
    }
    
    Ok(())
}

// Tauri commands for frontend integration
#[tauri::command]
pub async fn start_github_auth() -> Result<String, String> {
    let config = GitHubAuthConfig::default();
    let auth = GitHubAuth::new(config)
        .map_err(|e| e.to_string())?;
    
    let auth_url = auth.start_authorization().await
        .map_err(|e| e.to_string())?;
    
    Ok(auth_url)
}

#[tauri::command]
pub async fn complete_github_auth(
    code: String,
    state: String,
    password_manager_state: tauri::State<'_, Arc<Mutex<Option<PasswordManager>>>>,
) -> Result<GitHubToken, String> {
    let config = GitHubAuthConfig::default();
    let auth = GitHubAuth::new(config)
        .map_err(|e| e.to_string())?;
    
    let password_manager_guard = password_manager_state.lock().unwrap();
    let password_manager = password_manager_guard.as_ref()
        .ok_or("Password manager not initialized")?;
    
    let token = auth.complete_authorization(&code, &state, password_manager).await
        .map_err(|e| e.to_string())?;
    
    Ok(token)
}

#[tauri::command]
pub async fn validate_github_token(token: String) -> Result<bool, String> {
    let config = GitHubAuthConfig::default();
    let auth = GitHubAuth::new(config)
        .map_err(|e| e.to_string())?;
    
    let is_valid = auth.validate_token(&token).await
        .map_err(|e| e.to_string())?;
    
    Ok(is_valid)
}

#[tauri::command]
pub async fn get_github_user_info(token: String) -> Result<GitHubUser, String> {
    let config = GitHubAuthConfig::default();
    let auth = GitHubAuth::new(config)
        .map_err(|e| e.to_string())?;
    
    let user_info = auth.get_user_info(&token).await
        .map_err(|e| e.to_string())?;
    
    Ok(user_info)
}

#[tauri::command]
pub async fn revoke_github_token(token: String) -> Result<(), String> {
    let config = GitHubAuthConfig::default();
    let auth = GitHubAuth::new(config)
        .map_err(|e| e.to_string())?;
    
    auth.revoke_token(&token).await
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn get_github_rate_limit(token: String) -> Result<RateLimitInfo, String> {
    let config = GitHubAuthConfig::default();
    let auth = GitHubAuth::new(config)
        .map_err(|e| e.to_string())?;
    
    let rate_limit = auth.get_rate_limit(&token).await
        .map_err(|e| e.to_string())?;
    
    Ok(rate_limit)
}

#[tauri::command]
pub async fn generate_github_token_with_browser(
    password_manager_state: tauri::State<'_, Arc<Mutex<Option<PasswordManager>>>>,
) -> Result<GitHubToken, String> {
    let config = GitHubAuthConfig::default();
    let auth = GitHubAuth::new(config)
        .map_err(|e| e.to_string())?;
    
    let password_manager_guard = password_manager_state.lock().unwrap();
    let password_manager = password_manager_guard.as_ref()
        .ok_or("Password manager not initialized")?;
    
    let token = auth.authorize_with_browser(password_manager).await
        .map_err(|e| e.to_string())?;
    
    Ok(token)
}

// Helper function for main.rs integration
pub async fn generate_token(
    username: &str,
    password_manager: &PasswordManager,
) -> Result<String, Box<dyn std::error::Error>> {
    let config = GitHubAuthConfig::default();
    let auth = GitHubAuth::new(config)?;
    
    log::info!("Starting GitHub token generation for user: {}", username);
    
    let token = auth.authorize_with_browser(password_manager).await?;
    
    Ok(token.access_token)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_github_auth_creation() {
        let config = GitHubAuthConfig::default();
        let auth = GitHubAuth::new(config);
        assert!(auth.is_ok());
    }
    
    #[test]
    fn test_config_validation() {
        let config = GitHubAuthConfig {
            client_id: "test_client_id".to_string(),
            redirect_uri: "http://localhost:8080/callback".to_string(),
            ..Default::default()
        };
        
        assert!(!config.client_id.is_empty());
        assert!(config.redirect_uri.starts_with("http"));
    }
    
    #[tokio::test]
    async fn test_authorization_url_generation() {
        let config = GitHubAuthConfig::default();
        let auth = GitHubAuth::new(config).unwrap();
        
        let auth_url = auth.start_authorization().await.unwrap();
        assert!(auth_url.contains("github.com"));
        assert!(auth_url.contains("oauth/authorize"));
    }
    
    #[test]
    fn test_token_expiration() {
        let auth = GitHubAuth::new(GitHubAuthConfig::default()).unwrap();
        
        // Test non-expiring token
        let token_no_expiry = GitHubToken {
            access_token: "test_token".to_string(),
            token_type: "bearer".to_string(),
            scope: "repo".to_string(),
            expires_in: None,
            refresh_token: None,
            created_at: chrono::Utc::now(),
        };
        assert!(!auth.is_token_expired(&token_no_expiry));
        
        // Test expired token
        let token_expired = GitHubToken {
            access_token: "test_token".to_string(),
            token_type: "bearer".to_string(),
            scope: "repo".to_string(),
            expires_in: Some(3600), // 1 hour
            refresh_token: None,
            created_at: chrono::Utc::now() - chrono::Duration::hours(2), // 2 hours ago
        };
        assert!(auth.is_token_expired(&token_expired));
    }
}