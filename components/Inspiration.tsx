
import React, { useState } from 'react';
import { searchTrends } from '../services/geminiService';
import { SearchResult } from '../types';

export const Inspiration: React.FC = () => {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setResult(null);
    try {
      const data = await searchTrends(query);
      setResult(data);
    } catch (err) {
      console.error(err);
      alert('Failed to fetch trends.');
    } finally {
      setLoading(false);
    }
  };

  const renderContentWithCitations = (text: string) => {
    // Split by the markdown link pattern: [number](url)
    const parts = text.split(/(\[\d+\]\(https?:\/\/[^\)]+\))/g);
    
    return parts.map((part, index) => {
      // Check if this part matches the link pattern
      const match = part.match(/^\[(\d+)\]\((https?:\/\/[^\)]+)\)$/);
      
      if (match) {
        const num = match[1];
        const url = match[2];
        return (
          <a
            key={index}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center w-5 h-5 ml-1 text-[10px] font-bold text-blue-900 bg-blue-400 rounded-full hover:bg-blue-300 hover:text-blue-950 align-super transition-colors decoration-0 no-underline"
            title={url}
          >
            {num}
          </a>
        );
      }
      
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-gray-900/50 backdrop-blur-md rounded-2xl border border-gray-800 p-8 shadow-xl">
        <h2 className="text-3xl font-light tracking-tight text-white mb-4">
          Trend Scout
        </h2>
        <p className="text-gray-400 mb-6">
          Use Google Search Grounding to find real-time trends, news, and facts to inspire your next creation.
        </p>

        <form onSubmit={handleSearch} className="flex gap-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g., Top fashion trends for Summer 2025"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-5 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : 'Search'}
          </button>
        </form>
      </div>

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6">
              <h3 className="text-xl font-semibold mb-4 text-white">Insight</h3>
              <div className="prose prose-invert max-w-none text-gray-300 whitespace-pre-wrap leading-relaxed">
                {renderContentWithCitations(result.text)}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-400 px-1">Sources</h3>
            {result.sources.length > 0 ? (
              result.sources.map((source, idx) => (
                <a
                  key={idx}
                  href={source.web?.uri}
                  target="_blank"
                  rel="noreferrer"
                  className="block p-4 bg-gray-800 rounded-xl border border-gray-700 hover:border-blue-500 hover:bg-gray-750 transition-all group"
                >
                  <div className="flex items-center gap-3 mb-1">
                    <span className="flex items-center justify-center w-5 h-5 text-[10px] font-bold text-blue-900 bg-blue-400 rounded-full">
                      {idx + 1}
                    </span>
                    <h4 className="font-medium text-blue-400 group-hover:text-blue-300 truncate flex-1">
                      {source.web?.title || "Web Source"}
                    </h4>
                  </div>
                  <p className="text-xs text-gray-500 pl-8 truncate">
                    {source.web?.uri}
                  </p>
                </a>
              ))
            ) : (
              <div className="text-gray-500 italic">No specific sources cited.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
