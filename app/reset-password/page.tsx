'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import toast from 'react-hot-toast';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { CLIENT_FUNCTION, ROUTES, createRecoveryClient, type Appwrite } from '@/lib/appwrite';
import { BackendError, executeFunction } from '@/lib/function-call';
import { PASSWORD_RULES, validatePassword } from '@/lib/password';

/**
 * Password recovery in the browser.
 *
 * Appwrite's recovery is a **typed code**, not a link. Phase 2 of the
 * migration kept it that way deliberately: a six-character code works in
 * the mobile app, in this page and read aloud down a phone line, and it
 * removes the whole class of problems the Supabase link had — two
 * different token shapes to detect, a `redirectTo` that had to resolve a
 * custom scheme, and a desktop browser that could not open either.
 *
 * So there is nothing to read out of the URL and nothing to scrub from
 * the address bar. The page asks for the address, the `auth` Function
 * mails a code, and the code plus the new password finish the reset.
 *
 * Three calls, all to the `auth` Function, because each is something a
 * client may not be trusted to do for itself:
 *
 *   1. `sendRecoveryCode` — answers the same whether or not the address
 *      has an account, so this page cannot be used to find out which
 *      addresses are registered.
 *   2. `verifyRecovery` — exchanges the code for a session. The session
 *      is good only for the password change that follows.
 *   3. `setPassword` — reads whose password to change from the session,
 *      never from the body.
 *
 * It runs on its own client (`createRecoveryClient`), so the recovery
 * session never replaces a signed-in admin's and is never seen by the
 * admin guard in lib/auth-context.tsx — that guard signs out any session
 * that is not an approved admin, which would abort a legitimate reset for
 * a non-admin staff member.
 */

type Status = 'request' | 'code' | 'done';

function field(error: unknown, key: 'type' | 'name' | 'message'): string | undefined {
    if (typeof error === 'object' && error !== null && key in error) {
        const value = (error as Record<string, unknown>)[key];
        return typeof value === 'string' ? value : undefined;
    }
    return undefined;
}

function isNetworkError(error: unknown): boolean {
    return error instanceof TypeError && /fetch|network/i.test(error.message);
}

/** Message for a failed code exchange. */
function friendlyCodeError(error: unknown): string {
    if (isNetworkError(error)) return 'Network error. Check your connection and try again.';
    const type = error instanceof BackendError ? error.type : field(error, 'type');
    switch (type) {
        case 'general_rate_limit_exceeded':
            return 'Too many attempts. Please wait a moment and try again.';
        case 'user_blocked':
            return 'This account has been disabled. Please contact support.';
        case 'user_invalid_token':
            return 'That code is invalid or has expired. Request a new one and use the newest email.';
        default:
            return field(error, 'message') || 'That code could not be used. Request a new one.';
    }
}

/** Message for a failed password change. */
function friendlyUpdateError(error: unknown): string {
    if (isNetworkError(error)) return 'Network error. Check your connection and try again.';
    const type = error instanceof BackendError ? error.type : field(error, 'type');
    switch (type) {
        case 'general_password_weak':
        case 'password_personal_data':
            return field(error, 'message') || 'That password is too weak. Please choose a stronger one.';
        case 'password_recently_used':
            return 'Your new password must be different from a password you have used before.';
        case 'user_unauthorized':
        case 'general_unauthorized_scope':
            return 'That code is invalid or has expired. Request a new one.';
        case 'general_rate_limit_exceeded':
            return 'Too many attempts. Please wait a moment and try again.';
        default:
            return field(error, 'message') || 'Could not update your password. Please try again.';
    }
}

/** The code the Function mails: six alphanumeric characters, case-insensitive. */
const CODE_LENGTH = 6;

