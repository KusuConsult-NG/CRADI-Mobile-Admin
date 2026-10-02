import { NextResponse, type NextRequest } from 'next/server';
import { Query } from 'node-appwrite';
import { type AdminClients, DATABASE_ID, jsonError, requireAdmin } from '@/lib/appwrite-server';
import { isUserRole, TABLES, type UserRole } from '@/lib/constants';
import { isAuthUserConfirmed, isNotFound, USER_ID_RE } from '@/lib/admin-users';
import { isLga } from '@/lib/lgas';
import { isLgaInState } from '@/lib/wards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Appwrite has no ban duration: an account is active or it is not, and
// `status: false` refuses every sign-in until it is set back.
const BLOCKED = false;
const ACTIVE = true;

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
    admin: AdminClients,
    uid: string,
    update: Record<string, unknown>,
    expected: Expected,
    extra?: Record<string, unknown>,
): Promise<'ok' | 'not_found' | 'changed'> {
    const pins: Record<string, unknown> = { ...expected, ...extra };
    const queries = [
        Query.equal('$id', uid),
        ...Object.entries(pins).map(([column, value]) =>
            value === null ? Query.isNull(column) : Query.equal(column, value as string),
        ),
    ];

    // `updateRows` applies the update only to the rows the queries match, in
    // one call — the atomic compare-and-set the Postgres `WHERE` clause gave
    // us, and the reason this is not a read-then-write.
    //
    // The queries belong in the BODY. Passed as `?queries[]=` they are
    // silently ignored and **every row in the table is updated** — measured
    // on 1.9.6, and the SDK puts them in the body for us.
    const result = await admin.tables.updateRows({
        databaseId: DATABASE_ID(),
        tableId: TABLES.PROFILES,
        data: update,
        queries,
    });
    if (result.total > 0) return 'ok';

    // Nothing matched: either the row is gone, or a pinned value moved.
    try {
        await admin.tables.getRow({
            databaseId: DATABASE_ID(),
            tableId: TABLES.PROFILES,
            rowId: uid,
        });
        return 'changed';
    } catch (error) {
        if (isNotFound(error)) return 'not_found';
        throw error;
    }
}

async function setDisabledFlag(admin: AdminClients, uid: string, disabled: boolean): Promise<boolean> {
    try {
        await admin.tables.updateRow({
            databaseId: DATABASE_ID(),
            tableId: TABLES.PROFILES,
            rowId: uid,
            data: { isDisabled: disabled },
        });
        return true;
    } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
    }
}

const CHANGED_MESSAGE = 'User details changed since you loaded them — reload and review again.';

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
    if (!USER_ID_RE.test(uid)) return jsonError('Invalid user id', 400);

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
            return pinnedResponse(await pinnedProfileUpdate(admin, uid, { isApproved: false }, body.expected));
        }

        if ('approve' in body) {
            let account;
            try {
                account = await admin.users.get({ userId: uid });
            } catch (error) {
                if (isNotFound(error)) return jsonError('User not found', 404);
                throw error;
            }
            // The only check there is now. Postgres had a second one —
            // the `profiles_guard_approval` trigger refused the write
            // itself — and Appwrite has no triggers, so this route is
            // the whole defence. It matters: approving an account whose
            // address was never confirmed lets whoever signed up with
            // somebody else's email take it over.
            if (!isAuthUserConfirmed(account)) {
                return jsonError(
                    'Email not confirmed: the user must confirm their email address (or phone) before they can be approved.',
                    409,
                );
            }
            return pinnedResponse(
                await pinnedProfileUpdate(admin, uid, { isApproved: true, isVerified: true }, body.expected),
            );
        }

        if ('role' in body) {
            return pinnedResponse(await pinnedProfileUpdate(admin, uid, { role: body.role }, body.expected));
        }

        if ('location' in body) {
            return pinnedResponse(await pinnedProfileUpdate(admin, uid, { ...body.location }, body.expected));
        }

        if (body.disabled) {
            // Block: flag the profile first (every collection rule reads it,
            // so access stops immediately), then refuse sign-in.
            if (!(await setDisabledFlag(admin, uid, true))) return jsonError('User not found', 404);
            try {
                await admin.users.updateStatus({ userId: uid, status: BLOCKED });
            } catch (error) {
                try {
                    await setDisabledFlag(admin, uid, false);
                } catch (rollbackError) {
                    console.error('[api/admin/users] block rollback failed:', rollbackError);
                    return jsonError(
                        'Could not block the sign-in account, and restoring the profile failed; the profile is marked blocked but sign-in is not. Retry.',
                        500,
                    );
                }
                if (isNotFound(error)) return jsonError('User not found', 404);
                console.error('[api/admin/users] block failed:', error);
                return jsonError('Could not block the sign-in account; the user was not blocked.', 502);
            }
            return NextResponse.json({ success: true });
        }

        // Unblock: let them sign in again first, then clear the profile flag.
        try {
            await admin.users.updateStatus({ userId: uid, status: ACTIVE });
        } catch (error) {
            if (isNotFound(error)) return jsonError('User not found', 404);
            console.error('[api/admin/users] unblock failed:', error);
            return jsonError('Could not lift the sign-in block; the user is still blocked.', 502);
        }
        try {
            if (!(await setDisabledFlag(admin, uid, false))) return jsonError('User not found', 404);
        } catch (flagError) {
            console.error('[api/admin/users] unblock profile update failed:', flagError);
            // Re-apply the block so the two stay consistent.
            try {
                await admin.users.updateStatus({ userId: uid, status: BLOCKED });
            } catch (reblockError) {
                console.error('[api/admin/users] re-block after failed unblock failed:', reblockError);
            }
            return jsonError('Could not update the profile; the user is still blocked.', 500);
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[api/admin/users] PATCH failed:', error);
        return jsonError('Failed to update user', 500);
    }
}

/**
 * Deletes the account and its profile row.
 *
 * Postgres removed the profile by `ON DELETE CASCADE`. Appwrite has no
 * foreign keys, so the row is deleted here — after the account, because an
 * orphaned profile is visible and fixable while an account with no profile
 * can sign in and reach nothing.
 */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
    const check = await requireAdmin(req);
    if (!check.ok) return check.response;
    const { admin, callerId } = check;

    const { uid } = await ctx.params;
    if (!USER_ID_RE.test(uid)) return jsonError('Invalid user id', 400);
    if (uid === callerId) {
        return jsonError('You cannot delete your own admin account', 400);
    }

    try {
        try {
            await admin.users.delete({ userId: uid });
        } catch (error) {
            if (isNotFound(error)) return jsonError('User not found', 404);
            throw error;
        }
        try {
            await admin.tables.deleteRow({
                databaseId: DATABASE_ID(),
                tableId: TABLES.PROFILES,
                rowId: uid,
            });
        } catch (error) {
            if (!isNotFound(error)) {
                console.error('[api/admin/users] profile delete failed:', error);
                return jsonError(
                    'The sign-in account was deleted but its profile row was not; delete it again to clear the row.',
                    500,
                );
            }
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[api/admin/users] DELETE failed:', error);
        return jsonError('Failed to delete user', 500);
    }
}
