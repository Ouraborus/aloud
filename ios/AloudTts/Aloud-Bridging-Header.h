//
//  Aloud-Bridging-Header.h
//
//  Exposes the Rust core's C ABI to Swift. The header ships with the crate
//  (core/include/aloud_core.h) and is added to the app target's header search
//  path; the compiled static library (libaloud_core.a, built by cargo for the
//  device/simulator archs) is linked in. See ios/README.md for the xcframework
//  build step.
//

#import "aloud_core.h"
