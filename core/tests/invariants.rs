//! Invariant tests for segmentation.
//!
//! The byte offsets the core hands out are a contract the WebView highlight and
//! the native word-boundary mapping both depend on. Rather than assert specific
//! outputs (that is `segmentation`'s unit tests), these check *properties* that
//! must hold for ANY input — the cheap way to catch a whole class of "highlight
//! landed on half a character" bugs across many documents at once.

use aloud_core::segmentation::segment;

/// A spread of documents: ASCII, punctuation runs, accents, emoji/astral chars,
/// CJK, whitespace, and empty. If an offset is ever going to land mid-character,
/// one of these will provoke it.
const DOCUMENTS: &[&str] = &[
    "",
    "   \n\t  ",
    "Hello world.",
    "It's a well-known, hard-won fact!",
    "Really?!? Yes... maybe.",
    "Café música — naïve façade.",
    "🎧 Listen up. Ready? 🚀 Go.",
    "日本語のテキスト。これはテストです。",
    "A headline with no terminator",
    "Mixed 🎧 Café 日本語 end.",
];

#[test]
fn every_offset_is_a_valid_char_boundary_within_the_document() {
    for &doc in DOCUMENTS {
        for (u, unit) in segment(doc).into_iter().enumerate() {
            assert!(
                unit.start <= unit.end && unit.end <= doc.len(),
                "doc {doc:?} unit {u}: bounds {}..{} outside 0..{}",
                unit.start,
                unit.end,
                doc.len()
            );
            assert!(
                doc.is_char_boundary(unit.start) && doc.is_char_boundary(unit.end),
                "doc {doc:?} unit {u}: bounds not on char boundaries"
            );
            // Slicing must not panic — this is exactly what the native layer does
            // to get the utterance text.
            let _ = &doc[unit.start..unit.end];

            for (t, token) in unit.tokens.iter().enumerate() {
                assert!(
                    unit.start <= token.start && token.start < token.end && token.end <= unit.end,
                    "doc {doc:?} unit {u} token {t}: {}..{} not within unit {}..{}",
                    token.start,
                    token.end,
                    unit.start,
                    unit.end
                );
                assert!(
                    doc.is_char_boundary(token.start) && doc.is_char_boundary(token.end),
                    "doc {doc:?} unit {u} token {t}: token not on char boundaries"
                );
            }
        }
    }
}

#[test]
fn tokens_are_ordered_and_non_overlapping() {
    for &doc in DOCUMENTS {
        for unit in segment(doc) {
            let mut prev_end = unit.start;
            for token in &unit.tokens {
                assert!(
                    token.start >= prev_end,
                    "doc {doc:?}: tokens overlap or go backwards near byte {}",
                    token.start
                );
                prev_end = token.end;
            }
        }
    }
}

#[test]
fn units_are_ordered_and_never_empty_of_words() {
    for &doc in DOCUMENTS {
        let units = segment(doc);
        let mut prev_start = 0usize;
        for unit in &units {
            assert!(
                !unit.tokens.is_empty(),
                "doc {doc:?}: produced a unit with no word tokens"
            );
            assert!(
                unit.start >= prev_start,
                "doc {doc:?}: units are not in reading order"
            );
            prev_start = unit.start;
        }
    }
}
