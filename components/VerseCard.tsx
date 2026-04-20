"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Volume2, ArrowRight, Sparkles, StopCircle, Repeat } from "lucide-react";
import type { Verse } from "@/lib/types";
import { useReminders } from "./Reminders";
import { FloatingReciteButton } from "./FloatingReciteButton";

// ─── Five-section parser ────────────────────────────────────────────────
type Section = { key: string; label: string; body: string };
const SECTION_MAP: Record<string, string> = {
  SCENE: "The moment",
  MEANING: "What it's saying",
  HITS: "Why it lands",
  REFLECT: "Reflect",
  NEXT: "Read next",
};
function parseContext(raw: string): Section[] {
  const keys = Object.keys(SECTION_MAP);
  const re = new RegExp(`^(${keys.join("|")})\\s*:\\s*(.*)$`, "i");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      if (current) out.push(current);
      current = { key: m[1].toUpperCase(), label: SECTION_MAP[m[1].toUpperCase()], body: m[2] };
    } else if (current) current.body += " " + line;
  }
  if (current) out.push(current);
  if (out.length === 0) return [{ key: "FALLBACK", label: "Context", body: raw }];
  return keys.map((k) => out.find((s) => s.key === k)).filter((s): s is Section => Boolean(s));
}
function parseNextRef(body: string): { surah: number; ayah: number; reason: string } | null {
  const m = body.match(/(\d+)\s*:\s*(\d+)\s*[·—\-–:]*\s*(.*)$/);
  if (!m) return null;
  return { surah: parseInt(m[1], 10), ayah: parseInt(m[2], 10), reason: m[3].trim() };
}

// ─── Reciter catalog ────────────────────────────────────────────────────
const RECITERS = [
  { id: "7",        label: "Mishary Al Afasy" },
  { id: "3",        label: "Abdul Rahman Al Sudais" },
  { id: "10",       label: "Saud Ash Shuraym" },
  { id: "6",        label: "Mahmoud Khalil Al Husary" },
  { id: "4",        label: "Abu Bakr Al Shatri" },
  { id: "2",        label: "Abdul Basit Abdul Samad" },
  { id: "5",        label: "Hani Ar Rifai" },
  { id: "8",        label: "Mohamed Siddiq Al Minshawi" },
  { id: "ghamdi",   label: "Saad Al Ghamdi" },
  { id: "muaiqly",  label: "Maher Al Muaiqly" },
  { id: "ayyoub",   label: "Muhammad Ayyoub" },
  { id: "dossari",  label: "Yasser Al Dossari" },
  { id: "qatami",   label: "Nasser Al Qatami" },
  { id: "jibreel",  label: "Muhammad Jibreel" },
  { id: "juhany",   label: "Abdullah Al Juhany" },
  { id: "hudhaify", label: "Ali Hudhaify" },
  { id: "basfar",   label: "Abdullah Basfar" },
  { id: "budair",   label: "Salah Al Budair" },
] as const;
const RECITER_STORAGE_KEY = "ayat:reciter";

// ─── Segment helpers ─────────────────────────────────────────────────────
type Segment = number[];

function activeWordAt(segments: Segment[], timeMs: number): number {
  for (const seg of segments) {
    if (seg.length >= 4) {
      const [, wEnd, s, e] = seg;
      if (timeMs >= s && timeMs < e) return wEnd - 1;
    } else if (seg.length === 3) {
      const [w, s, e] = seg;
      if (timeMs >= s && timeMs < e) return w - 1;
    }
  }
  return -1;
}

function ensureArabicFontsLoaded(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const id = "ayat-arabic-fonts";
  if (!document.getElementById(id)) {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Scheherazade+New:wght@400;700&display=swap";
    document.head.appendChild(link);
  }
  if (document.fonts?.ready) return document.fonts.ready.then(() => undefined);
  return new Promise((r) => setTimeout(r, 300));
}

