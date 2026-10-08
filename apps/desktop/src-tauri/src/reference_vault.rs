use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChorusWindow {
    pub start_sec: f64,
    pub end_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceProfile {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub file_format: String,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub integrated_lufs: f64,
    pub true_peak_db: f64,
    pub crest_factor_db: f64,
    pub frequency_bands: Vec<f64>,
    #[serde(default)]
    pub chorus_window: Option<ChorusWindow>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceProfileSummary {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub file_format: String,
    pub duration_seconds: f64,
    pub integrated_lufs: f64,
    pub true_peak_db: f64,
    pub crest_factor_db: f64,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

/// Resolves the default storage directory for reference tracks: `~/.mixing-buddy/references/`
pub fn get_reference_vault_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .map_err(|_| "HOME-Verzeichnis konnte nicht ermittelt werden".to_string())?;
    let dir = PathBuf::from(home).join(".mixing-buddy").join("references");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Fehler beim Anlegen von '{}': {}", dir.display(), e))?;
    }
    Ok(dir)
}

/// Converts a track name into a safe, alphanumeric slug: `dua_lipa_levitating`
pub fn to_reference_slug(name: &str) -> String {
    let mut slug = String::new();
    let mut last_underscore = false;
    for ch in name.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_underscore = false;
        } else if !last_underscore && !slug.is_empty() {
            slug.push('_');
            last_underscore = true;
        }
    }
    let cleaned = slug.trim_matches('_').to_string();
    if cleaned.is_empty() {
        "reference_track".to_string()
    } else {
        cleaned
    }
}

/// Saves a reference profile as JSON to `~/.mixing-buddy/references/<slug>.json`
pub fn save_reference_profile_sync(profile: ReferenceProfile) -> Result<PathBuf, String> {
    let dir = get_reference_vault_dir()?;
    save_reference_profile_to_dir(&dir, profile)
}

pub fn save_reference_profile_to_dir(dir: &PathBuf, profile: ReferenceProfile) -> Result<PathBuf, String> {
    if !dir.exists() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Fehler beim Erstellen des Ordners '{}': {}", dir.display(), e))?;
    }

    let slug = to_reference_slug(&profile.name);
    let target = dir.join(format!("{}.json", slug));

    let json_str = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Fehler beim Serialisieren des Referenzprofils: {}", e))?;

    std::fs::write(&target, format!("{}\n", json_str))
        .map_err(|e| format!("Fehler beim Schreiben von '{}': {}", target.display(), e))?;

    Ok(target)
}

/// Lists all saved reference track profiles from `~/.mixing-buddy/references/`
pub fn list_reference_profiles_sync() -> Result<Vec<ReferenceProfileSummary>, String> {
    let dir = get_reference_vault_dir()?;
    list_reference_profiles_from_dir(&dir)
}

pub fn list_reference_profiles_from_dir(dir: &PathBuf) -> Result<Vec<ReferenceProfileSummary>, String> {
    let mut list = Vec::new();
    if !dir.exists() {
        return Ok(list);
    }

    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Fehler beim Lesen des Referenz-Ordners '{}': {}", dir.display(), e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(prof) = serde_json::from_str::<ReferenceProfile>(&raw) {
                list.push(ReferenceProfileSummary {
                    id: prof.id,
                    name: prof.name,
                    file_name: prof.file_name,
                    file_format: prof.file_format,
                    duration_seconds: prof.duration_seconds,
                    integrated_lufs: prof.integrated_lufs,
                    true_peak_db: prof.true_peak_db,
                    crest_factor_db: prof.crest_factor_db,
                    timestamp: prof.timestamp,
                    file_path: Some(path.to_string_lossy().to_string()),
                });
            }
        }
    }

    // Sort descending by timestamp (newest first)
    list.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(list)
}

/// Retrieves a full reference profile by ID or slug
pub fn get_reference_profile_sync(id_or_slug: &str) -> Result<ReferenceProfile, String> {
    let dir = get_reference_vault_dir()?;
    get_reference_profile_from_dir(&dir, id_or_slug)
}

