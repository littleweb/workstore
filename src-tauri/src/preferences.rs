use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    #[serde(default = "enabled")]
    pub maximize_on_start: bool,
    #[serde(default)]
    pub github_sync_enabled: bool,
    #[serde(default)]
    pub github_repo_url: String,
    #[serde(default = "default_branch")]
    pub github_sync_branch: String,
    #[serde(default)]
    pub github_token: String,
}

fn enabled() -> bool {
    true
}

fn default_branch() -> String {
    "main".into()
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            maximize_on_start: enabled(),
            github_sync_enabled: false,
            github_repo_url: String::new(),
            github_sync_branch: default_branch(),
            github_token: String::new(),
        }
    }
}

pub fn load(config: &Path) -> Result<Preferences, String> {
    match fs::read(config.join("preferences.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
        Err(e) => Err(e.to_string()),
    }
}
pub fn save(config: &Path, preferences: &Preferences) -> Result<(), String> {
    crate::storage::atomic_write(
        &config.join("preferences.json"),
        &serde_json::to_vec_pretty(preferences).map_err(|e| e.to_string())?,
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_preference_defaults_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load(dir.path()).unwrap().maximize_on_start);
        save(
            dir.path(),
            &Preferences {
                maximize_on_start: false,
                github_sync_enabled: false,
                github_repo_url: String::new(),
                github_sync_branch: "main".into(),
                github_token: String::new(),
            },
        )
        .unwrap();
        assert!(!load(dir.path()).unwrap().maximize_on_start);
        fs::write(dir.path().join("preferences.json"), "broken").unwrap();
        assert!(load(dir.path()).is_err());
    }
}
