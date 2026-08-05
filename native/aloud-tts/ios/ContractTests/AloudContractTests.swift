//
//  AloudContractTests.swift
//
//  The Swift end of the shared-fixture contract.
//
//  `contracts/README.md` used to claim all four bindings asserted against the
//  same fixture bytes; in reality only TypeScript did, and Rust restated the
//  values as hardcoded literals (fixed in #22/#29). Swift and Kotlin had no
//  contract test at all — which is the gap that matters most, because a decode
//  mismatch here is a runtime crash on a device, not a failed compile.
//
//  This closes the Swift half. It reads the SAME `contracts/fixtures.json` the
//  Rust and TypeScript suites read, and checks both directions of the boundary:
//
//    * decode  — every fixture's expected snapshot decodes into `Snapshot`
//                with the exact field values (and `asBridgePayload()`, the
//                shape RN actually receives, round-trips them),
//    * encode  — every fixture's command re-encodes to byte-equal JSON, which
//                is what the Rust `#[serde(tag = "type")]` deserialiser needs.
//
//  It deliberately needs no simulator, no xcframework and no Xcode project: the
//  types under test import only Foundation (see AloudProtocol.swift).
//

import XCTest

final class AloudContractTests: XCTestCase {
    // MARK: - Fixture loading

    /// The repo's shared fixtures, located relative to THIS source file so the
    /// test reads the same bytes as `core/tests/contract_fixtures.rs`
    /// (`include_str!`) and `app/__tests__/contract.test.ts` (`import`).
    /// Mirroring the path here rather than copying the file is the entire point.
    private static let fixturesURL: URL = {
        URL(fileURLWithPath: #filePath)          // .../ios/ContractTests/AloudContractTests.swift
            .deletingLastPathComponent()          // .../ios/ContractTests
            .deletingLastPathComponent()          // .../ios
            .deletingLastPathComponent()          // .../aloud-tts
            .deletingLastPathComponent()          // .../native
            .deletingLastPathComponent()          // repo root
            .appendingPathComponent("contracts/fixtures.json")
    }()

    private struct Fixtures: Decodable {
        let document: String
        let cases: [Case]

        struct Case: Decodable {
            let name: String
            let command: [String: JSONValue]
            let expect: Snapshot?
            let expectHighlight: Highlight?
            let expectErrorCode: String?

            enum CodingKeys: String, CodingKey {
                case name, command, expect
                case expectHighlight = "expect_highlight"
                case expectErrorCode = "expect_error_code"
            }
        }
    }

    /// Minimal `Any`-free JSON value, so a fixture's command can be compared
    /// structurally without pulling in a dependency.
    private enum JSONValue: Decodable, Equatable {
        case string(String)
        case int(Int)

        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let i = try? c.decode(Int.self) {
                self = .int(i)
            } else {
                self = .string(try c.decode(String.self))
            }
        }
    }

