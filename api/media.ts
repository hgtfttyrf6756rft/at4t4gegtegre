import * as pexelsImage from '../api-legacy/pexels-image.js';
import * as geminiImage from '../api-legacy/gemini-image.js';
import * as soraVideo from '../api-legacy/sora-video.js';
import * as creatomate from '../api-legacy/creatomate.js';
import * as videoOverview from '../api-legacy/video-overview.js';
import * as youtubeVideoAnalysis from '../api-legacy/youtube-video-analysis.js';
import * as xaiVideo from '../api-legacy/xai-video.js';
import * as lumaVideo from '../api-legacy/luma-video.js';
import * as sunoMusic from '../api-legacy/suno-music.js';
import * as klingVideo from '../api-legacy/kling-video.js';
import * as geminiAudio from '../api-legacy/gemini-audio.js';
import * as socialReel from '../api-legacy/social-reel.js';
import * as qwenTts from '../api-legacy/qwen-tts.js';

// Privacy operations (consolidated from privacy.ts)
import * as accountDelete from '../api-legacy/account-delete.js';
import * as dataDeletionCallback from '../api-legacy/data-deletion-callback.js';
import * as dataDeletionStatus from '../api-legacy/data-deletion-status.js';

import { put, del } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

type LegacyModule = {
  default?: { fetch?: (request: Request) => Promise<Response> | Response } | ((request: Request) => Promise<Response> | Response);
  fetch?: (request: Request) => Promise<Response> | Response;
  GET?: (request: Request) => Promise<Response> | Response;
  POST?: (request: Request) => Promise<Response> | Response;
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const error = (message: string, status = 400, details?: any) => json({ error: message, details }, status);

const callLegacyModule = async (mod: LegacyModule, request: Request): Promise<Response> => {
  const handler =
    (mod?.default as any)?.fetch ||
    (typeof mod?.default === 'function' ? (mod.default as any) : null) ||
    mod?.fetch ||
    (request.method === 'GET' ? mod?.GET : null) ||
    (request.method === 'POST' ? mod?.POST : null);

  if (typeof handler !== 'function') {
    throw new Error('Legacy handler missing');
  }

  return await handler(request);
};

const ALLOWED: Record<string, LegacyModule> = {
  // Media operations
  'pexels-image': pexelsImage,
  'gemini-image': geminiImage,
  'sora-video': soraVideo,
  'creatomate-video': { fetch: (req: Request) => req.json().then(body => creatomate.handleVoiceoverVideo(body)) } as any,
  'creatomate-overview-video': { fetch: (req: Request) => req.json().then(body => creatomate.handleOverviewVideo(body)) } as any,
  'creatomate-slideshow': { fetch: (req: Request) => req.json().then(body => creatomate.handleSlideshowVideo(body)) } as any,
  'video-overview': videoOverview,
  'youtube-video-analysis': youtubeVideoAnalysis,
  'xai-edit-video': xaiVideo,
  'xai-generate-video': xaiVideo,
  'xai-get-video': xaiVideo,
  'luma-modify': lumaVideo,
  'luma-get-generation': lumaVideo,
  'suno-generate': sunoMusic,
  'suno-generate-lyrics': sunoMusic,
  'suno-get': sunoMusic,
  'kling-generate-video': klingVideo,
  'kling-get-video': klingVideo,
  'kling-identify-face': klingVideo,
  'kling-create-lipsync': klingVideo,
  'kling-get-lipsync': klingVideo,
  'kling-generate-multi-video': klingVideo,
  'kling-get-multi-video': klingVideo,
  'kling-generate-avatar': klingVideo,
  'kling-get-avatar': klingVideo,
  'stitch-video': { fetch: (req: Request) => req.json().then(body => creatomate.handleStitchVideo(body)) } as any,
  'gemini-audio': geminiAudio,
  // Privacy operations (consolidated from privacy.ts)
  'account-delete': accountDelete,
  'data-deletion-callback': dataDeletionCallback,
  'data-deletion-status': dataDeletionStatus,
  'social-reel': socialReel,
  'qwen-clone-voice': { fetch: (req: Request) => qwenTts.handleCloneVoice(req) } as any,
  'qwen-synthesize-preview': { fetch: (req: Request) => qwenTts.handleSynthesizePreview(req) } as any,
};

const getBlobToken = () =>
  process.env.BLOB_READ_WRITE_TOKEN_FOR_FRONTEND ||
  process.env.BLOB_READ_WRITE_TOKEN_FOR_FRONTENT ||
  process.env.researcher_READ_WRITE_TOKEN ||
  process.env.BLOB_READ_WRITE_TOKEN ||
  undefined;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url, 'http://localhost');
    const op = (url.searchParams.get('op') || '').trim();
    if (!op) return error('Missing op', 400);

    // New Blob/Media Operations (Merged from api/blob.ts and api/blob/upload.ts)
    try {
      if (op === 'upload-token') {
        if (request.method !== 'POST') return error('Method not allowed', 405);

        try {
          const token = getBlobToken();
          if (!token) {
            console.error('[Media API] Missing BLOB_READ_WRITE_TOKEN');
            return error('Server configuration error: Missing Blob Token', 500);
          }

          const body = (await request.json()) as HandleUploadBody;
          const jsonResponse = await handleUpload({
            body,
            request,
            token, // Explicitly pass it
            onBeforeGenerateToken: async (pathname) => {
              return {
                allowedContentTypes: [
                  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
                  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/ogg',
                  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac',
                  // Documents
                  'application/pdf', 'text/csv', 'text/plain', 'text/markdown',
                  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  'application/octet-stream'
                ],
                addRandomSuffix: true,
              };
            },
            onUploadCompleted: async ({ blob }) => {
              console.log('[Media API] Blob upload completed:', blob.url);
            },
          });
          return json(jsonResponse);
        } catch (uploadError: any) {
          console.error('[Media API] handleUpload failed:', uploadError);
          return error(`Upload token generation failed: ${uploadError.message}`, 500);
        }
      }

      if (op === 'upload-blob') {
        if (request.method !== 'POST') return error('Method not allowed', 405);

        const projectId = url.searchParams.get('projectId') || 'unknown-project';
        const filename = url.searchParams.get('filename') || 'file';
        const contentType = url.searchParams.get('contentType') || 'application/octet-stream';

        const arrayBuffer = await request.arrayBuffer();
        const data = new Blob([arrayBuffer], { type: contentType });

        const pathname = `projects/${projectId}/${filename}`;
        const token = getBlobToken();

        const stored = await put(pathname, data, {
          access: 'public',
          addRandomSuffix: true,
          token,
        });

        return json(stored);
      }

      if (op === 'delete-blob') {
        if (request.method !== 'POST') return error('Method not allowed', 405);
        const body = await request.json().catch(() => ({}));
        const pathname = (body?.pathname || '').toString();

        if (!pathname) return error('Missing pathname', 400);

        const token = getBlobToken();
        await del(pathname, { token });

        return json({ success: true });
      }

    } catch (e: any) {
      console.error('[Media API] Blob operation failed:', e);
      return error(e?.message || 'Blob operation failed', 500);
    }

    // Proxy Image Operation
    if (op === 'proxy-image') {
      const imageUrl = url.searchParams.get('url');
      if (!imageUrl) return error('Missing url parameter', 400);

      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          return error(`Failed to fetch image: ${response.status}`, response.status);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type') || 'application/octet-stream';

        // CORS Headers handled by Vercel usually, but explicit headers for the image response:
        const headers = {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        };

        return new Response(buffer, { status: 200, headers });
      } catch (e: any) {
        console.error('[Media API] Proxy image failed:', e);
        return error('Failed to proxy image', 500);
      }
    }

    // Proxy World Labs Asset Operation
    if (op === 'proxy-world-asset') {
      const assetUrl = url.searchParams.get('url');
      if (!assetUrl) return error('Missing url parameter', 400);

      // Security: Only allow World Labs CDN
      if (!assetUrl.startsWith('https://cdn.marble.worldlabs.ai/')) {
        console.warn('[Media API] Rejected non-World Labs URL:', assetUrl);
        return error('Invalid asset URL - only World Labs CDN is allowed', 403);
      }

      try {
        console.log('[Media API] Proxying World Labs asset:', assetUrl);
        const response = await fetch(assetUrl);

        if (!response.ok) {
          console.error('[Media API] World Labs CDN returned error:', response.status);
          return error(`Failed to fetch asset: ${response.status}`, response.status);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type') || 'application/octet-stream';

        // Headers for CORS and caching
        const headers = {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400', // 24 hours for large 3D files
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Content-Length': buffer.length.toString()
        };

        return new Response(buffer, { status: 200, headers });
      } catch (e: any) {
        console.error('[Media API] Proxy world asset failed:', e);
        return error('Failed to proxy world asset', 500);
      }
    }

    // Proxy xAI Video Asset Operation
    if (op === 'proxy-xai-video') {
      const videoUrl = url.searchParams.get('url');
      if (!videoUrl) return error('Missing url parameter', 400);

      // Security: Only allow xAI CDN
      if (!videoUrl.startsWith('https://vidgen.x.ai/')) {
        console.warn('[Media API] Rejected non-xAI URL:', videoUrl);
        return error('Invalid video URL - only xAI CDN is allowed', 403);
      }

      try {
        console.log('[Media API] Proxying xAI video:', videoUrl);
        const response = await fetch(videoUrl);

        if (!response.ok) {
          console.error('[Media API] xAI CDN returned error:', response.status);
          return error(`Failed to fetch video: ${response.status}`, response.status);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type') || 'video/mp4';

        const headers = {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Content-Length': buffer.length.toString()
        };

        return new Response(buffer, { status: 200, headers });
      } catch (e: any) {
        console.error('[Media API] Proxy xAI video failed:', e);
        return error('Failed to proxy xAI video', 500);
      }
    }

    // Legacy Modules
    const mod = ALLOWED[op];
    if (!mod) return error('Not found', 404);

    try {
      return await callLegacyModule(mod, request);
    } catch (e: any) {
      return error(e?.message || 'Internal error', 500);
    }
  },
};
