"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import type { Verse } from "@/lib/types";

export function VerseCard({
  verse,
  onClose,
}: {
  verse: Verse | null;
  onClose: () => void;
}) {
  const [context, setContext] = useState<string | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  useEffect(() => {
    if (!verse) return;
    setContext(null);
    setLoadingContext(true);
    const ctrl = new AbortController();
    fetch("/api/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        arabic: verse.arabic,
        translation: verse.translation,
        surahName: verse.surahName,
        ayah: verse.ayah,
      }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d) => setContext(d.context ?? null))
      .catch(() => setContext(null))
      .finally(() => setLoadingContext(false));
    return () => ctrl.abort();
  }, [verse]);

  return (
    <AnimatePresence>
      {verse && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-30 flex items-center justify-center px-4 py-8"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-2xl rounded-2xl border border-white/10 bg-black/75 backdrop-blur-xl p-6 md:p-10 shadow-2xl max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onClose}
              className="absolute right-4 top-4 rounded-full p-2 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Surah tag */}
            <div className="mb-6 flex items-center justify-between">
              <div className="font-serif-fine text-xs uppercase tracking-[0.25em] text-white/50">
                {verse.surahName} · {verse.ayah}
              </div>
              <div
                className="text-[10px] font-serif-fine uppercase tracking-[0.2em]"
                style={{ color: verse.revelationType === "Meccan" ? "#8aa4ff" : "#ffb347" }}
              >
                {verse.revelationType}
              </div>
            </div>

            {/* Arabic */}
            <p className="arabic text-right text-[clamp(1.5rem,3.5vw,2.25rem)] text-white leading-relaxed mb-6">
              {verse.arabic}
            </p>

            {/* Transliteration */}
            <p className="font-serif-fine italic text-white/55 text-sm md:text-base mb-4 leading-relaxed">
              {verse.transliteration}
            </p>

            {/* Translation */}
            <p className="font-serif-fine text-white/90 text-base md:text-lg leading-relaxed mb-6">
              {verse.translation}
            </p>

            {/* Context */}
            <div className="mt-6 border-t border-white/10 pt-5">
              <div className="font-serif-fine text-[10px] uppercase tracking-[0.25em] text-white/40 mb-2">
                Historical context
              </div>
              {loadingContext && (
                <p className="font-serif-fine text-white/50 italic text-sm">
                  Drawing from the tafsir…
                </p>
              )}
              {!loadingContext && context && (
                <p className="font-serif-fine text-white/70 text-sm md:text-base leading-relaxed">
                  {context}
                </p>
              )}
              {!loadingContext && !context && (
                <p className="font-serif-fine text-white/40 text-xs italic">
                  Context unavailable for this verse.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
