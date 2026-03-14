/**
 * Video Overview Generator API
 * Creates slideshow videos using Gemini for images + TTS audio, assembled via Creatomate
 * 
 * Uses QStash for background processing to avoid Vercel timeout limits.
 * 
 * Operations:
 * - POST ?op=start - Queue a video overview job, returns jobId immediately
 * - GET ?op=status&jobId=xxx - Poll job status
 * - POST ?op=process - QStash callback to do the actual work (internal use)
 */
import { GoogleGenAI } from '@google/genai';
import { put } from '@vercel/blob';
import { requireAuth } from './_auth.js';
import { Client as QStashClient } from '@upstash/qstash';
import { executeKlingApi } from './kling-video.js';
import { postShotstackRender, getShotstackRender, ShotstackEdit, ShotstackClip } from './shotstackService.js';
import { synthesizeVoice } from './qwen-tts.js';

const CREATOMATE_BASE_URL = 'https://api.creatomate.com/v2';

const MODEL_PLAN = 'gemini-2.5-flash';
const MODEL_IMAGE_FAST = 'gemini-2.5-flash-image';
const MODEL_IMAGE_SMART = 'gemini-2.5-flash-image';
const MODEL_TTS = 'gemini-2.5-flash-preview-tts';
const MODEL_TTS_FALLBACK = 'gemini-2.5-pro-preview-tts';

// Environment variables
// Environment variables
const qstashToken = process.env.QSTASH_TOKEN;
const vercelBypassToken = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || process.env.VERCEL_PROTECTION_BYPASS || '';
// Prioritize APP_URL for correct origin, custom callback URL support
const appUrl = process.env.APP_URL ? (process.env.APP_URL.startsWith('http') ? process.env.APP_URL : `https://${process.env.APP_URL}`) : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

// Kling Avatar configuration
// Default public avatars provided by Kling or placeholders
const KLING_DEFAULT_AVATARS = [
    'https://p1-kling.klingai.com/kcdn/cdn-kcdn112452/kling-qa-test/pink_boy.png',
];

const KLING_FEMALE_AVATARS = [
    'https://p1-kling.klingai.com/kcdn/cdn-kcdn112452/kling-qa-test/pink_boy.png', // Placeholder
];

const KLING_MALE_AVATARS = [
    'https://p1-kling.klingai.com/kcdn/cdn-kcdn112452/kling-qa-test/pink_boy.png', // Placeholder
];

// Gemini TTS voices matched to gender
// Gemini TTS voices matched to gender
// Female voices
const GEMINI_FEMALE_VOICES = [
    'Achernar', 'Aoede', 'Autonoe', 'Callirrhoe', 'Despina', 'Erinome',
    'Gacrux', 'Kore', 'Laomedeia', 'Leda', 'Pulcherrima', 'Sulafat',
    'Vindemiatrix', 'Zephyr'
];

// Male voices
const GEMINI_MALE_VOICES = [
    'Achird', 'Algenib', 'Alnilam', 'Charon', 'Enceladus', 'Fenrir',
    'Iapetus', 'Orus', 'Puck', 'Rasalgethi', 'Sadachbia', 'Sadaltager',
    'Schedar', 'Umbriel', 'Zubenelgenubi'
];

type AvatarSelection = {
    avatarId: string;
    gender: 'female' | 'male';
    voiceName: string;
};

/**
 * Select a random avatar and matching voice
 * Falls back to env default if available
 */
function selectRandomAvatar(): AvatarSelection {
    // Randomly choose gender
    const gender = Math.random() < 0.5 ? 'female' : 'male';

    // Select random avatar from the appropriate pool
    const avatarPool = gender === 'female' ? KLING_FEMALE_AVATARS : KLING_MALE_AVATARS;
    const avatarId = avatarPool[Math.floor(Math.random() * avatarPool.length)];

    // Select random matching voice
    const voicePool = gender === 'female' ? GEMINI_FEMALE_VOICES : GEMINI_MALE_VOICES;
    const voiceName = voicePool[Math.floor(Math.random() * voicePool.length)];

    return { avatarId, gender, voiceName };
}

// Build QStash callback URL with optional Vercel protection bypass
const buildQStashUrl = (action: string) => {
    // Use 'action' to correspond with the new server logic and avoid Vercel rewrite issues
    const baseUrl = `${appUrl}/api/video-overview?action=${action}`;
    const finalUrl = vercelBypassToken ? `${baseUrl}&x-vercel-protection-bypass=${vercelBypassToken}` : baseUrl;

    // Debug logging to verify bypass token configuration
    console.log('[video-overview] QStash URL config:', {
        appUrl,
        action,
        hasVercelBypassToken: !!vercelBypassToken,
        tokenLength: vercelBypassToken?.length || 0,
        finalUrl: finalUrl.replace(vercelBypassToken || '', vercelBypassToken ? '[REDACTED]' : ''),
    });

    return finalUrl;
};

// Initialize QStash client
const qstash = qstashToken ? new QStashClient({ token: qstashToken }) : null;

type OverviewRequest = {
    projectId?: string;
    prompt?: string;
    aspect?: string;
    contextDescription?: string;
    slideCount?: number;
    voiceName?: string;
    avatarUrl?: string;
};

type CreatomateRender = {
    id: string;
    status: string;
    url?: string;
    snapshot_url?: string;
    output_format?: string;
    width?: number;
    height?: number;
    duration?: number;
    file_size?: number;
    error_message?: string | null;
};

type SlidePlan = {
    title: string;
    bullets: string[];
    imagePrompt: string;
    voiceover: string;
    durationSeconds: number;

};

type OverviewPlan = {
    voiceoverText: string;
    slides: SlidePlan[];
    totalDurationSeconds: number;
};

// Job state stored in Firestore
type VideoOverviewJob = {
    id: string;
    projectId: string; // Top-level for easier querying
    status: 'queued' | 'processing' | 'generating_script' | 'generating_audio' | 'generating_images' | 'assembling' | 'generating_avatar' | 'compositing' | 'completed' | 'failed';
    progress?: string;
    request: OverviewRequest;
    result?: {
        url: string;
        snapshotUrl?: string;
        durationSeconds?: number;
    };
    error?: string;
    createdAt: number;
    updatedAt: number;
    // Internal data for segmented processing
    internalData?: {
        plan?: OverviewPlan;
        audioUrl?: string;
        slideshowVideoUrl?: string; // Creatomate slideshow (without avatar)
        slideshowRenderId?: string; // Creatomate render ID (for polling)
        avatarVideoUrl?: string | null; // Final Avatar video URL
        avatarVideoId?: string | null; // Pending Avatar task ID for polling
        finalRenderId?: string; // Creatomate final render ID (for polling)
        slideImageUrls?: string[];


        avatarDone?: boolean;        // Flag: avatar step completed (success or failure)
        ownerUid?: string | null;
        width?: number;
        height?: number;
        aspectRatio?: string;
        // Random avatar/voice selection for this job
        selectedAvatarId?: string;
        selectedVoiceName?: string;
    };
};

// Payload for process callbacks (QStash)
type ProcessPayload = {
    jobId: string;
    step?: 'PLAN' | 'AUDIO' | 'IMAGE' | 'ASSEMBLY_SLIDES' | 'ASSEMBLY_POLL' | 'AVATAR_CREATE' | 'AVATAR_POLL' | 'FINAL_COMPOSITE' | 'FINAL_COMPOSITE_POLL';
    imageIndex?: number;
};

// Firestore persistence
let firestoreInitialized = false;
const ensureFirestore = async () => {
    if (firestoreInitialized) return;
    firestoreInitialized = true;

    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    if (getApps().length) return;

    const serviceAccount = JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
        process.env.FIREBASE_SERVICE_ACCOUNT ||
        process.env.FIREBASE_ADMIN_CREDENTIALS || '{}'
    );
    if (serviceAccount.client_email && serviceAccount.private_key) {
        initializeApp({
            credential: cert({
                projectId: serviceAccount.project_id || 'ffresearchr',
                clientEmail: serviceAccount.client_email,
                privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
            }),
        });
    }
};

const getJob = async (jobId: string): Promise<VideoOverviewJob | null> => {
    await ensureFirestore();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const doc = await db.collection('videoOverviewJobs').doc(jobId).get();
    if (!doc.exists) return null;
    return doc.data() as VideoOverviewJob;
};

const saveJob = async (job: VideoOverviewJob): Promise<void> => {
    await ensureFirestore();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    await db.collection('videoOverviewJobs').doc(job.id).set({
        ...job,
        updatedAt: Date.now(),
    });
};

const updateJobStatus = async (jobId: string, status: VideoOverviewJob['status'], progress?: string): Promise<void> => {
    await ensureFirestore();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const update: any = { status, updatedAt: Date.now() };
    if (progress !== undefined) update.progress = progress;
    await db.collection('videoOverviewJobs').doc(jobId).update(update);
};

const listProjectJobs = async (projectId: string): Promise<VideoOverviewJob[]> => {
    await ensureFirestore();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();

    const activeStatuses = ['queued', 'processing', 'generating_script', 'generating_audio', 'generating_images', 'assembling', 'generating_avatar', 'compositing'];

    try {
        console.log('[video-overview] listProjectJobs querying for projectId:', projectId);

        // Use simple query and filter in-memory to avoid Firebase index requirements
        // This is more flexible and works with both projectId and request.projectId
        const allJobs = await db.collection('videoOverviewJobs')
            .orderBy('createdAt', 'desc')
            .limit(100) // Increased limit to ensure we capture relevant jobs
            .get();

        const filtered = allJobs.docs
            .map(doc => doc.data() as VideoOverviewJob)
            .filter(job =>
                (job.projectId === projectId || job.request?.projectId === projectId) &&
                activeStatuses.includes(job.status)
            )
            .slice(0, 10); // Limit to 10 most recent after filtering

        console.log('[video-overview] listProjectJobs found', filtered.length, 'matching jobs');
        return filtered;
    } catch (e: any) {
        console.error('[video-overview] listProjectJobs query failed:', e?.message);
        return [];
    }
};


/**
 * Save an asset to the project's knowledgeBase in Firestore
 * This allows assets to appear in the appropriate tab (Blogs, Podcasts, Images, Videos)
 */
