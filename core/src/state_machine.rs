//! The reading-position state machine — the single source of truth.
//!
//! Everything the user perceives (which sentence is being spoken, which word is
//! highlighted, whether we're playing/paused/finished) is derived from this
//! reducer. Native TTS callbacks, UI buttons and WebView taps are all just
//! [`Command`]s fed into [`ReadingSession::dispatch`]; each returns a
//! [`Snapshot`] that the outer layers render. No layer keeps its own copy of the
//! position, so there is nothing to get out of sync.

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::segmentation::{self, Unit};

/// Playback status. Serialised as a plain string so every language can switch on
/// it without a shared enum definition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// Loaded but never started.
    Idle,
    /// Actively speaking.
    Playing,
    /// Paused mid-document; position is retained.
    Paused,
    /// Reached the end of the document.
    Finished,
}

/// Commands accepted over the FFI boundary. The `type` field is the tag, and
/// this exact JSON shape is the contract enforced by `contracts/` and the
/// cross-language contract tests.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum Command {
    /// Start (or resume, or restart if finished) playback.
    Play,
    /// Pause, retaining position.
    Pause,
    /// Advance to the next sentence; finishing the document if already last.
    Next,
    /// Go back one sentence.
    Prev,
    /// Jump to a specific sentence index.
    SeekUnit { unit: usize },
    /// Jump to whichever sentence contains a document **byte offset**, and to the
    /// word at that offset. This backs "tap a word in the reader to jump there":
    /// the WebView reports the tapped byte, and the core resolves it to a
    /// unit + token so no layer re-derives sentence boundaries.
    #[serde(rename_all = "camelCase")]
    SeekByte { byte: usize },
    /// A word-boundary report from the platform TTS engine.
    ///
    /// `utf16Offset` is the UTF-16 offset **within the current utterance** — the
    /// exact number iOS/Android hand us. The core converts it to a token; the
    /// outer layers never do this math (see `segmentation::utf16_offset_to_byte`).
    #[serde(rename_all = "camelCase")]
    WordBoundary { utf16_offset: usize },
    /// Return the current snapshot without mutating anything.
    GetState,
}

/// A byte span into the document, ready for the WebView to highlight.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Highlight {
    pub start: usize,
    pub end: usize,
}

/// The immutable view of session state returned by every dispatch. This is the
/// only shape the native/JS layers deserialise.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub status: Status,
    /// Current sentence index.
    pub unit: usize,
    /// Total sentences in the document.
    pub unit_count: usize,
    /// Current word index within the current sentence.
    pub token: usize,
    /// Total words in the current sentence.
    pub token_count: usize,
    /// The exact text the platform engine should speak for the current sentence
    /// (empty when idle/finished).
    pub utterance: String,
    /// Document byte span to highlight, or `null` when nothing should be lit.
    pub highlight: Option<Highlight>,
}

/// Owns the parsed document and the live reading position.
#[derive(Debug, Clone)]
pub struct ReadingSession {
    text: String,
    units: Vec<Unit>,
    status: Status,
    unit: usize,
    token: usize,
}

impl ReadingSession {
    /// Parse `text` and start idle at the top of the document.
    pub fn new(text: impl Into<String>) -> Self {
        let text = text.into();
        let units = segmentation::segment(&text);
        Self {
            text,
            units,
            status: Status::Idle,
            unit: 0,
            token: 0,
        }
    }

    pub fn unit_count(&self) -> usize {
        self.units.len()
    }

    /// Apply a command and return the resulting snapshot.
    pub fn dispatch(&mut self, command: Command) -> Result<Snapshot, CoreError> {
        match command {
            Command::Play => self.play(),
            Command::Pause => self.pause(),
            Command::Next => self.next(),
            Command::Prev => self.prev(),
            Command::SeekUnit { unit } => self.seek(unit)?,
            Command::SeekByte { byte } => self.seek_byte(byte),
            Command::WordBoundary { utf16_offset } => self.word_boundary(utf16_offset),
            Command::GetState => {}
        }
        Ok(self.snapshot())
    }

