import Foundation

/// A safe Swift wrapper around the `aloud_core` C ABI (see
/// `core/include/aloud_core.h`). Nothing else in the iOS layer touches the raw
/// pointers: this type owns the session handle and guarantees it is freed, and
/// it translates the JSON dispatch protocol into typed `Snapshot`/`CoreError`.
///
/// This is the Swift end of the contract in `contracts/ffi.contract.md`.
final class AloudCore {
    /// Opaque session pointer from `aloud_session_new`.
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

    var unitCount: Int {
        aloud_session_unit_count(session)
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

// MARK: - Protocol types (the Swift side of contracts/commands.schema.json)

/// Commands. Encodes to `{ "type": ..., ... }` to match the Rust `#[serde(tag)]`.
enum Command: Encodable {
    case play
    case pause
    case next
    case prev
    case getState
    case seekUnit(unit: Int)
    case wordBoundary(utf16Offset: Int)

    private enum CodingKeys: String, CodingKey {
        case type, unit, utf16Offset
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .play: try c.encode("Play", forKey: .type)
        case .pause: try c.encode("Pause", forKey: .type)
        case .next: try c.encode("Next", forKey: .type)
        case .prev: try c.encode("Prev", forKey: .type)
        case .getState: try c.encode("GetState", forKey: .type)
        case let .seekUnit(unit):
            try c.encode("SeekUnit", forKey: .type)
            try c.encode(unit, forKey: .unit)
        case let .wordBoundary(offset):
            try c.encode("WordBoundary", forKey: .type)
            try c.encode(offset, forKey: .utf16Offset)
        }
    }
}

struct Highlight: Codable, Equatable {
    let start: Int
    let end: Int
}

struct Snapshot: Codable, Equatable {
    let status: String
    let unit: Int
    let unitCount: Int
    let token: Int
    let tokenCount: Int
    let utterance: String
    let highlight: Highlight?

    /// Serialise back to a JSON dictionary for the RN bridge event payload.
    func asBridgePayload() -> [String: Any] {
        var dict: [String: Any] = [
            "status": status,
            "unit": unit,
            "unitCount": unitCount,
            "token": token,
            "tokenCount": tokenCount,
            "utterance": utterance,
            "highlight": NSNull(),
        ]
        if let h = highlight {
            dict["highlight"] = ["start": h.start, "end": h.end]
        }
        return dict
    }
}

struct CoreError: Codable, Error {
    let code: String
    let message: String
}

struct ErrorEnvelope: Codable {
    let error: CoreError
}
