"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { Entry } from "@/components/Entry";
import { SearchBar, type DetectiveMatch } from "@/components/SearchBar";
import { VerseCard } from "@/components/VerseCard";
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
  const [askReflection, setAskReflection] = useState<string | null>(null);
  const [isDaily, setIsDaily] = useState(false);
  const [entryDone, setEntryDone] = useState(false);

  // Detective state — 1-3 stars pulse; if single, auto-open after a beat.
  const [pulseIds, setPulseIds] = useState<Set<number> | undefined>(undefined);

  // Theme search reminder fires once per session on first non-empty query.
  const themeTriggeredRef = useRef(false);

  useEffect(() => {
    fetch("/data/verses.json", { cache: "force-cache" })
      .then((r) => r.json())
      .then((data: Verse[]) => setVerses(data))
      .catch((e) => console.error("Failed to load verses:", e));
  }, []);

  const matched = useMemo(() => {
    if (!verses || !query) return new Set<number>();
    return matchVerses(verses, query);
  }, [verses, query]);

  // Theme reminder — fire once when a real query lands a result.
  useEffect(() => {
    if (!query) return;
    if (themeTriggeredRef.current) return;
    if (matched.size === 0) return;
    themeTriggeredRef.current = true;
    reminders.trigger("theme-search");
  }, [query, matched, reminders]);

  // Daily ayah auto-open (once per device per day)
  useEffect(() => {
    if (!verses || !entryDone || selected) return;
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
  }, [verses, entryDone]);

  // ── Detective result handler ─────────────────────────────
  // 1-3 stars glow. Single high-confidence → auto-open the card.
  const handleDetective = (matches: DetectiveMatch[]) => {
    if (!verses || matches.length === 0) return;
    const resolved: { verse: Verse; m: DetectiveMatch }[] = [];
    for (const m of matches) {
      const v = verses.find((x) => x.surah === m.surah && x.ayah === m.ayah);
      if (v) resolved.push({ verse: v, m });
    }
    if (resolved.length === 0) return;

    // Clear theme search while detective runs.
    setQuery("");
    setPulseIds(new Set(resolved.map((r) => r.verse.id)));

    // Single result → let the full 2-pass shooting-star animation complete
    // (2 × 1.4 s = 2.8 s), then open the card. 3200 ms gives a comfortable margin.
    if (resolved.length === 1) {
      const only = resolved[0];
      setTimeout(() => {
        setAskReflection(only.m.reason);
        setSelected(only.verse);
        setPulseIds(undefined);
        reminders.trigger("detective-hit");
      }, 3200);
    } else {
      // Multi-result: let the user pick. Clear pulses when they do.
      // No auto-open. The reminder fires if they click one of the pulsed stars.
    }
  };

  // ── Clicking a pulsed star clears pulse & opens it ──────
  const handleSelectVerse = (v: Verse) => {
    if (pulseIds?.has(v.id)) {
      setPulseIds(undefined);
      reminders.trigger("detective-hit");
    }
    setSelected(v);
  };

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
          onSelectVerse={handleSelectVerse}
        />
      )}

      <Entry onDone={() => setEntryDone(true)} />

      {entryDone && verses && (
        <SearchBar
          onSearch={setQuery}
          activeQuery={query}
          matchCount={query ? matched.size : null}
          verses={verses}
          onDetective={handleDetective}
        />
      )}

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
          // Following a "Read next" = verse chain; bump counter.
          reminders.bumpChain();
          setAskReflection(null);
          setIsDaily(false);
          setSelected(v);
        }}
      />

      {!verses && entryDone && (
        <div className="fixed inset-0 z-10 flex items-center justify-center">
          <p className="font-serif-fine italic text-white/60">Unfolding the cosmos…</p>
        </div>
      )}
    </main>
  );
}
