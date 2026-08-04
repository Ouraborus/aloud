require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name           = "AloudTts"
  s.version        = package["version"]
  s.summary        = package["description"]
  s.license        = package["license"]
  s.homepage       = "https://github.com/Ouraborus/aloud"
  s.authors        = "Aloud contributors"
  s.platforms      = { ios: "15.1" }
  s.source         = { git: "https://github.com/Ouraborus/aloud.git" }

  # Swift + Objective-C bridge sources. Deliberately an explicit list rather
  # than a glob over `ios/**` — that would also sweep up the xcframework's own
  # internal headers once it's built (see below) and duplicate symbols.
  s.source_files = "ios/AloudCore.swift",
                    "ios/AloudTtsModule.swift",
                    "ios/AloudTtsModule.m"

  # The Rust core, prebuilt into a multi-arch xcframework by
  # `scripts/build-ios-core.sh` (device + simulator, arm64 + x86_64). Run that
  # script BEFORE `pod install` — this path must exist for CocoaPods to
  # validate the podspec, matching how other RN modules vendor prebuilt
  # binaries. See the root README for the one-line setup command.
  #
  # aloud_core.h is bundled inside the xcframework's own Headers/, alongside a
  # module.modulemap (see core/include/module.modulemap) naming it
  # `AloudCoreFFI` — AloudCore.swift does `import AloudCoreFFI` to see it. NOT
  # a bridging header: CocoaPods compiles any pod containing Swift +
  # DEFINES_MODULE as a *framework* target, and Xcode's Swift compiler
  # rejects bridging headers on framework targets outright ("using bridging
  # headers with framework targets is unsupported") — a proper Clang module
  # is the only mechanism that works here.
  s.vendored_frameworks = "ios/AloudCore.xcframework"

  s.pod_target_xcconfig = {
    "SWIFT_VERSION" => "5.0",
    "DEFINES_MODULE" => "YES",
  }

  s.dependency "React-Core"
end
