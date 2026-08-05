/**
 * ReadingSessionViewModel — the MVVM ViewModel.
 *
 * This is the "VM" in MVVM (see ADR-0006). It holds the latest `Snapshot`
 * (the Model, produced by the shared Rust core), exposes intents the View binds
 * to (`play`, `pause`, `next`, `prev`, `seekUnit`), and derives view-friendly
 * state (`viewState`). It contains **no reading logic** — position, highlight
 * and status all come from the core — so it stays a thin, fully-testable seam.
 *
 * It is deliberately framework-agnostic (no React, no react-native import). A
 * React hook (`useReadingSession`) adapts it to components; a Swift/Kotlin
 * screen could bind the same snapshots to a native ViewModel. The logic lives
 * once, here and in Rust — never re-implemented per platform.
 */

import type { Snapshot } from "../contract/types";
import type { AloudTts } from "../native/AloudTtsSpec";
import { announceTransition, type Announcer } from "../a11y/announce";
import { startTrace, type Logger } from "../logging/trace";
import {
  clampRate,
  noopPreferenceStore,
  rateLabel,
  RATE_BOUNDS,
  type PreferenceStore,
} from "./ReadingPreferences";

const INITIAL: Snapshot = {
  status: "idle",
  unit: 0,
  unitCount: 0,
  token: 0,
  tokenCount: 0,
  utterance: "",
  highlight: null,
};

/** Derived, presentation-ready state. The View renders this, not the raw snapshot. */
export interface ReaderViewState {
  status: Snapshot["status"];
  isPlaying: boolean;
  canPlay: boolean;
  canPause: boolean;
  /** e.g. "Sentence 2 of 5" — used as the accessibility label for progress. */
  progressLabel: string;
  /** 0..1 for a progress bar. */
  progress: number;
  /** The byte span the WebView should currently highlight (or null). */
  highlight: Snapshot["highlight"];
  utterance: string;
  /** Current speech-rate multiplier (1.0 = normal). */
  rate: number;
  /** Screen-reader/UI label for the rate, e.g. "1.2×". */
  rateLabel: string;
}

export interface ViewModelDeps {
  tts: AloudTts;
  announcer: Announcer;
  /** Persistence for reading preferences; defaults to a no-op store. */
  store?: PreferenceStore;
  /** Injectable for tests; defaults to console. */
  logger?: Logger;
}

type Observer = () => void;

export class ReadingSessionViewModel {
  private snapshot: Snapshot = INITIAL;
  private observers = new Set<Observer>();
  private unsubscribeNative: (() => void) | undefined;

  private rate: number = RATE_BOUNDS.default;
  /** Bumped on every emit; the React binding observes this so that changes which
   *  do NOT replace the snapshot object (e.g. rate) still trigger a re-render. */
  private version = 0;

  private readonly tts: AloudTts;
  private readonly announcer: Announcer;
  private readonly store: PreferenceStore;
  private readonly logger: Logger | undefined;

  constructor(deps: ViewModelDeps) {
    this.tts = deps.tts;
    this.announcer = deps.announcer;
    this.store = deps.store ?? noopPreferenceStore;
    this.logger = deps.logger;
  }

  // --- observation (View subscribes to this) -------------------------------

  subscribe(observer: Observer): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  getSnapshot(): Snapshot {
    return this.snapshot;
  }

  /** Monotonic change counter for `useSyncExternalStore` (see `version`). */
  getVersion(): number {
    return this.version;
  }

  get viewState(): ReaderViewState {
    const s = this.snapshot;
    const total = Math.max(s.unitCount, 1);
    return {
      status: s.status,
      isPlaying: s.status === "playing",
      canPlay: s.status !== "playing" && s.unitCount > 0,
      canPause: s.status === "playing",
      progressLabel:
        s.unitCount === 0
          ? "Nothing loaded"
          : `Sentence ${s.unit + 1} of ${s.unitCount}`,
      progress: s.status === "finished" ? 1 : s.unit / total,
      highlight: s.highlight,
      utterance: s.utterance,
      rate: this.rate,
      rateLabel: rateLabel(this.rate),
    };
  }

