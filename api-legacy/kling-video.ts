import { requireAuth } from './_auth.js';

const KLING_ACCESS_KEY = process.env.KLING_ACCESS_KEY;
const KLING_SECRET_KEY = process.env.KLING_SECRET_KEY;
const KLING_BASE_URL = 'https://api-singapore.klingai.com';

if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
    console.warn('[Kling Video] Warning: KLING_ACCESS_KEY or KLING_SECRET_KEY not configured');
}

// ─── JWT Token Generation (HS256, no external dependency) ─────────────────

function base64UrlEncode(data: Uint8Array | string): string {
    const str = typeof data === 'string'
        ? btoa(data)
        : btoa(String.fromCharCode(...data));
    return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateKlingToken(): Promise<string> {
    if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
        throw new Error('Kling API credentials not configured');
    }

    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: KLING_ACCESS_KEY,
        exp: now + 1800, // 30 minutes
        nbf: now - 5,
    };

    const headerB64 = base64UrlEncode(JSON.stringify(header));
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));
    const unsigned = `${headerB64}.${payloadB64}`;

    // Sign with HMAC-SHA256 using Web Crypto API
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(KLING_SECRET_KEY),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
    const signatureB64 = base64UrlEncode(new Uint8Array(signature));

    return `${unsigned}.${signatureB64}`;
}

// ─── Kling API Helper ─────────────────────────────────────────────────────

export async function executeKlingApi(
    path: string,
    method: 'GET' | 'POST' = 'GET',
    body?: any,
): Promise<any> {
    const token = await generateKlingToken();
    const url = `${KLING_BASE_URL}${path}`;

    const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
    };

    console.log(`[Kling] ${method} ${path}`);

    const res = await fetch(url, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const data = await res.json();

    if (!res.ok || data.code !== 0) {
        console.error(`[Kling] API error:`, JSON.stringify(data, null, 2));
        throw new Error(data.message || `Kling API error: ${res.status}`);
    }

    console.log(`[Kling] Response for ${method} ${path}:`, JSON.stringify(data, null, 2));

    return data;
}

// ─── JSON Response Helpers ────────────────────────────────────────────────

function jsonOk(data: any) {
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function jsonError(message: string, status = 400) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// ─── Router ───────────────────────────────────────────────────────────────

async function klingFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = url.searchParams.get('op');

    switch (op) {
        case 'kling-generate-video':
            return handleGenerateVideo(request);
        case 'kling-get-video':
            return handleGetVideoTask(request);
        case 'kling-identify-face':
            return handleIdentifyFace(request);
        case 'kling-create-lipsync':
            return handleCreateLipSync(request);
        case 'kling-get-lipsync':
            return handleGetLipSyncTask(request);
        case 'kling-generate-multi-video':
            return handleGenerateMultiVideo(request);
        case 'kling-get-multi-video':
            return handleGetMultiVideoTask(request);
        case 'kling-generate-avatar':
            return handleGenerateAvatarVideo(request);
        case 'kling-get-avatar':
            return handleGetAvatarVideo(request);
        default:
            return jsonError('Unknown Kling operation');
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────

/**
 * Create an image-to-video generation task.
 * POST body: { imageUrl, prompt, duration?, mode? }
 */
async function handleGenerateVideo(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in (authResult as any)) return jsonError((authResult as any).error, 401);

        if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
            return jsonError('Kling API credentials not configured', 500);
        }

        const body = await request.json();
        const { imageUrl, prompt, duration = '10', mode = 'pro' } = body;

        if (!imageUrl) return jsonError('imageUrl is required');
        if (!prompt) return jsonError('prompt is required');

        const result = await executeKlingApi('/v1/videos/image2video', 'POST', {
            model_name: 'kling-v2-6',
            image: imageUrl,
            prompt,
            duration,
            mode,
        });

        return jsonOk({
            taskId: result.data?.task_id,
            status: result.data?.task_status,
        });
    } catch (err: any) {
        console.error('[Kling] generateVideo error:', err);
        return jsonError(err?.message || 'Failed to generate video', 500);
    }
}

/**
 * Poll video generation status.
 * Query: ?op=kling-get-video&id={taskId}
 */