const saveAssetToProjectKnowledgeBase = async (
    projectId: string,
    ownerUid: string,
    asset: {
        name: string;
        type: string; // mime type like 'video/mp4', 'audio/wav', 'image/png', 'text/markdown'
        url: string;
        size?: number;
    }
): Promise<void> => {
    try {
        await ensureFirestore();
        const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
        const db = getFirestore();

        const kbFile = {
            id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: asset.name,
            type: asset.type,
            size: asset.size || 0,
            url: asset.url,
            storagePath: '', // Blob URL already public
            uploadedAt: Date.now(),
        };

        // Update the project document in Firestore
        const projectRef = db.collection('users').doc(ownerUid).collection('researchProjects').doc(projectId);
        await projectRef.update({
            knowledgeBase: FieldValue.arrayUnion(kbFile),
            lastModified: Date.now(),
        });

        console.log(`[video-overview] Saved asset to project knowledgeBase: ${asset.name}`);
    } catch (e: any) {
        console.error(`[video-overview] Failed to save asset to knowledgeBase:`, e?.message);
        // Non-fatal error - don't throw, just log
    }
};

/**
 * Helper function to complete a job with the final video URL
 * Saves to assets and marks job completed
 */
const completeJobWithVideo = async (
    jobId: string,
    job: VideoOverviewJob,
    videoUrl: string
): Promise<void> => {
    const { internalData, request } = job;
    const projectId = (request.projectId || '').trim();
    const prompt = (request.prompt || '').trim();
    const ownerUid = internalData?.ownerUid;

    // Save final video to project assets
    if (ownerUid) {
        await saveAssetToProjectKnowledgeBase(projectId, ownerUid, {
            name: `Video Overview - ${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}.mp4`,
            type: 'video/mp4',
            url: videoUrl,
        });
    }

    // Mark job completed
    const updatedJob: VideoOverviewJob = {
        ...job,
        status: 'completed',
        result: {
            url: videoUrl,
            snapshotUrl: null,
            durationSeconds: internalData?.plan?.totalDurationSeconds || 0,
        },
        updatedAt: Date.now(),
    };
    await saveJob(updatedJob);
    console.log(`[video-overview] Job ${jobId} completed with video:`, videoUrl);
};

/**
 * Get the owner UID for a project from Firestore
 */
