// JVM-only Gradle build for the Kotlin side of the FFI contract.
//
// It compiles exactly one production file — ../src/main/java/com/aloud/tts/
// AloudProtocol.kt — which depends on nothing but `org.json`. The files that
// need JNA or Android (AloudCore.kt, AloudTtsModule.kt, AloudTtsPackage.kt)
// are excluded from compilation: they cannot build without the native .so and
// the SDK, and the contract does not need them.
//
// Fidelity note: Android's own unit tests run on the JVM against a stub
// android.jar whose org.json throws unless the real artifact is added, so
// routing this through the Android Gradle Plugin would exercise the same
// org.json implementation — at the cost of an SDK install on every CI run.

import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    kotlin("jvm") version "2.0.21"
}

repositories { mavenCentral() }

// Compile the shared protocol file IN PLACE rather than copying it into this
// project. A copy is exactly the drift these tests exist to prevent.
kotlin {
    sourceSets["test"].kotlin.srcDir("../src/main/java")
}

tasks.withType<KotlinCompile>().configureEach {
    exclude("**/AloudCore.kt", "**/AloudTtsModule.kt", "**/AloudTtsPackage.kt")
}

dependencies {
    testImplementation("org.json:json:20240303")
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    // Deterministic working directory: the test walks up from here to find
    // contracts/fixtures.json.
    workingDir = projectDir
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = true
    }
}
