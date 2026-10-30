//! Code workspace: local roots, file listing and reading.
//!
//! A workspace holds several local folders picked by the person
//! (frontend, backend…), which may belong to different repositories.
//! This crate does NOT merge repositories or assume shared Git: each
//! root is independent and identified by a stable ID (`root-N`).
//!
//! Security in this first version:
//! - The frontend only sends a root ID + a relative path; Rust
//!   resolves absolute paths.
//! - `resolve_within` rejects escapes (`..`, absolute paths, prefixes
//!   leaving the root) and any symlink along the way.
//! - This does NOT limit what the terminal runs: it is file-API
//!   confinement, not a process sandbox.
//!
//! Explicit limits: directories excluded by name, a cap on entries per
//! listing, a cap on bytes per read and binary rejection (a NUL byte in
//! the first 8 KiB) without loading them fully.

use std::fmt;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub mod structure;

pub use structure::{analyze_rust_files, fnv1a_hex};

/// Directories excluded from the tree by name (initial policy).
pub const EXCLUDED_DIR_NAMES: &[&str] = &[".git", "node_modules", "target", "dist"];

/// Maximum entries per directory listing; the rest truncates.
pub const MAX_DIR_ENTRIES: usize = 500;

/// Maximum bytes per file read.
pub const MAX_FILE_BYTES: usize = 256 * 1024;

/// Binary-detection window (NUL byte = binary).
pub const BINARY_SNIFF_BYTES: usize = 8 * 1024;

/// Typed file-API error, with a stable code for the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeError {
    kind: &'static str,
    message: String,
}

impl CodeError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// Stable code (`code_*`) so the UI tells cases apart.
    pub fn kind(&self) -> &'static str {
        self.kind
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn root_not_found(id: &str) -> Self {
        Self::new(
            "code_root_not_found",
            format!("Folder \"{id}\" outside the workspace"),
        )
    }

    pub fn root_missing(path: &str) -> Self {
        Self::new(
            "code_root_missing",
            format!("Folder \"{path}\" no longer exists on disk"),
        )
    }

    pub fn not_found(rel: &str) -> Self {
        Self::new("code_not_found", format!("\"{rel}\" does not exist"))
    }

    pub fn escape() -> Self {
        Self::new("code_escape", "The path leaves the root folder")
    }

    pub fn symlink() -> Self {
        Self::new("code_symlink", "Symlinks are not followed in this version")
    }

    pub fn not_dir(rel: &str) -> Self {
        Self::new("code_not_dir", format!("\"{rel}\" is not a directory"))
    }

    pub fn not_file(rel: &str) -> Self {
        Self::new("code_not_file", format!("\"{rel}\" is not a file"))
    }

    pub fn binary(rel: &str) -> Self {
        Self::new(
            "code_binary",
            format!("\"{rel}\" looks binary and cannot be shown as text"),
        )
    }

    pub fn too_large(rel: &str, limit: usize) -> Self {
        Self::new(
            "code_too_large",
            format!("\"{rel}\" exceeds the {limit} byte limit"),
        )
    }

    pub fn invalid_utf8(rel: &str) -> Self {
        Self::new(
            "code_invalid_utf8",
            format!("\"{rel}\" is not valid UTF-8 text"),
        )
    }

    pub fn conflict(rel: &str) -> Self {
        Self::new(
            "code_conflict",
            format!("\"{rel}\" changed on disk since the read"),
        )
    }

    pub fn already_exists(rel: &str) -> Self {
        Self::new(
            "code_conflict",
            format!("\"{rel}\" already exists and is not overwritten"),
        )
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new("code_io", message)
    }

    pub fn not_a_directory(path: &str) -> Self {
        Self::new(
            "code_not_a_directory",
            format!("\"{path}\" is not a folder"),
        )
    }
}

impl fmt::Display for CodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for CodeError {}

/// Code workspace root folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeRoot {
    /// Stable identifier (`root-N`), assigned on add.
    pub id: String,
    /// Absolute path as added (without resolving links).
    pub path: String,
    /// Visible name (last segment by default).
    pub name: String,
    /// Associated Ruth project (`None` = loose folder, no project).
    /// Linking writes nothing in the repository and merges nothing:
    /// it is a local workspace-to-domain pointer.
    pub project_id: Option<String>,
}

