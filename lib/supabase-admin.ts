// Server-only Supabase helpers for Next.js API routes. Never import from client code.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { TABLES } from '@/lib/constants';

class NotConfiguredError extends Error {}

let cached: SupabaseClient | null = null;

/**
 * Lazily creates the service-role client (bypasses RLS). Only initialised when
 * an API route is actually hit, so builds work without the secret.
 */
export function supabaseAdmin(): SupabaseClient {
    if (cached) return cached;
    const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !serviceKey) {
        throw new NotConfiguredError('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    }
    cached = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return cached;
}

export function jsonError(message: string, status: number) {
    return NextResponse.json({ error: message }, { status });
}

type AdminCheck =
    | { ok: true; callerId: string; admin: SupabaseClient }
    | { ok: false; response: NextResponse };

/**
 * Verifies `Authorization: Bearer <Supabase access token>` and requires the
 * caller's profile to be an approved, non-disabled admin (same rule as
 * public.app_role() in the database).
 */
export async function requireAdmin(req: NextRequest): Promise<AdminCheck> {
    let admin: SupabaseClient;
    try {
        admin = supabaseAdmin();
    } catch (error) {
        console.error('[supabase-admin] Server not configured:', errorText(error));
        return { ok: false, response: jsonError('Server is not configured for admin actions.', 500) };
    }

    const header = req.headers.get('authorization') || '';
    const match = header.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
        return { ok: false, response: jsonError('Missing authentication token', 401) };
    }

    const { data: userData, error: userError } = await admin.auth.getUser(match[1]);
    if (userError || !userData.user) {
        return { ok: false, response: jsonError('Invalid or expired authentication token', 401) };
    }
    const callerId = userData.user.id;

    const { data: profile, error: profileError } = await admin
        .from(TABLES.PROFILES)
        .select('role, is_approved, is_disabled')
        .eq('id', callerId)
        .maybeSingle();
    if (profileError) {
        console.error('[supabase-admin] Failed to load caller profile:', profileError.message);
        return { ok: false, response: jsonError('Could not verify permissions', 500) };
    }
    if (!profile || profile.role !== 'admin' || profile.is_approved !== true || profile.is_disabled === true) {
        return { ok: false, response: jsonError('Admin privileges required', 403) };
    }

    return { ok: true, callerId, admin };
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
