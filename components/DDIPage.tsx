import React, { useMemo, useState } from 'react';
import { auth } from '../services/firebase';
import { authFetch } from '../services/authFetch';

interface DDIPageProps {
  isDarkMode: boolean;
}

export const DDIPage: React.FC<DDIPageProps> = ({ isDarkMode }) => {
  const user = auth.currentUser;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; confirmation_code: string } | null>(null);
  const [lookupCode, setLookupCode] = useState('');

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

  const goBack = () => {
    if (typeof window === 'undefined') return;
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const goToStatus = (code: string) => {
    const trimmed = (code || '').trim();
    if (!trimmed) return;
    if (typeof window === 'undefined') return;
    window.history.pushState({}, '', `/ddi/deletion?code=${encodeURIComponent(trimmed)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleDelete = async () => {
    if (!user) {
      setError('You must be signed in to request account deletion.');
      return;
    }

    if (!confirm('Request deletion of your account data? This cannot be undone.')) return;

    setIsSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await authFetch('/api/account-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to submit deletion request');
      }
      const url = String(data?.url || '').trim();
      const confirmation_code = String(data?.confirmation_code || '').trim();
      if (!url || !confirmation_code) {
        throw new Error('Deletion request response was missing required fields');
      }
      setResult({ url, confirmation_code });
    } catch (e: any) {
      setError(e?.message || 'Failed to submit deletion request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`min-h-screen ${ui.page}`}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div>
            <div className={`text-sm font-semibold uppercase tracking-wider ${ui.subtleText}`}>Account</div>
            <h1 className={`text-3xl sm:text-4xl font-semibold tracking-tight ${ui.heading}`}>Data & Deletion</h1>
          </div>
          <button
            type="button"
            onClick={goBack}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              isDarkMode ? 'bg-white/10 hover:bg-white/15 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
            }`}
          >
            Back
          </button>
        </div>

        <div className={`rounded-2xl sm:rounded-3xl p-6 ${ui.card}`}>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
            <div className="min-w-0">
              <h2 className={`text-lg font-semibold ${ui.heading}`}>Your account</h2>
              <div className={`mt-2 text-sm ${ui.subtleText}`}>
                <div className="truncate">Email: {user?.email || 'Unknown'}</div>
                <div className="truncate">User ID: {user?.uid || 'Unknown'}</div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:items-end">
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSubmitting}
                className={`px-4 py-2.5 rounded-full text-sm font-semibold transition-colors disabled:opacity-70 ${
                  isDarkMode
                    ? 'bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30'
                    : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                }`}
              >
                {isSubmitting ? 'Submitting…' : 'Request data deletion'}
              </button>
              <div className={`text-xs ${ui.subtleText} sm:text-right max-w-xs`}>
                This will request deletion of your stored account data.
              </div>
            </div>
          </div>

          {error && (
            <div className={`mt-5 p-3 rounded-xl text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {error}
            </div>
          )}

          {result && (
            <div className={`mt-5 p-4 rounded-2xl text-sm ${isDarkMode ? 'bg-white/5 border border-white/10' : 'bg-gray-50 border border-gray-200'}`}>
              <div className={`text-xs font-semibold uppercase tracking-wider ${ui.subtleText}`}>Deletion request received</div>
              <div className="mt-2">
                <div className="font-medium">Confirmation code</div>
                <div className={`mt-1 font-mono text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{result.confirmation_code}</div>
              </div>
              <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <button
                  type="button"
                  onClick={() => goToStatus(result.confirmation_code)}
                  className={`px-3 py-2 rounded-full text-xs font-semibold transition-colors ${
                    isDarkMode ? 'bg-[#0071e3] hover:bg-[#0077ed] text-white' : 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
                  }`}
                >
                  View status
                </button>
                <a
                  href={result.url}
                  className={`text-xs underline ${isDarkMode ? 'text-[#5ac8fa]' : 'text-blue-700'}`}
                >
                  Status link
                </a>
              </div>
            </div>
          )}
        </div>

        <div className={`mt-6 rounded-2xl sm:rounded-3xl p-6 ${ui.card}`}>
          <h2 className={`text-lg font-semibold ${ui.heading}`}>Check deletion request status</h2>
          <div className={`mt-2 text-sm ${ui.subtleText}`}>
            If you have a confirmation code (for example, from a Meta/Facebook callback), enter it here.
          </div>
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <input
              value={lookupCode}
              onChange={(e) => setLookupCode(e.target.value)}
              placeholder="Confirmation code"
              className={`flex-1 px-4 py-2.5 rounded-xl border text-sm outline-none ${
                isDarkMode
                  ? 'bg-[#0b0b0c] border-[#3d3d3f]/80 text-white placeholder:text-gray-500'
                  : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400'
              }`}
            />
            <button
              type="button"
              onClick={() => goToStatus(lookupCode)}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                isDarkMode ? 'bg-white/10 hover:bg-white/15 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
              }`}
            >
              Check
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
