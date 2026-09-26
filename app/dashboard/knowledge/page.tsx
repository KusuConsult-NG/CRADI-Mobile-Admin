'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getSupabase } from '@/lib/supabase';
import {
    TABLES,
    KNOWLEDGE_CATEGORIES,
    DEFAULT_KNOWLEDGE_CATEGORY,
    knowledgeCategoryByHazardType,
    sanitizeSearch,
    toDate,
} from '@/lib/constants';
import Pagination from '@/components/Pagination';
import Modal from '@/components/Modal';
import { BookOpen, Loader2, Search, Plus, Trash2, Edit } from 'lucide-react';
import toast from 'react-hot-toast';

const PAGE_SIZE = 24;

interface KnowledgeArticle {
    id: string;
    title: string;
    content: string;
    source: string;
    category: string;
    hazardType?: string;
    imageUrl: string;
    updatedAt: Date | null;
}

interface KnowledgeRow {
    id: string;
    title: string | null;
    content: string | null;
    source: string | null;
    category: string | null;
    hazard_type: string | null;
    image_url: string | null;
    updated_at: string | null;
    created_at: string | null;
}

const KB_COLUMNS = 'id, title, content, source, category, hazard_type, image_url, updated_at, created_at';

/** Dropdown value meaning "keep the article's stored category / hazard type". */
const KEEP_STORED = '__stored__';

interface ArticleForm {
    title: string;
    /** A KNOWLEDGE_CATEGORIES hazardType, or KEEP_STORED. */
    categoryKey: string;
    source: string;
    imageUrl: string;
    content: string;
}

interface EditorState {
    id: string | null;
    form: ArticleForm;
    /** Stored category / hazard type that match no listed category exactly. */
    stored: { category: string; hazardType: string } | null;
}

const EMPTY_FORM: ArticleForm = {
    title: '',
    categoryKey: DEFAULT_KNOWLEDGE_CATEGORY.hazardType,
    source: '',
    imageUrl: '',
    content: '',
};

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function toArticle(row: KnowledgeRow): KnowledgeArticle {
    return {
        id: row.id,
        title: str(row.title) || 'Untitled',
        content: str(row.content),
        source: str(row.source),
        category: str(row.category),
        hazardType: str(row.hazard_type) || undefined,
        imageUrl: str(row.image_url),
        updatedAt: toDate(row.updated_at ?? row.created_at),
    };
}

/**
 * Editor state for an existing article. Its stored category / hazard type are
 * kept unless the admin picks another category; a pair that is not exactly one
 * of the listed categories is offered as an extra "current value" option.
 */
function editorFor(article: KnowledgeArticle): EditorState {
    const hazardType = article.hazardType ?? '';
    const listed = knowledgeCategoryByHazardType(hazardType);
    const exact = listed !== null && listed.label === article.category;
    return {
        id: article.id,
        form: {
            title: article.title,
            categoryKey: exact ? listed.hazardType : KEEP_STORED,
            source: article.source,
            imageUrl: article.imageUrl,
            content: article.content,
        },
        stored: exact ? null : { category: article.category, hazardType },
    };
}

function preview(content: string): string {
    const text = content.trim();
    if (!text) return 'No content yet.';
    return text.length > 150 ? `${text.substring(0, 150)}...` : text;
}

