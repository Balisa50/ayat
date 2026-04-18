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
      const [ , wEnd, s, e] = seg;
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
  if (document.fonts && document.fonts.ready) {
    return document.fonts.ready.then(() => undefined);
  }
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Auto-continue
  const [chainVerse, setChainVerse] = useState<Verse | null>(null);
  const [autoActive, setAutoActive] = useState(false);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);
  const autoRef = useRef(false);

  // Text fade — only the text content fades, the card shell is static
  const [textVisible, setTextVisible] = useState(true);

  // Crossfade pre-fetch refs — all reads/writes inside the RAF loop, no re-renders
  const nextAudioRef = useRef<HTMLAudioElement | null>(null);
  const nextAudioUrlRef = useRef<string | null>(null);
  const nextSegmentsRef = useRef<Segment[]>([]);
  const nextVerseRef = useRef<Verse | null>(null);
  const prefetchDoneRef = useRef(false);
  const crossfadeActiveRef = useRef(false);
  const crossfadeRafRef = useRef<number | null>(null);

  // Snapshot of deps needed inside RAF (avoids stale closures without re-creating the loop)
  const reciterIdRef = useRef(reciterId);
  useEffect(() => { reciterIdRef.current = reciterId; }, [reciterId]);
  const allVersesRef = useRef(allVerses);
  useEffect(() => { allVersesRef.current = allVerses; }, [allVerses]);
  const chainVerseRef = useRef(chainVerse);
  useEffect(() => { chainVerseRef.current = chainVerse; }, [chainVerse]);

  // Derived current verse
  const currentVerse = (chainVerse ?? verse) as Verse;

  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [videoStatus, setVideoStatus] = useState<string | null>(null);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const readFullyTriggeredRef = useRef(false);

  // Reset everything when the top-level verse prop changes
  useEffect(() => {
    setChainVerse(null);
    setAutoActive(false);
    setAutoStatus(null);
    autoRef.current = false;
    setTextVisible(true);
    prefetchDoneRef.current = false;
    crossfadeActiveRef.current = false;
    if (crossfadeRafRef.current) {
      cancelAnimationFrame(crossfadeRafRef.current);
      crossfadeRafRef.current = null;
    }
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

  // Fetch AI analysis (skip during auto-play)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVerse, autoActive]);

  // Fetch audio for current verse
  useEffect(() => {
    if (!currentVerse) return;
    setAudioUrl(null);
    setSegments([]);
    setCurrentWord(-1);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      setPlaying(false);
    }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVerse, reciterId]);

  // ── Pre-fetch next verse audio silently ────────────────────────────────
  const triggerPrefetch = useCallback(() => {
    const cv = chainVerseRef.current ?? verse;
    const av = allVersesRef.current;
    if (!cv || !av) return;
    const nextV = av.find(
      (v) => v.surah === cv.surah && v.ayah === cv.ayah + 1
    );
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
  }, [verse]);

  // ── Seamless crossfade transition ──────────────────────────────────────
  // Called when current audio reaches 95%. Handles both the volume crossfade
  // and the visual text swap atomically.
  const doTransition = useCallback((currentAudio: HTMLAudioElement) => {
    const nextAudio = nextAudioRef.current;
    const nextV = nextVerseRef.current;
    if (!nextV || !autoRef.current) return;

    // Prevent onended from triggering a second transition
    currentAudio.onended = null;

    // If we have the next audio ready, start it and crossfade volumes.
    // If not, we proceed visually only (brief silence, acceptable fallback).
    const hasNext = Boolean(nextAudio);
    if (hasNext && nextAudio) {
      nextAudio.volume = 0;
      nextAudio.play().catch(() => {});
    }

    // Visual: fade text out over 300ms
    setTextVisible(false);

    // Volume crossfade over ~600ms (overlaps with text fade)
    const XFADE_MS = 600;
    const xStart = performance.now();
    const xfade = () => {
      const t = Math.min(1, (performance.now() - xStart) / XFADE_MS);
      try { currentAudio.volume = Math.max(0, 1 - t); } catch {}
      if (hasNext && nextAudio) {
        try { nextAudio.volume = Math.min(1, t); } catch {}
      }
      if (t < 1) {
        crossfadeRafRef.current = requestAnimationFrame(xfade);
      }
    };
    crossfadeRafRef.current = requestAnimationFrame(xfade);

    // After 300ms (text invisible): atomically swap verse data
    setTimeout(() => {
      if (!autoRef.current) return;

      // Swap state in one batch
      setChainVerse(nextV);
      setCurrentWord(-1);
      setAudioUrl(nextAudioUrlRef.current);
      setSegments(nextSegmentsRef.current ?? []);

      // Promote next audio to the active slot
      if (hasNext && nextAudio) {
        nextAudio.onended = () => {
          setPlaying(false);
          setCurrentWord(-1);
          // Will be handled by the new RAF loop on the next verse
        };
        nextAudio.onerror = () => { setPlaying(false); };
        audioRef.current = nextAudio;
      } else {
        // No pre-fetched audio — let the audioUrl effect spin up new playback
        audioRef.current = null;
        setPlaying(false);
      }

      // Clear pre-fetch slots for the NEXT verse
      nextAudioRef.current = null;
      nextAudioUrlRef.current = null;
      nextSegmentsRef.current = [];
      nextVerseRef.current = null;
      prefetchDoneRef.current = false;
      crossfadeActiveRef.current = false;

      setAutoStatus(`${nextV.surahName} · ${nextV.ayah}`);

      // Fade text back in
      setTextVisible(true);
    }, 300);
  }, []);

  // ── Combined RAF: word highlighting + crossfade progress monitor ────────
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

      // Crossfade progress (auto mode only)
      if (autoRef.current && a.duration > 0 && !isNaN(a.duration)) {
        const progress = a.currentTime / a.duration;

        if (progress >= 0.80 && !prefetchDoneRef.current) {
          prefetchDoneRef.current = true;
          triggerPrefetch();
        }

        if (
          progress >= 0.95 &&
          !crossfadeActiveRef.current &&
          nextAudioRef.current
        ) {
          crossfadeActiveRef.current = true;
          doTransition(a);
          return; // stop this RAF — doTransition manages the rest
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, segments]);

  // Cleanup audio on verse prop change
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (crossfadeRafRef.current) cancelAnimationFrame(crossfadeRafRef.current);
    };
  }, [verse]);

  const words = useMemo(
    () => currentVerse?.arabic.split(/\s+/).filter(Boolean) ?? [],
    [currentVerse]
  );

  // Fallback for when audio ends without a successful crossfade (short verses,
  // network delay, end of Surah)
  const onAudioEnded = useCallback(() => {
    if (crossfadeActiveRef.current) return; // crossfade already took over
    setPlaying(false);
    setCurrentWord(-1);
    if (!autoRef.current || !allVersesRef.current) return;
    const cv = chainVerseRef.current ?? verse;
    if (!cv) return;
    const nextV = allVersesRef.current.find(
      (v) => v.surah === cv.surah && v.ayah === cv.ayah + 1
    );
    if (!nextV) {
      setAutoActive(false);
      autoRef.current = false;
      setAutoStatus("End of Surah");
      setTimeout(() => setAutoStatus(null), 3000);
      return;
    }
    // Brief gap fallback (no pre-fetched audio available)
    setTextVisible(false);
    setTimeout(() => {
      if (!autoRef.current) return;
      setChainVerse(nextV);
      setCurrentWord(-1);
      setAudioUrl(null);
      setSegments([]);
      audioRef.current = null;
      prefetchDoneRef.current = false;
      crossfadeActiveRef.current = false;
      setAutoStatus(`${nextV.surahName} · ${nextV.ayah}`);
      setTextVisible(true);
    }, 300);
  }, [verse]);

  // When a new audioUrl arrives after an auto-advance fallback, start playing
  useEffect(() => {
    if (!autoRef.current || !audioUrl || playing) return;
    // Only auto-start if we just transitioned (chainVerse changed and we need to play)
    // We use the fact that audioRef.current is null after fallback transition
    if (audioRef.current) return;
    const a = new Audio();
    a.crossOrigin = "anonymous";
    a.src = audioUrl;
    a.onended = onAudioEnded;
    a.onerror = () => { setPlaying(false); };
    audioRef.current = a;
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  const toggleAudio = useCallback(() => {
    if (!currentVerse || !audioUrl) return;
    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }
    const a = audioRef.current ?? new Audio();
    a.crossOrigin = "anonymous";
    a.src = audioUrl;
    a.onended = onAudioEnded;
    a.onerror = () => { setPlaying(false); };
    audioRef.current = a;
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [currentVerse, audioUrl, playing, onAudioEnded]);

  const handleStartAutoPlay = useCallback(() => {
    autoRef.current = true;
    setAutoActive(true);
    setAutoStatus("Auto-continuing on…");
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
    // Cleanup pre-fetched audio
    if (nextAudioRef.current) {
      nextAudioRef.current.pause();
      nextAudioRef.current.src = "";
      nextAudioRef.current = null;
    }
    prefetchDoneRef.current = false;
    crossfadeActiveRef.current = false;
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
        await nav.share({
          files: [file],
          title: `${currentVerse.surahName} · ${currentVerse.ayah}`,
          text: "AYAT",
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      }
      reminders.trigger("share");
    } catch (e) {
      console.error("screenshot failed", e);
    } finally {
      setCapturing(false);
    }
  };

  const handleShareVideo = async () => {
    if (!verse || !audioUrl || recording) return;
    setRecording(true);
    setVideoStatus("Loading fonts…");
    try {
      await ensureArabicFontsLoaded();
      setVideoStatus("Preparing…");
      const blob = await recordVerseVideo({
        verse,
        words,
        audioUrl,
        segments,
        onStatus: setVideoStatus,
      });
      setVideoStatus("Processing…");
      // Brief pause to let "Processing…" show before save dialog
      await new Promise((r) => setTimeout(r, 400));
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const filename = `ayat-${verse.surah}-${verse.ayah}.${ext}`;
      const file = new File([blob], filename, { type: blob.type });
      const nav = navigator as Navigator & {
        canShare?: (d: { files?: File[] }) => boolean;
        share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>;
      };
      if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: `${verse.surahName} · ${verse.ayah}`,
          text: "From AYAT",
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      }
      reminders.trigger("share");
    } catch (e) {
      console.error("video share failed", e);
      setVideoStatus("Recording failed · tap to try again");
    } finally {
      setTimeout(() => {
        setVideoStatus(null);
        setRecording(false);
      }, 2500);
    }
  };

  const onBodyScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el || readFullyTriggeredRef.current) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom) {
      readFullyTriggeredRef.current = true;
      reminders.trigger("read-fully");
    }
  }, [reminders]);

  const sections = useMemo(() => (context ? parseContext(context) : []), [context]);
  const nextSection = sections.find((s) => s.key === "NEXT");
  const nextRef = nextSection ? parseNextRef(nextSection.body) : null;
  const nextVerse =
    nextRef && allVerses
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

            {/* Header — surah label + audio controls. Screenshot button moved to bottom. */}
            <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
              <div className="font-serif-fine text-xs uppercase tracking-[0.25em] text-white/50">
                {currentVerse.surahName} · {currentVerse.ayah}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={toggleAudio}
                  disabled={!audioUrl}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] font-serif-fine transition-colors disabled:opacity-40 ${
                    playing
                      ? "border-[#ffd700]/50 text-[#ffd700] animate-pulse"
                      : "border-white/15 text-white/60 hover:text-white hover:border-white/40"
                  }`}
                  aria-label={playing ? "Pause recitation" : "Play recitation"}
                >
                  {playing ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                  {playing ? "Pause" : "Recite"}
                </button>
                <select
                  value={reciterId}
                  onChange={(e) => setReciterId(e.target.value)}
                  className="rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] font-serif-fine text-white/60 hover:text-white hover:border-white/40 transition-colors outline-none appearance-none cursor-pointer"
                  aria-label="Select reciter"
                >
                  {RECITERS.map((r) => (
                    <option
                      key={r.id}
                      value={r.id}
                      className="bg-black text-white normal-case tracking-normal"
                    >
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Verse text — only this div fades during transitions ── */}
            {/* Fixed min-heights prevent layout jumps when verse length varies */}
            <div
              style={{
                opacity: textVisible ? 1 : 0,
                transition: "opacity 300ms ease",
              }}
            >
              {/* Arabic — min-height reserves space for up to ~4 lines */}
              <div className="min-h-[7rem] mb-6">
                <p
                  dir="rtl"
                  className="arabic text-right text-[clamp(1.5rem,3.5vw,2.25rem)] text-white leading-relaxed"
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
                      {w}
                      {i < words.length - 1 ? " " : ""}
                    </span>
                  ))}
                </p>
              </div>

              {/* Transliteration — min-height for ~2 lines */}
              <div className="min-h-[3rem] mb-4">
                <p className="font-serif-fine italic text-white/55 text-sm md:text-base leading-relaxed">
                  {currentVerse.transliteration}
                </p>
              </div>

              {/* Translation — min-height for ~3 lines */}
              <div className="min-h-[4.5rem] mb-6">
                <p className="font-serif-fine text-white/90 text-base md:text-lg leading-relaxed">
                  {currentVerse.translation}
                </p>
              </div>
            </div>

            {reflection && (
              <div className="mb-6 rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.01] p-5">
                <div className="font-serif-fine text-[10px] uppercase tracking-[0.22em] text-white/45 mb-2">
                  For what you carried here
                </div>
                <p className="font-serif-fine text-white/90 text-sm md:text-base leading-relaxed">
                  {reflection}
                </p>
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
                    <p className="font-serif-fine text-white/50 italic text-sm">
                      Finding where this verse lands…
                    </p>
                  )}
                  {!loadingContext && sections.length > 0 && (
                    <>
                      {sections
                        .filter(
                          (s) =>
                            s.key === "SCENE" ||
                            s.key === "MEANING" ||
                            s.key === "HITS",
                        )
                        .map(({ key, label, body }) => (
                          <div key={key}>
                            <div className="font-serif-fine text-[10px] uppercase tracking-[0.22em] text-white/40 mb-1.5">
                              {label}
                            </div>
                            <p className="font-serif-fine text-white/85 text-sm md:text-base leading-relaxed">
                              {body}
                            </p>
                          </div>
                        ))}
                      {sections.find((s) => s.key === "REFLECT") && (
                        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
                          <div className="font-serif-fine text-[10px] uppercase tracking-[0.22em] text-white/45 mb-2">
                            Reflect
                          </div>
                          <p className="font-serif-fine italic text-white text-base md:text-lg leading-relaxed">
                            {sections.find((s) => s.key === "REFLECT")!.body}
                          </p>
                        </div>
                      )}
                      {nextSection && (
                        <div className="mt-4">
                          <div className="font-serif-fine text-[10px] uppercase tracking-[0.22em] text-white/40 mb-2">
                            Read next
                          </div>
                          {nextVerse ? (
                            <button
                              onClick={() => onJumpToVerse(nextVerse)}
                              className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/25 px-4 py-3 text-left transition-colors"
                            >
                              <div>
                                <div className="font-serif-fine text-xs uppercase tracking-[0.18em] text-white/50">
                                  {nextVerse.surahName} · {nextVerse.ayah}
                                </div>
                                <div className="font-serif-fine text-sm text-white/80 mt-1 leading-snug">
                                  {nextRef?.reason}
                                </div>
                              </div>
                              <ArrowRight className="h-4 w-4 text-white/40 group-hover:text-white/90 group-hover:translate-x-0.5 transition-all" />
                            </button>
                          ) : (
                            <p className="font-serif-fine text-white/70 text-sm leading-relaxed">
                              {nextSection.body}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {!loadingContext && !context && (
                    <p className="font-serif-fine text-white/40 text-xs italic">
                      Context unavailable for this verse.
                    </p>
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
                  aria-label="Auto-continue recitation through Surah"
                >
                  <Volume2 className="h-3 w-3" />
                  Continue Surah
                </button>
              ) : (
                <button
                  onClick={handleStopAutoPlay}
                  className="flex items-center gap-1.5 rounded-full border border-[#ffd700]/30 bg-[#ffd700]/[0.04] px-4 py-2 text-[10px] uppercase tracking-[0.2em] font-serif-fine text-[#ffd700]/80 hover:text-[#ffd700] hover:border-[#ffd700]/60 transition-colors"
                  aria-label="Stop auto-continue"
                >
                  <StopCircle className="h-3 w-3" />
                  Stop
                </button>
              )}
              {autoStatus && (
                <p className="font-serif-fine text-[10px] italic text-white/40 animate-pulse">
                  {autoStatus}
                </p>
              )}
            </div>

            {/* Bottom action row — Screenshot + Video */}
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
                aria-label="Save verse as image"
              >
                <Camera className="h-3.5 w-3.5" />
                {capturing ? "Saving…" : "Screenshot"}
              </button>

              {!audioUrl && (
                <p className="text-center font-serif-fine text-[11px] italic text-white/40">
                  Loading recitation…
                </p>
              )}
              {recording && videoStatus && (
                <p className="text-center font-serif-fine text-[11px] italic text-white/50">
                  {videoStatus}
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  SCREENSHOT GENERATOR
// ═══════════════════════════════════════════════════════════════════════

interface ScreenshotArgs { verse: Verse; words: string[] }

async function screenshotVerseCanvas({ verse, words }: ScreenshotArgs): Promise<Blob> {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctxN = canvas.getContext("2d", { alpha: false });
  if (!ctxN) throw new Error("canvas 2d unavailable");
  const ctx: CanvasRenderingContext2D = ctxN;

  const ARABIC_FONT = `"Amiri", "Scheherazade New", "Traditional Arabic", serif`;
  const ENGLISH_FONT = `Georgia, "Times New Roman", serif`;
  const margin = 90;
  const arabicMaxW = W - margin * 2;

  function layoutArabicS(size: number): Array<{ words: Array<{ word: string; idx: number; width: number }>; totalW: number }> {
    ctx.font = `${size}px ${ARABIC_FONT}`;
    const spaceW = ctx.measureText(" ").width;
    const lines: Array<{ words: Array<{ word: string; idx: number; width: number }>; totalW: number }> = [{ words: [], totalW: 0 }];
    let line = lines[0]; let wLen = 0;
    for (let i = 0; i < words.length; i++) {
      const wm = ctx.measureText(words[i]).width;
      const need = wm + (line.words.length > 0 ? spaceW : 0);
      if (wLen + need > arabicMaxW && line.words.length > 0) {
        line.totalW = wLen;
        lines.push({ words: [], totalW: 0 }); line = lines[lines.length - 1]; wLen = 0;
      }
      if (line.words.length > 0) wLen += spaceW;
      line.words.push({ word: words[i], idx: i, width: wm }); wLen += wm;
    }
    line.totalW = wLen;
    return lines;
  }
  function wrapS(text: string, maxW: number, font: string): string[] {
    ctx.font = font;
    const tokens = text.split(/\s+/); const out: string[] = []; let line = "";
    for (const t of tokens) {
      const test = line ? line + " " + t : t;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = t; } else line = test;
    }
    if (line) out.push(line); return out;
  }

  let arabicSize = 110;
  let lines = layoutArabicS(arabicSize);
  while (lines.length > 4 && arabicSize > 64) { arabicSize -= 6; lines = layoutArabicS(arabicSize); }
  const arabicLineH = Math.round(arabicSize * 1.55);

  const transFont = `italic 30px ${ENGLISH_FONT}`;
  const translationFont = `40px ${ENGLISH_FONT}`;
  const translitLines = wrapS(verse.transliteration, arabicMaxW, transFont).slice(0, 3);
  const translationLines = wrapS(verse.translation, arabicMaxW, translationFont).slice(0, 5);

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);

  const rng = (n: number) => ((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;
  for (let i = 0; i < 120; i++) {
    const x = rng(i * 3) * W; const y = rng(i * 3 + 1) * H;
    const r = 0.6 + rng(i * 3 + 2) * 1.8;
    ctx.globalAlpha = 0.12 + rng(i) * 0.55;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  const glowY = H * 0.45;
  const glow = ctx.createRadialGradient(W / 2, glowY, 40, W / 2, glowY, W * 0.85);
  glow.addColorStop(0, "rgba(90, 70, 180, 0.45)");
  glow.addColorStop(0.35, "rgba(40, 50, 140, 0.22)");
  glow.addColorStop(0.8, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#C9A84C";
  ctx.font = `500 24px ${ENGLISH_FONT}`;
  ctx.textAlign = "right"; ctx.textBaseline = "top";
  ctx.fillText(`${verse.surahName} · ${verse.ayah}`, W - margin, margin);

  const blockH = lines.length * arabicLineH;
  const arabicStartY = glowY - blockH / 2 + arabicLineH * 0.15;
  ctx.font = `${arabicSize}px ${ARABIC_FONT}`;
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "center"; ctx.direction = "rtl";
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const y = arabicStartY + (li + 1) * arabicLineH;
    const spaceW = ctx.measureText(" ").width;
    let x = W / 2 + line.totalW / 2;
    ctx.shadowColor = "rgba(255, 220, 150, 0.3)"; ctx.shadowBlur = 14; ctx.fillStyle = "#ffffff";
    for (const item of line.words) {
      ctx.fillText(item.word, x - item.width / 2, y);
      x -= item.width + spaceW;
    }
  }
  ctx.shadowBlur = 0; ctx.direction = "ltr";

  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.font = transFont; ctx.fillStyle = "#888888";
  let ty = arabicStartY + blockH + 80;
  for (const ln of translitLines) { ctx.fillText(ln, W / 2, ty); ty += 42; }

  ctx.font = translationFont; ctx.fillStyle = "rgba(255,255,255,0.96)";
  ty += 28;
  for (const ln of translationLines) { ctx.fillText(ln, W / 2, ty); ty += 54; }

  // AYAT — bottom right, no URL
  ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = `500 22px ${ENGLISH_FONT}`;
  ctx.fillText("AYAT", W - margin, H - margin);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
      1.0,
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  VIDEO RECORDER — nuclear reset on every call
//
//  Every invocation:
//  1. Stops any leftover tracks / AudioContext nodes
//  2. Waits 300ms for the browser to release resources
//  3. Builds everything fresh: AudioContext, canvas stream, MediaRecorder
//  4. Pre-flight check before recording starts
//  5. Wraps entire flow in try/catch with visible status message on error
// ═══════════════════════════════════════════════════════════════════════

interface RecordArgs {
  verse: Verse;
  words: string[];
  audioUrl: string;
  segments: Segment[];
  onStatus: (s: string) => void;
}

// Global refs for cleanup between calls — module-level so they survive re-renders
let _activeAudioCtx: AudioContext | null = null;
let _activeStream: MediaStream | null = null;
let _activeRecorder: MediaRecorder | null = null;

async function recordVerseVideo({
  verse,
  words,
  audioUrl,
  segments,
  onStatus,
}: RecordArgs): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder unsupported in this browser.");
  }

  // ── NUCLEAR RESET ─────────────────────────────────────────────────
  onStatus("Resetting…");
  try { _activeRecorder?.stop(); } catch {}
  _activeRecorder = null;
  if (_activeStream) {
    for (const t of _activeStream.getTracks()) { try { t.stop(); } catch {} }
    _activeStream = null;
  }
  if (_activeAudioCtx) {
    try { await _activeAudioCtx.close(); } catch {}
    _activeAudioCtx = null;
  }
  // Give the browser 300ms to fully release hardware resources
  await new Promise((r) => setTimeout(r, 300));

  // ── CANVAS ────────────────────────────────────────────────────────
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctxNullable = canvas.getContext("2d", { alpha: false });
  if (!ctxNullable) throw new Error("canvas 2d unavailable");
  const ctx: CanvasRenderingContext2D = ctxNullable;

  // ── AUDIO GRAPH ───────────────────────────────────────────────────
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.src = audioUrl;

  type AudioCtxCtor = typeof AudioContext;
  const w = window as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error("AudioContext unsupported");

  const audioCtx = new Ctor();
  _activeAudioCtx = audioCtx;
  const source = audioCtx.createMediaElementSource(audio);
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(dest);
  source.connect(audioCtx.destination);

  // ── STREAM ────────────────────────────────────────────────────────
  const canvasStream = canvas.captureStream(30);
  _activeStream = canvasStream;
  for (const t of dest.stream.getAudioTracks()) canvasStream.addTrack(t);

  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm",
  ];
  const mimeType =
    candidates.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "video/webm";

  const recorder = new MediaRecorder(canvasStream, {
    mimeType,
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 192_000,
  });
  _activeRecorder = recorder;
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  // ── PARTICLES ─────────────────────────────────────────────────────
  type Particle = { x: number; y: number; r: number; speed: number; phase: number; alpha: number };
  const particles: Particle[] = [];
  for (let i = 0; i < 120; i++) {
    particles.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.6 + Math.random() * 2.0,
      speed: 4 + Math.random() * 12,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.15 + Math.random() * 0.65,
    });
  }

  // ── ARABIC LAYOUT ─────────────────────────────────────────────────
  const ARABIC_FONT = `"Amiri", "Scheherazade New", "Traditional Arabic", serif`;
  const ENGLISH_FONT = `Georgia, "Times New Roman", serif`;

  type LaidWord = { word: string; idx: number; width: number };
  type LaidLine = { words: LaidWord[]; totalW: number };

  function layoutArabic(maxW: number, size: number): LaidLine[] {
    ctx.font = `${size}px ${ARABIC_FONT}`;
    const spaceW = ctx.measureText(" ").width;
    const lines: LaidLine[] = [{ words: [], totalW: 0 }];
    let line = lines[0];
    let wLen = 0;
    for (let i = 0; i < words.length; i++) {
      const wm = ctx.measureText(words[i]).width;
      const need = wm + (line.words.length > 0 ? spaceW : 0);
      if (wLen + need > maxW && line.words.length > 0) {
        line.totalW = wLen;
        lines.push({ words: [], totalW: 0 });
        line = lines[lines.length - 1];
        wLen = 0;
      }
      if (line.words.length > 0) wLen += spaceW;
      line.words.push({ word: words[i], idx: i, width: wm });
      wLen += wm;
    }
    line.totalW = wLen;
    return lines;
  }

  const margin = 90;
  const arabicMaxW = W - margin * 2;
  let arabicSize = 110;
  let lines = layoutArabic(arabicMaxW, arabicSize);
  while (lines.length > 4 && arabicSize > 64) {
    arabicSize -= 6;
    lines = layoutArabic(arabicMaxW, arabicSize);
  }
  const arabicLineHeight = Math.round(arabicSize * 1.55);

  function wrapText(text: string, maxW: number, font: string): string[] {
    ctx.font = font;
    const tokens = text.split(/\s+/);
    const out: string[] = [];
    let line = "";
    for (const t of tokens) {
      const test = line ? line + " " + t : t;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = t; }
      else line = test;
    }
    if (line) out.push(line);
    return out;
  }

  const transFont = `italic 30px ${ENGLISH_FONT}`;
  const translationFont = `40px ${ENGLISH_FONT}`;
  const translitLines = wrapText(verse.transliteration, arabicMaxW, transFont).slice(0, 3);
  const translationLines = wrapText(verse.translation, arabicMaxW, translationFont).slice(0, 5);

  // ── FRAME RENDER ──────────────────────────────────────────────────
  let t0 = 0;
  function draw(now: number, currentIdx: number) {
    const tSec = t0 ? (now - t0) / 1000 : 0;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);

    for (const p of particles) {
      p.y -= p.speed * (1 / 30);
      if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; }
      const twinkle = 0.5 + 0.5 * Math.sin(tSec * 2 + p.phase);
      ctx.globalAlpha = p.alpha * twinkle;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const glowY = H * 0.45;
    const glow = ctx.createRadialGradient(W / 2, glowY, 40, W / 2, glowY, W * 0.85);
    glow.addColorStop(0, "rgba(90, 70, 180, 0.45)");
    glow.addColorStop(0.35, "rgba(40, 50, 140, 0.22)");
    glow.addColorStop(0.8, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#C9A84C";
    ctx.font = `500 24px ${ENGLISH_FONT}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`${verse.surahName} · ${verse.ayah}`, W - margin, margin);

    const blockH = lines.length * arabicLineHeight;
    const arabicStartY = glowY - blockH / 2 + arabicLineHeight * 0.15;
    ctx.font = `${arabicSize}px ${ARABIC_FONT}`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    ctx.direction = "rtl";

    const pulse = 0.75 + 0.25 * Math.sin(tSec * 6);

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const y = arabicStartY + (li + 1) * arabicLineHeight;
      const cx = W / 2;
      const total = line.totalW;
      const spaceW = ctx.measureText(" ").width;
      let x = cx + total / 2;
      for (const item of line.words) {
        const active = item.idx === currentIdx;
        const wordCenterX = x - item.width / 2;
        if (active) {
          ctx.shadowColor = `rgba(255, 215, 100, ${0.95 * pulse})`;
          ctx.shadowBlur = 50 * pulse;
          ctx.fillStyle = "#FFE27A";
        } else {
          ctx.shadowColor = "rgba(255, 220, 150, 0.35)";
          ctx.shadowBlur = 14;
          ctx.fillStyle = "#ffffff";
        }
        ctx.fillText(item.word, wordCenterX, y);
        x -= item.width + spaceW;
      }
    }
    ctx.shadowBlur = 0;
    ctx.direction = "ltr";

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = transFont;
    ctx.fillStyle = "#888888";
    let ty = arabicStartY + blockH + 80;
    for (const ln of translitLines) { ctx.fillText(ln, W / 2, ty); ty += 42; }

    ctx.font = translationFont;
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ty += 28;
    for (const ln of translationLines) { ctx.fillText(ln, W / 2, ty); ty += 54; }

    // AYAT only — no URL
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `500 22px ${ENGLISH_FONT}`;
    ctx.fillText("AYAT", W - margin, H - margin);
  }

  draw(performance.now(), -1);
  onStatus("Starting…");

  return new Promise<Blob>((resolve, reject) => {
    let stopped = false;
    let rafId = 0;
    let settled = false;
    const settleResolve = (v: Blob) => { if (!settled) { settled = true; resolve(v); } };
    const settleReject = (e: Error) => { if (!settled) { settled = true; reject(e); } };

    const cleanup = () => {
      try { cancelAnimationFrame(rafId); } catch {}
      try { audio.pause(); } catch {}
      try { audio.src = ""; audio.load(); } catch {}
      try { source.disconnect(); } catch {}
      try { dest.disconnect(); } catch {}
      try { for (const tr of canvasStream.getTracks()) tr.stop(); } catch {}
      audioCtx.close().catch(() => {});
      _activeAudioCtx = null;
      _activeStream = null;
      _activeRecorder = null;
    };

    recorder.onstop = () => {
      setTimeout(() => {
        cleanup();
        settleResolve(new Blob(chunks, { type: mimeType }));
      }, 120);
    };
    recorder.onerror = (ev) => {
      cleanup();
      settleReject(new Error(`recorder error: ${(ev as Event).type}`));
    };

    const onReady = async () => {
      try {
        // ── PRE-FLIGHT CHECK ───────────────────────────────────────
        if (canvasStream.getTracks().length === 0) {
          throw new Error("Canvas stream has no tracks");
        }
        if (audioCtx.state === "closed") {
          throw new Error("AudioContext was closed before recording");
        }
        if (audio.readyState < 2) {
          // HAVE_CURRENT_DATA minimum needed
          throw new Error("Audio not ready");
        }

        await audioCtx.resume();
        recorder.start(100);
        await audio.play();
        t0 = performance.now();
        onStatus("Recording…");

        const render = () => {
          if (stopped) return;
          const tMs = audio.currentTime * 1000;
          const idx = activeWordAt(segments, tMs);
          draw(performance.now(), idx);
          rafId = requestAnimationFrame(render);
        };
        rafId = requestAnimationFrame(render);
      } catch (err) {
        settleReject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    audio.addEventListener("canplaythrough", onReady, { once: true });
    audio.addEventListener(
      "loadeddata",
      () => { if (!stopped && !t0) onReady(); },
      { once: true },
    );
    audio.addEventListener(
      "ended",
      () => {
        if (stopped) return;
        stopped = true;
        onStatus("Processing…");
        setTimeout(() => { try { recorder.stop(); } catch {} }, 250);
      },
      { once: true },
    );
    audio.addEventListener(
      "error",
      () => { settleReject(new Error("audio load failed")); },
      { once: true },
    );

    try { audio.load(); } catch {}
  });
}
