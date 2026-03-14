/**
 * Social Reel Generator API
 * Creates vertical (9:16) social media videos using:
 * - Gemini 2.0 Flash for scripting (with Google Search grounding)
 * - Gemini TTS for voiceover
 * - Veo 3.1 for AI video generation
 * - Pexels for stock video fallback
 * - Creatomate for final composition (videos + audio + subtitles)
 * 
 * Pipeline: PLAN -> AUDIO -> VIDEOS -> ASSEMBLY -> COMPLETED
 */
import { GoogleGenAI } from '@google/genai';
import { put } from '@vercel/blob';
import { Client as QStashClient } from '@upstash/qstash';
import { executeKlingApi } from './kling-video.js';

// Constants
const CREATOMATE_BASE_URL = 'https://api.creatomate.com/v2';
const MODEL_PLAN = 'gemini-3-flash-preview';
// Use experimental for better tool use/search
const MODEL_TTS = 'gemini-2.5-flash-preview-tts';
const MODEL_TTS_FALLBACK = 'gemini-2.5-pro-preview-tts';
const VEO_MODEL = 'veo-3.1-fast-generate-preview'; // Latest Veo 3.1 model (fast)

// Environment variables
const qstashToken = process.env.QSTASH_TOKEN;
const vercelBypassToken = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || process.env.VERCEL_PROTECTION_BYPASS || '';
const appUrl = process.env.APP_URL ? (process.env.APP_URL.startsWith('http') ? process.env.APP_URL : `https://${process.env.APP_URL}`) : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';
const KLING_DEFAULT_AVATAR = 'https://p1-kling.klingai.com/kcdn/cdn-kcdn112452/kling-qa-test/pink_boy.png';

// ---------------------------------------------------------
// Constants
// ---------------------------------------------------------

// Royalty-free music placeholders (User should replace these with their own hosted assets)
const MUSIC_TRACKS: Record<string, string> = {
    'energetic': 'https://upload.wikimedia.org/wikipedia/commons/transcoded/5/52/Kevin_MacLeod_-_Lobby_Time.ogg/Kevin_MacLeod_-_Lobby_Time.ogg.mp3', // Lobby Time by Kevin MacLeod (CC BY 3.0)
    'calm': 'https://upload.wikimedia.org/wikipedia/commons/transcoded/b/b3/Kevin_MacLeod_-_Clean_Soul.ogg/Kevin_MacLeod_-_Clean_Soul.ogg.mp3', // Clean Soul by Kevin MacLeod (CC BY 3.0)
    'suspenseful': 'https://upload.wikimedia.org/wikipedia/commons/transcoded/8/8e/Kevin_MacLeod_-_Impact_Prelude.ogg/Kevin_MacLeod_-_Impact_Prelude.ogg.mp3', // Impact Prelude (CC BY 3.0)
    'upbeat': 'https://upload.wikimedia.org/wikipedia/commons/transcoded/9/9b/Kevin_MacLeod_-_Carefree.ogg/Kevin_MacLeod_-_Carefree.ogg.mp3', // Carefree (CC BY 3.0)
};

// Types
// ---------------------------------------------------------

type ReelRequest = {
    projectId?: string;
    prompt?: string;
    tone?: string;
    avatarUrl?: string; // Optional custom avatar
};

type ScenePlan = {
    visualDescription: string;
    narration: string;
    veoPrompt: string;
    pexelsQuery: string;
    durationSeconds: number;
};

type ReelPlan = {
    title: string;
    scenes: ScenePlan[];
    totalDuration: number;
    bgMusicMood?: string;
};

type SocialReelJob = {
    id: string;
    projectId: string;
    status: 'queued' | 'planning' | 'generating_audio' | 'generating_videos' | 'generating_avatar' | 'assembling' | 'completed' | 'failed';
    progress?: string;
    request: ReelRequest;
    result?: {
        url: string;
        durationSeconds?: number;
    };
    error?: string;
    createdAt: number;
    updatedAt: number;
    internalData?: {
        plan?: ReelPlan;
        audioUrl?: string; // Voiceover URL
        sceneVideoUrls?: (string | null)[]; // Array matching plan.scenes, null if failed
        avatarVideoUrl?: string | null; // Final Avatar video URL
        avatarVideoId?: string | null; // Pending Avatar task ID for polling
        videosDone?: boolean; // Flag: Veo generation step completed
        avatarDone?: boolean; // Flag: Avatar generation step completed
        renderId?: string; // Creatomate render ID for polling
        ownerUid?: string | null;
    };
};

type ProcessPayload = {
    jobId: string;
    step?: 'PLAN' | 'AUDIO' | 'VIDEOS' | 'AVATAR_CREATE' | 'AVATAR_POLL' | 'ASSEMBLY' | 'ASSEMBLY_POLL';
};

