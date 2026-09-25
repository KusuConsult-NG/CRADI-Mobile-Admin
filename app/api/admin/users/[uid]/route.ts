import { NextResponse, type NextRequest } from 'next/server';
import { jsonError, requireAdmin } from '@/lib/supabase-admin';
import { isUserRole, TABLES, type UserRole } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Effectively permanent ban (100 years), as used for blocked accounts.
const BAN_DURATION = '876000h';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ uid: string }> };

type PatchBody = { approve: true } | { disabled: boolean } | { role: UserRole };

/** Accepts exactly one of `approve: true`, `disabled: boolean` or `role: <UserRole>`. */
function parsePatchBody(value: unknown): PatchBody | null {
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    const keys = Object.keys(v);
    if (keys.length !== 1) return null;
    if (v.approve === true) return { approve: true };
    if (typeof v.disabled === 'boolean') return { disabled: v.disabled };
    if (isUserRole(v.role)) return { role: v.role };
    return null;
}

function isNotFound(error: { status?: number; code?: string } | null): boolean {
    return !!error && (error.status === 404 || error.code === 'user_not_found');
}

/**
 * Admin-only user operations. All user mutations go through this route so the
 * profile row and the Supabase Auth account stay in sync:
 *  - { approve: true }     → profiles.is_approved = true (+ is_verified) and confirm the email
 *  - { disabled: boolean } → profiles.is_disabled and ban / unban the Auth account
 *  - { role }              → profiles.role
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

    if (uid === callerId && (('disabled' in body && body.disabled) || ('role' in body && body.role !== 'admin'))) {
        return jsonError('You cannot block or demote your own admin account', 400);
    }

    try {
        const profileUpdate: Record<string, unknown> =
            'approve' in body
                ? { is_approved: true, is_verified: true }
                : 'disabled' in body
                  ? { is_disabled: body.disabled }
                  : { role: body.role };

        const { data: updated, error: profileError } = await admin
            .from(TABLES.PROFILES)
            .update(profileUpdate)
            .eq('id', uid)
            .select('id');
        if (profileError) throw profileError;
        if (!updated || updated.length === 0) return jsonError('User not found', 404);

        if ('approve' in body) {
            const { error } = await admin.auth.admin.updateUserById(uid, { email_confirm: true });
            if (error && !isNotFound(error)) throw error;
        } else if ('disabled' in body) {
            const { error } = await admin.auth.admin.updateUserById(uid, {
                ban_duration: body.disabled ? BAN_DURATION : 'none',
            });
            if (error) {
                if (isNotFound(error)) return jsonError('User not found', 404);
                throw error;
            }
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
