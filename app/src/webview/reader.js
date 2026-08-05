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

  // The article's DOM is built ONCE per render() as three stable children:
  //
  //   [beforeNode]  <mark id="aloud-current">[markTextNode]</mark>  [afterNode]
  //
  // Highlighting a word then only assigns three `nodeValue`s. The previous
  // approach rebuilt `articleEl.innerHTML` from escaped slices on every word
  // boundary, which meant an HTML re-parse and a full teardown/rebuild of the
  // article dozens of times per second — cost that scaled with document length
  // rather than with what actually changed (one word).
  //
  // Keeping the node structure fixed also removes the failure mode behind the
  // tap-to-seek bug: the DOM no longer reshapes under the tap handler, so the
  // Range walk in `globalCharOffset` always sees the same three children.
  var beforeNode = null;
  var markEl = null;
  var markTextNode = null;
  var afterNode = null;

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

  function render(text) {
    docText = text;
    byteToChar = buildByteMap(text);
    buildArticleDom(text);
  }

  /** Create the fixed three-child structure described above. */
  function buildArticleDom(text) {
    beforeNode = document.createTextNode(text);
    markTextNode = document.createTextNode("");
    markEl = document.createElement("mark");
    markEl.className = "aloud-word";
    markEl.id = "aloud-current";
    markEl.appendChild(markTextNode);
    afterNode = document.createTextNode("");

    // Text nodes carry no markup, so nothing here needs HTML-escaping — the
    // escaping the old innerHTML path required is gone along with the parse.
    articleEl.textContent = "";
    articleEl.appendChild(beforeNode);
    articleEl.appendChild(markEl);
    articleEl.appendChild(afterNode);
  }

  function highlight(range) {
    if (!markEl) return; // nothing rendered yet
    if (!range) {
      // An empty <mark> is zero-width, so this renders as plain text — the same
      // result the old `textContent = docText` reset produced.
      beforeNode.nodeValue = docText;
      markTextNode.nodeValue = "";
      afterNode.nodeValue = "";
      return;
    }
    var charStart = byteToChar[range.start];
    var charEnd = byteToChar[range.end];
    // Out-of-range bytes read back as undefined from the typed array; leave the
    // current highlight untouched rather than blanking it.
    if (charStart == null || charEnd == null) return;

    beforeNode.nodeValue = docText.slice(0, charStart);
    markTextNode.nodeValue = docText.slice(charStart, charEnd);
    afterNode.nodeValue = docText.slice(charEnd);

    if (markEl.scrollIntoView) {
      markEl.scrollIntoView({ block: "center", inline: "nearest" });
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
