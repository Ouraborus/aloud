# Android native layer

The `AloudTts` module bridges React Native to Android `TextToSpeech` and the
shared Rust core (via JNA). Like the iOS side, it ships as a proper local
library (`@aloud/aloud-tts` + `android/build.gradle`) — React Native's Gradle
autolinking adds it to the app automatically; **`settings.gradle` and
`app/build.gradle` are not edited by hand.**

## Files
| File | Role |
|---|---|
| `AloudCore.kt` | JNA binding to the `aloud_core` C ABI; owns the session and frees dispatch results. |
| `AloudTtsModule.kt` | The RN module: `TextToSpeech` + `AudioManager` focus + the `onRangeStart` word-boundary loop. |
| `AloudTtsPackage.kt` | Registers the module with the RN runtime — autolinking generates the code that instantiates this. |
| `src/main/jniLibs/` | **Build output**, not checked in — produced by `scripts/build-android-core.sh`. |

## One-time setup
Requires the Android SDK + NDK (set `ANDROID_NDK_HOME`) and `cargo-ndk`
(`cargo install cargo-ndk`). From the repo root:

```bash
scripts/build-android-core.sh      # cross-compiles core/ -> one .so per ABI
cd example/android && ./gradlew assembleDebug
```

`../../native/aloud-tts/react-native.config.js` pins the package/class names
explicitly for the autolinking CLI (the npm package folder name, `aloud-tts`,
doesn't textually match the Kotlin class `AloudTtsPackage`, so we don't rely on
the CLI's name-guessing).

> **What's verified here vs. not:** this Gradle module, its dependency on JNA,
> and the cargo-ndk build script were written and reviewed to current RN 0.86 /
> AGP conventions, but **not compiled** — this authoring environment has no
> JDK or Android SDK installed. The Kotlin source itself is the same code
> exercised in earlier reviews; what's unverified is the Gradle plumbing around
> it. See the root README's "what's verified" section for the honest split.

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
