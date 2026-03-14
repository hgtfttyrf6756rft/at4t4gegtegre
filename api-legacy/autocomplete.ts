import { requireAuth } from './_auth.js';

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400) => json({ error: message }, status);

export default {
  async fetch(request: Request): Promise<Response> {
    const authResult = await (requireAuth as any)(request);
    if (authResult instanceof Response) return authResult;

    const url = new URL(request.url);
    const query = url.searchParams.get('query');
    if (!query) return error('Missing query parameter', 400);

    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || process.env.VITE_RAPIDAPI_KEY || '';
    if (!RAPIDAPI_KEY) {
      console.warn('[Autocomplete] RAPIDAPI_KEY is not set.');
      return error('Server configuration error: RAPIDAPI_KEY missing', 500);
    }

    // Try Primary API: google-search-master-mega
    try {
      const primaryUrl = new URL('https://google-search-master-mega.p.rapidapi.com/autocomplete');
      primaryUrl.searchParams.set('q', query);
      primaryUrl.searchParams.set('gl', 'us');
      primaryUrl.searchParams.set('hl', 'en');
      primaryUrl.searchParams.set('autocorrect', 'true');
      primaryUrl.searchParams.set('page', '1');

      const response = await fetch(primaryUrl.toString(), {
        method: 'GET',
        headers: {
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': 'google-search-master-mega.p.rapidapi.com',
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        // Normalize: [{ value: "... "}, ...] -> ["...", ...]
        const suggestions = (data.suggestions || []).map((s: any) => s.value || s).filter(Boolean);
        return json({ query, suggestions });
      } else {
        console.warn(`[Autocomplete] Primary API failed (${response.status}), falling back...`);
      }
    } catch (e) {
      console.error('[Autocomplete] Primary API catch error:', e);
    }

    // Fallback API: web-search-autocomplete
    try {
      const fallbackUrl = new URL('https://web-search-autocomplete.p.rapidapi.com/autocomplete');
      fallbackUrl.searchParams.set('query', query);
      fallbackUrl.searchParams.set('language', 'en');
      fallbackUrl.searchParams.set('region', 'us');
      fallbackUrl.searchParams.set('user_agent', 'desktop');

      const response = await fetch(fallbackUrl.toString(), {
        method: 'GET',
        headers: {
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': 'web-search-autocomplete.p.rapidapi.com',
        },
      });

      if (response.ok) {
        const data = await response.json();
        return json(data);
      }
      
      const text = await response.text();
      return error(`Both Autocomplete APIs failed. Last status: ${response.status}`, response.status);
    } catch (e: any) {
      console.error('[Autocomplete] Fallback Fetch error:', e);
      return error(e?.message || 'Internal server error', 500);
    }
  },
};
