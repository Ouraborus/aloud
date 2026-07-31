/**
 * Concrete `AloudTts` adapter binding to the real native module + event emitter.
 *
 * This is the only file that imports `react-native` for the reader engine, which
 * is why the ViewModel and its tests depend on the `AloudTts` *interface*
 * instead. If the native module is missing (e.g. running in a bare JS test
 * harness), we fail loudly with an actionable message rather than throwing an
 * opaque "null is not an object".
 */

import { NativeEventEmitter, NativeModules } from "react-native";

import type { Snapshot } from "../contract/types";
import type { AloudTts, SnapshotListener } from "./AloudTtsSpec";

const LINKING_ERROR =
  "The native module 'AloudTts' is not linked. Rebuild the app after installing " +
  "(pod install for iOS / Gradle sync for Android). See ios/README.md and android/README.md.";

const AloudTtsNative = NativeModules.AloudTts
  ? NativeModules.AloudTts
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      },
    );

const emitter = new NativeEventEmitter(AloudTtsNative);

export const nativeAloudTts: AloudTts = {
  getCoreVersion: () => AloudTtsNative.getCoreVersion(),
  load: (text, traceId) => AloudTtsNative.load(text, traceId),
  play: (traceId) => AloudTtsNative.play(traceId),
  pause: (traceId) => AloudTtsNative.pause(traceId),
  next: (traceId) => AloudTtsNative.next(traceId),
  prev: (traceId) => AloudTtsNative.prev(traceId),
  seekUnit: (unit, traceId) => AloudTtsNative.seekUnit(unit, traceId),
  release: () => AloudTtsNative.release(),
  subscribe(listener: SnapshotListener) {
    const sub = emitter.addListener("AloudSnapshot", (snap: Snapshot) =>
      listener(snap, "native"),
    );
    return () => sub.remove();
  },
};
