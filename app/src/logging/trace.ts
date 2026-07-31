/**
 * Cross-layer tracing.
 *
 * A single feature in Aloud can touch JS, native, Rust and the WebView in one
 * user action. When something goes wrong, the offer's requirement is to
 * "correlate them to find the actual root cause before writing a fix". We make
 * that possible by minting a short **trace id** for every user intent and
 * threading it through every layer, so a `grep` for one id lines up the whole
 * causal chain across four log streams.
 *
 * Log line format (identical prefix on every layer — see
 * `docs/debugging-across-the-stack.md`):
 *
 *   [aloud t=<traceId> layer=<js|native|rust|webview> op=<name>] message
 */

let counter = 0;

/** A short, human-typeable, collision-resistant id (e.g. `a4f-017`). */
export function newTraceId(): string {
  counter = (counter + 1) % 1000;
  const rand = Math.random().toString(36).slice(2, 5);
  const seq = counter.toString().padStart(3, "0");
  return `${rand}-${seq}`;
}

export interface Trace {
  readonly id: string;
  readonly op: string;
  /** Log at the JS layer with the correlated prefix. */
  log(message: string, extra?: Record<string, unknown>): void;
  /** Duration since the trace was opened, in ms. */
  elapsedMs(): number;
}

export type Logger = (line: string) => void;

/**
 * Open a trace for a user intent. `op` is the intent name (`play`, `seek`, …).
 * Pass a custom `logger` in tests to capture output.
 */
export function startTrace(op: string, logger: Logger = console.log): Trace {
  const id = newTraceId();
  const startedAt = Date.now();
  const prefix = `[aloud t=${id} layer=js op=${op}]`;
  logger(`${prefix} start`);
  return {
    id,
    op,
    log(message, extra) {
      const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
      logger(`${prefix} ${message}${suffix}`);
    },
    elapsedMs() {
      return Date.now() - startedAt;
    },
  };
}
