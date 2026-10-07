"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import { Entry } from "@/components/Entry";
import { SearchBar, type DetectiveMatch } from "@/components/SearchBar";
import { VerseCard } from "@/components/VerseCard";
import { TourOverlay, TOUR_KEY, TOUR_STEPS } from "@/components/TourOverlay";
import { matchVerses } from "@/lib/search";
import { useSemanticSearch } from "@/lib/use-semantic-search";
import { SearchStatus } from "@/components/SearchStatus";
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

  // Reading history, browser-style. Every verse the reader opens is pushed
  // onto the stack; back and forward move the cursor without discarding
  // entries. Tapping a new star from the galaxy truncates anything ahead of
  // the cursor, which is what a reader expects when they navigate away
  // mid-history and pick something else.
  const [history, setHistory] = useState<Verse[]>([]);
  const [cursor, setCursor] = useState(-1);

  const pushToHistory = useCallback((v: Verse) => {
    setHistory((prev) => {
      // Truncate forward entries when the reader picks a new verse from the
      // galaxy. This is the same rule browsers use for a new navigation.
      const truncated = prev.slice(0, cursor + 1);
      // If the same verse is already at the cursor, do not duplicate it.
      if (truncated.length > 0 && truncated[truncated.length - 1].id === v.id) {
        return truncated;
      }
      const next = [...truncated, v];
      setCursor(next.length - 1);
      return next;
    });
    setSelected(v);
  }, [cursor]);

  const goBack = useCallback(() => {
    if (cursor <= 0) return;
    const next = cursor - 1;
    setCursor(next);
    setSelected(history[next]);
  }, [cursor, history]);

  const goForward = useCallback(() => {
    if (cursor >= history.length - 1) return;
    const next = cursor + 1;
    setCursor(next);
    setSelected(history[next]);
  }, [cursor, history]);

  // Clear history when the card is dismissed. Preserving it across close
  // and reopen would be confusing — the reader has left the reading
  // session, so the next star tap should start a fresh stack.
  const closeCard = useCallback(() => {
    setSelected(null);
    setHistory([]);
    setCursor(-1);
  }, []);

  // Mute the auto-reminder rail whenever a verse card is open.
  useEffect(() => {
    reminders.setMuted(!!selected);
  }, [selected, reminders]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (selected) document.documentElement.dataset.cardOpen = "1";
    else delete document.documentElement.dataset.cardOpen;
    return () => { delete document.documentElement.dataset.cardOpen; };
  }, [selected]);

  const [askReflection, setAskReflection] = useState<string | null>(null);
  const [isDaily, setIsDaily] = useState(false);
  const [entryDone, setEntryDone] = useState(false);

  const [pulseIds, setPulseIds] = useState<Set<number> | undefined>(undefined);
  const [pulseScores, setPulseScores] = useState<Map<number, number>>(new Map());
  const [pulseDismissing, setPulseDismissing] = useState(false);
  const pulseDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tourStep, setTourStep] = useState<number>(-1);

  useEffect(() => {
    if (!entryDone || !verses) return;
    try {
      if (!localStorage.getItem(TOUR_KEY)) {
        localStorage.setItem(TOUR_KEY, "1");
        const t = setTimeout(() => setTourStep(0), 700);
        return () => clearTimeout(t);
      }
    } catch { /* localStorage blocked, skip tour */ }
  }, [entryDone, verses]);

  useEffect(() => {
    if (tourStep === 1 && selected !== null) {
      const t = setTimeout(() => {
        closeCard();
        setAskReflection(null);
        setIsDaily(false);
        setTourStep(2);
      }, 1800);
      return () => clearTimeout(t);
    }
  }, [selected, tourStep, closeCard]);

  useEffect(() => {
    if (tourStep === 2 && query) setTourStep(3);
  }, [query, tourStep]);

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

  const themeTriggeredRef = useRef(false);

  useEffect(() => {
    fetch("/data/verses.json", { cache: "force-cache" })
      .then((r) => r.json())
      .then((data: Verse[]) => setVerses(data))
      .catch(() => { /* fail silently, loading indicator handles this */ });
  }, []);

  const literalMatched = useMemo(() => {
    if (!verses || !query) return new Set<number>();
    return matchVerses(verses, query);
  }, [verses, query]);

  const { semantic } = useSemanticSearch(verses, query);

  const matched = useMemo(() => {
    if (!semantic || semantic.ids.length === 0) return literalMatched;
    const out = new Set(literalMatched);
    for (const id of semantic.ids) out.add(id);
    return out;
  }, [literalMatched, semantic]);

  useEffect(() => {
    if (!query || themeTriggeredRef.current || matched.size === 0) return;
    themeTriggeredRef.current = true;
    reminders.trigger("theme-search");
  }, [query, matched, reminders]);

  useEffect(() => {
    if (!verses || !entryDone || selected || tourStep >= 0) return;
    try { if (!localStorage.getItem(TOUR_KEY)) return; } catch {}
    const today = todayKey();
    const last = typeof window !== "undefined" ? localStorage.getItem(DAILY_STORAGE_KEY) : null;
    if (last === today) return;
    const daily = pickDailyVerse(verses);
    if (!daily) return;
    const t = setTimeout(() => {
      pushToHistory(daily);
      setIsDaily(true);
      try { localStorage.setItem(DAILY_STORAGE_KEY, today); } catch {}
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses, entryDone, tourStep]);

  const clearPulse = useCallback(() => {
    if (pulseDismissTimerRef.current) clearTimeout(pulseDismissTimerRef.current);
    setPulseDismissing(true);
    pulseDismissTimerRef.current = setTimeout(() => {
      setPulseIds(undefined);
      setPulseScores(new Map());
      setPulseDismissing(false);
      pulseDismissTimerRef.current = null;
    }, 3200);
  }, []);

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

    if (resolved.length === 1) {
      const only = resolved[0];
      setTimeout(() => {
        setPulseIds(undefined);
        setPulseScores(new Map());
        setAskReflection(only.m.reason);
        pushToHistory(only.verse);
        reminders.trigger("detective-hit");
      }, 3200);
    }
  }, [verses, reminders, pushToHistory]);

  const handleSelectVerse = useCallback((v: Verse) => {
    if (pulseIds?.has(v.id)) {
      reminders.trigger("detective-hit");
    }
    pushToHistory(v);
  }, [pulseIds, reminders, pushToHistory]);

  return (
    <main className="relative h-screen w-screen overflow-hidden cosmos-bg">

      <div className="fixed top-5 left-6 z-20 select-none pointer-events-none">
        <div className="font-serif-fine text-sm tracking-[0.35em] uppercase text-white/80">AYAT</div>
        <div className="font-serif-fine italic text-[10px] text-white/35 mt-0.5">
          signs &amp; verses
        </div>
      </div>

      <div className="fixed top-5 right-6 z-20 flex flex-col gap-1 pointer-events-none">
        <div className="flex items-center gap-2 text-xs font-serif-fine text-white/55">
          <span className="h-1.5 w-1.5 rounded-full bg-[#8aa4ff]" /> Meccan
        </div>
        <div className="flex items-center gap-2 text-xs font-serif-fine text-white/55">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ffb347]" /> Medinan
        </div>
      </div>

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

      <Entry onDone={() => setEntryDone(true)} />

      <SearchStatus active={!!query && !selected} />

      {entryDone && verses && (
        <SearchBar
          onSearch={(q) => { setQuery(q); if (q) clearPulse(); }}
          activeQuery={query}
          matchCount={query ? matched.size : null}
          verses={verses}
          onDetective={handleDetective}
          onClear={clearPulse}
        />
      )}

      <VerseCard
        verse={selected}
        allVerses={verses}
        reflection={askReflection}
        isDaily={isDaily}
        onClose={closeCard}
        onJumpToVerse={(v) => {
          reminders.bumpChain();
          setAskReflection(null);
          setIsDaily(false);
          pushToHistory(v);
        }}
        onBack={goBack}
        onForward={goForward}
        position={cursor + 1}
        total={history.length}
        canGoBack={cursor > 0}
        canGoForward={cursor < history.length - 1}
      />

      {!verses && entryDone && (
        <div className="fixed inset-0 z-10 flex items-center justify-center">
          <p className="font-serif-fine italic text-white/60">Unfolding the cosmos…</p>
        </div>
      )}

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
