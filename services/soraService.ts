import { generateImage } from './geminiService.js';
import { authFetch } from './authFetch.js';

export type SoraModel = 'sora-2' | 'sora-2-pro' | 'veo-3.1';

export interface CreateVideoOptions {
  model?: SoraModel;
  prompt: string;
  seconds?: '4' | '8' | '12' | '5' | '10' | '15';
  size?: '720x1280' | '1280x720' | '1024x1792' | '1792x1024' | '1024x768' | '1024x1024' | '768x1024' | '1024x682' | '682x1024';
}

export interface VideoJob {
  id: string;
  object: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  model: string;
  progress?: number;
  seconds?: string;
  size?: string;
  error?: { message?: string };
}

const SORA_API_ROUTE = '/api/sora-video';

const postSoraJob = async (payload: Record<string, any>): Promise<VideoJob> => {
  const res = await authFetch(SORA_API_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || 'Failed to create Sora video');
  }
  return res.json();
};

const fetchJson = async (url: string): Promise<VideoJob> => {
  const res = await authFetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || 'Failed to fetch Sora job');
  }
  return res.json();
};

const fetchBlob = async (url: string): Promise<Blob> => {
  const res = await authFetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || 'Failed to download Sora video');
  }
  return res.blob();
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export async function createVideoFromText(options: CreateVideoOptions): Promise<VideoJob> {
  return postSoraJob({
    model: options.model || 'sora-2',
    prompt: options.prompt,
    seconds: options.seconds,
    size: options.size,
    mode: 'text',
  });
}

export async function createVideoFromImage(options: CreateVideoOptions, imageFile: File): Promise<VideoJob> {
  const imageDataUrl = await fileToDataUrl(imageFile);
  return postSoraJob({
    model: options.model || 'sora-2',
    prompt: options.prompt,
    seconds: options.seconds,
    size: options.size,
    mode: 'image',
    imageDataUrl,
  });
}

export async function createVideoFromImageUrl(options: CreateVideoOptions, imageUrl: string): Promise<VideoJob> {
  let imageDataUrl = imageUrl;

  // If not already a data URL, fetch and convert
  if (!imageUrl.startsWith('data:')) {
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      imageDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.error("Failed to convert image URL to data URL", e);
      throw new Error("Failed to process image for video generation");
    }
  }

  return postSoraJob({
    model: options.model || 'sora-2',
    prompt: options.prompt,
    seconds: options.seconds,
    size: options.size,
    mode: 'image',
    imageDataUrl,
  });
}

export async function retrieveVideo(id: string): Promise<VideoJob> {
  const url = `${SORA_API_ROUTE}?id=${encodeURIComponent(id)}&type=job`;
  return fetchJson(url);
}

export async function downloadVideoBlob(id: string, variant: 'video' | 'thumbnail' | 'spritesheet' = 'video'): Promise<Blob> {
  const url = `${SORA_API_ROUTE}?id=${encodeURIComponent(id)}&type=content&variant=${variant}`;
  return fetchBlob(url);
}

export async function pollVideoUntilComplete(id: string, onProgress?: (job: VideoJob) => void, pollMs = 5000): Promise<VideoJob> {
  let job = await retrieveVideo(id);
  if (onProgress) onProgress(job);
  while (job.status === 'queued' || job.status === 'in_progress') {
    await new Promise(r => setTimeout(r, pollMs));
    job = await retrieveVideo(id);
    if (onProgress) onProgress(job);
  }
  return job;
}

// Simple image generation helper (prototype only; not for production use)
export interface GeneratedImage {
  url: string; // object URL for display
  prompt: string;
}

// Use shared Gemini image generation helper (Pro -> Flash -> Pexels) for prototype image creation
export async function createImage(prompt: string, _size: '1024x1024' | '768x768' | '512x512' = '1024x1024'): Promise<GeneratedImage> {
  const result = await generateImage(prompt);
  const url = result.imageDataUrl;
  return { url, prompt };
}
// End of soraService.ts
