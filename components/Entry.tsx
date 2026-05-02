"use client";
import { useEffect, useState } from "react";

const ENTRY_KEY = "ayat:entryLastShown";
const COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours → max 2 shows per day

function shouldShowEntry(): boolean {
 if (typeof window === "undefined") return false;
 try {
 const last = localStorage.getItem(ENTRY_KEY);
 if (!last) return true; // first ever visit
 return Date.now() - parseInt(last, 10) >= COOLDOWN_MS;
 } catch {
 return false;
 }
}

function markEntryShown(): void {
 try { localStorage.setItem(ENTRY_KEY, String(Date.now())); } catch {}
}

export function Entry({ onDone }: { onDone: () => void }) {
 // Hydration-safe init: server cannot read localStorage, so we start
 // with `show=false` on both server and client. After mount we run
 // shouldShowEntry() in an effect and flip to true if the cooldown
 // has elapsed. This kills React error #418 while preserving the
 // every-12-hours animation gate.
 const [show, setShow] = useState(false);
 const [mounted, setMounted] = useState(false);
 const [phase, setPhase] = useState<"line" | "bismillah" | "bang" | "done">("line");

 useEffect(() => {
 setMounted(true);
 const willShow = shouldShowEntry();
 if (willShow) {
 setShow(true);
 markEntryShown();
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
 } else {
 onDone();
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 if (!mounted || !show || phase === "done") return null;

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
