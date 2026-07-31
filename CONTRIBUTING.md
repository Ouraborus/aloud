# Contributing to Aloud

This project treats git history, tests and the FFI contract as part of the
product. A few conventions keep cross-layer work tractable.

## Branches & commits
- **One branch per task**, prefixed by type: `feat/`, `fix/`, `docs/`, `ci/`,
  `refactor/`. Each branch maps to a tracking issue.
- **Atomic commits for cross-layer changes.** When a change touches multiple
  layers because it *is* one change (e.g. a new command touching Rust + contract
  + TS + Swift + Kotlin), commit it together so the boundary is never half-updated
  in history. Do not split a single logical change across commits per language.
- Conventional-commit style subjects: `feat(core): add SeekByte command`.
- Every commit compiles and passes the fast test suite.

## Changing the FFI protocol (read this first)
The order is not optional — it is what keeps four languages in sync:
1. Edit [`contracts/commands.schema.json`](contracts/commands.schema.json) and
   [`contracts/ffi.contract.md`](contracts/ffi.contract.md).
2. Add/adjust a golden fixture in
   [`contracts/fixtures.json`](contracts/fixtures.json).
3. Update every binding (Rust, TS, Swift, Kotlin) until its contract test is
   green.
4. Record breaking changes in an ADR under [`docs/adr/`](docs/adr/).

## Before opening a PR
```bash
cargo fmt --all --manifest-path core/Cargo.toml
cargo clippy --all-targets --manifest-path core/Cargo.toml -- -D warnings
cargo test --manifest-path core/Cargo.toml
cd app && npm test && npm run typecheck
```

## PRs
- Fill in [`.github/pull_request_template.md`](.github/pull_request_template.md):
  layers touched, contract impact, test evidence, accessibility impact.
- Keep PRs scoped to one task so review stays tractable.
- Accessibility is part of "done" — see
  [`docs/accessibility.md`](docs/accessibility.md).
