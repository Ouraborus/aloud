/**
 * Canonical TypeScript view of the FFI protocol.
 *
 * These types are the TS side of `contracts/ffi.contract.md`. They are asserted
 * against `contracts/commands.schema.json` in `app/__tests__/contract.test.ts`,
 * so if the Rust core changes the protocol and these drift, CI goes red — the
 * mismatch surfaces as a failing test, never a runtime crash on a device.
 *
 * Keep this file free of React Native imports so it can be unit-tested in plain
 * Node.
 */

/** Playback status, mirroring `aloud_core::state_machine::Status`. */
export type Status = "idle" | "playing" | "paused" | "finished";

/** Commands the host sends to the core. Tagged union on `type`. */
export type Command =
  | { type: "Play" }
  | { type: "Pause" }
  | { type: "Next" }
  | { type: "Prev" }
  | { type: "GetState" }
  | { type: "SeekUnit"; unit: number }
  /** Jump to the sentence + word containing a document byte offset (tap-to-seek). */
  | { type: "SeekByte"; byte: number }
  /**
   * A word-boundary report from the platform TTS engine.
   * `utf16Offset` is a UTF-16 offset within the current utterance — the raw
   * value iOS/Android hand us. Never a byte offset. See the contract doc.
   */
  | { type: "WordBoundary"; utf16Offset: number };

/** A document byte span `[start, end)` to highlight in the WebView. */
export interface Highlight {
  start: number;
  end: number;
}

/** Immutable view of session state. The only shape the UI renders. */
export interface Snapshot {
  status: Status;
  unit: number;
  unitCount: number;
  token: number;
  tokenCount: number;
  utterance: string;
  highlight: Highlight | null;
}

export type ErrorCode =
  | "INVALID_COMMAND"
  | "UNIT_OUT_OF_RANGE"
  | "INVALID_UTF8"
  | "NULL_POINTER";

export interface CoreError {
  code: ErrorCode;
  message: string;
}

export interface ErrorEnvelope {
  error: CoreError;
}

/** A dispatch returns either a Snapshot or an error envelope. */
export type CoreResponse = Snapshot | ErrorEnvelope;

/** Narrow a `CoreResponse` to its error case. */
export function isError(res: CoreResponse): res is ErrorEnvelope {
  return (res as ErrorEnvelope).error !== undefined;
}
