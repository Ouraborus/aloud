# End-to-end tests

One Maestro flow, [`read-aloud.yaml`](read-aloud.yaml), exercises the full
read-aloud path on a real device/emulator: load → play → highlight advances →
next → pause.

## Why just one flow
E2E is the slowest, flakiest layer, so we keep it to a single **golden path**
that proves the whole bridge is alive: RN → native module → Rust core → back up →
WebView highlight. Everything else (segmentation, state transitions, the a11y
policy, the FFI contract) is covered far more cheaply by the Rust and TS suites —
see [`docs/testing-strategy.md`](../docs/testing-strategy.md).

## Running
```bash
# iOS simulator or Android emulator booted, app installed as com.aloud.example
maestro test e2e/read-aloud.yaml
```

## In CI
This flow runs on the device-toolchain job (macOS runner with a booted
simulator), separate from the fast Rust + JS job that runs on every push.
