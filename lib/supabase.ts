import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// NEXT_PUBLIC_* values are inlined at build time, so they must be set in the
// build environment (e.g. Railway service variables) as well as at runtime.
// The anon key is public; all data access is enforced by Row Level Security.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const MISSING_SUPABASE_ENV = [
    !SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL',
    !SUPABASE_ANON_KEY && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
].filter((v): v is string => Boolean(v));

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client (lazy singleton). The session is persisted in
 * localStorage and refreshed automatically. Only call this from client code
 * (effects / event handlers), never during server rendering.
 */
export function getSupabase(): SupabaseClient {
    if (!isSupabaseConfigured) {
        throw new Error(`Supabase is not configured. Missing: ${MISSING_SUPABASE_ENV.join(', ')}`);
    }
    if (!client) {
        client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: false,
                storageKey: 'cradi-admin-auth',
            },
        });
    }
    return client;
}

/** Converts a stored image reference (public URL or bucket path) to a URL. */
export function publicImageUrl(bucket: string, value: string): string | null {
    const v = value.trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    return getSupabase().storage.from(bucket).getPublicUrl(v.replace(/^\/+/, '')).data.publicUrl;
}
