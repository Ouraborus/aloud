//! Error type shared by the core and serialised across the FFI boundary.
//!
//! Every fallible core operation returns a [`CoreError`]. Over FFI we never
//! panic across the boundary (that is undefined behaviour); instead we serialise
//! the error into the same JSON envelope the caller already parses, so the
//! Swift/Kotlin/JS side has exactly one shape to handle.

use serde::Serialize;

/// A machine-readable error code. Kept as a stable enum so clients can branch on
/// `code` without string-matching `message`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    /// The command JSON could not be parsed into a known command.
    InvalidCommand,
    /// A referenced unit index is out of range for this document.
    UnitOutOfRange,
    /// The provided text pointer or bytes were not valid UTF-8.
    InvalidUtf8,
    /// A null pointer was passed where a value was required.
    NullPointer,
}

/// The canonical error carried across the FFI boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CoreError {
    pub code: ErrorCode,
    pub message: String,
}

impl CoreError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn invalid_command(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidCommand, message)
    }

    pub fn unit_out_of_range(requested: usize, count: usize) -> Self {
        Self::new(
            ErrorCode::UnitOutOfRange,
            format!("unit {requested} is out of range (document has {count} units)"),
        )
    }
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for CoreError {}
