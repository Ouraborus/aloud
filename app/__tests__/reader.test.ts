/**
 * Tests for the WebView reader canvas (`src/webview/reader.canvasjs`).
 *
 * This file is plain, dependency-free DOM JavaScript that runs inside the
 * WebView, and it owns two things that are easy to get subtly wrong and
 * impossible to notice until a user reports it:
 *
 *   1. **UTF-8 byte ⟷ UTF-16 char index mapping.** The core addresses
 *      everything in document bytes; a JS string is indexed in UTF-16 code
 *      units. Every highlight and every tap crosses that boundary.
 *   2. **Resolving a tap to a document-global offset.** `highlight()` splits
 *      the article into three DOM nodes around the current `<mark>`, so a
 *      caret offset is local to whichever node was tapped.
 *
 * Both have already shipped bugs (see the forward-tap regression covered
 * below), so they are pinned here.
 *
 * The module is an IIFE with no exports — it is driven exactly the way React
 * Native drives it at runtime: `message` events in, `postMessage` calls out.
 * (The `.canvasjs` extension is not decoration: it is what makes Metro ship the
 * file as an asset next to reader.html rather than compiling it into the JS
 * bundle, where the `<script src>` could never reach it. See #40.)
 * Each test gets a completely fresh JSDOM so no listener or captured element
 * leaks between cases.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const READER_JS = readFileSync(resolve(HERE, "../src/webview/reader.canvasjs"), "utf8");

/** UTF-8 byte length of `s` — the unit the Rust core speaks in. */
function bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

interface Posted {
  type: string;
  byte?: number;
}

interface Harness {
  article: HTMLElement;
  /** Messages the canvas posted back to the host, newest last. */
  posted: Posted[];
  /** The most recent message posted to the host. */
  lastPosted(): Posted | undefined;
  /** Deliver a host -> WebView message. */
  send(message: unknown): void;
  /** Simulate a tap whose caret lands at `offset` inside `container`. */
  tap(container: Node, offset: number): void;
  /** The text node holding everything before the highlight. */
  before(): Node;
  /** The text node holding everything after the highlight. */
  after(): Node;
  markText(): string;
}

function mount(): Harness {
  const dom = new JSDOM(
    `<!doctype html><html><body><article id="article"></article></body></html>`,
    { runScripts: "outside-only" },
  );
  const win = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;

  // jsdom does not provide TextEncoder on the window; the real WebView does.
  win.TextEncoder = TextEncoder;

  const posted: Harness["posted"] = [];
  win.ReactNativeWebView = {
    postMessage: (raw: string) => posted.push(JSON.parse(raw)),
  };

  // Run the canvas exactly as the <script> tag would.
  (win as unknown as { eval(code: string): void }).eval(READER_JS);

  const article = win.document.getElementById("article") as HTMLElement;

  return {
    article,
    posted,
    lastPosted: () => posted[posted.length - 1],
    send(message) {
      win.dispatchEvent(
        new win.MessageEvent("message", { data: JSON.stringify(message) }),
      );
    },
    tap(container, offset) {
      const range = win.document.createRange();
      range.setStart(container, offset);
      range.setEnd(container, offset);
      // jsdom has no hit-testing, so we inject the caret the browser would
      // have resolved from the tap coordinates. Everything downstream of this
      // — the node-boundary walk that turns it into a document offset — is the
      // real code under test.
      (win.document as unknown as { caretRangeFromPoint: () => Range })
        .caretRangeFromPoint = () => range;
      article.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    },
    before: () => article.childNodes[0]!,
    after: () => article.childNodes[2]!,
    markText: () => article.querySelector("mark")!.textContent ?? "",
  };
}

const DOC = "Hello world. How are you today? Bye.";
/** Byte span of "How" in DOC — what the core would send while speaking it. */
const HOW = { start: DOC.indexOf("How"), end: DOC.indexOf("How") + 3 };

describe("render", () => {
  it("shows the document and announces readiness", () => {
    const h = mount();
    expect(h.posted).toEqual([{ type: "ready" }]);

    h.send({ type: "render", text: DOC });
    expect(h.article.textContent).toBe(DOC);
  });

  it("builds a stable three-node structure the highlight can move within", () => {
    // Guards the invariant behind both the tap-offset fix and the decision to
    // stop rebuilding innerHTML per word: the node layout must not change.
    const h = mount();
    h.send({ type: "render", text: DOC });
    expect(h.article.childNodes.length).toBe(3);

    h.send({ type: "highlight", highlight: HOW });
    expect(h.article.childNodes.length).toBe(3);

    h.send({ type: "highlight", highlight: { start: 0, end: 5 } });
    expect(h.article.childNodes.length).toBe(3);

    h.send({ type: "highlight", highlight: null });
    expect(h.article.childNodes.length).toBe(3);
  });
});

