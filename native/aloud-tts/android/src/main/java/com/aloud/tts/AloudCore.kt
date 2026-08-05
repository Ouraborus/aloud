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
    /**
     * The C ABI declares `uint32_t`, so this MUST be a 32-bit `Int` — JNA maps
     * Kotlin `Long` to a 64-bit native integer unconditionally. It previously
     * declared `Long` against a `size_t` return, which is 4 bytes on
     * armeabi-v7a: JNA read 8, so the high half was whatever happened to be in
     * the register. Correct on arm64, garbage on 32-bit. See the "fixed-width"
     * rule in contracts/ffi.contract.md.
     */
    fun aloud_session_unit_count(session: Pointer?): Int
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

/**
 * Owns one Rust session pointer.
 *
 * ## Ownership rule (the same one [AloudCore.swift] implements)
 * The session is freed **exactly once**. Swift gets that for free from ARC via
 * `deinit`; Kotlin has no deterministic destructor, so the caller must call
 * [release] — but calling it more than once, or dispatching after it, must never
 * corrupt memory. `aloud_core.h` is explicit that double-freeing is undefined
 * behaviour, so that guarantee lives here, in the type that owns the pointer,
 * rather than in every caller remembering to null its reference.
 *
 * Known limitation: there is no finalizer, so an instance dropped **without**
 * [release] leaks the Rust session until the process exits. That is the right
 * trade for a JNA binding — finalizers are deprecated and unreliable, and a
 * leak is far less harmful than a free racing the GC — but it does mean
 * `release()` is mandatory, not merely polite. [AloudTtsModule] calls it from
 * both `release()` and `load()`.
 */
class AloudCore(text: String) {
    private var session: Pointer? =
        LIB.aloud_session_new(text) ?: throw CoreException("INVALID_UTF8", "core rejected document text")

    /** The live pointer, or a typed error if the session was already released. */
    private fun requireSession(): Pointer =
        session ?: throw CoreException("NULL_POINTER", "core session has been released")

    val unitCount: Int get() = LIB.aloud_session_unit_count(requireSession())

    /** Send a command object and decode the response into a [Snapshot]. */
    fun dispatch(command: JSONObject): Snapshot {
        val resultPtr = LIB.aloud_session_dispatch(requireSession(), command.toString())
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

    /**
     * Release the Rust session. **Idempotent** — calling it again is a no-op,
     * and any later use throws a typed [CoreException] instead of dereferencing
     * a dangling pointer. Callers still should not use the core afterwards; this
     * only guarantees that doing so fails loudly rather than corrupting memory.
     */
    fun release() {
        // Clear the field first, so a concurrent or re-entrant call cannot pass
        // the same pointer to the allocator twice.
        val handle = session ?: return
        session = null
        LIB.aloud_session_free(handle)
    }

    companion object {
        /** Convenience command builders, matching the Rust `#[serde(tag="type")]`. */
        fun play() = JSONObject().put("type", "Play")
        fun pause() = JSONObject().put("type", "Pause")
        fun next() = JSONObject().put("type", "Next")
        fun prev() = JSONObject().put("type", "Prev")
        fun getState() = JSONObject().put("type", "GetState")
        fun seekUnit(unit: Int) = JSONObject().put("type", "SeekUnit").put("unit", unit)
        fun seekByte(byte: Int) = JSONObject().put("type", "SeekByte").put("byte", byte)
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
