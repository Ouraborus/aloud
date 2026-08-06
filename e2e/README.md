# End-to-end tests

One Maestro flow, [`read-aloud.yaml`](read-aloud.yaml), exercises the read-aloud
path on a booted simulator: the app loads, the WebView renders the document, and
the controls drive the shared Rust core with the resulting `Snapshot` coming
back up into the UI.

## Why just one flow
E2E is the slowest, flakiest layer, so we keep it to a single **golden path**
that proves the whole bridge is alive: RN → native module → Rust core → back up
→ WebView. Everything else (segmentation, state transitions, the a11y policy,
the FFI contract) is covered far more cheaply by the Rust, TypeScript and native
contract suites — see [`docs/testing-strategy.md`](../docs/testing-strategy.md).

## What it asserts, and what it deliberately does not
Every selector in the flow was taken from a real `maestro hierarchy` dump rather
than from what the app "should" expose. Two things follow from that:

- **There are no testIDs.** The controls are matched by their accessibility
  labels, which is a feature rather than a workaround: if a label regresses, a
  screen-reader user loses that control and this flow goes red for exactly the
  same reason.
- **The WebView's DOM is not addressable.** The `<mark id="aloud-current">`
  highlight does not appear in the hierarchy, so the canvas is asserted through
  its document title and the article text — which still proves the document
  crossed from JS into the WebView.

The flow does **not** assert that the highlight advances during playback. That
depends on real TTS audio timing, which is not deterministic in a simulator, and
a flaky golden path is worse than a narrow one. Word-boundary behaviour is
covered off-device by the Rust suite and by the JSDOM tests in
[`app/__tests__/reader.test.ts`](../app/__tests__/reader.test.ts).

## Running locally
Maestro needs a JDK (17 is fine) and a booted simulator with the app installed.

```bash
# once
curl -fsSL https://get.maestro.mobile.dev | bash
export PATH="$PATH:$HOME/.maestro/bin"

# with Metro running and the app installed (see the root README's "Run it")
maestro test e2e/read-aloud.yaml
```

`maestro hierarchy` is the tool to reach for when an assertion fails: it prints
exactly what Maestro can see, which is rarely what the JSX suggests.

## In CI
Runs on the `e2e-ios` job in
[`device-toolchain.yml`](../.github/workflows/device-toolchain.yml) — a macOS
runner that builds the xcframework, builds the app, boots a simulator and runs
this flow. It sits in the slow workflow, not the fast path.

The job builds **Release**, which matters for two reasons: the JS bundle is
embedded, so no Metro dev server has to be orchestrated, and it exercises what
would actually ship. That second point is not theoretical —
[#40](https://github.com/Ouraborus/aloud/issues/40) was a bug that existed
*only* in Release builds, and it was found by running this flow against one.
