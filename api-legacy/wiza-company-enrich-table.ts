import { GoogleGenAI } from '@google/genai';
import { requireAuth } from './_auth.js';
import {
  hunterCompanyEnrichment,
  hunterDiscover,
  isHunterConfigured,
  buildCompanyTableFromHunter,
  HunterCompanyData,
} from './hunter-client.js';

type RequestBody = {
  prompt?: string;
  size?: number;
};

type TableSpec = {
  title: string;
  description: string;
  columns: string[];
  rows: string[][];
};

type ResponseBody = {
  tableSpec: TableSpec;
  wiza?: {
    requested?: number;
    enriched?: number;
  };
};

const WIZA_BASE_URL = 'https://wiza.co/api';

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

/**
 * Call Gemini with fallback models to handle 503/Overloaded errors
 */
const callGeminiWithFallback = async (client: GoogleGenAI, params: any) => {
  const models = ['gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
  let lastError;

  for (const model of models) {
    try {
      return await client.models.generateContent({
        ...params,
        model,
      });
    } catch (e: any) {
      lastError = e;
      const isOverloaded = e.status === 503 || e.message?.includes('overloaded') || e.code === 503;
      if (isOverloaded) {
        console.log(`[Gemini Fallback] Model ${model} overloaded, trying next...`);
        continue;
      }
      throw e; // usage error or other fatal error
    }
  }
  throw lastError;
};

const pickFirstString = (...candidates: any[]): string => {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    if (Array.isArray(candidate)) {
      for (const inner of candidate) {
        const s = String(inner ?? '').trim();
        if (s) return s;
      }
      continue;
    }
    const s = String(candidate ?? '').trim();
    if (s) return s;
  }
  return '';
};

const buildCompanyTable = (prompt: string, companies: any[]): TableSpec => {
  const columns = [
    'Company',
    'Domain',
    'Industry',
    'Company Size',
    'Size Range',
    'Type',
    'Location',
    'Description',
    'LinkedIn',
    'Twitter',
    'Facebook',
    'Founded',
    'Revenue Range',
  ];

  const rows = (companies || []).map((c: any) => {
    const companyName = pickFirstString(c?.company_name, c?.companyName, c?.name);
    const domain = pickFirstString(c?.company_domain, c?.domain);
    const industry = pickFirstString(c?.company_industry, c?.industry);
    const size = pickFirstString(c?.company_size, c?.size);
    const sizeRange = pickFirstString(c?.company_size_range, c?.size_range);
    const type = pickFirstString(c?.company_type, c?.type);
    const location = pickFirstString(c?.company_location, c?.location, c?.company_country);
    const description = pickFirstString(c?.company_description, c?.description);
    const linkedin = pickFirstString(c?.company_linkedin, c?.linkedin);
    const twitter = pickFirstString(c?.company_twitter, c?.twitter);
    const facebook = pickFirstString(c?.company_facebook, c?.facebook);
    const founded = pickFirstString(c?.company_founded, c?.founded);
    const revenueRange = pickFirstString(c?.company_revenue_range, c?.company_revenue, c?.revenue_range);

    return [
      companyName,
      domain,
      industry,
      size,
      sizeRange,
      type,
      location,
      description,
      linkedin,
      twitter,
      facebook,
      founded,
      revenueRange,
    ].map((v) => (v == null ? '' : String(v)));
  });

  return {
    title: 'Wiza Companies',
    description: `Companies enriched from Wiza for: ${prompt}`,
    columns,
    rows,
  };
};