// ---------------------------------------------------------
// Helpers (Copied/Adapted from video-overview.ts)
// ---------------------------------------------------------

const getCreatomateApiKey = () => {
    const key = process.env.CREATOMATE_API_KEY;
    if (!key) throw new Error('Missing CREATOMATE_API_KEY');
    return key;
};

const getGeminiKey = () => {
    const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!key) throw new Error('Missing GEMINI_API_KEY');
    return key;
};

const getBlobToken = () => process.env.researcher_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;

const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const errorResponse = (message: string, status = 400) => new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });

// Firestore
let firestoreInitialized = false;
const ensureFirestore = async () => {
    if (firestoreInitialized) return;
    firestoreInitialized = true;
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    if (getApps().length) return;
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
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

const getJob = async (jobId: string): Promise<SocialReelJob | null> => {
    await ensureFirestore();
    const { getFirestore } = await import('firebase-admin/firestore');
    return (await getFirestore().collection('socialReelJobs').doc(jobId).get()).data() as SocialReelJob || null;
};

const saveJob = async (job: SocialReelJob) => {
    await ensureFirestore();
    const { getFirestore } = await import('firebase-admin/firestore');
    await getFirestore().collection('socialReelJobs').doc(job.id).set({ ...job, updatedAt: Date.now() });
};

const updateJobStatus = async (jobId: string, status: SocialReelJob['status'], progress?: string) => {
    await ensureFirestore();
    const { getFirestore } = await import('firebase-admin/firestore');
    const update: any = { status, updatedAt: Date.now() };
    if (progress) update.progress = progress;
    await getFirestore().collection('socialReelJobs').doc(jobId).update(update);
};

const saveAssetToProject = async (projectId: string, ownerUid: string, asset: { name: string, type: string, url: string }) => {
    try {
        await ensureFirestore();
        const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
        const kbFile = {
            id: `file_${Date.now()}_reel`,
            name: asset.name,
            type: asset.type,
            size: 0,
            url: asset.url,
            uploadedAt: Date.now(),
        };
        await getFirestore().collection('users').doc(ownerUid).collection('researchProjects').doc(projectId).update({
            knowledgeBase: FieldValue.arrayUnion(kbFile),
            lastModified: Date.now()
        });
    } catch (e) {
        console.error('Failed to save asset:', e);
    }
};

const getProjectOwnerUid = async (projectId: string): Promise<string | null> => {
    await ensureFirestore();
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const users = await db.collection('users').get();
    for (const user of users.docs) {
        if ((await user.ref.collection('researchProjects').doc(projectId).get()).exists) return user.id;
    }
    return null;
};

// QStash
const qstash = qstashToken ? new QStashClient({ token: qstashToken }) : null;

const buildQStashUrl = (action: string) => {
    const baseUrl = `${appUrl}/api/social-reel?action=${action}`;
    return vercelBypassToken ? `${baseUrl}&x-vercel-protection-bypass=${vercelBypassToken}` : baseUrl;
};

const triggerNextStep = async (jobId: string, step: ProcessPayload['step']) => {
    // If running locally (dev), bypass QStash and call directly to avoid network issues
    if (appUrl.includes('localhost')) {
        console.log(`[Social Reel] [Local Dev] Bypassing QStash, triggering ${step} directly...`);
        // Note: For parallel steps, we just fire and forget in local dev
        (async () => {
            try {
                processSocialReelJob({ jobId, step });
            } catch (e) {
                console.error(`[Social Reel] [Local Dev] Error in ${step}:`, e);
            }
        })();
        return;
    }

    if (!qstash) {
        console.error('[Social Reel] FATAL: QStash not configured, cannot trigger next step. Job will be stuck.');
        await updateJobStatus(jobId, 'failed', 'Server error: QStash not configured. Set QSTASH_TOKEN env var.');
        return;
    }

    const qstashUrl = buildQStashUrl('process');
    console.log(`[Social Reel] Triggering ${step} via QStash at ${qstashUrl}`);

    const headers: Record<string, string> = {};
    if (vercelBypassToken) {
        headers['x-vercel-protection-bypass'] = vercelBypassToken;
    }

    try {
        await qstash.publishJSON({
            url: qstashUrl,
            body: { jobId, step },
            headers: Object.keys(headers).length ? headers : undefined,
            retries: 2,
        });
        console.log(`[Social Reel] Successfully published ${step} to QStash for job ${jobId}`);
    } catch (e: any) {
        console.error(`[Social Reel] QStash publish FAILED for ${step}:`, e?.message || e);
        await updateJobStatus(jobId, 'failed', `QStash publish failed: ${e?.message || 'Unknown error'}`);
    }
};

const triggerNextStepWithDelay = async (jobId: string, step: ProcessPayload['step'], delaySeconds: number) => {
    if (appUrl.includes('localhost')) {
        console.log(`[Social Reel] [Local Dev] Delaying ${step} for ${delaySeconds}s...`);
        setTimeout(() => {
            processSocialReelJob({ jobId, step });
        }, delaySeconds * 1000);
        return;
    }

    if (!qstash) return;

    const qstashUrl = buildQStashUrl('process');
    const headers: Record<string, string> = {};
    if (vercelBypassToken) headers['x-vercel-protection-bypass'] = vercelBypassToken;

    try {
        await qstash.publishJSON({
            url: qstashUrl,
            body: { jobId, step },
            headers: Object.keys(headers).length ? headers : undefined,
            delay: delaySeconds,
            retries: 2,
        });
        console.log(`[Social Reel] Scheduled ${step} with ${delaySeconds}s delay`);
    } catch (e: any) {
        console.error(`[Social Reel] QStash delay publish failed:`, e);
    }
};

// ---------------------------------------------------------
// Core Logic Steps
// ---------------------------------------------------------

// STEP 1: PLAN
async function processStepPlan(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) return;
    await updateJobStatus(jobId, 'planning', 'Researching and writing script...');

    try {
        const client = new GoogleGenAI({ apiKey: getGeminiKey() });
        const prompt = `You are an expert social media video creator. Create a highly engaging, viral-style vertical video script (Reel/TikTok) based on this request: "${job.request.prompt}".
        
        Use Google Search to find relevant, real-time info, statistics, or trends matching the topic.
        
        Output a JSON object with this structure:
        {
            "title": "Video Title",
            "bgMusicMood": "energetic | calm | suspenseful | upbeat",
            "scenes": [
                {
                    "visualDescription": "Brief description of visual",
                    "narration": "Voiceover line for this scene (keep it snappy)",
                    "veoPrompt": "Detailed prompt for AI video generator (cinematic, 4k, vertical)",
                    "pexelsQuery": "Simple search term for stock video fallback",
                    "durationSeconds": 3
                }
            ]
        }
        
        Keep total duration under 60 seconds. Scenes should be fast (2-5 seconds).`;

        // Use explicit any cast for options to avoid 'tools' type error if descriptions are missing
        const response = await client.models.generateContent({
            model: MODEL_PLAN,
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ googleSearch: {} }],
            config: { responseMimeType: 'application/json' }
        } as any);

        const planText = response.text || '';
        const plan = JSON.parse(planText) as ReelPlan;

        // Calculate total duration
        plan.totalDuration = plan.scenes.reduce((acc, s) => acc + s.durationSeconds, 0);

        job.internalData = { ...job.internalData, plan };
        await saveJob(job);

        await triggerNextStep(jobId, 'AUDIO');
    } catch (e: any) {
        await updateJobStatus(jobId, 'failed', `Planning failed: ${e.message}`);
    }
}