const getProjectOwnerUid = async (projectId: string): Promise<string | null> => {
    try {
        await ensureFirestore();
        const { getFirestore } = await import('firebase-admin/firestore');
        const db = getFirestore();

        // Search for the project across all users
        const usersSnapshot = await db.collection('users').get();
        for (const userDoc of usersSnapshot.docs) {
            const projectDoc = await db.collection('users').doc(userDoc.id).collection('researchProjects').doc(projectId).get();
            if (projectDoc.exists) {
                return userDoc.id;
            }
        }
        return null;
    } catch (e) {
        console.error('[video-overview] Failed to get project owner:', e);
        return null;
    }
};

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const errorResponse = (message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const generateJobId = () =>
    `vo_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

const getCreatomateApiKey = (): string => {
    const key = process.env.CREATOMATE_API_KEY;
    if (!key) throw new Error('Missing CREATOMATE_API_KEY environment variable');
    return key;
};

const getGeminiKey = (): string => {
    const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!key) throw new Error('Missing GEMINI_API_KEY environment variable');
    return key;
};

const getBlobToken = (): string | undefined =>
    process.env.BLOB_READ_WRITE_TOKEN_FOR_FRONTEND ||
    process.env.BLOB_READ_WRITE_TOKEN_FOR_FRONTENT ||
    process.env.researcher_READ_WRITE_TOKEN ||
    process.env.BLOB_READ_WRITE_TOKEN ||
    undefined;

const parseAspect = (aspect?: string): { width: number; height: number; aspectRatio: '16:9' | '9:16' } => {
    const fallback = { width: 1280, height: 720, aspectRatio: '16:9' as const };
    if (!aspect) return fallback;
    const m = aspect.match(/^(\d+)x(\d+)$/);
    if (!m) return fallback;
    const width = parseInt(m[1], 10);
    const height = parseInt(m[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback;
    const aspectRatio: '16:9' | '9:16' = width >= height ? '16:9' : '9:16';
    return { width, height, aspectRatio };
};

const toDataUrl = (base64: string, mimeType = 'image/png') => `data:${mimeType};base64,${base64}`;

const parseDataUrl = (dataUrl: string): { mimeType: string; base64: string } => {
    const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    return { mimeType: match[1] || 'application/octet-stream', base64: match[2] || '' };
};

async function postRender(script: any): Promise<CreatomateRender> {
    const apiKey = getCreatomateApiKey();
    const res = await fetch(`${CREATOMATE_BASE_URL}/renders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(script),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Creatomate render create failed: ${res.status} ${text}`);
    }

    return (await res.json()) as CreatomateRender;
}

async function getRender(id: string): Promise<CreatomateRender> {
    const apiKey = getCreatomateApiKey();
    const res = await fetch(`${CREATOMATE_BASE_URL}/renders/${id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Creatomate get render failed: ${res.status} ${text}`);
    }

    return (await res.json()) as CreatomateRender;
}

// pollCreatomateRenderUntilComplete removed - replaced by non-blocking poll steps

// ---------------------------------------------------------
// HeyGen API Helpers
// ---------------------------------------------------------

// Note: uploadAudioToHeyGen removed - using audio_url directly in V2 API instead

/**
 * Create an avatar video with HeyGen using V2 API with video background
 * Uses the Creatomate slideshow as background and overlays the avatar
 */
/**
 * Create an avatar video with Kling AI
 */
async function createKlingAvatarVideo(
    avatarImageUrl: string,
    audioUrl: string
): Promise<string> {
    console.log('[video-overview] [KLING] Creating avatar video with image:', avatarImageUrl);

    const result = await executeKlingApi('/v1/videos/avatar/image2video', 'POST', {
        image: avatarImageUrl,
        sound_file: audioUrl,
        prompt: 'While speaking, maintain natural head movements and subtle facial expressions. Occasionally nod and use gentle hand gestures as if presenting to an audience.',
        mode: 'std', // 'std' or 'pro'
    });

    if (!result.data?.task_id) {
        throw new Error('Kling API did not return task_id');
    }

    console.log('[video-overview] [KLING] Created task, task_id:', result.data.task_id);
    return result.data.task_id;
}

/**
 * Poll Kling video status until complete
 */
async function pollKlingAvatarVideo(
    taskId: string,
    { pollMs = 5000, timeoutMs = 600000 }: { pollMs?: number; timeoutMs?: number } = {},
): Promise<string> {
    const start = Date.now();

    while (true) {
        const result = await executeKlingApi(`/v1/videos/avatar/image2video/${taskId}`, 'GET');
        const data = result.data;
        const status = data?.task_status;

        console.log(`[video-overview] [KLING] Task ${taskId} status: ${status}`);

        if (status === 'succeed' || status === 'completed' || status === 'success') { // Kling status can vary? Docs say 'succeed'? Checking kling-video.ts it says 'task_status'. Assume standard values.
            // Based on kling-video.ts handleGetVideoTask, it returns data.task_result.videos[0].url
            const videoUrl = data?.task_result?.videos?.[0]?.url;
            if (!videoUrl) {
                throw new Error('Kling task succeeded but no video_url returned');
            }
            return videoUrl;
        }

        if (status === 'failed' || status === 'error') {
            throw new Error(`Kling video generation failed: ${data?.task_status_msg || 'Unknown error'}`);
        }

        if (Date.now() - start > timeoutMs) {
            throw new Error(`Kling video timeout after ${timeoutMs}ms (last status: ${status})`);
        }

        await new Promise((r) => setTimeout(r, pollMs));
    }
}

/**
 * Generate the video overview script plan using Gemini
 */
async function generateOverviewPlan(userPrompt: string, context: string, slideCount: number): Promise<OverviewPlan> {
    const apiKey = getGeminiKey();
    const client = new GoogleGenAI({ apiKey });

    const targetSecondsPerSlide = 8; // Reduced from 10 to keep under 2 min
    const totalTargetSeconds = Math.min(slideCount * targetSecondsPerSlide, 100); // Cap at 100s
    const hardMaxSeconds = 120; // Absolute maximum (HeyGen limit is 180s, using 120s for safety)

    const prompt = `You are generating a VIDEO OVERVIEW script that will be turned into a narrated slideshow video.

CRITICAL DIRECTIVE:
The script MUST be directly driven by the following user prompt, using the provided Project Context to inform the details, statistics, and narrative. Do not just blindly summarize the context; craft a narrative that answers the user's specific prompt.

USER PROMPT:
"${userPrompt}"

CRITICAL DURATION CONSTRAINT:
- The TOTAL narration MUST NOT EXCEED ${hardMaxSeconds} seconds when spoken.
- Target: ~${totalTargetSeconds} seconds total
- This is a HARD LIMIT. The video will fail if longer than ${hardMaxSeconds}s.

Requirements:
- Output JSON only.
- Create EXACTLY ${slideCount} slides.
- Each slide should be ~${targetSecondsPerSlide} seconds of narration (brief and concise).
- Each slide must have:
  - title (short, 3-6 words)
  - bullets (2-3 SHORT bullet points, max 8 words each)
  - voiceover (BRIEF narration, 1-2 sentences max, ~${targetSecondsPerSlide}s when spoken at normal pace)
  - durationSeconds (estimated speaking duration, typically ${targetSecondsPerSlide}-${targetSecondsPerSlide + 2})
  - imagePrompt (detailed visual prompt for generating a 16:9 slide background image. REQUIREMENTS:
    * CRITICAL: Keep the CENTER of the image CLEAR/EMPTY - an avatar will be placed there. Place all text, graphics, and key visual elements on the LEFT and RIGHT SIDES only.
    * The slide title/headline MUST be incorporated NATURALLY and CREATIVELY into the scene on the LEFT or RIGHT side - for example as signage, a billboard, projected text, neon lights, carved in stone, written on a whiteboard, displayed on a screen, etc.
    * The visual scene MUST directly represent the key topic/point of that slide in a relevant and creative way.
    * Use a MIX of visual styles throughout the slides - alternate between: photorealistic real-world scenes, professional infographics with icons and data, business diagrams and flowcharts, charts/graphs with data visualizations, modern presentation slide aesthetics.
    * Make the title text large, high-contrast, and clearly legible within the scene.
    * The overall aesthetic should be modern, professional, and visually striking.)
- Also generate a single voiceoverText that is the FULL concatenation of all slide voiceovers.
- Keep the tone clear, professional, and executive-summary-like, while specifically addressing the User Prompt.
- BE CONCISE: Prioritize key insights over comprehensive coverage.
- Prefer concrete claims and numbers when present in the context.
- Keep bullets short enough to fit on-screen.

PROJECT CONTEXT:
"""
${(context || '').trim().slice(0, 12000)}
"""

Return ONLY valid JSON:
{
  "voiceoverText": "...",
  "totalDurationSeconds": ${totalTargetSeconds},
  "slides": [
    { "title": "...", "bullets": ["...", "..."], "voiceover": "...", "durationSeconds": ${targetSecondsPerSlide}, "imagePrompt": "..." }
  ]
}`;

    const response = await client.models.generateContent({
        model: MODEL_PLAN,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { temperature: 0.7, maxOutputTokens: 8000 },
    });

    const text = (response.text || '').trim();
    let cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = cleanJson.indexOf('{');
    const end = cleanJson.lastIndexOf('}');
    if (start !== -1 && end !== -1) cleanJson = cleanJson.substring(start, end + 1);

    const parsed = JSON.parse(cleanJson) as OverviewPlan;
    if (!parsed?.voiceoverText || !Array.isArray(parsed.slides)) {
        throw new Error('Invalid overview plan returned from Gemini');
    }

    for (const slide of parsed.slides) {
        if (!slide?.title || !Array.isArray(slide?.bullets) || !slide?.imagePrompt || !slide?.voiceover) {
            throw new Error('Invalid slide structure returned from Gemini');
        }
    }

    return parsed;
}

/**
 * Helper to wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutErrorMsg: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutErrorMsg)), ms)),
    ]);
}

/**
 * Generate image using Gemini (with fallback)
 */
async function generateGeminiImageDataUrl(prompt: string, aspectRatio: '16:9' | '9:16'): Promise<string> {
    const apiKey = getGeminiKey();
    const client = new GoogleGenAI({ apiKey });

    const attemptModel = async (model: string) => {
        const response = await withTimeout(
            client.models.generateContent({
                model,
                contents: { parts: [{ text: prompt }] },
                config: {
                    responseModalities: ['TEXT', 'IMAGE'],
                    imageConfig: {
                        aspectRatio,
                        ...(model === MODEL_IMAGE_SMART ? { imageSize: '1K' } : {}),
                    },
                },
            }),
            120000, // 120s timeout per attempt
            `Gemini image generation timeout for ${model}`
        );

        const candidateParts = (response as any)?.candidates?.[0]?.content?.parts || [];
        for (const part of candidateParts) {
            if (part?.inlineData?.data) {
                return toDataUrl(part.inlineData.data, part.inlineData.mimeType || 'image/png');
            }
        }
        throw new Error('No inline image returned from Gemini');
    };

    try {
        return await attemptModel(MODEL_IMAGE_SMART);
    } catch (e) {
        console.warn(`[video-overview] Smart image model (${MODEL_IMAGE_SMART}) failed, falling back to fast model (${MODEL_IMAGE_FAST})`, e);
        // Second attempt with faster model
        return attemptModel(MODEL_IMAGE_FAST);
    }
}

/**
 * Generate voiceover audio using Gemini TTS
 */
async function generateGeminiTTSAudio(
    text: string,
    voiceName: string = 'Kore'
): Promise<{ audioData: string; mimeType: string, durationSeconds: number }> {
    const apiKey = getGeminiKey();
    const client = new GoogleGenAI({ apiKey });

    const styledPrompt = `# AUDIO PROFILE: Professional Video Narrator
## "The Overview Presenter"

### DIRECTOR'S NOTES
Style: Confident, warm, and engaging professional presenter. Clear enunciation with a conversational yet authoritative delivery. Think TED Talk speaker — informative but approachable.

Pacing: Moderate, well-paced delivery with natural pauses between key points. Not rushed, not slow — conversational tempo that keeps listeners engaged.

### TRANSCRIPT
${text}`;

    const tryModels = [MODEL_TTS, MODEL_TTS_FALLBACK];
    let response: any;
    let pcmData: string | null = null;

    for (const model of tryModels) {
        try {
            response = await client.models.generateContent({
                model,
                contents: [{ parts: [{ text: styledPrompt }] }],
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName }
                        }
                    }
                } as any
            });

            const parts = (response as any)?.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
                if (part?.inlineData?.data) {
                    pcmData = part.inlineData.data;
                    break;
                }
            }
            if (pcmData) break;
        } catch (e) {
            console.warn(`[video-overview] TTS model ${model} failed, trying next...`, e);
        }
    }

    if (!pcmData) {
        throw new Error('No audio data received from Gemini TTS');
    }

    // Convert PCM to WAV
    const pcmBytes = Uint8Array.from(atob(pcmData), c => c.charCodeAt(0));
    const wavBytes = pcmToWav(pcmBytes, 24000, 1, 16);

    // Convert to base64 in chunks
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < wavBytes.length; i += chunkSize) {
        const chunk = wavBytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    const wavBase64 = btoa(binary);

    // Calculate exact duration of the audio in seconds
    // pcmBytes consists of 16-bit samples (2 bytes per sample) at 24000Hz (1 channel)
    const durationSeconds = pcmBytes.length / (24000 * 2);

    return { audioData: wavBase64, mimeType: 'audio/wav', durationSeconds };
}

/**
 * Convert PCM to WAV format
 */
function pcmToWav(pcmData: Uint8Array, sampleRate: number, channels: number, bitsPerSample: number): Uint8Array {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataLength = pcmData.length;
    const headerLength = 44;
    const totalLength = headerLength + dataLength;

    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // PCM data
    const output = new Uint8Array(buffer);
    output.set(pcmData, headerLength);

    return output;
}

function writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

/**
 * Upload data URL to Vercel Blob
 */
async function uploadDataUrlToBlob(projectId: string, filename: string, dataUrl: string): Promise<string> {
    const { mimeType, base64 } = parseDataUrl(dataUrl);
    const buffer = Buffer.from(base64, 'base64');
    const blob = new Blob([buffer], { type: mimeType });
    const pathname = `projects/${projectId}/${filename}`;
    const stored = await put(pathname, blob, {
        access: 'public',
        addRandomSuffix: true,
        token: getBlobToken(),
    });
    return stored.url;
}

/**
 * Upload raw base64 audio to Vercel Blob
 */
async function uploadAudioToBlob(projectId: string, filename: string, base64Audio: string, mimeType: string): Promise<string> {
    const buffer = Buffer.from(base64Audio, 'base64');
    const blob = new Blob([buffer], { type: mimeType });
    const pathname = `projects/${projectId}/${filename}`;
    const stored = await put(pathname, blob, {
        access: 'public',
        addRandomSuffix: true,
        token: getBlobToken(),
    });
    return stored.url;
}

/**
 * Re-upload a video from a remote URL to Vercel Blob for stable public access.
 * Kling CDN URLs are temporary/signed and may not be accessible to third-party services like Creatomate.
 */
async function reuploadVideoToBlob(projectId: string, sourceUrl: string, label: string): Promise<string> {
    console.log(`[video-overview] [REUPLOAD] Downloading ${label} video for re-upload...`);
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`Failed to download ${label} video: ${res.status}`);
    const videoBlob = await res.blob();
    const pathname = `projects/${projectId}/${label}-${Date.now()}.mp4`;
    const stored = await put(pathname, videoBlob, {
        access: 'public',
        addRandomSuffix: true,
        token: getBlobToken(),
    });
    console.log(`[video-overview] [REUPLOAD] ${label} video re-uploaded to: ${stored.url}`);
    return stored.url;
}

/**
 * Build Creatomate RenderScript for video overview
 */
function buildOverviewRenderScript(params: {
    width: number;
    height: number;
    audioUrl: string;
    avatarVideoUrl?: string | null;
    slides: { imageUrl: string; title: string; bullets: string[]; durationSeconds: number }[];
}): any {
    const { width, height, audioUrl, avatarVideoUrl, slides } = params;

    console.log('[buildOverviewRenderScript] Called with avatarVideoUrl:', avatarVideoUrl || 'null/undefined');

    let currentTime = 0;
    const timedSlides = slides.map((slide, idx) => {
        const startTime = currentTime;
        currentTime += slide.durationSeconds;
        return { ...slide, startTime, idx };
    });

    const totalDuration = currentTime;

    const script: any = {
        output_format: 'mp4',
        width,
        height,
        duration: totalDuration,
        elements: [] as any[],
    };

    // Add audio track (muted - Kling avatar will provide audio with lip-sync)
    script.elements.push({
        type: 'audio',
        track: 1,
        time: 0,
        source: audioUrl,
        duration: totalDuration,
        volume: '100%', // Enabled for fallback; Shotstack will mute if avatar exists
        audio_fade_out: 1.5,
    });

    // Add image slides on track 2
    timedSlides.forEach((slide, idx) => {
        const sceneElements: any[] = [];

        // Background image with zoom effect
        sceneElements.push({
            type: 'image',
            source: slide.imageUrl,
            fit: 'cover',
            clip: true,
            animations: [
                {
                    easing: 'linear',
                    type: 'scale',
                    scope: 'element',
                    start_scale: '112%',
                    end_scale: '100%',
                    fade: false,
                },
            ],
        });

        // Dark overlay
        sceneElements.push({
            type: 'shape',
            x: '50%',
            y: '50%',
            width: '100%',
            height: '100%',
            fill_color: 'rgba(0,0,0,0.22)',
        });


        const scene: any = {
            type: 'composition',
            name: `Scene-${idx + 1}`,
            track: 2,
            time: slide.startTime,
            duration: slide.durationSeconds,
            elements: sceneElements,
        };

        // Add fade transition for slides after the first
        if (idx > 0) {
            scene.animations = [
                {
                    time: 0,
                    duration: 0.6,
                    easing: 'cubic-in-out',
                    transition: true,
                    type: 'fade',
                    enable: 'second-only',
                },
            ];
        }

        script.elements.push(scene);
    });

    // Avatar is no longer overlaid here - it's handled by Kling as a video background
    // in the final step where the slideshow becomes the background for the avatar

    return script;
}

// ---------------------------------------------------------
// B-Roll + Stock Video Helpers
// ---------------------------------------------------------

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';



/**
 * Build Creatomate RenderScript for the final composite:
 * - Track 1: Slideshow video (Visuals background)
 * - Track 2: Kling Avatar video (PiP overlay + Audio)
 * - Track 3: Subtitle text element
 */
function buildFinalCompositeScript(params: {
    width: number;
    height: number;
    avatarVideoUrl?: string | null;
    slideshowVideoUrl: string; // The base visual layer
    plan: OverviewPlan;
}): any {
    const { width, height, avatarVideoUrl, slideshowVideoUrl, plan } = params;

    const totalDuration = plan.totalDurationSeconds || plan.slides.reduce((sum, s) => sum + s.durationSeconds, 0);

    const elements: any[] = [];

    // Track 1: Slideshow Video (Visuals, Muted if avatar present)
    elements.push({
        name: 'Slideshow-Video',
        type: 'video',
        track: 1,
        time: 0,
        duration: totalDuration,
        source: slideshowVideoUrl,
        volume: avatarVideoUrl ? '0%' : '100%', // Mute slideshow if avatar provides audio
        // Fill screen
        x: '50%',
        y: '50%',
        width: '100%',
        height: '100%',
    });

    // Track 2: Avatar Video (Audio + PiP Visual)
    if (avatarVideoUrl) {
        elements.push({
            name: 'Avatar-Video',
            type: 'video',
            track: 2,
            time: 0,
            // duration: undefined, // Omit to let Creatomate use full source duration
            source: avatarVideoUrl,
            // Picture-in-Picture Styling
            width: '28vmin', // Slightly larger for visibility
            height: '28vmin',
            x: '85%', // Bottom Right
            y: '78%',
            x_alignment: '50%',
            y_alignment: '50%',
            border_radius: '50%',
            stroke_color: '#ffffff',
            stroke_width: '4px',
            shadow_color: 'rgba(0,0,0,0.5)',
            shadow_blur: '20px',
            animations: [
                {
                    time: 0,
                    duration: 0.5,
                    easing: 'cubic-out',
                    type: 'scale',
                    start_scale: '0%',
                    end_scale: '100%',
                }
            ]
        });
    }

    // Track 3: Subtitles
    elements.push({
        type: 'text',
        track: 3,
        time: 0,
        duration: totalDuration,
        x: '50%',
        y: '88%',
        width: '90%',
        height: '15%',
        x_alignment: '50%',
        y_alignment: '50%',
        fill_color: '#ffffff',
        font_family: 'Inter',
        font_weight: 700,
        font_size_minimum: '2 vmin',
        font_size_maximum: '5.5 vmin',
        background_color: 'rgba(0,0,0,0.65)',
        background_x_padding: '60%',
        background_y_padding: '40%',
        background_border_radius: '20%',
        // Use Avatar-Video for transcript if available, else Slideshow-Video
        transcript_source: avatarVideoUrl ? 'Avatar-Video' : 'Slideshow-Video',
        transcript_effect: 'karaoke',
        transcript_split: 'word',
        transcript_placement: 'animate',
        transcript_maximum_length: 40,
        transcript_color: '#FFD700',
    });

    return {
        output_format: 'mp4',
        width,
        height,
        duration: totalDuration,
        elements,
    };
}



// ---------------------------------------------------------
// Job Steps
// ---------------------------------------------------------

// ---------------------------------------------------------
// Job Steps
// ---------------------------------------------------------



async function processVideoOverviewJob(payload: ProcessPayload): Promise<void> {
    const { jobId, step = 'PLAN', imageIndex = 0 } = payload;
    console.log(`[video-overview] Processing step ${step} for job ${jobId}`);

    // IMMEDIATELY update status to prevent "stuck in queued" if worker crashes/timeouts
    // Only do this for the initial PLAN step to mark the transition from queued -> active
    if (step === 'PLAN') {
        await updateJobStatus(jobId, 'generating_script', 'Starting job processing...');
    }

    try {
        switch (step) {
            case 'PLAN':
                await processStepPlan(jobId);
                break;
            case 'AUDIO':
                await processStepAudio(jobId);
                break;
            case 'IMAGE':
                await processStepImage(jobId, imageIndex);
                break;

            case 'ASSEMBLY_SLIDES':
                await processStepAssemblySlides(jobId);
                break;
            case 'ASSEMBLY_POLL': // New polling step
                await processStepAssemblyPoll(jobId);
                break;

            case 'AVATAR_CREATE':
                await processStepAvatarCreate(jobId);
                break;
            case 'AVATAR_POLL':
                await processStepAvatarPoll(jobId);
                break;

            case 'FINAL_COMPOSITE':
                await processStepFinalComposite(jobId);
                break;
            case 'FINAL_COMPOSITE_POLL': // New polling step
                await processStepFinalCompositePoll(jobId);
                break;

            default:
                console.error(`[video-overview] Unknown step: ${step}`);
        }
    } catch (error: any) {
        console.error(`[video-overview] Uncaught error in processVideoOverviewJob (step ${step}):`, error);
        await markJobFailed(jobId, error?.message || `Crash during step ${step}`);
    }
}

/**
 * Step PLAN: Generate script plan, save to job, trigger AUDIO
 */
async function processStepPlan(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    try {
        const { request } = job;
        const projectId = (request.projectId || '').trim();
        const prompt = (request.prompt || '').trim();

        const slideCount = typeof request.slideCount === 'number' && request.slideCount > 0 && request.slideCount <= 20
            ? Math.floor(request.slideCount)
            : 12;

        // Enforce 720p resolution to avoid HeyGen plan limits
        // const { width, height, aspectRatio } = parseAspect(request.aspect);
        const aspectRatio = request.aspect === '9:16' ? '9:16' : '16:9';
        const width = aspectRatio === '9:16' ? 720 : 1280;
        const height = aspectRatio === '9:16' ? 1280 : 720;
        const ownerUid = await getProjectOwnerUid(projectId);

        // Generate script
        await updateJobStatus(jobId, 'generating_script', 'Generating script plan...');
        console.log('[video-overview] [PLAN] Generating script plan...');
        const plan = await generateOverviewPlan(prompt, request.contextDescription || '', slideCount);

        // Save script to Blogs
        if (ownerUid) {
            const scriptContent = `# Video Overview Script\n\n**Prompt:** ${prompt}\n\n## Full Narration\n\n${plan.voiceoverText}\n\n## Slides\n\n${plan.slides.map((s, i) => `### Slide ${i + 1}: ${s.title}\n\n${s.bullets.map(b => `- ${b}`).join('\n')}\n\n*Voiceover:* ${s.voiceover}\n`).join('\n')}`;
            const scriptBuffer = Buffer.from(scriptContent, 'utf-8');
            const stored = await put(`projects/${projectId}/overview-script-${Date.now()}.md`, scriptBuffer, {
                access: 'public',
                addRandomSuffix: true,
                token: getBlobToken(),
            });
            await saveAssetToProjectKnowledgeBase(projectId, ownerUid, {
                name: `Overview Script - ${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}.md`,
                type: 'text/markdown',
                url: stored.url,
                size: scriptContent.length,
            });
        }

        // Select random avatar or use custom upload
        let avatarSelection = selectRandomAvatar();

        if (request.avatarUrl) {
            console.log('[video-overview] [PLAN] Using custom user avatar:', request.avatarUrl);
            avatarSelection.avatarId = request.avatarUrl;

            // NEW: Multimodal voice selection based on avatar photo analysis
            if (!request.voiceName) {
                try {
                    const analyzedVoice = await selectVoiceForAvatarImage(request.avatarUrl);
                    avatarSelection.voiceName = analyzedVoice;
                } catch (e) {
                    console.warn('[video-overview] [PLAN] Multimodal voice selection failed, staying with random', e);
                }
            }
        }

        if (request.voiceName) {
            avatarSelection.voiceName = request.voiceName;
        }

        console.log(`[video-overview] [PLAN] Selected avatar: ${avatarSelection.avatarId}, voice: ${avatarSelection.voiceName}`);

        // Save plan to job and trigger AUDIO step
        const updatedJob: VideoOverviewJob = {
            ...job,
            status: 'generating_audio',
            progress: 'Plan complete, generating audio...',
            internalData: {
                plan,
                slideImageUrls: [],
                ownerUid: ownerUid || null,
                width,
                height,
                aspectRatio,
                selectedAvatarId: avatarSelection.avatarId,
                selectedVoiceName: avatarSelection.voiceName,
            },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);

        console.log('[video-overview] [PLAN] Triggering AUDIO step');
        await triggerNextStep(jobId, 'AUDIO');

    } catch (error: any) {
        console.error(`[video-overview] [PLAN] Job ${jobId} failed:`, error);
        await markJobFailed(jobId, error?.message || 'Unknown error in PLAN');
    }
}

