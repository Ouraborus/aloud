//! A runnable, end-to-end demonstration of the real `aloud_core` engine.
//!
//! It does exactly what the native layer does at runtime — Play, then feed the
//! per-word boundaries a TTS engine would report, advancing sentence by sentence
//! — and prints the read-aloud progression, so you can watch the state machine,
//! segmentation, and UTF-16→UTF-8 mapping working without a device.
//!
//! Run:
//!   cargo run --example read_aloud --manifest-path core/Cargo.toml
//!
//! It also prints a `HIGHLIGHTS_JSON=[...]` line — the exact highlight byte
//! ranges the core produced — which the WebView demo replays visually.

use aloud_core::segmentation::utf16_word_starts;
use aloud_core::state_machine::Command;
use aloud_core::{ReadingSession, Status, VERSION};

fn main() {
    let document = "Aloud reads to you. It highlights every word as it speaks. \
                    Café música even works. Enjoy!";

    println!("┌─────────────────────────────────────────────────────────────┐");
    println!("│  aloud_core v{VERSION} — read-aloud engine demo                  │");
    println!("└─────────────────────────────────────────────────────────────┘");
    println!("document: {document:?}\n");

    let mut session = ReadingSession::new(document);
    println!("[core] segmented into {} sentences\n", session.unit_count());

    // Collected highlight ranges, for the WebView demo to replay.
    let mut highlights: Vec<(usize, usize)> = Vec::new();

    // Start playback.
    let mut snap = session.dispatch(Command::Play).unwrap();

    while snap.status == Status::Playing {
        println!("▶ sentence {}: {:?}", snap.unit + 1, snap.utterance);

        // Walk this sentence word-by-word, as the TTS engine would.
        let utterance = snap.utterance.clone();
        for offset in utf16_word_starts(&utterance) {
            let step = session
                .dispatch(Command::WordBoundary {
                    utf16_offset: offset,
                })
                .unwrap();
            if let Some(hl) = step.highlight {
                let word = &document[hl.start..hl.end];
                println!("    · {word:<12} bytes {}..{}", hl.start, hl.end);
                highlights.push((hl.start, hl.end));
            }
        }

        // Sentence finished — advance (this is the native onDone/didFinish loop).
        snap = session.dispatch(Command::Next).unwrap();
    }

    println!("\n[core] status: {:?} — reached the end.", snap.status);

    // Emit the machine-readable highlight sequence for the WebView demo.
    let json: Vec<String> = highlights
        .iter()
        .map(|(s, e)| format!("[{s},{e}]"))
        .collect();
    println!("\nHIGHLIGHTS_JSON=[{}]", json.join(","));
}
