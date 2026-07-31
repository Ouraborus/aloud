//! # aloud_core
//!
//! The shared, platform-agnostic engine behind Aloud's read-aloud experience.
//!
//! ## Responsibilities
//! - **Segmentation** ([`segmentation`]): turn a document into sentences (the
//!   unit we hand to a TTS engine) and word tokens (the unit we highlight),
//!   each carrying byte offsets back into the original text.
//! - **State machine** ([`state_machine`]): own the *reading position* — the
//!   single source of truth for "what are we saying, and which word is lit up".
//! - **FFI** ([`ffi`]): expose the whole engine over a deliberately tiny C ABI
//!   so Swift, Kotlin and (indirectly) JS all speak to the same brain.
//!
//! ## Design stance
//! This crate performs **no I/O**. It never plays audio, never draws, never
//! logs to a platform sink. It is a pure reducer: `dispatch(command) -> state`.
//! That is what lets us unit-test the hard logic on a laptop instead of on a
//! device farm, and it keeps the FFI surface small enough that four languages
//! can stay in sync (see `docs/adr/0002-contract-first-ffi.md`).

pub mod error;
pub mod ffi;
pub mod segmentation;
pub mod state_machine;

pub use error::CoreError;
pub use state_machine::{ReadingSession, Snapshot, Status};

/// Semantic version of the core, surfaced over FFI so every layer can log the
/// exact engine build it is talking to. Correlating a bug report is much easier
/// when the JS, native and Rust logs all agree on this string.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
