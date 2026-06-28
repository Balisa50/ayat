import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  turbopack: {
    root: __dirname,
  },

  typescript: {
    ignoreBuildErrors: false,
  },

  // ── Security headers ──────────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent AYAT from being iframed (clickjacking)
          { key: "X-Frame-Options", value: "DENY" },
          // Stop browsers from MIME-sniffing responses
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Minimal referrer - don't leak the full URL to third parties
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Permissions Policy - AYAT does not use camera, geolocation, or payment
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), payment=(), usb=()",
            // Note: microphone intentionally NOT denied - voice search (Ask) uses it
          },
          // HSTS - only add once you're 100% HTTPS-only on all domains
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Disable DNS prefetch to external origins not controlled by us
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
      // API routes: prevent caching of AI-generated responses by CDN/proxies
      {
        source: "/api/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
