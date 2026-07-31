# iOS native layer

The `AloudTts` native module bridges React Native to the platform TTS engine and
the shared Rust core.

## Files
| File | Role |
|---|---|
| `AloudCore.swift` | Safe Swift wrapper over the `aloud_core` C ABI; owns the session pointer, does JSON dispatch. |
| `AloudTtsModule.swift` | The RN `RCTEventEmitter` module: `AVSpeechSynthesizer` + `AVAudioSession` + the word-boundary delegate loop. |
| `AloudTtsModule.m` | `RCT_EXTERN_MODULE` / `RCT_EXTERN_METHOD` bridge — selectors must match the Swift `@objc` names exactly. |
| `Aloud-Bridging-Header.h` | Imports `core/include/aloud_core.h` so Swift can call the FFI. |

## Building & linking the Rust core
The core is compiled to a static library per Apple arch and packaged as an
`.xcframework`:

```bash
# Device (arm64) + simulator (arm64) — add x86_64 for Intel sims if needed.
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
cargo build --release --manifest-path ../core/Cargo.toml --target aarch64-apple-ios
cargo build --release --manifest-path ../core/Cargo.toml --target aarch64-apple-ios-sim

xcodebuild -create-xcframework \
  -library ../core/target/aarch64-apple-ios/release/libaloud_core.a \
    -headers ../core/include \
  -library ../core/target/aarch64-apple-ios-sim/release/libaloud_core.a \
    -headers ../core/include \
  -output AloudCore.xcframework
```

Add `AloudCore.xcframework` to *Frameworks, Libraries, and Embedded Content* and
set the bridging header to `Aloud-Bridging-Header.h`.

> This packaging is scripted in CI but **not compiled in the example repo's CI**
> (no signing / device toolchain there). The Rust core, its C header, and the
> Swift wrapper are all present and reviewed; only the archive step is
> environment-specific.

## Audio session & accessibility notes
- We use `AVAudioSession` category `.playback`, mode **`.spokenAudio`** — the
  correct choice for a reader that must coexist with VoiceOver instead of ducking
  it into silence.
- We observe `voiceOverStatusDidChangeNotification` and pause our own speech if
  VoiceOver starts mid-playback, so the two speech streams never overlap.
- For background playback, add the **Audio** background mode to `Info.plist`
  (`UIBackgroundModes` → `audio`).
- The word-boundary highlight is driven by
  `willSpeakRangeOfSpeechString`, whose `NSRange.location` is a **UTF-16** offset
  — handed straight to the core, which owns the UTF-16→UTF-8 conversion.
