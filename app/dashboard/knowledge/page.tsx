'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { databases, DATABASE_ID, COLLECTIONS, Query } from '@/lib/appwrite';
import { BookOpen, Loader2, Search, ArrowLeft, Plus, Trash2, Edit } from 'lucide-react';
import Link from 'next/link';

interface KnowledgeArticle {
    $id: string;
    title: string;
    content: string;
    category: string;
    hazardType?: string;
    $createdAt: string;
}

export default function KnowledgePage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
        } else if (user) {
            fetchArticles();
        }
    }, [user, authLoading, router]);

    async function fetchArticles() {
        try {
            setLoading(true);
            const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.KNOWLEDGE_BASE, [
                Query.orderDesc('$createdAt'),
                Query.limit(100),
            ]);
            setArticles(response.documents as any);
        } catch (error) {
            console.error('Error fetching knowledge articles:', error);
        } finally {
            setLoading(false);
        }
    }

    const filteredArticles = articles.filter(
        (article) =>
            article.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            article.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            article.hazardType?.toLowerCase().includes(searchQuery.toLowerCase())
    );

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
                <div className="mb-6 flex gap-4">
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
                                    key={article.$id}
                                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow"
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                                {article.title}
                                            </h3>
                                            {article.category && (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                    {article.category}
                                                </span>
                                            )}
                                            {article.hazardType && (
                                                <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                                    {article.hazardType}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <p className="text-sm text-gray-600 mb-4 line-clamp-3">
                                        {article.content.substring(0, 150)}...
                                    </p>

                                    <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                                        <span className="text-xs text-gray-500">
                                            {new Date(article.$createdAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* Footer Stats */}
                {!loading && (
                    <div className="mt-8 p-6 bg-white rounded-xl shadow-sm border border-gray-100">
                        <p className="text-sm text-gray-600">
                            Showing {filteredArticles.length} of {articles.length} articles
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
