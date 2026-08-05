//! Executes the shared golden fixtures in `contracts/fixtures.json` over the
//! real C ABI.
//!
//! ## Why this file exists
//! `contracts/` claims that every binding agrees byte-for-byte on the protocol.
//! That claim is only worth something if the fixtures are actually *executed*
//! rather than restated: a hand-copied literal in a test cannot fail when the
//! fixture it duplicates is edited, which is precisely the drift the fixtures
//! exist to prevent. So this test reads the same file the TypeScript contract
//! test reads, and drives each case through `aloud_session_dispatch` — the same
//! entry point Swift and Kotlin call — comparing the raw JSON responses.
//!
//! Each case is self-contained: a fresh session, the case's `setup` commands,
//! then the command under test. See the `description` field in the fixture file.

use std::ffi::{CStr, CString};

use aloud_core::ffi::{
    aloud_session_dispatch, aloud_session_free, aloud_session_new, aloud_string_free,
};
use aloud_core::state_machine::ReadingSession;
use serde_json::Value;

/// Compiled in, so a fixture edit rebuilds and re-runs this test automatically.
const FIXTURES: &str = include_str!("../../contracts/fixtures.json");

/// Send one command across the C ABI exactly as the native layers do, and parse
/// the response. Also asserts the ABI's own memory contract: the returned
/// pointer is always non-null and is handed straight back to `aloud_string_free`.
///
/// # Safety
/// `session` must be a live handle from `aloud_session_new`.
unsafe fn dispatch(session: *mut ReadingSession, command: &Value) -> Value {
    let json = CString::new(command.to_string()).expect("command JSON has no interior NUL");
    let out = aloud_session_dispatch(session, json.as_ptr());
    assert!(!out.is_null(), "dispatch must never return null");
    let raw = CStr::from_ptr(out)
        .to_str()
        .expect("response is valid UTF-8")
        .to_owned();
    aloud_string_free(out);
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("response is not valid JSON: {e}\n{raw}"))
}

#[test]
fn every_shared_fixture_round_trips_over_the_c_abi() {
    let fixtures: Value = serde_json::from_str(FIXTURES).expect("fixtures.json parses");
    let document = fixtures["document"]
        .as_str()
        .expect("fixtures declare a document");
    let cases = fixtures["cases"]
        .as_array()
        .expect("fixtures declare a cases array");
    assert!(!cases.is_empty(), "fixtures.json declares no cases");

    for case in cases {
        let name = case["name"].as_str().unwrap_or("<unnamed>");

        // A fixture that asserts nothing would pass silently forever.
        let asserts_something = case.get("expect").is_some()
            || case.get("expect_highlight").is_some()
            || case.get("expect_error_code").is_some();
        assert!(asserts_something, "{name}: fixture asserts nothing");

        unsafe {
            let text = CString::new(document).expect("document has no interior NUL");
            let session = aloud_session_new(text.as_ptr());
            assert!(
                !session.is_null(),
                "{name}: aloud_session_new returned null"
            );

            // `setup` puts the session into the state the case is about; a case
            // with no setup runs against a freshly-loaded (idle) session.
            for cmd in case
                .get("setup")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let response = dispatch(session, cmd);
                assert!(
                    response.get("error").is_none(),
                    "{name}: setup command {cmd} failed: {response}"
                );
            }

            let response = dispatch(session, &case["command"]);

            if let Some(expected) = case.get("expect") {
                assert_eq!(&response, expected, "{name}: snapshot differs from fixture");
            }
            if let Some(expected) = case.get("expect_highlight") {
                assert_eq!(
                    &response["highlight"], expected,
                    "{name}: highlight differs from fixture"
                );
            }
            if let Some(expected) = case.get("expect_error_code") {
                assert_eq!(
                    &response["error"]["code"], expected,
                    "{name}: error code differs from fixture"
                );
            }

            aloud_session_free(session);
        }
    }
}
