'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { databases, DATABASE_ID, COLLECTIONS, Query } from '@/lib/appwrite';
import { AlertTriangle, Loader2, Search, ArrowLeft, MapPin, Clock } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

interface Report {
    $id: string;
    type: string;
    severity: string;
    description: string;
    location?: string;
    status: string;
    userId?: string;
    $createdAt: string;
}

export default function ReportsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [reports, setReports] = useState<Report[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
        } else if (user) {
            fetchReports();
        }
    }, [user, authLoading, router]);

    async function fetchReports() {
        try {
            setLoading(true);
            const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.REPORTS, [
                Query.orderDesc('$createdAt'),
                Query.limit(100),
            ]);
            setReports(response.documents as any);
        } catch (error) {
            console.error('Error fetching reports:', error);
        } finally {
            setLoading(false);
        }
    }

    async function updateReportStatus(reportId: string, newStatus: string) {
        try {
            await databases.updateDocument(DATABASE_ID, COLLECTIONS.REPORTS, reportId, {
                status: newStatus,
            });
            toast.success(`Report ${newStatus}`);
            fetchReports();
        } catch (error) {
            console.error('Error updating report:', error);
            toast.error('Failed to update report');
        }
    }

    const filteredReports = reports.filter((r) => {
        const matchesSearch =
            r.type?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            r.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            r.location?.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesStatus = statusFilter === 'all' || r.status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    const getSeverityColor = (severity: string) => {
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
        switch (status?.toLowerCase()) {
            case 'verified':
            case 'resolved':
                return 'bg-green-100 text-green-700';
            case 'pending':
            case 'submitted':
                return 'bg-yellow-100 text-yellow-700';
            case 'rejected':
                return 'bg-red-100 text-red-700';
            default:
                return 'bg-gray-100 text-gray-700';
        }
    };

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
                            placeholder="Search reports..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                        />
                    </div>

                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                    >
                        <option value="all">All Status</option>
                        <option value="pending">Pending</option>
                        <option value="verified">Verified</option>
                        <option value="resolved">Resolved</option>
                        <option value="rejected">Rejected</option>
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
                            filteredReports.map((report) => (
                                <div
                                    key={report.$id}
                                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow"
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <h3 className="text-lg font-semibold text-gray-900">{report.type}</h3>
                                                <span
                                                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getSeverityColor(
                                                        report.severity
                                                    )}`}
                                                >
                                                    {report.severity}
                                                </span>
                                                <span
                                                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(
                                                        report.status
                                                    )}`}
                                                >
                                                    {report.status}
                                                </span>
                                            </div>
                                            <p className="text-gray-700 mb-3">{report.description}</p>
                                            <div className="flex items-center gap-6 text-sm text-gray-500">
                                                {report.location && (
                                                    <div className="flex items-center gap-2">
                                                        <MapPin className="w-4 h-4" />
                                                        <span>{report.location}</span>
                                                    </div>
                                                )}
                                                <div className="flex items-center gap-2">
                                                    <Clock className="w-4 h-4" />
                                                    <span>{new Date(report.$createdAt).toLocaleString()}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    {report.status !== 'verified' && report.status !== 'resolved' && (
                                        <div className="flex gap-2 pt-4 border-t border-gray-100">
                                            <button
                                                onClick={() => updateReportStatus(report.$id, 'verified')}
                                                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                                            >
                                                Verify
                                            </button>
                                            <button
                                                onClick={() => updateReportStatus(report.$id, 'resolved')}
                                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                                            >
                                                Resolve
                                            </button>
                                            <button
                                                onClick={() => updateReportStatus(report.$id, 'rejected')}
                                                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                                            >
                                                Reject
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}

                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-6 py-4">
                            <p className="text-sm text-gray-600">
                                Showing {filteredReports.length} of {reports.length} reports
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