// STEP 2: AUDIO
async function processStepAudio(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job || !job.internalData?.plan) return;
    await updateJobStatus(jobId, 'generating_audio', 'Generating AI voiceover...');

    try {
        const fullScript = job.internalData.plan.scenes.map(s => s.narration).join(' ');
        const client = new GoogleGenAI({ apiKey: getGeminiKey() });

        const styledPrompt = `# AUDIO PROFILE: Social Media Presenter
## "The Reel Creator"

### DIRECTOR'S NOTES
Style: High energy, charismatic, and engaging social media presenter. Punchy delivery with infectious enthusiasm. Think viral TikTok creator — exciting, fast-paced, and attention-grabbing.

Pacing: Fast and dynamic with quick transitions between points. Keep the energy up throughout — no dead air, no slow moments.

### TRANSCRIPT
${fullScript}`;

        const tryModels = [MODEL_TTS, MODEL_TTS_FALLBACK];
        let pcmData: string | null = null;

        for (const model of tryModels) {
            try {
                const response = await client.models.generateContent({
                    model,
                    contents: [{ parts: [{ text: styledPrompt }] }],
                    config: {
                        responseModalities: ['AUDIO'],
                        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
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
                console.warn(`[Social Reel] TTS model ${model} failed, trying next...`, e);
            }
        }

        if (!pcmData) throw new Error('No audio generated from any TTS model');

        // Note: Gemini returns PCM. Ideally we convert to WAV/MP3. 
        // For simplicity and to match video-overview without huge code dup, we'll try to use the raw blob if possible, 
        // but Creatomate needs a valid audio file.
        // We will REUSE the pcmToWav helper from video-overview logic here inline.

        const pcmBytes = Uint8Array.from(atob(pcmData), c => c.charCodeAt(0));

        // Simple WAV header construction (24kHz, 1 channel, 16bit - standard Gemini output)
        const wavBytes = (() => {
            const sampleRate = 24000;
            const numChannels = 1;
            const bitsPerSample = 16;
            const byteRate = sampleRate * numChannels * 2;
            const blockAlign = numChannels * 2;
            const dataSize = pcmBytes.length;
            const header = new ArrayBuffer(44);
            const v = new DataView(header);

            const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) };

            writeStr(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); writeStr(8, 'WAVE');
            writeStr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
            v.setUint16(22, numChannels, true); v.setUint32(24, sampleRate, true);
            v.setUint32(28, byteRate, true); v.setUint16(32, blockAlign, true);
            v.setUint16(34, bitsPerSample, true);
            writeStr(36, 'data'); v.setUint32(40, dataSize, true);

            const wav = new Uint8Array(44 + dataSize);
            wav.set(new Uint8Array(header), 0);
            wav.set(pcmBytes, 44);
            return wav;
        })();

        const blob = new Blob([wavBytes], { type: 'audio/wav' });
        const stored = await put(`projects/${job.projectId}/reel-audio-${Date.now()}.wav`, blob, {
            access: 'public',
            addRandomSuffix: true,
            token: getBlobToken(),
        });

        job.internalData.audioUrl = stored.url;
        await saveJob(job);

        // Trigger VIDEOS and AVATAR_CREATE in parallel
        console.log('[Social Reel] Audio done. Triggering VIDEOS and AVATAR_CREATE in parallel.');

        // We trigger both. QStash handles them as separate events.
        await triggerNextStep(jobId, 'VIDEOS');

        // Only trigger avatar if requested OR if we just always do it (Plan B)?
        // Original logic was: if (job.request.avatarUrl) ...
        // Let's check request.avatarUrl OR we can default to using one.
        // For now, let's stick to the logic: if we have audio, we probably want an avatar unless explicitly disabled?
        // But previously `processStepVideos` had logic for this.
        // Let's trigger AVATAR_CREATE always, and let it decide to skip if no avatarUrl/audioUrl?
        // Actually `processStepAvatarCreate` checks `job.internalData.audioUrl`.
        await triggerNextStep(jobId, 'AVATAR_CREATE');
    } catch (e: any) {
        await updateJobStatus(jobId, 'failed', `Audio generation failed: ${e.message}`);
    }
}

