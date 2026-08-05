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
import type { PreferenceStore } from "../src/core/ReadingPreferences";

const DOC_UNITS = 2;

/** In-memory preference store for tests. */
class FakeStore implements PreferenceStore {
  constructor(private rate: number | null = null) {}
  async getRate() {
    return this.rate;
  }
  async setRate(rate: number) {
    this.rate = rate;
  }
}

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
  async setRate(rate: number) {
    this.calls.push(`setRate:${rate}`);
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

  it("leaves subscriptions to their owners rather than clearing them on dispose", async () => {
    // A subscription's lifetime belongs to whoever opened it — `subscribe`
    // hands back its own unsubscribe. `dispose()` used to clear the whole
    // observer set, which silently detached the React binding; that only kept
    // working because an unstable `subscribe` identity made React re-subscribe
    // on the very next render. Two unrelated pieces of code propping each other
    // up, invisibly.
    let notified = 0;
    const unsubscribe = vm.subscribe(() => {
      notified += 1;
    });

    await vm.dispose();
    await vm.setRate(1.4);
    expect(notified).toBeGreaterThan(0);

    // ...and the owner's own unsubscribe still works.
    const before = notified;
    unsubscribe();
    await vm.setRate(1.6);
    expect(notified).toBe(before);
  });

  it("can load a new document without a dispose in between", async () => {
    // Swapping documents must not require tearing down native resources; the
    // hook relies on this to keep `dispose()` for unmount only.
    await vm.load("A different document. With two sentences.");
    expect(vm.viewState.progressLabel).toBe("Sentence 1 of 2");
    expect(tts.calls).not.toContain("release");
  });
});

describe("ReadingSessionViewModel — reading rate", () => {
  it("applies a rate change to the engine, persists it, and announces politely", async () => {
    const tts = new FakeTts();
    const announcer = new SpyAnnouncer();
    const store = new FakeStore();
    const vm = new ReadingSessionViewModel({ tts, announcer, store, logger: () => {} });
    await vm.load("Hello world.");
    announcer.announcements = [];

    await vm.setRate(1.5);

    expect(tts.calls).toContain("setRate:1.5");
    expect(vm.viewState.rate).toBe(1.5);
    expect(vm.viewState.rateLabel).toBe("1.5×");
    expect(await store.getRate()).toBe(1.5);
    expect(announcer.announcements).toEqual([
      { message: "Speed 1.5×", politeness: "polite" },
    ]);
  });

  it("clamps out-of-range rates to the supported bounds", async () => {
    const tts = new FakeTts();
    const vm = new ReadingSessionViewModel({
      tts,
      announcer: new SpyAnnouncer(),
      logger: () => {},
    });
    await vm.load("Hello world.");

    await vm.setRate(9);
    expect(vm.viewState.rate).toBe(2); // max
    await vm.setRate(0.1);
    expect(vm.viewState.rate).toBe(0.5); // min
  });

  it("stepRate nudges by one increment", async () => {
    const tts = new FakeTts();
    const vm = new ReadingSessionViewModel({
      tts,
      announcer: new SpyAnnouncer(),
      logger: () => {},
    });
    await vm.load("Hello world.");

    await vm.stepRate(1);
    expect(vm.viewState.rate).toBe(1.1);
    await vm.stepRate(-1);
    expect(vm.viewState.rate).toBe(1.0);
  });

  it("restores a persisted rate on load and applies it without announcing", async () => {
    const tts = new FakeTts();
    const announcer = new SpyAnnouncer();
    const store = new FakeStore(1.8);
    const vm = new ReadingSessionViewModel({ tts, announcer, store, logger: () => {} });

    await vm.load("Hello world.");

    expect(vm.viewState.rate).toBe(1.8);
    expect(tts.calls).toContain("setRate:1.8");
    // Restoring a saved preference is silent — no announcement on startup.
    expect(announcer.announcements).toEqual([]);
  });
});