describe("highlight", () => {
  it("lights exactly the requested byte span and leaves the text intact", () => {
    const h = mount();
    h.send({ type: "render", text: DOC });
    h.send({ type: "highlight", highlight: HOW });

    expect(h.markText()).toBe("How");
    expect(h.article.textContent).toBe(DOC);
  });

  it("maps multibyte spans correctly (UTF-8 bytes, not UTF-16 units)", () => {
    // "Café" is 5 bytes but 4 chars; "🎧" is 4 bytes but 2 UTF-16 units. If the
    // canvas confused the two, the highlight would slide off the intended word.
    const doc = "Café música works. 🎧 Enjoy!";
    const h = mount();
    h.send({ type: "render", text: doc });

    const start = bytes(doc.slice(0, doc.indexOf("música")));
    h.send({
      type: "highlight",
      highlight: { start, end: start + bytes("música") },
    });
    expect(h.markText()).toBe("música");

    const enjoyStart = bytes(doc.slice(0, doc.indexOf("Enjoy")));
    h.send({
      type: "highlight",
      highlight: { start: enjoyStart, end: enjoyStart + bytes("Enjoy") },
    });
    expect(h.markText()).toBe("Enjoy");
    expect(h.article.textContent).toBe(doc);
  });

  it("restores plain text when the core sends a null highlight", () => {
    const h = mount();
    h.send({ type: "render", text: DOC });
    h.send({ type: "highlight", highlight: HOW });
    h.send({ type: "highlight", highlight: null });

    expect(h.markText()).toBe("");
    expect(h.article.textContent).toBe(DOC);
  });

  it("ignores an out-of-range span instead of blanking the article", () => {
    const h = mount();
    h.send({ type: "render", text: DOC });
    h.send({ type: "highlight", highlight: HOW });
    h.send({ type: "highlight", highlight: { start: 99999, end: 100000 } });

    expect(h.markText()).toBe("How"); // unchanged
    expect(h.article.textContent).toBe(DOC);
  });
});

describe("tap-to-seek", () => {
  it("reports the tapped byte before anything is highlighted", () => {
    const h = mount();
    h.send({ type: "render", text: DOC });
    h.tap(h.before(), DOC.indexOf("world") + 2);

    expect(h.lastPosted()).toEqual({
      type: "wordTapped",
      byte: DOC.indexOf("world") + 2,
    });
  });

  it("reports a document-global byte for a word AHEAD of the highlight", () => {
    // The regression that shipped: `caretRangeFromPoint().startOffset` is local
    // to the tapped node. Once a word is highlighted the article is three nodes,
    // so a tap after the <mark> used to drop everything before that node —
    // seeking to a wrong, much earlier position. Tapping *behind* the highlight
    // masked it, because that node starts at document offset 0.
    const h = mount();
    h.send({ type: "render", text: DOC });
    h.send({ type: "highlight", highlight: HOW });

    // "today" lives in the third node, after the <mark>.
    const localOffset = h.after().textContent!.indexOf("today") + 2;
    h.tap(h.after(), localOffset);

    const expected = DOC.indexOf("today") + 2;
    expect(h.lastPosted()).toEqual({ type: "wordTapped", byte: expected });
    // And prove the bug would have been caught: the node-local offset differs.
    expect(localOffset).not.toBe(expected);
  });

  it("reports a document-global byte for a tap inside the highlighted word", () => {
    const h = mount();
    h.send({ type: "render", text: DOC });
    h.send({ type: "highlight", highlight: HOW });

    const markNode = h.article.querySelector("mark")!.firstChild!;
    h.tap(markNode, 1); // inside "How"

    expect(h.lastPosted()).toEqual({
      type: "wordTapped",
      byte: DOC.indexOf("How") + 1,
    });
  });

  it("reports UTF-8 byte offsets, so multibyte text does not skew the seek", () => {
    const doc = "Café música works. 🎧 Enjoy!";
    const h = mount();
    h.send({ type: "render", text: doc });

    const charIndex = doc.indexOf("Enjoy");
    h.tap(h.before(), charIndex);

    // 5 chars before "Enjoy" are multibyte, so the byte offset runs ahead of
    // the char index — the exact skew the core would decode as a wrong word.
    const expected = bytes(doc.slice(0, charIndex));
    expect(expected).toBeGreaterThan(charIndex);
    expect(h.lastPosted()).toEqual({ type: "wordTapped", byte: expected });
  });
});