// STEP 3: VIDEOS (Veo + Pexels)
async function processStepVideos(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job || !job.internalData?.plan) return;
    await updateJobStatus(jobId, 'generating_videos', 'Generating AI video clips...');

    try {
        const scenes = job.internalData.plan.scenes;
        const videoResults: (string | null)[] = new Array(scenes.length).fill(null);

        // Helper to wrap promises with a timeout (same as video-overview)
        const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
            return Promise.race([
                promise,
                new Promise<T>((resolve) => setTimeout(() => {
                    console.warn(`[Social Reel] Task timed out after ${ms}ms`);
                    resolve(fallback);
                }, ms))
            ]);
        };

        // We process scenes in batches to avoid overwhelming APIs/timeouts, but we want speed.
        // Let's do them in parallel but catch individual errors.

        const generateSceneVideo = async (scene: ScenePlan, index: number) => {
            // 1. Try Veo
            try {
                const client = new GoogleGenAI({ apiKey: getGeminiKey() });
                console.log(`[Reel] Generating Veo clip for scene ${index}: ${scene.veoPrompt.slice(0, 50)}...`);

                const generateVeo = async () => {
                    let op = await client.models.generateVideos({
                        model: VEO_MODEL,
                        prompt: scene.veoPrompt,
                        config: {
                            aspectRatio: '9:16',
                            // Veo 3.1 defaults to 720p. 
                            // 1080p/4k available but higher latency/cost. Sticking to default/agile.
                        } as any
                    });

                    // Poll Veo
                    const start = Date.now();
                    const apiKey = getGeminiKey();
                    while (!op.done) {
                        if (Date.now() - start > 180000) throw new Error('Veo internal polling timeout'); // Extra safety
                        await new Promise(r => setTimeout(r, 7000));

                        // Use raw fetch because SDK's getVideosOperation requires an instance we don't have
                        const opUrl = `https://generativelanguage.googleapis.com/v1beta/${op.name}?key=${apiKey}`;
                        const opRes = await fetch(opUrl);
                        if (!opRes.ok) {
                            console.warn(`[Social Reel] Failed to fetch operation ${op.name}: ${opRes.status}`);
                            continue;
                        }
                        op = await opRes.json();
                    }

                    if (op.done && op.response?.generatedVideos?.[0]?.video?.uri) {
                        // Upload to Blob
                        const vidRes = await fetch(op.response.generatedVideos[0].video.uri);
                        if (vidRes.ok) {
                            const blob = await vidRes.blob();
                            const stored = await put(`projects/${job.projectId}/veo-${index}-${Date.now()}.mp4`, blob, {
                                access: 'public', token: getBlobToken(), addRandomSuffix: true
                            });
                            return stored.url;
                        }
                    }
                    return null;
                };

                // Wrap Veo generation with 3 minute timeout
                const veoUrl = await withTimeout(generateVeo(), 180000, null);

                if (veoUrl) {
                    videoResults[index] = veoUrl;
                    return; // Success!
                }
            } catch (e) {
                console.warn(`[Reel] Veo failed for scene ${index}, trying Pexels...`, e);
            }

            // 2. Fallback to Pexels
            try {
                if (!PEXELS_API_KEY) return;

                const searchPexels = async () => {
                    const pexRes = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(scene.pexelsQuery)}&per_page=1&orientation=portrait`, {
                        headers: { Authorization: PEXELS_API_KEY }
                    });
                    if (pexRes.ok) {
                        const data: any = await pexRes.json();
                        const video = data.videos?.[0];
                        if (video) {
                            const file = video.video_files.find((f: any) => f.height >= 960 && f.file_type === 'video/mp4') || video.video_files[0];
                            if (file) return file.link;
                        }
                    }
                    return null;
                };

                // Wrap Pexels search with 15 second timeout
                const pexelsUrl = await withTimeout(searchPexels(), 15000, null);

                if (pexelsUrl) {
                    videoResults[index] = pexelsUrl;
                    console.log(`[Reel] Found Pexels video for scene ${index}`);
                }
            } catch (e) {
                console.error(`[Reel] Pexels failed for scene ${index}`, e);
            }
        };

        // Run all concurrently
        await Promise.all(scenes.map((scene, i) => generateSceneVideo(scene, i)));

        job.internalData.sceneVideoUrls = videoResults;
        await saveJob(job);

        // Mark videos as done
        const latestJob = await getJob(jobId); // Re-fetch to get latest state
        if (latestJob) {
            const updatedInternalData = { ...latestJob.internalData, sceneVideoUrls: videoResults, videosDone: true };
            await saveJob({ ...latestJob, internalData: updatedInternalData });

            // CONVERGENCE CHECK: If Avatar is also done (or skipped), trigger ASSEMBLY
            if (updatedInternalData.avatarDone) {
                console.log('[Social Reel] [VIDEOS] Avatar also done, triggering ASSEMBLY');
                await triggerNextStep(jobId, 'ASSEMBLY');
            } else {
                console.log('[Social Reel] [VIDEOS] Waiting for Avatar...');
            }
        }
    } catch (e: any) {
        await updateJobStatus(jobId, 'failed', `Video generation failed: ${e.message}`);
    }
}

// STEP 3.5: AVATAR CREATE (Kling AI)
async function processStepAvatarCreate(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job || !job.internalData?.audioUrl) return;

    await updateJobStatus(jobId, 'generating_avatar', 'Animating avatar with Kling AI...');

    try {
        const audioUrl = job.internalData.audioUrl;
        const avatarUrl = job.request.avatarUrl || KLING_DEFAULT_AVATAR;

        console.log(`[Social Reel] Creating avatar video with image: ${avatarUrl}`);

        const result = await executeKlingApi('/v1/videos/avatar/image2video', 'POST', {
            image: avatarUrl,
            sound_file: audioUrl,
            prompt: 'While speaking, maintain energetic head movements and expressive facial reactions. Use dynamic hand gestures as if presenting an exciting social media video.',
            mode: 'std',
        });

        if (!result.data?.task_id) throw new Error('Kling API did not return task_id');

        const taskId = result.data.task_id;
        console.log(`[Social Reel] Kling task created: ${taskId}`);

        job.internalData.avatarVideoId = taskId;
        await saveJob(job);

        await triggerNextStep(jobId, 'AVATAR_POLL');
    } catch (e: any) {
        console.error('[Social Reel] Avatar creation failed:', e);
        // Fallback: Mark done (failed) so pipeline continues
        const latestJob = await getJob(jobId);
        if (latestJob) {
            const updatedInternalData = { ...latestJob.internalData, avatarVideoId: null, avatarDone: true };
            await saveJob({ ...latestJob, internalData: updatedInternalData });

            // Check convergence
            if (updatedInternalData.videosDone) {
                await triggerNextStep(jobId, 'ASSEMBLY');
            }
        }
    }
}

// STEP 3.6: AVATAR POLL
async function processStepAvatarPoll(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job || !job.internalData?.avatarVideoId) {
        // Should not happen if flow is correct, but just in case
        console.log('[Social Reel] [AVATAR_POLL] No taskId, marking done');
        const updatedInternalData = { ...job.internalData, avatarDone: true };
        await saveJob({ ...job, internalData: updatedInternalData });
        if (updatedInternalData.videosDone) await triggerNextStep(jobId, 'ASSEMBLY');
        return;
    }

    const taskId = job.internalData.avatarVideoId;

    try {
        const res = await executeKlingApi(`/v1/videos/avatar/image2video/${taskId}`, 'GET');
        const data = res.data;
        const status = data?.task_status;

        console.log(`[Social Reel] Avatar task ${taskId} status: ${status}`);

        if (status === 'succeed' || status === 'completed' || status === 'success') {
            const videoUrl = data?.task_result?.videos?.[0]?.url;
            if (!videoUrl) throw new Error('Kling task succeeded but no video_url returned');

            job.internalData.avatarVideoUrl = videoUrl;
            job.internalData.avatarDone = true;
            await saveJob(job);

            console.log('[Social Reel] [AVATAR_POLL] Avatar done. Checking videos...');
            if (job.internalData.videosDone) {
                console.log('[Social Reel] [AVATAR_POLL] Videos also done, triggering ASSEMBLY');
                await triggerNextStep(jobId, 'ASSEMBLY');
            } else {
                console.log('[Social Reel] [AVATAR_POLL] Waiting for Videos...');
            }
            return;
        }

        if (status === 'failed' || status === 'error') {
            throw new Error(`Kling video generation failed: ${data?.task_status_msg}`);
        }

        // Still processing - rely on QStash to retry/poll? 
        // We'll manually delay and re-queue.
        if (Date.now() - job.updatedAt > 20 * 60 * 1000) { // 20 min timeout
            throw new Error('Avatar generation timed out');
        }

        // Wait 15s then re-queue (via QStash delay)
        await triggerNextStepWithDelay(jobId, 'AVATAR_POLL', 15);

    } catch (e: any) {
        console.error('[Social Reel] Avatar poll failed:', e);
        // Fallback: Mark done (failed)
        const latestJob = await getJob(jobId);
        if (latestJob) {
            const updatedInternalData = { ...latestJob.internalData, avatarVideoUrl: null, avatarDone: true };
            await saveJob({ ...latestJob, internalData: updatedInternalData });

            if (updatedInternalData.videosDone) {
                await triggerNextStep(jobId, 'ASSEMBLY');
            }
        }
    }
}

// STEP 4: ASSEMBLY (Creatomate)
async function processStepAssembly(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job || !job.internalData?.plan || !job.internalData.sceneVideoUrls || !job.internalData.audioUrl) return;
    await updateJobStatus(jobId, 'assembling', 'Compositing final reel...');

    try {
        const { plan, sceneVideoUrls, audioUrl, avatarVideoUrl } = job.internalData;

        // Build RenderScript
        // Track 1: Videos sequence (Background)
        // Track 2: Avatar (PiP)
        // Track 3: Subtitles
        // Track 4: Audio

        const elements: any[] = [];
        let currentTime = 0;

        // 1. Video Track (Background)
        plan.scenes.forEach((scene, i) => {
            const url = sceneVideoUrls[i];
            if (!url) return;

            elements.push({
                type: 'video',
                track: 1,
                source: url,
                time: currentTime,
                duration: scene.durationSeconds,
                fit: 'cover',
                animations: i > 0 ? [{ time: 'start', duration: 0.5, type: 'fade', transition: true }] : undefined
            });
            currentTime += scene.durationSeconds;
        });

        const totalDuration = currentTime;

        // 2. Avatar Track (PiP)
        if (avatarVideoUrl) {
            elements.push({
                type: 'video',
                track: 2,
                source: avatarVideoUrl,
                time: 0,
                // Make sure it loops or cuts if shorter/longer? 
                // Kling avatar video is usually generated to match audio length.
                duration: totalDuration,
                // Layout: Circle PiP top-right or just below header area
                width: '35%',
                height: '35%',
                x: '75%', // Right side
                y: '20%', // Top-ish
                border_radius: '50%',
                stroke_color: '#ffffff',
                stroke_width: '4px',
                shadow_color: 'rgba(0,0,0,0.5)',
                shadow_blur: '20px',
            });
        }

        // 3. Kinetic Subtitles (Word-by-word with pop animation)
        const audioId = 'main-voiceover';

        elements.push({
            type: 'text',
            track: 3,
            text: ' ',
            fill_color: '#ffffff',
            stroke_color: '#000000',
            stroke_width: '2 vmin',
            font_family: 'Montserrat',
            font_weight: 900, // Extra bold for impact
            font_size: '7 vmin', // Slightly larger
            y: '82%', // Bottom area
            width: '85%',
            x_alignment: '50%',
            y_alignment: '50%',
            transcript_source: audioId,
            transcript_effect: 'word', // Word-by-word reveal (more engaging than karaoke)
            transcript_color: '#FCD34D', // Gold highlight for current word
            transcript_placement: 'word', // Each word animates independently
            transcript_word_timing: 'split', // Tight word timing
            animations: [
                {
                    time: 'word', // Apply to each word
                    duration: 0.15,
                    easing: 'elastic-out',
                    type: 'scale',
                    start_scale: '70%',
                    end_scale: '100%',
                }
            ]
        });

        // 4. Audio Track (Voiceover)
        elements.push({
            type: 'audio',
            track: 4,
            name: audioId,
            source: audioUrl,
        });

        // 5. Background Music
        const musicMood = plan.bgMusicMood || 'energetic'; // Default to energetic
        const musicUrl = MUSIC_TRACKS[musicMood] || MUSIC_TRACKS['energetic'];

        if (musicUrl) {
            elements.push({
                type: 'audio',
                track: 5,
                source: musicUrl,
                duration: totalDuration, // Trim to video length
                volume: '12%', // Low volume background (simulated ducking)
                audio_fade_out: 2, // Smooth fade out at end
            });
        }

        const renderScript = {
            output_format: 'mp4',
            width: 1080,
            height: 1920,
            elements,
        };

        // Submit to Creatomate
        const res = await fetch(`${CREATOMATE_BASE_URL}/renders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getCreatomateApiKey()}` },
            body: JSON.stringify(renderScript),
        });

        if (!res.ok) throw new Error(`Creatomate submission failed: ${res.statusText}`);
        const render = await res.json() as any;

        // Poll for completion - ASYNC via QStash
        // Do NOT loop inline. Schedule ASSEMBLY_POLL.
        console.log(`[Social Reel] Creatomate render started: ${render.id}. Scheduling polling...`);

        job.internalData.renderId = render.id; // Save render ID for polling (need to add to type? TS might complain, let's cast or add property)
        // Actually better to add it to type, but for now let's just use existing fields or assume internalData works
        // Update: I should add renderId to SocialReelJob type.
        // For now, I'll store it in internalData as 'avatarVideoId' reused? No that's confusing.
        // Let's just pass it in payload? step doesn't carry data.
        // I'll add it to internalData in a separate step or just cast `job.internalData` as any for this new field.
        job.internalData.renderId = render.id;
        await saveJob(job);

        await triggerNextStepWithDelay(jobId, 'ASSEMBLY_POLL', 10);

    } catch (e: any) {
        await updateJobStatus(jobId, 'failed', `Assembly failed: ${e.message}`);
    }
}

// STEP 4.5: ASSEMBLY POLL
async function processStepAssemblyPoll(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job || !job.internalData?.renderId) return;

    const renderId = job.internalData.renderId;

    try {
        const poll = await fetch(`${CREATOMATE_BASE_URL}/renders/${renderId}`, { headers: { Authorization: `Bearer ${getCreatomateApiKey()}` } });
        if (!poll.ok) throw new Error(`Creatomate poll failed: ${poll.statusText}`);

        const data = await poll.json() as any;
        const status = data.status;
        const resultUrl = data.url;

        console.log(`[Social Reel] [ASSEMBLY_POLL] Status: ${status}`);

        if (status === 'succeeded') {
            // Complete Job
            const ownerUid = job.internalData?.ownerUid || await getProjectOwnerUid(job.projectId);
            if (ownerUid) {
                await saveAssetToProject(job.projectId, ownerUid, {
                    name: `Social Reel - ${job.request.prompt?.slice(0, 30)}.mp4`,
                    type: 'video/mp4',
                    url: resultUrl
                });
            }

            job.status = 'completed';
            job.result = { url: resultUrl, durationSeconds: job.internalData?.plan?.totalDuration || 0 };
            job.internalData!.ownerUid = ownerUid;
            await saveJob(job);
            console.log(`[Social Reel] Job ${jobId} completed successfully!`);
            return;
        }

        if (status === 'failed' || status === 'transcoding_failed') {
            await updateJobStatus(jobId, 'failed', `Creatomate render failed: ${data.errorMessage || status}`);
            return;
        }

        // Still processing
        if (Date.now() - job.updatedAt > 20 * 60 * 1000) { // 20 min total timeout
            await updateJobStatus(jobId, 'failed', 'Assembly timed out');
            return;
        }

        await triggerNextStepWithDelay(jobId, 'ASSEMBLY_POLL', 10);

    } catch (e: any) {
        console.error('[Social Reel] Assembly poll error:', e);
        // Don't fail immediately on network blip, retry
        await triggerNextStepWithDelay(jobId, 'ASSEMBLY_POLL', 10);
    }
}


// ---------------------------------------------------------
// Main Handler & Dispatcher
// ---------------------------------------------------------

async function processSocialReelJob(payload: ProcessPayload): Promise<void> {
    const { jobId, step = 'PLAN' } = payload;
    console.log(`[Social Reel] Processing step ${step} for job ${jobId}`);

    // Immediately mark active for PLAN
    if (step === 'PLAN') {
        await updateJobStatus(jobId, 'planning', 'Starting reel generation...');
    }

    try {
        switch (step) {
            case 'PLAN': await processStepPlan(jobId); break;
            case 'AUDIO': await processStepAudio(jobId); break;
            case 'VIDEOS': await processStepVideos(jobId); break;
            case 'AVATAR_CREATE': await processStepAvatarCreate(jobId); break;
            case 'AVATAR_POLL': await processStepAvatarPoll(jobId); break;
            case 'ASSEMBLY': await processStepAssembly(jobId); break;
            case 'ASSEMBLY_POLL': await processStepAssemblyPoll(jobId); break;
            default: console.error(`[Social Reel] Unknown step: ${step}`);
        }
    } catch (error: any) {
        console.error(`[Social Reel] Dispatch error for ${step}:`, error);
        await updateJobStatus(jobId, 'failed', `Step ${step} failed: ${error?.message}`);
    }
}

// ---------------------------------------------------------
// Main Handler
// ---------------------------------------------------------

export default async function socialReelApi(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    try {
        switch (action) {
            case 'start': {
                const body = await req.json() as ReelRequest;
                if (!body.projectId || !body.prompt) return errorResponse('Missing projectId or prompt');

                // QStash is required for background processing (unless local)
                if (!qstash && !appUrl.includes('localhost')) {
                    console.error('[Social Reel] QSTASH_TOKEN not configured');
                    return errorResponse('Server configuration error: QSTASH_TOKEN missing', 500);
                }

                const jobId = `reel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                const job: SocialReelJob = {
                    id: jobId,
                    projectId: body.projectId,
                    status: 'queued',
                    request: body,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    internalData: { ownerUid: await getProjectOwnerUid(body.projectId) }
                };

                await saveJob(job);

                console.log(`[Social Reel] Starting job ${jobId}`);
                console.log(`[Social Reel] QStash configured: ${!!qstash}, QSTASH_TOKEN present: ${!!qstashToken}`);
                console.log(`[Social Reel] APP_URL: ${appUrl}`);
                console.log(`[Social Reel] Callback URL: ${buildQStashUrl('process')}`);
                console.log(`[Social Reel] VERCEL_PROTECTION_BYPASS present: ${!!vercelBypassToken}, length: ${vercelBypassToken?.length || 0}`);

                await triggerNextStep(jobId, 'PLAN'); // Kick off
                return json({ jobId, status: 'queued' });
            }

            case 'status': {
                const jobId = url.searchParams.get('jobId');
                if (!jobId) return errorResponse('Missing jobId');
                const job = await getJob(jobId);
                if (!job) return errorResponse('Job not found', 404);
                return json({
                    jobId: job.id,
                    status: job.status,
                    progress: job.progress,
                    result: job.result,
                    error: job.error
                });
            }

            case 'process': {
                // QStash Callback
                const body = await req.json() as ProcessPayload;
                const { jobId, step } = body;
                console.log(`[Social Reel] Processing ${step} for ${jobId}`);

                // Mark as processing immediately to avoid stuck 'queued' state
                if (step === 'PLAN') {
                    await updateJobStatus(jobId, 'planning', 'Starting reel generation...');
                }

                try {
                    switch (step) {
                        case 'PLAN': await processStepPlan(jobId); break;
                        case 'AUDIO': await processStepAudio(jobId); break;
                        case 'VIDEOS': await processStepVideos(jobId); break;
                        case 'AVATAR_CREATE': await processStepAvatarCreate(jobId); break;
                        case 'AVATAR_POLL': await processStepAvatarPoll(jobId); break;
                        case 'ASSEMBLY': await processStepAssembly(jobId); break;
                        default: console.error('Unknown step:', step);
                    }
                } catch (error: any) {
                    console.error(`[Social Reel] Uncaught error in step ${step}:`, error);
                    await updateJobStatus(jobId, 'failed', `Crash during ${step}: ${error?.message || 'Unknown error'}`);
                    return errorResponse(error?.message || 'Internal processing error', 500);
                }

                return json({ success: true });
            }

            default:
                return errorResponse('Invalid action');
        }
    } catch (e: any) {
        console.error('[Social Reel] API Error:', e);
        return errorResponse(e?.message || 'Internal Server Error', 500);
    }
}