/// In-memory root set, a mirror of the last confirmed commit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CodeWorkspace {
    roots: Vec<CodeRoot>,
}

impl CodeWorkspace {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_roots(roots: Vec<CodeRoot>) -> Self {
        Self { roots }
    }

    pub fn roots(&self) -> &[CodeRoot] {
        &self.roots
    }

    pub fn get(&self, id: &str) -> Option<&CodeRoot> {
        self.roots.iter().find(|r| r.id == id)
    }

    /// Adds an already-validated root (it exists and is a directory). The
    /// same path can be added only once; removing it deletes no files.
    pub fn add(&mut self, root: CodeRoot) -> Result<(), CodeError> {
        if self.roots.iter().any(|r| r.id == root.id) {
            return Err(CodeError::io(format!(
                "Folder \"{}\" is already in the workspace",
                root.id
            )));
        }
        self.roots.push(root);
        Ok(())
    }

    /// Removes a root from the workspace. Never deletes files on disk.
    pub fn remove(&mut self, id: &str) -> Result<CodeRoot, CodeError> {
        let pos = self
            .roots
            .iter()
            .position(|r| r.id == id)
            .ok_or_else(|| CodeError::root_not_found(id))?;
        Ok(self.roots.remove(pos))
    }
}

/// Class of a directory entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Dir,
    /// Symlink or other special kind: shown but neither opened nor
    /// traversed in this version.
    Other,
}

/// A directory listing entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirEntry {
    pub name: String,
    /// Path relative to the root, with `/` as separator.
    pub rel: String,
    pub kind: EntryKind,
    pub size: Option<u64>,
}

/// A directory listing, with an explicit truncation notice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirListing {
    pub entries: Vec<DirEntry>,
    pub truncated: bool,
}

/// Content read from a text file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileContent {
    pub text: String,
    /// Opaque fingerprint (size + mtime) to detect external changes
    /// before saving. Not a content hash.
    pub fingerprint: String,
    pub size: u64,
}

/// Normalizes a relative path and confines it to the root.
///
/// Rejects absolute paths, `..` components leaving the root and any
/// symlink along the way (without following it). The root must exist;
/// otherwise `root_missing` (a clear error, without deleting the
/// workspace root: the person decides that).
pub fn resolve_within(root: &Path, rel: &str) -> Result<PathBuf, CodeError> {
    if !root.is_dir() {
        return Err(CodeError::root_missing(&root.display().to_string()));
    }
    let normalized = normalize_rel(rel)?;
    let mut current = root.to_path_buf();
    for component in normalized.components() {
        let name = match component {
            Component::Normal(name) => name,
            _ => return Err(CodeError::escape()),
        };
        current.push(name);
        // `symlink_metadata` does not follow the link: when it is one,
        // it rejects before the next component escapes through it.
        let meta = fs::symlink_metadata(&current)
            .map_err(|_| CodeError::not_found(&display_rel(&normalized)))?;
        if meta.file_type().is_symlink() {
            return Err(CodeError::symlink());
        }
    }
    // The canonical root + normal components without links guarantees
    // confinement; this final check is defense in depth.
    let canonical_root = root
        .canonicalize()
        .map_err(|_| CodeError::root_missing(&root.display().to_string()))?;
    let canonical_current = current
        .canonicalize()
        .map_err(|_| CodeError::not_found(&display_rel(&normalized)))?;
    if !canonical_current.starts_with(&canonical_root) {
        return Err(CodeError::escape());
    }
    Ok(current)
}

