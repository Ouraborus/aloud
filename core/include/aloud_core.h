/*
 * aloud_core.h — the canonical C ABI for the Aloud shared reading engine.
 *
 * This header is the single source of truth for the FFI surface. Swift imports
 * it through a bridging header; the Android side calls the same symbols via a
 * small JNI shim (or `uniffi`/`cargo-ndk`). It is hand-maintained rather than
 * generated so it can carry documentation, but its shape is verified against the
 * Rust `#[no_mangle]` exports by the contract tests (see contracts/README.md).
 *
 * ABI stability contract:
 *   - The five functions below are the ENTIRE surface. Do not add typed
 *     entry points for new features; add a new command to the JSON protocol
 *     instead (see contracts/ffi.contract.md and ADR-0002).
 *   - Strings are UTF-8, NUL-terminated.
 *   - `aloud_session_dispatch` returns heap memory owned by the caller.
 */
#ifndef ALOUD_CORE_H
#define ALOUD_CORE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Opaque handle to a reading session. Never dereferenced by the caller. */
typedef struct AloudSession AloudSession;

/*
 * Returns the core semver as a static, NUL-terminated string.
 * The pointer is valid for the life of the program; DO NOT free it.
 */
const char *aloud_core_version(void);

/*
 * Parse `text` (UTF-8, NUL-terminated) into a new session.
 * Returns NULL if `text` is NULL or not valid UTF-8.
 * The returned handle must be released exactly once with aloud_session_free().
 */
AloudSession *aloud_session_new(const char *text);

/* Release a session. Passing NULL is a no-op. Do not double-free. */
void aloud_session_free(AloudSession *session);

/*
 * Number of sentence units in the document, or 0 if `session` is NULL.
 *
 * Deliberately uint32_t, not size_t: a pointer-width return is 4 bytes on
 * armeabi-v7a and 8 on arm64, so a binding that assumes one width silently
 * reads garbage on the other. See the "fixed-width" rule in
 * contracts/ffi.contract.md.
 */
uint32_t aloud_session_unit_count(const AloudSession *session);

/*
 * Apply a JSON command and return a newly-allocated JSON response.
 *
 * Response is EITHER a Snapshot object (contains "status") OR an error envelope
 * {"error":{"code":...,"message":...}}. The returned pointer is always non-NULL
 * and MUST be released with aloud_string_free().
 *
 * See contracts/ffi.contract.md for the command/response schema.
 */
char *aloud_session_dispatch(AloudSession *session, const char *command_json);

/* Free a string returned by aloud_session_dispatch(). NULL is a no-op. */
void aloud_string_free(char *ptr);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* ALOUD_CORE_H */
