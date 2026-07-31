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

### 3. Test every binding against the same fixtures
The same command/response fixtures are validated in each language:

| Layer | Test | What it proves |
|---|---|---|
| Rust | `core/src/ffi.rs` (`#[cfg(test)]`) | The core emits schema-valid JSON and round-trips over the C ABI |
| TS / RN | `app/__tests__/contract.test.ts` | The TS `Command`/`Snapshot` types match the schema; encoder/decoder round-trips |
| C header | `cbindgen` diff in CI (`core/cbindgen.toml`) | The hand-written header matches the real exported symbols |
| Swift / Kotlin | `ios/…/ContractTests`, `android/…/ContractTest` (specs) | The native structs decode the shared fixtures |

The shared fixtures live in [`fixtures.json`](./fixtures.json) so all four
languages assert against literally the same bytes.

### How to change the protocol
1. Edit `commands.schema.json` and `ffi.contract.md` **first**.
2. Add/adjust the fixture in `fixtures.json`.
3. Update each binding until its contract test is green again.
4. Record the reasoning in an ADR if it is a breaking change.

Because step 3 fails loudly in CI, a signature mismatch becomes a red build —
never a runtime crash on a user's device.
