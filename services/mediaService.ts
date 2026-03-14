import { upload } from '@vercel/blob/client';

export const mediaService = {
    /**
     * Uploads a File or Blob to Vercel Blob storage.
     * This is performed client-side to bypass serverless function limits.
     */
    async uploadToBlob(file: File | Blob, filename?: string): Promise<string> {
        const name = filename || (file as File).name || `upload-${Date.now()}`;

        console.log('[MediaService] Starting blob upload:', { name, size: file.size, type: file.type });

        try {
            const blob = await upload(name, file, {
                access: 'public',
                handleUploadUrl: '/api/blob/upload',
            });

            console.log('[MediaService] Upload successful:', blob.url);
            return blob.url;
        } catch (error: any) {
            console.error('[MediaService] Upload failed:', error);
            throw new Error(error?.message || 'Failed to upload media to blob storage');
        }
    },

    /**
     * Checks if a URL is "local" (data: or blob:) or internal (gemini-api) 
     * and uploads it to a permanent remote location if so.
     */
    async ensureRemoteUrl(url: string | null | undefined): Promise<string | null | undefined> {
        if (!url) return url;

        const isDataUrl = url.startsWith('data:');
        const isBlobUrl = url.startsWith('blob:');
        const isGeminiUrl = url.includes('generativelanguage.googleapis.com'); // Gemini temp URLs

        if (isDataUrl || isBlobUrl || isGeminiUrl) {
            console.log(`[MediaService] Detected non-permanent URL, uploading to Blob: ${url.substring(0, 50)}...`);

            try {
                const response = await fetch(url);
                const blob = await response.blob();

                // Extract a sensible filename
                let filename = 'media-asset';
                if (isDataUrl) {
                    const mime = url.split(';')[0].split(':')[1];
                    const ext = mime.split('/')[1] || 'bin';
                    filename = `asset-${Date.now()}.${ext}`;
                } else if (isBlobUrl || isGeminiUrl) {
                    const urlObj = new URL(url);
                    const path = urlObj.pathname;
                    const lastPart = path.split('/').pop();
                    if (lastPart && lastPart.includes('.')) {
                        filename = lastPart;
                    } else {
                        filename = `asset-${Date.now()}`;
                    }
                }

                return await this.uploadToBlob(blob, filename);
            } catch (error) {
                console.error('[MediaService] failed to ensure remote URL:', error);
                return url; // Fallback to original if upload fails, though might still 413
            }
        }

        return url;
    }
};
