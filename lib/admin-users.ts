// Server-side helpers shared by the admin user API routes.
import 'server-only';
import type { Models } from 'node-appwrite';

/**
 * A valid Appwrite resource id: at most 36 characters of
 * `[A-Za-z0-9._-]`, not starting with punctuation.
 *
 * Not a UUID. Accounts created through the `auth` Function are made with
 * `unique()`, which Appwrite answers with a 20-character hex id; only the
 * accounts carried over from Supabase still have UUIDs.
 */
export const USER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/;

export function isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const e = error as { code?: unknown; type?: unknown };
    return e.code === 404 || e.type === 'user_not_found' || e.type === 'row_not_found';
}

/** True when the account has proven ownership of its email or phone. */
export function isAuthUserConfirmed(
    user: Pick<Models.User<Models.Preferences>, 'emailVerification' | 'phoneVerification'> | null,
): boolean {
    return !!user && (user.emailVerification === true || user.phoneVerification === true);
}
