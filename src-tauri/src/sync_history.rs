//! Immutable, Git-tracked history is outside tool directories. Conflicting
//! versions are recoverable without becoming extra documents in the navigation.
use crate::sync::Files;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const PREFIX: &str = ".workstore-history/sync/";
const COPY_SUFFIX: &str = "（冲突副本）";
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Version {
    schema_version: u32,
    source_path: String,
    reason: String,
    content_base64: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    primary_path: Option<String>,
}

pub fn archive(files: &mut Files, name: &str, bytes: &[u8], reason: &str, primary: Option<&str>) {
    let version = Version {
        schema_version: 1, source_path: name.into(), reason: reason.into(),
        content_base64: STANDARD.encode(bytes), primary_path: primary.map(str::to_owned),
    };
    let bytes = serde_json::to_vec_pretty(&version).expect("history serialization");
    let digest = Sha256::digest(&bytes);
    files.insert(format!("{PREFIX}{digest:x}.json"), bytes);
}

pub fn valid(name: &str, bytes: &[u8]) -> bool {
    name == format!("{PREFIX}{:x}.json", Sha256::digest(bytes)) &&
        serde_json::from_slice::<Version>(bytes).is_ok_and(|version| {
            version.schema_version == 1 && STANDARD.decode(version.content_base64).is_ok()
        })
}

fn document(name: &str, bytes: &[u8]) -> Option<Value> {
    let (folder, suffix, kind) = if name.starts_with("data/app.doc/") {
        ("data/app.doc", ".doc.json", "workstore.document")
    } else if name.starts_with("data/app.whiteboard/") {
        ("data/app.whiteboard", ".whiteboard.json", "workstore.whiteboard")
    } else if name.starts_with("data/app.comic/") {
        ("data/app.comic", ".comic.json", "workstore.comic")
    } else { return None; };
    let value: Value = serde_json::from_slice(bytes).ok()?;
    let id = value["id"].as_str()?;
    uuid::Uuid::parse_str(id).ok()?;
    (value["schemaVersion"] == 1 && value["type"] == kind &&
        name == format!("{folder}/{id}{suffix}")).then_some(value)
}

/// Only collapse an unambiguous legacy copy family. The old format did not
/// store its original ID, so same-title alone is never enough to delete a file.
/// An immutable mapping also retires copies that older devices later resend.
pub fn normalize(files: &mut Files) -> usize {
    let mut retired = BTreeMap::new();
    for (name, bytes) in files.iter().filter(|(name, _)| name.starts_with(PREFIX)) {
        if let Ok(version) = serde_json::from_slice::<Version>(bytes) {
            if version.schema_version == 1 && version.reason == "legacy-copy" &&
                *name == format!("{PREFIX}{:x}.json", Sha256::digest(bytes)) &&
                STANDARD.decode(&version.content_base64).ok()
                    .and_then(|bytes| document(&version.source_path, &bytes))
                    .is_some_and(|value| value["title"].as_str().is_some_and(|title| title.ends_with(COPY_SUFFIX)))
            {
                if let Some(primary) = version.primary_path {
                    if primary != version.source_path {
                        retired.insert(version.source_path, primary);
                    }
                }
            }
        }
    }
    let documents: Vec<_> = files.iter().filter_map(|(name, bytes)| {
        document(name, bytes).map(|value| (name.clone(), bytes.clone(), value))
    }).collect();
    let mut count = 0;
    for (name, bytes, value) in &documents {
        let original_title = value["title"].as_str().and_then(|title| title.strip_suffix(COPY_SUFFIX));
        let candidates: Vec<_> = documents.iter().filter(|(other, _, candidate)| {
            other != name && original_title.is_some() &&
            candidate["type"] == value["type"] && value["createdAt"].as_u64().is_some() &&
            candidate["createdAt"] == value["createdAt"] &&
            candidate["title"].as_str().is_some_and(|title| !title.ends_with(COPY_SUFFIX) &&
                Some(title.chars().take(100).collect::<String>().as_str()) == original_title)
        }).collect();
        let primary = retired.get(name).cloned().or_else(|| {
            (candidates.len() == 1).then(|| candidates[0].0.clone())
        });
        if let Some(primary) = primary {
            // Preserve the exact source bytes before retiring the visible file.
            archive(files, name, bytes, "legacy-copy", Some(&primary));
            files.remove(name);
            count += 1;
        }
    }
    // Generic conflicts were never tool documents; move them into the same
    // immutable namespace, retaining every byte as well.
    let generic: Vec<_> = files.iter().filter(|(name, _)| name.starts_with("conflicts/") &&
        name.strip_prefix("conflicts/").and_then(|s| s.strip_suffix(".json"))
            .is_some_and(|digest| digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit())))
        .map(|(name, bytes)| (name.clone(), bytes.clone())).collect();
    for (name, bytes) in generic {
        archive(files, &name, &bytes, "legacy-generic", None);
        files.remove(&name);
        count += 1;
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    fn doc(id: &str, title: &str, created: u64, content: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"id":id,"type":"workstore.document","schemaVersion":1,
            "title":title,"createdAt":created,"content":content})).unwrap()
    }
    #[test]
    fn legacy_copy_is_archived_exactly_without_changing_primary_and_does_not_reappear() {
        let a = uuid::Uuid::new_v4().to_string(); let b = uuid::Uuid::new_v4().to_string();
        let primary = format!("data/app.doc/{a}.doc.json");
        let copy = format!("data/app.doc/{b}.doc.json");
        let bytes = doc(&b,"Title（冲突副本）",7,"different valuable text");
        let mut files = Files::from([(primary.clone(),doc(&a,"Title",7,"current")),(copy.clone(),bytes.clone())]);
        let main = files[&primary].clone();
        assert_eq!(normalize(&mut files),1);
        assert_eq!(files[&primary],main); assert!(!files.contains_key(&copy));
        let history: Version = serde_json::from_slice(files.iter().find(|(p,_)|p.starts_with(PREFIX)).unwrap().1).unwrap();
        assert_eq!(STANDARD.decode(history.content_base64).unwrap(),bytes);
        let clean = files.clone(); assert_eq!(normalize(&mut files),0); assert_eq!(clean,files);
        let edited = doc(&b,"Renamed on an old device",7,"more edits");
        files.insert(copy.clone(),edited.clone());
        assert_eq!(normalize(&mut files),1); assert!(!files.contains_key(&copy));
        assert!(files.values().filter_map(|bytes|serde_json::from_slice::<Version>(bytes).ok())
            .any(|v|STANDARD.decode(v.content_base64).unwrap()==edited));
    }
    #[test]
    fn unrelated_or_ambiguous_titles_are_not_automatically_removed() {
        let a=uuid::Uuid::new_v4().to_string(); let b=uuid::Uuid::new_v4().to_string();
        let mut files=Files::from([(format!("data/app.doc/{a}.doc.json"),doc(&a,"Title",1,"a")),
            (format!("data/app.doc/{b}.doc.json"),doc(&b,"Title（冲突副本）",2,"b"))]);
        let before=files.clone(); assert_eq!(normalize(&mut files),0); assert_eq!(files,before);
    }
}
