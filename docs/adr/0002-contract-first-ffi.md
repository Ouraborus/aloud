# ADR-0002: A tiny JSON-command FFI, not a wide typed one

- **Status:** Accepted
- **Context:** A shared core ([ADR-0001](0001-rust-shared-core.md)) introduces an
  FFI boundary crossed by Swift, Kotlin and (through native) JS. The classic
  failure mode: every new feature adds a typed C function that must be re-declared
  in each language, and a signature that disagrees is **a runtime crash, not a
  compile error** (an `unrecognized selector`, a mismatched JNI signature, a
  mis-decoded struct).

## Decision
Keep the C ABI at **five functions** (`version`, `new`, `free`, `unit_count`,
`dispatch`, `string_free`) and never add typed entry points for features. All
behaviour flows through:

```
char *aloud_session_dispatch(session, const char *command_json) -> response_json
```

Commands and responses are JSON, pinned by
[`contracts/commands.schema.json`](../../contracts/commands.schema.json) and the
same golden [`fixtures.json`](../../contracts/fixtures.json) that every language's
contract test asserts against.

## Consequences
- (+) The set of signatures that must match across four languages is effectively
  **one**. New features (e.g. `SeekByte`) add a JSON variant, not a C function.
- (+) Drift becomes a **failed contract test in CI**, not a field crash.
- (+) The protocol is trivially versionable and loggable (it is already text).
- (−) A serialize/deserialize cost per call. Measured negligible for coarse
  intents; the hot word-boundary path is a single small object and stays native
  ([ADR-0003](0003-native-owns-the-boundary-loop.md)).
- (−) We give up compile-time type-checking *at the boundary*, and buy it back
  with the schema + contract tests, which also cover the JS and native sides that
  a typed C header never could.
