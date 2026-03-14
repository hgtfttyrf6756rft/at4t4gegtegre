import { requireAuth } from './_auth.js';
import { hunterDiscover, hunterDomainSearch } from './hunter-client.js';

type RequestBody = {
    filters?: Record<string, any>;
    size?: number;
};

// Unified response format
type LeadSearchResponse = {
    provider: 'wiza' | 'hunter';
    data: any; // Normalized data or raw provider data
    meta?: any;
};

const WIZA_BASE_URL = 'https://wiza.co/api';

const errorResponse = (message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

export async function POST(request: Request) {
    try {
        const authResult = await requireAuth(request);
        if (authResult instanceof Response) {
            return authResult;
        }

        const wizaKey = process.env.WIZA_API_KEY;
        const hunterKey = process.env.HUNTER_API_KEY;

        if (!wizaKey && !hunterKey) {
            return errorResponse('Server configuration error: Missing API keys for Wiza or Hunter', 500);
        }

        const body = (await request.json()) as RequestBody;
        const sizeRaw = typeof body.size === 'number' ? body.size : 10;
        const safeSize = Math.max(0, Math.min(sizeRaw || 0, 30));
        const filters = body.filters || {};

        // Log intent
        console.log(`[api/lead-search] Search request. Filters:`, JSON.stringify(filters));

        // ==========================================
        // STRATEGY 1: Wiza Prospect Search (People)
        // ==========================================
        let wizaSuccess = false;
        let wizaData: any = null;

        if (wizaKey) {
            try {
                console.log('[api/lead-search] Attempting Wiza search...');
                const res = await fetch(`${WIZA_BASE_URL}/prospects/search`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${wizaKey}`,
                    },
                    body: JSON.stringify({
                        size: safeSize,
                        filters,
                    }),
                });

                if (res.ok) {
                    const json = await res.json();
                    if (json.data && json.data.profiles && json.data.profiles.length > 0) {
                        wizaSuccess = true;
                        wizaData = json;
                        console.log(`[api/lead-search] Wiza found ${json.data.profiles.length} profiles.`);
                    } else {
                        console.log('[api/lead-search] Wiza returned 0 profiles.');
                    }
                } else {
                    console.warn(`[api/lead-search] Wiza API error: ${res.status}`);
                }
            } catch (e) {
                console.error('[api/lead-search] Wiza attempt failed:', e);
            }
        }

        if (wizaSuccess) {
            return new Response(JSON.stringify({
                provider: 'wiza',
                data: wizaData.data
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ==========================================
        // STRATEGY 2: Hunter Fallback
        // ==========================================
        if (hunterKey) {
            console.log('[api/lead-search] Falling back to Hunter...');

            // Determine if this is a Domain Search (specific company) or Discovery (generic)
            const domain = filters.domain || filters.company_domain;
            const company = filters.company || filters.company_name;

            // Case A: Specific Company/Domain -> Domain Search (find people)
            if (domain || company) {
                try {
                    // If we only have company name, we might need to "guess" domain or just fail. 
                    // Hunter Domain Search requires a domain.
                    // Using just company name for domain search is flaky but sometimes works if it's a domain-like string?
                    const targetDomain = domain || company;
                    // Simple heuristic: if it has a dot, treat as domain.
                    if (targetDomain.includes('.')) {
                        console.log(`[api/lead-search] Hunter Domain Search for: ${targetDomain}`);
                        const hunterRes = await hunterDomainSearch(targetDomain, { limit: safeSize });

                        if (hunterRes.data && hunterRes.data.emails && hunterRes.data.emails.length > 0) {
                            return new Response(JSON.stringify({
                                provider: 'hunter',
                                data: {
                                    // Normalize to look somewhat like Wiza profiles if possible, or just raw
                                    profiles: hunterRes.data.emails,
                                    total: hunterRes.meta.results
                                },
                                meta: { type: 'domain_search', domain: targetDomain }
                            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                        }
                    }
                } catch (e) {
                    console.error('[api/lead-search] Hunter Domain Search failed:', e);
                }
            }

            // Case B: Generic Filters -> Company Discovery
            // Map Wiza-like filters to Hunter Discover filters
            // Wiza: job_title, location, industry, company_size
            // Hunter Discover: industry, headquarters_location, company_type, etc.
            try {
                console.log('[api/lead-search] Hunter Discovery for generic criteria...');
                const discoverFilters: any = { limit: safeSize };

                if (filters.industry) {
                    discoverFilters.industry = { include: [filters.industry] };
                }
                if (filters.location || filters.country) {
                    // Hunter expects structured location. This is best-effort.
                    const loc = filters.location || filters.country;
                    // Naive mapping: passed as query string maybe? Hunter Discover doesn't have a generic query for location mixed with others well.
                    // But it has `headquarters_location` object.
                    // We'll try to just pass the location string as a keyword query if nothing else works, 
                    // or try to map if it looks like a country. 
                    // For now, let's use the `keywords` filter for general terms
                }

                // If we have job titles, Hunter Discover CANNOT filter by job title of employees. 
                // It finds COMPANIES.
                // But this is better than nothing? 
                // Or maybe we use the "keywords" filter for everything.

                // Construct a query keyword list from filters
                const keywords: string[] = [];
                if (filters.job_title) keywords.push(filters.job_title);
                if (filters.keywords) keywords.push(filters.keywords);
                if (filters.location) keywords.push(filters.location); // Hunter keywords matches on location text too sometimes?
                // Actually Hunter defaults to "query" for company name/website.

                // Let's rely on simple industry/keyword mapping if possible
                if (keywords.length > 0) {
                    discoverFilters.keywords = { include: keywords };
                }

                const hunterRes = await hunterDiscover(discoverFilters);

                if (hunterRes.data && hunterRes.data.length > 0) {
                    return new Response(JSON.stringify({
                        provider: 'hunter',
                        data: {
                            companies: hunterRes.data,
                            total: hunterRes.meta.results
                        },
                        meta: { type: 'discovery' }
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }

            } catch (e) {
                console.error('[api/lead-search] Hunter Discovery failed:', e);
            }
        }

        return errorResponse('No leads found (Wiza returned 0, Hunter fallback failed or returned 0)', 404);

    } catch (error: any) {
        console.error('[api/lead-search] Error:', error);
        return errorResponse(error?.message || 'Failed to search leads', 500);
    }
}

export default {
    fetch: POST,
};
