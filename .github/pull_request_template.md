<!-- Keep PRs scoped to one task so review stays tractable. -->

## What & why
<!-- One paragraph: the change and the motivation. Link the issue. -->
Closes #

## Layers touched
<!-- Tick every layer this PR changes. A cross-layer feature should be ONE atomic
     commit so the boundary is never half-updated in history. -->
- [ ] Rust core (`core/`)
- [ ] FFI contract (`contracts/`)
- [ ] RN / TypeScript engine (`app/`)
- [ ] WebView canvas (`app/src/webview/`)
- [ ] iOS native (`native/aloud-tts/ios/`)
- [ ] Android native (`native/aloud-tts/android/`)
- [ ] Example host app (`example/`)
- [ ] Docs (`docs/`)

## Contract impact
<!-- Did the JSON protocol / C ABI change? If yes: schema + fixtures + every
     binding updated, and an ADR added for breaking changes. If no, say "none". -->

## Accessibility impact
<!-- New/changed controls have role+label+state? Any new speech during playback?
     Politeness chosen deliberately? See docs/accessibility.md. "none" is a valid
     answer for non-UI changes. -->

## Test evidence
<!-- Paste the relevant output. -->
- [ ] `cargo test` (core)
- [ ] `npm test` + `npm run typecheck` (app)
- [ ] Contract tests pass (parity across languages)
- [ ] Manual device a11y check (if UI/audio changed)

## Notes for the reviewer
<!-- Anything that makes the review faster: the risky bit, what to look at first. -->
