import { requireAuth } from './_auth.js';

const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_BASE_URL = 'https://api.x.ai/v1';

if (!XAI_API_KEY) {
    console.warn('[xAI Video] Warning: XAI_API_KEY not configured');
}

export interface XAIVideoResponse {
    request_id: string;
    url?: string;
    status: 'processing' | 'completed' | 'failed';
    error?: string;
}

/**
 * Process xAI video operations
 */
async function xaiFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = url.searchParams.get('op');

    if (op === 'xai-edit-video') {
        return handleEditVideo(request);
    }

    if (op === 'xai-generate-video') {
        return handleGenerateVideo(request);
    }

    if (op === 'xai-get-video') {
        return handleGetVideo(request);
    }

    return new Response(JSON.stringify({ error: 'Unknown operation' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function handleGenerateVideo(request: Request): Promise<Response> {
    try {
        // Verify authentication
        const authResult = await requireAuth(request);
        if ('error' in authResult) {
            return new Response(JSON.stringify({ error: authResult.error }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!XAI_API_KEY) {
            return new Response(JSON.stringify({ error: 'xAI API key not configured' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const body = await request.json();
        const { prompt, image, image_url, duration, aspect_ratio, resolution, model = 'grok-imagine-video' } = body;

        if (!prompt) {
            return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const xaiBody: any = {
            prompt,
            model,
        };

        const xai_ref_image_url = image_url || image?.url;
        if (xai_ref_image_url) xaiBody.image_url = xai_ref_image_url;
        if (duration) xaiBody.duration = duration;
        if (aspect_ratio) xaiBody.aspect_ratio = aspect_ratio;
        if (resolution) xaiBody.resolution = resolution;

        console.log('[xAI Video] Sending generation request:', {
            prompt: prompt.substring(0, 50),
            duration,
            aspect_ratio
        });

        // Call xAI API
        const response = await fetch(`${XAI_BASE_URL}/videos/generations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${XAI_API_KEY}`,
            },
            body: JSON.stringify(xaiBody),
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('[xAI Video] Generation failed:', result);
            return new Response(JSON.stringify({
                error: result.error || result.message || `xAI API error: ${response.status}`,
                details: result
            }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('[xAI Video] Generation request successful:', result.request_id);

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        console.error('[xAI Video] Generation error:', error);
        return new Response(JSON.stringify({
            error: error.message || 'Failed to generate video',
            details: error.toString()
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

async function handleEditVideo(request: Request): Promise<Response> {
    try {
        // Verify authentication
        const authResult = await requireAuth(request);
        if ('error' in authResult) {
            return new Response(JSON.stringify({ error: authResult.error }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!XAI_API_KEY) {
            return new Response(JSON.stringify({ error: 'xAI API key not configured' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const body = await request.json();
        const { prompt, video, image, image_url, model = 'grok-imagine-video' } = body;

        if (!prompt) {
            return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!video?.url) {
            return new Response(JSON.stringify({ error: 'Video URL is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('[xAI Video] Editing video:', {
            prompt: prompt.substring(0, 50),
            video_url: video.url.substring(0, 100),
            has_image: !!image?.url,
            model
        });

        // Build request body according to xAI documentation
        const xaiBody: any = {
            prompt,
            video: { url: video.url },
            model
        };

        // Add optional image reference if provided
        const xai_ref_image_url = image_url || image?.url;
        if (xai_ref_image_url) {
            xaiBody.image_url = xai_ref_image_url;
            console.log('[xAI Video] Including image reference:', xai_ref_image_url.substring(0, 100));
        }

        // Call xAI API
        const response = await fetch(`${XAI_BASE_URL}/videos/edits`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${XAI_API_KEY}`,
            },
            body: JSON.stringify(xaiBody),
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('[xAI Video] Edit failed:', result);
            return new Response(JSON.stringify({
                error: result.error || result.message || `xAI API error: ${response.status}`,
                details: result
            }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('[xAI Video] Edit request successful:', result.request_id);

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        console.error('[xAI Video] Edit error:', error);
        return new Response(JSON.stringify({
            error: error.message || 'Failed to edit video',
            details: error.toString()
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

async function handleGetVideo(request: Request): Promise<Response> {
    try {
        // Verify authentication
        const authResult = await requireAuth(request);
        if ('error' in authResult) {
            return new Response(JSON.stringify({ error: authResult.error }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!XAI_API_KEY) {
            return new Response(JSON.stringify({ error: 'xAI API key not configured' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const url = new URL(request.url);
        const requestId = url.searchParams.get('id');

        if (!requestId) {
            return new Response(JSON.stringify({ error: 'Request ID is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('[xAI Video] Getting video status for:', requestId);

        // Call xAI API to get video result
        const response = await fetch(`${XAI_BASE_URL}/videos/${requestId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${XAI_API_KEY}`,
            },
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('[xAI Video] Get video failed:', result);
            return new Response(JSON.stringify({
                error: result.error || result.message || `xAI API error: ${response.status}`,
                details: result
            }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // xAI has shown different response formats in documentation:
        // 1. { status: "pending/done", response: { video: { url, duration }, model } }
        // 2. { video: { url, duration }, model }
        // 3. { url, status }

        // Determine status: "completed", "processing"
        let status: 'completed' | 'processing' | 'failed' = 'processing';
        if (result.status === 'done' || result.status === 'completed' || result.url || result.video?.url) {
            status = 'completed';
        } else if (result.status === 'failed' || result.error) {
            status = 'failed';
        }

        // Extract URL, duration, model using robust path checking
        const url_result = result.response?.video?.url || result.video?.url || result.url;
        const duration = result.response?.video?.duration || result.video?.duration || result.duration;
        const model = result.response?.model || result.model;

        const transformedResult: XAIVideoResponse = {
            request_id: requestId,
            status,
            url: url_result || undefined,
            error: result.error || undefined
        };

        if (duration) (transformedResult as any).duration = duration;
        if (model) (transformedResult as any).model = model;

        console.log('[xAI Video] Video status:', {
            request_id: requestId,
            raw_status: result.status,
            transformed_status: status,
            has_url: !!url_result
        });

        return new Response(JSON.stringify(transformedResult), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        console.error('[xAI Video] Get video error:', error);
        return new Response(JSON.stringify({
            error: error.message || 'Failed to get video',
            details: error.toString()
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

export { xaiFetch as fetch };
