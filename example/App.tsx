/**
 * Aloud demo host app.
 *
 * A thin shell that loads a sample article and hands it to the reader. All the
 * interesting behaviour lives in the `@aloud/app` reading engine (a workspace
 * package, imported like any library below — not a copy-pasted file) and the
 * `@aloud/aloud-tts` native module (Swift/Kotlin + the Rust core, autolinked
 * by CocoaPods/Gradle; see the root README).
 */

import React from "react";
import { SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";

import { ReaderScreen } from "@aloud/app";

const SAMPLE = [
  "Aloud reads to you.",
  "It highlights every word as it speaks.",
  "The reading position lives in a shared Rust core, so iOS and Android stay in step.",
  "Café música even works, because the core maps UTF-16 boundaries to UTF-8.",
  "Enjoy!",
].join(" ");

export default function App() {
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Aloud
        </Text>
        <Text style={styles.subtitle}>Accessible read-aloud reader</Text>
      </View>
      <ReaderScreen document={SAMPLE} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 28, fontWeight: "800", color: "#1a1a1a" },
  subtitle: { fontSize: 14, color: "#666" },
});
