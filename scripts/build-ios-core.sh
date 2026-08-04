#!/usr/bin/env bash
# Cross-compiles the aloud_core Rust engine for iOS and packages it as
# AloudCore.xcframework, vendored by native/aloud-tts/AloudTts.podspec.
#
# Run this ONCE before `pod install` in example/ios (or whenever core/ changes).
# It is not run automatically by `npm install`, because it needs the Rust
# toolchain + iOS targets, which a pure-JS contributor may not have installed.
#
# Usage: scripts/build-ios-core.sh
set -euo pipefail

# If both a non-rustup cargo (e.g. Homebrew's) and rustup are installed, the
# Homebrew one usually wins on PATH and silently lacks iOS cross-target
# support (`error[E0463]: can't find crate for 'core'`). rustup's own cargo is
# always at ~/.cargo/bin — prefer it explicitly rather than trust the caller's
# PATH order.
if [ -x "$HOME/.cargo/bin/cargo" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE="$ROOT/core"
OUT="$ROOT/native/aloud-tts/ios/AloudCore.xcframework"

command -v cargo >/dev/null || { echo "error: cargo not found — install Rust via rustup (https://rustup.rs), not just Homebrew: Homebrew's Rust cannot cross-compile for iOS."; exit 1; }
command -v rustup >/dev/null || { echo "error: rustup not found — install Rust via https://rustup.rs (a Homebrew-only Rust install can't add iOS targets)"; exit 1; }
command -v xcodebuild >/dev/null || { echo "error: xcodebuild not found — install Xcode"; exit 1; }

echo "==> Ensuring iOS Rust targets are installed"
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

build() {
  local target=$1
  echo "==> cargo build --release --target $target"
  cargo build --release --manifest-path "$CORE/Cargo.toml" --target "$target"
}

build aarch64-apple-ios       # physical devices
build aarch64-apple-ios-sim   # Apple Silicon simulator
build x86_64-apple-ios        # Intel Mac simulator

# The simulator slot in an xcframework must be ONE (possibly multi-arch) slice,
# so fold the two simulator archs into a single fat static library with lipo.
# It MUST be named identically to the device slice's binary (libaloud_core.a)
# — CocoaPods rejects a vendored xcframework whose per-slice static libraries
# have different binary names, even though the containing .a files sit in
# different directories.
SIM_DIR="$CORE/target/ios-sim-fat"
mkdir -p "$SIM_DIR"
SIM_FAT="$SIM_DIR/libaloud_core.a"
echo "==> lipo: combining simulator archs (arm64 + x86_64) into $SIM_FAT"
lipo -create \
  "$CORE/target/aarch64-apple-ios-sim/release/libaloud_core.a" \
  "$CORE/target/x86_64-apple-ios/release/libaloud_core.a" \
  -output "$SIM_FAT"

echo "==> xcodebuild -create-xcframework -> $OUT"
rm -rf "$OUT"
xcodebuild -create-xcframework \
  -library "$CORE/target/aarch64-apple-ios/release/libaloud_core.a" -headers "$CORE/include" \
  -library "$SIM_FAT" -headers "$CORE/include" \
  -output "$OUT"

echo "==> Done. $OUT is ready for 'pod install' in example/ios."
