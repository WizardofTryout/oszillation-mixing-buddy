/**
 * session_vault.rs – Native Session Vault & File Dialogs (Sprint 4)
 * Oszillation Mixing Buddy (Universal AI Co-Producer)
 *
 * Verwaltet die atomare Persistierung von *.omb-session.json Dateien,
 * Hintergrund-Sicherungen unter ~/.mixing-buddy/projects/<uuid>/vault.json,
 * sowie native macOS Open- und Save-Dialoge.
 */

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionLoadResult {
    pub content: String,
    pub file_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionVaultSummary {
    pub session_uuid: String,
    pub session_name: String,
    pub file_path: String,
    pub updated_at: String,
    pub actions_count: usize,
}

/// Ermittelt das Basis-Verzeichnis ~/.mixing-buddy/
pub fn get_mixing_buddy_home_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .map_err(|_| "HOME-Umgebungsvariable konnte nicht ermittelt werden".to_string())?;
    let dir = PathBuf::from(home).join(".mixing-buddy");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Fehler beim Anlegen von '{}': {}", dir.display(), e))?;
    }
    Ok(dir)
}

/// Ermittelt das Projekt-Verzeichnis ~/.mixing-buddy/projects/<session_uuid>/
pub fn get_project_vault_dir(session_uuid: &str) -> Result<PathBuf, String> {
    let safe_uuid: String = session_uuid
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    let effective_uuid = if safe_uuid.is_empty() { "default" } else { &safe_uuid };

    let dir = get_mixing_buddy_home_dir()?
        .join("projects")
        .join(effective_uuid);
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Fehler beim Anlegen des Projektverzeichnisses '{}': {}", dir.display(), e))?;
    }
    Ok(dir)
}

/// Atomares Schreiben: Schreibt zuerst in eine temporäre Datei und benennt sie dann um.
pub fn write_file_atomically(target_path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = target_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Fehler beim Anlegen von '{}': {}", parent.display(), e))?;
        }
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_path = target_path.with_extension(format!("tmp.{}", timestamp));

    fs::write(&temp_path, content)
        .map_err(|e| format!("Fehler beim Schreiben der temporären Datei '{}': {}", temp_path.display(), e))?;

    if let Err(e) = fs::rename(&temp_path, target_path) {
        // Fallback falls Rename über Filesystem-Grenzen fehlschlägt
        let copy_res = fs::copy(&temp_path, target_path);
        let _ = fs::remove_file(&temp_path);
        if copy_res.is_err() || !target_path.exists() {
            return Err(format!(
                "Fehler beim Ersetzen der Zieldatei '{}': {}",
                target_path.display(),
                e
            ));
        }
    }

    Ok(())
}

/// Merkt sich die zuletzt aktive Session UUID in ~/.mixing-buddy/last_session_uuid.txt
pub fn record_last_session_uuid(session_uuid: &str) -> Result<(), String> {
    let base = get_mixing_buddy_home_dir()?;
    let path = base.join("last_session_uuid.txt");
    write_file_atomically(&path, session_uuid.trim())
}

/// Liest die zuletzt aktive Session UUID aus
pub fn read_last_session_uuid() -> Option<String> {
    let base = get_mixing_buddy_home_dir().ok()?;
    let path = base.join("last_session_uuid.txt");
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    None
}

/// Nativer macOS Dateiauswahl-Dialog ("Session öffnen")
pub fn open_session_dialog() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let script = r#"POSIX path of (choose file of type {"json"} with prompt "Oszillation Mixing Buddy Session öffnen:")"#;
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|e| format!("Fehler beim Ausführen des macOS-Dateidialogs: {}", e))?;

        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                return Ok(Some(path_str));
            }
        }
        Ok(None)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}

/// Nativer macOS Speichern-Dialog ("Session speichern unter")
pub fn save_session_dialog(default_name: Option<String>) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let def = default_name.unwrap_or_else(|| "Session.omb-session.json".to_string());
        let script = format!(
            r#"POSIX path of (choose file name default name "{}" default location (path to documents folder) with prompt "Session speichern unter:")"#,
            def
        );
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|e| format!("Fehler beim Ausführen des macOS-Speicherdialogs: {}", e))?;

        if output.status.success() {
            let mut path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                if !path_str.ends_with(".json") {
                    path_str.push_str(".omb-session.json");
                }
                return Ok(Some(path_str));
            }
        }
        Ok(None)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn save_session_file(
    session_json: String,
    file_path: Option<String>,
    default_name: Option<String>,
    session_uuid: Option<String>,
) -> Result<Option<String>, String> {
    let chosen_path = match file_path {
        Some(p) => p,
        None => match save_session_dialog(default_name)? {
            Some(p) => p,
            None => return Ok(None),
        },
    };

    let target = PathBuf::from(&chosen_path);
    write_file_atomically(&target, &session_json)?;

    // Automatische Hintergrund-Spiegelung nach ~/.mixing-buddy/projects/<uuid>/vault.json
    let uuid = session_uuid.unwrap_or_else(|| {
        // Falls keine UUID übergeben, versuche aus dem JSON zu parsen
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&session_json) {
            if let Some(u) = v.get("sessionUuid").and_then(|x| x.as_str()) {
                return u.to_string();
            }
        }
        format!("proj_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
    });

    let vault_path = get_project_vault_dir(&uuid)?.join("vault.json");
    let _ = write_file_atomically(&vault_path, &session_json);
    let _ = record_last_session_uuid(&uuid);

    Ok(Some(chosen_path))
}

