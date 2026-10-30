//! Persistence adapter errors.

use std::fmt;
use std::path::{Path, PathBuf};

/// Failure opening, reading or writing the local database. No variant
/// writes or destroys data: when in doubt, the database stays intact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    /// The directory could not be created or the file opened.
    Io { path: PathBuf, message: String },
    /// Generic SQLite error.
    Sqlite { message: String },
    /// Another process holds the database open (second instance).
    Locked { path: PathBuf },
    /// The file is not a valid database.
    Corrupt { message: String },
    /// Schema newer than supported; nothing was written.
    FutureSchema { found: i64, supported: i64 },
    /// Data fails domain validation; nothing was written.
    InvalidData { message: String },
}

impl StoreError {
    pub(crate) fn convert(path: &Path, err: rusqlite::Error) -> Self {
        if is_busy(&err) {
            return Self::Locked {
                path: path.to_path_buf(),
            };
        }
        if is_not_db(&err) {
            return Self::Corrupt {
                message: err.to_string(),
            };
        }
        Self::Sqlite {
            message: err.to_string(),
        }
    }
}

impl From<rusqlite::Error> for StoreError {
    fn from(err: rusqlite::Error) -> Self {
        if is_not_db(&err) {
            return Self::Corrupt {
                message: err.to_string(),
            };
        }
        Self::Sqlite {
            message: err.to_string(),
        }
    }
}

fn is_busy(err: &rusqlite::Error) -> bool {
    err.sqlite_error_code() == Some(rusqlite::ErrorCode::DatabaseBusy)
}

fn is_not_db(err: &rusqlite::Error) -> bool {
    err.sqlite_error_code() == Some(rusqlite::ErrorCode::NotADatabase)
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { path, message } => {
                write!(
                    f,
                    "could not use the database at {}: {message}",
                    path.display()
                )
            }
            Self::Sqlite { message } => write!(f, "SQLite error: {message}"),
            Self::Locked { path } => write!(
                f,
                "database {} is locked: Ruth IDE is already open in another process",
                path.display()
            ),
            Self::Corrupt { message } => {
                write!(
                    f,
                    "the database is corrupt ({message}); nothing was modified"
                )
            }
            Self::FutureSchema { found, supported } => write!(
                f,
                "the database uses schema v{found}, newer than v{supported}; nothing was modified"
            ),
            Self::InvalidData { message } => {
                write!(
                    f,
                    "the saved data is not valid ({message}); nothing was modified"
                )
            }
        }
    }
}

impl std::error::Error for StoreError {}
