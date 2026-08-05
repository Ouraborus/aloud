package com.aloud.tts

import org.json.JSONObject

/**
 * The Kotlin side of `contracts/commands.schema.json` — the exact shapes that
 * cross the FFI boundary as JSON.
 *
 * Deliberately kept in its own file, depending on nothing but `org.json`, so the
 * contract tests can compile it WITHOUT JNA, the native `.so`, the Android SDK
 * or an emulator. That is what lets `android/contract-tests` run these types
 * against the shared `contracts/fixtures.json` as an ordinary JVM Gradle build
 * in CI — the Kotlin mirror of `ios/AloudProtocol.swift`.
 *
 * Note this costs no fidelity: Android's own unit tests run on the JVM against a
 * stub `android.jar` whose `org.json` throws unless the real artifact is added,
 * so the "proper" Android route would exercise the same `org.json` this does.
 *
 * The JNA wrapper that USES these types lives next door in AloudCore.kt.
 */

/** A parse error surfaced from the core as a typed exception. */
class CoreException(val code: String, override val message: String) : Exception(message)

data class Highlight(val start: Int, val end: Int)

data class Snapshot(
    val status: String,
    val unit: Int,
    val unitCount: Int,
    val token: Int,
    val tokenCount: Int,
    val utterance: String,
    val highlight: Highlight?,
)

/**
 * Command builders. The `type` strings here must match the Rust
 * `#[serde(tag = "type")]` variants exactly — a typo is rejected at runtime by
 * the core's deserialiser, never by the Kotlin compiler, which is precisely why
 * the contract test asserts them against the shared fixtures.
 */
object AloudCommand {
    fun play(): JSONObject = JSONObject().put("type", "Play")
    fun pause(): JSONObject = JSONObject().put("type", "Pause")
    fun next(): JSONObject = JSONObject().put("type", "Next")
    fun prev(): JSONObject = JSONObject().put("type", "Prev")
    fun getState(): JSONObject = JSONObject().put("type", "GetState")
    fun seekUnit(unit: Int): JSONObject = JSONObject().put("type", "SeekUnit").put("unit", unit)
    fun seekByte(byte: Int): JSONObject = JSONObject().put("type", "SeekByte").put("byte", byte)
    fun wordBoundary(utf16Offset: Int): JSONObject =
        JSONObject().put("type", "WordBoundary").put("utf16Offset", utf16Offset)
}

/**
 * Decode a core response object into a [Snapshot]. `internal` rather than
 * private so the contract tests, which compile this file directly, can exercise
 * it without going through JNA.
 */
internal fun JSONObject.toSnapshot(): Snapshot {
    val highlight = optJSONObject("highlight")?.let {
        Highlight(it.getInt("start"), it.getInt("end"))
    }
    return Snapshot(
        status = getString("status"),
        unit = getInt("unit"),
        unitCount = getInt("unitCount"),
        token = getInt("token"),
        tokenCount = getInt("tokenCount"),
        utterance = getString("utterance"),
        highlight = highlight,
    )
}