async function handleGetVideoTask(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in (authResult as any)) return jsonError((authResult as any).error, 401);

        const url = new URL(request.url);
        const taskId = url.searchParams.get('id');
        if (!taskId) return jsonError('id is required');

        const result = await executeKlingApi(`/v1/videos/image2video/${taskId}`);
        const data = result.data;

        return jsonOk({
            taskId: data?.task_id,
            status: data?.task_status,
            statusMsg: data?.task_status_msg,
            videoUrl: data?.task_result?.videos?.[0]?.url || null,
            videoId: data?.task_result?.videos?.[0]?.id || null,
            duration: data?.task_result?.videos?.[0]?.duration || null,
        });
    } catch (err: any) {
        console.error('[Kling] getVideoTask error:', err);
        return jsonError(err?.message || 'Failed to get video task', 500);
    }
}

/**
 * Identify faces in a video for lip-sync.
 * POST body: { videoUrl?, videoId? } — one is required (mutually exclusive per Kling docs)
 */
async function handleIdentifyFace(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in (authResult as any)) return jsonError((authResult as any).error, 401);

        if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
            return jsonError('Kling API credentials not configured', 500);
        }

        const body = await request.json();
        const { videoUrl, videoId } = body;

        if (!videoUrl && !videoId) return jsonError('videoUrl or videoId is required');

        // Prefer video_id for Kling-generated videos; otherwise use video_url
        const requestBody: any = {};
        if (videoId) {
            requestBody.video_id = videoId;
        } else {
            requestBody.video_url = videoUrl;
        }

        const result = await executeKlingApi('/v1/videos/identify-face', 'POST', requestBody);

        const faceData = result.data?.face_data || [];
        return jsonOk({
            sessionId: result.data?.session_id,
            faces: faceData.map((f: any) => ({
                faceId: f.face_id,
                faceImage: f.face_image,
                startTime: f.start_time,
                endTime: f.end_time,
            })),
        });
    } catch (err: any) {
        console.error('[Kling] identifyFace error:', err);
        return jsonError(err?.message || 'Failed to identify faces', 500);
    }
}

/**
 * Create a lip-sync task.
 * POST body: { sessionId, faceId, audioUrl, soundStartMs, soundEndMs, soundInsertMs }
 */
async function handleCreateLipSync(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in (authResult as any)) return jsonError((authResult as any).error, 401);

        if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
            return jsonError('Kling API credentials not configured', 500);
        }

        const body = await request.json();
        const {
            sessionId,
            faceId,
            audioUrl,
            soundStartMs = 0,
            soundEndMs = 10000,
            soundInsertMs = 0,
        } = body;

        if (!sessionId) return jsonError('sessionId is required');
        if (!faceId && faceId !== '0') return jsonError('faceId is required');
        if (!audioUrl) return jsonError('audioUrl is required');

        const result = await executeKlingApi('/v1/videos/advanced-lip-sync', 'POST', {
            session_id: sessionId,
            face_choose: [
                {
                    face_id: String(faceId),
                    sound_file: audioUrl,
                    sound_start_time: soundStartMs,
                    sound_end_time: soundEndMs,
                    sound_insert_time: soundInsertMs,
                    sound_volume: 2,
                    original_audio_volume: 0,
                },
            ],
        });

        return jsonOk({
            taskId: result.data?.task_id,
            status: result.data?.task_status,
        });
    } catch (err: any) {
        console.error('[Kling] createLipSync error:', err);
        return jsonError(err?.message || 'Failed to create lip-sync task', 500);
    }
}

/**
 * Poll lip-sync task status.
 * Query: ?op=kling-get-lipsync&id={taskId}
 */
async function handleGetLipSyncTask(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in (authResult as any)) return jsonError((authResult as any).error, 401);

        const url = new URL(request.url);
        const taskId = url.searchParams.get('id');
        if (!taskId) return jsonError('id is required');

        const result = await executeKlingApi(`/v1/videos/advanced-lip-sync/${taskId}`);
        const data = result.data;

        return jsonOk({
            taskId: data?.task_id,
            status: data?.task_status,
            statusMsg: data?.task_status_msg,
            videoUrl: data?.task_result?.videos?.[0]?.url || null,
            videoId: data?.task_result?.videos?.[0]?.id || null,
            duration: data?.task_result?.videos?.[0]?.duration || null,
        });
    } catch (err: any) {
        console.error('[Kling] getLipSyncTask error:', err);
        return jsonError(err?.message || 'Failed to get lip-sync task', 500);
    }
}

