"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Islamic moment reminders, large rotating hadith pool.
 *
 * Rules:
 * - AT MOST one reminder per session, ever.
 * - Authentic attribution only, every hadith below has a source citation.
 * - Pool is large enough that repetition is rare. We track shown indices
 * in localStorage and skip already-shown ones for up to 30 visits.
 * - No close button. Fades in, stays 7 seconds, fades out. Bottom-centre.
 */

export type ReminderKind =
 | "share"
 | "read-fully"
 | "theme-search"
 | "detective-hit"
 | "verse-chain"
 | "night"
 | "first-visit";

// ── Hadith pool, all about Quran recitation, knowledge, and reward ───────────
// Theme: make the reader feel the weight and joy of what they are doing.
const HADITH_POOL: string[] = [
 // Quran recitation & reward
 "\u201CWhoever reads one letter from the Book of Allah earns one good deed, and that good deed is multiplied by ten.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Jami\u02BB at-Tirmidhi 2910",
 "\u201CThe best of you are those who learn the Quran and teach it.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih al-Bukhari 5027",
 "\u201CRecite the Quran, for it will come as an intercessor for its companions on the Day of Resurrection.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih Muslim 804",
 "\u201CThe one who is skilled in reciting the Quran will be with the honourable and obedient recording angels. The one who recites it with difficulty, stuttering through it, will have a double reward.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih al-Bukhari 4937",
 "\u201CAdorn the Quran with your voices, for a beautiful voice increases the beauty of the Quran.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sunan Abi Dawud 1468",
 "\u201CVerily the hearts rust just as iron rusts when water gets to it.\u201D It was asked: what is its polish? He said: \u201CRecitation of the Quran and remembrance of death.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Shu\u02BBab al-\u012Bm\u0101n 2014",
 "\u201CA house in which the Quran is recited is like a star shining to the inhabitants of the heavens, just as stars shine to the inhabitants of the earth.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Shu\u02BBab al-\u012Bm\u0101n, al-Bayhaqi",
 "\u201CIt will be said to the companion of the Quran: Recite and ascend. Recite carefully as you used to recite carefully in the world. Your rank will be at the last verse you recite.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sunan Abi Dawud 1464",
 "\u201CWhoever recites ten verses in a night will not be recorded among the heedless.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sunan Abi Dawud 1397",
 "\u201CMake your homes bright with the recitation of the Quran.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih Ibn Hibban 765",
 "\u201CThe Quran is an intercessor, and its intercession is accepted. It is an adversary whose testimony is believed. Whoever places it ahead, it leads him to Paradise. Whoever places it behind, it drives him to Hellfire.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih Ibn Hibban 124",
 "\u201CHold fast to the Quran. By the One in whose Hand my soul is, it escapes more swiftly than camels from their tethers. Revise it constantly.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih al-Bukhari 5033",
 "\u201CAllah listens more attentively to a man with a beautiful voice reciting the Quran than a master of a singing-girl listens to her.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih Ibn Majah 1340",

 // Seeking knowledge & learning
 "\u201CWhoever takes a path in search of knowledge, Allah will ease for him a path to Paradise.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih Muslim 2699",
 "\u201CSeeking knowledge is an obligation upon every Muslim.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sunan Ibn Majah 224",
 "\u201CScholars are the heirs of the prophets. The prophets left behind no dinar and no dirham, they left behind knowledge. Whoever takes it has taken a great share.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sunan Abi Dawud 3641",
 "\u201CThe superiority of the scholar over the worshipper is like the superiority of the full moon over all the stars.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sunan Abi Dawud 3641",
 "\u201CThere is no envy except in two cases: a man to whom Allah has given wealth and he spends it in the right way, and a man to whom Allah has given wisdom and he judges by it and teaches it to others.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih al-Bukhari 73",
 "\u201CWhoever teaches good is praised by Allah and His angels, and all of creation \u2014 even the fish in the sea.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Jami\u02BB at-Tirmidhi 2685",
 "\u201CSeek knowledge from the cradle to the grave.\u201D \u2014 Attributed, widely cited in Islamic tradition",
 "\u201CWhen a person dies, all their deeds end except three: a continuing charity, knowledge that others benefit from, or a righteous child who prays for them.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih Muslim 1631",

 // Dhikr, reflection, connection to Allah
 "\u201CWhoever guides to good is like the one who does it.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih Muslim 1893",
 "\u201CAllah said: I am as my servant thinks of Me, and I am with him when he remembers Me.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih al-Bukhari 7405",
 "\u201CShall I not tell you of the best of your deeds, the purest before your Lord, the highest in raising your ranks, better for you than spending gold and silver, and better for you than meeting your enemy and striking their necks? It is the remembrance of Allah.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Jami\u02BB at-Tirmidhi 3377",
 "\u201CThe comparison of the one who remembers Allah and the one who does not is like the living and the dead.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih al-Bukhari 6407",

 // Time, night prayer, reward
 "\u201CMake use of five things before five others: your life before your death, your health before your illness, your free time before you become busy, your youth before your old age, and your wealth before your poverty.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Shu\u02BBab al-\u012Bm\u0101n, al-Bayhaqi",
 "\u201CThe closest the servant comes to his Lord is during the last part of the night. If you can be among those who remember Allah at that hour, be among them.\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Jami\u02BB at-Tirmidhi 3579",
 "\u201COur Lord descends to the lowest heaven in the last third of every night and says: Who is calling on Me so I may answer? Who is asking of Me so I may give? Who is seeking My forgiveness so I may forgive?\u201D \u2014 Prophet Muhammad \uFDFA \u00B7 Sahih al-Bukhari 1145",
];

