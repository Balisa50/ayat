"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Volume2, ArrowRight, ArrowLeft, Sparkles, StopCircle, Repeat } from "lucide-react";
import type { Verse } from "@/lib/types";
import { useReminders } from "./Reminders";
import { FloatingReciteButton } from "./FloatingReciteButton";

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
  const m = body.match(/(\d+)\s*:\s*(\d+)\s*[·, \-, :]*\s*(.*)$/);
  if (!m) return null;
  return { surah: parseInt(m[1], 10), ayah: parseInt(m[2], 10), reason: m[3].trim() };
}

const RECITERS = [
  { id: "7", label: "Mishary Al Afasy" },
  { id: "3", label: "Abdul Rahman Al Sudais" },
  { id: "10", label: "Saud Ash Shuraym" },
  { id: "6", label: "Mahmoud Khalil Al Husary" },
  { id: "4", label: "Abu Bakr Al Shatri" },
  { id: "2", label: "Abdul Basit Abdul Samad" },
  { id: "5", label: "Hani Ar Rifai" },
  { id: "8", label: "Mohamed Siddiq Al Minshawi" },
  { id: "ghamdi", label: "Saad Al Ghamdi" },
  { id: "muaiqly", label: "Maher Al Muaiqly" },
  { id: "ayyoub", label: "Muhammad Ayyoub" },
  { id: "dossari", label: "Yasser Al Dossari" },
  { id: "qatami", label: "Nasser Al Qatami" },
  { id: "jibreel", label: "Muhammad Jibreel" },
  { id: "juhany", label: "Abdullah Al Juhany" },
  { id: "hudhaify", label: "Ali Hudhaify" },
  { id: "basfar", label: "Abdullah Basfar" },
  { id: "budair", label: "Salah Al Budair" },
] as const;
const RECITER_STORAGE_KEY = "ayat:reciter";

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
  onBack,
  onForward,
  position,
  total,
  canGoBack,
  canGoForward,
}: {
  verse: Verse | null;
  allVerses: Verse[] | null;
  reflection?: string | null;
  isDaily?: boolean;
  onClose: () => void;
  onJumpToVerse: (v: Verse) => void;
  onBack?: () => void;
  onForward?: () => void;
  position?: number;
  total?: number;
  canGoBack?: boolean;
  canGoForward?: boolean;
}) {
  const reminders = useReminders();

  const [context, setContext] = useState<string | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [contextRequested, setContextRequested] = useState(false);

  const [reciterId, setReciterId] = useState<string>("7");
  const [reciterOpen, setReciterOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ left: number; right: number; y: number; above: boolean } | null>(null);
  const reciterBtnRef = useRef<HTMLButtonElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentWord, setCurrentWord] = useState(-1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const autoRef = useRef(false);
  const repeatRef = useRef(false);

  const [repeatActive, setRepeatActive] = useState(false);

  const [chainVerse, setChainVerse] = useState<Verse | null>(null);
  const [autoActive, setAutoActive] = useState(false);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);

  const [textVisible, setTextVisible] = useState(true);

  const [density, setDensity] = usePersistedState<"compact" | "comfortable">(
    "ayat:density",
    "comfortable",
    ["compact", "comfortable"] as const,
  );
  const compact = density === "compact";

  const nextAudioRef = useRef<HTMLAudioElement | null>(null);
  const nextAudioUrlRef = useRef<string | null>(null);
  const nextSegmentsRef = useRef<Segment[]>([]);
  const nextVerseRef = useRef<Verse | null>(null);
  const prefetchDoneRef = useRef(false);
  const nextAudioWarmRef = useRef(false);

  const skipAudioResetRef = useRef(false);

  const reciterIdRef = useRef(reciterId);
  useEffect(() => { reciterIdRef.current = reciterId; }, [reciterId]);
  const allVersesRef = useRef(allVerses);
  useEffect(() => { allVersesRef.current = allVerses; }, [allVerses]);
  const chainVerseRef = useRef<Verse | null>(null);
  useEffect(() => { chainVerseRef.current = chainVerse; }, [chainVerse]);
  const verseRef = useRef<Verse | null>(verse);
  useEffect(() => { verseRef.current = verse; }, [verse]);
  const onEndedRef = useRef<() => void>(() => {});

  const currentVerse = (chainVerse ?? verse) as Verse;

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const readFullyTriggeredRef = useRef(false);

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
    nextAudioUrlRef.current = null;
    nextSegmentsRef.current = [];
    nextVerseRef.current = null;
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

  useEffect(() => {
    setContext(null);
    setLoadingContext(false);
    setContextRequested(false);
    readFullyTriggeredRef.current = false;
  }, [currentVerse]);

  useEffect(() => {
    if (!currentVerse) return;
    if (!contextRequested) return;
    if (autoActive) return;
    if (context || loadingContext) return;
    setLoadingContext(true);
    const ctrl = new AbortController();
    fetch("/api/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        arabic: currentVerse.arabic,
        translation: currentVerse.translation,
        surahName: currentVerse.surahName,
        surah: currentVerse.surah,
        ayah: currentVerse.ayah,
      }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d) => setContext(d.context ?? null))
      .catch(() => setContext(null))
      .finally(() => setLoadingContext(false));
    return () => ctrl.abort();
  }, [currentVerse, contextRequested, autoActive]);

  useEffect(() => {
    if (!currentVerse) return;

    if (skipAudioResetRef.current) {
      skipAudioResetRef.current = false;
      return;
    }

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
      ayah: `${currentVerse.surah}:${currentVerse.ayah}`,
    });
    fetch(`/api/recitation?${q.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d?.audioUrl) setAudioUrl(d.audioUrl);
        if (Array.isArray(d?.segments)) setSegments(d.segments);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [currentVerse, reciterId]);

  const triggerPrefetch = useCallback(() => {
    const cv = chainVerseRef.current ?? verseRef.current;
    const av = allVersesRef.current;
    if (!cv || !av) return;

    const nextV = av.find((v) => v.surah === cv.surah && v.ayah === cv.ayah + 1);
    if (!nextV) return;
    nextVerseRef.current = nextV;

    const q = new URLSearchParams({
      reciter: reciterIdRef.current,
      ayah: `${nextV.surah}:${nextV.ayah}`,
    });
    fetch(`/api/recitation?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d?.audioUrl) return;
        const a = new Audio();
        a.crossOrigin = "anonymous";
        a.src = d.audioUrl;
        a.volume = 0;
        a.preload = "auto";
        a.load();
        nextAudioRef.current = a;
        nextAudioUrlRef.current = d.audioUrl;
        nextSegmentsRef.current = Array.isArray(d.segments) ? d.segments : [];
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    onEndedRef.current = () => {
      setCurrentWord(-1);

      if (repeatRef.current && !autoRef.current) {
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

      const nextV = nextVerseRef.current;
      const nextAudio = nextAudioRef.current;

      if (nextV && nextAudio) {
        const wasWarm = nextAudioWarmRef.current;
        nextAudio.volume = 1;
        nextAudio.onended = () => onEndedRef.current();
        nextAudio.onerror = () => setPlaying(false);

        skipAudioResetRef.current = true;
        audioRef.current = nextAudio;

        chainVerseRef.current = nextV;

        setTextVisible(false);

        setChainVerse(nextV);
        setAudioUrl(nextAudioUrlRef.current);
        setSegments(nextSegmentsRef.current.length > 0 ? [...nextSegmentsRef.current] : []);
        setAutoStatus(`${nextV.surahName} · ${nextV.ayah}`);

        nextAudioRef.current = null;
        nextAudioUrlRef.current = null;
        nextSegmentsRef.current = [];
        nextVerseRef.current = null;
        prefetchDoneRef.current = false;
        nextAudioWarmRef.current = false;

        if (wasWarm) {
          nextAudio.pause();
          nextAudio.currentTime = 0;
          nextAudio.play()
            .then(() => setPlaying(true))
            .catch(() => {
              setTimeout(() => nextAudio.play().then(() => setPlaying(true)).catch(() => setPlaying(false)), 20);
            });
        } else {
          nextAudio.play()
            .then(() => setPlaying(true))
            .catch(() => {
              setTimeout(() => nextAudio.play().then(() => setPlaying(true)).catch(() => setPlaying(false)), 80);
            });
        }

        setTimeout(() => setTextVisible(true), 80);
      } else {
        setPlaying(false);
        audioRef.current = null;

        const cv = chainVerseRef.current ?? verseRef.current;
        if (!cv || !allVersesRef.current) {
          autoRef.current = false; setAutoActive(false); return;
        }
        const nextVFallback = allVersesRef.current.find(
          (v) => v.surah === cv.surah && v.ayah === cv.ayah + 1,
        );
        if (!nextVFallback) {
          if (repeatRef.current) {
            const firstVerse = allVersesRef.current.find(
              (v) => v.surah === cv.surah && v.ayah === 1,
            );
            if (firstVerse) {
              setPlaying(false);
              audioRef.current = null;
              setTextVisible(false);
              chainVerseRef.current = firstVerse;
              setChainVerse(firstVerse);
              setAutoStatus(`${firstVerse.surahName} · looping`);
              prefetchDoneRef.current = false;
              setTimeout(() => setTextVisible(true), 80);
              return;
            }
          }
          autoRef.current = false;
          setAutoActive(false);
          setAutoStatus("End of Surah");
          setTimeout(() => setAutoStatus(null), 3000);
          return;
        }
        setTextVisible(false);
        setChainVerse(nextVFallback);
        setAutoStatus(`${nextVFallback.surahName} · ${nextVFallback.ayah}`);
        prefetchDoneRef.current = false;
        setTimeout(() => setTextVisible(true), 80);
      }
    };
  });

  useEffect(() => {
    if (!autoRef.current || !audioUrl || playing || audioRef.current) return;
    const a = new Audio();
    a.crossOrigin = "anonymous";
    a.src = audioUrl;
    a.onended = () => onEndedRef.current();
    a.onerror = () => setPlaying(false);
    audioRef.current = a;
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [audioUrl]);

  useEffect(() => {
    if (!playing || !audioRef.current) return;
    const a = audioRef.current;
    let lastIdx = -2;

    const tick = () => {
      const tMs = a.currentTime * 1000;

      if (segments.length > 0) {
        const idx = activeWordAt(segments, tMs);
        if (idx !== lastIdx) { lastIdx = idx; setCurrentWord(idx); }
      }

      if (autoRef.current && a.duration > 0 && !isNaN(a.duration)) {
        const progress = a.currentTime / a.duration;
        const remaining = a.duration - a.currentTime;

        if (progress >= 0.20 && !prefetchDoneRef.current) {
          prefetchDoneRef.current = true;
          triggerPrefetch();
        }

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
  }, [playing, segments, triggerPrefetch]);

  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [verse]);

  const BISMILLAH_WORD_COUNT = 4;
  const { words, bismillahWords } = useMemo(() => {
    const all = currentVerse?.arabic.split(/\s+/).filter(Boolean) ?? [];
    if (
      currentVerse?.ayah === 1 &&
      currentVerse.surah !== 1 &&
      currentVerse.surah !== 9 &&
      all.length > BISMILLAH_WORD_COUNT
    ) {
      return {
        bismillahWords: all.slice(0, BISMILLAH_WORD_COUNT),
        words: all.slice(BISMILLAH_WORD_COUNT),
      };
    }
    return { bismillahWords: null, words: all };
  }, [currentVerse]);

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

  useEffect(() => {
    if (!verse) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "ArrowLeft" && canGoBack && onBack) {
        e.preventDefault();
        onBack();
      } else if (e.key === "ArrowRight" && canGoForward && onForward) {
        e.preventDefault();
        onForward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [verse, canGoBack, canGoForward, onBack, onForward]);

  const sections = useMemo(() => (context ? parseContext(context) : []), [context]);
  const nextSection = sections.find((s) => s.key === "NEXT");
  const nextRef = nextSection ? parseNextRef(nextSection.body) : null;
  const nextVerse = nextRef && allVerses
    ? allVerses.find((v) => v.surah === nextRef.surah && v.ayah === nextRef.ayah)
    : null;

  const showNav = true;
  const verseKey = currentVerse?.id ?? "none";

  return (
    <>
      <AnimatePresence mode="wait">
        {verse && (
          <motion.div
            key={verseKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-30 flex items-center justify-center px-4 py-8 pointer-events-none"
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              layout="size"
              ref={bodyRef}
              onScroll={onBodyScroll}
              className={`relative w-full max-w-2xl md:max-w-3xl lg:max-w-4xl xl:max-w-5xl rounded-2xl border border-white/10 bg-black/75 backdrop-blur-xl shadow-2xl min-h-[120px] max-h-[90vh] overflow-y-auto pointer-events-auto ${
                compact ? "p-6 md:p-6 lg:p-7" : "p-6 md:p-10 lg:p-14"
              }`}
            >
              <div className="absolute right-4 top-4 flex items-center gap-1">
                <button
                  onClick={() => setDensity(compact ? "comfortable" : "compact")}
                  className="rounded-full px-2.5 py-1.5 font-serif-fine text-[10px] uppercase tracking-[0.18em] text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                  aria-pressed={compact}
                  title={compact ? "Switch to comfortable spacing" : "Switch to compact spacing"}
                >
                  {compact ? "Expand" : "Compact"}
                </button>
                <button
                  onClick={onClose}
                  className="rounded-full p-2 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {isDaily && (
                <div className="mb-5 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 w-fit">
                  <Sparkles className="h-3 w-3 text-white/60" />
                  <span className="font-serif-fine text-[10px] uppercase tracking-[0.22em] text-white/70">
                    Something found you today
                  </span>
                </div>
              )}

              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pr-24">
                {showNav && (
                  <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-1.5 py-1 w-fit">
                    <button
                      onClick={onBack}
                      disabled={!canGoBack}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-white/55 transition-colors hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-white/55"
                      aria-label="Previous verse"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="font-mono text-[10px] tabular-nums text-white/50 min-w-[2.6rem] text-center">
                      {position ?? 1} of {total ?? 1}
                    </span>
                    <button
                      onClick={onForward}
                      disabled={!canGoForward}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-white/55 transition-colors hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-white/55"
                      aria-label="Next verse"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <div className="font-serif-fine text-xs uppercase tracking-[0.25em] text-white/50">
                  {currentVerse.surahName} · {currentVerse.ayah}
                </div>
              </div>

              <div style={{ opacity: textVisible ? 1 : 0, transition: "opacity 80ms ease" }}>
                <div className="min-h-[7rem] mb-6">
                  {bismillahWords && (
                    <div className="mb-4">
                      <p
                        dir="rtl"
                        lang="ar"
                        className="arabic text-center text-[clamp(1rem,2.2vw,1.4rem)] text-white/38 leading-[2] tracking-normal break-words"
                        style={{ wordSpacing: "0.15em" }}
                      >
                        {bismillahWords.join(" ")}
                      </p>
                      <div className="mt-3 border-t border-white/10" />
                    </div>
                  )}
                  <p
                    dir="rtl"
                    lang="ar"
                    className="arabic text-right text-[clamp(1.4rem,3.2vw,2.25rem)] text-white leading-[2.1] tracking-normal break-words"
                    style={{ wordSpacing: "0.15em" }}
                  >
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
                  <p className="font-serif-fine italic text-white/55 text-sm md:text-base leading-relaxed break-words">
                    {currentVerse.transliteration}
                  </p>
                </div>
                <div className="min-h-[4.5rem] mb-5">
                  <p className="font-serif-fine text-white/90 text-base md:text-lg leading-relaxed break-words">
                    {currentVerse.translation}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <button
                    ref={reciterBtnRef}
                    onClick={() => {
                      const btn = reciterBtnRef.current;
                      if (btn) {
                        const r = btn.getBoundingClientRect();
                        const above = r.top > window.innerHeight / 2;
                        setDropPos({
                          left: r.left,
                          right: r.right,
                          y: above ? r.top : r.bottom,
                          above,
                        });
                      }
                      setReciterOpen((o) => !o);
                    }}
                    className="flex items-center gap-1 rounded-full border border-white/15 bg-black/60 px-2 py-1 text-[10px] uppercase tracking-[0.15em] font-serif-fine text-white/55 hover:text-white hover:border-white/40 transition-colors outline-none cursor-pointer whitespace-nowrap"
                    aria-label="Select reciter"
                    aria-expanded={reciterOpen}
                  >
                    {RECITERS.find((r) => r.id === reciterId)?.label ?? "Reciter"}
                    <svg width="8" height="5" viewBox="0 0 8 5" fill="none" className={`transition-transform duration-150 ${reciterOpen ? "rotate-180" : ""}`} aria-hidden="true">
                      <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>

                  {reciterOpen && dropPos && typeof window !== "undefined" && createPortal(
                    <>
                      <div className="fixed inset-0 z-[190]" onClick={() => setReciterOpen(false)} />
                      <div
                        className="fixed z-[191] rounded-xl border border-white/10 bg-[#06070f] shadow-2xl py-1 overflow-y-auto"
                        style={(() => {
                          const MAX_W = 260;
                          const MARGIN = 12;
                          const ideal = dropPos.right - MAX_W;
                          const left = Math.max(MARGIN, Math.min(ideal, window.innerWidth - MAX_W - MARGIN));
                          return {
                            left,
                            maxWidth: MAX_W,
                            maxHeight: "min(260px, 48vh)",
                            backdropFilter: "blur(24px)",
                            WebkitBackdropFilter: "blur(24px)",
                            ...(dropPos.above
                              ? { bottom: window.innerHeight - dropPos.y + 6 }
                              : { top: dropPos.y + 6 }),
                          };
                        })()}
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

                  <button
                    onClick={() => {
                      const next = !repeatRef.current;
                      repeatRef.current = next;
                      setRepeatActive(next);
                    }}
                    disabled={!audioUrl}
                    className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-serif-fine uppercase tracking-[0.15em] transition-colors disabled:opacity-40 ${
                      repeatActive
                        ? "border-[#ffd700]/50 text-[#ffd700]"
                        : "border-white/15 text-white/45 hover:text-white/80 hover:border-white/35"
                    }`}
                    aria-label={repeatActive ? "Repeat on, tap to turn off" : "Repeat off, tap to loop this verse"}
                    title={repeatActive ? "Repeating this verse" : "Repeat this verse"}
                  >
                    <Repeat className="h-3 w-3" />
                    {repeatActive ? "Looping" : "Repeat"}
                  </button>

                  {!autoActive ? (
                    <button
                      onClick={handleStartAutoPlay}
                      disabled={!audioUrl}
                      className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/30 px-2 py-1 text-[10px] uppercase tracking-[0.15em] font-serif-fine text-white/50 hover:text-white/80 transition-colors disabled:opacity-30"
                    >
                      <Volume2 className="h-3 w-3" /> Continue
                    </button>
                  ) : (
                    <button
                      onClick={handleStopAutoPlay}
                      className="flex items-center gap-1 rounded-full border border-[#ffd700]/30 bg-[#ffd700]/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.15em] font-serif-fine text-[#ffd700]/80 hover:text-[#ffd700] hover:border-[#ffd700]/60 transition-colors"
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
                  <p className="font-serif-fine text-white/90 text-sm md:text-base leading-relaxed break-words">{reflection}</p>
                </div>
              )}

              <div className="mt-2 border-t border-white/10 pt-6 space-y-5">
                {autoActive ? (
                  <p className="font-serif-fine text-[10px] uppercase tracking-[0.2em] text-white/25 text-center">
                    Analysis available when recitation stops
                  </p>
                ) : (
                  <>
                    {!contextRequested && !loadingContext && !context && (
                      <button
                        onClick={() => setContextRequested(true)}
                        className="group w-full flex items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/30 px-5 py-3.5 font-serif-fine text-[11px] uppercase tracking-[0.22em] text-white/65 hover:text-white transition-colors"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-white/55 group-hover:text-white" />
                        Reveal AI analysis
                      </button>
                    )}
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
                            <p className="font-serif-fine text-white/85 text-sm md:text-base leading-relaxed break-words">{body}</p>
                          </div>
                        ))}
                        {sections.find((s) => s.key === "REFLECT") && (
                          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
                            <div className="font-serif-fine text-[10px] uppercase tracking-[0.22em] text-white/45 mb-2">Reflect</div>
                            <p className="font-serif-fine italic text-white text-base md:text-lg leading-relaxed break-words">
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
                              <p className="font-serif-fine text-white/70 text-sm leading-relaxed break-words">{nextSection.body}</p>
                            )}
                          </div>
                        )}
                      </motion.div>
                    )}
                    {contextRequested && !loadingContext && !context && (
                      <div className="rounded-xl border border-white/8 bg-white/[0.02] px-5 py-4 text-center">
                        <p className="font-serif-fine text-[10px] uppercase tracking-[0.22em] text-white/45 mb-2">AI commentary is paused</p>
                        <p className="font-serif-fine italic text-white/65 text-[13px] leading-relaxed break-words">
                          We&apos;re between API top-ups. The verse, translation, recitation, and the rest of the app work as normal. The verse itself is more than enough - sit with it.
                        </p>
                      </div>
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
