import { NextResponse, type NextRequest } from 'next/server';
import { jsonError, requireAdmin } from '@/lib/supabase-admin';
import { isAuthUserConfirmed, isNotFound, UUID_RE } from '@/lib/admin-users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_IDS = 100;

/**
 * POST { ids: string[] } → { confirmed: { [id]: boolean | null } }
 * Whether each Auth account has a confirmed email or phone (null = no Auth account / lookup failed).
 * Admin-only; used by the users list to flag accounts that cannot be approved yet.
 */
export async function POST(req: NextRequest) {
    const check = await requireAdmin(req);
    if (!check.ok) return check.response;
    const { admin } = check;

    let ids: string[] | null = null;
    try {
        const body: unknown = await req.json();
        const raw = typeof body === 'object' && body !== null ? (body as { ids?: unknown }).ids : null;
        if (Array.isArray(raw) && raw.length <= MAX_IDS && raw.every((id) => typeof id === 'string' && UUID_RE.test(id))) {
            ids = [...new Set(raw as string[])];
        }
    } catch {
        ids = null;
    }
    if (!ids) return jsonError(`Body must be { ids: string[] } with at most ${MAX_IDS} user ids`, 400);

    const entries = await Promise.all(
        ids.map(async (id): Promise<[string, boolean | null]> => {
            const { data, error } = await admin.auth.admin.getUserById(id);
            if (error) {
                if (!isNotFound(error)) console.error('[api/admin/users/confirmation] lookup failed:', error.message);
                return [id, null];
            }
            return [id, isAuthUserConfirmed(data.user)];
        }),
    );

    return NextResponse.json({ confirmed: Object.fromEntries(entries) });
}
