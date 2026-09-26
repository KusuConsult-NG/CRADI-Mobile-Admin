'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { getSupabase, isSupabaseConfigured, MISSING_SUPABASE_ENV } from '@/lib/supabase';
import { TABLES } from '@/lib/constants';

export interface AdminUser {
    id: string;
    email: string | null;
    name: string | null;
}

interface AuthContextType {
    user: AdminUser | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    /** Ends this browser's session and goes to /login; false if sign-out failed. */
    logout: () => Promise<boolean>;
    /** Returns a current Supabase access token for authenticating admin API calls. */
    getAccessToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const ADMIN_REQUIRED_MESSAGE =
    'Access denied. This account is not an approved, active administrator.';

export const ADMIN_REVOKED_MESSAGE =
    'Your administrator access has been revoked or your account was disabled. You have been signed out.';

/** Minimum gap between admin re-checks triggered by window focus. */
const FOCUS_RECHECK_INTERVAL_MS = 60_000;

/**
 * Ends only this browser's session. The default scope ('global') would revoke
 * every refresh token for the user, signing them out of the mobile app and
 * all other devices too.
 */
function signOutLocal() {
    return getSupabase().auth.signOut({ scope: 'local' });
}

class AdminRequiredError extends Error {
    constructor() {
        super(ADMIN_REQUIRED_MESSAGE);
        this.name = 'AdminRequiredError';
    }
}

/**
 * Loads the signed-in user's own profile and returns it only if it is an
 * approved, non-disabled admin (same rule as public.app_role() in the DB).
 */
async function loadAdminProfile(session: Session): Promise<AdminUser | null> {
    const { data, error } = await getSupabase()
        .from(TABLES.PROFILES)
        .select('id, email, name, role, is_approved, is_disabled')
        .eq('id', session.user.id)
        .maybeSingle();
    if (error) throw error;
    if (!data || data.role !== 'admin' || data.is_approved !== true || data.is_disabled === true) {
        return null;
    }
    return {
        id: session.user.id,
        email: (data.email as string | null) ?? session.user.email ?? null,
        name: typeof data.name === 'string' && data.name.trim() && data.name !== 'User' ? data.name : null,
    };
}

function field(error: unknown, key: 'code' | 'name' | 'message'): string | undefined {
    if (typeof error === 'object' && error !== null && key in error) {
        const v = (error as Record<string, unknown>)[key];
        return typeof v === 'string' ? v : undefined;
    }
    return undefined;
}

export function friendlyAuthError(error: unknown): string {
    if (error instanceof AdminRequiredError) return ADMIN_REQUIRED_MESSAGE;

    const code = field(error, 'code');
    const name = field(error, 'name');
    const status =
        typeof error === 'object' && error !== null && 'status' in error
            ? (error as { status: unknown }).status
            : undefined;

    switch (code) {
        case 'invalid_credentials':
        case 'user_not_found':
            return 'Incorrect email or password.';
        case 'email_address_invalid':
        case 'validation_failed':
            return 'Please enter a valid email address.';
        case 'email_not_confirmed':
            return 'This email address has not been confirmed yet.';
        case 'user_banned':
            return 'This account has been disabled. Please contact support.';
        case 'over_request_rate_limit':
            return 'Too many failed attempts. Please wait a moment and try again.';
        case 'email_provider_disabled':
            return 'Email/password sign-in is not enabled for this project.';
    }
    if (status === 429) return 'Too many failed attempts. Please wait a moment and try again.';
    if (name === 'AuthRetryableFetchError' || (error instanceof TypeError && /fetch/i.test(error.message))) {
        return 'Network error. Check your connection and try again.';
    }
    return 'Failed to sign in. Please try again.';
}

function ConfigErrorScreen() {
    return (
        <div className="min-h-screen login-gradient flex items-center justify-center p-4">
            <div className="glass-card rounded-2xl p-8 max-w-lg w-full text-white">
                <h1 className="text-2xl font-bold mb-3">Configuration required</h1>
                <p className="text-red-100 mb-4">
                    The admin panel cannot connect to Supabase because these environment variables are not set:
                </p>
                <ul className="mb-4 space-y-1">
                    {MISSING_SUPABASE_ENV.map((name) => (
                        <li key={name}>
                            <code className="px-2 py-0.5 rounded bg-black/30 text-sm">{name}</code>
                        </li>
                    ))}
                </ul>
                <p className="text-sm text-red-100/80">
                    Set them in <code>.env.local</code> (local development) or in the hosting provider&apos;s
                    variables (e.g. Railway), then rebuild and restart. <code>NEXT_PUBLIC_*</code> values are
                    embedded at build time.
                </p>
            </div>
        </div>
    );
}

function ConfiguredAuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AdminUser | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    // While login() runs it handles verification itself (and reports errors).
    const loginInProgress = useRef(false);
    const verifiedUserId = useRef<string | null>(null);

