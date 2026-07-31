# ADR-0005: Correlated trace ids across layers

- **Status:** Accepted
- **Context:** A single user action produces log lines in four places — JS,
  native (Logcat/Console), Rust, and the WebView console. When a highlight lands
  on the wrong word, the root cause could be in any of them, and stitching four
  unsynchronised logs by timestamp is slow and error-prone.

## Decision
Mint a short **trace id** per user intent in the ViewModel and thread it through
every layer. Every layer logs with the same prefix grammar:

```
[aloud t=<traceId> layer=<js|native|rust|webview> op=<name>] message
```

A single `grep t=a4f-017` then lines up the entire causal chain in order across
all four streams.

## Consequences
- (+) Cross-layer debugging becomes a filter, not a reconstruction — directly
  supporting "correlate them to find the actual root cause before writing a fix".
- (+) The format is greppable and stable, so it can feed log tooling later.
- (−) Every native intent signature carries a `traceId` argument (a small, worth-
  it tax visible across the FFI contract).
- (−) The core, being pure, does not log to a platform sink itself; it returns
  enough state that the native caller logs on its behalf with the same id.

See [`debugging-across-the-stack.md`](../debugging-across-the-stack.md) for a
worked example.
