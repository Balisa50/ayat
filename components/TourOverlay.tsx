"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export const TOUR_KEY = "ayat:tour:v1";
export const TOUR_STEPS = 5; // 0=welcome 1=galaxy 2=theme 3=ask 4=done

// ── Step copy ──────────────────────────────────────────────────────────────

type StepDef = {
  type: "welcome" | "tip" | "toast";
  tipPos?: "center" | "low";
  eyebrow?: string;
  title: string;
  body: string;
  sub?: string;
  actionHint?: string;
};

const STEPS: StepDef[] = [
  {
    type: "welcome",
    title: "Not an app.\nA universe.",
    body: "AYAT renders all 6,236 verses of the Quran as a living star field. Each star is a verse — positioned by meaning, not scripture order. Verses that speak of the same things draw toward each other like constellations.",
    sub: "This is an exploration space. Not a full Quran reader. Not a memorisation tool. Not a tafsir database — those have better homes. AYAT is for wandering, and for finding the verse you didn't know you were looking for.",
  },
  {
    type: "tip",
    tipPos: "center",
    eyebrow: "The Galaxy",
    title: "Each star is a verse.",
    body: "Blue stars are Meccan revelations — earlier, philosophical, intimate.\nGold stars are Medinan — communal, legal, historical.\n\nDrag to orbit. Scroll or pinch to zoom.",
    actionHint: "Tap any star to continue →",
  },
  {
    type: "tip",
    tipPos: "low",
    eyebrow: "Theme Search",
    title: "Search by meaning,\nnot keywords.",
    body: "Type a theme in the bar below — FORGIVENESS, PATIENCE, LIGHT, JUSTICE — and the galaxy dims everything irrelevant. Only the verses that carry that meaning glow.\n\nIt reads intent. Not exact words.",
    actionHint: "Type a theme below to continue →",
  },
  {
    type: "tip",
    tipPos: "low",
    eyebrow: "Verse Detective",
    title: "Describe.\nDon't search.",
    body: "Switch to Ask. Half-remember a verse? A feeling? A story from the prophets? Describe it — the detective finds it, grounded in the real dataset. No hallucinations.\n\nNot a chatbot. A detective.",
    actionHint: "Try Ask below, or skip →",
  },
  {
    type: "toast",
    title: "The galaxy is yours.",
    body: "",
  },
];

// ── Props ──────────────────────────────────────────────────────────────────

interface TourOverlayProps {
  step: number; // -1 = hidden; 0-4 = active step
  onNext: () => void;
  onEnd: () => void;
}

// ── Root ───────────────────────────────────────────────────────────────────

export function TourOverlay({ step, onNext, onEnd }: TourOverlayProps) {
  const def = STEPS[step];
  if (!def) return null;

  if (def.type === "welcome") return <WelcomeStep def={def} onNext={onNext} />;
  if (def.type === "tip")     return <TipStep def={def} onNext={onNext} onEnd={onEnd} />;
  if (def.type === "toast")   return <ToastStep def={def} onEnd={onEnd} />;
  return null;
}

// ── Welcome ────────────────────────────────────────────────────────────────

function WelcomeStep({ def, onNext }: { def: StepDef; onNext: () => void }) {
  return (
    <motion.div
      key="welcome"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        textAlign: "center",
        padding: "2rem",
        background: "radial-gradient(ellipse at 50% 40%, rgba(5,6,14,0.93) 0%, rgba(3,4,10,0.97) 100%)",
      }}
    >
      {/* Logo mark */}
      <motion.div
        initial={{ opacity: 0, letterSpacing: "0.6em" }}
        animate={{ opacity: 1, letterSpacing: "0.35em" }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        style={{
          fontFamily: "var(--font-serif-fine, 'Cormorant Garamond', serif)",
          fontSize: "0.75rem",
          color: "rgba(245,215,100,0.65)",
          textTransform: "uppercase",
          marginBottom: "2.5rem",
          letterSpacing: "0.35em",
        }}
      >
        A &nbsp; Y &nbsp; A &nbsp; T
      </motion.div>

      {/* Headline */}
      <motion.h1
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        style={{
          fontFamily: "var(--font-serif-fine, 'Cormorant Garamond', serif)",
          fontSize: "clamp(2rem, 6vw, 3.75rem)",
          fontWeight: 400,
          color: "rgba(255,255,255,0.96)",
          lineHeight: 1.1,
          marginBottom: "2rem",
          whiteSpace: "pre-line",
          maxWidth: "640px",
        }}
      >
        {def.title}
      </motion.h1>

      {/* Body */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.3, duration: 1.0 }}
        style={{
          fontFamily: "var(--font-serif-fine, 'Cormorant Garamond', serif)",
          fontSize: "clamp(0.9rem, 2.2vw, 1.0625rem)",
          color: "rgba(255,255,255,0.65)",
          lineHeight: 1.75,
          maxWidth: "520px",
          marginBottom: "1.5rem",
        }}
      >
        {def.body}
      </motion.p>

      {/* Sub — what it is / isn't */}
      {def.sub && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.1, duration: 1.0 }}
          style={{
            fontFamily: "var(--font-serif-fine, 'Cormorant Garamond', serif)",
            fontSize: "clamp(0.78rem, 1.8vw, 0.875rem)",
            color: "rgba(255,255,255,0.36)",
            lineHeight: 1.8,
            maxWidth: "480px",
            marginBottom: "2.75rem",
            fontStyle: "italic",
          }}
        >
          {def.sub}
        </motion.p>
      )}

      {/* CTA */}
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.9, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        onClick={onNext}
        style={{
          fontFamily: "var(--font-serif-fine, 'Cormorant Garamond', serif)",
          fontSize: "0.8125rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "rgba(245,215,100,0.9)",
          background: "rgba(245,215,100,0.06)",
          border: "1px solid rgba(245,215,100,0.25)",
          borderRadius: "100px",
          padding: "0.75rem 2.25rem",
          cursor: "pointer",
          transition: "all 0.2s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(245,215,100,0.12)";
          e.currentTarget.style.borderColor = "rgba(245,215,100,0.5)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(245,215,100,0.06)";
          e.currentTarget.style.borderColor = "rgba(245,215,100,0.25)";
        }}
      >
        Show me
      </motion.button>
    </motion.div>
  );
}

