import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { jsonError, requireAdmin } from '@/lib/supabase-admin';
import { isUserRole, TABLES, type UserRole } from '@/lib/constants';
import { isAuthUserConfirmed, isNotFound, UUID_RE } from '@/lib/admin-users';
import { isLga } from '@/lib/lgas';
import { isLgaInState } from '@/lib/wards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Effectively permanent ban (100 years), as used for blocked accounts.
const BAN_DURATION = '876000h';

type RouteContext = { params: Promise<{ uid: string }> };

/** The profile values the admin saw when deciding; the update only applies if they are unchanged. */
type Expected = { role: string | null; lga: string | null; ward: string | null };

type Location = { state: string; lga: string; ward: string };

type PatchBody =
    | { approve: boolean; expected: Expected }
    | { disabled: boolean }
    | { role: UserRole; expected: Expected }
    | { location: Location; expected: Expected };

const WARD_MAX = 100;

function nullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function parseExpected(value: unknown): Expected | null {
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    if (!nullableString(v.role) || !nullableString(v.lga) || !nullableString(v.ward)) return null;
    return { role: v.role, lga: v.lga, ward: v.ward };
}

/** state / lga / ward, trimmed; lga must be a known LGA of state and ward non-empty. */
function parseLocation(value: unknown): Location | null {
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    if (Object.keys(v).sort().join(',') !== 'lga,state,ward') return null;
    if (typeof v.state !== 'string' || typeof v.lga !== 'string' || typeof v.ward !== 'string') return null;
    const state = v.state.trim();
    const lga = v.lga.trim();
    const ward = v.ward.trim();
    if (!state || !ward || ward.length > WARD_MAX) return null;
    if (!isLga(lga) || !isLgaInState(state, lga)) return null;
    return { state, lga, ward };
}

/**
 * Accepts exactly one of:
 *  - `{ approve: boolean, expected: { role, lga, ward } }`   (false = revoke approval)
 *  - `{ disabled: boolean }`
 *  - `{ role: <UserRole>, expected: { role, lga, ward } }`
 *  - `{ location: { state, lga, ward }, expected: { role, lga, ward } }`
 */
function parsePatchBody(value: unknown): PatchBody | null {
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    const keys = Object.keys(v).sort().join(',');
    if (keys === 'disabled' && typeof v.disabled === 'boolean') return { disabled: v.disabled };
    if (keys === 'approve,expected' && typeof v.approve === 'boolean') {
        const expected = parseExpected(v.expected);
        return expected ? { approve: v.approve, expected } : null;
    }
    if (keys === 'expected,location') {
        const expected = parseExpected(v.expected);
        const location = parseLocation(v.location);
        return expected && location ? { location, expected } : null;
    }
    if (keys === 'expected,role' && isUserRole(v.role)) {
        const expected = parseExpected(v.expected);
        return expected ? { role: v.role, expected } : null;
    }
    return null;
}

/**
 * Updates the profile only while role / lga / ward still hold the values the
 * admin reviewed. Returns 'ok', 'not_found' or 'changed'.
 */
async function pinnedProfileUpdate(
    admin: SupabaseClient,
    uid: string,
    update: Record<string, unknown>,
    expected: Expected,
    extra?: Record<string, unknown>,
): Promise<'ok' | 'not_found' | 'changed'> {
    let query = admin.from(TABLES.PROFILES).update(update).eq('id', uid);
    const pins: Record<string, unknown> = { ...expected, ...extra };
    for (const [column, value] of Object.entries(pins)) {
        query = value === null ? query.is(column, null) : query.eq(column, value);
    }
    const { data, error } = await query.select('id');
    if (error) throw error;
    if (data && data.length > 0) return 'ok';

    const { data: exists, error: existsError } = await admin
        .from(TABLES.PROFILES)
        .select('id')
        .eq('id', uid)
        .maybeSingle();
    if (existsError) throw existsError;
    return exists ? 'changed' : 'not_found';
}

async function setDisabledFlag(admin: SupabaseClient, uid: string, disabled: boolean): Promise<boolean> {
    const { data, error } = await admin
        .from(TABLES.PROFILES)
        .update({ is_disabled: disabled })
        .eq('id', uid)
        .select('id');
    if (error) throw error;
    return !!data && data.length > 0;
}

const CHANGED_MESSAGE = 'User details changed since you loaded them — reload and review again.';

/** A database trigger refusal (raise ... using errcode = '42501'), e.g. approving an unconfirmed account. */
function dbRefusal(error: unknown): string | null {
    if (typeof error !== 'object' || error === null) return null;
    const e = error as { code?: unknown; message?: unknown };
    return e.code === '42501' && typeof e.message === 'string' && e.message ? e.message : null;
}

function pinnedResponse(result: 'ok' | 'not_found' | 'changed') {
    if (result === 'not_found') return jsonError('User not found', 404);
    if (result === 'changed') return jsonError(CHANGED_MESSAGE, 409);
    return NextResponse.json({ success: true });
}

