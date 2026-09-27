'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Link from 'next/link';
import Image from 'next/image';
import toast from 'react-hot-toast';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { createRecoveryClient } from '@/lib/supabase';
import { PASSWORD_RULES, validatePassword } from '@/lib/password';

/**
 * Password recovery in the browser.
 *
 * The recovery mail carries both halves of the same reset (see
 * docs/DEPLOYMENT.md § 1a.d in the mobile repo): the 6-digit `{{ .Token }}`
 * that the mobile app asks for, and a link to this page. Supabase can deliver
 * that link in either of two shapes, so both are handled:
 *
 *   1. `?token_hash=<hash>&type=recovery` — what `{{ .TokenHash }}` (and the
 *      PKCE form of `{{ .ConfirmationURL }}`) produces. Exchanged with
 *      `verifyOtp({ token_hash, type: 'recovery' })`.
 *   2. `#access_token=…&refresh_token=…&type=recovery` — the implicit-flow
 *      fragment GoTrue redirects to after its own `/auth/v1/verify`. Fed to
 *      `setSession(...)`.
 *
 * Which one arrives depends on the template and on the client flow type, and
 * the fragment form is also what a plain `{{ .ConfirmationURL }}` ends up as,
 * so the page detects whichever is present instead of assuming one.
 *
 * The token is read from the URL here rather than by the Supabase client:
 * `lib/supabase.ts` sets `detectSessionInUrl: false` for the shared client on
 * purpose and that stays as it is. This page uses an isolated, non-persisting
 * client (`createRecoveryClient`) so the recovery session never reaches
 * localStorage or the admin guard in lib/auth-context.tsx.
 */

type Status = 'verifying' | 'ready' | 'invalid' | 'done';

const INVALID_LINK =
    'This password reset link is invalid or has expired. Request a new reset email and open the newest one.';

const NO_LINK =
    'This page needs a password reset link. Open the most recent reset email and follow the link in it, or use the 6-digit code in the CRADI mobile app.';

function field(error: unknown, key: 'code' | 'name' | 'message'): string | undefined {
    if (typeof error === 'object' && error !== null && key in error) {
        const value = (error as Record<string, unknown>)[key];
        return typeof value === 'string' ? value : undefined;
    }
    return undefined;
}

function isNetworkError(error: unknown): boolean {
    return (
        field(error, 'name') === 'AuthRetryableFetchError' ||
        (error instanceof TypeError && /fetch/i.test(error.message))
    );
}

/** Message for a failed token exchange (verifyOtp / setSession). */
function friendlyLinkError(error: unknown): string {
    if (isNetworkError(error)) return 'Network error. Check your connection and try again.';
    switch (field(error, 'code')) {
        case 'over_request_rate_limit':
        case 'over_email_send_rate_limit':
            return 'Too many attempts. Please wait a moment and try again.';
        case 'user_banned':
            return 'This account has been disabled. Please contact support.';
        default:
            return INVALID_LINK;
    }
}

/** Message for a failed updateUser. */
function friendlyUpdateError(error: unknown): string {
    if (isNetworkError(error)) return 'Network error. Check your connection and try again.';
    const code = field(error, 'code');
    // Supabase enforces the project's own password policy; show its wording.
    if (code === 'weak_password') {
        return field(error, 'message') || 'That password is too weak. Please choose a stronger one.';
    }
    switch (code) {
        case 'same_password':
            return 'Your new password must be different from your current password.';
        case 'session_not_found':
        case 'bad_jwt':
            return INVALID_LINK;
        case 'over_request_rate_limit':
            return 'Too many attempts. Please wait a moment and try again.';
        default:
            return field(error, 'message') || 'Could not update your password. Please try again.';
    }
}

/** Removes the recovery token from the address bar without reloading. */
function scrubUrl() {
    window.history.replaceState(null, '', window.location.pathname);
}

