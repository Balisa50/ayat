import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ReminderProvider } from "@/components/Reminders";

export const viewport: Viewport = {
  themeColor: "#05060e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL("https://ayat.app"),
  title: "AYAT · The Quran, visualised",
  description:
    "6,236 verses of the Quran rendered as a living star field. Explore by theme, feeling, or a verse you half-remember.",
  keywords: ["Quran", "Islamic", "visualisation", "Quran explorer", "galaxy", "AYAT"],
  openGraph: {
    title: "AYAT · The Quran, visualised",
    description:
      "6,236 verses rendered as a living galaxy. Semantic themes self-organise into constellations.",
    type: "website",
    url: "https://ayat.app",
    siteName: "AYAT",
  },
  twitter: {
    card: "summary_large_image",
    title: "AYAT · The Quran, visualised",
    description: "6,236 verses rendered as a living galaxy.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Arabic fonts preloaded so the first frame of the verse card renders
            with full Arabic typography rather than falling back to system fonts. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Scheherazade+New:wght@400;700&display=swap"
        />
      </head>
      <body className="cosmos-bg">
        <ReminderProvider>{children}</ReminderProvider>
      </body>
    </html>
  );
}
