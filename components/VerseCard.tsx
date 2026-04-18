"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Volume2, VolumeX, ArrowRight, Camera, Sparkles, Film, StopCircle } from "lucide-react";
import type { Verse } from "@/lib/types";
import { useReminders } from "./Reminders";

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
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentWord, setCurrentWord] = useState(-1);

  // Refs that live outside React render cycle
  const audioRef        = useRef<HTMLAudioElement | null>(null);
  const rafRef          = useRef<number | null>(null);
  const autoRef         = useRef(false);

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

  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [videoStatus, setVideoStatus] = useState<string | null>(null);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const readFullyTriggeredRef = useRef(false);

  // ── Reset everything when the top-level verse prop changes ────────────────
  useEffect(() => {
    setChainVerse(null);
    setAutoActive(false);
    setAutoStatus(null);
    autoRef.current = false;
    setTextVisible(true);
    prefetchDoneRef.current = false;
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

      if (!autoRef.current) {
        setPlaying(false);
        return;
      }

      const nextV     = nextVerseRef.current;
      const nextAudio = nextAudioRef.current;

      if (nextV && nextAudio) {
        // ── Zero-gap advance (pre-fetch was ready) ──────────────────
        nextAudio.volume  = 1;
        nextAudio.onended = () => onEndedRef.current();
        nextAudio.onerror = () => setPlaying(false);

        // Block the fetch effect — we're bringing our own audio
        skipAudioResetRef.current = true;
        audioRef.current = nextAudio;

        // Visual: text fades out for 300ms, content swaps while invisible
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

        // Start playback — stays "playing" with no gap
        nextAudio.play()
          .then(() => setPlaying(true))
          .catch(() => setPlaying(false));

        // Text fades back in once content has swapped (~one render later)
        setTimeout(() => setTextVisible(true), 300);
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
        setTimeout(() => setTextVisible(true), 300);
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

      // Kick off pre-fetch at 80% (auto mode only)
      if (autoRef.current && a.duration > 0 && !isNaN(a.duration)) {
        if (a.currentTime / a.duration >= 0.80 && !prefetchDoneRef.current) {
          prefetchDoneRef.current = true;
          triggerPrefetch();
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
  }, [playing, toggleAudio]);

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

  const handleScreenshot = async () => {
    if (!currentVerse || capturing) return;
    setCapturing(true);
    try {
      await ensureArabicFontsLoaded();
      const blob = await screenshotVerseCanvas({ verse: currentVerse, words });
      const filename = `ayat-${currentVerse.surah}-${currentVerse.ayah}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (d: { files?: File[] }) => boolean;
        share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>;
      };
      if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: `${currentVerse.surahName} · ${currentVerse.ayah}`, text: "AYAT" });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      }
      reminders.trigger("share");
    } catch (e) { console.error("screenshot failed", e); }
    finally { setCapturing(false); }
  };

  const handleShareVideo = async () => {
    if (!verse || !audioUrl || recording) return;
    setRecording(true);
    setVideoStatus("Loading fonts…");
    try {
      await ensureArabicFontsLoaded();
      setVideoStatus("Preparing…");
      const blob = await recordVerseVideo({ verse, words, audioUrl, segments, onStatus: setVideoStatus });
      setVideoStatus("Processing…");
      await new Promise((r) => setTimeout(r, 400));
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const filename = `ayat-${verse.surah}-${verse.ayah}.${ext}`;
      const file = new File([blob], filename, { type: blob.type });
      const nav = navigator as Navigator & {
        canShare?: (d: { files?: File[] }) => boolean;
        share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>;
      };
      if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: `${verse.surahName} · ${verse.ayah}`, text: "From AYAT" });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      }
      reminders.trigger("share");
    } catch (e) {
      console.error("video share failed", e);
      setVideoStatus("Recording failed · tap to try again");
    } finally {
      setTimeout(() => { setVideoStatus(null); setRecording(false); }, 2500);
    }
  };

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
            <div style={{ opacity: textVisible ? 1 : 0, transition: "opacity 300ms ease" }}>
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

              {/* Recite controls — directly below the verse, easy reach */}
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <button
                  onClick={toggleAudio}
                  disabled={!audioUrl}
                  className={`flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[11px] uppercase tracking-[0.2em] font-serif-fine transition-colors disabled:opacity-40 ${
                    playing
                      ? "border-[#ffd700]/50 text-[#ffd700] animate-pulse"
                      : "border-white/20 text-white/70 hover:text-white hover:border-white/50"
                  }`}
                  aria-label={playing ? "Pause recitation" : "Play recitation"}
                >
                  {playing ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                  {playing ? "Pause" : "Recite"}
                </button>
                <select
                  value={reciterId}
                  onChange={(e) => setReciterId(e.target.value)}
                  className="rounded-full border border-white/15 bg-black/60 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] font-serif-fine text-white/55 hover:text-white hover:border-white/40 transition-colors outline-none appearance-none cursor-pointer"
                  aria-label="Select reciter"
                >
                  {RECITERS.map((r) => (
                    <option key={r.id} value={r.id} className="bg-black text-white normal-case tracking-normal">
                      {r.label}
                    </option>
                  ))}
                </select>
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
                    <p className="font-serif-fine text-white/50 italic text-sm">Finding where this verse lands…</p>
                  )}
                  {!loadingContext && sections.length > 0 && (
                    <>
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
                    </>
                  )}
                  {!loadingContext && !context && (
                    <p className="font-serif-fine text-white/40 text-xs italic">Context unavailable for this verse.</p>
                  )}
                </>
              )}
            </div>

            {/* Auto-continue controls */}
            <div className="mt-6 flex items-center justify-between gap-3">
              {!autoActive ? (
                <button
                  onClick={handleStartAutoPlay}
                  disabled={!audioUrl}
                  className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/30 px-4 py-2 text-[10px] uppercase tracking-[0.2em] font-serif-fine text-white/50 hover:text-white/80 transition-colors disabled:opacity-30"
                >
                  <Volume2 className="h-3 w-3" /> Continue Surah
                </button>
              ) : (
                <button
                  onClick={handleStopAutoPlay}
                  className="flex items-center gap-1.5 rounded-full border border-[#ffd700]/30 bg-[#ffd700]/[0.04] px-4 py-2 text-[10px] uppercase tracking-[0.2em] font-serif-fine text-[#ffd700]/80 hover:text-[#ffd700] hover:border-[#ffd700]/60 transition-colors"
                >
                  <StopCircle className="h-3 w-3" /> Stop
                </button>
              )}
              {autoStatus && (
                <p className="font-serif-fine text-[10px] italic text-white/40 animate-pulse">{autoStatus}</p>
              )}
            </div>

            {/* Bottom: Video + Screenshot */}
            <div className="mt-6 pt-6 border-t border-white/10 flex flex-col gap-3">
              <button
                onClick={handleShareVideo}
                disabled={recording || !audioUrl}
                className="group flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/35 px-4 py-3 text-sm font-serif-fine text-white/80 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Film className="h-4 w-4" />
                {recording ? (videoStatus ?? "Recording…") : "Share as video"}
              </button>
              <button
                onClick={handleScreenshot}
                disabled={capturing}
                className="group flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.01] hover:bg-white/[0.05] hover:border-white/25 px-4 py-2.5 text-xs font-serif-fine text-white/55 hover:text-white/80 transition-colors disabled:opacity-40"
              >
                <Camera className="h-3.5 w-3.5" />
                {capturing ? "Saving…" : "Screenshot"}
              </button>
              {!audioUrl && (
                <p className="text-center font-serif-fine text-[11px] italic text-white/40">Loading recitation…</p>
              )}
              {recording && videoStatus && (
                <p className="text-center font-serif-fine text-[11px] italic text-white/50">{videoStatus}</p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  SCREENSHOT
// ═══════════════════════════════════════════════════════════════════════
interface ScreenshotArgs { verse: Verse; words: string[] }

async function screenshotVerseCanvas({ verse, words }: ScreenshotArgs): Promise<Blob> {
  const W = 1080, H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  if (!ctx) throw new Error("canvas 2d unavailable");
  const AF = `"Amiri","Scheherazade New","Traditional Arabic",serif`;
  const EF = `Georgia,"Times New Roman",serif`;
  const M  = 90;
  const maxW = W - M * 2;
  function layout(size: number) {
    ctx.font = `${size}px ${AF}`;
    const sp = ctx.measureText(" ").width;
    const lines: Array<{ words: Array<{ word: string; idx: number; width: number }>; totalW: number }> = [{ words: [], totalW: 0 }];
    let line = lines[0], wLen = 0;
    for (let i = 0; i < words.length; i++) {
      const wm = ctx.measureText(words[i]).width;
      const need = wm + (line.words.length > 0 ? sp : 0);
      if (wLen + need > maxW && line.words.length > 0) { line.totalW = wLen; lines.push({ words: [], totalW: 0 }); line = lines[lines.length - 1]; wLen = 0; }
      if (line.words.length > 0) wLen += sp;
      line.words.push({ word: words[i], idx: i, width: wm }); wLen += wm;
    }
    line.totalW = wLen; return lines;
  }
  function wrap(text: string, mW: number, font: string) {
    ctx.font = font;
    const toks = text.split(/\s+/); const out: string[] = []; let ln = "";
    for (const t of toks) { const test = ln ? ln + " " + t : t; if (ctx.measureText(test).width > mW && ln) { out.push(ln); ln = t; } else ln = test; }
    if (ln) out.push(ln); return out;
  }
  let sz = 110, lines = layout(sz);
  while (lines.length > 4 && sz > 64) { sz -= 6; lines = layout(sz); }
  const lh = Math.round(sz * 1.55);
  const transFont = `italic 30px ${EF}`, translaFont = `40px ${EF}`;
  const tlLines = wrap(verse.transliteration, maxW, transFont).slice(0, 3);
  const trLines = wrap(verse.translation, maxW, translaFont).slice(0, 5);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  const rng = (n: number) => ((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;
  for (let i = 0; i < 120; i++) {
    ctx.globalAlpha = 0.12 + rng(i) * 0.55; ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(rng(i*3)*W, rng(i*3+1)*H, 0.6 + rng(i*3+2)*1.8, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const gY = H * 0.45, glow = ctx.createRadialGradient(W/2, gY, 40, W/2, gY, W*0.85);
  glow.addColorStop(0,"rgba(90,70,180,0.45)"); glow.addColorStop(0.35,"rgba(40,50,140,0.22)"); glow.addColorStop(0.8,"rgba(0,0,0,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#C9A84C"; ctx.font = `500 24px ${EF}`; ctx.textAlign = "right"; ctx.textBaseline = "top";
  ctx.fillText(`${verse.surahName} · ${verse.ayah}`, W - M, M);
  const bH = lines.length * lh, startY = gY - bH / 2 + lh * 0.15;
  ctx.font = `${sz}px ${AF}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "center"; ctx.direction = "rtl";
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li], y = startY + (li + 1) * lh, sp = ctx.measureText(" ").width;
    let x = W / 2 + l.totalW / 2;
    ctx.shadowColor = "rgba(255,220,150,0.3)"; ctx.shadowBlur = 14; ctx.fillStyle = "#fff";
    for (const item of l.words) { ctx.fillText(item.word, x - item.width/2, y); x -= item.width + sp; }
  }
  ctx.shadowBlur = 0; ctx.direction = "ltr";
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.font = transFont; ctx.fillStyle = "#888";
  let ty = startY + bH + 80;
  for (const ln of tlLines) { ctx.fillText(ln, W/2, ty); ty += 42; }
  ctx.font = translaFont; ctx.fillStyle = "rgba(255,255,255,0.96)"; ty += 28;
  for (const ln of trLines) { ctx.fillText(ln, W/2, ty); ty += 54; }
  ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = `500 22px ${EF}`;
  ctx.fillText("AYAT", W - M, H - M);
  return new Promise<Blob>((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error("toBlob failed")), "image/png", 1.0));
}

// ═══════════════════════════════════════════════════════════════════════
//  VIDEO RECORDER — nuclear reset on every call
// ═══════════════════════════════════════════════════════════════════════
interface RecordArgs { verse: Verse; words: string[]; audioUrl: string; segments: Segment[]; onStatus: (s: string) => void }
let _activeAudioCtx: AudioContext | null = null;
let _activeStream: MediaStream | null = null;
let _activeRecorder: MediaRecorder | null = null;

async function recordVerseVideo({ verse, words, audioUrl, segments, onStatus }: RecordArgs): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") throw new Error("MediaRecorder unsupported.");
  onStatus("Resetting…");
  try { _activeRecorder?.stop(); } catch {}
  _activeRecorder = null;
  if (_activeStream) { for (const t of _activeStream.getTracks()) { try { t.stop(); } catch {} } _activeStream = null; }
  if (_activeAudioCtx) { try { await _activeAudioCtx.close(); } catch {} _activeAudioCtx = null; }
  await new Promise((r) => setTimeout(r, 300));
  const W = 1080, H = 1920;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  if (!ctx) throw new Error("canvas 2d unavailable");
  const audio = new Audio(); audio.crossOrigin = "anonymous"; audio.preload = "auto"; audio.src = audioUrl;
  type ACtor = typeof AudioContext;
  const ww = window as unknown as { AudioContext?: ACtor; webkitAudioContext?: ACtor };
  const Ctor = ww.AudioContext ?? ww.webkitAudioContext;
  if (!Ctor) throw new Error("AudioContext unsupported");
  const audioCtx = new Ctor(); _activeAudioCtx = audioCtx;
  const source = audioCtx.createMediaElementSource(audio);
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(dest); source.connect(audioCtx.destination);
  const canvasStream = canvas.captureStream(30); _activeStream = canvasStream;
  for (const t of dest.stream.getAudioTracks()) canvasStream.addTrack(t);
  const mimeType = ["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/mp4;codecs=h264,aac","video/mp4","video/webm"]
    .find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "video/webm";
  const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000 });
  _activeRecorder = recorder;
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  type P = { x: number; y: number; r: number; speed: number; phase: number; alpha: number };
  const particles: P[] = Array.from({ length: 120 }, () => ({ x: Math.random()*W, y: Math.random()*H, r: 0.6+Math.random()*2, speed: 4+Math.random()*12, phase: Math.random()*Math.PI*2, alpha: 0.15+Math.random()*0.65 }));
  const AF = `"Amiri","Scheherazade New","Traditional Arabic",serif`, EF = `Georgia,"Times New Roman",serif`, M = 90, maxW = W - M*2;
  type LW = { word: string; idx: number; width: number }; type LL = { words: LW[]; totalW: number };
  function layoutV(maxWW: number, size: number): LL[] {
    ctx.font = `${size}px ${AF}`; const sp = ctx.measureText(" ").width;
    const lines: LL[] = [{ words: [], totalW: 0 }]; let line = lines[0], wLen = 0;
    for (let i = 0; i < words.length; i++) {
      const wm = ctx.measureText(words[i]).width, need = wm + (line.words.length > 0 ? sp : 0);
      if (wLen + need > maxWW && line.words.length > 0) { line.totalW = wLen; lines.push({ words: [], totalW: 0 }); line = lines[lines.length-1]; wLen = 0; }
      if (line.words.length > 0) wLen += sp;
      line.words.push({ word: words[i], idx: i, width: wm }); wLen += wm;
    }
    line.totalW = wLen; return lines;
  }
  function wrapV(text: string, mW: number, font: string) {
    ctx.font = font; const toks = text.split(/\s+/); const out: string[] = []; let ln = "";
    for (const t of toks) { const test = ln ? ln+" "+t : t; if (ctx.measureText(test).width > mW && ln) { out.push(ln); ln = t; } else ln = test; }
    if (ln) out.push(ln); return out;
  }
  let sz = 110, lines = layoutV(maxW, sz);
  while (lines.length > 4 && sz > 64) { sz -= 6; lines = layoutV(maxW, sz); }
  const lh = Math.round(sz*1.55), tF = `italic 30px ${EF}`, trF = `40px ${EF}`;
  const tlLines = wrapV(verse.transliteration, maxW, tF).slice(0,3);
  const trLines = wrapV(verse.translation, maxW, trF).slice(0,5);
  let t0 = 0;
  function draw(now: number, cidx: number) {
    const ts = t0 ? (now-t0)/1000 : 0;
    ctx.fillStyle="#000"; ctx.fillRect(0,0,W,H);
    for (const p of particles) {
      p.y -= p.speed*(1/30); if (p.y < -5) { p.y = H+5; p.x = Math.random()*W; }
      ctx.globalAlpha = p.alpha*(0.5+0.5*Math.sin(ts*2+p.phase)); ctx.fillStyle="#fff";
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
    const gY=H*0.45; const glow=ctx.createRadialGradient(W/2,gY,40,W/2,gY,W*0.85);
    glow.addColorStop(0,"rgba(90,70,180,0.45)"); glow.addColorStop(0.35,"rgba(40,50,140,0.22)"); glow.addColorStop(0.8,"rgba(0,0,0,0)");
    ctx.fillStyle=glow; ctx.fillRect(0,0,W,H);
    ctx.fillStyle="#C9A84C"; ctx.font=`500 24px ${EF}`; ctx.textAlign="right"; ctx.textBaseline="top";
    ctx.fillText(`${verse.surahName} · ${verse.ayah}`,W-M,M);
    const bH=lines.length*lh, sY=gY-bH/2+lh*0.15;
    ctx.font=`${sz}px ${AF}`; ctx.textBaseline="alphabetic"; ctx.textAlign="center"; ctx.direction="rtl";
    const pulse=0.75+0.25*Math.sin(ts*6);
    for (let li=0; li<lines.length; li++) {
      const l=lines[li], y=sY+(li+1)*lh, sp=ctx.measureText(" ").width; let x=W/2+l.totalW/2;
      for (const item of l.words) {
        const active=item.idx===cidx;
        if (active) { ctx.shadowColor=`rgba(255,215,100,${0.95*pulse})`; ctx.shadowBlur=50*pulse; ctx.fillStyle="#FFE27A"; }
        else { ctx.shadowColor="rgba(255,220,150,0.35)"; ctx.shadowBlur=14; ctx.fillStyle="#fff"; }
        ctx.fillText(item.word,x-item.width/2,y); x-=item.width+sp;
      }
    }
    ctx.shadowBlur=0; ctx.direction="ltr";
    ctx.textAlign="center"; ctx.textBaseline="top"; ctx.font=tF; ctx.fillStyle="#888";
    let ty=sY+bH+80; for (const ln of tlLines) { ctx.fillText(ln,W/2,ty); ty+=42; }
    ctx.font=trF; ctx.fillStyle="rgba(255,255,255,0.96)"; ty+=28;
    for (const ln of trLines) { ctx.fillText(ln,W/2,ty); ty+=54; }
    ctx.textAlign="right"; ctx.textBaseline="alphabetic"; ctx.fillStyle="rgba(255,255,255,0.55)"; ctx.font=`500 22px ${EF}`;
    ctx.fillText("AYAT",W-M,H-M);
  }
  draw(performance.now(),-1); onStatus("Starting…");
  return new Promise<Blob>((resolve, reject) => {
    let stopped=false, started=false, rafId=0, settled=false;
    const ok=(v:Blob)=>{if(!settled){settled=true;resolve(v);}};
    const fail=(e:Error)=>{if(!settled){settled=true;reject(e);}};
    const cleanup=()=>{
      try{cancelAnimationFrame(rafId);}catch{}
      try{audio.pause();audio.src="";}catch{}
      try{source.disconnect();dest.disconnect();}catch{}
      try{for(const tr of canvasStream.getTracks())tr.stop();}catch{}
      audioCtx.close().catch(()=>{}); _activeAudioCtx=null; _activeStream=null; _activeRecorder=null;
    };
    recorder.onstop=()=>setTimeout(()=>{cleanup();ok(new Blob(chunks,{type:mimeType}));},120);
    recorder.onerror=(ev)=>{cleanup();fail(new Error(`recorder error: ${(ev as Event).type}`));};
    const onReady=async()=>{
      // Guard: both canplaythrough and loadeddata can fire — only start once
      if(started) return;
      started=true;
      try {
        if(canvasStream.getTracks().length===0)throw new Error("canvas stream has no tracks");
        if(audioCtx.state==="closed")throw new Error("AudioContext closed");
        await audioCtx.resume();
        recorder.start(100);
        await audio.play();
        t0=performance.now();
        onStatus("Recording…");
        const render=()=>{ if(stopped)return; draw(performance.now(),activeWordAt(segments,audio.currentTime*1000)); rafId=requestAnimationFrame(render); };
        rafId=requestAnimationFrame(render);
      } catch(err){fail(err instanceof Error?err:new Error(String(err)));}
    };
    // Listen on both events; the guard above ensures onReady only runs once.
    // canplaythrough fires when the browser has buffered enough to play through.
    // loadeddata fires earlier (readyState >= 2) and acts as a faster fallback.
    audio.addEventListener("canplaythrough",onReady,{once:true});
    audio.addEventListener("loadeddata",onReady,{once:true});
    // Timeout fallback: if neither fires within 12s, abort cleanly
    const loadTimeout=setTimeout(()=>fail(new Error("Audio took too long to load — try again.")),12000);
    audio.addEventListener("ended",()=>{
      clearTimeout(loadTimeout);
      if(stopped)return;
      stopped=true;
      onStatus("Processing…");
      setTimeout(()=>{try{recorder.stop();}catch{}},250);
    },{once:true});
    audio.addEventListener("error",()=>{clearTimeout(loadTimeout);fail(new Error("Audio load failed — check your connection."));},{once:true});
    try{audio.load();}catch{}
  });
}
