import AloudCoreFFI // the Rust core's C ABI, exposed as a Clang module (see core/include/module.modulemap)
import Foundation

/// A safe Swift wrapper around the `aloud_core` C ABI (see
/// `core/include/aloud_core.h`). Nothing else in the iOS layer touches the raw
/// pointers: this type owns the session handle and guarantees it is freed, and
/// it translates the JSON dispatch protocol into typed `Snapshot`/`CoreError`.
///
/// This is the Swift end of the contract in `contracts/ffi.contract.md`.
///
/// ## Ownership rule (the same one AloudCore.kt implements)
/// The session is freed **exactly once**. Here that falls out of ARC: `session`
/// is a `let`, so it can never be reassigned, and `deinit` runs once when the
/// last reference goes away. The Kotlin binding has no deterministic destructor,
/// so it exposes an idempotent `release()` instead — different mechanics, same
/// guarantee, because `aloud_core.h` states that double-freeing is undefined
/// behaviour.
final class AloudCore {
    /// Opaque session pointer from `aloud_session_new`. `let`, so ARC's `deinit`
    /// is the single path to `aloud_session_free`.
    private let session: OpaquePointer

    /// Engine version, surfaced for diagnostics so JS/native/Rust logs agree.
    static var version: String {
        String(cString: aloud_core_version())
    }

    /// Parse `text`. Throws if the core rejects it (e.g. allocation failure).
    init(text: String) throws {
        guard let handle = text.withCString({ aloud_session_new($0) }) else {
            throw CoreError(code: "INVALID_UTF8", message: "core rejected document text")
        }
        self.session = handle
    }

    deinit {
        aloud_session_free(session)
    }

    /// The C ABI returns a fixed-width `uint32_t` (see the "fixed-width" rule in
    /// contracts/ffi.contract.md); widen it to Swift's native `Int` at the edge.
    var unitCount: Int {
        Int(aloud_session_unit_count(session))
    }

    /// Send a command and decode the response. A single choke point keeps the
    /// UTF-8/JSON handling — and the memory ownership of the returned string —
    /// in exactly one place.
    func dispatch(_ command: Command) throws -> Snapshot {
        let json = try JSONEncoder().encode(command)
        let raw = String(decoding: json, as: UTF8.self)

        guard let responsePtr = raw.withCString({ aloud_session_dispatch(session, $0) }) else {
            throw CoreError(code: "NULL_POINTER", message: "dispatch returned null")
        }
        // The core owns the returned buffer until we free it; copy out first.
        defer { aloud_string_free(responsePtr) }
        let data = Data(bytes: responsePtr, count: strlen(responsePtr))

        // The response is either a Snapshot or an error envelope.
        if let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: data) {
            throw envelope.error
        }
        return try JSONDecoder().decode(Snapshot.self, from: data)
    }
}
