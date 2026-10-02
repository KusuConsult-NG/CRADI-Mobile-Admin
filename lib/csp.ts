/**
 * Content-Security-Policy for the admin panel. Built per request by proxy.ts
 * with a fresh nonce: Next.js reads the nonce from the request's CSP header
 * and puts it on every script it renders, so no inline script needs
 * 'unsafe-inline'. The Appwrite origin comes from
 * NEXT_PUBLIC_APPWRITE_ENDPOINT (inlined at build time, like in the client
 * bundle).
 */
function appwriteOrigins(): { https: string; wss: string } | null {
    const raw = (process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || '').trim();
    if (!raw) return null;
    try {
        const url = new URL(raw);
        // A self-hosted Appwrite (http://appwrite.local:8090/v1) serves
        // realtime over ws://. The panel does not subscribe today, but the
        // SDK opens the socket as soon as anything does, and a CSP that
        // forbids it fails in the browser rather than in a test.
        const ws = url.protocol === 'http:' ? 'ws' : 'wss';
        return { https: url.origin, wss: `${ws}://${url.host}` };
    } catch {
        return null;
    }
}

export function contentSecurityPolicy(nonce: string): string {
    const isDev = process.env.NODE_ENV !== 'production';
    const appwrite = appwriteOrigins();
    const connectSrc = ["'self'", ...(appwrite ? [appwrite.https, appwrite.wss] : [])];
    // 'strict-dynamic' lets the nonced Next.js scripts load their chunks;
    // the dev server's React Refresh additionally needs eval and a websocket for HMR.
    const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])];
    if (isDev) connectSrc.push('ws:', 'wss:');

    return [
        "default-src 'self'",
        `script-src ${scriptSrc.join(' ')}`,
        // React and react-hot-toast set inline style attributes.
        "style-src 'self' 'unsafe-inline'",
        // Report images are served by Appwrite Storage (also over http for a
        // self-hosted one).
        `img-src 'self' data: blob: https:${appwrite ? ` ${appwrite.https}` : ''}`,
        "font-src 'self' data:",
        `connect-src ${connectSrc.join(' ')}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join('; ');
}

/** A fresh base64 nonce (128 bits). */
export function createNonce(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
}
