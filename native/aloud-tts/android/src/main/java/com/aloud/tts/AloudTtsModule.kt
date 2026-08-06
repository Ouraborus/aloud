package com.aloud.tts

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.view.accessibility.AccessibilityManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale

/**
 * The Android native module. Mirror image of the iOS one: it owns the shared
 * Rust core, the platform `TextToSpeech` engine, and audio focus, and runs the
 * word-boundary loop natively while streaming `Snapshot`s to JS.
 *
 * The per-vendor quirk this file exists to absorb: Android reports word
 * boundaries via `UtteranceProgressListener.onRangeStart`, whose `start` is a
 * **UTF-16** code-unit index into the utterance — the same shape iOS gives us,
 * and exactly what the core's `WordBoundary` command consumes.
 */
class AloudTtsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var tts: TextToSpeech? = null
    private var core: AloudCore? = null
    private var ready = false
    private var activeTraceId = "-"
    private var focusRequest: AudioFocusRequest? = null
    /**
     * The utteranceId of the most recent `speak()` call. `onRangeStart`/`onDone`
     * below discard any callback whose id doesn't match this.
     *
     * Why: seeking (tap-to-seek, next/prev) stops the in-flight utterance and
     * immediately starts a new one. `TextToSpeech.stop()` does not guarantee a
     * callback already queued for the OLD utterance is suppressed before the NEW
     * one starts producing its own — without this guard, a stale word-boundary
     * report from the utterance we just abandoned could move the highlight to
     * the wrong word for a moment (an intermittent "highlight desyncs from the
     * audio" bug). The id must be unique per `speak()` call, not just per
     * sentence — a seek that lands in the SAME sentence still starts a genuinely
     * new utterance, so `"aloud-$unit"` alone can't tell old and new apart.
     */
    private var currentUtteranceId: String? = null
    private var utteranceGeneration = 0

    private val audioManager =
        reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    override fun getName() = "AloudTts"

    // --- exported intents ----------------------------------------------------

    @ReactMethod
    fun getCoreVersion(promise: Promise) = promise.resolve(AloudCore.version)

    @ReactMethod
    fun load(text: String, traceId: String, promise: Promise) {
        activeTraceId = traceId
        try {
            core?.release()
            core = AloudCore(text)
            ensureEngine {
                val snap = core!!.dispatch(AloudCore.getState())
                promise.resolve(snap.toWritableMap())
            }
        } catch (e: CoreException) {
            promise.reject(e.code, e.message)
        }
    }

    @ReactMethod
    fun play(traceId: String, promise: Promise) = run(traceId, promise) { core ->
        val snap = core.dispatch(AloudCore.play())
        requestAudioFocus()
        speakCurrent(snap)
        snap
    }

    @ReactMethod
    fun pause(traceId: String, promise: Promise) = run(traceId, promise) { core ->
        tts?.stop()
        currentUtteranceId = null
        val snap = core.dispatch(AloudCore.pause())
        abandonAudioFocus()
        snap
    }

    @ReactMethod
    fun next(traceId: String, promise: Promise) = run(traceId, promise) { core ->
        tts?.stop()
        val snap = core.dispatch(AloudCore.next())
        speakCurrent(snap)
        snap
    }

    @ReactMethod
    fun prev(traceId: String, promise: Promise) = run(traceId, promise) { core ->
        tts?.stop()
        val snap = core.dispatch(AloudCore.prev())
        speakCurrent(snap)
        snap
    }

    @ReactMethod
    fun seekUnit(unit: Int, traceId: String, promise: Promise) = run(traceId, promise) { core ->
        tts?.stop()
        val snap = core.dispatch(AloudCore.seekUnit(unit))
        speakCurrent(snap)
        snap
    }

    /**
     * Set the speech-rate multiplier (1.0 = normal). Android's `setSpeechRate`
     * already uses the same convention, so we pass it through (clamped) and it
     * applies to subsequent utterances.
     */
    @ReactMethod
    fun setRate(rate: Double, traceId: String, promise: Promise) {
        activeTraceId = traceId
        val clamped = rate.coerceIn(0.5, 2.0).toFloat()
        tts?.setSpeechRate(clamped)
        log("setRate", "rate=$clamped")
        promise.resolve(null)
    }

    @ReactMethod
    fun seekByte(byte: Int, traceId: String, promise: Promise) = run(traceId, promise) { core ->
        tts?.stop()
        val snap = core.dispatch(AloudCore.seekByte(byte))
        speakCurrent(snap)
        snap
    }

    @ReactMethod
    fun release(promise: Promise) {
        tts?.stop()
        currentUtteranceId = null
        tts?.shutdown()
        tts = null
        abandonAudioFocus()
        core?.release()
        core = null
        promise.resolve(null)
    }

    // RN requires these for NativeEventEmitter; no-op is fine.
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    // --- internals -----------------------------------------------------------

    private inline fun run(traceId: String, promise: Promise, body: (AloudCore) -> Snapshot) {
        activeTraceId = traceId
        val core = this.core ?: return promise.reject("no_session", "load() must be called first")
        try {
            promise.resolve(body(core).toWritableMap())
        } catch (e: CoreException) {
            promise.reject(e.code, e.message)
        }
    }

    private fun ensureEngine(onReady: () -> Unit) {
        if (ready) return onReady()
        tts = TextToSpeech(reactContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.US
                tts?.setOnUtteranceProgressListener(progressListener)
                ready = true
                onReady()
            } else {
                log("engine", "TextToSpeech init failed: $status")
            }
        }
    }

    private fun speakCurrent(snap: Snapshot) {
        if (snap.status != "playing" || snap.utterance.isEmpty()) {
            currentUtteranceId = null
            return
        }
        // A unique-per-call id (not just per sentence) lets onDone/onRangeStart
        // tell this utterance apart from one we've since abandoned mid-sentence.
        utteranceGeneration++
        val id = "aloud-${snap.unit}-$utteranceGeneration"
        currentUtteranceId = id
        tts?.speak(snap.utterance, TextToSpeech.QUEUE_FLUSH, null, id)
    }

    private val progressListener = object : UtteranceProgressListener() {
        /** UTF-16 code-unit index into the utterance — fed straight to the core. */
        override fun onRangeStart(utteranceId: String, start: Int, end: Int, frame: Int) {
            if (utteranceId != currentUtteranceId) return
            val core = core ?: return
            runCatching { core.dispatch(AloudCore.wordBoundary(start)) }
                .onSuccess { emit(it) }
        }

        override fun onDone(utteranceId: String) {
            if (utteranceId != currentUtteranceId) return
            val core = core ?: return
            runCatching { core.dispatch(AloudCore.next()) }.onSuccess { snap ->
                emit(snap)
                if (snap.status == "playing") speakCurrent(snap) else abandonAudioFocus()
            }
        }

        @Deprecated("Deprecated in Java", ReplaceWith(""))
        override fun onError(utteranceId: String) {
            log("tts", "utterance error: $utteranceId")
        }

        override fun onStart(utteranceId: String) {}
    }

    private fun talkBackActive(): Boolean {
        val am = reactContext.getSystemService(Context.ACCESSIBILITY_SERVICE)
                as? AccessibilityManager ?: return false
        return am.isTouchExplorationEnabled
    }

    /** Request media/assistant focus. Marked as SPEECH content so the system
     *  coordinates with TalkBack's accessibility stream sensibly. */
    private fun requestAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setWillPauseWhenDucked(true)
                .build()
            focusRequest = request
            audioManager.requestAudioFocus(request)
        }
    }

    private fun abandonAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            focusRequest = null
        }
    }

    private fun emit(snap: Snapshot) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("AloudSnapshot", snap.toWritableMap())
    }

    private fun log(op: String, message: String) =
        android.util.Log.i("Aloud", "[aloud t=$activeTraceId layer=native op=$op] $message")
}

private fun Snapshot.toWritableMap(): WritableMap {
    val map = Arguments.createMap()
    map.putString("status", status)
    map.putInt("unit", unit)
    map.putInt("unitCount", unitCount)
    map.putInt("token", token)
    map.putInt("tokenCount", tokenCount)
    map.putString("utterance", utterance)
    if (highlight != null) {
        val h = Arguments.createMap()
        h.putInt("start", highlight.start)
        h.putInt("end", highlight.end)
        map.putMap("highlight", h)
    } else {
        map.putNull("highlight")
    }
    return map
}
