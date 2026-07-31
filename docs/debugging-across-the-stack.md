# Debugging across the stack

A single Aloud action produces logs in four places: JS (Metro), native
(Console.app / Logcat), Rust (stderr, surfaced through the native log), and the
WebView console. This document shows how the correlation trace id
([ADR-0005](adr/0005-cross-layer-tracing.md)) turns "four logs and a stopwatch"
into one `grep`.

## The shared log grammar

Every layer emits:

```
[aloud t=<traceId> layer=<js|native|rust|webview> op=<name>] message
```

- `t` — the trace id minted per user intent in the ViewModel.
- `layer` — which of the four streams this came from.
- `op` — the intent (`play`, `seek`, `wordBoundary`, …).

## Worked example: "the highlight is one word behind on Android"

Reproduce, grab the trace id from the JS log, then filter every stream by it:

```text
[aloud t=k2p-014 layer=js     op=play] start
[aloud t=k2p-014 layer=native op=play] unitCount=12
[aloud t=k2p-014 layer=rust   op=dispatch] Play -> unit=0 token=0 highlight=0..5
[aloud t=k2p-014 layer=native op=wordBoundary] onRangeStart start=6
[aloud t=k2p-014 layer=rust   op=dispatch] WordBoundary utf16=6 -> token=1 highlight=6..11
[aloud t=k2p-014 layer=webview op=highlight] painted 6..11
```

Reading top-to-bottom in trace order tells you *which layer first diverged*:

- If `rust` reports the right token but `webview` paints the wrong span → the bug
  is in the byte→char mapping in `reader.js`.
- If `native` sends `start=` off by a word → the engine's boundary timing or the
  utterance text handed to it is wrong (a per-vendor quirk), not the core.
- If `rust` computes the wrong token for a correct offset → the bug is in the
  core, and there is a failing unit test to add.

The point of the discipline: **find the layer that first diverges before writing
a fix**, instead of guessing and patching the layer where the symptom shows up.

## Layer-by-layer log sources
| Layer | Where | How to filter |
|---|---|---|
| JS | Metro / `console` | `t=<id>` |
| iOS native | Console.app / Xcode | `NSLog` prefix, filter by subsystem/text |
| Android native | `adb logcat` | `adb logcat | grep "t=<id>"` |
| Rust | routed through native `NSLog`/`Log.i` | same id |
| WebView | `webview.onMessage` debug channel / Safari Web Inspector | `t=<id>` |

## Tips
- The core is pure and does not own a platform sink; it returns enough in each
  `Snapshot` that the native caller can log on its behalf with the same id.
- `aloud_core_version()` is logged at load, so a bug report always states the
  exact engine build all four layers were running.