/**
 * Admin-only user operations. All user mutations go through this route so the
 * profile row and the Supabase Auth account stay in sync:
 *  - { approve: true, expected } → profiles.is_approved = true (+ is_verified). Refused unless the
 *                                  Auth account's email or phone is already confirmed; this route
 *                                  never confirms an email itself (that would let anyone who signs
 *                                  up with somebody else's address take it over once approved).
 *  - { approve: false, expected } → profiles.is_approved = false (revoke approval; access is lost until
 *                                  approved again)
 *  - { disabled: boolean }       → profiles.is_disabled and ban / unban the Auth account (the backend
 *                                  also syncs the ban from the flag; both are idempotent)
 *  - { role, expected }          → profiles.role
 *  - { location, expected }      → profiles.state / lga / ward (lga must be a known LGA of state)
 * `expected` pins the role / lga / ward the admin reviewed; if they changed meanwhile → 409.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
    const check = await requireAdmin(req);
    if (!check.ok) return check.response;
    const { admin, callerId } = check;

    const { uid } = await ctx.params;
    if (!UUID_RE.test(uid)) return jsonError('Invalid user id', 400);

    let body: PatchBody | null;
    try {
        body = parsePatchBody(await req.json());
    } catch {
        body = null;
    }
    if (!body) return jsonError('Invalid request body', 400);

    if (
        uid === callerId &&
        (('disabled' in body && body.disabled) ||
            ('role' in body && body.role !== 'admin') ||
            ('approve' in body && !body.approve))
    ) {
        return jsonError('You cannot block, demote or revoke approval of your own admin account', 400);
    }

    try {
        if ('approve' in body && !body.approve) {
            return pinnedResponse(await pinnedProfileUpdate(admin, uid, { is_approved: false }, body.expected));
        }

        if ('approve' in body) {
            const { data, error } = await admin.auth.admin.getUserById(uid);
            if (error) {
                if (isNotFound(error)) return jsonError('User not found', 404);
                throw error;
            }
            if (!isAuthUserConfirmed(data.user as User | null)) {
                return jsonError(
                    'Email not confirmed: the user must confirm their email address (or phone) before they can be approved.',
                    409,
                );
            }
            try {
                return pinnedResponse(
                    await pinnedProfileUpdate(admin, uid, { is_approved: true, is_verified: true }, body.expected),
                );
            } catch (error) {
                // The database refuses approving an unconfirmed account (profiles_guard_approval).
                const refusal = dbRefusal(error);
                if (refusal) return jsonError(refusal, 409);
                throw error;
            }
        }

        if ('role' in body) {
            return pinnedResponse(await pinnedProfileUpdate(admin, uid, { role: body.role }, body.expected));
        }

        if ('location' in body) {
            return pinnedResponse(await pinnedProfileUpdate(admin, uid, { ...body.location }, body.expected));
        }

        if (body.disabled) {
            // Block: flag the profile first (RLS denies access immediately), then ban sign-in.
            if (!(await setDisabledFlag(admin, uid, true))) return jsonError('User not found', 404);
            const { error } = await admin.auth.admin.updateUserById(uid, { ban_duration: BAN_DURATION });
            if (error) {
                try {
                    await setDisabledFlag(admin, uid, false);
                } catch (rollbackError) {
                    console.error('[api/admin/users] block rollback failed:', rollbackError);
                    return jsonError(
                        'Could not ban the sign-in account, and restoring the profile failed; the profile is marked blocked but sign-in is not banned. Retry.',
                        500,
                    );
                }
                if (isNotFound(error)) return jsonError('User not found', 404);
                console.error('[api/admin/users] ban failed:', error);
                return jsonError('Could not ban the sign-in account; the user was not blocked.', 502);
            }
            return NextResponse.json({ success: true });
        }

        // Unblock: lift the sign-in ban first, then clear the profile flag.
        const { error: unbanError } = await admin.auth.admin.updateUserById(uid, { ban_duration: 'none' });
        if (unbanError) {
            if (isNotFound(unbanError)) return jsonError('User not found', 404);
            console.error('[api/admin/users] unban failed:', unbanError);
            return jsonError('Could not lift the sign-in ban; the user is still blocked.', 502);
        }
        try {
            if (!(await setDisabledFlag(admin, uid, false))) return jsonError('User not found', 404);
        } catch (flagError) {
            console.error('[api/admin/users] unblock profile update failed:', flagError);
            // Re-apply the ban so the two stay consistent.
            const { error: rebanError } = await admin.auth.admin.updateUserById(uid, { ban_duration: BAN_DURATION });
            if (rebanError) console.error('[api/admin/users] re-ban after failed unblock failed:', rebanError);
            return jsonError('Could not update the profile; the user is still blocked.', 500);
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[api/admin/users] PATCH failed:', error);
        return jsonError('Failed to update user', 500);
    }
}

/** Deletes the Supabase Auth account; the profile row is removed by ON DELETE CASCADE. */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
    const check = await requireAdmin(req);
    if (!check.ok) return check.response;
    const { admin, callerId } = check;

    const { uid } = await ctx.params;
    if (!UUID_RE.test(uid)) return jsonError('Invalid user id', 400);
    if (uid === callerId) {
        return jsonError('You cannot delete your own admin account', 400);
    }

    try {
        const { error } = await admin.auth.admin.deleteUser(uid);
        if (error) {
            if (isNotFound(error)) return jsonError('User not found', 404);
            throw error;
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[api/admin/users] DELETE failed:', error);
        return jsonError('Failed to delete user', 500);
    }
}
