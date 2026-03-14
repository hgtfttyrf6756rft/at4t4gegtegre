import { Client } from "@upstash/qstash";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { requireAuth } from './_auth.js';
import { TwitterApi } from 'twitter-api-v2';

type JsonValue = any;

type GraphErrorResponse = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

// QStash client for scheduling
let qstashClient: Client | null = null;
const getQStashClient = () => {
  if (!qstashClient) {
    qstashClient = new Client({ token: process.env.QSTASH_TOKEN! });
  }
  return qstashClient;
};

// Get base URL for callbacks - prefer production domain over preview URLs
const getScheduleBaseUrl = () => {
  // Prefer explicit production URL 
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL;
  }
  // Hardcode production domain as fallback (avoid preview URLs for QStash callbacks)
  return 'https://www.freshfront.co';
};

// Firebase Admin for scheduling (dynamic import)
let scheduleAdminDb: any = null;
const getScheduleDb = async () => {
  if (!scheduleAdminDb) {
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');

    if (getApps().length === 0) {
      const projectId = process.env.FIREBASE_PROJECT_ID || 'ffresearchr';

      // Try individual env vars FIRST (most reliable in production)
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
      const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

      if (clientEmail && privateKey) {
        initializeApp({
          credential: cert({ projectId, clientEmail, privateKey }),
        });
      }
      // Fallback: Try base64 encoded JSON
      else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
        try {
          const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf-8');
          const parsed = JSON.parse(decoded);
          initializeApp({
            credential: cert({
              projectId: parsed.project_id || projectId,
              clientEmail: parsed.client_email,
              privateKey: (parsed.private_key || '').replace(/\\n/g, '\n'),
            }),
          });
        } catch (e) {
          console.error('[getScheduleDb] Failed to parse base64 service account:', e);
          throw new Error('Invalid Firebase service account configuration');
        }
      }
      // Fallback: Try direct JSON
      else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        initializeApp({
          credential: cert({
            projectId: parsed.project_id || projectId,
            clientEmail: parsed.client_email,
            privateKey: (parsed.private_key || '').replace(/\\n/g, '\n'),
          }),
        });
      }
      else {
        throw new Error('Missing Firebase credentials');
      }
    }
    scheduleAdminDb = getFirestore();
  }
  return scheduleAdminDb;
};

// Scheduled post type
interface ScheduledPost {
  id?: string;
  projectId: string;
  userId: string;
  scheduledAt: number;
  status: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
  platforms: string[];
  postType: 'TEXT' | 'IMAGE' | 'VIDEO';
  textContent: string;
  mediaUrl?: string;
  platformOverrides: Record<string, any>;
  qstashMessageId?: string;
  createdAt: number;
  publishResults?: Array<{ platform: string; success: boolean; postId?: string; error?: string; }>;
}

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const errorJson = (message: string, status = 400, extra?: Record<string, any>) =>
  json({ error: message, ...(extra || {}) }, status);

const getApiVersion = () =>
  (
    process.env.FACEBOOK_API_VERSION ||
    process.env.VITE_FACEBOOK_API_VERSION ||
    process.env.INSTAGRAM_API_VERSION ||
    'v24.0'
  ).toString();

