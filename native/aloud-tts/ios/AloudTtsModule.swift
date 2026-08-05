import AVFoundation
import Foundation
// React ships as a prebuilt Swift-consumable framework module in modern RN
// (0.79+ / React-Core-prebuilt): `RCTEventEmitter` and friends come from
// `import React`, not a bridging header. The C-only Rust ABI is exposed the
// same way, as a Clang module — see AloudCore.swift's `import AloudCoreFFI`
// and core/include/module.modulemap.
import React
import UIKit

/// The iOS native module. It owns three things and keeps them in step:
///   1. the shared Rust core (`AloudCore`) — the source of truth for position,
///   2. `AVSpeechSynthesizer` — the platform TTS engine,
///   3. `AVAudioSession` — the shared audio hardware, which we must share
///      politely with VoiceOver.
///
/// JS sends coarse intents; this module runs the tight word-boundary loop
/// natively and streams `Snapshot`s back up. See `AloudTtsSpec.ts` for why the
/// loop lives here and not in JS.
@objc(AloudTts)
final class AloudTtsModule: RCTEventEmitter {
    private let synthesizer = AVSpeechSynthesizer()
    private var core: AloudCore?
    private var hasListeners = false
    private var activeTraceId = "-"
    /// AVSpeechUtterance.rate to apply to future utterances (see `setRate`).
    private var currentRate = AVSpeechUtteranceDefaultSpeechRate
    /// The exact `AVSpeechUtterance` instance we last told the synthesizer to
    /// speak. Every delegate callback below checks the callback's `utterance`
    /// against this by REFERENCE before touching the core.
    ///
    /// Why this matters: seeking (tap-to-seek, next/prev) stops the in-flight
    /// utterance and immediately starts a new one. `stopSpeaking` does not
    /// guarantee its delegate callback for the OLD utterance is suppressed
    /// before the NEW one starts producing callbacks of its own — on a fast
    /// double-seek this could otherwise feed a stale word-boundary report from
    /// the utterance we just abandoned into the core, which would move the
    /// highlight to the wrong word for a moment. Without this guard that shows
    /// up as an intermittent "highlight desyncs from the audio" bug — it only
    /// reproduces when the race is lost, which is exactly why it was
    /// inconsistent to reproduce by hand.
    private var currentUtterance: AVSpeechUtterance?

