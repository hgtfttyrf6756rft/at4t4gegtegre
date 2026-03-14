import { authFetch } from './authFetch.js';

export interface WorldGenerationRequest {
    display_name?: string;
    world_prompt: {
        type: 'text' | 'image' | 'video' | 'multi-image';
        text_prompt?: string;
        image_prompt?: {
            source: 'uri' | 'media_asset';
            uri?: string;
            media_asset_id?: string;
            is_pano?: boolean;
        };
        video_prompt?: {
            source: 'uri' | 'media_asset';
            uri?: string;
            media_asset_id?: string;
        };
        multi_image_prompt?: Array<{
            azimuth: number;
            content: {
                source: 'uri' | 'media_asset';
                uri?: string;
                media_asset_id?: string;
            };
        }>;
    };
    model?: 'Marble 0.1-mini' | 'Marble 0.1-plus';
}

export interface OperationResponse {
    operation_id: string;
    created_at: string;
    updated_at: string;
    done: boolean;
    error?: {
        code?: number;
        message?: string;
    };
    metadata?: {
        progress?: {
            status: string;
            description: string;
        };
        world_id?: string;
    };
    response?: World;
}

export interface PrepareUploadResponse {
    media_asset: {
        id: string;
        file_name: string;
        kind: 'image' | 'video';
    };
    upload_info: {
        upload_url: string;
        required_headers?: Record<string, string>;
    };
}

export const worldLabsService = {
    /**
     * Start a world generation job
     */
    generateWorld: async (request: WorldGenerationRequest): Promise<OperationResponse> => {
        const response = await authFetch('/api/media?op=worldlabs-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || error.message || `World Labs Generate Error: ${response.status}`);
        }
        return response.json();
    },

    /**
     * Get operation status
     */
    getOperation: async (id: string): Promise<OperationResponse> => {
        const response = await authFetch(`/api/media?op=worldlabs-get-operation&id=${id}`);
        if (!response.ok) throw new Error(`World Labs Operation Error: ${response.status}`);
        return response.json();
    },

    /**
     * Upload a media file (Step 1: Prepare, Step 2: Upload direct)
     */
    uploadMedia: async (file: File): Promise<string> => {
        const kind = file.type.startsWith('image/') ? 'image' : 'video';
        const extension = file.name.split('.').pop() || (kind === 'image' ? 'jpg' : 'mp4');

        // 1. Prepare
        const prepareUrl = '/api/media?op=worldlabs-prepare-upload';
        console.log('[WorldLabs] calling:', prepareUrl);
        const prepareRes = await authFetch(prepareUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_name: file.name,
                kind,
                extension
            })
        });

        if (!prepareRes.ok) {
            console.error('[WorldLabs] Prepare upload failed:', prepareRes.status, await prepareRes.text().catch(() => ''));
            throw new Error('Failed to prepare upload');
        }
        const { media_asset, upload_info } = await prepareRes.json() as PrepareUploadResponse;

        // 2. Upload to signed URL
        const uploadHeaders = upload_info.required_headers || {};
        // Ensure content-type is set if not provided by required_headers, although usually it is.
        // The documentation says required_headers MUST be included.

        // Note: We use fetch directly here, not authFetch, because we are hitting a signed URL (GCS/S3)
        const uploadRes = await fetch(upload_info.upload_url, {
            method: 'PUT',
            headers: {
                ...uploadHeaders,
                // Depending on provider, Content-Type might be required or part of signature
            },
            body: file
        });

        if (!uploadRes.ok) throw new Error(`Failed to upload file to World Labs storage: ${uploadRes.status}`);

        return media_asset.id;
    },

    /**
     * Poll until complete
     */
    pollUntilComplete: async (
        operationId: string,
        onProgress?: (op: OperationResponse) => void
    ): Promise<OperationResponse['response']> => {
        const pollInterval = 5000; // 5 seconds
        const maxAttempts = 120; // 10 minutes max (generation takes ~5 mins)

        for (let i = 0; i < maxAttempts; i++) {
            const op = await worldLabsService.getOperation(operationId);
            if (onProgress) onProgress(op);

            if (op.done) {
                if (op.error) throw new Error(op.error.message || 'Generation failed');
                return op.response;
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        throw new Error('Polling timed out');
    },

    /**
     * Get a world by ID
     */
    getWorld: async (id: string): Promise<World> => {
        const response = await authFetch(`/api/media?op=worldlabs-get-world&id=${id}`);
        if (!response.ok) throw new Error(`World Labs Get World Error: ${response.status}`);
        return response.json();
    },

    /**
     * List worlds
     */
    listWorlds: async (filters: ListWorldsFilters = {}): Promise<ListWorldsResponse> => {
        const response = await authFetch('/api/media?op=worldlabs-list-worlds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(filters)
        });
        if (!response.ok) throw new Error(`World Labs List Worlds Error: ${response.status}`);
        return response.json();
    }
};

export interface World {
    display_name: string;
    world_id: string;
    world_marble_url: string;
    assets: {
        caption?: string;
        thumbnail_url?: string;
        [key: string]: any;
    };
    created_at: string;
    model?: string;
    permission?: {
        public: boolean;
        [key: string]: any;
    };
    tags?: string[];
    updated_at: string;
    world_prompt?: {
        text_prompt?: string;
        type?: string;
        [key: string]: any;
    };
}

export interface ListWorldsFilters {
    page_size?: number;
    page_token?: string;
    status?: string;
    model?: string;
    tags?: string[];
    is_public?: boolean;
    created_after?: string;
    created_before?: string;
    sort_by?: 'created_at' | 'updated_at';
}

export interface ListWorldsResponse {
    worlds: World[];
    next_page_token?: string;
}