    fn play(&mut self) {
        if self.units.is_empty() {
            return; // nothing to read
        }
        if self.status == Status::Finished {
            self.unit = 0;
            self.token = 0;
        }
        self.status = Status::Playing;
    }

    fn pause(&mut self) {
        if self.status == Status::Playing {
            self.status = Status::Paused;
        }
    }

    fn next(&mut self) {
        if self.units.is_empty() {
            return;
        }
        if self.unit + 1 < self.units.len() {
            self.unit += 1;
            self.token = 0;
        } else {
            self.status = Status::Finished;
        }
    }

    fn prev(&mut self) {
        if self.units.is_empty() {
            return;
        }
        if self.unit > 0 {
            self.unit -= 1;
        }
        self.token = 0;
        if self.status == Status::Finished {
            self.status = Status::Paused;
        }
    }

    fn seek(&mut self, unit: usize) -> Result<(), CoreError> {
        if unit >= self.units.len() {
            return Err(CoreError::unit_out_of_range(unit, self.units.len()));
        }
        self.unit = unit;
        self.token = 0;
        if self.status == Status::Finished {
            self.status = Status::Paused;
        }
        Ok(())
    }

    fn seek_byte(&mut self, byte: usize) {
        if self.units.is_empty() {
            return;
        }
        // The first unit whose span reaches past `byte`. A tap in the whitespace
        // gap between two sentences maps forward to the following sentence; a tap
        // past the end clamps to the last sentence.
        let idx = self
            .units
            .iter()
            .position(|u| byte < u.end)
            .unwrap_or(self.units.len() - 1);
        self.unit = idx;
        self.token = segmentation::token_at_byte(&self.units[idx].tokens, byte).unwrap_or(0);
        if self.status == Status::Finished {
            self.status = Status::Paused;
        }
    }

    fn word_boundary(&mut self, utf16_offset: usize) {
        let Some(unit) = self.units.get(self.unit) else {
            return;
        };
        let utterance = unit.text(&self.text);
        // UTF-16 (from the platform) -> byte offset within the utterance ...
        let byte_in_utterance = segmentation::utf16_offset_to_byte(utterance, utf16_offset);
        // ... then to a document-global offset, then to a token.
        let global_byte = unit.start + byte_in_utterance;
        if let Some(idx) = segmentation::token_at_byte(&unit.tokens, global_byte) {
            self.token = idx;
        }
    }

    fn current_unit(&self) -> Option<&Unit> {
        self.units.get(self.unit)
    }

