'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import {
    collection,
    doc,
    getCountFromServer,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    startAfter,
    updateDoc,
    where,
    type DocumentData,
    type QueryConstraint,
    type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db, COLLECTIONS, REPORT_STATUSES, toDate, type ReportStatus } from '@/lib/firebase';
import { AlertTriangle, Loader2, Search, ArrowLeft, MapPin, Clock } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

const PAGE_SIZE = 25;

type StatusFilter = 'all' | ReportStatus;

interface Report {
    id: string;
    hazardType: string;
    severity?: string;
    description?: string;
    location?: string;
    ward?: string;
    lga?: string;
    state?: string;
    status: string;
    userId?: string;
    submittedAt: Date | null;
    imageUrls: string[];
    isAlert: boolean;
    verificationCount: number;
}

function str(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function toReport(snap: QueryDocumentSnapshot<DocumentData>): Report {
    const d = snap.data();
    const imageUrls = Array.isArray(d.imageUrls)
        ? d.imageUrls.filter((u: unknown): u is string => typeof u === 'string' && u.startsWith('http'))
        : [];
    return {
        id: snap.id,
        hazardType: str(d.hazardType) ?? str(d.type) ?? 'Unknown hazard',
        severity: str(d.severity),
        description: str(d.description),
        location: str(d.locationDetails) ?? str(d.location) ?? str(d.address),
        ward: str(d.ward),
        lga: str(d.lga),
        state: str(d.state),
        status: str(d.status) ?? 'pending',
        userId: str(d.userId),
        submittedAt: toDate(d.submittedAt ?? d.createdAt),
        imageUrls,
        isAlert: d.isAlert === true,
        verificationCount: typeof d.verificationCount === 'number' ? d.verificationCount : 0,
    };
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

const getSeverityColor = (severity?: string) => {
    switch (severity?.toLowerCase()) {
        case 'critical':
            return 'bg-red-100 text-red-700';
        case 'high':
            return 'bg-orange-100 text-orange-700';
        case 'medium':
            return 'bg-yellow-100 text-yellow-700';
        case 'low':
            return 'bg-blue-100 text-blue-700';
        default:
            return 'bg-gray-100 text-gray-700';
    }
};

const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
        case 'approved':
            return 'bg-green-100 text-green-700';
        case 'verified':
            return 'bg-blue-100 text-blue-700';
        case 'pending':
            return 'bg-yellow-100 text-yellow-700';
        case 'rejected':
            return 'bg-red-100 text-red-700';
        default:
            return 'bg-gray-100 text-gray-700';
    }
};

const STATUS_ACTIONS: Record<ReportStatus, { label: string; className: string }> = {
    approved: { label: 'Approve', className: 'bg-green-600 hover:bg-green-700' },
    verified: { label: 'Mark Verified', className: 'bg-blue-600 hover:bg-blue-700' },
    rejected: { label: 'Reject', className: 'bg-red-600 hover:bg-red-700' },
    pending: { label: 'Reset to Pending', className: 'bg-yellow-500 hover:bg-yellow-600' },
};

const ACTION_ORDER: ReportStatus[] = ['approved', 'verified', 'rejected', 'pending'];

