//! The C ABI — the entire surface Swift and Kotlin bind to.
//!
//! ## Why it is this small
//! There are exactly five exported functions: session lifecycle (`new`/`free`),
//! one `dispatch`, one `unit_count`, and a `version` string. Everything
//! interesting travels as JSON through `dispatch`. That is a deliberate choice
//! (ADR-0002): the offer describes signatures that must match across three
//! languages "where a mismatch is a runtime crash, not a compile error", so we
//! shrink that surface to almost nothing and push the real contract into
//! versioned JSON that the contract tests validate.
//!
//! ## Safety rules honoured here
//! - We never unwind across the FFI boundary (that is UB). Every entry point
//!   that runs user logic is wrapped in [`std::panic::catch_unwind`].
//! - Ownership is explicit: `dispatch` returns a heap `char*` the caller must
//!   hand back to [`aloud_string_free`]; the session pointer must be released
//!   with [`aloud_session_free`].
//! - Null and non-UTF-8 inputs return a JSON error envelope, never a crash.

use std::ffi::{c_char, CStr, CString};
use std::panic::{self, AssertUnwindSafe};

use crate::error::{CoreError, ErrorCode};
use crate::state_machine::{Command, ReadingSession};

/// NUL-terminated version string with static lifetime; safe to return as a
/// borrowed `const char*` that the caller must **not** free.
const VERSION_C: &str = concat!(env!("CARGO_PKG_VERSION"), "\0");

/// Returns the core version as a static, NUL-terminated C string.
///
/// # Safety
/// The returned pointer is valid for the life of the program and must not be
/// freed by the caller.
#[no_mangle]
pub extern "C" fn aloud_core_version() -> *const c_char {
    VERSION_C.as_ptr() as *const c_char
}

/// Parse `text` (UTF-8, NUL-terminated) and return an owned session handle, or
/// null if `text` is null or not valid UTF-8.
///
/// # Safety
/// `text` must be a valid NUL-terminated C string or null. The returned pointer
/// must be released exactly once with [`aloud_session_free`].
#[no_mangle]
pub unsafe extern "C" fn aloud_session_new(text: *const c_char) -> *mut ReadingSession {
    if text.is_null() {
        return std::ptr::null_mut();
    }
    let result = panic::catch_unwind(AssertUnwindSafe(|| {
        let text = CStr::from_ptr(text).to_str().ok()?;
        Some(Box::into_raw(Box::new(ReadingSession::new(text))))
    }));
    result.ok().flatten().unwrap_or(std::ptr::null_mut())
}

/// Release a session created by [`aloud_session_new`]. Passing null is a no-op.
///
/// # Safety
/// `session` must have come from [`aloud_session_new`] and must not be used
/// afterwards. Do not call this twice on the same pointer.
#[no_mangle]
pub unsafe extern "C" fn aloud_session_free(session: *mut ReadingSession) {
    if !session.is_null() {
        drop(Box::from_raw(session));
    }
}

/// Number of sentence units in the document, or 0 if `session` is null.
///
/// # Safety
/// `session` must be a valid pointer from [`aloud_session_new`] or null.
#[no_mangle]
pub unsafe extern "C" fn aloud_session_unit_count(session: *const ReadingSession) -> usize {
    match session.as_ref() {
        Some(s) => s.unit_count(),
        None => 0,
    }
}

/// Apply a JSON command and return a newly-allocated JSON response.
///
/// The response is either a `Snapshot` object (has a `status` field) or an error
/// envelope `{"error":{"code":...,"message":...}}`. The returned pointer is
/// always non-null and must be released with [`aloud_string_free`].
///
/// # Safety
/// `session` must be valid (or null) and `command_json` must be a valid
/// NUL-terminated C string (or null). The caller owns the returned pointer.
#[no_mangle]
pub unsafe extern "C" fn aloud_session_dispatch(
    session: *mut ReadingSession,
    command_json: *const c_char,
) -> *mut c_char {
    let json = panic::catch_unwind(AssertUnwindSafe(|| dispatch_inner(session, command_json)))
        .unwrap_or_else(|_| {
            error_json(CoreError::new(
                ErrorCode::InvalidCommand,
                "core panicked while dispatching",
            ))
        });
    into_c_string(json)
}

