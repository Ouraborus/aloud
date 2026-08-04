/**
 * ViewModel unit tests. The ViewModel depends only on the `AloudTts` port and an
 * `Announcer`, so we drive it entirely with fakes — no device, no native module.
 * This is what "MVVM over a shared core" buys us: the presentation seam is
 * trivially testable because it holds no reading logic of its own.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { ReadingSessionViewModel } from "../src/core/ReadingSessionViewModel";
import type { AloudTts, SnapshotListener } from "../src/native/AloudTtsSpec";
import type { Announcer, Announcement } from "../src/a11y/announce";
import type { Snapshot } from "../src/contract/types";

const DOC_UNITS = 2;

/** A scriptable fake of the native module. */
class FakeTts implements AloudTts {
  calls: string[] = [];
  private listeners = new Set<SnapshotListener>();
  private base: Snapshot = {
    status: "idle",
    unit: 0,
    unitCount: DOC_UNITS,
    token: 0,
    tokenCount: 2,
    utterance: "Hello world.",
    highlight: null,
  };

  async getCoreVersion() {
    return "0.1.0-test";
  }
  async load(_text: string) {
    this.calls.push("load");
    return this.base;
  }
  async play() {
    this.calls.push("play");
    this.base = { ...this.base, status: "playing", highlight: { start: 0, end: 5 } };
    return this.base;
  }
  async pause() {
    this.calls.push("pause");
    this.base = { ...this.base, status: "paused" };
    return this.base;
  }
  async next() {
    this.calls.push("next");
    return this.base;
  }
  async prev() {
    this.calls.push("prev");
    return this.base;
  }
  async seekUnit(unit: number) {
    this.calls.push(`seek:${unit}`);
    return this.base;
  }
  async seekByte(byte: number) {
    this.calls.push(`seekByte:${byte}`);
    this.base = { ...this.base, unit: 1, utterance: "Bye." };
    return this.base;
  }
  async release() {
    this.calls.push("release");
  }
  subscribe(listener: SnapshotListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test helper: simulate a native-initiated snapshot (word boundary, etc). */
  emitNative(snapshot: Snapshot) {
    for (const l of this.listeners) l(snapshot, "native-trace");
  }
}

class SpyAnnouncer implements Announcer {
  announcements: Announcement[] = [];
  announce(a: Announcement) {
    this.announcements.push(a);
  }
}

describe("ReadingSessionViewModel", () => {
  let tts: FakeTts;
  let announcer: SpyAnnouncer;
  let vm: ReadingSessionViewModel;

  beforeEach(async () => {
    tts = new FakeTts();
    announcer = new SpyAnnouncer();
    vm = new ReadingSessionViewModel({ tts, announcer, logger: () => {} });
    await vm.load("Hello world. Bye.");
  });

  it("derives view state from the loaded snapshot", () => {
    const vs = vm.viewState;
    expect(vs.status).toBe("idle");
    expect(vs.canPlay).toBe(true);
    expect(vs.progressLabel).toBe("Sentence 1 of 2");
  });

  it("announces 'Playing' when playback starts and notifies observers", async () => {
    const observer = vi.fn();
    vm.subscribe(observer);
    await vm.play();

    expect(tts.calls).toContain("play");
    expect(observer).toHaveBeenCalled();
    expect(vm.viewState.isPlaying).toBe(true);
    expect(announcer.announcements).toEqual([
      { message: "Playing", politeness: "polite" },
    ]);
  });

  it("updates the highlight from native word boundaries WITHOUT announcing each word", async () => {
    await vm.play();
    announcer.announcements = []; // ignore the 'Playing' announcement

    tts.emitNative({
      status: "playing",
      unit: 0,
      unitCount: DOC_UNITS,
      token: 1,
      tokenCount: 2,
      utterance: "Hello world.",
      highlight: { start: 6, end: 11 },
    });

    expect(vm.viewState.highlight).toEqual({ start: 6, end: 11 });
    // Crucial a11y rule: we do NOT talk over the TTS engine word-by-word.
    expect(announcer.announcements).toEqual([]);
  });

  it("announces completion assertively when the article finishes", async () => {
    await vm.play();
    announcer.announcements = [];

    tts.emitNative({
      status: "finished",
      unit: 1,
      unitCount: DOC_UNITS,
      token: 0,
      tokenCount: 0,
      utterance: "",
      highlight: null,
    });

    expect(vm.viewState.progress).toBe(1);
    expect(announcer.announcements).toEqual([
      { message: "Finished reading", politeness: "assertive" },
    ]);
  });

  it("forwards a tapped byte offset to the core via seekByte", async () => {
    await vm.seekByte(13);
    expect(tts.calls).toContain("seekByte:13");
    expect(vm.viewState.progressLabel).toBe("Sentence 2 of 2");
  });

  it("releases native resources on dispose", async () => {
    await vm.dispose();
    expect(tts.calls).toContain("release");
  });
});
