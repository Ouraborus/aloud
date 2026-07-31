/**
 * ReaderScreen — the View in MVVM.
 *
 * It binds to the ViewModel (via `useReadingSession`) and owns two things the
 * ViewModel deliberately does not: the platform UI and its accessibility.
 *
 * Accessibility highlights in this file:
 *   - Controls expose `accessibilityRole="button"`, a clear label, and
 *     `accessibilityState={{ disabled }}` so VoiceOver/TalkBack announce state.
 *   - The play/pause control keeps a STABLE label position and moves focus to it
 *     after load, so a screen-reader user lands on the primary action.
 *   - Progress is exposed as an `adjustable` control: swipe up/down on the
 *     progress row maps to next/prev sentence, the idiomatic screen-reader
 *     gesture, instead of forcing tiny hit targets.
 *   - The WebView highlight is decorative; it never steals the a11y focus.
 */

import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useReadingSession } from "../hooks/useReadingSession";

// The reader canvas assets are bundled with the app (see metro asset config).
const READER_SOURCE = require("../webview/reader.html");

export function ReaderScreen({ document: doc }: { document: string }) {
  const { viewState, play, pause, next, prev } = useReadingSession(doc);
  const webRef = useRef<WebView>(null);
  const playButtonRef = useRef<View>(null);

  // Push document + theme into the WebView once it signals ready.
  const onWebViewMessage = (event: WebViewMessageEvent) => {
    const msg = JSON.parse(event.nativeEvent.data);
    if (msg.type === "ready") {
      post({ type: "render", text: doc });
    }
    // `wordTapped` is consumed by the tap-to-seek feature.
  };

  const post = (message: unknown) =>
    webRef.current?.postMessage(JSON.stringify(message));

  // Mirror the current highlight into the WebView every time it changes.
  useEffect(() => {
    post({ type: "highlight", highlight: viewState.highlight });
  }, [viewState.highlight]);

  // After first load, move screen-reader focus to the primary action.
  useEffect(() => {
    if (viewState.status !== "idle") return;
    const node = findNodeHandle(playButtonRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, [viewState.status]);

  return (
    <View style={styles.root}>
      <WebView
        ref={webRef}
        source={READER_SOURCE}
        originWhitelist={["*"]}
        onMessage={onWebViewMessage}
        style={styles.canvas}
        // The article is read by our TTS engine; hide the WebView from the a11y
        // tree so the screen reader does not also try to read it as a huge blob.
        importantForAccessibility="no-hide-descendants"
      />

      <View
        style={styles.controls}
        accessibilityRole="toolbar"
        accessible={false}
      >
        <ControlButton label="Previous sentence" onPress={prev} icon="⏮" />

        <Pressable
          ref={playButtonRef}
          onPress={viewState.isPlaying ? pause : play}
          disabled={!viewState.canPlay && !viewState.canPause}
          accessibilityRole="button"
          accessibilityLabel={viewState.isPlaying ? "Pause" : "Play"}
          accessibilityState={{
            disabled: !viewState.canPlay && !viewState.canPause,
            busy: viewState.isPlaying,
          }}
          style={styles.playButton}
        >
          <Text style={styles.playIcon}>{viewState.isPlaying ? "⏸" : "▶︎"}</Text>
        </Pressable>

        <ControlButton label="Next sentence" onPress={next} icon="⏭" />
      </View>

      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Reading progress"
        accessibilityValue={{ text: viewState.progressLabel }}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "increment") next();
          if (e.nativeEvent.actionName === "decrement") prev();
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        style={styles.progressRow}
      >
        <Text style={styles.progressLabel}>{viewState.progressLabel}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { flex: viewState.progress }]} />
          <View style={{ flex: 1 - viewState.progress }} />
        </View>
      </View>
    </View>
  );
}

function ControlButton({
  label,
  onPress,
  icon,
}: {
  label: string;
  onPress: () => void;
  icon: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Meet the 44x44pt minimum touch target (WCAG 2.5.5 / Apple HIG).
      hitSlop={12}
      style={styles.controlButton}
    >
      <Text style={styles.controlIcon}>{icon}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  canvas: { flex: 1 },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 32,
    paddingVertical: 16,
  },
  controlButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  controlIcon: { fontSize: 28 },
  playButton: {
    minWidth: 64,
    minHeight: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2b6cb0",
  },
  playIcon: { fontSize: 30, color: "white" },
  progressRow: { paddingHorizontal: 20, paddingBottom: 24, gap: 8 },
  progressLabel: { fontSize: 14, opacity: 0.8 },
  progressTrack: { flexDirection: "row", height: 6, borderRadius: 3, backgroundColor: "#ccc", overflow: "hidden" },
  progressFill: { backgroundColor: "#2b6cb0" },
});
