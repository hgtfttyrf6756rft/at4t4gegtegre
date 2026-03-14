import { requireAuth } from './_auth.js';

type RequestBody = {
  // Kept for backward compatibility with existing callers.
  endpoint?: 'everything' | 'top-headlines';
  q?: string;
  language?: string;
  pageSize?: number;
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400) => json({ error: message }, status);

const clampInt = (n: any, min: number, max: number, fallback: number) => {
  const num = typeof n === 'number' ? n : parseInt(String(n || ''), 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
};

const pick = <T extends object>(obj: any, key: keyof T): any => {
  const value = obj?.[key as any];
  if (value === undefined || value === null) return undefined;
  const asString = typeof value === 'string' ? value.trim() : value;
  if (typeof asString === 'string' && !asString) return undefined;
  return asString;
};

const decodeHtml = (value: string): string => {
  return (value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
};

const stripHtml = (value: string): string => {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
};

const extractTag = (xml: string, tag: string): string => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(re);
  return match ? match[1].trim() : '';
};

const parseGoogleNewsRss = (xml: string, limit: number) => {
  const items: any[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(xml)) && items.length < limit) {
    const itemXml = match[1];
    const rawTitle = stripHtml(extractTag(itemXml, 'title'));
    const link = stripHtml(extractTag(itemXml, 'link'));
    const pubDateRaw = stripHtml(extractTag(itemXml, 'pubDate'));
    const description = stripHtml(extractTag(itemXml, 'description'));

    const sourceMatch = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? stripHtml(sourceMatch[1]) : null;

    let title = rawTitle;
    let fallbackSource: string | null = null;
    if (!source && rawTitle.includes(' - ')) {
      const parts = rawTitle.split(' - ');
      if (parts.length >= 2) {
        fallbackSource = parts[parts.length - 1].trim();
        title = parts.slice(0, -1).join(' - ').trim();
      }
    }

    let publishedAt: string | null = null;
    if (pubDateRaw) {
      const dt = new Date(pubDateRaw);
      if (!Number.isNaN(dt.getTime())) {
        publishedAt = dt.toISOString();
      }
    }

    if (!title || !link) continue;

    items.push({
      source: { id: null, name: source || fallbackSource || 'News' },
      author: null,
      title,
      description: description || '',
      url: link,
      urlToImage: null,
      publishedAt,
      content: '',
    });
  }

  return items;
};

export async function POST(request: Request) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) {
    return authResult;
  }

  try {
    const body = (await request.json()) as RequestBody;

    const q = (body.q || '').toString().trim();
    if (!q) return error('Missing q', 400);

    const pageSize = clampInt(body.pageSize, 1, 50, 20);
    const language = (pick<RequestBody>(body, 'language') || 'en').toString().trim().toLowerCase();

    const rss = new URL('https://news.google.com/rss/search');
    rss.searchParams.set('q', q);
    // Basic language wiring. Google News RSS expects hl/gl/ceid combos.
    if (language === 'en') {
      rss.searchParams.set('hl', 'en-US');
      rss.searchParams.set('gl', 'US');
      rss.searchParams.set('ceid', 'US:en');
    } else {
      rss.searchParams.set('hl', language);
    }

    const res = await fetch(rss.toString(), {
      headers: {
        Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, text/plain;q=0.5',
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return error(`Google News RSS error: ${res.status} ${text || ''}`.trim(), res.status);
    }

    const xml = await res.text();
    const articles = parseGoogleNewsRss(xml, pageSize);

    return json({
      status: 'ok',
      totalResults: articles.length,
      articles,
    });
  } catch (e: any) {
    console.error('[api/news-search] Error:', e);
    return error(e?.message || 'News search failed', 500);
  }
}

export default {
  fetch: POST,
};
