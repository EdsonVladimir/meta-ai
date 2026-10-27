//! Errores del adaptador de persistencia.

use std::fmt;
use std::path::{Path, PathBuf};

/// Fallo al abrir, leer o escribir la base local. Ninguna variante escribe
/// ni destruye datos: ante la duda, la base queda intacta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    /// No se pudo crear el directorio o abrir el archivo.
    Io { path: PathBuf, message: String },
    /// Error genérico de SQLite.
    Sqlite { message: String },
    /// Otro proceso tiene la base abierta (segunda instancia).
    Locked { path: PathBuf },
    /// El archivo no es una base válida.
    Corrupt { message: String },
    /// Esquema posterior al soportado; no se escribió nada.
    FutureSchema { found: i64, supported: i64 },
    /// Los datos no pasan la validación del dominio; no se escribió nada.
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
                write!(f, "no se pudo usar la base en {}: {message}", path.display())
            }
            Self::Sqlite { message } => write!(f, "error de SQLite: {message}"),
            Self::Locked { path } => write!(
                f,
                "la base {} está bloqueada: Ruth IDE ya está abierto en otro proceso",
                path.display()
            ),
            Self::Corrupt { message } => {
                write!(f, "la base de datos está dañada ({message}); no se ha modificado nada")
            }
            Self::FutureSchema { found, supported } => write!(
                f,
                "la base usa el esquema v{found}, posterior a v{supported}; no se ha modificado nada"
            ),
            Self::InvalidData { message } => {
                write!(f, "los datos guardados no son válidos ({message}); no se ha modificado nada")
            }
        }
    }
}

impl std::error::Error for StoreError {}
