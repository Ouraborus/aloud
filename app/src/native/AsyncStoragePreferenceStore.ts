/**
 * The real `PreferenceStore`, backed by `@react-native-async-storage`.
 *
 * Isolated in its own file (like the native TTS adapter) so the ViewModel — and
 * its tests — depend only on the `PreferenceStore` interface, never on the
 * storage library.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { clampRate, type PreferenceStore } from "../core/ReadingPreferences";

const RATE_KEY = "aloud.rate";

export const asyncStoragePreferenceStore: PreferenceStore = {
  async getRate() {
    const raw = await AsyncStorage.getItem(RATE_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampRate(parsed) : null;
  },
  async setRate(rate: number) {
    await AsyncStorage.setItem(RATE_KEY, String(clampRate(rate)));
  },
};
