import { GoogleGenAI } from '@google/genai';
import { requireAuth } from './_auth.js';
import {
  hunterDomainSearch,
  hunterDiscover,
  isHunterConfigured,
  buildContactTableFromHunter,
  HunterEmail,
} from './hunter-client.js';

type RequestBody = {
  prompt?: string;
  size?: number;
  listId?: number;
  userLocation?: { lat: number; lng: number; label?: string };
};

const DEFAULT_WIZA_FILTERS = {
  first_name: [],
  last_name: [],
  job_title: [],
  job_title_level: [],
  job_role: [],
  job_sub_role: [],
  location: {},
  skill: [],
  school: [],
  major: [],
  linkedin_slug: [],
  job_company: [],
  past_company: [],
  company_location: [],
  company_industry: [],
  company_size: [],
  revenue: [],
  company_type: [],
  company_summary: [],
  year_founded_start: '',
  year_founded_end: '',
} as const;

const WIZA_FILTERS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    filters: {
      type: 'object',
      properties: {
        first_name: { type: 'array', items: { type: 'string' } },
        last_name: { type: 'array', items: { type: 'string' } },
        job_title: { type: 'array', items: { type: 'string' } },
        job_title_level: { type: 'array', items: { type: 'string' } },
        job_role: { type: 'array', items: { type: 'string' } },
        job_sub_role: { type: 'array', items: { type: 'string' } },
        location: { type: 'object', additionalProperties: true },
        skill: { type: 'array', items: { type: 'string' } },
        school: { type: 'array', items: { type: 'string' } },
        major: { type: 'array', items: { type: 'string' } },
        linkedin_slug: { type: 'array', items: { type: 'string' } },
        job_company: { type: 'array', items: { type: 'string' } },
        past_company: { type: 'array', items: { type: 'string' } },
        company_location: { type: 'array', items: { type: 'string' } },
        company_industry: { type: 'array', items: { type: 'string' } },
        company_size: { type: 'array', items: { type: 'string' } },
        revenue: { type: 'array', items: { type: 'string' } },
        company_type: { type: 'array', items: { type: 'string' } },
        company_summary: { type: 'array', items: { type: 'string' } },
        year_founded_start: { type: 'string' },
        year_founded_end: { type: 'string' },
      },
      required: [
        'first_name',
        'last_name',
        'job_title',
        'job_title_level',
        'job_role',
        'job_sub_role',
        'location',
        'skill',
        'school',
        'major',
        'linkedin_slug',
        'job_company',
        'past_company',
        'company_location',
        'company_industry',
        'company_size',
        'revenue',
        'company_type',
        'company_summary',
        'year_founded_start',
        'year_founded_end',
      ],
      additionalProperties: true,
    },
  },
  required: ['filters'],
  additionalProperties: false,
} as const;

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

const extractFirstJsonObject = (text: string): string | null => {
  const s = (text || '').toString();
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
};

const safeArrayStrings = (value: any): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean);
};

const normalizeLocationHashes = (value: any, fallbackBucket: string): Array<{ v: string; b: string }> => {
  if (!Array.isArray(value)) return [];

  const out: Array<{ v: string; b: string }> = [];
  for (const item of value) {
    if (item && typeof item === 'object') {
      const v = typeof (item as any).v === 'string' ? (item as any).v.trim() : '';
      if (!v) continue;
      const b = typeof (item as any).b === 'string' ? (item as any).b.trim() : fallbackBucket;
      out.push({ v, b: b || fallbackBucket });
      continue;
    }

    const s = String(item || '').trim();
    if (!s) continue;
    out.push({ v: s, b: fallbackBucket });
  }

  return out;
};

const normalizeSimpleHashes = (value: any): Array<{ v: string }> => {
  if (!Array.isArray(value)) return [];
  return value.map((v) => ({ v: String(v || '').trim() })).filter((item) => item.v);
};

