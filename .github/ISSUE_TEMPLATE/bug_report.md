---
name: Bug report
about: Something misbehaves across the stack
title: "[bug] "
labels: ["bug"]
---

## What happened
<!-- Symptom, and where you saw it (which platform, screen reader on/off). -->

## Trace id
<!-- If you can, reproduce and paste the correlated logs. A single trace id lines
     up JS/native/Rust/WebView — see docs/debugging-across-the-stack.md. -->
```
[aloud t=??? layer=... op=...] ...
```

## Which layer first diverged?
<!-- From the trace, the first layer whose output was wrong. Best guess is fine. -->

## Environment
- Platform / OS version:
- Physical device or simulator:
- `aloud_core` version (logged at load):
- Screen reader: VoiceOver / TalkBack / off
