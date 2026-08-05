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
| Swift / Kotlin | — | Would prove the native structs decode the shared fixtures | ❌ **not implemented** — needs the device-toolchain runners tracked in [#10](https://github.com/Ouraborus/aloud/issues/10) |

So today **two** bindings are pinned to the fixture bytes, not four. The gap is
the one that matters most — Swift and Kotlin are exactly where a decode mismatch
becomes a runtime crash rather than a failed compile — which is why it is
tracked rather than glossed over. The `Snapshot`/`Command` structs in
[`AloudCore.swift`](../native/aloud-tts/ios/AloudCore.swift) and
[`AloudCore.kt`](../native/aloud-tts/android/src/main/java/com/aloud/tts/AloudCore.kt)
are currently kept in step by review, not by a test.

### How to change the protocol
1. Edit `commands.schema.json` and `ffi.contract.md` **first**.
2. Add/adjust the fixture in `fixtures.json`. Each case is self-contained: a
   fresh session on `document`, the case's `setup` commands, then `command`.
3. Update each binding until its contract test is green again.
4. Record the reasoning in an ADR if it is a breaking change.

For Rust and TypeScript, step 3 fails loudly in CI: edit a fixture without
updating the core and the build goes red. For Swift and Kotlin it is still a
review-time discipline until #10 lands.