/**
 * Create a multi-image-to-video generation task.
 * POST body: { images: string[] (base64 or URLs), prompt, duration?, mode?, aspectRatio? }
 */
async function handleGenerateMultiVideo(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in (authResult as any)) return jsonError((authResult as any).error, 401);

        if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
            return jsonError('Kling API credentials not configured', 500);
        }

        const body = await request.json();
        const { images, prompt, duration = '5', mode = 'pro', aspectRatio = '16:9' } = body;

        if (!images || !Array.isArray(images) || images.length === 0) {
            return jsonError('images array is required (1-4 images)');
        }
        if (images.length > 4) {
            return jsonError('Maximum 4 images allowed');
        }
        if (!prompt) return jsonError('prompt is required');

        const image_list = images.map((img: string) => ({ image: img }));

        const result = await executeKlingApi('/v1/videos/multi-image2video', 'POST', {
            model_name: 'kling-v1-6',
            image_list,
            prompt,
            duration,
            mode,
            aspect_ratio: aspectRatio,
        });

        return jsonOk({
            taskId: result.data?.task_id,
            status: result.data?.task_status,
        });
    } catch (err: any) {
        console.error('[Kling] generateMultiVideo error:', err);
        return jsonError(err?.message || 'Failed to generate multi-image video', 500);
    }
}

/**
 * Poll multi-image-to-video task status.
 * Query: ?op=kling-get-multi-video&id={taskId}
 */
async function handleGetMultiVideoTask(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in (authResult as any)) return jsonError((authResult as any).error, 401);

        const url = new URL(request.url);
        const taskId = url.searchParams.get('id');
        if (!taskId) return jsonError('id is required');

        const result = await executeKlingApi(`/v1/videos/multi-image2video/${taskId}`);
        const data = result.data;

        return jsonOk({
            taskId: data?.task_id,
            status: data?.task_status,
            statusMsg: data?.task_status_msg,
            videoUrl: data?.task_result?.videos?.[0]?.url || null,
            videoId: data?.task_result?.videos?.[0]?.id || null,
            duration: data?.task_result?.videos?.[0]?.duration || null,
        });
    } catch (err: any) {
        console.error('[Kling] getMultiVideoTask error:', err);
        return jsonError(err?.message || 'Failed to get multi-video task', 500);
    }
}

/**
* Create an avatar video generation task.
* POST body: { image, sound_file, mode? }
*/
async function handleGenerateAvatarVideo(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in (authResult as any)) return jsonError((authResult as any).error, 401);

        if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
            return jsonError('Kling API credentials not configured', 500);
        }

        const body = await request.json();
        const { image, sound_file, mode = 'std' } = body;

        if (!image) return jsonError('image (url or base64) is required');
        if (!sound_file) return jsonError('sound_file (url or base64) is required');

        const result = await executeKlingApi('/v1/videos/avatar/image2video', 'POST', {
            image,
            sound_file,
            mode,
        });

        return jsonOk({
            taskId: result.data?.task_id,
            status: result.data?.task_status,
        });
    } catch (err: any) {
        console.error('[Kling] generateAvatarVideo error:', err);
        return jsonError(err?.message || 'Failed to generate avatar video', 500);
    }
}

/**
* Poll avatar video generation status.
* Query: ?op=kling-get-avatar&id={taskId}
*/
async function handleGetAvatarVideo(request: Request): Promise<Response> {
    try {
        const authResult = await requireAuth(request);
        if ('error' in (authResult as any)) return jsonError((authResult as any).error, 401);

        const url = new URL(request.url);
        const taskId = url.searchParams.get('id');
        if (!taskId) return jsonError('id is required');

        const result = await executeKlingApi(`/v1/videos/avatar/image2video/${taskId}`);
        const data = result.data;

        return jsonOk({
            taskId: data?.task_id,
            status: data?.task_status,
            statusMsg: data?.task_status_msg,
            videoUrl: data?.task_result?.videos?.[0]?.url || null,
            videoId: data?.task_result?.videos?.[0]?.id || null,
            duration: data?.task_result?.videos?.[0]?.duration || null,
        });
    } catch (err: any) {
        console.error('[Kling] getAvatarVideo error:', err);
        return jsonError(err?.message || 'Failed to get avatar video task', 500);
    }
}

export { klingFetch as fetch };