    useEffect(() => {
        const supabase = getSupabase();
        let cancelled = false;

        async function verify(session: Session) {
            try {
                const admin = await loadAdminProfile(session);
                if (cancelled) return;
                if (admin) {
                    verifiedUserId.current = admin.id;
                    setUser(admin);
                } else {
                    // Not an admin: end the session silently (login() reports the error).
                    verifiedUserId.current = null;
                    setUser(null);
                    await signOutLocal();
                }
            } catch (error) {
                console.error('Failed to verify admin profile:', error);
                if (!cancelled) setUser(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        /**
         * Re-checks an already verified session (token refresh, window focus):
         * if the account was demoted, unapproved or disabled meanwhile, end the
         * local session and say why. Transient errors keep the current state.
         */
        let lastRecheck = 0;
        let recheckInFlight = false;
        async function recheck(session: Session) {
            if (recheckInFlight || loginInProgress.current) return;
            recheckInFlight = true;
            lastRecheck = Date.now();
            try {
                const admin = await loadAdminProfile(session);
                if (cancelled || verifiedUserId.current !== session.user.id) return;
                if (admin) {
                    setUser((prev) =>
                        prev && prev.id === admin.id && prev.email === admin.email && prev.name === admin.name
                            ? prev
                            : admin,
                    );
                    return;
                }
                verifiedUserId.current = null;
                setUser(null);
                await signOutLocal();
                toast.error(ADMIN_REVOKED_MESSAGE, { duration: 8000 });
            } catch (error) {
                console.error('Failed to re-check admin profile:', error);
            } finally {
                recheckInFlight = false;
            }
        }

        const { data } = supabase.auth.onAuthStateChange((event, session) => {
            if (!session) {
                verifiedUserId.current = null;
                setUser(null);
                setLoading(false);
                return;
            }
            if (loginInProgress.current) return;
            if (session.user.id === verifiedUserId.current) {
                // Defer: Supabase recommends not awaiting other client calls inside this callback.
                if (event === 'TOKEN_REFRESHED') setTimeout(() => void recheck(session), 0);
                return;
            }
            setTimeout(() => void verify(session), 0);
        });

        async function onFocus() {
            if (!verifiedUserId.current || Date.now() - lastRecheck < FOCUS_RECHECK_INTERVAL_MS) return;
            const { data: current } = await supabase.auth.getSession();
            if (current.session && current.session.user.id === verifiedUserId.current) {
                await recheck(current.session);
            }
        }
        const handleFocus = () => void onFocus();
        window.addEventListener('focus', handleFocus);

        return () => {
            cancelled = true;
            data.subscription.unsubscribe();
            window.removeEventListener('focus', handleFocus);
        };
    }, []);

    const login = useCallback(async (email: string, password: string) => {
        const supabase = getSupabase();
        loginInProgress.current = true;
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password,
            });
            if (error) throw error;
            if (!data.session) throw new Error('No session returned');

            let admin: AdminUser | null;
            try {
                admin = await loadAdminProfile(data.session);
            } catch (profileError) {
                await signOutLocal();
                throw profileError;
            }
            if (!admin) {
                await signOutLocal();
                throw new AdminRequiredError();
            }
            verifiedUserId.current = admin.id;
            setUser(admin);
            setLoading(false);
            toast.success('Logged in successfully');
        } finally {
            loginInProgress.current = false;
        }
    }, []);

    const logout = useCallback(async () => {
        const { error } = await signOutLocal();
        if (error) {
            console.error('Logout error:', error);
            toast.error('Logout failed. Please try again.');
            return false;
        }
        verifiedUserId.current = null;
        setUser(null);
        toast.success('Logged out successfully');
        router.replace('/login');
        return true;
    }, [router]);

    const getAccessToken = useCallback(async () => {
        const { data, error } = await getSupabase().auth.getSession();
        if (error || !data.session) throw new Error('Your session has expired. Please sign in again.');
        return data.session.access_token;
    }, []);

    const value = useMemo(
        () => ({ user, loading, login, logout, getAccessToken }),
        [user, loading, login, logout, getAccessToken],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    if (!isSupabaseConfigured) return <ConfigErrorScreen />;
    return <ConfiguredAuthProvider>{children}</ConfiguredAuthProvider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
