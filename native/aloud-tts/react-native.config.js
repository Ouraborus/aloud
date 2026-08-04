// Explicit autolinking hints for Android. iOS autolinking finds AloudTts.podspec
// on its own (via `use_native_modules!` in the example app's Podfile); Android's
// autolinking is normally convention-based too, but we pin the package/class
// names explicitly here since "aloud-tts" (the npm package folder) doesn't
// textually match "AloudTtsPackage" (the Kotlin class) — being explicit avoids
// depending on the CLI's name-guessing heuristic.
module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath: "import com.aloud.tts.AloudTtsPackage;",
        packageInstance: "new AloudTtsPackage()",
      },
      ios: {
        podspecPath: __dirname + "/AloudTts.podspec",
      },
    },
  },
};
