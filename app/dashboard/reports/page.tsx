'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getSupabase, publicImageUrl } from '@/lib/supabase';
import {
    TABLES,
    REPORT_IMAGES_BUCKET,
    REPORT_STATUSES,
    capitalize,
    sanitizeSearch,
    toDate,
    type ReportStatus,
} from '@/lib/constants';
import Pagination from '@/components/Pagination';
import { AlertTriangle, Loader2, Search, MapPin, Clock, User } from 'lucide-react';
import toast from 'react-hot-toast';

const PAGE_SIZE = 20;

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
    reporterName?: string;
    submittedAt: Date | null;
    imageUrls: string[];
    isAlert: boolean;
    escalated: boolean;
    verificationCount: number;
}

interface ReportRow {
    id: string;
    hazard_type: string | null;
    type: string | null;
    severity: string | null;
    description: string | null;
    location_details: string | null;
    location: string | null;
    address: string | null;
    ward: string | null;
    lga: string | null;
    state: string | null;
    status: string | null;
    reporter_name: string | null;
    submitted_at: string | null;
    created_at: string | null;
    image_urls: string[] | null;
    is_alert: boolean | null;
    escalated: boolean | null;
    verification_count: number | null;
}

const REPORT_COLUMNS =
    'id, hazard_type, type, severity, description, location_details, location, address, ward, lga, state, status, reporter_name, submitted_at, created_at, image_urls, is_alert, escalated, verification_count';

function str(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function toReport(row: ReportRow): Report {
    const imageUrls = (Array.isArray(row.image_urls) ? row.image_urls : [])
        .map((v) => (typeof v === 'string' ? publicImageUrl(REPORT_IMAGES_BUCKET, v) : null))
        .filter((u): u is string => !!u);
    return {
        id: row.id,
        hazardType: str(row.hazard_type) ?? str(row.type) ?? 'Unknown hazard',
        severity: str(row.severity),
        description: str(row.description),
        location: str(row.location_details) ?? str(row.location) ?? str(row.address),
        ward: str(row.ward),
        lga: str(row.lga),
        state: str(row.state),
        status: str(row.status) ?? 'pending',
        reporterName: str(row.reporter_name),
        submittedAt: toDate(row.submitted_at ?? row.created_at),
        imageUrls,
        isAlert: row.is_alert === true,
        escalated: row.escalated === true,
        verificationCount: typeof row.verification_count === 'number' ? row.verification_count : 0,
    };
}

/** Timestamp columns stamped when an admin moves a report into a status. */
const STATUS_TIMESTAMP: Partial<Record<ReportStatus, string>> = {
    approved: 'approved_at',
    rejected: 'rejected_at',
    verified: 'verified_at',
};

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
    const [reports, setReports] = useState<Report[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [reloadKey, setReloadKey] = useState(0);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    // Debounce the search box; a new search starts again at the first page.
    useEffect(() => {
        const next = sanitizeSearch(searchInput);
        if (next === searchQuery) return;
        const handle = setTimeout(() => {
            setSearchQuery(next);
            setPage(0);
        }, 350);
        return () => clearTimeout(handle);
    }, [searchInput, searchQuery]);

    useEffect(() => {
        // Signed-out users are redirected by app/dashboard/layout.tsx.
        if (!user) return;

        let cancelled = false;
        async function load() {
            setLoading(true);
            let query = getSupabase()
                .from(TABLES.REPORTS)
                .select(REPORT_COLUMNS, { count: 'exact' })
                .order('submitted_at', { ascending: false })
                .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
            if (statusFilter !== 'all') query = query.eq('status', statusFilter);
            if (searchQuery) {
                const p = `*${searchQuery}*`;
                query = query.or(
                    `hazard_type.ilike.${p},description.ilike.${p},location_details.ilike.${p},ward.ilike.${p},lga.ilike.${p},state.ilike.${p},reporter_name.ilike.${p}`,
                );
            }
            const { data, count, error } = await query;
            if (cancelled) return;
            if (error) {
                console.error('Error fetching reports:', error);
                toast.error('Failed to load reports.');
                setReports([]);
                setTotalCount(null);
            } else {
                setReports(((data ?? []) as ReportRow[]).map(toReport));
                setTotalCount(count ?? null);
            }
            setLoading(false);
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [user, page, statusFilter, searchQuery, reloadKey]);

    async function updateReportStatus(report: Report, newStatus: ReportStatus) {
        if (updatingId || !user) return;
        setUpdatingId(report.id);
        try {
            const update: Record<string, unknown> = { status: newStatus, updated_by: user.id };
            const stampColumn = STATUS_TIMESTAMP[newStatus];
            if (stampColumn) update[stampColumn] = new Date().toISOString();
            if (newStatus === 'pending') {
                // Back to the start of the workflow: clear the previous decision.
                Object.assign(update, { verified_at: null, approved_at: null, rejected_at: null, rejection_reason: null });
            }

            const { data, error } = await getSupabase()
                .from(TABLES.REPORTS)
                .update(update)
                .eq('id', report.id)
                .select('id');
            if (error) throw error;
            // RLS filters rows silently: no row back means the update was not allowed.
            if (!data || data.length === 0) throw new Error('Report not found or not permitted');

            toast.success(`Report marked as ${newStatus}`);
            if (statusFilter !== 'all' && statusFilter !== newStatus) {
                // No longer matches the active filter: reload the current page.
                if (reports.length === 1 && page > 0) setPage((p) => p - 1);
                else setReloadKey((k) => k + 1);
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

    if (authLoading || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div>
            <div className="bg-white border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center gap-4">
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
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Filters */}
                <div className="mb-6 flex flex-col sm:flex-row gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by hazard, description, location or reporter..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                        />
                    </div>

                    <select
                        value={statusFilter}
                        onChange={(e) => {
                            setStatusFilter(e.target.value as StatusFilter);
                            setPage(0);
                        }}
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
                        {reports.length === 0 ? (
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
                                <AlertTriangle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                                <p className="text-gray-500">No reports found</p>
                            </div>
                        ) : (
                            reports.map((report) => {
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
                                                    {report.escalated && (
                                                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                                                            Escalated
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
                                                    {report.reporterName && (
                                                        <div className="flex items-center gap-2">
                                                            <User className="w-4 h-4 flex-shrink-0" />
                                                            <span>{report.reporterName}</span>
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
                                                                {/* eslint-disable-next-line @next/next/no-img-element -- remote Supabase Storage URLs */}
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

                        {reports.length > 0 && (
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                                <Pagination
                                    page={page}
                                    pageSize={PAGE_SIZE}
                                    total={totalCount}
                                    itemCount={reports.length}
                                    noun={statusFilter === 'all' ? 'reports' : `${statusFilter} reports`}
                                    disabled={loading}
                                    onPageChange={setPage}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
