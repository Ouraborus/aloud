/**
 * The port (in the hexagonal sense) between the RN/TS layer and the native
 * module that owns the Rust core + the platform TTS engine + the audio session.
 *
 * The ViewModel depends on THIS interface, never on `react-native` directly, so
 * it can be unit-tested with a fake in plain Node. The concrete adapter that
 * binds to the real TurboModule lives in `AloudTts.native.ts`.
 *
 * ## Why intents, not raw `dispatch`, cross this boundary
 * The Rust FFI speaks the JSON `dispatch` protocol. But word-boundary callbacks
 * fire dozens of times per second on the native audio thread. Routing each one
 * up to JS, into the core, and back down would add latency and jank to the
 * highlight. So the native module owns the tight loop: it feeds TTS boundaries
 * straight into the core and **streams the resulting snapshots up** via
 * `subscribe`. JS sends coarse intents (`play`, `seek`) and renders snapshots.
 */

import type { Snapshot } from "../contract/types";

/** Imperative intents. Every call carries a `traceId` for cross-layer logs. */
export interface AloudTtsCommands {
  /** Version string from `aloud_core_version()`; handy in diagnostics. */
  getCoreVersion(): Promise<string>;
  /** Parse `text` into a session and return the initial snapshot. */
  load(text: string, traceId: string): Promise<Snapshot>;
  play(traceId: string): Promise<Snapshot>;
  pause(traceId: string): Promise<Snapshot>;
  next(traceId: string): Promise<Snapshot>;
  prev(traceId: string): Promise<Snapshot>;
  seekUnit(unit: number, traceId: string): Promise<Snapshot>;
  /** Jump to the sentence + word containing a document byte offset (tap-to-seek). */
  seekByte(byte: number, traceId: string): Promise<Snapshot>;
  /** Stop the engine, release the audio session and free the core session. */
  release(): Promise<void>;
}

/**
 * Snapshots pushed from native for changes JS did not initiate:
 * word-boundary highlights, automatic sentence advance, and completion.
 */
export type SnapshotListener = (snapshot: Snapshot, traceId: string) => void;

export interface AloudTtsEvents {
  /** Subscribe to native-initiated snapshots. Returns an unsubscribe fn. */
  subscribe(listener: SnapshotListener): () => void;
}

export type AloudTts = AloudTtsCommands & AloudTtsEvents;
