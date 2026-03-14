import { authFetch } from './authFetch.js';

const MEDIA_API = '/api/media';

// ─── Types ────────────────────────────────────────────────────────────────

export interface KlingVideoTask {
    taskId: string;
    status: string;
    statusMsg?: string;
    videoUrl?: string | null;
    videoId?: string | null;
    duration?: string | null;
}

export interface KlingFaceData {
    sessionId: string;
    faces: Array<{
        faceId: string;
        faceImage: string;
        startTime: number;
        endTime: number;
    }>;
}

// ─── API Calls ────────────────────────────────────────────────────────────

/**
 * Start an image-to-video generation task with Kling.
 */
export async function generateVideo(
    imageUrl: string,
    prompt: string,
    duration: '5' | '10' = '10',
    mode: 'std' | 'pro' = 'pro',
): Promise<KlingVideoTask> {
    const res = await authFetch(`${MEDIA_API}?op=kling-generate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, prompt, duration, mode }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Kling video generation failed: ${res.status}`);
    }
    return res.json();
}

/**
 * Poll a video generation task.
 */
export async function getVideoTask(taskId: string): Promise<KlingVideoTask> {
    const res = await authFetch(`${MEDIA_API}?op=kling-get-video&id=${encodeURIComponent(taskId)}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to get video task: ${res.status}`);
    }
    return res.json();
}

/**
 * Identify faces in a video for lip-sync.
 * Prefers videoId for Kling-generated videos; falls back to videoUrl.
 */
export async function identifyFace(videoUrl?: string, videoId?: string): Promise<KlingFaceData> {
    const res = await authFetch(`${MEDIA_API}?op=kling-identify-face`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl, videoId }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Face identification failed: ${res.status}`);
    }
    return res.json();
}

/**
 * Create a lip-sync task.
 */
export async function createLipSync(
    sessionId: string,
    faceId: string,
    audioUrl: string,
    soundStartMs: number = 0,
    soundEndMs: number = 10000,
    soundInsertMs: number = 0,
): Promise<KlingVideoTask> {
    const res = await authFetch(`${MEDIA_API}?op=kling-create-lipsync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, faceId, audioUrl, soundStartMs, soundEndMs, soundInsertMs }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Lip-sync creation failed: ${res.status}`);
    }
    return res.json();
}

/**
 * Poll a lip-sync task.
 */
export async function getLipSyncTask(taskId: string): Promise<KlingVideoTask> {
    const res = await authFetch(`${MEDIA_API}?op=kling-get-lipsync&id=${encodeURIComponent(taskId)}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to get lip-sync task: ${res.status}`);
    }
    return res.json();
}

/**
 * Start a multi-image-to-video generation task with Kling.
 */
export async function generateMultiVideo(
    images: string[],
    prompt: string,
    duration: '5' | '10' = '5',
    mode: 'std' | 'pro' = 'pro',
    aspectRatio: '16:9' | '9:16' | '1:1' = '16:9',
): Promise<KlingVideoTask> {
    const res = await authFetch(`${MEDIA_API}?op=kling-generate-multi-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, prompt, duration, mode, aspectRatio }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Multi-image video generation failed: ${res.status}`);
    }
    return res.json();
}

/**
 * Poll a multi-image video generation task.
 */
export async function getMultiVideoTask(taskId: string): Promise<KlingVideoTask> {
    const res = await authFetch(`${MEDIA_API}?op=kling-get-multi-video&id=${encodeURIComponent(taskId)}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to get multi-video task: ${res.status}`);
    }
    return res.json();
}

// ─── Polling Helpers ──────────────────────────────────────────────────────

const POLL_INTERVAL = 8000; // 8 seconds
const MAX_POLL_ATTEMPTS = 90; // ~12 minutes max

/**
 * Poll video generation until complete, returning the final task result.
 */
export async function pollVideoUntilComplete(
    taskId: string,
    onProgress?: (status: string) => void,
    useMultiImage: boolean = false,
): Promise<KlingVideoTask> {
    const getter = useMultiImage ? getMultiVideoTask : getVideoTask;
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        const result = await getter(taskId);

        if (result.status === 'succeed') return result;
        if (result.status === 'failed') {
            throw new Error(result.statusMsg || 'Video generation failed');
        }

        if (onProgress) onProgress(result.status || 'processing');
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    throw new Error('Video generation timed out');
}

/**
 * Poll lip-sync until complete, returning the final task result.
 */
export async function pollLipSyncUntilComplete(
    taskId: string,
    onProgress?: (status: string) => void,
): Promise<KlingVideoTask> {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        const result = await getLipSyncTask(taskId);

        if (result.status === 'succeed') return result;
        if (result.status === 'failed') {
            throw new Error(result.statusMsg || 'Lip-sync failed');
        }

        if (onProgress) onProgress(result.status || 'processing');
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    throw new Error('Lip-sync timed out');
}

const klingService = {
    generateVideo,
    getVideoTask,
    identifyFace,
    createLipSync,
    getLipSyncTask,
    generateMultiVideo,
    getMultiVideoTask,
    pollVideoUntilComplete,
    pollLipSyncUntilComplete,
};

export default klingService;
