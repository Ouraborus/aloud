package com.aloud.tts

import com.sun.jna.Library
import com.sun.jna.Native
import com.sun.jna.Pointer
import org.json.JSONObject

/**
 * Kotlin binding to the `aloud_core` C ABI via JNA (the same mechanism `uniffi`
 * uses). This is the Android end of the contract in
 * `contracts/ffi.contract.md`; it owns the session pointer and guarantees the
 * dispatch result string is freed.
 *
 * The shared library `libaloud_core.so` is produced by `cargo-ndk` per ABI and
 * packaged under `jniLibs/` (see android/README.md).
 */
private interface AloudCoreLib : Library {
    fun aloud_core_version(): Pointer
    fun aloud_session_new(text: String): Pointer?
    fun aloud_session_free(session: Pointer?)
    fun aloud_session_unit_count(session: Pointer?): Long
    fun aloud_session_dispatch(session: Pointer?, commandJson: String): Pointer
    fun aloud_string_free(ptr: Pointer?)
}

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

class AloudCore(text: String) {
    private val session: Pointer =
        LIB.aloud_session_new(text) ?: throw CoreException("INVALID_UTF8", "core rejected document text")

    val unitCount: Int get() = LIB.aloud_session_unit_count(session).toInt()

    /** Send a command object and decode the response into a [Snapshot]. */
    fun dispatch(command: JSONObject): Snapshot {
        val resultPtr = LIB.aloud_session_dispatch(session, command.toString())
        try {
            val json = resultPtr.getString(0, "UTF-8")
            val obj = JSONObject(json)
            if (obj.has("error")) {
                val err = obj.getJSONObject("error")
                throw CoreException(err.getString("code"), err.getString("message"))
            }
            return obj.toSnapshot()
        } finally {
            // The core owns the buffer until we hand it back.
            LIB.aloud_string_free(resultPtr)
        }
    }

    /** Release the Rust session. Safe to call once; do not use the core after. */
    fun release() = LIB.aloud_session_free(session)

    companion object {
        /** Convenience command builders, matching the Rust `#[serde(tag="type")]`. */
        fun play() = JSONObject().put("type", "Play")
        fun pause() = JSONObject().put("type", "Pause")
        fun next() = JSONObject().put("type", "Next")
        fun prev() = JSONObject().put("type", "Prev")
        fun getState() = JSONObject().put("type", "GetState")
        fun seekUnit(unit: Int) = JSONObject().put("type", "SeekUnit").put("unit", unit)
        fun wordBoundary(utf16Offset: Int) =
            JSONObject().put("type", "WordBoundary").put("utf16Offset", utf16Offset)

        val version: String get() = LIB.aloud_core_version().getString(0, "UTF-8")

        private val LIB: AloudCoreLib by lazy {
            Native.load("aloud_core", AloudCoreLib::class.java)
        }
    }
}

private fun JSONObject.toSnapshot(): Snapshot {
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