/// Free a string returned by [`aloud_session_dispatch`]. Passing null is a no-op.
///
/// # Safety
/// `ptr` must have come from [`aloud_session_dispatch`] and must not be used
/// afterwards.
#[no_mangle]
pub unsafe extern "C" fn aloud_string_free(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(CString::from_raw(ptr));
    }
}

// --- internals -------------------------------------------------------------

unsafe fn dispatch_inner(session: *mut ReadingSession, command_json: *const c_char) -> String {
    let Some(session) = session.as_mut() else {
        return error_json(CoreError::new(
            ErrorCode::NullPointer,
            "session pointer was null",
        ));
    };
    if command_json.is_null() {
        return error_json(CoreError::new(
            ErrorCode::NullPointer,
            "command json was null",
        ));
    }
    let raw = match CStr::from_ptr(command_json).to_str() {
        Ok(s) => s,
        Err(_) => {
            return error_json(CoreError::new(
                ErrorCode::InvalidUtf8,
                "command json was not valid UTF-8",
            ))
        }
    };
    let command: Command = match serde_json::from_str(raw) {
        Ok(c) => c,
        Err(e) => return error_json(CoreError::invalid_command(e.to_string())),
    };
    match session.dispatch(command) {
        Ok(snapshot) => serde_json::to_string(&snapshot)
            .unwrap_or_else(|e| error_json(CoreError::invalid_command(e.to_string()))),
        Err(e) => error_json(e),
    }
}

fn error_json(err: CoreError) -> String {
    // Manual, infallible envelope so error reporting never itself fails.
    serde_json::json!({ "error": err }).to_string()
}

fn into_c_string(s: String) -> *mut c_char {
    // Interior NULs are impossible in our JSON; fall back defensively anyway.
    match CString::new(s) {
        Ok(c) => c.into_raw(),
        Err(_) => CString::new(
            "{\"error\":{\"code\":\"INVALID_COMMAND\",\"message\":\"nul in response\"}}",
        )
        .expect("static string has no nul")
        .into_raw(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    unsafe fn dispatch_str(session: *mut ReadingSession, cmd: &str) -> String {
        let c = CString::new(cmd).unwrap();
        let out = aloud_session_dispatch(session, c.as_ptr());
        let s = CStr::from_ptr(out).to_str().unwrap().to_owned();
        aloud_string_free(out);
        s
    }

    #[test]
    fn round_trips_a_command_over_the_c_abi() {
        unsafe {
            let text = CString::new("Hello world. Bye.").unwrap();
            let session = aloud_session_new(text.as_ptr());
            assert!(!session.is_null());
            assert_eq!(aloud_session_unit_count(session), 2);

            let out = dispatch_str(session, r#"{"type":"Play"}"#);
            assert!(out.contains("\"status\":\"playing\""));
            assert!(out.contains("\"utterance\":\"Hello world.\""));

            aloud_session_free(session);
        }
    }

    #[test]
    fn invalid_json_returns_error_envelope_not_crash() {
        unsafe {
            let text = CString::new("Hi.").unwrap();
            let session = aloud_session_new(text.as_ptr());
            let out = dispatch_str(session, "not json");
            assert!(out.contains("\"error\""));
            assert!(out.contains("INVALID_COMMAND"));
            aloud_session_free(session);
        }
    }

    #[test]
    fn null_session_is_handled() {
        unsafe {
            let out = dispatch_str(std::ptr::null_mut(), r#"{"type":"GetState"}"#);
            assert!(out.contains("NULL_POINTER"));
        }
    }

    #[test]
    fn version_is_non_null() {
        let ptr = aloud_core_version();
        assert!(!ptr.is_null());
        let v = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap();
        assert_eq!(v, env!("CARGO_PKG_VERSION"));
    }
}