const normalizeWizaFilters = (raw: any): Record<string, any> => {
  const base: any = { ...DEFAULT_WIZA_FILTERS };
  if (!raw || typeof raw !== 'object') return base;

  const out: any = { ...base };
  out.first_name = safeArrayStrings(raw.first_name);
  out.last_name = safeArrayStrings(raw.last_name);
  out.job_title = normalizeSimpleHashes(raw.job_title);
  out.job_title_level = safeArrayStrings(raw.job_title_level);
  out.job_role = safeArrayStrings(raw.job_role);
  out.job_sub_role = safeArrayStrings(raw.job_sub_role);
  out.location = raw.location && typeof raw.location === 'object' ? raw.location : {};
  out.skill = safeArrayStrings(raw.skill);
  out.school = safeArrayStrings(raw.school);
  out.major = safeArrayStrings(raw.major);
  out.linkedin_slug = safeArrayStrings(raw.linkedin_slug);
  out.job_company = safeArrayStrings(raw.job_company);
  out.past_company = safeArrayStrings(raw.past_company);
  // Wiza expects company_location as an array of hashes, not strings.
  // Example: [{ v: 'city, state, country', b: 'city' }]
  out.company_location = normalizeLocationHashes(raw.company_location, 'city');
  out.company_industry = safeArrayStrings(raw.company_industry);
  out.company_size = safeArrayStrings(raw.company_size);
  out.revenue = safeArrayStrings(raw.revenue);
  out.company_type = safeArrayStrings(raw.company_type);
  out.company_summary = safeArrayStrings(raw.company_summary);
  out.year_founded_start = typeof raw.year_founded_start === 'string' ? raw.year_founded_start : '';
  out.year_founded_end = typeof raw.year_founded_end === 'string' ? raw.year_founded_end : '';

  return out;
};

