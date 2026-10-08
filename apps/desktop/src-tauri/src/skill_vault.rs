use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RevisionHistoryItem {
    pub version: String,
    pub timestamp: String,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CrestFactorRange {
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillMetrologyTargets {
    pub integrated_lufs: f64,
    pub tolerance_lufs: f64,
    pub crest_factor: CrestFactorRange,
    pub max_true_peak_db: f64,
    pub recommended_headroom_db: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillChainSlot {
    pub slot_type: String, // "utility" | "eq" | "dynamics" | "saturation" | "space"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_plugin_hint: Option<String>,
    #[serde(default)]
    pub typical_rules: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillPrompts {
    pub quickstart: String,
    pub workshop: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MixingSkill {
    pub id: String,
    pub name: String,
    pub category: String, // "vocal" | "drums" | "master" | "bass" | "general"
    #[serde(default)]
    pub is_favorite: bool,
    pub version: String,
    #[serde(default)]
    pub revision_history: Vec<RevisionHistoryItem>,
    pub metrology_targets: SkillMetrologyTargets,
    #[serde(default)]
    pub preferred_chain: Vec<SkillChainSlot>,
    pub prompts: SkillPrompts,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MixingSkillSummary {
    pub id: String,
    pub name: String,
    pub category: String,
    pub is_favorite: bool,
    pub version: String,
    pub chain_slots_count: usize,
    pub updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

/// Resolves the storage directory for custom mixing skills: `~/.mixing-buddy/skills/`
pub fn get_skill_vault_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .map_err(|_| "HOME-Verzeichnis konnte nicht ermittelt werden".to_string())?;
    let dir = PathBuf::from(home).join(".mixing-buddy").join("skills");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Fehler beim Anlegen von '{}': {}", dir.display(), e))?;
    }
    let _ = ensure_seed_skill_in_dir(&dir);
    Ok(dir)
}

/// Converts a skill id or name into a safe slug
pub fn to_skill_slug(input: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in input.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if (ch == '-' || ch == '_' || ch.is_whitespace()) && !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }
    let cleaned = slug.trim_matches('-').to_string();
    if cleaned.is_empty() {
        "custom-mixing-skill".to_string()
    } else {
        cleaned
    }
}

/// Default Tonmischmeister seed skill definition
pub fn get_seed_tonmischmeister_skill() -> MixingSkill {
    MixingSkill {
        id: "tonmischmeister".to_string(),
        name: "Tonmischmeister".to_string(),
        category: "master".to_string(),
        is_favorite: true,
        version: "v1.0".to_string(),
        revision_history: vec![RevisionHistoryItem {
            version: "v1.0".to_string(),
            timestamp: "2026-10-01T00:00:00.000Z".to_string(),
            comment: "Initialer deutscher Broadcast & Mastering Studio Standard".to_string(),
        }],
        metrology_targets: SkillMetrologyTargets {
            integrated_lufs: -14.0,
            tolerance_lufs: 1.0,
            crest_factor: CrestFactorRange {
                min: 9.0,
                max: 12.0,
            },
            max_true_peak_db: -1.0,
            recommended_headroom_db: 1.5,
        },
        preferred_chain: vec![
            SkillChainSlot {
                slot_type: "utility".to_string(),
                preferred_plugin_hint: Some("Gain / Mono-Maker".to_string()),
                typical_rules: vec![
                    "Mono-Kompatibilität unterhalb von 90 Hz erzwingen".to_string(),
                    "Headroom vor Dynamikbearbeitung auf -18 dBFS kalibrieren".to_string(),
                ],
            },
            SkillChainSlot {
                slot_type: "eq".to_string(),
                preferred_plugin_hint: Some("Channel EQ / Linear Phase EQ".to_string()),
                typical_rules: vec![
                    "High-Pass bei 28 Hz (18 dB/Okt)".to_string(),
                    "Resonanz-Absenkung bei 250-400 Hz (Mumpf-Kompensation)".to_string(),
                    "Sanfter Air-Boost bei 12 kHz".to_string(),
                ],
            },
            SkillChainSlot {
                slot_type: "dynamics".to_string(),
                preferred_plugin_hint: Some("Master Bus Compressor".to_string()),
                typical_rules: vec![
                    "Maximal 1.5 bis 2.5 dB Gain Reduction (Glue)".to_string(),
                    "Attack > 30 ms zum Erhalt der Transienten".to_string(),
                    "Auto-Release oder 100 ms".to_string(),
                ],
            },
            SkillChainSlot {
                slot_type: "saturation".to_string(),
                preferred_plugin_hint: Some("Tape / Tube Saturator".to_string()),
                typical_rules: vec![
                    "Feine ungeradzahlige Obertöne für Dichte und Wärme".to_string(),
                    "Kein hörbares Clipping".to_string(),
                ],
            },
            SkillChainSlot {
                slot_type: "space".to_string(),
                preferred_plugin_hint: Some("Stereo Widener / Imager".to_string()),
                typical_rules: vec![
                    "Stereo-Korrelationskoeffizient stets > +0.6 halten".to_string(),
                    "Kein Reverb auf dem Sub-Bass".to_string(),
                ],
            },
        ],
        prompts: SkillPrompts {
            quickstart: "Du bist ein erfahrener deutscher Tonmischmeister. Analysiere das Spektrum und die EBU R128 Lautheit präzise, halte Headroom ein und erzeuge minimale, musikalische EQ- und Dynamik-Deltas mit transparentem Klangbild.".to_string(),
            workshop: "Du agierst als Meister des Tonmisch-Handwerks. Führe eine ganzheitliche psychoakustische Diagnose durch: Prüfe Maskierungseffekte im Bass- und Tiefmittenbereich, Phasenkorrelation bei Stereoverbreiterung, Crest-Faktor für Dynamikerhalt und die Einhaltung des maximalen True Peak von -1.0 dBTP.".to_string(),
        },
        created_at: 1759276800000,
        updated_at: 1759276800000,
    }
}

/// Ensures the default Tonmischmeister seed skill exists in the specified directory
pub fn ensure_seed_skill_in_dir(dir: &PathBuf) -> Result<(), String> {
    if !dir.exists() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Fehler beim Erstellen des Ordners '{}': {}", dir.display(), e))?;
    }

    let seed_file = dir.join("tonmischmeister.json");
    if !seed_file.exists() {
        let seed = get_seed_tonmischmeister_skill();
        let json_str = serde_json::to_string_pretty(&seed)
            .map_err(|e| format!("Fehler beim Serialisieren des Seed-Skills: {}", e))?;
        std::fs::write(&seed_file, format!("{}\n", json_str))
            .map_err(|e| format!("Fehler beim Schreiben von '{}': {}", seed_file.display(), e))?;
    }
    Ok(())
}

/// Saves a mixing skill to `~/.mixing-buddy/skills/<slug>.json`
pub fn save_mixing_skill_sync(skill: MixingSkill) -> Result<PathBuf, String> {
    let dir = get_skill_vault_dir()?;
    save_mixing_skill_to_dir(&dir, skill)
}

pub fn save_mixing_skill_to_dir(dir: &PathBuf, mut skill: MixingSkill) -> Result<PathBuf, String> {
    if !dir.exists() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Fehler beim Erstellen des Ordners '{}': {}", dir.display(), e))?;
    }

    let slug = to_skill_slug(&skill.id);
    skill.id = slug.clone();
    skill.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(skill.updated_at);

    let target = dir.join(format!("{}.json", slug));
    let json_str = serde_json::to_string_pretty(&skill)
        .map_err(|e| format!("Fehler beim Serialisieren des Skills: {}", e))?;

    std::fs::write(&target, format!("{}\n", json_str))
        .map_err(|e| format!("Fehler beim Schreiben von '{}': {}", target.display(), e))?;

    Ok(target)
}

/// Lists all available mixing skills as lightweight summaries
pub fn list_mixing_skills_sync() -> Result<Vec<MixingSkillSummary>, String> {
    let dir = get_skill_vault_dir()?;
    list_mixing_skills_from_dir(&dir)
}

pub fn list_mixing_skills_from_dir(dir: &PathBuf) -> Result<Vec<MixingSkillSummary>, String> {
    ensure_seed_skill_in_dir(dir)?;

    let mut summaries = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Fehler beim Lesen des Skill-Ordners '{}': {}", dir.display(), e))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if let Ok(skill) = serde_json::from_str::<MixingSkill>(&content) {
                summaries.push(MixingSkillSummary {
                    id: skill.id,
                    name: skill.name,
                    category: skill.category,
                    is_favorite: skill.is_favorite,
                    version: skill.version,
                    chain_slots_count: skill.preferred_chain.len(),
                    updated_at: skill.updated_at,
                    file_path: Some(path.to_string_lossy().to_string()),
                });
            }
        }
    }

    // Sort: favorites first, then newest updated first
    summaries.sort_by(|a, b| {
        b.is_favorite
            .cmp(&a.is_favorite)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });

    Ok(summaries)
}

