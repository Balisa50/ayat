"use client";

import { useEffect, useRef, useState } from "react";
import { semanticSearch, warmUp, type SemanticResult } from "./semantic";
import type { Verse } from "./types";

/**
 * Runs semantic search alongside the existing literal search.
 *
 * Progressive enhancement, deliberately: the literal path in lib/search.ts
 * still paints instantly and is never blocked or replaced. This resolves a
 * moment later (once MiniLM and the verse vectors are cached, effectively
 * immediately) and the caller unions the two sets, so a query can only ever
 * gain results, never lose them. If anything fails to load, the app behaves
 * exactly as it did before.
 */
export function useSemanticSearch(verses: Verse[] | null, query: string) {
  const [result, setResult] = useState<{ query: string; res: SemanticResult } | null>(null);
  const [pending, setPending] = useState(false);
  const idsRef = useRef<number[] | null>(null);

  // Start fetching the model and weights as soon as the corpus is in memory,
  // so the first real query doesn't pay for the download.
  useEffect(() => {
    if (!verses) return;
    idsRef.current = verses.map((v) => v.id);
    warmUp();
  }, [verses]);

  useEffect(() => {
    const text = query.trim();
    const ids = idsRef.current;
    if (!verses || !ids || !text) {
      setResult(null);
      setPending(false);
      return;
    }

    let cancelled = false;
    setPending(true);

    semanticSearch(text, ids)
      .then((res) => {
        if (cancelled || !res) return;
        setResult({ query: text, res });
      })
      .catch((err) => {
        // Never surface this; the literal results are already on screen.
        console.warn("[semantic] search failed:", err);
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });

    return () => {
      cancelled = true;
    };
  }, [verses, query]);

  // Only hand back a result that belongs to the query being displayed.
  const fresh = result && result.query === query.trim() ? result.res : null;
  return { semantic: fresh, pending };
}