#[tauri::command]
pub async fn load_session_file(file_path: Option<String>) -> Result<Option<SessionLoadResult>, String> {
    let path_to_load = match file_path {
        Some(p) => p,
        None => match open_session_dialog()? {
            Some(p) => p,
            None => return Ok(None),
        },
    };

    let target = PathBuf::from(&path_to_load);
    if !target.exists() {
        return Err(format!("Datei '{}' existiert nicht.", path_to_load));
    }

    let content = fs::read_to_string(&target)
        .map_err(|e| format!("Fehler beim Lesen der Datei '{}': {}", path_to_load, e))?;

    // Notiere die geladene Session UUID falls vorhanden
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
        if let Some(u) = v.get("sessionUuid").and_then(|x| x.as_str()) {
            let _ = record_last_session_uuid(u);
            let vault_path = get_project_vault_dir(u).ok().map(|d| d.join("vault.json"));
            if let Some(vp) = vault_path {
                let _ = write_file_atomically(&vp, &content);
            }
        }
    }

    Ok(Some(SessionLoadResult {
        content,
        file_path: path_to_load,
    }))
}

#[tauri::command]
pub async fn save_vault_background(session_uuid: String, session_json: String) -> Result<String, String> {
    let vault_dir = get_project_vault_dir(&session_uuid)?;
    let vault_path = vault_dir.join("vault.json");
    write_file_atomically(&vault_path, &session_json)?;
    let _ = record_last_session_uuid(&session_uuid);
    Ok(vault_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_last_session_vault() -> Result<Option<String>, String> {
    // 1. Prüfe last_session_uuid.txt
    if let Some(uuid) = read_last_session_uuid() {
        let vault_path = get_project_vault_dir(&uuid)?.join("vault.json");
        if vault_path.exists() {
            if let Ok(content) = fs::read_to_string(&vault_path) {
                return Ok(Some(content));
            }
        }
    }

    // 2. Fallback: Suche das jüngste vault.json im projects-Verzeichnis
    let projects_dir = get_mixing_buddy_home_dir()?.join("projects");
    if projects_dir.exists() {
        if let Ok(entries) = fs::read_dir(projects_dir) {
            let mut best_file: Option<(PathBuf, std::time::SystemTime)> = None;
            for entry in entries.flatten() {
                let p = entry.path().join("vault.json");
                if p.exists() {
                    if let Ok(meta) = p.metadata() {
                        if let Ok(mtime) = meta.modified() {
                            if best_file.as_ref().map_or(true, |(_, best_time)| mtime > *best_time) {
                                best_file = Some((p, mtime));
                            }
                        }
                    }
                }
            }
            if let Some((p, _)) = best_file {
                if let Ok(content) = fs::read_to_string(p) {
                    return Ok(Some(content));
                }
            }
        }
    }

    Ok(None)
}

#[tauri::command]
pub async fn list_session_vaults() -> Result<Vec<SessionVaultSummary>, String> {
    let mut result = Vec::new();
    let projects_dir = get_mixing_buddy_home_dir()?.join("projects");
    if !projects_dir.exists() {
        return Ok(result);
    }

    let entries = fs::read_dir(projects_dir)
        .map_err(|e| format!("Fehler beim Lesen der Session-Verzeichnisse: {}", e))?;

    for entry in entries.flatten() {
        let vault_file = entry.path().join("vault.json");
        if vault_file.exists() {
            if let Ok(content) = fs::read_to_string(&vault_file) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                    let uuid = v.get("sessionUuid").and_then(|x| x.as_str()).unwrap_or("unknown").to_string();
                    let name = v.get("sessionName").and_then(|x| x.as_str()).unwrap_or("Unbenannte Session").to_string();
                    let updated = v.get("updatedAt").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let count = v.get("actionJournal").and_then(|x| x.as_array()).map_or(0, |a| a.len());

                    result.push(SessionVaultSummary {
                        session_uuid: uuid,
                        session_name: name,
                        file_path: vault_file.to_string_lossy().to_string(),
                        updated_at: updated,
                        actions_count: count,
                    });
                }
            }
        }
    }

    // Sortiere absteigend nach Aktualisierungsdatum
    result.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(result)
}
