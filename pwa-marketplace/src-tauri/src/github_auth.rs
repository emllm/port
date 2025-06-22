use std::sync::Mutex;
use std::sync::Arc;
use std::collections::HashMap;
use serde_json;
use oauth2;
use oauth2::basic::BasicClient;
use oauth2::reqwest::http_client;
use oauth2::prelude::*;
use url::Url;
use tauri::State;

pub struct GitHubAuth {
    client: BasicClient,
    tokens: Mutex<HashMap<String, oauth2::Token>>,
    config: Mutex<GitHubAuthConfig>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct GitHubAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub scopes: Vec<String>,
}

impl GitHubAuth {
    pub fn new(config: GitHubAuthConfig) -> Arc<Self> {
        let client = BasicClient::new(
            oauth2::ClientId::new(config.client_id.clone()),
            Some(oauth2::ClientSecret::new(config.client_secret.clone())),
            Url::parse("https://github.com/login/oauth/authorize").unwrap(),
            Some(Url::parse("https://github.com/login/oauth/access_token").unwrap()),
        )
        .set_redirect_uri(Url::parse(&config.redirect_uri).unwrap());

        Arc::new(GitHubAuth {
            client,
            tokens: Mutex::new(HashMap::new()),
            config: Mutex::new(config),
        })
    }

    pub fn get_auth_url(&self) -> Result<Url, String> {
        let (auth_url, _) = self.client
            .authorize_url(oauth2::CsrfToken::new_random)
            .add_scopes(self.config.lock().unwrap().scopes.iter().map(|s| s.clone()))
            .url();

        Ok(auth_url)
    }

    pub fn exchange_code(&self, code: &str) -> Result<oauth2::Token, String> {
        let token = self.client
            .exchange_code(oauth2::AuthorizationCode::new(code.to_string()))
            .request(http_client)
            .map_err(|e| e.to_string())?;

        let mut tokens = self.tokens.lock().unwrap();
        tokens.insert(code.to_string(), token.clone());

        Ok(token)
    }

    pub fn get_token(&self, code: &str) -> Result<Option<oauth2::Token>, String> {
        Ok(self.tokens.lock().unwrap().get(code).cloned())
    }

    pub fn refresh_token(&self, refresh_token: &str) -> Result<oauth2::Token, String> {
        let token = self.client
            .exchange_refresh_token(oauth2::RefreshToken::new(refresh_token.to_string()))
            .request(http_client)
            .map_err(|e| e.to_string())?;

        // Update stored token
        let mut tokens = self.tokens.lock().unwrap();
        tokens.retain(|_, t| t.refresh_token().map_or(false, |rt| rt.secret() != refresh_token));
        tokens.insert(refresh_token.to_string(), token.clone());

        Ok(token)
    }
}

#[tauri::command]
fn get_auth_url(
    auth: State<'_, Arc<GitHubAuth>>,
) -> Result<String, String> {
    Ok(auth.get_auth_url()?.to_string())
}

#[tauri::command]
fn exchange_code(
    code: String,
    auth: State<'_, Arc<GitHubAuth>>,
) -> Result<String, String> {
    let token = auth.exchange_code(&code)?;
    Ok(serde_json::to_string(&token).map_err(|e| e.to_string())?)
}

#[tauri::command]
fn get_token(
    code: String,
    auth: State<'_, Arc<GitHubAuth>>,
) -> Result<Option<String>, String> {
    Ok(auth.get_token(&code)?
        .map(|token| serde_json::to_string(&token).unwrap()))
}

#[tauri::command]
fn refresh_token(
    refresh_token: String,
    auth: State<'_, Arc<GitHubAuth>>,
) -> Result<String, String> {
    let token = auth.refresh_token(&refresh_token)?;
    Ok(serde_json::to_string(&token).map_err(|e| e.to_string())?)
}

pub fn init(config: GitHubAuthConfig) -> Arc<GitHubAuth> {
    let auth = GitHubAuth::new(config);

    tauri::Builder::default()
        .manage(auth.clone())
        .invoke_handler(tauri::generate_handler![
            get_auth_url,
            exchange_code,
            get_token,
            refresh_token
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    auth
}