/// Gets a specific mixing skill from `~/.mixing-buddy/skills/<id>.json`
pub fn get_mixing_skill_sync(id: String) -> Result<MixingSkill, String> {
    let dir = get_skill_vault_dir()?;
    get_mixing_skill_from_dir(&dir, id)
}

pub fn get_mixing_skill_from_dir(dir: &PathBuf, id: String) -> Result<MixingSkill, String> {
    ensure_seed_skill_in_dir(dir)?;

    let slug = to_skill_slug(&id);
    let mut file_path = dir.join(format!("{}.json", slug));

    if !file_path.exists() {
        let direct_path = dir.join(format!("{}.json", id));
        if direct_path.exists() {
            file_path = direct_path;
        } else {
            return Err(format!("Skill '{}' wurde nicht gefunden in '{}'", id, dir.display()));
        }
    }

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Fehler beim Lesen von '{}': {}", file_path.display(), e))?;

    let skill: MixingSkill = serde_json::from_str(&content)
        .map_err(|e| format!("Fehler beim Parsen von '{}': {}", file_path.display(), e))?;

    Ok(skill)
}

/// Deletes a mixing skill from `~/.mixing-buddy/skills/<id>.json`
pub fn delete_mixing_skill_sync(id: String) -> Result<(), String> {
    let dir = get_skill_vault_dir()?;
    delete_mixing_skill_from_dir(&dir, id)
}

