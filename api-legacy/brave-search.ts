import { requireAuth } from './_auth.js';

export async function GET(request: Request) {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
        return authResult;
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const count = searchParams.get('count') || '10';
    const safeSearch = searchParams.get('safesearch') || 'strict';

    if (!query) {
        return new Response(JSON.stringify({ error: 'Missing query parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const apiKey = process.env.BRAVE_API_KEY;

    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Server configuration error: Missing API Key' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const braveUrl = new URL('https://api.search.brave.com/res/v1/images/search');
        braveUrl.searchParams.set('q', query);
        braveUrl.searchParams.set('count', count);
        braveUrl.searchParams.set('safesearch', safeSearch);
        braveUrl.searchParams.set('search_lang', 'en');
        braveUrl.searchParams.set('country', 'us');
        braveUrl.searchParams.set('spellcheck', '1');

        const response = await fetch(braveUrl.toString(), {
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip',
                'X-Subscription-Token': apiKey,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            return new Response(JSON.stringify({ error: `Brave API error: ${response.status}`, details: errorText }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const data = await response.json();

        return new Response(JSON.stringify(data), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' // Cache for 1 hour
            },
        });
    } catch (error: any) {
        console.error('Error fetching from Brave Search:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

export default {
    fetch: GET,
};
