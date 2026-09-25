#!/usr/bin/env node
/**
 * Promote an existing Supabase user to an approved admin.
 *
 * Updates public.profiles for that user: role = 'admin', is_approved = true,
 * is_disabled = false. Uses the service role key (bypasses RLS) — run it
 * locally or in a trusted shell only.
 *
 * Env:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   npm run set:admin -- admin@example.org
 *   node --env-file=.env.local scripts/set-admin.mjs admin@example.org
 */
import { createClient } from '@supabase/supabase-js';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email || !email.includes('@')) {
    console.error('Usage: node scripts/set-admin.mjs <email>');
    process.exit(1);
}

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !serviceKey) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
}

const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
});

/** Finds the auth user id by email: profiles first, then a scan of auth users. */
async function findUserId() {
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', email)
        .limit(1)
        .maybeSingle();
    if (error) throw new Error(`Profile lookup failed: ${error.message}`);
    if (profile) return profile.id;

    const perPage = 1000;
    for (let page = 1; ; page += 1) {
        const { data, error: listError } = await supabase.auth.admin.listUsers({ page, perPage });
        if (listError) throw new Error(`Auth user lookup failed: ${listError.message}`);
        const match = data.users.find((u) => (u.email || '').toLowerCase() === email);
        if (match) return match.id;
        if (data.users.length < perPage) return null;
    }
}

async function main() {
    const userId = await findUserId();
    if (!userId) {
        throw new Error(`No user with email ${email}. The user must sign up (mobile app or Supabase dashboard) first.`);
    }

    const { data, error } = await supabase
        .from('profiles')
        .update({ role: 'admin', is_approved: true, is_disabled: false })
        .eq('id', userId)
        .select('id');
    if (error) throw new Error(`Profile update failed: ${error.message}`);
    if (!data || data.length === 0) {
        throw new Error(`User ${userId} has no profile row (was the schema migration applied before sign-up?).`);
    }

    // Make sure a previously blocked account can sign in again.
    const { error: unbanError } = await supabase.auth.admin.updateUserById(userId, { ban_duration: 'none' });
    if (unbanError) console.warn(`Warning: could not clear ban: ${unbanError.message}`);

    console.log(`Granted admin to ${email} (id: ${userId}). Sign in to the admin panel with this account.`);
}

main().catch((error) => {
    console.error(`Failed to set admin: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
});