export default function ResetPasswordPage() {
    const [status, setStatus] = useState<Status>('request');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [sending, setSending] = useState(false);
    const [saving, setSaving] = useState(false);
    const client = useRef<Appwrite | null>(null);

    function recoveryClient(): Appwrite | null {
        if (client.current) return client.current;
        try {
            client.current = createRecoveryClient();
            return client.current;
        } catch {
            setError('The admin panel is not configured to reach Appwrite. Contact an administrator.');
            return null;
        }
    }

    const requestCode = useCallback(
        async (event: React.FormEvent) => {
            event.preventDefault();
            setError('');
            const address = email.trim();
            if (!address) {
                setError('Enter the email address of the account.');
                return;
            }
            const appwrite = recoveryClient();
            if (!appwrite) return;

            setSending(true);
            try {
                await executeFunction(appwrite, CLIENT_FUNCTION, {
                    action: 'sendRecoveryCode',
                    email: address,
                }, ROUTES.AUTH);
                // Deliberately the same message whether or not the address has
                // an account: the Function answers identically, and saying "we sent
                // you a code" only for real accounts would undo that.
                toast.success('If that address has an account, a code is on its way.');
                setStatus('code');
            } catch (caught) {
                setError(friendlyCodeError(caught));
            } finally {
                setSending(false);
            }
        },
        [email],
    );

    const submitCode = useCallback(
        async (event: React.FormEvent) => {
            event.preventDefault();
            setError('');

            const typed = code.trim();
            if (typed.length !== CODE_LENGTH) {
                setError(`Enter the ${CODE_LENGTH}-character code from the email.`);
                return;
            }
            const ruleError = validatePassword(password);
            if (ruleError) {
                setError(ruleError);
                return;
            }
            if (password !== confirm) {
                setError('Passwords do not match.');
                return;
            }
            const appwrite = recoveryClient();
            if (!appwrite) return;

            setSaving(true);
            try {
                const redeemed = await executeFunction(appwrite, CLIENT_FUNCTION, {
                    action: 'verifyRecovery',
                    email: email.trim(),
                    code: typed,
                }, ROUTES.AUTH);
                const secret = redeemed.sessionSecret;
                if (typeof secret !== 'string' || !secret) {
                    throw new BackendError('The server did not return a session', 502);
                }
                appwrite.client.setSession(secret);

                try {
                    await executeFunction(appwrite, CLIENT_FUNCTION, {
                        action: 'setPassword',
                        password,
                    }, ROUTES.AUTH);
                } finally {
                    // Whether or not the change succeeded: this session exists
                    // only for it, and leaving it alive would leave a usable
                    // session minted from a code.
                    await appwrite.account.deleteSession({ sessionId: 'current' }).catch(() => {});
                    client.current = null;
                }

                toast.success('Password updated successfully');
                setStatus('done');
            } catch (caught) {
                setError(
                    caught instanceof BackendError && caught.status === 401
                        ? friendlyCodeError(caught)
                        : friendlyUpdateError(caught),
                );
            } finally {
                setSaving(false);
            }
        },
        [code, password, confirm, email],
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
                    <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">CRADI / EWER</h1>
                    <p className="text-red-200 text-lg">Password reset</p>
                </div>

                <div className="glass-card rounded-2xl p-8 shadow-2xl">
                    {status === 'request' && (
                        <>
                            <h2 className="text-2xl font-semibold text-white mb-6">Reset your password</h2>
                            <p className="mb-6 text-sm text-gray-300">
                                Enter the address of the account. If it has one, we will email a
                                {' '}{CODE_LENGTH}-character code to type in on the next step.
                            </p>

                            {error && (
                                <div
                                    role="alert"
                                    className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3"
                                >
                                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                                    <p className="text-sm text-red-200">{error}</p>
                                </div>
                            )}

                            <form onSubmit={requestCode} className="space-y-5" noValidate>
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
                                        autoComplete="email"
                                        className="input-modern w-full px-4 py-3.5 rounded-lg text-white placeholder-gray-500"
                                        placeholder="you@example.org"
                                        disabled={sending}
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={sending}
                                    className="btn-primary w-full text-white py-3.5 px-4 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base"
                                >
                                    {sending ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Sending…
                                        </>
                                    ) : (
                                        'Email me a code'
                                    )}
                                </button>
                            </form>

                            <div className="mt-6 flex flex-col items-center gap-2 text-center">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setError('');
                                        setStatus('code');
                                    }}
                                    className="text-sm text-gray-400 hover:text-gray-300"
                                >
                                    I already have a code
                                </button>
                                <Link href="/login" className="text-sm text-gray-400 hover:text-gray-300">
                                    Back to Admin Sign In
                                </Link>
                            </div>
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
                                    Your password has been changed. Sign in again with your new
                                    password.
                                </p>
                            </div>
                            <p className="mb-4 text-sm text-gray-300">
                                <strong className="text-white">Using the CRADI mobile app?</strong> You are done here
                                — open the app and sign in with your new password. The sign-in button below is for
                                staff using the admin panel.
                            </p>
                            <Link
                                href="/login"
                                className="btn-primary w-full text-white py-3.5 px-4 rounded-lg font-semibold flex items-center justify-center gap-2 text-base"
                            >
                                Go to Admin Sign In
                            </Link>
                        </>
                    )}

                    {status === 'code' && (
                        <>
                            <h2 className="text-2xl font-semibold text-white mb-6">Enter your code</h2>

                            {error && (
                                <div
                                    role="alert"
                                    className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3"
                                >
                                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                                    <p className="text-sm text-red-200">{error}</p>
                                </div>
                            )}

                            <form onSubmit={submitCode} className="space-y-5" noValidate>
                                <div>
                                    <label htmlFor="code" className="block text-sm font-medium text-gray-300 mb-2">
                                        Code from the email
                                    </label>
                                    <input
                                        type="text"
                                        id="code"
                                        value={code}
                                        onChange={(e) => setCode(e.target.value)}
                                        required
                                        inputMode="text"
                                        autoCapitalize="characters"
                                        autoComplete="one-time-code"
                                        spellCheck={false}
                                        maxLength={CODE_LENGTH}
                                        className="input-modern w-full px-4 py-3.5 rounded-lg text-white placeholder-gray-500 tracking-[0.4em] font-mono uppercase"
                                        placeholder="A1B2C3"
                                        disabled={saving}
                                    />
                                    <p className="mt-2 text-xs text-gray-400">
                                        {CODE_LENGTH} letters and digits. Letters are not case sensitive.
                                    </p>
                                </div>

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

                            <div className="mt-6 flex flex-col items-center gap-2 text-center">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setError('');
                                        setCode('');
                                        setStatus('request');
                                    }}
                                    className="text-sm text-gray-400 hover:text-gray-300"
                                    disabled={saving}
                                >
                                    Send me a new code
                                </button>
                                <Link href="/login" className="text-sm text-gray-400 hover:text-gray-300">
                                    Back to Admin Sign In
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
