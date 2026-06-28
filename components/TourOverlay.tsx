"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export const TOUR_KEY = "ayat:tour:v1";
export const TOUR_STEPS = 5; // 0=welcome 1=galaxy 2=theme 3=ask 4=done

// ── Step definitions ───────────────────────────────────────────────────────

type StepDef =
  | { type: "welcome"; title: string; lines: string[] }
  | { type: "pill";    eyebrow: string; title: string; sub: string; hint: string }
  | { type: "top";     eyebrow: string; title: string; body: string; arrowLabel: string }
  | { type: "toast";   title: string };

const STEPS: StepDef[] = [
  {
    type: "welcome",
    title: "6,236 stars.\nEach one is a verse.",
    lines: [
      "AYAT renders the entire Quran as a living galaxy. Verses that share a theme cluster together - like constellations of meaning.",
      "Blue stars = Meccan surahs (faith, soul, God)  ·  Gold = Medinan (law, community, ethics)",
      "Three things to try →  tap a star  ·  search a theme  ·  describe a verse by voice",
    ],
  },
  {
    type: "pill",
    eyebrow: "Step 1 of 3",
    title: "Tap any star.",
    sub: "Stars are everywhere - look around the field, not just the center.\nBlue = Meccan · Gold = Medinan · Drag to orbit · Pinch / scroll to zoom",
    hint: "Go ahead - tap any star you see",
  },
  {
    type: "top",
    eyebrow: "Step 2 of 3  ·  Theme Search",
    title: "Type a theme.\nThe galaxy answers.",
    body: "Type FORGIVENESS, PATIENCE, GRIEF, LIGHT - anything.\n\nEvery verse carrying that meaning lights up. The rest dims. You're looking at a constellation of meaning.\n\nTry one now ↓",
    arrowLabel: "Type in the search bar below ↓",
  },
  {
    type: "top",
    eyebrow: "Step 3 of 3  ·  Verse Detective",
    title: "Half-remember a verse?\nJust describe it.",
    body: "Tap Ask, then type - or tap the mic and speak in Arabic or English.\n\n\"the verse about iron being sent down\"\n\"God is closer than your jugular vein\"\n\"two seas that don't mix\"\n\nIt finds the verse. Try it ↓",
    arrowLabel: "Tap Ask in the bar below ↓",
  },
  {
    type: "toast",
    title: "The galaxy is yours.",
  },
];

// ── Root ───────────────────────────────────────────────────────────────────

interface TourOverlayProps {
  step: number;
  onNext: () => void;
  onEnd: () => void;
}

export function TourOverlay({ step, onNext, onEnd }: TourOverlayProps) {
  const def = STEPS[step];
  if (!def) return null;

  switch (def.type) {
    case "welcome": return <WelcomeStep def={def} onNext={onNext} onEnd={onEnd} />;
    case "pill":    return <PillStep    def={def} onNext={onNext} onEnd={onEnd} />;
    case "top":     return <TopStep     def={def} onNext={onNext} onEnd={onEnd} />;
    case "toast":   return <ToastStep   def={def} onEnd={onEnd} />;
  }
}

// ── Shared font style ──────────────────────────────────────────────────────
const SERIF: React.CSSProperties = {
  fontFamily: "'Cormorant Garamond', Georgia, serif",
};

// ── Welcome ────────────────────────────────────────────────────────────────

