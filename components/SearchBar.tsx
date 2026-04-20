"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X, Sparkles, Mic, MicOff, Globe } from "lucide-react";
import type { Verse } from "@/lib/types";

type Mode = "theme" | "ask";
type VoiceLang = "ar-SA" | "en-US";

export type DetectiveMatch = {
  surah: number;
  ayah: number;
  confidence: number;
  reason: string;
};

interface SearchBarProps {
  onSearch: (q: string) => void;
  matchCount: number | null;
  activeQuery: string;
  verses: Verse[] | null;
  onDetective: (matches: DetectiveMatch[], query: string) => void;
}

const THEME_SUGGESTIONS = [
  "patience",
  "mercy",
  "prayer",
  "light",
  "knowledge",
  "charity",
  "gratitude",
  "forgiveness",
];

const ASK_SUGGESTIONS = [
  "the ant warning about Solomon's army",
  "something about iron being sent down",
  "revealed when people accused Aisha",
  "Qul huwa Allahu ahad",
];

// ── Web Speech API types ───────────────────────────────────────────────
type SpeechResult = { transcript: string };
type SpeechEvent = {
  results: ArrayLike<ArrayLike<SpeechResult> & { isFinal?: boolean }>;
};
type SpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
};
type SRCtor = new () => SpeechRecognition;

