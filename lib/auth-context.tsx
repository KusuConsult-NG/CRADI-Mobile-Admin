'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    type User,
} from 'firebase/auth';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { auth } from '@/lib/firebase';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    /** Returns a fresh Firebase ID token for authenticating admin API calls. */
    getIdToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const ADMIN_REQUIRED_MESSAGE = 'Access denied. This account does not have admin privileges.';

/** Admin = custom claim `admin == true` or `role == 'admin'` (matches Firestore rules). */
async function hasAdminClaim(user: User): Promise<boolean> {
    // Force refresh so recently granted/revoked claims are picked up.
    const result = await user.getIdTokenResult(true);
    return result.claims.admin === true || result.claims.role === 'admin';
}

function authErrorCode(error: unknown): string | undefined {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = (error as { code: unknown }).code;
        return typeof code === 'string' ? code : undefined;
    }
    return undefined;
}

export function friendlyAuthError(error: unknown): string {
    switch (authErrorCode(error)) {
        case 'auth/invalid-credential':
        case 'auth/invalid-login-credentials':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
            return 'Incorrect email or password.';
        case 'auth/invalid-email':
            return 'Please enter a valid email address.';
        case 'auth/user-disabled':
            return 'This account has been disabled. Please contact support.';
        case 'auth/too-many-requests':
            return 'Too many failed attempts. Please wait a moment and try again.';
        case 'auth/network-request-failed':
            return 'Network error. Check your connection and try again.';
        case 'auth/operation-not-allowed':
            return 'Email/password sign-in is not enabled for this project.';
        default:
            if (error instanceof Error && error.message === ADMIN_REQUIRED_MESSAGE) {
                return ADMIN_REQUIRED_MESSAGE;
            }
            return 'Failed to sign in. Please try again.';
    }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (!firebaseUser) {
                setUser(null);
                setLoading(false);
                return;
            }
            try {
                if (await hasAdminClaim(firebaseUser)) {
                    setUser(firebaseUser);
                } else {
                    // Not an admin: end the session silently (login() reports the error).
                    setUser(null);
                    await signOut(auth);
                }
            } catch (error) {
                console.error('Failed to verify admin claims:', error);
                setUser(null);
            } finally {
                setLoading(false);
            }
        });
        return unsubscribe;
    }, []);

    const login = useCallback(async (email: string, password: string) => {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        const isAdmin = await hasAdminClaim(credential.user);
        if (!isAdmin) {
            await signOut(auth);
            throw new Error(ADMIN_REQUIRED_MESSAGE);
        }
        setUser(credential.user);
        toast.success('Logged in successfully');
    }, []);

    const logout = useCallback(async () => {
        try {
            await signOut(auth);
            setUser(null);
            toast.success('Logged out successfully');
            router.push('/login');
        } catch (error) {
            console.error('Logout error:', error);
            toast.error('Logout failed. Please try again.');
        }
    }, [router]);

    const getIdToken = useCallback(async () => {
        const current = auth.currentUser;
        if (!current) throw new Error('Not signed in');
        return current.getIdToken();
    }, []);

    const value = useMemo(
        () => ({ user, loading, login, logout, getIdToken }),
        [user, loading, login, logout, getIdToken],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
