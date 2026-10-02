'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { publicImageUrl } from '@/lib/appwrite';
import { BackendError, callOperation, listRows, Query, updateRow } from '@/lib/data';
import {
    TABLES,
    REPORT_IMAGES_BUCKET,
    REPORT_STATUSES,
    REPORT_HAZARDS,
    canonicalHazardName,
    capitalize,
    sanitizeSearch,
    toDate,
    type ReportStatus,
} from '@/lib/constants';
import Pagination from '@/components/Pagination';
import Modal from '@/components/Modal';
import { AlertTriangle, Loader2, Search, MapPin, Clock, User } from 'lucide-react';
import toast from 'react-hot-toast';

const PAGE_SIZE = 20;

/**
 * Refusals whose message the server wrote for a person to read: the caller
 * is not allowed, the report is not in a state the operation accepts, or it
 * is gone. Anything else gets the generic message, because an Appwrite
 * internal error names internals.
 */
const SERVER_MESSAGE_STATUSES = new Set([400, 401, 403, 404, 409]);

/** A refusal that means the card is out of date, so the list must reload. */
function isStaleState(error: unknown): boolean {
    return error instanceof BackendError && (error.status === 400 || error.status === 404 || error.status === 409);
}

type StatusFilter = 'all' | ReportStatus;

/** Report `type` of a peer verification request (as opposed to a direct hazard report). */
const VERIFICATION_REQUEST_TYPE = 'verification_request';

/** Stored hazardType values matched by the hazard filter: the canonical name plus legacy spellings. */
function hazardFilterValues(name: string): string[] {
    const hazard = REPORT_HAZARDS.find((h) => h.name === name);
    return hazard ? Array.from(new Set([hazard.name, ...hazard.aliases])) : [name];
}

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
    isVerificationRequest: boolean;
}

interface ReportRow {
    id: string;
    hazardType: string | null;
    type: string | null;
    severity: string | null;
    description: string | null;
    locationDetails: string | null;
    location: string | null;
    address: string | null;
    ward: string | null;
    lga: string | null;
    state: string | null;
    status: string | null;
    reporterName: string | null;
    submittedAt: string | null;
    createdAt: string | null;
    imageUrls: string[] | null;
    isAlert: boolean | null;
    escalated: boolean | null;
    verificationCount: number | null;
}

const REPORT_COLUMNS = [
    'hazardType', 'type', 'severity', 'description', 'locationDetails', 'location',
    'address', 'ward', 'lga', 'state', 'status', 'reporterName', 'submittedAt',
    'createdAt', 'imageUrls', 'isAlert', 'escalated', 'verificationCount',
];

