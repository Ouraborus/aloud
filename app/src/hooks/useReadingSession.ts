/**
 * React binding for the `ReadingSessionViewModel`.
 *
 * The hook is a thin adapter: it constructs the ViewModel once, subscribes to
 * its changes with `useSyncExternalStore` (so React re-renders on every
 * snapshot), and returns the derived `viewState` plus the intent callbacks. All
 * logic stays in the ViewModel; the hook only wires it to React's lifecycle.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { ReadingSessionViewModel } from "../core/ReadingSessionViewModel";
import { nativeAloudTts } from "../native/AloudTts.native";
import { platformAnnouncer } from "../a11y/PlatformAnnouncer";

export function useReadingSession(documentText: string) {
  const vm = useMemo(
    () =>
      new ReadingSessionViewModel({
        tts: nativeAloudTts,
        announcer: platformAnnouncer,
      }),
    [],
  );

  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor.current !== documentText) {
      loadedFor.current = documentText;
      void vm.load(documentText);
    }
    return () => {
      void vm.dispose();
    };
  }, [vm, documentText]);

  useSyncExternalStore(
    (onChange) => vm.subscribe(onChange),
    () => vm.getSnapshot(),
  );

  return {
    viewState: vm.viewState,
    play: vm.play,
    pause: vm.pause,
    next: vm.next,
    prev: vm.prev,
    seekUnit: vm.seekUnit,
    seekByte: vm.seekByte,
  };
}