const fallbackFiltersFromPrompt = (prompt: string): Record<string, any> => {
  const base: any = { ...DEFAULT_WIZA_FILTERS };
  const text = (prompt || '').toLowerCase();

  const locationMatch = prompt.match(/\b(in|at|near|around)\s+([A-Za-z .,'-]{2,})$/i);
  const torontoMatch = /\btoronto\b/i.test(prompt);
  if (locationMatch?.[2]) {
    base.company_location = [{ v: String(locationMatch[2]).trim(), b: 'city' }];
  } else if (torontoMatch) {
    base.company_location = [{ v: 'Toronto', b: 'city' }];
  }

  if (/\bresearch\b|\br&d\b|\bresearch and development\b/i.test(text)) {
    base.company_summary = ['research and development', 'R&D'];
  }

  return base;
};

type WizaProspectSearchResponse = {
  status?: {
    code: number;
    message: string;
  };
  data?: {
    total: number;
    profiles: any[];
  };
  [key: string]: any;
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
    total?: number;
    returned?: number;
    filters?: Record<string, any>;
    listId?: number;
    listStatus?: string;
  };
};

const WIZA_BASE_URL = 'https://wiza.co/api';

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

const normalizeString = (value: any): string => {
  const s = (value ?? '').toString().trim();
  return s;
};

const pickFirstString = (...candidates: any[]): string => {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    if (Array.isArray(candidate)) {
      for (const inner of candidate) {
        const s = normalizeString(inner);
        if (s) return s;
      }
      continue;
    }
    const s = normalizeString(candidate);
    if (s) return s;
  }
  return '';
};

const extractEmail = (profile: any): string => {
  return pickFirstString(
    profile?.email,
    profile?.work_email,
    profile?.email1,
    profile?.email_primary,
    profile?.contact?.email,
    profile?.contact?.email1,
    profile?.contact_details?.email,
    profile?.contactDetails?.email,
    profile?.emails,
    profile?.contact_details?.emails,
    profile?.contactDetails?.emails,
  );
};

const extractCompanyLinkedIn = (profile: any): string => {
  return pickFirstString(
    profile?.company_linkedin,
    profile?.companyLinkedin,
    profile?.company?.linkedin,
    profile?.company?.linkedin_url,
  );
};

const extractPhone = (profile: any): string => {
  return pickFirstString(
    profile?.phone,
    profile?.phone_number,
    profile?.phone_number1,
    profile?.phone_number2,
    profile?.mobile_phone1,
    profile?.other_phone1,
    profile?.contact?.phone,
    profile?.contact_details?.phone,
    profile?.contact_details?.phone_number1,
    profile?.contactDetails?.phone,
    profile?.phones,
    profile?.phone_numbers,
  );
};

const extractLinkedIn = (profile: any): string => {
  return pickFirstString(
    profile?.linkedin,
    profile?.linkedin_url,
    profile?.linkedinUrl,
    profile?.url,
    profile?.profile_url,
    profile?.profileUrl,
  );
};

const buildTableFromContacts = (prompt: string, contacts: any[]): TableSpec => {
  const columns = [
    'Full Name',
    'Title',
    'Company',
    'Email',
    'Email Status',
    'Phone',
    'Location',
    'LinkedIn',
    'Company Domain',
    'Company LinkedIn',
  ];

  const rows = (contacts || []).map((profile: any) => {
    const fullName = pickFirstString(profile?.full_name, profile?.fullName, profile?.name, profile?.fullName);
    const title = pickFirstString(profile?.title, profile?.job_title, profile?.jobTitle, profile?.headline);
    const company = pickFirstString(profile?.company, profile?.company_name, profile?.companyName, profile?.organization);
    const email = extractEmail(profile);
    const emailStatus = pickFirstString(profile?.email_status, profile?.emailStatus, profile?.email_verification_status);
    const phone = extractPhone(profile);
    const location = pickFirstString(profile?.location, profile?.city, profile?.region, profile?.company_location);
    const linkedin = extractLinkedIn(profile);
    const companyDomain = pickFirstString(profile?.company_domain, profile?.domain, profile?.companyDomain);
    const companyLinkedIn = extractCompanyLinkedIn(profile);

    return [
      fullName,
      title,
      company,
      email,
      emailStatus,
      phone,
      location,
      linkedin,
      companyDomain,
      companyLinkedIn,
    ].map((v) => (v == null ? '' : String(v)));
  });

  return {
    title: 'Wiza Contacts',
    description: `Contacts generated from Wiza for: ${prompt}`,
    columns,
    rows,
  };
};

const buildWizaFiltersViaGemini = async (prompt: string, userLocation?: { lat: number; lng: number }): Promise<Record<string, any>> => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    return fallbackFiltersFromPrompt(prompt);
  }

  const client = new GoogleGenAI({ apiKey });
  let promptText = `Convert the user request into Wiza Prospect Search filters for POST /api/prospects/search.\n\nUser request: ${prompt}`;

  if (userLocation) {
    promptText += `\n\nContext: The user is located at ${userLocation.lat}, ${userLocation.lng}. Use this location for filtering ONLY if the user's request implies "near me" or "local".`;
  }

  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: promptText,
        },
      ],
    },
  ];

  try {
    const response = await callGeminiWithFallback(client, {
      contents,
      config: {
        temperature: 0.2,
        maxOutputTokens: 600,
        responseMimeType: 'application/json',
        responseJsonSchema: WIZA_FILTERS_JSON_SCHEMA as any,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });

    const text = (response.text || '').trim();
    let parsed: any;

    try {
      parsed = JSON.parse(text);
    } catch {
      const extracted = extractFirstJsonObject(text);
      if (!extracted) {
        return fallbackFiltersFromPrompt(prompt);
      }
      const cleaned = extracted.replace(/,\s*([}\]])/g, '$1');
      parsed = JSON.parse(cleaned);
    }

    const filters = parsed?.filters;
    return normalizeWizaFilters(filters);
  } catch (e: any) {
    const status = e?.status;
    const message = (e?.message || '').toString();
    if (status === 429 || /RESOURCE_EXHAUSTED/i.test(message) || /quota/i.test(message)) {
      return fallbackFiltersFromPrompt(prompt);
    }
    // For other errors (that exhausted fallback), return fallback filters
    return fallbackFiltersFromPrompt(prompt);
  }
};

const isListComplete = (status: string) => {
  const s = (status || '').toLowerCase();
  return ['complete', 'completed', 'finished', 'done', 'success'].includes(s);
};

