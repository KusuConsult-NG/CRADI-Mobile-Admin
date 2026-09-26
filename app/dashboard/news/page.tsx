'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getSupabase } from '@/lib/supabase';
import { TABLES, errorMessage, toDate } from '@/lib/constants';
import Pagination from '@/components/Pagination';
import Modal from '@/components/Modal';
import { Newspaper, Loader2, Plus, Pencil, Trash2, Info, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';

const PAGE_SIZE = 25;
// Mirror the check constraints on public.news_links
// (CRADI-mobile/supabase/migrations/20260927040000_builtin_content.sql).
const TITLE_MAX = 300;
const URL_MAX = 2000;
const SOURCE_MAX = 120;
const URL_RE = /^https?:\/\/\S+$/i;
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;
/** Gap left between sort orders when a link is added at the end. */
const SORT_STEP = 10;

interface NewsLink {
    id: string;
    title: string;
    url: string;
    source: string;
    sortOrder: number;
    isActive: boolean;
    updatedAt: Date | null;
}

interface NewsLinkRow {
    id: string;
    title: string | null;
    url: string | null;
    source: string | null;
    sort_order: number | null;
    is_active: boolean | null;
    updated_at: string | null;
}

interface LinkForm {
    /** Set when editing an existing row. */
    id?: string;
    title: string;
    url: string;
    source: string;
    /** Text of the number field; empty on a new link means "add at the end". */
    sortOrder: string;
    isActive: boolean;
}

const EMPTY_FORM: LinkForm = { title: '', url: '', source: '', sortOrder: '', isActive: true };

const INPUT_CLASS =
    'w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none';

function toLink(row: NewsLinkRow): NewsLink {
    return {
        id: row.id,
        title: row.title?.trim() ?? '',
        url: row.url?.trim() ?? '',
        source: row.source?.trim() ?? '',
        sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
        isActive: row.is_active === true,
        updatedAt: toDate(row.updated_at),
    };
}

type Validated = { title: string; url: string; source: string; sortOrder: number | null; isActive: boolean };

/** Client-side checks matching the table's constraints; returns the values to store or an error message. */
function validate(form: LinkForm): { values: Validated } | { error: string } {
    const title = form.title.trim();
    const url = form.url.trim();
    const source = form.source.trim();
    const sortText = form.sortOrder.trim();
    if (!title) return { error: 'Title is required.' };
    if (title.length > TITLE_MAX) return { error: `Title must be at most ${TITLE_MAX} characters.` };
    if (!url) return { error: 'URL is required.' };
    if (url.length > URL_MAX) return { error: `URL must be at most ${URL_MAX} characters.` };
    let parsed = false;
    try {
        parsed = URL_RE.test(url) && !!new URL(url).hostname;
    } catch {
        parsed = false;
    }
    if (!parsed) return { error: 'URL must be a web address starting with http:// or https://' };
    if (source.length > SOURCE_MAX) return { error: `Source must be at most ${SOURCE_MAX} characters.` };
    let sortOrder: number | null = null;
    if (sortText) {
        if (!/^-?\d+$/.test(sortText)) return { error: 'Sort order must be a whole number.' };
        sortOrder = Number.parseInt(sortText, 10);
        if (sortOrder < INT_MIN || sortOrder > INT_MAX) return { error: 'Sort order is out of range.' };
    } else if (form.id) {
        return { error: 'Sort order is required.' };
    }
    return { values: { title, url, source, sortOrder, isActive: form.isActive } };
}

export default function NewsLinksPage() {
    const { user, loading: authLoading } = useAuth();
    const [links, setLinks] = useState<NewsLink[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [reloadKey, setReloadKey] = useState(0);

    const [form, setForm] = useState<LinkForm | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<NewsLink | null>(null);
    /** Row with a toggle or delete in flight. */
    const [busyId, setBusyId] = useState<string | null>(null);

    useEffect(() => {
        // Signed-out users are redirected by app/dashboard/layout.tsx.
        if (!user) return;

        let cancelled = false;
        async function load() {
            setLoading(true);
            // Same order as the mobile app: sort_order, then oldest first.
            const { data, count, error } = await getSupabase()
                .from(TABLES.NEWS_LINKS)
                .select('id, title, url, source, sort_order, is_active, updated_at', { count: 'exact' })
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: true })
                .order('id', { ascending: true })
                .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
            if (cancelled) return;
            if (error) {
                console.error('Error fetching news links:', error);
                toast.error('Failed to load news links.');
                setLinks([]);
                setTotalCount(null);
            } else {
                const rows = (data ?? []) as NewsLinkRow[];
                if (rows.length === 0 && page > 0) {
                    // Past the last page (rows changed elsewhere): step back.
                    const lastPage = count ? Math.ceil(count / PAGE_SIZE) - 1 : page - 1;
                    setPage(Math.max(0, Math.min(page - 1, lastPage)));
                    return;
                }
                setLinks(rows.map(toLink));
                setTotalCount(count ?? null);
            }
            setLoading(false);
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [user, page, reloadKey]);

    function reload() {
        setReloadKey((k) => k + 1);
    }

    function updateForm<K extends keyof LinkForm>(key: K, value: LinkForm[K]) {
        setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    }

    async function saveLink(e: React.FormEvent) {
        e.preventDefault();
        if (!form || saving) return;
        const result = validate(form);
        if ('error' in result) {
            toast.error(result.error);
            return;
        }
        const { title, url, source, isActive } = result.values;

        setSaving(true);
        try {
            const supabase = getSupabase();
            let sortOrder = result.values.sortOrder;
            if (sortOrder === null) {
                // New link without an explicit order: place it after the last one.
                const { data: last, error: lastError } = await supabase
                    .from(TABLES.NEWS_LINKS)
                    .select('sort_order')
                    .order('sort_order', { ascending: false })
                    .limit(1);
                if (lastError) throw lastError;
                const max = (last as { sort_order: number | null }[] | null)?.[0]?.sort_order;
                sortOrder = typeof max === 'number' ? Math.min(max + SORT_STEP, INT_MAX) : SORT_STEP;
            }
            const values = { title, url, source, sort_order: sortOrder, is_active: isActive };
            const { data, error } = form.id
                ? await supabase.from(TABLES.NEWS_LINKS).update(values).eq('id', form.id).select('id')
                : await supabase.from(TABLES.NEWS_LINKS).insert(values).select('id');
            if (error) throw error;
            // RLS filters rows silently: no row back means the write was not allowed.
            if (!data || data.length === 0) throw new Error('Not found or not permitted');
            toast.success(form.id ? 'Link updated' : 'Link added');
            setForm(null);
            reload();
        } catch (error) {
            console.error('Error saving news link:', error);
            toast.error(`Failed to save link: ${errorMessage(error)}`);
        } finally {
            setSaving(false);
        }
    }

    async function toggleActive(link: NewsLink) {
        if (busyId) return;
        setBusyId(link.id);
        try {
            const { data, error } = await getSupabase()
                .from(TABLES.NEWS_LINKS)
                .update({ is_active: !link.isActive })
                .eq('id', link.id)
                .select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error('Not found or not permitted');
            toast.success(link.isActive ? 'Link hidden from the app' : 'Link shown in the app');
            reload();
        } catch (error) {
            console.error('Error updating news link:', error);
            toast.error(`Failed to update link: ${errorMessage(error)}`);
        } finally {
            setBusyId(null);
        }
    }

    async function confirmDelete() {
        if (!deleteTarget || busyId) return;
        const target = deleteTarget;
        setDeleteTarget(null);
        setBusyId(target.id);
        try {
            const { data, error } = await getSupabase()
                .from(TABLES.NEWS_LINKS)
                .delete()
                .eq('id', target.id)
                .select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error('Not found or not permitted');
            toast.success('Link deleted');
            if (links.length === 1 && page > 0) setPage((p) => p - 1);
            else reload();
        } catch (error) {
            console.error('Error deleting news link:', error);
            toast.error(`Failed to delete link: ${errorMessage(error)}`);
        } finally {
            setBusyId(null);
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
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-sky-600 to-blue-700 rounded-lg flex items-center justify-center">
                            <Newspaper className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">News Links</h1>
                            <p className="text-xs text-gray-600">Fallback links for the mobile app&apos;s News section</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
                <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                    <Info className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <p>
                        These links appear in the mobile app&apos;s News section when the live ReliefWeb feed is
                        unavailable (for example when ReliefWeb cannot be reached). Only active links are shown, in
                        ascending sort order (lower numbers first). Hide a link to take it out of the app without
                        deleting it.
                    </p>
                </div>

                <div className="flex justify-end">
                    <button
                        onClick={() => setForm(EMPTY_FORM)}
                        className="flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-medium text-white bg-gradient-to-r from-[#E63946] to-[#9D0208] hover:opacity-90 transition-opacity"
                    >
                        <Plus className="w-5 h-5" />
                        Add Link
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-sky-600" />
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        {['Order', 'Title', 'Source', 'Status', 'Updated', 'Actions'].map((h) => (
                                            <th
                                                key={h}
                                                className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"
                                            >
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {links.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                                                No news links yet
                                            </td>
                                        </tr>
                                    ) : (
                                        links.map((l) => {
                                            const label = l.title || l.url || 'link';
                                            return (
                                                <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-4 text-sm text-gray-700 tabular-nums">
                                                        {l.sortOrder}
                                                    </td>
                                                    <td className="px-6 py-4 max-w-md">
                                                        <p className="font-medium text-gray-900">{l.title || '—'}</p>
                                                        <a
                                                            href={l.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline break-all"
                                                        >
                                                            {l.url}
                                                            <ExternalLink className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                                                        </a>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-700">{l.source || '—'}</td>
                                                    <td className="px-6 py-4">
                                                        <button
                                                            type="button"
                                                            onClick={() => void toggleActive(l)}
                                                            disabled={busyId !== null}
                                                            title={l.isActive ? 'Hide from the app' : 'Show in the app'}
                                                            aria-label={`${l.isActive ? 'Hide' : 'Show'} ${label}`}
                                                            className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
                                                                l.isActive
                                                                    ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                            }`}
                                                        >
                                                            {l.isActive ? 'Active' : 'Hidden'}
                                                        </button>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-700">
                                                        {l.updatedAt ? l.updatedAt.toLocaleDateString() : '—'}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {busyId === l.id ? (
                                                            <div className="p-2">
                                                                <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    onClick={() =>
                                                                        setForm({
                                                                            id: l.id,
                                                                            title: l.title,
                                                                            url: l.url,
                                                                            source: l.source,
                                                                            sortOrder: String(l.sortOrder),
                                                                            isActive: l.isActive,
                                                                        })
                                                                    }
                                                                    disabled={busyId !== null}
                                                                    className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                                                                    title="Edit link"
                                                                    aria-label={`Edit ${label}`}
                                                                >
                                                                    <Pencil className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() => setDeleteTarget(l)}
                                                                    disabled={busyId !== null}
                                                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                                                    title="Delete link"
                                                                    aria-label={`Delete ${label}`}
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <Pagination
                            page={page}
                            pageSize={PAGE_SIZE}
                            total={totalCount}
                            itemCount={links.length}
                            noun="links"
                            disabled={loading}
                            onPageChange={setPage}
                        />
                    </div>
                )}
            </div>

            {/* Create / edit */}
            {form && (
                <Modal
                    title={form.id ? 'Edit Link' : 'Add Link'}
                    titleClassName="text-xl font-bold mb-2 text-gray-900"
                    onClose={() => setForm(null)}
                    closeDisabled={saving}
                    className="max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
                >
                    <form onSubmit={(e) => void saveLink(e)} noValidate>
                        <p className="text-sm text-gray-600 mb-4">
                            Shown in the app&apos;s News section while the live ReliefWeb feed is unavailable.
                        </p>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="news-title" className="block text-sm font-medium text-gray-700 mb-1">
                                    Title
                                </label>
                                <input
                                    id="news-title"
                                    type="text"
                                    required
                                    maxLength={TITLE_MAX}
                                    value={form.title}
                                    onChange={(e) => updateForm('title', e.target.value)}
                                    placeholder="e.g. NiMet Seasonal Climate Prediction"
                                    className={INPUT_CLASS}
                                />
                            </div>
                            <div>
                                <label htmlFor="news-url" className="block text-sm font-medium text-gray-700 mb-1">
                                    URL
                                </label>
                                <input
                                    id="news-url"
                                    type="url"
                                    inputMode="url"
                                    required
                                    maxLength={URL_MAX}
                                    value={form.url}
                                    onChange={(e) => updateForm('url', e.target.value)}
                                    placeholder="https://..."
                                    className={INPUT_CLASS}
                                />
                            </div>
                            <div>
                                <label htmlFor="news-source" className="block text-sm font-medium text-gray-700 mb-1">
                                    Source <span className="text-gray-400 font-normal">(optional)</span>
                                </label>
                                <input
                                    id="news-source"
                                    type="text"
                                    maxLength={SOURCE_MAX}
                                    value={form.source}
                                    onChange={(e) => updateForm('source', e.target.value)}
                                    placeholder="e.g. NiMet, Red Cross"
                                    className={INPUT_CLASS}
                                />
                            </div>
                            <div>
                                <label htmlFor="news-sort" className="block text-sm font-medium text-gray-700 mb-1">
                                    Sort order
                                </label>
                                <input
                                    id="news-sort"
                                    type="number"
                                    inputMode="numeric"
                                    step={1}
                                    value={form.sortOrder}
                                    onChange={(e) => updateForm('sortOrder', e.target.value)}
                                    aria-describedby="news-sort-hint"
                                    className={`${INPUT_CLASS} max-w-xs`}
                                />
                                <p id="news-sort-hint" className="mt-1 text-xs text-gray-500">
                                    Lower numbers appear first.
                                    {!form.id && ' Leave empty to add the link at the end.'}
                                </p>
                            </div>
                            <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={form.isActive}
                                    onChange={(e) => updateForm('isActive', e.target.checked)}
                                    className="h-5 w-5 rounded border-gray-300 bg-white text-[#E63946] focus:ring-[#E63946]"
                                />
                                Active (shown in the app)
                            </label>
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
                                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white bg-gradient-to-r from-[#e85d04] to-[#dc2f02] hover:opacity-90 transition-opacity disabled:opacity-50"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {form.id ? 'Save Changes' : 'Add Link'}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Delete confirmation */}
            {deleteTarget && (
                <Modal
                    title="Delete Link"
                    titleClassName="text-xl font-bold mb-4 text-red-600"
                    onClose={() => setDeleteTarget(null)}
                >
                    <p className="text-gray-600 mb-6 leading-relaxed">
                        Delete &ldquo;{deleteTarget.title || deleteTarget.url}&rdquo;? It will no longer appear in the
                        app. This cannot be undone.
                    </p>
                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={() => setDeleteTarget(null)}
                            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => void confirmDelete()}
                            className="px-4 py-2 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                        >
                            Delete
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}
