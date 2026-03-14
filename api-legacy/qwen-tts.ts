import { put } from '@vercel/blob';

function getDashscopeKey() {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error('DASHSCOPE_API_KEY is not defined in environment variables');
    return key;
}

export async function cloneVoice(audioUrl: string, prefix: string = 'cloned_voice'): Promise<string> {
    const apiKey = getDashscopeKey();
    const endpoint = 'https://dashscope-intl.aliyuncs.com/api/v1/services/audio/tts/customization';

    console.log(`[qwen-tts] Downloading audio from ${audioUrl} for enrollment...`);
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error(`Failed to fetch audio from blob: ${audioRes.statusText}`);

    const arrayBuffer = await audioRes.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = audioRes.headers.get('content-type') || 'audio/wav';
    const dataUrl = `data:${mimeType};base64,${base64Audio}`;

    console.log(`[qwen-tts] Enrolling new voice (${mimeType}, ${(base64Audio.length / 1024).toFixed(2)} KB)...`);
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'qwen-voice-enrollment',
            input: {
                action: 'create',
                target_model: 'qwen3-tts-vc-2026-01-22',
                preferred_name: prefix,
                audio: {
                    data: dataUrl
                }
            }
        })
    });

    if (!response.ok) {
        const text = await response.text();
        console.error('[qwen-tts] Voice clone error:', text);
        throw new Error(`Failed to clone voice: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.output && data.output.voice) {
        return data.output.voice;
    }

    throw new Error('Unexpected response format from DashScope voice enrollment');
}

export async function synthesizeVoice(
    text: string,
    voiceId: string
): Promise<{ audioData: string; mimeType: string, durationSeconds: number }> {
    const apiKey = getDashscopeKey();
    // Qwen3-TTS models require the multimodal-generation endpoint and return a JSON payload with an audio URL
    const endpoint = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

    console.log(`[qwen-tts] Synthesizing speech with voice ${voiceId}...`);

    // We send using the Multimodal Conversation pattern
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'qwen3-tts-vc-2026-01-22',
            input: {
                text: text,
                voice: voiceId
            }
        })
    });

    if (!response.ok) {
        const err = await response.text();
        console.error('[qwen-tts] Synthesis error:', err);
        throw new Error(`Failed to synthesize voice: ${response.statusText}`);
    }

    const json = await response.json();
    if (!json.output || !json.output.audio || !json.output.audio.url) {
        console.error('[qwen-tts] Unexpected response JSON format:', JSON.stringify(json, null, 2));
        throw new Error('Missing output.audio.url in DashScope response.');
    }

    const audioUrl = json.output.audio.url;
    console.log(`[qwen-tts] Synthesis succeeded. Fetching audio from: ${audioUrl}`);

    // Fetch the actual audio file
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
        throw new Error(`Failed to download audio from DashScope URL: ${audioRes.statusText}`);
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const audioData = buffer.toString('base64');

    // Estimate string duration from bytes. WAV header is 44 bytes. 
    // 16000 Hz * 1 channel * 2 bytes/sample = 32000 bytes/sec
    const dataSize = buffer.length > 44 ? buffer.length - 44 : buffer.length;
    const durationSeconds = dataSize / 32000;

    return {
        audioData,
        mimeType: 'audio/wav',
        durationSeconds
    };
}

export async function handleCloneVoice(req: Request): Promise<Response> {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    try {
        const body = await req.json();
        const { audioUrl, prefix } = body;
        if (!audioUrl) {
            return new Response(JSON.stringify({ error: 'audioUrl is required' }), { status: 400 });
        }
        const voiceId = await cloneVoice(audioUrl, prefix);
        return new Response(JSON.stringify({ voiceId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}

export async function handleSynthesizePreview(req: Request): Promise<Response> {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    try {
        const body = await req.json();
        const { text, voiceId } = body;
        if (!text || !voiceId) {
            return new Response(JSON.stringify({ error: 'text and voiceId are required' }), { status: 400 });
        }
        const { audioData, mimeType } = await synthesizeVoice(text, voiceId);

        // Return base64 to frontend to play
        return new Response(JSON.stringify({ audioData, mimeType }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}
