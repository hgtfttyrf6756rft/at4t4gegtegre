import { authFetch } from './authFetch.js';

export interface SunoGenerateRequest {
    prompt: string;
    style?: string;
    title?: string;
    instrumental?: boolean;
    lyrics?: string;
}

export interface SunoLyricsRequest {
    prompt: string;
}

export interface SunoSong {
    id: string;
    title: string;
    status: string;
    audio_url: string;
    image_url: string;
    lyrics: string;
    duration: number;
    style: string;
}

export interface SunoGenerateResponse {
    taskId: string;
    status: string;
}

export interface SunoLyricsResponse {
    taskId: string;
    status: string;
}

export interface SunoTaskResponse {
    taskId: string;
    status: string;
    type: 'music' | 'lyrics';
    songs?: SunoSong[];
    lyrics?: string;
    title?: string;
}

export const sunoService = {
    /**
     * Generate music using Suno AI
     */
    generateSong: async (params: SunoGenerateRequest): Promise<SunoGenerateResponse> => {
        const response = await authFetch('/api/media?op=suno-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `Suno Generation Error: ${response.status}`);
        }
        return response.json();
    },

    /**
     * Generate lyrics using Suno AI
     */
    generateLyrics: async (params: SunoLyricsRequest): Promise<SunoLyricsResponse> => {
        const response = await authFetch('/api/media?op=suno-generate-lyrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `Suno Lyrics Error: ${response.status}`);
        }
        return response.json();
    },

    /**
     * Get song/lyrics task status
     * @param type - 'music' or 'lyrics' — determines which Suno polling endpoint to use
     */
    getTask: async (taskId: string, type: 'music' | 'lyrics' = 'music'): Promise<SunoTaskResponse> => {
        const response = await authFetch(`/api/media?op=suno-get&id=${taskId}&type=${type}`);
        if (!response.ok) {
            if (response.status === 404) throw new Error('Task not found');
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `Suno Get Task Error: ${response.status}`);
        }
        return response.json();
    },

    /**
     * Poll until music generation is complete
     */
    pollUntilComplete: async (
        taskId: string,
        onProgress?: (status: string) => void,
        type: 'music' | 'lyrics' = 'music',
    ): Promise<SunoTaskResponse> => {
        const pollInterval = 5000; // 5 seconds
        const maxAttempts = 60; // 5 minutes max

        for (let i = 0; i < maxAttempts; i++) {
            try {
                const result = await sunoService.getTask(taskId, type);

                if (result.status === 'completed' || result.status === 'complete') {
                    return result;
                }

                if (result.status === 'failed' || result.status === 'error') {
                    throw new Error('Song generation failed');
                }

                if (onProgress) onProgress(result.status || 'processing');

                await new Promise(resolve => setTimeout(resolve, pollInterval));
            } catch (err: any) {
                // If it's early and just initializing, retry
                if (i > 5 && err.message === 'Task not found') throw err;
                if (err.message !== 'Task not found') console.warn('Polling error:', err);
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
        }
        throw new Error('Polling timed out — song generation took too long');
    },
};