/**
 * Step AUDIO: Generate TTS audio, save to job, trigger first IMAGE
 */
async function processStepAudio(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    const { internalData, request } = job;
    if (!internalData?.plan) {
        await markJobFailed(jobId, 'Missing plan data in AUDIO step');
        return;
    }

    try {
        const { plan, ownerUid, width, height, aspectRatio, selectedVoiceName } = internalData;
        const projectId = (request.projectId || '').trim();
        const prompt = (request.prompt || '').trim();
        // Use selected voice from avatar selection, fallback to request or default
        const voiceName = selectedVoiceName || request.voiceName || 'Kore';
        console.log(`[video-overview] [AUDIO] Using TTS voice: ${voiceName}`);

        // Generate TTS audio
        await updateJobStatus(jobId, 'generating_audio', 'Generating voiceover audio...');
        console.log('[video-overview] [AUDIO] Generating TTS audio...');

        let audioData: string;
        let mimeType: string;
        let trueAudioDuration: number;

        if (voiceName.startsWith('cloned:')) {
            const rawVoiceId = voiceName.substring('cloned:'.length);
            console.log(`[video-overview] [AUDIO] Using cloned Qwen TTS voice: ${rawVoiceId}`);
            try {
                const qwenResult = await synthesizeVoice(plan.voiceoverText, rawVoiceId);
                audioData = qwenResult.audioData;
                mimeType = qwenResult.mimeType;
                trueAudioDuration = qwenResult.durationSeconds;
            } catch (err: any) {
                console.warn('[video-overview] [AUDIO] Qwen TTS failed, falling back to Gemini (Kore)', err);
                const geminiFallback = await generateGeminiTTSAudio(plan.voiceoverText, 'Kore');
                audioData = geminiFallback.audioData;
                mimeType = geminiFallback.mimeType;
                trueAudioDuration = geminiFallback.durationSeconds;
            }
        } else {
            const geminiResult = await generateGeminiTTSAudio(plan.voiceoverText, voiceName);
            audioData = geminiResult.audioData;
            mimeType = geminiResult.mimeType;
            trueAudioDuration = geminiResult.durationSeconds;
        }

        const audioUrl = await uploadAudioToBlob(projectId, `overview-audio-${Date.now()}.wav`, audioData, mimeType);

        // Synchronize slide durations to match the true audio length
        console.log(`[video-overview] [AUDIO] Synchronizing slides to audio length (${trueAudioDuration.toFixed(2)}s)`);
        const estimatedTotal = plan.slides.reduce((sum, s) => sum + (s.durationSeconds || 10), 0);
        const ratio = trueAudioDuration / estimatedTotal;

        let accumulatedDuration = 0;
        const syncedSlides = plan.slides.map((s, index) => {
            // Apply ratio for all slides
            let newDuration = (s.durationSeconds || 10) * ratio;

            // Adjust the final slide to ensure exact match (prevent rounding drift)
            if (index === plan.slides.length - 1) {
                newDuration = trueAudioDuration - accumulatedDuration;
            }

            accumulatedDuration += newDuration;
            return { ...s, durationSeconds: newDuration };
        });

        const syncedPlan = {
            ...plan,
            totalDurationSeconds: trueAudioDuration,
            slides: syncedSlides
        };

        // Save audio to Podcasts
        if (ownerUid) {
            const audioBuffer = Buffer.from(audioData, 'base64');
            await saveAssetToProjectKnowledgeBase(projectId, ownerUid, {
                name: `Overview Voiceover - ${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}.wav`,
                type: 'audio/wav',
                url: audioUrl,
                size: audioBuffer.length,
            });
        }

        // Save audio URL and synced plan to job and trigger IMAGE step
        const updatedJob: VideoOverviewJob = {
            ...job,
            status: 'generating_images',
            progress: 'Generating slide 1...',
            internalData: {
                ...internalData,
                plan: syncedPlan,
                audioUrl,
            },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);

        console.log('[video-overview] [AUDIO] Triggering IMAGE step');
        await triggerNextStep(jobId, 'IMAGE', 0);



    } catch (error: any) {
        console.error(`[video-overview] [AUDIO] Job ${jobId} failed:`, error);
        await markJobFailed(jobId, error?.message || 'Unknown error in AUDIO');
    }
}




