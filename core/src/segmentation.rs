//! Text segmentation: document -> sentences ("units") -> word tokens.
//!
//! Two granularities matter to Aloud, and they are different on purpose:
//!
//! - A **unit** (sentence) is what we hand to the platform TTS engine as one
//!   utterance. Speaking sentence-by-sentence — rather than the whole article
//!   in one shot — is what makes pause/resume/seek feel instant and keeps the
//!   audio session interruption-friendly for screen-reader users.
//! - A **token** (word) is what we highlight in the WebView. When the native
//!   engine reports "I'm now speaking the character range 6..11 of this
//!   utterance", we resolve that to a token and light it up.
//!
//! Every unit and token stores **byte offsets into the original document text**,
//! so the WebView can map a highlight back onto the exact source span without
//! re-tokenising in JS (which would risk drift — see ADR-0002).
//!
//! ## Scope / honesty
//! This is a pragmatic segmenter, not a Unicode-compliant one. It handles ASCII
//! and common European punctuation well and is fully deterministic, which is
//! what an example and its tests want. Swapping in `unicode-segmentation` /
//! ICU rules is tracked as a follow-up (see the "Unicode segmentation" issue);
//! the public API here does not change when that happens.

use serde::Serialize;

/// A word token, addressed by byte offsets `[start, end)` into the document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Token {
    pub start: usize,
    pub end: usize,
}

/// A sentence unit: the byte span we speak, plus the tokens inside it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Unit {
    /// Byte offset of the first token in the unit (leading whitespace trimmed).
    pub start: usize,
    /// Byte offset just past the last token in the unit.
    pub end: usize,
    pub tokens: Vec<Token>,
}

impl Unit {
    /// The exact source slice this unit will speak.
    pub fn text<'a>(&self, document: &'a str) -> &'a str {
        &document[self.start..self.end]
    }
}

/// Returns `true` if `c` may appear *inside* a word token. We include the two
/// common apostrophes and the hyphen so "don't" and "well-known" stay whole,
/// which matters for a natural-sounding highlight.
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '\'' | '\u{2019}' | '-')
}

fn is_sentence_terminator(c: char) -> bool {
    matches!(c, '.' | '!' | '?')
}

/// Tokenise a slice, offsetting every token by `base` so the offsets are
/// document-global rather than slice-local.
fn tokenize(slice: &str, base: usize) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut token_start: Option<usize> = None;

    for (i, c) in slice.char_indices() {
        if is_word_char(c) {
            if token_start.is_none() {
                token_start = Some(i);
            }
        } else if let Some(start) = token_start.take() {
            tokens.push(Token {
                start: base + start,
                end: base + i,
            });
        }
    }
    if let Some(start) = token_start.take() {
        tokens.push(Token {
            start: base + start,
            end: base + slice.len(),
        });
    }
    tokens
}

/// Build a unit from a raw sentence span. Whitespace-only spans (e.g. the gap
/// after a paragraph) produce a unit with no tokens; callers drop those.
fn build_unit(document: &str, span_start: usize, span_end: usize) -> Unit {
    let slice = &document[span_start..span_end];
    let tokens = tokenize(slice, span_start);
    // Trim only *whitespace* from the bounds. We keep sentence-ending
    // punctuation ("Hello world." stays intact) because the TTS engine needs it
    // for natural prosody, but we never speak leading/trailing whitespace —
    // some engines pause awkwardly on it.
    let start = tokens.first().map(|t| t.start).unwrap_or(span_start);
    let end = span_start + slice.trim_end().len();
    Unit { start, end, tokens }
}

/// Segment `document` into sentence units. The returned units are in reading
/// order and contain only spans that have at least one word token.
pub fn segment(document: &str) -> Vec<Unit> {
    let mut units = Vec::new();
    let mut span_start = 0usize;
    let mut chars = document.char_indices().peekable();

    while let Some((idx, c)) = chars.next() {
        if is_sentence_terminator(c) {
            let mut span_end = idx + c.len_utf8();
            // Absorb runs like "?!" or "..." into a single terminator.
            while let Some(&(next_idx, next_c)) = chars.peek() {
                if is_sentence_terminator(next_c) {
                    span_end = next_idx + next_c.len_utf8();
                    chars.next();
                } else {
                    break;
                }
            }
            let unit = build_unit(document, span_start, span_end);
            if !unit.tokens.is_empty() {
                units.push(unit);
            }
            span_start = span_end;
        }
    }

    // Trailing text with no terminator (e.g. a headline) is still a unit.
    if span_start < document.len() {
        let unit = build_unit(document, span_start, document.len());
        if !unit.tokens.is_empty() {
            units.push(unit);
        }
    }

    units
}