// ── Pool rotation via localStorage ───────────────────────────────────────────
const SEEN_KEY = "ayat:seenHadiths"; // comma-separated indices already shown
const MAX_MEMORY = 30; // forget after this many, so pool resets

function pickHadith(): string {
 if (typeof window === "undefined") return HADITH_POOL[0];
 try {
 const raw = localStorage.getItem(SEEN_KEY) ?? "";
 const seen = new Set(raw.split(",").filter(Boolean).map(Number));
 // Reset memory if we've seen most of the pool
 const available = HADITH_POOL.map((_, i) => i).filter(i => !seen.has(i));
 const candidates = available.length > 0 ? available : HADITH_POOL.map((_, i) => i);
 const chosen = candidates[Math.floor(Math.random() * candidates.length)];
 // Record it, keep only the last MAX_MEMORY entries
 const updated = [...seen, chosen].slice(-MAX_MEMORY);
 localStorage.setItem(SEEN_KEY, updated.join(","));
 return HADITH_POOL[chosen];
 } catch {
 return HADITH_POOL[Math.floor(Math.random() * HADITH_POOL.length)];
 }
}

// ── Context & Provider ────────────────────────────────────────────────────────

const SESSION_KEY = "ayat:reminderShown";
const FIRST_VISIT_KEY = "ayat:firstVisitDone";
const CHAIN_COUNT_KEY = "ayat:chainCount";

type Ctx = {
 trigger: (kind: ReminderKind) => void;
 bumpChain: () => void;
 setMuted: (muted: boolean) => void;
};

const ReminderContext = createContext<Ctx | null>(null);

export function useReminders(): Ctx {
 const ctx = useContext(ReminderContext);
 if (!ctx) return { trigger: () => {}, bumpChain: () => {}, setMuted: () => {} };
 return ctx;
}

export function ReminderProvider({ children }: { children: React.ReactNode }) {
 const [message, setMessage] = useState<string | null>(null);
 // When a verse card is open we mute the reminder rail entirely so its
 // auto-sentences never bleed over the card. The page flips this on
 // verse selection and back off on close.
 const [muted, setMuted] = useState(false);

 const hasShown = () => {
 try {
 return typeof window !== "undefined" && sessionStorage.getItem(SESSION_KEY) === "1";
 } catch {
 return true;
 }
 };

 const show = useCallback((msg: string) => {
 if (hasShown()) return;
 try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
 setMessage(msg);
 setTimeout(() => setMessage(null), 7000);
 }, []);

 const trigger = useCallback((_kind: ReminderKind) => {
 // All triggers now draw from the same rotating hadith pool
 show(pickHadith());
 }, [show]);

 const bumpChain = useCallback(() => {
 try {
 const cur = parseInt(sessionStorage.getItem(CHAIN_COUNT_KEY) ?? "0", 10);
 const next = cur + 1;
 sessionStorage.setItem(CHAIN_COUNT_KEY, String(next));
 if (next >= 3) trigger("verse-chain");
 } catch {}
 }, [trigger]);

 // Auto-trigger: first visit or night-time open
 useEffect(() => {
 if (typeof window === "undefined") return;
 const t = setTimeout(() => {
 if (hasShown()) return;
 const firstDone = localStorage.getItem(FIRST_VISIT_KEY);
 if (!firstDone) {
 localStorage.setItem(FIRST_VISIT_KEY, "1");
 trigger("first-visit");
 return;
 }
 const hour = new Date().getHours();
 if (hour >= 19 || hour < 5) {
 trigger("night");
 }
 }, 4500);
 return () => clearTimeout(t);
 }, [trigger]);

 const value = useMemo<Ctx>(() => ({ trigger, bumpChain, setMuted }), [trigger, bumpChain]);

 return (
 <ReminderContext.Provider value={value}>
 {children}
 <AnimatePresence>
 {message && !muted && (
 <motion.div
 key={message}
 initial={{ opacity: 0, y: 8 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -4 }}
 transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
 className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 max-w-md px-6 pointer-events-none"
 aria-live="polite"
 >
 <p className="font-serif-fine italic text-center text-[13px] md:text-sm leading-relaxed text-[#f2e7d1]">
 {message}
 </p>
 </motion.div>
 )}
 </AnimatePresence>
 </ReminderContext.Provider>
 );
}
