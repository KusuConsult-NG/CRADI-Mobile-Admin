'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { Shield, Loader2, AlertCircle } from 'lucide-react';

export default function LoginPage() {
    const { login, loading: authLoading } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const router = useRouter();

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await login(email, password);
        } catch (error: any) {
            setError(error.message || 'Failed to sign in. Please check your credentials.');
        } finally {
            setLoading(false);
        }
    }

    if (authLoading) {
        return (
            <div className="min-h-screen login-gradient flex items-center justify-center">
                <div className="glass-card rounded-2xl p-8">
                    <Loader2 className="w-12 h-12 animate-spin text-blue-400" />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen login-gradient flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo and Title */}
                <div className="text-center mb-8 animate-fadeIn">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-3xl mb-6 shadow-2xl">
                        <Shield className="w-10 h-10 text-white drop-shadow-lg" />
                    </div>
                    <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
                        CRADI Admin
                    </h1>
                    <p className="text-blue-200 text-lg">
                        Climate Risk & Disaster Intelligence
                    </p>
                </div>

                {/* Login Form */}
                <div className="glass-card rounded-2xl p-8 shadow-2xl">
                    <h2 className="text-2xl font-semibold text-white mb-6">
                        Sign In
                    </h2>

                    {error && (
                        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-200">{error}</p>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                                Email Address
                            </label>
                            <input
                                type="email"
                                id="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="input-modern w-full px-4 py-3.5 rounded-lg text-white placeholder-gray-500"
                                placeholder="admin@cradi.org"
                                disabled={loading}
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                                Password
                            </label>
                            <input
                                type="password"
                                id="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="input-modern w-full px-4 py-3.5 rounded-lg text-white placeholder-gray-500"
                                placeholder="••••••••"
                                disabled={loading}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full text-white py-3.5 px-4 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Signing in...
                                </>
                            ) : (
                                'Sign In'
                            )}
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <p className="text-sm text-gray-400 flex items-center justify-center gap-2">
                            <Shield className="w-4 h-4" />
                            Admin access only
                        </p>
                    </div>
                </div>

                <p className="text-center text-sm text-blue-200/60 mt-8">
                    © 2026 CRADI. All rights reserved.
                </p>
            </div>

            <style jsx>{`
                @keyframes fadeIn {
                    from {
                        opacity: 0;
                        transform: translateY(-20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                .animate-fadeIn {
                    animation: fadeIn 0.6s ease-out;
                }
            `}</style>
        </div>
    );
}