// ... existing imports ...

// ---------------------------------------------------------
// Helper: Gemini Green Screen
// ---------------------------------------------------------

/**
 * Generate a green screen version of the avatar image using Gemini Image-to-Image
 */
async function generateGeminiGreenScreenImage(originalImageUrl: string): Promise<string> {
    const apiKey = getGeminiKey();
    const client = new GoogleGenAI({ apiKey });

    // Download original image to pass to Gemini
    const imageResp = await fetch(originalImageUrl);
    if (!imageResp.ok) throw new Error(`Failed to download avatar image: ${imageResp.statusText}`);
    const imageBuffer = await imageResp.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');

    // Download pure green background reference image
    const greenBgUrl = 'https://cI6wjaC8e4NWiqIn.public.blob.vercel-storage.com/green.png';
    const bgResp = await fetch(greenBgUrl);
    if (!bgResp.ok) throw new Error(`Failed to download green background reference: ${bgResp.statusText}`);
    const bgBuffer = await bgResp.arrayBuffer();
    const base64BgImage = Buffer.from(bgBuffer).toString('base64');

    const promptText = "Replace the entire background of this image with a solid green background using the exact hex code #00b140. Use the provided green reference image only if necessary to match the hue. The subject (person) must remain perfectly intact, preserving their face, clothing, and full body outline. Ensure clean, sharp edges around the subject with no color bleeding or halos. The new background must be purely #00b140.";

    const attemptModel = async (model: string) => {
        const result = await withTimeout(
            client.models.generateContent({
                model,
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: promptText },
                            {
                                inlineData: {
                                    mimeType: 'image/png', // Reference Background
                                    data: base64BgImage
                                }
                            },
                            {
                                inlineData: {
                                    mimeType: 'image/png', // Original Avatar
                                    data: base64Image
                                }
                            }
                        ]
                    }
                ],
                config: {
                    responseModalities: ['IMAGE'], // Only return the resulting image
                    imageConfig: {
                        imageSize: '1K', // High res for avatar
                        aspectRatio: '1:1', // Avatars are usually square/portrait
                    }
                },
            }),
            120000,
            `Gemini green screen generation timeout for ${model}`
        );

        const candidateParts = (result as any)?.candidates?.[0]?.content?.parts || [];
        for (const part of candidateParts) {
            if (part?.inlineData?.data) {
                return toDataUrl(part.inlineData.data, part.inlineData.mimeType || 'image/png');
            }
        }
        throw new Error('No inline image returned from Gemini');
    };

    try {
        console.log('[video-overview] Generating green screen avatar with Gemini...');
        return await attemptModel(MODEL_IMAGE_SMART);
    } catch (e) {
        console.warn('[video-overview] Gemini Green Screen failed with Pro, trying Flash', e);
        return await attemptModel(MODEL_IMAGE_FAST);
    }
}

/**
 * Analyze an avatar image using Gemini Multimodal to select the best TTS voice.
 */
async function selectVoiceForAvatarImage(avatarUrl: string): Promise<string> {
    const apiKey = getGeminiKey();
    const client = new GoogleGenAI({ apiKey });

    // Download avatar image
    const imageResp = await fetch(avatarUrl);
    if (!imageResp.ok) throw new Error(`Failed to download avatar for voice analysis: ${imageResp.statusText}`);
    const imageBuffer = await imageResp.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');

    const voicesPrompt = `
Analyze this person's photo and select the most appropriate text-to-speech voice from the list below.
Consider their estimated gender, age, and personality/vibe.

Female Voices:
- Achernar: Soft
- Aoede: Breezy
- Autonoe: Bright
- Callirrhoe: Easy-going
- Despina: Smooth
- Erinome: Clear
- Gacrux: Mature
- Kore: Firm
- Laomedeia: Upbeat
- Leda: Youthful
- Pulcherrima: Forward
- Sulafat: Warm
- Vindemiatrix: Gentle
- Zephyr: Bright

Male Voices:
- Achird: Friendly
- Algenib: Gravelly
- Algieba: Smooth
- Alnilam: Firm
- Charon: Informative
- Enceladus: Breathy
- Fenrir: Excitable
- Iapetus: Clear
- Orus: Firm
- Puck: Upbeat
- Rasalgethi: Informative
- Sadachbia: Lively
- Sadaltager: Knowledgeable
- Schedar: Even
- Umbriel: Easy-going
- Zubenelgenubi: Casual

Return ONLY the name of the chosen voice (e.g., "Zephyr"). Do not include any other text.
`;

    try {
        console.log('[video-overview] Analyzing avatar image for voice selection...');
        const result = await client.models.generateContent({
            model: MODEL_PLAN, // Using flash for fast multimodal analysis
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: voicesPrompt },
                        {
                            inlineData: {
                                mimeType: 'image/png',
                                data: base64Image
                            }
                        }
                    ]
                }
            ]
        });

        const textResult = (result as any)?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const chosenVoice = textResult.trim();
        if (chosenVoice) {
            console.log(`[video-overview] Gemini selected voice: ${chosenVoice}`);
            return chosenVoice;
        }
        return 'Kore'; // Fallback
    } catch (e) {
        console.warn('[video-overview] Multimodal voice selection failed, falling back to Kore', e);
        return 'Kore';
    }
}

// ---------------------------------------------------------
// Helper: Shotstack Composite
// ---------------------------------------------------------


/**
 * Build Shotstack Edit JSON for final composite
 */
function buildShotstackComposite(params: {
    width: number;
    height: number;
    avatarVideoUrl?: string | null;
    slideshowVideoUrl: string;
    durationSeconds: number;
}): ShotstackEdit {
    const { width, height, avatarVideoUrl, slideshowVideoUrl, durationSeconds } = params;

    const tracks: any[] = [];

    // Identify main audio source for transcription/captions
    const mainAudioAlias = 'main-audio';

    // Track 1: Captions / Subtitles (Top Layer / Foreground)
    tracks.push({
        clips: [{
            asset: {
                type: 'caption',
                src: `alias://${mainAudioAlias}`,
                font: {
                    family: 'Open Sans',
                    color: '#ffffff',
                    size: 28, // Improved sizing for high-res rendering
                    lineHeight: 1.2
                },
                background: {
                    color: '#000000',
                    opacity: 0.6, // Higher contrast
                    padding: 8,   // Adequate padding to prevent text blending
                    borderRadius: 4
                }
            },
            start: 0,
            length: durationSeconds,
            position: 'bottom',
            offset: { y: -0.1 } // Safe margin from bottom to prevent mobile UI covering text
        }]
    });

    // Track 2: Avatar with Green Screen (Middle Layer)
    if (avatarVideoUrl) {
        const avatarClip: ShotstackClip = {
            asset: {
                type: 'video',
                src: avatarVideoUrl,
                volume: 1,
                transcode: true, // ENFORCED for AI Media: Normalizes Kling VFR and fixes codecs to prevent compositing failures
                chromaKey: {
                    color: '#00b140', // Optimal Shotstack green hex
                    threshold: 150, // Reverting to user snippet value
                    halo: 100       // Feather to hide 4:2:0 subsampling blockiness
                }
            },
            start: 0,
            length: durationSeconds,
            fit: 'contain',
            position: 'center'
        };
        tracks.push({ clips: [avatarClip] });
    }

    // Track 3: Slideshow (Bottom Layer / BackgroundCanvas)
    // The slideshow clip contains the original TTS audio track needed for transcription
    const slideshowClip: ShotstackClip = {
        asset: {
            type: 'video',
            src: slideshowVideoUrl,
            volume: avatarVideoUrl ? 0 : 1 // Mute if avatar is speaking (wait, the avatar has no audio... the audio IS the slideshow. We should NOT mute the slideshow if avatar is present because Kling video has NO audio!)
        },
        start: 0,
        length: durationSeconds,
        alias: mainAudioAlias // Attach alias here unconditionally for automatic captions
    };
    tracks.push({ clips: [slideshowClip] });

    return {
        timeline: {
            background: '#000000',
            tracks
        },
        output: {
            format: 'mp4',
            resolution: width >= 1280 ? 'hd' : 'sd',
            size: { width, height },
            fps: 30,
            destinations: [{
                provider: 'shotstack',
                exclude: false
            }]
        }
    } as any; // Cast as any to bypass temporary incomplete typing in ShotstackEdit interface
}