const extractCompaniesViaGemini = async (prompt: string, size: number): Promise<string[]> => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    return [];
  }

  const client = new GoogleGenAI({ apiKey });
  const schema = {
    type: 'object',
    properties: {
      companies: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['companies'],
    additionalProperties: false,
  } as const;

  const response = await callGeminiWithFallback(client, {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Extract up to ${size} company names from the user request.\n\nReturn JSON only.\n\nUser request:\n${prompt}`,
          },
        ],
      },
    ],
    config: {
      temperature: 0.2,
      maxOutputTokens: 300,
      responseMimeType: 'application/json',
      responseJsonSchema: schema as any,
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  });

  const text = response.text?.trim() || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]);
  const companies = Array.isArray(parsed?.companies) ? parsed.companies : [];
  return companies.map((c: any) => String(c || '').trim()).filter(Boolean).slice(0, size);
};

/**
 * Extract company domains from prompt using Gemini
 */
const extractCompanyDomainsViaGemini = async (prompt: string, size: number): Promise<string[]> => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) return [];

  const client = new GoogleGenAI({ apiKey });
  const schema = {
    type: 'object',
    properties: {
      domains: { type: 'array', items: { type: 'string' } },
    },
    required: ['domains'],
    additionalProperties: false,
  } as const;

  try {
    const response = await callGeminiWithFallback(client, {
      contents: [{
        role: 'user',
        parts: [{
          text: `Extract up to ${size} company domains from the user request. Return domains like "stripe.com", "google.com". Return JSON only.\n\nUser request:\n${prompt}`,
        }],
      }],
      config: {
        temperature: 0.2,
        maxOutputTokens: 300,
        responseMimeType: 'application/json',
        responseJsonSchema: schema as any,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    const domains = Array.isArray(parsed?.domains) ? parsed.domains : [];
    return domains.map((d: any) => String(d || '').trim().toLowerCase()).filter(Boolean).slice(0, size);
  } catch {
    return [];
  }
};

/**
 * Extract Hunter Discover filters from prompt using Gemini
 */
const extractHunterDiscoverFilters = async (prompt: string): Promise<any> => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) return {};

  const client = new GoogleGenAI({ apiKey });
  const schema = {
    type: 'object',
    properties: {
      industry: { type: 'string', description: 'Canonical Industry name (e.g. "Marketing and Advertising", "Information Technology and Services"). PREFER KEYWORDS if unsure.' },
      city: { type: 'string', description: 'City name (e.g., "Toronto")' },
      country: { type: 'string', description: '2-letter ISO country code (e.g. "US", "CA", "GB"). REQUIRED if city is present. Infer if missing (e.g. Toronto -> CA).' },
      keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords describing the company' },
    },
    additionalProperties: false,
  } as const;

  try {
    const response = await callGeminiWithFallback(client, {
      contents: [{
        role: 'user',
        parts: [{
          text: `Extract company search filters from the request. 
          1. If a CITY is mentioned, you MUST provide the 2-letter ISO COUNTRY code (e.g. Toronto -> CA).
          2. INDUSTRY field is strict. "Marketing" is INVALID. Use "Marketing and Advertising". If unsure, use KEYWORDS instead.
          3. Prefer KEYWORDS for niche topics.
          
          User request:\n${prompt}`,
        }],
      }],
      config: {
        temperature: 0.1,
        maxOutputTokens: 300,
        responseMimeType: 'application/json',
        responseJsonSchema: schema as any,
      },
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  }
};

/**
 * Try Hunter Company Enrichment as fallback
 */
const tryHunterCompanyFallback = async (
  prompt: string,
  companyNames: string[],
  size?: number,
): Promise<{ tableSpec: TableSpec; source: 'hunter' } | null> => {
  if (!isHunterConfigured()) {
    console.log('[Hunter Company Fallback] Hunter API key not configured');
    return null;
  }

  try {
    const enrichedCompanies: HunterCompanyData[] = [];

    // First try extracting domains directly
    const domains = await extractCompanyDomainsViaGemini(prompt, companyNames.length);

    for (const domain of domains) {
      try {
        const result = await hunterCompanyEnrichment(domain);
        if (result.data) {
          enrichedCompanies.push(result.data);
        }
      } catch {
        // Skip failed enrichments
      }
    }

    // If no domains found, try Hunter Discover
    if (enrichedCompanies.length === 0) {
      console.log('[Hunter Company Fallback] Trying Discover API');

      // Extract structured filters for Hunter Discover
      const filters = await extractHunterDiscoverFilters(prompt);
      console.log('[Hunter Company Fallback] Extracted filters:', filters);

      const discoverParams: any = {};

      if (filters.industry) discoverParams.industry = { include: [filters.industry] };
      if (filters.city || filters.country) {
        discoverParams.headquarters_location = { include: [] };
        const locationObj: any = {};
        if (filters.city) locationObj.city = filters.city;
        if (filters.country) locationObj.country = filters.country;
        discoverParams.headquarters_location.include.push(locationObj);
      }
      if (filters.keywords?.length) discoverParams.keywords = { include: filters.keywords };

      // If no specific filters extracted, fallback to naive keyword search if query param is supported, 
      // otherwise this might still fail but better than nothing.
      if (Object.keys(discoverParams).length === 1) { // only limit is set
        // If we couldn't parse filters, maybe try using the whole prompt as keyword?
        // But Hunter keywords are specific. Let's try to pass the first few words or key nouns.
      }

      const discoverResult = await hunterDiscover(discoverParams);

      // Manual limit since Free plan restricts API limit parameter
      const candidates = (discoverResult.data || []).slice(0, size || 20);

      for (const company of candidates) {
        try {
          const result = await hunterCompanyEnrichment(company.domain);
          if (result.data) {
            enrichedCompanies.push(result.data);
          } else {
            throw new Error('No data');
          }
        } catch {
          // Fallback to basic data if enrichment fails
          console.warn(`[Hunter Company Fallback] Enrichment failed for ${company.domain}, using basic info.`);
          enrichedCompanies.push({
            name: company.organization || company.domain,
            domain: company.domain,
            description: 'No detailed description available.',
            site: { emailAddresses: [], phoneNumbers: [] },
            linkedin: null,
            twitter: null,
            facebook: null,
            // Add other required fields if missing from partial data
            id: 'fallback-' + Math.random(),
            legalName: null,
            foundedYear: null,
            location: null,
            geo: null,
            logo: null,
            type: null,
            company_type: null,
            phone: null,
            category: null,
            metrics: null,
            tech: [],
            techCategories: []

          });
        }
      }
    }

    if (enrichedCompanies.length > 0) {
      const tableSpec = buildCompanyTableFromHunter(prompt, enrichedCompanies);
      return { tableSpec, source: 'hunter' };
    }

    console.log('[Hunter Company Fallback] No results from Hunter');
    return null;
  } catch (e: any) {
    console.error('[Hunter Company Fallback] Error:', e?.message || e);
    return null;
  }
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return error('Method not allowed', 405);
    }

    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    const wizaApiKey = process.env.WIZA_API_KEY;

    // If Wiza API key is missing, try Hunter as primary
    if (!wizaApiKey) {
      console.log('[wiza-company-enrich-table] No Wiza API key, trying Hunter as primary');
      const body = (await request.json()) as RequestBody;
      const prompt = (body.prompt || '').toString().trim();
      if (!prompt) return error('Missing prompt', 400);
      const sizeRaw = typeof body.size === 'number' ? body.size : 10;
      const safeSize = Math.max(1, Math.min(sizeRaw || 10, 15));

      const names = await extractCompaniesViaGemini(prompt, safeSize);
      const hunterResult = await tryHunterCompanyFallback(prompt, names, safeSize);
      if (hunterResult) {
        return json({ tableSpec: hunterResult.tableSpec, source: 'hunter' }, 200);
      }
      return error('Server configuration error: Missing WIZA_API_KEY and Hunter fallback failed', 500);
    }

    try {
      const body = (await request.json()) as RequestBody;
      const prompt = (body.prompt || '').toString().trim();
      if (!prompt) return error('Missing prompt', 400);

      const sizeRaw = typeof body.size === 'number' ? body.size : 10;
      const safeSize = Math.max(1, Math.min(sizeRaw || 10, 15));

      const names = await extractCompaniesViaGemini(prompt, safeSize);
      if (!names.length) {
        console.warn('[wiza-company-enrich-table] Could not extract specific company names. Will try discovery fallback.');
      }

      const enriched: any[] = [];
      for (const name of names) {
        const res = await fetch(`${WIZA_BASE_URL}/company_enrichments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${wizaApiKey}`,
          },
          body: JSON.stringify({ company_name: name }),
        });

        if (res.status === 404) {
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.warn(`[wiza-company-enrich-table] Wiza request failed for ${name}: ${res.status} ${text}`);
          // Don't return error immediately, break so we can try fallback if no results
          break;
        }

        const data = await res.json().catch(() => ({}));
        const payload = data?.data || data;
        if (payload && typeof payload === 'object') {
          enriched.push(payload);
        }
      }

      // If Wiza returned 0 enriched results, try Hunter as fallback
      if (enriched.length === 0) {
        console.log('[wiza-company-enrich-table] Wiza returned 0 results, trying Hunter fallback');
        const hunterResult = await tryHunterCompanyFallback(prompt, names, safeSize);
        if (hunterResult) {
          return json({ tableSpec: hunterResult.tableSpec, source: 'hunter' }, 200);
        }
      }

      const tableSpec = buildCompanyTable(prompt, enriched);
      const responseBody: ResponseBody = {
        tableSpec,
        wiza: {
          requested: names.length,
          enriched: enriched.length,
        },
      };

      return json(responseBody, 200);
    } catch (e: any) {
      console.error('[api/wiza-company-enrich-table] Error:', e);

      // Try Hunter as fallback on Wiza error
      try {
        const body = await request.clone().json().catch(() => ({})) as RequestBody;
        const prompt = (body?.prompt || '').toString().trim();
        const sizeRaw = typeof body?.size === 'number' ? body.size : 10;
        const safeSize = Math.max(1, Math.min(sizeRaw || 10, 15));

        if (prompt) {
          console.log('[wiza-company-enrich-table] Wiza failed, trying Hunter fallback');
          const names = await extractCompaniesViaGemini(prompt, safeSize);
          const hunterResult = await tryHunterCompanyFallback(prompt, names);
          if (hunterResult) {
            return json({ tableSpec: hunterResult.tableSpec, source: 'hunter' }, 200);
          }
        }
      } catch (hunterErr) {
        console.error('[wiza-company-enrich-table] Hunter fallback also failed:', hunterErr);
      }

      return error(e?.message || 'Failed to enrich companies', 500);
    }
  },
};
