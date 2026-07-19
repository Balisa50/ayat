"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getLoadState, onLoadStateChange, type LoadState } from "@/lib/semantic";

/**
 * Tells the reader the first search is preparing itself.
 *
 * Searching for the first time downloads a ~23 MB model, which on a slow
 * connection is 10-30 seconds during which the galaxy sits perfectly still.
 * With no signal that reads as a broken app, and people tap again -- so this
 * says what is happening, and shows real download progress rather than a
 * spinner that conveys nothing.
 *
 * Only ever appears once. After the model is cached every search resolves
 * immediately and this renders nothing.
 */
export function SearchStatus({ active }: { active: boolean }) {
  const [state, setState] = useState<LoadState>(() => getLoadState());

  useEffect(() => onLoadStateChange(setState), []);

  const show = active && state.phase === "loading";
  const pct = Math.round(Math.min(1, Math.max(0, state.progress)) * 100);
  // Progress events only start once the download does; until then say
  // something true rather than showing a stuck 0%.
  const known = pct > 0 && pct < 100;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-28 sm:bottom-24 z-30 flex justify-center px-6"
        >
          <div className="flex w-full max-w-[19rem] flex-col items-center gap-2.5">
            <p className="font-serif-fine text-[12px] italic text-white/60 text-center">
              {known
                ? `Teaching AYAT to read your question… ${pct}%`
                : "Teaching AYAT to read your question…"}
            </p>

            <div className="h-px w-full overflow-hidden bg-white/10">
              {known ? (
                <motion.div
                  className="h-full bg-white/55"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ ease: "easeOut", duration: 0.3 }}
                />
              ) : (
                // Indeterminate: a travelling sliver, so the line still reads
                // as working while the request is still opening.
                <motion.div
                  className="h-full w-1/3 bg-white/45"
                  animate={{ x: ["-100%", "300%"] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                />
              )}
            </div>

            <p className="font-serif-fine text-[10px] uppercase tracking-[0.18em] text-white/25 text-center">
              once only · then instant
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
