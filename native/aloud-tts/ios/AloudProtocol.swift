import Foundation

// The Swift side of `contracts/commands.schema.json` — the exact shapes that
// cross the FFI boundary as JSON.
//
// Deliberately kept in its own file, importing nothing but Foundation, so the
// contract tests can compile it WITHOUT the Rust `AloudCoreFFI` module, the
// React module, an xcframework or a simulator. That is what lets
// `native/aloud-tts/ios/ContractTests` run these types against the shared
// `contracts/fixtures.json` as an ordinary `swift test` in CI — closing the
// gap called out in contracts/README.md, where Swift and Kotlin were the only
// bindings kept in step by review rather than by a test.
//
// The FFI wrapper that USES these types lives next door in AloudCore.swift.

/// Commands. Encodes to `{ "type": ..., ... }` to match the Rust `#[serde(tag)]`.
enum Command: Encodable {
    case play
    case pause
    case next
    case prev
    case getState
    case seekUnit(unit: Int)
    case seekByte(byte: Int)
    case wordBoundary(utf16Offset: Int)

    private enum CodingKeys: String, CodingKey {
        case type, unit, byte, utf16Offset
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
        case let .seekByte(byte):
            try c.encode("SeekByte", forKey: .type)
            try c.encode(byte, forKey: .byte)
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
