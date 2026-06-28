import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Verse = {
  surah: number;
  ayah: number;
  surahName: string;
  arabic: string;
  translation: string;
  transliteration: string;
  revelationType: "Meccan" | "Medinan";
};

let cached: Verse[] | null = null;

async function loadVerses(): Promise<Verse[]> {
  if (cached) return cached;
  const p = path.join(process.cwd(), "public", "data", "verses.json");
  const raw = await readFile(p, "utf-8");
  cached = JSON.parse(raw) as Verse[];
  return cached;
}

/**
 * /api/card?s=<surah>&a=<ayah>
 *
 * Returns a 1080x1350 PNG. Portrait aspect, Instagram-story friendly,
 * typographic and dark - it's meant to look like the verse card itself,
 * not a marketing banner.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const surah = parseInt(searchParams.get("s") ?? "", 10);
  const ayah = parseInt(searchParams.get("a") ?? "", 10);

  if (!surah || !ayah) {
    return new Response("bad params", { status: 400 });
  }

  const verses = await loadVerses();
  const v = verses.find((x) => x.surah === surah && x.ayah === ayah);
  if (!v) {
    return new Response("not found", { status: 404 });
  }

  const accent = v.revelationType === "Meccan" ? "#8aa4ff" : "#ffb347";

  // Simple truncation so very long ayat still look balanced.
  const clip = (s: string, max: number) =>
    s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1080px",
          height: "1350px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "96px 88px",
          background:
            "radial-gradient(circle at 20% 20%, #101a33 0%, #05060e 55%), #05060e",
          color: "white",
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ fontSize: 22, letterSpacing: "0.35em", color: "rgba(255,255,255,0.85)" }}>
              AYAT
            </div>
            <div style={{ fontSize: 16, fontStyle: "italic", color: "rgba(255,255,255,0.4)" }}>
              signs &amp; verses
            </div>
          </div>
          <div
            style={{
              fontSize: 14,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: accent,
              border: `1px solid ${accent}55`,
              borderRadius: 999,
              padding: "6px 14px",
            }}
          >
            {v.revelationType}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
          <div
            style={{
              fontSize: 56,
              lineHeight: 1.55,
              textAlign: "right",
              direction: "rtl",
              color: "white",
            }}
          >
            {clip(v.arabic, 240)}
          </div>

          <div
            style={{
              fontSize: 22,
              fontStyle: "italic",
              color: "rgba(255,255,255,0.55)",
              lineHeight: 1.45,
            }}
          >
            {clip(v.transliteration, 220)}
          </div>

          <div
            style={{
              fontSize: 30,
              color: "rgba(255,255,255,0.92)",
              lineHeight: 1.45,
            }}
          >
            {clip(v.translation, 360)}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: 28,
          }}
        >
          <div
            style={{
              fontSize: 18,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.55)",
            }}
          >
            {v.surahName} · {v.ayah}
          </div>
          <div style={{ fontSize: 16, fontStyle: "italic", color: "rgba(255,255,255,0.35)" }}>
            ayat-galaxy.vercel.app
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350 },
  );
}