// ── Tip ────────────────────────────────────────────────────────────────────

function TipStep({
  def,
  onNext,
  onEnd,
}: {
  def: StepDef;
  onNext: () => void;
  onEnd: () => void;
}) {
  const isLow = def.tipPos === "low";

  const cardStyle: React.CSSProperties = isLow
    ? {
        position: "fixed",
        bottom: "clamp(130px, 20vh, 175px)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 72,
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 72,
      };

  return (
    <>
      {/* Click-through dimming layer */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.52)",
          zIndex: 71,
          pointerEvents: "none",
        }}
      />

      {/* Tip card */}
      <motion.div
        key={def.eyebrow}
        initial={{ opacity: 0, y: isLow ? 16 : -10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: isLow ? 8 : -6, scale: 0.98 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        style={{
          ...cardStyle,
          width: "min(420px, calc(100vw - 3rem))",
          borderRadius: "18px",
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(8,9,18,0.88)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          padding: "1.625rem 1.75rem 1.5rem",
          boxShadow: "0 24px 64px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        {/* Eyebrow */}
        {def.eyebrow && (
          <div
            style={{
              fontFamily: "var(--font-serif-fine, 'Cormorant Garamond', serif)",
              fontSize: "0.6875rem",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "rgba(245,215,100,0.6)",
              marginBottom: "0.6rem",
            }}
          >
            {def.eyebrow}
          </div>
        )}

        {/* Title */}
        <h2
          style={{
            fontFamily: "var(--font-serif-fine, 'Cormorant Garamond', serif)",
            fontSize: "clamp(1.25rem, 4vw, 1.625rem)",
            fontWeight: 400,
            color: "rgba(255,255,255,0.95)",
            lineHeight: 1.2,
            marginBottom: "1rem",
            whiteSpace: "pre-line",
          }}
        >
          {def.title}
        </h2>

        {/* Body */}
        <p
          style={{
            fontFamily: "var(--font-serif-fine, 'Cormorant Garamond', serif)",
            fontSize: "clamp(0.85rem, 2vw, 0.9375rem)",
            color: "rgba(255,255,255,0.6)",
            lineHeight: 1.75,
            whiteSpace: "pre-line",
            marginBottom: "1.25rem",
          }}
        >
          {def.body}
        </p>

        {/* Action hint */}
        {def.actionHint && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "1.25rem",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "rgba(245,215,100,0.75)",
                animation: "tip-pulse 1.8s ease-in-out infinite",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-serif-fine, 'Cormorant Garamond', serif)",
                fontSize: "0.8125rem",
                color: "rgba(245,215,100,0.65)",
                fontStyle: "italic",
              }}
            >
              {def.actionHint}
            </span>
          </div>
        )}

        {/* Footer buttons */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
          <button
            onClick={onEnd}
            style={{
              fontFamily: "var(--font-serif-fine, 'Cormorant Garamond', serif)",
              fontSize: "0.75rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.28)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0.375rem 0.5rem",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.5)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.28)")}
          >
            End tour
          </button>
          <button
            onClick={onNext}
            style={{
              fontFamily: "var(--font-serif-fine, 'Cormorant Garamond', serif)",
              fontSize: "0.75rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(245,215,100,0.7)",
              background: "rgba(245,215,100,0.07)",
              border: "1px solid rgba(245,215,100,0.2)",
              borderRadius: "100px",
              padding: "0.375rem 1rem",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(245,215,100,0.13)";
              e.currentTarget.style.borderColor = "rgba(245,215,100,0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(245,215,100,0.07)";
              e.currentTarget.style.borderColor = "rgba(245,215,100,0.2)";
            }}
          >
            Skip →
          </button>
        </div>
      </motion.div>

      <style>{`
        @keyframes tip-pulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.4); }
        }
      `}</style>
    </>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────

function ToastStep({ def, onEnd }: { def: StepDef; onEnd: () => void }) {
  useEffect(() => {
    const t = setTimeout(onEnd, 2800);
    return () => clearTimeout(t);
  }, [onEnd]);

  return (
    <motion.div
      key="done-toast"
      initial={{ opacity: 0, y: -12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "fixed",
        top: "1.5rem",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 72,
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        background: "rgba(8,9,18,0.9)",
        border: "1px solid rgba(245,215,100,0.25)",
        borderRadius: "100px",
        padding: "0.5rem 1.25rem 0.5rem 0.875rem",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        pointerEvents: "none",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      {/* Gold dot */}
      <span
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "rgba(245,215,100,0.85)",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-serif-fine, 'Cormorant Garamond', serif)",
          fontSize: "0.875rem",
          color: "rgba(255,255,255,0.85)",
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
        }}
      >
        {def.title}
      </span>
    </motion.div>
  );
}
