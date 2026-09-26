'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getSupabase } from '@/lib/supabase';
import { TABLES, ALERT_SEVERITIES, capitalize, toDate, type AlertSeverity } from '@/lib/constants';
import Pagination from '@/components/Pagination';
import Modal from '@/components/Modal';
import { Megaphone, Loader2, Plus, MapPin, Clock, BellOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { LGAS } from '@/lib/lgas';

const PAGE_SIZE = 20;

type ActiveFilter = 'all' | 'active' | 'inactive';

interface Alert {
    id: string;
    title: string;
    message: string;
    severity: string;
    targetLga: string;
    isActive: boolean;
    createdAt: Date | null;
}

interface AlertRow {
    id: string;
    title: string | null;
    message: string | null;
    severity: string | null;
    target_lga: string | null;
    is_active: boolean | null;
    created_at: string | null;
}

interface AlertForm {
    title: string;
    message: string;
    severity: AlertSeverity;
    targetLga: string;
}

// Same suggestions as the mobile admin alerts screen; any LGA name can be typed.
const LGA_SUGGESTIONS = ['All', ...LGAS];

const EMPTY_FORM: AlertForm = { title: '', message: '', severity: 'info', targetLga: 'All' };

const SEVERITY_STYLES: Record<string, string> = {
    info: 'bg-blue-100 text-blue-700',
    warning: 'bg-yellow-100 text-yellow-700',
    critical: 'bg-red-100 text-red-700',
};

function toAlert(row: AlertRow): Alert {
    return {
        id: row.id,
        title: row.title?.trim() || 'Untitled alert',
        message: row.message ?? '',
        severity: row.severity ?? 'info',
        targetLga: row.target_lga?.trim() || 'All',
        isActive: row.is_active === true,
        createdAt: toDate(row.created_at),
    };
}

export default function AlertsPage() {
    const { user, loading: authLoading } = useAuth();
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [filter, setFilter] = useState<ActiveFilter>('active');
    const [reloadKey, setReloadKey] = useState(0);

    const [form, setForm] = useState<AlertForm | null>(null);
    const [saving, setSaving] = useState(false);
    const [deactivateTarget, setDeactivateTarget] = useState<Alert | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    useEffect(() => {
        // Signed-out users are redirected by app/dashboard/layout.tsx.
        if (!user) return;

        let cancelled = false;
        async function load() {
            setLoading(true);
            let query = getSupabase()
                .from(TABLES.ALERTS)
                .select('id, title, message, severity, target_lga, is_active, created_at', { count: 'exact' })
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })
                .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
            if (filter !== 'all') query = query.eq('is_active', filter === 'active');
            const { data, count, error } = await query;
            if (cancelled) return;
            if (error) {
                console.error('Error fetching alerts:', error);
                toast.error('Failed to load alerts.');
                setAlerts([]);
                setTotalCount(null);
            } else {
                const rows = (data ?? []) as AlertRow[];
                if (rows.length === 0 && page > 0) {
                    // Past the last page (rows changed elsewhere): step back.
                    const lastPage = count ? Math.ceil(count / PAGE_SIZE) - 1 : page - 1;
                    setPage(Math.max(0, Math.min(page - 1, lastPage)));
                    return;
                }
                setAlerts(rows.map(toAlert));
                setTotalCount(count ?? null);
            }
            setLoading(false);
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [user, page, filter, reloadKey]);

    function reloadFirstPage() {
        if (page === 0) setReloadKey((k) => k + 1);
        else setPage(0);
    }

    async function createAlert(e: React.FormEvent) {
        e.preventDefault();
        if (!form || saving || !user) return;
        const title = form.title.trim();
        const message = form.message.trim();
        if (!title || !message) {
            toast.error('Title and message are required.');
            return;
        }

        setSaving(true);
        try {
            // Inserting an active alert queues a push broadcast (processed by the backend).
            const { data, error } = await getSupabase()
                .from(TABLES.ALERTS)
                .insert({
                    title,
                    message,
                    severity: form.severity,
                    target_lga: form.targetLga.trim() || 'All',
                    is_active: true,
                    created_by: user.id,
                })
                .select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error('Not permitted');
            toast.success('Alert published');
            setForm(null);
            if (filter === 'inactive') {
                setFilter('active');
                setPage(0);
            } else {
                reloadFirstPage();
            }
        } catch (error) {
            console.error('Error creating alert:', error);
            toast.error('Failed to publish alert. Please try again.');
        } finally {
            setSaving(false);
        }
    }

    async function confirmDeactivate() {
        if (!deactivateTarget || updatingId) return;
        const target = deactivateTarget;
        setDeactivateTarget(null);
        setUpdatingId(target.id);
        try {
            const { data, error } = await getSupabase()
                .from(TABLES.ALERTS)
                .update({ is_active: false })
                .eq('id', target.id)
                .select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error('Alert not found or not permitted');
            toast.success('Alert deactivated');
            if (filter === 'active') {
                if (alerts.length === 1 && page > 0) setPage((p) => p - 1);
                else setReloadKey((k) => k + 1);
            } else {
                setAlerts((prev) => prev.map((a) => (a.id === target.id ? { ...a, isActive: false } : a)));
            }
        } catch (error) {
            console.error('Error deactivating alert:', error);
            toast.error('Failed to deactivate alert. Please try again.');
        } finally {
            setUpdatingId(null);
        }
    }

    function updateForm<K extends keyof AlertForm>(key: K, value: AlertForm[K]) {
        setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
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
                            <div className="w-10 h-10 bg-gradient-to-br from-rose-500 to-[#9D0208] rounded-lg flex items-center justify-center">
                                <Megaphone className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-gray-900">Community Alerts</h1>
                                <p className="text-xs text-gray-600">Broadcast alerts to app users</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8">
                <div className="mb-6 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
                    <select
                        value={filter}
                        onChange={(e) => {
                            setFilter(e.target.value as ActiveFilter);
                            setPage(0);
                        }}
                        aria-label="Filter alerts by status"
                        className="px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                    >
                        <option value="active">Active alerts</option>
                        <option value="inactive">Inactive alerts</option>
                        <option value="all">All alerts</option>
                    </select>
                    <button
                        onClick={() => setForm(EMPTY_FORM)}
                        className="flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-medium text-white bg-gradient-to-r from-[#E63946] to-[#9D0208] hover:opacity-90 transition-opacity"
                    >
                        <Plus className="w-5 h-5" />
                        New Alert
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-rose-600" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        {alerts.length === 0 ? (
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
                                <Megaphone className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                                <p className="text-gray-500">No alerts found</p>
                            </div>
                        ) : (
                            alerts.map((alert) => (
                                <div
                                    key={alert.id}
                                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow"
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-3 mb-2">
                                                <h3 className="text-lg font-semibold text-gray-900">{alert.title}</h3>
                                                <span
                                                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                                                        SEVERITY_STYLES[alert.severity] ?? 'bg-gray-100 text-gray-700'
                                                    }`}
                                                >
                                                    {capitalize(alert.severity)}
                                                </span>
                                                <span
                                                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                                                        alert.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                                    }`}
                                                >
                                                    {alert.isActive ? 'Active' : 'Inactive'}
                                                </span>
                                            </div>
                                            <p className="text-gray-700 mb-3 whitespace-pre-line">
                                                {alert.message || 'No message.'}
                                            </p>
                                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
                                                <div className="flex items-center gap-2">
                                                    <MapPin className="w-4 h-4 flex-shrink-0" />
                                                    <span>{alert.targetLga === 'All' ? 'All LGAs' : alert.targetLga}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Clock className="w-4 h-4 flex-shrink-0" />
                                                    <span>{alert.createdAt ? alert.createdAt.toLocaleString() : 'Unknown date'}</span>
                                                </div>
                                            </div>
                                        </div>
                                        {alert.isActive && (
                                            <button
                                                onClick={() => setDeactivateTarget(alert)}
                                                disabled={updatingId !== null}
                                                aria-label={`Deactivate alert ${alert.title}`}
                                                className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium text-sm transition-colors disabled:opacity-50"
                                            >
                                                {updatingId === alert.id ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <BellOff className="w-4 h-4" />
                                                )}
                                                Deactivate
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}

                        {(alerts.length > 0 || page > 0) && (
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                                <Pagination
                                    page={page}
                                    pageSize={PAGE_SIZE}
                                    total={totalCount}
                                    itemCount={alerts.length}
                                    noun="alerts"
                                    disabled={loading}
                                    onPageChange={setPage}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {form && (
                <Modal
                    title="New Alert"
                    titleClassName="text-xl font-bold mb-2 text-gray-900"
                    onClose={() => setForm(null)}
                    closeDisabled={saving}
                    className="max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
                >
                    <form onSubmit={(e) => void createAlert(e)}>
                        <p className="text-sm text-gray-600 mb-4">
                            Publishing sends a push notification to app users in the target LGA (or everyone).
                        </p>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="alert-title" className="block text-sm font-medium text-gray-700 mb-1">
                                    Title
                                </label>
                                <input
                                    id="alert-title"
                                    type="text"
                                    required
                                    maxLength={120}
                                    value={form.title}
                                    onChange={(e) => updateForm('title', e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none text-gray-900"
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="alert-severity" className="block text-sm font-medium text-gray-700 mb-1">
                                        Severity
                                    </label>
                                    <select
                                        id="alert-severity"
                                        value={form.severity}
                                        onChange={(e) => updateForm('severity', e.target.value as AlertSeverity)}
                                        className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none text-gray-900"
                                    >
                                        {ALERT_SEVERITIES.map((s) => (
                                            <option key={s} value={s}>
                                                {capitalize(s)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="alert-lga" className="block text-sm font-medium text-gray-700 mb-1">
                                        Target LGA
                                    </label>
                                    <input
                                        id="alert-lga"
                                        type="text"
                                        list="alert-lga-options"
                                        value={form.targetLga}
                                        onChange={(e) => updateForm('targetLga', e.target.value)}
                                        placeholder="All"
                                        className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none text-gray-900"
                                    />
                                    <datalist id="alert-lga-options">
                                        {LGA_SUGGESTIONS.map((l) => (
                                            <option key={l} value={l} />
                                        ))}
                                    </datalist>
                                    <p className="text-xs text-gray-500 mt-1">Use &ldquo;All&rdquo; to alert every LGA.</p>
                                </div>
                            </div>
                            <div>
                                <label htmlFor="alert-message" className="block text-sm font-medium text-gray-700 mb-1">
                                    Message
                                </label>
                                <textarea
                                    id="alert-message"
                                    required
                                    rows={6}
                                    maxLength={1000}
                                    value={form.message}
                                    onChange={(e) => updateForm('message', e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none text-gray-900"
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end mt-6">
                            <button
                                type="button"
                                onClick={() => setForm(null)}
                                disabled={saving}
                                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="px-4 py-2 rounded-lg font-medium transition-colors bg-gradient-to-r from-[#e85d04] to-[#dc2f02] text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                Publish Alert
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Deactivate Confirmation */}
            {deactivateTarget && (
                <Modal title="Deactivate Alert" onClose={() => setDeactivateTarget(null)}>
                    <p className="text-gray-600 mb-6 leading-relaxed">
                        Deactivate &ldquo;{deactivateTarget.title}&rdquo;? It will no longer be shown as an active
                        alert in the app.
                    </p>
                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={() => setDeactivateTarget(null)}
                            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => void confirmDeactivate()}
                            className="px-4 py-2 rounded-lg font-medium transition-colors bg-red-600 text-white hover:bg-red-700"
                        >
                            Deactivate
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}