export function VerseCard({
  verse,
  allVerses,
  reflection,
  isDaily,
  onClose,
  onJumpToVerse,
}: {
  verse: Verse | null;
  allVerses: Verse[] | null;
  reflection?: string | null;
  isDaily?: boolean;
  onClose: () => void;
  onJumpToVerse: (v: Verse) => void;
}) {
  const reminders = useReminders();

  const [context, setContext] = useState<string | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  const [reciterId, setReciterId] = useState<string>("7");
  const [reciterOpen, setReciterOpen] = useState(false);
  // Measured position of the trigger button — used to portal-render the dropdown
  // in exactly the right spot without any overflow/clipping from parent containers.
  const [dropPos, setDropPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const reciterBtnRef = useRef<HTMLButtonElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentWord, setCurrentWord] = useState(-1);

  // Refs that live outside React render cycle
  const audioRef        = useRef<HTMLAudioElement | null>(null);
  const rafRef          = useRef<number | null>(null);
  const autoRef         = useRef(false);
  const repeatRef       = useRef(false);

  // UI state for repeat toggle
  const [repeatActive, setRepeatActive] = useState(false);

  // ── Auto-continue state ───────────────────────────────────────────────
  const [chainVerse, setChainVerse] = useState<Verse | null>(null);
  const [autoActive,  setAutoActive]  = useState(false);
  const [autoStatus,  setAutoStatus]  = useState<string | null>(null);

  // Text visibility — only the text content div fades; card shell is static
  const [textVisible, setTextVisible] = useState(true);

  // ── Pre-fetch refs — all written/read inside the RAF + onended callback ──
  // These are NEVER setState — that prevents the fetch effect from re-firing
  const nextAudioRef     = useRef<HTMLAudioElement | null>(null);
  const nextAudioUrlRef  = useRef<string | null>(null);
  const nextSegmentsRef  = useRef<Segment[]>([]);
  const nextVerseRef     = useRef<Verse | null>(null);
  const prefetchDoneRef  = useRef(false);
  // Tracks whether we've already silently started the pre-fetched audio (warm-start)
  const nextAudioWarmRef = useRef(false);

  // When true, the [currentVerse, reciterId] fetch effect must skip its reset.
  // Set to true immediately before we swap chainVerse during an auto-advance.
  const skipAudioResetRef = useRef(false);

  // Stable snapshots for use inside callbacks (avoid stale closures)
  const reciterIdRef  = useRef(reciterId);
  useEffect(() => { reciterIdRef.current = reciterId; }, [reciterId]);
  const allVersesRef  = useRef(allVerses);
  useEffect(() => { allVersesRef.current = allVerses; }, [allVerses]);
  const chainVerseRef = useRef<Verse | null>(null);
  useEffect(() => { chainVerseRef.current = chainVerse; }, [chainVerse]);
  const verseRef      = useRef<Verse | null>(verse);
  useEffect(() => { verseRef.current = verse; }, [verse]);
  // Stable ref for the ended-callback so audio elements can always call the latest version
  const onEndedRef = useRef<() => void>(() => {});

  const currentVerse = (chainVerse ?? verse) as Verse;

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const readFullyTriggeredRef = useRef(false);

  // ── Reset everything when the top-level verse prop changes ────────────────
  useEffect(() => {
    setChainVerse(null);
    setAutoActive(false);
    setAutoStatus(null);
    autoRef.current = false;
    repeatRef.current = false;
    setRepeatActive(false);
    setReciterOpen(false);
    setTextVisible(true);
    prefetchDoneRef.current = false;
    nextAudioWarmRef.current = false;
    skipAudioResetRef.current = false;
    if (nextAudioRef.current) {
      nextAudioRef.current.pause();
      nextAudioRef.current.src = "";
      nextAudioRef.current = null;
    }
    nextAudioUrlRef.current  = null;
    nextSegmentsRef.current  = [];
    nextVerseRef.current     = null;
  }, [verse]);

  useEffect(() => { ensureArabicFontsLoaded(); }, []);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(RECITER_STORAGE_KEY);
      if (saved && RECITERS.find((r) => r.id === saved)) setReciterId(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(RECITER_STORAGE_KEY, reciterId); } catch {}
  }, [reciterId]);

  // ── AI analysis (skipped during auto-play) ───────────────────────────────
  useEffect(() => {
    if (!currentVerse) return;
    if (autoActive) { setContext(null); setLoadingContext(false); return; }
    setContext(null);
    setLoadingContext(true);
    readFullyTriggeredRef.current = false;
    const ctrl = new AbortController();
    fetch("/api/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        arabic:      currentVerse.arabic,
        translation: currentVerse.translation,
        surahName:   currentVerse.surahName,
        surah:       currentVerse.surah,
        ayah:        currentVerse.ayah,
      }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d) => setContext(d.context ?? null))
      .catch(() => setContext(null))
      .finally(() => setLoadingContext(false));
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVerse, autoActive]);

  // ── Audio fetch for current verse ────────────────────────────────────────
  // Guard: if skipAudioResetRef is true we already have the audio ready from
  // a pre-fetch; skip the reset and let the auto-advance code handle playback.
  useEffect(() => {
    if (!currentVerse) return;

    if (skipAudioResetRef.current) {
      skipAudioResetRef.current = false;
      return; // pre-fetched audio is already in audioRef — do not clobber it
    }

    // Pause and release whatever was playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    setAudioUrl(null);
    setSegments([]);
    setCurrentWord(-1);
    setPlaying(false);

    const ctrl = new AbortController();
    const q = new URLSearchParams({
      reciter: reciterId,
      ayah:    `${currentVerse.surah}:${currentVerse.ayah}`,
    });
    fetch(`/api/recitation?${q.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d?.audioUrl)              setAudioUrl(d.audioUrl);
        if (Array.isArray(d?.segments)) setSegments(d.segments);
      })
      .catch(() => {});
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVerse, reciterId]);

  // ── Pre-fetch next verse audio silently ──────────────────────────────────
  // Called from the RAF loop when the current verse reaches 80% progress.
  const triggerPrefetch = useCallback(() => {
    const cv = chainVerseRef.current ?? verseRef.current;
    const av = allVersesRef.current;
    if (!cv || !av) return;

    const nextV = av.find((v) => v.surah === cv.surah && v.ayah === cv.ayah + 1);
    if (!nextV) return;
    nextVerseRef.current = nextV;

    const q = new URLSearchParams({
      reciter: reciterIdRef.current,
      ayah:    `${nextV.surah}:${nextV.ayah}`,
    });
    fetch(`/api/recitation?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d?.audioUrl) return;
        const a = new Audio();
        a.crossOrigin = "anonymous";
        a.src = d.audioUrl;
        a.volume = 0; // silent until needed
        a.preload = "auto";
        a.load();
        nextAudioRef.current    = a;
        nextAudioUrlRef.current = d.audioUrl;
        nextSegmentsRef.current = Array.isArray(d.segments) ? d.segments : [];
      })
      .catch(() => {});
  }, []);

  // ── onended: the ONLY place where auto-advance happens ──────────────────
  // The verse plays to FULL COMPLETION before we do anything.
  // • If next audio was pre-fetched: instant zero-gap swap.
  // • If not: brief visual gap, then fresh fetch starts playback when URL arrives.
  //
  // Defined as a ref-backed function so any audio element can call the latest
  // version without stale-closure issues.
  useEffect(() => {
    onEndedRef.current = () => {
      setCurrentWord(-1);

      // ── Repeat: replay this exact verse, ignore auto-advance ───────────
      if (repeatRef.current) {
        const a = audioRef.current;
        if (a) {
          a.currentTime = 0;
          a.play()
            .then(() => setPlaying(true))
            .catch(() => {
              setTimeout(() =>
                a.play().then(() => setPlaying(true)).catch(() => setPlaying(false)),
              80);
            });
        }
        return;
      }

      if (!autoRef.current) {
        setPlaying(false);
        return;
      }

      const nextV     = nextVerseRef.current;
      const nextAudio = nextAudioRef.current;

      if (nextV && nextAudio) {
        // ── Zero-gap advance (pre-fetch was ready) ──────────────────
        const wasWarm = nextAudioWarmRef.current; // silently started already?
        nextAudio.volume  = 1;                    // unmute (was 0 if warm)
        nextAudio.onended = () => onEndedRef.current();
        nextAudio.onerror = () => setPlaying(false);

        // Block the fetch effect — we're bringing our own audio
        skipAudioResetRef.current = true;
        audioRef.current = nextAudio;

        // Update chainVerseRef IMMEDIATELY so triggerPrefetch (RAF loop)
        // always reads the current verse even before React effects commit.
        chainVerseRef.current = nextV;

        // Visual: brief fade so the text label updates aren't jarring
        setTextVisible(false);

        // Batch all state changes into one render
        setChainVerse(nextV);
        setAudioUrl(nextAudioUrlRef.current);
        setSegments(nextSegmentsRef.current.length > 0 ? [...nextSegmentsRef.current] : []);
        setAutoStatus(`${nextV.surahName} · ${nextV.ayah}`);

        // Clear pre-fetch slots
        nextAudioRef.current    = null;
        nextAudioUrlRef.current = null;
        nextSegmentsRef.current = [];
        nextVerseRef.current    = null;
        prefetchDoneRef.current = false;
        nextAudioWarmRef.current = false;

        if (wasWarm) {
          // Pipeline is hot, but we must seek back to 0 — the silent warm-play
          // already consumed up to 300ms, which would cut the opening syllable.
          // pause() + currentTime=0 is synchronous; play() fires on a warm pipeline
          // so startup latency is near-zero.
          nextAudio.pause();
          nextAudio.currentTime = 0;
          nextAudio.play()
            .then(() => setPlaying(true))
            .catch(() => {
              setTimeout(() => nextAudio.play().then(() => setPlaying(true)).catch(() => setPlaying(false)), 20);
            });
        } else {
          // Warm-start missed its window; call play() normally
          nextAudio.play()
            .then(() => setPlaying(true))
            .catch(() => {
              setTimeout(() => nextAudio.play().then(() => setPlaying(true)).catch(() => setPlaying(false)), 80);
            });
        }

        // Text fades back in quickly — audio is already running
        setTimeout(() => setTextVisible(true), 80);
      } else {
        // ── Fallback (pre-fetch not ready) ──────────────────────────
        setPlaying(false);
        audioRef.current = null; // signal fallbackAutoStart effect

        const cv = chainVerseRef.current ?? verseRef.current;
        if (!cv || !allVersesRef.current) {
          autoRef.current = false; setAutoActive(false); return;
        }
        const nextVFallback = allVersesRef.current.find(
          (v) => v.surah === cv.surah && v.ayah === cv.ayah + 1,
        );
        if (!nextVFallback) {
          autoRef.current = false;
          setAutoActive(false);
          setAutoStatus("End of Surah");
          setTimeout(() => setAutoStatus(null), 3000);
          return;
        }
        // Trigger audio fetch via [currentVerse, reciterId] effect
        setTextVisible(false);
        setChainVerse(nextVFallback);
        setAutoStatus(`${nextVFallback.surahName} · ${nextVFallback.ayah}`);
        prefetchDoneRef.current = false;
        setTimeout(() => setTextVisible(true), 80);
      }
    };
  }); // runs every render — always current, never stale

  // ── Fallback auto-start: fires when a fresh audioUrl lands after a gap advance
  // Conditions: auto is active, audio URL just loaded, not already playing,
  //             and there's no active audio element (we set audioRef.current = null in fallback)
  useEffect(() => {
    if (!autoRef.current || !audioUrl || playing || audioRef.current) return;
    const a = new Audio();
    a.crossOrigin = "anonymous";
    a.src = audioUrl;
    a.onended = () => onEndedRef.current();
    a.onerror = () => setPlaying(false);
    audioRef.current = a;
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  // ── RAF: word highlighting + pre-fetch trigger at 80% ────────────────────
  useEffect(() => {
    if (!playing || !audioRef.current) return;
    const a = audioRef.current;
    let lastIdx = -2;

    const tick = () => {
      const tMs = a.currentTime * 1000;

      // Word highlighting
      if (segments.length > 0) {
        const idx = activeWordAt(segments, tMs);
        if (idx !== lastIdx) { lastIdx = idx; setCurrentWord(idx); }
      }

      // Auto mode: pre-fetch early + warm-start to eliminate the inter-verse gap
      if (autoRef.current && a.duration > 0 && !isNaN(a.duration)) {
        const progress  = a.currentTime / a.duration;
        const remaining = a.duration - a.currentTime;

        // Pre-fetch at 20% so the audio file has plenty of time to download
        if (progress >= 0.20 && !prefetchDoneRef.current) {
          prefetchDoneRef.current = true;
          triggerPrefetch();
        }

        // Warm-start: silently begin the pre-fetched audio 0.1 s before end so
        // the browser audio pipeline is hot when onended fires.
        // We seek back to 0 in onEndedRef so no audio is lost.
        if (!nextAudioWarmRef.current && remaining < 0.10 && nextAudioRef.current) {
          nextAudioWarmRef.current = true;
          const na = nextAudioRef.current;
          na.volume = 0;
          na.play().catch(() => {});
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, segments]);

  // Cleanup audio when the top-level verse prop changes
  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [verse]);

  const words = useMemo(
    () => currentVerse?.arabic.split(/\s+/).filter(Boolean) ?? [],
    [currentVerse],
  );

  // ── Manual play / pause ──────────────────────────────────────────────────
  const toggleAudio = useCallback(() => {
    if (!currentVerse || !audioUrl) return;
    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }
    const a = audioRef.current ?? new Audio();
    a.crossOrigin = "anonymous";
    if (!audioRef.current) a.src = audioUrl;
    a.onended = () => onEndedRef.current();
    a.onerror = () => setPlaying(false);
    audioRef.current = a;
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [currentVerse, audioUrl, playing]);

  const handleStartAutoPlay = useCallback(() => {
    autoRef.current = true;
    setAutoActive(true);
    setAutoStatus("Continuing…");
    if (!playing) toggleAudio();
    // Kick off pre-fetch immediately — don't wait for the 20% RAF threshold
    if (!prefetchDoneRef.current) {
      prefetchDoneRef.current = true;
      triggerPrefetch();
    }
  }, [playing, toggleAudio, triggerPrefetch]);

  const handleStopAutoPlay = useCallback(() => {
    autoRef.current = false;
    setAutoActive(false);
    setAutoStatus(null);
    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
    }
    if (nextAudioRef.current) {
      nextAudioRef.current.pause();
      nextAudioRef.current.src = "";
      nextAudioRef.current = null;
    }
    prefetchDoneRef.current = false;
  }, [playing]);

  const onBodyScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el || readFullyTriggeredRef.current) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
      readFullyTriggeredRef.current = true;
      reminders.trigger("read-fully");
    }
  }, [reminders]);

  const sections     = useMemo(() => (context ? parseContext(context) : []), [context]);
  const nextSection  = sections.find((s) => s.key === "NEXT");
  const nextRef      = nextSection ? parseNextRef(nextSection.body) : null;
  const nextVerse    = nextRef && allVerses
    ? allVerses.find((v) => v.surah === nextRef.surah && v.ayah === nextRef.ayah)
    : null;

  return (
    <>
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
            ref={bodyRef}
            onScroll={onBodyScroll}
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

            {isDaily && (
              <div className="mb-5 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 w-fit">
                <Sparkles className="h-3 w-3 text-white/60" />
                <span className="font-serif-fine text-[10px] uppercase tracking-[0.22em] text-white/70">
                  Something found you today
                </span>
              </div>
            )}

            {/* Header — surah name only */}
            <div className="mb-6 flex items-center justify-between">
              <div className="font-serif-fine text-xs uppercase tracking-[0.25em] text-white/50">
                {currentVerse.surahName} · {currentVerse.ayah}
              </div>
            </div>

            {/* ── Verse text — only this section fades during transitions ── */}
            <div style={{ opacity: textVisible ? 1 : 0, transition: "opacity 80ms ease" }}>
              <div className="min-h-[7rem] mb-6">
                <p dir="rtl" className="arabic text-right text-[clamp(1.5rem,3.5vw,2.25rem)] text-white leading-relaxed">
                  {words.map((w, i) => (
                    <span
                      key={i}
                      className={
                        i === currentWord
                          ? "text-[#ffd700] [text-shadow:0_0_18px_rgba(255,215,0,0.85),0_0_4px_rgba(255,215,0,0.95)] transition-[color,text-shadow] duration-150"
                          : "text-white transition-[color,text-shadow] duration-300"
                      }
                    >
                      {w}{i < words.length - 1 ? " " : ""}
                    </span>
                  ))}
                </p>
              </div>
              <div className="min-h-[3rem] mb-4">
                <p className="font-serif-fine italic text-white/55 text-sm md:text-base leading-relaxed">
                  {currentVerse.transliteration}
                </p>
              </div>
              <div className="min-h-[4.5rem] mb-5">
                <p className="font-serif-fine text-white/90 text-base md:text-lg leading-relaxed">
                  {currentVerse.translation}
                </p>
              </div>

              {/* Reciter + Repeat + Continue — all in one flex-wrap row.
                  They sit together and naturally flow onto a second line when
                  the reciter name is long, never forcing a fixed width. */}
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {/* Reciter pill — width = text width, dropdown via portal so it
                    is never clipped by the card's scroll container */}
                <button
                  ref={reciterBtnRef}
                  onClick={() => {
                    const btn = reciterBtnRef.current;
                    if (btn) {
                      const r = btn.getBoundingClientRect();
                      const above = r.top > window.innerHeight / 2;
                      setDropPos({ x: r.left, y: above ? r.top : r.bottom, above });
                    }
                    setReciterOpen((o) => !o);
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] font-serif-fine text-white/55 hover:text-white hover:border-white/40 transition-colors outline-none cursor-pointer whitespace-nowrap"
                  aria-label="Select reciter"
                  aria-expanded={reciterOpen}
                >
                  {RECITERS.find((r) => r.id === reciterId)?.label ?? "Reciter"}
                  <svg width="8" height="5" viewBox="0 0 8 5" fill="none" className={`transition-transform duration-150 ${reciterOpen ? "rotate-180" : ""}`} aria-hidden="true">
                    <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>

                {/* Portal dropdown — renders on <body> so nothing clips it */}
                {reciterOpen && dropPos && typeof window !== "undefined" && createPortal(
                  <>
                    <div className="fixed inset-0 z-[190]" onClick={() => setReciterOpen(false)} />
                    <div
                      className="fixed z-[191] rounded-xl border border-white/10 bg-[#06070f] shadow-2xl py-1 overflow-y-auto"
                      style={{
                        left: dropPos.x,
                        maxHeight: "min(260px, 48vh)",
                        backdropFilter: "blur(24px)",
                        WebkitBackdropFilter: "blur(24px)",
                        minWidth: "max-content",
                        ...(dropPos.above
                          ? { bottom: window.innerHeight - dropPos.y + 6 }
                          : { top: dropPos.y + 6 }),
                      }}
                    >
                      {RECITERS.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => { setReciterId(r.id); setReciterOpen(false); }}
                          className={`w-full text-left px-4 py-2.5 text-[11px] font-serif-fine whitespace-nowrap transition-colors ${
                            r.id === reciterId
                              ? "text-[#ffd700] bg-white/5"
                              : "text-white/60 hover:text-white hover:bg-white/[0.06]"
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </>,
                  document.body
                )}
                {/* Repeat toggle */}
                <button
                  onClick={() => {
                    const next = !repeatRef.current;
                    repeatRef.current = next;
                    setRepeatActive(next);
                  }}
                  disabled={!audioUrl}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-serif-fine uppercase tracking-[0.2em] transition-colors disabled:opacity-40 ${
                    repeatActive
                      ? "border-[#ffd700]/50 text-[#ffd700]"
                      : "border-white/15 text-white/45 hover:text-white/80 hover:border-white/35"
                  }`}
                  aria-label={repeatActive ? "Repeat on — tap to turn off" : "Repeat off — tap to loop this verse"}
                  title={repeatActive ? "Repeating this verse" : "Repeat this verse"}
                >
                  <Repeat className="h-3 w-3" />
                  {repeatActive ? "Looping" : "Repeat"}
                </button>
                {/* Continue Surah — alongside other controls, not buried at bottom */}
                {!autoActive ? (
                  <button
                    onClick={handleStartAutoPlay}
                    disabled={!audioUrl}
                    className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/30 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] font-serif-fine text-white/50 hover:text-white/80 transition-colors disabled:opacity-30"
                  >
                    <Volume2 className="h-3 w-3" /> Continue
                  </button>
                ) : (
                  <button
                    onClick={handleStopAutoPlay}
                    className="flex items-center gap-1.5 rounded-full border border-[#ffd700]/30 bg-[#ffd700]/[0.04] px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] font-serif-fine text-[#ffd700]/80 hover:text-[#ffd700] hover:border-[#ffd700]/60 transition-colors"
                  >
                    <StopCircle className="h-3 w-3" /> Stop
                  </button>
                )}
              </div>
            </div>

            {reflection && (
              <div className="mb-6 rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.01] p-5">
                <div className="font-serif-fine text-[10px] uppercase tracking-[0.22em] text-white/45 mb-2">
                  For what you carried here
                </div>
                <p className="font-serif-fine text-white/90 text-sm md:text-base leading-relaxed">{reflection}</p>
              </div>
            )}

            <div className="mt-2 border-t border-white/10 pt-6 space-y-5">
              {autoActive ? (
                <p className="font-serif-fine text-[10px] uppercase tracking-[0.2em] text-white/25 text-center">
                  Analysis available when recitation stops
                </p>
              ) : (
                <>
                  {loadingContext && (
                    <div className="space-y-3 animate-pulse">
                      <div className="h-2 w-24 rounded bg-white/10" />
                      <div className="h-3 w-full rounded bg-white/[0.07]" />
                      <div className="h-3 w-5/6 rounded bg-white/[0.07]" />
                      <div className="h-3 w-4/6 rounded bg-white/[0.07]" />
                    </div>
                  )}
                  {!loadingContext && sections.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                      className="space-y-4"
                    >
                      {sections.filter((s) => s.key === "SCENE" || s.key === "MEANING" || s.key === "HITS").map(({ key, label, body }) => (
                        <div key={key}>
                          <div className="font-serif-fine text-[10px] uppercase tracking-[0.22em] text-white/40 mb-1.5">{label}</div>
                          <p className="font-serif-fine text-white/85 text-sm md:text-base leading-relaxed">{body}</p>
                        </div>
                      ))}
                      {sections.find((s) => s.key === "REFLECT") && (
                        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
                          <div className="font-serif-fine text-[10px] uppercase tracking-[0.22em] text-white/45 mb-2">Reflect</div>
                          <p className="font-serif-fine italic text-white text-base md:text-lg leading-relaxed">
                            {sections.find((s) => s.key === "REFLECT")!.body}
                          </p>
                        </div>
                      )}
                      {nextSection && (
                        <div className="mt-4">
                          <div className="font-serif-fine text-[10px] uppercase tracking-[0.22em] text-white/40 mb-2">Read next</div>
                          {nextVerse ? (
                            <button
                              onClick={() => onJumpToVerse(nextVerse)}
                              className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/25 px-4 py-3 text-left transition-colors"
                            >
                              <div>
                                <div className="font-serif-fine text-xs uppercase tracking-[0.18em] text-white/50">
                                  {nextVerse.surahName} · {nextVerse.ayah}
                                </div>
                                <div className="font-serif-fine text-sm text-white/80 mt-1 leading-snug">{nextRef?.reason}</div>
                              </div>
                              <ArrowRight className="h-4 w-4 text-white/40 group-hover:text-white/90 group-hover:translate-x-0.5 transition-all" />
                            </button>
                          ) : (
                            <p className="font-serif-fine text-white/70 text-sm leading-relaxed">{nextSection.body}</p>
                          )}
                        </div>
                      )}
                    </motion.div>
                  )}
                  {!loadingContext && !context && (
                    <p className="font-serif-fine text-white/40 text-xs italic">Context unavailable for this verse.</p>
                  )}
                </>
              )}
            </div>

            {autoStatus && (
              <p className="mt-4 font-serif-fine text-[10px] italic text-white/40 animate-pulse text-center">{autoStatus}</p>
            )}

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    {/* Render FloatingReciteButton outside the transformed motion.div so
        position:fixed is relative to the viewport, not the animated parent */}
    {verse !== null && typeof document !== "undefined" &&
      createPortal(
        <FloatingReciteButton
          playing={playing}
          onToggle={toggleAudio}
          disabled={!audioUrl}
        />,
        document.body,
      )}
    </>
  );
}

