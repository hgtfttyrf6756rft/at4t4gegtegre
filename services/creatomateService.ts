// Creatomate RenderScript video helper (voiceover slideshow fallback)
// NOTE: This is a prototype client used as a fallback when Sora video generation fails.

import { authFetch } from './authFetch.js';

export interface CreatomateRender {
  id: string;
  status: string;
  url?: string;
  snapshot_url?: string;
  output_format?: string;
  width?: number;
  height?: number;
  duration?: number;
  file_size?: number;
  error_message?: string | null;
}


const CREATOMATE_ROUTE = '/api/creatomate-video';
const CREATOMATE_OVERVIEW_ROUTE = '/api/creatomate-overview-video';
const CREATOMATE_SLIDESHOW_ROUTE = '/api/creatomate-slideshow';

export type CreatomateAspect = '720x1280' | '1280x720' | '1024x1792' | '1792x1024';

export interface CreatomateFallbackOptions {
  prompt: string;
  voiceoverPrompt?: string;
  aspect?: CreatomateAspect | string;
  durationSeconds?: number;
  contextDescription?: string;
}

export interface CreatomateGeneratedVideo {
  url: string;
  snapshotUrl?: string;
  durationSeconds?: number;
}

export interface CreatomateOverviewOptions {
  projectId: string;
  prompt: string;
  aspect?: CreatomateAspect | string;
  contextDescription?: string;
  slideCount?: number;
}

export async function createVoiceoverVideoWithCreatomate(
  options: CreatomateFallbackOptions,
): Promise<CreatomateGeneratedVideo> {
  const res = await authFetch(CREATOMATE_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || 'Failed to create Creatomate video');
  }

  return res.json();
}

export async function createOverviewVideoWithCreatomate(
  options: CreatomateOverviewOptions,
): Promise<CreatomateGeneratedVideo> {
  const res = await authFetch(CREATOMATE_OVERVIEW_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || 'Failed to create Creatomate overview video');
  }

  return res.json();
}

const VIDEO_OVERVIEW_ROUTE = '/api/video-overview';

export interface VideoOverviewOptions {
  projectId: string;
  prompt: string;
  aspect?: CreatomateAspect | string;
  contextDescription?: string;
  slideCount?: number;
  voiceName?: string;
  avatarUrl?: string;
  onStatusUpdate?: (status: string, progress?: string) => void;
}

export interface VideoOverviewJobStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'generating_script' | 'generating_audio' | 'generating_images' | 'assembling' | 'completed' | 'failed';
  progress?: string;
  result?: CreatomateGeneratedVideo;
  error?: string;
}

/**
 * Start a video overview job and poll until completion
 */
export async function createVideoOverview(
  options: VideoOverviewOptions,
): Promise<CreatomateGeneratedVideo> {
  const { onStatusUpdate, ...requestOptions } = options;

  // Step 1: Start the job
  const startRes = await authFetch(`${VIDEO_OVERVIEW_ROUTE}?action=start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestOptions),
  });

  if (!startRes.ok) {
    const text = await startRes.text().catch(() => startRes.statusText);
    throw new Error(text || 'Failed to start video overview job');
  }

  const { jobId } = await startRes.json() as { jobId: string };
  onStatusUpdate?.('queued', 'Job queued...');

  // Store jobId in localStorage for persistence across page refreshes
  try {
    const trackedJobs = JSON.parse(localStorage.getItem('videoOverviewJobs') || '[]');
    if (!trackedJobs.includes(jobId)) {
      trackedJobs.push(jobId);
      localStorage.setItem('videoOverviewJobs', JSON.stringify(trackedJobs));
    }
  } catch (e) {
    console.warn('Failed to store jobId in localStorage:', e);
  }

  // Step 2: Poll for completion
  const pollIntervalMs = 3000;
  const maxPollTimeMs = 45 * 60 * 1000; // 45 minutes max (HeyGen avatar can take ~15-20 mins)
  const startTime = Date.now();

  try {
    while (true) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      const statusRes = await fetch(`${VIDEO_OVERVIEW_ROUTE}?action=status&jobId=${encodeURIComponent(jobId)}`);

      if (!statusRes.ok) {
        const text = await statusRes.text().catch(() => statusRes.statusText);
        throw new Error(text || 'Failed to get job status');
      }

      const status = await statusRes.json() as VideoOverviewJobStatus;
      onStatusUpdate?.(status.status, status.progress);

      if (status.status === 'completed' && status.result) {
        return status.result;
      }

      if (status.status === 'failed') {
        throw new Error(status.error || 'Video overview generation failed');
      }

      // Check timeout
      if (Date.now() - startTime > maxPollTimeMs) {
        throw new Error('Video overview generation timed out after 45 minutes');
      }
    }
  } finally {
    // Remove jobId from localStorage when done (success or failure)
    try {
      const trackedJobs = JSON.parse(localStorage.getItem('videoOverviewJobs') || '[]');
      const filtered = trackedJobs.filter((id: string) => id !== jobId);
      localStorage.setItem('videoOverviewJobs', JSON.stringify(filtered));
    } catch (e) {
      console.warn('Failed to remove jobId from localStorage:', e);
    }
  }
}

/**
 * Start a video overview job without waiting for completion
 * Returns the jobId for manual status polling
 */
export async function startVideoOverviewJob(
  options: Omit<VideoOverviewOptions, 'onStatusUpdate'>,
): Promise<string> {
  const res = await authFetch(`${VIDEO_OVERVIEW_ROUTE}?op=start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || 'Failed to start video overview job');
  }

  const { jobId } = await res.json() as { jobId: string };
  return jobId;
}

