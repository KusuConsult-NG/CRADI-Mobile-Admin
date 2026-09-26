'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { loginHref } from '@/lib/redirect';

const NAV_LINKS = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/dashboard/users', label: 'Users' },
    { href: '/dashboard/reports', label: 'Reports' },
    { href: '/dashboard/knowledge', label: 'Knowledge' },
    { href: '/dashboard/alerts', label: 'Alerts' },
    { href: '/dashboard/authorities', label: 'Authorities' },
    { href: '/dashboard/settings', label: 'Settings' },
];

function isActive(pathname: string, href: string): boolean {
    if (href === '/dashboard') return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
}

/** Shared shell for every /dashboard page: auth guard + header with navigation and logout. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const { user, loading, logout } = useAuth();
    const router = useRouter();
    const pathname = usePathname() ?? '/dashboard';

    useEffect(() => {
        // replace (not push) so Back does not return to a page that needs a session.
        if (!loading && !user) router.replace(loginHref(pathname));
    }, [user, loading, router, pathname]);

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
                        {NAV_LINKS.map(({ href, label }) => {
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
                            <p className="text-xs text-gray-500">Administrator</p>
                        </div>
                        <button
                            onClick={() => void logout()}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                            <LogOut className="w-4 h-4" />
                            Logout
                        </button>
                    </div>
                </div>
            </header>
            {children}
        </div>
    );
}
