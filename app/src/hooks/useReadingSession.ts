/**
 * React binding for the `ReadingSessionViewModel`.
 *
 * The hook is a thin adapter: it constructs the ViewModel once, subscribes to
 * its changes with `useSyncExternalStore` (so React re-renders on every
 * snapshot), and returns the derived `viewState` plus the intent callbacks. All
 * logic stays in the ViewModel; the hook only wires it to React's lifecycle.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { ReadingSessionViewModel } from "../core/ReadingSessionViewModel";
import { nativeAloudTts } from "../native/AloudTts.native";
import { platformAnnouncer } from "../a11y/PlatformAnnouncer";
import { asyncStoragePreferenceStore } from "../native/AsyncStoragePreferenceStore";

export function useReadingSession(documentText: string) {
  const vm = useMemo(
    () =>
      new ReadingSessionViewModel({
        tts: nativeAloudTts,
        announcer: platformAnnouncer,
        store: asyncStoragePreferenceStore,
      }),
    [],
  );

  // Load whenever the document changes. This effect deliberately has NO
  // cleanup: swapping documents is not a reason to tear down the audio session
  // and free the Rust core. `vm.load` already replaces the core session and
  // re-points the native subscription.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor.current === documentText) return;
    loadedFor.current = documentText;
    void vm.load(documentText);
  }, [vm, documentText]);

  // Release native resources only when the screen actually goes away. Keeping
  // this separate from the load effect is the point: the two used to share one
  // effect, so every document change ran `dispose()` — releasing the audio
  // session mid-life — and then re-loaded.
  useEffect(() => () => void vm.dispose(), [vm]);

  // Observe the version counter so rate changes (which don't replace the
  // snapshot object) still re-render. `subscribe` must be referentially stable:
  // React re-subscribes whenever its identity changes, and an inline arrow
  // changes every render.
  const subscribe = useCallback((onChange: () => void) => vm.subscribe(onChange), [vm]);
  const getVersion = useCallback(() => vm.getVersion(), [vm]);
  useSyncExternalStore(subscribe, getVersion);

  return {
    viewState: vm.viewState,
    play: vm.play,
    pause: vm.pause,
    next: vm.next,
    prev: vm.prev,
    seekUnit: vm.seekUnit,
    seekByte: vm.seekByte,
    setRate: vm.setRate,
    stepRate: vm.stepRate,
  };
}
