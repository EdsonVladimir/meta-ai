//! Saved workspaces (recents): validation and pure list updates.
//!
//! Touch matches by id when reopening a known entry, otherwise by
//! identical root-path set, so restoring the same folders never
//! duplicates the list. References only: labels, project ids and
//! paths; file contents are never stored here.

use ruth_store::{StoredRecent, MAX_RECENT_WORKSPACES};

use crate::error::ApiError;

/// Longest accepted workspace label (chars, trimmed).
pub const MAX_RECENT_LABEL_CHARS: usize = 120;
/// Most root paths kept per entry.
pub const MAX_RECENT_PATHS: usize = 32;
/// Longest accepted single path (chars, trimmed).
pub const MAX_RECENT_PATH_CHARS: usize = 1024;

fn invalid(message: impl Into<String>) -> ApiError {
    ApiError::coded("recent_invalid", message)
}

/// Validated touch payload: trimmed label, deduplicated paths.
pub struct RecentTouch {
    pub label: String,
    pub project_id: Option<String>,
    pub root_paths: Vec<String>,
}

/// Validates a touch request. Empty paths are allowed (a project
/// without code yet); empty labels and oversized payloads are not.
pub fn validate_touch(
    label: &str,
    project_id: Option<String>,
    root_paths: Vec<String>,
) -> Result<RecentTouch, ApiError> {
    let label = label.trim();
    if label.is_empty() {
        return Err(invalid("the workspace needs a label"));
    }
    if label.chars().count() > MAX_RECENT_LABEL_CHARS {
        return Err(invalid("the label is too long"));
    }
    let mut paths = Vec::new();
    for raw in root_paths {
        let path = raw.trim().to_string();
        if path.is_empty() {
            continue;
        }
        if path.chars().count() > MAX_RECENT_PATH_CHARS {
            return Err(invalid("a root path is too long"));
        }
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    if paths.len() > MAX_RECENT_PATHS {
        return Err(invalid("too many root paths"));
    }
    Ok(RecentTouch {
        label: label.to_string(),
        project_id: project_id
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty()),
        root_paths: paths,
    })
}

fn path_set(paths: &[String]) -> Vec<String> {
    let mut sorted = paths.to_vec();
    sorted.sort();
    sorted
}

/// Applies a touch to the list: same id wins, otherwise same path
/// set reuses the entry (keeping id and creation time); anything
/// else is appended. Sorted by last_opened, newest first, pruned
/// to the kept cap.
pub fn apply_touch(recents: &[StoredRecent], entry: StoredRecent) -> Vec<StoredRecent> {
    let mut next: Vec<StoredRecent> = Vec::with_capacity(recents.len() + 1);
    let mut placed = false;
    for recent in recents {
        if !placed
            && (recent.id == entry.id
                || path_set(&recent.root_paths) == path_set(&entry.root_paths))
        {
            placed = true;
            next.push(StoredRecent {
                id: recent.id.clone(),
                created_at: recent.created_at.clone(),
                ..entry.clone()
            });
        } else {
            next.push(recent.clone());
        }
    }
    if !placed {
        next.push(entry);
    }
    next.sort_by(|a, b| {
        b.last_opened
            .cmp(&a.last_opened)
            .then_with(|| b.id.cmp(&a.id))
    });
    next.truncate(MAX_RECENT_WORKSPACES);
    next
}

/// Removes one entry by id. Unknown ids are a no-op, never an error.
pub fn apply_remove(recents: &[StoredRecent], id: &str) -> Vec<StoredRecent> {
    recents
        .iter()
        .filter(|recent| recent.id != id)
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, paths: &[&str], opened: &str) -> StoredRecent {
        StoredRecent {
            id: id.to_string(),
            label: format!("label-{id}"),
            project_id: None,
            root_paths: paths.iter().map(|p| p.to_string()).collect(),
            last_opened: opened.to_string(),
            created_at: "2026-10-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn touch_validates_and_dedupes() {
        let touch = validate_touch(
            "  Shop  ",
            Some("proy-1".to_string()),
            vec![
                "/b".to_string(),
                "/a".to_string(),
                "/b".to_string(),
                " ".to_string(),
            ],
        )
        .expect("valid");
        assert_eq!(touch.label, "Shop");
        assert_eq!(touch.root_paths, vec!["/b".to_string(), "/a".to_string()]);
        assert!(validate_touch("  ", None, vec![]).is_err());
        assert!(validate_touch(&"x".repeat(121), None, vec![]).is_err());
        assert!(validate_touch("ok", None, vec!["x".repeat(1025)]).is_err());
    }

    #[test]
    fn touch_reuses_same_paths_without_duplicating() {
        let list = vec![entry("ws-1", &["/a", "/b"], "2026-10-28T00:00:00Z")];
        let touched = StoredRecent {
            label: "renamed".to_string(),
            last_opened: "2026-10-29T00:00:00Z".to_string(),
            ..entry("ws-9", &["/b", "/a"], "2026-10-29T00:00:00Z")
        };
        let next = apply_touch(&list, touched);
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].id, "ws-1");
        assert_eq!(next[0].label, "renamed");
        assert_eq!(next[0].created_at, "2026-10-01T00:00:00Z");
    }

    #[test]
    fn touch_appends_and_sorts_newest_first() {
        let list = vec![entry("ws-1", &["/a"], "2026-10-28T00:00:00Z")];
        let next = apply_touch(&list, entry("ws-2", &["/b"], "2026-10-29T00:00:00Z"));
        assert_eq!(next.len(), 2);
        assert_eq!(next[0].id, "ws-2");
    }

    #[test]
    fn remove_is_idempotent() {
        let list = vec![entry("ws-1", &["/a"], "2026-10-28T00:00:00Z")];
        assert!(apply_remove(&list, "ws-9").len() == 1);
        assert!(apply_remove(&list, "ws-1").is_empty());
    }
}
