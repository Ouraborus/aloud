# example — a runnable Aloud host app

A minimal React Native app that exists to prove `@aloud/app` and
`@aloud/aloud-tts` work as **real, autolinked packages**, not a hand-pasted
demo. It's a thin shell (`App.tsx`) around `<ReaderScreen>`, imported like any
consumer would: `import { ReaderScreen } from "@aloud/app"`.

## Prerequisites

- Node.js 22+, and the repo's npm workspace installed (`npm install` at the
  **repo root**, not in here — see the [root README](../README.md#run-it)).
- **iOS**: Xcode, CocoaPods, and the **Rust toolchain via [rustup](https://rustup.rs)**
  with the iOS targets. A Homebrew-only Rust install cannot cross-compile for
  iOS — `npm run build:core:ios` (from the root) will tell you if that's the
  problem.
- **Android**: Android Studio/SDK, the Android NDK (`ANDROID_NDK_HOME` set),
  and [`cargo-ndk`](https://github.com/bbqsrc/cargo-ndk) (`cargo install cargo-ndk`).

## Run on iOS Simulator

From the **repo root**:

```bash
npm install
npm run build:core:ios          # -> native/aloud-tts/ios/AloudCore.xcframework
cd example/ios && pod install && cd ../..
npm run example:ios             # boots the simulator, builds, launches
```

Metro serves the JS separately; `npm run example:ios` starts it for you. To run
them in two terminals instead (useful for watching Metro's logs):

```bash
# terminal 1
npm run example:start

# terminal 2
cd example && npx react-native run-ios --simulator "iPhone 16"
```

## Run on Android

```bash
npm install
npm run build:core:android      # -> native/aloud-tts/android/src/main/jniLibs
npm run example:android
```

*(Written to current RN/Gradle conventions but not compiled in this repo's own
authoring environment — see the root README's "what's verified" table. If you
hit a Gradle issue, it's most likely a version-alignment fix, not a design
problem with the module.)*

## Why this app is so small

On purpose. It contains no reading logic — everything interesting is in
`@aloud/app` (tested with Vitest, no device needed) and `@aloud/aloud-tts`
(the platform audio/TTS code). This app's only job is to prove the two
packages compose into something that actually runs, the same way a real
consumer's app would depend on them.

## Troubleshooting

- **`CocoaPods requires your terminal to be using UTF-8 encoding` / a Ruby
  `Encoding::CompatibilityError` crash** — set the locale before running pod
  commands: `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.
- **`Unable to install vendored xcframework ... differing binary names`** — the
  xcframework wasn't built by `scripts/build-ios-core.sh` (which names every
  slice's static library `libaloud_core.a` consistently); rebuild it with that
  script rather than a hand-rolled `xcodebuild -create-xcframework` command.
- **`error[E0463]: can't find crate for 'core'` while building the Rust core
  for iOS** — you have a Homebrew-only Rust install shadowing rustup's on
  `PATH`. Install Rust via [rustup.rs](https://rustup.rs); the build script
  now prefers `~/.cargo/bin` explicitly, but a broken shell profile can still
  reintroduce the conflict.
- **Metro can't resolve `@aloud/app`** — make sure you ran `npm install` at the
  **repo root** (not inside `example/`), so the workspace symlinks exist in the
  root `node_modules/`.