/**
 * Build Shotstack Edit JSON for Slideshow (Images + Audio)
 * Replaces Creatomate buildOverviewRenderScript
 */
function buildShotstackSlideshow(params: {
    width: number;
    height: number;
    audioUrl: string;
    slides: { imageUrl: string; durationSeconds: number }[];
}): ShotstackEdit {
    const { width, height, audioUrl, slides } = params;

    // Calculate total duration for validation if needed, but Shotstack handles timing per clip
    let currentTime = 0;
    const videoClips: ShotstackClip[] = slides.map((slide, index) => {
        const clip: ShotstackClip = {
            asset: {
                type: 'image',
                src: slide.imageUrl,
            },
            start: currentTime,
            length: slide.durationSeconds,
            fit: 'cover',
            effect: 'zoomIn', // Subtle Ken Burns effect
            transition: {
                in: index > 0 ? 'fade' : undefined, // Fade in for all except first
                out: 'fade'
            }
        };
        currentTime += slide.durationSeconds;
        return clip;
    });

    return {
        timeline: {
            background: '#000000',
            soundtrack: {
                src: audioUrl,
                effect: 'fadeOut',
                volume: 1.0
            },
            tracks: [
                { clips: videoClips }
            ]
        },
        output: {
            format: 'mp4',
            resolution: width >= 1280 ? 'hd' : 'sd',
            size: { width, height },
            fps: 30
        }
    };
}



// ... (existing code)

/**
 * Step AVATAR_CREATE: Trigger Kling AI avatar video generation
 */
async function processStepAvatarCreate(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    const { internalData, request } = job;
    const projectId = (request.projectId || '').trim();

    // Check if we have audioUrl (required for Kling lip sync)
    if (!internalData?.audioUrl) {
        console.warn('[video-overview] [AVATAR_CREATE] No audioUrl, skipping avatar');
        // ... (fallback logic same as before)
        const updatedJob: VideoOverviewJob = {
            ...job,
            internalData: { ...internalData, avatarDone: true, avatarVideoUrl: null },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);
        await triggerNextStep(jobId, 'FINAL_COMPOSITE');
        return;
    }

    try {
        // Use selected avatar or default
        const originalAvatarUrl = internalData.selectedAvatarId || KLING_DEFAULT_AVATARS[0];

        await updateJobStatus(jobId, 'generating_avatar', 'Preprocessing avatar (Green Screen)...');
        console.log(`[video-overview] [AVATAR_CREATE] Preprocessing avatar image: ${originalAvatarUrl}`);

        // 1. Generate Green Screen Image
        const greenScreenBase64 = await generateGeminiGreenScreenImage(originalAvatarUrl);

        // 2. Upload Green Screen Image to Blob (for stable URL)
        const greenScreenUrl = await uploadDataUrlToBlob(projectId, `avatar-green-${Date.now()}.png`, greenScreenBase64);
        console.log(`[video-overview] [AVATAR_CREATE] Green Screen Image uploaded: ${greenScreenUrl}`);

        await updateJobStatus(jobId, 'generating_avatar', 'Starting Kling AI avatar generation...');
        console.log(`[video-overview] [AVATAR_CREATE] Creating avatar video with GS image: ${greenScreenUrl}`);

        // 3. Call Kling API with Green Screen URL
        const taskId = await createKlingAvatarVideo(greenScreenUrl, internalData.audioUrl);

        // Update job with taskId and trigger polling
        const updatedJob: VideoOverviewJob = {
            ...job,
            status: 'generating_avatar',
            progress: 'Kling AI processing avatar...',
            internalData: {
                ...internalData,
                avatarVideoId: taskId, // Reusing field for Kling Task ID
            },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);

        console.log('[video-overview] [AVATAR_CREATE] Triggering AVATAR_POLL');
        await triggerNextStep(jobId, 'AVATAR_POLL');

    } catch (error: any) {
        console.error(`[video-overview] [AVATAR_CREATE] Error:`, error);
        // Mark avatar as done (failed) and route to FINAL_COMPOSITE
        const updatedJob: VideoOverviewJob = {
            ...job,
            internalData: { ...internalData, avatarDone: true, avatarVideoUrl: null },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);
        console.log('[video-overview] [AVATAR_CREATE] Error occurred, routing to FINAL_COMPOSITE without avatar');
        await triggerNextStep(jobId, 'FINAL_COMPOSITE');
    }
}


/**
 * Step AVATAR_POLL: Check Kling avatar video status
 */
/**
 * Step AVATAR_POLL: Check Kling avatar video status
 */
async function processStepAvatarPoll(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    const { internalData, createdAt } = job;
    const taskId = internalData?.avatarVideoId; // Kling Task ID

    // Timeout check (30 minutes)
    const TIMEOUT_MS = 30 * 60 * 1000;
    const isTimedOut = (Date.now() - (createdAt || 0)) > TIMEOUT_MS;

    if (isTimedOut) {
        console.error(`[video-overview] [AVATAR_POLL] Job ${jobId} timed out waiting for avatar.`);
        const updatedJob: VideoOverviewJob = {
            ...job,
            internalData: { ...internalData, avatarDone: true, avatarVideoUrl: null },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);
        console.log('[video-overview] [AVATAR_POLL] Timeout reached, routing to FINAL_COMPOSITE without avatar');
        await triggerNextStep(jobId, 'FINAL_COMPOSITE');
        return;
    }

    if (!taskId) {
        console.log('[video-overview] [AVATAR_POLL] No taskId, marking avatar done and routing to FINAL_COMPOSITE');
        const updatedJob: VideoOverviewJob = {
            ...job,
            internalData: { ...internalData, avatarDone: true, avatarVideoUrl: null },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);
        await triggerNextStep(jobId, 'FINAL_COMPOSITE');
        return;
    }

    try {
        // We use executeKlingApi directly to avoid the blocking loop of pollKlingAvatarVideo
        const res = await executeKlingApi(`/v1/videos/avatar/image2video/${taskId}`, 'GET');
        const data = res.data;
        const status = data?.task_status;
        console.log(`[video-overview] [AVATAR_POLL] Task ${taskId} status: ${status}`);

        if (status === 'succeed' || status === 'completed' || status === 'success') {
            const avatarVideoUrl = data?.task_result?.videos?.[0]?.url;

            if (!avatarVideoUrl) {
                // Succeeded but no URL? Treat as failure - mark done and route to FINAL_COMPOSITE
                console.error('[video-overview] [AVATAR_POLL] Kling task succeeded but no URL');
                const updatedJob: VideoOverviewJob = {
                    ...job,
                    internalData: { ...internalData, avatarDone: true, avatarVideoUrl: null },
                    updatedAt: Date.now(),
                };
                await saveJob(updatedJob);

                console.log('[video-overview] [AVATAR_POLL] Kling task succeeded but no URL, routing to FINAL_COMPOSITE');
                await triggerNextStep(jobId, 'FINAL_COMPOSITE');

                return;
            }

            console.log('[video-overview] [AVATAR_POLL] Avatar video ready:', avatarVideoUrl);

            // Re-upload Kling video to Vercel Blob for stable public access
            // Kling CDN URLs are temporary/signed and Creatomate cannot fetch them
            let stableAvatarUrl = avatarVideoUrl;
            try {
                stableAvatarUrl = await reuploadVideoToBlob(job.projectId, avatarVideoUrl, 'avatar');
            } catch (reuploadErr: any) {
                console.error('[video-overview] [AVATAR_POLL] Failed to re-upload avatar video, using original URL:', reuploadErr?.message);
            }

            // Save stable avatar URL, mark avatar as done
            const updatedJob: VideoOverviewJob = {
                ...job,
                internalData: {
                    ...internalData,
                    avatarVideoUrl: stableAvatarUrl,
                    avatarDone: true,
                },
                updatedAt: Date.now(),
            };
            await saveJob(updatedJob);

            console.log('[video-overview] [AVATAR_POLL] Avatar done, triggering FINAL_COMPOSITE');
            await triggerNextStep(jobId, 'FINAL_COMPOSITE');

        } else if (status === 'failed' || status === 'error') {
            // Explicit failure from API
            console.error(`[video-overview] [AVATAR_POLL] Kling task failed: ${data?.task_status_msg}`);
            // Mark avatar as done (failed) and route to FINAL_COMPOSITE
            const failedJob: VideoOverviewJob = {
                ...job,
                internalData: { ...internalData, avatarDone: true, avatarVideoUrl: null },
                updatedAt: Date.now(),
            };
            await saveJob(failedJob);
            console.log('[video-overview] [AVATAR_POLL] Avatar failed, routing to FINAL_COMPOSITE without avatar');
            await triggerNextStep(jobId, 'FINAL_COMPOSITE');

        } else {
            // Still in progress - re-queue with delay
            // Kling takes longer, so 15s delay is reasonable
            console.log(`[video-overview] [AVATAR_POLL] Status: ${status}, re-queuing with 15s delay`);
            await updateJobStatus(jobId, 'generating_avatar', `Processing avatar: ${status}...`);
            await triggerNextStepWithDelay(jobId, 'AVATAR_POLL', 15);
        }

    } catch (error: any) {
        console.error(`[video-overview] [AVATAR_POLL] Error:`, error);

        // Resilient Polling: If error occurs, check if we should retry or fail
        // We only fail if timed out (handled at top) or if we want to limit retries
        // For now, infinite retries until timeout seems safer for "resilient" polling.

        console.log('[video-overview] [AVATAR_POLL] Transient error, re-queuing with 15s delay...');
        await triggerNextStepWithDelay(jobId, 'AVATAR_POLL', 15);
    }
}

