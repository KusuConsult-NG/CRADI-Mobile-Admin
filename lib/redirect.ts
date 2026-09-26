// Post-login redirect helpers.

export const DEFAULT_AFTER_LOGIN = '/dashboard';

/**
 * Returns `next` only if it is a same-origin path ("/..." but not "//..." or
 * "/\\...", which browsers treat as protocol-relative URLs). Prevents open
 * redirects through /login?next=.
 */
export function safeNextPath(next: string | null | undefined): string | null {
    if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
    return next;
}

/** Login URL that returns to `pathname` after sign-in. */
export function loginHref(pathname: string | null | undefined): string {
    const next = safeNextPath(pathname);
    return next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login';
}
