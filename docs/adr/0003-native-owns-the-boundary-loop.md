# ADR-0003: The word-boundary loop runs native-side

- **Status:** Accepted
- **Context:** As a sentence is spoken, the TTS engine emits a word-boundary
  callback for every word — `willSpeakRangeOfSpeechString` on iOS,
  `onRangeStart` on Android — often dozens per second, on the audio thread. Each
  one must update the highlight. We could route each event up to JS, into the
  core, and back down, or keep the loop native.

## Decision
The **native module** owns the tight loop. On each boundary it calls the core's
`WordBoundary` command directly and **streams the resulting `Snapshot` up to JS**
as an event. JS sends only coarse intents (`play`, `pause`, `seek`) and renders
snapshots.

## Consequences
- (+) The highlight stays in lock-step with the audio with no per-word JS bridge
  hop, avoiding jank and dropped frames.
- (+) The core still owns the offset math (native passes the raw UTF-16 offset
  straight through), so there is no logic duplicated on the native side.
- (−) Native code participates in the loop, so the native module has real
  responsibility and needs its own tests — accepted; it is where the audio
  session and engine live anyway.
- (−) Snapshots now arrive on two paths (intent resolution and native events);
  the ViewModel treats both identically through one `applySnapshot`.
