import { requireAuth } from './_auth.js';

// YouTube Data API v3 Search endpoint
// Docs: https://developers.google.com/youtube/v3/docs/search/list

interface YouTubeSearchItem {
    id: { videoId?: string; channelId?: string; playlistId?: string };
    snippet: {
        title: string;
        description: string;
        thumbnails: {
            default?: { url: string };
            medium?: { url: string };
            high?: { url: string };
        };
        channelTitle: string;
        publishedAt: string;
    };
}

interface YouTubeSearchResponse {
    items: YouTubeSearchItem[];
    nextPageToken?: string;
    pageInfo: { totalResults: number; resultsPerPage: number };
}

const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY;

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const error = (message: string, status = 400, details?: any) =>
    json({ error: message, details }, status);

export default {
    async fetch(request: Request): Promise<Response> {
        const authResult = await requireAuth(request);
        if (authResult instanceof Response) {
            return authResult;
        }

        if (!apiKey) {
            return error('Missing YOUTUBE_API_KEY or GOOGLE_API_KEY environment variable.', 500);
        }

        if (request.method !== 'GET') {
            return error('Method not allowed', 405);
        }

        try {
            const url = new URL(request.url);
            const q = (url.searchParams.get('q') || '').trim();
            if (!q) return error('Missing q (query) parameter', 400);

            const maxResults = parseInt(url.searchParams.get('maxResults') || '6', 10);
            const type = url.searchParams.get('type') || 'video';
            const order = url.searchParams.get('order') || 'relevance';
            const videoDuration = url.searchParams.get('videoDuration') || 'any';

            // Build YouTube Data API v3 URL
            const params = new URLSearchParams({
                part: 'snippet',
                q,
                maxResults: String(Math.min(Math.max(maxResults, 1), 50)),
                type,
                order,
                key: apiKey,
            });

            // Only add videoDuration if type is video
            if (type === 'video' && videoDuration !== 'any') {
                params.set('videoDuration', videoDuration);
            }

            const ytApiUrl = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;

            const res = await fetch(ytApiUrl);

            if (!res.ok) {
                const text = await res.text().catch(() => res.statusText);
                return error(`YouTube API error: ${res.status}`, res.status, text);
            }

            const data: YouTubeSearchResponse = await res.json();

            // Transform to simpler format for frontend
            const videos = (data.items || [])
                .filter(item => item.id.videoId) // Only include videos
                .map(item => ({
                    id: item.id.videoId,
                    title: item.snippet.title,
                    description: item.snippet.description,
                    thumbnail: item.snippet.thumbnails?.high?.url ||
                        item.snippet.thumbnails?.medium?.url ||
                        item.snippet.thumbnails?.default?.url || '',
                    channel: item.snippet.channelTitle,
                    publishedAt: item.snippet.publishedAt,
                }));

            return json({
                videos,
                totalResults: data.pageInfo?.totalResults || 0,
                nextPageToken: data.nextPageToken,
            });
        } catch (e: any) {
            return error(e?.message || 'Failed to search YouTube', 500);
        }
    },
};