const isListFailed = (status: string) => {
  const s = (status || '').toLowerCase();
  return ['failed', 'error', 'canceled', 'cancelled'].includes(s);
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============ Hunter Fallback ============

/**
 * Extract domain from prompt using Gemini
 */
const extractDomainFromPrompt = async (prompt: string): Promise<string | null> => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) return null;

  const client = new GoogleGenAI({ apiKey });
  try {
    const response = await callGeminiWithFallback(client, {
      contents: [{
        role: 'user',
        parts: [{
          text: `Extract the company domain from this request. Return ONLY the domain (e.g., "stripe.com") or "none" if no specific company is mentioned.\n\nRequest: ${prompt}`,
        }],
      }],
      config: {
        temperature: 0.1,
        maxOutputTokens: 50,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const text = (response.text || '').trim().toLowerCase();
    if (text === 'none' || !text || text.length > 100) return null;

    // Basic domain validation
    if (/^[a-z0-9][a-z0-9-]*\.[a-z]{2,}$/i.test(text)) {
      return text;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Try Hunter Domain Search as fallback
 */
const tryHunterFallback = async (
  prompt: string,
  size: number,
): Promise<{ tableSpec: TableSpec; source: 'hunter' } | null> => {
  if (!isHunterConfigured()) {
    console.log('[Hunter Fallback] Hunter API key not configured');
    return null;
  }

  try {
    // Try to extract a domain from the prompt
    const domain = await extractDomainFromPrompt(prompt);

    if (domain) {
      console.log(`[Hunter Fallback] Trying domain search for: ${domain}`);
      const result = await hunterDomainSearch(domain, { limit: Math.min(size, 100) });

      if (result.data?.emails?.length > 0) {
        const tableSpec = buildContactTableFromHunter(
          domain,
          result.data.emails,
          result.data.organization
        );
        return { tableSpec, source: 'hunter' };
      }
    }

    // If no domain found, try Hunter Discover for company search
    console.log('[Hunter Fallback] Trying Discover API with natural language');
    const discoverResult = await hunterDiscover({
      query: prompt,
      limit: Math.min(size, 100),
    });

    if (discoverResult.data?.length > 0) {
      // Get emails from the first few companies found
      const allEmails: HunterEmail[] = [];
      const seenDomains = new Set<string>();

      for (const company of discoverResult.data.slice(0, 5)) {
        if (seenDomains.has(company.domain)) continue;
        seenDomains.add(company.domain);

        try {
          const domainResult = await hunterDomainSearch(company.domain, { limit: Math.ceil(size / 5) });
          if (domainResult.data?.emails) {
            // Add organization to each email for context
            for (const email of domainResult.data.emails) {
              allEmails.push(email);
              if (allEmails.length >= size) break;
            }
          }
        } catch {
          // Skip failed domains
        }

        if (allEmails.length >= size) break;
      }

      if (allEmails.length > 0) {
        const tableSpec = buildContactTableFromHunter(
          'Multiple Companies',
          allEmails,
          null
        );
        tableSpec.title = 'Hunter Contacts';
        tableSpec.description = `Contacts found via Hunter for: ${prompt}`;
        return { tableSpec, source: 'hunter' };
      }
    }

    console.log('[Hunter Fallback] No results from Hunter');
    return null;
  } catch (e: any) {
    console.error('[Hunter Fallback] Error:', e?.message || e);
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
      console.log('[wiza-generate-table] No Wiza API key, trying Hunter as primary');
      const body = (await request.json()) as RequestBody;
      const prompt = (body.prompt || '').toString().trim();
      if (!prompt) return error('Missing prompt', 400);
      const sizeRaw = typeof body.size === 'number' ? body.size : 10;
      const safeSize = Math.max(1, Math.min(sizeRaw || 10, 30));

      const hunterResult = await tryHunterFallback(prompt, safeSize);
      if (hunterResult) {
        return json({ tableSpec: hunterResult.tableSpec, source: 'hunter' }, 200);
      }
      return error('Server configuration error: Missing WIZA_API_KEY and Hunter fallback failed', 500);
    }

    try {
      const body = (await request.json()) as RequestBody;
      const prompt = (body.prompt || '').toString().trim();
      const listId = typeof body.listId === 'number' ? body.listId : undefined;

      const sizeRaw = typeof body.size === 'number' ? body.size : 10;
      const safeSize = Math.max(1, Math.min(sizeRaw || 10, 30));

      let filters: Record<string, any> | undefined;
      let activeListId: number | undefined = listId;

      if (!activeListId) {
        if (!prompt) return error('Missing prompt', 400);
        filters = await buildWizaFiltersViaGemini(prompt, body.userLocation);

        const createRes = await fetch(`${WIZA_BASE_URL}/prospects/create_prospect_list`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${wizaApiKey}`,
          },
          body: JSON.stringify({
            list: {
              name: `Researchr: ${prompt}`.slice(0, 120),
              max_profiles: safeSize,
              enrichment_level: 'partial',
              email_options: {
                accept_work: true,
                accept_personal: true,
                accept_generic: true,
              },
            },
            filters,
          }),
        });

        if (!createRes.ok) {
          const text = await createRes.text().catch(() => '');
          throw new Error(`Wiza create_prospect_list failed (${createRes.status}): ${text}`);
        }

        const created = await createRes.json().catch(() => ({}));
        const createdId = Number(created?.data?.id);
        if (!createdId || Number.isNaN(createdId)) {
          throw new Error('Wiza create_prospect_list returned no list id');
        }
        activeListId = createdId;
      }

      const pollAttempts = 18;
      let listStatus = '';
      let listPayload: any = null;
      for (let i = 0; i < pollAttempts; i++) {
        const listRes = await fetch(`${WIZA_BASE_URL}/lists/${encodeURIComponent(String(activeListId))}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${wizaApiKey}`,
          },
        });

        if (!listRes.ok) {
          const text = await listRes.text().catch(() => '');
          throw new Error(`Wiza list status failed (${listRes.status}): ${text}`);
        }

        listPayload = await listRes.json().catch(() => ({}));
        listStatus = (listPayload?.data?.status || '').toString();

        if (isListFailed(listStatus)) {
          return error(`Wiza list failed (${listStatus || 'unknown'})`, 500, listPayload);
        }
        if (isListComplete(listStatus)) {
          break;
        }

        await sleep(1500);
      }

      if (!isListComplete(listStatus)) {
        return json(
          {
            tableSpec: {
              title: 'Wiza Contacts',
              description: 'Wiza is still building the list. Please retry shortly.',
              columns: ['Status', 'List ID'],
              rows: [[listStatus || 'queued', String(activeListId)]],
            },
            wiza: {
              listId: activeListId,
              listStatus: listStatus || 'queued',
            },
          } satisfies ResponseBody,
          202,
        );
      }

      const contactsRes = await fetch(
        `${WIZA_BASE_URL}/lists/${encodeURIComponent(String(activeListId))}/contacts?segment=people`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${wizaApiKey}`,
          },
        },
      );

      if (!contactsRes.ok) {
        const text = await contactsRes.text().catch(() => '');
        return error(`Wiza list contacts failed (${contactsRes.status})`, contactsRes.status, text);
      }

      const contactsPayload = await contactsRes.json().catch(() => ({}));
      const contacts = Array.isArray(contactsPayload?.data) ? contactsPayload.data : [];

      // If Wiza returned 0 contacts, try Hunter as fallback
      if (contacts.length === 0) {
        console.log('[wiza-generate-table] Wiza returned 0 contacts, trying Hunter fallback');
        const hunterResult = await tryHunterFallback(prompt, safeSize);
        if (hunterResult) {
          return json({ tableSpec: hunterResult.tableSpec, source: 'hunter' }, 200);
        }
      }

      const finalPrompt = prompt || (listPayload?.data?.name || '').toString() || 'contacts';
      const tableSpec = buildTableFromContacts(finalPrompt, contacts);
      return json(
        {
          tableSpec,
          wiza: {
            total: contacts.length,
            returned: contacts.length,
            filters,
            listId: activeListId,
            listStatus,
          },
        } satisfies ResponseBody,
        200,
      );
    } catch (e: any) {
      console.error('[api/wiza-generate-table] Error:', e);

      // Try Hunter as fallback on Wiza error
      try {
        const body = await request.clone().json().catch(() => ({})) as RequestBody;
        const prompt = (body?.prompt || '').toString().trim();
        const sizeRaw = typeof body?.size === 'number' ? body.size : 10;
        const safeSize = Math.max(1, Math.min(sizeRaw || 10, 30));

        if (prompt) {
          console.log('[wiza-generate-table] Wiza failed, trying Hunter fallback');
          const hunterResult = await tryHunterFallback(prompt, safeSize);
          if (hunterResult) {
            return json({ tableSpec: hunterResult.tableSpec, source: 'hunter' }, 200);
          }
        }
      } catch (hunterErr) {
        console.error('[wiza-generate-table] Hunter fallback also failed:', hunterErr);
      }

      return error(e?.message || 'Failed to generate table', 500);
    }
  },
};