/**
 * Get the status of a video overview job
 */
export async function getVideoOverviewStatus(jobId: string): Promise<VideoOverviewJobStatus> {
  const res = await fetch(`${VIDEO_OVERVIEW_ROUTE}?op=status&jobId=${encodeURIComponent(jobId)}`);

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || 'Failed to get job status');
  }

  return res.json();
}

/**
 * List in-progress video overview jobs for a project
 */
export async function listVideoOverviewJobs(projectId: string): Promise<Array<{
  jobId: string;
  status: string;
  progress?: string;
  createdAt: number;
}>> {
  const res = await authFetch(`${VIDEO_OVERVIEW_ROUTE}?action=list&projectId=${encodeURIComponent(projectId)}`);

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || 'Failed to list jobs');
  }

  return res.json();
}

/**
 * Resume polling an existing video overview job
 * Use this to restore tracking of in-progress jobs after page reload
 */
export async function resumeVideoOverviewPolling(
  jobId: string,
  onStatusUpdate?: (status: string, progress?: string) => void,
): Promise<CreatomateGeneratedVideo | null> {
  const pollIntervalMs = 3000;
  const maxPollTimeMs = 45 * 60 * 1000; // 45 minutes max
  const startTime = Date.now();

  while (true) {
    try {
      const statusRes = await fetch(`${VIDEO_OVERVIEW_ROUTE}?action=status&jobId=${encodeURIComponent(jobId)}`);

      if (!statusRes.ok) {
        console.error('[resumeVideoOverviewPolling] Status fetch failed:', statusRes.status);
        return null;
      }

      const status = await statusRes.json() as VideoOverviewJobStatus;
      onStatusUpdate?.(status.status, status.progress);

      if (status.status === 'completed' && status.result) {
        return status.result;
      }

      if (status.status === 'failed') {
        console.error('[resumeVideoOverviewPolling] Job failed:', status.error);
        return null;
      }

      // Check timeout
      if (Date.now() - startTime > maxPollTimeMs) {
        console.error('[resumeVideoOverviewPolling] Polling timed out');
        return null;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    } catch (e) {
      console.error('[resumeVideoOverviewPolling] Error:', e);
      return null;
    }
  }
}

// Slideshow video assembly
export interface SlideshowElement {
  url: string;
  type: 'image' | 'video';
  duration: number | 'full';
}

export interface SlideshowOptions {
  elements: SlideshowElement[];
  width?: number;
  height?: number;
  transition?: 'fade' | 'slide' | 'none';
  projectId?: string;
}


export async function createSlideshowVideoWithCreatomate(
  options: SlideshowOptions,
): Promise<CreatomateGeneratedVideo> {
  const res = await authFetch(CREATOMATE_SLIDESHOW_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || 'Failed to create slideshow video');
  }

  return res.json();
}

export interface StitchVideoOptions {
  videoUrls: string[];
  width?: number;
  height?: number;
  enableSubtitles?: boolean;
}

export async function stitchVideos(
  options: StitchVideoOptions,
): Promise<CreatomateGeneratedVideo> {
  const res = await authFetch(`/api/media?op=stitch-video`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || 'Failed to stitch videos');
  }

  return res.json();
}

const SOCIAL_REEL_ROUTE = '/api/social-reel';

export interface SocialReelOptions {
  projectId: string;
  prompt: string;
  tone?: string;
  avatarUrl?: string;
  onStatusUpdate?: (status: string, progress?: string) => void;
}

export interface SocialReelJobStatus {
  jobId: string;
  status: 'queued' | 'planning' | 'generating_audio' | 'generating_videos' | 'assembling' | 'completed' | 'failed';
  progress?: string;
  result?: { url: string; durationSeconds?: number };
  error?: string;
}

/**
 * Start a social reel job and poll until completion
 */
export async function createSocialReel(
  options: SocialReelOptions,
): Promise<{ url: string; durationSeconds?: number }> {
  const { onStatusUpdate, ...requestOptions } = options;

  // Step 1: Start the job
  const startRes = await authFetch(`${SOCIAL_REEL_ROUTE}?action=start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestOptions),
  });

  if (!startRes.ok) {
    const text = await startRes.text().catch(() => startRes.statusText);
    throw new Error(text || 'Failed to start social reel job');
  }

  const { jobId } = await startRes.json() as { jobId: string };
  onStatusUpdate?.('queued', 'Job queued...');

  // Step 2: Poll for completion
  const pollIntervalMs = 3000;
  const maxPollTimeMs = 20 * 60 * 1000; // 20 minutes max
  const startTime = Date.now();

  while (true) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    const statusRes = await fetch(`${SOCIAL_REEL_ROUTE}?action=status&jobId=${encodeURIComponent(jobId)}`);

    if (!statusRes.ok) {
      const text = await statusRes.text().catch(() => statusRes.statusText);
      throw new Error(text || 'Failed to get job status');
    }

    const status = await statusRes.json() as SocialReelJobStatus;
    onStatusUpdate?.(status.status, status.progress);

    if (status.status === 'completed' && status.result) {
      return status.result;
    }

    if (status.status === 'failed') {
      throw new Error(status.error || 'Social reel generation failed');
    }

    // Check timeout
    if (Date.now() - startTime > maxPollTimeMs) {
      throw new Error('Social reel generation timed out after 20 minutes');
    }
  }
}