pub fn get_reference_profile_from_dir(dir: &PathBuf, id_or_slug: &str) -> Result<ReferenceProfile, String> {
    let clean = id_or_slug.trim();
    if !dir.exists() {
        return Err(format!("Referenz '{}' nicht gefunden.", clean));
    }

    // Direct check for <clean>.json
    let direct_path = dir.join(format!("{}.json", to_reference_slug(clean)));
    if direct_path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&direct_path) {
            if let Ok(prof) = serde_json::from_str::<ReferenceProfile>(&raw) {
                return Ok(prof);
            }
        }
    }

    // Scan all json files to match by `id` or slug
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Fehler beim Durchsuchen von '{}': {}", dir.display(), e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(prof) = serde_json::from_str::<ReferenceProfile>(&raw) {
                if prof.id == clean || to_reference_slug(&prof.name) == to_reference_slug(clean) {
                    return Ok(prof);
                }
            }
        }
    }

    Err(format!("Referenz-Profil '{}' nicht gefunden.", clean))
}

/// Deletes a reference profile by ID or slug
pub fn delete_reference_profile_sync(id_or_slug: &str) -> Result<String, String> {
    let dir = get_reference_vault_dir()?;
    delete_reference_profile_from_dir(&dir, id_or_slug)
}

pub fn delete_reference_profile_from_dir(dir: &PathBuf, id_or_slug: &str) -> Result<String, String> {
    let clean = id_or_slug.trim();
    if !dir.exists() {
        return Err(format!("Referenz '{}' nicht gefunden.", clean));
    }

    // Check direct slug file first
    let slug = to_reference_slug(clean);
    let direct_path = dir.join(format!("{}.json", slug));
    if direct_path.exists() {
        std::fs::remove_file(&direct_path)
            .map_err(|e| format!("Fehler beim Löschen von '{}': {}", direct_path.display(), e))?;
        return Ok(format!("Referenz-Profil '{}' erfolgreich gelöscht.", slug));
    }

    // Scan all json files to find matching `id`
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Fehler beim Durchsuchen von '{}': {}", dir.display(), e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(prof) = serde_json::from_str::<ReferenceProfile>(&raw) {
                if prof.id == clean || to_reference_slug(&prof.name) == slug {
                    std::fs::remove_file(&path)
                        .map_err(|e| format!("Fehler beim Löschen von '{}': {}", path.display(), e))?;
                    return Ok(format!("Referenz-Profil '{}' erfolgreich gelöscht.", prof.name));
                }
            }
        }
    }

    Err(format!("Referenz-Profil '{}' konnte nicht gefunden werden.", clean))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_reference_slug() {
        assert_eq!(to_reference_slug("Dua Lipa - Levitating"), "dua_lipa_levitating");
        assert_eq!(to_reference_slug("Pop Master (Final) [2026]!"), "pop_master_final_2026");
        assert_eq!(to_reference_slug(""), "reference_track");
    }

    #[test]
    fn test_save_list_get_delete_cycle() {
        let temp_dir = std::env::temp_dir().join(format!("mixing_buddy_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));

        let profile = ReferenceProfile {
            id: "ref_test_123".to_string(),
            name: "Test Reference Track".to_string(),
            file_name: "test.wav".to_string(),
            file_format: "WAV".to_string(),
            duration_seconds: 184.5,
            sample_rate: 44100,
            channels: 2,
            integrated_lufs: -14.2,
            true_peak_db: -1.0,
            crest_factor_db: 11.5,
            frequency_bands: vec![-12.0; 32],
            chorus_window: Some(ChorusWindow {
                start_sec: 45.0,
                end_sec: 55.0,
            }),
            timestamp: 1700000000,
        };

        // 1. Save
        let saved_path = save_reference_profile_to_dir(&temp_dir, profile.clone()).expect("Failed to save");
        assert!(saved_path.exists());

        // 2. List
        let list = list_reference_profiles_from_dir(&temp_dir).expect("Failed to list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "ref_test_123");
        assert_eq!(list[0].name, "Test Reference Track");

        // 3. Get
        let fetched = get_reference_profile_from_dir(&temp_dir, "ref_test_123").expect("Failed to fetch");
        assert_eq!(fetched.id, profile.id);
        assert_eq!(fetched.frequency_bands.len(), 32);
        assert_eq!(fetched.chorus_window.as_ref().unwrap().start_sec, 45.0);

        // 4. Delete
        let msg = delete_reference_profile_from_dir(&temp_dir, "ref_test_123").expect("Failed to delete");
        assert!(msg.contains("erfolgreich gelöscht"));
        assert!(!saved_path.exists());

        let after_delete = list_reference_profiles_from_dir(&temp_dir).expect("Failed to list after delete");
        assert_eq!(after_delete.len(), 0);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
