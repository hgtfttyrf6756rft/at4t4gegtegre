/**
 * Hunter API Client
 * Provides fallback methods for Wiza API integration
 * https://api.hunter.io/v2/
 */

const HUNTER_BASE_URL = 'https://api.hunter.io/v2';

// ============ Types ============

export interface HunterEmail {
    value: string;
    type: 'personal' | 'generic';
    confidence: number;
    first_name: string | null;
    last_name: string | null;
    position: string | null;
    seniority: string | null;
    department: string | null;
    linkedin: string | null;
    twitter: string | null;
    phone_number: string | null;
    verification: {
        date: string | null;
        status: 'valid' | 'accept_all' | 'unknown' | null;
    } | null;
    sources: Array<{
        domain: string;
        uri: string;
        extracted_on: string;
        last_seen_on: string;
        still_on_page: boolean;
    }>;
}

export interface HunterDomainSearchResponse {
    data: {
        domain: string;
        disposable: boolean;
        webmail: boolean;
        accept_all: boolean;
        pattern: string | null;
        organization: string | null;
        emails: HunterEmail[];
    };
    meta: {
        results: number;
        limit: number;
        offset: number;
    };
}

export interface HunterEmailFinderResponse {
    data: {
        first_name: string;
        last_name: string;
        email: string;
        score: number;
        domain: string;
        accept_all: boolean;
        position: string | null;
        twitter: string | null;
        linkedin_url: string | null;
        phone_number: string | null;
        company: string | null;
        sources: Array<{
            domain: string;
            uri: string;
            extracted_on: string;
            last_seen_on: string;
            still_on_page: boolean;
        }>;
        verification: {
            date: string | null;
            status: 'valid' | 'accept_all' | 'unknown' | null;
        } | null;
    };
}

export interface HunterCompanyData {
    id: string;
    name: string;
    legalName: string | null;
    domain: string;
    description: string | null;
    site: {
        phoneNumbers: string[];
        emailAddresses: string[];
    } | null;
    foundedYear: number | null;
    location: string | null;
    geo: {
        city: string | null;
        state: string | null;
        stateCode: string | null;
        country: string | null;
        countryCode: string | null;
    } | null;
    logo: string | null;
    linkedin: { handle: string | null } | null;
    twitter: { handle: string | null } | null;
    facebook: { handle: string | null } | null;
    type: string | null;
    company_type: string | null;
    phone: string | null;
    category: {
        sector: string | null;
        industryGroup: string | null;
        industry: string | null;
        subIndustry: string | null;
    } | null;
    metrics: {
        employees: string | null;
        estimatedAnnualRevenue: string | null;
        trafficRank: string | null;
    } | null;
    tech: string[];
    techCategories: string[];
}

export interface HunterCompanyEnrichmentResponse {
    data: HunterCompanyData;
    meta: {
        domain: string;
    };
}

export interface HunterDiscoverCompany {
    domain: string;
    organization: string;
    emails_count: {
        personal: number;
        generic: number;
        total: number;
    };
}

export interface HunterDiscoverResponse {
    data: HunterDiscoverCompany[];
    meta: {
        results: number;
        limit: number;
        offset: number;
    };
}

export interface HunterEmailVerifierResponse {
    data: {
        status: 'valid' | 'invalid' | 'accept_all' | 'webmail' | 'disposable' | 'unknown';
        score: number;
        email: string;
        regexp: boolean;
        gibberish: boolean;
        disposable: boolean;
        webmail: boolean;
        mx_records: boolean;
        smtp_server: boolean;
        smtp_check: boolean;
        accept_all: boolean;
        block: boolean;
        sources: Array<{
            domain: string;
            uri: string;
            extracted_on: string;
            last_seen_on: string;
            still_on_page: boolean;
        }>;
    };
}

// ============ Helper Functions ============

function getApiKey(): string {
    const key = process.env.HUNTER_API_KEY;
    if (!key) {
        throw new Error('Missing HUNTER_API_KEY environment variable');
    }
    return key;
}

async function hunterFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const apiKey = getApiKey();
    const url = new URL(`${HUNTER_BASE_URL}${endpoint}`);

    // Add API key to query params for GET requests
    if (!options?.method || options.method === 'GET') {
        url.searchParams.set('api_key', apiKey);
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options?.headers as Record<string, string> || {}),
    };

    // For POST requests, use header auth
    if (options?.method === 'POST') {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url.toString(), {
        ...options,
        headers,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData?.errors?.[0]?.details || errorData?.errors?.[0]?.id || `Hunter API error: ${response.status}`;
        throw new Error(errorMsg);
    }

    return response.json() as Promise<T>;
}

// ============ API Methods ============

/**
 * Domain Search - Find all emails for a domain
 * https://hunter.io/api-documentation/v2#domain-search
 */
export async function hunterDomainSearch(
    domain: string,
    options?: {
        limit?: number;
        offset?: number;
        type?: 'personal' | 'generic';
        seniority?: string;
        department?: string;
    }
): Promise<HunterDomainSearchResponse> {
    const params = new URLSearchParams();
    params.set('domain', domain);

    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.type) params.set('type', options.type);
    if (options?.seniority) params.set('seniority', options.seniority);
    if (options?.department) params.set('department', options.department);

    return hunterFetch<HunterDomainSearchResponse>(`/domain-search?${params.toString()}`);
}

