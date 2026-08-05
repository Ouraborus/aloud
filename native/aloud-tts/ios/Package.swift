// swift-tools-version:5.9
//
// A test-only Swift package. It exists so the Swift side of the FFI contract
// can be executed against `contracts/fixtures.json` in CI as a plain
// `swift test` — no Xcode project, no xcframework, no simulator, no CocoaPods.
//
// It compiles exactly ONE production file, `AloudProtocol.swift`, which imports
// nothing but Foundation. The files that need the Rust core or React
// (`AloudCore.swift`, `AloudTtsModule.swift`) are deliberately excluded: they
// cannot build without the xcframework, and the contract does not need them.
//
// This package is invisible to the app build — the podspec lists its sources
// explicitly rather than globbing, so nothing here is compiled into the pod.

import PackageDescription

let package = Package(
    name: "AloudContract",
    platforms: [.macOS(.v12)],
    targets: [
        .testTarget(
            name: "AloudContractTests",
            path: ".",
            exclude: [
                "AloudCore.swift",
                "AloudTtsModule.swift",
                "AloudTtsModule.m",
                "AloudCore.xcframework",
                "README.md",
            ],
            sources: [
                "AloudProtocol.swift",
                "ContractTests/AloudContractTests.swift",
            ]
        )
    ]
)
