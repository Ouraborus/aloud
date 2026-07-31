# ADR-0004: Accessibility strategy & definition of done

- **Status:** Accepted
- **Context:** Screen-reader users are core users of a read-aloud product, and
  the app itself produces speech — so it can literally talk over the screen
  reader. Accessibility here is not contrast-checking at the end; it is a
  behavioural contract that has to be designed and tested.

## Decision
Accessibility is part of "done" for every feature, defined by these rules:

1. **Never talk over the TTS engine.** During active playback we do NOT emit
   per-word screen-reader announcements. Only coarse transitions (started,
   paused, finished) are announced. Encoded and unit-tested in
   [`announce.ts`](../../app/src/a11y/announce.ts).
2. **Politeness is explicit.** Completion is `assertive`; pause/resume is
   `polite`. Maps to `announceForAccessibilityWithOptions({ queue })` on iOS.
3. **Audio session cooperates with the screen reader.** iOS uses
   `AVAudioSession` mode `.spokenAudio`; Android marks output as
   `CONTENT_TYPE_SPEECH`. If VoiceOver/TalkBack activates mid-playback we pause.
4. **Focus is managed.** After load, focus moves to the primary action; the
   WebView canvas is hidden from the a11y tree (`no-hide-descendants`) so the
   screen reader is not handed a wall of text our own engine is already reading.
5. **Idiomatic gestures.** Progress is an `adjustable` control (swipe up/down =
   next/prev sentence) rather than tiny targets.
6. **Verified on physical devices**, not just simulators — VoiceOver/TalkBack
   audio-session interactions differ on real hardware. Tracked per release.

## Consequences
- (+) The decision logic (rules 1–2) is a pure function, unit-tested without a
  device.
- (+) WCAG mapping is concrete (see [`accessibility.md`](../accessibility.md)).
- (−) Some behaviour (rules 3, 6) can only be *fully* validated on-device, so a
  manual device checklist is part of the release process, not automated in CI.