/**
 * Step IMAGE: Generate one image, save, trigger next image or assembly
 */
async function processStepImage(jobId: string, imageIndex: number): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    const { internalData, request } = job;
    if (!internalData?.plan) {
        await markJobFailed(jobId, 'Missing plan data in IMAGE step');
        return;
    }

    try {
        const { plan, slideImageUrls = [], ownerUid, aspectRatio } = internalData;
        const projectId = (request.projectId || '').trim();
        const prompt = (request.prompt || '').trim();

        const slide = plan.slides[imageIndex];
        if (!slide) {
            console.log(`[video-overview] [IMAGE] No slide at index ${imageIndex}, moving to ASSEMBLY_SLIDES`);
            await triggerNextStep(jobId, 'ASSEMBLY_SLIDES');
            return;
        }

        await updateJobStatus(jobId, 'generating_images', `Generating slide ${imageIndex + 1} of ${plan.slides.length}...`);
        console.log(`[video-overview] [IMAGE] Generating slide ${imageIndex + 1}/${plan.slides.length}...`);

        const imagePrompt = (slide.imagePrompt || '').trim() || `${slide.title || 'Slide'} - ${prompt}`;
        const img = await generateGeminiImageDataUrl(imagePrompt, (aspectRatio || '16:9') as '16:9' | '9:16');
        const url = await uploadDataUrlToBlob(projectId, `overview-slide-${imageIndex + 1}-${Date.now()}.png`, img);

        // Add to slideImageUrls
        const newSlideImageUrls = [...slideImageUrls];
        newSlideImageUrls[imageIndex] = url;

        // Save image to project
        if (ownerUid) {
            await saveAssetToProjectKnowledgeBase(projectId, ownerUid, {
                name: `Slide ${imageIndex + 1} - ${slide.title || prompt.slice(0, 30)}.png`,
                type: 'image/png',
                url: url,
            });
        }

        // Update job with new image URL
        const updatedJob: VideoOverviewJob = {
            ...job,
            internalData: {
                ...internalData,
                slideImageUrls: newSlideImageUrls,
            },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);

        // Trigger next
        const nextIndex = imageIndex + 1;
        if (nextIndex < plan.slides.length) {
            console.log(`[video-overview] [IMAGE] Triggering IMAGE step ${nextIndex}`);
            await triggerNextStep(jobId, 'IMAGE', nextIndex);
        } else {
            console.log('[video-overview] [IMAGE] All images done, triggering ASSEMBLY_SLIDES');
            await triggerNextStep(jobId, 'ASSEMBLY_SLIDES');
        }

    } catch (error: any) {
        console.error(`[video-overview] [IMAGE] Job ${jobId} failed at index ${imageIndex}:`, error);
        await markJobFailed(jobId, error?.message || `Image generation failed at slide ${imageIndex + 1}`);
    }
}

/**
 * Step ASSEMBLY_SLIDES: Submit slideshow render to Shotstack (no avatar)
 */
async function processStepAssemblySlides(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    const { internalData, request } = job;
    if (!internalData?.plan || !internalData?.audioUrl || !internalData?.slideImageUrls) {
        await markJobFailed(jobId, 'Missing data in ASSEMBLY_SLIDES step');
        return;
    }

    try {
        const { plan, audioUrl, slideImageUrls, width = 1280, height = 720 } = internalData;
        const projectId = (request.projectId || '').trim();

        await updateJobStatus(jobId, 'assembling', 'Starting slideshow assembly (Shotstack)...');
        console.log('[video-overview] [ASSEMBLY_SLIDES] Building Shotstack slideshow script...');

        const slides = plan.slides.map((s, idx) => ({
            imageUrl: slideImageUrls[idx] || '',
            durationSeconds: typeof s.durationSeconds === 'number' ? s.durationSeconds : 10,
        }));

        // Build Shotstack JSON
        const edit = buildShotstackSlideshow({ width, height, audioUrl, slides });

        console.log('[video-overview] [ASSEMBLY_SLIDES] Submitting to Shotstack...');
        const response = await postShotstackRender(edit);

        // Save render ID for polling
        const updatedJob: VideoOverviewJob = {
            ...job,
            internalData: {
                ...internalData,
                slideshowRenderId: response.response.id, // Store Shotstack ID
            },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);

        console.log(`[video-overview] [ASSEMBLY_SLIDES] Submitted Shotstack render ${response.response.id}, triggering ASSEMBLY_POLL`);
        await triggerNextStepWithDelay(jobId, 'ASSEMBLY_POLL', 5); // Check in 5s

    } catch (error: any) {
        console.error(`[video-overview] [ASSEMBLY_SLIDES] Job ${jobId} failed:`, error);
        await markJobFailed(jobId, error?.message || 'Assembly submission failed');
    }
}

/**
 * Step ASSEMBLY_POLL: Check Shotstack slideshow status
 */
async function processStepAssemblyPoll(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) return;

    if (job.status === 'completed' || job.status === 'failed') return;

    const { internalData } = job;
    const renderId = internalData?.slideshowRenderId;

    if (!renderId) {
        await markJobFailed(jobId, 'Missing slideshowRenderId in ASSEMBLY_POLL');
        return;
    }

    try {
        const status = await getShotstackRender(renderId);
        console.log(`[video-overview] [ASSEMBLY_POLL] Render ${renderId} status: ${status.response.status}`);

        const renderStatus = status.response.status;

        if (renderStatus === 'done') {
            const url = status.response.url;
            if (!url) throw new Error('Render done but no URL returned');

            console.log('[video-overview] [ASSEMBLY_POLL] Slideshow ready:', url);

            // Save slideshow URL and trigger AVATAR_CREATE
            const updatedJob: VideoOverviewJob = {
                ...job,
                status: 'generating_avatar',
                progress: 'Creating avatar video...',
                internalData: {
                    ...internalData,
                    slideshowVideoUrl: url,
                },
                updatedAt: Date.now(),
            };
            await saveJob(updatedJob);

            console.log('[video-overview] [ASSEMBLY_POLL] Triggering AVATAR_CREATE step');
            await triggerNextStep(jobId, 'AVATAR_CREATE');
        } else if (renderStatus === 'failed') {
            throw new Error(status.response.error || 'Shotstack render failed');
        } else {
            // queued, fetching, rendering, saving
            await updateJobStatus(jobId, 'assembling', `Assembling slideshow: ${renderStatus}...`);
            await triggerNextStepWithDelay(jobId, 'ASSEMBLY_POLL', 5);
        }
    } catch (error: any) {
        console.error(`[video-overview] [ASSEMBLY_POLL] Job ${jobId} failed:`, error);
        await markJobFailed(jobId, error?.message || 'Assembly polling failed');
    }
}


/**
 * Step FINAL_COMPOSITE: Composite Avatar (Kling) + Slideshow + B-roll (Shotstack)
 */
async function processStepFinalComposite(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) {
        console.error(`[video-overview] Job not found: ${jobId}`);
        return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
        console.log(`[video-overview] Job ${jobId} already ${job.status}, skipping`);
        return;
    }

    const { internalData } = job;

    // We expect at least one video source
    const slideshowUrl = internalData?.slideshowVideoUrl;
    const avatarUrl = internalData?.avatarVideoUrl; // optional

    if (!slideshowUrl) {
        console.error(`[video-overview] [FINAL_COMPOSITE] Missing slideshow URL for job ${jobId}`);
        await markJobFailed(jobId, 'Missing slideshow video URL');
        return;
    }

    // Check if Avatar is ready (if applicable)
    // Note: B-roll has been removed from the pipeline, so we only wait for avatar if needed
    if (avatarUrl === undefined && internalData?.avatarDone === false) {
        console.log('[video-overview] [FINAL_COMPOSITE] Waiting for avatar generation...');
        return;
    }

    try {
        await updateJobStatus(jobId, 'compositing', 'Creating final video composite (Shotstack)...');
        console.log('[video-overview] [FINAL_COMPOSITE] Building Shotstack composite script...');

        const width = internalData.width || 1280;
        const height = internalData.height || 720;
        const durationSeconds = internalData.plan?.totalDurationSeconds || 30; // Fallback if somehow missing

        // Build Shotstack JSON
        const edit = buildShotstackComposite({
            width,
            height,
            avatarVideoUrl: avatarUrl,
            slideshowVideoUrl: slideshowUrl!,
            durationSeconds,
        });

        console.log(`[video-overview] [FINAL_COMPOSITE] Submitting to Shotstack (Avatar: ${!!avatarUrl})...`);
        const response = await postShotstackRender(edit);

        // Save render ID for polling
        const updatedJob: VideoOverviewJob = {
            ...job,
            internalData: {
                ...internalData,
                finalRenderId: response.response.id, // Stoare Shotstack ID
            },
            updatedAt: Date.now(),
        };
        await saveJob(updatedJob);

        console.log(`[video-overview] [FINAL_COMPOSITE] Submitted Shotstack render ${response.response.id}, triggering FINAL_COMPOSITE_POLL`);
        await triggerNextStepWithDelay(jobId, 'FINAL_COMPOSITE_POLL', 5); // Check in 5s

    } catch (error: any) {
        console.error(`[video-overview] [FINAL_COMPOSITE] Job ${jobId} failed:`, error);
        // Graceful fallback? Try to complete with slideshow only if Shotstack fails?
        // or just mark failed.
        await markJobFailed(jobId, error?.message || 'FINAL_COMPOSITE failed');
    }
}

/**
 * Step FINAL_COMPOSITE_POLL: Check Shotstack final render status
 */
