import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, createNonce } from '@/lib/csp';

/**
 * Per-request nonce-based Content-Security-Policy. The CSP is set on the
 * request (Next.js reads the nonce from it while rendering and adds it to its
 * scripts) and on the response. Pages are rendered per request for this (see
 * app/layout.tsx): a prerendered page could not carry a fresh nonce.
 */
export function proxy(request: NextRequest) {
    const csp = contentSecurityPolicy(createNonce());
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('Content-Security-Policy', csp);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('Content-Security-Policy', csp);
    return response;
}

export const config = {
    matcher: [
        {
            // Everything except static assets (they carry no scripts to nonce).
            source: '/((?!_next/static|_next/image|favicon.ico).*)',
            missing: [
                { type: 'header', key: 'next-router-prefetch' },
                { type: 'header', key: 'purpose', value: 'prefetch' },
            ],
        },
    ],
};