/// Convert a **UTF-16 code-unit offset within `utterance`** to a byte offset
/// within the same string.
///
/// This is the crux of a real cross-platform quirk: iOS
/// (`AVSpeechSynthesizer` `willSpeakRangeOfSpeechString`) and Android
/// (`UtteranceProgressListener.onRangeStart`) both report word-boundary
/// positions as **UTF-16** offsets, because their string types are UTF-16.
/// Rust strings are UTF-8. If we treated the incoming number as a byte offset
/// we would land mid-character the first time an emoji or accented letter
/// appears — a silent corruption, not a crash. We convert explicitly instead.
///
/// Offsets past the end clamp to the string's byte length.
pub fn utf16_offset_to_byte(utterance: &str, utf16_offset: usize) -> usize {
    let mut utf16_seen = 0usize;
    for (byte_idx, c) in utterance.char_indices() {
        if utf16_seen >= utf16_offset {
            return byte_idx;
        }
        utf16_seen += c.len_utf16();
    }
    utterance.len()
}

/// Find the index of the token in `tokens` that contains `byte_offset`
/// (document-global). Falls back to the nearest following token so a highlight
/// never simply disappears when the engine reports a boundary that lands in
/// whitespace between words.
pub fn token_at_byte(tokens: &[Token], byte_offset: usize) -> Option<usize> {
    if tokens.is_empty() {
        return None;
    }
    for (i, t) in tokens.iter().enumerate() {
        if byte_offset < t.end {
            return Some(i);
        }
    }
    Some(tokens.len() - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_into_sentences() {
        let doc = "Hello world. How are you?";
        let units = segment(doc);
        assert_eq!(units.len(), 2);
        assert_eq!(units[0].text(doc), "Hello world.");
        assert_eq!(units[1].text(doc), "How are you?");
    }

    #[test]
    fn tokens_carry_document_global_offsets() {
        let doc = "Hello world.";
        let units = segment(doc);
        let tokens = &units[0].tokens;
        assert_eq!(tokens.len(), 2);
        assert_eq!(&doc[tokens[0].start..tokens[0].end], "Hello");
        assert_eq!(&doc[tokens[1].start..tokens[1].end], "world");
    }

    #[test]
    fn keeps_contractions_and_hyphenates_whole() {
        let doc = "It's a well-known fact.";
        let units = segment(doc);
        let words: Vec<&str> = units[0]
            .tokens
            .iter()
            .map(|t| &doc[t.start..t.end])
            .collect();
        assert_eq!(words, vec!["It's", "a", "well-known", "fact"]);
    }

    #[test]
    fn collapses_repeated_terminators() {
        let doc = "Really?! Yes...";
        let units = segment(doc);
        assert_eq!(units.len(), 2);
        assert_eq!(units[0].text(doc), "Really?!");
        assert_eq!(units[1].text(doc), "Yes...");
    }

    #[test]
    fn trailing_text_without_terminator_is_a_unit() {
        let doc = "A Headline";
        let units = segment(doc);
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].text(doc), "A Headline");
    }

    #[test]
    fn ignores_whitespace_only_spans() {
        let doc = "Done.   \n\n  ";
        let units = segment(doc);
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].text(doc), "Done.");
    }

    #[test]
    fn utf16_offset_matches_byte_offset_for_ascii() {
        let s = "Hello world";
        assert_eq!(utf16_offset_to_byte(s, 6), 6);
    }

    #[test]
    fn utf16_offset_accounts_for_astral_characters() {
        // "🎧" is 1 char, 2 UTF-16 code units, 4 UTF-8 bytes.
        let s = "🎧 audio";
        // UTF-16 offset 3 = past the emoji (2 units) + the space (1 unit).
        assert_eq!(utf16_offset_to_byte(s, 3), 5);
        assert_eq!(&s[utf16_offset_to_byte(s, 3)..], "audio");
    }

    #[test]
    fn token_at_byte_resolves_and_falls_forward() {
        let doc = "Hello world.";
        let tokens = &segment(doc)[0].tokens;
        assert_eq!(token_at_byte(tokens, 0), Some(0)); // inside "Hello"
        assert_eq!(token_at_byte(tokens, 5), Some(1)); // the space -> next token
        assert_eq!(token_at_byte(tokens, 8), Some(1)); // inside "world"
    }
}
