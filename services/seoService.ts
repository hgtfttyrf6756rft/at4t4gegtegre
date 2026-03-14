// Support both Node-style env (process.env) and Vite's import.meta.env so this
// works in the browser bundle and in any server environment.
// Note: RapidAPI keys used from the browser are inherently exposed to users.
// Only use this for prototyping or with rate-limited keys you are comfortable
// exposing client-side.
const nodeRapidKey =
  (typeof process !== 'undefined'
    ? (process.env.RAPIDAPI_KEYWORD_INSIGHT_KEY as string | undefined) ||
      (process.env.NEXT_PUBLIC_RAPIDAPI_KEYWORD_INSIGHT_KEY as string | undefined)
    : undefined) ||
  undefined;

const viteRapidKey =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof import.meta !== 'undefined' && (import.meta as any).env
    ? // Prefer Vite-exposed key if present
      ((import.meta as any).env.VITE_RAPIDAPI_KEYWORD_INSIGHT_KEY as string | undefined) ||
      ((import.meta as any).env.RAPIDAPI_KEYWORD_INSIGHT_KEY as string | undefined)
    : undefined) ||
  undefined;

const RAPIDAPI_KEY = nodeRapidKey || viteRapidKey || '';

const RAPIDAPI_HOST = 'google-keyword-insight1.p.rapidapi.com';
const BASE_URL = `https://${RAPIDAPI_HOST}`;

if (!RAPIDAPI_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[SEO] RAPIDAPI_KEYWORD_INSIGHT_KEY is not set. SEO tab will not work until this is configured.');
}

async function callKeywordApi<T = any>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  if (!RAPIDAPI_KEY) {
    throw new Error('Missing RAPIDAPI_KEYWORD_INSIGHT_KEY env var for SEO keyword API');
  }

  const query = params
    ? `?${new URLSearchParams(
        Object.entries(params)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([key, value]) => [key, String(value)])
      ).toString()}`
    : '';

  const url = `${BASE_URL}${path}${query}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': RAPIDAPI_HOST,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RapidAPI SEO request failed (${res.status}): ${text || res.statusText}`);
  }

  return (await res.json()) as T;
}

export interface SeoKeywordApiResult {
  global?: any;
  local?: any;
  top?: any;
}

export async function fetchSeoKeywordData(
  keyword: string,
  location: string,
  lang: string = 'en',
  topNum: number = 15,
): Promise<SeoKeywordApiResult> {
  const safeKeyword = keyword.trim();
  if (!safeKeyword) {
    throw new Error('Keyword is required for SEO analysis');
  }

  const safeLocation = location.trim() || 'US';
  const safeLang = lang.trim() || 'en';

  const [global, local, top] = await Promise.all([
    callKeywordApi('/globalkey/', { keyword: safeKeyword, lang: safeLang, mode: 'all' }),
    callKeywordApi('/keysuggest/', { keyword: safeKeyword, location: safeLocation, lang: safeLang }),
    callKeywordApi('/topkeys/', { keyword: safeKeyword, location: safeLocation, lang: safeLang, num: topNum }),
  ]);

  return { global, local, top };
}

export async function fetchSeoLocations(): Promise<any> {
  return callKeywordApi('/locations/');
}

export async function fetchSeoLanguages(): Promise<any> {
  return callKeywordApi('/languages/');
}