    override init() {
        super.init()
        synthesizer.delegate = self
        // React to VoiceOver turning on/off so we can coordinate the audio
        // session (see `configureAudioSession`).
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(voiceOverStatusChanged),
            name: UIAccessibility.voiceOverStatusDidChangeNotification,
            object: nil
        )
    }

    // RCTEventEmitter plumbing -------------------------------------------------

    override static func requiresMainQueueSetup() -> Bool { true }
    override func supportedEvents() -> [String]! { ["AloudSnapshot"] }
    override func startObserving() { hasListeners = true }
    override func stopObserving() { hasListeners = false }

    // Exported intents ---------------------------------------------------------

    @objc(getCoreVersion:rejecter:)
    func getCoreVersion(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        resolve(AloudCore.version)
    }

    @objc(load:traceId:resolver:rejecter:)
    func load(_ text: String, traceId: String,
              resolver resolve: RCTPromiseResolveBlock,
              rejecter reject: RCTPromiseRejectBlock) {
        activeTraceId = traceId
        do {
            let core = try AloudCore(text: text)
            self.core = core
            log("load", "unitCount=\(core.unitCount)")
            let snap = try core.dispatch(.getState)
            resolve(snap.asBridgePayload())
        } catch {
            reject("load_failed", "\(error)", error)
        }
    }

    @objc(play:resolver:rejecter:)
    func play(_ traceId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        run(traceId, resolve, reject) { core in
            let snap = try core.dispatch(.play)
            self.configureAudioSession(active: true)
            self.speakCurrentUtterance(snap)
            return snap
        }
    }

    @objc(pause:resolver:rejecter:)
    func pause(_ traceId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        run(traceId, resolve, reject) { core in
            self.synthesizer.stopSpeaking(at: .word)
            self.currentUtterance = nil
            let snap = try core.dispatch(.pause)
            self.configureAudioSession(active: false)
            return snap
        }
    }

    @objc(next:resolver:rejecter:)
    func next(_ traceId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        run(traceId, resolve, reject) { core in
            self.synthesizer.stopSpeaking(at: .immediate)
            let snap = try core.dispatch(.next)
            self.speakCurrentUtterance(snap)
            return snap
        }
    }

    @objc(prev:resolver:rejecter:)
    func prev(_ traceId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        run(traceId, resolve, reject) { core in
            self.synthesizer.stopSpeaking(at: .immediate)
            let snap = try core.dispatch(.prev)
            self.speakCurrentUtterance(snap)
            return snap
        }
    }

    @objc(seekUnit:traceId:resolver:rejecter:)
    func seekUnit(_ unit: NSNumber, traceId: String,
                  resolver resolve: RCTPromiseResolveBlock,
                  rejecter reject: RCTPromiseRejectBlock) {
        run(traceId, resolve, reject) { core in
            self.synthesizer.stopSpeaking(at: .immediate)
            let snap = try core.dispatch(.seekUnit(unit: unit.intValue))
            self.speakCurrentUtterance(snap)
            return snap
        }
    }

    @objc(seekByte:traceId:resolver:rejecter:)
    func seekByte(_ byte: NSNumber, traceId: String,
                  resolver resolve: RCTPromiseResolveBlock,
                  rejecter reject: RCTPromiseRejectBlock) {
        run(traceId, resolve, reject) { core in
            self.synthesizer.stopSpeaking(at: .immediate)
            let snap = try core.dispatch(.seekByte(byte: byte.intValue))
            self.speakCurrentUtterance(snap)
            return snap
        }
    }

    /// Set the speech-rate multiplier (1.0 = normal). We map it onto Apple's
    /// rate scale around its default and clamp to the platform's min/max. The new
    /// rate applies to the next utterance; we do not restart the current one.
    @objc(setRate:traceId:resolver:rejecter:)
    func setRate(_ rate: NSNumber, traceId: String,
                 resolver resolve: RCTPromiseResolveBlock,
                 rejecter reject: RCTPromiseRejectBlock) {
        activeTraceId = traceId
        let mapped = AVSpeechUtteranceDefaultSpeechRate * rate.floatValue
        currentRate = min(AVSpeechUtteranceMaximumSpeechRate,
                          max(AVSpeechUtteranceMinimumSpeechRate, mapped))
        log("setRate", "multiplier=\(rate.floatValue) rate=\(currentRate)")
        resolve(nil)
    }

    @objc(release:rejecter:)
    func release(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        synthesizer.stopSpeaking(at: .immediate)
        currentUtterance = nil
        configureAudioSession(active: false)
        core = nil // AloudCore.deinit frees the Rust session
        resolve(nil)
    }

    // Internals ----------------------------------------------------------------

    private func run(_ traceId: String,
                     _ resolve: RCTPromiseResolveBlock,
                     _ reject: RCTPromiseRejectBlock,
                     _ body: (AloudCore) throws -> Snapshot) {
        activeTraceId = traceId
        guard let core = core else {
            reject("no_session", "load() must be called first", nil)
            return
        }
        do {
            let snap = try body(core)
            resolve(snap.asBridgePayload())
        } catch {
            log("error", "\(error)")
            reject("dispatch_failed", "\(error)", error)
        }
    }

    /// Speak the current sentence (or the remaining suffix of it after a
    /// mid-sentence seek — see `Snapshot.utterance`) if we are in the playing
    /// state.
    private func speakCurrentUtterance(_ snap: Snapshot) {
        guard snap.status == "playing", !snap.utterance.isEmpty else {
            currentUtterance = nil
            return
        }
        let utterance = AVSpeechUtterance(string: snap.utterance)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = currentRate
        currentUtterance = utterance
        synthesizer.speak(utterance)
    }

    /// Configure the shared audio session. `.spokenAudio` mode is the key
    /// screen-reader-friendly choice: it tells the system this is speech, so it
    /// mixes sensibly with VoiceOver rather than ducking it into inaudibility.
    private func configureAudioSession(active: Bool) {
        let session = AVAudioSession.sharedInstance()
        do {
            if active {
                try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
                try session.setActive(true)
            } else {
                // Yield the session so VoiceOver/other apps regain full volume.
                try session.setActive(false, options: [.notifyOthersOnDeactivation])
            }
        } catch {
            log("audio_session", "failed: \(error)")
        }
    }

    @objc private func voiceOverStatusChanged() {
        // If VoiceOver turns on mid-playback, pause so the two speech streams do
        // not talk over each other; the user can resume deliberately.
        if UIAccessibility.isVoiceOverRunning, synthesizer.isSpeaking {
            synthesizer.pauseSpeaking(at: .word)
            if let core = core, let snap = try? core.dispatch(.pause) {
                emit(snap)
            }
        }
    }

    private func emit(_ snap: Snapshot) {
        guard hasListeners else { return }
        sendEvent(withName: "AloudSnapshot", body: snap.asBridgePayload())
    }

    private func log(_ op: String, _ message: String) {
        NSLog("[aloud t=\(activeTraceId) layer=native op=\(op)] \(message)")
    }
}

// MARK: - AVSpeechSynthesizerDelegate — the native word-boundary loop

extension AloudTtsModule: AVSpeechSynthesizerDelegate {
    /// Word boundary. `characterRange.location` is a **UTF-16** offset into the
    /// utterance string — exactly what the core's `WordBoundary` command wants.
    /// We feed it straight in and stream the resulting highlight to JS. No
    /// offset math happens here; that lives once, in Rust.
    ///
    /// The `utterance === currentUtterance` guard discards callbacks for an
    /// utterance we've since abandoned (seeked/stopped away from) — see the
    /// doc comment on `currentUtterance` for why this race is real.
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
                           willSpeakRangeOfSpeechString characterRange: NSRange,
                           utterance: AVSpeechUtterance) {
        guard utterance === currentUtterance, let core = core else { return }
        if let snap = try? core.dispatch(.wordBoundary(utf16Offset: characterRange.location)) {
            emit(snap)
        }
    }

    /// Sentence finished. Advance the core; if it produced another sentence and
    /// we are still playing, speak it — this is the auto-advance loop.
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
                           didFinish utterance: AVSpeechUtterance) {
        guard utterance === currentUtterance, let core = core else { return }
        guard let snap = try? core.dispatch(.next) else { return }
        emit(snap)
        if snap.status == "playing" {
            speakCurrentUtterance(snap)
        } else {
            // Document finished: release the audio session politely.
            configureAudioSession(active: false)
        }
    }
}
