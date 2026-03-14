import { GoogleGenAI } from '@google/genai';
import { put } from '@vercel/blob';

// Unified Creatomate API Handler
// Handles: voiceover videos (Pexels), overview videos (Gemini slides), and slideshow videos (user assets)

const CREATOMATE_BASE_URL = 'https://api.creatomate.com/v2';
const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;
const BLOB_TOKEN = process.env.researcher_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;

const MODEL_VOICEOVER = 'gemini-2.5-flash';
const MODEL_PLAN = 'gemini-2.5-flash';
const MODEL_IMAGE_FAST = 'gemini-2.5-flash-image';
const MODEL_IMAGE_SMART = 'gemini-3-pro-image-preview';

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const errorResponse = (message: string, status = 400) => json({ error: message }, status);

// ===== FIRESTORE HELPERS =====

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
        console.error('[creatomate] Failed to get project owner:', e);
        return null;
    }
};

const saveAssetToProjectKnowledgeBase = async (
    projectId: string,
    ownerUid: string,
    asset: {
        name: string;
        type: string;
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
            storagePath: '',
            uploadedAt: Date.now(),
        };

        const projectRef = db.collection('users').doc(ownerUid).collection('researchProjects').doc(projectId);
        await projectRef.update({
            knowledgeBase: FieldValue.arrayUnion(kbFile),
            lastModified: Date.now(),
        });

        console.log(`[creatomate] Saved asset to project knowledgeBase: ${asset.name}`);

        // Log activity (Manual server-side equivalent of logProjectActivity)
        try {
            const activityRef = projectRef.collection('activity').doc();
            await activityRef.set({
                id: activityRef.id,
                projectId: projectId,
                userId: ownerUid,
                type: 'asset_created',
                description: `Created asset "${asset.name}"`,
                timestamp: Date.now(),
                metadata: {
                    assetName: asset.name,
                    assetType: asset.type,
                    assetUrl: asset.url,
                    assetSize: asset.size
                }
            });
            console.log(`[creatomate] Logged asset_created activity for ${asset.name}`);
        } catch (logErr) {
            console.error('[creatomate] Failed to log activity:', logErr);
        }
    } catch (e: any) {
        console.error(`[creatomate] Failed to save asset to knowledgeBase:`, e?.message);
    }
};

// ===== SHARED UTILITIES =====

async function postRender(script: any) {
    if (!CREATOMATE_API_KEY) throw new Error('CREATOMATE_API_KEY not configured');

    const res = await fetch(`${CREATOMATE_BASE_URL}/renders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${CREATOMATE_API_KEY}`,
        },
        body: JSON.stringify(script),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Creatomate render create failed: ${res.status} ${text}`);
    }

    return await res.json();
}

async function getRender(id: string) {
    if (!CREATOMATE_API_KEY) throw new Error('CREATOMATE_API_KEY not configured');

    const res = await fetch(`${CREATOMATE_BASE_URL}/renders/${id}`, {
        headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Creatomate get render failed: ${res.status} ${text}`);
    }

    return await res.json();
}

