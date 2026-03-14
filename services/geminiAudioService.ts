import { authFetch } from './authFetch.js';
import { mediaService } from './mediaService.js';

export interface AudioAnalysisResponse {
    text: string;
}

export const geminiAudioService = {
    async analyzeAudio(audioUrl: string, prompt?: string): Promise<string> {
        // Ensure the audio URL is remote (data/blob -> Vercel Blob)
        const remoteAudioUrl = await mediaService.ensureRemoteUrl(audioUrl);

        const res = await authFetch('/api/media?op=gemini-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioUrl: remoteAudioUrl, prompt }),
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            const message = error.error || error.message || `Failed to analyze audio: ${res.status}`;
            throw new Error(message);
        }

        const data = await res.json();
        return data.text;
    }
};
