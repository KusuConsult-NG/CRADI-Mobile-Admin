// Server-side helpers shared by the admin user API routes.
import 'server-only';
import type { User } from '@supabase/supabase-js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNotFound(error: { status?: number; code?: string } | null): boolean {
    return !!error && (error.status === 404 || error.code === 'user_not_found');
}

/** True when the Auth account has proven ownership of its email or phone. */
export function isAuthUserConfirmed(user: Pick<User, 'email_confirmed_at' | 'phone_confirmed_at'> | null): boolean {
    return !!user && (!!user.email_confirmed_at || !!user.phone_confirmed_at);
}