export function SearchBar({
  onSearch,
  matchCount,
  activeQuery,
  verses,
  onDetective,
}: SearchBarProps) {
  const [mode, setMode] = useState<Mode>("theme");
  const [q, setQ] = useState("");
  const [feeling, setFeeling] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const askErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Speech recognition
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceLang, setVoiceLang] = useState<VoiceLang>("ar-SA");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  // Tracks the latest committed voice transcript so onend can auto-submit
  // without relying on stale closure state.
  const latestFeelingRef = useRef("");

  // Debounce timers
  const themeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const askDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a stable ref to submitAsk so recognition callbacks always call
  // the version that sees the current verses/asking state.
  const submitAskRef = useRef<(value: string) => void>(() => {});

  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      SpeechRecognition?: SRCtor;
      webkitSpeechRecognition?: SRCtor;
    };
    setMicSupported(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);

  // Auto-dismiss ask errors after 5 s
  const showAskError = (msg: string) => {
    setAskError(msg);
    if (askErrorTimerRef.current) clearTimeout(askErrorTimerRef.current);
    askErrorTimerRef.current = setTimeout(() => setAskError(null), 5000);
  };

  // Clean up debounce timers on unmount
  useEffect(() => {
    return () => {
      if (themeDebounceRef.current) clearTimeout(themeDebounceRef.current);
      if (askDebounceRef.current) clearTimeout(askDebounceRef.current);
      if (askErrorTimerRef.current) clearTimeout(askErrorTimerRef.current);
    };
  }, []);

  const submitTheme = (value: string) => {
    const trimmed = value.trim();
    setQ(trimmed);
    onSearch(trimmed);
  };

  const submitAsk = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !verses || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      const r = await fetch("/api/reflect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const d = await r.json();
      if (!r.ok) {
        showAskError(d.error ?? "Something went wrong.");
        return;
      }
      const matches: DetectiveMatch[] = Array.isArray(d.matches)
        ? d.matches
        : [];
      if (matches.length === 0) {
        showAskError(d.message ?? "No strong match. Try a more specific detail.");
        return;
      }
      onDetective(matches, trimmed);
      // Keep the ask query visible so the user can see what they searched.
      // They can clear it manually with the X button.
      setInterim("");
    } catch {
      showAskError("Network hiccup. Try again.");
    } finally {
      setAsking(false);
    }
  };

  // Keep the ref current after every render
  useEffect(() => { submitAskRef.current = submitAsk; });

  // Theme input change — debounce 1500ms, also fires immediately on Enter
  const handleThemeChange = (value: string) => {
    setQ(value);
    if (themeDebounceRef.current) clearTimeout(themeDebounceRef.current);
    themeDebounceRef.current = setTimeout(() => submitTheme(value), 1500);
  };

  // Ask input change — debounce 1500ms
  const handleAskChange = (value: string) => {
    setFeeling(value);
    latestFeelingRef.current = value;
    if (askDebounceRef.current) clearTimeout(askDebounceRef.current);
    if (value.trim()) {
      askDebounceRef.current = setTimeout(() => submitAsk(value), 1500);
    }
  };

  const startListening = () => {
    if (listening) return;
    const w = window as unknown as {
      SpeechRecognition?: SRCtor;
      webkitSpeechRecognition?: SRCtor;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = voiceLang;
    rec.interimResults = true;
    rec.continuous = false;

    rec.onresult = (e: SpeechEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        const first = res[0];
        if (!first) continue;
        if (res.isFinal) finalText += first.transcript;
        else interimText += first.transcript;
      }
      if (finalText) {
        // Update both state and the ref so onend can read the latest value
        setFeeling((prev) => {
          const next = (prev ? prev + " " : "") + finalText.trim();
          latestFeelingRef.current = next;
          return next;
        });
        setInterim("");
      } else {
        setInterim(interimText);
      }
    };
    rec.onerror = () => {
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      // Auto-submit whatever was captured — browser already detected silence
      const captured = latestFeelingRef.current.trim();
      if (captured) {
        // Brief delay so React state has flushed before submitAsk reads it
        setTimeout(() => submitAskRef.current(captured), 150);
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const stopListening = () => {
    try {
      recognitionRef.current?.stop();
    } catch {}
    setListening(false);
  };

  const toggleVoiceLang = () => {
    if (listening) stopListening();
    setVoiceLang((prev) => (prev === "ar-SA" ? "en-US" : "ar-SA"));
  };

  const isArabicVoice = voiceLang === "ar-SA";
  const liveText = interim
    ? `${feeling}${feeling ? " " : ""}${interim}`
    : feeling;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 pointer-events-none">
      {mode === "theme" && activeQuery && matchCount !== null && matchCount > 0 && (
        <div className="mb-4 flex justify-center pointer-events-none">
          <p className="font-serif-fine text-[11px] tracking-[0.2em] uppercase text-white/35">
            <span className="tabular-nums text-white/55">{matchCount}</span>
            <span className="mx-2">·</span>
            <span className="italic normal-case tracking-normal text-white/45">
              {activeQuery}
            </span>
          </p>
        </div>
      )}

      <div className="mx-auto max-w-xl px-6 pb-8 pointer-events-auto">
        {/* Mode toggle */}
        <div className="mb-3 flex items-center justify-center gap-4 text-[14px] uppercase tracking-[0.25em] font-serif-fine">
          <button
            onClick={() => setMode("theme")}
            className={`transition-colors ${mode === "theme" ? "text-white" : "text-white/35 hover:text-white/65"}`}
          >
            Theme
          </button>
          <span className="text-white/15">·</span>
          <button
            onClick={() => setMode("ask")}
            className={`flex items-center gap-1.5 transition-colors ${mode === "ask" ? "text-white" : "text-white/35 hover:text-white/65"}`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Ask
          </button>
        </div>

        {mode === "theme" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (themeDebounceRef.current) clearTimeout(themeDebounceRef.current);
              submitTheme(q);
            }}
            className="relative"
          >
            <div className="flex items-center gap-3 border-b border-white/30 focus-within:border-white/80 transition-colors py-3">
              <Search className="h-4 w-4 text-white/50" aria-hidden="true" />
              <input
                type="text"
                value={q}
                onChange={(e) => handleThemeChange(e.target.value)}
                placeholder="Search a theme · patience, mercy, prayer…"
                className="w-full bg-transparent font-serif-fine text-base md:text-lg text-white placeholder:text-white/30 outline-none"
                aria-label="Search by theme"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => {
                    if (themeDebounceRef.current) clearTimeout(themeDebounceRef.current);
                    submitTheme("");
                  }}
                  className="p-1 text-white/40 hover:text-white/80 transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (askDebounceRef.current) clearTimeout(askDebounceRef.current);
              submitAsk(feeling);
            }}
            className="relative"
          >
            <div className="flex items-center gap-3 border-b border-white/30 focus-within:border-white/80 transition-colors py-3">
              <Sparkles className="h-4 w-4 text-white/50" aria-hidden="true" />
              <input
                type="text"
                value={liveText}
                onChange={(e) => handleAskChange(e.target.value)}
                disabled={asking}
                dir={isArabicVoice && listening ? "rtl" : "ltr"}
                placeholder={
                  asking
                    ? "Searching…"
                    : listening
                      ? isArabicVoice
                        ? "Listening · recite in Arabic…"
                        : "Listening · describe in English…"
                      : "Describe a verse, a story, a feeling…"
                }
                className="w-full bg-transparent font-serif-fine text-base md:text-lg text-white placeholder:text-white/30 outline-none disabled:opacity-60"
                aria-label="Describe what you're looking for"
                maxLength={500}
              />
              {micSupported && (
                <button
                  type="button"
                  onClick={toggleVoiceLang}
                  className="flex items-center gap-1 p-1 text-white/40 hover:text-white/80 transition-colors"
                  aria-label={`Voice language: ${isArabicVoice ? "Arabic" : "English"}. Tap to switch.`}
                  title={`Voice: ${isArabicVoice ? "Arabic (ar-SA)" : "English (en-US)"}`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-serif-fine tracking-[0.15em]">
                    {isArabicVoice ? "AR" : "EN"}
                  </span>
                </button>
              )}
              {micSupported && (
                <button
                  type="button"
                  onClick={listening ? stopListening : startListening}
                  className={`p-1 transition-colors ${listening ? "text-[#ffd700]" : "text-white/40 hover:text-white/80"}`}
                  aria-label={
                    listening ? "Stop listening" : "Start voice input"
                  }
                  title={listening ? "Listening · tap to stop" : "Voice input"}
                >
                  {listening ? (
                    <MicOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </button>
              )}
              {feeling && !asking && !listening && (
                <button
                  type="button"
                  onClick={() => {
                    setFeeling("");
                    latestFeelingRef.current = "";
                    setInterim("");
                    if (askDebounceRef.current) clearTimeout(askDebounceRef.current);
                  }}
                  className="p-1 text-white/40 hover:text-white/80 transition-colors"
                  aria-label="Clear"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {askError && (
              <p className="mt-2 font-serif-fine text-xs italic text-white/55">
                {askError}
              </p>
            )}
            {listening && (
              <p
                className="mt-2 font-serif-fine text-[11px] italic text-white/45"
                dir={isArabicVoice ? "rtl" : "ltr"}
              >
                {isArabicVoice
                  ? "تفضّل · سأُريك ما سمعت. سيُرسَل تلقائياً عند صمتك."
                  : "Speak now · will search automatically when you go silent."}
              </p>
            )}
          </form>
        )}

        {mode === "theme" && !activeQuery && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {THEME_SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  if (themeDebounceRef.current) clearTimeout(themeDebounceRef.current);
                  submitTheme(s);
                }}
                className="rounded-full border border-white/10 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.08] px-3 py-1 text-xs font-serif-fine text-white/60 hover:text-white transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {mode === "ask" && !asking && !feeling && !listening && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {ASK_SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => submitAsk(s)}
                className="rounded-full border border-white/10 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.08] px-3 py-1 text-xs font-serif-fine italic text-white/60 hover:text-white transition-colors max-w-full truncate"
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
