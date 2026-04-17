"use client";
import { useEffect, useState } from "react";

export function Entry({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"line" | "bismillah" | "bang" | "done">("line");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("bismillah"), 2200);
    const t2 = setTimeout(() => setPhase("bang"), 3800);
    const t3 = setTimeout(() => {
      setPhase("done");
      onDone();
    }, 5600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onDone]);

  if (phase === "done") return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none"
      style={{
        background: phase === "bang" ? "rgba(2,3,8,0.0)" : "rgba(2,3,8,1.0)",
        transition: "background 1.2s ease-out",
      }}
    >
      {/* The main entry line */}
      <p
        className="font-serif-fine text-[clamp(1.25rem,3vw,2rem)] text-white/80 fade-slow text-center px-6"
        style={{
          opacity: phase === "bang" ? 0 : 1,
          transition: "opacity 1.2s ease-out",
        }}
      >
        <span className="italic">6,236 signs. One message.</span>
      </p>

      {/* Arabic bismillah watermark */}
      <span
        className="absolute arabic text-[clamp(4rem,14vw,12rem)] text-white/[0.05] select-none"
        style={{
          opacity: phase === "bismillah" || phase === "bang" ? 1 : 0,
          transition: "opacity 1.8s ease-out",
        }}
        aria-hidden="true"
      >
        بسم الله
      </span>
    </div>
  );
}
