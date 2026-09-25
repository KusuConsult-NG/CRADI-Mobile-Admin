'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getCountFromServer,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    startAfter,
    updateDoc,
    type DocumentData,
    type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
    db,
    COLLECTIONS,
    KNOWLEDGE_CATEGORIES,
    toDate,
    type KnowledgeCategory,
} from '@/lib/firebase';
import { BookOpen, Loader2, Search, ArrowLeft, Plus, Trash2, Edit } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

const PAGE_SIZE = 50;

interface KnowledgeArticle {
    id: string;
    title: string;
    content: string;
    source: string;
    category: string;
    hazardType?: string;
    updatedAt: Date | null;
}

interface ArticleForm {
    title: string;
    category: KnowledgeCategory;
    source: string;
    content: string;
}

const EMPTY_FORM: ArticleForm = { title: '', category: 'General', source: '', content: '' };

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function toArticle(snap: QueryDocumentSnapshot<DocumentData>): KnowledgeArticle {
    const d = snap.data();
    return {
        id: snap.id,
        title: str(d.title) || 'Untitled',
        content: str(d.content),
        source: str(d.source),
        category: str(d.category),
        hazardType: str(d.hazardType) || undefined,
        updatedAt: toDate(d.updatedAt ?? d.createdAt),
    };
}

function matchCategory(article: KnowledgeArticle): KnowledgeCategory {
    const candidates = [article.category, article.hazardType].map((c) => (c ?? '').toLowerCase());
    return KNOWLEDGE_CATEGORIES.find((c) => candidates.includes(c.toLowerCase())) ?? 'General';
}

function preview(content: string): string {
    const text = content.trim();
    if (!text) return 'No content yet.';
    return text.length > 150 ? `${text.substring(0, 150)}...` : text;
}

export default function KnowledgePage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const [editor, setEditor] = useState<{ id: string | null; form: ArticleForm } | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<KnowledgeArticle | null>(null);
    const [deleting, setDeleting] = useState(false);

    const fetchArticles = useCallback(async (append: boolean) => {
        const kbRef = collection(db, COLLECTIONS.KNOWLEDGE_BASE);
        const cursor = append ? lastDocRef.current : null;
        const q = cursor
            ? query(kbRef, orderBy('updatedAt', 'desc'), startAfter(cursor), limit(PAGE_SIZE))
            : query(kbRef, orderBy('updatedAt', 'desc'), limit(PAGE_SIZE));

        if (append) setLoadingMore(true);
        else setLoading(true);

        try {
            const [snapshot, count] = await Promise.all([
                getDocs(q),
                append ? Promise.resolve(null) : getCountFromServer(kbRef).then((c) => c.data().count).catch(() => null),
            ]);
            const page = snapshot.docs.map(toArticle);
            lastDocRef.current = snapshot.docs[snapshot.docs.length - 1] ?? lastDocRef.current;
            setHasMore(snapshot.docs.length === PAGE_SIZE);
            setArticles((prev) => (append ? [...prev, ...page] : page));
            if (!append) setTotalCount(count);
        } catch (error) {
            console.error('Error fetching knowledge articles:', error);
            toast.error('Failed to load knowledge articles.');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, []);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
        } else if (user) {
            void fetchArticles(false);
        }
    }, [user, authLoading, router, fetchArticles]);

    async function saveArticle(e: React.FormEvent) {
        e.preventDefault();
        if (!editor || saving) return;
        const { id, form } = editor;
        const title = form.title.trim();
        const content = form.content.trim();
        if (!title || !content) {
            toast.error('Title and content are required.');
            return;
        }

        const data = {
            title,
            content,
            source: form.source.trim(),
            category: form.category,
            hazardType: form.category.toLowerCase(),
            updatedAt: serverTimestamp(),
        };

        setSaving(true);
        try {
            if (id) {
                await updateDoc(doc(db, COLLECTIONS.KNOWLEDGE_BASE, id), data);
                toast.success('Article updated');
            } else {
                await addDoc(collection(db, COLLECTIONS.KNOWLEDGE_BASE), {
                    ...data,
                    createdAt: serverTimestamp(),
                });
                toast.success('Article created');
            }
            setEditor(null);
            lastDocRef.current = null;
            await fetchArticles(false);
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
            await deleteDoc(doc(db, COLLECTIONS.KNOWLEDGE_BASE, target.id));
            setArticles((prev) => prev.filter((a) => a.id !== target.id));
            setTotalCount((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
            toast.success('Article deleted');
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

    const filteredArticles = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return articles;
        return articles.filter(
            (article) =>
                article.title.toLowerCase().includes(q) ||
                article.category.toLowerCase().includes(q) ||
                article.hazardType?.toLowerCase().includes(q)
        );
    }, [articles, searchQuery]);

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
            </header>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Search Bar */}
                <div className="mb-6 flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search articles by title, category, or hazard type..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                        />
                    </div>
                    <button
                        onClick={() => setEditor({ id: null, form: EMPTY_FORM })}
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
                        {filteredArticles.length === 0 ? (
                            <div className="col-span-full text-center py-12 text-gray-500">
                                No knowledge articles found
                            </div>
                        ) : (
                            filteredArticles.map((article) => (
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
                                                onClick={() =>
                                                    setEditor({
                                                        id: article.id,
                                                        form: {
                                                            title: article.title,
                                                            category: matchCategory(article),
                                                            source: article.source,
                                                            content: article.content,
                                                        },
                                                    })
                                                }
                                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="Edit article"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => setDeleteTarget(article)}
                                                disabled={deleting}
                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                                title="Delete article"
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

                {/* Footer Stats */}
                {!loading && (
                    <div className="mt-8 p-6 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <p className="text-sm text-gray-600">
                            {searchQuery.trim()
                                ? `${filteredArticles.length} match${filteredArticles.length === 1 ? '' : 'es'} among ${articles.length} loaded articles`
                                : `Showing ${articles.length} loaded article${articles.length === 1 ? '' : 's'}`}
                            {totalCount !== null && ` (${totalCount.toLocaleString()} total)`}
                        </p>
                        {hasMore && (
                            <button
                                onClick={() => void fetchArticles(true)}
                                disabled={loadingMore}
                                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                                Load more
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Create / Edit Modal */}
            {editor && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <form
                        onSubmit={(e) => void saveArticle(e)}
                        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
                    >
                        <h3 className="text-xl font-bold mb-4 text-gray-900">
                            {editor.id ? 'Edit Article' : 'New Article'}
                        </h3>
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
                                        value={editor.form.category}
                                        onChange={(e) => updateForm('category', e.target.value as KnowledgeCategory)}
                                        className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none text-gray-900"
                                    >
                                        {KNOWLEDGE_CATEGORIES.map((c) => (
                                            <option key={c} value={c}>
                                                {c}
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
                </div>
            )}

            {/* Delete Confirmation */}
            {deleteTarget && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
                        <h3 className="text-xl font-bold mb-4 text-red-600">Delete Article</h3>
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
                    </div>
                </div>
            )}
        </div>
    );
}