const graphFetch = async <T extends JsonValue>(
  path: string,
  options: {
    method?: string;
    accessToken: string;
    body?: any;
    query?: Record<string, string | number | boolean | undefined | null>;
    timeoutMs?: number;
  }
): Promise<T> => {
  const version = getApiVersion();
  const method = options.method || 'GET';
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 10000;

  console.log(`[Social API] graphFetch: ${method} ${path}`, options.query || '');

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(options.query || {})) {
    if (v === undefined || v === null) continue;
    qs.set(k, String(v));
  }
  // Always include access_token in query for reliability with Graph API
  qs.set('access_token', options.accessToken);

  const url = `https://graph.facebook.com/${version}/${path}${qs.toString() ? `?${qs.toString()}` : ''}`;
  console.log(`[Social API] Fetching URL: ${url.replace(options.accessToken, 'REDACTED')}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FreshFront/1.0 (Meta API Diagnostic)',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeout);
    if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
      console.error('[Social API] graphFetch timeout reached', { path, timeoutMs });
      throw new Error(`Graph API request timed out after ${timeoutMs}ms`);
    }
    console.error('[Social API] graphFetch network error:', e?.message || e);
    throw new Error(e?.message || 'Network error calling Graph API');
  } finally {
    clearTimeout(timeout);
  }

  console.log(`[Social API] graphFetch response status: ${res.status}`);

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const graphErr = data as GraphErrorResponse;
    const msg =
      graphErr?.error?.message ||
      (typeof data?.error === 'string' ? data.error : '') ||
      `Graph API request failed (${res.status})`;
    console.error('[Social API] graphFetch non-OK response', {
      status: res.status,
      statusText: res.statusText,
      path,
      body: data,
    });
    throw new Error(msg);
  }

  return data as T;
};

// Facebook Page Types and Functions
type FacebookPage = {
  id: string;
  name: string;
  access_token?: string;
  tasks?: string[];
};

const getFacebookPages = async (fbUserAccessToken: string): Promise<FacebookPage[]> => {
  console.log('[Social API] Getting all Facebook Pages...');
  const resp = await graphFetch<any>('me/accounts', {
    method: 'GET',
    accessToken: fbUserAccessToken,
    query: {
      fields: 'id,name,access_token,tasks',
      limit: 100,
    },
  });

  const pages = Array.isArray(resp?.data) ? resp.data : [];
  console.log(`[Social API] Found ${pages.length} pages.`);

  return pages.map((p: any) => ({
    id: p.id,
    name: p.name,
    access_token: p.access_token,
    tasks: p.tasks,
  }));
};

const getPageAccessToken = async (fbUserAccessToken: string, pageId: string): Promise<string> => {
  // Try to find token in list first to avoid extra call if possible, or just fetch specific page
  const resp = await graphFetch<any>(pageId, {
    method: 'GET',
    accessToken: fbUserAccessToken,
    query: { fields: 'access_token' }
  });

  if (!resp.access_token) {
    throw new Error('Could not retrieve access token for this Page.');
  }
  return resp.access_token;
};

const publishFacebookPost = async (params: {
  fbUserAccessToken: string;
  pageId: string;
  message: string;
  link?: string;
  published?: boolean;
  scheduled_publish_time?: number;
}) => {
  const pageAccessToken = await getPageAccessToken(params.fbUserAccessToken, params.pageId);

  const body: any = {
    message: params.message,
    published: params.published ?? true,
  };

  if (params.link) body.link = params.link;
  if (params.scheduled_publish_time) body.scheduled_publish_time = params.scheduled_publish_time;

  return await graphFetch<any>(`${params.pageId}/feed`, {
    method: 'POST',
    accessToken: pageAccessToken,
    body,
  });
};

const publishFacebookPhoto = async (params: {
  fbUserAccessToken: string;
  pageId: string;
  url: string;
  caption?: string;
  published?: boolean;
  scheduled_publish_time?: number;
}) => {
  const pageAccessToken = await getPageAccessToken(params.fbUserAccessToken, params.pageId);

  const body: any = {
    url: params.url,
    published: params.published ?? true,
  };

  if (params.caption) body.caption = params.caption;
  if (params.scheduled_publish_time) body.scheduled_publish_time = params.scheduled_publish_time;

  return await graphFetch<any>(`${params.pageId}/photos`, {
    method: 'POST',
    accessToken: pageAccessToken,
    body,
  });
};

const publishFacebookVideo = async (params: {
  fbUserAccessToken: string;
  pageId: string;
  file_url: string;
  title?: string;
  description?: string;
}) => {
  const pageAccessToken = await getPageAccessToken(params.fbUserAccessToken, params.pageId);

  // Note: For videos, we use the graph-video.facebook.com host usually, 
  // but graphFetch handles the domain logic if we were using it for general calls.
  // However, the standard Graph API endpoint for page videos also works for hosted files.

  const body: any = {
    file_url: params.file_url,
  };

  if (params.title) body.title = params.title;
  if (params.description) body.description = params.description;

  return await graphFetch<any>(`${params.pageId}/videos`, {
    method: 'POST',
    accessToken: pageAccessToken,
    body,
    timeoutMs: 120000, // 2 minute timeout for video uploads
  });
};


type InstagramAccount = {
  pageId: string;
  pageName: string;
  igId: string;
  igUsername?: string;
};

type HashtagSearchResult = {
  id: string;
  name?: string;
};

const listInstagramAccounts = async (
  fbUserAccessToken: string
): Promise<{ accounts: InstagramAccount[]; diagnostics: any }> => {
  console.log('[Social API] >>> listInstagramAccounts START');

  const diagnostics: any = {
    config: {
      tokenPrefix: (fbUserAccessToken || '').substring(0, 10) + '...',
      tokenLength: (fbUserAccessToken || '').length,
    },
    pagesCount: 0,
    pages: [],
  };

  const accounts: InstagramAccount[] = [];

  try {
    const resp = await graphFetch<any>('me/accounts', {
      method: 'GET',
      accessToken: fbUserAccessToken,
      query: {
        // Per Meta docs for Facebook Login for Business
        fields: 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}',
        limit: 100,
      },
      timeoutMs: 5000,
    });

    const pages = Array.isArray(resp?.data) ? resp.data : [];
    diagnostics.pagesCount = pages.length;
    diagnostics.pages = pages.map((p: any) => ({
      id: p.id,
      name: p.name,
      hasAccessToken: !!p.access_token,
      instagram_business_account: p.instagram_business_account,
    }));

    for (const page of pages) {
      const ig = page?.instagram_business_account;
      if (ig?.id) {
        const acct: InstagramAccount = {
          pageId: String(page.id),
          pageName: String(page.name),
          igId: String(ig.id),
          igUsername: ig.username ? String(ig.username) : ig.name || undefined,
        };
        if (!accounts.some(a => a.igId === acct.igId)) {
          accounts.push(acct);
        }
      }
    }
  } catch (e: any) {
    diagnostics.globalError = e?.message || String(e);
  }

  console.log(`[Social API] listInstagramAccounts result: ${accounts.length} accounts found.`);
  return { accounts, diagnostics };
};

const getPageAccessTokenForIg = async (fbUserAccessToken: string, igId: string): Promise<string> => {
  console.log(`[Social API] Getting Page access token for Instagram ID: ${igId}`);

  const resp = await graphFetch<any>('me/accounts', {
    method: 'GET',
    accessToken: fbUserAccessToken,
    query: {
      fields: 'id,name,access_token,instagram_business_account{id}',
      limit: 200,
    },
  });

  const pages = Array.isArray(resp?.data) ? resp.data : [];
  console.log(`[Social API] Found ${pages.length} Facebook Pages`);

  for (const page of pages) {
    const ig = page?.instagram_business_account;
    if (!ig?.id) continue;

    console.log(`[Social API] Checking page ${page.id} with Instagram account ${ig.id}`);

    if (String(ig.id) !== String(igId)) continue;

    const token = page?.access_token;
    if (!token) {
      console.error(`[Social API] Page ${page.id} has no access_token`);
      break;
    }

    console.log(`[Social API] Found matching Page access token for Instagram ID: ${igId}`);
    return String(token);
  }

  console.error(`[Social API] Could not find Page access token for Instagram ID: ${igId}`);
  throw new Error('Could not resolve Page access token for this Instagram account.');
};

const createInstagramContainer = async (params: {
  fbUserAccessToken: string;
  igId: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'REELS' | 'STORIES';
  imageUrl?: string;
  videoUrl?: string;
  caption?: string;
  altText?: string;
  isCarouselItem?: boolean;
  children?: string[]; // array of container IDs
  locationId?: string;
  shareToFeed?: boolean;
}): Promise<{ id: string; uri?: string }> => {
  console.log('[Social API] Creating Instagram container:', {
    igId: params.igId,
    mediaType: params.mediaType,
    hasImageUrl: !!params.imageUrl,
    hasVideoUrl: !!params.videoUrl,
    isCarouselItem: params.isCarouselItem,
    childrenCount: params.children?.length || 0,
  });

  const pageAccessToken = await getPageAccessTokenForIg(params.fbUserAccessToken, params.igId);

  const body: any = {};

  // Set media_type - for videos, Instagram now requires REELS or STORIES, not VIDEO
  // Only set media_type if it's CAROUSEL, REELS, or STORIES (images don't need it)
  if (params.mediaType === 'CAROUSEL' || params.mediaType === 'REELS' || params.mediaType === 'STORIES') {
    body.media_type = params.mediaType;
  }

  // Only add caption if it's not empty
  if (params.caption && params.caption.trim()) {
    body.caption = params.caption.trim();
  }

  if (params.imageUrl) body.image_url = params.imageUrl;
  if (params.videoUrl) body.video_url = params.videoUrl;
  if (params.altText) body.alt_text = params.altText;
  if (params.isCarouselItem) body.is_carousel_item = true;
  if (params.locationId) body.location_id = params.locationId;
  if (params.shareToFeed !== undefined) body.share_to_feed = params.shareToFeed;

  if (params.children && params.children.length > 0) {
    body.children = params.children.join(',');
  }

  console.log('[Social API] Container creation body:', {
    ...body,
    image_url: body.image_url ? `${body.image_url.substring(0, 50)}...` : undefined,
    video_url: body.video_url ? `${body.video_url.substring(0, 50)}...` : undefined,
  });

  const resp = await graphFetch<any>(`${params.igId}/media`, {
    method: 'POST',
    accessToken: pageAccessToken,
    body,
  });

  console.log('[Social API] Container created successfully:', {
    containerId: resp.id,
    uri: resp.uri
  });

  return { id: String(resp.id), uri: resp.uri ? String(resp.uri) : undefined };
};

const handleInstagramPublishRobust = async (params: {
  fbUserAccessToken: string;
  igId: string;
  mediaType: 'FEED' | 'STORY' | 'REEL' | 'REELS' | 'STORIES';
  mediaUrls: string[];
  caption?: string;
  shareToFeed?: boolean;
  isVideo?: boolean; // Explicit hint for video detection (useful for Blob URLs without extensions)
}): Promise<{ containerId?: string; mediaId?: string; status: string; message?: string; qstashMessageId?: string }> => {
  const { fbUserAccessToken, igId, mediaType, mediaUrls, caption, shareToFeed, isVideo: isVideoHint } = params;

  // Helper to detect if URL is a video
  const detectIsVideo = (url: string): boolean => {
    // If explicit hint provided, use it
    if (isVideoHint !== undefined) return isVideoHint;
    // Otherwise check file extension
    return !!url.toLowerCase().match(/\.(mp4|mov|m4v|avi|webm)(\?|$)/);
  };

  let containerId: string;

  // Normalize mediaType - REELS and REEL are the same, STORIES and STORY are the same
  const normalizedType = mediaType === 'REELS' ? 'REEL' : mediaType === 'STORIES' ? 'STORY' : mediaType;

  if (normalizedType === 'FEED') {
    if (mediaUrls.length === 1) {
      const isVideo = detectIsVideo(mediaUrls[0]);
      console.log('[Social API] FEED single media - isVideo:', isVideo, 'URL preview:', mediaUrls[0].substring(0, 50));
      const result = await createInstagramContainer({
        fbUserAccessToken,
        igId,
        // For FEED, videos must use REELS media_type (VIDEO is deprecated)
        mediaType: isVideo ? 'REELS' : 'IMAGE',
        imageUrl: isVideo ? undefined : mediaUrls[0],
        videoUrl: isVideo ? mediaUrls[0] : undefined,
        caption,
        shareToFeed: isVideo ? true : undefined,
      });
      containerId = result.id;
    } else {
      // Carousel
      const childrenIds: string[] = [];
      for (const url of mediaUrls) {
        const isVideo = detectIsVideo(url);
        const child = await createInstagramContainer({
          fbUserAccessToken,
          igId,
          mediaType: isVideo ? 'VIDEO' : 'IMAGE',
          imageUrl: isVideo ? undefined : url,
          videoUrl: isVideo ? url : undefined,
          isCarouselItem: true,
        });
        childrenIds.push(child.id);
      }

      const carousel = await createInstagramContainer({
        fbUserAccessToken,
        igId,
        mediaType: 'CAROUSEL',
        caption,
        children: childrenIds,
      });
      containerId = carousel.id;
    }
  } else if (normalizedType === 'STORY') {
    const isVideo = detectIsVideo(mediaUrls[0]);
    const result = await createInstagramContainer({
      fbUserAccessToken,
      igId,
      // Stories use STORIES media_type for both images and videos
      mediaType: 'STORIES',
      imageUrl: isVideo ? undefined : mediaUrls[0],
      videoUrl: isVideo ? mediaUrls[0] : undefined,
    });
    containerId = result.id;
  } else if (normalizedType === 'REEL') {
    // Reels are always videos - use the hint or assume video
    const isVideo = isVideoHint !== undefined ? isVideoHint : true;
    if (!isVideo) {
      console.log('[Social API] REEL requested but isVideo is false, forcing video mode');
    }
    const result = await createInstagramContainer({
      fbUserAccessToken,
      igId,
      // Reels use REELS media_type directly (VIDEO is deprecated)
      mediaType: 'REELS',
      videoUrl: mediaUrls[0],
      caption,
      shareToFeed: shareToFeed ?? true,
    });
    containerId = result.id;
  } else {
    throw new Error(`Unsupported media type: ${mediaType}`);
  }

  // For videos (REELS, STORIES with video), we need to wait for processing
  // Since Vercel has a 30s timeout, we can't poll synchronously
  // Instead, schedule a delayed publish via QStash
  const needsAsyncPublish = normalizedType === 'REEL' ||
    (normalizedType === 'STORY' && detectIsVideo(mediaUrls[0])) ||
    (normalizedType === 'FEED' && detectIsVideo(mediaUrls[0]));

  if (needsAsyncPublish) {
    console.log(`[Social API] Video container created, scheduling async publish via QStash...`);

    // Schedule a delayed publish attempt via QStash
    // First attempt after 30 seconds, then retries with QStash's retry logic
    const baseUrl = getScheduleBaseUrl();
    const publishUrl = `${baseUrl}/api/social?op=ig-container-publish`;

    try {
      const response = await getQStashClient().publishJSON({
        url: publishUrl,
        body: {
          fbUserAccessToken,
          igId,
          containerId,
          attempt: 1,
          maxAttempts: 10,
        },
        delay: 30, // Wait 30 seconds for video processing before first publish attempt
        retries: 3,
        timeout: '25s', // Vercel has 30s timeout, leave 5s buffer
      });

      console.log(`[Social API] Scheduled async publish for container ${containerId}, messageId: ${response.messageId}`);

      // Return early with pending status
      return {
        containerId,
        status: 'PROCESSING',
        message: 'Video is being processed. Will be published automatically when ready.',
        qstashMessageId: response.messageId
      };
    } catch (qstashError: any) {
      console.error(`[Social API] Failed to schedule async publish:`, qstashError?.message);
      // Fall through to try immediate publish as fallback
    }
  }

  // Publish the container
  console.log(`[Social API] Publishing Instagram container: ${containerId}`);
  const publishResult = await publishInstagramContainer({
    fbUserAccessToken,
    igId,
    creationId: containerId,
  });

  console.log(`[Social API] Container published successfully: ${publishResult.id}`);
  return { mediaId: publishResult.id, containerId, status: 'PUBLISHED' };
};

const publishInstagramContainer = async (params: {
  fbUserAccessToken: string;
  igId: string;
  creationId: string;
}): Promise<{ id: string }> => {
  const pageAccessToken = await getPageAccessTokenForIg(params.fbUserAccessToken, params.igId);

  const resp = await graphFetch<any>(`${params.igId}/media_publish`, {
    method: 'POST',
    accessToken: pageAccessToken,
    body: {
      creation_id: params.creationId,
    },
  });

  return { id: String(resp.id) };
};

const getInstagramContainerStatus = async (params: {
  fbUserAccessToken: string;
  igId: string;
  containerId: string;
}): Promise<{ status_code: string; status?: string; video_status?: any }> => {
  console.log(`[Social API] Checking container status for: ${params.containerId}`);

  const pageAccessToken = await getPageAccessTokenForIg(params.fbUserAccessToken, params.igId);

  console.log(`[Social API] Retrieved page access token for igId: ${params.igId}`);

  try {
    const result = await graphFetch<any>(params.containerId, {
      method: 'GET',
      accessToken: pageAccessToken,
      query: { fields: 'id,status_code,status' },
      timeoutMs: 15000, // Increase timeout for container status checks
    });

    console.log(`[Social API] Container status result:`, {
      id: result?.id,
      status_code: result?.status_code,
      status: result?.status
    });

    return result;
  } catch (error: any) {
    console.error(`[Social API] Error checking container status:`, {
      containerId: params.containerId,
      igId: params.igId,
      error: error?.message || String(error)
    });
    throw error;
  }
};

const getInstagramPublishingLimit = async (params: {
  fbUserAccessToken: string;
  igId: string;
}): Promise<any> => {
  const pageAccessToken = await getPageAccessTokenForIg(params.fbUserAccessToken, params.igId);

  return await graphFetch<any>(`${params.igId}/content_publishing_limit`, {
    method: 'GET',
    accessToken: pageAccessToken,
    query: { fields: 'config,quota_usage' },
  });
};

const searchHashtag = async (params: {
  fbUserAccessToken: string;
  igUserId: string;
  q: string;
}): Promise<HashtagSearchResult | null> => {
  try {
    const resp = await graphFetch<any>('ig_hashtag_search', {
      method: 'GET',
      accessToken: params.fbUserAccessToken,
      query: {
        user_id: params.igUserId,
        q: params.q,
      },
    });

    const first = Array.isArray(resp?.data) ? resp.data[0] : null;
    if (!first?.id) return null;
    return { id: String(first.id), name: first.name ? String(first.name) : undefined };
  } catch (error: any) {
    const msg = error?.message || '';
    // Error 24/2207024 is "resource does not exist" (hashtag not found or invalid)
    if (msg.includes('requested resource does not exist') || msg.includes('Hashtag') || msg.includes('permissions')) {
      console.warn(`[Social API] Hashtag "${params.q}" not found or restricted. Returning null.`);
      return null;
    }
    throw error;
  }
};

const hashtagMedia = async (params: {
  fbUserAccessToken: string;
  igUserId: string;
  hashtagId: string;
  kind: 'top' | 'recent';
  limit?: number;
}) => {
  const edge = params.kind === 'top' ? 'top_media' : 'recent_media';
  const fields = 'id,media_type,comments_count,like_count,media_url,permalink,timestamp,caption';

  return await graphFetch<any>(`${params.hashtagId}/${edge}`, {
    method: 'GET',
    accessToken: params.fbUserAccessToken,
    query: {
      user_id: params.igUserId,
      fields,
      limit: params.limit ?? 25,
    },
  });
};

const instagramBusinessDiscovery = async (params: {
  fbUserAccessToken: string;
  igUserId: string;
  username: string;
}) => {
  // Nested request for business discovery
  // We want basic profile stats + recent media
  const targetUsername = params.username.trim();
  if (!targetUsername) throw new Error('Username is required');

  const mediaFields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
  // Note: syntax is business_discovery.username(NAME){fields}
  const fields = `business_discovery.username(${targetUsername}){followers_count,media_count,id,media.limit(12){${mediaFields}}}`;

  const resp = await graphFetch<any>(params.igUserId, {
    method: 'GET',
    accessToken: params.fbUserAccessToken,
    query: {
      fields,
    },
  });

  return resp.business_discovery;
};

// ═══════════════════════════════════════════════════════════════════════════
// X (Twitter) Helpers
// ═══════════════════════════════════════════════════════════════════════════

interface XTokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
  scope: string[];
  profileId?: string;
  profileName?: string;
  profileUsername?: string;
  profileImage?: string;
  codeVerifier?: string | null;
  state?: string | null;
}

const getXConfig = () => {
  const clientId = (process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID || '').trim();
  const clientSecret = (process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET || '').trim();
  const redirectUri = process.env.X_REDIRECT_URI || 'http://localhost:5173/x/callback';

  if (!clientId || !clientSecret) {
    throw new Error('Missing X API credentials (X_CLIENT_ID, X_CLIENT_SECRET)');
  }

  if (!redirectUri) {
    throw new Error('Missing X_REDIRECT_URI');
  }

  return { clientId, clientSecret, redirectUri };
};

const getStoredXData = async (uid: string) => {
  const db = await getScheduleDb();
  const doc = await db.doc(`users/${uid}/integrations/x`).get();
  return doc.exists ? (doc.data() as any) : null;
};

const saveXData = async (uid: string, data: any) => {
  const db = await getScheduleDb();
  await db.doc(`users/${uid}/integrations/x`).set({
    ...data,
    updatedAt: Date.now(),
  }, { merge: true });
};

const getValidXClient = async (uid: string) => {
  console.log(`[X API] getValidXClient called with uid: ${uid}`);
  const data = await getStoredXData(uid);
  if (!data || !data.accessToken) throw new Error(`Not connected to X (uid: ${uid})`);

  const { clientId, clientSecret } = getXConfig();

  if (data.expiresAt && Date.now() < data.expiresAt - 5 * 60 * 1000) {
    return new TwitterApi(data.accessToken);
  }

  if (!data.refreshToken) throw new Error('No refresh token available');

  console.log(`[X API] Refreshing X access token for uid: ${uid}`);
  const client = new TwitterApi({ clientId, clientSecret });

  try {
    const { client: refreshedClient, accessToken, refreshToken: newRefreshToken, expiresIn } = await client.refreshOAuth2Token(data.refreshToken);

    const expiresAt = Date.now() + (expiresIn * 1000);
    console.log(`[X API] Token refreshed successfully, new expiry: ${new Date(expiresAt).toISOString()}`);

    await saveXData(uid, {
      accessToken,
      refreshToken: newRefreshToken || data.refreshToken,
      expiresAt,
    });

    return refreshedClient;
  } catch (e: any) {
    console.error('[X API] Token Refresh Error:', e);
    await saveXData(uid, {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
    });
    throw new Error(`Failed to refresh X token: ${e.message || 'Token revoked or invalid'}`);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// UploadPost API Helpers
// ═══════════════════════════════════════════════════════════════════════════

const getUploadPostApiKey = () => process.env.UPLOADPOST_API_KEY || '';
const UPLOADPOST_BASE = 'https://api.upload-post.com';

const uploadPostFetch = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: any;
    formData?: FormData;
    query?: Record<string, string>;
  } = {}
): Promise<T> => {
  const apiKey = getUploadPostApiKey();
  if (!apiKey) throw new Error('UPLOADPOST_API_KEY is not configured');

  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    'Authorization': `ApiKey ${apiKey}`,
  };

  let url = `${UPLOADPOST_BASE}${endpoint}`;
  if (options.query) {
    const qs = new URLSearchParams(options.query);
    url += `?${qs.toString()}`;
  }

  let bodyContent: string | FormData | undefined;
  if (options.formData) {
    bodyContent = options.formData;
  } else if (options.body) {
    headers['Content-Type'] = 'application/json';
    bodyContent = JSON.stringify(options.body);
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: bodyContent,
    });

    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      throw new Error(data?.error || data?.message || `Upload-Post API error (${res.status})`);
    }

    return data as T;
  } catch (e: any) {
    throw e;
  }
};

// Create user profile
const createUploadPostUser = async (username: string) => {
  return uploadPostFetch<any>('/api/uploadposts/users', {
    method: 'POST',
    body: { username },
  });
};

// Get user profiles
const getUploadPostUsers = async () => {
  return uploadPostFetch<any>('/api/uploadposts/users', {
    method: 'GET',
  });
};

// Get a specific user profile
const getUploadPostUser = async (username: string) => {
  return uploadPostFetch<any>(`/api/uploadposts/users/${encodeURIComponent(username)}`, {
    method: 'GET',
  });
};

// Generate JWT URL for account linking
const generateUploadPostJwt = async (params: {
  username: string;
  redirect_url?: string;
  logo_image?: string;
  redirect_button_text?: string;
  connect_title?: string;
  connect_description?: string;
  platforms?: string[];
  show_calendar?: boolean;
}) => {
  return uploadPostFetch<any>('/api/uploadposts/users/generate-jwt', {
    method: 'POST',
    body: params,
  });
};

// Upload video
const uploadPostUploadVideo = async (params: {
  user: string;
  platforms: string[];
  videoUrl: string;
  title: string;
  description?: string;
  scheduled_date?: string;
  timezone?: string;
  async_upload?: boolean;
  first_comment?: string;
  // Platform-specific
  privacy_level?: string;
  facebook_page_id?: string;
  facebook_media_type?: string;
  media_type?: string;
}) => {
  const formData = new FormData();
  formData.append('user', params.user);
  formData.append('video', params.videoUrl);
  formData.append('title', params.title);
  if (params.description) formData.append('description', params.description);
  if (params.scheduled_date) formData.append('scheduled_date', params.scheduled_date);
  if (params.timezone) formData.append('timezone', params.timezone);
  if (params.async_upload !== undefined) formData.append('async_upload', String(params.async_upload));
  if (params.first_comment) formData.append('first_comment', params.first_comment);
  if (params.privacy_level) formData.append('privacy_level', params.privacy_level);
  if (params.facebook_page_id) formData.append('facebook_page_id', params.facebook_page_id);
  if (params.facebook_media_type) formData.append('facebook_media_type', params.facebook_media_type);
  if (params.media_type) formData.append('media_type', params.media_type);

  params.platforms.forEach(p => formData.append('platform[]', p));

  return uploadPostFetch<any>('/api/upload', {
    method: 'POST',
    formData,
  });
};

// Upload photos
const uploadPostUploadPhotos = async (params: {
  user: string;
  platforms: string[];
  photoUrls: string[];
  title: string;
  description?: string;
  scheduled_date?: string;
  timezone?: string;
  async_upload?: boolean;
  first_comment?: string;
  // Platform-specific
  facebook_page_id?: string;
  facebook_media_type?: string;
  media_type?: string;
  privacy_level?: string;
  auto_add_music?: boolean;
}) => {
  const formData = new FormData();
  formData.append('user', params.user);
  formData.append('title', params.title);
  if (params.description) formData.append('description', params.description);
  if (params.scheduled_date) formData.append('scheduled_date', params.scheduled_date);
  if (params.timezone) formData.append('timezone', params.timezone);
  if (params.async_upload !== undefined) formData.append('async_upload', String(params.async_upload));
  if (params.first_comment) formData.append('first_comment', params.first_comment);
  if (params.facebook_page_id) formData.append('facebook_page_id', params.facebook_page_id);
  if (params.facebook_media_type) formData.append('facebook_media_type', params.facebook_media_type);
  if (params.media_type) formData.append('media_type', params.media_type);
  if (params.privacy_level) formData.append('privacy_level', params.privacy_level);
  if (params.auto_add_music !== undefined) formData.append('auto_add_music', String(params.auto_add_music));

  params.platforms.forEach(p => formData.append('platform[]', p));
  params.photoUrls.forEach(url => formData.append('photos[]', url));

  return uploadPostFetch<any>('/api/upload_photos', {
    method: 'POST',
    formData,
  });
};

// Upload text
const uploadPostUploadText = async (params: {
  user: string;
  platforms: string[];
  title: string;
  description?: string;
  scheduled_date?: string;
  timezone?: string;
  async_upload?: boolean;
  first_comment?: string;
  // Platform-specific
  facebook_page_id?: string;
  x_long_text_as_post?: boolean;
}) => {
  const formData = new FormData();
  formData.append('user', params.user);
  formData.append('title', params.title);
  if (params.description) formData.append('description', params.description);
  if (params.scheduled_date) formData.append('scheduled_date', params.scheduled_date);
  if (params.timezone) formData.append('timezone', params.timezone);
  if (params.async_upload !== undefined) formData.append('async_upload', String(params.async_upload));
  if (params.first_comment) formData.append('first_comment', params.first_comment);
  if (params.facebook_page_id) formData.append('facebook_page_id', params.facebook_page_id);
  if (params.x_long_text_as_post !== undefined) formData.append('x_long_text_as_post', String(params.x_long_text_as_post));

  params.platforms.forEach(p => formData.append('platform[]', p));

  return uploadPostFetch<any>('/api/upload_text', {
    method: 'POST',
    formData,
  });
};

// Get upload status
const uploadPostGetStatus = async (requestId: string) => {
  return uploadPostFetch<any>('/api/uploadposts/status', {
    method: 'GET',
    query: { request_id: requestId },
  });
};

// Get upload history
const uploadPostGetHistory = async (page = 1, limit = 20) => {
  return uploadPostFetch<any>('/api/uploadposts/history', {
    method: 'GET',
    query: { page: String(page), limit: String(limit) },
  });
};

// Get Facebook pages
const uploadPostGetFacebookPages = async (profile?: string) => {
  const query: Record<string, string> = {};
  if (profile) query.profile = profile;
  return uploadPostFetch<any>('/api/uploadposts/facebook/pages', {
    method: 'GET',
    query,
  });
};

// Delete user profile
const uploadPostDeleteUser = async (username: string) => {
  return uploadPostFetch<any>('/api/uploadposts/users', {
    method: 'DELETE',
    body: { username },
  });
};

// X (Twitter) Types and Functions
// ═══════════════════════════════════════════════════════════════════════════

const getXCredentials = async (userId: string): Promise<string> => {
  const db = await getScheduleDb();
  const ref = db.doc(`users/${userId}/integrations/x`);
  const snap = await ref.get();
  const data = snap.data();

  if (!data?.accessToken || !data?.refreshToken) {
    throw new Error('X (Twitter) not connected');
  }

  const now = Date.now();
  const expiresAt = data.expiresAt || 0;

  // Refresh if expired or expiring in 5 mins
  if (now > expiresAt - 300000) {
    console.log('[Social API] Refreshing X token for user:', userId);
    const clientId = (process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID || '').trim();
    const clientSecret = (process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET || '').trim();

    if (!clientId || !clientSecret) throw new Error('X API credentials missing');

    try {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const res = await fetch('https://api.x.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: data.refreshToken,
          client_id: clientId,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.access_token) {
        console.error('[Social API] X refresh failed:', json);
        throw new Error(json.error_description || 'Failed to refresh X token');
      }

      await ref.update({
        accessToken: json.access_token,
        refreshToken: json.refresh_token || data.refreshToken,
        expiresAt: Date.now() + ((json.expires_in || 7200) * 1000),
        updatedAt: Date.now(),
      });

      return json.access_token;
    } catch (e: any) {
      console.error('[Social API] X token refresh error:', e);
      throw e;
    }
  }

  return data.accessToken;
};

const searchXTweets = async (userId: string, query: string): Promise<any> => {
  const token = await getXCredentials(userId);
  const q = encodeURIComponent(query);

  // Recent search: last 7 days
  // COMPLIANCE: Uses OAuth 2.0 User Context (Bearer token) with scopes: tweet.read, users.read
  // Matches OpenAPI security requirement: OAuth2UserToken: [tweet.read, users.read]
  const url = `https://api.x.com/2/tweets/search/recent?query=${q}&max_results=25&tweet.fields=created_at,author_id,public_metrics&expansions=author_id&user.fields=name,username,profile_image_url,verified`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.title || 'Failed to search tweets');
  }

  return await res.json();
};

