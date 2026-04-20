"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Islamic moment reminders.
 *
 * Rules the user asked for (read them before changing anything):
 *   - AT MOST one reminder per session, ever.
 *   - Authentic attribution only. We source-cite every hadith. The first
 *     rule-set the user proposed attributed a saying to the Prophet ﷺ
 *     that I could not verify in that wording; I swapped it for Sahih
 *     Muslim 1893 which IS authentic and covers the same meaning.
 *   - No close button, no interruption, no gamification. Fade in, sit for
 *     six seconds, fade out. Bottom-center. Warm off-white italic.
 */

export type ReminderKind =
  | "share"          // after user shares a verse video / image
  | "read-fully"     // after scrolling a verse card to the bottom
  | "theme-search"   // after using the Theme search
  | "detective-hit"  // after finding a single star via Verse Detective
  | "verse-chain"    // after following 3 "Read next" jumps in one session
  | "night"          // first open between Maghrib & Fajr (rough: 18:00–05:00 local)
  | "first-visit";   // first ever visit on this device

const MESSAGES: Record<ReminderKind, string> = {
  share:
    "\u201CWhoever guides to good is like the one who does it.\u201D \u2014 Prophet Muhammad \uFDFA, Sahih Muslim 1893",
  "read-fully":
    "\u201CWhoever reads one letter from the Book of Allah earns one good deed.\u201D \u2014 Prophet Muhammad \uFDFA, Jami\u02BB at-Tirmidhi 2910",
  "theme-search":
    "You sought. And Allah sees every seeking heart.",
  "detective-hit":
    "You remembered. And Allah loves those who return to His words.",
  "verse-chain":
    "You are traveling through Allah\u2019s words tonight. The angels travel with those who do.",
  night:
    "The night hours are precious. You chose well.",
  "first-visit":
    "Every letter you read here is being written. \u2014 Based on Jami\u02BB at-Tirmidhi 2910",
};

const SESSION_KEY = "ayat:reminderShown";      // sessionStorage — one per tab session
const FIRST_VISIT_KEY = "ayat:firstVisitDone"; // localStorage — first-visit fires once ever
const CHAIN_COUNT_KEY = "ayat:chainCount";     // sessionStorage — track verse-chain jumps

type Ctx = {
  trigger: (kind: ReminderKind) => void;
  bumpChain: () => void; // increments the verse-chain counter and fires reminder at 3
};

const ReminderContext = createContext<Ctx | null>(null);

export function useReminders(): Ctx {
  const ctx = useContext(ReminderContext);
  if (!ctx) {
    // Tolerant fallback — if used outside provider, no-op rather than crash.
    return { trigger: () => {}, bumpChain: () => {} };
  }
  return ctx;
}

export function ReminderProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ReminderKind | null>(null);

  // Helper: returns true if we've already shown one this session.
  const hasShown = () => {
    try {
      return typeof window !== "undefined" && sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      return true; // if storage blocked, suppress rather than spam
    }
  };

  const trigger = useCallback((kind: ReminderKind) => {
    if (hasShown()) return;
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
    setActive(kind);
    // Auto-dismiss after 6s
    setTimeout(() => setActive(null), 6000);
  }, []);

  const bumpChain = useCallback(() => {
    try {
      const cur = parseInt(sessionStorage.getItem(CHAIN_COUNT_KEY) ?? "0", 10);
      const next = cur + 1;
      sessionStorage.setItem(CHAIN_COUNT_KEY, String(next));
      if (next >= 3) trigger("verse-chain");
    } catch {}
  }, [trigger]);

  // ── First-visit + night-time auto-triggers ─────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Delay so the entry experience doesn't compete with the reminder.
    const t = setTimeout(() => {
      if (hasShown()) return;
      const firstDone = localStorage.getItem(FIRST_VISIT_KEY);
      if (!firstDone) {
        localStorage.setItem(FIRST_VISIT_KEY, "1");
        trigger("first-visit");
        return;
      }
      const hour = new Date().getHours();
      // Rough local Maghrib → Fajr window. We deliberately don't ask the
      // user for their location; this is a soft heuristic, not a prayer
      // timetable.
      if (hour >= 19 || hour < 5) {
        trigger("night");
      }
    }, 4500);
    return () => clearTimeout(t);
  }, [trigger]);

  const value = useMemo<Ctx>(() => ({ trigger, bumpChain }), [trigger, bumpChain]);

  return (
    <ReminderContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 max-w-md px-6 pointer-events-none"
            aria-live="polite"
          >
            <p className="font-serif-fine italic text-center text-[13px] md:text-sm leading-relaxed text-[#f2e7d1]">
              {MESSAGES[active]}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </ReminderContext.Provider>
  );
}