async function processStepFinalCompositePoll(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) return;

    if (job.status === 'completed' || job.status === 'failed') return;

    const { internalData } = job;
    const renderId = internalData?.finalRenderId;

    if (!renderId) {
        await markJobFailed(jobId, 'Missing finalRenderId in FINAL_COMPOSITE_POLL');
        return;
    }

    try {
        const response = await getShotstackRender(renderId);
        const status = response.response;
        console.log(`[video-overview] [FINAL_COMPOSITE_POLL] Render ${renderId} status: ${status.status}`);

        if (status.status === 'done') {
            if (!status.url) throw new Error('Render succeeded but no URL returned');
            console.log('[video-overview] [FINAL_COMPOSITE_POLL] Final video ready:', status.url);
            await completeJobWithVideo(jobId, job, status.url);
        } else if (status.status === 'failed') {
            throw new Error(status.error || 'Shotstack render failed');
        } else {
            // queued, fetching, preprocessing, rendering, saving
            await updateJobStatus(jobId, 'compositing', `Compositing final video: ${status.status}...`);
            await triggerNextStepWithDelay(jobId, 'FINAL_COMPOSITE_POLL', 5);
        }
    } catch (error: any) {
        console.error(`[video-overview] [FINAL_COMPOSITE_POLL] Job ${jobId} failed:`, error);
        // Graceful fallback
        const fallbackUrl = internalData?.slideshowVideoUrl || internalData?.avatarVideoUrl;
        if (fallbackUrl) {
            console.log('[video-overview] [FINAL_COMPOSITE_POLL] Falling back to available video due to error');
            await completeJobWithVideo(jobId, job, fallbackUrl);
        } else {
            await markJobFailed(jobId, error?.message || 'FINAL_COMPOSITE_POLL failed');
        }
    }
}

/**
 * Helper to trigger the next step via QStash
 */
async function triggerNextStep(jobId: string, step: ProcessPayload['step'], imageIndex?: number): Promise<void> {
    // If running locally (dev), bypass QStash and call directly to avoid network issues
    if (appUrl.includes('localhost')) {
        console.log(`[video-overview] [Local Dev] Bypassing QStash, triggering ${step}...`);
        (async () => {
            try {
                await processVideoOverviewJob({ jobId, step, imageIndex });
            } catch (e) {
                console.error(`[video-overview] [Local Dev] Error in ${step}:`, e);
            }
        })();
        return;
    }

    if (!qstash) {
        console.error('[video-overview] QStash not configured, cannot trigger next step');
        await markJobFailed(jobId, 'QStash not configured');
        return;
    }

    const qstashUrl = buildQStashUrl('process');
    const payload: ProcessPayload = { jobId, step, imageIndex };

    console.log(`[video-overview] Triggering next step: ${step} via QStash at ${qstashUrl}`);

    // Build headers with bypass token if available
    const headers: Record<string, string> = {};
    if (vercelBypassToken) {
        headers['x-vercel-protection-bypass'] = vercelBypassToken;
        console.log('[video-overview] Added x-vercel-protection-bypass header to QStash request');
    }

    await qstash.publishJSON({
        url: qstashUrl,
        body: payload,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        retries: 2,
    });
}

/**
 * Helper to trigger the next step via QStash with a delay
 */
async function triggerNextStepWithDelay(jobId: string, step: ProcessPayload['step'], delaySeconds: number): Promise<void> {
    // If running locally (dev), bypass QStash and call directly to avoid network issues
    if (appUrl.includes('localhost')) {
        console.log(`[video-overview] [Local Dev] Bypassing QStash with delay, triggering ${step} in ${delaySeconds}s...`);
        setTimeout(() => {
            (async () => {
                try {
                    await processVideoOverviewJob({ jobId, step });
                } catch (e) {
                    console.error(`[video-overview] [Local Dev] Error in ${step} (delayed):`, e);
                }
            })();
        }, delaySeconds * 1000);
        return;
    }

    if (!qstash) {
        console.error('[video-overview] QStash not configured, cannot trigger next step');
        await markJobFailed(jobId, 'QStash not configured');
        return;
    }

    const qstashUrl = buildQStashUrl('process');
    const payload: ProcessPayload = { jobId, step };

    console.log(`[video-overview] Triggering ${step} with ${delaySeconds}s delay via QStash`);

    // Build headers with bypass token if available
    const headers: Record<string, string> = {};
    if (vercelBypassToken) {
        headers['x-vercel-protection-bypass'] = vercelBypassToken;
    }

    await qstash.publishJSON({
        url: qstashUrl,
        body: payload,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        retries: 2,
        delay: delaySeconds,
    });
}

/**
 * Helper to mark job as failed
 */
async function markJobFailed(jobId: string, errorMessage: string): Promise<void> {
    const job = await getJob(jobId);
    if (job) {
        const failedJob: VideoOverviewJob = {
            ...job,
            status: 'failed',
            error: errorMessage,
            updatedAt: Date.now(),
        };
        await saveJob(failedJob);
    }
}

export default {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        // Handle Vercel rewrites where op might be 'video-overview' first
        // Check for 'action' param first (preferred to avoid rewrite collision)
        let op = url.searchParams.get('action');

        const ops = url.searchParams.getAll('op');
        if (!op) {
            op = ops.find(o => ['start', 'status', 'process'].includes(o)) || ops.filter(o => o !== 'video-overview' && o !== 'media').pop() || '';
        }

        console.log(`[video-overview] Request URL: ${request.url}`);
        console.log(`[video-overview] Raw ops: ${JSON.stringify(ops)}, Detected op: '${op}'`);

        // Handle different operations
        switch (op) {
            case 'start': {
                // Queue a new job
                if (request.method !== 'POST') {
                    return errorResponse('Method not allowed', 405);
                }

                const authResult = await requireAuth(request);
                if (authResult instanceof Response) return authResult;

                // Log QStash configuration status
                console.log(`[video-overview] QStash configured: ${!!qstash}, QSTASH_TOKEN present: ${!!qstashToken}`);
                console.log(`[video-overview] APP_URL resolved to: ${appUrl}`);
                console.log(`[video-overview] Callback URL would be: ${buildQStashUrl('process')}`);
                console.log(`[video-overview] VERCEL_PROTECTION_BYPASS present: ${!!vercelBypassToken}, length: ${vercelBypassToken?.length || 0}`);

                try {
                    const body = (await request.json()) as OverviewRequest;
                    const projectId = (body.projectId || '').trim();
                    const prompt = (body.prompt || '').trim();
                    if (!projectId) return errorResponse('projectId is required', 400);
                    if (!prompt) return errorResponse('prompt is required', 400);

                    // Require QStash for this long-running operation
                    if (!qstash) {
                        console.error('[video-overview] QSTASH_TOKEN environment variable is not set');
                        return errorResponse('Video overview requires QSTASH_TOKEN to be configured. Please add it to your Vercel environment variables.', 500);
                    }

                    const jobId = generateJobId();
                    const job: VideoOverviewJob = {
                        id: jobId,
                        projectId: body.projectId || '', // Top-level for querying
                        status: 'queued',
                        request: body,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    };

                    await saveJob(job);

                    // If running locally (dev), bypass QStash and call directly to avoid network issues
                    if (appUrl.includes('localhost')) {
                        console.log(`[video-overview] [Local Dev] Bypassing QStash, triggering process directly...`);
                        // We must not await this, otherwise the API call waits for the whole job
                        (async () => {
                            try {
                                await processVideoOverviewJob({ jobId, step: 'PLAN' });
                            } catch (e) {
                                console.error(`[video-overview] [Local Dev] Error in process loop:`, e);
                            }
                        })();
                        return json({ jobId, status: 'queued' });
                    }

                    // Queue processing via QStash
                    try {
                        const qstashUrl = buildQStashUrl('process');
                        console.log(`[video-overview] Publishing job ${jobId} to QStash at ${qstashUrl}`);

                        // Build headers with bypass token if available
                        const headers: Record<string, string> = {};
                        if (vercelBypassToken) {
                            headers['x-vercel-protection-bypass'] = vercelBypassToken;
                            console.log('[video-overview] Added x-vercel-protection-bypass header to initial QStash request');
                        }

                        await qstash.publishJSON({
                            url: qstashUrl,
                            body: { jobId },
                            headers: Object.keys(headers).length > 0 ? headers : undefined,
                            retries: 2,
                        });
                        console.log(`[video-overview] Successfully queued job ${jobId} via QStash`);
                    } catch (qstashError: any) {
                        console.error(`[video-overview] QStash publish failed:`, qstashError?.message || qstashError);
                        // Update job status to failed
                        await updateJobStatus(jobId, 'failed', `QStash error: ${qstashError?.message || 'Unknown error'}`);
                        return errorResponse(`Failed to queue job: ${qstashError?.message || 'QStash error'}`, 500);
                    }

                    // Return job ID immediately (job is now queued in QStash)
                    return json({ jobId, status: 'queued' });
                } catch (error: any) {
                    console.error('[video-overview] Error starting job:', error);
                    return errorResponse(error?.message || 'Failed to start video overview job', 500);
                }
            }

            case 'status': {
                // Poll job status
                const jobId = url.searchParams.get('jobId') || '';
                if (!jobId) return errorResponse('jobId is required', 400);

                const job = await getJob(jobId);
                if (!job) return errorResponse('Job not found', 404);

                return json({
                    jobId: job.id,
                    status: job.status,
                    progress: job.progress,
                    result: job.result,
                    error: job.error,
                });
            }

            case 'list': {
                // List in-progress jobs for a project
                const projectId = url.searchParams.get('projectId') || '';
                if (!projectId) return errorResponse('projectId is required', 400);

                const jobs = await listProjectJobs(projectId);
                return json(jobs.map(job => ({
                    jobId: job.id,
                    status: job.status,
                    progress: job.progress,
                    createdAt: job.createdAt,
                })));
            }

            case 'process': {
                // QStash callback to do the actual work
                if (request.method !== 'POST') {
                    return errorResponse('Method not allowed', 405);
                }

                // Note: QStash callbacks skip auth - they're verified by QStash signatures
                try {
                    const body = await request.json() as ProcessPayload;
                    console.log(`[video-overview] Process callback body:`, JSON.stringify(body));

                    const { jobId, step, imageIndex } = body;
                    if (!jobId) {
                        console.error('[video-overview] Missing jobId in process request');
                        return errorResponse('jobId is required', 400);
                    }

                    console.log(`[video-overview] Processing step ${step || 'INIT'} for job ${jobId}`);
                    await processVideoOverviewJob(body);
                    return json({ success: true });
                } catch (error: any) {
                    console.error('[video-overview] Error processing job:', error);
                    return errorResponse(error?.message || 'Failed to process job', 500);
                }
            }

            default: {
                console.warn(`[video-overview] Unknown operation: '${op}' (Raw ops: ${JSON.stringify(ops)})`);
                return errorResponse(`Unknown operation: '${op}'. Valid operations are: start, status, process. Debug: ops=${JSON.stringify(ops)}`, 400);
            }
        }
    },
};


