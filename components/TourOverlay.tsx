"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export const TOUR_KEY = "ayat:tour:v1";
export const TOUR_STEPS = 5; // 0=welcome 1=galaxy 2=theme 3=ask 4=done

// ── Step definitions ───────────────────────────────────────────────────────

type StepDef = {
  type: "welcome" | "tip" | "toast";
  /** Where the tip card sits. "center" = middle of screen. "low" = above search bar. */
  tipPos?: "center" | "low";
  eyebrow?: string;
  title: string;
  body: string;
  sub?: string;
  actionHint?: string;
  /** Show a downward arrow pointing at the search bar */
  arrowDown?: boolean;
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
    body: "Type a theme — FORGIVENESS, PATIENCE, LIGHT, JUSTICE — and the galaxy dims everything except verses that carry that meaning.\n\nIt reads intent. Not exact words.",
    actionHint: "Type a theme in the bar below to continue",
    arrowDown: true,
  },
  {
    type: "tip",
    tipPos: "low",
    eyebrow: "Verse Detective",
    title: "Describe.\nDon't search.",
    body: "Tap Ask in the search bar below. Describe a verse you half-remember — a feeling, a story from the prophets, a phrase. The AI detective finds it, grounded in the real dataset.",
    actionHint: "Use Ask below to continue",
    arrowDown: true,
  },
  {
    type: "toast",
    title: "The galaxy is yours.",
    body: "",
  },
];

// ── Props ──────────────────────────────────────────────────────────────────

interface TourOverlayProps {
  step: number;
  onNext: () => void;
  onEnd: () => void;
}

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
        padding: "2rem 1.5rem",
        background: "radial-gradient(ellipse at 50% 40%, rgba(5,6,14,0.93) 0%, rgba(3,4,10,0.97) 100%)",
        overflowY: "auto",
      }}
    >
      {/* Logo mark */}
      <motion.div
        initial={{ opacity: 0, letterSpacing: "0.6em" }}
        animate={{ opacity: 1, letterSpacing: "0.35em" }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: "0.75rem",
          color: "rgba(245,215,100,0.65)",
          textTransform: "uppercase",
          marginBottom: "2rem",
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
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: "clamp(1.75rem, 6vw, 3.5rem)",
          fontWeight: 400,
          color: "rgba(255,255,255,0.96)",
          lineHeight: 1.1,
          marginBottom: "1.5rem",
          whiteSpace: "pre-line",
          maxWidth: "600px",
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
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: "clamp(0.875rem, 2.2vw, 1rem)",
          color: "rgba(255,255,255,0.65)",
          lineHeight: 1.75,
          maxWidth: "480px",
          marginBottom: "1.25rem",
        }}
      >
        {def.body}
      </motion.p>

      {/* Sub */}
      {def.sub && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.0, duration: 1.0 }}
          style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: "clamp(0.75rem, 1.8vw, 0.875rem)",
            color: "rgba(255,255,255,0.35)",
            lineHeight: 1.8,
            maxWidth: "460px",
            marginBottom: "2.5rem",
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
        transition={{ delay: 2.8, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        onClick={onNext}
        style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: "0.8125rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "rgba(245,215,100,0.9)",
          background: "rgba(245,215,100,0.06)",
          border: "1px solid rgba(245,215,100,0.3)",
          borderRadius: "100px",
          padding: "0.75rem 2.25rem",
          cursor: "pointer",
          transition: "all 0.2s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(245,215,100,0.13)";
          e.currentTarget.style.borderColor = "rgba(245,215,100,0.55)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(245,215,100,0.06)";
          e.currentTarget.style.borderColor = "rgba(245,215,100,0.3)";
        }}
      >
        Show me
      </motion.button>
    </motion.div>
  );
}

