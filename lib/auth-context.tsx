'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { getAppwrite, isAppwriteConfigured, MISSING_APPWRITE_ENV } from '@/lib/appwrite';
import { getRow } from '@/lib/data';
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
    /** Returns a short-lived Appwrite JWT for authenticating admin API calls. */
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
 * Ends only this browser's session.
 *
 * An Appwrite session is per-device, so deleting the current one leaves the
 * same account signed in on the mobile app — which is what `scope: 'local'`
 * bought under Supabase. `deleteSessions()` would end them all.
 */
function signOutLocal() {
    return getAppwrite().account.deleteSession({ sessionId: 'current' });
}

class AdminRequiredError extends Error {
    constructor() {
        super(ADMIN_REQUIRED_MESSAGE);
        this.name = 'AdminRequiredError';
    }
}

interface ProfileRow {
    email?: unknown;
    name?: unknown;
    role?: unknown;
    isApproved?: unknown;
    isDisabled?: unknown;
}

/**
 * Loads the signed-in user's own profile and returns it only if it is an
 * approved, non-disabled admin (the same rule the `write` Function applies).
 */
async function loadAdminProfile(userId: string, fallbackEmail: string | null): Promise<AdminUser | null> {
    const row = await getRow<ProfileRow>(TABLES.PROFILES, userId);
    if (!row || row.role !== 'admin' || row.isApproved !== true || row.isDisabled === true) {
        return null;
    }
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    return {
        id: userId,
        email: (typeof row.email === 'string' ? row.email : null) ?? fallbackEmail,
        name: name && name !== 'User' ? name : null,
    };
}

function field(error: unknown, key: 'type' | 'name' | 'message'): string | undefined {
    if (typeof error === 'object' && error !== null && key in error) {
        const v = (error as Record<string, unknown>)[key];
        return typeof v === 'string' ? v : undefined;
    }
    return undefined;
}

export function friendlyAuthError(error: unknown): string {
    if (error instanceof AdminRequiredError) return ADMIN_REQUIRED_MESSAGE;

    const type = field(error, 'type');
    const name = field(error, 'name');
    const code =
        typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code: unknown }).code
            : undefined;

    switch (type) {
        case 'user_invalid_credentials':
        case 'user_not_found':
            return 'Incorrect email or password.';
        case 'general_argument_invalid':
            return 'Please enter a valid email address.';
        case 'user_email_not_whitelisted':
        case 'user_blocked':
            return 'This account has been disabled. Please contact support.';
        case 'general_rate_limit_exceeded':
            return 'Too many failed attempts. Please wait a moment and try again.';
        case 'user_auth_method_unsupported':
            return 'Email/password sign-in is not enabled for this project.';
        case 'user_session_already_exists':
            return 'You are already signed in. Reload the page.';
    }
    if (code === 429) return 'Too many failed attempts. Please wait a moment and try again.';
    if (name === 'TypeError' || (error instanceof TypeError && /fetch/i.test(error.message))) {
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
                    The admin panel cannot connect to Appwrite. These environment variables need
                    attention:
                </p>
                <ul className="mb-4 space-y-1">
                    {MISSING_APPWRITE_ENV.map((name) => (
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
        const { account } = getAppwrite();
        let cancelled = false;

        /**
         * Appwrite has no `onAuthStateChange`: the session is a cookie, and
         * nothing tells the page when it changes. So the session is read once
         * on mount and re-checked on focus, which is also what catches an
         * account demoted, unapproved or disabled in another tab.
         */
        async function verify() {
            try {
                const account_ = await account.get();
                if (cancelled) return;
                const admin = await loadAdminProfile(account_.$id, account_.email || null);
                if (cancelled) return;
                if (admin) {
                    verifiedUserId.current = admin.id;
                    setUser(admin);
                } else {
                    // Not an admin: end the session silently (login() reports the error).
                    verifiedUserId.current = null;
                    setUser(null);
                    await signOutLocal().catch(() => {});
                }
            } catch {
                // No session, or it has expired. Both mean signed out.
                if (!cancelled) {
                    verifiedUserId.current = null;
                    setUser(null);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        let lastRecheck = 0;
        let recheckInFlight = false;
        async function recheck() {
            const userId = verifiedUserId.current;
            if (!userId || recheckInFlight || loginInProgress.current) return;
            recheckInFlight = true;
            lastRecheck = Date.now();
            try {
                const admin = await loadAdminProfile(userId, user?.email ?? null);
                if (cancelled || verifiedUserId.current !== userId) return;
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
                await signOutLocal().catch(() => {});
                toast.error(ADMIN_REVOKED_MESSAGE, { duration: 8000 });
            } catch (error) {
                // Transient errors keep the current state.
                console.error('Failed to re-check admin profile:', error);
            } finally {
                recheckInFlight = false;
            }
        }

        void verify();

        function onFocus() {
            if (!verifiedUserId.current || Date.now() - lastRecheck < FOCUS_RECHECK_INTERVAL_MS) return;
            void recheck();
        }
        window.addEventListener('focus', onFocus);

        return () => {
            cancelled = true;
            window.removeEventListener('focus', onFocus);
        };
        // Mount only: `user` is read inside `recheck` for a fallback email and
        // re-subscribing on every change would restart the whole guard.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const login = useCallback(async (email: string, password: string) => {
        const { account } = getAppwrite();
        loginInProgress.current = true;
        try {
            // A stale session makes Appwrite refuse the new one
            // (`user_session_already_exists`), which reads as a failed
            // password. Clearing it first is cheap and always safe here.
            await account.deleteSession({ sessionId: 'current' }).catch(() => {});

            const session = await account.createEmailPasswordSession({
                email: email.trim(),
                password,
            });

            let admin: AdminUser | null;
            try {
                admin = await loadAdminProfile(session.userId, email.trim());
            } catch (profileError) {
                await signOutLocal().catch(() => {});
                throw profileError;
            }
            if (!admin) {
                await signOutLocal().catch(() => {});
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
        try {
            await signOutLocal();
        } catch (error) {
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
        try {
            const { jwt } = await getAppwrite().account.createJWT();
            return jwt;
        } catch {
            throw new Error('Your session has expired. Please sign in again.');
        }
    }, []);

    const value = useMemo(
        () => ({ user, loading, login, logout, getAccessToken }),
        [user, loading, login, logout, getAccessToken],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    if (!isAppwriteConfigured) return <ConfigErrorScreen />;
    return <ConfiguredAuthProvider>{children}</ConfiguredAuthProvider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
