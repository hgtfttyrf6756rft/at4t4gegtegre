
import React, { useState, useEffect } from 'react';
import { authFetch } from '../services/authFetch';
import { generateNewsApiQueries } from '../services/geminiService';
import { NewsArticle } from '../types';

interface NewsSectionProps {
    project: any;
    isDarkMode: boolean;
    activeTheme?: string;
    currentTheme?: any;
}

export const NewsSection: React.FC<NewsSectionProps> = ({ project, isDarkMode, activeTheme, currentTheme }) => {
    const [news, setNews] = useState<NewsArticle[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [queries, setQueries] = useState<string[]>([]);
    const [activeQueryIndex, setActiveQueryIndex] = useState(0);

    const fetchNews = async (searchQuery: string) => {
        if (!searchQuery) return;
        setLoading(true);
        setError(null);
        try {
            const res = await authFetch(`/api/news?q=${encodeURIComponent(searchQuery)}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to fetch news');

            setNews(Array.isArray(data.articles) ? data.articles : []);
        } catch (e: any) {
            setError(e.message || 'Failed to fetch news');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const initQueries = async () => {
            if (project?.id) {
                try {
                    const generatedQueries = await generateNewsApiQueries(project.name, project.description || '');
                    setQueries(generatedQueries);
                    if (generatedQueries.length > 0) {
                        setQuery(generatedQueries[0]);
                        fetchNews(generatedQueries[0]);
                    } else {
                        // Fallback
                        const fallback = project.name;
                        setQueries([fallback]);
                        setQuery(fallback);
                        fetchNews(fallback);
                    }
                } catch (e) {
                    console.error('Failed to generate news queries:', e);
                    // Fallback
                    const fallback = project.name;
                    setQueries([fallback]);
                    setQuery(fallback);
                    fetchNews(fallback);
                }
            }
        };

        initQueries();
    }, [project?.id, project?.name]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchNews(query);
    };

    return (
        <div className={`rounded-2xl sm:rounded-3xl p-5 ${isDarkMode
            ? 'bg-[#1d1d1f] border border-[#3d3d3f]/50'
            : activeTheme === 'light'
                ? 'bg-white border border-gray-200 shadow-sm'
                : `${currentTheme?.cardBg || 'bg-white'} border ${currentTheme?.border || 'border-gray-200'}`
            }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <h3 className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    📰 Relevant News
                </h3>
                <form onSubmit={handleSearch} className="flex-1 max-w-md">
                    <div className="relative">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search news..."
                            className={`w-full pl-4 pr-10 py-2 rounded-xl text-sm border outline-none transition-all ${isDarkMode
                                ? 'bg-[#2c2c2e] border-[#3d3d3f] text-white focus:border-[#0a84ff]'
                                : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-blue-500'
                                }`}
                        />
                        <button
                            type="submit"
                            disabled={loading}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </button>
                    </div>
                </form>
            </div>

            {/* Queries Pills */}
            {queries.length > 1 && (
                <div className="flex flex-wrap gap-2 mb-6">
                    {queries.map((q, idx) => (
                        <button
                            key={idx}
                            onClick={() => {
                                setQuery(q);
                                setActiveQueryIndex(idx);
                                fetchNews(q);
                            }}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${query === q
                                ? (activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light'
                                    ? `${currentTheme.primary} text-white`
                                    : 'bg-blue-500 text-white')
                                : (isDarkMode ? 'bg-[#2c2c2e] text-gray-300 hover:bg-[#3d3d3f]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
                                }`}
                        >
                            {q}
                        </button>
                    ))}
                </div>
            )}

            {loading ? (
                <div className="py-12 text-center">
                    <div className={`inline-block w-6 h-6 border-2 border-t-transparent rounded-full animate-spin ${isDarkMode ? 'border-white' : 'border-blue-600'}`}></div>
                    <p className={`mt-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Finding relevant articles...</p>
                </div>
            ) : error ? (
                <div className={`p-4 rounded-xl text-center ${isDarkMode ? 'bg-red-900/20 text-red-400' : 'bg-red-50 text-red-600'}`}>
                    {error}
                </div>
            ) : news.length === 0 ? (
                <div className="py-12 text-center">
                    <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>No articles found for "{query}"</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {news.map((item, index) => (
                        <a
                            key={index}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`group block p-4 rounded-xl border transition-all ${isDarkMode
                                ? 'bg-[#2c2c2e]/50 border-[#3d3d3f]/50 hover:bg-[#2c2c2e]'
                                : 'bg-white border-gray-100 hover:border-blue-200 hover:shadow-md'
                                }`}
                        >
                            <div className="flex gap-4">
                                {item.urlToImage && (
                                    <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-gray-200">
                                        <img src={item.urlToImage} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className={`text-xs font-semibold mb-1 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                                        {typeof item.source === 'object' ? (item.source?.name || 'News') : (item.source || 'News')}
                                    </div>
                                    <h4 className={`text-sm font-semibold leading-snug mb-2 line-clamp-2 group-hover:underline ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                                        {item.title}
                                    </h4>
                                    <p className={`text-xs line-clamp-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {item.description}
                                    </p>
                                    <div className={`mt-2 text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                        {new Date(item.publishedAt).toLocaleDateString()}
                                    </div>
                                </div>
                            </div>
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
};