    fn snapshot(&self) -> Snapshot {
        let show_content = !self.units.is_empty() && self.status != Status::Finished;
        let unit = self.current_unit();

        let utterance = if show_content {
            unit.map(|u| u.text(&self.text).to_string())
                .unwrap_or_default()
        } else {
            String::new()
        };

        let token_count = unit.map(|u| u.tokens.len()).unwrap_or(0);

        let highlight = match (show_content, self.status) {
            // Only light a word while there is content and we're not idle at the
            // very top with nothing spoken yet.
            (true, Status::Playing) | (true, Status::Paused) => unit
                .and_then(|u| u.tokens.get(self.token))
                .map(|t| Highlight {
                    start: t.start,
                    end: t.end,
                }),
            _ => None,
        };

        Snapshot {
            status: self.status,
            unit: self.unit,
            unit_count: self.units.len(),
            token: self.token,
            token_count,
            utterance,
            highlight,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> ReadingSession {
        ReadingSession::new("Hello world. How are you? Bye.")
    }

    #[test]
    fn starts_idle_with_units_parsed() {
        let s = session();
        assert_eq!(s.unit_count(), 3);
        let snap = ReadingSession::new("Hello world.")
            .dispatch(Command::GetState)
            .unwrap();
        assert_eq!(snap.status, Status::Idle);
        assert_eq!(snap.highlight, None);
    }

    #[test]
    fn play_lights_first_word_of_first_sentence() {
        let mut s = session();
        let snap = s.dispatch(Command::Play).unwrap();
        assert_eq!(snap.status, Status::Playing);
        assert_eq!(snap.utterance, "Hello world.");
        let hl = snap.highlight.unwrap();
        assert_eq!(&"Hello world. How are you? Bye."[hl.start..hl.end], "Hello");
    }

    #[test]
    fn word_boundary_moves_the_highlight() {
        let mut s = session();
        s.dispatch(Command::Play).unwrap();
        // UTF-16 offset 6 within "Hello world." is the start of "world".
        let snap = s
            .dispatch(Command::WordBoundary { utf16_offset: 6 })
            .unwrap();
        assert_eq!(snap.token, 1);
        let hl = snap.highlight.unwrap();
        assert_eq!(&"Hello world. How are you? Bye."[hl.start..hl.end], "world");
    }

    #[test]
    fn next_advances_and_resets_word() {
        let mut s = session();
        s.dispatch(Command::Play).unwrap();
        s.dispatch(Command::WordBoundary { utf16_offset: 6 })
            .unwrap();
        let snap = s.dispatch(Command::Next).unwrap();
        assert_eq!(snap.unit, 1);
        assert_eq!(snap.token, 0);
        assert_eq!(snap.utterance, "How are you?");
    }

    #[test]
    fn next_past_the_end_finishes() {
        let mut s = session();
        s.dispatch(Command::Play).unwrap();
        s.dispatch(Command::SeekUnit { unit: 2 }).unwrap();
        let snap = s.dispatch(Command::Next).unwrap();
        assert_eq!(snap.status, Status::Finished);
        assert_eq!(snap.utterance, "");
        assert_eq!(snap.highlight, None);
    }

    #[test]
    fn seek_byte_jumps_to_the_unit_and_word() {
        let doc = "Hello world. How are you? Bye.";
        let mut s = ReadingSession::new(doc);
        // Tap the word "are" — resolve its document byte offset.
        let byte = doc.find("are").unwrap();
        let snap = s.dispatch(Command::SeekByte { byte }).unwrap();
        assert_eq!(snap.unit, 1); // "How are you?"
        assert_eq!(snap.utterance, "How are you?");
        assert_eq!(snap.token, 1); // How[0] are[1] you[2]
    }

    #[test]
    fn seek_byte_while_playing_moves_the_highlight() {
        let doc = "Hello world. How are you? Bye.";
        let mut s = ReadingSession::new(doc);
        s.dispatch(Command::Play).unwrap();
        let byte = doc.find("Bye").unwrap();
        let snap = s.dispatch(Command::SeekByte { byte }).unwrap();
        assert_eq!(snap.status, Status::Playing);
        assert_eq!(snap.unit, 2);
        let hl = snap.highlight.unwrap();
        assert_eq!(&doc[hl.start..hl.end], "Bye");
    }

    #[test]
    fn seek_byte_past_the_end_clamps_to_last_sentence() {
        let doc = "One. Two.";
        let mut s = ReadingSession::new(doc);
        let snap = s.dispatch(Command::SeekByte { byte: 9999 }).unwrap();
        assert_eq!(snap.unit, 1);
        assert_eq!(snap.utterance, "Two.");
    }

    #[test]
    fn play_after_finished_restarts_from_top() {
        let mut s = session();
        s.dispatch(Command::Play).unwrap();
        s.dispatch(Command::SeekUnit { unit: 2 }).unwrap();
        s.dispatch(Command::Next).unwrap(); // -> Finished
        let snap = s.dispatch(Command::Play).unwrap();
        assert_eq!(snap.status, Status::Playing);
        assert_eq!(snap.unit, 0);
        assert_eq!(snap.utterance, "Hello world.");
    }

    #[test]
    fn seek_out_of_range_is_an_error_not_a_crash() {
        let mut s = session();
        let err = s.dispatch(Command::SeekUnit { unit: 99 }).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::UnitOutOfRange);
    }

    #[test]
    fn pause_retains_position_and_highlight() {
        let mut s = session();
        s.dispatch(Command::Play).unwrap();
        s.dispatch(Command::WordBoundary { utf16_offset: 6 })
            .unwrap();
        let snap = s.dispatch(Command::Pause).unwrap();
        assert_eq!(snap.status, Status::Paused);
        assert_eq!(snap.token, 1);
        assert!(snap.highlight.is_some());
    }
}