export default function ReportsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [reports, setReports] = useState<Report[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    const fetchReports = useCallback(async (filter: StatusFilter, append: boolean) => {
        const reportsRef = collection(db, COLLECTIONS.REPORTS);
        const filters: QueryConstraint[] = filter === 'all' ? [] : [where('status', '==', filter)];
        const cursor = append ? lastDocRef.current : null;
        const q = query(
            reportsRef,
            ...filters,
            orderBy('submittedAt', 'desc'),
            ...(cursor ? [startAfter(cursor)] : []),
            limit(PAGE_SIZE),
        );

        if (append) setLoadingMore(true);
        else setLoading(true);

        try {
            const [snapshot, count] = await Promise.all([
                getDocs(q),
                append
                    ? Promise.resolve(null)
                    : getCountFromServer(query(reportsRef, ...filters))
                        .then((c) => c.data().count)
                        .catch(() => null),
            ]);
            const page = snapshot.docs.map(toReport);
            lastDocRef.current = snapshot.docs[snapshot.docs.length - 1] ?? lastDocRef.current;
            setHasMore(snapshot.docs.length === PAGE_SIZE);
            setReports((prev) => (append ? [...prev, ...page] : page));
            if (!append) setTotalCount(count);
        } catch (error) {
            console.error('Error fetching reports:', error);
            toast.error('Failed to load reports.');
            if (!append) setReports([]);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, []);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
        } else if (user) {
            lastDocRef.current = null;
            void fetchReports(statusFilter, false);
        }
    }, [user, authLoading, router, statusFilter, fetchReports]);

    async function updateReportStatus(report: Report, newStatus: ReportStatus) {
        if (updatingId) return;
        setUpdatingId(report.id);
        try {
            await updateDoc(doc(db, COLLECTIONS.REPORTS, report.id), {
                status: newStatus,
                updatedAt: serverTimestamp(),
                updatedBy: 'admin',
            });
            toast.success(`Report marked as ${newStatus}`);
            if (statusFilter !== 'all' && statusFilter !== newStatus) {
                // No longer matches the active filter.
                setReports((prev) => prev.filter((r) => r.id !== report.id));
                setTotalCount((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
            } else {
                setReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, status: newStatus } : r)));
            }
        } catch (error) {
            console.error('Error updating report:', error);
            toast.error('Failed to update report');
        } finally {
            setUpdatingId(null);
        }
    }

    const filteredReports = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return reports;
        return reports.filter((r) =>
            [r.hazardType, r.description, r.location, r.ward, r.lga, r.state].some((v) =>
                v?.toLowerCase().includes(q)
            )
        );
    }, [reports, searchQuery]);

    if (authLoading || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/dashboard"
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5 text-gray-600" />
                        </Link>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-orange-600 to-red-600 rounded-lg flex items-center justify-center">
                                <AlertTriangle className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-gray-900">Report Management</h1>
                                <p className="text-xs text-gray-600">View and verify disaster reports</p>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Filters */}
                <div className="mb-6 flex flex-col sm:flex-row gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search loaded reports by hazard, description or location..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                        />
                    </div>

                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                        className="px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                    >
                        <option value="all">All Status</option>
                        {REPORT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                                {capitalize(s)}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Reports */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        {filteredReports.length === 0 ? (
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
                                <AlertTriangle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                                <p className="text-gray-500">No reports found</p>
                            </div>
                        ) : (
                            filteredReports.map((report) => {
                                const place = [report.ward, report.lga, report.state].filter(Boolean).join(', ');
                                return (
                                    <div
                                        key={report.id}
                                        className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow"
                                    >
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex flex-wrap items-center gap-3 mb-2">
                                                    <h3 className="text-lg font-semibold text-gray-900">
                                                        {capitalize(report.hazardType)}
                                                    </h3>
                                                    {report.severity && (
                                                        <span
                                                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getSeverityColor(
                                                                report.severity
                                                            )}`}
                                                        >
                                                            {capitalize(report.severity)}
                                                        </span>
                                                    )}
                                                    <span
                                                        className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(
                                                            report.status
                                                        )}`}
                                                    >
                                                        {capitalize(report.status)}
                                                    </span>
                                                    {report.isAlert && (
                                                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-600 text-white">
                                                            Alert
                                                        </span>
                                                    )}
                                                    {report.verificationCount > 0 && (
                                                        <span className="text-xs text-gray-500">
                                                            {report.verificationCount} verification{report.verificationCount === 1 ? '' : 's'}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-gray-700 mb-3 whitespace-pre-line">
                                                    {report.description || 'No description provided.'}
                                                </p>
                                                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
                                                    {(report.location || place) && (
                                                        <div className="flex items-center gap-2">
                                                            <MapPin className="w-4 h-4 flex-shrink-0" />
                                                            <span>
                                                                {[report.location, place].filter(Boolean).join(' — ')}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className="flex items-center gap-2">
                                                        <Clock className="w-4 h-4 flex-shrink-0" />
                                                        <span>
                                                            {report.submittedAt ? report.submittedAt.toLocaleString() : 'Unknown date'}
                                                        </span>
                                                    </div>
                                                </div>
                                                {report.imageUrls.length > 0 && (
                                                    <div className="flex flex-wrap gap-2 mt-4">
                                                        {report.imageUrls.map((url, i) => (
                                                            <a
                                                                key={url}
                                                                href={url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="block w-20 h-20 rounded-lg overflow-hidden border border-gray-200 hover:opacity-90 transition-opacity"
                                                            >
                                                                {/* eslint-disable-next-line @next/next/no-img-element -- remote Firebase Storage URLs */}
                                                                <img
                                                                    src={url}
                                                                    alt={`${report.hazardType} report image ${i + 1}`}
                                                                    loading="lazy"
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-100">
                                            {ACTION_ORDER.filter((s) => s !== report.status).map((s) => (
                                                <button
                                                    key={s}
                                                    onClick={() => void updateReportStatus(report, s)}
                                                    disabled={updatingId !== null}
                                                    className={`px-4 py-2 text-white rounded-lg transition-colors text-sm font-medium disabled:opacity-50 ${STATUS_ACTIONS[s].className}`}
                                                >
                                                    {updatingId === report.id ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        STATUS_ACTIONS[s].label
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })
                        )}

                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <p className="text-sm text-gray-600">
                                {searchQuery.trim()
                                    ? `${filteredReports.length} match${filteredReports.length === 1 ? '' : 'es'} among ${reports.length} loaded reports`
                                    : `Showing ${reports.length} loaded report${reports.length === 1 ? '' : 's'}`}
                                {totalCount !== null &&
                                    ` (${totalCount.toLocaleString()} ${statusFilter === 'all' ? 'total' : statusFilter})`}
                            </p>
                            {hasMore && (
                                <button
                                    onClick={() => void fetchReports(statusFilter, true)}
                                    disabled={loadingMore}
                                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                                >
                                    {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Load more
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
