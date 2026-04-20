/**
 * Daily ayah selector.
 *
 * Everyone on a given calendar day gets the same verse. The choice is
 * deterministic — seeded by YYYY-MM-DD — so the app feels like the verse
 * was waiting for you, not rolled at random.
 *
 * We bias away from the handful of verses everyone already quotes (the
 * Throne verse, Al-Baqarah:286, Ash-Sharh) because a daily moment should
 * feel like discovery, not a repeat of the same instagram carousel.
 */

import type { Verse } from "./types";

// Overquoted references — skip these unless the seed has no other option.
const OVERQUOTED: ReadonlySet<string> = new Set([
  "2:255", // Ayat al-Kursi
  "2:286", // last verse of Al-Baqarah
  "1:1", "1:2", "1:3", "1:4", "1:5", "1:6", "1:7", // Al-Fatiha
  "94:5", "94:6", // Ash-Sharh "with hardship comes ease"
  "3:8",
  "65:3",
]);

/** FNV-1a hash of a string → 32-bit unsigned int. Tiny, deterministic. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Pick today's verse. Deterministic per day. Skips over-quoted refs. */
export function pickDailyVerse(verses: Verse[], d: Date = new Date()): Verse | null {
  if (!verses.length) return null;
  const seed = fnv1a(todayKey(d));

  // Try up to 5 offsets in case the first pick is over-quoted.
  for (let i = 0; i < 5; i++) {
    const idx = (seed + i * 104729) % verses.length; // 104729 is prime
    const v = verses[idx];
    const ref = `${v.surah}:${v.ayah}`;
    if (!OVERQUOTED.has(ref)) return v;
  }
  return verses[seed % verses.length];
}
