"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Entry } from "@/components/Entry";
import { SearchBar } from "@/components/SearchBar";
import { VerseCard } from "@/components/VerseCard";
import { matchVerses } from "@/lib/search";
import type { Verse } from "@/lib/types";

const Galaxy = dynamic(() => import("@/components/Galaxy").then((m) => m.Galaxy), {
  ssr: false,
  loading: () => null,
});

export default function Home() {
  const [verses, setVerses] = useState<Verse[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Verse | null>(null);
  const [entryDone, setEntryDone] = useState(false);

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

  return (
    <main className="relative h-screen w-screen overflow-hidden cosmos-bg">
      {/* Brand mark */}
      <div className="fixed top-5 left-6 z-20 select-none pointer-events-none">
        <div className="font-serif-fine text-sm tracking-[0.35em] uppercase text-white/80">
          AYAT
        </div>
        <div className="font-serif-fine italic text-[10px] text-white/35 mt-0.5">
          signs &amp; verses
        </div>
      </div>

      {/* Legend */}
      <div className="fixed top-5 right-6 z-20 flex flex-col gap-1 pointer-events-none">
        <div className="flex items-center gap-2 text-xs font-serif-fine text-white/55">
          <span className="h-1.5 w-1.5 rounded-full bg-[#8aa4ff]" />
          Meccan
        </div>
        <div className="flex items-center gap-2 text-xs font-serif-fine text-white/55">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ffb347]" />
          Medinan
        </div>
      </div>

      {/* Galaxy */}
      {verses && entryDone && (
        <Galaxy verses={verses} matchedIds={matched} onSelectVerse={setSelected} />
      )}

      {/* Entry experience */}
      <Entry onDone={() => setEntryDone(true)} />

      {/* Search */}
      {entryDone && verses && (
        <SearchBar
          onSearch={setQuery}
          activeQuery={query}
          matchCount={query ? matched.size : null}
        />
      )}

      {/* Verse card */}
      <VerseCard verse={selected} onClose={() => setSelected(null)} />

      {/* Loading state */}
      {!verses && entryDone && (
        <div className="fixed inset-0 z-10 flex items-center justify-center">
          <p className="font-serif-fine italic text-white/60">
            Unfolding the cosmos…
          </p>
        </div>
      )}
    </main>
  );
}
