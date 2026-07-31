/**
 * Reading preferences — currently just the speech rate.
 *
 * ## Why rate does NOT go through the Rust core
 * The core owns *reading position* (which sentence/word). Speech **rate** is a
 * property of the platform TTS engine, not of the position — the snapshot is
 * byte-for-byte identical at 0.5× and 2×. Pushing rate through the FFI would add
 * a command the core does nothing meaningful with, widen the contract for no
 * reason, and blur the "core owns logic, edges own I/O" line (ADR-0001/0006).
 * So rate lives in the ViewModel + native engines, and this file is the small
 * persistence port for it.
 */

/** App-facing rate is a multiplier: 1.0 = normal, 0.5 = half, 2.0 = double. */
export const RATE_BOUNDS = { min: 0.5, max: 2.0, default: 1.0, step: 0.1 } as const;

/** Clamp and round to one decimal so the UI and persisted value stay tidy. */
export function clampRate(rate: number): number {
  const clamped = Math.min(RATE_BOUNDS.max, Math.max(RATE_BOUNDS.min, rate));
  return Math.round(clamped * 10) / 10;
}

/** Human/screen-reader label, e.g. `1.2×`. */
export function rateLabel(rate: number): string {
  return `${rate.toFixed(1)}×`;
}

/**
 * Persistence port. The RN app backs this with AsyncStorage; tests pass a fake.
 * Kept tiny and injectable so the ViewModel never imports a storage library.
 */
export interface PreferenceStore {
  getRate(): Promise<number | null>;
  setRate(rate: number): Promise<void>;
}

/** A no-op store, used when persistence is not wired (e.g. previews, some tests). */
export const noopPreferenceStore: PreferenceStore = {
  getRate: async () => null,
  setRate: async () => {},
};