/// Resolves the PARENT directory of `rel` inside the root and returns
/// (absolute parent, final name). Only for creating new files: the
/// parent must exist as a real directory (without creating it or
/// following links), the name is a single component and any `..` or
/// trailing slash rejects without normalizing (strict as a creation
/// primitive; proposal validation already requires it).
fn resolve_parent_within(root: &Path, rel: &str) -> Result<(PathBuf, String), CodeError> {
    if !root.is_dir() {
        return Err(CodeError::root_missing(&root.display().to_string()));
    }
    if rel.ends_with('/') || rel.split('/').any(|segment| segment == "..") {
        return Err(CodeError::escape());
    }
    let normalized = normalize_rel(rel)?;
    let name = normalized
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(CodeError::escape)?;
    let mut current = root.to_path_buf();
    if let Some(parent) = normalized.parent() {
        for component in parent.components() {
            let piece = match component {
                Component::Normal(piece) => piece,
                _ => return Err(CodeError::escape()),
            };
            current.push(piece);
            let meta = fs::symlink_metadata(&current)
                .map_err(|_| CodeError::not_found(&display_rel(&normalized)))?;
            if meta.file_type().is_symlink() {
                return Err(CodeError::symlink());
            }
            if !meta.file_type().is_dir() {
                return Err(CodeError::not_dir(&display_rel(&normalized)));
            }
        }
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|_| CodeError::root_missing(&root.display().to_string()))?;
    let canonical_parent = current
        .canonicalize()
        .map_err(|_| CodeError::not_found(&display_rel(&normalized)))?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err(CodeError::escape());
    }
    Ok((current, name.to_string()))
}

/// Normalizes `rel` to a relative path without `.`, escaping `..` or root.
fn normalize_rel(rel: &str) -> Result<PathBuf, CodeError> {
    if rel.is_empty() {
        return Ok(PathBuf::new());
    }
    let path = Path::new(rel);
    if path.is_absolute() {
        return Err(CodeError::escape());
    }
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(name) => out.push(name),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return Err(CodeError::escape());
                }
            }
            _ => return Err(CodeError::escape()),
        }
    }
    Ok(out)
}

fn display_rel(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        return ".".to_string();
    }
    path.display().to_string()
}

