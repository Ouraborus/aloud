# Aloud FFI Contract (v1)

This document is the **single source of truth** for how every layer talks to the
Rust core. Swift, Kotlin, and the RN/TypeScript bridge all implement _this_, and
the parity tests (`contracts/`, `core/src/ffi.rs`, `app/__tests__/contract.test.ts`)
fail CI if any side drifts.

> **Why a document + schema instead of just headers?** The offer describes the
> exact failure mode we are designing against: _"method signatures consistent
> across several files in three languages — where a mismatch is a runtime crash,
> not a compile error."_ A hand-written C header only pins the C side. The JSON
> protocol below is what actually crosses the boundary at runtime, so we pin it
> with a machine-checkable schema and test all four languages against it.

## 1. The C surface (stable, tiny by design)

Five functions, defined in [`core/include/aloud_core.h`](../core/include/aloud_core.h):

| Function | Purpose | Ownership |
|---|---|---|
| `const char *aloud_core_version(void)` | Engine semver | Static — never freed |
| `AloudSession *aloud_session_new(const char *text)` | Parse a document | Caller frees via `aloud_session_free` |
| `void aloud_session_free(AloudSession *)` | Release a session | — |
| `uint32_t aloud_session_unit_count(const AloudSession *)` | Sentence count | — |
| `char *aloud_session_dispatch(AloudSession *, const char *cmd_json)` | Run a command | Caller frees via `aloud_string_free` |
| `void aloud_string_free(char *)` | Free a dispatch result | — |

**Rule:** New features never add C functions. They add a **command** to the JSON
protocol below (see ADR-0002). This keeps the count of "signatures that must
match in four languages" at effectively one: `dispatch`.

**Rule:** Integer types in this surface are **fixed-width** (`uint32_t`), never
pointer-width (`size_t`/`usize`). A pointer-width return is a different size on
32-bit ABIs than on 64-bit ones, so a binding that hardcodes 64 bits — as the
Kotlin/JNA one did for `unit_count` — reads garbage on `armeabi-v7a` while
working perfectly on `arm64-v8a`. Fixed widths make every binding's declaration
checkable by eye against this table.

## 2. The JSON protocol (what actually crosses the boundary)

### Commands (host → core)

Every command is a JSON object tagged by `type`. Schema:
[`contracts/commands.schema.json`](./commands.schema.json).

| `type` | Extra fields | Meaning |
|---|---|---|
| `Play` | — | Start / resume / restart-if-finished |
| `Pause` | — | Pause, keep position |
| `Next` | — | Next sentence (finishes if last) |
| `Prev` | — | Previous sentence |
| `SeekUnit` | `unit: u32` | Jump to sentence index |
| `SeekByte` | `byte: u32` | Jump to the sentence + word containing a document byte offset (tap-to-seek) |
| `WordBoundary` | `utf16Offset: u32` | Word-boundary report from the platform TTS engine |
| `GetState` | — | Return snapshot, mutate nothing |

> **`utf16Offset` is not a byte offset.** iOS `AVSpeechSynthesizer`
> (`willSpeakRangeOfSpeechString`) and Android `UtteranceProgressListener`
> (`onRangeStart`) both report positions as **UTF-16** offsets within the
> utterance, because their strings are UTF-16. The core converts to UTF-8 bytes
> internally. Passing a byte offset here corrupts the highlight the first time an
> accented or emoji character appears — a silent bug, which is exactly why it
> lives behind the contract and is covered by `boundary_math_survives_multibyte_text`.

### Responses (core → host)

A dispatch returns **either** a `Snapshot` **or** an error envelope. The host
distinguishes by presence of the `error` key.

**Snapshot:**

```json
{
  "status": "idle | playing | paused | finished",
  "unit": 0,
  "unitCount": 3,
  "token": 0,
  "tokenCount": 2,
  "utterance": "Hello world.",
  "highlight": { "start": 0, "end": 5 }
}
```

- `utterance` — the exact string the platform engine should (re)start speaking
  now. **Not always the full sentence** — after a mid-sentence seek (tap-to-seek
  while playing, or resuming a paused mid-sentence position), it is the suffix
  starting at the current word, so the native layer can hand it straight to the
  TTS engine without re-deriving where to start. Empty when
  `finished`/idle-with-no-content.
- `highlight` — document byte span `[start, end)` for the WebView to light up, or
  `null` when nothing should be highlighted.

**Error envelope:**

```json
{ "error": { "code": "UNIT_OUT_OF_RANGE", "message": "unit 99 is out of range (document has 3 units)" } }
```

`code` is one of: `INVALID_COMMAND`, `UNIT_OUT_OF_RANGE`, `INVALID_UTF8`,
`NULL_POINTER`.

## 3. Byte offsets are always document-global

`highlight.start/end` and token offsets are byte offsets into the **original
document text** passed to `aloud_session_new`. The WebView maps them directly
onto the source span it rendered; no layer re-tokenises, so no layer can drift on
where word boundaries are.

## 4. Versioning

The protocol is versioned by this document's major version (currently **v1**) and
the crate semver from `aloud_core_version()`. A breaking change to a command or
snapshot shape bumps the contract major and is called out in an ADR.
