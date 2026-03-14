import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;
// Use a model capable of audio understanding like 1.5 Flash or 2.0 Flash
const MODEL_AUDIO = process.env.MODEL_FAST || 'gemini-1.5-flash';

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const errorResponse = (message: string, status = 400) => json({ error: message }, status);

async function fetchAudioAsBase64(url: string): Promise<{ data: string, mimeType: string }> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch audio: ${res.statusText}`);
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = res.headers.get('content-type') || 'audio/mp3';
    // Ensure valid MIME type for Gemini (audio/wav, audio/mp3, audio/aiff, audio/aac, audio/ogg, audio/flac)
    // Suno usually returns audio/mpeg which maps to audio/mp3
    return { data: base64, mimeType };
}

export async function handleAnalyzeAudio(request: Request): Promise<Response> {
    if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

    try {
        const { audioUrl, prompt } = await request.json();

        if (!audioUrl) return errorResponse('audioUrl is required');
        if (!process.env.GEMINI_API_KEY) return errorResponse('GEMINI_API_KEY not configured', 500);

        const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const { data, mimeType } = await fetchAudioAsBase64(audioUrl);

        const response = await client.models.generateContent({
            model: MODEL_AUDIO,
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: prompt || 'Describe this audio clip.' },
                        {
                            inlineData: {
                                mimeType,
                                data
                            }
                        }
                    ]
                }
            ]
        });

        const text = (response.text || '').trim();
        return json({ text });

    } catch (error: any) {
        console.error('[gemini-audio] Error:', error);
        return errorResponse(error.message || 'Failed to analyze audio', 500);
    }
}

export default {
    fetch: handleAnalyzeAudio
};
