// Post-login redirect helpers.

export const DEFAULT_AFTER_LOGIN = '/dashboard';

// Used to resolve `next` when no window is available (SSR); only the
// comparison between the two origins matters, not the host itself.
const FALLBACK_ORIGIN = 'https://admin.invalid';

/**
 * Returns `next` only if it is a same-origin absolute path. Rejects
 * protocol-relative forms ("//host", "/\\host"), any backslash, and any ASCII
 * control character (browsers strip tab/CR/LF from URLs, so "/\t/evil.com"
 * becomes "//evil.com"), then double-checks by resolving against the current
 * origin. Prevents open redirects through /login?next=.
 */
export function safeNextPath(next: string | null | undefined): string | null {
    if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
    if (/[\u0000-\u001F\u007F\\]/.test(next)) return null;
    const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : FALLBACK_ORIGIN;
    try {
        if (new URL(next, origin).origin !== origin) return null;
    } catch {
        return null;
    }
    return next;
}

/** Login URL that returns to `pathname` after sign-in. */
export function loginHref(pathname: string | null | undefined): string {
    const next = safeNextPath(pathname);
    return next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login';
}
