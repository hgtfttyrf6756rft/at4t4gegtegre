import { requireAuth } from './_auth.js';

const VIDEO_API_BASE = 'https://api.openai.com/v1/videos';

type CreateVideoRequest = {
  prompt?: string;
  model?: string;
  seconds?: '4' | '8' | '12' | string;
  size?: '720x1280' | '1280x720' | '1024x1792' | '1792x1024' | string;
  mode?: 'text' | 'image';
  imageDataUrl?: string;
};

const getOpenAiKey = (): string => {
  const key = process.env.OPENAI_API_KEY || process.env.SORA_API_KEY;
  if (!key) {
    throw new Error('Missing OPENAI_API_KEY environment variable for Sora video generation');
  }
  return key;
};

const dataUrlToBlob = (dataUrl: string): Blob => {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL for image reference');
  }
  const mimeType = match[1] || 'image/png';
  const buffer = Buffer.from(match[2], 'base64');
  return new Blob([buffer], { type: mimeType });
};

const buildFormData = (payload: CreateVideoRequest): FormData => {
  const { prompt, model = 'sora-2', seconds, size, mode = 'text', imageDataUrl } = payload;
  if (!prompt?.trim()) {
    throw new Error('Prompt is required for Sora video generation');
  }

  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt.trim());
  if (seconds) {
    form.append('seconds', seconds);
  }
  if (size) {
    form.append('size', size);
  }

  if (mode === 'image') {
    if (!imageDataUrl) {
      throw new Error('imageDataUrl is required for image-to-video requests');
    }
    const blob = dataUrlToBlob(imageDataUrl);
    form.append('input_reference', blob, `reference-${Date.now()}.png`);
  }

  return form;
};

const errorResponse = (message: string, status = 400) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const createJob = async (body: CreateVideoRequest): Promise<Response> => {
  try {
    const apiKey = getOpenAiKey();
    const form = buildFormData(body);
    const res = await fetch(VIDEO_API_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return errorResponse(`Sora create video failed: ${res.status} ${text || ''}`, res.status);
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[api/sora-video] Create job error:', error);
    return errorResponse(error?.message || 'Failed to create Sora video', 500);
  }
};

const fetchJobInfo = async (id: string): Promise<Response> => {
  try {
    const apiKey = getOpenAiKey();
    const res = await fetch(`${VIDEO_API_BASE}/${id}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return errorResponse(`Sora job fetch failed: ${res.status} ${text || ''}`, res.status);
    }
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[api/sora-video] Fetch job error:', error);
    return errorResponse(error?.message || 'Failed to retrieve Sora job', 500);
  }
};

const fetchJobContent = async (id: string, variant: 'video' | 'thumbnail' | 'spritesheet'): Promise<Response> => {
  try {
    const apiKey = getOpenAiKey();
    const url = `${VIDEO_API_BASE}/${id}/content${variant === 'video' ? '' : `?variant=${variant}`}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return errorResponse(`Sora content fetch failed: ${res.status} ${text || ''}`, res.status);
    }

    const headers = new Headers(res.headers);
    return new Response(res.body, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    console.error('[api/sora-video] Fetch content error:', error);
    return errorResponse(error?.message || 'Failed to download Sora video', 500);
  }
};

export default {
  async fetch(request: Request): Promise<Response> {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    if (request.method === 'POST') {
      const body = (await request.json()) as CreateVideoRequest;
      return createJob(body);
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const type = searchParams.get('type') || 'job';
    if (!id) {
      return errorResponse('Missing id parameter', 400);
    }

    if (type === 'content') {
      const variant = (searchParams.get('variant') as 'video' | 'thumbnail' | 'spritesheet') || 'video';
      return fetchJobContent(id, variant);
    }

    return fetchJobInfo(id);
  },
};