async function pollRenderUntilComplete(id: string, timeoutMs = 300000) {
    const start = Date.now();

    while (true) {
        const render = await getRender(id);
        if (render.status === 'succeeded' || render.status === 'failed') {
            return render;
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Render timed out after ${timeoutMs}ms`);
        }
        await new Promise(r => setTimeout(r, 5000));
    }
}

function parseAspect(aspect?: string) {
    const fallback = { width: 720, height: 1280 };
    if (!aspect) return fallback;
    const m = aspect.match(/^(\d+)x(\d+)$/);
    if (!m) return fallback;
    const width = parseInt(m[1], 10);
    const height = parseInt(m[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback;
    return { width, height };
}

// ===== VOICEOVER VIDEO (Pexels + voiceover) =====

async function generateVoiceoverText(context: string): Promise<string> {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

    const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const prompt = `You are writing a concise social-media-style EXPLAINER voiceover for a short video (about 20–30 seconds).

Write 6-10 short sentences. Keep it friendly and clear. Avoid hashtags, emojis, and calls to action.

Context:
${(context || '').trim().substring(0, 6000)}`;

    const response = await client.models.generateContent({
        model: MODEL_VOICEOVER,
        contents: prompt,
    });

    const text = (response.text || '').trim();
    if (!text) throw new Error('Empty response from Gemini voiceover generation');
    return text;
}

async function getPexelsVideos(query: string, limit = 3): Promise<string[]> {
    if (!PEXELS_API_KEY) return [];

    try {
        const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${limit}`;
        const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
        if (!res.ok) return [];

        const data: any = await res.json();
        const videos: any[] = Array.isArray(data.videos) ? data.videos : [];
        const urls: string[] = [];

        for (const video of videos) {
            const files: any[] = Array.isArray(video.video_files) ? video.video_files : [];
            const mp4 = files.find(f => f.file_type === 'video/mp4') || files[0];
            if (mp4?.link) {
                urls.push(mp4.link);
                if (urls.length >= limit) break;
            }
        }
        return urls;
    } catch {
        return [];
    }
}

async function getPexelsImages(query: string, limit = 4, orientation: 'landscape' | 'portrait' = 'landscape'): Promise<string[]> {
    if (!PEXELS_API_KEY) return [];

    try {
        const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${limit}&orientation=${orientation}`;
        const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
        if (!res.ok) return [];

        const data: any = await res.json();
        const photos: any[] = Array.isArray(data.photos) ? data.photos : [];
        const urls: string[] = [];

        for (const photo of photos) {
            const src = photo?.src;
            // Prefer the requested orientation size
            const url = orientation === 'landscape' ? (src?.landscape || src?.large2x) : (src?.portrait || src?.large2x);
            if (url) {
                urls.push(url);
                if (urls.length >= limit) break;
            }
        }
        return urls;
    } catch {
        return [];
    }
}

export async function handleVoiceoverVideo(body: any): Promise<Response> {
    try {
        const { prompt = '', aspect, durationSeconds = 12, contextDescription } = body;
        const { width, height } = parseAspect(aspect);
        const orientation = width >= height ? 'landscape' : 'portrait';

        const voiceoverContext = [contextDescription, prompt].filter(Boolean).join('\n\n') || 'Short, friendly narration.';
        let voiceoverText: string;

        try {
            voiceoverText = await generateVoiceoverText(voiceoverContext);
        } catch {
            voiceoverText = prompt || 'Generic narration';
        }

        const pexelsQuery = [prompt, contextDescription].filter(Boolean).join(' ') || 'b-roll background';
        const videoUrls = await getPexelsVideos(pexelsQuery, 3);
        const imageUrls = await getPexelsImages(pexelsQuery, 4, orientation);

        if (!videoUrls.length && !imageUrls.length) {
            throw new Error('Failed to fetch Pexels assets');
        }

        const totalDuration = durationSeconds * 2;
        const segmentCount = videoUrls.length + imageUrls.length;
        const segmentDuration = segmentCount > 0 ? totalDuration / segmentCount : totalDuration;

        const elements: any[] = [];

        for (const url of videoUrls) {
            elements.push({
                type: 'video',
                track: 1,
                source: url,
                duration: segmentDuration,
                fit: 'cover',
                audio_fade_out: 1,
                animations: [{ time: 0, duration: 0.6, easing: 'linear', type: 'fade' }],
            });
        }

        for (const url of imageUrls) {
            elements.push({
                type: 'image',
                track: 1,
                source: url,
                duration: segmentDuration,
                fit: 'cover',
                clip: true,
                animations: [
                    { type: 'scale', scope: 'element', easing: 'linear', start_scale: '120%', end_scale: '100%', fade: false },
                    { time: 0, duration: 0.6, easing: 'linear', type: 'fade' },
                ],
            });
        }

        elements.push(
            {
                name: 'Voiceover-1',
                type: 'audio',
                duration: null,
                source: voiceoverText,
                provider: 'elevenlabs model_id=eleven_multilingual_v2 voice_id=XrExE9yKIg1WjnnlVkGX stability=0.75',
            },
            {
                type: 'text',
                width: '86.66%',
                height: '37.71%',
                x_alignment: '50%',
                y_alignment: '80%',
                fill_color: '#ffffff',
                stroke_color: '#333333',
                stroke_width: '1.05 vmin',
                font_family: 'Montserrat',
                font_weight: 700,
                font_size: '5.5 vmin',
                background_x_padding: '26%',
                background_y_padding: '7%',
                background_border_radius: '28%',
                transcript_source: 'Voiceover-1',
                transcript_effect: 'highlight',
            }
        );

        const script = { output_format: 'mp4', width, height, elements };
        const created = await postRender(script);
        const final = await pollRenderUntilComplete(created.id);

        if (final.status !== 'succeeded' || !final.url) {
            throw new Error(final.error_message || `Render failed with status ${final.status}`);
        }

        return json({
            url: final.url,
            snapshotUrl: final.snapshot_url,
            durationSeconds: final.duration,
        });
    } catch (e: any) {
        return errorResponse(e?.message || 'Failed to handle voiceover video', 500);
    }
}

// ===== OVERVIEW VIDEO (Gemini slides) =====

async function generateOverviewPlan(context: string, slideCount: number) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

    const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const prompt = `You are generating an OVERVIEW video plan that will be turned into a narrated slideshow.

Requirements:
- Output JSON only.
- Create EXACTLY ${slideCount} slides.
- Each slide must have:
  - title (short)
  - bullets (2-4 short bullets, legible on screen)
  - voiceover (1-2 sentences for THIS slide only; plain spoken narration; do not include stage directions)
  - pexelsSearchQuery (2-4 simple keywords to search Pexels for a background stock photo. E.g. "office meeting", "sunny beach", "modern city street". Avoid abstract concepts.)
  - imagePrompt (FALLBACK ONLY: a detailed visual prompt for generating a slide background image if Pexels fails. It MUST include a short on-image headline using the slide title or a 3-6 word phrase. The headline must be large, high-contrast, and clearly legible.)
- Also generate a single voiceoverText that is the concatenation of the slide voiceovers.
- Keep the tone clear and executive-summary-like. Avoid hashtags/emojis.

Context:
"""
${(context || '').trim().slice(0, 9000)}
"""

Return ONLY valid JSON:
{
  "voiceoverText": "...",
  "slides": [
    { "title": "...", "bullets": ["..."], "voiceover": "...", "pexelsSearchQuery": "...", "imagePrompt": "..." }
  ]
}`;

    const response = await client.models.generateContent({
        model: MODEL_PLAN,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { temperature: 0.7, maxOutputTokens: 6000 },
    });

    const text = (response.text || '').trim();
    let cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = cleanJson.indexOf('{');
    const end = cleanJson.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
        cleanJson = cleanJson.substring(start, end + 1);
    }

    const parsed = JSON.parse(cleanJson);
    if (!parsed?.voiceoverText || !Array.isArray(parsed.slides) || parsed.slides.length !== slideCount) {
        throw new Error('Invalid overview plan from Gemini');
    }

    return parsed;
}

async function generateGeminiImageDataUrl(prompt: string, aspectRatio: '16:9' | '9:16'): Promise<string> {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

    const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const attemptModel = async (model: string) => {
        const response = await client.models.generateContent({
            model,
            contents: { parts: [{ text: prompt }] },
            config: {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig: {
                    aspectRatio,
                    ...(model === MODEL_IMAGE_SMART ? { imageSize: '1K' } : {}),
                },
            },
        });

        const parts = (response as any)?.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
            if (part?.inlineData?.data) {
                return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
            }
        }
        throw new Error('No image returned from Gemini');
    };

    try {
        return await attemptModel(MODEL_IMAGE_SMART);
    } catch {
        return attemptModel(MODEL_IMAGE_FAST);
    }
}

async function uploadDataUrlToBlob(projectId: string, filename: string, dataUrl: string): Promise<string> {
    const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');

    const mimeType = match[1];
    const base64 = match[2];
    const buffer = Buffer.from(base64, 'base64');
    const blob = new Blob([buffer], { type: mimeType });

    const stored = await put(`projects/${projectId}/${filename}`, blob, {
        access: 'public',
        addRandomSuffix: true,
        token: BLOB_TOKEN,
    });

    return stored.url;
}

export async function handleOverviewVideo(body: any): Promise<Response> {
    try {
        const { projectId, prompt, aspect, contextDescription, slideCount = 12 } = body;
        if (!projectId || !prompt) throw new Error('projectId and prompt required');

        const { width, height } = parseAspect(aspect);
        const aspectRatio: '16:9' | '9:16' = width >= height ? '16:9' : '9:16';
        const orientation: 'landscape' | 'portrait' = width >= height ? 'landscape' : 'portrait';

        const context = [contextDescription, `User request: ${prompt}`].filter(Boolean).join('\n\n');
        const plan = await generateOverviewPlan(context, slideCount);

        const slideImageUrls: string[] = [];
        for (let i = 0; i < plan.slides.length; i++) {
            const slide = plan.slides[i];
            let url: string | null = null;

            // 1. Try Pexels first (if configured and query exists)
            const pexelsQuery = slide.pexelsSearchQuery || slide.title;
            if (PEXELS_API_KEY && pexelsQuery) {
                try {
                    const pexelsImages = await getPexelsImages(pexelsQuery, 1, orientation);
                    if (pexelsImages.length > 0) {
                        url = pexelsImages[0];
                    }
                } catch (e) {
                    console.warn(`[creatomate] Pexels search failed for "${pexelsQuery}":`, e);
                }
            }

            // 2. Fallback to Gemini Image Generation
            if (!url) {
                const imagePrompt = slide.imagePrompt || `${slide.title} - ${prompt}`;
                try {
                    const img = await generateGeminiImageDataUrl(imagePrompt, aspectRatio);
                    url = await uploadDataUrlToBlob(projectId, `overview-slide-${i + 1}-${Date.now()}.png`, img);
                } catch (e) {
                    console.error(`[creatomate] Image generation failed for slide ${i + 1}:`, e);
                    // Absolute fallback: placeholder/error image or simple text slide background
                    // For now, we'll just let it fail or use a solid color if we had that logic, 
                    // but throwing here is safer to identify issues.
                    // Recover with a generic placeholder if generation fails completely?
                    // Let's rethrow for now so the user knows it failed.
                    throw e;
                }
            }

            slideImageUrls.push(url);
        }

        const elements: any[] = [];

        plan.slides.forEach((slide: any, idx: number) => {
            const bulletText = (slide.bullets || []).slice(0, 5).map((b: string) => `• ${b}`).join('\n');
            const voiceover = slide.voiceover || plan.voiceoverText;

            const sceneElements: any[] = [];

            if (voiceover) {
                sceneElements.push({
                    type: 'audio',
                    source: voiceover,
                    provider: 'elevenlabs model_id=eleven_multilingual_v2 voice_id=XrExE9yKIg1WjnnlVkGX stability=0.75',
                });
            }

            sceneElements.push({
                type: 'image',
                source: slideImageUrls[idx],
                fit: 'cover',
                clip: true,
                animations: [{ easing: 'linear', type: 'scale', scope: 'element', start_scale: '112%', end_scale: '100%', fade: false }],
            });

            sceneElements.push({
                type: 'shape',
                x: '50%',
                y: '50%',
                width: '100%',
                height: '100%',
                fill_color: 'rgba(0,0,0,0.18)',
            });

            sceneElements.push({
                type: 'text',
                x_alignment: '50%',
                y_alignment: '18%',
                width: '92%',
                height: '20%',
                fill_color: '#ffffff',
                stroke_color: 'rgba(0,0,0,0.65)',
                stroke_width: '0.9 vmin',
                font_family: 'Montserrat',
                font_weight: 800,
                font_size: '6 vmin',
                text_align: 'center',
                text: slide.title,
                background_color: 'rgba(0,0,0,0.35)',
                background_x_padding: '10%',
                background_y_padding: '18%',
                background_border_radius: '22%',
                animations: [{
                    time: 0,
                    duration: 0.6,
                    easing: 'quadratic-out',
                    type: 'text-slide',
                    scope: 'split-clip',
                    split: 'line',
                    overlap: '100%',
                    direction: 'up',
                    background_effect: 'scaling-clip',
                }],
            });

            sceneElements.push({
                type: 'text',
                x_alignment: '50%',
                y_alignment: '64%',
                width: '92%',
                height: '42%',
                fill_color: '#ffffff',
                stroke_color: 'rgba(0,0,0,0.65)',
                stroke_width: '0.7 vmin',
                font_family: 'Montserrat',
                font_weight: 700,
                font_size: '4.2 vmin',
                text_align: 'left',
                text: bulletText,
                background_color: 'rgba(0,0,0,0.30)',
                background_x_padding: '10%',
                background_y_padding: '10%',
                background_border_radius: '18%',
                animations: [{
                    time: 0.1,
                    duration: 0.7,
                    easing: 'quadratic-out',
                    type: 'text-slide',
                    scope: 'split-clip',
                    split: 'line',
                    overlap: '90%',
                    direction: 'up',
                    background_effect: 'scaling-clip',
                }],
            });

            const scene: any = {
                type: 'composition',
                name: `Scene-${idx + 1}`,
                track: 1,
                elements: sceneElements,
            };

            if (idx > 0) {
                scene.animations = [{
                    time: 0,
                    duration: 0.6,
                    easing: 'cubic-in-out',
                    transition: true,
                    type: 'fade',
                    enable: 'second-only',
                }];
            }

            elements.push(scene);
        });

        const script = { output_format: 'mp4', width, height, elements };
        const created = await postRender(script);
        const final = await pollRenderUntilComplete(created.id);

        if (final.status !== 'succeeded' || !final.url) {
            throw new Error(final.error_message || `Render failed with status ${final.status}`);
        }

        return json({
            url: final.url,
            snapshotUrl: final.snapshot_url,
            durationSeconds: final.duration,
        });
    } catch (e: any) {
        return errorResponse(e?.message || 'Failed to handle overview video', 500);
    }
}

// ===== STITCH VIDEO (Concatenate) =====

export async function handleStitchVideo(body: any): Promise<Response> {
    try {
        const { videoUrls, width = 1080, height = 1920, enableSubtitles = false } = body;

        if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length < 2) {
            throw new Error('At least 2 video URLs are required for stitching');
        }

        // Track 1: Video elements — each named so transcript can reference them
        const elements: any[] = videoUrls.map((url: string, idx: number) => ({
            type: 'video',
            name: `Video-${idx + 1}`,
            source: url,
            track: 1,
        }));

        // Track 2: Subtitle/transcript text elements (one per video clip)
        if (enableSubtitles) {
            videoUrls.forEach((_url: string, idx: number) => {
                elements.push({
                    type: 'text',
                    track: 2,
                    // Position at bottom of frame
                    x: '50%',
                    y: '82%',
                    width: '90%',
                    height: '20%',
                    x_alignment: '50%',
                    y_alignment: '50%',
                    // Font styling
                    fill_color: '#ffffff',
                    font_family: 'Inter',
                    font_weight: 700,
                    font_size: null,
                    font_size_minimum: '2 vmin',
                    font_size_maximum: '6 vmin',
                    // Background behind text for readability
                    background_color: 'rgba(0,0,0,0.65)',
                    background_x_padding: '60%',
                    background_y_padding: '40%',
                    background_border_radius: '20%',
                    // Transcript auto-generation from the corresponding video's audio
                    transcript_source: `Video-${idx + 1}`,
                    transcript_effect: 'karaoke',
                    transcript_split: 'word',
                    transcript_placement: 'animate',
                    transcript_maximum_length: 35,
                    transcript_color: '#FFD700', // Gold highlight for active word
                });
            });
        }

        const script = { output_format: 'mp4', width, height, elements };
        const created = await postRender(script);

        const final = await pollRenderUntilComplete(created.id);

        if (final.status !== 'succeeded' || !final.url) {
            throw new Error(final.error_message || `Render failed with status ${final.status}`);
        }

        return json({
            url: final.url,
            snapshotUrl: final.snapshot_url,
            durationSeconds: final.duration,
        });
    } catch (e: any) {
        return errorResponse(e?.message || 'Failed to handle stitch video', 500);
    }
}

// ===== SLIDESHOW VIDEO (User assets) =====

export async function handleSlideshowVideo(body: any): Promise<Response> {
    try {
        const { elements, width = 1920, height = 1080, transition = 'fade' } = body;

        if (!elements || !Array.isArray(elements) || elements.length === 0) {
            throw new Error('At least one element is required');
        }

        const renderElements = elements.map((el: any, index: number) => {
            const element: any = {
                type: el.type,
                source: el.url,
                track: 1,
                // If duration is 'full' (videos), let Creatomate use source length. Otherwise use specified number.
                duration: el.duration === 'full' ? undefined : el.duration,
            };

            if (el.type === 'video') {
                element.loop = true;
            }

            if (index > 0 && transition !== 'none') {
                element.animations = [{
                    duration: 0.5,
                    transition: true,
                    type: transition,
                    easing: 'cubic-in-out',
                }];
            }

            if (el.type === 'image') {
                element.clip = true;
                if (!element.animations) element.animations = [];
                element.animations.push({
                    easing: 'linear',
                    type: 'scale',
                    scope: 'element',
                    start_scale: '105%',
                    end_scale: '100%',
                    fade: false,
                });
            }

            return element;
        });

        const script = { output_format: 'mp4', width, height, elements: renderElements };
        const created = await postRender(script);

        // Check if already complete
        if (created.status === 'succeeded' && created.url) {
            return json({
                url: created.url,
                snapshotUrl: created.snapshot_url,
                durationSeconds: created.duration,
            });
        }

        // Poll for completion
        const renderId = created.id;
        const maxAttempts = 60;
        const pollInterval = 5000;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            const statusResult = await getRender(renderId);

            if (statusResult.status === 'succeeded' && statusResult.url) {
                if (body.projectId) {
                    const ownerUid = await getProjectOwnerUid(body.projectId);
                    if (ownerUid) {
                        await saveAssetToProjectKnowledgeBase(body.projectId, ownerUid, {
                            name: `Slideshow - ${new Date().toLocaleString()}.mp4`,
                            type: 'video/mp4',
                            url: statusResult.url,
                        });
                    }
                }
                return json({
                    url: statusResult.url,
                    snapshotUrl: statusResult.snapshot_url,
                    durationSeconds: statusResult.duration,
                });
            }

            if (statusResult.status === 'failed') {
                throw new Error(statusResult.error_message || 'Render failed');
            }
        }

        throw new Error('Render timed out');
    } catch (e: any) {
        return errorResponse(e?.message || 'Failed to handle slideshow video', 500);
    }
}

// ===== MAIN HANDLER (Vercel Edge/Runtime style) =====

export default {
    async fetch(request: Request): Promise<Response> {
        if (request.method !== 'POST') {
            return errorResponse('Method not allowed', 405);
        }

        try {
            const url = new URL(request.url);
            const operation = (url.searchParams.get('op') || 'voiceover').trim();
            const body = await request.json().catch(() => ({}));

            switch (operation) {
                case 'voiceover':
                    return await handleVoiceoverVideo(body);
                case 'overview':
                    return await handleOverviewVideo(body);
                case 'slideshow':
                    return await handleSlideshowVideo(body);
                case 'stitch':
                    return await handleStitchVideo(body);
                default:
                    return errorResponse(`Unknown operation: ${operation}`, 400);
            }
        } catch (error: any) {
            console.error(`[api/creatomate] Runtime Error:`, error);
            return errorResponse(error?.message || 'Internal server error', 500);
        }
    },
};
