import { requireAuth } from './_auth.js';

const LUMA_API_KEY = process.env.LUMA_API_KEY;
const LUMA_BASE_URL = 'https://api.lumalabs.ai/dream-machine/v1';

if (!LUMA_API_KEY) {
    console.warn('[Luma Video] Warning: LUMA_API_KEY not configured');
}

/**
 * Process Luma video operations
 */
async function lumaFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = url.searchParams.get('op');

    if (op === 'luma-modify') {
        return handleModifyVideo(request);
    }

    if (op === 'luma-get-generation') {
        return handleGetGeneration(request);
    }

    return new Response(JSON.stringify({ error: 'Unknown operation' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function handleModifyVideo(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in authResult) {
            return new Response(JSON.stringify({ error: authResult.error }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!LUMA_API_KEY) {
            return new Response(JSON.stringify({ error: 'Luma API key not configured' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const body = await request.json();
        const { media, first_frame, model, mode, prompt, callback_url } = body;

        if (!prompt) {
            return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const lumaBody: any = {
            prompt,
            model: model || 'ray-2',
            mode: mode || 'flex_1',
        };

        if (media?.url) lumaBody.media = { url: media.url };
        if (first_frame?.url) lumaBody.first_frame = { url: first_frame.url };
        if (callback_url) lumaBody.callback_url = callback_url;

        console.log('[Luma Video] Sending modify request:', {
            prompt: prompt.substring(0, 50),
            model: lumaBody.model,
            mode: lumaBody.mode,
            has_media: !!media?.url,
            has_first_frame: !!first_frame?.url,
        });

        const response = await fetch(`${LUMA_BASE_URL}/generations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LUMA_API_KEY}`,
            },
            body: JSON.stringify(lumaBody),
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('[Luma Video] Modify failed:', result);
            return new Response(JSON.stringify({
                error: result.detail || result.error || result.message || `Luma API error: ${response.status}`,
                details: result
            }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('[Luma Video] Modify request successful:', result.id);

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        console.error('[Luma Video] Modify error:', error);
        return new Response(JSON.stringify({
            error: error.message || 'Failed to modify video',
            details: error.toString()
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

async function handleGetGeneration(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in authResult) {
            return new Response(JSON.stringify({ error: authResult.error }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!LUMA_API_KEY) {
            return new Response(JSON.stringify({ error: 'Luma API key not configured' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const url = new URL(request.url);
        const generationId = url.searchParams.get('id');

        if (!generationId) {
            return new Response(JSON.stringify({ error: 'Generation ID is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('[Luma Video] Getting generation status for:', generationId);

        const response = await fetch(`${LUMA_BASE_URL}/generations/${generationId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${LUMA_API_KEY}`,
            },
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('[Luma Video] Get generation failed:', result);
            return new Response(JSON.stringify({
                error: result.detail || result.error || result.message || `Luma API error: ${response.status}`,
                details: result
            }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('[Luma Video] Generation status:', {
            id: generationId,
            state: result.state,
            has_video: !!result.assets?.video,
        });

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        console.error('[Luma Video] Get generation error:', error);
        return new Response(JSON.stringify({
            error: error.message || 'Failed to get generation',
            details: error.toString()
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

export { lumaFetch as fetch };
