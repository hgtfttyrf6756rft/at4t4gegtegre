import { requireAuth } from './_auth.js';

type RequestBody = {
  filters?: Record<string, any>;
  size?: number;
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

    const apiKey = process.env.WIZA_API_KEY;
    if (!apiKey) {
      return errorResponse('Server configuration error: Missing WIZA_API_KEY', 500);
    }

    const body = (await request.json()) as RequestBody;
    const sizeRaw = typeof body.size === 'number' ? body.size : 10;
    const safeSize = Math.max(0, Math.min(sizeRaw || 0, 30));
    const filters = body.filters || {};

    const res = await fetch(`${WIZA_BASE_URL}/prospects/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        size: safeSize,
        filters,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return errorResponse(`Wiza prospects search failed (${res.status}): ${text}`, res.status);
    }

    const data = (await res.json()) as WizaProspectSearchResponse;
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[api/wiza-prospect-search] Error:', error);
    return errorResponse(error?.message || 'Failed to search Wiza prospects', 500);
  }
}

export default {
  fetch: POST,
};