const searchXUsers = async (userId: string, query: string): Promise<any> => {
  // Use the "User Search" endpoint if available, but standard v2 user search is actually just 
  // lookup by username(s) or ID(s). 
  // HOWEVER, the user request mentions "The Users Search endpoint provides a simple, relevance-based search interface".
  // Note: This endpoint is often restricted or requires specific access levels. 
  // Endpoint: GET /2/users/search (Appears in some docs, but standard access might be limited).
  // If this fails, we might need to fallback to "User Lookup" if the query looks like a handle.

  const token = await getXCredentials(userId);

  // Trying standard users search endpoint
  const url = `https://api.x.com/2/users/search?query=${encodeURIComponent(query)}&max_results=20&user.fields=description,public_metrics,profile_image_url,verified,location`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) {
    const err = await res.json();
    // Fallback: If 403 or similar, it might be due to access level. 
    // But we will throw for now to let the UI handle it.
    throw new Error(err.detail || err.title || 'Failed to search users');
  }

  return await res.json();
};

const getRequestUrl = (request: Request): URL => {
  const raw = request.url || '';
  try {
    // If this is already an absolute URL, this will succeed.
    return new URL(raw);
  } catch {
    // Normalize relative paths for the Node.js runtime.
    const base =
      (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
      (process.env.SITE_URL && String(process.env.SITE_URL)) ||
      'http://localhost';
    return new URL(raw, base);
  }
};




// ═══════════════════════════════════════════════════════════════════════════
// LinkedIn Helpers
// ═══════════════════════════════════════════════════════════════════════════

const getLinkedInConfig = () => {
  const clientId = (process.env.LINKEDIN_CLIENT_ID || '').trim();
  const clientSecret = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
  const redirectUri = (process.env.LINKEDIN_REDIRECT_URI || 'https://freshfront.co/linkedin/callback').trim();

  if (!clientId || !clientSecret) {
    throw new Error('LinkedIn credentials not configured. Please set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET environment variables.');
  }

  return { clientId, clientSecret, redirectUri };
};

const linkedinFetch = async <T>(
  url: string,
  options: {
    method?: string;
    accessToken?: string;
    body?: any;
    formData?: Record<string, string>;
    headers?: Record<string, string>;
  }
): Promise<T> => {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    'X-Restli-Protocol-Version': '2.0.0',
    ...options.headers,
  };

  let bodyContent: any;

  if (options.formData) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    bodyContent = new URLSearchParams(options.formData).toString();
  } else if (options.body) {
    if (options.body instanceof ArrayBuffer || (typeof Buffer !== 'undefined' && Buffer.isBuffer(options.body))) {
      bodyContent = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      bodyContent = JSON.stringify(options.body);
    }
  }

  if (options.accessToken) {
    headers['Authorization'] = `Bearer ${options.accessToken}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: bodyContent,
  });

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (!res.ok) {
      throw new Error(`LinkedIn API error (${res.status}): ${text.substring(0, 300)}`);
    }
    return {} as T;
  }

  if (!res.ok) {
    const errorMsg = data?.message || data?.error_description || data?.error || `LinkedIn API request failed (${res.status})`;
    throw new Error(errorMsg);
  }

  return data as T;
};

const getStoredTokens = async (uid: string) => {
  const db = await getScheduleDb();
  const ref = db.doc(`users/${uid}/integrations/linkedin`);
  const snap = await ref.get();
  return snap.exists ? snap.data() : null;
};

const saveTokens = async (uid: string, data: Record<string, any>) => {
  const db = await getScheduleDb();
  const ref = db.doc(`users/${uid}/integrations/linkedin`);
  await ref.set({ ...data, updatedAt: Date.now() }, { merge: true });
};

const getValidAccessToken = async (uid: string): Promise<{ accessToken: string; personUrn: string }> => {
  const tokens = await getStoredTokens(uid);
  if (!tokens?.refreshToken) {
    throw new Error('LinkedIn not connected');
  }

  if (tokens.accessToken && tokens.accessTokenExpiresAt && Date.now() < tokens.accessTokenExpiresAt - 60000) {
    return { accessToken: tokens.accessToken, personUrn: tokens.personUrn };
  }

  const { clientId, clientSecret } = getLinkedInConfig();

  const refreshData = await linkedinFetch<any>('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    formData: {
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    },
  });

  const newAccessToken = refreshData.access_token;
  const expiresIn = refreshData.expires_in || 3600;

  await saveTokens(uid, {
    accessToken: newAccessToken,
    accessTokenExpiresAt: Date.now() + expiresIn * 1000,
    refreshToken: refreshData.refresh_token || tokens.refreshToken,
    refreshTokenExpiresAt: refreshData.refresh_token_expires_in
      ? Date.now() + refreshData.refresh_token_expires_in * 1000
      : tokens.refreshTokenExpiresAt,
  });

  return { accessToken: newAccessToken, personUrn: tokens.personUrn };
};

// ═══════════════════════════════════════════════════════════════════════════
// TikTok Helpers
// ═══════════════════════════════════════════════════════════════════════════

const getStoredTikTokData = async (uid: string) => {
  const db = await getScheduleDb();
  const doc = await db.doc(`users/${uid}/integrations/tiktok`).get();
  return doc.exists ? (doc.data() as any) : null;
};

const getTikTokConfig = () => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY || '';
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || '';
  const redirectUri = process.env.TIKTOK_REDIRECT_URI || '';

  if (!clientKey || !clientSecret || !redirectUri) {
    throw new Error('TikTok credentials not configured. Please set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, and TIKTOK_REDIRECT_URI environment variables.');
  }

  return { clientKey, clientSecret, redirectUri };
};

const tiktokFetch = async <T>(
  url: string,
  options: {
    method?: string;
    accessToken?: string;
    body?: any;
    formData?: Record<string, string>;
  }
): Promise<T> => {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    'Cache-Control': 'no-cache'
  };

  let bodyContent: string | undefined;

  if (options.formData) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    bodyContent = new URLSearchParams(options.formData).toString();
  } else if (options.body) {
    headers['Content-Type'] = 'application/json; charset=UTF-8';
    bodyContent = JSON.stringify(options.body);
  }

  if (options.accessToken) {
    headers['Authorization'] = `Bearer ${options.accessToken}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: bodyContent,
  });

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (parseError) {
    throw new Error(`Failed to parse TikTok API response: ${text.substring(0, 200)}`);
  }

  if (data?.error && data.error.code && data.error.code !== 'ok') {
    const errorMsg = data.error.message || data.error.code || 'TikTok API error';
    const logId = data.error.log_id ? ` (log_id: ${data.error.log_id})` : '';
    throw new Error(errorMsg + logId);
  }

  if (data?.error && typeof data.error === 'string') {
    const errorMsg = data.error_description || data.error;
    const logId = data.log_id ? ` (log_id: ${data.log_id})` : '';
    throw new Error(errorMsg + logId);
  }

  if (!res.ok) {
    const errorMsg = data?.error?.message
      || data?.message
      || `TikTok API request failed (${res.status}): ${text.substring(0, 200)}`;
    throw new Error(errorMsg);
  }

  return data as T;
};

const generateTikTokAuthUrl = (state: string): string => {
  const { clientKey, redirectUri } = getTikTokConfig();
  const params = new URLSearchParams({
    client_key: clientKey,
    scope: 'user.info.basic,video.publish,video.upload',
    response_type: 'code',
    redirect_uri: redirectUri,
    state: state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
};

const exchangeTikTokCodeForToken = async (code: string): Promise<any> => {
  const { clientKey, clientSecret, redirectUri } = getTikTokConfig();
  return tiktokFetch<any>('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    formData: {
      client_key: clientKey,
      client_secret: clientSecret,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    },
  });
};

const refreshTikTokAccessToken = async (refreshToken: string): Promise<any> => {
  const { clientKey, clientSecret } = getTikTokConfig();
  return tiktokFetch<any>('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    formData: {
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
  });
};

const revokeTikTokAccess = async (accessToken: string): Promise<void> => {
  const { clientKey, clientSecret } = getTikTokConfig();
  await tiktokFetch<any>('https://open.tiktokapis.com/v2/oauth/revoke/', {
    method: 'POST',
    formData: {
      client_key: clientKey,
      client_secret: clientSecret,
      token: accessToken,
    },
  });
};

const queryTikTokCreatorInfo = async (accessToken: string): Promise<any> => {
  const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
    method: 'POST',
    accessToken,
  });
  const d = data.data || {};
  return {
    creatorAvatarUrl: d.creator_avatar_url || '',
    creatorUsername: d.creator_username || '',
    creatorNickname: d.creator_nickname || '',
    privacyLevelOptions: d.privacy_level_options || [],
    commentDisabled: !!d.comment_disabled,
    duetDisabled: !!d.duet_disabled,
    stitchDisabled: !!d.stitch_disabled,
    maxVideoPostDurationSec: d.max_video_post_duration_sec || 60,
  };
};

const postTikTokVideoInit = async (params: {
  accessToken: string;
  title?: string;
  privacyLevel: string;
  disableDuet?: boolean;
  disableStitch?: boolean;
  disableComment?: boolean;
  videoCoverTimestampMs?: number;
  videoSize?: number;
  chunkSize?: number;
  totalChunkCount?: number;
  source?: 'FILE_UPLOAD' | 'PULL_FROM_URL';
  videoUrl?: string;
  inbox?: boolean;
}): Promise<any> => {
  const endpoint = params.inbox
    ? 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'
    : 'https://open.tiktokapis.com/v2/post/publish/video/init/';

  const body: any = {
    source_info: {
      source: params.source || 'FILE_UPLOAD',
    }
  };

  if (params.source === 'PULL_FROM_URL') {
    body.source_info.video_url = params.videoUrl;
  } else {
    body.source_info.video_size = params.videoSize;
    body.source_info.chunk_size = params.chunkSize;
    body.source_info.total_chunk_count = params.totalChunkCount;
  }

  if (!params.inbox) {
    body.post_info = {
      title: params.title || '',
      privacy_level: params.privacyLevel,
      disable_duet: params.disableDuet ?? false,
      disable_stitch: params.disableStitch ?? false,
      disable_comment: params.disableComment ?? false,
      video_cover_timestamp_ms: params.videoCoverTimestampMs ?? 1000,
    };
  }

  const data = await tiktokFetch<any>(endpoint, {
    method: 'POST',
    accessToken: params.accessToken,
    body,
  });

  return {
    publishId: data.data?.publish_id || '',
    uploadUrl: data.data?.upload_url || ''
  };
};

const postTikTokPhotosInit = async (params: {
  accessToken: string;
  photoCount: number;
  title?: string;
  description?: string;
  privacyLevel: string;
  disableComment?: boolean;
  autoAddMusic?: boolean;
  photoCoverIndex?: number;
  source?: 'FILE_UPLOAD' | 'PULL_FROM_URL';
  photoUrls?: string[];
  inbox?: boolean;
}): Promise<any> => {
  const endpoint = 'https://open.tiktokapis.com/v2/post/publish/content/init/';

  const body: any = {
    post_info: {
      title: params.title || '',
      description: params.description || '',
    },
    source_info: {
      source: params.source || 'FILE_UPLOAD',
      photo_cover_index: params.photoCoverIndex ?? 0,
    },
    post_mode: params.inbox ? 'MEDIA_UPLOAD' : 'DIRECT_POST',
    media_type: 'PHOTO',
  };

  if (params.source === 'PULL_FROM_URL') {
    body.source_info.photo_images = params.photoUrls;
  } else {
    body.source_info.photo_count = params.photoCount;
  }

  if (!params.inbox) {
    body.post_info.privacy_level = params.privacyLevel;
    body.post_info.disable_comment = params.disableComment ?? false;
    body.post_info.auto_add_music = params.autoAddMusic ?? true;
  }

  const data = await tiktokFetch<any>(endpoint, {
    method: 'POST',
    accessToken: params.accessToken,
    body,
  });

  return {
    publishId: data.data?.publish_id || '',
    uploadUrls: data.data?.upload_urls || []
  };
};

const getTikTokPostStatus = async (accessToken: string, publishId: string): Promise<any> => {
  const data = await tiktokFetch<any>('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
    method: 'POST',
    accessToken,
    body: { publish_id: publishId },
  });
  const d = data.data || {};
  return {
    status: d.status || 'UNKNOWN',
    failReason: d.fail_reason,
    publiclyAvailablePostId: d.publicaly_available_post_id,
    uploadedBytes: d.uploaded_bytes,
    downloadedBytes: d.downloaded_bytes,
  };
};

