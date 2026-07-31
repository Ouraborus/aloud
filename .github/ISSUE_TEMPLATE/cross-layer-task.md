---
name: Cross-layer task
about: A feature or change that crosses the JS ↔ native ↔ Rust boundary
title: "[task] "
labels: []
---

## Goal
<!-- What should the user be able to do, and why. -->

## Layers involved
- [ ] Rust core
- [ ] FFI contract (schema + fixtures)
- [ ] RN / TypeScript
- [ ] WebView canvas
- [ ] iOS native
- [ ] Android native

## Contract change
<!-- New command / snapshot field? Describe the JSON shape. Remember: change the
     contract FIRST, then the bindings (see CONTRIBUTING.md). -->

## Acceptance criteria
- [ ] Behaviour defined once in the core with unit tests
- [ ] Contract tests updated and green in every language
- [ ] Accessibility reviewed (roles/labels/announcements) per docs/accessibility.md
- [ ] Lands as an atomic cross-layer commit on a `feat/…` branch
