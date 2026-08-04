#!/usr/bin/env bash
# Cross-compiles the aloud_core Rust engine for Android and drops one .so per
# ABI into native/aloud-tts/android/src/main/jniLibs, picked up by Gradle via
# the sourceSets.main.jniLibs.srcDirs entry in native/aloud-tts/android/build.gradle.
#
# Requires the Android NDK (set ANDROID_NDK_HOME) and cargo-ndk. Run once
# before building the example app for Android, or whenever core/ changes.
#
# Usage: scripts/build-android-core.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE="$ROOT/core"
OUT="$ROOT/native/aloud-tts/android/src/main/jniLibs"

command -v cargo >/dev/null || { echo "error: cargo not found — install Rust (https://rustup.rs)"; exit 1; }
command -v cargo-ndk >/dev/null || { echo "error: cargo-ndk not found — run: cargo install cargo-ndk"; exit 1; }
: "${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME to your Android NDK path}"

echo "==> Ensuring Android Rust targets are installed"
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android 2>/dev/null || true

mkdir -p "$OUT"
echo "==> cargo ndk build (arm64-v8a, armeabi-v7a, x86_64) -> $OUT"
cargo ndk \
  -t arm64-v8a -t armeabi-v7a -t x86_64 \
  -o "$OUT" \
  build --release --manifest-path "$CORE/Cargo.toml"

echo "==> Done. $OUT/*/libaloud_core.so is ready for Gradle."
