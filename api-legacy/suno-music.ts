import { requireAuth } from './_auth.js';

const SUNO_API_KEY = process.env.SUNO_API_KEY;
const SUNO_BASE_URL = 'https://api.sunoapi.org';

if (!SUNO_API_KEY) {
    console.warn('[Suno Music] Warning: SUNO_API_KEY not configured');
}

/**
 * Process Suno music operations
 */
async function sunoFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = url.searchParams.get('op');

    if (op === 'suno-generate') {
        return handleGenerateMusic(request);
    }

    if (op === 'suno-generate-lyrics') {
        return handleGenerateLyrics(request);
    }

    if (op === 'suno-get') {
        return handleGetSong(request);
    }

    return new Response(JSON.stringify({ error: 'Unknown operation' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Generate music using Suno AI
 * POST /api/media?op=suno-generate
 * Body: { prompt, style?, title?, instrumental?, lyrics? }
 *
 * Docs: https://docs.sunoapi.org/suno-api/generate-music
 * - customMode=false → only prompt required (lyrics auto-generated), max 500 chars
 * - customMode=true + instrumental=false → style, title, prompt (used as lyrics) required
 * - customMode=true + instrumental=true → style, title required
 * - callBackUrl is REQUIRED (we pass empty string since we poll instead)
 * - model: V4, V4_5, V4_5PLUS, V4_5ALL, V5
 */
async function handleGenerateMusic(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in authResult) {
            return new Response(JSON.stringify({ error: authResult.error }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!SUNO_API_KEY) {
            return new Response(JSON.stringify({ error: 'Suno API key not configured' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const body = await request.json();
        const { prompt, style, title, instrumental, lyrics } = body;

        if (!prompt) {
            return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Determine custom mode: use custom if lyrics, style, or title are provided
        const useCustomMode = !!(lyrics || (style && title));

        const sunoBody: any = {
            customMode: useCustomMode,
            instrumental: instrumental || false,
            model: 'V4_5ALL',
            callBackUrl: 'https://example.com/callback', // Required field — using dummy URL since we poll instead
        };

        if (useCustomMode) {
            // Custom mode: prompt is used as exact lyrics
            sunoBody.prompt = lyrics || prompt;
            sunoBody.style = style || '';
            sunoBody.title = title || '';
        } else {
            // Non-custom mode: prompt is a description, lyrics auto-generated
            sunoBody.prompt = prompt.substring(0, 500); // Max 500 chars in non-custom
        }

        console.log('[Suno Music] Sending generation request:', {
            prompt: sunoBody.prompt.substring(0, 80),
            style: sunoBody.style,
            customMode: sunoBody.customMode,
            instrumental: sunoBody.instrumental,
            model: sunoBody.model,
        });

        const response = await fetch(`${SUNO_BASE_URL}/api/v1/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUNO_API_KEY}`,
            },
            body: JSON.stringify(sunoBody),
        });

        const result = await response.json();

        if (!response.ok || result.code !== 200) {
            console.error('[Suno Music] Generation failed:', result);
            return new Response(JSON.stringify({
                error: result.msg || result.message || `Suno API error: ${response.status}`,
                details: result,
            }), {
                status: response.ok ? 400 : response.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('[Suno Music] Generation request successful:', result.data?.taskId);

        return new Response(JSON.stringify({
            taskId: result.data?.taskId,
            status: 'submitted',
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        console.error('[Suno Music] Generation error:', error);
        return new Response(JSON.stringify({
            error: error.message || 'Failed to generate music',
            details: error.toString(),
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

/**
 * Generate lyrics using Suno AI
 * POST /api/media?op=suno-generate-lyrics
 * Body: { prompt }
 *
 * Docs: https://docs.sunoapi.org/suno-api/generate-lyrics
 * - prompt: max 200 words
 * - callBackUrl is REQUIRED
 */
async function handleGenerateLyrics(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in authResult) {
            return new Response(JSON.stringify({ error: authResult.error }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!SUNO_API_KEY) {
            return new Response(JSON.stringify({ error: 'Suno API key not configured' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const body = await request.json();
        const { prompt } = body;

        if (!prompt) {
            return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('[Suno Music] Generating lyrics for:', prompt.substring(0, 80));

        const response = await fetch(`${SUNO_BASE_URL}/api/v1/lyrics`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUNO_API_KEY}`,
            },
            body: JSON.stringify({
                prompt,
                callBackUrl: 'https://example.com/callback', // Required field — using dummy URL since we poll instead
            }),
        });

        const result = await response.json();

        if (!response.ok || result.code !== 200) {
            console.error('[Suno Music] Lyrics generation failed:', result);
            return new Response(JSON.stringify({
                error: result.msg || result.message || `Suno API error: ${response.status}`,
                details: result,
            }), {
                status: response.ok ? 400 : response.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('[Suno Music] Lyrics generation successful:', result.data?.taskId);

        return new Response(JSON.stringify({
            taskId: result.data?.taskId,
            status: 'submitted',
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        console.error('[Suno Music] Lyrics error:', error);
        return new Response(JSON.stringify({
            error: error.message || 'Failed to generate lyrics',
            details: error.toString(),
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

/**
 * Get song/lyrics generation status
 * GET /api/media?op=suno-get&id={taskId}&type={music|lyrics}
 *
 * Docs:
 * - Music:  GET /api/v1/generate/record-info?taskId=...
 *   Status: PENDING | GENERATING | SUCCESS | FAILED | ...
 *   Response: { data: { taskId, status, response: { data: [...songs] } } }
 *
 * - Lyrics: GET /api/v1/lyrics/record-info?taskId=...
 *   Status: PENDING | SUCCESS | GENERATE_LYRICS_FAILED | ...
 *   Response: { data: { taskId, status, response: { data: [...lyrics] }, type: "LYRICS" } }
 */
async function handleGetSong(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in authResult) {
            return new Response(JSON.stringify({ error: authResult.error }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!SUNO_API_KEY) {
            return new Response(JSON.stringify({ error: 'Suno API key not configured' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const url = new URL(request.url);
        const taskId = url.searchParams.get('id');
        const taskType = url.searchParams.get('type') || 'music'; // 'music' or 'lyrics'

        if (!taskId) {
            return new Response(JSON.stringify({ error: 'Task ID is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('[Suno Music] Getting task status for:', taskId, 'type:', taskType);

        // Use the correct endpoint based on task type
        const endpoint = taskType === 'lyrics'
            ? `${SUNO_BASE_URL}/api/v1/lyrics/record-info?taskId=${taskId}`
            : `${SUNO_BASE_URL}/api/v1/generate/record-info?taskId=${taskId}`;

        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${SUNO_API_KEY}`,
            },
        });

        const result = await response.json();

        if (!response.ok || result.code !== 200) {
            console.error('[Suno Music] Get task failed:', result);
            return new Response(JSON.stringify({
                error: result.msg || result.message || `Suno API error: ${response.status}`,
                details: result,
            }), {
                status: response.ok ? 400 : response.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const data = result.data;

        // ── LYRICS task ──
        if (taskType === 'lyrics' || data?.type === 'LYRICS') {
            const lyricsItems = data?.response?.data || [];
            const firstLyrics = lyricsItems.find((l: any) => l.status === 'complete');

            // Map Suno status → our normalized status
            const status = data?.status === 'SUCCESS' ? 'completed'
                : data?.status === 'PENDING' ? 'processing'
                    : data?.status?.includes('FAILED') ? 'failed'
                        : 'processing';

            return new Response(JSON.stringify({
                taskId,
                status,
                type: 'lyrics',
                lyrics: firstLyrics?.text || '',
                title: firstLyrics?.title || '',
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── MUSIC task ──
        console.log('[Suno Debug] Raw music response data:', JSON.stringify(data, null, 2));

        const songs = Array.isArray(data?.response?.sunoData)
            ? data.response.sunoData
            : Array.isArray(data?.response?.data)
                ? data.response.data
                : Array.isArray(data?.data)
                    ? data.data
                    : Array.isArray(data?.response)
                        ? data.response
                        : [];
        const normalizedSongs = (Array.isArray(songs) ? songs : []).map((song: any) => ({
            id: song.id || '',
            title: song.title || '',
            status: song.status || 'processing',
            audio_url: song.audioUrl || song.audio_url || '',
            image_url: song.imageUrl || song.image_url || '',
            lyrics: song.prompt || song.lyrics || '', // In Suno response, 'prompt' contains the lyrics
            duration: song.duration || 0,
            style: song.tags || song.style || '',
        }));

        // Map Suno status → our normalized status
        const overallStatus = data?.status === 'SUCCESS' ? 'completed'
            : data?.status === 'PENDING' ? 'processing'
                : data?.status === 'GENERATING' ? 'processing'
                    : data?.status?.includes('FAILED') ? 'failed'
                        : 'processing';

        console.log('[Suno Music] Task status:', {
            taskId,
            status: overallStatus,
            songCount: normalizedSongs.length,
            hasAudio: normalizedSongs.some((s: any) => s.audio_url),
        });

        return new Response(JSON.stringify({
            taskId,
            status: overallStatus,
            type: 'music',
            songs: normalizedSongs,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        console.error('[Suno Music] Get task error:', error);
        return new Response(JSON.stringify({
            error: error.message || 'Failed to get task status',
            details: error.toString(),
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

export { sunoFetch as fetch };