  // --- intents (View calls these) ------------------------------------------

  async load(text: string): Promise<void> {
    const trace = this.trace("load");
    trace.log("loading document", { chars: text.length });
    const snap = await this.tts.load(text, trace.id);
    // Subscribe to native-initiated snapshots (word boundaries, auto-advance).
    this.unsubscribeNative?.();
    this.unsubscribeNative = this.tts.subscribe((s) => this.applySnapshot(s));
    this.applySnapshot(snap);
    // Restore the user's saved rate and apply it to the engine.
    const saved = await this.store.getRate();
    if (saved !== null) {
      await this.applyRate(clampRate(saved), { persist: false, announce: false });
    }
  }

  play = () => this.run("play", (t) => this.tts.play(t));
  pause = () => this.run("pause", (t) => this.tts.pause(t));
  next = () => this.run("next", (t) => this.tts.next(t));
  prev = () => this.run("prev", (t) => this.tts.prev(t));
  seekUnit = (unit: number) =>
    this.run("seek", (t) => this.tts.seekUnit(unit, t));
  /** Jump to the word at a document byte offset — backs tap-to-seek. */
  seekByte = (byte: number) =>
    this.run("seekByte", (t) => this.tts.seekByte(byte, t));

  /**
   * Change the speech rate. Applied to the native engine, persisted, and
   * announced politely (never during nothing — this is a user-driven action).
   */
  setRate = (rate: number) => this.applyRate(clampRate(rate), {});

  /** Step the rate by one increment; used by the accessible +/- controls. */
  stepRate = (direction: 1 | -1) =>
    this.setRate(this.rate + direction * RATE_BOUNDS.step);

  /**
   * Release native resources; call on unmount.
   *
   * Deliberately does **not** clear `observers`: a subscription's lifetime
   * belongs to whoever opened it (each `subscribe` hands back its own
   * unsubscribe), not to the native session. Clearing them here used to leave
   * the React binding silently detached, and it only kept working because an
   * unstable `subscribe` identity made React re-subscribe on the next render.
   */
  async dispose(): Promise<void> {
    this.unsubscribeNative?.();
    this.unsubscribeNative = undefined;
    await this.tts.release();
  }

  // --- internals -----------------------------------------------------------

  private async run(
    op: string,
    action: (traceId: string) => Promise<Snapshot>,
  ): Promise<void> {
    const trace = this.trace(op);
    try {
      const snap = await action(trace.id);
      trace.log("applied", { status: snap.status, unit: snap.unit });
      this.applySnapshot(snap);
    } catch (err) {
      trace.log("intent failed", { error: String(err) });
      throw err;
    }
  }

  private async applyRate(
    rate: number,
    opts: { persist?: boolean; announce?: boolean },
  ): Promise<void> {
    const { persist = true, announce = true } = opts;
    if (rate === this.rate && persist) return; // no-op change from the UI
    const trace = this.trace("setRate");
    this.rate = rate;
    await this.tts.setRate(rate, trace.id);
    if (persist) {
      await this.store.setRate(rate).catch((err) =>
        trace.log("persist failed", { error: String(err) }),
      );
    }
    if (announce) {
      this.announcer.announce({ message: `Speed ${rateLabel(rate)}`, politeness: "polite" });
    }
    this.emit();
  }

  private applySnapshot(next: Snapshot): void {
    const prev = this.snapshot;
    this.snapshot = next;
    // Coordinate the screen reader on meaningful transitions only.
    announceTransition(this.announcer, prev, next);
    this.emit();
  }

  private emit(): void {
    this.version += 1;
    for (const o of this.observers) o();
  }

  private trace(op: string) {
    return this.logger ? startTrace(op, this.logger) : startTrace(op);
  }
}
