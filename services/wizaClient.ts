import { authFetch } from './authFetch.js';

const WIZA_API_ROUTE = '/api/wiza-prospect-search';

export interface WizaProspectSearchFilters {
  // This is intentionally loose so the research model can pass through
  // Wiza's filters structure directly (job_title, location, company_size, etc.).
  [key: string]: any;
}

export interface WizaProspectSearchResponse {
  status: {
    code: number;
    message: string;
  };
  data: {
    total: number;
    profiles: any[];
  };
}

export async function wizaProspectSearch(
  filters: WizaProspectSearchFilters,
  size: number = 10,
): Promise<WizaProspectSearchResponse> {
  const safeSize = Math.max(0, Math.min(size || 0, 30));

  const res = await authFetch(WIZA_API_ROUTE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      size: safeSize,
      filters: filters || {},
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Wiza prospects search failed (${res.status}): ${text}`);
  }

  return (await res.json()) as WizaProspectSearchResponse;
}
