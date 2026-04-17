"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";

interface SearchBarProps {
  onSearch: (q: string) => void;
  matchCount: number | null;
  activeQuery: string;
}

const SUGGESTIONS = [
  "patience",
  "mercy",
  "prayer",
  "light",
  "knowledge",
  "charity",
  "gratitude",
  "forgiveness",
];

export function SearchBar({ onSearch, matchCount, activeQuery }: SearchBarProps) {
  const [q, setQ] = useState("");

  const submit = (value: string) => {
    const trimmed = value.trim();
    setQ(trimmed);
    onSearch(trimmed);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 pointer-events-none">
      {/* Counter pill */}
      {activeQuery && matchCount !== null && (
        <div className="mb-6 flex justify-center pointer-events-auto">
          <div className="rounded-full border border-white/15 bg-black/60 backdrop-blur-md px-5 py-2 text-center">
            <p className="font-serif-fine text-sm md:text-base text-white/90">
              <span className="text-white font-medium tabular-nums">{matchCount}</span> verses speak of{" "}
              <span className="italic text-white">{activeQuery}</span>
            </p>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-xl px-6 pb-8 pointer-events-auto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(q);
          }}
          className="relative"
        >
          <div className="flex items-center gap-3 border-b border-white/30 focus-within:border-white/80 transition-colors py-3">
            <Search className="h-4 w-4 text-white/50" aria-hidden="true" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onBlur={() => submit(q)}
              placeholder="Search a theme — patience, mercy, prayer…"
              className="w-full bg-transparent font-serif-fine text-base md:text-lg text-white placeholder:text-white/30 outline-none"
              aria-label="Search by theme"
            />
            {q && (
              <button
                type="button"
                onClick={() => submit("")}
                className="p-1 text-white/40 hover:text-white/80 transition-colors"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </form>

        {/* Suggestions */}
        {!activeQuery && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="rounded-full border border-white/10 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.08] px-3 py-1 text-xs font-serif-fine text-white/60 hover:text-white transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
