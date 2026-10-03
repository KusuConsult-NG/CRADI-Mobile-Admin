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

/** Every label an Appwrite ACL in the CRADI project may name. */
const LABELS = [
    'ewm',
    'ewv',
    'ewr',
    'ldpCoordinator',
    'projectStaff',
    'admin',
    'techSupport',
    'approved',
] as const;

/** The profile fields whose value decides the account's labels. */
export const LABEL_FIELDS = ['role', 'isApproved', 'isDisabled'] as const;

/**
 * The Appwrite account labels a profile row implies.
 *
 * Collections are read through `read("label:…")` permissions, and a label
 * lives on the **account**, not on the profile row — so a row that says
 * `role: 'admin'` grants nothing on its own. Appwrite answers a read the
 * caller has no permission for with `200 {"total": 0}`, so the symptom of
 * a missing label is an empty page and no error at all.
 *
 * This must agree with `accountLabels` in CRADI-mobile's
 * `functions/cradi/src/lib/policy.js`, which is the authority: that is
 * what runs when the panel writes a profile through the `write` Function.
 * This copy exists because user administration goes through this route
 * with an API key instead, bypassing the Function entirely.
 */
export function accountLabels(profile: {
    role?: unknown;
    isApproved?: unknown;
    isDisabled?: unknown;
}): string[] {
    if (profile.isDisabled === true) return [];
    const labels: string[] = [];
    const name = String(profile.role ?? '').replace(/_(.)/g, (_, c: string) => c.toUpperCase());
    if (name && name !== 'user' && (LABELS as readonly string[]).includes(name)) labels.push(name);
    if (profile.isApproved === true) labels.push('approved');
    return labels;
}
