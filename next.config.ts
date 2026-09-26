import type { NextConfig } from "next";

/**
 * Security headers. The Supabase origin is read from NEXT_PUBLIC_SUPABASE_URL
 * at build time (it is inlined into the client bundle the same way).
 */
function supabaseOrigins(): { https: string; wss: string } | null {
  const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return { https: url.origin, wss: `wss://${url.host}` };
  } catch {
    return null;
  }
}

function contentSecurityPolicy(): string {
  const isDev = process.env.NODE_ENV !== "production";
  const supabase = supabaseOrigins();
  const connectSrc = ["'self'", ...(supabase ? [supabase.https, supabase.wss] : [])];
  // Next.js inlines hydration scripts ('unsafe-inline'); the dev server's
  // React Refresh additionally needs eval and a websocket for HMR.
  const scriptSrc = ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])];
  if (isDev) connectSrc.push("ws:", "wss:");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
