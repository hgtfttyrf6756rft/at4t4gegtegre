
export interface LumaModifyRequest {
    media: { url: string };
    first_frame?: { url: string };
    model: 'ray-2' | 'ray-flash-2';
    mode: 'adhere_1' | 'adhere_2' | 'adhere_3' | 'flex_1' | 'flex_2' | 'flex_3' | 'reimagine_1' | 'reimagine_2' | 'reimagine_3';
    prompt: string;
    callback_url?: string;
}

export interface LumaGenerationResponse {
    id: string;
    state: 'queued' | 'dreaming' | 'completed' | 'failed';
    failure_reason?: string;
    assets?: {
        video?: string;
        image?: string;
        progress_video?: string;
        first_frame?: string;
    };
    created_at: string;
    generation_type: string;
    request?: any;
}

import { authFetch } from './authFetch.js';

export const lumaService = {
    /**
     * Modify a video using Luma Dream Machine
     */
    modifyVideo: async (params: LumaModifyRequest): Promise<LumaGenerationResponse> => {
        const response = await authFetch(`/api/media?op=luma-modify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                generation_type: 'modify_video',
                ...params
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `Luma API Error: ${response.status}`);
        }

        return response.json();
    },

    /**
     * Get generation status
     */
    getGeneration: async (id: string): Promise<LumaGenerationResponse> => {
        const response = await authFetch(`/api/media?op=luma-get-generation&id=${id}`, {
            method: 'GET'
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            // If 404, might be expired or wrong ID
            if (response.status === 404) {
                throw new Error('Generation not found');
            }
            throw new Error(error.error || `Luma API Error: ${response.status}`);
        }

        return response.json();
    }
};