function WelcomeStep({ def, onNext, onEnd }: { def: Extract<StepDef, { type: "welcome" }>; onNext: () => void; onEnd: () => void }) {
  // CTA becomes active after 1.6 s so users see at least the headline before skipping
  const [ctaReady, setCtaReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setCtaReady(true), 1600);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      style={{
        position: "fixed", inset: 0, zIndex: 70,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        textAlign: "center",
        padding: "2rem 1.5rem",
        background: "radial-gradient(ellipse at 50% 38%, rgba(5,6,14,0.94) 0%, rgba(3,4,10,0.98) 100%)",
        overflowY: "auto",
      }}
    >
      {/* Brand */}
      <motion.div
        initial={{ opacity: 0, letterSpacing: "0.8em" }}
        animate={{ opacity: 1, letterSpacing: "0.35em" }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        style={{ ...SERIF, fontSize: "0.7rem", color: "rgba(245,215,100,0.6)", textTransform: "uppercase", marginBottom: "1.75rem" }}
      >
        A &nbsp; Y &nbsp; A &nbsp; T
      </motion.div>

      {/* Headline */}
      <motion.h1
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        style={{ ...SERIF, fontSize: "clamp(1.75rem, 6.5vw, 3.5rem)", fontWeight: 400, color: "rgba(255,255,255,0.97)", lineHeight: 1.1, marginBottom: "1.5rem", whiteSpace: "pre-line", maxWidth: 540 }}
      >
        {def.title}
      </motion.h1>

      {/* Three-line explainer - each line fades in separately */}
      <div style={{ maxWidth: 460, marginBottom: "2.25rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        {def.lines.map((line, i) => (
          <motion.p
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.75 + i * 0.35, duration: 0.8 }}
            style={{
              ...SERIF,
              fontSize: i === 2
                ? "clamp(0.8rem, 2vw, 0.9rem)"
                : "clamp(0.875rem, 2.2vw, 1rem)",
              color: i === 2 ? "rgba(245,215,100,0.55)" : "rgba(255,255,255,0.58)",
              lineHeight: 1.75,
              fontStyle: i === 2 ? "italic" : "normal",
            }}
          >
            {line}
          </motion.p>
        ))}
      </div>

      {/* CTA row */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: ctaReady ? 1 : 0, y: ctaReady ? 0 : 10 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.9rem" }}
      >
        <motion.button
          onClick={ctaReady ? onNext : undefined}
          whileHover={ctaReady ? { scale: 1.04 } : {}}
          whileTap={ctaReady ? { scale: 0.97 } : {}}
          style={{
            ...SERIF,
            fontSize: "0.8125rem", letterSpacing: "0.2em", textTransform: "uppercase",
            color: ctaReady ? "rgba(245,215,100,0.9)" : "rgba(245,215,100,0.3)",
            background: "rgba(245,215,100,0.07)",
            border: `1px solid ${ctaReady ? "rgba(245,215,100,0.3)" : "rgba(245,215,100,0.1)"}`,
            borderRadius: "100px",
            padding: "0.8rem 2.5rem",
            cursor: ctaReady ? "pointer" : "default",
            transition: "color 0.3s, border-color 0.3s",
          }}
        >
          Show me the galaxy →
        </motion.button>
        {ctaReady && (
          <button
            onClick={onEnd}
            style={{ ...SERIF, fontSize: "0.65rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            skip
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── Pill (step 1 - tap a star) ─────────────────────────────────────────────

function PillStep({
  def,
  onNext,
  onEnd,
}: {
  def: Extract<StepDef, { type: "pill" }>;
  onNext: () => void;
  onEnd: () => void;
}) {
  return (
    <>
      {/* Near-invisible overlay - galaxy still clickable */}
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 71,
          background: "rgba(0,0,0,0.15)",
          pointerEvents: "none",
        }}
      />

      {/* Floating pill - top-center */}
      <div style={{ position: "fixed", top: "1.25rem", left: "50%", zIndex: 72, transform: "translateX(-50%)", width: "min(400px, calc(100vw - 2rem))" }}>
        <motion.div
          initial={{ opacity: 0, y: -18, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          style={{
            borderRadius: "20px",
            border: "1px solid rgba(255,255,255,0.13)",
            background: "rgba(6,7,15,0.90)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            padding: "1rem 1.125rem 0.875rem",
            boxShadow: "0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
          }}
        >
          {/* Top row: eyebrow + skip */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ ...SERIF, fontSize: "0.6rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(245,215,100,0.55)" }}>
              {def.eyebrow}
            </span>
            <button
              onClick={onEnd}
              style={{ ...SERIF, fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              skip tour
            </button>
          </div>

          {/* Title */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.5rem" }}>
            {/* Pulsing tap indicator */}
            <span style={{ position: "relative", flexShrink: 0, width: 28, height: 28 }}>
              <span style={{
                position: "absolute", inset: 0, borderRadius: "50%",
                background: "rgba(245,215,100,0.15)",
                animation: "tap-ring 1.6s ease-out infinite",
              }} />
              <span style={{
                position: "absolute", inset: "6px", borderRadius: "50%",
                background: "rgba(245,215,100,0.65)",
                animation: "tap-dot 1.6s ease-in-out infinite",
              }} />
            </span>
            <h2 style={{ ...SERIF, fontSize: "clamp(1.1rem, 4vw, 1.375rem)", fontWeight: 400, color: "rgba(255,255,255,0.95)", margin: 0 }}>
              {def.title}
            </h2>
          </div>

          {/* Sub - split by newline so we can style separately */}
          {def.sub.split("\n").map((line, i) => (
            <p key={i} style={{
              ...SERIF,
              fontSize: i === 0 ? "0.8rem" : "0.72rem",
              color: i === 0 ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.32)",
              margin: i === 0 ? "0 0 0.3rem 2.25rem" : "0 0 0.75rem 2.25rem",
              lineHeight: 1.5,
            }}>
              {line}
            </p>
          ))}

          {/* Hint row */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.45rem",
            padding: "0.45rem 0.75rem",
            borderRadius: "8px",
            background: "rgba(245,215,100,0.06)",
            border: "1px solid rgba(245,215,100,0.14)",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              background: "rgba(245,215,100,0.85)",
              animation: "pulse-dot 2s ease-in-out infinite",
            }} />
            <span style={{ ...SERIF, fontSize: "0.78rem", color: "rgba(245,215,100,0.7)", fontStyle: "italic" }}>
              {def.hint}
            </span>
          </div>
        </motion.div>
      </div>

      <style>{`
        @keyframes tap-ring {
          0%   { transform: scale(0.6); opacity: 0.9; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes tap-dot {
          0%, 100% { transform: scale(1);    opacity: 0.8; }
          50%       { transform: scale(0.75); opacity: 1; }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.5); }
        }
        @keyframes arrow-drop {
          0%, 100% { transform: translateY(0);   opacity: 0.55; }
          50%       { transform: translateY(6px); opacity: 1; }
        }
        @keyframes chevron-fall {
          0%        { opacity: 0;   transform: translateY(-4px); }
          40%, 60%  { opacity: 0.9; transform: translateY(0); }
          100%      { opacity: 0;   transform: translateY(4px); }
        }
      `}</style>
    </>
  );
}

// ── Top card (steps 2 & 3 - search bar interactions) ──────────────────────

function TopStep({
  def,
  onNext,
  onEnd,
}: {
  def: Extract<StepDef, { type: "top" }>;
  onNext: () => void;
  onEnd: () => void;
}) {
  return (
    <>
      {/* Gradient overlay: dark top, clear bottom so search bar is tappable */}
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 71,
          background: "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.75) 52%, rgba(0,0,0,0.08) 80%, rgba(0,0,0,0) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Card - top of screen */}
      <div style={{ position: "fixed", top: "1.25rem", left: "50%", zIndex: 72, transform: "translateX(-50%)", width: "min(420px, calc(100vw - 2rem))" }}>
        <motion.div
          key={def.eyebrow}
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          style={{
            borderRadius: "18px",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(6,7,15,0.93)",
            backdropFilter: "blur(22px)",
            WebkitBackdropFilter: "blur(22px)",
            padding: "1.125rem 1.25rem 1rem",
            boxShadow: "0 16px 52px rgba(0,0,0,0.65)",
          }}
        >
          {/* Eyebrow */}
          <div style={{ ...SERIF, fontSize: "0.6rem", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(245,215,100,0.55)", marginBottom: "0.45rem" }}>
            {def.eyebrow}
          </div>

          {/* Title */}
          <h2 style={{ ...SERIF, fontSize: "clamp(1.1rem, 4.5vw, 1.5rem)", fontWeight: 400, color: "rgba(255,255,255,0.96)", lineHeight: 1.15, marginBottom: "0.75rem", whiteSpace: "pre-line" }}>
            {def.title}
          </h2>

          {/* Body - split by \n so each line is separate */}
          <div style={{ marginBottom: "0.875rem" }}>
            {def.body.split("\n").map((line, i) => (
              line.trim() ? (
                <p key={i} style={{
                  ...SERIF,
                  fontSize: "clamp(0.8rem, 2.1vw, 0.875rem)",
                  color: line.startsWith('"') ? "rgba(245,215,100,0.6)" : "rgba(255,255,255,0.55)",
                  lineHeight: 1.65,
                  fontStyle: line.startsWith('"') ? "italic" : "normal",
                  margin: "0 0 0.2rem",
                }}>
                  {line}
                </p>
              ) : <div key={i} style={{ height: "0.4rem" }} />
            ))}
          </div>

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button
              onClick={onEnd}
              style={{ ...SERIF, fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              end tour
            </button>
            <button
              onClick={onNext}
              style={{ ...SERIF, fontSize: "0.65rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(245,215,100,0.85)", background: "rgba(245,215,100,0.07)", border: "1px solid rgba(245,215,100,0.24)", borderRadius: "100px", padding: "0.35rem 1rem", cursor: "pointer" }}
            >
              next →
            </button>
          </div>
        </motion.div>

        {/* Animated arrow pointing down toward search bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "0.6rem", gap: "2px" }}
        >
          <span style={{ ...SERIF, fontSize: "0.7rem", color: "rgba(245,215,100,0.65)", letterSpacing: "0.08em", marginBottom: "4px" }}>
            {def.arrowLabel}
          </span>
          {[0, 1, 2].map((i) => (
            <svg key={i} width="14" height="8" viewBox="0 0 14 8" fill="none"
              style={{ animation: `chevron-fall 1.2s ease-in-out ${i * 0.18}s infinite`, opacity: 0 }}>
              <path d="M1 1L7 7L13 1" stroke="rgba(245,215,100,0.65)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ))}
        </motion.div>
      </div>
    </>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────

function ToastStep({ def, onEnd }: { def: Extract<StepDef, { type: "toast" }>; onEnd: () => void }) {
  useEffect(() => {
    const t = setTimeout(onEnd, 2800);
    return () => clearTimeout(t);
  }, [onEnd]);

  return (
    <div style={{ position: "fixed", top: "1.25rem", left: "50%", zIndex: 72, transform: "translateX(-50%)" }}>
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{
          display: "flex", alignItems: "center", gap: "0.55rem",
          background: "rgba(6,7,15,0.92)",
          border: "1px solid rgba(245,215,100,0.28)",
          borderRadius: "100px",
          padding: "0.5rem 1.25rem 0.5rem 0.875rem",
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "rgba(245,215,100,0.85)", flexShrink: 0 }} />
        <span style={{ ...SERIF, fontSize: "0.875rem", color: "rgba(255,255,255,0.85)" }}>
          {def.title}
        </span>
      </motion.div>
    </div>
  );
}