fn rel_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| {
            p.components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

/// Lists a directory on demand, without walking the whole tree.
///
/// Stable order (directories first, then case-insensitive
/// alphabetical). Excludes the `EXCLUDED_DIR_NAMES` directories and
/// symlinks (these show as `Other`, without following them).
/// Past `MAX_DIR_ENTRIES`, it truncates with notice.
pub fn list_dir(root: &Path, rel: &str) -> Result<DirListing, CodeError> {
    let dir = resolve_within(root, rel)?;
    if !dir.is_dir() {
        return Err(CodeError::not_dir(rel));
    }
    let mut entries = Vec::new();
    let mut truncated = false;
    let read = fs::read_dir(&dir).map_err(|e| CodeError::io(e.to_string()))?;
    for entry in read {
        let entry = entry.map_err(|e| CodeError::io(e.to_string()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let file_type = entry
            .file_type()
            .map_err(|e| CodeError::io(e.to_string()))?;
        if file_type.is_dir() && EXCLUDED_DIR_NAMES.contains(&name.as_str()) {
            continue;
        }
        let kind = if file_type.is_symlink() {
            EntryKind::Other
        } else if file_type.is_dir() {
            EntryKind::Dir
        } else if file_type.is_file() {
            EntryKind::File
        } else {
            EntryKind::Other
        };
        let size = if kind == EntryKind::File {
            entry.metadata().ok().map(|m| m.len())
        } else {
            None
        };
        if entries.len() >= MAX_DIR_ENTRIES {
            truncated = true;
            continue;
        }
        entries.push(DirEntry {
            name,
            rel: rel_string(root, &entry.path()),
            kind,
            size,
        });
    }
    entries.sort_by(|a, b| {
        let rank = |kind: EntryKind| match kind {
            EntryKind::Dir => 0,
            EntryKind::File => 1,
            EntryKind::Other => 2,
        };
        rank(a.kind)
            .cmp(&rank(b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(DirListing { entries, truncated })
}

/// Reads a file as UTF-8 text, with explicit limits.
///
/// - Rejects binaries (a NUL byte in the first 8 KiB) and files over
///   `MAX_FILE_BYTES`, without loading them fully.
/// - Rejects invalid UTF-8.
/// - Returns a fingerprint (size + mtime nanos) so saving detects
///   external changes.
pub fn read_file(root: &Path, rel: &str) -> Result<FileContent, CodeError> {
    use std::io::Read;
    let path = resolve_within(root, rel)?;
    let meta = fs::symlink_metadata(&path).map_err(|_| CodeError::not_found(rel))?;
    if !meta.file_type().is_file() {
        return Err(CodeError::not_file(rel));
    }
    if meta.len() > MAX_FILE_BYTES as u64 {
        return Err(CodeError::too_large(rel, MAX_FILE_BYTES));
    }
    let mut file = fs::File::open(&path).map_err(|e| CodeError::io(e.to_string()))?;
    let mut head = vec![0u8; BINARY_SNIFF_BYTES.min(meta.len() as usize)];
    file.read_exact(&mut head)
        .map_err(|e| CodeError::io(e.to_string()))?;
    if head.contains(&0) {
        return Err(CodeError::binary(rel));
    }
    let mut rest = Vec::new();
    file.read_to_end(&mut rest)
        .map_err(|e| CodeError::io(e.to_string()))?;
    head.extend_from_slice(&rest);
    // Defense in depth: the file may have grown between `metadata`
    // and the read.
    if head.len() > MAX_FILE_BYTES {
        return Err(CodeError::too_large(rel, MAX_FILE_BYTES));
    }
    // NUL is only sniffed in the head: long text without an initial
    // NUL but with a later NUL is not valid UTF-8 and falls below.
    let text = String::from_utf8(head).map_err(|_| CodeError::invalid_utf8(rel))?;
    if text.as_bytes().contains(&0) {
        return Err(CodeError::binary(rel));
    }
    let fingerprint = fingerprint_of(&meta);
    Ok(FileContent {
        text,
        fingerprint,
        size: meta.len(),
    })
}

fn fingerprint_of(meta: &fs::Metadata) -> String {
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}:{mtime}", meta.len())
}

/// A write outcome: a new fingerprint to keep editing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteOutcome {
    pub fingerprint: String,
    pub size: u64,
}

/// Saves text into an existing file, without overwriting blindly.
///
/// - Only existing, regular files (this version creates no files):
///   anything else rejects like on read.
/// - Unless `force`, the fingerprint must match the read one; when the
///   file changed outside, `code_conflict` and nothing is touched.
/// - Content respects the same cap as reading and admits no NUL bytes
///   (they would make the next read unreadable).
/// - Atomic write: a temp file in the same directory + rename; the
///   original permissions are kept. On failure nothing is left
///   half-done and the temp file is removed.
/// - Hard links: the rename replaces the directory entry, so other hard
///   links keep the previous content. Writing "through" the link or
///   preserving the inode is not supported.
pub fn write_file(
    root: &Path,
    rel: &str,
    expected_fingerprint: &str,
    content: &str,
    force: bool,
) -> Result<WriteOutcome, CodeError> {
    let path = resolve_within(root, rel)?;
    let meta = fs::symlink_metadata(&path).map_err(|_| CodeError::not_found(rel))?;
    if !meta.file_type().is_file() {
        return Err(CodeError::not_file(rel));
    }
    if !force && fingerprint_of(&meta) != expected_fingerprint {
        return Err(CodeError::conflict(rel));
    }
    if content.len() > MAX_FILE_BYTES {
        return Err(CodeError::too_large(rel, MAX_FILE_BYTES));
    }
    if content.as_bytes().contains(&0) {
        return Err(CodeError::binary(rel));
    }
    let parent = path.parent().ok_or_else(|| CodeError::not_found(rel))?;
    let temp = parent.join(format!(
        ".ruth-tmp-{}-{}",
        std::process::id(),
        temp_counter()
    ));
    let wrote = (|| -> Result<(), CodeError> {
        fs::write(&temp, content).map_err(|e| CodeError::io(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = meta.permissions().mode();
            fs::set_permissions(&temp, fs::Permissions::from_mode(mode))
                .map_err(|e| CodeError::io(e.to_string()))?;
        }
        #[cfg(not(unix))]
        {
            fs::set_permissions(&temp, meta.permissions())
                .map_err(|e| CodeError::io(e.to_string()))?;
        }
        fs::rename(&temp, &path).map_err(|e| CodeError::io(e.to_string()))?;
        Ok(())
    })();
    if wrote.is_err() {
        let _ = fs::remove_file(&temp);
    }
    wrote?;
    let after = fs::symlink_metadata(&path).map_err(|e| CodeError::io(e.to_string()))?;
    Ok(WriteOutcome {
        fingerprint: fingerprint_of(&after),
        size: after.len(),
    })
}

fn temp_counter() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    COUNTER.fetch_add(1, Ordering::SeqCst)
}

/// Checks whether the read fingerprint is still current on disk.
pub fn fingerprint_matches(root: &Path, rel: &str, expected: &str) -> Result<bool, CodeError> {
    let path = resolve_within(root, rel)?;
    let meta = fs::symlink_metadata(&path).map_err(|_| CodeError::not_found(rel))?;
    if !meta.file_type().is_file() {
        return Err(CodeError::not_file(rel));
    }
    Ok(fingerprint_of(&meta) == expected)
}

/// Checks whether something exists at `rel`, without reading it. To
/// decide creations: `Ok(true)` = exists (file or not), `Ok(false)` =
/// missing with a valid parent, `Err` = missing root, escape or broken parent.
pub fn file_exists(root: &Path, rel: &str) -> Result<bool, CodeError> {
    let (parent, name) = resolve_parent_within(root, rel)?;
    match fs::symlink_metadata(parent.join(name)) {
        Ok(_) => Ok(true),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(CodeError::io(err.to_string())),
    }
}

/// Creates a new file with an atomic write (temp + rename in the same
/// directory). Only for accepting proposals: it fails when the target
/// exists (never overwrites), when the parent directory is missing (it
/// creates no folders) or when the path escapes the root. Permissions
/// are the process ones (umask); there is no original to copy.
pub fn create_file(root: &Path, rel: &str, content: &str) -> Result<WriteOutcome, CodeError> {
    if content.len() > MAX_FILE_BYTES {
        return Err(CodeError::too_large(rel, MAX_FILE_BYTES));
    }
    if content.as_bytes().contains(&0) {
        return Err(CodeError::binary(rel));
    }
    let (parent, name) = resolve_parent_within(root, rel)?;
    let path = parent.join(&name);
    // Atomic target reservation: when it exists (or appears in between),
    // `create_new` fails and nothing preexisting is ever overwritten.
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                CodeError::already_exists(rel)
            } else {
                CodeError::io(e.to_string())
            }
        })?;
    let temp = parent.join(format!(
        ".ruth-tmp-{}-{}",
        std::process::id(),
        temp_counter()
    ));
    let wrote = (|| -> Result<(), CodeError> {
        fs::write(&temp, content).map_err(|e| CodeError::io(e.to_string()))?;
        fs::rename(&temp, &path).map_err(|e| CodeError::io(e.to_string()))?;
        Ok(())
    })();
    if wrote.is_err() {
        let _ = fs::remove_file(&temp);
        let _ = fs::remove_file(&path);
    }
    wrote?;
    let after = fs::symlink_metadata(&path).map_err(|e| CodeError::io(e.to_string()))?;
    Ok(WriteOutcome {
        fingerprint: fingerprint_of(&after),
        size: after.len(),
    })
}

/// Default visible name for a root: its last segment.
pub fn default_root_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn scratch(name: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("ruth-code-{}-{}-{n}", std::process::id(), name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create scratch");
        dir
    }

    fn write(path: &Path, content: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parents");
        }
        fs::write(path, content).expect("write fixture");
    }

    #[test]
    fn workspace_adds_and_removes_without_deleting() {
        let dir = scratch("roots");
        let mut ws = CodeWorkspace::new();
        ws.add(CodeRoot {
            id: "root-1".into(),
            path: dir.display().to_string(),
            name: "a".into(),
            project_id: None,
        })
        .expect("add");
        assert!(ws.get("root-1").is_some());
        let removed = ws.remove("root-1").expect("remove");
        assert_eq!(removed.id, "root-1");
        assert!(dir.is_dir(), "removing deletes no files");
        assert!(ws.remove("root-1").is_err());
    }

    #[test]
    fn resolver_rejects_escapes() {
        let dir = scratch("escape");
        write(&dir.join("ok.txt"), b"hello");
        assert!(resolve_within(&dir, "ok.txt").is_ok());
        assert!(resolve_within(&dir, "").is_ok());
        assert_eq!(
            resolve_within(&dir, "../x").unwrap_err().kind(),
            "code_escape"
        );
        assert_eq!(
            resolve_within(&dir, "a/../../x").unwrap_err().kind(),
            "code_escape"
        );
        assert_eq!(
            resolve_within(&dir, "/etc/hostname").unwrap_err().kind(),
            "code_escape"
        );
    }

    #[cfg(unix)]
    #[test]
    fn resolver_rejects_links() {
        let dir = scratch("symlink");
        write(&dir.join("real.txt"), b"real");
        std::os::unix::fs::symlink("real.txt", dir.join("link.txt")).expect("link");
        std::os::unix::fs::symlink("/etc", dir.join("outside")).expect("dir link");
        assert_eq!(
            resolve_within(&dir, "link.txt").unwrap_err().kind(),
            "code_symlink"
        );
        assert_eq!(
            resolve_within(&dir, "outside/hostname").unwrap_err().kind(),
            "code_symlink"
        );
    }

    #[test]
    fn listing_excludes_sorts_and_truncates() {
        let dir = scratch("list");
        write(&dir.join("b.txt"), b"b");
        write(&dir.join("a.txt"), b"a");
        write(&dir.join("sub/c.txt"), b"c");
        write(&dir.join("node_modules/x.js"), b"x");
        write(&dir.join(".git/config"), b"g");
        write(&dir.join("target/x"), b"t");
        write(&dir.join("dist/x"), b"d");
        let listing = list_dir(&dir, "").expect("list");
        let names: Vec<_> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["sub", "a.txt", "b.txt"]);
        assert!(!listing.truncated);
        assert_eq!(listing.entries[0].rel, "sub");
        assert_eq!(listing.entries[1].rel, "a.txt");
    }

    #[test]
    fn listing_truncates_with_notice() {
        let dir = scratch("truncate");
        for i in 0..(MAX_DIR_ENTRIES + 5) {
            write(&dir.join(format!("f{i:04}.txt")), b"x");
        }
        let listing = list_dir(&dir, "").expect("list");
        assert_eq!(listing.entries.len(), MAX_DIR_ENTRIES);
        assert!(listing.truncated);
    }

    #[test]
    fn reading_rejects_binary_large_and_utf8() {
        let dir = scratch("read");
        write(&dir.join("ok.txt"), "hello ♥".as_bytes());
        let content = read_file(&dir, "ok.txt").expect("read");
        assert_eq!(content.text, "hello ♥");
        assert!(!content.fingerprint.is_empty());

        write(&dir.join("bin.dat"), &[0, 1, 2, 3]);
        assert_eq!(
            read_file(&dir, "bin.dat").unwrap_err().kind(),
            "code_binary"
        );

        write(&dir.join("bad.txt"), &[0x66, 0x80, 0x80]);
        assert_eq!(
            read_file(&dir, "bad.txt").unwrap_err().kind(),
            "code_invalid_utf8"
        );

        let big = vec![b'a'; MAX_FILE_BYTES + 1];
        write(&dir.join("big.txt"), &big);
        assert_eq!(
            read_file(&dir, "big.txt").unwrap_err().kind(),
            "code_too_large"
        );
    }

    #[test]
    fn writing_saves_and_returns_a_new_fingerprint() {
        let dir = scratch("write");
        write(&dir.join("f.txt"), b"one");
        let before = read_file(&dir, "f.txt").expect("read").fingerprint;
        let outcome = write_file(&dir, "f.txt", &before, "one two", false).expect("save");
        assert_eq!(
            fs::read_to_string(dir.join("f.txt")).expect("reread"),
            "one two"
        );
        assert!(fingerprint_matches(&dir, "f.txt", &outcome.fingerprint).expect("compare"));
        // No forgotten temp files.
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .expect("list")
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".ruth-tmp-"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn writing_detects_conflicts_and_force_replaces() {
        let dir = scratch("conflict");
        write(&dir.join("f.txt"), b"one");
        let before = read_file(&dir, "f.txt").expect("read").fingerprint;
        write(&dir.join("f.txt"), b"external");
        let err = write_file(&dir, "f.txt", &before, "mine", false).unwrap_err();
        assert_eq!(err.kind(), "code_conflict");
        assert_eq!(
            fs::read_to_string(dir.join("f.txt")).expect("intact"),
            "external"
        );
        write_file(&dir, "f.txt", &before, "mine", true).expect("force");
        assert_eq!(
            fs::read_to_string(dir.join("f.txt")).expect("reread"),
            "mine"
        );
    }

    #[test]
    fn writing_rejects_large_nul_directory_and_escapes() {
        let dir = scratch("werr");
        write(&dir.join("f.txt"), b"x");
        let fpr = read_file(&dir, "f.txt").expect("read").fingerprint;
        let big = "a".repeat(MAX_FILE_BYTES + 1);
        assert_eq!(
            write_file(&dir, "f.txt", &fpr, &big, false)
                .unwrap_err()
                .kind(),
            "code_too_large"
        );
        assert_eq!(
            write_file(&dir, "f.txt", &fpr, "a\0b", false)
                .unwrap_err()
                .kind(),
            "code_binary"
        );
        assert_eq!(
            write_file(&dir, "missing.txt", &fpr, "x", false)
                .unwrap_err()
                .kind(),
            "code_not_found"
        );
        assert_eq!(
            write_file(&dir, "", &fpr, "x", false).unwrap_err().kind(),
            "code_not_file"
        );
        assert_eq!(
            write_file(&dir, "../f.txt", &fpr, "x", false)
                .unwrap_err()
                .kind(),
            "code_escape"
        );
        assert_eq!(fs::read_to_string(dir.join("f.txt")).expect("intact"), "x");
    }

    #[cfg(unix)]
    #[test]
    fn writing_keeps_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("perms");
        write(&dir.join("s.sh"), b"#!/bin/sh\n");
        fs::set_permissions(dir.join("s.sh"), fs::Permissions::from_mode(0o755)).expect("chmod");
        let fpr = read_file(&dir, "s.sh").expect("read").fingerprint;
        write_file(&dir, "s.sh", &fpr, "#!/bin/sh\necho hello\n", false).expect("save");
        let mode = fs::metadata(dir.join("s.sh"))
            .expect("meta")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o755);
    }

    #[test]
    fn fingerprint_detects_changes() {
        let dir = scratch("fpr");
        write(&dir.join("f.txt"), b"one");
        let before = read_file(&dir, "f.txt").expect("read").fingerprint;
        assert!(fingerprint_matches(&dir, "f.txt", &before).expect("compare"));
        write(&dir.join("f.txt"), b"one two");
        assert!(!fingerprint_matches(&dir, "f.txt", &before).expect("compare"));
    }

    #[test]
    fn missing_root_gives_a_clear_error() {
        let dir = scratch("gone");
        let gone = dir.join("missing");
        assert_eq!(list_dir(&gone, "").unwrap_err().kind(), "code_root_missing");
        assert_eq!(
            read_file(&gone, "a.txt").unwrap_err().kind(),
            "code_root_missing"
        );
    }

    #[test]
    fn default_name_is_the_last_segment() {
        assert_eq!(default_root_name(Path::new("/x/frontend")), "frontend");
    }

    #[test]
    fn create_writes_new_and_never_overwrites() {
        let dir = scratch("create");
        let outcome = create_file(&dir, "new.txt", "hello\n").expect("create file");
        assert_eq!(outcome.size, 6);
        assert_eq!(read_file(&dir, "new.txt").expect("read").text, "hello\n");
        // Exists: conflict, content intact.
        let err = create_file(&dir, "new.txt", "other\n").expect_err("duplicate");
        assert_eq!(err.kind(), "code_conflict");
        assert_eq!(read_file(&dir, "new.txt").expect("read").text, "hello\n");
        // No parent: it creates no folders and leaves no trace.
        let err = create_file(&dir, "sub/new.txt", "x").expect_err("no parent");
        assert_eq!(err.kind(), "code_not_found");
        assert!(!dir.join("sub").exists());
        // Escapes and NUL reject.
        assert!(create_file(&dir, "../outside.txt", "x").is_err());
        assert!(create_file(&dir, "nul.txt", "a\0b").is_err());
        assert!(!dir.join("nul.txt").exists());
    }
}