export default function KnowledgePage() {
    const { user, loading: authLoading } = useAuth();
    const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    const [editor, setEditor] = useState<EditorState | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<KnowledgeArticle | null>(null);
    const [deleting, setDeleting] = useState(false);

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
                .from(TABLES.KNOWLEDGE_BASE)
                .select(KB_COLUMNS, { count: 'exact' })
                .order('updated_at', { ascending: false })
                .order('id', { ascending: false })
                .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
            if (searchQuery) {
                const p = `*${searchQuery}*`;
                query = query.or(`title.ilike.${p},category.ilike.${p},hazard_type.ilike.${p},source.ilike.${p}`);
            }
            const { data, count, error } = await query;
            if (cancelled) return;
            if (error) {
                console.error('Error fetching knowledge articles:', error);
                toast.error('Failed to load knowledge articles.');
                setArticles([]);
                setTotalCount(null);
            } else {
                const rows = (data ?? []) as KnowledgeRow[];
                if (rows.length === 0 && page > 0) {
                    // Past the last page (rows were deleted elsewhere): step back.
                    const lastPage = count ? Math.ceil(count / PAGE_SIZE) - 1 : page - 1;
                    setPage(Math.max(0, Math.min(page - 1, lastPage)));
                    return;
                }
                setArticles(rows.map(toArticle));
                setTotalCount(count ?? null);
            }
            setLoading(false);
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [user, page, searchQuery, reloadKey]);

    async function saveArticle(e: React.FormEvent) {
        e.preventDefault();
        if (!editor || saving) return;
        const { id, form, stored } = editor;
        const title = form.title.trim();
        const content = form.content.trim();
        const imageUrl = form.imageUrl.trim();
        if (!title || !content) {
            toast.error('Title and content are required.');
            return;
        }
        if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
            toast.error('Image URL must start with https://');
            return;
        }

        const picked = knowledgeCategoryByHazardType(form.categoryKey);
        const data: Record<string, unknown> = {
            title,
            content,
            source: form.source.trim(),
            image_url: imageUrl || null,
        };
        if (picked) {
            data.category = picked.label;
            data.hazard_type = picked.hazardType;
        } else if (!stored) {
            data.category = DEFAULT_KNOWLEDGE_CATEGORY.label;
            data.hazard_type = DEFAULT_KNOWLEDGE_CATEGORY.hazardType;
        }
        // Otherwise KEEP_STORED on an existing article: leave both columns untouched.

        setSaving(true);
        try {
            const table = getSupabase().from(TABLES.KNOWLEDGE_BASE);
            const { data: rows, error } = id
                ? await table.update(data).eq('id', id).select('id')
                : await table.insert(data).select('id');
            if (error) throw error;
            if (!rows || rows.length === 0) throw new Error('Article not found or not permitted');
            toast.success(id ? 'Article updated' : 'Article created');
            setEditor(null);
            // updated_at ordering puts the saved article first.
            if (page === 0) setReloadKey((k) => k + 1);
            else setPage(0);
        } catch (error) {
            console.error('Error saving article:', error);
            toast.error('Failed to save article. Please try again.');
        } finally {
            setSaving(false);
        }
    }

    async function confirmDelete() {
        if (!deleteTarget || deleting) return;
        const target = deleteTarget;
        setDeleting(true);
        setDeleteTarget(null);
        try {
            const { data, error } = await getSupabase()
                .from(TABLES.KNOWLEDGE_BASE)
                .delete()
                .eq('id', target.id)
                .select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error('Article not found or not permitted');
            toast.success('Article deleted');
            if (articles.length === 1 && page > 0) setPage((p) => p - 1);
            else setReloadKey((k) => k + 1);
        } catch (error) {
            console.error('Error deleting article:', error);
            toast.error('Failed to delete article. Please try again.');
        } finally {
            setDeleting(false);
        }
    }

    function updateForm<K extends keyof ArticleForm>(key: K, value: ArticleForm[K]) {
        setEditor((prev) => (prev ? { ...prev, form: { ...prev.form, [key]: value } } : prev));
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
                            <div className="w-10 h-10 bg-gradient-to-br from-[#E63946] to-[#9D0208] rounded-lg flex items-center justify-center">
                                <BookOpen className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-gray-900">Knowledge Base</h1>
                                <p className="text-xs text-gray-600">Manage hazard guides and articles</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Search Bar */}
                <div className="mb-6 flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search articles by title, category, hazard type or source..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            aria-label="Search knowledge articles"
                            className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                        />
                    </div>
                    <button
                        onClick={() => setEditor({ id: null, form: EMPTY_FORM, stored: null })}
                        className="flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-medium text-white bg-gradient-to-r from-[#E63946] to-[#9D0208] hover:opacity-90 transition-opacity"
                    >
                        <Plus className="w-5 h-5" />
                        New Article
                    </button>
                </div>

                {/* Articles Grid */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {articles.length === 0 ? (
                            <div className="col-span-full text-center py-12 text-gray-500">
                                No knowledge articles found
                            </div>
                        ) : (
                            articles.map((article) => (
                                <div
                                    key={article.id}
                                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow flex flex-col"
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1 min-w-0">
                                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                                {article.title}
                                            </h3>
                                            {article.category && (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                    {article.category}
                                                </span>
                                            )}
                                            {article.hazardType &&
                                                article.hazardType !== article.category.toLowerCase() && (
                                                    <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                                        {article.hazardType}
                                                    </span>
                                                )}
                                        </div>
                                    </div>

                                    <p className="text-sm text-gray-600 mb-4 line-clamp-3 flex-1">
                                        {preview(article.content)}
                                    </p>
                                    {article.source && (
                                        <p className="text-xs text-gray-500 mb-4 truncate">Source: {article.source}</p>
                                    )}

                                    <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                                        <span className="text-xs text-gray-500">
                                            {article.updatedAt ? `Updated ${article.updatedAt.toLocaleDateString()}` : '—'}
                                        </span>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => setEditor(editorFor(article))}
                                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="Edit article"
                                                aria-label={`Edit article ${article.title}`}
                                            >
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => setDeleteTarget(article)}
                                                disabled={deleting}
                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                                title="Delete article"
                                                aria-label={`Delete article ${article.title}`}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {!loading && (articles.length > 0 || page > 0) && (
                    <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <Pagination
                            page={page}
                            pageSize={PAGE_SIZE}
                            total={totalCount}
                            itemCount={articles.length}
                            noun="articles"
                            disabled={loading}
                            onPageChange={setPage}
                        />
                    </div>
                )}
            </div>

            {/* Create / Edit Modal */}
            {editor && (
                <Modal
                    title={editor.id ? 'Edit Article' : 'New Article'}
                    onClose={() => setEditor(null)}
                    closeDisabled={saving}
                    className="max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
                >
                    <form onSubmit={(e) => void saveArticle(e)}>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="kb-title" className="block text-sm font-medium text-gray-700 mb-1">
                                    Title
                                </label>
                                <input
                                    id="kb-title"
                                    type="text"
                                    required
                                    value={editor.form.title}
                                    onChange={(e) => updateForm('title', e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none text-gray-900"
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="kb-category" className="block text-sm font-medium text-gray-700 mb-1">
                                        Category
                                    </label>
                                    <select
                                        id="kb-category"
                                        value={editor.form.categoryKey}
                                        onChange={(e) => updateForm('categoryKey', e.target.value)}
                                        className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none text-gray-900"
                                    >
                                        {editor.stored && (
                                            <option value={KEEP_STORED}>
                                                {editor.stored.category || '(none)'} / {editor.stored.hazardType || '(none)'} (current)
                                            </option>
                                        )}
                                        {KNOWLEDGE_CATEGORIES.map((c) => (
                                            <option key={c.hazardType} value={c.hazardType}>
                                                {c.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="kb-source" className="block text-sm font-medium text-gray-700 mb-1">
                                        Source
                                    </label>
                                    <input
                                        id="kb-source"
                                        type="text"
                                        value={editor.form.source}
                                        onChange={(e) => updateForm('source', e.target.value)}
                                        placeholder="e.g. NEMA, NiMet"
                                        className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none text-gray-900"
                                    />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="kb-image" className="block text-sm font-medium text-gray-700 mb-1">
                                    Image URL <span className="text-gray-400 font-normal">(optional)</span>
                                </label>
                                <input
                                    id="kb-image"
                                    type="url"
                                    value={editor.form.imageUrl}
                                    onChange={(e) => updateForm('imageUrl', e.target.value)}
                                    placeholder="https://..."
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none text-gray-900"
                                />
                            </div>
                            <div>
                                <label htmlFor="kb-content" className="block text-sm font-medium text-gray-700 mb-1">
                                    Content
                                </label>
                                <textarea
                                    id="kb-content"
                                    required
                                    rows={10}
                                    value={editor.form.content}
                                    onChange={(e) => updateForm('content', e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none text-gray-900"
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end mt-6">
                            <button
                                type="button"
                                onClick={() => setEditor(null)}
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
                                {editor.id ? 'Save Changes' : 'Create Article'}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Delete Confirmation */}
            {deleteTarget && (
                <Modal
                    title="Delete Article"
                    titleClassName="text-xl font-bold mb-4 text-red-600"
                    onClose={() => setDeleteTarget(null)}
                >
                    <p className="text-gray-600 mb-6 leading-relaxed">
                            Delete &ldquo;{deleteTarget.title}&rdquo;? This cannot be undone.
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
                                disabled={deleting}
                                className="px-4 py-2 rounded-lg font-medium transition-colors bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                            >
                                Delete
                            </button>
                        </div>
                </Modal>
            )}
        </div>
    );
}