function str(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function toReport(row: ReportRow): Report {
    const imageUrls = (Array.isArray(row.imageUrls) ? row.imageUrls : [])
        .map((v) => (typeof v === 'string' ? publicImageUrl(REPORT_IMAGES_BUCKET, v) : null))
        .filter((u): u is string => !!u);
    const isVerificationRequest = row.type === VERIFICATION_REQUEST_TYPE;
    // Older rows kept the hazard in `type`; a verification request's type is not a hazard.
    const rawHazard = str(row.hazardType) ?? (isVerificationRequest ? undefined : str(row.type));
    return {
        id: row.id,
        hazardType: rawHazard ? canonicalHazardName(rawHazard) : 'Unknown hazard',
        severity: str(row.severity),
        description: str(row.description),
        location: str(row.locationDetails) ?? str(row.location) ?? str(row.address),
        ward: str(row.ward),
        lga: str(row.lga),
        state: str(row.state),
        status: str(row.status) ?? 'pending',
        reporterName: str(row.reporterName),
        submittedAt: toDate(row.submittedAt ?? row.createdAt),
        imageUrls,
        isAlert: row.isAlert === true,
        escalated: row.escalated === true,
        verificationCount: typeof row.verificationCount === 'number' ? row.verificationCount : 0,
        isVerificationRequest,
    };
}

/** Timestamp columns stamped when an admin moves a report into a status. */
const STATUS_TIMESTAMP: Partial<Record<ReportStatus, string>> = {
    approved: 'approvedAt',
    rejected: 'rejectedAt',
    verified: 'verifiedAt',
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

/** Status changes that need confirmation before they are applied. */
type ConfirmAction = { report: Report; status: 'rejected' | 'pending' };

const REJECTION_REASON_MAX = 500;

export default function ReportsPage() {
    const { user, loading: authLoading } = useAuth();
    const [reports, setReports] = useState<Report[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    // The dashboard's stat cards link here with ?status=pending etc. An
    // unknown or absent value falls back to 'all' rather than filtering on
    // something the database has never heard of.
    const searchParams = useSearchParams();
    const requestedStatus = searchParams.get('status');
    const initialStatus: StatusFilter =
        requestedStatus && (REPORT_STATUSES as readonly string[]).includes(requestedStatus)
            ? (requestedStatus as ReportStatus)
            : 'all';
    const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);
    const [hazardFilter, setHazardFilter] = useState('all');
    const [reloadKey, setReloadKey] = useState(0);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
    const [rejectionReason, setRejectionReason] = useState('');

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
            const queries = [
                Query.orderDesc('submittedAt'),
                Query.orderDesc('$id'),
                Query.limit(PAGE_SIZE),
                Query.offset(page * PAGE_SIZE),
                Query.select([...REPORT_COLUMNS]),
            ];
            if (statusFilter !== 'all') queries.push(Query.equal('status', statusFilter));
            if (hazardFilter !== 'all') {
                queries.push(Query.equal('hazardType', hazardFilterValues(hazardFilter)));
            }
            if (searchQuery) {
                queries.push(
                    Query.or([
                        Query.contains('hazardType', searchQuery),
                        Query.contains('description', searchQuery),
                        Query.contains('locationDetails', searchQuery),
                        Query.contains('ward', searchQuery),
                        Query.contains('lga', searchQuery),
                        Query.contains('state', searchQuery),
                        Query.contains('reporterName', searchQuery),
                    ]),
                );
            }
            let loaded: { rows: ReportRow[]; total: number };
            try {
                loaded = await listRows<ReportRow>(TABLES.REPORTS, queries);
            } catch (error) {
                if (cancelled) return;
                console.error('Error fetching reports:', error);
                toast.error('Failed to load reports.');
                setReports([]);
                setTotalCount(null);
                setLoading(false);
                return;
            }
            if (cancelled) return;
            if (loaded.rows.length === 0 && page > 0) {
                // Past the last page (rows changed elsewhere): step back.
                const lastPage = loaded.total ? Math.ceil(loaded.total / PAGE_SIZE) - 1 : page - 1;
                setPage(Math.max(0, Math.min(page - 1, lastPage)));
                return;
            }
            setReports(loaded.rows.map(toReport));
            setTotalCount(loaded.total);
            setLoading(false);
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [user, page, statusFilter, hazardFilter, searchQuery, reloadKey]);

    /** Reject and Reset to Pending ask for confirmation first; other actions apply directly. */
    function requestStatusChange(report: Report, newStatus: ReportStatus) {
        if (newStatus === 'rejected' || newStatus === 'pending') {
            setRejectionReason('');
            setConfirmAction({ report, status: newStatus });
        } else {
            void updateReportStatus(report, newStatus);
        }
    }

    function runConfirmedAction() {
        if (!confirmAction) return;
        const { report, status } = confirmAction;
        setConfirmAction(null);
        void updateReportStatus(report, status, status === 'rejected' ? rejectionReason.trim() : undefined);
    }

    async function updateReportStatus(report: Report, newStatus: ReportStatus, reason?: string) {
        if (updatingId || !user) return;
        setUpdatingId(report.id);
        try {
            if (newStatus === 'pending') {
                // Reopening must also clear peer votes and reschedule escalation,
                // otherwise the report can never be verified again.
                await callOperation('reopen_report', { p_report_id: report.id });
            } else {
                const update: Record<string, unknown> = { status: newStatus, updatedBy: user.id };
                const stampColumn = STATUS_TIMESTAMP[newStatus];
                if (stampColumn) update[stampColumn] = new Date().toISOString();
                if (newStatus === 'rejected') update.rejectionReason = reason || null;

                // Optimistic lock: only apply the decision to the status this
                // card showed. If someone else decided (or reopened) the report
                // meanwhile, the `write` Function matches no row and answers
                // 409 rather than overwriting their decision.
                try {
                    await updateRow(TABLES.REPORTS, report.id, update, {
                        expect: { status: report.status },
                    });
                } catch (error) {
                    if (error instanceof BackendError && error.status === 409) {
                        toast.error('This report changed since you loaded it — reloading');
                        setReloadKey((k) => k + 1);
                        return;
                    }
                    throw error;
                }
            }

            toast.success(`Report marked as ${newStatus}`);
            if (newStatus === 'pending' || (statusFilter !== 'all' && statusFilter !== newStatus)) {
                // Reopen resets several columns, or the row no longer matches the
                // active filter: reload the current page.
                if (reports.length === 1 && page > 0) setPage((p) => p - 1);
                else setReloadKey((k) => k + 1);
            } else {
                setReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, status: newStatus } : r)));
            }
        } catch (error) {
            console.error('Error updating report:', error);
            const message = error instanceof Error ? error.message : '';
            // A Function refusal carries a reason written for people (e.g.
            // "That report is already pending"); a transport or server fault
            // does not, so it gets the generic message.
            const readable = !(error instanceof BackendError) || SERVER_MESSAGE_STATUSES.has(error.status);
            toast.error(readable && message ? message : 'Failed to update report');
            // The server refused because the row is not what this card shows.
            if (isStaleState(error)) setReloadKey((k) => k + 1);
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
                            aria-label="Search reports"
                            className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                        />
                    </div>

                    <select
                        value={statusFilter}
                        onChange={(e) => {
                            setStatusFilter(e.target.value as StatusFilter);
                            setPage(0);
                        }}
                        aria-label="Filter reports by status"
                        className="px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                    >
                        <option value="all">All Status</option>
                        {REPORT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                                {capitalize(s)}
                            </option>
                        ))}
                    </select>

                    <select
                        value={hazardFilter}
                        onChange={(e) => {
                            setHazardFilter(e.target.value);
                            setPage(0);
                        }}
                        aria-label="Filter reports by hazard"
                        className="px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                    >
                        <option value="all">All Hazards</option>
                        {REPORT_HAZARDS.map((h) => (
                            <option key={h.name} value={h.name}>
                                {h.name}
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
                                                    {report.isVerificationRequest && (
                                                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-sky-100 text-sky-700">
                                                            Verification request
                                                        </span>
                                                    )}
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
                                                                {/* eslint-disable-next-line @next/next/no-img-element -- remote Appwrite Storage URLs */}
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
                                                    onClick={() => requestStatusChange(report, s)}
                                                    disabled={updatingId !== null}
                                                    className={`px-4 py-2 text-white rounded-lg transition-colors text-sm font-medium disabled:opacity-50 ${STATUS_ACTIONS[s].className}`}
                                                >
                                                    {updatingId === report.id ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" aria-label="Updating" />
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

                        {(reports.length > 0 || page > 0) && (
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

            {/* Reject / Reset to Pending confirmation */}
            {confirmAction && (
                <Modal
                    title={confirmAction.status === 'rejected' ? 'Reject Report' : 'Reset to Pending'}
                    titleClassName={`text-xl font-bold mb-4 ${
                        confirmAction.status === 'rejected' ? 'text-red-600' : 'text-gray-900'
                    }`}
                    onClose={() => setConfirmAction(null)}
                >
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            runConfirmedAction();
                        }}
                    >
                        {confirmAction.status === 'rejected' ? (
                            <>
                                <p className="text-gray-600 mb-4 leading-relaxed">
                                    Reject this {confirmAction.report.hazardType} report? The reporter will see it as
                                    rejected.
                                </p>
                                <label
                                    htmlFor="rejection-reason"
                                    className="block text-sm font-medium text-gray-700 mb-1"
                                >
                                    Reason <span className="text-gray-400 font-normal">(optional)</span>
                                </label>
                                <textarea
                                    id="rejection-reason"
                                    rows={4}
                                    maxLength={REJECTION_REASON_MAX}
                                    value={rejectionReason}
                                    onChange={(e) => setRejectionReason(e.target.value)}
                                    placeholder="e.g. Duplicate of an existing report, insufficient detail..."
                                    className="w-full mb-6 px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                                />
                            </>
                        ) : (
                            <p className="text-gray-600 mb-6 leading-relaxed">
                                Move this {confirmAction.report.hazardType} report back to pending? All peer
                                verification votes
                                {confirmAction.report.verificationCount > 0
                                    ? ` (${confirmAction.report.verificationCount})`
                                    : ''}{' '}
                                and the current decision will be cleared, and escalation will be rescheduled.
                            </p>
                        )}
                        <div className="flex gap-3 justify-end">
                            <button
                                type="button"
                                onClick={() => setConfirmAction(null)}
                                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className={`px-4 py-2 rounded-lg font-medium text-white transition-colors ${
                                    STATUS_ACTIONS[confirmAction.status].className
                                }`}
                            >
                                {STATUS_ACTIONS[confirmAction.status].label}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