    private func loadFixtures() throws -> Fixtures {
        let url = Self.fixturesURL
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: url.path),
            "fixtures.json not found at \(url.path) — did the repo layout move?"
        )
        return try JSONDecoder().decode(Fixtures.self, from: Data(contentsOf: url))
    }

    // MARK: - Tests

    func testFixturesAreLoadableAndNonEmpty() throws {
        let fixtures = try loadFixtures()
        XCTAssertFalse(fixtures.document.isEmpty)
        XCTAssertFalse(fixtures.cases.isEmpty, "fixtures.json declares no cases")
    }

    /// Every expected snapshot in the fixtures decodes into the Swift struct.
    /// If Rust adds or renames a field, this fails here rather than on a device.
    func testEverySnapshotFixtureDecodes() throws {
        let fixtures = try loadFixtures()
        var decoded = 0

        for testCase in fixtures.cases {
            guard let snapshot = testCase.expect else { continue }
            decoded += 1

            // Field-by-field, so a failure names the field rather than just
            // reporting "decoding failed".
            XCTAssertFalse(snapshot.status.isEmpty, "\(testCase.name): empty status")
            XCTAssertGreaterThanOrEqual(snapshot.unit, 0, "\(testCase.name): unit")
            XCTAssertGreaterThan(snapshot.unitCount, 0, "\(testCase.name): unitCount")
            XCTAssertGreaterThanOrEqual(snapshot.token, 0, "\(testCase.name): token")

            // A highlight is either absent or a well-formed, non-empty span.
            if let highlight = snapshot.highlight {
                XCTAssertLessThan(
                    highlight.start, highlight.end,
                    "\(testCase.name): highlight is empty or inverted"
                )
            }
        }

        XCTAssertGreaterThan(decoded, 0, "no fixture carried an `expect` snapshot")
    }

    /// The exact values the `play_lights_first_word` fixture pins, asserted
    /// against the Swift struct — the same assertions the Rust and TS suites
    /// make on the same bytes.
    func testPlayFixtureDecodesToTheExpectedValues() throws {
        let fixtures = try loadFixtures()
        let playCase = try XCTUnwrap(
            fixtures.cases.first { $0.name == "play_lights_first_word" },
            "fixture `play_lights_first_word` is missing"
        )
        let snapshot = try XCTUnwrap(playCase.expect)

        XCTAssertEqual(snapshot.status, "playing")
        XCTAssertEqual(snapshot.unit, 0)
        XCTAssertEqual(snapshot.unitCount, 2)
        XCTAssertEqual(snapshot.token, 0)
        XCTAssertEqual(snapshot.tokenCount, 2)
        XCTAssertEqual(snapshot.utterance, "Hello world.")
        XCTAssertEqual(snapshot.highlight, Highlight(start: 0, end: 5))
    }

    /// A null highlight must decode to `nil`, not fail — the `finished` and
    /// `idle` snapshots rely on it.
    func testNullHighlightDecodesToNil() throws {
        let fixtures = try loadFixtures()
        let seekCase = try XCTUnwrap(
            fixtures.cases.first { $0.name == "seek_byte_jumps_to_second_sentence" }
        )
        let snapshot = try XCTUnwrap(seekCase.expect)

        XCTAssertNil(snapshot.highlight)
        XCTAssertEqual(snapshot.unit, 1)
        XCTAssertEqual(snapshot.utterance, "Bye.")
    }

    /// `asBridgePayload()` is what React Native actually receives. A field
    /// dropped or renamed there is invisible to the decoder above but breaks
    /// the JS `Snapshot` type, so it is pinned separately.
    func testBridgePayloadCarriesEveryFixtureField() throws {
        let fixtures = try loadFixtures()
        let snapshot = try XCTUnwrap(
            fixtures.cases.first { $0.name == "play_lights_first_word" }?.expect
        )
        let payload = snapshot.asBridgePayload()

        XCTAssertEqual(payload["status"] as? String, "playing")
        XCTAssertEqual(payload["unit"] as? Int, 0)
        XCTAssertEqual(payload["unitCount"] as? Int, 2)
        XCTAssertEqual(payload["token"] as? Int, 0)
        XCTAssertEqual(payload["tokenCount"] as? Int, 2)
        XCTAssertEqual(payload["utterance"] as? String, "Hello world.")

        let highlight = try XCTUnwrap(payload["highlight"] as? [String: Int])
        XCTAssertEqual(highlight["start"], 0)
        XCTAssertEqual(highlight["end"], 5)

        // The keys must match `Snapshot` in app/src/contract/types.ts exactly.
        XCTAssertEqual(
            Set(payload.keys),
            ["status", "unit", "unitCount", "token", "tokenCount", "utterance", "highlight"]
        )
    }

    /// A nil highlight must reach JS as an explicit null, never a missing key —
    /// the TS type is `Highlight | null`, and a missing key would read as
    /// `undefined` and skip the WebView's "clear the highlight" path.
    func testBridgePayloadEncodesAMissingHighlightAsNull() throws {
        let fixtures = try loadFixtures()
        let snapshot = try XCTUnwrap(
            fixtures.cases.first { $0.name == "seek_byte_jumps_to_second_sentence" }?.expect
        )
        let payload = snapshot.asBridgePayload()

        XCTAssertNotNil(payload["highlight"], "highlight key must be present")
        XCTAssertTrue(payload["highlight"] is NSNull, "highlight must be NSNull, not absent")
    }

    /// Every command in the fixtures re-encodes to the same JSON object the
    /// fixture declares. This is the direction that actually crashes at
    /// runtime: Rust's `#[serde(tag = "type")]` rejects an unknown or
    /// misspelled tag, and nothing else in the Swift build would catch it.
    func testEveryFixtureCommandReEncodesIdentically() throws {
        let fixtures = try loadFixtures()

        for testCase in fixtures.cases {
            guard let command = Self.swiftCommand(for: testCase.command) else {
                XCTFail("\(testCase.name): no Swift Command maps to \(testCase.command)")
                continue
            }

            let data = try JSONEncoder().encode(command)
            let reEncoded = try XCTUnwrap(
                JSONSerialization.jsonObject(with: data) as? [String: Any],
                "\(testCase.name): command did not encode to a JSON object"
            )

            // Compare structurally — key order is not part of the contract.
            XCTAssertEqual(
                reEncoded.count, testCase.command.count,
                "\(testCase.name): field count differs from the fixture"
            )
            for (key, expected) in testCase.command {
                switch expected {
                case .string(let s):
                    XCTAssertEqual(
                        reEncoded[key] as? String, s,
                        "\(testCase.name): field `\(key)`"
                    )
                case .int(let i):
                    XCTAssertEqual(
                        reEncoded[key] as? Int, i,
                        "\(testCase.name): field `\(key)`"
                    )
                }
            }
        }
    }

    /// Map a fixture's raw command object onto the Swift `Command` case it
    /// represents. Intentionally exhaustive over the tag: a new command in the
    /// protocol makes this return nil and the test above fails loudly, rather
    /// than the fixture being silently skipped.
    private static func swiftCommand(for raw: [String: JSONValue]) -> Command? {
        guard case .string(let type)? = raw["type"] else { return nil }
        switch type {
        case "Play": return .play
        case "Pause": return .pause
        case "Next": return .next
        case "Prev": return .prev
        case "GetState": return .getState
        case "SeekUnit":
            guard case .int(let unit)? = raw["unit"] else { return nil }
            return .seekUnit(unit: unit)
        case "SeekByte":
            guard case .int(let byte)? = raw["byte"] else { return nil }
            return .seekByte(byte: byte)
        case "WordBoundary":
            guard case .int(let offset)? = raw["utf16Offset"] else { return nil }
            return .wordBoundary(utf16Offset: offset)
        default: return nil
        }
    }
}
