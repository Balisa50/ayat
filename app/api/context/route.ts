import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { arabic, translation, surahName, ayah } = await req.json();
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { context: null, error: "Server is missing ANTHROPIC_API_KEY" },
        { status: 500 }
      );
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const msg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 150,
      system:
        "You are a respectful Quranic context provider. Given a verse, provide ONE sentence about its historical or thematic context drawing from classical tafsir (Ibn Kathir, Al-Tabari, At-Tabari, As-Sa'di). Never interpret, never issue rulings, never be preachy or devotional. State factual context only. Begin directly with the context — no preamble like 'This verse' or 'This passage'. Keep it under 40 words.",
      messages: [
        {
          role: "user",
          content: `Surah ${surahName}, Verse ${ayah}\nArabic: ${arabic}\nTranslation: ${translation}\n\nProvide one sentence of historical or thematic context.`,
        },
      ],
    });

    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    return NextResponse.json({ context: text.trim() });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Unknown error";
    console.error("context API error:", errMsg);
    return NextResponse.json({ context: null, error: errMsg }, { status: 500 });
  }
}
