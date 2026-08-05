//! End-to-end integration test: drive a whole document the way the native layer
//! will at runtime — Play, a stream of word-boundary reports per sentence, then
//! advance — and assert the highlight tracks correctly across the boundary math.
//!
//! This is the "if the state machine is wrong, the app highlights the wrong
//! word" safety net, exercised entirely off-device.

use aloud_core::segmentation::utf16_word_starts;
use aloud_core::state_machine::Command;
use aloud_core::{ReadingSession, Status};

#[test]
fn reads_a_full_document_and_tracks_the_highlight() {
    let doc = "Aloud reads to you. It highlights every word.";
    let mut session = ReadingSession::new(doc);
    assert_eq!(session.unit_count(), 2);

    // Start playback: highlight lands on the first word of the first sentence.
    let snap = session.dispatch(Command::Play).unwrap();
    assert_eq!(snap.status, Status::Playing);
    assert_eq!(snap.utterance, "Aloud reads to you.");
    let hl = snap.highlight.unwrap();
    assert_eq!(&doc[hl.start..hl.end], "Aloud");

    // Walk sentence one word-by-word as the engine would.
    let words = utf16_word_starts("Aloud reads to you.");
    let expected = ["Aloud", "reads", "to", "you"];
    for (i, &offset) in words.iter().enumerate() {
        let snap = session
            .dispatch(Command::WordBoundary {
                utf16_offset: offset,
            })
            .unwrap();
        let hl = snap.highlight.unwrap();
        assert_eq!(&doc[hl.start..hl.end], expected[i], "word {i}");
    }

    // Sentence finished -> advance to sentence two.
    let snap = session.dispatch(Command::Next).unwrap();
    assert_eq!(snap.unit, 1);
    assert_eq!(snap.utterance, "It highlights every word.");
    let hl = snap.highlight.unwrap();
    assert_eq!(&doc[hl.start..hl.end], "It");

    // Finish the document.
    let snap = session.dispatch(Command::Next).unwrap();
    assert_eq!(snap.status, Status::Finished);
    assert!(snap.highlight.is_none());
}

#[test]
fn boundary_math_survives_multibyte_text() {
    // A sentence containing an astral char before the words we highlight.
    let doc = "🎧 Café música.";
    let mut session = ReadingSession::new(doc);
    session.dispatch(Command::Play).unwrap();

    // "Café" begins after the emoji (2 UTF-16 units) and a space (1) => offset 3.
    let snap = session
        .dispatch(Command::WordBoundary { utf16_offset: 3 })
        .unwrap();
    let hl = snap.highlight.unwrap();
    assert_eq!(&doc[hl.start..hl.end], "Café");
}