// ── Tip ────────────────────────────────────────────────────────────────────
// IMPORTANT: The outer <div> handles fixed positioning + centering transform.
// The inner <motion.div> handles ONLY the entrance animation (no transform: translate).
// This prevents Framer Motion's animation transforms from overwriting the centering transform.

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

  // Outer wrapper: handles fixed positioning. No animation on this element.
  const wrapperStyle: React.CSSProperties = isLow
    ? {
        position: "fixed",
        bottom: "clamp(120px, 22vh, 180px)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 72,
        width: "min(400px, calc(100vw - 2rem))",
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 72,
        width: "min(400px, calc(100vw - 2rem))",
      };

  return (
    <>
      {/* Dimming overlay — click-through so user can interact with the app */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          zIndex: 71,
          pointerEvents: "none",
        }}
      />

      {/* Positioning wrapper (no animation transforms here) */}
      <div style={wrapperStyle}>
        {/* Animated card — only y/scale/opacity; no translate */}
        <motion.div
          key={def.eyebrow}
          initial={{ opacity: 0, y: isLow ? 12 : -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          style={{
            borderRadius: "16px",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(7,8,16,0.92)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            padding: "1.375rem 1.5rem 1.25rem",
            boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
          }}
        >
          {/* Eyebrow */}
          {def.eyebrow && (
            <div
              style={{
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                fontSize: "0.625rem",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "rgba(245,215,100,0.65)",
                marginBottom: "0.5rem",
              }}
            >
              {def.eyebrow}
            </div>
          )}

          {/* Title */}
          <h2
            style={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: "clamp(1.125rem, 4vw, 1.5rem)",
              fontWeight: 400,
              color: "rgba(255,255,255,0.95)",
              lineHeight: 1.2,
              marginBottom: "0.875rem",
              whiteSpace: "pre-line",
            }}
          >
            {def.title}
          </h2>

          {/* Body */}
          <p
            style={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: "clamp(0.8125rem, 2vw, 0.9rem)",
              color: "rgba(255,255,255,0.58)",
              lineHeight: 1.7,
              whiteSpace: "pre-line",
              marginBottom: "1rem",
            }}
          >
            {def.body}
          </p>

          {/* Action hint + arrow */}
          {def.actionHint && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginBottom: "1rem",
                padding: "0.5rem 0.75rem",
                borderRadius: "8px",
                background: "rgba(245,215,100,0.06)",
                border: "1px solid rgba(245,215,100,0.15)",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "rgba(245,215,100,0.8)",
                  animation: "tip-pulse 1.8s ease-in-out infinite",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: "'Cormorant Garamond', Georgia, serif",
                  fontSize: "0.8rem",
                  color: "rgba(245,215,100,0.75)",
                  fontStyle: "italic",
                  lineHeight: 1.4,
                }}
              >
                {def.actionHint}
              </span>
            </div>
          )}

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button
              onClick={onEnd}
              style={{
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                fontSize: "0.6875rem",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.22)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0.375rem 0",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.45)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.22)")}
            >
              End tour
            </button>
            <button
              onClick={onNext}
              style={{
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                fontSize: "0.6875rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "rgba(245,215,100,0.75)",
                background: "rgba(245,215,100,0.07)",
                border: "1px solid rgba(245,215,100,0.2)",
                borderRadius: "100px",
                padding: "0.375rem 1rem",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(245,215,100,0.14)";
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

        {/* Downward arrow pointing at search bar */}
        {def.arrowDown && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: "0.75rem",
              gap: "3px",
              animation: "arrow-bounce 1.4s ease-in-out infinite",
            }}
          >
            <div style={{ width: 1, height: 20, background: "rgba(245,215,100,0.4)" }} />
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: "7px solid rgba(245,215,100,0.5)",
              }}
            />
          </div>
        )}
      </div>

      <style>{`
        @keyframes tip-pulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.4); }
        }
        @keyframes arrow-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.6; }
          50%       { transform: translateY(5px); opacity: 1; }
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
    <div
      style={{
        position: "fixed",
        top: "1.25rem",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 72,
        pointerEvents: "none",
      }}
    >
      <motion.div
        key="done-toast"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.55rem",
          background: "rgba(7,8,16,0.92)",
          border: "1px solid rgba(245,215,100,0.28)",
          borderRadius: "100px",
          padding: "0.5rem 1.25rem 0.5rem 0.875rem",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          whiteSpace: "nowrap",
        }}
      >
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
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: "0.875rem",
            color: "rgba(255,255,255,0.85)",
          }}
        >
          {def.title}
        </span>
      </motion.div>
    </div>
  );
}
