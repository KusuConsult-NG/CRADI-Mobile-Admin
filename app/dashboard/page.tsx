'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { collection, getCountFromServer, query, where, type Query } from 'firebase/firestore';
import { db, COLLECTIONS } from '@/lib/firebase';
import {
    LayoutDashboard,
    Users,
    AlertTriangle,
    Phone,
    BookOpen,
    LogOut,
    Loader2,
    Clock,
    CheckCircle2,
} from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

interface Stats {
    totalUsers: number | null;
    totalReports: number | null;
    pendingReports: number | null;
    approvedReports: number | null;
    emergencyContacts: number | null;
    knowledgeArticles: number | null;
}

const EMPTY_STATS: Stats = {
    totalUsers: null,
    totalReports: null,
    pendingReports: null,
    approvedReports: null,
    emergencyContacts: null,
    knowledgeArticles: null,
};

async function countOf(q: Query): Promise<number> {
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
}

const STAT_KEYS: (keyof Stats)[] = [
    'totalUsers',
    'totalReports',
    'pendingReports',
    'approvedReports',
    'emergencyContacts',
    'knowledgeArticles',
];

/** Loads each count independently so one failure doesn't blank the others. */
async function loadStats(): Promise<{ stats: Stats; failures: number; total: number }> {
    const reports = collection(db, COLLECTIONS.REPORTS);
    const results = await Promise.allSettled([
        countOf(collection(db, COLLECTIONS.USERS)),
        countOf(reports),
        countOf(query(reports, where('status', '==', 'pending'))),
        countOf(query(reports, where('status', 'in', ['approved', 'verified']))),
        countOf(collection(db, COLLECTIONS.CONTACTS)),
        countOf(collection(db, COLLECTIONS.KNOWLEDGE_BASE)),
    ]);

    const stats: Stats = { ...EMPTY_STATS };
    let failures = 0;
    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            stats[STAT_KEYS[i]] = result.value;
        } else {
            failures += 1;
            console.error(`Failed to load ${STAT_KEYS[i]}:`, result.reason);
        }
    });
    return { stats, failures, total: STAT_KEYS.length };
}

function formatStat(value: number | null): string {
    return value === null ? '—' : value.toLocaleString();
}

export default function DashboardPage() {
    const { user, loading: authLoading, logout } = useAuth();
    const router = useRouter();
    const [stats, setStats] = useState<Stats>(EMPTY_STATS);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
            return;
        }
        if (!user) return;

        let cancelled = false;
        void loadStats().then(({ stats: next, failures, total }) => {
            if (cancelled) return;
            setStats(next);
            setLoading(false);
            if (failures > 0) {
                toast.error(`Could not load ${failures} of ${total} statistics.`);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [user, authLoading, router]);

    if (authLoading || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-[#E63946] to-[#9D0208] rounded-lg flex items-center justify-center">
                            <LayoutDashboard className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">EWER Admin</h1>
                            <p className="text-xs text-gray-600">Early Warning and Emergency Response</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <p className="text-sm font-medium text-gray-900">{user.displayName || user.email}</p>
                            <p className="text-xs text-gray-500">Administrator</p>
                        </div>
                        <button
                            onClick={logout}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                            <LogOut className="w-4 h-4" />
                            Logout
                        </button>
                    </div>
                </div>
            </header>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Welcome Section */}
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-gray-900 mb-2">
                        Welcome back, {user.displayName || 'Admin'}!
                    </h2>
                    <p className="text-gray-600">
                        Here&apos;s an overview of the CRADI system status and recent activity.
                    </p>
                </div>

                {/* Statistics Grid */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                            {/* Total Users */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="w-12 h-12 bg-red-50 rounded-lg flex items-center justify-center">
                                        <Users className="w-6 h-6 text-[#E63946]" />
                                    </div>
                                </div>
                                <h3 className="text-2xl font-bold text-gray-900 mb-1">{formatStat(stats.totalUsers)}</h3>
                                <p className="text-gray-600 text-sm">Total Users</p>
                            </div>

                            {/* Total Reports */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                                        <AlertTriangle className="w-6 h-6 text-orange-600" />
                                    </div>
                                </div>
                                <h3 className="text-2xl font-bold text-gray-900 mb-1">{formatStat(stats.totalReports)}</h3>
                                <p className="text-gray-600 text-sm">Total Reports</p>
                            </div>

                            {/* Pending Reports */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                                        <Clock className="w-6 h-6 text-yellow-600" />
                                    </div>
                                </div>
                                <h3 className="text-2xl font-bold text-gray-900 mb-1">{formatStat(stats.pendingReports)}</h3>
                                <p className="text-gray-600 text-sm">Pending Reports</p>
                            </div>

                            {/* Resolved Reports */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="w-12 h-12 bg-teal-50 rounded-lg flex items-center justify-center">
                                        <CheckCircle2 className="w-6 h-6 text-[#06D6A0]" />
                                    </div>
                                </div>
                                <h3 className="text-2xl font-bold text-gray-900 mb-1">{formatStat(stats.approvedReports)}</h3>
                                <p className="text-gray-600 text-sm">Approved / Verified Reports</p>
                            </div>

                            {/* Emergency Contacts */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="w-12 h-12 bg-red-50 rounded-lg flex items-center justify-center">
                                        <Phone className="w-6 h-6 text-[#9D0208]" />
                                    </div>
                                </div>
                                <h3 className="text-2xl font-bold text-gray-900 mb-1">
                                    {formatStat(stats.emergencyContacts)}
                                </h3>
                                <p className="text-gray-600 text-sm">Emergency Contacts</p>
                            </div>

                            {/* Knowledge Articles */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center">
                                        <BookOpen className="w-6 h-6 text-indigo-600" />
                                    </div>
                                </div>
                                <h3 className="text-2xl font-bold text-gray-900 mb-1">
                                    {formatStat(stats.knowledgeArticles)}
                                </h3>
                                <p className="text-gray-600 text-sm">Knowledge Articles</p>
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                <Link
                                    href="/dashboard/users"
                                    className="flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 hover:border-[#E63946] hover:bg-red-50 transition-all group"
                                >
                                    <Users className="w-5 h-5 text-gray-600 group-hover:text-[#E63946]" />
                                    <span className="font-medium text-gray-700 group-hover:text-[#E63946]">
                                        Manage Users
                                    </span>
                                </Link>

                                <Link
                                    href="/dashboard/reports"
                                    className="flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 hover:border-orange-500 hover:bg-orange-50 transition-all group"
                                >
                                    <AlertTriangle className="w-5 h-5 text-gray-600 group-hover:text-orange-600" />
                                    <span className="font-medium text-gray-700 group-hover:text-orange-700">
                                        View Reports
                                    </span>
                                </Link>


                                <Link
                                    href="/dashboard/knowledge"
                                    className="flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 hover:border-indigo-500 hover:bg-indigo-50 transition-all group"
                                >
                                    <BookOpen className="w-5 h-5 text-gray-600 group-hover:text-indigo-600" />
                                    <span className="font-medium text-gray-700 group-hover:text-indigo-700">
                                        Knowledge Base
                                    </span>
                                </Link>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
