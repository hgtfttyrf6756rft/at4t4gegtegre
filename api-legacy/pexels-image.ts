import { requireAuth } from './_auth.js';

type PexelsSearchResponse = {
  photos?: Array<{
    src?: {
      landscape?: string;
      large?: string;
      large2x?: string;
      medium?: string;
      original?: string;
    };
  }>;
};

const errorResponse = (message: string, status = 400) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function getPexelsImageUrl(query: string): Promise<string> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    throw new Error('PEXELS_API_KEY is not set');
  }

  const encodedQuery = encodeURIComponent(query || 'abstract background');
  const url = `https://api.pexels.com/v1/search?query=${encodedQuery}&per_page=1&orientation=landscape`;
  const res = await fetch(url, {
    headers: {
      Authorization: apiKey,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pexels API error: ${res.status} ${text}`);
  }

  const data = (await res.json()) as PexelsSearchResponse;
  const photo = data.photos?.[0];
  const imageUrl =
    photo?.src?.landscape ||
    photo?.src?.large ||
    photo?.src?.large2x ||
    photo?.src?.medium ||
    photo?.src?.original;

  if (!imageUrl) {
    throw new Error('No Pexels photos found');
  }

  return imageUrl;
}

export async function GET(request: Request) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get('q') || '').trim();
    if (!query) {
      return errorResponse('Missing q parameter', 400);
    }

    const imageUrl = await getPexelsImageUrl(query);
    return new Response(JSON.stringify({ imageUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[api/pexels-image] Error:', error);
    return errorResponse(error?.message || 'Failed to fetch Pexels image', 500);
  }
}

export default {
  fetch: GET,
};
