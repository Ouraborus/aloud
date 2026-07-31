/**
 * The real `Announcer`, backed by React Native's `AccessibilityInfo`.
 *
 * `announceForAccessibilityWithOptions` supports a `queue` flag: assertive
 * announcements interrupt, polite ones queue behind whatever the screen reader
 * is currently saying. This is the platform expression of the politeness policy
 * decided (and unit-tested) in `announce.ts`.
 */

import { AccessibilityInfo, Platform } from "react-native";

import type { Announcer, Announcement } from "./announce";

export const platformAnnouncer: Announcer = {
  announce({ message, politeness }: Announcement) {
    if (!message) return;
    // iOS honours the queue option; Android ignores options but still speaks.
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibilityWithOptions(message, {
        queue: politeness === "polite",
      });
    } else {
      AccessibilityInfo.announceForAccessibility(message);
    }
  },
};
