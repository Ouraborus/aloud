# iOS native layer

The `AloudTts` native module bridges React Native to `AVSpeechSynthesizer` and
the shared Rust core. It ships as a proper local React Native library
(`@aloud/aloud-tts` + `AloudTts.podspec`) — a consuming app installs it and runs
`pod install`; **nothing is wired into Xcode by hand.**

## Files
| File | Role |
|---|---|
| `AloudCore.swift` | Safe Swift wrapper over the `aloud_core` C ABI; owns the session pointer, does JSON dispatch. |
| `AloudTtsModule.swift` | The RN `RCTEventEmitter` module: `AVSpeechSynthesizer` + `AVAudioSession` + the word-boundary delegate loop. |
| `AloudTtsModule.m` | `RCT_EXTERN_MODULE` / `RCT_EXTERN_METHOD` bridge — selectors must match the Swift `@objc` names exactly. |
| `AloudCore.xcframework` | **Build output**, not checked in — produced by `scripts/build-ios-core.sh`. |

`AloudCore.swift` sees the Rust C ABI via `import AloudCoreFFI`, a Clang module
defined by [`core/include/module.modulemap`](../../../core/include/module.modulemap)
and bundled into the xcframework's headers — **not** a bridging header.
CocoaPods compiles any pod containing Swift + `DEFINES_MODULE` as a *framework*
target, and Xcode's Swift compiler rejects bridging headers on framework
targets outright (`using bridging headers with framework targets is
unsupported`); a real module is the only mechanism that works for a
Swift+vendored-C-library pod like this one.

## One-time setup
From the repo root:

```bash
scripts/build-ios-core.sh          # cross-compiles core/ -> AloudCore.xcframework
cd example/ios && pod install      # CocoaPods autolinks AloudTts.podspec automatically
```

`use_native_modules!` in `example/ios/Podfile` (the standard RN template line —
nothing Aloud-specific) discovers `AloudTts.podspec` via
`node_modules/@aloud/aloud-tts`, which npm workspaces symlinks there. Re-run the
build script whenever `core/` changes; re-run `pod install` whenever this
module's Swift/ObjC sources or podspec change.

> **What's verified here vs. not:** the Rust core, this Swift module, and this
> exact podspec/xcframework pipeline were built, linked, and run on the iOS
> Simulator during development (see the root README's "what's verified"
> section) — this isn't a paper design.

## Audio session & accessibility notes
- We use `AVAudioSession` category `.playback`, mode **`.spokenAudio`** — the
  correct choice for a reader that must coexist with VoiceOver instead of ducking
  it into silence.
- We observe `voiceOverStatusDidChangeNotification` and pause our own speech if
  VoiceOver starts mid-playback, so the two speech streams never overlap.
- For background playback, add the **Audio** background mode to the app's
  `Info.plist` (`UIBackgroundModes` → `audio`).
- The word-boundary highlight is driven by `willSpeakRangeOfSpeechString`, whose
  `NSRange.location` is a **UTF-16** offset — handed straight to the core, which
  owns the UTF-16→UTF-8 conversion.
