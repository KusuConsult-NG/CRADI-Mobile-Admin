import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth, adminDb, firebaseErrorCode, jsonError, requireAdmin } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ROLES = new Set([
    'user',
    'ewm',
    'ewv',
    'ewr',
    'ldp_coordinator',
    'project_staff',
    'admin',
    'techSupport',
]);

type RouteContext = { params: Promise<{ uid: string }> };

interface PatchBody {
    emailVerified?: boolean;
    disabled?: boolean;
    role?: string;
}

function parsePatchBody(value: unknown): PatchBody | null {
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    const body: PatchBody = {};
    if ('emailVerified' in v) {
        if (typeof v.emailVerified !== 'boolean') return null;
        body.emailVerified = v.emailVerified;
    }
    if ('disabled' in v) {
        if (typeof v.disabled !== 'boolean') return null;
        body.disabled = v.disabled;
    }
    if ('role' in v) {
        if (typeof v.role !== 'string' || !VALID_ROLES.has(v.role)) return null;
        body.role = v.role;
    }
    if (Object.keys(body).length === 0) return null;
    return body;
}

function isValidUid(uid: string): boolean {
    return uid.length > 0 && uid.length <= 128 && !uid.includes('/');
}

/**
 * Updates the Firebase Auth side of a user:
 *  - emailVerified: mark the email verified (used when approving)
 *  - disabled: disable/enable sign-in (block/unblock); revokes sessions when disabling
 *  - role: set custom claims {role, admin} used by Firestore rules, and mirror to users/{uid}.role
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
    const check = await requireAdmin(req);
    if (!check.ok) return check.response;

    const { uid } = await ctx.params;
    if (!isValidUid(uid)) return jsonError('Invalid user id', 400);

    let body: PatchBody | null;
    try {
        body = parsePatchBody(await req.json());
    } catch {
        body = null;
    }
    if (!body) return jsonError('Invalid request body', 400);

    if (uid === check.token.uid && (body.disabled === true || (body.role && body.role !== 'admin'))) {
        return jsonError('You cannot block or demote your own admin account', 400);
    }

    try {
        const auth = adminAuth();

        const update: { emailVerified?: boolean; disabled?: boolean } = {};
        if (body.emailVerified !== undefined) update.emailVerified = body.emailVerified;
        if (body.disabled !== undefined) update.disabled = body.disabled;
        if (Object.keys(update).length > 0) {
            await auth.updateUser(uid, update);
        }
        if (body.disabled === true) {
            await auth.revokeRefreshTokens(uid);
        }

        if (body.role) {
            const existing = (await auth.getUser(uid)).customClaims ?? {};
            await auth.setCustomUserClaims(uid, {
                ...existing,
                role: body.role,
                admin: body.role === 'admin',
            });
            await adminDb().collection('users').doc(uid).set({ role: body.role }, { merge: true });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        if (firebaseErrorCode(error) === 'auth/user-not-found') {
            return jsonError('No Firebase Auth account exists for this user', 404);
        }
        console.error('[api/admin/users] PATCH failed:', error);
        return jsonError('Failed to update user', 500);
    }
}

/** Deletes the Firebase Auth account and the users/{uid} Firestore document. */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
    const check = await requireAdmin(req);
    if (!check.ok) return check.response;

    const { uid } = await ctx.params;
    if (!isValidUid(uid)) return jsonError('Invalid user id', 400);
    if (uid === check.token.uid) {
        return jsonError('You cannot delete your own admin account', 400);
    }

    try {
        try {
            await adminAuth().deleteUser(uid);
        } catch (error) {
            // A Firestore profile without an Auth account can still be removed.
            if (firebaseErrorCode(error) !== 'auth/user-not-found') throw error;
        }
        await adminDb().collection('users').doc(uid).delete();
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[api/admin/users] DELETE failed:', error);
        return jsonError('Failed to delete user', 500);
    }
}