/**
 * Email Finder - Find email for a specific person
 * https://hunter.io/api-documentation/v2#email-finder
 */
export async function hunterEmailFinder(
    domain: string,
    firstName: string,
    lastName: string
): Promise<HunterEmailFinderResponse> {
    const params = new URLSearchParams();
    params.set('domain', domain);
    params.set('first_name', firstName);
    params.set('last_name', lastName);

    return hunterFetch<HunterEmailFinderResponse>(`/email-finder?${params.toString()}`);
}

/**
 * Company Enrichment - Get company information from domain
 * https://hunter.io/api-documentation/v2#company-enrichment
 */
export async function hunterCompanyEnrichment(
    domain: string
): Promise<HunterCompanyEnrichmentResponse> {
    const params = new URLSearchParams();
    params.set('domain', domain);

    return hunterFetch<HunterCompanyEnrichmentResponse>(`/companies/find?${params.toString()}`);
}

/**
 * Discover - Find companies matching criteria
 * https://hunter.io/api-documentation/v2#discover
 */
export async function hunterDiscover(
    filters: {
        query?: string;
        organization?: { domain?: string[]; name?: string[] };
        headquarters_location?: {
            include?: Array<{ continent?: string; country?: string; city?: string }>;
            exclude?: Array<{ continent?: string; country?: string; city?: string }>;
        };
        industry?: { include?: string[]; exclude?: string[] };
        headcount?: string[];
        company_type?: { include?: string[]; exclude?: string[] };
        keywords?: { include?: string[]; exclude?: string[] };
        limit?: number;
        offset?: number;
    }
): Promise<HunterDiscoverResponse> {
    return hunterFetch<HunterDiscoverResponse>('/discover', {
        method: 'POST',
        body: JSON.stringify(filters),
    });
}

/**
 * Email Verifier - Check email deliverability
 * https://hunter.io/api-documentation/v2#email-verifier
 */
export async function hunterEmailVerifier(
    email: string
): Promise<HunterEmailVerifierResponse> {
    const params = new URLSearchParams();
    params.set('email', email);

    return hunterFetch<HunterEmailVerifierResponse>(`/email-verifier?${params.toString()}`);
}

// ============ Table Building Helpers ============

/**
 * Convert Hunter Domain Search response to contact table format
 * Compatible with existing Wiza table structure
 */
export function buildContactTableFromHunter(
    domain: string,
    emails: HunterEmail[],
    organization: string | null
): {
    title: string;
    description: string;
    columns: string[];
    rows: string[][];
} {
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

    const rows = emails.map((email) => {
        const fullName = [email.first_name, email.last_name].filter(Boolean).join(' ') || '';
        const title = email.position || '';
        const company = organization || '';
        const emailValue = email.value || '';
        const emailStatus = email.verification?.status || '';
        const phone = email.phone_number || '';
        const location = ''; // Hunter doesn't provide location in domain search
        const linkedin = email.linkedin ? `https://linkedin.com/in/${email.linkedin}` : '';
        const companyDomain = domain;
        const companyLinkedIn = ''; // Not available in email response

        return [
            fullName,
            title,
            company,
            emailValue,
            emailStatus,
            phone,
            location,
            linkedin,
            companyDomain,
            companyLinkedIn,
        ];
    });

    return {
        title: 'Hunter Contacts',
        description: `Contacts found via Hunter for: ${domain}`,
        columns,
        rows,
    };
}

/**
 * Convert Hunter Company Enrichment response to company table format
 * Compatible with existing Wiza table structure
 */
export function buildCompanyTableFromHunter(
    prompt: string,
    companies: HunterCompanyData[]
): {
    title: string;
    description: string;
    columns: string[];
    rows: string[][];
} {
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

    const rows = companies.map((c) => {
        const companyName = c.name || c.legalName || '';
        const domain = c.domain || '';
        const industry = c.category?.industry || c.category?.sector || '';
        const size = c.metrics?.employees || '';
        const sizeRange = c.metrics?.employees || '';
        const type = c.company_type || c.type || '';
        const location = c.location || '';
        const description = c.description || '';
        const linkedin = c.linkedin?.handle ? `https://linkedin.com/company/${c.linkedin.handle}` : '';
        const twitter = c.twitter?.handle ? `https://twitter.com/${c.twitter.handle}` : '';
        const facebook = c.facebook?.handle ? `https://facebook.com/${c.facebook.handle}` : '';
        const founded = c.foundedYear ? String(c.foundedYear) : '';
        const revenueRange = c.metrics?.estimatedAnnualRevenue || '';

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
        ];
    });

    return {
        title: 'Hunter Companies',
        description: `Companies enriched via Hunter for: ${prompt}`,
        columns,
        rows,
    };
}

/**
 * Check if Hunter API key is configured
 */
export function isHunterConfigured(): boolean {
    return !!process.env.HUNTER_API_KEY;
}
