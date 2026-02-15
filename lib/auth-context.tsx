'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { account } from '@/lib/appwrite';
import { Models } from 'appwrite';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

interface AuthContextType {
    user: Models.User<Models.Preferences> | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<Models.User<Models.Preferences> | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        checkAuth();
    }, []);

    async function checkAuth() {
        try {
            const currentUser = await account.get();

            // Verify admin label
            const isAdmin = currentUser.labels && currentUser.labels.includes('admin');

            if (isAdmin) {
                setUser(currentUser);
            } else {
                // Not an admin - clear session
                await account.deleteSession('current');
                setUser(null);
            }
        } catch (error) {
            setUser(null);
        } finally {
            setLoading(false);
        }
    }

    async function login(email: string, password: string) {
        try {
            await account.createEmailPasswordSession(email, password);
            const currentUser = await account.get();

            // Check if user has admin label
            const isAdmin = currentUser.labels && currentUser.labels.includes('admin');

            if (!isAdmin) {
                // Not an admin - delete session and show error
                await account.deleteSession('current');
                toast.error('Access denied. Admin privileges required.');
                throw new Error('Admin access required');
            }

            setUser(currentUser);
            toast.success('Logged in successfully');
            router.push('/dashboard');
        } catch (error: any) {
            console.error('Login error:', error);
            if (error.message === 'Admin access required') {
                toast.error('You do not have admin access');
            } else {
                toast.error(error.message || 'Login failed');
            }
            throw error;
        }
    }

    async function logout() {
        try {
            await account.deleteSession('current');
            setUser(null);
            toast.success('Logged out successfully');
            router.push('/login');
        } catch (error: any) {
            console.error('Logout error:', error);
            toast.error(error.message || 'Logout failed');
        }
    }

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
