import { authFetch } from './authFetch.js';

const LEAD_SEARCH_API = '/api/agent?op=lead-search';

export interface LeadSearchFilters {
    job_title?: string;
    location?: string;
    industry?: string;
    company_size?: string;
    company?: string;
    company_name?: string;
    domain?: string;
    company_domain?: string;
    keywords?: string;
    [key: string]: any;
}

export interface LeadSearchResponse {
    provider: 'wiza' | 'hunter';
    data: any;
    meta?: any;
}

export async function findBusinessLeads(
    filters: LeadSearchFilters,
    size: number = 10
): Promise<LeadSearchResponse> {
    const safeSize = Math.max(0, Math.min(size || 0, 30));

    const res = await authFetch(LEAD_SEARCH_API, {
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
        throw new Error(`Lead search failed (${res.status}): ${text}`);
    }

    return (await res.json()) as LeadSearchResponse;
}
