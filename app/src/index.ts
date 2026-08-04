/**
 * Public surface of `@aloud/app`.
 *
 * This is what a consuming app (see `example/App.tsx`) imports — the rest of
 * `src/` is implementation detail. Deep imports (e.g.
 * `@aloud/app/src/core/ReadingSessionViewModel`) still work since this is
 * plain TypeScript source, not a bundled package, but prefer this barrel so
 * the public API stays deliberate and easy to keep stable.
 */

export { ReaderScreen } from "./components/ReaderScreen";
export { useReadingSession } from "./hooks/useReadingSession";
export { ReadingSessionViewModel } from "./core/ReadingSessionViewModel";
export type { ReaderViewState, ViewModelDeps } from "./core/ReadingSessionViewModel";

export type {
  Command,
  Snapshot,
  Status,
  Highlight,
  CoreError,
  CoreResponse,
  ErrorEnvelope,
} from "./contract/types";
export { isError } from "./contract/types";

export type { AloudTts, AloudTtsCommands, AloudTtsEvents, SnapshotListener } from "./native/AloudTtsSpec";
export { nativeAloudTts } from "./native/AloudTts.native";

export type { Announcer, Announcement, Politeness } from "./a11y/announce";
export { announcementFor, announceTransition } from "./a11y/announce";
export { platformAnnouncer } from "./a11y/PlatformAnnouncer";
