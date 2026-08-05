/*
 * Aloud WebView reader canvas — the embedded-JavaScript layer.
 *
 * Responsibilities:
 *   - render the article text,
 *   - highlight the word the TTS engine is currently speaking, given a
 *     document BYTE range from the core's Snapshot,
 *   - post word taps back up (used by the tap-to-seek feature).
 *
 * The one subtlety: the core speaks in UTF-8 **byte** offsets, but a JS string
 * is indexed by UTF-16 code units. We build the byte->charIndex map exactly ONCE
 * at render time (not per word), so the per-frame highlight path is O(1)-ish and
 * the conversion lives in a single, documented place.
 *
 * Messages IN  (RN -> WebView): { type: 'render', text } | { type: 'highlight', highlight } | { type: 'theme', scheme }
 * Messages OUT (WebView -> RN): { type: 'ready' } | { type: 'wordTapped', byte }
 */
(function () {
  "use strict";

  var articleEl = document.getElementById("article");
  var docText = "";
  /** byteToChar[b] = index into docText of the char starting at byte b. */
  var byteToChar = new Int32Array(0);

  function postToHost(message) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }
  }

  /** Build the UTF-8 byte -> UTF-16 char-index lookup for the whole document. */
  function buildByteMap(text) {
    var encoder = new TextEncoder();
    var totalBytes = encoder.encode(text).length;
    var map = new Int32Array(totalBytes + 1);
    var byte = 0;
    for (var i = 0; i < text.length; ) {
      var codePoint = text.codePointAt(i);
      var charLen = codePoint > 0xffff ? 2 : 1; // surrogate pair?
      var byteLen = utf8Len(codePoint);
      for (var b = 0; b < byteLen; b++) {
        map[byte + b] = i;
      }
      byte += byteLen;
      i += charLen;
    }
    map[totalBytes] = text.length;
    return map;
  }

  function utf8Len(codePoint) {
    if (codePoint <= 0x7f) return 1;
    if (codePoint <= 0x7ff) return 2;
    if (codePoint <= 0xffff) return 3;
    return 4;
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function render(text) {
    docText = text;
    byteToChar = buildByteMap(text);
    articleEl.textContent = text;
  }

  function highlight(range) {
    if (!range) {
      articleEl.textContent = docText;
      return;
    }
    var charStart = byteToChar[range.start];
    var charEnd = byteToChar[range.end];
    if (charStart == null || charEnd == null) return;

    articleEl.innerHTML =
      escapeHtml(docText.slice(0, charStart)) +
      '<mark class="aloud-word" id="aloud-current">' +
      escapeHtml(docText.slice(charStart, charEnd)) +
      "</mark>" +
      escapeHtml(docText.slice(charEnd));

    var mark = document.getElementById("aloud-current");
    if (mark && mark.scrollIntoView) {
      mark.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }

  function applyTheme(scheme) {
    document.documentElement.style.colorScheme = scheme === "dark" ? "dark" : "light";
  }

  // Tap-to-seek: report the byte offset of the tapped position so the host can
  // seek the core to that sentence. (Handled end-to-end by the SeekByte feature.)
  articleEl.addEventListener("click", function (event) {
    var sel = document.caretRangeFromPoint
      ? document.caretRangeFromPoint(event.clientX, event.clientY)
      : null;
    if (!sel) return;
    var charIndex = globalCharOffset(sel);
    var byte = charToByte(charIndex);
    postToHost({ type: "wordTapped", byte: byte });
  });

  // `range.startOffset` is local to whichever DOM node the tap landed in, not
  // global to the article. Once `highlight()` has run once, the article is no
  // longer a single text node — it's split into up to three siblings around
  // the <mark> — so a tap inside or after the highlighted word needs the
  // length of everything before it added back in. A Range from the top of the
  // article to the tap point does that walk for us regardless of which node
  // (or how many) the tap point falls in.
  function globalCharOffset(range) {
    var preRange = document.createRange();
    preRange.selectNodeContents(articleEl);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
  }

  function charToByte(charIndex) {
    // Inverse of the byte map; linear scan is fine for a tap (not hot path).
    var encoder = new TextEncoder();
    return encoder.encode(docText.slice(0, charIndex)).length;
  }

  function handleMessage(raw) {
    var msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    switch (msg.type) {
      case "render":
        render(msg.text);
        break;
      case "highlight":
        highlight(msg.highlight);
        break;
      case "theme":
        applyTheme(msg.scheme);
        break;
    }
  }

  // RN's react-native-webview delivers messages on both targets across versions.
  window.addEventListener("message", function (e) { handleMessage(e.data); });
  document.addEventListener("message", function (e) { handleMessage(e.data); });

  postToHost({ type: "ready" });
})();
