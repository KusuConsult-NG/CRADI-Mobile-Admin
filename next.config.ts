import type { NextConfig } from "next";

// Security headers for every response. The Content-Security-Policy is not
// here: proxy.ts builds it per request with a script nonce (lib/csp.ts).

/**
 * HTTPS-only for two years, subdomains included. Production only: in dev the
 * app runs on http://localhost, and a browser that cached HSTS for localhost
 * would refuse every other local http dev server.
 */
function strictTransportSecurity(): { key: string; value: string }[] {
  if (process.env.NODE_ENV !== "production") return [];
  return [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }];
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...strictTransportSecurity(),
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
