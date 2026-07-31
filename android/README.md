# Android native layer

The `AloudTts` module bridges React Native to Android `TextToSpeech` and the
shared Rust core (via JNA).

## Files
| File | Role |
|---|---|
| `AloudCore.kt` | JNA binding to the `aloud_core` C ABI; owns the session, does JSON dispatch. |
| `AloudTtsModule.kt` | The RN module: `TextToSpeech` + `AudioManager` focus + the `onRangeStart` word-boundary loop. |
| `AloudTtsPackage.kt` | Registers the module with the RN runtime. |

## Building the Rust core for Android
Use `cargo-ndk` to produce a `.so` per ABI and drop it under `jniLibs/`:

```bash
cargo install cargo-ndk
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 \
  -o android/src/main/jniLibs \
  build --release --manifest-path core/Cargo.toml
```

Add JNA to `build.gradle`: `implementation "net.java.dev.jna:jna:5.14.0@aar"`.

> As with iOS, CI in this example repo compiles and tests the Rust core and
> type-checks the JS, but does not run the full Gradle/NDK build (that needs the
> Android SDK/NDK toolchain). The Kotlin module and its FFI binding are present
> and reviewed.

## Audio focus & accessibility notes
- We request `AUDIOFOCUS_GAIN` with `USAGE_ASSISTANT` + `CONTENT_TYPE_SPEECH`, so
  the system treats our output as speech and coordinates with TalkBack's
  accessibility audio stream rather than fighting it.
- `isTouchExplorationEnabled` tells us TalkBack is active; we use it to decide
  whether to defer to the screen reader.
- Word boundaries come from `UtteranceProgressListener.onRangeStart`, whose
  `start` is a **UTF-16** index — handed straight to the core, which owns the
  UTF-16→UTF-8 conversion.
- A stable `utteranceId` per sentence lets `onDone`/`onRangeStart` correlate back
  to the sentence we asked the engine to speak.
