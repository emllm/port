use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::Arc;
use tauri::api::dialog::FileDialogBuilder;
use tauri::State;

pub struct FolderSelector {
    last_selected: Mutex<Option<PathBuf>>,
}

impl FolderSelector {
    pub fn new() -> Arc<Self> {
        Arc::new(FolderSelector {
            last_selected: Mutex::new(None),
        })
    }

    pub fn select_folder(&self, title: &str, default_path: Option<&Path>) -> Result<Option<PathBuf>, String> {
        let last_selected = self.last_selected.lock().unwrap();
        let default_path = default_path.or_else(|| last_selected.as_ref());

        let result = FileDialogBuilder::new()
            .set_title(title)
            .set_directory(default_path)
            .pick_folder();

        if let Some(path) = result {
            let mut last_selected = self.last_selected.lock().unwrap();
            *last_selected = Some(path.clone());
            Ok(Some(path))
        } else {
            Ok(None)
        }
    }

    pub fn select_file(&self, title: &str, filters: &[(&str, &[&str])], default_path: Option<&Path>) -> Result<Option<PathBuf>, String> {
        let last_selected = self.last_selected.lock().unwrap();
        let default_path = default_path.or_else(|| last_selected.as_ref());

        let result = FileDialogBuilder::new()
            .set_title(title)
            .set_directory(default_path)
            .add_filter(filters)
            .pick_file();

        if let Some(path) = result {
            let mut last_selected = self.last_selected.lock().unwrap();
            *last_selected = Some(path.clone());
            Ok(Some(path))
        } else {
            Ok(None)
        }
    }

    pub fn select_multiple_files(&self, title: &str, filters: &[(&str, &[&str])], default_path: Option<&Path>) -> Result<Vec<PathBuf>, String> {
        let last_selected = self.last_selected.lock().unwrap();
        let default_path = default_path.or_else(|| last_selected.as_ref());

        let result = FileDialogBuilder::new()
            .set_title(title)
            .set_directory(default_path)
            .add_filter(filters)
            .pick_files();

        if let Some(paths) = result {
            let mut last_selected = self.last_selected.lock().unwrap();
            if let Some(first_path) = paths.first() {
                *last_selected = Some(first_path.clone());
            }
            Ok(paths)
        } else {
            Ok(vec![])
        }
    }
}

#[tauri::command]
fn select_folder(
    title: String,
    default_path: Option<String>,
    selector: State<'_, Arc<FolderSelector>>,
) -> Result<Option<String>, String> {
    let path = selector.select_folder(&title, default_path.as_deref().map(Path::new))?
        .map(|p| p.to_string_lossy().to_string());
    Ok(path)
}

#[tauri::command]
fn select_file(
    title: String,
    filters: Vec<(String, Vec<String>)>,
    default_path: Option<String>,
    selector: State<'_, Arc<FolderSelector>>,
) -> Result<Option<String>, String> {
    let filters = filters
        .iter()
        .map(|(name, exts)| (name.as_str(), exts.iter().map(|e| e.as_str()).collect::<Vec<_>>().as_slice()))
        .collect::<Vec<_>>();

    let path = selector.select_file(&title, &filters, default_path.as_deref().map(Path::new))?
        .map(|p| p.to_string_lossy().to_string());
    Ok(path)
}

#[tauri::command]
fn select_multiple_files(
    title: String,
    filters: Vec<(String, Vec<String>)>,
    default_path: Option<String>,
    selector: State<'_, Arc<FolderSelector>>,
) -> Result<Vec<String>, String> {
    let filters = filters
        .iter()
        .map(|(name, exts)| (name.as_str(), exts.iter().map(|e| e.as_str()).collect::<Vec<_>>().as_slice()))
        .collect::<Vec<_>>();

    let paths = selector.select_multiple_files(&title, &filters, default_path.as_deref().map(Path::new))?
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    Ok(paths)
}

pub fn init() -> Arc<FolderSelector> {
    let selector = FolderSelector::new();

    tauri::Builder::default()
        .manage(selector.clone())
        .invoke_handler(tauri::generate_handler![
            select_folder,
            select_file,
            select_multiple_files
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    selector
}
