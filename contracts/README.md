# `contracts/` — one boundary, four languages, zero drift

This directory exists to defeat one specific bug class the role calls out:

> _"keeping method signatures consistent across several files in three languages
> — where a mismatch is a runtime crash, not a compile error."_

Our answer has three parts:

### 1. Shrink the typed surface to almost nothing
The C ABI is **five functions** and never grows (ADR-0002). Features are added as
**commands** in the JSON protocol, not as new C entry points. There is essentially
one signature — `dispatch` — that must agree across languages.

### 2. Make the runtime protocol machine-checkable
Everything that actually crosses the boundary is JSON, pinned by
[`commands.schema.json`](./commands.schema.json) and documented in
[`ffi.contract.md`](./ffi.contract.md).

### 3. Test the bindings against the same fixtures
The golden fixtures live in [`fixtures.json`](./fixtures.json). Being precise
about which bindings actually consume them matters more than a tidy claim, so:

| Layer | Test | What it proves | Status |
|---|---|---|---|
| Rust | [`core/tests/contract_fixtures.rs`](../core/tests/contract_fixtures.rs) | **Executes** every fixture case through `aloud_session_dispatch` — the same C entry point the native layers call — and compares the raw JSON responses | ✅ in CI |
| TS / RN | [`app/__tests__/contract.test.ts`](../app/__tests__/contract.test.ts) | The TS `Command`/`Snapshot` types validate against `commands.schema.json`, and the fixtures' expected shapes validate too | ✅ in CI |
| C header | symbol-parity job in [`ci.yml`](../.github/workflows/ci.yml) | `aloud_core.h` and the Rust `#[no_mangle]` exports declare the same symbol set | ✅ in CI |
| Swift | [`native/aloud-tts/ios/ContractTests`](../native/aloud-tts/ios/ContractTests) | The native structs decode every fixture snapshot, `asBridgePayload()` carries exactly the keys the TS `Snapshot` declares, and every fixture command re-encodes to the same JSON tag/field names Rust's `#[serde(tag)]` expects | ✅ in CI |
| Kotlin | [`android/contract-tests`](../native/aloud-tts/android/contract-tests) | The same, for the Android structs: every fixture snapshot decodes, and every fixture command re-encodes with identical tag and field names | ✅ in CI |

So **all four bindings** now assert against the fixture bytes, and the claim at
the top of this section is one the build actually enforces.

Three notes on how the native tests are built, because they are the reason they
are cheap enough to sit in the fast path rather than behind a device runner:

- The protocol types live in their **own file per platform**
  ([`AloudProtocol.swift`](../native/aloud-tts/ios/AloudProtocol.swift),
  [`AloudProtocol.kt`](../native/aloud-tts/android/src/main/java/com/aloud/tts/AloudProtocol.kt)),
  separate from the FFI wrappers that need the Rust module. Swift imports only
  Foundation; Kotlin depends only on `org.json`. So the tests compile them with
  a plain `swift test` and a JVM `gradle test` — **no xcframework, no
  CocoaPods, no Android SDK, no simulator or emulator.**
- Every suite reads the *same* `fixtures.json`: Rust via `include_str!`,
  TypeScript via `import`, Swift and Kotlin by locating it relative to their own
  source. None of them copy the values — a copy is the drift these exist to
  prevent.
- Skipping the Android SDK costs no fidelity here: Android unit tests run on the
  JVM against a stub `android.jar` whose `org.json` throws unless the real
  artifact is added, so the Android Gradle Plugin route would exercise the same
  `org.json` implementation, just slower.

Each suite is verified to actually *fail* on drift, not merely to pass: see the
"negative test" evidence on the PRs that introduced them
([#29](https://github.com/Ouraborus/aloud/pull/29),
[#37](https://github.com/Ouraborus/aloud/pull/37),
[#38](https://github.com/Ouraborus/aloud/pull/38)).

### How to change the protocol
1. Edit `commands.schema.json` and `ffi.contract.md` **first**.
2. Add/adjust the fixture in `fixtures.json`. Each case is self-contained: a
   fresh session on `document`, the case's `setup` commands, then `command`.
3. Update each binding until its contract test is green again.
4. Record the reasoning in an ADR if it is a breaking change.

For Rust and TypeScript, step 3 fails loudly in CI: edit a fixture without
updating the core and the build goes red. For Swift and Kotlin it is still a
review-time discipline until #10 lands.
