import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AYAT — The Quran, visualised",
  description:
    "6,236 verses, rendered as a living galaxy. Semantic themes self-organise into constellations.",
  openGraph: {
    title: "AYAT — The Quran, visualised",
    description: "6,236 verses rendered as a living galaxy.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="cosmos-bg">{children}</body>
    </html>
  );
}
