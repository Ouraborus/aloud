/**
 * Accessibility announcements.
 *
 * Screen-reader users are core users of Aloud, so state changes must be spoken
 * by VoiceOver/TalkBack — but *carefully*, because the app is itself producing
 * speech. Two rules encoded here:
 *
 * 1. **Never fight the TTS engine.** While a sentence is actively playing we do
 *    NOT announce per-word changes; that would talk over the very audio the user
 *    is listening to. We only announce coarse, meaningful transitions
 *    (started, paused, finished).
 * 2. **Politeness matters.** Completion is `assertive` (the user should know the
 *    article ended); pause/resume is `polite`. This maps to
 *    `AccessibilityInfo.announceForAccessibilityWithOptions({ queue })` on iOS
 *    and live-region politeness on Android.
 *
 * The decision logic is a pure function so it can be unit-tested without a
 * device; the platform sink is injected.
 */

import type { Snapshot } from "../contract/types";

export type Politeness = "polite" | "assertive";

export interface Announcement {
  message: string;
  politeness: Politeness;
}

/** The platform sink. Real impl calls `AccessibilityInfo`; tests pass a spy. */
export interface Announcer {
  announce(a: Announcement): void;
}

/**
 * Decide what (if anything) a screen reader should say when state moves from
 * `prev` to `next`. Returns `null` when nothing should be announced — notably
 * during ordinary word-by-word playback.
 */
export function announcementFor(
  prev: Snapshot,
  next: Snapshot,
): Announcement | null {
  // Started or resumed playback.
  if (prev.status !== "playing" && next.status === "playing") {
    return { message: "Playing", politeness: "polite" };
  }
  // Paused by the user.
  if (prev.status === "playing" && next.status === "paused") {
    return { message: "Paused", politeness: "polite" };
  }
  // Reached the end of the article.
  if (prev.status !== "finished" && next.status === "finished") {
    return { message: "Finished reading", politeness: "assertive" };
  }
  // Sentence changed while NOT actively playing (e.g. the user is stepping
  // through with next/prev to explore) — announce the sentence so they can hear
  // where they landed without starting playback.
  if (next.status === "paused" && next.unit !== prev.unit) {
    return { message: next.utterance, politeness: "polite" };
  }
  // Everything else (per-word highlight during playback) is intentionally silent.
  return null;
}

/** Convenience: compute and, if non-null, emit the announcement. */
export function announceTransition(
  announcer: Announcer,
  prev: Snapshot,
  next: Snapshot,
): Announcement | null {
  const a = announcementFor(prev, next);
  if (a) announcer.announce(a);
  return a;
}
