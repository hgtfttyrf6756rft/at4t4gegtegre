import { authFetch } from './authFetch.js';
import { mediaService } from './mediaService.js';

export interface XAIGenerateRequest {
    prompt: string;
    image_url?: string; // Optional image reference
    duration?: number; // 1-15 seconds
    aspect_ratio?: '16:9' | '4:3' | '1:1' | '9:16' | '3:4' | '3:2' | '2:3';
    resolution?: '720p' | '480p';
    model?: 'grok-imagine-video'; // Default
}

export interface XAIVideoResponse {
    request_id: string; // Used for polling
    id?: string; // Sometimes returned
    status?: 'processing' | 'completed' | 'failed';
    url?: string; // Final video URL
    duration?: number;
    model?: string;
    error?: string;
}

export interface XAIEditRequest {
    prompt: string;
    video_url: string;
    image_url?: string; // Optional image reference
    model?: 'grok-imagine-video'; // Default
}

export const xaiService = {
    /**
     * Generate a video using xAI (Grok Imagine)
     */
    generateVideo: async (params: XAIGenerateRequest): Promise<XAIVideoResponse> => {
        // Ensure image_url is remote if provided
        const remoteImageUrl = await mediaService.ensureRemoteUrl(params.image_url);

        const response = await authFetch('/api/media?op=xai-generate-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: params.prompt,
                image_url: remoteImageUrl || params.image_url,
                duration: params.duration,
                aspect_ratio: params.aspect_ratio,
                resolution: params.resolution,
                model: params.model || 'grok-imagine-video'
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || error.message || `xAI Generation Error: ${response.status}`);
        }
        return response.json();
    },

    /**
     * Edit a video using xAI (Grok Imagine)
     */
    editVideo: async (params: XAIEditRequest): Promise<XAIVideoResponse> => {
        // Ensure both video_url and image_url are remote
        const [remoteVideoUrl, remoteImageUrl] = await Promise.all([
            mediaService.ensureRemoteUrl(params.video_url),
            mediaService.ensureRemoteUrl(params.image_url)
        ]);

        const response = await authFetch('/api/media?op=xai-edit-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: params.prompt,
                video: { url: remoteVideoUrl || params.video_url },
                image_url: remoteImageUrl || params.image_url,
                model: params.model || 'grok-imagine-video'
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || error.message || `xAI Edit Error: ${response.status}`);
        }
        return response.json();
    },

    /**
     * Get video status/result
     */
    getVideo: async (id: string): Promise<XAIVideoResponse> => {
        const response = await authFetch(`/api/media?op=xai-get-video&id=${id}`);
        if (!response.ok) {
            if (response.status === 404) throw new Error('Video not found');
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || error.message || `xAI Get Video Error: ${response.status}`);
        }
        return response.json();
    },

    /**
     * Poll until complete
     */
    pollUntilComplete: async (
        requestId: string,
        onProgress?: (status: string) => void
    ): Promise<XAIVideoResponse> => {
        const pollInterval = 5000; // 5 seconds
        const maxAttempts = 60; // 5 minutes max

        for (let i = 0; i < maxAttempts; i++) {
            try {
                const result = await xaiService.getVideo(requestId);

                // If we get a URL, it's done
                if (result.url) {
                    return { ...result, status: 'completed' };
                }

                if (result.status === 'failed') {
                    throw new Error(result.error || 'Video generation failed');
                }

                if (onProgress) onProgress(result.status || 'processing');

                await new Promise(resolve => setTimeout(resolve, pollInterval));
            } catch (err: any) {
                // If it's a 404, it might just be initializing, so ignore first few failures
                if (i > 3 && err.message === 'Video not found') throw err;
                if (err.message !== 'Video not found') console.warn('Polling error:', err);
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
        }
        throw new Error('Polling timed out');
    }
};
