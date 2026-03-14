import React, { useEffect, useMemo, useState } from 'react';

interface DDIDeletionStatusPageProps {
  isDarkMode: boolean;
}

type DeletionStatus = {
  confirmation_code: string;
  status: string;
  requestedAt?: string;
  completedAt?: string;
  message?: string;
};

export const DDIDeletionStatusPage: React.FC<DDIDeletionStatusPageProps> = ({ isDarkMode }) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DeletionStatus | null>(null);

  const ui = useMemo(
    () => ({
      page: isDarkMode ? 'bg-[#000000] text-white' : 'bg-gray-50 text-gray-900',
      card: isDarkMode
        ? 'bg-[#1d1d1f] border border-[#3d3d3f]/70'
        : 'bg-white border border-gray-200',
      subtleText: isDarkMode ? 'text-[#86868b]' : 'text-gray-600',
      heading: isDarkMode ? 'text-white' : 'text-gray-900',
    }),
    [isDarkMode]
  );

  const goHome = () => {
    if (typeof window === 'undefined') return;
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const fetchStatus = async (nextCode: string) => {
    const trimmed = (nextCode || '').trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch(`/api/data-deletion-status?code=${encodeURIComponent(trimmed)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || 'Failed to load status');
      }
      setData(body as DeletionStatus);
    } catch (e: any) {
      setError(e?.message || 'Failed to load status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const initial = (url.searchParams.get('code') || '').trim();
    setCode(initial);
    if (initial) {
      fetchStatus(initial);
    }
  }, []);

  return (
    <div className={`min-h-screen ${ui.page}`}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div>
            <div className={`text-sm font-semibold uppercase tracking-wider ${ui.subtleText}`}>Deletion</div>
            <h1 className={`text-3xl sm:text-4xl font-semibold tracking-tight ${ui.heading}`}>Request status</h1>
          </div>
          <button
            type="button"
            onClick={goHome}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              isDarkMode ? 'bg-white/10 hover:bg-white/15 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
            }`}
          >
            Home
          </button>
        </div>

        <div className={`rounded-2xl sm:rounded-3xl p-6 ${ui.card}`}>
          <div className={`text-sm ${ui.subtleText}`}>
            Enter your confirmation code to view the current status of your deletion request.
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Confirmation code"
              className={`flex-1 px-4 py-2.5 rounded-xl border text-sm outline-none ${
                isDarkMode
                  ? 'bg-[#0b0b0c] border-[#3d3d3f]/80 text-white placeholder:text-gray-500'
                  : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400'
              }`}
            />
            <button
              type="button"
              onClick={() => fetchStatus(code)}
              disabled={loading}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-70 ${
                isDarkMode ? 'bg-white/10 hover:bg-white/15 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
              }`}
            >
              {loading ? 'Loading…' : 'Check'}
            </button>
          </div>

          {error && (
            <div className={`mt-4 p-3 rounded-xl text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {error}
            </div>
          )}

          {data && (
            <div className={`mt-4 p-4 rounded-2xl ${isDarkMode ? 'bg-white/5 border border-white/10' : 'bg-gray-50 border border-gray-200'}`}>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div>
                  <div className={`text-xs font-semibold uppercase tracking-wider ${ui.subtleText}`}>Confirmation code</div>
                  <div className={`mt-1 font-mono text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{data.confirmation_code}</div>
                </div>
                <div>
                  <div className={`text-xs font-semibold uppercase tracking-wider ${ui.subtleText}`}>Status</div>
                  <div className={`mt-1 text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{data.status}</div>
                </div>
              </div>

              {(data.requestedAt || data.completedAt) && (
                <div className={`mt-4 text-sm ${ui.subtleText}`}>
                  {data.requestedAt && <div>Requested: {new Date(data.requestedAt).toLocaleString()}</div>}
                  {data.completedAt && <div>Completed: {new Date(data.completedAt).toLocaleString()}</div>}
                </div>
              )}

              {data.message && (
                <div className={`mt-4 text-sm ${isDarkMode ? 'text-white/80' : 'text-gray-800'}`}>{data.message}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
