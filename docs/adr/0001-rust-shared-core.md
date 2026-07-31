# ADR-0001: A shared Rust core owns reading logic

- **Status:** Accepted
- **Context:** The reading experience needs identical behaviour on iOS and
  Android: how text splits into sentences and words, where the highlight sits,
  and how play/pause/seek transition. Re-implementing that three times (Swift,
  Kotlin, JS) guarantees drift — the same input eventually highlights a different
  word on one platform, and the bug only reproduces on that platform.

## Decision
Put segmentation, the reading-position state machine, and all offset math in a
single **Rust** crate (`core/`) compiled into every platform:

- One implementation, one test suite (`cargo test`), run on every push.
- Rust gives us a C ABI for free, no GC to fight across the FFI, and memory
  safety in the layer most likely to be shared and least likely to be re-tested
  per platform.
- The crate does **no I/O** — it is a pure reducer — so it is fully testable off
  device and cannot "work on my simulator but not the phone".

## Consequences
- (+) Behaviour is defined once; a fix lands everywhere at once.
- (+) The hardest logic runs on a laptop CI in milliseconds.
- (−) Contributors need enough Rust to work in the core, and a cross-compilation
  step (`xcframework` / `cargo-ndk`) exists in the native builds.
- (−) A boundary now exists to manage — addressed by [ADR-0002](0002-contract-first-ffi.md).
