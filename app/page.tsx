"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import { Entry } from "@/components/Entry";
import { SearchBar, type DetectiveMatch } from "@/components/SearchBar";
import { VerseCard } from "@/components/VerseCard";
import { TourOverlay, TOUR_KEY, TOUR_STEPS } from "@/components/TourOverlay";
import { matchVerses } from "@/lib/search";
import { pickDailyVerse, todayKey } from "@/lib/daily";
import { useReminders } from "@/components/Reminders";
import type { Verse } from "@/lib/types";

const Galaxy = dynamic(() => import("@/components/Galaxy").then((m) => m.Galaxy), {
  ssr: false,
  loading: () => null,
});

const DAILY_STORAGE_KEY = "ayat:lastDaily";

export default function Home() {
  const reminders = useReminders();

  const [verses, setVerses] = useState<Verse[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Verse | null>(null);

  // Mute the auto-reminder rail whenever a verse card is open. The card
  // is the focal moment, the floating italic reminders should not bleed
  // over it. Galaxy stars stay free, only the bottom UI is silenced.
  useEffect(() => {
    reminders.setMuted(!!selected);
  }, [selected, reminders]);

  // Tag the document while a verse card is open. CSS in globals can hide
  // any stray bottom-fixed UI that ever forgets to gate itself. This is
  // a belt-and-braces guarantee on top of the conditional render below.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (selected) document.documentElement.dataset.cardOpen = "1";
    else delete document.documentElement.dataset.cardOpen;
    return () => { delete document.documentElement.dataset.cardOpen; };
  }, [selected]);
  const [askReflection, setAskReflection] = useState<string | null>(null);
  const [isDaily, setIsDaily] = useState(false);
  const [entryDone, setEntryDone] = useState(false);

  // Detective state — stars pulse based on AI match.
  const [pulseIds, setPulseIds] = useState<Set<number> | undefined>(undefined);
  const [pulseScores, setPulseScores] = useState<Map<number, number>>(new Map());
  // True while the "clear search" return animation is in progress
  const [pulseDismissing, setPulseDismissing] = useState(false);
  const pulseDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Guided tour state ────────────────────────────────────────────────────
  // -1 = hidden; 0–(TOUR_STEPS-1) = active step
  const [tourStep, setTourStep] = useState<number>(-1);

  // Start tour for first-time visitors once the galaxy is ready.
  // Mark as seen immediately so closing mid-tour never causes it to repeat.
  useEffect(() => {
    if (!entryDone || !verses) return;
    try {
      if (!localStorage.getItem(TOUR_KEY)) {
        localStorage.setItem(TOUR_KEY, "1");
        const t = setTimeout(() => setTourStep(0), 700);
        return () => clearTimeout(t);
      }
    } catch { /* localStorage blocked — skip tour */ }
  }, [entryDone, verses]);

  // Tour step 1 → 2: user tapped a star — close the card first so step 2 tip is unobstructed
  useEffect(() => {
    if (tourStep === 1 && selected !== null) {
      // Brief delay so the user sees the card open, then it closes and step 2 begins
      const t = setTimeout(() => {
        setSelected(null);
        setAskReflection(null);
        setIsDaily(false);
        setTourStep(2);
      }, 1800);
      return () => clearTimeout(t);
    }
  }, [selected, tourStep]);

  // Tour step 2 → 3: user typed a theme
  useEffect(() => {
    if (tourStep === 2 && query) setTourStep(3);
  }, [query, tourStep]);

  // Tour step 3 → 4: user used Ask detective
  useEffect(() => {
    if (tourStep === 3 && pulseIds && pulseIds.size > 0) setTourStep(4);
  }, [pulseIds, tourStep]);

  const advanceTour = useCallback(() => {
    setTourStep((s) => {
      const next = s + 1;
      if (next >= TOUR_STEPS) {
        try { localStorage.setItem(TOUR_KEY, "1"); } catch {}
        return -1;
      }
      return next;
    });
  }, []);

  const endTour = useCallback(() => {
    try { localStorage.setItem(TOUR_KEY, "1"); } catch {}
    setTourStep(-1);
  }, []);

  // ── Theme search reminder (once per session) ─────────────────────────────
  const themeTriggeredRef = useRef(false);

  useEffect(() => {
    fetch("/data/verses.json", { cache: "force-cache" })
      .then((r) => r.json())
      .then((data: Verse[]) => setVerses(data))
      .catch(() => { /* fail silently — loading indicator handles this */ });
  }, []);

  const matched = useMemo(() => {
    if (!verses || !query) return new Set<number>();
    return matchVerses(verses, query);
  }, [verses, query]);

  useEffect(() => {
    if (!query || themeTriggeredRef.current || matched.size === 0) return;
    themeTriggeredRef.current = true;
    reminders.trigger("theme-search");
  }, [query, matched, reminders]);

  // ── Daily ayah auto-open (once per device per day) ───────────────────────
  useEffect(() => {
    if (!verses || !entryDone || selected || tourStep >= 0) return;
    // Never open the daily verse on a first-time visit — let the tour run first.
    try { if (!localStorage.getItem(TOUR_KEY)) return; } catch {}
    const today = todayKey();
    const last = typeof window !== "undefined" ? localStorage.getItem(DAILY_STORAGE_KEY) : null;
    if (last === today) return;
    const daily = pickDailyVerse(verses);
    if (!daily) return;
    const t = setTimeout(() => {
      setSelected(daily);
      setIsDaily(true);
      try { localStorage.setItem(DAILY_STORAGE_KEY, today); } catch {}
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses, entryDone, tourStep]);

  // ── Clear detective pulse ─────────────────────────────────────────────────
  // Triggers the "fly home" return animation first; clears state after it lands.
  const clearPulse = useCallback(() => {
    if (pulseDismissTimerRef.current) clearTimeout(pulseDismissTimerRef.current);
    setPulseDismissing(true);
    pulseDismissTimerRef.current = setTimeout(() => {
      setPulseIds(undefined);
      setPulseScores(new Map());
      setPulseDismissing(false);
      pulseDismissTimerRef.current = null;
    }, 3200); // matches RETURN_SECS (2.8s) + small buffer
  }, []);

  // ── Detective result handler ──────────────────────────────────────────────
  const handleDetective = useCallback((matches: DetectiveMatch[]) => {
    if (!verses || matches.length === 0) return;

    const resolved: { verse: Verse; m: DetectiveMatch }[] = [];
    for (const m of matches) {
      const v = verses.find((x) => x.surah === m.surah && x.ayah === m.ayah);
      if (v) resolved.push({ verse: v, m });
    }
    if (resolved.length === 0) return;

    resolved.sort((a, b) => b.m.confidence - a.m.confidence);

    const scores = new Map<number, number>();
    resolved.forEach((r) => scores.set(r.verse.id, r.m.confidence));
    setPulseScores(scores);
    setQuery("");
    setPulseIds(new Set(resolved.map((r) => r.verse.id)));

    // Single result → auto-open after shooting-star animation (≈3.2 s)
    if (resolved.length === 1) {
      const only = resolved[0];
      setTimeout(() => {
        setPulseIds(undefined);
        setPulseScores(new Map());
        setAskReflection(only.m.reason);
        setSelected(only.verse);
        reminders.trigger("detective-hit");
      }, 3200);
    }
  }, [verses, reminders]);

  // ── Star click handler ────────────────────────────────────────────────────
  // Keep detective pulse alive when a verse is opened so results persist
  // after the card closes. Only fire the reminder; don't wipe the highlights.
  const handleSelectVerse = useCallback((v: Verse) => {
    if (pulseIds?.has(v.id)) {
      reminders.trigger("detective-hit");
    }
    setSelected(v);
  }, [pulseIds, reminders]);

  return (
    <main className="relative h-screen w-screen overflow-hidden cosmos-bg">

      {/* AYAT wordmark */}
      <div className="fixed top-5 left-6 z-20 select-none pointer-events-none">
        <div className="font-serif-fine text-sm tracking-[0.35em] uppercase text-white/80">AYAT</div>
        <div className="font-serif-fine italic text-[10px] text-white/35 mt-0.5">
          signs &amp; verses
        </div>
      </div>

      {/* Revelation legend */}
      <div className="fixed top-5 right-6 z-20 flex flex-col gap-1 pointer-events-none">
        <div className="flex items-center gap-2 text-xs font-serif-fine text-white/55">
          <span className="h-1.5 w-1.5 rounded-full bg-[#8aa4ff]" /> Meccan
        </div>
        <div className="flex items-center gap-2 text-xs font-serif-fine text-white/55">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ffb347]" /> Medinan
        </div>
      </div>

      {/* Galaxy */}
      {verses && entryDone && (
        <Galaxy
          verses={verses}
          matchedIds={matched}
          pulseIds={pulseIds}
          pulseScores={pulseScores}
          dismissing={pulseDismissing}
          onSelectVerse={handleSelectVerse}
          disabled={!!selected}
        />
      )}

      {/* Entry animation */}
      <Entry onDone={() => setEntryDone(true)} />

      {/*
        Search bar — hidden while a verse card is open. The card already
        owns the user's focus; the bar showing through behind looks broken
        and steals taps near the bottom of the screen.
      */}
      {entryDone && verses && !selected && (
        <SearchBar
          onSearch={(q) => { setQuery(q); if (q) clearPulse(); }}
          activeQuery={query}
          matchCount={query ? matched.size : null}
          verses={verses}
          onDetective={handleDetective}
          onClear={clearPulse}
        />
      )}

      {/* Verse card */}
      <VerseCard
        verse={selected}
        allVerses={verses}
        reflection={askReflection}
        isDaily={isDaily}
        onClose={() => {
          setSelected(null);
          setAskReflection(null);
          setIsDaily(false);
        }}
        onJumpToVerse={(v) => {
          reminders.bumpChain();
          setAskReflection(null);
          setIsDaily(false);
          setSelected(v);
        }}
      />

      {/* Loading state */}
      {!verses && entryDone && (
        <div className="fixed inset-0 z-10 flex items-center justify-center">
          <p className="font-serif-fine italic text-white/60">Unfolding the cosmos…</p>
        </div>
      )}

      {/* Guided tour */}
      <AnimatePresence mode="wait">
        {tourStep >= 0 && (
          <TourOverlay
            key={`tour-${tourStep}`}
            step={tourStep}
            onNext={advanceTour}
            onEnd={endTour}
          />
        )}
      </AnimatePresence>

    </main>
  );
}
