// This package ships native code only (Swift/ObjC for iOS, Kotlin for
// Android) — it has no JS API of its own. Consumers reach it through
// `NativeModules.AloudTts`, wrapped by the typed adapter in
// `@aloud/app` (`src/native/AloudTts.native.ts`), which implements the
// `AloudTts` port defined in `AloudTtsSpec.ts`.
//
// This file exists only so `main` in package.json resolves to something.
module.exports = {};