pub fn delete_mixing_skill_from_dir(dir: &PathBuf, id: String) -> Result<(), String> {
    let slug = to_skill_slug(&id);
    let mut file_path = dir.join(format!("{}.json", slug));

    if !file_path.exists() {
        let direct = dir.join(format!("{}.json", id));
        if direct.exists() {
            file_path = direct;
        } else {
            return Err(format!("Skill '{}' nicht gefunden zum Löschen", id));
        }
    }

    std::fs::remove_file(&file_path)
        .map_err(|e| format!("Fehler beim Löschen von '{}': {}", file_path.display(), e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_skill_slug() {
        assert_eq!(to_skill_slug("Tonmischmeister"), "tonmischmeister");
        assert_eq!(to_skill_slug("Vocal Magic v2!"), "vocal-magic-v2");
        assert_eq!(to_skill_slug("808_Sub_Crusher"), "808-sub-crusher");
        assert_eq!(to_skill_slug("   "), "custom-mixing-skill");
    }

    #[test]
    fn test_seed_and_crud_cycle() {
        let temp_dir = std::env::temp_dir().join(format!("test_skill_vault_{}", std::time::SystemTime::now().elapsed().unwrap().as_nanos()));
        let _ = std::fs::remove_dir_all(&temp_dir);

        // 1. Ensure seed
        ensure_seed_skill_in_dir(&temp_dir).expect("Seed creation failed");
        let list = list_mixing_skills_from_dir(&temp_dir).expect("Listing failed");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "tonmischmeister");
        assert_eq!(list[0].is_favorite, true);

        // 2. Get seed
        let seed = get_mixing_skill_from_dir(&temp_dir, "tonmischmeister".to_string()).expect("Get seed failed");
        assert_eq!(seed.name, "Tonmischmeister");
        assert_eq!(seed.preferred_chain.len(), 5);

        // 3. Save new custom skill
        let mut custom = seed.clone();
        custom.id = "vocal-air".to_string();
        custom.name = "Vocal Air Sheen".to_string();
        custom.category = "vocal".to_string();
        custom.is_favorite = false;

        save_mixing_skill_to_dir(&temp_dir, custom).expect("Save failed");
        let updated_list = list_mixing_skills_from_dir(&temp_dir).expect("Listing 2 failed");
        assert_eq!(updated_list.len(), 2);
        // Favorite tonmischmeister should be first
        assert_eq!(updated_list[0].id, "tonmischmeister");
        assert_eq!(updated_list[1].id, "vocal-air");

        // 4. Delete custom skill
        delete_mixing_skill_from_dir(&temp_dir, "vocal-air".to_string()).expect("Delete failed");
        let final_list = list_mixing_skills_from_dir(&temp_dir).expect("Listing 3 failed");
        assert_eq!(final_list.len(), 1);
        assert_eq!(final_list[0].id, "tonmischmeister");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