const handleRequest = async (request: Request): Promise<Response> => {
  const url = getRequestUrl(request);
  let op = (url.searchParams.get('op') || '').trim();

  // Map legacy LinkedIn op names
  const legacyLinkedinOps: Record<string, string> = {
    'auth-url': 'linkedin-auth-url',
    'exchange': 'linkedin-exchange',
    'status': 'linkedin-status',
    'post-text': 'linkedin-post-text',
    'post-article': 'linkedin-post-article',
    'register-upload': 'linkedin-register-upload',
    'upload-media': 'linkedin-upload-media',
    'post-media': 'linkedin-post-media',
    'disconnect': 'linkedin-disconnect'
  };
  if (legacyLinkedinOps[op]) {
    op = legacyLinkedinOps[op];
  }

  try {
    if (!op) return errorJson('Missing op', 400);

    console.log(`[Social API] Handler called with op: ${op}, method: ${request.method}`);

    const allowedGetOps = [
      'ping',
      'x-auth-url',
      'x-status',
      'x-upload-status',
      'schedule-list',
      'uploadpost-get-users',
      'uploadpost-get-user',
      'uploadpost-status',
      'uploadpost-history',
      'uploadpost-facebook-pages',
      'linkedin-auth-url',
      'linkedin-status',
      'tiktok-auth-url',
      'tiktok-creator-info',
      'tiktok-post-status',
      'tiktok-tokens-get',
      'fb-tokens-get'
    ];

    if (request.method !== 'POST' && !allowedGetOps.includes(op)) {
      return errorJson('Method not allowed', 405);
    }

    let body: any = {};
    const binaryOps = ['x-upload-append', 'linkedin-upload-media'];

    // Only parse JSON if NOT a binary operation
    if (!binaryOps.includes(op)) {
      try {
        body = await request.json();
      } catch {
        // Body might be empty or invalid JSON, which is fine for some ops
        body = {};
      }
    } else {
      console.log(`[Social API] Skipping JSON parse for binary op: ${op}`);
    }

    const ADMIN_TOKEN = process.env.AGENT_ADMIN_TOKEN;

    // 1. Diagnostic Ops (Admin Only)
    if (op === 'ping' || op === 'debug-token') {
      const token = url.searchParams.get('token') || request.headers.get('X-Agent-Admin-Token');
      if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return errorJson('Unauthorized: Invalid admin token', 401);
      }

      if (op === 'ping') {
        return json({ pong: true, time: Date.now(), nodeVersion: process.version });
      }

      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      return json({
        length: fbUserAccessToken.length,
        prefix: fbUserAccessToken.substring(0, 10),
        receivedAt: new Date().toISOString()
      });
    }

    let uid: string | undefined;
    if (op !== 'ig-container-publish') {
      const authResult = await requireAuth(request);
      if (authResult instanceof Response) return authResult;
      uid = authResult.uid;
    }

    if (op === 'ig-accounts') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      if (!fbUserAccessToken) return errorJson('Missing fbUserAccessToken', 400);

      const { accounts, diagnostics } = await listInstagramAccounts(fbUserAccessToken);
      return json({ accounts, diagnostics });
    }

    // ... rest of the handler ...

    if (op === 'ig-publish-image') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const igId = String(body?.igId || '').trim();
      const imageUrl = String(body?.imageUrl || '').trim();
      if (!fbUserAccessToken || !igId || !imageUrl) return errorJson('Missing required fields', 400);

      const result = await createInstagramContainer({
        fbUserAccessToken,
        igId,
        mediaType: 'IMAGE',
        imageUrl,
        caption: body?.caption,
        altText: body?.altText,
      });

      const publish = await publishInstagramContainer({
        fbUserAccessToken,
        igId,
        creationId: result.id,
      });

      return json({ mediaId: publish.id });
    }

    if (op === 'ig-publish-robust') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const igId = String(body?.igId || '').trim();
      const mediaUrls = Array.isArray(body?.mediaUrls) ? body.mediaUrls : [];
      if (!fbUserAccessToken || !igId || !mediaUrls.length) return errorJson('Missing required fields', 400);

      const result = await handleInstagramPublishRobust({
        fbUserAccessToken,
        igId,
        mediaType: body?.mediaType || 'FEED',
        mediaUrls,
        caption: body?.caption,
        shareToFeed: body?.shareToFeed,
        isVideo: body?.isVideo,
      });

      return json(result);
    }

    // Handler for QStash-scheduled container publishing
    if (op === 'ig-container-publish') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const igId = String(body?.igId || '').trim();
      const containerId = String(body?.containerId || '').trim();
      const attempt = Number(body?.attempt) || 1;
      const maxAttempts = Number(body?.maxAttempts) || 10;

      if (!fbUserAccessToken || !igId || !containerId) {
        return errorJson('Missing required fields for container publish', 400);
      }

      console.log(`[Social API] ig-container-publish called - attempt ${attempt}/${maxAttempts}, containerId: ${containerId}`);

      try {
        // Check container status
        const status = await getInstagramContainerStatus({
          fbUserAccessToken,
          igId,
          containerId,
        });

        console.log(`[Social API] Container status:`, status.status_code);

        if (status.status_code === 'FINISHED') {
          // Container is ready, publish it
          console.log(`[Social API] Container is ready, publishing...`);
          const publishResult = await publishInstagramContainer({
            fbUserAccessToken,
            igId,
            creationId: containerId,
          });
          console.log(`[Social API] Container published successfully:`, publishResult.id);
          return json({ success: true, mediaId: publishResult.id, status: 'PUBLISHED' });
        } else if (status.status_code === 'ERROR') {
          console.error(`[Social API] Container processing failed:`, status.status);
          return errorJson(`Container processing failed: ${status.status || 'Unknown error'}`, 500);
        } else if (status.status_code === 'EXPIRED') {
          return errorJson('Container expired before publishing', 500);
        } else if (status.status_code === 'IN_PROGRESS') {
          // Still processing, reschedule if we have attempts left
          if (attempt < maxAttempts) {
            const baseUrl = getScheduleBaseUrl();
            const publishUrl = `${baseUrl}/api/social?op=ig-container-publish`;

            const response = await getQStashClient().publishJSON({
              url: publishUrl,
              body: {
                fbUserAccessToken,
                igId,
                containerId,
                attempt: attempt + 1,
                maxAttempts,
              },
              delay: 20, // Wait 20 seconds before next attempt
              retries: 2,
              timeout: '25s', // Vercel has 30s timeout, leave 5s buffer
            });

            console.log(`[Social API] Rescheduled publish attempt ${attempt + 1}, messageId: ${response.messageId}`);
            return json({
              status: 'STILL_PROCESSING',
              attempt,
              nextAttemptScheduled: true,
              qstashMessageId: response.messageId
            });
          } else {
            return errorJson(`Container still processing after ${maxAttempts} attempts`, 500);
          }
        }

        return json({ status: status.status_code });
      } catch (error: any) {
        console.error(`[Social API] ig-container-publish error:`, error?.message);
        return errorJson(error?.message || 'Unknown error', 500);
      }
    }

    if (op === 'fb-exchange-token') {
      const shortLivedToken = String(body?.shortLivedToken || '').trim();
      if (!shortLivedToken) return errorJson('Missing shortLivedToken', 400);

      const appId = process.env.VITE_FACEBOOK_APP_ID;
      const appSecret = process.env.FACEBOOK_CLIENT_SECRET || process.env.FACEBOOK_APP_SECRET;

      if (!appId || !appSecret) {
        console.error('[Social API] Missing Facebook App ID or Secret in env');
        return errorJson('Server configuration error: Missing Facebook App Secret', 500);
      }

      try {
        const exchangeUrl = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`;

        const res = await fetch(exchangeUrl);
        const data = await res.json();

        if (data.error) {
          console.error('[Social API] Token exchange failed:', data.error);
          return errorJson(data.error.message || 'Token exchange failed', 400);
        }

        return json({
          accessToken: data.access_token,
          expiresIn: data.expires_in // Seconds until expiration (usually 60 days)
        });
      } catch (e: any) {
        console.error('[Social API] Token exchange exception:', e);
        return errorJson(e.message || 'Token exchange failed', 500);
      }
    }

    if (op === 'ig-create-container') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const igId = String(body?.igId || '').trim();
      if (!fbUserAccessToken) return errorJson('Missing fbUserAccessToken', 400);
      if (!igId) return errorJson('Missing igId', 400);

      const result = await createInstagramContainer({
        fbUserAccessToken,
        igId,
        mediaType: body?.mediaType,
        imageUrl: body?.imageUrl,
        videoUrl: body?.videoUrl,
        caption: body?.caption,
        altText: body?.altText,
        isCarouselItem: body?.isCarouselItem,
        children: body?.children,
        locationId: body?.locationId,
        shareToFeed: body?.shareToFeed,
      });

      return json({ ...result });
    }

    if (op === 'ig-publish-container') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const igId = String(body?.igId || '').trim();
      // Accept both containerId (from frontend) and creationId (API standard)
      const creationId = String(body?.creationId || body?.containerId || '').trim();

      console.log('[Social API] ig-publish-container request:', {
        hasToken: !!fbUserAccessToken,
        igId,
        creationId,
        receivedContainerId: !!body?.containerId,
        receivedCreationId: !!body?.creationId,
      });

      if (!fbUserAccessToken) return errorJson('Missing fbUserAccessToken', 400);
      if (!igId) return errorJson('Missing igId', 400);
      if (!creationId) return errorJson('Missing containerId or creationId', 400);

      try {
        const result = await publishInstagramContainer({
          fbUserAccessToken,
          igId,
          creationId,
        });

        console.log('[Social API] ig-publish-container success:', result);
        return json({ ...result });
      } catch (error: any) {
        console.error('[Social API] ig-publish-container error:', {
          error: error?.message || String(error),
          creationId,
          igId
        });
        return errorJson(error?.message || 'Failed to publish container', 500);
      }
    }

    if (op === 'ig-container-status') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const igId = String(body?.igId || '').trim();
      const containerId = String(body?.containerId || '').trim();

      console.log('[Social API] ig-container-status request:', {
        hasToken: !!fbUserAccessToken,
        tokenLength: fbUserAccessToken.length,
        igId,
        containerId,
      });

      if (!fbUserAccessToken) return errorJson('Missing fbUserAccessToken', 400);
      if (!igId || igId === 'undefined') return errorJson('Missing or invalid igId', 400);
      if (!containerId || containerId === 'undefined') return errorJson('Missing or invalid containerId', 400);

      try {
        const result = await getInstagramContainerStatus({
          fbUserAccessToken,
          igId,
          containerId,
        });

        console.log('[Social API] ig-container-status success:', result);
        return json({ ...result });
      } catch (error: any) {
        console.error('[Social API] ig-container-status error:', {
          error: error?.message || String(error),
          containerId,
          igId
        });
        return errorJson(error?.message || 'Failed to check container status', 500);
      }
    }

    if (op === 'ig-publishing-limit') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const igId = String(body?.igId || '').trim();
      if (!fbUserAccessToken) return errorJson('Missing fbUserAccessToken', 400);
      if (!igId) return errorJson('Missing igId', 400);

      const result = await getInstagramPublishingLimit({
        fbUserAccessToken,
        igId,
      });

      return json({ ...result });
    }

    if (op === 'ig-hashtag-search') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const igUserId = String(body?.igUserId || '').trim();
      const q = String(body?.q || '').trim().replace(/^#/, '');
      if (!fbUserAccessToken) return errorJson('Missing fbUserAccessToken', 400);
      if (!igUserId) return errorJson('Missing igUserId', 400);
      if (!q) return errorJson('Missing q', 400);

      const result = await searchHashtag({ fbUserAccessToken, igUserId, q });
      return json({ result });
    }

    if (op === 'ig-hashtag-top-media' || op === 'ig-hashtag-recent-media') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const igUserId = String(body?.igUserId || '').trim();
      const hashtagId = String(body?.hashtagId || '').trim();
      const limitRaw = body?.limit;
      const limit = typeof limitRaw === 'number' ? limitRaw : limitRaw ? Number(limitRaw) : undefined;

      if (!fbUserAccessToken) return errorJson('Missing fbUserAccessToken', 400);
      if (!igUserId) return errorJson('Missing igUserId', 400);
      if (!hashtagId) return errorJson('Missing hashtagId', 400);

      const kind = op === 'ig-hashtag-top-media' ? 'top' : 'recent';
      const resp = await hashtagMedia({ fbUserAccessToken, igUserId, hashtagId, kind, limit });
      return json({ data: resp?.data || [], paging: resp?.paging || null });
    }

    if (op === 'ig-business-discovery') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const igUserId = String(body?.igUserId || '').trim();
      const username = String(body?.username || '').trim();
      if (!fbUserAccessToken) return errorJson('Missing fbUserAccessToken', 400);
      if (!igUserId) return errorJson('Missing igUserId', 400);
      if (!username) return errorJson('Missing username', 400);

      const result = await instagramBusinessDiscovery({ fbUserAccessToken, igUserId, username });
      return json({ result });
    }

    if (op === 'x-recent-search') {
      const { userId, query } = body;

      if (!userId || !query) return errorJson('Missing userId or query', 400);

      // IDOR Fix: Ensure requested userId matches authenticated uid
      if (userId !== uid) {
        return errorJson('Forbidden: You can only search with your own linked account', 403);
      }

      try {
        const result = await searchXTweets(userId, query);
        return json(result);
      } catch (e: any) {
        return errorJson(e.message, 500);
      }
    }

    if (op === 'x-user-search') {
      const { userId, query } = body;

      if (!userId || !query) return errorJson('Missing userId or query', 400);

      // IDOR Fix: Ensure requested userId matches authenticated uid
      if (userId !== uid) {
        return errorJson('Forbidden: You can only search with your own linked account', 403);
      }

      try {
        const result = await searchXUsers(userId, query);
        return json(result);
      } catch (e: any) {
        return errorJson(e.message, 500);
      }
    }

    if (op === 'fb-pages') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      if (!fbUserAccessToken) return errorJson('Missing fbUserAccessToken', 400);
      const pages = await getFacebookPages(fbUserAccessToken);
      return json({ pages });
    }

    if (op === 'fb-publish-post') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const pageId = String(body?.pageId || '').trim();
      const message = String(body?.message || '').trim();
      if (!fbUserAccessToken || !pageId || !message) return errorJson('Missing required fields', 400);

      const result = await publishFacebookPost({
        fbUserAccessToken,
        pageId,
        message,
        link: body?.link,
        published: body?.published,
        scheduled_publish_time: body?.scheduled_publish_time,
      });

      return json({ id: result.id, post_id: result.post_id || result.id });
    }

    if (op === 'fb-publish-photo') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const pageId = String(body?.pageId || '').trim();
      const url = String(body?.url || '').trim();

      console.log('[Social API] fb-publish-photo request:', {
        hasFbToken: !!fbUserAccessToken,
        fbTokenLength: fbUserAccessToken?.length,
        pageId,
        hasUrl: !!url,
        urlPreview: url?.substring(0, 50),
        caption: body?.caption,
        allBodyKeys: Object.keys(body || {})
      });

      if (!fbUserAccessToken || !pageId || !url) {
        console.error('[Social API] fb-publish-photo missing required fields:', {
          fbUserAccessToken: !!fbUserAccessToken,
          pageId: !!pageId,
          url: !!url
        });
        return errorJson('Missing required fields', 400);
      }

      const result = await publishFacebookPhoto({
        fbUserAccessToken,
        pageId,
        url,
        caption: body?.caption,
        published: body?.published,
        scheduled_publish_time: body?.scheduled_publish_time,
      });

      return json({ id: result.id, post_id: result.post_id });
    }

    if (op === 'fb-publish-video') {
      const fbUserAccessToken = String(body?.fbUserAccessToken || '').trim();
      const pageId = String(body?.pageId || '').trim();
      const file_url = String(body?.file_url || '').trim();
      if (!fbUserAccessToken || !pageId || !file_url) return errorJson('Missing required fields', 400);

      const result = await publishFacebookVideo({
        fbUserAccessToken,
        pageId,
        file_url,
        title: body?.title,
        description: body?.description,
      });

      return json({ id: result.id });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // X (Twitter) Handlers
    // ═══════════════════════════════════════════════════════════════════════════

    if (op === 'x-auth-url') {
      const { clientId, clientSecret, redirectUri } = getXConfig();
      const uid = url.searchParams.get('uid');
      if (!uid) return errorJson('UID must be provided', 400);

      const client = new TwitterApi({ clientId, clientSecret });
      const { url: authUrl, codeVerifier, state: authState } = client.generateOAuth2AuthLink(
        redirectUri,
        {
          scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'],
          state: url.searchParams.get('state') || 'state'
        }
      );

      await saveXData(uid, { codeVerifier, state: authState });
      return json({ url: authUrl });
    }

    if (op === 'x-exchange') {
      const { code, state, uid } = body;
      console.log(`[X API] x-exchange called for uid: ${uid}, code: ${code ? 'present' : 'missing'}`);

      if (!uid || !code) return errorJson('Missing required fields', 400);

      try {
        const { clientId, clientSecret, redirectUri } = getXConfig();
        console.log(`[X API] Config params: clientId=${clientId ? 'ok' : 'missing'}, redirectUri=${redirectUri}`);

        const storedData = await getStoredXData(uid);
        console.log(`[X API] Stored data found: ${!!storedData}, hasVerifier: ${!!storedData?.codeVerifier}`);

        if (!storedData || !storedData.codeVerifier) {
          console.error(`[X API] No pending authentication (codeVerifier missing). Stored keys: ${storedData ? Object.keys(storedData) : 'null'}`);
          return errorJson('No pending authentication found (verifier missing)', 400);
        }

        const client = new TwitterApi({ clientId, clientSecret });

        console.log('[X API] Attempting loginWithOAuth2...');
        const { client: loggedClient, accessToken, refreshToken, expiresIn, scope } = await client.loginWithOAuth2({
          code,
          codeVerifier: storedData.codeVerifier,
          redirectUri,
        });
        console.log('[X API] Token exchange successful');

        const meUser = await loggedClient.v2.me({ 'user.fields': ['profile_image_url'] });
        const profileData = meUser.data;

        await saveXData(uid, {
          accessToken,
          refreshToken,
          expiresAt: Date.now() + (expiresIn * 1000),
          scope,
          profileId: profileData.id,
          profileName: profileData.name,
          profileUsername: profileData.username,
          profileImage: profileData.profile_image_url,
          codeVerifier: null,
          state: null
        });

        return json({ success: true, profile: profileData });
      } catch (e: any) {
        console.error('[X API] Exchange Error:', JSON.stringify(e, null, 2));
        // Return full error details to frontend
        return errorJson(`X Token Exchange Failed: ${e?.message || e?.data?.error || JSON.stringify(e)}`, 400);
      }
    }

    if (op === 'x-status') {
      const authHeader = request.headers.get('Authorization');
      const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!idToken) return errorJson('Missing authorization token', 401);

      try {
        await getScheduleDb();
        const { getAuth } = await import('firebase-admin/auth');
        const decodedToken = await getAuth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const data = await getStoredXData(uid);
        if (!data || !data.accessToken) return json({ connected: false });

        return json({
          connected: true,
          profile: {
            name: data.profileName,
            username: data.profileUsername,
            profile_image_url: data.profileImage,
          }
        });
      } catch (e: any) {
        return errorJson('Invalid authorization token', 401);
      }
    }

    if (op === 'x-disconnect') {
      const authHeader = request.headers.get('Authorization');
      const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!idToken) return errorJson('Missing authorization token', 401);

      try {
        await getScheduleDb();
        const { getAuth } = await import('firebase-admin/auth');
        const decodedToken = await getAuth().verifyIdToken(idToken);
        const db = await getScheduleDb();
        await db.doc(`users/${decodedToken.uid}/integrations/x`).delete();
        return json({ success: true });
      } catch (e: any) {
        return errorJson(`Disconnect failed: ${e.message}`, 500);
      }
    }

    if (op === 'x-upload-init') {
      const authHeader = request.headers.get('Authorization');
      const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!idToken) return errorJson('Missing authorization token', 401);

      try {
        await getScheduleDb();
        const { getAuth } = await import('firebase-admin/auth');
        const decodedToken = await getAuth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const { mediaType, totalBytes, mediaCategory } = body;
        await getValidXClient(uid);
        const storedData = await getStoredXData(uid);
        const accessToken = storedData?.accessToken;
        if (!accessToken) return errorJson('No access token', 401);

        const res = await fetch('https://api.x.com/2/media/upload/initialize', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ media_type: mediaType, media_category: mediaCategory, total_bytes: totalBytes })
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        return json(data.data || data);
      } catch (e: any) { return errorJson(e.message, 500); }
    }

    if (op === 'x-upload-append') {
      const authHeader = request.headers.get('Authorization');
      const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!idToken) return errorJson('Missing authorization token', 401);

      try {
        await getScheduleDb();
        const { getAuth } = await import('firebase-admin/auth');
        const decodedToken = await getAuth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const mediaId = url.searchParams.get('mediaId');
        const segmentIndex = url.searchParams.get('segmentIndex');
        if (!mediaId || segmentIndex === null) return errorJson('Missing mediaId/segmentIndex', 400);

        await getValidXClient(uid);
        console.log('[X API] X Client Validated');
        const storedData = await getStoredXData(uid);
        const accessToken = storedData?.accessToken;
        if (!accessToken) return errorJson('No access token', 401);

        console.log('[X API] Reading request body...');
        const fileBytes = await request.arrayBuffer();
        if (!fileBytes || fileBytes.byteLength === 0) {
          console.error('[X API] Empty file body received');
          return errorJson('Empty file body', 400);
        }
        console.log(`[X API] Body read, bytes: ${fileBytes.byteLength}`);

        console.log(`[X API] Appending chunk ${segmentIndex} to media ${mediaId}, size: ${fileBytes.byteLength}`);

        const formData = new FormData();
        // IMPORTANT: Filename 'blob' (or similar) is often required by APIs expecting file uploads
        formData.append('media', new Blob([fileBytes]), 'blob');
        formData.append('segment_index', segmentIndex);

        const res = await fetch(`https://api.x.com/2/media/upload/${mediaId}/append`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}` },
          body: formData
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[X API] Append failed: ${res.status} ${errText}`);
          throw new Error(errText);
        }
        return json({ success: true });
      } catch (e: any) {
        console.error('[X API] x-upload-append fatal error:', e);
        return errorJson(e.message, 500);
      }
    }

    if (op === 'x-upload-finalize') {
      const authHeader = request.headers.get('Authorization');
      const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!idToken) return errorJson('Missing authorization token', 401);

      try {
        await getScheduleDb();
        const { getAuth } = await import('firebase-admin/auth');
        const decodedToken = await getAuth().verifyIdToken(idToken);
        const uid = decodedToken.uid;
        const { mediaId } = body;

        await getValidXClient(uid);
        const storedData = await getStoredXData(uid);
        const accessToken = storedData?.accessToken;

        const res = await fetch(`https://api.x.com/2/media/upload/${mediaId}/finalize`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        return json(data.data || data);
      } catch (e: any) { return errorJson(e.message, 500); }
    }

    if (op === 'x-upload-status') {
      const authHeader = request.headers.get('Authorization');
      const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!idToken) return errorJson('Missing authorization token', 401);

      try {
        await getScheduleDb();
        const { getAuth } = await import('firebase-admin/auth');
        const decodedToken = await getAuth().verifyIdToken(idToken);
        const uid = decodedToken.uid;
        const mediaId = url.searchParams.get('mediaId');
        if (!mediaId) return errorJson('Missing mediaId', 400);

        await getValidXClient(uid);
        const storedData = await getStoredXData(uid);
        const accessToken = storedData?.accessToken;

        const res = await fetch(`https://api.x.com/2/media/upload?media_id=${mediaId}&command=STATUS`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        return json(data.data || data);
      } catch (e: any) { return errorJson(e.message, 500); }
    }

    if (op === 'x-post-tweet') {
      const authHeader = request.headers.get('Authorization');
      const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!idToken) return errorJson('Missing authorization token', 401);

      try {
        await getScheduleDb();
        const { getAuth } = await import('firebase-admin/auth');
        const decodedToken = await getAuth().verifyIdToken(idToken);
        const uid = decodedToken.uid;
        const { text, mediaIds } = body;

        const client = await getValidXClient(uid);
        const payload: any = { text };
        if (mediaIds && mediaIds.length > 0) {
          payload.media = { media_ids: mediaIds };
        }

        const data = await client.v2.tweet(payload);
        return json(data);
      } catch (e: any) { return errorJson(`Post Tweet Failed: ${e.message}`, 500); }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SCHEDULING OPERATIONS (QStash-based)
    // ═══════════════════════════════════════════════════════════════════════════

    if (op === 'schedule-create') {
      console.log('[Schedule Create] ======= ENTRY POINT =======');
      console.log('[Schedule Create] Request received at:', new Date().toISOString());
      console.log('[Schedule Create] Body:', JSON.stringify(body, null, 2));

      // IMPORTANT: Use authenticated user's UID, not client-provided userId
      // Tokens are stored under the Firebase Auth UID, not project.ownerUid

      // Inline Firebase Auth token verification (to avoid module import issues)
      const authHeader = request.headers.get('Authorization');
      const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      console.log('[Schedule Create] Auth header present:', !!authHeader);
      console.log('[Schedule Create] ID Token present:', !!idToken);

      if (!idToken) {
        console.error('[Schedule Create] Missing authorization token');
        return errorJson('Missing authorization token', 401);
      }

      let authUid: string;
      try {
        // Ensure Firebase Admin is initialized (uses same logic as getScheduleDb)
        await getScheduleDb();
        const { getAuth } = await import('firebase-admin/auth');
        const decodedToken = await getAuth().verifyIdToken(idToken);
        authUid = decodedToken.uid;
        console.log('[Schedule Create] Auth verified, UID:', authUid);
      } catch (e: any) {
        console.error('[Schedule Create] Auth error:', e.message);
        return errorJson('Invalid authorization token', 401);
      }

      const { projectId, scheduledAt, platforms, postType, textContent, mediaUrl, platformOverrides } = body;

      console.log('[Schedule Create] Extracted params:', {
        projectId,
        scheduledAt,
        scheduledAtDate: scheduledAt ? new Date(scheduledAt * 1000).toISOString() : 'N/A',
        platforms,
        postType,
        textContentLength: textContent?.length || 0,
        hasMediaUrl: !!mediaUrl,
        mediaUrlPreview: mediaUrl?.substring(0, 60),
        platformOverridesKeys: Object.keys(platformOverrides || {})
      });

      if (!projectId) { console.error('[Schedule Create] Missing projectId'); return errorJson('Missing projectId'); }
      if (!scheduledAt) { console.error('[Schedule Create] Missing scheduledAt'); return errorJson('Missing scheduledAt'); }
      if (!platforms?.length) { console.error('[Schedule Create] Missing platforms'); return errorJson('Missing platforms'); }
      if (!textContent && !mediaUrl) { console.error('[Schedule Create] Missing content'); return errorJson('Missing content'); }

      const now = Math.floor(Date.now() / 1000);
      const minTime = now + 600;
      const maxTime = now + 7 * 24 * 60 * 60;

      if (scheduledAt < minTime) return errorJson('Scheduled time must be at least 10 minutes in the future');
      if (scheduledAt > maxTime) return errorJson('Scheduled time cannot be more than 7 days in the future');

      const db = await getScheduleDb();
      const qstash = getQStashClient();

      // Use authUid - the authenticated user's Firebase UID
      // This ensures schedule-execute will find tokens at users/${authUid}/integrations/x
      const postData: ScheduledPost = {
        projectId, userId: authUid, scheduledAt,
        status: 'scheduled',
        platforms,
        postType: postType || 'TEXT',
        textContent: textContent || '',
        ...(mediaUrl ? { mediaUrl } : {}),
        platformOverrides: platformOverrides || {},
        createdAt: now,
      };

      console.log('[Schedule Create] Saving post:', {
        projectId: postData.projectId,
        userId: authUid,
        scheduledAt: postData.scheduledAt,
        scheduledAtDate: new Date(postData.scheduledAt * 1000).toISOString(),
        postType: postData.postType,
        hasMediaUrl: !!postData.mediaUrl,
        mediaUrlPrefix: postData.mediaUrl?.substring(0, 50),
        platforms: postData.platforms,
        hasOverrides: Object.keys(postData.platformOverrides).length > 0
      });

      const docRef = await db.collection('scheduledPosts').add(postData);
      const postId = docRef.id;
      console.log('[Schedule Create] Post saved to Firestore with ID:', postId);

      // Build headers for Vercel Deployment Protection bypass
      const bypassHeaders: Record<string, string> = {};
      const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      if (bypassSecret) {
        bypassHeaders['x-vercel-protection-bypass'] = bypassSecret;
      }

      const result = await qstash.publishJSON({
        url: `${getScheduleBaseUrl()}/api/social?op=schedule-execute`,
        body: { scheduledPostId: postId },
        notBefore: scheduledAt,
        retries: 3,
        headers: bypassHeaders,
      });

      await docRef.update({ qstashMessageId: result.messageId });

      console.log('[Schedule Create] SUCCESS! Post scheduled:', {
        postId,
        projectId,
        qstashMessageId: result.messageId,
        scheduledAtDate: new Date(scheduledAt * 1000).toISOString()
      });

      return json({ success: true, scheduledPostId: postId, qstashMessageId: result.messageId, scheduledAt });
    }

    if (op === 'schedule-execute') {
      console.log('[Schedule Execute] ======= ENTRY POINT =======');
      console.log('[Schedule Execute] Request received at:', new Date().toISOString());

      const { scheduledPostId } = body;
      console.log('[Schedule Execute] scheduledPostId:', scheduledPostId);
      if (!scheduledPostId) return errorJson('Missing scheduledPostId');

      const db = await getScheduleDb();
      const docRef = db.collection('scheduledPosts').doc(scheduledPostId);
      const doc = await docRef.get();

      if (!doc.exists) return errorJson('Scheduled post not found', 404);

      const post = doc.data() as ScheduledPost;
      console.log(`[Schedule Execute] Post data:`, { userId: post.userId, platforms: post.platforms, postType: post.postType, textContentLength: post.textContent?.length });
      if (post.status !== 'scheduled') return json({ success: true, message: `Post already ${post.status}` });

      await docRef.update({ status: 'publishing' });

      const publishResults: ScheduledPost['publishResults'] = [];
      const baseUrl = getScheduleBaseUrl();
      console.log(`[Schedule Execute] Using baseUrl: ${baseUrl}`);

      for (const platform of post.platforms) {
        console.log(`[Schedule Execute] Processing platform: ${platform}`, {
          postType: post.postType,
          hasMediaUrl: !!post.mediaUrl,
          mediaUrl: post.mediaUrl ? post.mediaUrl.substring(0, 50) + '...' : 'NONE',
          textContentLength: post.textContent?.length,
          platformOverride: post.platformOverrides?.[platform] ? 'present' : 'missing'
        });
        try {
          const override = post.platformOverrides[platform] || {};
          let res: Response;
          let data: any;

          switch (platform) {
            case 'facebook': {
              console.log('[Schedule Execute] Processing platform: facebook');

              // Get Facebook tokens from user's integrations
              const fbDb = await getScheduleDb();
              const fbRef = fbDb.doc(`users/${post.userId}/integrations/facebook`);
              const fbSnap = await fbRef.get();
              const fbData = fbSnap.data();

              if (!fbData?.accessToken) {
                throw new Error('Facebook not connected for this user');
              }

              // Determine the correct operation based on post type
              let op = 'fb-publish-post';
              const fbBody: any = {
                fbUserAccessToken: fbData.accessToken, // Use token from DB
                pageId: override.pageId || fbData.selectedPageId || (fbData.pages && fbData.pages.length > 0 ? fbData.pages[0].id : undefined),
              };

              if (!fbBody.pageId) {
                throw new Error('No Facebook Page ID found. Please select a page in settings.');
              }

              if (post.postType === 'VIDEO' && post.mediaUrl) {
                op = 'fb-publish-video';
                fbBody.file_url = post.mediaUrl;
                fbBody.title = override.title || post.textContent?.substring(0, 100) || '';
                fbBody.description = override.message || post.textContent;
              } else if (post.postType === 'IMAGE' && post.mediaUrl) {
                op = 'fb-publish-photo';
                fbBody.url = post.mediaUrl;
                fbBody.caption = override.message || post.textContent;
              } else {
                fbBody.message = override.message || post.textContent;
              }

              res = await fetch(`${baseUrl}/api/social?op=${op}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fbBody),
              });
              data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Facebook post failed');
              publishResults.push({ platform, success: true, postId: data.id });
              break;
            }
            case 'instagram': {
              if (!post.mediaUrl) throw new Error('Instagram requires media');

              // Get Facebook/Instagram tokens from user's integrations (Instagram uses FB auth)
              const fbDb = await getScheduleDb();
              const fbRef = fbDb.doc(`users/${post.userId}/integrations/facebook`);
              const fbSnap = await fbRef.get();
              const fbData = fbSnap.data();

              if (!fbData?.accessToken) {
                throw new Error('Facebook/Instagram not connected for this user');
              }

              const igId = override.igId || fbData.selectedIgId || (fbData.igAccounts && fbData.igAccounts.length > 0 ? fbData.igAccounts[0].igId : undefined);

              if (!igId) {
                throw new Error('No Instagram Business Account found. Please select an account in settings.');
              }

              const igBody = {
                fbUserAccessToken: fbData.accessToken, // Use token from DB
                igId: igId,
                mediaType: post.postType === 'VIDEO' ? (override.mediaType || 'REELS') : 'FEED',
                mediaUrls: [post.mediaUrl],
                caption: override.caption || post.textContent,
                shareToFeed: override.shareToFeed ?? true,
                isVideo: post.postType === 'VIDEO', // Explicit hint for Blob URLs without extensions
              };

              res = await fetch(`${baseUrl}/api/social?op=ig-publish-robust`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(igBody),
              });
              data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Instagram post failed');
              publishResults.push({ platform, success: true, postId: data.mediaId || data.containerId });
              break;
            }
            case 'tiktok': {
              if (!post.mediaUrl) throw new Error('TikTok requires media');

              console.log(`[Schedule Execute] TikTok upload starting, postType:`, post.postType);

              // Get TikTok credentials
              const ttClientKey = (process.env.TIKTOK_CLIENT_KEY || '').trim();
              const ttClientSecret = (process.env.TIKTOK_CLIENT_SECRET || '').trim();

              if (!ttClientKey || !ttClientSecret) {
                throw new Error('TikTok API credentials not configured');
              }

              // Get fresh TikTok access token from user's integrations
              const ttDb = await getScheduleDb();
              const ttRef = ttDb.doc(`users/${post.userId}/integrations/tiktok`);
              const ttSnap = await ttRef.get();
              const ttData = ttSnap.data();

              if (!ttData?.accessToken || !ttData?.refreshToken) {
                throw new Error('TikTok not connected for this user');
              }

              let ttAccessToken = ttData.accessToken;
              const now = Date.now();
              const expiresAt = ttData.expiresAt || 0;

              console.log(`[Schedule Execute] TikTok token check: expiresAt=${expiresAt}, now=${now}, expired=${now > expiresAt}`);

              // Refresh token if expired or about to expire (within 5 minutes)
              if (now > expiresAt - 300000) {
                console.log('[Schedule Execute] TikTok token expired or expiring soon, refreshing...');

                try {
                  const refreshRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                      client_key: ttClientKey,
                      client_secret: ttClientSecret,
                      grant_type: 'refresh_token',
                      refresh_token: ttData.refreshToken,
                    }),
                  });

                  const refreshData = await refreshRes.json();
                  console.log(`[Schedule Execute] TikTok refresh response: ${refreshRes.status}`);

                  if (refreshData.access_token) {
                    ttAccessToken = refreshData.access_token;
                    // Update Firestore with new tokens
                    await ttRef.update({
                      accessToken: refreshData.access_token,
                      refreshToken: refreshData.refresh_token || ttData.refreshToken,
                      expiresAt: Date.now() + ((refreshData.expires_in || 86400) * 1000),
                      refreshExpiresAt: refreshData.refresh_expires_in
                        ? Date.now() + (refreshData.refresh_expires_in * 1000)
                        : ttData.refreshExpiresAt,
                    });
                    console.log('[Schedule Execute] TikTok tokens refreshed and saved');
                  } else if (refreshData.error) {
                    console.error('[Schedule Execute] TikTok refresh failed:', refreshData);
                    throw new Error(`TikTok token refresh failed: ${refreshData.error_description || refreshData.error}`);
                  }
                } catch (refreshErr: any) {
                  console.error('[Schedule Execute] TikTok refresh error:', refreshErr);
                  throw new Error(`Failed to refresh TikTok token: ${refreshErr.message}`);
                }
              }

              const privacyLevel = override.privacyLevel || 'PUBLIC_TO_EVERYONE';
              console.log(`[Schedule Execute] TikTok privacy level: ${privacyLevel} (from override: ${!!override.privacyLevel})`);

              // Determine if VIDEO or IMAGE (PHOTO) post
              if (post.postType === 'IMAGE') {
                // Photo post - call TikTok content/init API directly
                console.log(`[Schedule Execute] TikTok photo post to:`, post.mediaUrl.substring(0, 50));

                const photoRes = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${ttAccessToken}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                  },
                  body: JSON.stringify({
                    post_info: {
                      title: override.title || post.textContent?.substring(0, 90) || '',
                      description: override.description || post.textContent || '',
                      privacy_level: privacyLevel,
                      disable_comment: override.disableComment ?? false,
                      auto_add_music: override.autoAddMusic ?? true,
                    },
                    source_info: {
                      source: 'PULL_FROM_URL',
                      photo_cover_index: 0,
                      photo_images: [post.mediaUrl],
                    },
                    post_mode: 'DIRECT_POST',
                    media_type: 'PHOTO',
                  }),
                });

                const photoData = await photoRes.json();

                if (!photoRes.ok || (photoData?.error?.code && photoData.error.code !== 'ok')) {
                  const errMsg = photoData?.error?.message || photoData?.error?.code || `TikTok photo post failed: ${photoRes.status}`;
                  throw new Error(errMsg);
                }

                const publishId = photoData?.data?.publish_id || '';
                console.log(`[Schedule Execute] TikTok photo post initiated:`, publishId);
                publishResults.push({ platform, success: true, postId: publishId });
              } else {
                // Video post - use FILE_UPLOAD mode with single-chunk (matches working advanced tab)
                console.log(`[Schedule Execute] TikTok video post starting, downloading from:`, post.mediaUrl.substring(0, 50));

                // Step 1: Download video from blob storage
                const ttVideoRes = await fetch(post.mediaUrl);
                if (!ttVideoRes.ok) {
                  throw new Error(`Failed to download video from blob: ${ttVideoRes.status}`);
                }

                const ttVideoBuffer = await ttVideoRes.arrayBuffer();
                const ttVideoSize = ttVideoBuffer.byteLength;
                console.log(`[Schedule Execute] TikTok video downloaded, size: ${ttVideoSize} bytes`);

                // Use single-chunk upload (same as working advanced tab)
                // This is simpler and avoids chunking edge cases
                const ttChunkSize = ttVideoSize;
                const ttTotalChunks = 1;

                console.log(`[Schedule Execute] TikTok upload config: single chunk of ${ttVideoSize} bytes`);

                // Step 2: Initialize FILE_UPLOAD with TikTok
                const ttInitRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${ttAccessToken}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                  },
                  body: JSON.stringify({
                    post_info: {
                      title: override.title || post.textContent || '',
                      privacy_level: privacyLevel,
                      disable_duet: override.disableDuet ?? false,
                      disable_stitch: override.disableStitch ?? false,
                      disable_comment: override.disableComment ?? false,
                      video_cover_timestamp_ms: override.videoCoverTimestampMs ?? 1000,
                    },
                    source_info: {
                      source: 'FILE_UPLOAD',
                      video_size: ttVideoSize,
                      chunk_size: ttChunkSize,
                      total_chunk_count: ttTotalChunks,
                    },
                  }),
                });

                const ttInitData = await ttInitRes.json();
                console.log(`[Schedule Execute] TikTok init response:`, JSON.stringify(ttInitData).substring(0, 300));

                if (!ttInitRes.ok || (ttInitData?.error?.code && ttInitData.error.code !== 'ok')) {
                  const errMsg = ttInitData?.error?.message || ttInitData?.error?.code || `TikTok init failed: ${ttInitRes.status}`;
                  throw new Error(errMsg);
                }

                const ttUploadUrl = ttInitData?.data?.upload_url;
                const ttPublishId = ttInitData?.data?.publish_id || '';

                if (!ttUploadUrl) {
                  throw new Error('TikTok did not return upload_url');
                }

                console.log(`[Schedule Execute] TikTok upload URL obtained, publish_id: ${ttPublishId}`);

                // Step 3: Upload entire video in single PUT request
                console.log(`[Schedule Execute] TikTok uploading: bytes 0-${ttVideoSize - 1}/${ttVideoSize}`);

                const ttUploadRes = await fetch(ttUploadUrl, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'video/mp4',
                    'Content-Length': String(ttVideoSize),
                    'Content-Range': `bytes 0-${ttVideoSize - 1}/${ttVideoSize}`,
                  },
                  body: ttVideoBuffer,
                });

                console.log(`[Schedule Execute] TikTok upload response: ${ttUploadRes.status}`);

                if (ttUploadRes.status !== 201) {
                  const errText = await ttUploadRes.text();
                  throw new Error(`TikTok upload failed: ${ttUploadRes.status} ${errText.substring(0, 200)}`);
                }

                console.log(`[Schedule Execute] TikTok video upload complete, publish_id: ${ttPublishId}`);
                publishResults.push({ platform, success: true, postId: ttPublishId });
              }
              break;
            }
            case 'youtube': {
              if (!post.mediaUrl) throw new Error('YouTube requires video');

              console.log(`[Schedule Execute] YouTube upload starting for:`, post.mediaUrl.substring(0, 50));

              // Get fresh YouTube access token from user's integrations
              const ytClientId = (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
              const ytClientSecret = (process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();

              if (!ytClientId || !ytClientSecret) {
                throw new Error('YouTube API credentials not configured');
              }

              const ytDb = await getScheduleDb();
              const ytRef = ytDb.doc(`users/${post.userId}/integrations/youtube`);
              const ytSnap = await ytRef.get();
              const ytData = ytSnap.data();
              const ytRefreshToken = String(ytData?.refreshToken || '');

              if (!ytRefreshToken) {
                throw new Error('YouTube not connected for this user');
              }

              // Check if we have a valid access token or need to refresh
              let ytAccessToken = ytData?.accessToken;
              if (!ytAccessToken || !ytData?.accessTokenExpiresAt || Date.now() >= ytData.accessTokenExpiresAt - 60000) {
                console.log(`[Schedule Execute] Refreshing YouTube access token...`);
                const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: new URLSearchParams({
                    client_id: ytClientId,
                    client_secret: ytClientSecret,
                    refresh_token: ytRefreshToken,
                    grant_type: 'refresh_token',
                  }).toString(),
                });

                if (!tokenRes.ok) {
                  throw new Error('Failed to refresh YouTube token');
                }

                const tokenJson: any = await tokenRes.json().catch(() => ({}));
                ytAccessToken = String(tokenJson.access_token || '');
                const expiresIn = Number(tokenJson.expires_in || 0);

                if (!ytAccessToken) throw new Error('No access_token from refresh');

                await ytRef.update({
                  accessToken: ytAccessToken,
                  accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
                });
                console.log(`[Schedule Execute] YouTube token refreshed successfully`);
              }

              if (!ytAccessToken) throw new Error('YouTube access token not found');

              // Step 1: Initialize resumable upload
              const metadata = {
                snippet: {
                  title: override.title || post.textContent?.substring(0, 100) || 'Untitled Video',
                  description: override.description || post.textContent || '',
                  tags: override.tags || [],
                  categoryId: override.categoryId || '22', // 22 = People & Blogs
                },
                status: {
                  privacyStatus: override.privacyStatus || 'public',
                  selfDeclaredMadeForKids: !!override.madeForKids,
                },
              };

              const mimeType = override.mimeType || 'video/mp4';
              const notifySubscribers = override.notifySubscribers !== false;

              console.log(`[Schedule Execute] YouTube init upload with title:`, metadata.snippet.title);

              const initRes = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${notifySubscribers}`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${ytAccessToken}`,
                  'Content-Type': 'application/json',
                  'X-Upload-Content-Type': mimeType,
                },
                body: JSON.stringify(metadata),
              });

              if (!initRes.ok) {
                const errText = await initRes.text();
                throw new Error(`YouTube upload init failed: ${initRes.status} ${errText}`);
              }

              const uploadUrl = initRes.headers.get('Location');
              if (!uploadUrl) {
                throw new Error('No upload URL returned from YouTube');
              }

              console.log(`[Schedule Execute] YouTube upload URL obtained, fetching video...`);

              // Step 2: Fetch the video from blob storage
              const videoRes = await fetch(post.mediaUrl);
              if (!videoRes.ok) {
                throw new Error(`Failed to fetch video: ${videoRes.status}`);
              }

              const videoBuffer = await videoRes.arrayBuffer();
              const videoSize = videoBuffer.byteLength;
              console.log(`[Schedule Execute] Video fetched, size: ${videoSize} bytes`);

              // Step 3: Upload the video to YouTube
              const uploadRes = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                  'Content-Type': mimeType,
                  'Content-Length': String(videoSize),
                },
                body: videoBuffer,
              });

              if (!uploadRes.ok) {
                const errText = await uploadRes.text();
                throw new Error(`YouTube video upload failed: ${uploadRes.status} ${errText}`);
              }

              const uploadData = await uploadRes.json();
              console.log(`[Schedule Execute] YouTube upload complete:`, uploadData.id);

              publishResults.push({ platform, success: true, postId: uploadData.id });
              break;
            }
            case 'linkedin': {
              console.log(`[Schedule Execute] LinkedIn post starting, postType:`, post.postType, 'hasMedia:', !!post.mediaUrl);

              // Get fresh LinkedIn access token from user's integrations
              const liDb = await getScheduleDb();
              const liRef = liDb.doc(`users/${post.userId}/integrations/linkedin`);
              const liSnap = await liRef.get();
              const liData = liSnap.data();

              if (!liData?.accessToken) {
                throw new Error('LinkedIn not connected for this user');
              }

              // LinkedIn access tokens last 60 days, so refresh is less critical
              // but we check for refresh token if expired
              let liAccessToken = liData.accessToken;
              const liPersonUrn = liData.personUrn || liData.sub || liData.id;

              if (!liPersonUrn) {
                throw new Error('LinkedIn person URN not found');
              }

              const text = override.text || post.textContent || '';
              const visibility = override.visibility || 'PUBLIC';

              // Check if this is a media post (IMAGE or VIDEO)
              if (post.mediaUrl && (post.postType === 'IMAGE' || post.postType === 'VIDEO')) {
                console.log(`[Schedule Execute] LinkedIn media post - registering upload for ${post.postType}`);

                // Step 1: Register the media upload
                const mediaType = post.postType === 'VIDEO' ? 'VIDEO' : 'IMAGE';
                const recipe = post.postType === 'VIDEO' ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image';

                const registerRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${liAccessToken}`,
                    'Content-Type': 'application/json',
                    'X-Restli-Protocol-Version': '2.0.0',
                  },
                  body: JSON.stringify({
                    registerUploadRequest: {
                      recipes: [recipe],
                      owner: `urn:li:person:${liPersonUrn}`,
                      serviceRelationships: [{
                        relationshipType: 'OWNER',
                        identifier: 'urn:li:userGeneratedContent',
                      }],
                    },
                  }),
                });

                if (!registerRes.ok) {
                  const errText = await registerRes.text();
                  throw new Error(`LinkedIn register upload failed: ${registerRes.status} ${errText}`);
                }

                const registerData = await registerRes.json();
                const uploadUrl = registerData?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
                const asset = registerData?.value?.asset;

                if (!uploadUrl || !asset) {
                  throw new Error('LinkedIn did not return upload URL or asset');
                }

                console.log(`[Schedule Execute] LinkedIn upload registered, asset:`, asset);

                // Step 2: Fetch the media from blob storage and upload to LinkedIn
                const mediaRes = await fetch(post.mediaUrl);
                if (!mediaRes.ok) {
                  throw new Error(`Failed to fetch media: ${mediaRes.status}`);
                }

                const mediaBuffer = await mediaRes.arrayBuffer();
                const contentType = mediaRes.headers.get('content-type') || (post.postType === 'VIDEO' ? 'video/mp4' : 'image/jpeg');

                console.log(`[Schedule Execute] LinkedIn uploading media, size: ${mediaBuffer.byteLength} bytes`);

                const uploadRes = await fetch(uploadUrl, {
                  method: 'PUT',
                  headers: {
                    'Authorization': `Bearer ${liAccessToken}`,
                    'Content-Type': contentType,
                    'X-Restli-Protocol-Version': '2.0.0',
                  },
                  body: mediaBuffer,
                });

                if (!uploadRes.ok) {
                  const errText = await uploadRes.text();
                  throw new Error(`LinkedIn media upload failed: ${uploadRes.status} ${errText}`);
                }

                console.log(`[Schedule Execute] LinkedIn media uploaded successfully`);

                // Step 3: Create the media post
                const ugcPost = {
                  author: `urn:li:person:${liPersonUrn}`,
                  lifecycleState: 'PUBLISHED',
                  specificContent: {
                    'com.linkedin.ugc.ShareContent': {
                      shareCommentary: { text },
                      shareMediaCategory: mediaType,
                      media: [{
                        status: 'READY',
                        media: asset,
                        title: override.mediaTitle ? { text: override.mediaTitle } : undefined,
                        description: override.mediaDescription ? { text: override.mediaDescription } : undefined,
                      }],
                    },
                  },
                  visibility: {
                    'com.linkedin.ugc.MemberNetworkVisibility': visibility,
                  },
                };

                const postRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${liAccessToken}`,
                    'Content-Type': 'application/json',
                    'X-Restli-Protocol-Version': '2.0.0',
                  },
                  body: JSON.stringify(ugcPost),
                });

                if (!postRes.ok) {
                  const errText = await postRes.text();
                  throw new Error(`LinkedIn post creation failed: ${postRes.status} ${errText}`);
                }

                const postId = postRes.headers.get('X-RestLi-Id') || '';
                console.log(`[Schedule Execute] LinkedIn media post created:`, postId);
                publishResults.push({ platform, success: true, postId });
              } else {
                // Text-only post
                console.log(`[Schedule Execute] LinkedIn text-only post`);

                const ugcPost = {
                  author: `urn:li:person:${liPersonUrn}`,
                  lifecycleState: 'PUBLISHED',
                  specificContent: {
                    'com.linkedin.ugc.ShareContent': {
                      shareCommentary: { text },
                      shareMediaCategory: 'NONE',
                    },
                  },
                  visibility: {
                    'com.linkedin.ugc.MemberNetworkVisibility': visibility,
                  },
                };

                const postRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${liAccessToken}`,
                    'Content-Type': 'application/json',
                    'X-Restli-Protocol-Version': '2.0.0',
                  },
                  body: JSON.stringify(ugcPost),
                });

                if (!postRes.ok) {
                  const errText = await postRes.text();
                  throw new Error(`LinkedIn post creation failed: ${postRes.status} ${errText}`);
                }

                const postId = postRes.headers.get('X-RestLi-Id') || '';
                console.log(`[Schedule Execute] LinkedIn text post created:`, postId);
                publishResults.push({ platform, success: true, postId });
              }
              break;
            }
            case 'x':
            case 'twitter': {
              console.log(`[Schedule Execute] X: Inline posting starting`);

              // Get X credentials
              const xClientId = (process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID || '').trim();
              const xClientSecret = (process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET || '').trim();

              if (!xClientId || !xClientSecret) {
                throw new Error('X API credentials not configured');
              }

              // Get X tokens from Firestore
              const xDb = await getScheduleDb();
              const xRef = xDb.doc(`users/${post.userId}/integrations/x`);
              const xSnap = await xRef.get();
              const xData = xSnap.data();

              console.log(`[Schedule Execute] X token data:`, xData ? {
                hasAccessToken: !!xData.accessToken,
                hasRefreshToken: !!xData.refreshToken,
                expiresAt: xData.expiresAt,
                now: Date.now(),
              } : 'null');

              if (!xData?.accessToken || !xData?.refreshToken) {
                throw new Error('X not connected for this user. Please reconnect X in the Social tab.');
              }

              let xAccessToken = xData.accessToken;
              const xNow = Date.now();
              const xExpiresAt = xData.expiresAt || 0;

              // Refresh token if expired or about to expire (within 5 minutes)
              if (xNow > xExpiresAt - 300000) {
                console.log('[Schedule Execute] X token expired or expiring soon, refreshing...');

                try {
                  // Use twitter-api-v2's OAuth2 refresh
                  const refreshRes = await fetch('https://api.x.com/2/oauth2/token', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/x-www-form-urlencoded',
                      'Authorization': `Basic ${Buffer.from(`${xClientId}:${xClientSecret}`).toString('base64')}`,
                    },
                    body: new URLSearchParams({
                      grant_type: 'refresh_token',
                      refresh_token: xData.refreshToken,
                      client_id: xClientId,
                    }),
                  });

                  const refreshData = await refreshRes.json();
                  console.log(`[Schedule Execute] X refresh response: ${refreshRes.status}`);

                  if (refreshData.access_token) {
                    xAccessToken = refreshData.access_token;
                    // Update Firestore with new tokens
                    await xRef.update({
                      accessToken: refreshData.access_token,
                      refreshToken: refreshData.refresh_token || xData.refreshToken,
                      expiresAt: Date.now() + ((refreshData.expires_in || 7200) * 1000),
                      updatedAt: Date.now(),
                    });
                    console.log('[Schedule Execute] X tokens refreshed and saved');
                  } else if (refreshData.error) {
                    console.error('[Schedule Execute] X refresh failed:', refreshData);
                    throw new Error(`X token refresh failed: ${refreshData.error_description || refreshData.error}. Please reconnect X.`);
                  }
                } catch (refreshErr: any) {
                  console.error('[Schedule Execute] X refresh error:', refreshErr);
                  throw new Error(`Failed to refresh X token: ${refreshErr.message}. Please reconnect X.`);
                }
              }

              const xText = override.text || post.textContent || '';
              let xMediaId = '';

              // Upload media if present
              if (post.mediaUrl) {
                console.log('[Schedule Execute] X: Uploading media from:', post.mediaUrl.substring(0, 50));

                // Download media
                const mediaRes = await fetch(post.mediaUrl);
                if (!mediaRes.ok) throw new Error(`Failed to download media: ${mediaRes.status}`);
                const mediaBuffer = await mediaRes.arrayBuffer();
                const contentType = mediaRes.headers.get('content-type') || 'application/octet-stream';
                const isVideo = contentType.startsWith('video/') || !!post.mediaUrl.toLowerCase().match(/\.(mp4|mov|avi|webm)(\?|$)/);
                const mediaCategory = isVideo ? 'tweet_video' : 'tweet_image';

                console.log('[Schedule Execute] X: Media downloaded, size:', mediaBuffer.byteLength, 'category:', mediaCategory);

                // INIT
                console.log('[Schedule Execute] X: Starting INIT request...');
                const initRes = await fetch('https://api.x.com/2/media/upload/initialize', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${xAccessToken}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ media_type: contentType, media_category: mediaCategory, total_bytes: mediaBuffer.byteLength }),
                });
                const initText = await initRes.text();
                console.log('[Schedule Execute] X INIT response:', initRes.status, initText.substring(0, 500));
                if (!initRes.ok) throw new Error(`X INIT failed: ${initRes.status} - ${initText}`);
                const initData = JSON.parse(initText);
                xMediaId = initData.data?.id || initData.data?.id_str || initData.data?.media_id_string || initData.id || initData.id_str || initData.media_id_string;
                console.log('[Schedule Execute] X: Got media ID:', xMediaId);

                if (!xMediaId) {
                  console.error('[Schedule Execute] X: No media ID in INIT response:', initText);
                  throw new Error('X INIT returned no media ID');
                }

                // APPEND (chunk by chunk) - Use FormData like working x.ts
                const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
                const totalChunks = Math.ceil(mediaBuffer.byteLength / CHUNK_SIZE);
                console.log(`[Schedule Execute] X: Uploading ${totalChunks} chunks...`);

                for (let i = 0; i < totalChunks; i++) {
                  const start = i * CHUNK_SIZE;
                  const end = Math.min(start + CHUNK_SIZE, mediaBuffer.byteLength);
                  const chunk = mediaBuffer.slice(start, end);

                  // Use FormData with segment_index like working x.ts implementation
                  const formData = new FormData();
                  // IMPORTANT: Filename 'blob' is required for X API multipart/form-data
                  formData.append('media', new Blob([chunk]), 'blob');
                  formData.append('segment_index', String(i));

                  console.log(`[Schedule Execute] X: APPEND chunk ${i + 1}/${totalChunks}, size: ${chunk.byteLength}`);
                  const appendRes = await fetch(`https://api.x.com/2/media/upload/${xMediaId}/append`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${xAccessToken}` },
                    body: formData,
                  });

                  if (!appendRes.ok) {
                    const appendErr = await appendRes.text();
                    console.error(`[Schedule Execute] X APPEND chunk ${i} failed:`, appendRes.status, appendErr);
                    throw new Error(`X APPEND chunk ${i} failed: ${appendRes.status} - ${appendErr}`);
                  }
                  console.log(`[Schedule Execute] X: APPEND chunk ${i + 1}/${totalChunks} completed`);
                }

                // FINALIZE
                console.log('[Schedule Execute] X: Starting FINALIZE...');
                const finalizeRes = await fetch(`https://api.x.com/2/media/upload/${xMediaId}/finalize`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${xAccessToken}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({}),
                });
                const finalizeText = await finalizeRes.text();
                console.log('[Schedule Execute] X FINALIZE response:', finalizeRes.status, finalizeText.substring(0, 500));
                if (!finalizeRes.ok) throw new Error(`X FINALIZE failed: ${finalizeRes.status} - ${finalizeText}`);
                const finalizeData = JSON.parse(finalizeText);

                // Wait for video processing
                if (isVideo && (finalizeData.processing_info || finalizeData.data?.processing_info)) {
                  const procInfo = finalizeData.processing_info || finalizeData.data?.processing_info;
                  let state = procInfo.state;
                  let checkAfterSecs = procInfo.check_after_secs || 1;
                  let attempts = 0;
                  const maxAttempts = 30;

                  console.log('[Schedule Execute] X: Video processing started, state:', state);

                  while (state !== 'succeeded' && state !== 'failed' && attempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, checkAfterSecs * 1000));
                    attempts++;

                    console.log(`[Schedule Execute] X: Checking status attempt ${attempts}/${maxAttempts}...`);
                    const statusRes = await fetch(`https://api.x.com/2/media/upload?media_id=${xMediaId}&command=STATUS`, {
                      headers: { 'Authorization': `Bearer ${xAccessToken}` },
                    });
                    if (statusRes.ok) {
                      const statusData = await statusRes.json();
                      const statusInfo = statusData.processing_info || statusData.data?.processing_info;
                      state = statusInfo?.state || 'succeeded';
                      checkAfterSecs = statusInfo?.check_after_secs || 2;
                      console.log('[Schedule Execute] X: Video processing state:', state);
                    } else {
                      console.error('[Schedule Execute] X: Status check failed:', statusRes.status);
                      break;
                    }
                  }

                  if (state === 'failed') throw new Error('X video processing failed');
                }

                console.log('[Schedule Execute] X: Media upload complete, id:', xMediaId);
              }

              // Post tweet
              const tweetPayload: any = { text: xText };
              if (xMediaId) {
                tweetPayload.media = { media_ids: [xMediaId] };
              }

              const tweetRes = await fetch('https://api.x.com/2/tweets', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${xAccessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(tweetPayload),
              });

              const tweetData = await tweetRes.json();
              console.log(`[Schedule Execute] X tweet response: ${tweetRes.status}`, tweetData);

              if (!tweetRes.ok) {
                throw new Error(tweetData.detail || tweetData.title || 'X post failed');
              }

              publishResults.push({ platform, success: true, postId: tweetData.data?.id });
              break;
            }
            default:
              publishResults.push({ platform, success: false, error: `Unsupported platform: ${platform}` });
          }
        } catch (error: any) {
          publishResults.push({ platform, success: false, error: error.message });
        }
      }

      const allSuccess = publishResults.every(r => r.success);
      const allFailed = publishResults.every(r => !r.success);
      const finalStatus = allSuccess ? 'published' : allFailed ? 'failed' : 'published';

      await docRef.update({ status: finalStatus, publishResults, publishedAt: Math.floor(Date.now() / 1000) });

      return json({ success: true, status: finalStatus, publishResults });
    }

    if (op === 'schedule-cancel') {
      const { scheduledPostId } = body;
      if (!scheduledPostId) return errorJson('Missing scheduledPostId');

      const db = await getScheduleDb();
      const qstash = getQStashClient();
      const docRef = db.collection('scheduledPosts').doc(scheduledPostId);
      const doc = await docRef.get();

      if (!doc.exists) return errorJson('Scheduled post not found', 404);

      const post = doc.data() as ScheduledPost;
      if (post.status !== 'scheduled') return errorJson(`Cannot cancel post with status: ${post.status}`);

      if (post.qstashMessageId) {
        try { await qstash.messages.delete(post.qstashMessageId); } catch (e) { /* already processed */ }
      }

      await docRef.update({ status: 'cancelled', cancelledAt: Math.floor(Date.now() / 1000) });

      return json({ success: true, message: 'Scheduled post cancelled' });
    }

    if (op === 'schedule-list') {
      console.log('[Schedule List] ======= ENTRY POINT =======');
      const { projectId, userId, status } = body;
      console.log('[Schedule List] Query params:', { projectId, userId, status });

      if (!projectId && !userId) return errorJson('Missing projectId or userId');

      const db = await getScheduleDb();
      let query = db.collection('scheduledPosts') as any;

      if (projectId) query = query.where('projectId', '==', projectId);
      if (userId) query = query.where('userId', '==', userId);
      if (status) query = query.where('status', '==', status);
      query = query.orderBy('scheduledAt', 'asc');

      const snapshot = await query.get();
      const posts: ScheduledPost[] = [];
      snapshot.forEach((doc: any) => { posts.push({ id: doc.id, ...doc.data() }); });

      console.log('[Schedule List] Found', posts.length, 'posts for projectId:', projectId);
      if (posts.length > 0) {
        console.log('[Schedule List] First post:', JSON.stringify(posts[0]).substring(0, 200));
      }

      return json({ success: true, posts });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UploadPost API Operations
    // ═══════════════════════════════════════════════════════════════════════════

    // Create user profile
    if (op === 'uploadpost-create-user') {
      const username = String(body?.username || '').trim();
      if (!username) return errorJson('Missing username', 400);
      const result = await createUploadPostUser(username);
      return json(result);
    }

    // Get all user profiles
    if (op === 'uploadpost-get-users') {
      const result = await getUploadPostUsers();
      return json(result);
    }

    // Get single user profile
    if (op === 'uploadpost-get-user') {
      const username = url.searchParams.get('username') || String(body?.username || '').trim();
      if (!username) return errorJson('Missing username', 400);
      const result = await getUploadPostUser(username);
      return json(result);
    }

    // Generate JWT URL
    if (op === 'uploadpost-generate-jwt') {
      const username = String(body?.username || '').trim();
      if (!username) return errorJson('Missing username', 400);
      const result = await generateUploadPostJwt({
        username,
        redirect_url: body?.redirect_url,
        logo_image: body?.logo_image,
        redirect_button_text: body?.redirect_button_text,
        connect_title: body?.connect_title,
        connect_description: body?.connect_description,
        platforms: body?.platforms,
        show_calendar: body?.show_calendar,
      });
      return json(result);
    }

    // Upload video
    if (op === 'uploadpost-upload-video') {
      const user = String(body?.user || '').trim();
      const platforms = Array.isArray(body?.platforms) ? body.platforms : [];
      const videoUrl = String(body?.videoUrl || '').trim();
      const title = String(body?.title || '').trim();

      if (!user) return errorJson('Missing user', 400);
      if (!platforms.length) return errorJson('Missing platforms', 400);
      if (!videoUrl) return errorJson('Missing videoUrl', 400);
      if (!title) return errorJson('Missing title', 400);

      const result = await uploadPostUploadVideo({
        user,
        platforms,
        videoUrl,
        title,
        description: body?.description,
        scheduled_date: body?.scheduled_date,
        timezone: body?.timezone,
        async_upload: body?.async_upload ?? true,
        first_comment: body?.first_comment,
        privacy_level: body?.privacy_level,
        facebook_page_id: body?.facebook_page_id,
        facebook_media_type: body?.facebook_media_type,
        media_type: body?.media_type,
      });
      return json(result);
    }

    // Upload photos
    if (op === 'uploadpost-upload-photos') {
      const user = String(body?.user || '').trim();
      const platforms = Array.isArray(body?.platforms) ? body.platforms : [];
      const photoUrls = Array.isArray(body?.photoUrls) ? body.photoUrls : [];
      const title = String(body?.title || '').trim();

      if (!user) return errorJson('Missing user', 400);
      if (!platforms.length) return errorJson('Missing platforms', 400);
      if (!photoUrls.length) return errorJson('Missing photoUrls', 400);
      if (!title) return errorJson('Missing title', 400);

      const result = await uploadPostUploadPhotos({
        user,
        platforms,
        photoUrls,
        title,
        description: body?.description,
        scheduled_date: body?.scheduled_date,
        timezone: body?.timezone,
        async_upload: body?.async_upload ?? true,
        first_comment: body?.first_comment,
        facebook_page_id: body?.facebook_page_id,
        facebook_media_type: body?.facebook_media_type,
        media_type: body?.media_type,
        privacy_level: body?.privacy_level,
        auto_add_music: body?.auto_add_music,
      });
      return json(result);
    }

    // Upload text
    if (op === 'uploadpost-upload-text') {
      const user = String(body?.user || '').trim();
      const platforms = Array.isArray(body?.platforms) ? body.platforms : [];
      const title = String(body?.title || '').trim();

      if (!user) return errorJson('Missing user', 400);
      if (!platforms.length) return errorJson('Missing platforms', 400);
      if (!title) return errorJson('Missing title', 400);

      const result = await uploadPostUploadText({
        user,
        platforms,
        title,
        description: body?.description,
        scheduled_date: body?.scheduled_date,
        timezone: body?.timezone,
        async_upload: body?.async_upload ?? true,
        first_comment: body?.first_comment,
        facebook_page_id: body?.facebook_page_id,
        x_long_text_as_post: body?.x_long_text_as_post,
      });
      return json(result);
    }

    // Get upload status
    if (op === 'uploadpost-status') {
      const requestId = url.searchParams.get('request_id') || String(body?.request_id || '').trim();
      if (!requestId) return errorJson('Missing request_id', 400);
      const result = await uploadPostGetStatus(requestId);
      return json(result);
    }

    // Get upload history
    if (op === 'uploadpost-history') {
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const result = await uploadPostGetHistory(page, limit);
      return json(result);
    }

    // Get Facebook pages
    if (op === 'uploadpost-facebook-pages') {
      const profile = url.searchParams.get('profile') || undefined;
      const result = await uploadPostGetFacebookPages(profile);
      return json(result);
    }

    // Delete user profile
    if (op === 'uploadpost-delete-user') {
      const username = String(body?.username || '').trim();
      if (!username) return errorJson('Missing username', 400);
      const result = await uploadPostDeleteUser(username);
      return json(result);
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // LinkedIn API Operations
    // ═══════════════════════════════════════════════════════════════════════════

    const getLinkedInConfig = () => {
      const clientId = (process.env.LINKEDIN_CLIENT_ID || '').trim();
      const clientSecret = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
      const redirectUri = (process.env.LINKEDIN_REDIRECT_URI || 'https://freshfront.co/linkedin/callback').trim();

      if (!clientId || !clientSecret) {
        throw new Error('LinkedIn credentials not configured. Please set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET environment variables.');
      }

      return { clientId, clientSecret, redirectUri };
    };

    const linkedinFetch = async <T>(
      url: string,
      options: {
        method?: string;
        accessToken?: string;
        body?: any;
        formData?: Record<string, string>;
        headers?: Record<string, string>;
      }
    ): Promise<T> => {
      const method = options.method || 'GET';
      const headers: Record<string, string> = {
        'X-Restli-Protocol-Version': '2.0.0',
        ...options.headers,
      };

      let bodyContent: any;

      if (options.formData) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        bodyContent = new URLSearchParams(options.formData).toString();
      } else if (options.body) {
        if (options.body instanceof ArrayBuffer || Buffer.isBuffer(options.body)) {
          bodyContent = options.body;
        } else {
          headers['Content-Type'] = 'application/json';
          bodyContent = JSON.stringify(options.body);
        }
      }

      if (options.accessToken) {
        headers['Authorization'] = `Bearer ${options.accessToken}`;
      }

      const res = await fetch(url, { method, headers, body: bodyContent });

      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        if (!res.ok) {
          throw new Error(`LinkedIn API error (${res.status}): ${text.substring(0, 300)}`);
        }
        return {} as T;
      }

      if (!res.ok) {
        const errorMsg = data?.message || data?.error_description || data?.error || `LinkedIn API request failed (${res.status})`;
        throw new Error(errorMsg);
      }

      return data as T;
    };

    const getStoredLinkedInTokens = async (uid: string) => {
      const db = await getScheduleDb();
      const ref = db.doc(`users/${uid}/integrations/linkedin`);
      const snap = await ref.get();
      return snap.exists ? snap.data() : null;
    };

    const saveLinkedInTokens = async (uid: string, data: Record<string, any>) => {
      const db = await getScheduleDb();
      const ref = db.doc(`users/${uid}/integrations/linkedin`);
      await ref.set({ ...data, updatedAt: Date.now() }, { merge: true });
    };

    const getValidLinkedInAccessToken = async (uid: string): Promise<{ accessToken: string; personUrn: string }> => {
      const tokens = await getStoredLinkedInTokens(uid);
      if (!tokens?.refreshToken) {
        throw new Error('LinkedIn not connected');
      }

      if (tokens.accessToken && tokens.accessTokenExpiresAt && Date.now() < tokens.accessTokenExpiresAt - 60000) {
        return { accessToken: tokens.accessToken, personUrn: tokens.personUrn };
      }

      const { clientId, clientSecret } = getLinkedInConfig();

      const refreshData = await linkedinFetch<any>('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        formData: {
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        },
      });

      const newAccessToken = refreshData.access_token;
      const expiresIn = refreshData.expires_in || 3600;

      await saveLinkedInTokens(uid, {
        accessToken: newAccessToken,
        accessTokenExpiresAt: Date.now() + expiresIn * 1000,
        refreshToken: refreshData.refresh_token || tokens.refreshToken,
        refreshTokenExpiresAt: refreshData.refresh_token_expires_in
          ? Date.now() + refreshData.refresh_token_expires_in * 1000
          : tokens.refreshTokenExpiresAt,
      });

      return { accessToken: newAccessToken, personUrn: tokens.personUrn };
    };

    if (op === 'linkedin-auth-url') {
      const { clientId, redirectUri } = getLinkedInConfig();
      const returnTo = url.searchParams.get('returnTo') || '/';
      const state = Buffer.from(JSON.stringify({ returnTo })).toString('base64url');

      const oauthUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
      oauthUrl.searchParams.set('response_type', 'code');
      oauthUrl.searchParams.set('client_id', clientId);
      oauthUrl.searchParams.set('redirect_uri', redirectUri);
      oauthUrl.searchParams.set('state', state);
      oauthUrl.searchParams.set('scope', 'openid profile email w_member_social');

      return json({ url: oauthUrl.toString() });
    }

    if (op === 'linkedin-exchange') {
      const code = (body.code || '').trim();
      if (!code) return errorJson('Missing code', 400);

      const { clientId, clientSecret, redirectUri } = getLinkedInConfig();

      // Exchange code for tokens
      const tokenData = await linkedinFetch<any>('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        formData: {
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        },
      });

      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token || '';
      const expiresIn = tokenData.expires_in || 3600;
      const refreshExpiresIn = tokenData.refresh_token_expires_in || 31536000;
      const scope = tokenData.scope || '';

      if (!accessToken) {
        return errorJson('Token exchange returned no access_token', 500);
      }

      const userInfo = await linkedinFetch<any>('https://api.linkedin.com/v2/userinfo', {
        accessToken,
      });

      const personUrn = userInfo.sub;
      const profileName = userInfo.name || `${userInfo.given_name} ${userInfo.family_name}`.trim();
      const profilePicture = userInfo.picture || '';

      await saveTokens(uid!, {
        provider: 'linkedin',
        accessToken,
        refreshToken,
        accessTokenExpiresAt: Date.now() + expiresIn * 1000,
        refreshTokenExpiresAt: Date.now() + refreshExpiresIn * 1000,
        scope,
        personUrn,
        profileName,
        profilePicture,
      });

      return json({ connected: true, profile: { personUrn, name: profileName, picture: profilePicture } });
    }

    if (op === 'linkedin-status') {
      try {
        const tokens = await getStoredTokens(uid!);
        if (!tokens?.refreshToken) {
          return json({ connected: false });
        }

        return json({
          connected: true,
          profile: {
            personUrn: tokens.personUrn,
            name: tokens.profileName,
            picture: tokens.profilePicture,
          },
        });
      } catch (e: any) {
        if (e.message === 'LinkedIn not connected') {
          return json({ connected: false });
        }
        throw e;
      }
    }

    if (op === 'linkedin-post-text') {
      const text = (body.text || '').trim();
      if (!text) return errorJson('Missing text', 400);

      const { accessToken, personUrn } = await getValidAccessToken(uid!);

      const ugcPost = {
        author: `urn:li:person:${personUrn}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': body.visibility || 'PUBLIC',
        },
      };

      const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(ugcPost),
      });

      if (!res.ok) {
        const errText = await res.text();
        return errorJson(`Failed to create post: ${res.status} ${errText}`, res.status);
      }

      const postId = res.headers.get('X-RestLi-Id') || '';
      return json({ success: true, postId });
    }

    if (op === 'linkedin-post-article') {
      const articleUrl = (body.articleUrl || '').trim();
      if (!articleUrl) return errorJson('Missing articleUrl', 400);

      const { accessToken, personUrn } = await getValidAccessToken(uid!);

      const media: any = {
        status: 'READY',
        originalUrl: articleUrl,
      };

      if (body.articleTitle) {
        media.title = { text: body.articleTitle };
      }
      if (body.articleDescription) {
        media.description = { text: body.articleDescription };
      }

      const ugcPost = {
        author: `urn:li:person:${personUrn}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: body.text || '' },
            shareMediaCategory: 'ARTICLE',
            media: [media],
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': body.visibility || 'PUBLIC',
        },
      };

      const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(ugcPost),
      });

      if (!res.ok) {
        const errText = await res.text();
        return errorJson(`Failed to create post: ${res.status} ${errText}`, res.status);
      }

      const postId = res.headers.get('X-RestLi-Id') || '';
      return json({ success: true, postId });
    }

    if (op === 'linkedin-register-upload') {
      const mediaType = body.mediaType || 'IMAGE';
      const { accessToken, personUrn } = await getValidAccessToken(uid!);

      const recipe = mediaType === 'VIDEO' ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image';

      const registerData = {
        registerUploadRequest: {
          recipes: [recipe],
          owner: `urn:li:person:${personUrn}`,
          serviceRelationships: [
            {
              relationshipType: 'OWNER',
              identifier: 'urn:li:userGeneratedContent',
            },
          ],
        },
      };

      const res = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(registerData),
      });

      if (!res.ok) {
        const errText = await res.text();
        return errorJson(`Failed to register upload: ${res.status} ${errText}`, res.status);
      }

      const data = await res.json();
      const uploadUrl = data?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
      const asset = data?.value?.asset;

      if (!uploadUrl || !asset) {
        return errorJson('Failed to get upload URL from LinkedIn', 500);
      }

      return json({ uploadUrl, asset });
    }

    if (op === 'linkedin-upload-media') {
      const uploadUrl = url.searchParams.get('uploadUrl');
      if (!uploadUrl) return errorJson('Missing uploadUrl parameter', 400);

      const { accessToken } = await getValidAccessToken(uid!);

      const bodyBuffer = await request.arrayBuffer();
      if (!bodyBuffer || bodyBuffer.byteLength === 0) {
        return errorJson('Missing file body', 400);
      }

      const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': contentType,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: bodyBuffer,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        return errorJson(`Failed to upload media to LinkedIn: ${uploadRes.status} ${errText}`, uploadRes.status);
      }

      return json({ success: true });
    }

    if (op === 'linkedin-post-media') {
      const asset = (body.asset || '').trim();
      if (!asset) return errorJson('Missing asset URN', 400);

      const { accessToken, personUrn } = await getValidAccessToken(uid!);

      const mediaCategory = body.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE';

      const media: any = {
        status: 'READY',
        media: asset,
      };

      if (body.mediaTitle) {
        media.title = { text: body.mediaTitle };
      }
      if (body.mediaDescription) {
        media.description = { text: body.mediaDescription };
      }

      const ugcPost = {
        author: `urn:li:person:${personUrn}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: body.text || '' },
            shareMediaCategory: mediaCategory,
            media: [media],
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': body.visibility || 'PUBLIC',
        },
      };

      const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(ugcPost),
      });

      if (!res.ok) {
        const errText = await res.text();
        return errorJson(`Failed to create post: ${res.status} ${errText}`, res.status);
      }

      const postId = res.headers.get('X-RestLi-Id') || '';
      return json({ success: true, postId });
    }

    if (op === 'linkedin-disconnect') {
      const db = await getScheduleDb();
      await db.doc(`users/${uid}/integrations/linkedin`).delete();
      return json({ success: true });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TikTok API Operations
    // ═══════════════════════════════════════════════════════════════════════════

    // Generate OAuth URL
    if (op === 'tiktok-auth-url') {
      const state = String(body?.state || Math.random().toString(36).substring(2, 15));
      const authUrl = generateTikTokAuthUrl(state);
      return json({ authUrl, state });
    }

    // Exchange code for tokens
    if (op === 'tiktok-exchange') {
      const code = String(body?.code || '').trim();
      if (!code) return errorJson('Missing code', 400);
      const tokens = await exchangeTikTokCodeForToken(code);
      return json(tokens);
    }

    // Refresh access token
    if (op === 'tiktok-refresh') {
      const refreshToken = String(body?.refreshToken || '').trim();
      if (!refreshToken) return errorJson('Missing refreshToken', 400);
      const tokens = await refreshTikTokAccessToken(refreshToken);
      return json(tokens);
    }

    // Revoke access
    if (op === 'tiktok-revoke') {
      const accessToken = String(body?.accessToken || '').trim();
      if (!accessToken) return errorJson('Missing accessToken', 400);
      await revokeTikTokAccess(accessToken);
      return json({ success: true });
    }

    // Query creator info
    if (op === 'tiktok-creator-info') {
      const accessToken = String(body?.accessToken || '').trim();
      if (!accessToken) return errorJson('Missing accessToken', 400);
      const creatorInfo = await queryTikTokCreatorInfo(accessToken);
      return json(creatorInfo);
    }

    // Post video
    if (op === 'tiktok-post-video') {
      const accessToken = String(body?.accessToken || '').trim();
      const videoUrl = String(body?.videoUrl || '').trim();

      if (!accessToken) return errorJson('Missing accessToken', 400);
      if (!videoUrl) return errorJson('Missing videoUrl', 400);

      const result = await postTikTokVideoInit({
        accessToken,
        source: 'PULL_FROM_URL',
        videoUrl,
        title: body?.title,
        privacyLevel: String(body?.privacyLevel || 'PUBLIC_TO_EVERYONE'),
        disableDuet: body?.disableDuet,
        disableStitch: body?.disableStitch,
        disableComment: body?.disableComment,
        videoCoverTimestampMs: body?.videoCoverTimestampMs,
      });
      return json(result);
    }

    // Post video init (for FILE_UPLOAD to inbox - user reviews)
    if (op === 'tiktok-post-video-init-inbox') {
      const accessToken = String(body?.accessToken || '').trim();
      if (!accessToken) return errorJson('Missing accessToken', 400);

      const result = await postTikTokVideoInit({
        accessToken,
        inbox: true,
        videoSize: body?.videoSize,
        chunkSize: body?.chunkSize,
        totalChunkCount: body?.totalChunkCount,
        privacyLevel: 'PUBLIC_TO_EVERYONE' // Not used in inbox mode
      });
      return json(result);
    }

    // Post video init (for FILE_UPLOAD direct post with metadata)
    if (op === 'tiktok-post-video-init') {
      let accessToken = String(body?.accessToken || '').trim();

      // If accessToken not provided, fetch from Firestore
      if (!accessToken) {
        const storedData = await getStoredTikTokData(uid!);
        accessToken = storedData?.accessToken || '';
        if (!accessToken) {
          return errorJson('TikTok not connected for this user', 401);
        }
      }

      const result = await postTikTokVideoInit({
        accessToken,
        title: body?.title,
        privacyLevel: String(body?.privacyLevel || 'PUBLIC_TO_EVERYONE'),
        disableDuet: body?.disableDuet,
        disableStitch: body?.disableStitch,
        disableComment: body?.disableComment,
        videoCoverTimestampMs: body?.videoCoverTimestampMs,
        videoSize: body?.videoSize,
        chunkSize: body?.chunkSize,
        totalChunkCount: body?.totalChunkCount,
      });
      return json(result);
    }

    // Post photos
    if (op === 'tiktok-post-photo') {
      let accessToken = String(body?.accessToken || '').trim();
      const photoUrls = Array.isArray(body?.photoUrls) ? body.photoUrls : [];

      if (!accessToken) {
        const storedData = await getStoredTikTokData(uid!);
        accessToken = storedData?.accessToken || '';
        if (!accessToken) {
          return errorJson('TikTok not connected for this user', 401);
        }
      }

      if (!photoUrls.length) return errorJson('Missing photoUrls', 400);

      const result = await postTikTokPhotosInit({
        accessToken,
        photoUrls,
        source: 'PULL_FROM_URL',
        photoCount: photoUrls.length,
        title: body?.title,
        description: body?.description,
        privacyLevel: String(body?.privacyLevel || 'PUBLIC_TO_EVERYONE'),
        disableComment: body?.disableComment,
        autoAddMusic: body?.autoAddMusic,
        photoCoverIndex: body?.photoCoverIndex,
      });
      return json(result);
    }

    // Post photo init (for FILE_UPLOAD)
    if (op === 'tiktok-post-photo-init') {
      let accessToken = String(body?.accessToken || '').trim();

      if (!accessToken) {
        const storedData = await getStoredTikTokData(uid!);
        accessToken = storedData?.accessToken || '';
        if (!accessToken) {
          return errorJson('TikTok not connected for this user', 401);
        }
      }

      const result = await postTikTokPhotosInit({
        accessToken,
        photoCount: body?.photoCount || 1,
        title: body?.title,
        description: body?.description,
        privacyLevel: String(body?.privacyLevel || 'PUBLIC_TO_EVERYONE'),
        disableComment: body?.disableComment,
        autoAddMusic: body?.autoAddMusic,
        photoCoverIndex: body?.photoCoverIndex,
        inbox: body?.inbox
      });
      return json(result);
    }

    // Get post status
    if (op === 'tiktok-post-status') {
      const accessToken = String(body?.accessToken || '').trim();
      const publishId = String(body?.publishId || '').trim();

      if (!accessToken) return errorJson('Missing accessToken', 400);
      if (!publishId) return errorJson('Missing publishId', 400);

      const status = await getTikTokPostStatus(accessToken, publishId);
      return json(status);
    }

    // Retrieve stored TikTok tokens for the current user
    if (op === 'tiktok-tokens-get') {
      const db = await getScheduleDb();
      const snap = await db.doc(`users/${uid}/integrations/tiktok`).get();
      if (!snap.exists) return json({ accessToken: null, refreshToken: null });
      const data = snap.data() || {};
      return json({
        accessToken: data.accessToken || null,
        refreshToken: data.refreshToken || null,
        openId: data.openId || null,
      });
    }

    // Retrieve stored Facebook access token for the current user
    if (op === 'fb-tokens-get') {
      const db = await getScheduleDb();
      const snap = await db.doc(`users/${uid}/integrations/facebook`).get();
      if (!snap.exists) return json({ accessToken: null });
      const data = snap.data() || {};
      return json({ accessToken: data.accessToken || null });
    }

    return errorJson('Not found', 404);
  } catch (e: any) {
    console.error('[Social API] Unhandled error:', e);
    return errorJson(e?.message || 'Internal error', 500);
  }
};

export default {
  async fetch(request: Request): Promise<Response> {
    return handleRequest(request);
  },
};