export default function ResetPasswordPage() {
    const [status, setStatus] = useState<Status>('verifying');
    const [linkError, setLinkError] = useState(NO_LINK);
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const client = useRef<SupabaseClient | null>(null);
    // The token is single use: never exchange it twice (remounts, fast refresh).
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;

        const fail = (message: string) => {
            setLinkError(message);
            setStatus('invalid');
        };

        async function establishSession() {
            const url = new URL(window.location.href);
            const query = url.searchParams;
            const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
            const from = (key: string) => fragment.get(key) ?? query.get(key);

            // GoTrue reports its own failures (expired link, used link) by
            // redirecting here with error parameters instead of a token.
            if (from('error') || from('error_code')) {
                scrubUrl();
                const description = from('error_description');
                fail(description ? description.replace(/\+/g, ' ') : INVALID_LINK);
                return;
            }

            const tokenHash = query.get('token_hash') ?? query.get('token');
            const accessToken = fragment.get('access_token');
            const refreshToken = fragment.get('refresh_token');
            if (!tokenHash && !accessToken) {
                fail(NO_LINK);
                return;
            }

            const type = from('type');
            if (type && type !== 'recovery') {
                scrubUrl();
                fail('This link is not a password reset link. Open the most recent password reset email.');
                return;
            }

            let supabase: SupabaseClient;
            try {
                supabase = createRecoveryClient();
            } catch {
                fail('The admin panel is not configured to reach Supabase. Contact an administrator.');
                return;
            }

            try {
                if (tokenHash) {
                    const { error: verifyError } = await supabase.auth.verifyOtp({
                        token_hash: tokenHash,
                        type: 'recovery',
                    });
                    if (verifyError) throw verifyError;
                } else {
                    if (!refreshToken) {
                        scrubUrl();
                        fail(INVALID_LINK);
                        return;
                    }
                    const { error: sessionError } = await supabase.auth.setSession({
                        access_token: accessToken as string,
                        refresh_token: refreshToken,
                    });
                    if (sessionError) throw sessionError;
                }
            } catch (caught) {
                scrubUrl();
                fail(friendlyLinkError(caught));
                return;
            }

            client.current = supabase;
            scrubUrl();
            setStatus('ready');
        }

        void establishSession();
    }, []);

    const handleSubmit = useCallback(
        async (event: React.FormEvent) => {
            event.preventDefault();
            setError('');

            const ruleError = validatePassword(password);
            if (ruleError) {
                setError(ruleError);
                return;
            }
            if (password !== confirm) {
                setError('Passwords do not match.');
                return;
            }
            const supabase = client.current;
            if (!supabase) {
                setLinkError(INVALID_LINK);
                setStatus('invalid');
                return;
            }

            setSaving(true);
            try {
                const { error: updateError } = await supabase.auth.updateUser({ password });
                if (updateError) throw updateError;
                // End the recovery session everywhere, as the mobile app does,
                // so the next sign-in uses the new password.
                await supabase.auth.signOut({ scope: 'global' });
                client.current = null;
                toast.success('Password updated successfully');
                setStatus('done');
            } catch (caught) {
                setError(friendlyUpdateError(caught));
            } finally {
                setSaving(false);
            }
        },
        [password, confirm],
    );

    return (
        <div className="min-h-screen login-gradient flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo and Title */}
                <div className="text-center mb-8 animate-fadeIn">
                    <div className="inline-flex items-center justify-center mb-6">
                        <Image
                            src="/ewer-logo.png"
                            alt="EWER Logo"
                            width={200}
                            height={200}
                            className="drop-shadow-2xl"
                            priority
                        />
                    </div>
                    <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">EWER Admin</h1>
                    <p className="text-red-200 text-lg">Early Warning and Emergency Response</p>
                </div>

                <div className="glass-card rounded-2xl p-8 shadow-2xl">
                    {status === 'verifying' && (
                        <div className="flex flex-col items-center gap-4 py-6 text-center">
                            <Loader2 className="w-10 h-10 animate-spin text-red-400" />
                            <p className="text-gray-300">Checking your password reset link…</p>
                        </div>
                    )}

                    {status === 'invalid' && (
                        <>
                            <h2 className="text-2xl font-semibold text-white mb-6">Reset link problem</h2>
                            <div
                                role="alert"
                                className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3"
                            >
                                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-red-200">{linkError}</p>
                            </div>
                            <Link
                                href="/login"
                                className="btn-primary w-full text-white py-3.5 px-4 rounded-lg font-semibold flex items-center justify-center gap-2 text-base"
                            >
                                Back to Sign In
                            </Link>
                        </>
                    )}

                    {status === 'done' && (
                        <>
                            <h2 className="text-2xl font-semibold text-white mb-6">Password updated</h2>
                            <div
                                role="alert"
                                className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg flex items-start gap-3"
                            >
                                <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-green-200">
                                    Your password has been changed and you have been signed out everywhere. Sign in
                                    again with your new password.
                                </p>
                            </div>
                            <Link
                                href="/login"
                                className="btn-primary w-full text-white py-3.5 px-4 rounded-lg font-semibold flex items-center justify-center gap-2 text-base"
                            >
                                Go to Sign In
                            </Link>
                        </>
                    )}

                    {status === 'ready' && (
                        <>
                            <h2 className="text-2xl font-semibold text-white mb-6">Set a New Password</h2>

                            {error && (
                                <div
                                    role="alert"
                                    className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3"
                                >
                                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                                    <p className="text-sm text-red-200">{error}</p>
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                                <div>
                                    <label
                                        htmlFor="new-password"
                                        className="block text-sm font-medium text-gray-300 mb-2"
                                    >
                                        New Password
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showPassword ? 'text' : 'password'}
                                            id="new-password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            required
                                            autoComplete="new-password"
                                            className="input-modern w-full px-4 py-3.5 pr-12 rounded-lg text-white placeholder-gray-500"
                                            placeholder="••••••••"
                                            disabled={saving}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                                            disabled={saving}
                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                        >
                                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                        </button>
                                    </div>
                                    <ul className="mt-3 space-y-1 text-xs text-gray-400 list-disc list-inside">
                                        {PASSWORD_RULES.map((rule) => (
                                            <li key={rule}>{rule}</li>
                                        ))}
                                    </ul>
                                </div>

                                <div>
                                    <label
                                        htmlFor="confirm-password"
                                        className="block text-sm font-medium text-gray-300 mb-2"
                                    >
                                        Confirm New Password
                                    </label>
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        id="confirm-password"
                                        value={confirm}
                                        onChange={(e) => setConfirm(e.target.value)}
                                        required
                                        autoComplete="new-password"
                                        className="input-modern w-full px-4 py-3.5 rounded-lg text-white placeholder-gray-500"
                                        placeholder="••••••••"
                                        disabled={saving}
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="btn-primary w-full text-white py-3.5 px-4 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base"
                                >
                                    {saving ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Updating…
                                        </>
                                    ) : (
                                        'Update Password'
                                    )}
                                </button>
                            </form>

                            <div className="mt-6 text-center">
                                <Link href="/login" className="text-sm text-gray-400 hover:text-gray-300">
                                    Back to Sign In
                                </Link>
                            </div>
                        </>
                    )}
                </div>

                <p className="text-center text-sm text-red-200/60 mt-8">
                    © {new Date().getFullYear()} EWER. All rights reserved.
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
