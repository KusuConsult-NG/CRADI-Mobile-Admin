'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { loginHref } from '@/lib/redirect';
import { type DashboardSection, ROLE_LABELS } from '@/lib/constants';

const NAV_LINKS: { href: string; label: string; section: DashboardSection }[] = [
    { href: '/dashboard', label: 'Dashboard', section: 'dashboard' },
    { href: '/dashboard/users', label: 'Users', section: 'users' },
    { href: '/dashboard/reports', label: 'Reports', section: 'reports' },
    { href: '/dashboard/knowledge', label: 'Knowledge', section: 'knowledge' },
    { href: '/dashboard/news', label: 'News', section: 'news' },
    { href: '/dashboard/alerts', label: 'Alerts', section: 'alerts' },
    { href: '/dashboard/authorities', label: 'Authorities', section: 'authorities' },
    { href: '/dashboard/settings', label: 'Settings', section: 'settings' },
];

function isActive(pathname: string, href: string): boolean {
    if (href === '/dashboard') return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The section a path belongs to, or null for a path outside the panel.
 *
 * Longest match first: `/dashboard/users/abc` is the users section, and
 * `/dashboard` itself must not claim it.
 */
function sectionOf(pathname: string): DashboardSection | null {
    const match = [...NAV_LINKS]
        .sort((a, b) => b.href.length - a.href.length)
        .find((link) => isActive(pathname, link.href));
    return match?.section ?? null;
}

/** Shared shell for every /dashboard page: auth guard + header with navigation and logout. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const { user, loading, logout } = useAuth();
    const router = useRouter();
    const pathname = usePathname() ?? '/dashboard';
    // Set while an explicit logout runs: logout() itself goes to plain /login,
    // so the guard below must not race it with /login?next=<this page>.
    const [loggingOut, setLoggingOut] = useState(false);

    useEffect(() => {
        // replace (not push) so Back does not return to a page that needs a session.
        if (!loading && !user && !loggingOut) router.replace(loginHref(pathname));
    }, [user, loading, loggingOut, router, pathname]);

    async function handleLogout() {
        setLoggingOut(true);
        // On success stay flagged: this layout unmounts once /login is shown.
        if (!(await logout())) setLoggingOut(false);
    }

    // Typed in directly, or reached from a bookmark made under a role that
    // had it. The nav does not offer it, which is not the same as the page
    // refusing to render — and these pages call privileged routes that
    // answer 403, so what the user would otherwise see is a screen of
    // failed requests.
    const section = sectionOf(pathname);
    const allowed = section !== null && (user?.sections.includes(section) ?? false);

    if (loading || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 text-gray-900">
            <header className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-[#E63946] to-[#9D0208] rounded-lg flex items-center justify-center">
                            <LayoutDashboard className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <p className="text-xl font-bold text-gray-900">EWER Admin</p>
                            <p className="text-xs text-gray-600">Early Warning and Emergency Response</p>
                        </div>
                    </Link>

                    <nav className="flex flex-wrap items-center gap-1" aria-label="Main">
                        {NAV_LINKS.filter(({ section }) => user.sections.includes(section)).map(({ href, label }) => {
                            const active = isActive(pathname, href);
                            return (
                                <Link
                                    key={href}
                                    href={href}
                                    aria-current={active ? 'page' : undefined}
                                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                        active ? 'bg-red-50 text-[#E63946]' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                    }`}
                                >
                                    {label}
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <p className="text-sm font-medium text-gray-900">{user.name || user.email}</p>
                            {/* The role, not the word "Administrator", which
                                was shown to every account that reached this
                                page regardless of what it actually was. */}
                            <p className="text-xs text-gray-500">{ROLE_LABELS[user.role]}</p>
                        </div>
                        <button
                            onClick={() => void handleLogout()}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                            <LogOut className="w-4 h-4" />
                            Logout
                        </button>
                    </div>
                </div>
            </header>
            {allowed ? (
                children
            ) : (
                <main className="max-w-7xl mx-auto px-6 py-16">
                    <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
                        <h1 className="text-lg font-semibold text-gray-900">Not available for your role</h1>
                        <p className="mt-2 text-sm text-gray-600">
                            This section is open to administrators. Your account is signed in as{' '}
                            {ROLE_LABELS[user.role]}.
                        </p>
                        <Link
                            href="/dashboard"
                            className="inline-block mt-6 px-4 py-2 rounded-lg bg-[#E63946] text-white text-sm font-medium"
                        >
                            Back to the dashboard
                        </Link>
                    </div>
                </main>
            )}
        </div>
    );
}
