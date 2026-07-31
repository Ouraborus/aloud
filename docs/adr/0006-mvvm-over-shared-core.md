# ADR-0006: MVVM presentation over the shared core

- **Status:** Accepted
- **Context:** We want the familiar testability and structure of MVVM in the
  presentation layer, but MVVM on its own would push us toward one ViewModel per
  platform — each re-implementing reading logic, which is exactly the drift
  [ADR-0001](0001-rust-shared-core.md) exists to prevent.

## Decision
Use **MVVM at the edges, one reducer at the center.** The pieces map as:

| MVVM role | In Aloud |
|---|---|
| Model | the shared core's `Snapshot` (produced in Rust, identical on every platform) |
| ViewModel | a thin `ReadingSessionViewModel` that holds the latest snapshot, exposes intents, derives `viewState`, and coordinates a11y — **no reading logic** |
| View | RN components (or a fully-native screen) that bind to the ViewModel |

The ViewModel depends on the `AloudTts` **port**, not on `react-native`, so it is
unit-tested with a fake in plain Node
([`ReadingSessionViewModel.test.ts`](../../app/__tests__/ReadingSessionViewModel.test.ts)).
A React `useReadingSession` hook adapts it via `useSyncExternalStore`; a Swift
`ObservableObject` / Android `ViewModel` could bind the same snapshots natively.

## Consequences
- (+) All the ergonomic wins of MVVM (bindable state, testable VM) without
  duplicating logic across three ViewModels.
- (+) The View/ViewModel split keeps accessibility (a View concern) out of the
  reducer and out of the core.
- (−) Two "view-model-ish" concepts exist (the Rust reducer *is* the model layer,
  the TS `ViewModel` is the presentation VM); this ADR exists precisely to name
  that split so it does not confuse newcomers.
