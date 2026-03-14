import { GoogleGenAI, GenerateContentResponse, FunctionDeclaration, Type, Schema, GroundingMetadata } from "@google/genai";
import { SearchResult, ResearchReport, Source, DynamicSection, ThemePalette, DualTheme, NoteNode, YoutubeVideo, VideoAnalysis, SocialPost, BlogPost, UploadedFile, ResearchProject, TableAsset, ProjectComponentScore } from '../types.js';
import {
  auth, getUserFromFirestore,
  logProjectActivity
} from './firebase.js';
import type { SeoKeywordApiResult } from './seoService.js';
import { wizaProspectSearch } from './wizaClient.js';
import { isUserSubscribed, isRateLimitError as checkRateLimit } from './modelSelector.js';
import { authFetch } from './authFetch.js';

// Initialize the generic client (uses env vars)
export const primaryApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const altPrimaryApiKey = process.env.GEMINI_ALT_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY;
export const ai = new GoogleGenAI({ apiKey: primaryApiKey });

// Optional alternate client for background tasks (e.g. draft suggestions)
const aiAlt = new GoogleGenAI({ apiKey: altPrimaryApiKey });

// Base model constants (fallbacks)
const MODEL_SUPER_FAST = process.env.MODEL_SUPER_FAST || 'gemini-3-flash-preview'; // Ultra-fast primary
const MODEL_FAST = process.env.MODEL_FAST || 'gemini-2.5-flash'; // Fallback
const MODEL_LITE = process.env.MODEL_LITE || 'gemini-3.1-flash-lite-preview';
const MODEL_MEDIUM = process.env.MODEL_MEDIUM || 'gemini-2.5-pro';
const MODEL_SMART = process.env.MODEL_SMART || 'gemini-3.1-pro-preview';
const MODEL_IMAGE_FAST = process.env.MODEL_IMAGE_FAST || 'gemini-3.1-flash-image-preview';
const MODEL_IMAGE_SMART = process.env.MODEL_IMAGE_SMART || 'gemini-3.1-flash-image-preview';
const MODEL_TTS = process.env.MODEL_TTS || 'gemini-2.5-flash-preview-tts';
const MODEL_TTS_FALLBACK = process.env.MODEL_TTS_FALLBACK || 'gemini-2.5-pro-preview-tts';

/**
 * Helper to identify Gemini 3 models which have different tool/config requirements.
 */
function isGemini3(modelName: string): boolean {
  return modelName.includes('gemini-3');
}

// Versioned models required for Explicit Caching (must use -001 suffix)
const MODEL_FAST_VERSIONED = 'gemini-2.5-flash-001';
const MODEL_MEDIUM_VERSIONED = 'gemini-2.5-pro-001';

// ============================================
// EXPLICIT CONTEXT CACHING
// ============================================

interface ProjectContextCache {
  cacheName: string;
  projectId: string;
  contextHash: string;  // Simple hash to detect if context changed
  expiresAt: number;
  createdAt: number;
}

// In-memory cache store (per server instance)
const projectContextCaches = new Map<string, ProjectContextCache>();

// Simple hash function for context comparison
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

/**
 * Get or create a cached context for a project.
 * Returns the cache name if successful, null if caching failed.
 */
export async function getOrCreateProjectContextCache(
  projectId: string,
  systemInstruction: string,
  ttlSeconds: number = 600  // 10 minutes default
): Promise<string | null> {
  if (!projectId || !systemInstruction) return null;

  const contextHash = simpleHash(systemInstruction);
  const now = Date.now();

  // Check if we have a valid cached entry
  const existing = projectContextCaches.get(projectId);
  if (existing && existing.contextHash === contextHash && existing.expiresAt > now) {
    console.log(`[CacheManager] Using existing cache for project ${projectId}`);
    return existing.cacheName;
  }

  // Need to create a new cache
  const client = new GoogleGenAI({ apiKey: primaryApiKey });

  try {
    console.log(`[CacheManager] Creating new cache for project ${projectId} (TTL: ${ttlSeconds}s)`);

    const cache = await client.caches.create({
      model: MODEL_FAST_VERSIONED,
      config: {
        displayName: `project-${projectId}-context`,
        systemInstruction: systemInstruction,
        ttl: `${ttlSeconds}s`,
      },
    });

    const cacheName = (cache as any).name;
    if (!cacheName) {
      console.warn('[CacheManager] Cache created but no name returned');
      return null;
    }

    // Store in our local map
    projectContextCaches.set(projectId, {
      cacheName,
      projectId,
      contextHash,
      expiresAt: now + (ttlSeconds * 1000),
      createdAt: now,
    });

    console.log(`[CacheManager] Cache created: ${cacheName}`);
    return cacheName;
  } catch (error: any) {
    console.error('[CacheManager] Failed to create cache:', error?.message || error);
    return null;
  }
}

/**
 * Invalidate the cache for a project (call when project data changes)
 */
export function invalidateProjectContextCache(projectId: string): void {
  if (projectContextCaches.has(projectId)) {
    console.log(`[CacheManager] Invalidating cache for project ${projectId}`);
    projectContextCaches.delete(projectId);
  }
}

/**
 * Clean up expired caches from memory
 */
export function cleanupExpiredCaches(): void {
  const now = Date.now();
  for (const [projectId, cache] of projectContextCaches.entries()) {
    if (cache.expiresAt < now) {
      projectContextCaches.delete(projectId);
    }
  }
}

/**
 * Get cache stats for debugging/monitoring
 */
export function getCacheStats(): { count: number; projectIds: string[] } {
  return {
    count: projectContextCaches.size,
    projectIds: Array.from(projectContextCaches.keys()),
  };
}

/**
 * Helper to generate content with fallback logic:
 * Attempt MODEL_SUPER_FAST first, then fallback to MODEL_FAST if it fails.
 */
async function generateContentFast(
  contents: any,
  config: any = {},
  systemInstruction?: string
): Promise<GenerateContentResponse> {
  try {
    return await ai.models.generateContent({
      model: MODEL_SUPER_FAST,
      contents,
      config: {
        ...config,
        ...(systemInstruction ? { systemInstruction } : {})
      },
    });
  } catch (error) {
    console.warn(`[geminiService] ${MODEL_SUPER_FAST} failed, falling back to ${MODEL_FAST}`, error);
    return await ai.models.generateContent({
      model: MODEL_FAST, // Fallback to 2.5 Flash
      contents,
      config: {
        ...config,
        ...(systemInstruction ? { systemInstruction } : {})
      },
    });
  }
}

// ---------------------------------------------------------
// 3. Image Generation & Color Extraction
// ---------------------------------------------------------
const PEXELS_IMAGE_ROUTE = '/api/pexels-image';

export const getPexelsImage = async (query: string): Promise<string> => {
  const encodedQuery = encodeURIComponent(query || 'abstract background');
  const res = await authFetch(`${PEXELS_IMAGE_ROUTE}?q=${encodedQuery}`);

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Pexels API error: ${res.status}`);
  }

  const data = await res.json();
  const imageUrl = data?.imageUrl as string | undefined;
  if (!imageUrl) {
    throw new Error('No Pexels photos found');
  }
  return imageUrl;
};

export interface ImageReference {
  base64?: string;
  fileUri?: string;
  mimeType: string;
}

const GEMINI_IMAGE_ROUTE = '/api/gemini-image';

const postGeminiImage = async (payload: Record<string, any>): Promise<{ imageDataUrl: string; parts?: any[] }> => {
  const res = await authFetch(GEMINI_IMAGE_ROUTE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini image API error: ${text || res.statusText}`);
  }

  const data = await res.json();

  // New response format: parts array with thoughts and signatures
  if (data?.parts && Array.isArray(data.parts)) {
    // Find the final (non-thought) image
    const finalImagePart = data.parts
      .filter((p: any) => p.type === 'image' && !p.thought)
      .pop(); // Take the last non-thought image as the final result

    if (!finalImagePart?.dataUrl) {
      throw new Error('Gemini image API returned no final image');
    }

    return {
      imageDataUrl: finalImagePart.dataUrl,
      parts: data.parts, // Include full parts for UI display
    };
  }

  // Backward compatibility: if old format is returned
  if (data?.imageDataUrl) {
    return { imageDataUrl: data.imageDataUrl };
  }

  throw new Error('Invalid response from Gemini image API');
};

export const generateImage = async (
  prompt: string,
  options?: { aspectRatio?: string; imageSize?: '1K' | '2K' | '4K'; useProModel?: boolean }
): Promise<{ imageDataUrl: string; parts?: any[] }> => {
  if (!prompt?.trim()) {
    throw new Error('Prompt is required for image generation');
  }
  return postGeminiImage({
    prompt: prompt.trim(),
    mode: 'generate',
    ...(options?.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
    ...(options?.imageSize ? { imageSize: options.imageSize } : {}),
    useProModel: options?.useProModel ?? true,
  });
};

export const generateImageWithReferences = async (
  prompt: string,
  references: ImageReference[],
  options?: { aspectRatio?: string; imageSize?: '1K' | '2K' | '4K'; useProModel?: boolean }
): Promise<{ imageDataUrl: string; parts?: any[] }> => {
  if (!references || references.length === 0) {
    throw new Error('Reference image is required for image generation');
  }

  // Optimize payloads by uploading large base64 images directly to Gemini
  const processedReferences = await Promise.all(
    references.map(async (ref, index) => {
      // Vercel Serverless Functions have a 4.5MB payload limit.
      // If the base64 string is > 2MB, upload it to the Gemini File Storage directly.
      if (ref.base64 && ref.base64.length > 2 * 1024 * 1024) {
        try {
          const byteCharacters = atob(ref.base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const file = new File([byteArray], `generate-ref-${Date.now()}-${index}.jpg`, {
            type: ref.mimeType || 'image/jpeg'
          });
          const uploaded = await uploadFileToGemini(file);
          return {
            fileUri: uploaded.uri,
            mimeType: ref.mimeType || 'image/jpeg',
          };
        } catch (err) {
          console.warn('Failed to upload large reference image to Gemini, falling back to base64', err);
        }
      }
      return {
        base64: ref.base64,
        fileUri: ref.fileUri,
        mimeType: ref.mimeType,
      };
    })
  );

  return postGeminiImage({
    prompt: prompt.trim(),
    mode: 'generate',
    references: processedReferences,
    ...(options?.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
    ...(options?.imageSize ? { imageSize: options.imageSize } : {}),
    useProModel: options?.useProModel ?? true,
  });
};

export const editImageWithReferences = async (
  prompt: string,
  references: ImageReference[],
  options?: { aspectRatio?: string; imageSize?: '1K' | '2K' | '4K'; useProModel?: boolean }
): Promise<{ imageDataUrl: string; parts?: any[] }> => {
  if (!references || references.length === 0) {
    throw new Error('Reference image is required for image editing');
  }

  // Optimize payloads by uploading large base64 images directly to Gemini
  const processedReferences = await Promise.all(
    references.map(async (ref, index) => {
      // Vercel Serverless Functions have a 4.5MB payload limit.
      // If the base64 string is > 2MB, upload it to the Gemini File Storage directly.
      if (ref.base64 && ref.base64.length > 2 * 1024 * 1024) {
        try {
          const byteCharacters = atob(ref.base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const file = new File([byteArray], `edit-ref-${Date.now()}-${index}.jpg`, {
            type: ref.mimeType || 'image/jpeg'
          });
          const uploaded = await uploadFileToGemini(file);
          return {
            fileUri: uploaded.uri,
            mimeType: ref.mimeType || 'image/jpeg',
          };
        } catch (err) {
          console.warn('Failed to upload large reference image to Gemini, falling back to base64', err);
        }
      }
      return {
        base64: ref.base64,
        fileUri: ref.fileUri,
        mimeType: ref.mimeType,
      };
    })
  );

  return postGeminiImage({
    prompt: prompt.trim(),
    mode: 'edit',
    references: processedReferences,
    ...(options?.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
    ...(options?.imageSize ? { imageSize: options.imageSize } : {}),
    useProModel: options?.useProModel ?? true,
  });
};

export const editImageWithGeminiNano = async (
  imageBase64: string,
  mimeType: string,
  prompt: string,
): Promise<Blob> => {
  if (!imageBase64 || !prompt?.trim()) {
    throw new Error('Image and prompt are required for editing');
  }

  // Uses Gemini 3.1 Flash Image
  const modelToUse = process.env.MODEL_IMAGE_FAST || 'gemini-3.1-flash-image-preview';

  // Construct the prompt with image and text
  const contents = [
    {
      role: 'user',
      parts: [
        { text: prompt.trim() },
        {
          inlineData: {
            mimeType: mimeType,
            data: imageBase64,
          },
        },
      ],
    },
  ];

  try {
    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: contents,
    });

    // Check for inline data (native image handling)
    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          // Convert base64 to Blob
          const binaryString = atob(part.inlineData.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return new Blob([bytes], { type: 'image/png' }); // Gemini typically returns PNG
        }
      }
    }

    throw new Error('No image data returned from Gemini');
  } catch (error) {
    console.error('Gemini Nano Image Editing failed:', error);
    throw error;
  }
}


export const editImageWithMultipleReferences = async (
  references: ImageReference[],
  prompt: string,
): Promise<Blob> => {
  if (!references.length || !prompt?.trim()) {
    throw new Error('Images and prompt are required for editing');
  }

  // Uses Gemini 3.1 Flash Image
  const modelToUse = process.env.MODEL_IMAGE_FAST || 'gemini-3.1-flash-image-preview';

  // Construct the prompt with text and multiple images
  const parts: any[] = [{ text: prompt.trim() }];

  references.forEach(ref => {
    parts.push({
      inlineData: {
        mimeType: ref.mimeType,
        data: ref.base64,
      },
    });
  });

  const contents = [
    {
      role: 'user',
      parts: parts,
    },
  ];

  try {
    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: contents,
    });

    // Check for inline data (native image handling)
    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          // Convert base64 to Blob
          const binaryString = atob(part.inlineData.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return new Blob([bytes], { type: 'image/png' }); // Gemini typically returns PNG
        }
      }
    }

    throw new Error('No image data returned from Gemini');
  } catch (error) {
    console.error('Gemini Image Editing failed:', error);
    throw error;
  }
};

export const generateImageWithIngredients = async (
  references: ImageReference[],
  prompt: string,
  options?: { aspectRatio?: string; imageSize?: '1K' | '2K' | '4K' }
): Promise<Blob> => {
  if (!references.length || !prompt?.trim()) {
    throw new Error('Images and prompt are required for ingredients generation');
  }

  // Uses Gemini 3.1 Flash Image for ingredients mode
  const modelToUse = 'gemini-3.1-flash-image-preview';
  const aspectRatio = options?.aspectRatio || '1:1';
  const resolution = options?.imageSize || '1K';

  const contents: any[] = [
    { text: prompt.trim() },
    ...references.map(ref => ({
      inlineData: {
        mimeType: ref.mimeType,
        data: ref.base64,
      },
    }))
  ];

  try {
    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: contents,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        // @ts-ignore - Image config typing might be missing in some SDK versions
        imageConfig: {
          aspectRatio: aspectRatio,
          imageSize: resolution,
        },
      },
    });

    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          const binaryString = atob(part.inlineData.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return new Blob([bytes], { type: 'image/png' });
        }
      }
    }

    throw new Error('No image data returned from Gemini Ingredients Mode');
  } catch (error) {
    console.error('Gemini Ingredients Mode failed:', error);
    throw error;
  }
};

// ---------------------------------------------------------
// App Mockup Generation
// ---------------------------------------------------------

/**
 * Generates 4 AI Mockups for a mobile app based on its description and features.
 * Uses gemini-3-pro-image-preview and runs 4 requests concurrently for speed.
 */
export const generateAppMockups = async (
  prompt: string,
): Promise<string[]> => {
  if (!prompt?.trim()) {
    throw new Error('Prompt is required for app mockup generation');
  }

  const modelToUse = 'gemini-3.1-flash-image-preview';
  const enhancedPrompt = `A highly detailed, professional UI design mockup of a mobile app. 
Style: Modern, sleek, dribbble-style, isometric or flat lay presentation. High quality UX/UI design, vibrant colors, clean typography.
App Concept: ${prompt}

Generate a beautiful, full-screen UI layout showcasing the app's main dashboard or key feature screen. Do not include excessive text. Focus on visual hierarchy, components like cards, buttons, and charts fitting the theme.`;

  const mockupPromises = Array.from({ length: 4 }).map(async (_, index) => {
    try {
      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: [{ text: enhancedPrompt }],
        config: {
          responseModalities: ['IMAGE'],
          // @ts-ignore
          imageConfig: {
            aspectRatio: '9:16', // Best for mobile phone UI mockups
            imageSize: '1K',
          },
        },
      });

      const candidates = response.candidates;
      if (candidates && candidates.length > 0) {
        for (const part of candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          }
        }
      }
      return null;
    } catch (error) {
      console.error(`Mockup generation ${index + 1} failed:`, error);
      return null;
    }
  });

  const results = await Promise.all(mockupPromises);
  // Filter out any failed requests
  const successfulMockups = results.filter((url): url is string => url !== null);

  if (successfulMockups.length === 0) {
    throw new Error('Failed to generate any app mockups.');
  }

  return successfulMockups;
};

// ---------------------------------------------------------
// Social Media Image Generation Helpers
// ---------------------------------------------------------

/**
 * Generate an image optimized for social media posts.
 * Uses generateImage under the hood with social-optimized settings.
 */
export const generateSocialPostImage = async (
  prompt: string,
  options?: { aspectRatio?: string; useProModel?: boolean }
): Promise<{ imageDataUrl: string; parts?: any[] }> => {
  return generateImage(prompt, {
    aspectRatio: options?.aspectRatio || '1:1',
    useProModel: options?.useProModel ?? true,
  });
};

/**
 * Uses Gemini 3 Pro with thinking to refine a user's prompt based on project context.
 * It strictly adheres to the rule: "only use the project context if the user prompt requires it".
 * 
 * Model cascade: gemini-3.1-pro-preview -> gemini-3-flash-preview -> gemini-2.5-flash
 */
export const refinePromptWithGemini3 = async (
  userPrompt: string,
  projectContext?: string,
  targetType: 'image' | 'video' | 'text' | 'general' = 'general',
  documentContext?: string,
  hasImageContext?: boolean
): Promise<string> => {
  if (!userPrompt.trim()) return '';

  const systemInstruction = `You are an expert Prompt Engineer and Content Creator.
Your goal is to refine the user's prompt to be optimal for a ${targetType} generator.
You have access to:
1. Project Context (Global background, style, themes)
2. Current Document Context (The specific text user is working on)

CRITICAL RULE: You must ONLY use the contexts if the user's prompt implicitly or explicitly requires it.
- If the user's prompt is generic (e.g., "A cat") and doesn't relate to the project/document, DO NOT inject unrelated context.
- If the prompt refers to "the project" or global themes, use Project Context.
- If the prompt refers to "this section", "the hero", "above text", or specific content in the document, PRIORTIZE Document Context.

Return ONLY the refined prompt string. No explanations.`;

  const contents = [{
    role: 'user' as const,
    parts: [{
      text: `User Prompt: "${userPrompt}"

${projectContext ? `Project Context (Global):
${projectContext.substring(0, 15000)}` : 'No project context.'}

${documentContext ? `Current Document Context (Active File):
${documentContext.substring(0, 5000)}` : 'No document context.'}

${hasImageContext ? `IMPORTANT: The user has attached reference image(s) to this request.
- The refined prompt MUST explicitly refer to "the provided image" or "the reference image" if the user's intent involves using it.
- Do not describe the image yourself (you cannot see it), but ensure the prompt instructs the model to use the attached image as a source/reference.` : ''}

Refine this prompt for a ${targetType} generator. Ensure it aligns with the relevant context.`
    }]
  }];

  /**
   * Helper to execute generation safely (Client-side proxy vs Server-side direct)
   */
  const generateSafe = async (model: string, config: any): Promise<string> => {
    // Client-side: Proxy through API
    if (typeof window !== 'undefined') {
      const response = await authFetch('/api/agent?op=generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          contents,
          config: {
            ...config,
            systemInstruction
          }
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API Refine Proxy Failed: ${response.status} ${text}`);
      }

      const data = await response.json();
      const result = data.text?.trim();
      return result || '';
    }

    // Server-side: Direct SDK
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        ...config,
        systemInstruction
      },
    });

    const result = response.text?.trim() || '';
    return result?.trim() || '';
  };

  // Try Gemini 3 Pro first (with thinking)
  try {
    const result = await generateSafe(MODEL_SMART, {
      thinkingConfig: {
        thinkingLevel: "high" as any,
      },
      temperature: 1.0,
    });
    if (result) return result;
    throw new Error('Empty response from Gemini 3 Pro');
  } catch (error) {
    console.warn('[refinePromptWithGemini3] Gemini 3 Pro failed, trying Gemini 3 Flash:', error);
  }

  // Fallback 1: Try Gemini 3 Flash
  try {
    const result = await generateSafe(MODEL_SUPER_FAST, {
      thinkingConfig: {
        thinkingLevel: "medium" as any,
      },
      temperature: 1.0,
    });
    if (result) return result;
    throw new Error('Empty response from Gemini 3 Flash');
  } catch (error) {
    console.warn('[refinePromptWithGemini3] Gemini 3 Flash failed, trying Gemini 2.5 Flash:', error);
  }

  // Fallback 2: Try Gemini 2.5 Flash (no thinking config needed)
  try {
    const result = await generateSafe(MODEL_FAST, {
      temperature: 0.7,
    });
    if (result) return result;
  } catch (error) {
    console.warn('[refinePromptWithGemini3] All models failed:', error);
  }

  // Final fallback: Just return the user prompt unchanged
  return userPrompt;
};

/**
 * Generate an image prompt from text content (e.g., for social media posts).
 * Uses AI to create a descriptive image prompt from general text.
 */
export const generateImagePromptFromText = async (textContent: string, projectContext?: string): Promise<string> => {
  // Use the new Gemini 3 Pro reasoning engine for prompt engineering
  return refinePromptWithGemini3(textContent, projectContext, 'image');
};

const sanitizeNewsApiQuery = (value: string): string => {
  let q = (value || '').trim();
  q = q
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .trim();

  // Strip common accidental prefixes like: q=..., q: ..., query=...
  q = q.replace(/^\s*(?:q|query)\s*[:=]\s*/i, '').trim();

  // If Gemini outputs something like: q="..." AND ...
  q = q.replace(/^\s*q\s*=\s*/i, '').trim();

  // Remove wrapping quotes
  if ((q.startsWith('"') && q.endsWith('"')) || (q.startsWith("'") && q.endsWith("'"))) {
    q = q.slice(1, -1).trim();
  }

  // First line only
  q = q.split(/\r?\n/)[0]?.trim() || '';

  // Collapse whitespace
  q = q.replace(/\s+/g, ' ').trim();

  // Avoid overly-restrictive standalone years that frequently lead to off-topic matches.
  // Keep years only if the query is very short (i.e., the year is likely the subject).
  if (q.length > 30) {
    q = q
      .replace(/\b(19|20)\d{2}\b/g, '')
      .replace(/"\s*(19|20)\d{2}\s*"/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return q;
};

export const detectWizaResearchTools = async (
  topic: string,
): Promise<{ useProspects: boolean; useCompany: boolean; reason: string }> => {
  const prompt = (topic || '').trim();
  const keywordFallback = () => {
    const s = prompt.toLowerCase();
    const wantsPeople = /(\bcontact\b|\bcontacts\b|\blead\b|\bleads\b|\bprospect\b|\bprospects\b|\bpeople\b|\bdecision\s*makers\b|\bexecutives\b)/i.test(s);
    const wantsContactInfo = /(\bemail\b|\bemails\b|\bwork email\b|\bphone\b|\bphones\b|\bmobile\b|\blinkedin\b|\bsales nav\b|\bprofile url\b)/i.test(s);
    const wantsCompanies = /(\bcompany\b|\bcompanies\b|\borganizations\b|\bstartups\b|\bvendors\b|\bsuppliers\b|\bbrands\b|\bcompetitors\b)/i.test(s);
    const useProspects = wantsPeople && wantsContactInfo;
    const useCompany = wantsCompanies;
    return {
      useProspects,
      useCompany,
      reason: useProspects || useCompany ? 'Keyword fallback' : 'Keyword fallback: not relevant',
    };
  };

  if (!prompt) return { useProspects: false, useCompany: false, reason: 'Empty topic' };

  try {
    const schema = {
      type: 'object',
      properties: {
        useProspects: { type: 'boolean' },
        useCompany: { type: 'boolean' },
        reason: { type: 'string' },
      },
      required: ['useProspects', 'useCompany', 'reason'],
      additionalProperties: false,
    } as const;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Decide whether this research topic should use Wiza enrichment tools.

Return JSON only.

Rules:
- useProspects=true ONLY when the topic explicitly requests people/leads/prospects/contacts AND contact info (email/phone/LinkedIn).
- useCompany=true when the topic requests companies/competitors/vendors and would benefit from firmographic enrichment.
- Both may be true.

Topic:
${prompt}`,
            },
          ],
        },
      ],
      config: {
        temperature: 0.2,
        maxOutputTokens: 180,
        responseMimeType: 'application/json',
        responseJsonSchema: schema as any,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return keywordFallback();
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      useProspects: Boolean(parsed?.useProspects),
      useCompany: Boolean(parsed?.useCompany),
      reason: String(parsed?.reason || '').trim() || 'Detected via Gemini',
    };
  } catch {
    return keywordFallback();
  }
};

const buildStrictPrintOnDemandQuery = (value: string): string => {
  const raw = sanitizeNewsApiQuery(value);
  const tokens = raw
    .toLowerCase()
    .replace(/["\(\)]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => t.length >= 4)
    .filter(t => !['print', 'demand', 'pod', 'custom', 'merch', 'query', 'title', 'description', 'content'].includes(t));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
    if (unique.length >= 3) break;
  }

  const base = '"print on demand"';
  const withAnd = unique.length ? `${base} AND ${unique.join(' AND ')}` : base;
  return withAnd.length > 200 ? withAnd.slice(0, 200) : withAnd;
};

export const generateNewsApiQueries = async (
  projectName: string,
  projectDescription: string,
): Promise<string[]> => {
  const name = (projectName || '').trim();
  const description = (projectDescription || '').trim();
  const seed = (name || description || 'technology').trim();
  const isPrintOnDemandTopic = /\bprint\s+on\s+demand\b/i.test(`${name} ${description}`) || /\bpod\b/i.test(`${name} ${description}`);

  try {
    const prompt = isPrintOnDemandTopic
      ? `ROLE: News search query generator.

You are generating NewsAPI "everything" search query strings.

CONTEXT:
- Project name: "${name || '(none)'}"
- Project description: "${description || '(none)'}"

TASK:
- Return EXACTLY 3 candidate queries as a JSON array of strings.
- Order them from MOST precise to MOST broad.
- Each must be <= 200 characters.
- EVERY query MUST include the exact phrase "print on demand" (in quotes).
- Do NOT include the acronym POD.
- Do NOT include OR expansions (no OR synonyms like "custom merch").
- Do NOT include standalone years like 2025.

Return ONLY JSON like:
["...", "...", "..."]`
      : `ROLE: News search query generator.

You are generating NewsAPI "everything" search query strings.

CONTEXT:
- Project name: "${name || '(none)'}"
- Project description: "${description || '(none)'}"

TASK:
- Return EXACTLY 3 candidate queries as a JSON array of strings.
- Order them from MOST precise to MOST broad.
- Each must be <= 200 characters.
- Do NOT include any prefixes like q= or query=.
- Prefer entity + industry terms.
- Do NOT include standalone years like 2025 unless the year itself is the subject.
- Prefer adding 1-2 high-signal synonyms using OR (example: "print on demand" OR POD OR "custom merch").
- Expand acronyms when present (example: POD -> "print on demand").

Return ONLY JSON like:
["...", "...", "..."]`;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.25,
        maxOutputTokens: 200,
      },
    });

    const raw = (response.text || '').trim();
    const cleaned = sanitizeNewsApiQuery(raw);

    // If it returned a JSON array, parse it.
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          const candidates = parsed
            .map(item => sanitizeNewsApiQuery(String(item || '')))
            .filter(Boolean)
            .map(q => (q.length > 200 ? q.slice(0, 200) : q))
            .map(q => (isPrintOnDemandTopic ? buildStrictPrintOnDemandQuery(q) : q));
          const deduped = Array.from(new Set(candidates));
          if (deduped.length > 0) return deduped.slice(0, 3);
        }
      }
    } catch {
      // ignore
    }

    // Fallback: treat the response as a single query
    const single = sanitizeNewsApiQuery(cleaned);
    return [isPrintOnDemandTopic ? buildStrictPrintOnDemandQuery(single || seed) : (single || seed)];
  } catch (error) {
    console.error('Failed to generate NewsAPI queries via Gemini:', error);
    return [isPrintOnDemandTopic ? buildStrictPrintOnDemandQuery(seed) : seed];
  }
};

export const generateNewsApiQuery = async (
  projectName: string,
  projectDescription: string,
): Promise<string> => {
  const queries = await generateNewsApiQueries(projectName, projectDescription);
  return (queries[0] || (projectName || projectDescription || 'technology')).trim() || 'technology';
};

export const generateInspoSearchQueries = async (
  projectName: string,
  projectDescription: string,
): Promise<string[]> => {
  const name = (projectName || '').trim();
  const description = (projectDescription || '').trim();
  const seed = (name || description || 'inspiration').trim();

  try {
    const prompt = `ROLE: Visual inspiration search expert.

You are generating search queries to find visual inspiration (images, videos, social posts) for a project.

CONTEXT:
- Project name: "${name || '(none)'}"
- Project description: "${description || '(none)'}"

TASK:
- Return EXACTLY 4 distinct, high-quality search queries.
- These queries should cover different angles:
  1. A specific object/subject matter query.
  2. A stylistic/aesthetic query (e.g. "minimalist", "neon").
  3. A broad industry or theme query (e.g. "PrintOnDemand").
  4. An abstract or metaphorical query related to the concept.
- Queries MUST be short (1-3 words) and suitable for use as hashtags (avoid sentences or long phrases).
- Do NOT use hashtags (#) in the strings.

Return ONLY a JSON array of strings:
["...", "...", "...", "..."]`;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7, // Higher temperature for creativity
        maxOutputTokens: 200,
        responseMimeType: 'application/json',
      },
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        const queries = parsed.map(s => String(s).trim()).filter(Boolean).slice(0, 4);
        if (queries.length > 0) return queries;
      }
    }

    return [seed];
  } catch (error) {
    console.error('Failed to generate inspo queries:', error);
    return [seed];
  }
};

export const detectWizaTableIntent = async (
  userPrompt: string,
): Promise<{ mode: 'people' | 'company' | 'none'; reason: string }> => {
  const prompt = (userPrompt || '').trim();
  const keywordFallback = (): { mode: 'people' | 'company' | 'none'; reason: string } => {
    const s = prompt.toLowerCase();
    const wantsPeople = /(\bcontact\b|\bcontacts\b|\blead\b|\bleads\b|\bprospect\b|\bprospects\b|\bpeople\b|\bdecision\s*makers\b|\bexecutives\b)/i.test(s);
    const wantsEmails = /(\bemail\b|\bemails\b|\bwork email\b|\bphone\b|\bphones\b|\bmobile\b)/i.test(s);
    const wantsLinkedin = /(\blinkedin\b|\bsales nav\b|\brecruiter\b|\bprofile url\b)/i.test(s);

    if (wantsPeople && (wantsEmails || wantsLinkedin)) {
      return { mode: 'people', reason: 'Keyword fallback: contacts + contact info requested' };
    }

    const wantsCompanies = /(\bcompany\b|\bcompanies\b|\borganizations\b|\bstartups\b|\bvendors\b|\bsuppliers\b|\bbrands\b)/i.test(s);
    if (wantsCompanies) {
      return { mode: 'company', reason: 'Keyword fallback: company list requested' };
    }

    return { mode: 'none', reason: 'Keyword fallback: general table' };
  };

  if (!prompt) return { mode: 'none', reason: 'Empty prompt' };

  try {
    const schema = {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['people', 'company', 'none'] },
        reason: { type: 'string' },
      },
      required: ['mode', 'reason'],
      additionalProperties: false,
    } as const;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Decide whether a user table prompt should use Wiza for enrichment.

Return JSON only.

Guidance:
- mode="people" ONLY if the user is explicitly asking for people/contacts/leads/prospects with contact info (emails/phones/LinkedIn).
- mode="company" if the user is asking for company lists and would benefit from firmographic enrichment (industry, size, revenue range, LinkedIn, etc.).
- mode="none" for everything else.

User prompt:
${prompt}`,
            },
          ],
        },
      ],
      config: {
        temperature: 0.2,
        maxOutputTokens: 160,
        responseMimeType: 'application/json',
        responseJsonSchema: schema as any,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return keywordFallback();
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const mode = (parsed?.mode === 'people' || parsed?.mode === 'company' || parsed?.mode === 'none')
      ? parsed.mode
      : 'none';
    const reason = String(parsed?.reason || '').trim() || (mode === 'people' ? 'Prompt requires contacts' : mode === 'company' ? 'Prompt requires company enrichment' : 'Prompt does not require enrichment');
    return { mode, reason };
  } catch (e: any) {
    return keywordFallback();
  }
};

export const generateTableTitle = async (
  columns: string[],
  sampleRows: string[][]
): Promise<string> => {
  try {
    const colStr = columns.join(', ');
    const rowStr = sampleRows.map(r => r.join(', ')).join('\n');
    const prompt = `Generate a concise, descriptive title (3-6 words) for this data table.
Columns: ${colStr}
Sample Data:
${rowStr}

Return ONLY the title string. No quotes.`;

    const response = await ai.models.generateContent({
      model: MODEL_SUPER_FAST, // gemini-3-flash-preview
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 20
      }
    });

    return (response.text || '').trim() || 'Untitled Table';
  } catch (error) {
    console.error('Failed to generate table title:', error);
    return 'Untitled Table';
  }
};

function extractInlineAudioData(response: any): { data: string; mimeType?: string } | null {
  const candidate = response?.candidates?.[0];
  const parts: any[] = candidate?.content?.parts || [];

  for (const part of parts) {
    const data = part?.inlineData?.data;
    if (data) {
      return { data, mimeType: part?.inlineData?.mimeType };
    }
  }

  return null;
}

// Subscription-aware model selection
export async function getSmartModel(): Promise<string> {
  const subscribed = await isUserSubscribed();
  return subscribed ? MODEL_SMART : MODEL_SUPER_FAST;
}

export async function getPrimaryModel(): Promise<string> {
  const subscribed = await isUserSubscribed();
  return subscribed ? MODEL_SMART : MODEL_SUPER_FAST;
}

export async function getImageModel(): Promise<string> {
  const subscribed = await isUserSubscribed();
  return subscribed ? MODEL_IMAGE_SMART : MODEL_IMAGE_FAST;
}

// Re-export for use in components
export { isRateLimitError, isUserSubscribed } from './modelSelector.js';

// TTS Voice Options
export const TTS_VOICES = [
  { name: 'Zephyr', style: 'Bright' },
  { name: 'Puck', style: 'Upbeat' },
  { name: 'Charon', style: 'Informative' },
  { name: 'Kore', style: 'Firm' },
  { name: 'Fenrir', style: 'Excitable' },
  { name: 'Leda', style: 'Youthful' },
  { name: 'Orus', style: 'Firm' },
  { name: 'Aoede', style: 'Breezy' },
  { name: 'Callirrhoe', style: 'Easy-going' },
  { name: 'Autonoe', style: 'Bright' },
  { name: 'Enceladus', style: 'Breathy' },
  { name: 'Iapetus', style: 'Clear' },
  { name: 'Umbriel', style: 'Easy-going' },
  { name: 'Algieba', style: 'Smooth' },
  { name: 'Despina', style: 'Smooth' },
  { name: 'Erinome', style: 'Clear' },
  { name: 'Algenib', style: 'Gravelly' },
  { name: 'Rasalgethi', style: 'Informative' },
  { name: 'Laomedeia', style: 'Upbeat' },
  { name: 'Achernar', style: 'Soft' },
  { name: 'Alnilam', style: 'Firm' },
  { name: 'Schedar', style: 'Even' },
  { name: 'Gacrux', style: 'Mature' },
  { name: 'Pulcherrima', style: 'Forward' },
  { name: 'Achird', style: 'Friendly' },
  { name: 'Zubenelgenubi', style: 'Casual' },
  { name: 'Vindemiatrix', style: 'Gentle' },
  { name: 'Sadachbia', style: 'Lively' },
  { name: 'Sadaltager', style: 'Knowledgeable' },
  { name: 'Sulafat', style: 'Warm' }
] as const;

// ========== EMAIL BUILDER AI ==========
export const generateEmailText = async (
  currentText: string,
  fullContext: string
): Promise<string> => {
  try {
    const prompt = `Current Text Field Content:
"${currentText}"

Full Email Context (Other blocks):
${fullContext}

Instructions:
You are an expert email copywriter.
1. If the "Current Text Content" is a short prompt or instruction (e.g., "intro paragraph about sales"), generate the full professional text for it.
2. If it is an incomplete sentence or paragraph, complete it naturally matching the tone.
3. If it looks like finished text, improve/polish it slightly for better conversion and clarity.
4. Use the "Full Email Context" to ensure consistency in tone and topic.
5. Return ONLY the generated text content. No explanations. Use HTML line breaks <br> if needed for formatting, but mostly keep it clean.`;

    const response = await ai.models.generateContent({
      model: MODEL_FAST, // gemini-2.5-flash is good for text generation
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,
        maxOutputTokens: 500,
      },
    });

    return (response.text || '').trim();
  } catch (error) {
    console.error('Failed to generate email text:', error);
    return currentText; // Fallback to original text
  }
};

// Generate a full email template (blocks array) from a prompt
export interface GenerateFullEmailOptions {
  prompt: string;
  projectName: string;
  projectDescription?: string;
  logoUrl?: string;
  products?: { name: string; price: string; description?: string; imageUrl?: string; paymentLink?: string }[];
}

export const generateFullEmail = async (
  options: GenerateFullEmailOptions
): Promise<any[]> => {
  const { prompt, projectName, projectDescription, logoUrl, products } = options;

  console.log('[generateFullEmail] Starting with prompt:', prompt?.substring(0, 100));

  const productContext = products && products.length > 0
    ? `\n\nAvailable Products:\n${products.slice(0, 5).map((p, i) => `${i + 1}. "${p.name}" - ${p.price}${p.description ? ` - ${p.description}` : ''}${p.paymentLink ? ` [Payment Link: ${p.paymentLink}]` : ''}`).join('\n')}`
    : '';

  // STEP 1: Generate the email content plan
  const planPrompt = `You are an expert email copywriter. Create the content for a professional marketing email.

PROJECT CONTEXT:
- Brand Name: "${projectName}"
- Description: "${projectDescription || 'A professional business'}"${productContext}

USER REQUEST:
"${prompt}"

Generate the following content in JSON format:
{
  "headline": "A compelling 5-10 word headline for the email",
  "heroImageDescription": "A detailed 1-2 sentence description of what the hero image should show (for AI image generation)",
  "introText": "2-3 engaging sentences introducing the email topic/offer",
  "mainContent": "3-4 sentences with the main message, benefits, or details",
  "ctaButtonText": "A short action-oriented button text like 'Shop Now' or 'Learn More'",
  "ctaUrl": "The URL for the button (use '#' if unknown)"
}

Return ONLY valid JSON, no markdown code fences.`;

  try {
    // Step 1: Generate content plan
    console.log('[generateFullEmail] Step 1: Generating content plan...');
    const planResponse = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: [{ role: 'user', parts: [{ text: planPrompt }] }],
      config: {
        temperature: 0.9,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    });

    const planText = (planResponse.text || '').trim();
    console.log('[generateFullEmail] Plan response:', planText?.substring(0, 200));

    let contentPlan: any = {};
    try {
      const jsonMatch = planText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        contentPlan = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('[generateFullEmail] Failed to parse content plan:', parseError);
    }

    // Ensure we have content (use defaults if needed)
    const headline = contentPlan.headline || `Exciting Update from ${projectName}`;
    const heroImageDescription = contentPlan.heroImageDescription || `A professional, modern image representing ${projectName} and their services. Clean, vibrant, and business-appropriate.`;
    const introText = contentPlan.introText || `Thank you for being part of the ${projectName} community. We have some exciting news to share with you today.`;
    const mainContent = contentPlan.mainContent || `At ${projectName}, we're committed to providing you with the best experience possible. Our team has been working hard to bring you new features, improved services, and better value. We believe this will make a significant difference in how you work with us.`;
    const ctaButtonText = contentPlan.ctaButtonText || 'Learn More';
    const ctaUrl = contentPlan.ctaUrl || '#';

    console.log('[generateFullEmail] Content generated - headline:', headline);

    // Step 2: Build blocks with generated content
    const now = Date.now();
    const blocks: any[] = [];

    // Header block
    blocks.push({
      id: `gen-header-${now}`,
      type: 'header',
      content: { text: headline },
      styles: {
        backgroundColor: '#0071e3',
        color: '#ffffff',
        fontSize: '28px',
        fontWeight: 'bold',
        textAlign: 'center',
        padding: '32px 24px'
      },
    });

    // Hero image block
    blocks.push({
      id: `gen-hero-${now}`,
      type: 'image',
      content: {
        src: 'GENERATE_IMAGE',
        alt: heroImageDescription,
        width: '100%',
        height: 'auto'
      },
      styles: { padding: '0', textAlign: 'center' },
    });

    // Intro text block
    blocks.push({
      id: `gen-intro-${now}`,
      type: 'text',
      content: { text: introText },
      styles: {
        padding: '32px 24px',
        textAlign: 'left',
        color: '#1d1d1f',
        fontSize: '18px',
        lineHeight: '1.7'
      },
    });

    // Main content block
    blocks.push({
      id: `gen-main-${now}`,
      type: 'text',
      content: { text: mainContent },
      styles: {
        padding: '16px 24px 32px',
        textAlign: 'left',
        color: '#333333',
        fontSize: '16px',
        lineHeight: '1.6'
      },
    });

    // CTA Button
    blocks.push({
      id: `gen-cta-${now}`,
      type: 'button',
      content: {
        text: ctaButtonText,
        url: ctaUrl,
        backgroundColor: '#0071e3',
        textColor: '#ffffff',
        borderRadius: '8px',
        align: 'center'
      },
      styles: { padding: '24px', textAlign: 'center' },
    });

    // Add product blocks if available
    if (products && products.length > 0) {
      blocks.push({
        id: `gen-divider-${now}`,
        type: 'divider',
        content: { color: '#e5e5e5', thickness: '1px' },
        styles: { padding: '24px' },
      });

      products.slice(0, 3).forEach((product, i) => {
        blocks.push({
          id: `gen-product-${now}-${i}`,
          type: 'product',
          content: {
            title: product.name,
            price: product.price,
            description: product.description || '',
            imageUrl: product.imageUrl || 'GENERATE_IMAGE',
            buttonText: 'Buy Now',
            buttonUrl: product.paymentLink || '#',
            buttonColor: '#0071e3',
            buttonTextColor: '#ffffff',
            buttonBorderRadius: '8px',
          },
          styles: { padding: '24px', textAlign: 'center', backgroundColor: '#ffffff' },
        });
      });
    }

    // Footer
    blocks.push({
      id: `gen-footer-${now}`,
      type: 'footer',
      content: {
        text: `© ${new Date().getFullYear()} ${projectName}. All rights reserved.\n\nUnsubscribe | Privacy Policy`
      },
      styles: {
        backgroundColor: '#f5f5f7',
        color: '#86868b',
        fontSize: '12px',
        textAlign: 'center',
        padding: '32px 24px'
      },
    });

    // Step 3: Generate images for placeholder blocks
    console.log('[generateFullEmail] Step 2: Generating images...');
    const processedBlocks = await generateEmailImages(blocks, projectName, projectDescription || '');

    console.log('[generateFullEmail] Complete! Generated', processedBlocks.length, 'blocks');
    return processedBlocks;

  } catch (error) {
    console.error('[generateFullEmail] Failed:', error);
    return createFallbackEmailTemplate(prompt, projectName, logoUrl);
  }
};


// Generate images for email blocks that have placeholder src values
async function generateEmailImages(blocks: any[], projectName: string, projectDescription: string): Promise<any[]> {
  const processedBlocks = [...blocks];

  for (let i = 0; i < processedBlocks.length; i++) {
    const block = processedBlocks[i];

    if (block.type === 'image' && block.content) {
      const src = block.content.src || '';
      const alt = block.content.alt || '';

      // Check if this is a placeholder that needs image generation
      if (src === 'GENERATE_IMAGE' || src === '' || src.includes('placeholder') || src.includes('placehold.co')) {
        if (alt && alt.length > 5) {
          try {
            // Generate image using the alt text as the prompt
            const imagePrompt = `Professional email marketing image: ${alt}. Style: Clean, modern, high-quality stock photo aesthetic. Brand: ${projectName}. ${projectDescription ? `Context: ${projectDescription}` : ''}`;

            const result = await generateImage(imagePrompt, {
              aspectRatio: '16:9',
              imageSize: '1K',
              useProModel: false, // Use fast model for email images
            });

            if (result?.imageDataUrl) {
              // Update the block with the generated image
              processedBlocks[i] = {
                ...block,
                content: {
                  ...block.content,
                  src: result.imageDataUrl,
                }
              };
            }
          } catch (imgError) {
            console.error('Failed to generate email image:', imgError);
            // Keep the placeholder, user can manually add image
          }
        }
      }
    }

    // Handle product blocks that might need image generation
    if (block.type === 'product' && block.content) {
      const imageUrl = block.content.imageUrl || '';
      const title = block.content.title || 'Product';

      if (!imageUrl || imageUrl === 'GENERATE_IMAGE' || imageUrl.includes('placeholder')) {
        try {
          const imagePrompt = `Professional product photo of ${title}. Style: E-commerce product photography, clean white background, high-quality, appealing.`;

          const result = await generateImage(imagePrompt, {
            aspectRatio: '1:1',
            imageSize: '1K',
            useProModel: false,
          });

          if (result?.imageDataUrl) {
            processedBlocks[i] = {
              ...block,
              content: {
                ...block.content,
                imageUrl: result.imageDataUrl,
              }
            };
          }
        } catch (imgError) {
          console.error('Failed to generate product image:', imgError);
        }
      }
    }
  }

  return processedBlocks;
}


// Sanitize AI-generated email blocks to ensure all required fields exist
function sanitizeEmailBlock(block: any, idx: number): any {
  const id = block.id || `gen-${idx + 1}-${Date.now()}`;
  const type = block.type || 'text';
  const styles = block.styles || { padding: '16px' };
  let content = block.content || {};

  // Ensure type-specific required fields exist
  switch (type) {
    case 'text':
    case 'header':
    case 'footer':
      content = { text: content.text || '', ...content };
      break;
    case 'image':
      content = {
        src: content.src || '',
        alt: content.alt || 'Image',
        width: content.width || '100%',
        height: content.height || 'auto',
        ...content
      };
      break;
    case 'button':
      content = {
        text: content.text || 'Click Here',
        url: content.url || '#',
        backgroundColor: content.backgroundColor || '#0071e3',
        textColor: content.textColor || '#ffffff',
        borderRadius: content.borderRadius || '4px',
        align: content.align || 'center',
        ...content
      };
      break;
    case 'divider':
      content = {
        color: content.color || '#e5e5e5',
        thickness: content.thickness || '1px',
        ...content
      };
      break;
    case 'spacer':
      content = { height: content.height || '20px', ...content };
      break;
    case 'social':
      // CRITICAL: Ensure platforms array exists
      content = {
        platforms: Array.isArray(content.platforms) ? content.platforms : [
          { name: 'Facebook', url: 'https://facebook.com/', slug: '', enabled: true },
          { name: 'Twitter', url: 'https://x.com/', slug: '', enabled: true },
          { name: 'Instagram', url: 'https://instagram.com/', slug: '', enabled: true },
        ],
        ...content
      };
      break;
    case 'columns':
      // CRITICAL: Ensure children array exists with proper structure
      const children = Array.isArray(content.children) ? content.children : [];
      content = {
        columns: content.columns || 2,
        children: children.length >= 2 ? children.map((col: any) => ({
          blocks: Array.isArray(col?.blocks) ? col.blocks : []
        })) : [{ blocks: [] }, { blocks: [] }],
        ...content
      };
      break;
    case 'product':
      content = {
        title: content.title || 'Product',
        price: content.price || '$0.00',
        description: content.description || '',
        imageUrl: content.imageUrl || '',
        buttonText: content.buttonText || 'Buy Now',
        buttonUrl: content.buttonUrl || '#',
        buttonColor: content.buttonColor || '#0071e3',
        buttonTextColor: content.buttonTextColor || '#ffffff',
        buttonBorderRadius: content.buttonBorderRadius || '4px',
        ...content
      };
      break;
    default:
      // Unknown type, convert to text
      content = { text: content.text || '' };
  }

  return { id, type, content, styles };
}

function createFallbackEmailTemplate(prompt: string, projectName: string, logoUrl?: string): any[] {
  const blocks: any[] = [];
  const now = Date.now();

  if (logoUrl) {
    blocks.push({
      id: `fb-logo-${now}`,
      type: 'image',
      content: { src: logoUrl, alt: projectName, width: '150px', height: 'auto' },
      styles: { padding: '20px', textAlign: 'center' },
    });
  }

  blocks.push({
    id: `fb-header-${now}`,
    type: 'header',
    content: { text: projectName },
    styles: { backgroundColor: '#0071e3', color: '#ffffff', fontSize: '24px', fontWeight: 'bold', textAlign: 'center', padding: '24px' },
  });

  blocks.push({
    id: `fb-text-${now}`,
    type: 'text',
    content: { text: `<p>Thank you for your interest!</p><p>${prompt || 'We have exciting news to share with you.'}</p>` },
    styles: { padding: '20px', textAlign: 'left', color: '#333333', fontSize: '16px', lineHeight: '1.6' },
  });

  blocks.push({
    id: `fb-button-${now}`,
    type: 'button',
    content: { text: 'Learn More', url: '#', backgroundColor: '#0071e3', textColor: '#ffffff', borderRadius: '8px', align: 'center' },
    styles: { padding: '20px', textAlign: 'center' },
  });

  blocks.push({
    id: `fb-footer-${now}`,
    type: 'footer',
    content: { text: `© ${new Date().getFullYear()} ${projectName}. All rights reserved.\n\nUnsubscribe | Privacy Policy` },
    styles: { backgroundColor: '#f5f5f5', color: '#666666', fontSize: '12px', textAlign: 'center', padding: '24px' },
  });

  return blocks;
}

// ========== RESEARCH PROJECT SUGGESTIONS ==========
export const generateResearchSuggestions = async (
  projectName: string,
  projectDescription: string,
  existingTopics: string[] = []
): Promise<string[]> => {
  try {
    const existingContext = existingTopics.length > 0
      ? `\n\nTopics already researched (avoid repeating these): ${existingTopics.join(', ')}`
      : '';

    const prompt = `You are helping a researcher generate relevant research topic suggestions for their project.

Project Name: "${projectName}"
Project Description: "${projectDescription}"${existingContext}

Generate exactly 5 specific, actionable research topics that would be valuable for this project. 
Each topic should be:
- Specific and focused (not too broad)
- Directly relevant to the project goals
- Phrased as a clear research question or topic
- Different from any existing topics

Return ONLY a JSON array of 5 strings, no other text. Example format:
["Topic 1", "Topic 2", "Topic 3", "Topic 4", "Topic 5"]`;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.8,
        maxOutputTokens: 500
      }
    });

    const text = response.text?.trim() || '';

    // Try to parse as JSON
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0]);
        if (Array.isArray(suggestions) && suggestions.length > 0) {
          return suggestions.slice(0, 5).map(s => String(s));
        }
      }
    } catch (parseError) {
      console.error("Failed to parse suggestions JSON:", parseError);
    }

    // Fallback: try to extract topics from text
    const lines = text.split('\n').filter(line => line.trim().length > 10);
    return lines.slice(0, 5).map(line => line.replace(/^[\d\-\*\.\)]+\s*/, '').trim());
  } catch (error) {
    console.error("Failed to generate research suggestions:", error);
    return [
      `${projectName} - Market Analysis`,
      `${projectName} - Best Practices`,
      `${projectName} - Competitive Landscape`,
      `${projectName} - Future Trends`,
      `${projectName} - Implementation Strategies`
    ];
  }
};

const KEYWORD_STOP_WORDS = new Set([
  'the', 'and', 'a', 'an', 'for', 'with', 'from', 'into', 'about', 'your', 'you', 'of', 'to', 'in',
  'on', 'by', 'or', 'at', 'as', 'it', 'its', 'this', 'that', 'these', 'those', 'how', 'why', 'what',
  'best', 'top', 'guide', 'tips', 'ideas'
]);

const splitKeywordCandidates = (value: string): string[] => {
  return value
    .split(/[\n,;]+/)
    .map(part => part.trim())
    .filter(part => part.length > 0);
};

const cleanKeywordCandidate = (candidate: string): string | null => {
  if (!candidate) return null;

  const stripped = candidate
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .replace(/^[\d\-\*\.\)\s>]+/, '')
    .replace(/[“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!stripped) return null;

  const words = stripped.split(' ').filter(Boolean);
  const filtered =
    words.length > 1
      ? words.filter(word => !KEYWORD_STOP_WORDS.has(word.toLowerCase()))
      : words;

  const cleaned = (filtered.length >= 2 ? filtered : words).join(' ').trim();
  if (!cleaned) return null;

  const finalWords = cleaned.split(' ');
  if (finalWords.length === 1 && finalWords[0].length < 4) {
    return null;
  }

  const truncated =
    finalWords.length > 6 ? finalWords.slice(0, 6).join(' ') : cleaned;

  return truncated;
};

const normalizeKeywordCandidates = (candidates: string[], limit?: number): string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const splits = splitKeywordCandidates(candidate);
    for (const part of splits) {
      const cleaned = cleanKeywordCandidate(part);
      if (!cleaned) continue;
      const lower = cleaned.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      normalized.push(cleaned);
      if (typeof limit === 'number' && normalized.length >= limit) {
        return normalized;
      }
    }
  }

  return normalized;
};

const buildHeuristicKeywords = (projectName: string, projectDescription: string, limit: number): string[] => {
  const segments = [
    projectName,
    ...projectDescription.split(/[\.\n]+/).filter(Boolean),
  ].filter(Boolean);

  if (segments.length === 0) {
    return [];
  }

  const candidates: string[] = [];

  for (const segment of segments) {
    const cleaned = segment
      .replace(/[^a-zA-Z0-9&\-\+\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (!cleaned) continue;

    const words = cleaned.split(' ').filter(Boolean);
    if (words.length === 0) continue;

    if (words.length >= 2) {
      for (let i = 0; i < words.length; i += 2) {
        const slice = words.slice(i, i + 4);
        if (slice.length >= 2) {
          candidates.push(slice.join(' '));
        }
      }
    } else {
      candidates.push(words[0]);
    }
  }

  if (projectName) {
    const normalizedName = projectName.replace(/[^a-zA-Z0-9&\-\+\s]/g, ' ').trim().toLowerCase();
    if (normalizedName) {
      candidates.push(`${normalizedName} market trends`);
      candidates.push(`${normalizedName} buyer insights`);
    }
  }

  return normalizeKeywordCandidates(candidates, limit);
};

const requestAiKeywordCandidates = async (
  projectName: string,
  projectDescription: string,
  requestedTerms: number,
): Promise<string[]> => {
  const prompt = `ROLE: SEO strategist.

Project: "${projectName || 'Untitled Project'}"
Description:
"""
${projectDescription || 'No description provided.'}
"""

TASK:
- Suggest up to ${requestedTerms} smart starter keywords (2-6 words each).
- Focus on real search phrases the user could paste into a keyword research tool.
- Avoid duplicates and keep the phrasing natural.

Return ONLY a JSON array of strings.`;

  const response = await ai.models.generateContent({
    model: MODEL_FAST,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0.65,
      maxOutputTokens: 800,
    },
  });

  const rawText = response.text?.trim() || '';
  const cleanedText = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const textToParse = cleanedText || rawText;

  try {
    const jsonMatch = textToParse.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const arr = JSON.parse(jsonMatch[0]);
      if (Array.isArray(arr)) {
        return arr.map(item => String(item || ''));
      }
    }
  } catch (error) {
    console.error('Failed to parse AI SEO keywords JSON:', error);
  }

  return textToParse ? [textToParse] : [];
};

// Generate a small set of SEO seed keywords / topic areas for a project so the
// dedicated SEO tab can surface sensible default search terms.
export const generateSeoSeedKeywords = async (
  projectName: string,
  projectDescription: string,
  maxTerms: number = 5,
): Promise<string[]> => {
  const trimmedName = (projectName || '').trim();
  const trimmedDescription = (projectDescription || '').trim();
  const heuristicLimit = Math.max(maxTerms * 2, 6);

  const heuristicKeywords = buildHeuristicKeywords(trimmedName, trimmedDescription, heuristicLimit);

  let aiKeywords: string[] = [];
  try {
    aiKeywords = await requestAiKeywordCandidates(trimmedName, trimmedDescription, heuristicLimit);
  } catch (error) {
    console.error('Failed to generate AI SEO keywords:', error);
  }

  const combined = normalizeKeywordCandidates(
    [...aiKeywords, ...heuristicKeywords],
    maxTerms,
  );

  if (combined.length > 0) {
    return combined;
  }

  // If both AI and heuristics failed to produce anything, fall back to very simple tokens.
  if (heuristicKeywords.length > 0) {
    return heuristicKeywords.slice(0, maxTerms);
  }

  if (trimmedName) {
    return normalizeKeywordCandidates([trimmedName], maxTerms);
  }

  return [];
};

// Background: generate additional draft research topics for a project
export const generateDraftResearchTopicsAlt = async (
  projectName: string,
  projectDescription: string,
  existingTopics: string[] = [],
  project?: ResearchProject
): Promise<string[]> => {
  const client = aiAlt;
  try {
    // Build rich context from existing project data
    let existingResearchContext = '';
    let notesContext = '';
    let tasksContext = '';
    let knowledgeBaseContext = '';

    if (project) {
      // Extract TLDRs and key points from existing sessions
      const sessions = project.researchSessions || [];
      if (sessions.length > 0) {
        const sessionSummaries = sessions.slice(0, 10).map((s, idx) => {
          const report = s.researchReport;
          const tldr = report?.tldr ? report.tldr.substring(0, 200) : '';
          const keyPoints = Array.isArray((report as any)?.keyPoints)
            ? (report as any).keyPoints
              .slice(0, 3)
              .map((kp: any) => {
                if (typeof kp === 'string') return kp.substring(0, 80);
                if (kp?.text) return String(kp.text).substring(0, 80);
                if (kp?.title) return String(kp.title).substring(0, 80);
                return '';
              })
              .filter(Boolean)
              .join('; ')
            : '';
          return `  ${idx + 1}. "${s.topic}": ${tldr}${keyPoints ? ' | Key: ' + keyPoints : ''}`;
        }).join('\n');
        existingResearchContext = `\n\nEXISTING RESEARCH (summarized):\n${sessionSummaries}`;
      }

      // Extract notes context
      const notes = project.notes || [];
      if (notes.length > 0) {
        const notesSummary = notes.slice(0, 5).map(n =>
          `  - ${n.title || 'Untitled'}: ${n.content?.substring(0, 100) || ''}`
        ).join('\n');
        notesContext = `\n\nPROJECT NOTES:\n${notesSummary}`;
      }

      // Extract tasks context (focus on incomplete tasks)
      const tasks = project.tasks || [];
      const incompleteTasks = tasks.filter(t => t.status !== 'done').slice(0, 5);
      if (incompleteTasks.length > 0) {
        const tasksSummary = incompleteTasks.map(t =>
          `  - [${t.priority || 'medium'}] ${t.title}`
        ).join('\n');
        tasksContext = `\n\nOPEN TASKS:\n${tasksSummary}`;
      }

      // Extract knowledge base file names
      const kbFiles = project.knowledgeBase || [];
      if (kbFiles.length > 0) {
        const kbSummary = kbFiles.slice(0, 5).map(f =>
          `  - ${f.name}`
        ).join('\n');
        knowledgeBaseContext = `\n\nKNOWLEDGE BASE FILES:\n${kbSummary}`;
      }
    }

    const existingTopicsContext = existingTopics.length > 0
      ? `\n\nTOPICS ALREADY COVERED (do NOT repeat these or similar):\n${existingTopics.map(t => `  - ${t}`).join('\n')}`
      : '';

    const prompt = `You are a research strategist helping expand a project's research backlog with DIVERSE and VALUABLE topics.

PROJECT NAME: "${projectName}"
PROJECT DESCRIPTION: "${projectDescription}"${existingResearchContext}${notesContext}${tasksContext}${knowledgeBaseContext}${existingTopicsContext}

TASK: Generate 5-8 NEW research draft topics that would be MOST VALUABLE for this project.

REQUIREMENTS:
1. **No repetition**: Each topic must explore an ANGLE NOT COVERED by existing research.
2. **Diverse perspectives**: Include topics from different categories:
   - Market/competitive analysis
   - Technical deep-dives
   - User/audience research
   - Trends and future outlook
   - Practical implementation guides
   - Case studies or examples
3. **Relevant to gaps**: Address knowledge gaps evident from notes, tasks, or missing areas.
4. **Actionable**: Each topic should be specific enough to run a focused research session.
5. **Complementary**: Topics should BUILD ON existing research, not repeat it.

Return ONLY a JSON array of strings, for example:
["Topic 1", "Topic 2", "Topic 3"]`;

    const response = await client.models.generateContent({
      model: MODEL_LITE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.85, // Slightly higher for diversity
        maxOutputTokens: 800,
      },
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const arr = JSON.parse(jsonMatch[0]);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.slice(0, 8).map((s: any) => String(s));
      }
    }
    return [];
  } catch (error) {
    console.error('Failed to generate background draft topics:', error);
    return [];
  }
};

// ========== PRODUCTIVITY AI HELPERS ==========

export interface AITaskSuggestion {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  sourceInsight?: string;
}

export interface AIConfidenceScore {
  score: number;
  level: 'low' | 'medium' | 'high';
  reasoning: string;
  missingElements: string[];
}

export const generateTasksFromResearch = async (
  researchReport: { topic: string; keyPoints: { title: string; details: string }[]; sources?: { title: string }[] },
  projectName: string
): Promise<AITaskSuggestion[]> => {
  try {
    const keyPointsSummary = researchReport.keyPoints
      .slice(0, 5)
      .map(kp => `- ${kp.title}: ${kp.details.substring(0, 100)}...`)
      .join('\n');

    const prompt = `Based on this research report, generate actionable tasks for the project.

Project: "${projectName}"
Research Topic: "${researchReport.topic}"
Key Findings:
${keyPointsSummary}

Generate 3-5 specific, actionable tasks that would help make progress on this project based on the research findings.
For each task, provide:
- A clear, concise title (action-oriented)
- A brief description of what needs to be done
- Priority level (low, medium, or high)
- The key insight from research that inspired this task

Return ONLY valid JSON in this exact format:
[{"title": "...", "description": "...", "priority": "medium", "sourceInsight": "..."}]`;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.7, maxOutputTokens: 800 }
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const tasks = JSON.parse(jsonMatch[0]);
      return tasks.slice(0, 5);
    }
    return [];
  } catch (error) {
    console.error("Failed to generate tasks from research:", error);
    return [];
  }
};

export const generateConfidenceScore = async (
  project: { name: string; description: string; researchSessions: { topic: string; researchReport: { sources?: any[] } }[] }
): Promise<AIConfidenceScore> => {
  try {
    const totalSources = project.researchSessions.reduce(
      (acc, s) => acc + (s.researchReport.sources?.length || 0), 0
    );
    const topics = project.researchSessions.map(s => s.topic).join(', ');

    const prompt = `Evaluate the research confidence for this project.

Project: "${project.name}"
Description: "${project.description}"
Research Topics Covered: ${topics || 'None yet'}
Total Sources Found: ${totalSources}
Number of Research Sessions: ${project.researchSessions.length}

Based on this information, provide:
1. A confidence score from 0-100
2. A level: "low" (0-40), "medium" (41-70), or "high" (71-100)
3. Brief reasoning for the score
4. List of missing elements that would improve confidence

Return ONLY valid JSON:
{"score": 65, "level": "medium", "reasoning": "...", "missingElements": ["..."]}`;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.3, maxOutputTokens: 400 }
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { score: totalSources * 5, level: totalSources > 10 ? 'high' : totalSources > 3 ? 'medium' : 'low', reasoning: 'Based on source count', missingElements: [] };
  } catch (error) {
    console.error("Failed to generate confidence score:", error);
    return { score: 0, level: 'low', reasoning: 'Unable to evaluate', missingElements: ['Complete research analysis'] };
  }
};

export const suggestNoteEnhancements = async (
  noteContent: string,
  projectContext: string
): Promise<string[]> => {
  try {
    const prompt = `You are helping enhance a research note. Provide 3 brief suggestions to improve or expand this note.

Project Context: "${projectContext}"
Current Note Content: "${noteContent.substring(0, 500)}"

Provide exactly 3 short, actionable suggestions (1 sentence each) to make this note more valuable.
Return ONLY a JSON array: ["suggestion 1", "suggestion 2", "suggestion 3"]`;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.7, maxOutputTokens: 300 }
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]).slice(0, 3);
    }
    return [];
  } catch (error) {
    console.error("Failed to suggest note enhancements:", error);
    return [];
  }
};

export const generateQuickNote = async (
  projectName: string,
  projectDescription: string,
  prompt: string
): Promise<{ title: string; content: string } | null> => {
  try {
    const aiPrompt = `Generate a research note for this project.

Project: "${projectName}"
Description: "${projectDescription}"
User Request: "${prompt}"

Create a helpful note with:
- A concise title (5-10 words)
- Detailed content (2-3 paragraphs of useful information)

Return ONLY valid JSON: {"title": "...", "content": "..."}`;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: [{ role: 'user', parts: [{ text: aiPrompt }] }],
      config: { temperature: 0.7, maxOutputTokens: 600 }
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (error) {
    console.error("Failed to generate quick note:", error);
    return null;
  }
};

export const prioritizeTasks = async (
  tasks: { id: string; title: string; description?: string; priority: string }[],
  projectGoal: string
): Promise<{ id: string; suggestedPriority: 'low' | 'medium' | 'high'; reason: string }[]> => {
  try {
    const taskList = tasks.map(t => `- [${t.id}] ${t.title}: ${t.description || 'No description'}`).join('\n');

    const prompt = `Analyze these tasks and suggest priority levels based on the project goal.

Project Goal: "${projectGoal}"
Current Tasks:
${taskList}

For each task, suggest the optimal priority (low, medium, high) and briefly explain why.
Return ONLY valid JSON array: [{"id": "...", "suggestedPriority": "high", "reason": "..."}]`;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.5, maxOutputTokens: 600 }
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (error) {
    console.error("Failed to prioritize tasks:", error);
    return [];
  }
};

export const generateProjectSummary = async (
  project: { name: string; description: string; researchSessions: { topic: string }[]; tasks?: { title: string; status: string }[]; notes?: { title: string }[] }
): Promise<string> => {
  try {
    const researchTopics = project.researchSessions.map(s => s.topic).join(', ') || 'None';
    const completedTasks = project.tasks?.filter(t => t.status === 'done').length || 0;
    const totalTasks = project.tasks?.length || 0;
    const noteCount = project.notes?.length || 0;

    const prompt = `Create a brief, insightful project status summary (2-3 sentences).

Project: "${project.name}"
Description: "${project.description}"
Research Topics: ${researchTopics}
Tasks: ${completedTasks}/${totalTasks} completed
Notes: ${noteCount}

Provide a helpful summary of project progress and next steps.`;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.6, maxOutputTokens: 200 }
    });

    return response.text?.trim() || 'Project in progress.';
  } catch (error) {
    console.error("Failed to generate project summary:", error);
    return 'Unable to generate summary.';
  }
};

export interface ReverifySessionResult {
  sessionId: string;
  isStale: boolean;
  updatedTldr?: string;
  updatedSummary?: string;
  staleReason?: string;
  outdatedItems?: Array<{
    claim: string;
    previous?: string;
    current?: string;
    evidenceUrl?: string;
  }>;
  refreshActions?: string[];
  searchQueries?: string[];
  urlsChecked?: string[];
  error?: string;
}

export const reverifyProjectResearch = async (
  project: ResearchProject
): Promise<ReverifySessionResult[]> => {
  try {
    const sessions = project.researchSessions || [];
    if (!sessions.length) return [];

    const today = new Date().toISOString().split('T')[0];

    const results: ReverifySessionResult[] = [];

    for (const session of sessions) {
      const report = session.researchReport;
      const lastUpdated = new Date(session.lastModified || session.timestamp).toISOString().split('T')[0];
      const tldr = report?.tldr || '';
      const summary = report?.summary || '';
      const keyPoints = Array.isArray((report as any)?.keyPoints)
        ? (report as any).keyPoints
          .slice(0, 12)
          .map((kp: any) => {
            if (typeof kp === 'string') return `- ${kp}`;
            if (kp && typeof kp === 'object') {
              const text = (kp.text || kp.title || kp.point || kp.claim) as any;
              if (typeof text === 'string' && text.trim()) return `- ${text.trim()}`;
              try {
                return `- ${JSON.stringify(kp).slice(0, 200)}`;
              } catch {
                return '- (unreadable key point)';
              }
            }
            return `- ${String(kp)}`;
          })
          .join('\n')
        : '';

      const sources = (report?.sources || [])
        .slice(0, 10)
        .map((src, idx) => {
          const url = (src as any).url || (src as any).uri || '';
          return `  - [${idx + 1}] ${src.title || ''} :: ${url}`;
        })
        .join('\n');

      const prompt = limitUrlsInPrompt(
        `ROLE: Research reverification auditor.\n\n` +
        `TODAY_DATE: ${today}\n` +
        `PROJECT: ${project.name}\n` +
        `PROJECT_DESCRIPTION: ${project.description || ''}\n\n` +
        `TASK:\n` +
        `You must cross-check this saved research session against the latest information available as of TODAY_DATE.\n` +
        `You have access to tools: googleSearch and urlContext.\n\n` +
        `REQUIREMENTS (mandatory):\n` +
        `- Use googleSearch to run at least 2 targeted queries to verify time-sensitive claims, stats, pricing, regulations, product names, or market facts.\n` +
        `- Use urlContext to read the session's cited URLs when possible, and also read any critical URLs you discover.\n` +
        `- Decide if the session is stale (major facts changed) or still valid.\n` +
        `- Return a single JSON object only (no markdown), using this exact schema:\n` +
        `{\n` +
        `  "sessionId": string,\n` +
        `  "isStale": boolean,\n` +
        `  "staleReason"?: string,\n` +
        `  "outdatedItems"?: [{"claim": string, "previous"?: string, "current"?: string, "evidenceUrl"?: string}],\n` +
        `  "refreshActions"?: string[],\n` +
        `  "searchQueries"?: string[],\n` +
        `  "urlsChecked"?: string[],\n` +
        `  "updatedTldr"?: string,\n` +
        `  "updatedSummary"?: string\n` +
        `}\n\n` +
        `IMPORTANT:\n` +
        `- If isStale=false, keep updatedTldr/updatedSummary empty unless there's a clear factual correction.\n` +
        `- If isStale=true, include updatedTldr and updatedSummary with corrected facts.\n` +
        `- Include URLs in urlsChecked that you actually relied on.\n\n` +
        `SESSION:\n` +
        `SESSION_ID: ${session.id}\n` +
        `TOPIC: ${session.topic}\n` +
        `LAST_UPDATED: ${lastUpdated}\n` +
        `TLDR: ${tldr}\n` +
        `SUMMARY: ${summary}\n` +
        `KEY_POINTS:\n${keyPoints || '(none)'}\n\n` +
        `SOURCES:\n${sources || '  - (none)'}\n`,
        20
      );

      try {
        const response = await generateContentFast(
          prompt,
          {
            tools: [{ googleSearch: {} }, { urlContext: {} }],
            temperature: 0,
            responseMimeType: 'application/json',
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingBudget: 0 },
          }
        );

        const rawText = response.text?.trim() || '';
        const jsonObject = extractFirstJsonObject(rawText) || rawText;
        if (!jsonObject) {
          results.push({
            sessionId: session.id,
            isStale: false,
            error: 'Reverify returned no parseable JSON.',
          });
          continue;
        }

        const parsed = JSON.parse(jsonObject);
        const sessionId = String(parsed.sessionId || session.id || '').trim() || session.id;

        const normalized: ReverifySessionResult = {
          sessionId,
          isStale: Boolean(parsed.isStale),
          updatedTldr: parsed.updatedTldr ? String(parsed.updatedTldr) : undefined,
          updatedSummary: parsed.updatedSummary ? String(parsed.updatedSummary) : undefined,
          staleReason: parsed.staleReason ? String(parsed.staleReason) : undefined,
          refreshActions: Array.isArray(parsed.refreshActions) ? parsed.refreshActions.map((v: any) => String(v)) : undefined,
          searchQueries: Array.isArray(parsed.searchQueries) ? parsed.searchQueries.map((v: any) => String(v)) : undefined,
          urlsChecked: Array.isArray(parsed.urlsChecked) ? parsed.urlsChecked.map((v: any) => String(v)) : undefined,
          outdatedItems: Array.isArray(parsed.outdatedItems)
            ? parsed.outdatedItems
              .map((it: any) => {
                if (!it) return null;
                const claim = String(it.claim || '').trim();
                if (!claim) return null;
                return {
                  claim,
                  previous: it.previous ? String(it.previous) : undefined,
                  current: it.current ? String(it.current) : undefined,
                  evidenceUrl: it.evidenceUrl ? String(it.evidenceUrl) : undefined,
                };
              })
              .filter(Boolean)
            : undefined,
        };

        results.push(normalized);
      } catch (err) {
        console.error('Failed to reverify session', session.id, err);
        results.push({
          sessionId: session.id,
          isStale: false,
          error: err instanceof Error ? err.message : 'Unknown error occurred.',
        });
      }
    }

    return results;
  } catch (error) {
    console.error('reverifyProjectResearch failed:', error);
    return [];
  }
};

export interface MagicProjectPlanTask {
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high';
}

export interface MagicProjectPlanNote {
  title: string;
  content: string;
}

export interface MagicProjectPlan {
  projectName: string;
  projectDescription: string;
  researchDraftTopics: string[];
  initialNotes: MagicProjectPlanNote[];
  tasks: MagicProjectPlanTask[];
}

function extractFirstJsonObject(text: string): string | null {
  let inString = false;
  let escape = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function buildMagicProjectFallbackPlan(
  userPrompt: string,
  partialName?: string,
  partialDescription?: string
): MagicProjectPlan {
  const baseName = (partialName || userPrompt || 'New Research Project').trim();
  const projectName = (baseName || 'New Research Project').slice(0, 120);
  const projectDescription = (partialDescription || userPrompt || 'Magic research project').trim();
  const topicBase = projectName || userPrompt || 'the project';

  const topics = [
    `Foundations and key concepts of ${topicBase}`,
    `Current landscape and major players in ${topicBase}`,
    `Key challenges, constraints, and risks in ${topicBase}`,
    `Opportunities, emerging trends, and future directions for ${topicBase}`,
    `Primary use cases and applications of ${topicBase}`,
    `Impact of ${topicBase} on users, markets, and ecosystems`,
    `Prerequisites, technologies, and infrastructure required for ${topicBase}`,
    `Key metrics and success criteria for ${topicBase}`,
  ];

  const researchDraftTopics = Array.from(new Set(topics.map(t => t.slice(0, 200)))).slice(0, 8);

  const overviewText =
    projectDescription ||
    `This project explores ${topicBase}, clarifying why it matters and what outcomes we want.`;

  const initialNotes: MagicProjectPlanNote[] = [
    {
      title: 'Project overview and intent',
      content: `This project focuses on ${topicBase}. The goal is to understand why it matters, how it works today, and what gaps or opportunities exist.\n\n${overviewText}`,
    },
    {
      title: 'Initial research questions',
      content:
        `Start by framing a small set of guiding questions about ${topicBase}. Use the draft research topics as prompts and write down which questions feel most important to answer first.`,
    },
    {
      title: 'Key stakeholders and audiences',
      content:
        `List the main people, organizations, or user groups affected by ${topicBase}. Consider who benefits, who is at risk, and who has power to influence outcomes.`,
    },
    {
      title: 'Assumptions and hypotheses',
      content:
        `Capture your current assumptions about ${topicBase}. What do you believe is true today? Where might those beliefs be wrong? Turn a few of these into testable hypotheses for future research sessions.`,
    },
    {
      title: 'Next steps for exploration',
      content:
        `Outline the very next steps for exploring ${topicBase}. This can include running a deep research session on one draft topic, collecting a small set of source materials, or sketching a simple map of the ecosystem.`,
    },
  ];

  const tasks: MagicProjectPlanTask[] = [
    {
      title: `Clarify objectives for ${topicBase}`,
      description: `Write a short paragraph that explains what you want to learn or decide about ${topicBase}.`,
      priority: 'medium',
    },
    {
      title: `Survey existing knowledge on ${topicBase}`,
      description:
        `Collect 5–10 credible sources that describe the current state of ${topicBase}. Capture key facts and definitions.`,
      priority: 'medium',
    },
    {
      title: `Identify key stakeholders for ${topicBase}`,
      description:
        `List the main stakeholders and audiences impacted by ${topicBase}, and note why they matter.`,
      priority: 'low',
    },
    {
      title: `Draft initial research questions for ${topicBase}`,
      description:
        `Translate the project goals into 5–8 concrete research questions that can guide deep research sessions.`,
      priority: 'high',
    },
    {
      title: `Prioritize draft research topics`,
      description:
        `Review the draft research topics for ${topicBase} and choose 1–2 high-impact topics to investigate first.`,
      priority: 'high',
    },
  ];

  return {
    projectName,
    projectDescription,
    researchDraftTopics,
    initialNotes,
    tasks,
  };
}

const magicProjectPlanJsonSchema = {
  type: "object",
  properties: {
    projectName: {
      type: "string",
      description: "A clear, descriptive project name (max 80 characters).",
    },
    projectDescription: {
      type: "string",
      description: "A concise 2-3 sentence description of the research project.",
    },
    researchDraftTopics: {
      type: "array",
      description: "Exactly 8 specific research draft topics.",
      items: {
        type: "string",
        description: "A focused research question or angle.",
      },
      minItems: 8,
      maxItems: 8,
    },
    initialNotes: {
      type: "array",
      description: "Exactly 5 initial project notes.",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short note title.",
          },
          content: {
            type: "string",
            description: "A short paragraph (3-6 sentences, max ~120 words) of helpful note content.",
          },
        },
        required: ["title", "content"],
      },
      minItems: 5,
      maxItems: 5,
    },
    tasks: {
      type: "array",
      description: "5-10 actionable project tasks.",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Task title.",
          },
          description: {
            type: "string",
            description: "Optional short 1-2 sentence task description (max ~40 words).",
          },
          priority: {
            type: "string",
            description: "Task priority level.",
            enum: ["low", "medium", "high"],
          },
        },
        required: ["title", "priority"],
      },
      minItems: 5,
      maxItems: 10,
    },
  },
  required: [
    "projectName",
    "projectDescription",
    "researchDraftTopics",
    "initialNotes",
    "tasks",
  ],
} as const;

export const generateMagicProjectPlan = async (userPrompt: string): Promise<MagicProjectPlan> => {
  try {
    const prompt = `You are an expert research project planner.

The user wants to create a new research project based on this idea:
"${userPrompt}"

Design a concise project scaffold with:
- A clear, descriptive projectName (max 80 characters)
- A projectDescription (2-3 sentences, keep it concise)
- Exactly 8 researchDraftTopics: specific research questions or angles
- Exactly 5 initialNotes: each with a short title and a single concise paragraph (3-6 sentences, max ~120 words)
- 5-10 tasks: each with title, optional short 1-2 sentence description (max ~40 words), and priority (low|medium|high)

Important style rules:
- Do NOT simply repeat the user idea text as the projectName.
- Rewrite the projectName so it reads like a focused, descriptive research project title.
- Rewrite the projectDescription in your own words as 2-3 sentences expanding on the idea.
- Keep all content compact so the full JSON stays relatively short.

Return ONLY valid JSON in this exact shape:
{
  "projectName": "...",
  "projectDescription": "...",
  "researchDraftTopics": ["topic 1", "topic 2", ... up to 8],
  "initialNotes": [
    { "title": "...", "content": "..." }
  ],
  "tasks": [
    { "title": "...", "description": "...", "priority": "low|medium|high" }
  ]
}`;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
        responseJsonSchema: magicProjectPlanJsonSchema,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      }
    });

    const text = response.text?.trim() || '';

    let raw: any;
    try {
      // Primary path: responseMimeType 'application/json' should give us
      // clean JSON we can parse directly.
      raw = JSON.parse(text);
    } catch (primaryError) {
      // Fallback: some models may still emit explanations or slightly
      // malformed JSON. Try to salvage the first JSON object and clean
      // obvious trailing commas before giving up.
      try {
        const extracted = extractFirstJsonObject(text);
        if (!extracted) throw primaryError;
        const cleaned = extracted.replace(/,\s*([}\]])/g, '$1');
        raw = JSON.parse(cleaned);
      } catch (secondaryError) {
        console.warn(
          'Magic project plan JSON parse failed; attempting to salvage fields from raw text. Message:',
          (secondaryError as any)?.message || secondaryError
        );

        // Try to at least recover projectName and projectDescription directly from the raw text,
        // even if the rest of the JSON (arrays, tasks, etc.) is malformed.
        let partialName: string | undefined;
        let partialDescription: string | undefined;
        try {
          const nameMatch = text.match(/"projectName"\s*:\s*"([^\"]*)"/);
          const descMatch = text.match(/"projectDescription"\s*:\s*"([^\"]*)"/);
          partialName = nameMatch?.[1]?.trim();
          partialDescription = descMatch?.[1]?.trim();
        } catch (regexError) {
          console.warn('Magic project plan regex salvage failed:', regexError);
        }

        try {
          // Log a small slice of the raw text to help debug formatting issues without flooding the console.
          console.warn('Magic project plan raw text (first 400 chars):', text.slice(0, 400));
        } catch {
          // Ignore logging failures.
        }

        // If we managed to recover at least one of the key fields, build a partial plan from that
        // so the project title/description still benefit from the AI output.
        if (partialName || partialDescription) {
          return buildMagicProjectFallbackPlan(userPrompt, partialName, partialDescription);
        }

        return buildMagicProjectFallbackPlan(userPrompt);
      }
    }

    const researchDraftTopics = Array.isArray(raw.researchDraftTopics)
      ? raw.researchDraftTopics.map((t: any) => String(t)).slice(0, 8)
      : [];

    const initialNotes: MagicProjectPlanNote[] = Array.isArray(raw.initialNotes)
      ? raw.initialNotes.slice(0, 5).map((n: any) => ({
        title: String(n?.title || 'Note'),
        content: String(n?.content || '')
      }))
      : [];

    const tasks: MagicProjectPlanTask[] = Array.isArray(raw.tasks)
      ? raw.tasks.slice(0, 10).map((t: any) => {
        const priority = String(t?.priority || 'medium').toLowerCase();
        const normalized: 'low' | 'medium' | 'high' =
          priority === 'high' || priority === 'low' ? (priority as any) : 'medium';
        return {
          title: String(t?.title || 'New task'),
          description: t?.description ? String(t.description) : undefined,
          priority: normalized
        };
      })
      : [];

    return {
      projectName: String(raw.projectName || (userPrompt || 'New Research Project')).slice(0, 120),
      projectDescription: String(raw.projectDescription || userPrompt || ''),
      researchDraftTopics,
      initialNotes,
      tasks
    };
  } catch (error) {
    console.error('Failed to generate magic project plan:', error);
    // Fallback: minimal plan derived from the user prompt
    return {
      projectName: (userPrompt || 'New Research Project').slice(0, 120),
      projectDescription: userPrompt || 'Magic research project',
      researchDraftTopics: userPrompt ? [userPrompt] : [],
      initialNotes: [],
      tasks: []
    };
  }
};

// Tool Definition for Live API: Website Generation
export const generateWebsiteTool: FunctionDeclaration = {
  name: "generate_website",
  description: "Generates the website code based on a detailed technical specification. Use this to build the final app.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      specification: {
        type: Type.STRING,
        description: "The detailed content, design rules, and technical requirements for the website.",
      },
    },
    required: ["specification"],
  },
};

export const editWebsiteTool: FunctionDeclaration = {
  name: "edit_website",
  description: "Edits the existing website HTML in Builder mode based on a natural-language instruction, preserving the existing structure and only making the requested change(s).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      instruction: {
        type: Type.STRING,
        description: "The specific change to apply to the existing website (for example: 'make the hero CTA button blue and larger', 'replace the pricing section with three equal cards').",
      },
    },
    required: ["instruction"],
  },
};

// Tool Definition: Wiza Prospect Search
const wizaProspectSearchTool: FunctionDeclaration = {
  name: "wiza_prospect_search",
  description:
    "Searches for companies and prospects via the Wiza API. Use this when the research topic clearly involves go-to-market, ICP, sales prospects, or target companies (e.g., 'VPs of Sales at B2B SaaS companies', 'CFOs at fintech startups in Toronto').",
  parameters: {
    type: Type.OBJECT,
    properties: {
      filters: {
        type: Type.OBJECT,
        description:
          "Raw Wiza filters object, passed directly to Wiza prospect search. Use supported keys like job_title, job_role, location, company_location, company_size, company_industry, year_founded_start, year_founded_end, etc.",
      },
      size: {
        type: Type.NUMBER,
        description:
          "Number of results to return (max 30). Defaults to 10.",
      },
    },
    required: ["filters"],
  },
};

// Tool Definition for Live API: Deep Research
export const generateResearchReportTool: FunctionDeclaration = {
  name: "generate_research_report",
  description: "Performs rigorous, multi-step deep research on a topic. It cross-checks facts across extensive sources, verified recent data, and generates a verified report.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      topic: {
        type: Type.STRING,
        description: "The main topic or question to research deeply.",
      },
    },
    required: ["topic"],
  },
};

// Tool Definition for Live API: Switch to Builder
export const switchToBuilderTool: FunctionDeclaration = {
  name: "switch_to_builder",
  description: "Switches the application to Builder mode to create a website based on the research. Call this when the user is satisfied with the research and wants to build.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      researchContext: {
        type: Type.STRING,
        description: "A comprehensive summary of the research findings, key points, and requirements to be used as the basis for the website specification.",
      },
    },
    required: ["researchContext"],
  },
};

// ========== NEW APP CONTROL TOOLS ==========

// Tool: Toggle Dark/Light Mode
export const toggleDarkModeTool: FunctionDeclaration = {
  name: "toggle_dark_mode",
  description: "Toggles the application between dark mode and light mode. Use this when the user asks to switch themes, turn on dark mode, or make it lighter/darker.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      mode: {
        type: Type.STRING,
        description: "The mode to set: 'dark', 'light', or 'toggle' (to flip the current mode).",
      },
    },
  },
};

// Tool: Switch Tab / Navigate
export const switchTabTool: FunctionDeclaration = {
  name: "switch_tab",
  description: "Navigates to a different tab/mode in the application. Available tabs: 'researcher' (research mode), 'builder' (website builder), 'notemap' (mind map/notes), 'create' (social media & blog content).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      tab: {
        type: Type.STRING,
        description: "The tab to switch to: 'researcher', 'builder', 'notemap', or 'create'.",
      },
    },
    required: ["tab"],
  },
};

// Tool: Open Library
export const openLibraryTool: FunctionDeclaration = {
  name: "open_library",
  description: "Opens the Library panel to show saved projects, research reports, and website versions. Use when user wants to see their saved work or history.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

// Tool: Close Library
export const closeLibraryTool: FunctionDeclaration = {
  name: "close_library",
  description: "Closes the Library panel if it's open.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

// Tool: Scroll to Section
export const scrollToSectionTool: FunctionDeclaration = {
  name: "scroll_to_section",
  description: "Scrolls the research report to a specific section. Sections include: 'summary', 'executive', 'analysis', 'slides', 'financials', 'timeline', 'sources', 'dynamic', 'game', 'videos', or use a section title.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      section: {
        type: Type.STRING,
        description: "The section ID or title to scroll to (e.g., 'summary', 'analysis', 'sources', 'game').",
      },
    },
    required: ["section"],
  },
};

// Tool: Play Educational Game
export const playGameTool: FunctionDeclaration = {
  name: "play_game",
  description: "Opens and starts the educational game (Fun Zone) generated from the research. Use when the user wants to play the game or learn interactively.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

// Tool: Toggle Code View
export const toggleCodeViewTool: FunctionDeclaration = {
  name: "toggle_code_view",
  description: "Toggles between showing the code editor and the website preview in Builder mode.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      show: {
        type: Type.STRING,
        description: "What to show: 'code' (show code editor), 'preview' (show website preview), or 'toggle' (flip current view).",
      },
    },
  },
};

// Tool: Toggle Fullscreen Preview
export const toggleFullscreenTool: FunctionDeclaration = {
  name: "toggle_fullscreen",
  description: "Toggles fullscreen mode for the website preview or research report view.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

// Tool: Clear/Reset Workspace
export const clearWorkspaceTool: FunctionDeclaration = {
  name: "clear_workspace",
  description: "Clears or resets the current workspace. Use with caution - this will clear unsaved work.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      confirm: {
        type: Type.BOOLEAN,
        description: "Must be true to confirm the clear action.",
      },
    },
    required: ["confirm"],
  },
};

// Tool: Expand/Collapse Research Section
export const toggleSectionTool: FunctionDeclaration = {
  name: "toggle_section",
  description: "Expands or collapses a section in the research report view. Useful for focusing on specific content.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      section: {
        type: Type.STRING,
        description: "The section to toggle: 'analysis', 'timeline', 'sources', 'financials', 'videos', 'slides'.",
      },
      action: {
        type: Type.STRING,
        description: "Action to perform: 'expand', 'collapse', or 'toggle'.",
      },
    },
    required: ["section"],
  },
};

// Tool: Start New Research
export const startNewResearchTool: FunctionDeclaration = {
  name: "start_new_research",
  description: "Clears the current research and prepares for a new research topic. Use when the user wants to research something completely new.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

// Tool: Save Current Work
export const saveWorkTool: FunctionDeclaration = {
  name: "save_work",
  description: "Saves the current research report or website to the Library for later access.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: {
        type: Type.STRING,
        description: "Optional custom name for the saved project.",
      },
    },
  },
};

// Tool: Read Current Content Aloud (describe what's on screen)
export const describeScreenTool: FunctionDeclaration = {
  name: "describe_screen",
  description: "Describes the current screen content to the user. Use when the user asks 'what am I looking at' or wants a summary of what's visible.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

// Tool: Zoom In/Out
export const zoomTool: FunctionDeclaration = {
  name: "zoom",
  description: "Adjusts the zoom level of the preview or content area.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: "Zoom action: 'in', 'out', or 'reset' (to 100%).",
      },
    },
    required: ["action"],
  },
};

// Tool: Copy Content
export const copyContentTool: FunctionDeclaration = {
  name: "copy_content",
  description: "Copies content to the clipboard. Can copy the website code, research summary, or specific sections.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      what: {
        type: Type.STRING,
        description: "What to copy: 'code' (website HTML), 'summary' (research summary), 'all' (full research report).",
      },
    },
    required: ["what"],
  },
};

// Tool: Set Voice Speed
export const setVoiceSpeedTool: FunctionDeclaration = {
  name: "set_voice_speed",
  description: "Adjusts the AI voice response speed. Use when user wants faster or slower responses.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      speed: {
        type: Type.STRING,
        description: "Speed setting: 'slow', 'normal', or 'fast'.",
      },
    },
    required: ["speed"],
  },
};

const newsSearchTool: FunctionDeclaration = {
  name: "news_search",
  description:
    "Searches recent news articles via Google News search (RSS). Use this when the research topic benefits from timely coverage, recent developments, announcements, regulatory actions, controversies, or breaking updates.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      q: {
        type: Type.STRING,
        description:
          "Google News search query (Google-style syntax). Use quotes for exact match when needed. Keep under ~200 characters.",
      },
      from: {
        type: Type.STRING,
        description:
          "Optional start date (YYYY-MM-DD). Will be applied as a Google query operator (after:YYYY-MM-DD) when supported.",
      },
      to: {
        type: Type.STRING,
        description:
          "Optional end date (YYYY-MM-DD). Will be applied as a Google query operator (before:YYYY-MM-DD) when supported.",
      },
      language: {
        type: Type.STRING,
        description:
          "Language code (e.g. en).",
      },
      sortBy: {
        type: Type.STRING,
        description:
          "Sort order hint. May be ignored by Google News RSS.",
      },
      pageSize: {
        type: Type.NUMBER,
        description:
          "Number of results to return (max 50).",
      },
    },
    required: ["q"],
  },
};

// Tool Definition: Crypto Price Fetcher
const cryptoPriceTool: FunctionDeclaration = {
  name: "get_crypto_price",
  description: "Fetches the current price of a cryptocurrency in USD. ONLY use this when the user EXPLICITLY asks for crypto prices, investment information, portfolio tracking, or mentions wanting to buy/sell/trade cryptocurrency. Do NOT use for general blockchain technology, Web3 development, or crypto industry research unless the user specifically requests price data.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: {
        type: Type.STRING,
        description: "The cryptocurrency symbol (e.g., BTC, ETH, SOL).",
      },
    },
    required: ["symbol"],
  },
};

// Tool Definition: Stock Price Fetcher (Simulating yfinance)
const stockPriceTool: FunctionDeclaration = {
  name: "get_stock_price",
  description: "Fetches the current stock price and detailed market data (open, high, low, volume) for a given ticker symbol. ONLY use this when the user EXPLICITLY asks for stock prices, investment information, trading data, or financial performance metrics. Do NOT use for general company research, product reviews, or industry analysis unless the user specifically requests stock/market data. Identify the correct TICKER first (e.g. AAPL, MSFT, GOOG).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: {
        type: Type.STRING,
        description: "The stock ticker symbol (e.g., AAPL, MSFT, GOOG).",
      },
    },
    required: ["symbol"],
  },
};

// Tool Definition: Remote Job Search
const searchRemoteJobsTool: FunctionDeclaration = {
  name: "search_remote_jobs",
  description: "Searches for the latest remote job listings via Jobicy API. ONLY use this when the user EXPLICITLY asks for job listings, career opportunities, job searching, hiring information, or employment openings. Keywords that indicate job search intent include: 'jobs', 'hiring', 'career', 'employment', 'work opportunities', 'open positions', 'job market'. Do NOT use for general industry research, company analysis, skill development, or career advice topics unless jobs are explicitly requested.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      tag: {
        type: Type.STRING,
        description: "Keyword/Tag to search for (e.g., 'python', 'seo', 'writer', 'design').",
      },
      geo: {
        type: Type.STRING,
        description: "Geographic region filter (e.g., 'usa', 'canada', 'uk', 'emea', 'latam', 'apac').",
      },
      industry: {
        type: Type.STRING,
        description: "Job category/industry (e.g., 'marketing', 'dev', 'copywriting', 'supporting', 'hr').",
      },
      count: {
        type: Type.NUMBER,
        description: "Number of jobs to return (default 20, max 50).",
      }
    },
  },
};

// Helper to fetch crypto price
async function getCryptoPrice(symbol: string): Promise<any> {
  try {
    const res = await fetch(`https://min-api.cryptocompare.com/data/price?fsym=${symbol.toUpperCase()}&tsyms=USD`);
    const data = await res.json();
    return data;
  } catch (e) {
    console.error("Crypto fetch error", e);
    return { error: "Failed to fetch price" };
  }
}

const toYmd = (value?: string): string | null => {
  if (!value) return null;
  const trimmed = String(value).trim();
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const withGoogleDateOperators = (q: string, from?: string, to?: string): string => {
  const base = (q || '').trim();
  if (!base) return base;
  const after = toYmd(from);
  const before = toYmd(to);
  const extras: string[] = [];
  if (after) extras.push(`after:${after}`);
  if (before) extras.push(`before:${before}`);
  return extras.length ? `${base} ${extras.join(' ')}`.trim() : base;
};

const braveImageSearchTool: FunctionDeclaration = {
  name: "brave_image_search",
  description:
    "Searches for relevant images via the app's Brave Image Search endpoint. Use this to fetch real image URLs (thumbnails + source pages) that can be embedded into report sections (news_gallery, artwork_gallery, creative_showcase, etc.).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      q: {
        type: Type.STRING,
        description: "Image search query. Keep it short and specific (entity + context + 'photo'/'diagram'/'logo').",
      },
      count: {
        type: Type.NUMBER,
        description: "Number of images to return (1-10). Defaults to 6.",
      },
      safesearch: {
        type: Type.STRING,
        description: "Safe search mode: strict|moderate|off. Defaults to strict.",
      },
    },
    required: ["q"],
  },
};

async function fetchBraveImages(params: { q: string; count?: number; safesearch?: string }): Promise<any> {
  try {
    const q = (params.q || '').toString().trim();
    if (!q) return { error: 'Missing q' };

    const count = typeof params.count === 'number' ? params.count : 6;
    const safesearch = params.safesearch ? String(params.safesearch) : 'strict';

    const qs = new URLSearchParams({
      q,
      count: String(Math.max(1, Math.min(10, count))),
      safesearch,
    });

    const response = await authFetch(`/api/brave-search?${qs.toString()}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { error: `Brave search failed: ${response.status}`, details: text };
    }

    const raw = await response.json();
    const results = Array.isArray((raw as any)?.results) ? (raw as any).results : [];

    // Normalize down to a stable, small schema for the model.
    const normalized = results.slice(0, 10).map((r: any) => ({
      title: (r?.title || '').toString(),
      url: (r?.url || r?.properties?.url || '').toString(),
      source: (r?.source || '').toString(),
      thumbnail: {
        src: (r?.thumbnail?.src || '').toString(),
        width: typeof r?.thumbnail?.width === 'number' ? r.thumbnail.width : undefined,
        height: typeof r?.thumbnail?.height === 'number' ? r.thumbnail.height : undefined,
      },
    })).filter((r: any) => r.thumbnail?.src || r.url);

    return {
      query: q,
      results: normalized,
    };
  } catch (e: any) {
    return { error: e?.message || 'Brave search error' };
  }
}

// Helper to fill missing images in dynamic sections using Brave
async function fillMissingSectionImagesWithBrave(reportData: ResearchReport, onUpdate?: (type: string, message: string) => void) {
  if (!reportData.dynamicSections) return;

  // Expanded list of gallery types to check
  const galleryTypes = [
    'news_gallery', 'entity_logo_wall', 'key_people_gallery',
    'chart_image_gallery', 'product_showcase', 'artwork_gallery',
    'creative_showcase', 'book_shelf', 'movie_cast', 'game_roster',
    'location_list', 'event_agenda', 'mood_board', 'testimonial_grid',
    'comparative_analysis' // Sometimes has visuals
  ];

  let fetchCount = 0;
  // Increased limit to 40 to cover more cards in comprehensive reports
  const MAX_FETCH_LIMIT = 40;

  for (const section of reportData.dynamicSections) {
    if (!section || !section.type || !galleryTypes.includes(section.type)) continue;

    let items: any[] = [];
    // Map section types to their specific content arrays
    if (section.type === 'news_gallery') items = section.content?.articles;
    else if (section.type === 'entity_logo_wall') items = section.content?.entities;
    else if (section.type === 'key_people_gallery') items = section.content?.people;
    else if (section.type === 'chart_image_gallery') items = section.content?.images;
    else if (section.type === 'product_showcase') items = section.content?.products;
    else if (section.type === 'artwork_gallery') items = section.content?.works;
    else if (section.type === 'creative_showcase') items = section.content?.items;
    else if (section.type === 'book_shelf') items = section.content?.books;
    else if (section.type === 'movie_cast') items = section.content?.cast;
    else if (section.type === 'game_roster') items = section.content?.characters;
    else if ((section.type as string) === 'location_list') items = section.content?.locations;
    else if (section.type === 'event_agenda') items = section.content?.events;
    else if (section.type === 'mood_board') items = section.content?.items;
    else if ((section.type as string) === 'testimonial_grid') items = section.content?.testimonials;

    if (Array.isArray(items)) {
      for (const item of items) {
        // Skip if already has an image
        if (item.imageUrl || item.image_url) continue;

        // Construct search query from available fields
        const queryCandidate = item.imageQuery || item.name || item.title || item.headline || item.actor || item.product || item.work || item.book || item.location;

        if (queryCandidate && typeof queryCandidate === 'string') {
          // Limit total extra fetches
          if (fetchCount >= MAX_FETCH_LIMIT) break;

          fetchCount++;
          if (fetchCount === 1) onUpdate?.('tool', '🖼️ Filling missing card images via Brave...');
          if (fetchCount % 5 === 0) onUpdate?.('tool', `🖼️ Fetched ${fetchCount} images...`);

          try {
            // Append context to query if generic
            let finalQuery = queryCandidate;
            if (section.type === 'entity_logo_wall') finalQuery += ' logo';
            else if (section.type === 'key_people_gallery') finalQuery += ' portrait';
            else if (section.type === 'news_gallery') finalQuery += ' news';

            const res = await fetchBraveImages({ q: finalQuery, count: 1 });
            if (res && Array.isArray(res.results) && res.results.length > 0) {
              const hit = res.results[0];
              const url = hit.thumbnail?.src || hit.url;
              if (url) {
                item.imageUrl = url;
                // Normalize alternate keys just in case
                item.image_url = url;
              }
            }
          } catch (e) {
            console.warn(`Failed individual image fetch for "${queryCandidate}"`, e);
          }
        }
      }
    }
  }
}

async function fetchNewsArticles(params: { q: string; from?: string; to?: string; language?: string; sortBy?: string; pageSize?: number }): Promise<any> {
  try {
    const q = withGoogleDateOperators(params.q, params.from, params.to);
    const res = await authFetch('/api/news-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'everything',
        q,
        language: params.language,
        pageSize: params.pageSize,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { error: text || `News search failed: ${res.status}` };
    }

    return res.json();
  } catch (e: any) {
    console.error('News search error', e);
    return { error: e?.message || 'News search failed' };
  }
}

// Helper to fetch stock price (Yahoo Finance via Proxy)
async function getStockPrice(symbol: string): Promise<any> {
  try {
    const cleanSymbol = symbol.trim().toUpperCase();
    // Use corsproxy.io to bypass CORS for Yahoo Finance API
    // This mimics yfinance's data source
    const proxyUrl = "https://corsproxy.io/?";
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${cleanSymbol}?interval=1d&range=1d`;
    const res = await fetch(proxyUrl + encodeURIComponent(targetUrl));
    const data = await res.json();

    const result = data?.chart?.result?.[0];
    if (result && result.meta) {
      const meta = result.meta;
      return {
        symbol: meta.symbol,
        price: meta.regularMarketPrice,
        currency: meta.currency,
        exchange: meta.exchangeName,
        marketTime: new Date(meta.regularMarketTime * 1000).toLocaleString(),
        previousClose: meta.previousClose,
        open: meta.regularMarketOpen,
        dayHigh: meta.regularMarketDayHigh,
        dayLow: meta.regularMarketDayLow,
        volume: meta.regularMarketVolume
      };
    }
    return { error: `No stock data found for ${cleanSymbol}` };
  } catch (e) {
    console.error("Stock fetch error", e);
    return { error: "Failed to fetch stock price" };
  }
}

// Helper to fetch remote jobs - Exported for UI usage
export async function fetchRemoteJobs(params: { tag?: string; geo?: string; industry?: string; count?: number }): Promise<any> {
  try {
    const url = new URL("https://jobicy.com/api/v2/remote-jobs");
    if (params.count) url.searchParams.append("count", params.count.toString());
    if (params.geo) url.searchParams.append("geo", params.geo);
    if (params.industry) url.searchParams.append("industry", params.industry);
    if (params.tag) url.searchParams.append("tag", params.tag);

    const res = await fetch(url.toString());
    const data = await res.json();
    return data;
  } catch (e) {
    console.error("Job search error", e);
    return { error: "Failed to fetch jobs. API might be down or rate limited." };
  }
}

// YouTube Search using official YouTube Data API v3
export async function searchYoutubeVideos(keyword: string): Promise<YoutubeVideo[]> {
  try {
    const params = new URLSearchParams({
      q: keyword,
      maxResults: '8',
      type: 'video',
      order: 'relevance',
      videoDuration: 'medium', // Prefer 4-20 min videos for educational content
    });

    const response = await authFetch(`/api/google?op=youtube-search&${params.toString()}`);

    if (!response.ok) {
      console.warn('YouTube API search failed:', response.status);
      return [];
    }

    const data = await response.json();

    // Transform API response to YoutubeVideo format
    const videos: YoutubeVideo[] = (data.videos || []).map((v: any) => ({
      id: v.id,
      title: v.title,
      thumbnail: v.thumbnail,
      channel: v.channel,
      views: '', // YouTube Search API doesn't return view counts (need videos.list for that)
      duration: '', // Would need videos.list API call for duration
      description: v.description,
      publishedAt: v.publishedAt,
    }));

    return videos;
  } catch (error) {
    console.error("YouTube search failed", error);
    return [];
  }
}




// Analyze a YouTube video using Gemini via backend API
// Analyze a YouTube video using Gemini Video Understanding
export async function analyzeYoutubeVideo(videoUrl: string, topic: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    // 1. Process as a YouTube URL for Gemini Video Understanding
    // Documentation: file_data: { file_uri: 'https://www.youtube.com/watch?v=...' }
    // MimeType must be 'video/mp4' (or 'video/*') for YouTube URLs

    // Safety check for empty URL
    if (!videoUrl || !videoUrl.trim()) {
      return "No video URL provided.";
    }

    const response = await ai.models.generateContent({
      model: MODEL_SMART, // gemini-1.5-pro or gemini-2.0-flash-exp usually best for video
      contents: [{
        parts: [
          {
            fileData: {
              fileUri: videoUrl,
              mimeType: 'video/mp4'
            }
          },
          {
            text: `Analyze this YouTube video in the context of the user's research topic: "${topic}".
            
            Provide a detailed analysis including:
            1. A concise summary of the video's main points.
            2. Key insights, facts, or arguments relevant to the topic.
            3. Detailed breakdown of any important steps, methods, or concepts explained.
            4. Notable quotes or statements if applicable.
            
            Format the output as a clear, structured Markdown section that can be directly inserted into a research report.`
          }
        ]
      }]
    });

    const text = response.text;
    if (!text) {
      console.warn('Gemini video analysis returned empty text', videoUrl);
      return "Video analysis yielded no results.";
    }

    return text.trim();

  } catch (error) {
    console.error("Gemini YouTube video analysis failed", error);
    // Fallback? Or just return error message as a string for the report.
    // Use a friendlier message if it's a known issue (e.g., token limit, safety).
    return `Unable to analyze video content directly. (Error: ${(error as any).message || 'Unknown'})`;
  }
}


// NEW: Analyze Document or Image (General Purpose)
// Per Gemini API docs: inlineData works for files < 20 MB
// For larger files, would need to use Gemini Files API
const MAX_INLINE_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export const analyzeDocument = async (file: File): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  if (file.size > MAX_INLINE_FILE_SIZE) {
    console.warn(`File ${file.name} exceeds 20MB limit for inline data. Extracting text summary only.`);
    return `[Large file: ${file.name}] - File exceeds 20MB size limit for direct analysis. Consider uploading a smaller file or text summary.`;
  }

  try {
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const res = e.target?.result as string;
        // res is data:mime;base64,....
        const data = res.split(',')[1];
        resolve(data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const response = await generateContentFast({
      parts: [
        {
          inlineData: {
            mimeType: file.type,
            data: base64Data
          }
        },
        {
          text: `Analyze this document or image thoroughly. 
                      
                      Provide:
                      1. A concise summary of the key content and purpose
                      2. Important data points, facts, figures, or statistics mentioned
                      3. Key themes or topics covered
                      4. Any notable conclusions or recommendations
                      
                      Format your response as structured text that can be used as reference context for research.`
        }
      ]
    });
    return response.text || "Analysis failed to generate text.";
  } catch (e) {
    console.error("Document analysis failed", e);
    return "Failed to analyze document.";
  }
};


// Stream the website code generation with error propagation
export const streamWebsiteCode = async (spec: string, theme: DualTheme | undefined, onChunk: (text: string) => void): Promise<string> => {
  const streamAi = new GoogleGenAI({ apiKey: process.env.API_KEY });

  if (!spec) {
    throw new Error("Specification provided to generate_website was empty.");
  }

  let themeContext = "";
  if (theme) {
    themeContext = `
    DESIGN THEME (Extracted from Brand Imagery):
    
    LIGHT MODE PALETTE:
    - Primary: ${theme.light.primary}
    - Secondary: ${theme.light.secondary}
    - Accent: ${theme.light.accent}
    - Background: ${theme.light.background}
    - Surface: ${theme.light.surface}
    - Text: ${theme.light.text}

    DARK MODE PALETTE:
    - Primary: ${theme.dark.primary}
    - Secondary: ${theme.dark.secondary}
    - Accent: ${theme.dark.accent}
    - Background: ${theme.dark.background}
    - Surface: ${theme.dark.surface}
    - Text: ${theme.dark.text}
    
    IMPORTANT: Implement system-preference aware dark mode using Tailwind's 'dark:' modifier.
    `;
  }

  try {
    const streamContents = {
      parts: [
        { text: "You are an ELITE Frontend Engineer and UI/UX Designer creating STUNNING, award-winning websites." },
        { text: `SPECIFICATION:\n${spec}` },
        { text: themeContext },
        {
          text: `TECHNICAL REQUIREMENTS:
          - OUTPUT ONLY RAW HTML CODE. Do not wrap in markdown \`\`\` code blocks.
          - Use Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
          - Include all logic in internal <script> tags.
          - NO explanations, just code.
          
          **MANDATORY VISUAL EXCELLENCE**:
          1. **Hero Section**: Large, impactful hero with gradient backgrounds, animated text, or parallax effects.
          2. **Typography**: Use Google Fonts (Inter, Poppins, or Playfair Display). Mix font weights creatively.
          3. **Animations**: Add CSS animations and transitions:
             - Fade-in on scroll (Intersection Observer)
             - Hover effects on cards (scale, shadow lift, color shift)
             - Smooth page transitions
             - Loading animations
          4. **Glassmorphism**: Use backdrop-blur, semi-transparent backgrounds where appropriate.
          5. **Gradients**: Use modern gradient combinations (mesh gradients, radial gradients).
          6. **Shadows**: Layered shadows for depth (shadow-lg, shadow-2xl with color tints).
          7. **Spacing**: Generous whitespace, asymmetric layouts for visual interest.
          8. **Icons**: Use Heroicons or Lucide via CDN for beautiful icons.
          9. **Cards**: Modern card designs with hover states and subtle borders.
          10. **Buttons**: Gradient buttons, pill shapes, with hover animations.
          
          **MOBILE-FIRST RESPONSIVE**:
          - All layouts must work perfectly on mobile (320px) to desktop (1920px+).
          - Use Tailwind responsive prefixes (sm:, md:, lg:, xl:).
          - Touch-friendly buttons (min 44px tap targets).
          
          **INTERACTIVITY**:
          - Smooth scroll behavior.
          - Interactive elements with visual feedback.
          - Micro-interactions (button ripples, icon animations).
          
          **REAL-TIME DATA APIs**:
          - **CRYPTO**: \`https://min-api.cryptocompare.com/data/price?fsym={SYMBOL}&tsyms=USD\`
          - **STOCKS**: \`https://corsproxy.io/?https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?interval=1d&range=1d\` (Parse chart.result[0].meta.regularMarketPrice)
          
          CREATE A WEBSITE THAT LOOKS LIKE IT WAS DESIGNED BY A TOP AGENCY.` }
      ]
    };

    let response;
    try {
      // Attempt with Super Fast (Gemini 3 Flash)
      response = await streamAi.models.generateContentStream({
        model: MODEL_SUPER_FAST,
        contents: streamContents
      });
    } catch (err) {
      console.warn(`[streamWebsiteCode] ${MODEL_SUPER_FAST} failed, falling back to ${MODEL_FAST}`, err);
      // Fallback to Fast (Gemini 2.5 Flash)
      response = await streamAi.models.generateContentStream({
        model: MODEL_FAST,
        contents: streamContents
      });
    }

    let fullText = "";
    for await (const chunk of response) {
      const text = chunk.text;
      if (text) {
        fullText += text;
        onChunk(text);
      }
    }

    if (!fullText) {
      throw new Error("Generated content was empty.");
    }

    return fullText;

  } catch (error) {
    console.error("Stream generation error:", error);
    throw error;
  }
};

// Lead Form Field interface (copy from types for local use)
interface LeadFormFieldSpec {
  id: string;
  name: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox';
  required: boolean;
  placeholder?: string;
  options?: string[];
}

// Stream the lead form website code generation
export const streamLeadFormWebsite = async (
  prompt: string,
  fields: LeadFormFieldSpec[],
  formId: string,
  slug: string,
  projectId: string,
  formTitle: string,
  onChunk: (text: string) => void,
  logoUrl?: string,
  images?: string[] // Array of base64 strings
): Promise<string> => {
  const streamAi = new GoogleGenAI({ apiKey: process.env.API_KEY });

  if (!prompt) {
    throw new Error("Prompt for lead form generation was empty.");
  }

  // Build field specifications for the AI
  const fieldSpecs = fields.map(f => {
    let spec = `- ${f.label} (${f.type}${f.required ? ', required' : ', optional'})`;
    if (f.placeholder) spec += ` placeholder: "${f.placeholder}"`;
    if (f.options?.length) spec += ` options: [${f.options.join(', ')}]`;
    return spec;
  }).join('\n');

  // Build the submission script that will be embedded in the generated HTML
  const submissionScript = `
<script>
  document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('lead-form');
    const submitBtn = document.getElementById('submit-btn');
    const successMsg = document.getElementById('success-message');
    const errorMsg = document.getElementById('error-message');
    const formContainer = document.getElementById('form-container');
    
    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Submitting...';
        }
        
        const formData = new FormData(form);
        const data = {};
        formData.forEach((value, key) => {
          data[key] = value;
        });
        
        try {
          const response = await fetch('/api/websites?op=submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              formId: '${formId}',
              slug: '${slug}',
              projectId: '${projectId}',
              formTitle: '${formTitle.replace(/'/g, "\\'")}',
              data: data
            })
          });
          
          if (response.ok) {
            if (formContainer) formContainer.style.display = 'none';
            if (successMsg) successMsg.style.display = 'block';
          } else {
            throw new Error('Submission failed');
          }
        } catch (err) {
          if (errorMsg) {
            errorMsg.style.display = 'block';
            errorMsg.textContent = 'Something went wrong. Please try again.';
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit';
          }
        }
      });
    }
  });
</script>`;

  try {
    const imageParts: any[] = [];
    if (images && images.length > 0) {
      images.forEach(imgBase64 => {
        // Assume simplified base64 for now, usually data:image/jpeg;base64,...
        // We need to extract the mime type and the data
        const matches = imgBase64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          imageParts.push({
            inlineData: {
              mimeType: matches[1],
              data: matches[2]
            }
          });
        }
      });
    }

    const streamContents = {
      parts: [
        { text: "You are an ELITE Frontend Engineer and UI/UX Designer creating a STUNNING, COMPLETE lead capture form website." },
        { text: `USER'S DESIGN VISION:\n${prompt}` },
        { text: `FORM FIELDS TO INCLUDE (YOU MUST INCLUDE EVERY SINGLE ONE OF THESE):\n${fieldSpecs}` },
        ...imageParts, // Append images for analysis
        {
          text: `TECHNICAL REQUIREMENTS:
          - OUTPUT ONLY RAW HTML CODE. Do not wrap in markdown \`\`\` code blocks.
          - Use Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
          - The form MUST have id="lead-form" - THIS IS CRITICAL
          - Each input MUST have name attribute matching the field name
          - Include a submit button with id="submit-btn"
          - Include a success message div with id="success-message" (initially hidden with display:none)
          - Include an error message div with id="error-message" (initially hidden with display:none)
          - Wrap the form in a container with id="form-container"
          
          **⚠️ CRITICAL - READ CAREFULLY ⚠️**:
          1. You MUST include EVERY SINGLE field listed above in "FORM FIELDS TO INCLUDE"
          2. The form is the PRIMARY content - it should be visible immediately, not hidden or secondary
          3. Do NOT create just a hero/landing page - CREATE A COMPLETE FUNCTIONAL FORM
          4. Each field must have proper label, input, and placeholder as specified
          5. Required fields must have visual indicators (asterisk or similar)

          **IMAGE HANDLING (If images were provided):**
          - You have been provided with images along with this prompt.
          - ANALYZE these images to understand their content (e.g., product shot, office background, abstract texture, portrait).
          - INTELLIGENTLY PLACE them in the HTML where they fit best.
            - If it looks like a background texture, use it as a background.
            - If it looks like a product, feature it next to the form.
            - If it looks like a person, maybe use it in a testimonial section.
          - Use the exact Base64 strings provided in the input as the 'src' for <img> tags. Since I cannot give you the URLs back, you MUST embed them directly if you use them. **Wait, actually, since I am streaming the response, embedding HUGE base64 strings in the HTML output might break the stream or be too large.**
          - **BETTER STRATEGY:** I will provide the images to you for *context* and *visual style analysis*, but for the actual HTML, assume the user will replace placeholders OR if you really want to impress, use standard Unsplash placeholders that MATCH the content you analyzed.
          - **CORRECTION:** The user WANTS to use these uploaded images. Okay, to make this work efficiently:
            - Analyze the images to determine the *layout* and *color scheme*.
            - If you use the images, simply reference them as "IMAGE_0", "IMAGE_1" etc in the src attributes, and I will post-process them? No, that's too complex.
            - **FINAL DIRECTIVE:** Analyze the images for context. If they are suitable, use them as 'src="data:image/..."' in your HTML output. *However*, only do this if the image is reasonable in size. If no images are suitable, finding high-quality public URLs (Unsplash) is acceptable.
            - **ACTUALLY**: The user explicitly uploaded them. You MUST use them. To avoid huge output, just use the first 1-2 images if they are provided. Embed them as base64 in the img src.
          
          **PRIMARY DIRECTIVE**: PRIORITIZE USER EXPERIENCE DESIGN AND CONVERSION. The form must be frictionless, trustworthy, and visually persuasive.
          
          **MANDATORY VISUAL EXCELLENCE**:
          1. **Header/Hero**: A beautiful but COMPACT header that sets the tone - NOT a full-page hero.
          ${logoUrl ? `   - **LOGO**: You MUST display the provided logo URL in the header: <img src="${logoUrl}" alt="Logo" class="h-10 w-auto object-contain mx-auto mb-4" />` : ''}
          2. **Form as Main Content**: The form should be the CENTERPIECE, visible above the fold
          3. **Typography**: Use Google Fonts (Inter, Poppins, or similar). Clean, professional typography.
          4. **Form Styling**: 
             - Elegant input fields with focus states and proper borders
             - Clear labels positioned above each input
             - Beautiful submit button with hover effects
             - Required field indicators (asterisk *)
             - Proper spacing between fields (gap-4 or similar)
          5. **Layout**: 
             - Centered, card-like form container with shadow
             - Attractive background (gradient, pattern, or solid)
             - Form should take 60-80% of available width on desktop
             - Proper padding and margins
          6. **Success State**: Beautiful thank you message when form is submitted
          7. **Error State**: Friendly error message styling
          8. **Animations**: Subtle transitions on focus, hover, and interactions
          9. **Responsive**: Works perfectly on mobile and desktop
          
          **FORM INPUT TYPES** (generate the correct HTML for each):
          - 'text': <input type="text"> with label
          - 'email': <input type="email"> with label
          - 'phone': <input type="tel"> with label
          - 'textarea': <textarea> with label (min 3 rows)
          - 'select': <select> with <option> elements using provided options
          - 'checkbox': <input type="checkbox"> with label next to it
          
          **CRITICAL**: Include this exact script at the end of the body (it handles form submission):
          ${submissionScript}
          
          REMEMBER: Generate a COMPLETE, STYLISH FORM with ALL the fields specified above. The form must be immediately visible and usable.`
        }
      ]
    };

    let response;
    try {
      // 1. Try Gemini 3 Pro (Smart)
      response = await streamAi.models.generateContentStream({
        model: MODEL_SMART,
        contents: streamContents
      });
    } catch (err) {
      console.warn(`[streamLeadFormWebsite] ${MODEL_SMART} failed, falling back to ${MODEL_SUPER_FAST}`, err);
      try {
        // 2. Try Gemini 3 Flash (Super Fast)
        response = await streamAi.models.generateContentStream({
          model: MODEL_SUPER_FAST,
          contents: streamContents
        });
      } catch (err2) {
        console.warn(`[streamLeadFormWebsite] ${MODEL_SUPER_FAST} failed, falling back to ${MODEL_FAST}`, err2);
        // 3. Fallback to Gemini 2.5 Flash (Fast)
        response = await streamAi.models.generateContentStream({
          model: MODEL_FAST,
          contents: streamContents
        });
      }
    }

    let fullText = "";
    for await (const chunk of response) {
      const text = chunk.text;
      if (text) {
        fullText += text;
        onChunk(text);
      }
    }

    if (!fullText) {
      throw new Error("Generated lead form content was empty.");
    }

    return fullText;

  } catch (error) {
    console.error("Lead form stream generation error:", error);
    throw error;
  }
};

// Interface for website media that the AI can both analyze AND embed
export interface WebsiteMedia {
  url: string;          // The URL to embed in HTML (could be https:// or data:...)
  base64?: string;      // The base64 data for AI vision analysis (optional if url is already base64)
  mimeType: string;     // e.g. 'image/jpeg', 'video/mp4'
  type: 'image' | 'video';
}

// Interface for e-commerce product data
export interface EcommerceProduct {
  id: string;
  name: string;
  description?: string;
  price: number;        // in cents
  currency: string;
  imageUrl?: string;    // product image URL
  paymentLinkUrl: string; // Stripe payment link
}

// Stream e-commerce website generation with products
export const streamEcommerceWebsite = async (
  prompt: string,
  products: EcommerceProduct[],
  onChunk: (text: string) => void,
  brandName?: string,
  logoUrl?: string,
  mediaItems?: WebsiteMedia[] // Structured media with URLs for embedding
): Promise<string> => {
  const streamAi = new GoogleGenAI({ apiKey: process.env.API_KEY });

  if (!prompt) {
    throw new Error("Prompt for e-commerce website generation was empty.");
  }

  if (!products || products.length === 0) {
    throw new Error("No products provided for e-commerce website.");
  }

  // Build product specifications for the AI
  const productSpecs = products.map((p, idx) => {
    const priceFormatted = (p.price / 100).toFixed(2);
    return `
PRODUCT ${idx + 1}:
- Name: ${p.name}
- Description: ${p.description || 'No description'}
- Price: ${priceFormatted} ${p.currency.toUpperCase()}
- Image URL: ${p.imageUrl || 'No image provided'}
- Payment Link: ${p.paymentLinkUrl}`;
  }).join('\n');

  try {
    const imageParts: any[] = [];
    // Build embeddable media references for the AI to use in HTML
    let mediaEmbedText = '';

    if (mediaItems && mediaItems.length > 0) {
      mediaEmbedText = '\n\n**EMBEDDABLE MEDIA URLs** (Use these EXACT URLs in your HTML):\n';

      mediaItems.forEach((item, idx) => {
        // Add for AI vision/analysis (use base64 if available, otherwise skip vision)
        const base64Data = item.base64 || (item.url.startsWith('data:') ? item.url : null);
        if (base64Data) {
          const matches = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            imageParts.push({
              inlineData: {
                mimeType: matches[1],
                data: matches[2]
              }
            });
          }
        }

        // Provide the URL for embedding in HTML
        const mediaType = item.type === 'video' ? 'VIDEO' : 'IMAGE';
        mediaEmbedText += `\nMEDIA_${idx + 1} (${mediaType}, ${item.mimeType}):\nURL: ${item.url}\n`;
      });

      mediaEmbedText += '\n\n**IMPORTANT**: Use the EXACT URLs above as the src attribute in your img/video tags. Do NOT use placeholder URLs like "https://gemini.image/...".\n';
    }

    const streamContents = {
      parts: [
        { text: "You are an ELITE E-commerce Frontend Engineer and UI/UX Designer creating a STUNNING, COMPLETE online store website." },
        { text: `USER'S DESIGN VISION:\n${prompt}` },
        { text: `BRAND NAME: ${brandName || 'Online Store'}` },
        { text: `PRODUCTS TO DISPLAY (YOU MUST INCLUDE EVERY PRODUCT):${productSpecs}` },
        ...imageParts,
        ...(mediaEmbedText ? [{ text: mediaEmbedText }] : []),
        {
          text: `TECHNICAL REQUIREMENTS:
          - OUTPUT ONLY RAW HTML CODE. Do not wrap in markdown \`\`\` code blocks.
          - Use Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
          - Create a modern, professional e-commerce store layout
          - Include a header with brand name${logoUrl ? ` and logo (use this URL: ${logoUrl})` : ''}
          - Display ALL products in a responsive grid layout
          
          **⚠️ CRITICAL PRODUCT REQUIREMENTS ⚠️**:
          1. Each product MUST be displayed as a card with:
             - Product image (use the provided imageUrl or a placeholder gradient)
             - Product name as heading
             - Description text
             - Price prominently displayed
             - "Buy Now" button that links to the product's paymentLinkUrl
          
          2. The "Buy Now" button MUST be an <a> tag with:
             - href set to the exact paymentLinkUrl provided
             - target="_blank" to open in new tab
             - Prominent styling (colored, rounded, with hover effects)
          
          **DESIGN REQUIREMENTS**:
          - Modern, clean aesthetic with proper spacing
          - Responsive grid: 1 column mobile, 2 columns tablet, 3-4 columns desktop
          - Product cards with subtle shadows and hover effects
          - Consistent typography and color scheme
          - Hero section with store name and tagline
          - Footer with basic info
          
          **VISUAL ENHANCEMENTS**:
          - Smooth hover animations on product cards (scale, shadow)
          - Gradient accents for buttons
          - Image hover zoom effect
          - Professional color palette (avoid harsh colors)
          - Dark mode support using Tailwind dark: classes
          
          **USER-PROVIDED MEDIA** (CRITICAL):
          The user has provided ${mediaItems && mediaItems.length > 0 ? mediaItems.length : 0} additional media file(s) for styling/branding.
          ${mediaItems && mediaItems.length > 0 ? `
          ⚠️ YOU MUST USE THESE MEDIA FILES ⚠️
          
          STEP 1 - ANALYZE: Look at each media item and understand what it is (logo, hero banner, product shot, etc.)
          STEP 2 - EMBED: Use the EXACT URLs provided in the EMBEDDABLE MEDIA URLs section above
          STEP 3 - VERIFY: Ensure all img/video src attributes use the provided URLs - NO placeholder URLs!
          
          For IMAGES: <img src="THE_URL_FROM_ABOVE" class="..." />
          For VIDEOS: <video src="THE_URL_FROM_ABOVE" controls class="..."></video>
          
          - Place media in hero banner, about section, or featured imagery areas
          - Use at least ${Math.min(mediaItems.length, 2)} of these media files prominently
          ` : '- No additional media provided, use product images only'}
          
          **DO NOT**:
          - Skip any products - include ALL of them
          - Use placeholder buyLinks - use the EXACT paymentLinkUrl provided
          - Create a checkout/cart system - just link directly to Stripe
          - Wrap output in markdown code blocks
          - Use placeholder image URLs like "https://gemini.image/..." when user media is provided`
        }
      ]
    };

    let response;
    try {
      response = await streamAi.models.generateContentStream({
        model: MODEL_SMART,
        contents: streamContents
      });
    } catch (err) {
      console.warn(`[streamEcommerceWebsite] ${MODEL_SMART} failed, falling back to ${MODEL_SUPER_FAST}`, err);
      try {
        response = await streamAi.models.generateContentStream({
          model: MODEL_SUPER_FAST,
          contents: streamContents
        });
      } catch (err2) {
        console.warn(`[streamEcommerceWebsite] ${MODEL_SUPER_FAST} failed, falling back to ${MODEL_FAST}`, err2);
        response = await streamAi.models.generateContentStream({
          model: MODEL_FAST,
          contents: streamContents
        });
      }
    }

    let fullText = "";
    for await (const chunk of response) {
      const text = chunk.text;
      if (text) {
        fullText += text;
        onChunk(text);
      }
    }

    if (!fullText) {
      throw new Error("Generated e-commerce content was empty.");
    }

    return fullText;

  } catch (error) {
    console.error("E-commerce website stream generation error:", error);
    throw error;
  }
}

// Step 2: Refine Code with Gemini 3 Pro (Thinking) -> Fallback to 2.5 Pro -> Fallback to Flash
export const refineWebsiteCode = async (
  currentHtml: string,
  researchContext: string,
  theme: DualTheme | undefined,
  onChunk: (text: string) => void,
  onLog?: (text: string) => void,
  mediaItems?: WebsiteMedia[]
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  let themeContext = "";
  if (theme) {
    themeContext = `
    VISUAL IDENTITY SYSTEM:
    Use the following color palettes.
    
    Light Mode:
    - Primary: ${theme.light.primary}
    - Secondary: ${theme.light.secondary}
    - Accent: ${theme.light.accent}
    - Bg: ${theme.light.background} / Surface: ${theme.light.surface}
    
    Dark Mode:
    - Primary: ${theme.dark.primary}
    - Secondary: ${theme.dark.secondary}
    - Accent: ${theme.dark.accent}
    - Bg: ${theme.dark.background} / Surface: ${theme.dark.surface}

    REQUIREMENT: Use Tailwind's 'dark:' classes to support both modes fully.
    `;
  }

  const generate = async (modelName: string, budget: number) => {
    const imageParts: any[] = [];
    // Build embeddable media references for the AI to use in HTML
    let mediaEmbedText = '';

    if (mediaItems && mediaItems.length > 0) {
      mediaEmbedText = '\n\n**EMBEDDABLE MEDIA URLs** (Use these EXACT URLs in your HTML):\n';

      mediaItems.forEach((item, idx) => {
        // Add for AI vision/analysis (use base64 if available, otherwise skip vision)
        const base64Data = item.base64 || (item.url.startsWith('data:') ? item.url : null);
        if (base64Data) {
          const matches = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            imageParts.push({
              inlineData: {
                mimeType: matches[1],
                data: matches[2]
              }
            });
          }
        }

        // Provide the URL for embedding in HTML
        const mediaType = item.type === 'video' ? 'VIDEO' : 'IMAGE';
        mediaEmbedText += `\nMEDIA_${idx + 1} (${mediaType}, ${item.mimeType}):\nURL: ${item.url}\n`;
      });

      mediaEmbedText += '\n\n**IMPORTANT**: Use the EXACT URLs above as the src attribute in your img/video tags. Do NOT use placeholder URLs like "https://gemini.image/...".\n';
    }

    const contents = {
      parts: [
        { text: "You are an AWARD-WINNING Frontend Architect, UI/UX Designer, and Creative Technologist known for creating breathtaking digital experiences." },
        { text: `INPUT CONTEXT:\n1. **Research Findings**: ${researchContext}\n2. **Current Prototype**: A basic implementation exists that needs a dramatic upgrade.` },
        { text: themeContext },
        {
          text: `YOUR MISSION: Create a STUNNING, WORLD-CLASS 'Step 2' version that transforms this into an unforgettable digital experience.

CREATIVE DIRECTIONS (Choose the best fit):
- **Interactive Dashboard**: Real-time data viz, animated charts, live counters
- **Cinematic Story**: Full-screen sections, parallax, scroll-triggered animations
- **Immersive Experience**: 3D elements, particle effects, WebGL backgrounds
- **Editorial Magazine**: Beautiful typography, image galleries, pull quotes
- **Product Showcase**: Hero animations, floating elements, spotlight effects` },
        {
          text: `MANDATORY VISUAL ENHANCEMENTS:

1. **ADVANCED ANIMATIONS** (Include ALL):
   - Scroll-triggered fade-ins using Intersection Observer
   - Staggered animations for lists/grids (delay each item)
   - Smooth number counters for statistics
   - Parallax scrolling effects
   - Hover 3D transforms (perspective, rotateX/Y)
   - Loading skeleton screens
   - Page transition effects
   
2. **MODERN UI PATTERNS**:
   - Bento grid layouts (asymmetric, varied sizes)
   - Floating/overlapping elements
   - Gradient mesh backgrounds
   - Glassmorphism cards (backdrop-blur, transparency)
   - Neumorphism for interactive elements
   - Animated gradients (background-position animation)
   - Custom scrollbars
   
3. **TYPOGRAPHY EXCELLENCE**:
   - Google Fonts: Inter, Plus Jakarta Sans, Outfit, or Sora for body
   - Display fonts: Clash Display, Cabinet Grotesk for headings
   - Variable font weights (100-900)
   - Fluid typography (clamp() for responsive sizing)
   - Animated text reveals (letter by letter, line by line)
   
4. **MICRO-INTERACTIONS**:
   - Button ripple effects on click
   - Icon animations on hover
   - Cursor following effects
   - Magnetic buttons
   - Toast notifications
   - Progress indicators
   
5. **ADVANCED COMPONENTS**:
   - Animated accordions/FAQs
   - Image comparison sliders
   - Infinite marquee scrollers
   - Animated counters/statistics
   - Interactive timelines
   - Modal overlays with animations
   - Tabs with smooth transitions
   
6. **PERFORMANCE & POLISH**:
   - Lazy loading for images
   - Smooth scroll behavior
   - Debounced scroll handlers
   - CSS containment for performance
   
CDN RESOURCES TO USE:
- Tailwind: <script src="https://cdn.tailwindcss.com"></script>
- GSAP (animations): <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
- ScrollTrigger: <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js"></script>
- Lucide Icons: <script src="https://unpkg.com/lucide@latest"></script>
- AOS (Animate on Scroll): Include if needed

REAL-TIME DATA APIS:
- Crypto: \`https://min-api.cryptocompare.com/data/price?fsym={SYMBOL}&tsyms=USD\`
- Stocks: \`https://corsproxy.io/?https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?interval=1d&range=1d\`

**USER-PROVIDED MEDIA** (CRITICAL - READ CAREFULLY):
The user has provided ${mediaItems && mediaItems.length > 0 ? mediaItems.length : 0} media file(s) along with this request.
${mediaItems && mediaItems.length > 0 ? `
⚠️ YOU MUST USE THESE MEDIA FILES IN THE GENERATED HTML ⚠️

STEP 1 - ANALYZE THE MEDIA:
First, look at each image/video I've provided (via the vision parts) and understand what it contains:
- Is it a product photo, logo, team photo, background texture, hero video, etc.?
- What colors, mood, and style does it convey?
- Where would this media item best fit in a website layout?

STEP 2 - EMBED THE MEDIA:
After analyzing, you MUST embed these files using the EXACT URLs provided in the EMBEDDABLE MEDIA URLs section above.
- For IMAGES: Use <img src="THE_URL" alt="..." class="..." />
- For VIDEOS: Use <video src="THE_URL" controls class="..."></video>
- Place each item where it fits best based on your analysis
- Hero media goes in hero sections, product shots in galleries, logos in headers, etc.

STEP 3 - VERIFICATION:
Before outputting, verify that:
- You have used the provided URLs - NO placeholder URLs like "https://gemini.image/..."
- NO Unsplash URLs are used when user media is available
- At least ${Math.min(mediaItems.length, 3)} of these media items are embedded
` : '- No media was provided by the user, you may use Unsplash placeholders or AI-generated images'}

OUTPUT: Raw HTML only. NO markdown. Create something EXTRAORDINARY.` },
        ...imageParts,
        ...(mediaEmbedText ? [{ text: mediaEmbedText }] : []),
        { text: `CURRENT PROTOTYPE CODE:\n${currentHtml.substring(0, 50000)}` }
      ]
    };

    const isG3 = isGemini3(modelName);
    const config: any = {};

    if (isG3) {
      config.thinkingConfig = {
        includeThoughts: true,
        // @ts-ignore
        thinking_level: budget > 16384 ? 'medium' : 'low'
      };
    } else {
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: budget,
      };
    }

    const response = await ai.models.generateContentStream({
      model: modelName,
      contents: contents,
      config: config
    });

    let fullText = "";
    for await (const chunk of response) {
      // Manually iterate parts to separate thoughts from code
      const parts = chunk.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.thought && part.text) {
          // Log the thought
          if (onLog) onLog(part.text);
        } else if (part.text) {
          // Accumulate content
          fullText += part.text;
          onChunk(part.text);
        }
      }
    }
    return fullText;
  };

  const smartModel = await getSmartModel();
  try {
    return await generate(smartModel, 16384);
  } catch (error) {
    console.warn("Primary model enhancement failed, falling back...", error);
    try {
      onChunk("\n\n<!-- Switching to Gemini 3 Flash due to high traffic... -->\n");
      return await generate(MODEL_SUPER_FAST, 16384);
    } catch (err2) {
      console.warn("Gemini 3 Flash fallback failed, trying 2.5 Flash...", err2);
      try {
        onChunk("\n\n<!-- Switching to Gemini 2.5 Flash as a deep fallback... -->\n");
        return await generate(MODEL_FAST, 8192);
      } catch (fallbackError) {
        console.error("Enhancement fallback failed completely:", fallbackError);
        throw fallbackError;
      }
    }
  }
};

export const generateSlideshowImage = async (query: string): Promise<string> => {
  // Reuse the core image generator so slides also follow:
  // Gemini 3 Pro Image -> Gemini 2.5 Flash Image -> Pexels
  const result = await generateImage(query);
  return result.imageDataUrl;
};

// Lightweight helper to generate a social-media-style explainer voiceover for short videos.
// Used by Creatomate fallback to produce narration text from project/research context
// (including research summaries, uploaded files, and notes when available).
export const generateVideoVoiceoverText = async (context: string): Promise<string> => {
  const trimmed = (context || '').trim();

  const prompt = `You are writing a concise social-media-style EXPLAINER voiceover for a short video (about 20–30 seconds).

CONTEXT (research project, findings, uploaded files, notes, etc.):
-----------------
${trimmed}
-----------------

Requirements:
- 4–6 short sentences max (so it comfortably fits ~20–30 seconds of neutral speech).
- Explain ONE core idea or insight from the research in plain, non-technical language.
- Speak as if narrating an educational social video (TikTok/Instagram), but keep it professional and concise.
- You MAY mention how this insight helps the viewer (1–2 quick benefits or implications).
- Optionally end with a very short call-to-action like "save this for later" or "follow for more research breakdowns".
- No bullet points, no markdown, no headings, no speaker labels.
- Do NOT say things like "Introduction", "Project", "Topic", "Summary" or any other section labels out loud – just speak directly to the viewer in a natural paragraph.
- Return PLAIN TEXT ONLY (no JSON, no quotes around the whole script).
`;

  try {
    const response = await generateContentFast(
      [{ role: 'user', parts: [{ text: prompt }] }],
      {
        temperature: 0.85,
        maxOutputTokens: 320,
      }
    );

    const text = (response.text || '').trim();

    // If Gemini produced something, but it still looks like raw labels/headings (Project:/Topic:/Summary:/Introduction:),
    // treat it as invalid and fall back to our local synthesizer.
    if (text && !/^(?:Project:|Topic:|Summary:|Introduction:|Intro:|Context:)/im.test(text)) {
      return text;
    }
  } catch (e) {
    console.error('generateVideoVoiceoverText failed, falling back to raw context snippet', e);
  }

  // Fallback: synthesize a simple explainer from the context instead of echoing raw labels.
  return buildFallbackExplainerFromContext(trimmed);
};

// Local fallback VO generator: produces a short explainer from loose context.
function buildFallbackExplainerFromContext(context: string): string {
  const text = (context || '').trim();
  if (!text) {
    return 'In this short video, we will quickly walk through the key ideas from this research and what they mean for you.';
  }

  const topicMatch = text.match(/^Topic:\s*(.+)$/im);
  const summaryMatch = text.match(/^Summary:\s*(.+)$/im);
  const projectMatch = text.match(/^Project:\s*(.+)$/im);

  const topic = (topicMatch?.[1] || projectMatch?.[1] || '').trim();
  const summary = (summaryMatch?.[1] || '').trim();

  const safeTopic = topic || 'this research';
  const safeSummary = summary || text.split(/\n+/)[0].slice(0, 200);

  const sentences: string[] = [];

  sentences.push(`In this video, we break down ${safeTopic} in a simple, fast way.`);

  if (safeSummary) {
    sentences.push(`Here is the core idea: ${safeSummary}`);
  }

  sentences.push('We will highlight what this means in practice and why it matters.');
  sentences.push('Think of this as a quick explainer you could share on social or YouTube.');
  sentences.push('If this helps, save the video and come back to these insights whenever you need a refresher.');

  return sentences.join(' ');
}

// ---------------------------------------------------------
// Video Title Helper (Gemini 2.5 Flash Lite)
// ---------------------------------------------------------
// Generate a short, content-aware title for a video from project/research context
// and the user's video request. Used to name generated videos in the Assets tab.
export const generateVideoTitleFromContext = async (context: string): Promise<string> => {
  const trimmed = (context || '').trim();

  const prompt = `You are naming a short social-media/YouTube explainer video.

CONTEXT (research project, findings, files, notes, video request):
-----------------
${trimmed}
-----------------

Requirements for the TITLE:
- 3 to 8 words.
- Clear, descriptive, and enticing.
- Sounds like a YouTube or social video title, but not clickbait.
- No emojis, no hashtags, no quotation marks.
- Do NOT include "explainer" or "video" unless it is naturally part of the idea.

Return ONLY the title text, nothing else.`;

  try {
    const response = await generateContentFast(
      [{ role: 'user', parts: [{ text: prompt }] }],
      {
        temperature: 0.8,
        maxOutputTokens: 64,
      },
    );

    let text = (response.text || '').trim();
    if (!text) throw new Error('Empty title response');

    // Use first line, strip surrounding quotes if present
    text = text.split('\n')[0].trim();
    text = text.replace(/^['"“”]+|['"“”]+$/g, '').trim();

    if (text) return text;
  } catch (e) {
    console.error('generateVideoTitleFromContext failed, falling back to simple title', e);
  }

  if (!trimmed) return 'Project explainer';
  // Fallback: use first sentence/snippet as a crude title
  const firstLine = trimmed.split(/\n|[.!?]/)[0].trim();
  return (firstLine || 'Project explainer').slice(0, 80);
};

// Helper to add inline citations from Grounding Metadata
export function resolveCitations(response: GenerateContentResponse): string {
  let text = response.text || "";

  if (!response.candidates?.[0]?.groundingMetadata?.groundingSupports) {
    return text;
  }

  const candidate = response.candidates[0];
  const supports = candidate.groundingMetadata.groundingSupports;
  const chunks = candidate.groundingMetadata.groundingChunks || [];

  // Sort supports by end_index in descending order to avoid shifting issues when inserting.
  const sortedSupports = [...supports].sort(
    (a, b) => (b.segment?.endIndex ?? 0) - (a.segment?.endIndex ?? 0),
  );

  for (const support of sortedSupports) {
    const endIndex = support.segment?.endIndex;
    if (endIndex === undefined || !support.groundingChunkIndices?.length) {
      continue;
    }

    const citationLinks = support.groundingChunkIndices
      .map(chunkIndex => {
        const chunk = chunks[chunkIndex];
        // Prefer Web URI, fall back to Map URI
        const mapChunk = chunk?.maps as any;
        const uri = chunk?.web?.uri || mapChunk?.googleMapsUri || mapChunk?.desktopUri;
        if (uri) {
          // Markdown style: [index](url)
          return `[${chunkIndex + 1}](${uri})`;
        }
        return null;
      })
      .filter(Boolean);

    if (citationLinks.length > 0) {
      // Add a space before the citations for cleaner reading
      const citationString = " " + citationLinks.join(" ");
      text = text.slice(0, endIndex) + citationString + text.slice(endIndex);
    }
  }

  return text;
}

// ---------------------------------------------------------
// 1. Search Grounding (Inspiration)
// ---------------------------------------------------------
export const searchTrends = async (query: string): Promise<SearchResult> => {
  try {
    try {
      const response = await generateContentFast(
        `Perform a comprehensive Google Search for: "${query}". 
      Ensure you find the latest information available as of today. 
      Synthesize the findings into a clear summary with citations.`,
        {
          tools: [{ googleSearch: {} }],
          // Disable thinking for search to ensure fast response for Live API tool calls
          thinkingConfig: {
            thinkingBudget: 0,
          },
        }
      );

      // Process text to include citations
      const text = resolveCitations(response) || "No results found.";
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

      // Cast the chunks carefully to match SearchResult expected type if needed, 
      // but Typescript should match loosely or we can cast
      return { text, sources: chunks as any[] };
    } catch (error) {
      console.error("Search error:", error);
      // Return a safe fallback to prevent Live API from crashing on tool response
      return { text: "I encountered an error while searching. Please try again.", sources: [] };
    }
  } catch (e) {
    console.error("Outer search error:", e);
    return { text: "Search failed completely.", sources: [] };
  }
};

// ---------------------------------------------------------
// 2. Image Editing (Gemini 3 Pro Image)
// ---------------------------------------------------------
export const editImage = async (base64Image: string, mimeType: string, prompt: string): Promise<string> => {
  try {
    // Check for API Key first since we are using Pro
    const hasKey = await ensureVeoKey(); // Re-use the key check logic
    if (!hasKey) throw new Error("API Key required for Pro model");

    const proAi = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // Fallback Logic for Image Editing
    const attemptEdit = async (model: string) => {
      const response = await proAi.models.generateContent({
        model: model,
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Image,
                mimeType: mimeType,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      });

      // Extract image from response parts
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
            return `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
      throw new Error("No image generated.");
    };

    const imageModel = await getImageModel();
    try {
      return await attemptEdit(imageModel);
    } catch (e) {
      console.warn("Primary image model failed, falling back to Flash Image...", e);
      return await attemptEdit(MODEL_IMAGE_FAST);
    }

  } catch (error) {
    console.error("Image edit error:", error);
    throw error;
  }
};





export interface GeneratedBookPage {
  pageNumber: number;
  title: string;
  text: string;
  imagePrompt: string;
}

export interface GeneratedBook {
  title: string;
  description: string;
  pages: GeneratedBookPage[];
}

export interface GeneratedTableSpec {
  title: string;
  description?: string;
  columns: string[];
  rows: string[][];
}

export const generateBookFromProjectContext = async (
  project: ResearchProject,
  userPrompt: string,
  pageCount: number,
  projectContext?: string
): Promise<GeneratedBook> => {
  const clampedPages = Math.max(4, Math.min(32, pageCount || 8));
  const sessions = project.researchSessions || [];
  const recentSessions = sessions.slice(-5).map(session => {
    const report = session.researchReport;
    return {
      topic: session.topic,
      summary: report?.summary || report?.tldr || "",
      keyPoints: (report?.keyPoints || []).slice(0, 5).map(kp => ({
        title: kp.title,
        details: kp.details,
      })),
    };
  });

  const kbSummaries = (project.knowledgeBase || [])
    .slice(-8)
    .map(file => file.summary || file.extractedText || file.name)
    .filter(Boolean);

  const basePrompt = userPrompt.trim() || project.description || project.name;

  try {
    const prompt = `You are designing a multi-page PDF document based on a research project.

Project name: ${project.name}
Project description: ${project.description}

${projectContext ? `FULL PROJECT CONTEXT:\n${projectContext}\n` : ''}

User's request for this document:
"""
${basePrompt}
"""

Recent research sessions (for context):
${JSON.stringify(recentSessions, null, 2)}

Knowledge base themes:
${kbSummaries.join("\n")}

TASK: Design a ${clampedPages}-page PDF document that fulfills the user's request. Infer the appropriate document type and style from the user's prompt:
- If they mention "report", "analysis", "whitepaper" → Professional/Business style
- If they mention "story", "book", "tale", "children" → Narrative/Illustrated style  
- If they mention "guide", "tutorial", "manual" → Educational/Instructional style
- If they mention "proposal", "pitch" → Persuasive/Business style
- Default → Informative document style

Structure the document as pages, each with:
- pageNumber (1-based integer)
- title (short heading for the page)
- text (DETAILED content for this page, 100-200 words. This should be coherent, substantive text appropriate for the document type - NOT just a caption.)
- imagePrompt (precise visual instructions for a full-page visual element appropriate to the document type. For reports/proposals: "professional chart/diagram/infographic showing...". For stories: "illustrated scene showing...". For guides: "clear diagram/screenshot demonstrating...")

CRITICAL: The imagePrompt should instruct the image generator to include any essential text/labels/data that should appear in the visual. Example: "A professional bar chart comparing Q1-Q4 revenue, with clear axis labels and a legend showing Product A (blue) and Product B (green)."

The document should have approximately ${clampedPages} pages (you may vary by 1-2 pages if needed). Keep language appropriate to the inferred document type. Do not include code fences or markdown.

Return ONLY valid JSON in this exact shape with double quotes on all keys:
{
  "title": "Document title",
  "description": "1-2 sentence description of the document",
  "pages": [
    {
      "pageNumber": 1,
      "title": "Page title",
      "text": "Full content for this page...",
      "imagePrompt": "Visual instructions appropriate for document type"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: MODEL_SMART,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.8,
        maxOutputTokens: 4096,
        responseMimeType: "text/plain",
      },
    });

    const text = response.text?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON book spec returned");
    }
    const raw = JSON.parse(jsonMatch[0]);
    const pages = Array.isArray(raw.pages) ? raw.pages : [];
    const normalizedPages: GeneratedBookPage[] = pages
      .map((p: any, idx: number) => ({
        pageNumber: typeof p.pageNumber === "number" ? p.pageNumber : idx + 1,
        title: String(p.title || `Page ${idx + 1}`),
        text: String(p.text || ""),
        imagePrompt: String(p.imagePrompt || basePrompt),
      }))
      .slice(0, clampedPages);

    if (!normalizedPages.length) {
      throw new Error("No pages in generated book spec");
    }

    return {
      title: String(raw.title || basePrompt || project.name),
      description: String(raw.description || ""),
      pages: normalizedPages,
    };
  } catch (error) {
    console.error("Failed to generate book from project context:", error);
    const safeTitle = basePrompt || project.name || "Project Book";
    const fallbackPages: GeneratedBookPage[] = Array.from({ length: Math.max(4, Math.min(16, pageCount || 8)) }).map((_, idx) => ({
      pageNumber: idx + 1,
      title: `Page ${idx + 1}`,
      text: safeTitle,
      imagePrompt: `${safeTitle} - page ${idx + 1}`,
    }));
    return {
      title: safeTitle,
      description: "Auto-generated book based on project context.",
      pages: fallbackPages,
    };
  }
};

export const generateTableFromProjectContext = async (
  project: ResearchProject,
  userPrompt: string,
  projectContext?: string
): Promise<GeneratedTableSpec> => {
  const sessions = project.researchSessions || [];
  const recentSessions = sessions.slice(-5).map(session => {
    const report = session.researchReport;
    return {
      topic: session.topic,
      summary: report?.summary || report?.tldr || "",
      keyPoints: (report?.keyPoints || []).slice(0, 5).map(kp => kp.title),
    };
  });

  const tasks = (project.tasks || [])
    .slice(0, 8)
    .map(task => `${task.title} [${task.status}]`);

  const notes = (project.notes || [])
    .slice(0, 8)
    .map(note => note.title || "Untitled note");

  const kbSummaries = (project.knowledgeBase || [])
    .slice(-8)
    .map(file => file.summary || file.extractedText || file.name)
    .filter(Boolean);

  const basePrompt = userPrompt.trim() || project.description || project.name;

  // Data tab / Gemini Files context: surface uploaded project files so the
  // model has full awareness of available documents before designing the
  // table. When a table prompt refers to a specific file by name, Gemini can
  // use File Search to retrieve that document for grounding.
  const dataTabFiles = (project.uploadedFiles || []).slice(0, 8);
  let filesContext = "";
  let fileSearchStoreName: string | null = null;
  let focusedDisplayName: string | null = null;

  if (dataTabFiles.length) {
    const promptLower = (userPrompt || "").toLowerCase();

    filesContext = `\n\nUploaded Data Tab files (for additional context):\n${dataTabFiles
      .map((f, i) => {
        const rawName = f.displayName || f.name || "Untitled file";
        const display = rawName.replace(/\n/g, " ");
        const type = f.mimeType || "unknown type";
        const summary = f.summary
          ? `Summary: ${f.summary}`
          : "Available in the Data tab for detailed reference.";

        // Heuristic: if the user's prompt mentions this file name, mark it as
        // the primary target for File Search so Gemini can retrieve it.
        if (!focusedDisplayName && rawName && promptLower.includes(rawName.toLowerCase())) {
          focusedDisplayName = rawName;
        }

        return `File ${i + 1}: "${display}" (${type})\n${summary}`;
      })
      .join("\n---\n")}`;

    try {
      fileSearchStoreName = await ensureFileSearchStoreName();
    } catch (e) {
      console.error("Failed to ensure File Search store for table generation", e);
      fileSearchStoreName = null;
    }
  }

  try {
    const prompt = `You are a data analyst creating a table based on the user's specific request.

IMPORTANT: For data-driven requests (market size, statistics, competitors, pricing, trends, etc.), USE GOOGLE SEARCH to find accurate, current information. Do NOT make up placeholder data.

Project context for reference:
- Project name: ${project.name}
- Project description: ${project.description}

${projectContext ? `ADDITIONAL PROJECT CONTEXT:\n${projectContext}\n` : ''}

USER'S TABLE REQUEST:
"""
${basePrompt}
"""

${recentSessions.length > 0 ? `Recent research topics (for context only):\n${recentSessions.map(s => s.topic).join(', ')}` : ''}

INSTRUCTIONS:
1. If the user is asking for specific data (market size, statistics, competitors, pricing, etc.), use Google Search to find real, current data to populate the table.
2. Create a table that DIRECTLY addresses the user's request with accurate information.
3. Use clear, short column headers and concise cell values.
4. Include source information in a column if data comes from search results.
5. Do NOT generate placeholder data or generic summaries from the project context.

Generate the table with real data based on the user's request.`;

    // JSON Schema for structured table output
    const tableSchema = {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short, descriptive title for the table' },
        description: { type: 'string', description: 'Optional brief description of what the table contains' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Array of column header names' },
        rows: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'Array of rows, each row is an array of cell values'
        },
      },
      required: ['title', 'columns', 'rows'],
    };

    // TWO-STAGE APPROACH: File Search and Google Search cannot be used together (API limitation)
    // Stage 1: If user references a file, retrieve its content via File Search first
    // Stage 2: Use Google Search with the retrieved file content as context

    let fileSearchContext = "";

    // Stage 1: File Search (if user references a specific file)
    if (focusedDisplayName && fileSearchStoreName) {
      console.log('[generateTableFromProjectContext] Stage 1: Retrieving file content via File Search for:', focusedDisplayName);
      try {
        const fileSearchConfig: any = {
          fileSearchStoreNames: [fileSearchStoreName],
        };

        const sanitizedProjectId = String(project?.id || '').replace(/"/g, '');
        const sanitized = focusedDisplayName.replace(/"/g, "");

        if (sanitizedProjectId.length > 0) {
          fileSearchConfig.metadataFilter = `project_id="${sanitizedProjectId}" AND display_name="${sanitized}"`;
        } else {
          fileSearchConfig.metadataFilter = `display_name="${sanitized}"`;
        }

        // Call File Search to retrieve document content
        const fileSearchResponse = await ai.models.generateContent({
          model: MODEL_FAST, // Use 2.5 Flash for File Search (faster)
          contents: [{
            role: "user",
            parts: [{
              text: `Extract and summarize the key data, statistics, and relevant information from the file "${focusedDisplayName}" that would be useful for creating a table about: ${basePrompt}. 
              
              Include:
              - Any numerical data, statistics, or metrics
              - Key facts and figures
              - Names, dates, and categories
              - Any tabular data already in the document
              
              Return the extracted information in a structured format.`
            }]
          }],
          config: {
            temperature: 0.3,
            maxOutputTokens: 4096,
            tools: [{ fileSearch: fileSearchConfig }],
          },
        });

        fileSearchContext = fileSearchResponse.text?.trim() || "";
        console.log('[generateTableFromProjectContext] File Search retrieved:', fileSearchContext.length, 'chars');

        if (fileSearchContext.length > 0) {
          fileSearchContext = `\n\nDATA EXTRACTED FROM UPLOADED FILE "${focusedDisplayName}":\n${fileSearchContext}\n`;
        }
      } catch (fileSearchError: any) {
        console.warn('[generateTableFromProjectContext] File Search failed:', fileSearchError?.message || fileSearchError);
        // Continue without file context
      }
    }

    // Stage 2: Google Search with file context (if any)
    // Build the final prompt with any file search context included
    const finalPrompt = `You are a data analyst creating a table based on the user's specific request.

IMPORTANT: For data-driven requests (market size, statistics, competitors, pricing, trends, etc.), USE GOOGLE SEARCH to find accurate, current information. Do NOT make up placeholder data.

Project context for reference:
- Project name: ${project.name}
- Project description: ${project.description}

${projectContext ? `ADDITIONAL PROJECT CONTEXT:\n${projectContext}\n` : ''}
${fileSearchContext}

USER'S TABLE REQUEST:
"""
${basePrompt}
"""

${recentSessions.length > 0 ? `Recent research topics (for context only):\n${recentSessions.map(s => s.topic).join(', ')}` : ''}

INSTRUCTIONS:
1. If file data was provided above, USE IT as the primary source for the table.
2. For any additional or current data needs, use Google Search to find real, current data.
3. Create a table that DIRECTLY addresses the user's request with accurate information.
4. Use clear, short column headers and concise cell values.
5. Include source information in a column if data comes from search results.
6. Do NOT generate placeholder data or generic summaries.

Generate the table with real data based on the user's request.`;

    console.log('[generateTableFromProjectContext] Stage 2: Using Google Search with', fileSearchContext.length > 0 ? 'file context' : 'no file context');
    console.log('[generateTableFromProjectContext] Using model:', MODEL_SMART);

    const response = await ai.models.generateContent({
      model: MODEL_SMART, // gemini-3.1-pro-preview
      contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
      config: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        // Gemini 3 supports responseMimeType + tools together
        responseMimeType: 'application/json',
        responseJsonSchema: tableSchema,
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text?.trim() || "";
    console.log('[generateTableFromProjectContext] Raw response text length:', text.length);
    console.log('[generateTableFromProjectContext] Raw response text (first 500 chars):', text.substring(0, 500));

    // With structured outputs (responseMimeType: application/json), the response should be valid JSON
    // Try direct parsing first, then regex fallback
    let raw: any = null;

    try {
      // First, try to parse the text directly as JSON (structured output mode)
      raw = JSON.parse(text);
      console.log('[generateTableFromProjectContext] Successfully parsed JSON directly');
    } catch (directParseError) {
      console.log('[generateTableFromProjectContext] Direct JSON parse failed, trying regex extraction');
      // Fallback: try to extract JSON via regex
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          raw = JSON.parse(jsonMatch[0]);
          console.log('[generateTableFromProjectContext] Successfully parsed JSON via regex');
        } catch (regexParseError) {
          console.error('[generateTableFromProjectContext] Regex JSON parse also failed:', regexParseError);
        }
      }
    }

    // If we still don't have valid parsed data, return fallback
    if (!raw) {
      console.warn('[generateTableFromProjectContext] No valid JSON found, using fallback');
      const safeTitle = basePrompt || project.name || "Project Table";
      const fallbackColumns = ["Topic", "Summary"];
      const fallbackRows = (project.researchSessions || [])
        .slice(-5)
        .map(session => {
          const report = session.researchReport;
          const summary = report?.summary || report?.tldr || "";
          return [
            session.topic || project.name,
            summary || project.description || safeTitle,
          ];
        });

      if (!fallbackRows.length) {
        fallbackRows.push([
          safeTitle,
          project.description || "",
        ]);
      }

      return {
        title: safeTitle,
        description: "Auto-generated table based on project context.",
        columns: fallbackColumns,
        rows: fallbackRows,
      };
    }

    console.log('[generateTableFromProjectContext] Parsed raw:', JSON.stringify(raw).substring(0, 500));

    const rawColumns = Array.isArray(raw.columns) ? raw.columns : [];
    const columns = rawColumns
      .map((c: any) => String(c || "").trim())
      .filter((c: string) => c.length > 0);

    const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
    const rows = rawRows
      .map((row: any) =>
        Array.isArray(row)
          ? row.map((cell: any) => String(cell ?? ""))
          : [],
      )
      .filter((row: string[]) => row.length > 0);

    console.log('[generateTableFromProjectContext] Columns count:', columns.length, '- Rows count:', rows.length);

    if (!columns.length || !rows.length) {
      console.warn('[generateTableFromProjectContext] Empty columns or rows after parsing, throwing error');
      throw new Error("Empty table spec");
    }

    const normalizedRows = rows.map((row: string[]) => {
      const copy = [...row];
      while (copy.length < columns.length) copy.push("");
      return copy.slice(0, columns.length);
    });

    return {
      title: String(raw.title || basePrompt || project.name),
      description: raw.description ? String(raw.description) : undefined,
      columns,
      rows: normalizedRows,
    };
  } catch (error) {
    console.error("Failed to generate table from project context:", error);
    const safeTitle = basePrompt || project.name || "Project Table";
    const fallbackColumns = ["Topic", "Summary"];
    const fallbackRows = (project.researchSessions || [])
      .slice(-5)
      .map(session => {
        const report = session.researchReport;
        const summary = report?.summary || report?.tldr || "";
        return [
          session.topic || project.name,
          summary || project.description || safeTitle,
        ];
      });

    if (!fallbackRows.length) {
      fallbackRows.push([
        safeTitle,
        project.description || "",
      ]);
    }

    return {
      title: safeTitle,
      description: "Auto-generated table based on project context.",
      columns: fallbackColumns,
      rows: fallbackRows,
    };
  }
};

export const generateChartFromTable = async (
  table: Pick<TableAsset, 'title' | 'description' | 'columns' | 'rows'>,
  userPrompt?: string,
  chartType?: 'bar' | 'bar_horizontal' | 'line' | 'area' | 'pie' | 'donut' | 'table',
  isDarkMode?: boolean
): Promise<string> => {
  // ... (rest of the code remains the same)
  const basePrompt = (userPrompt || table.description || table.title || 'Data visualization').trim();
  const selectedChartType: 'bar' | 'bar_horizontal' | 'line' | 'area' | 'pie' | 'donut' | 'table' = chartType || 'bar';

  // Only keep columns that have at least one non-empty cell so padded/blank
  // columns (e.g., the extra empty columns added for editing) are ignored in
  // the visualization.
  let effectiveColumns = table.columns;
  let effectiveRows = table.rows;

  try {
    const colCount = table.columns.length;
    const used: boolean[] = new Array(colCount).fill(false);

    for (const row of table.rows) {
      row.forEach((cell, idx) => {
        if (!used[idx] && String(cell ?? '').trim().length > 0) {
          used[idx] = true;
        }
      });
    }

    const keepIndices = used
      .map((u, idx) => (u ? idx : -1))
      .filter(idx => idx !== -1);

    // If we found at least one populated column, slice down to only those.
    if (keepIndices.length > 0) {
      effectiveColumns = keepIndices.map(i => table.columns[i]);
      effectiveRows = table.rows.map(row => keepIndices.map(i => row[i] ?? ''));
    }
  } catch (e) {
    console.warn('generateChartFromTable: failed to prune empty columns, using full table', e);
  }

  const escapeHtml = (value: any) => {
    const str = String(value ?? '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const parseNumber = (value: any): number | null => {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const cleaned = raw
      .replace(/,/g, '')
      .replace(/\$/g, '')
      .replace(/%/g, '')
      .replace(/\s+/g, '');
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const num = Number(match[0]);
    return Number.isFinite(num) ? num : null;
  };

  const rows = effectiveRows || [];
  const cols = effectiveColumns || [];

  const safeTitle = table.title || 'Chart';

  // Theme colors for dark/light mode
  const theme = {
    bg: isDarkMode ? '#0b0f19' : '#ffffff',
    cardBg: isDarkMode ? '#1d1d1f' : '#ffffff',
    cardBorder: isDarkMode ? '#3d3d3f' : '#e2e8f0',
    textPrimary: isDarkMode ? '#ffffff' : '#0f172a',
    textSecondary: isDarkMode ? '#86868b' : '#475569',
    textMuted: isDarkMode ? '#636366' : '#64748b',
    codeBg: isDarkMode ? '#2d2d2f' : '#f1f5f9',
    tableBorder: isDarkMode ? '#3d3d3f' : '#e2e8f0',
    tableHeaderBg: isDarkMode ? '#2d2d2f' : '#f8fafc',
    gridLine: isDarkMode ? '#3d3d3f' : '#e2e8f0',
    axisLine: isDarkMode ? '#636366' : '#cbd5e1',
  };

  const renderEmptyStateHtml = (message: string) => {
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(safeTitle)}</title>
    <style>
      body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: ${theme.bg}; color: ${theme.textPrimary}; }
      .card { border: 1px solid ${theme.cardBorder}; border-radius: 12px; padding: 16px; background: ${theme.cardBg}; }
      h1 { margin: 0; font-size: 18px; }
      .sub { margin: 8px 0 0; font-size: 12px; color: ${theme.textSecondary}; }
      .hint { margin: 12px 0 0; font-size: 12px; color: ${theme.textMuted}; }
      code { background: ${theme.codeBg}; padding: 2px 6px; border-radius: 8px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(safeTitle)}</h1>
      <p class="sub">${escapeHtml(basePrompt)}</p>
      <div class="hint">${escapeHtml(message)}</div>
    </div>
  </body>
</html>`;
  };

  const nonEmptyCountByCol = cols.map((_, colIdx) =>
    rows.reduce((acc, r) => (String(r?.[colIdx] ?? '').trim() ? acc + 1 : acc), 0)
  );
  const numericCountByCol = cols.map((_, colIdx) =>
    rows.reduce((acc, r) => (parseNumber(r?.[colIdx]) !== null ? acc + 1 : acc), 0)
  );

  const isNumericCol = cols.map((_, colIdx) => {
    const nonEmpty = nonEmptyCountByCol[colIdx] || 0;
    const numeric = numericCountByCol[colIdx] || 0;
    if (nonEmpty === 0) return false;
    // Be permissive so small manually-edited tables (even 1-2 rows) can chart.
    return numeric >= Math.max(1, Math.ceil(nonEmpty * 0.5));
  });

  // Prefer labels from a non-numeric column; otherwise fall back to row index.
  let labelColIdx = cols.findIndex((_, idx) => !isNumericCol[idx]);
  if (labelColIdx === -1) labelColIdx = 0;

  const numericIndices = isNumericCol
    .map((isNum, idx) => (isNum ? idx : -1))
    .filter(idx => idx !== -1);

  // Choose a numeric value column even when there's only 1 numeric column.
  let valueColIdx = cols.findIndex((_, idx) => isNumericCol[idx] && idx !== labelColIdx);
  if (valueColIdx === -1 && numericIndices.length > 0) {
    valueColIdx = numericIndices[0];
  }

  const getLabelForRow = (r: any[], rowIdx: number) => {
    const candidate = String(r?.[labelColIdx] ?? '').trim();
    if (candidate && labelColIdx !== valueColIdx && !isNumericCol[labelColIdx]) return candidate;
    return `Row ${rowIdx + 1}`;
  };

  // If we still can't find a numeric column, show an empty state (unless the user chose table).
  const renderTableHtml = () => {
    const header = cols
      .map(c => `<th style="padding:6px 10px;border:1px solid ${theme.tableBorder};text-align:left;font-weight:600;">${escapeHtml(c || '')}</th>`)
      .join('');
    const rowsHtml = rows
      .map(r =>
        `<tr>${(r || [])
          .map(cell => `<td style="padding:6px 10px;border:1px solid ${theme.tableBorder};">${escapeHtml(cell || '')}</td>`)
          .join('')}</tr>`
      )
      .join('');

    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(safeTitle)}</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 16px; background: ${theme.bg}; color: ${theme.textPrimary}; }
      h1 { font-size: 18px; margin: 0 0 12px; }
      .sub { margin: 0 0 12px; font-size: 12px; color: ${theme.textSecondary}; }
      .card { border: 1px solid ${theme.cardBorder}; border-radius: 12px; padding: 16px; background: ${theme.cardBg}; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      thead { background: ${theme.tableHeaderBg}; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(safeTitle)}</h1>
      <p class="sub">${escapeHtml(basePrompt)}</p>
      <table>
        <thead><tr>${header}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  </body>
</html>`;
  };

  if (selectedChartType === 'table') {
    return renderTableHtml();
  }

  if (valueColIdx === -1) {
    return renderEmptyStateHtml('Add at least one numeric column (e.g., values like 10, 42, 3.14) to render a chart.');
  }

  const labelName = cols[labelColIdx] || 'Label';
  const valueName = cols[valueColIdx] || 'Value';

  const points = rows
    .map((r, idx) => {
      const labelRaw = getLabelForRow(r as any[], idx);
      const valueNum = parseNumber(r?.[valueColIdx]);
      return { label: labelRaw, value: valueNum };
    })
    .filter(p => p.value !== null) as Array<{ label: string; value: number }>;

  if (!points.length) {
    return renderEmptyStateHtml('No numeric values found yet. Enter numbers into a column to render a chart.');
  }

  const maxValue = Math.max(...points.map(p => p.value), 0);
  const width = 900;
  const height = 420;
  const marginLeft = 60;
  const marginRight = 20;
  const marginTop = 30;
  const marginBottom = 70;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;

  const barGap = points.length > 12 ? 4 : 10;
  const barW = points.length > 0 ? Math.max(6, (plotW - barGap * (points.length - 1)) / points.length) : 0;
  const safeMax = maxValue <= 0 ? 1 : maxValue;

  const yTicks = 5;
  const tickVals = new Array(yTicks + 1).fill(0).map((_, i) => (safeMax * i) / yTicks);

  const barsSvg = points
    .map((p, i) => {
      const x = marginLeft + i * (barW + barGap);
      const barH = (p.value / safeMax) * plotH;
      const y = marginTop + (plotH - barH);
      const label = escapeHtml(p.label);
      const value = escapeHtml(p.value);
      const showRotate = points.length > 6;
      const lx = x + barW / 2;
      const ly = marginTop + plotH + 18;
      const labelSvg = showRotate
        ? `<text x="${lx}" y="${ly}" font-size="11" fill="#475569" text-anchor="end" transform="rotate(-35 ${lx} ${ly})">${label}</text>`
        : `<text x="${lx}" y="${ly}" font-size="11" fill="#475569" text-anchor="middle">${label}</text>`;
      return `
        <g>
          <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="6" fill="#2563eb">
            <title>${labelName}: ${label}\n${valueName}: ${value}</title>
          </rect>
          ${labelSvg}
        </g>
      `;
    })
    .join('');

  const yAxisSvg = tickVals
    .map(v => {
      const y = marginTop + (plotH - (v / safeMax) * plotH);
      const label = v >= 1000 ? `${Math.round(v)}` : `${Math.round(v * 100) / 100}`;
      return `
        <g>
          <line x1="${marginLeft}" y1="${y}" x2="${width - marginRight}" y2="${y}" stroke="#e2e8f0" stroke-width="1" />
          <text x="${marginLeft - 10}" y="${y + 4}" font-size="11" fill="#64748b" text-anchor="end">${escapeHtml(label)}</text>
        </g>
      `;
    })
    .join('');

  const renderSvgHtml = (svg: string, ariaLabel: string, extraMeta?: string) => {
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(safeTitle)}</title>
    <style>
      body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: ${theme.bg}; color: ${theme.textPrimary}; }
      .card { border: 1px solid ${theme.cardBorder}; border-radius: 12px; padding: 16px; background: ${theme.cardBg}; }
      h1 { margin: 0; font-size: 18px; }
      .sub { margin: 8px 0 0; font-size: 12px; color: ${theme.textSecondary}; }
      .meta { margin: 10px 0 0; font-size: 12px; color: ${theme.textMuted}; }
      .chartWrap { margin-top: 14px; }
      svg { width: 100%; height: auto; display: block; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(safeTitle)}</h1>
      <p class="sub">${escapeHtml(basePrompt)}</p>
      <div class="meta">${escapeHtml(extraMeta || `${labelName} vs ${valueName}`)}</div>
      <div class="chartWrap">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}">
          ${svg}
        </svg>
      </div>
    </div>
  </body>
</html>`;
  };

  if (selectedChartType === 'bar') {
    const svg = `
      ${yAxisSvg}
      <line x1="${marginLeft}" y1="${marginTop + plotH}" x2="${width - marginRight}" y2="${marginTop + plotH}" stroke="#cbd5e1" stroke-width="1" />
      <line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + plotH}" stroke="#cbd5e1" stroke-width="1" />
      ${barsSvg}
    `;
    return renderSvgHtml(svg, 'Bar chart');
  }

  if (selectedChartType === 'bar_horizontal') {
    const xTicks = 5;
    const tickValsX = new Array(xTicks + 1).fill(0).map((_, i) => (safeMax * i) / xTicks);
    const xAxisSvg = tickValsX
      .map(v => {
        const x = marginLeft + (v / safeMax) * plotW;
        const label = v >= 1000 ? `${Math.round(v)}` : `${Math.round(v * 100) / 100}`;
        return `
          <g>
            <line x1="${x}" y1="${marginTop}" x2="${x}" y2="${marginTop + plotH}" stroke="#e2e8f0" stroke-width="1" />
            <text x="${x}" y="${marginTop + plotH + 16}" font-size="11" fill="#64748b" text-anchor="middle">${escapeHtml(label)}</text>
          </g>
        `;
      })
      .join('');

    const rowGap = points.length > 12 ? 4 : 10;
    const barH = points.length > 0 ? Math.max(8, (plotH - rowGap * (points.length - 1)) / points.length) : 0;

    const bars = points
      .map((p, i) => {
        const y = marginTop + i * (barH + rowGap);
        const w = (p.value / safeMax) * plotW;
        const label = escapeHtml(p.label);
        const value = escapeHtml(p.value);
        const ly = y + barH / 2 + 4;
        return `
          <g>
            <rect x="${marginLeft}" y="${y}" width="${w}" height="${barH}" rx="6" fill="#2563eb">
              <title>${labelName}: ${label}\n${valueName}: ${value}</title>
            </rect>
            <text x="${marginLeft - 8}" y="${ly}" font-size="11" fill="#475569" text-anchor="end">${label}</text>
          </g>
        `;
      })
      .join('');

    const svg = `
      ${xAxisSvg}
      <line x1="${marginLeft}" y1="${marginTop + plotH}" x2="${width - marginRight}" y2="${marginTop + plotH}" stroke="#cbd5e1" stroke-width="1" />
      <line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + plotH}" stroke="#cbd5e1" stroke-width="1" />
      ${bars}
    `;
    return renderSvgHtml(svg, 'Horizontal bar chart');
  }

  if (selectedChartType === 'line' || selectedChartType === 'area') {
    const safePoints = points.slice(0, 60);
    const xStep = safePoints.length > 1 ? plotW / (safePoints.length - 1) : plotW;
    const toX = (i: number) => marginLeft + i * xStep;
    const toY = (v: number) => marginTop + (plotH - (v / safeMax) * plotH);
    const pathD = safePoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(p.value)}`)
      .join(' ');

    const areaD = `${pathD} L ${toX(safePoints.length - 1)} ${marginTop + plotH} L ${toX(0)} ${marginTop + plotH} Z`;

    const showRotate = safePoints.length > 6;
    const xLabels = safePoints
      .map((p, i) => {
        if (safePoints.length > 14 && i % 2 === 1) return '';
        const x = toX(i);
        const y = marginTop + plotH + 18;
        const label = escapeHtml(p.label);
        return showRotate
          ? `<text x="${x}" y="${y}" font-size="11" fill="#475569" text-anchor="end" transform="rotate(-35 ${x} ${y})">${label}</text>`
          : `<text x="${x}" y="${y}" font-size="11" fill="#475569" text-anchor="middle">${label}</text>`;
      })
      .filter(Boolean)
      .join('');

    const dots = safePoints
      .map((p, i) => {
        const x = toX(i);
        const y = toY(p.value);
        return `<circle cx="${x}" cy="${y}" r="3" fill="#2563eb"><title>${escapeHtml(p.label)}: ${escapeHtml(p.value)}</title></circle>`;
      })
      .join('');

    const svg = `
      ${yAxisSvg}
      <line x1="${marginLeft}" y1="${marginTop + plotH}" x2="${width - marginRight}" y2="${marginTop + plotH}" stroke="#cbd5e1" stroke-width="1" />
      <line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + plotH}" stroke="#cbd5e1" stroke-width="1" />
      ${xLabels}
      ${selectedChartType === 'area' ? `<path d="${areaD}" fill="rgba(37,99,235,0.18)" />` : ''}
      <path d="${pathD}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      ${dots}
    `;
    return renderSvgHtml(svg, selectedChartType === 'area' ? 'Area chart' : 'Line chart');
  }

  if (selectedChartType === 'pie' || selectedChartType === 'donut') {
    const safePoints = points.filter(p => p.value > 0).slice(0, 12);
    const total = safePoints.reduce((acc, p) => acc + p.value, 0);
    if (!safePoints.length || total <= 0) {
      return renderEmptyStateHtml('Pie/Donut charts need positive numeric values. Add values > 0 to render this chart.');
    }

    const cx = 260;
    const cy = 220;
    const r = 140;
    const innerR = selectedChartType === 'donut' ? 78 : 0;
    const colors = ['#2563eb', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#a855f7', '#64748b', '#111827', '#06b6d4', '#84cc16'];

    const polar = (angle: number, radius: number) => {
      return {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      };
    };

    let start = -Math.PI / 2;
    const segments = safePoints
      .map((p, idx) => {
        const fraction = p.value / total;
        const end = start + fraction * Math.PI * 2;
        const largeArc = end - start > Math.PI ? 1 : 0;
        const p1 = polar(start, r);
        const p2 = polar(end, r);
        const p3 = polar(end, innerR);
        const p4 = polar(start, innerR);
        const fill = colors[idx % colors.length];
        const label = escapeHtml(p.label);
        const value = escapeHtml(p.value);

        let d: string;
        if (innerR > 0) {
          d = [
            `M ${p1.x} ${p1.y}`,
            `A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
            `L ${p3.x} ${p3.y}`,
            `A ${innerR} ${innerR} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
            'Z',
          ].join(' ');
        } else {
          d = [
            `M ${cx} ${cy}`,
            `L ${p1.x} ${p1.y}`,
            `A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
            'Z',
          ].join(' ');
        }

        start = end;
        return `<path d="${d}" fill="${fill}"><title>${labelName}: ${label}\n${valueName}: ${value}</title></path>`;
      })
      .join('');

    const legend = safePoints
      .map((p, idx) => {
        const y = 90 + idx * 22;
        const fill = colors[idx % colors.length];
        const label = escapeHtml(p.label);
        const value = escapeHtml(p.value);
        return `
          <g>
            <rect x="520" y="${y - 10}" width="12" height="12" rx="3" fill="${fill}" />
            <text x="538" y="${y}" font-size="12" fill="#0f172a">${label}</text>
            <text x="860" y="${y}" font-size="12" fill="#64748b" text-anchor="end">${value}</text>
          </g>
        `;
      })
      .join('');

    const donutHole = innerR > 0 ? `<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#ffffff" />` : '';

    const svg = `
      ${segments}
      ${donutHole}
      ${legend}
    `;
    return renderSvgHtml(svg, selectedChartType === 'donut' ? 'Donut chart' : 'Pie chart', `${labelName} / ${valueName}`);
  }

  return renderSvgHtml(`
    ${yAxisSvg}
    <line x1="${marginLeft}" y1="${marginTop + plotH}" x2="${width - marginRight}" y2="${marginTop + plotH}" stroke="#cbd5e1" stroke-width="1" />
    <line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + plotH}" stroke="#cbd5e1" stroke-width="1" />
    ${barsSvg}
  `, 'Bar chart');
};

export const generateSeoInsightsFromData = async (
  project: ResearchProject,
  keyword: string,
  location: string,
  data: SeoKeywordApiResult,
): Promise<string> => {
  const sessions = project.researchSessions || [];
  const latest = sessions[sessions.length - 1];

  const contextLines: string[] = [];
  contextLines.push(`Project: ${project.name}`);
  if (project.description) contextLines.push(`Description: ${project.description}`);
  if (latest?.topic) contextLines.push(`Latest research topic: ${latest.topic}`);
  if (latest?.researchReport?.summary || latest?.researchReport?.tldr) {
    contextLines.push(
      `Latest research summary: ${latest.researchReport?.summary || latest.researchReport?.tldr}`,
    );
  }

  const context = contextLines.join("\n");

  const prompt = `You are an SEO strategist helping refine a research-driven content project.\n\nPROJECT CONTEXT:\n${context || "No extra project context."
    }\n\nTARGET KEYWORD: "${keyword}"\nTARGET LOCATION: ${location || "Global"
    }\n\nRAW SEO DATA FROM GOOGLE KEYWORD INSIGHT (RapidAPI):\n- Global results (globalkey):\n${JSON.stringify(
      data.global ?? {},
      null,
      2,
    )}\n\n- Local keyword research (keysuggest):\n${JSON.stringify(
      data.local ?? {},
      null,
      2,
    )}\n\n- Top opportunity keywords (topkeys):\n${JSON.stringify(
      data.top ?? {},
      null,
      2,
    )}\n\nYour job is to translate this REAL keyword data into a clear SEO plan that a content strategist can act on.\n\nPlease provide a concise but actionable report with these sections (use markdown headings and bullet lists):\n\n1. Keyword Overview\n   - Summarize overall search demand, competition, and notable trends for the main keyword and its close variants.\n\n2. Priority Keyword Clusters\n   - Group related keywords into 3-6 clusters.\n   - For each cluster, list 3-8 high-value keywords with any important metrics (e.g., volume, CPC, competition) if present in the data.\n\n3. Content Strategy & Titles\n   - Recommend 5-10 content pieces (articles, landing pages, guides) tailored to this project.\n   - For each, include: working title, primary keyword, 1-2 secondary keywords, and target intent (informational/commercial/transactional).\n\n4. On-Page SEO Checklist\n   - Give specific advice for title tags, meta descriptions, H1/H2 structure, and internal linking for this project.\n\n5. Quick Wins & Long-Term Opportunities\n   - Highlight a few "quick win" keywords (easier to rank, good volume) and a few longer-term strategic targets.\n\nIMPORTANT:\n- Use the numeric data if you can infer it from the JSON (volume, CPC, competition, etc.), but if a field is missing, do NOT invent numbers—just reason qualitatively.\n- Keep the tone practical and concrete, suitable for a marketing strategist executing an SEO/content plan.\n- Output MUST be valid markdown, no surrounding code fences.`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.6,
        // Allow a longer, multi-section SEO plan without truncation.
        maxOutputTokens: 4096,
        // Use text/plain; the content is still markdown-formatted but the
        // model currently restricts response_mime_type away from text/markdown.
        responseMimeType: "text/plain",
      },
    });

    return response.text?.trim() || "";
  } catch (error) {
    console.error("Failed to generate SEO insights from data:", error);
    return "SEO insights are currently unavailable due to an AI error.";
  }
};

export const extractImageColors = async (base64Image: string): Promise<DualTheme | null> => {
  if (!base64Image || !base64Image.startsWith('data:image')) return null;
  const cleanBase64 = base64Image.split(',')[1];

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png', // Assume PNG from our generation, or JPEG
              data: cleanBase64
            }
          },
          {
            text: `Analyze this image and extract TWO harmonious UI color palettes: one for Light Mode and one for Dark Mode.
             
             CRITICAL TEXT COLOR RULES:
             - Light mode: ALL text colors MUST be DARK SHADES (low lightness, high saturation). Use the darkened version of primary/secondary colors. Examples: #1a365d (dark blue), #2d3748 (dark gray-blue), #1e3a5f (dark navy).
             - Dark mode: ALL text colors MUST be LIGHT SHADES (high lightness). Use the lightened version of primary/secondary colors. Examples: #e2e8f0 (light gray), #90cdf4 (light blue), #fed7aa (light orange).
             - Text colors should be thematic variations of primary/secondary, NOT pure black/white.
             
             Return ONLY a raw JSON object with this exact structure (no markdown, no explanations):
             {
               "light": {
                 "primary": "#hex (vibrant, saturated color)",
                 "secondary": "#hex (complementary to primary)",
                 "accent": "#hex (bright highlight color)",
                 "background": "#hex (light/white tinted, e.g. #f7fafc, #ffffff)",
                 "surface": "#hex (slightly darker than background, e.g. #edf2f7)",
                 "text": "#hex (DARK shade of primary - must be readable on light background, lightness < 30%)"
               },
               "dark": {
                 "primary": "#hex (same hue as light, but adjusted for dark mode)",
                 "secondary": "#hex (same hue as light secondary, adjusted)",
                 "accent": "#hex (bright accent that pops on dark)",
                 "background": "#hex (dark/black tinted, e.g. #1a202c, #0d1117)",
                 "surface": "#hex (slightly lighter than background, e.g. #2d3748)",
                 "text": "#hex (LIGHT shade of primary - must be readable on dark background, lightness > 70%)"
               }
             }
             `
          }
        ]
      },
      config: {
        responseMimeType: 'application/json'
      }
    });

    let text = response.text;
    if (text) {
      // Robust JSON cleaning
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        text = text.substring(start, end + 1);
      }
      const theme = JSON.parse(text) as DualTheme;

      // Post-process to ensure text color contrast is correct
      return validateAndFixThemeColors(theme);
    }
    return null;

  } catch (error) {
    console.error("Color extraction failed:", error);
    return null;
  }
};

// Helper to convert hex to HSL for color manipulation
const hexToHsl = (hex: string): { h: number; s: number; l: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 0, l: 50 };

  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
};

// Helper to convert HSL to hex
const hslToHex = (h: number, s: number, l: number): string => {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

// Validate and fix theme colors to ensure proper contrast
const validateAndFixThemeColors = (theme: DualTheme): DualTheme => {
  // Check light mode text - must be dark (lightness < 35%)
  const lightTextHsl = hexToHsl(theme.light.text);
  if (lightTextHsl.l > 35) {
    // Text is too light for light mode - darken it
    const primaryHsl = hexToHsl(theme.light.primary);
    theme.light.text = hslToHex(primaryHsl.h, Math.min(primaryHsl.s, 60), 20);
  }

  // Check dark mode text - must be light (lightness > 65%)
  const darkTextHsl = hexToHsl(theme.dark.text);
  if (darkTextHsl.l < 65) {
    // Text is too dark for dark mode - lighten it
    const primaryHsl = hexToHsl(theme.dark.primary);
    theme.dark.text = hslToHex(primaryHsl.h, Math.min(primaryHsl.s, 40), 85);
  }

  // Validate background colors
  const lightBgHsl = hexToHsl(theme.light.background);
  if (lightBgHsl.l < 85) {
    // Background too dark for light mode
    theme.light.background = hslToHex(lightBgHsl.h, Math.min(lightBgHsl.s, 15), 97);
  }

  const darkBgHsl = hexToHsl(theme.dark.background);
  if (darkBgHsl.l > 25) {
    // Background too light for dark mode
    theme.dark.background = hslToHex(darkBgHsl.h, Math.min(darkBgHsl.s, 30), 12);
  }

  return theme;
};

// ---------------------------------------------------------
// 4. Veo Video Generation
// ---------------------------------------------------------

// Helper to handle the key selection
export const ensureVeoKey = async (): Promise<boolean> => {
  // @ts-ignore
  if (window.aistudio && window.aistudio.hasSelectedApiKey) {
    // @ts-ignore
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
      return true; // Assume success/retry flow
    }
    return true;
  }
  return false;
};



// ---------------------------------------------------------
// 5. Blog Post Content Generation (REPLACES OLD FUNCTION)
// ---------------------------------------------------------
export const generateStructuredBlogPost = async (topic: string, summary: string, keyPoints: any[], projectContext?: string): Promise<BlogPost> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `
    ROLE: Elite Tech Journalist & Editor.
    TOPIC: "${topic}"
    SUMMARY: "${summary.substring(0, 1000)}"
    KEY POINTS: ${JSON.stringify(keyPoints)}
    ${projectContext ? `\n    PROJECT CONTEXT:\n    ${projectContext}\n` : ''}

    TASK: Write a high-quality, engaging blog post (approx 400-500 words).
    
    REQUIREMENTS:
    1. Title: Catchy, viral-worthy headline.
    2. Subtitle: Intriguing hook.
    3. Content: Well-structured Markdown (use ## for headers, ** for bold, > for quotes).
       - Include an Intro, 2-3 Body Sections based on key points, and a Conclusion.
    4. Image Prompt: A description for a cover image that matches the article's tone.

    OUTPUT JSON:
    {
      "title": "string",
      "subtitle": "string",
      "content": "markdown string",
      "imagePrompt": "string"
    }
    `;

    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    let text = response.text || "{}";
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      text = text.substring(start, end + 1);
    }
    return JSON.parse(text);

  } catch (error) {
    console.error("Blog post generation error:", error);
    throw error;
  }
};

// ---------------------------------------------------------
// 6. Deep Research (Gemini 3 Pro - Multi-Stage Verification Protocol)
// ---------------------------------------------------------

// Helper to ensure we never exceed the URL Context limit (20 URLs per request).
// When urlContext is enabled, we keep only the first `maxUrls` HTTP(S) URLs in
// the prompt and replace the rest with non-URL placeholders so the tool does
// not attempt to fetch them.
// Helper to ensure we never exceed the URL Context limit (20 URLs per request).
// When urlContext is enabled, we keep only the first `maxUrls` HTTP(S) URLs in
// the prompt and replace the rest with non-URL placeholders so the tool does
// not attempt to fetch them.
function limitUrlsInPrompt(prompt: string, maxUrls: number = 20): string {
  // Regex matches http/https URLs OR www. URLs to be safe, ensuring we catch everything the API might.
  const urlRegex = /((?:https?:\/\/[^\s)"']+|www\.[^\s)"']+))/g;
  let count = 0;
  return prompt.replace(urlRegex, (url) => {
    count++;
    if (count <= maxUrls) return url;
    // Replace extra URLs with a non-URL placeholder so urlContext ignores them.
    return `[URL_${count - maxUrls}_omitted]`;
  });
}

// Helper to request user location from the browser
export const getUserLocation = async (): Promise<{ lat: number; lng: number } | null> => {
  if (typeof window === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        console.warn('Location permission denied or unavailable:', err);
        resolve(null);
      },
      { timeout: 10000 }
    );
  });
};

// Helper to execute a single phase of research
async function executeResearchPhase(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
  onUpdate: ((type: 'thought' | 'tool', text: string) => void) | undefined,
  knownUrls: Set<string>,
  toolsMode: 'search' | 'functions' | 'read' | 'hybrid' = 'search',
  userLocation?: { lat: number, lng: number }
): Promise<{ text: string, sources: Source[], usedModel: string }> {

  let activeLocation = userLocation;
  // Heuristic: If prompt implies local search and we don't have location, ask for it.
  if (!activeLocation && (toolsMode === 'search' || toolsMode === 'hybrid')) {
    const locKeywords = ['near', 'local', 'area', 'closest', 'nearby', 'places'];
    if (locKeywords.some(k => prompt.toLowerCase().includes(k))) {
      onUpdate?.('tool', 'Requesting location for local search...');
      try {
        const loc = await getUserLocation();
        console.log('[executeResearchPhase] getUserLocation result:', loc);
        if (loc) {
          activeLocation = loc;
          onUpdate?.('tool', `Location acquired: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`);
        } else {
          onUpdate?.('tool', 'Location permission denied. Continuing without location.');
        }
      } catch (e) {
        console.warn('Failed to get location:', e);
      }
    }
  }

  console.log('[executeResearchPhase] Final activeLocation:', activeLocation);

  // Initial contents with the prompt
  const effectivePrompt =
    toolsMode === 'read' || toolsMode === 'hybrid'
      ? limitUrlsInPrompt(prompt)
      : prompt;
  let contents = [{ role: 'user', parts: [{ text: effectivePrompt }] }];
  let fullText = "";

  // Aggregators for metadata across multiple potential turns
  const allGroundingChunks: any[] = [];
  const allUrlMetadata: any[] = [];

  const extraSources: Source[] = [];

  let keepGoing = true;
  let loopCount = 0;

  // Helper to generate content stream with retry
  const generateStream = async (startModel: string): Promise<{ stream: any, finalModel: string }> => {
    // Helper to run specific model config
    const runStream = async (modelName: string, budget: number) => {
      const toolConfig =
        (toolsMode === 'search' || toolsMode === 'hybrid') && activeLocation
          ? {
            retrievalConfig: {
              latLng: {
                latitude: activeLocation.lat,
                longitude: activeLocation.lng,
              },
            },
          }
          : undefined;

      const tools: any[] = [];

      const isG3 = isGemini3(modelName);

      // NOTE: Google Search and FunctionDeclarations CANNOT be mixed in the same request.
      // Hybrid mode combines Google Search, Maps, and URL Context for maximum research power.
      // Code execution is added to all modes for calculations, data analysis, and verification.
      if (toolsMode === 'search') {
        tools.push({ googleSearch: {} });
        // Grounding with Google Maps is NOT currently supported on Gemini 3 models.
        if (!isG3) tools.push({ googleMaps: {} });
      } else if (toolsMode === 'functions') {
        tools.push({ functionDeclarations: [cryptoPriceTool, stockPriceTool, searchRemoteJobsTool, wizaProspectSearchTool, newsSearchTool, braveImageSearchTool] });
      } else if (toolsMode === 'read') {
        // urlContext can be used on its own for specific deep reads
        tools.push({ urlContext: {} });
        tools.push({ codeExecution: {} });
      } else if (toolsMode === 'hybrid') {
        tools.push({ googleSearch: {} });
        // Grounding with Google Maps is NOT currently supported on Gemini 3 models.
        if (!isG3) tools.push({ googleMaps: {} });
        tools.push({ urlContext: {} });
      }

      const config: any = {
        tools: tools,
        toolConfig,
      };

      // Gemini 3 models use thinking_level instead of legacy thinkingBudget.
      if (isG3) {
        config.thinkingConfig = {
          includeThoughts: true,
          // Gemini 3 models transition to level-based thinking.
          // @ts-ignore
          thinking_level: budget > 16384 ? 'medium' : 'low'
        };
      } else {
        config.thinkingConfig = {
          includeThoughts: true,
          thinkingBudget: budget,
        };
      }

      return await ai.models.generateContentStream({
        model: modelName,
        // @ts-ignore
        contents: contents,
        config: config
      });
    };

    const isPremiumModel = startModel === MODEL_SMART || startModel === MODEL_MEDIUM;
    const budget = isPremiumModel ? 32768 : 16384;

    try {
      return {
        stream: await runStream(startModel, budget),
        finalModel: startModel
      };
    } catch (error) {
      // Improved Fallback Chain: Premium -> Gemini 3 Flash (Super Fast) -> Gemini 2.5 Flash (Fast)
      if (isPremiumModel) {
        console.warn(`[Fallback] ${startModel} failed. Switching to ${MODEL_SUPER_FAST}.`);
        onUpdate?.('tool', `⚠️ High traffic - switching to lighter model...`);
        try {
          return {
            stream: await runStream(MODEL_SUPER_FAST, 16384),
            finalModel: MODEL_SUPER_FAST
          };
        } catch (err2) {
          console.warn(`[Fallback] ${MODEL_SUPER_FAST} failed. Switching to ${MODEL_FAST}.`);
          try {
            return {
              stream: await runStream(MODEL_FAST, 8192),
              finalModel: MODEL_FAST
            };
          } catch (err3) {
            throw err3;
          }
        }
      }
      throw error;
    }
  };

  // Track the effective model to ensure subsequent loop iterations use the fallback
  let currentLoopModel = model;

  // Loop to handle tool calls (function execution)
  while (keepGoing && loopCount < 10) { // Increased limits for deeper research
    keepGoing = false;
    loopCount++;

    const { stream: responseStream, finalModel } = await generateStream(currentLoopModel);

    // Update currentLoopModel so subsequent tool calls in this phase use the stable model
    currentLoopModel = finalModel;

    // We need to reconstruct the model's turn to add it to history if there is a function call
    // Using aggregation to handle streaming fragmentation which can cause duplicate function calls
    let currentModelTurnParts: any[] = [];
    let aggregatedFunctionCalls: any[] = [];

    for await (const chunk of responseStream) {
      const candidate = chunk.candidates?.[0];

      // 1. Capture Grounding Metadata (Search & Maps)
      if (candidate?.groundingMetadata) {
        if (candidate.groundingMetadata.groundingChunks) {
          allGroundingChunks.push(...candidate.groundingMetadata.groundingChunks);
        }
        if (candidate.groundingMetadata.webSearchQueries) {
          // Log unique search queries
          for (const query of candidate.groundingMetadata.webSearchQueries) {
            onUpdate?.('tool', `Running Search: "${query}"`);
          }
        }
      }

      // 2. Capture URL Context Metadata
      // @ts-ignore
      if (candidate?.urlContextMetadata) {
        // @ts-ignore
        const urls = candidate.urlContextMetadata.urlMetadata || [];
        allUrlMetadata.push(...urls);

        for (const meta of urls) {
          const url = meta.retrievedUrl || (meta as any).retrieved_url;
          if (url && !knownUrls.has(url)) {
            knownUrls.add(url);
            onUpdate?.('tool', `Reading Source: ${url.substring(0, 45)}...`);
          }
        }
      }

      // 3. Capture Content Parts (Text, Thoughts, FunctionCalls)
      // CRITICAL: Aggregate parts to prevent fragmentation which causes missing signatures
      const parts = candidate?.content?.parts || [];
      for (const part of parts) {
        const lastPart = currentModelTurnParts[currentModelTurnParts.length - 1];
        const currentSig = (part as any).thoughtSignature;

        if (part.thought) {
          if (lastPart?.thought) {
            lastPart.text = (lastPart.text || "") + (part.text || "");
          } else {
            currentModelTurnParts.push({ ...part });
          }
          if (part.text) onUpdate?.('thought', part.text);
        } else if (part.functionCall) {
          // Deduplicate or Aggregate Function Calls
          // Streaming chunks might update the same function call.
          // If we see a function call with the same ID (or name if single), we should update it.
          // However, we MUST preserve `thoughtSignature`.

          const existingFC = currentModelTurnParts.find(p => p.functionCall && p.functionCall.name === part.functionCall.name);

          if (existingFC) {
            existingFC.functionCall = part.functionCall;
            if (currentSig) {
              (existingFC as any).thoughtSignature = currentSig;
            }
          } else {
            const newPart: any = { functionCall: part.functionCall };
            if (currentSig) {
              newPart.thoughtSignature = currentSig;
            }
            currentModelTurnParts.push(newPart);
          }

          // Log only if new
          if (!aggregatedFunctionCalls.find(fc => fc.name === part.functionCall.name)) {
            onUpdate?.('tool', `Calling Tool: ${part.functionCall.name}`);
            aggregatedFunctionCalls.push(part.functionCall);
          }
        } else if (part.text) {
          // Regular Text
          if (lastPart && !lastPart.thought && !lastPart.functionCall && lastPart.text !== undefined) {
            lastPart.text += part.text;
          } else {
            currentModelTurnParts.push({ ...part });
          }
          fullText += part.text;
        } else {
          // Other types (inlineData, etc) - just push
          currentModelTurnParts.push({ ...part });
        }
      }
    }

    // Extract final function calls from the aggregated parts
    const finalFunctionCalls = currentModelTurnParts
      .filter(p => p.functionCall)
      .map(p => p.functionCall);

    // If we have function calls, execute them and loop back
    if (finalFunctionCalls.length > 0) {
      // 1. Add model turn to history
      contents.push({ role: 'model', parts: currentModelTurnParts });

      // 2. Execute functions and build response parts
      const responseParts = [];
      for (const fc of finalFunctionCalls) {
        if (fc.name === 'get_crypto_price') {
          const symbol = (fc.args as any).symbol;
          onUpdate?.('tool', `Fetching crypto price for ${symbol}...`);
          const result = await getCryptoPrice(symbol);
          responseParts.push({
            functionResponse: {
              name: fc.name,
              id: fc.id,
              response: { result: result }
            }
          });
        } else if (fc.name === 'get_stock_price') {
          const symbol = (fc.args as any).symbol;
          onUpdate?.('tool', `Fetching stock price for ${symbol}...`);
          const result = await getStockPrice(symbol);
          responseParts.push({
            functionResponse: {
              name: fc.name,
              id: fc.id,
              response: { result: result }
            }
          });
        } else if (fc.name === 'search_remote_jobs') {
          const params = fc.args as any;
          onUpdate?.('tool', `Searching for remote jobs: ${JSON.stringify(params)}`);
          const result = await fetchRemoteJobs(params);
          responseParts.push({
            functionResponse: {
              name: fc.name,
              id: fc.id,
              response: { result: result }
            }
          });
        } else if (fc.name === 'wiza_prospect_search') {
          const args = fc.args as any;
          const size = typeof args.size === 'number' ? args.size : 10;
          const filters = (args.filters as any) || {};
          onUpdate?.('tool', `Searching Wiza prospects with filters: ${JSON.stringify(filters).slice(0, 200)}...`);
          let result: any;
          try {
            result = await wizaProspectSearch(filters, size);
          } catch (e: any) {
            console.error('Wiza prospect search error', e);
            result = { error: e?.message || 'Wiza search failed' };
          }
          responseParts.push({
            functionResponse: {
              name: fc.name,
              id: fc.id,
              response: result,
            },
          });
        } else if (fc.name === 'news_search') {
          const args = fc.args as any;
          const q = (args.q || '').toString().trim();
          const from = args.from ? String(args.from) : undefined;
          const to = args.to ? String(args.to) : undefined;
          const language = args.language ? String(args.language) : undefined;
          const sortBy = args.sortBy ? String(args.sortBy) : undefined;
          const pageSize = typeof args.pageSize === 'number' ? args.pageSize : undefined;

          onUpdate?.('tool', `Searching Google News for: ${q.substring(0, 80)}...`);

          const result = q
            ? await fetchNewsArticles({ q, from, to, language, sortBy, pageSize })
            : { error: 'Missing q' };

          try {
            const articles: any[] = Array.isArray((result as any)?.articles) ? (result as any).articles : [];
            for (const a of articles.slice(0, 25)) {
              const uri = (a?.url || '').toString();
              const title = (a?.title || a?.source || 'News Article').toString();
              if (uri && uri.startsWith('http')) {
                extraSources.push({ title, uri });
                knownUrls.add(uri);
              }
            }
          } catch {
            // Ignore source extraction errors
          }

          responseParts.push({
            functionResponse: {
              name: fc.name,
              id: fc.id,
              response: { result },
            },
          });
        } else if (fc.name === 'brave_image_search') {
          const args = fc.args as any;
          const q = (args.q || '').toString().trim();
          const count = typeof args.count === 'number' ? args.count : undefined;
          const safesearch = args.safesearch ? String(args.safesearch) : undefined;

          onUpdate?.('tool', `Searching Brave Images for: ${q.substring(0, 80)}...`);
          const result = q ? await fetchBraveImages({ q, count, safesearch }) : { error: 'Missing q' };

          try {
            const items: any[] = Array.isArray((result as any)?.results) ? (result as any).results : [];
            for (const it of items.slice(0, 10)) {
              const uri = (it?.url || '').toString();
              const title = (it?.title || 'Image Source').toString();
              if (uri && uri.startsWith('http')) {
                extraSources.push({ title, uri });
                knownUrls.add(uri);
              }
            }
          } catch {
            // ignore
          }

          responseParts.push({
            functionResponse: {
              name: fc.name,
              id: fc.id,
              response: { result },
            },
          });
        }
      }

      // 3. Add function responses to history
      if (responseParts.length > 0) {
        contents.push({ role: 'function', parts: responseParts });
        keepGoing = true; // Continue conversation

        // Inject tool data into the text stream for Phase 2
        for (const part of responseParts) {
          if (part.functionResponse) {
            const name = part.functionResponse.name;
            const responseStr = JSON.stringify(part.functionResponse.response, null, 2);
            fullText += `\n\n[SYSTEM_DATA_INJECTION: ${name}]\n${responseStr}\n\n`;
          }
        }
      }
    }
  }

  // Process Sources for this phase
  const derivedSources: Source[] = allGroundingChunks
    .map(c => {
      // Web Sources
      if (c.web) {
        return {
          title: c.web.title || "Web Source",
          uri: c.web.uri || ""
        };
      }
      // Map Sources
      if (c.maps) {
        // IMPORTANT: The maps grounding chunk type might need specific handling if the SDK updates.
        // For now we map common fields.
        const mapChunk = c.maps as any;
        return {
          title: mapChunk.sourceConfig?.title || "Google Maps Result",
          uri: mapChunk.googleMapsUri || mapChunk.desktopUri || ""
        };
      }
      return null;
    })
    .filter((s): s is Source => !!s && !!s.uri && s.uri.startsWith('http'));

  for (const meta of allUrlMetadata) {
    const uri = meta.retrievedUrl || meta.retrieved_url;
    if (uri && uri.startsWith('http')) {
      derivedSources.push({
        title: "Deep Read: " + (meta.title || uri.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]),
        uri: uri
      });
    }
  }

  const mergedSources = [...derivedSources, ...extraSources];
  const uniqueByUri = new Map<string, Source>();
  for (const s of mergedSources) {
    if (!s?.uri) continue;
    if (!uniqueByUri.has(s.uri)) {
      uniqueByUri.set(s.uri, s);
    }
  }

  return { text: fullText, sources: Array.from(uniqueByUri.values()), usedModel: currentLoopModel };
}

// Independent Game Generator (Uses Gemini 3 Pro to ensure high quality)
export const generateEducationalGame = async (
  topic: string,
  researchContext: string,
  concept: any
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    You are an expert Game Developer and Educational Technologist.
    
    TASK: Create a high-quality, interactive HTML5 mini-game to teach the user about "${topic}".

    REQUIRED MECHANIC:
    The game MUST follow this classic mechanic family: ${concept?.mechanic || 'unspecified'}
    - space_blaster: space shooter like Space Invaders/Space Blasters
    - asteroids: thrust + rotate + shoot + drifting hazards like Asteroids
    - tetris: falling blocks + line clears
    - pacman: maze navigation + collectibles + avoid/chase
    - platformer: side-scroller jumps + obstacles
    - merge_2048: sliding/merging tiles
    - tower_defense: place defenses + waves
    - duolingo_quiz: short lesson loop + streak + mastery
    - memory_match: card matching + recall
    - word_puzzle: word-building / crossword-like

    MECHANICS TOOLBOX (MANDATORY — add depth beyond the base mechanic):
    Incorporate AT LEAST 5 of the following mechanics/subsystems, adapted to the topic:
    - Scoring system: points, multipliers, combos, streaks, accuracy bonuses.
    - Progression: levels/waves, unlocking, mastery meter, skill tree-lite, stage select.
    - Difficulty curve: faster timers, more enemies, tighter constraints, adaptive difficulty.
    - Rewards: badges, achievements, loot drops, “unlock cards”, end-of-round summary.
    - Power-ups/abilities: limited-use boosts, shields, hints, slow-motion, skip, reroll.
    - Risk/reward: optional challenges for extra points, “hard mode” toggles.
    - Feedback loops: juicy hit feedback, success/failure toasts, end-of-round recap.
    - Tutorial/onboarding: 20–40s guided intro + “How to play” panel.
    - Pause/restart: pause menu, reset button, and a “play again” end screen.
    - Accessibility: reduced motion toggle (optional), readable contrast, large tap targets.

    INPUT MODES (CRITICAL):
    - Must be fully playable with mouse/touch.
    - If the mechanic benefits from keyboard, support it too (WASD/arrow keys/space), but do NOT require it.
    - Do not rely on pointer lock.

    RESEARCH CONTEXT (Content for the game):
    ${researchContext.substring(0, 15000)} // Truncate to fit context if needed
    
    GAME CONCEPT (Architect's Vision):
    Title: ${concept?.title || "Topic Master"}
    Goal: ${concept?.educationalGoal || "Test knowledge of the topic"}
    Type: ${concept?.type || "Simulation"}
    
    REQUIREMENTS:
    1. **Single File**: Output ONLY raw HTML with embedded CSS and JS (<script>).
    2. **Relevance**: The game content (questions, items, variables) MUST be directly based on the Research Context provided.
    
    3. **VISUAL DESIGN (CRITICAL)**:
       - Use a premium, modern UI (clean typography, spacing, subtle shadow/glow, crisp HUD).
       - You MAY use either:
         (A) HTML5 Canvas 2D for gameplay rendering, OR
         (B) DOM elements for tile/grid games, OR
         (C) Three.js (optional) when it truly adds value.
       - No external assets besides optional Three.js CDN.
       - The game's visuals and labels MUST incorporate topic-specific entities, terms, and relationships.
    
    4. **MOBILE-FIRST RESPONSIVE DESIGN (CRITICAL)**:
       The game will run inside an iframe with a fixed-height widget container (roughly ~600px tall).
       Your HTML MUST size itself to the iframe container — NOT the browser viewport.

       - **Do NOT use**: 100vh, position: fixed, or any layout that assumes full-screen.
       - **Do use**:
         * html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
         * a single root container (e.g. <div id="game-root">) sized to width:100%; height:100%; min-height:400px.
         * layout with flex/grid so the game area expands/shrinks without overflow.
         * if using <canvas>, it MUST automatically resize to the available container size.
           - Use ResizeObserver on the root/container.
           - Update canvas width/height with devicePixelRatio for crispness.
           - Keep canvas CSS size at 100% (no fixed pixel widths).
       - **No Horizontal Scroll**: ensure nothing overflows horizontally at any breakpoint.
       - **Never render text/buttons off-screen**.
       - **Safe area**: keep HUD inside padding so it’s not flush to edges.

       - **Container**: width: 100%, height: 100%, min-height: 400px.
       - **Mobile Breakpoint (@media max-width: 768px)**:
         * Buttons must be at least 48px tall with touch-friendly tap targets.
         * Font sizes: titles 1.25rem, body text 1rem minimum.
         * Padding/margins: Use generous spacing (16px+) for touch.
         * Quiz options: Stack vertically on mobile (flex-direction: column).
         * Score/stats: Smaller, positioned in corners or top bar.
       - **Tablet Breakpoint (@media max-width: 1024px)**:
         * 2-column grid for options if applicable.
       - **Touch Events**: All buttons must respond to both click AND touch events.
       - **Viewport Meta**: Include <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
       - **No Horizontal Scroll**: Ensure nothing overflows horizontally.

    5. **EMOJI-RICH UI (MANDATORY)**:
       - Use LOTS of emojis throughout the game to make it fun and engaging! 🎮✨
       - Title/Header: Include 2-3 relevant emojis (e.g., "🧠 Quiz Time! 🎯")
       - Buttons: Each button/option should have an emoji prefix (e.g., "🔥 Option A", "💡 Option B")
       - Score Display: Use emojis like "⭐ Score: 5" or "🏆 High Score"
       - Correct Answer: Show celebratory emojis (🎉 ✅ 🌟 💯 🚀)
       - Wrong Answer: Show encouraging emojis (❌ 😅 💪 Try again!)
       - Progress: Use visual emojis (📊 📈 🎯 🔋)
       - Topic-relevant emojis based on the research subject.
       - End screen: Big celebration with multiple emojis (🎊🏆🌟)
    
    6. **Gameplay Structure (CRITICAL)**:
       - Implement a clear game loop: start screen → play rounds/levels → results → retry/next.
       - Provide a clear win/lose condition or completion condition.
       - Always include a visible scoreboard/progress UI.
       - Keep the game state deterministic and resettable.

    7. **FAIL-SAFE RENDERING (CRITICAL)**:
       - The HTML must render something even if the game throws an error.
       - Add a small error overlay (window.onerror) that prints errors to the screen.
       - Do not require any network calls.

    OUTPUT:
    Return ONLY the raw HTML string. Do not wrap in markdown code blocks.
    `;

  const generate = async (model: string) => {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });
    let html = response.text || "";
    // Clean markdown if present
    html = html.replace(/```html/g, '').replace(/```/g, '').trim();
    return html;
  };

  const smartModel = await getSmartModel();
  let gameHtml = '';

  try {
    gameHtml = await generate(smartModel);
  } catch (e) {
    console.warn("Primary model failed for game gen, falling back to Flash", e);
    try {
      gameHtml = await generate(MODEL_FAST);
    } catch (err2) {
      console.error("Game generation failed completely", err2);
      return "";
    }
  }

  // Bug-checking step with gemini-3-flash-preview
  if (gameHtml) {
    try {
      console.log('[Game Gen] Running bug-check analysis...');
      const bugCheckPrompt = `Analyze this HTML5 game code for potential bugs and issues:

${gameHtml}

Check for:
1. JavaScript syntax errors
2. Logic bugs (undefined variables, missing event listeners, broken loops)
3. Game mechanics that don't work properly
4. Missing or incorrect Canvas API usage
5. Responsive design issues
6. Event handler problems

If you find ANY bugs or issues, return ONLY the fixed, complete HTML code with all bugs corrected.
If the code is bug-free, return exactly: NO_BUGS_FOUND

Return ONLY raw HTML or the exact text "NO_BUGS_FOUND". No markdown, no explanations.`;

      const bugCheckResponse = await ai.models.generateContent({
        model: MODEL_SUPER_FAST, // gemini-3-flash-preview
        contents: [{ role: 'user', parts: [{ text: bugCheckPrompt }] }],
      });

      let fixedHtml = (bugCheckResponse.text || '').trim();
      fixedHtml = fixedHtml.replace(/```html/g, '').replace(/```/g, '').trim();

      if (fixedHtml && fixedHtml !== 'NO_BUGS_FOUND' && fixedHtml.length > 100) {
        console.log('[Game Gen] ✅ Bugs found and fixed by gemini-3-flash-preview');
        gameHtml = fixedHtml;
      } else {
        console.log('[Game Gen] ✅ No bugs detected, using original game code');
      }
    } catch (bugCheckError) {
      console.warn('[Game Gen] Bug-check failed, using original game code:', bugCheckError);
      // Continue with original gameHtml if bug-checking fails
    }
  }

  return gameHtml;
}

export const generateTopicWidgetHtml = async (
  topic: string,
  summary: string,
  category?: string,
  userLocation?: { lat: number; lng: number }
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const googleMapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const googleMapsConfig = googleMapsKey
    ? `
    - **GOOGLE MAPS SUPPORTED**: If the topic is geographic (travel, real estate, location), you MAY use Google Maps JavaScript API.
      - JS: <script src="https://maps.googleapis.com/maps/api/js?key=${googleMapsKey}&v=beta&libraries=maps,marker&loading=async"></script>
      - HTML: <div id="map" style="position: absolute; top: 0; bottom: 0; width: 100%; border-radius: 12px;"></div> (Ensure container has explicit height if relative)
      - CSS Constraint: Add \`html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }\` to <style>.
      - Init Pattern: 
        async function initMap() {
          const { Map } = await google.maps.importLibrary("maps");
          const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
          const map = new Map(document.getElementById("map"), {
            center: { lat: ${userLocation?.lat || 40.7135}, lng: ${userLocation?.lng || -74.0066} },
            zoom: ${userLocation ? 14.5 : 2},
            mapId: 'DEMO_MAP_ID',
            heading: 0,
            tilt: 45
          });
          new AdvancedMarkerElement({ 
            map, 
            position: { lat: ${userLocation?.lat || 40.7135}, lng: ${userLocation?.lng || -74.0066} },
            title: "${topic.replace(/"/g, '\\"')}"
          });
        }
        initMap();
    `
    : `- **NO EXTERNAL ASSETS**: Do not use Google Maps or any external libraries (missing API key).`;

  const prompt = `
  You are an elite product designer and front-end architect.

  TOPIC: "${topic}"
  CATEGORY: "${category || 'General'}"
  SUMMARY: "${summary.substring(0, 1000)}"

  TASK:
  Create a single interactive HTML UI widget that helps the user explore or act on this topic.
  It should feel like a premium, modern dashboard card embedded in a research report.

  IMPORTANT STYLE CONSTRAINTS:
  - Produce a SINGLE LIGHT MODE design ONLY.
  - Do NOT include any light/dark theme toggles or dark-mode logic.
  - Use a clean, professional light palette (white surfaces, subtle borders, soft shadows).
  - Use system fonts only (no external fonts).

  INTERACTION CONSTRAINTS:
  - Use vanilla JS only (no frameworks).
  ${googleMapsConfig}
  - No other network calls or external assets allowed.
  - The widget MUST have at least 2 interactive controls (e.g., tabs, sliders, checkboxes, radio buttons, expandable details)
    and at least 1 live-updating output area (e.g., computed summary, recommendation, score, next steps).

  OUTPUT FORMAT (CRITICAL):
  - Output a COMPLETE HTML DOCUMENT suitable for iframe srcDoc:
    include <!doctype html>, <html>, <head>, <meta charset>, <meta name="viewport">, <style>, and <script>.
  - The main root element must be <div id="widget"> and everything should be contained inside it.
  - Use semantic HTML and accessible labels.
  - Keep it reasonably small (~250 lines max), but prioritize good UX.

  DESIGN GUIDELINES:
  - Rounded corners (12-16px), subtle shadow, generous spacing.
  - Clear hierarchy: kicker, title, short description, controls, output.
  - Use a two-column layout on desktop and single column on mobile.
  - Make the copy SPECIFIC to this topic (no generic placeholders).

  Pick ONE pattern that best fits this topic:
  - Interactive Map (ONLY if Google Maps is enabled and topic is geographic)
  - Scenario chooser + impact summary
  - Decision helper + recommendation
  - Mini planner + checklist + timeline
  - Learning path + progress + quiz-lite
  - Parameter exploration panel + computed result

  Return ONLY the raw HTML. No markdown, no explanation.
  `;

  const smartModel = await getSmartModel();

  const generate = async (model: string) => {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    let html = response.text || '';
    html = html.replace(/```html/gi, '').replace(/```/g, '').trim();
    return html;
  };

  try {
    return await generate(smartModel);
  } catch (e) {
    console.warn('Topic widget generation failed on primary model, falling back to fast model', e);
    try {
      return await generate(MODEL_FAST);
    } catch (err2) {
      console.error('Topic widget generation failed completely', err2);
      return '';
    }
  }
};

// New Query Widget for Gemini Lite
// Used by interactive widgets (quiz/calculator/oracle). For oracle/quiz, it
// judges the user's answer against the research context and returns markdown.
export const queryWidget = async (context: string, instruction: string, input: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `
        CONTEXT (RESEARCH JSON SNIPPET):
        ${context.substring(0, 5000)}

        WIDGET INSTRUCTION (may describe subtype quiz/calculator/oracle and how to behave):
        ${instruction}

        USER ANSWER:
        "${input}"

        ROLE:
        You are an INTERACTIVE ORACLE for this research. Interpret the widget instruction and treat the USER ANSWER as their attempt to answer a question about the research.

        TASK:
        - Work ONLY from the CONTEXT above.
        - If the widget behaves like an oracle or quiz, respond in **Markdown** with:
          1) A first line starting with either "**Correct!**" or "**Not quite.**".
          2) A line giving the correct answer in bold, e.g. "**Correct answer:** ...".
          3) 1–3 short bullet points (using "- ") giving extra explanation or insight drawn from the research.
        - If the widget behaves like a calculator or other tool, still respond in Markdown, focusing on the computed result plus 1–2 explanatory bullets.
        - Keep the whole response under about 150 words.
        `;

  const response = await ai.models.generateContent({
    model: MODEL_LITE,
    contents: prompt
  });
  return response.text || "No response generated.";
}

export const generateNoteSuggestions = async (currentNotes: string, topic: string): Promise<string[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  // Don't trigger on very short content
  if (!currentNotes || currentNotes.length < 5) return [];

  const prompt = `
    TOPIC: "${topic}"
    CURRENT USER NOTES: "${currentNotes.substring(0, 2000)}"
    
    TASK: Provide 3 short, relevant, predictive text suggestions or follow-up questions that the user might want to add to their notes.
    - Keep them under 8 words.
    - They should sound like natural continuations or smart research prompts.
    
    OUTPUT JSON ONLY: ["suggestion 1", "suggestion 2", "suggestion 3"]
    `;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    const text = response.text || "[]";
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = clean.indexOf('[');
    const end = clean.lastIndexOf(']');
    const jsonStr = (start !== -1 && end !== -1) ? clean.substring(start, end + 1) : "[]";

    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Suggestion gen failed", e);
    return [];
  }
};

// NEW: Generate Note Fusion
export const generateNoteFusion = async (nodeA: NoteNode, nodeB: NoteNode): Promise<{ title: string, content: string }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `
    FUSION TASK: Combine these two concepts into a new, insightful synthesis or intersection.
    
    Concept A: "${nodeA.title}" - ${nodeA.content}
    Concept B: "${nodeB.title}" - ${nodeB.content}
    
    OUTPUT JSON: { "title": "Short fused title", "content": "2-sentence synthesis of how these connect." }
    `;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    let text = response.text || "{}";
    // Clean markdown
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    // Remove potentially wrapping array if model messes up
    if (text.startsWith('[')) text = text.substring(1, text.length - 1);

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      text = text.substring(start, end + 1);
    }

    return JSON.parse(text);
  } catch (e) {
    console.error("Fusion failed", e);
    return { title: "Fusion Failed", content: "Could not combine notes." };
  }
};

// NEW: Generate Sub Topics
export const generateSubTopics = async (node: NoteNode): Promise<{ title: string, content: string }[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `
    BRANCHING TASK: Provide 3 distinct sub-topics or deeper details related to this concept.
    
    Concept: "${node.title}" - ${node.content}
    
    OUTPUT JSON: [ { "title": "Subtopic Title", "content": "Brief explanation" }, ... ]
    `;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    let text = response.text || "[]";
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      text = text.substring(start, end + 1);
    }
    return JSON.parse(text);
  } catch (e) {
    console.error("Branching failed", e);
    return [];
  }
};

export const generateNoteContent = async (node: NoteNode, context: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `
ROLE: You are a precise, helpful note-writing assistant.

CONTEXT:
${(context || '').substring(0, 9000)}

NOTE TITLE:
"${(node.title || '').trim()}"

CURRENT NOTE CONTENT (may be empty or placeholder):
"${(node.content || '').substring(0, 4000)}"

TASK:
- Generate well-structured Markdown content for this note that fits the NOTE TITLE.
- Prefer concise, high-signal writing.
- Use headings and bullet points where helpful.
- If the CONTEXT is insufficient, make reasonable assumptions but keep them clearly labeled as assumptions.
- Output Markdown ONLY.
`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: prompt,
    });

    return response.text || "";
  } catch (e) {
    console.error('Note content generation failed', e);
    return 'Failed to generate note.';
  }
};

// NEW: Generate Initial Nodes for Note Map
export const generateInitialNodes = (report: ResearchReport): NoteNode[] => {
  const nodes: NoteNode[] = [];
  // Default center for initial render if window not available (though it usually is in React)
  const centerX = typeof window !== 'undefined' ? window.innerWidth / 2 : 500;
  const centerY = typeof window !== 'undefined' ? window.innerHeight / 2 : 500;

  // Distinct, vibrant palette for initial nodes to aid memory and distinction
  const DISTINCT_PALETTE = [
    '#3b82f6', // Blue 500
    '#ef4444', // Red 500
    '#10b981', // Emerald 500
    '#f59e0b', // Amber 500
    '#8b5cf6', // Violet 500
    '#ec4899', // Pink 500
    '#06b6d4', // Cyan 500
    '#6366f1', // Indigo 500
  ];

  // Root Node (Topic) - Keeps primary theme color or defaults to distinct Indigo
  nodes.push({
    id: 'root',
    x: centerX - 150,
    // Position so that the card's visual center (roughly y + 100) aligns
    // with the vertical center of the viewport, avoiding overlap with
    // surrounding nodes.
    y: centerY - 100,
    title: report.topic,
    content: report.tldr || report.summary.substring(0, 150) + "...",
    color: report.theme ? report.theme.light.primary : '#3b82f6',
    width: 300
  });

  // Key Points as surrounding nodes
  if (report.keyPoints) {
    const count = Math.min(report.keyPoints.length, DISTINCT_PALETTE.length);
    report.keyPoints.slice(0, count).forEach((kp, idx) => {
      const angle = (idx / count) * Math.PI * 2;
      const radius = 350;
      // Assign a unique color from the palette
      const distinctColor = DISTINCT_PALETTE[idx % DISTINCT_PALETTE.length];

      nodes.push({
        id: `kp-${idx}`,
        x: (centerX - 125) + Math.cos(angle) * radius,
        y: (centerY - 100) + Math.sin(angle) * radius,
        title: kp.title,
        content: kp.details,
        color: distinctColor,
        width: 250,
        parentId: 'root'
      });
    });
  }

  return nodes;
};

// NEW: Generate Social Media Campaign
export const generateSocialCampaign = async (topic: string, summary: string, keyPoints: any[]): Promise<SocialPost[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `
    ROLE: Social Media Expert.
    TOPIC: "${topic}"
    SUMMARY: "${summary.substring(0, 1000)}"
    KEY POINTS: ${JSON.stringify(keyPoints)}

    TASK: Create 3 distinct, high-engagement social media posts (mix of LinkedIn/Instagram styles) to promote this research.
    
    REQUIREMENTS:
    1. Post 1 (Instagram): "Did You Know?" hook, visual focus, short & punchy.
    2. Post 2 (LinkedIn): Professional insight, data-driven, "Thought Leadership" style.
    3. Post 3 (Twitter/X): A provocative question or future-looking statement, concise (under 280 chars).
    
    For EACH post, provide a 'imagePrompt' that describes a visual to accompany the text. The image prompt should be descriptive, modern, and suitable for AI generation.

    OUTPUT JSON ARRAY:
    [
      {
        "platform": "Instagram" | "LinkedIn" | "Twitter",
        "caption": "string (The full post text)",
        "hashtags": ["string"],
        "imagePrompt": "string (Visual description for AI)"
      }
    ]
    `;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    let text = response.text || "[]";
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      text = text.substring(start, end + 1);
    }
    return JSON.parse(text);
  } catch (e) {
    console.error("Social campaign gen failed", e);
    return [];
  }
};

/**
 * Search Pexels for a relevant stock photo
 */
const searchPexelsImage = async (query: string): Promise<string | null> => {
  try {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) {
      console.warn('PEXELS_API_KEY not set, skipping Pexels search');
      return null;
    }

    const response = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: apiKey } }
    );

    if (!response.ok) {
      console.warn(`Pexels API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.photos && data.photos.length > 0) {
      return data.photos[0].src.large; // High quality image
    }

    return null;
  } catch (e) {
    console.error('Pexels search failed:', e);
    return null;
  }
};

export const performDeepResearch = async (
  topic: string,
  onUpdate?: (type: 'thought' | 'tool', text: string) => void,
  userLocation?: { lat: number, lng: number },
  projectContext?: string,
  onRateLimitError?: (error: any) => void,
  projectId?: string,
  ownerUid?: string
): Promise<ResearchReport> => {
  const researchAi = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const currentDate = new Date().toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const knownUrls = new Set<string>();

  const wizaToolPlan = await detectWizaResearchTools(topic);


  const GAME_MECHANICS: Array<(NonNullable<ResearchReport['gameConcept']> & { mechanic: any })['mechanic']> = [
    'space_blaster',
    'asteroids',
    'tetris',
    'pacman',
    'platformer',
    'merge_2048',
    'tower_defense',
    'duolingo_quiz',
    'memory_match',
    'word_puzzle',
  ];

  const loadRecentGameMechanics = (): string[] => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('recent-game-mechanics');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
    } catch {
      return [];
    }
  };

  const saveRecentGameMechanics = (mechanic: string) => {
    if (typeof window === 'undefined') return;
    try {
      const prev = loadRecentGameMechanics();
      const next = [mechanic, ...prev.filter(m => m !== mechanic)].slice(0, 6);
      window.localStorage.setItem('recent-game-mechanics', JSON.stringify(next));
    } catch {
    }
  };

  const hashString = (value: string): number => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  const pickGameMechanic = (seed: string, avoid: string[]): string => {
    const avoidSet = new Set(avoid);
    const candidates = GAME_MECHANICS.filter(m => !avoidSet.has(m));
    const pool = candidates.length ? candidates : GAME_MECHANICS;
    const idx = hashString(`${seed}:${Date.now()}`) % pool.length;
    return pool[idx];
  };

  const recentGameMechanics = loadRecentGameMechanics();

  const knowledgeBasePrefix = projectContext ? `
=== CONTEXT FROM PROJECT KNOWLEDGE BASE ===
The user has provided the following documents and context from their project that may be relevant to this research.
Use this as background information and incorporate any relevant details into your analysis.

${projectContext}

=== END OF PROJECT KNOWLEDGE BASE ===

` : '';

  // Model State Tracking: Use subscription-aware model selection for synthesis, 
  // but prioritize super-fast Flash for the iterative research steps.
  let currentModel = MODEL_SUPER_FAST;

  const handleResearchError = (error: any) => {
    if (checkRateLimit(error)) {
      onRateLimitError?.(error);
    }
  };

  // JSON Structure definition for prompt
  const jsonStructure = `
  {
    "topic": "string",
    "category": "string - One word broad category (e.g. Technology, Finance, Health, Science, Arts, General)",
    "headerImagePrompt": "string - A descriptive image prompt for the report header. MUST INCLUDE specific text to render inside the image AND specific color palette keywords relevant to the topic (e.g., 'Cyberpunk Neon colors', 'Earthy Green and Brown', 'Corporate Blue and Grey').",
    "tldr": "string - 2 to 3 impactful sentences summarizing the absolute essence.",
    "summary": "string - Detailed context paragraph.",
    "expandedSummary": "string - A longer, read-aloud friendly summary (approx 60-120 seconds spoken). Write in natural narration, no bullet points, no markdown.",
    "narrationScript": "string - A single-speaker podcast-style narration script (approx 60-120 seconds spoken). Must be clean spoken text, no markdown, no speaker labels, no sound effects, no stage directions.",
    "keyPoints": [
      {
        "title": "string",
        "details": "string - Comprehensive explanation of this finding",
        "priority": "High" | "Medium" | "Low"
      }
    ],
    "slides": [
      {
        "title": "string",
        "content": ["string", "string"],
        "imagePrompt": "string"
      }
    ],
    "dynamicSections": [
      {
        "title": "string - The heading for this section",
        "type": "stats" | "top_picks" | "interactive_widget" | "timeline" | "comparison" | "text" | "table" | "faq" | "checklist" | "quote" | "radar_chart" | "swot_analysis" | "process_flow" | "metric_card_grid" | "tradingview_chart" | "map_widget" | "scenario_slider" | "parameter_knobs" | "venn_diagram" | "sankey_flow" | "bias_radar" | "influence_network" | "root_cause_tree" | "sentiment_timeline" | "insight_cards" | "word_cloud" | "iceberg_depth" | "shield_meter" | "confidence_gauge" | "action_items" | "eli5_toggle" | "persona_grid" | "funnel_breakdown" | "channel_mix_board" | "messaging_matrix" | "competitor_battlecards" | "experiment_backlog" | "content_calendar" | "pricing_tiers" | "opportunity_grid" | "gtm_playbook" | "risk_matrix" | "decision_tree" | "stakeholder_map" | "milestone_tracker" | "resource_allocation" | "heat_map" | "bubble_chart" | "before_after" | "pros_cons_neutral" | "feature_comparison" | "rating_breakdown" | "skill_tree" | "dependency_graph" | "cost_benefit" | "impact_effort" | "learning_path" | "recipe_steps" | "product_showcase" | "poll_results" | "org_chart" | "mood_board" | "event_agenda" | "testimonials" | "tips_grid" | "numbered_list" | "resource_links" | "glossary" | "trivia_facts" | "highlight_box" | "progress_tracker" | "poetry_display" | "music_player" | "artwork_gallery" | "book_shelf" | "creative_showcase" | "periodic_element" | "discovery_timeline" | "formula_display" | "anatomy_explorer" | "experiment_steps" | "event_calendar" | "venue_cards" | "directions_guide" | "local_spotlight" | "flashcard_deck" | "quiz_interactive" | "concept_map" | "study_schedule" | "recipe_card" | "workout_routine" | "nutrition_breakdown" | "habit_tracker" | "company_profile" | "executive_team" | "product_lineup" | "tech_stack" | "destination_guide" | "hotel_showcase" | "travel_itinerary" | "movie_cast" | "game_roster" | "historical_figure" | "wildlife_encyclopedia" | "plant_guide" | "space_exploration" | "fashion_lookbook" | "architectural_style" | "vehicle_showcase" | "property_listing" | "news_gallery" | "entity_logo_wall" | "key_people_gallery" | "chart_image_gallery" | "buying_guide" | "streaming_guide" | "gift_ideas" | "diy_project" | "pet_care" | "parenting_tips" | "hobby_starter" | "budget_breakdown" | "life_hack_cards" | "review_summary" | "podcast_playlist" | "season_guide" | "celebration_planner",
        "content": "any - See schema requirements below!",
        "icon": "string - emoji representing the section"
      }
    ],
    "funSection": "string - HTML for interactive game",
    "marketImplications": "string",
    "gameConcept": {
       "title": "string",
       "educationalGoal": "string",
       "type": "quiz" | "simulation" | "puzzle",
       "mechanic": "space_blaster" | "asteroids" | "tetris" | "pacman" | "platformer" | "merge_2048" | "tower_defense" | "duolingo_quiz" | "memory_match" | "word_puzzle"
    },
    "jobListings": [
        {
            "title": "string",
            "company": "string",
            "location": "string",
            "url": "string",
            "type": "string",
            "salary": "string",
            "pubDate": "string"
        }
    ]
  }
  `;

  // PHASE 1a: BROAD LANDSCAPE & ENTITIES (ENHANCED - 8+ SEARCHES)
  let phase1aPrompt = `${knowledgeBasePrefix}
  Analyze the user's request: "${topic}".
  Current Date: ${currentDate}.
  
  PHASE 1a: COMPREHENSIVE LANDSCAPE MAPPING & ENTITY IDENTIFICATION
  ${projectContext ? '\n  NOTE: You have access to documents from the project knowledge base above. Reference and incorporate relevant information from these documents into your research.\n' : ''}
  
  You MUST execute EXTENSIVE searches to build a complete picture. This is the foundation of the research.
  
  MANDATORY SEARCH STRATEGY (Execute ALL applicable):
  1. **CORE CONCEPT SEARCH**: Search for the main topic definition, overview, and fundamentals.
  2. **HISTORY & EVOLUTION**: Search for historical context, timeline, and key milestones.
  3. **KEY PLAYERS**: Search for main companies, people, organizations, or technologies involved.
  4. **MARKET DATA**: Search for market size, growth rates, and industry statistics.
  5. **RECENT NEWS**: Search for latest developments (last 30 days).
  6. **EXPERT OPINIONS**: Search for expert analysis, reviews, or commentary.
  7. **CONTROVERSIES/CHALLENGES**: Search for criticism, challenges, or debates.
  8. **FUTURE OUTLOOK**: Search for predictions, forecasts, and trends.
  
  LOCATION INTELLIGENCE:
  - Use 'googleMaps' if the topic implies physical locations, businesses, or geographic data.
  
  ENTITY & TICKER EXTRACTION:
  - **CRITICAL**: Identify ALL Stock Tickers (e.g., AAPL, NVDA) and Crypto Symbols (e.g., BTC, ETH).
  - List all relevant companies, their competitors, and market positions.
  
  BREADTH REQUIREMENT: Execute AT LEAST 8-10 distinct Google searches covering different angles.
  `;

  if (userLocation) {
    phase1aPrompt += `\n**USER LOCATION**: The user is located at Lat: ${userLocation.lat}, Lng: ${userLocation.lng}. 
      If the search query is generic (e.g. "Best coffee near me"), prioritize local results using 'googleMaps' near these coordinates.`;
  }

  onUpdate?.('tool', '[PHASE 1a] Mapping Research Landscape & Finding Tickers...');
  const p1a = await executeResearchPhase(researchAi, currentModel, phase1aPrompt, onUpdate, knownUrls, 'search', userLocation);
  if (p1a.usedModel !== currentModel) {
    currentModel = p1a.usedModel;
  }

  // PHASE 1b: FINANCIAL & JOB DATA (DEDICATED FUNCTION PHASE)
  // We use the context from 1a to drive specific tool calls without Google Search enabled
  const phase1bPrompt = `
  PHASE 1b: FINANCIAL, JOB, & NEWS DATA EXTRACTION

  USER TOPIC:
  ${topic}

  Based on the landscape identified in Phase 1a:
  ${p1a.text.substring(0, 5000)}...

  **INTENT DETECTION RULES** (CRITICAL - READ BEFORE CALLING ANY TOOL):
  Before calling stock, crypto, or job tools, you MUST verify the user's EXPLICIT intent. 
  Do NOT infer intent from tangential topic relationships. The user must be asking for this data specifically.

  1. **STOCK PRICE ('get_stock_price')**: 
     - ✅ ONLY call if the user's original topic EXPLICITLY mentions: stock prices, investment advice, trading, portfolio, financial performance, market cap, "should I buy/sell", stock analysis, shareholder returns
     - ❌ DO NOT call for: general company news, product research, industry overviews, technology analysis, competitor comparisons, company history (unless explicitly about stock performance)
     - Example YES: "Is AAPL a good investment?" → Call get_stock_price
     - Example YES: "What is Tesla's stock price?" → Call get_stock_price
     - Example NO: "What are Apple's latest products?" → DO NOT call
     - Example NO: "Tesla's autonomous driving technology" → DO NOT call
     - Example NO: "Microsoft's AI strategy" → DO NOT call

  2. **CRYPTO PRICE ('get_crypto_price')**: 
     - ✅ ONLY call if the user's original topic EXPLICITLY mentions: crypto prices, token values, trading crypto, DeFi investments, "should I buy BTC/ETH", crypto portfolio, cryptocurrency market
     - ❌ DO NOT call for: blockchain technology overviews, Web3 development, NFT art/culture, crypto industry news, smart contract development (unless explicitly about prices)
     - Example YES: "What is the current Bitcoin price?" → Call get_crypto_price
     - Example YES: "Should I invest in Ethereum?" → Call get_crypto_price
     - Example NO: "How does blockchain work?" → DO NOT call
     - Example NO: "Web3 development tutorial" → DO NOT call
     - Example NO: "NFT marketplace comparison" → DO NOT call

  3. **REMOTE JOBS ('search_remote_jobs')**: 
     - ✅ ONLY call if the user's original topic EXPLICITLY mentions: job openings, job listings, hiring, career search, "looking for work", employment opportunities, job market, finding jobs, open positions
     - ❌ DO NOT call for: skill development, learning topics, industry analysis, company research, technology overviews, career advice, salary negotiation (unless explicitly about finding job listings)
     - Example YES: "Remote Python developer jobs" → Call search_remote_jobs
     - Example YES: "What AI jobs are hiring?" → Call search_remote_jobs
     - Example NO: "How to become a Python developer" → DO NOT call
     - Example NO: "AI industry trends" → DO NOT call
     - Example NO: "Skills needed for data science" → DO NOT call

  4. **WIZA PROSPECTS ('wiza_prospect_search')**: Keep existing logic - only call for explicit lead generation, prospecting, ICP, outreach, B2B targeting needs.

  5. **NEWS SEARCH ('news_search')**: Call 1-3 times for timely reporting relevant to the topic. This is generally useful for most topics.

  6. **BRAVE IMAGE SEARCH ('brave_image_search')**: Call 2-4 times for relevant visual content.

  7. **NO GOOGLE SEARCH**: Do NOT ask to search Google. Only use the provided tools.

  **RESPONSE FORMAT**:
  - First, state whether the user's topic matches the intent criteria for stock/crypto/job tools.
  - If NO match: Respond with "No financial/job tools needed - user intent does not match criteria."
  - If YES match: Explain which specific criteria matched, then call the appropriate tools.
  `;

  onUpdate?.('tool', '[PHASE 1b] Fetching Real-Time Market Data...');
  const p1b_tools = await executeResearchPhase(researchAi, currentModel, phase1bPrompt, onUpdate, knownUrls, 'functions', userLocation);
  if (p1b_tools.usedModel !== currentModel) {
    currentModel = p1b_tools.usedModel;
  }

  const extractInjectedJsonBlocks = (text: string, name: string): any[] => {
    const marker = `[SYSTEM_DATA_INJECTION: ${name}]`;
    const out: any[] = [];
    let idx = 0;
    while (idx < text.length) {
      const start = text.indexOf(marker, idx);
      if (start === -1) break;
      const jsonStart = start + marker.length;
      // Find the next marker (any injection) to bound this JSON payload.
      const next = text.indexOf('[SYSTEM_DATA_INJECTION:', jsonStart);
      const slice = (next === -1 ? text.slice(jsonStart) : text.slice(jsonStart, next)).trim();
      idx = next === -1 ? text.length : next;
      if (!slice) continue;
      // Best-effort: parse first JSON object found in slice.
      const firstObj = extractFirstJsonObject(slice);
      if (!firstObj) continue;
      try {
        out.push(JSON.parse(firstObj));
      } catch {
        // ignore
      }
    }
    return out;
  };

  const mergeWizaProspects = (blocks: any[]): any | null => {
    if (!Array.isArray(blocks) || blocks.length === 0) return null;
    const profiles: any[] = [];
    const seen = new Set<string>();
    let totalHint = 0;
    let status: any = undefined;
    let lastError: string | undefined;

    const profileKey = (p: any): string => {
      const candidates = [
        p?.linkedin_profile_url,
        p?.profile_url,
        p?.linkedin,
        p?.email,
        p?.id,
        p?.slug,
      ]
        .map((v: any) => (v ? String(v).trim() : ''))
        .filter(Boolean);
      return candidates[0] || JSON.stringify(p).slice(0, 200);
    };

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (block.error) {
        lastError = String(block.error);
      }
      if (block.status && typeof block.status === 'object') {
        status = block.status;
      }
      const data = block.data;
      if (data && typeof data === 'object') {
        const t = typeof data.total === 'number' ? data.total : 0;
        if (t > totalHint) totalHint = t;
        const arr = Array.isArray(data.profiles) ? data.profiles : [];
        for (const p of arr) {
          const k = profileKey(p);
          if (!k || seen.has(k)) continue;
          seen.add(k);
          profiles.push(p);
        }
      }
    }

    return {
      status,
      error: lastError,
      data: {
        total: totalHint || profiles.length,
        profiles,
      },
    };
  };

  // PHASE 1c: DEEP DATA & TRENDS (HYBRID - ENHANCED URL READING)
  const phase1cPrompt = `
  PHASE 1c: COMPREHENSIVE DATA EXTRACTION & DEEP SOURCE ANALYSIS
  
  Context from Phase 1a:
  ${p1a.text.substring(0, 3000)}...
  
  ENHANCED RESEARCH PROTOCOL:
  
  1. **EXTENSIVE SEARCH COVERAGE** (Execute 8-12 searches):
     - Search for specific statistics, market size, growth rates.
     - Search for performance metrics, benchmarks, and KPIs.
     - Search for case studies and real-world examples.
     - Search for academic research or scientific studies if applicable.
     - Search for government reports or official statistics.
     - Search for industry reports and analyst insights.
  
  2. **DEEP URL READING** (CRITICAL):
     - Use 'urlContext' to READ the full content of the most relevant URLs found in searches.
     - Prioritize reading: Official sources, research papers, detailed analyses.
     - Extract specific data points, quotes, and verifiable facts.
     - The system can read up to 20 URLs per request - use this capability!
  
  3. **DATA VERIFICATION**:
     - Cross-reference statistics across multiple sources.
     - Note discrepancies and search for resolution.
     - Prefer primary sources over secondary reporting.
  
  4. **TEMPORAL ANALYSIS**:
     - Search for trends over time (5-year, 10-year perspectives).
     - Identify inflection points and catalysts.
  
  HYBRID MODE ENABLED: You have access to 'googleSearch', 'googleMaps', AND 'urlContext'.
  Use all three tools strategically to maximize information quality.
  `;

  onUpdate?.('tool', '[PHASE 1c] Deep Dive: Hybrid Search & Analysis...');
  const p1c = await executeResearchPhase(researchAi, currentModel, phase1cPrompt, onUpdate, knownUrls, 'hybrid', userLocation);
  if (p1c.usedModel !== currentModel) {
    currentModel = p1c.usedModel;
  }

  // === Phase 1d (Video Intelligence) - MOVED BEFORE VERIFICATION ===
  let videoAnalysisData: VideoAnalysis | undefined;
  let videoAnalysisText = "";
  let videos: YoutubeVideo[] = [];

  try {
    // 1. Generate optimized query
    const ytQueryResponse = await researchAi.models.generateContent({
      model: MODEL_FAST, // Video search query gen is always fast/cheap
      contents: `Generate a single, highly effective YouTube search query to find a deep, educational, or analytical video about: "${topic}". 
        Return ONLY the raw search query string. No quotes.`,
    });
    const ytQuery = ytQueryResponse.text?.trim() || topic;

    onUpdate?.('tool', `[PHASE 1d] 🎥 Video Intelligence: Searching YouTube for "${ytQuery}"...`);
    videos = await searchYoutubeVideos(ytQuery);

    if (videos.length > 0) {
      // 2. Select the best video by relevance first
      const videoListContext = videos.map((v, i) =>
        `${i}. Title: "${v.title}" | Channel: ${v.channel} | Duration: ${v.duration} | Views: ${v.views}`
      ).join('\n');

      const selectionResponse = await researchAi.models.generateContent({
        model: MODEL_FAST, // Selection logic is fast
        contents: `Research Topic: "${topic}"
              
              Available Videos:
              ${videoListContext}
              
              Task: Select the single most relevant, authoritative, and educational video from this list for a professional research report. Prefer longer, analysis-focused content over shorts or news clips.
              
              Return ONLY the index number (0-${videos.length - 1}).`
      });

      const selectedIndexStr = selectionResponse.text?.trim().match(/\d+/)?.[0];
      const selectedIndex = selectedIndexStr ? parseInt(selectedIndexStr) : 0;
      const safeIndex = (selectedIndex >= 0 && selectedIndex < videos.length) ? selectedIndex : 0;

      // 3. Popularity guardrail: avoid a main video with "no views" when alternatives exist
      const isZeroViews = (views: string | undefined) => {
        if (!views) return true;
        const lower = views.toLowerCase();
        if (lower.includes('no views')) return true;
        const num = parseInt(views.replace(/[^0-9]/g, ''), 10);
        return isNaN(num) || num === 0;
      };

      let topVideo = videos[safeIndex];
      if (isZeroViews(topVideo.views)) {
        const alt = videos.find(v => !isZeroViews(v.views));
        if (alt) {
          topVideo = alt;
        }
      }
      onUpdate?.('tool', `[PHASE 1d] Selected best match: "${topVideo.title}". Analyzing...`);

      const fullVideoUrl = `https://www.youtube.com/watch?v=${topVideo.id}`;
      const analysis = await analyzeYoutubeVideo(fullVideoUrl, topic);

      videoAnalysisData = {
        videoId: topVideo.id,
        title: topVideo.title,
        analysis: analysis
      };

      videoAnalysisText = `
          === VIDEO INTELLIGENCE FINDINGS ===
          Video Title: "${topVideo.title}"
          Video URL: ${fullVideoUrl}
          
          GEMINI VIDEO ANALYSIS:
          ${analysis}
          `;

      onUpdate?.('tool', `[PHASE 1d] Video analysis complete. Insights integrated.`);
    }
  } catch (e) {
    console.warn("Video intelligence phase failed", e);
  }

  // === NEW: Phase 1e (Claim Verification & Deep Read) ===
  let p1e_text = "";
  let p1e_sources: Source[] = [];

  // Filter distinct URLs from Phase 1a & 1c to read deeply
  const allPhase1Sources = [...p1a.sources, ...p1c.sources];
  const candidateUrls = Array.from(new Set(allPhase1Sources
    .map(s => s.uri)
    .filter(uri => uri && uri.startsWith('http') && !uri.includes('google.com/search'))
  )).slice(0, 20); // Limit to 20 to respect 'urlContext' request limits

  if (candidateUrls.length > 0) {
    const phase1ePrompt = `
      PHASE 1e: COMPREHENSIVE SOURCE VERIFICATION & DEEP CONTENT EXTRACTION
      
      PRIORITY SOURCES TO ANALYZE:
      ${candidateUrls.join('\n')}
      
      ENHANCED VERIFICATION PROTOCOL:
      
      1. **DEEP URL READING** (CRITICAL - Read ALL provided URLs):
         - Use 'urlContext' to thoroughly read EACH of the URLs listed above.
         - Extract: Key statistics, quotes, methodologies, dates, author credentials.
         - Note: The URL context tool can process up to 20 URLs - maximize this capability!
      
      2. **PRIMARY SOURCE DISCOVERY**:
         - Use 'googleSearch' to find original sources cited within the articles.
         - Search for: Official reports, academic papers, government data, company filings.
         - Prioritize: .gov, .edu, official company websites, peer-reviewed journals.
      
      3. **CLAIM VERIFICATION MATRIX**:
         - Identify the 10 most important claims from the research.
         - For each claim: Find at least 2 corroborating sources.
         - Note any discrepancies with exact source citations.
      
      4. **DATA FRESHNESS CHECK**:
         - Verify dates of all statistics (reject outdated data if newer exists).
         - Search for the most recent updates on key metrics.
      
      5. **EXPERT CREDIBILITY**:
         - Identify quoted experts and verify their credentials.
         - Search for any conflicting expert opinions.
      
      HYBRID MODE: Use 'googleSearch' + 'urlContext' together for maximum verification depth.
      `;

    onUpdate?.('tool', `[PHASE 1e] Claim Verification: Reading up to ${candidateUrls.length} sources & searching for primary data...`);
    const p1e = await executeResearchPhase(researchAi, currentModel, phase1ePrompt, onUpdate, knownUrls, 'hybrid', userLocation);
    p1e_text = p1e.text;
    p1e_sources = p1e.sources;
    if (p1e.usedModel !== currentModel) {
      currentModel = p1e.usedModel;
    }
  }

  // === PHASE 1f: COMPREHENSIVE COUNTER-ANALYSIS & ALTERNATIVE PERSPECTIVES ===
  const phase1fPrompt = `
  PHASE 1f: RIGOROUS FACT-CHECK, COUNTER-ANALYSIS & ALTERNATIVE PERSPECTIVES
  
  RESEARCH CONTEXT SO FAR:
  ${p1a.text.substring(0, 1500)}...
  ${p1e_text.substring(0, 1500)}...
  
  CRITICAL THINKING PROTOCOL (Execute 6-10 searches):
  
  1. **ACTIVE SKEPTICISM** (Multiple searches required):
     - Search for: "criticism of [topic]", "[topic] problems", "[topic] controversy"
     - Search for: "[topic] debunked", "[topic] myths", "[topic] misconceptions"
     - Search for: "[topic] failures", "[topic] risks", "[topic] downsides"
     - Search for: "alternative to [topic]", "competitors to [topic]"
  
  2. **BIAS DETECTION**:
     - Identify potential industry bias in sources (funded research, sponsored content).
     - Search for independent analysis or academic critique.
     - Note any conflicts of interest among quoted experts.
  
  3. **MINORITY PERSPECTIVES**:
     - Search for dissenting expert opinions.
     - Find alternative theories or interpretations.
     - Look for regional or cultural differences in perspective.
  
  4. **NUANCE & EDGE CASES**:
     - Search for exceptions to general claims.
     - Find cases where the conventional wisdom doesn't apply.
     - Identify "it depends" scenarios.
  
  5. **DEEP READ CRITICAL SOURCES**:
     - Use 'urlContext' to thoroughly read the most substantive critical articles.
     - Extract specific counterarguments with evidence.
  
  OUTPUT REQUIREMENT: Produce a balanced "Counter-Analysis" section that strengthens the research through intellectual rigor.
  `;

  onUpdate?.('tool', `[PHASE 1f] Red Teaming: Searching for controversy & counter-arguments...`);
  const p1f = await executeResearchPhase(researchAi, currentModel, phase1fPrompt, onUpdate, knownUrls, 'hybrid', userLocation);
  if (p1f.usedModel !== currentModel) {
    currentModel = p1f.usedModel;
  }

  // === NEW PHASE 1g: FINAL DEEP READ & SYNTHESIS PREPARATION ===
  // Collect all discovered URLs for a final comprehensive reading pass
  const allDiscoveredUrls = Array.from(new Set([
    ...p1a.sources.map(s => s.uri),
    ...p1c.sources.map(s => s.uri),
    ...p1e_sources.map(s => s.uri),
    ...p1f.sources.map(s => s.uri)
  ].filter(uri => uri && uri.startsWith('http') && !uri.includes('google.com/search')))).slice(0, 20);

  let p1g_text = "";
  let p1g_sources: Source[] = [];

  if (allDiscoveredUrls.length >= 5) {
    const phase1gPrompt = `
      PHASE 1g: FINAL COMPREHENSIVE SOURCE SYNTHESIS
      
      You have access to these high-value sources discovered during research:
      ${allDiscoveredUrls.slice(0, 15).join('\n')}
      
      FINAL DEEP READ PROTOCOL:
      
      1. **COMPREHENSIVE URL READING**:
         - Use 'urlContext' to READ the full content of as many URLs as possible.
         - Focus on extracting information NOT yet captured in previous phases.
         - Look for: Hidden details, footnotes, methodology sections, data tables.
      
      2. **SYNTHESIS PREPARATION**:
         - Identify the TOP 10 most important facts discovered across all sources.
         - Note any remaining gaps or unanswered questions.
         - Highlight the most credible and well-sourced claims.
      
      3. **FINAL VERIFICATION**:
         - Double-check any statistics that appeared in multiple sources.
         - Confirm dates and data currency.
         - Flag any claims that could not be independently verified.
      
      4. **ADDITIONAL SEARCHES** (if needed):
         - Search for any remaining questions or gaps.
         - Find the most recent updates on key topics.
      
      This is your final opportunity to ensure comprehensive coverage.
      `;

    onUpdate?.('tool', `[PHASE 1g] Final Synthesis: Deep reading ${Math.min(15, allDiscoveredUrls.length)} priority sources...`);
    const p1g = await executeResearchPhase(researchAi, currentModel, phase1gPrompt, onUpdate, knownUrls, 'hybrid', userLocation);
    p1g_text = p1g.text;
    p1g_sources = p1g.sources;
    // We don't update currentModel here to avoid dragging a fallback model into the final synthesis if it happened during research
  }

  const smartModel = await getSmartModel();

  let deepResearchAgentText = '';


  const phase2Prompt = `
  PHASE 2: COMPREHENSIVE SYNTHESIS & REPORT GENERATION
  
  Based on the extensive research findings below, generate a FINAL JSON Research Report.
  This report should reflect the depth and breadth of multi-phase research conducted.
  
  === FINDINGS (PHASE 1A: COMPREHENSIVE LANDSCAPE) ===
  ${p1a.text}

  === FINDINGS (PHASE 1B: FINANCIAL DATA) ===
  ${p1b_tools.text}

  === FINDINGS (PHASE 1C: DATA & DEEP ANALYSIS) ===
  ${p1c.text}

  === FINDINGS (PHASE 1E: SOURCE VERIFICATION) ===
  ${p1e_text}

  === FINDINGS (PHASE 1F: COUNTER-ANALYSIS) ===
  ${p1f.text}

  ${p1g_text ? `=== FINDINGS (PHASE 1G: FINAL SYNTHESIS) ===\n${p1g_text}` : ''}
  ${videoAnalysisText}

  USER TOPIC: "${topic}"

  ${projectContext ? `
  PROJECT CONTEXT:
  ${projectContext}
  ` : ''}

  TASK:
  - Return a VALID JSON object matching the ResearchReport schema.
  - DO NOT omit any required fields.
  - Ensure all dynamicSections follow the specific structure for their type.
  - Include all source URLs in the sources array.
  - Make the tldr and summary professional, analytical, and insightful.
  
  JSON SCHEMA:
  ${jsonStructure}
  
  Return ONLY the JSON object.

  ${deepResearchAgentText ? `=== FINDINGS (DEEP RESEARCH AGENT) ===\n${deepResearchAgentText}` : ''}

  ${videoAnalysisText}
  
  REQUIREMENTS:
  1. Output STRICT JSON matching the schema below.

  **GAME VARIETY POLICY**:
  - Include a 'gameConcept' object ONLY if an educational game would be truly relevant and helpful for learning about this topic.
  - OMIT the game for: local businesses, simple fact lookups, navigation, or serious/sensitive topics.
  - If including a game, set 'gameConcept.mechanic' to ONE of:
    "space_blaster" | "asteroids" | "tetris" | "pacman" | "platformer" | "merge_2048" | "tower_defense" | "duolingo_quiz" | "memory_match" | "word_puzzle"
  - Avoid repeating mechanics recently used by the user. Recent mechanics to avoid:
    ${recentGameMechanics.length ? recentGameMechanics.join(', ') : '(none)'}
  - The mechanic must be a familiar classic pattern reinvented for the topic (topic terms/entities become enemies/tiles/cards/questions/etc.).
  
  2. **MANDATORY SECTIONS & TOPIC-ALIGNED WIDGETS**
     Your goal is to choose dynamic sections that BEST match the USER'S TOPIC and the tools/data you used in earlier phases.
     Always prioritize sections that expose real, actionable data to the user (charts, job boards, maps, metrics) over generic text.

     **DYNAMIC SECTION VARIETY POLICY**:
     - Aim for **7 to 12** dynamic sections when the research is rich; use fewer only when the topic truly doesn't support it.
     - Prefer **breadth over repetition**: avoid using the same section type more than once (exception: 'text' may appear up to 2 times).
     - Ensure at least **5 different section types** when you include 7+ sections.
     - Do NOT default to the same small set of widgets every time. Use the wider library when relevant.
     - Use at least **2** of the "NEW ADVANCED WIDGETS" when the topic supports it (flows, comparisons, networks, evaluation).
     - If you cannot justify a widget, omit it.

     **CRITICAL WIDGET SELECTION RULES**:
     - **RELEVANCE IS PARAMOUNT**: Only include a widget if it adds SIGNIFICANT value to the user's specific request. Do not add widgets just to have them.
     - **DO NOT FORCE IT**: If no widget fits perfectly, it is better to have NO widget than a confusing or irrelevant one.
     - **STOCK/CRYPTO/JOBS**: 
       * ONLY use 'stock_chart', 'crypto_chart', or 'job_list' if the user EXPLICITLY asks for stock prices, cryptocurrency trends, or job openings. 
       * NEVER show these for general company research or broad industry topics unless specifically requested.
     - **LOCATION**: 
       * ONLY use location-based widgets ('event_calendar', 'venue_cards', 'local_spotlight') if the user's query is clearly location-specific (e.g., "near me", "in New York").

     A. **'top_picks'**: If the topic involves products, tools, strategies, or any recommended options.
        - Content Schema: { "picks": [{ "name": "string", "badge": "string (e.g. Best Overall)", "description": "string" }] }
     B. **'stats'**: If the research found ANY numbers, statistics, or growth rates.
        - Content Schema: [{ "label": "string", "value": "string (e.g. $50M, 45%)" }]
     C. **'interactive_widget'**: OPTIONAL (include only when it is genuinely valuable). A widget to engage the user (Quiz, Calculator, or Oracle).
        - Content Schema: { "subtype": "quiz"|"calculator"|"oracle", "description": "string", "placeholder": "string", "buttonText": "string", "widgetSystemInstruction": "string (System prompt for the widget AI)" }
        - For subtype **"quiz"** or **"oracle"**, the **description MUST be a single clear question** that the user can answer in one short line (for example: "According to this research, what is the primary driver of X?"). This text is shown directly above the input box in the UI, and the user will type their answer there.
     D. **'metric_card_grid'**: For high-level KPI dashboards.
        - Content Schema: { "metrics": [{ "label": "string", "value": "string", "trend": "up"|"down"|"neutral", "trendValue": "string" }] }
     E. **'comparison'**: For side-by-side comparisons (Pros/Cons, Old vs New, Competitor A vs B).
        - Content Schema: { "leftTitle": "string (e.g. Pros)", "rightTitle": "string (e.g. Cons)", "points": [{ "left": "string", "right": "string" }] }
     F. **'tradingview_chart'**: If Phase 1b found STOCK or CRYPTO data, include this section with the correct TradingView symbol (e.g. NASDAQ:AAPL, COINBASE:BTCUSD).
        - Content Schema: { "symbol": "string (TradingView format)", "title": "string" }
     G. **'map_widget'**: If the topic is location-based and you found specific places using Google Maps.
        - Content Schema: { "locations": [{ "name": "string", "address": "string", "lat": "number (optional)", "lng": "number (optional)", "rating": "string (optional)" }] }
  
  3. **Visual Selection & Schemas**:
     - **'radar_chart'**: For comparing 3+ variables/competitors on shared axes.
       - Schema: { "axes": [{ "label": "string", "value": number (0-100) }] }
     - **'swot_analysis'**: For strategic breakdowns.
       - Schema: { "strengths": ["string"], "weaknesses": ["string"], "opportunities": ["string"], "threats": ["string"] }
     - **'process_flow'**: For steps or history.
       - Schema: { "steps": [{ "title": "string", "description": "string" }] }
     - **'timeline'**: For chronological events.
       - Schema: [{ "date": "string", "event": "string", "details": "string" }]
     - **'comparison'**: For side-by-side comparisons.
       - Schema: { "leftTitle": "string", "rightTitle": "string", "points": [{ "left": "string", "right": "string" }] }
     - **'table'**: For dense data comparison.
       - CRITICAL: Must have 3+ columns if possible. Avoid simple 2-column "Feature | Description" tables.
       - Schema: { "headers": ["Feature", "Option A", "Option B", "Option C"], "rows": [["Battery", "20h", "18h", "24h"], ["Price", "$999", "$899", "$1100"]] }
     - **'faq'**: Frequently Asked Questions.
       - Schema: [{ "question": "string", "answer": "string" }]
     - **'checklist'**: Actionable items.
       - Schema: ["string"]
     - **'quote'**: Key insight or quote.
       - Schema: { "text": "string", "author": "string", "role": "string" }
  
  4. **NEW ADVANCED WIDGETS** (Use these for richer research visualization - select 3-5 that best fit the topic):
     
     A. **'scenario_slider'**: For A/B testing, policy comparisons, or "what if" scenarios.
        - BEST FOR: Economics, policy analysis, strategy comparisons, business decisions.
        - Schema: { "description": "string", "scenarios": [{ "title": "string", "icon": "emoji", "description": "string", "metrics": [{ "label": "string", "value": "string" }] }] }
     
     B. **'parameter_knobs'**: For interactive calculators with multiple adjustable variables.
        - BEST FOR: Financial planning, ROI calculators, impact simulators.
        - Schema: { "parameters": [{ "id": "string", "label": "string", "min": number, "max": number, "default": number, "step": number, "prefix": "string", "suffix": "string" }], "formula": "string (optional JS expression using {id})", "baseOutput": "string" }
     
     C. **'venn_diagram'**: For showing overlapping concepts, skills, or domains.
        - BEST FOR: Interdisciplinary topics, skill overlap, market segments, concept relationships.
        - Schema: { "circles": [{ "label": "string", "weight": number (0-100) }], "overlapStrength": number (0-100), "overlapLabel": "string", "insights": ["string"] }
     
     D. **'sankey_flow'**: For showing flow of resources, money, energy, or processes.
        - BEST FOR: Supply chains, budget allocation, energy flow, user journeys, data pipelines.
        - Schema: { "nodes": [{ "label": "string", "items": [{ "id": "string", "label": "string", "value": "string" }] }], "flows": [{ "from": "string", "to": "string", "value": number }], "summary": "string" }
     
     E. **'bias_radar'**: For detecting bias or imbalance across multiple dimensions.
        - BEST FOR: Media analysis, research methodology critique, AI fairness, policy evaluation.
        - Schema: { "dimensions": [{ "label": "string", "value": number (0-100) }], "idealValue": number, "analysis": "string" }
     
     F. **'influence_network'**: For showing relationships and influence between entities.
        - BEST FOR: Industry ecosystems, political relationships, social networks, stakeholder analysis.
        - Schema: { "nodes": [{ "id": "string", "label": "string", "weight": number }], "connections": [{ "from": "string", "to": "string", "strength": number }] }
     
     G. **'root_cause_tree'**: For showing hierarchical cause-and-effect relationships.
        - BEST FOR: Problem analysis, debugging, incident reports, failure analysis.
        - Schema: { "root": { "id": "root", "label": "string", "description": "string", "severity": "high"|"medium"|"low", "causes": [/* recursive same structure */] } }
     
     H. **'sentiment_timeline'**: For showing emotional/sentiment changes over time.
        - BEST FOR: Public opinion, stock sentiment, brand perception, event impact analysis.
        - Schema: { "dataPoints": [{ "date": "string", "value": number (-100 to 100), "event": "string" }], "annotations": [{ "date": "string", "event": "string" }] }
     
     I. **'insight_cards'**: Swipeable key insights cards for engagement.
        - BEST FOR: Executive summaries, key takeaways, learning modules.
        - Schema: { "cards": [{ "title": "string", "content": "string", "icon": "emoji", "source": "string" }] }
     
     J. **'word_cloud'**: Topic visualization with weighted keywords.
        - BEST FOR: Trend analysis, SEO topics, research themes, content analysis.
        - Schema: { "words": [{ "text": "string", "weight": number, "context": "string (optional)" }] }
     
     K. **'iceberg_depth'**: For showing hidden complexity beneath the surface.
        - BEST FOR: Complex systems, hidden costs, technical debt, organizational culture.
        - Schema: { "layers": [{ "title": "string", "description": "string", "depth": "surface"|"hidden"|"deep" }] }
     
     L. **'shield_meter'**: For security, protection, or integrity assessments.
        - BEST FOR: Cybersecurity, risk assessment, compliance, data protection.
        - Schema: { "title": "string", "integrity": number (0-100), "threats": [{ "name": "string", "severity": "high"|"medium"|"low" }], "protections": ["string"] }
     
     M. **'confidence_gauge'**: For showing reliability/confidence levels of claims.
        - BEST FOR: Fact-checking, research reliability, claim verification.
        - Schema: { "claims": [{ "statement": "string", "confidence": number (0-100), "source": "string" }], "methodology": "string" }
     
     N. **'action_items'**: Interactive to-do list generated from research.
        - BEST FOR: How-to guides, implementation plans, recommendations.
        - Schema: { "items": [{ "task": "string", "details": "string", "priority": "high"|"medium"|"low" }] }
     O. **'eli5_toggle'**: Complexity switcher between technical and simple explanations.
        - BEST FOR: Technical topics, scientific research, educational content.
        - Schema: { "title": "string", "technical": "string", "simple": "string", "analogy": "string" }

     P. **'poetry_display'**:
        - BEST FOR: Poems, lyrics, literary quotes, creative writing.
        - Schema: { "lines": ["string"], "author": "string", "title": "string", "annotation": "string (optional)", "style": "haiku"|"sonnet"|"free_verse"|"limerick" (optional) }

     Q. **'music_player'**:
        - BEST FOR: Song recommendations, playlists, album reviews.
        - Schema: { "tracks": [{ "title": "string", "artist": "string", "album": "string (optional)", "spotifyUri": "string (optional)", "previewUrl": "string (optional)" }], "playlistName": "string (optional)" }

     R. **'artwork_gallery'**:
        - BEST FOR: Art pieces, photography, visual portfolios.
        - Schema: { "works": [{ "title": "string", "artist": "string", "year": "string (optional)", "imageUrl": "string", "description": "string (optional)" }], "layout": "grid"|"masonry"|"carousel" (optional) }

     S. **'book_shelf'**:
        - BEST FOR: Book recommendations, reading lists, literary reviews.
        - Schema: { "books": [{ "title": "string", "author": "string", "coverUrl": "string (optional)", "rating": number (optional), "description": "string (optional)", "goodreadsUrl": "string (optional)" }] }

     T. **'creative_showcase'**:
        - BEST FOR: Crafts, DIY projects, maker portfolios.
        - Schema: { "items": [{ "title": "string", "description": "string", "imageUrl": "string", "materials": ["string"] }] }

     U. **'periodic_element'**:
        - BEST FOR: Chemistry topics, element properties.
        - Schema: { "elements": [{ "symbol": "string", "name": "string", "number": number, "category": "string", "fact": "string" }], "highlightGroup": "string (optional)" }

     V. **'discovery_timeline'**:
        - BEST FOR: Scientific breakthroughs, history of science.
        - Schema: { "discoveries": [{ "year": "string", "title": "string", "scientist": "string", "significance": "string", "icon": "emoji (optional)" }] }

     W. **'formula_display'**:
        - BEST FOR: Math/physics equations, scientific principles.
        - Schema: { "formulas": [{ "latex": "string", "name": "string", "explanation": "string", "variables": [{ "symbol": "string", "meaning": "string" }] }] }

     X. **'anatomy_explorer'**:
        - BEST FOR: Biology, health topics, medical explanations.
        - Schema: { "parts": [{ "name": "string", "function": "string", "location": "string" }], "system": "string" }

     Z. **'event_calendar'**:
        - BEST FOR: Events near user, schedules, itineraries.
        - Schema: { "events": [{ "name": "string", "date": "string", "time": "string (optional)", "venue": "string", "address": "string (optional)", "category": "string (optional)", "ticketUrl": "string (optional)", "price": "string (optional)" }], "viewMode": "list"|"calendar"|"cards" (optional) }

     AA. **'venue_cards'**:
        - BEST FOR: Restaurants, businesses, local spots.
        - Schema: { "venues": [{ "name": "string", "category": "string", "rating": number (optional), "priceLevel": "string (optional)", "address": "string", "phone": "string (optional)", "hours": "string (optional)", "highlights": ["string"], "imageUrl": "string (optional)" }] }

     AB. **'directions_guide'**:
        - BEST FOR: How to get there, transit guides, driving directions.
        - Schema: { "steps": [{ "instruction": "string", "mode": "driving"|"transit"|"walking", "distance": "string (optional)", "duration": "string (optional)" }], "destination": "string" }

     AC. **'local_spotlight'**:
        - BEST FOR: Area highlights, neighborhood guides, local features.
        - Schema: { "features": [{ "title": "string", "description": "string", "type": "string", "imagePrompt": "string (optional)", "sourceUrl": "string (optional)" }], "area": "string (optional)" }

     AD. **'flashcard_deck'**:
        - BEST FOR: Vocabulary, study topics, memorization.
        - Schema: { "cards": [{ "front": "string", "back": "string", "hint": "string (optional)", "category": "string (optional)" }], "shuffleEnabled": boolean (optional) }

     AE. **'quiz_interactive'**:
        - BEST FOR: Self-assessment, knowledge checks, trivia games.
        - Schema: { "title": "string", "questions": [{ "question": "string", "options": ["string"], "correct": number (index), "explanation": "string (optional)" }], "passingScore": number (optional) }

     AF. **'concept_map'**:
        - BEST FOR: Interconnected ideas, knowledge graphs, mind maps.
        - Schema: { "nodes": [{ "id": "string", "label": "string", "description": "string (optional)" }], "connections": [{ "from": "string", "to": "string", "label": "string (optional)" }] }

     AG. **'study_schedule'**:
        - BEST FOR: Learning plans, curriculum outlines, study blocks.
        - Schema: { "blocks": [{ "title": "string", "duration": "string", "topic": "string", "type": "study"|"break"|"review" }] }

     AH. **'recipe_card'**:
        - BEST FOR: Cooking, food topics, meal prep.
        - Schema: { "name": "string", "servings": number, "prepTime": "string", "cookTime": "string (optional)", "ingredients": [{ "item": "string", "amount": "string" }], "steps": ["string"], "tips": ["string"], "nutrition": { "calories": number, "protein": "string", "carbs": "string", "fat": "string" } (optional) }

     AI. **'workout_routine'**:
        - BEST FOR: Fitness topics, exercise plans, gym guides.
        - Schema: { "name": "string", "duration": "string", "difficulty": "beginner"|"intermediate"|"advanced", "exercises": [{ "name": "string", "reps": "string (optional)", "sets": number (optional), "duration": "string (optional)", "notes": "string (optional)" }], "equipment": ["string"] }

     AJ. **'nutrition_breakdown'**:
        - BEST FOR: Health, diet, macro analysis.
        - Schema: { "title": "string", "totals": { "calories": number, "protein": number, "carbs": number, "fat": number }, "items": [{ "name": "string", "calories": number }], "recommendations": ["string"] }

     AK. **'habit_tracker'**:
        - BEST FOR: Productivity, wellness, goal tracking.
        - Schema: { "habits": [{ "name": "string", "frequency": "daily"|"weekly", "goal": "string (optional)", "icon": "emoji (optional)" }] }

     AL. **'company_profile'**:
        - BEST FOR: Company overviews, business profiles.
        - Schema: { "name": "string", "industry": "string", "founded": "string", "headquarters": "string", "description": "string", "website": "string (optional)" }

     AM. **'executive_team'**:
        - BEST FOR: Leadership bios, team introductions.
        - Schema: { "members": [{ "name": "string", "title": "string", "bio": "string", "linkedin": "string (optional)" }] }

     AN. **'product_lineup'**:
        - BEST FOR: Product catalogs, merchandise showcases.
        - Schema: { "products": [{ "name": "string", "category": "string", "price": "string (optional)", "description": "string" }] }

     AO. **'tech_stack'**:
        - BEST FOR: Software tools, technology stacks, dev tools.
        - Schema: { "tools": [{ "name": "string", "category": "string", "description": "string (optional)" }] }

     AP. **'destination_guide'**:
        - BEST FOR: City/Country guides, travel overviews.
        - Schema: { "location": "string", "country": "string", "bestTime": "string", "currency": "string", "highlights": ["string"] }

     AQ. **'hotel_showcase'**:
        - BEST FOR: Accommodation reviews, hotel features.
        - Schema: { "hotels": [{ "name": "string", "stars": number, "priceRange": "string", "amenities": ["string"], "description": "string" }] }

     AR. **'travel_itinerary'**:
        - BEST FOR: Trip planning, day-by-day guides.
        - Schema: { "days": [{ "day": number, "title": "string", "activities": ["string"], "location": "string" }] }

     AS. **'movie_cast'**:
        - BEST FOR: Film/TV analysis, cast lists.
        - Schema: { "movieTitle": "string", "cast": [{ "actor": "string", "role": "string", "bio": "string (optional)" }] }

     AT. **'game_roster'**:
        - BEST FOR: Gaming characters, hero lists.
        - Schema: { "gameTitle": "string", "characters": [{ "name": "string", "role": "string", "abilities": ["string"] }] }

     AU. **'historical_figure'**:
        - BEST FOR: Biographies, historical profiles.
        - Schema: { "name": "string", "era": "string", "knownFor": "string", "bio": "string" }

     AV. **'wildlife_encyclopedia'**:
        - BEST FOR: Animal facts, nature guides.
        - Schema: { "animal": "string", "scientificName": "string", "habitat": "string", "diet": "string", "status": "string" }

     AW. **'plant_guide'**:
        - BEST FOR: Botany, gardening, plant care.
        - Schema: { "plant": "string", "type": "string", "careLevel": "string", "sunlight": "string", "water": "string" }

     AX. **'space_exploration'**:
        - BEST FOR: Astronomy, space missions, planets.
        - Schema: { "object": "string", "type": "string", "distance": "string", "facts": ["string"] }

     AY. **'fashion_lookbook'**:
        - BEST FOR: Style trends, outfit ideas.
        - Schema: { "collection": "string", "looks": [{ "name": "string", "style": "string", "items": ["string"] }] }

     AZ. **'architectural_style'**:
        - BEST FOR: Building design, architecture history.
        - Schema: { "style": "string", "era": "string", "features": ["string"], "examples": ["string"] }

     BA. **'vehicle_showcase'**:
        - BEST FOR: Cars, planes, boats, vehicle specs.
        - Schema: { "vehicles": [{ "model": "string", "make": "string", "year": "string", "specs": "string" }] }

     BB. **'property_listing'**:
        - BEST FOR: Real estate, house tours.
        - Schema: { "properties": [{ "title": "string", "price": "string", "location": "string", "beds": number, "baths": number, "sqft": "string" }] }

     BC. **'news_gallery'**:
        - BEST FOR: Current events, news topics.
        - Schema: { "topic": "string", "articles": [{ "headline": "string", "source": "string", "date": "string", "summary": "string", "url": "string (optional)", "imageUrl": "string (optional)" }] }

     BD. **'entity_logo_wall'**:
        - BEST FOR: Any topic with named entities (companies, organizations, products, projects, institutions).
        - Schema: { "entities": [{ "name": "string", "subtitle": "string (optional)", "url": "string (optional)", "imageUrl": "string (optional)", "imageQuery": "string (optional)" }] }

     BE. **'key_people_gallery'**:
        - BEST FOR: Any topic involving people (founders, researchers, leaders, artists, politicians, athletes).
        - Schema: { "people": [{ "name": "string", "role": "string", "whyRelevant": "string", "url": "string (optional)", "imageUrl": "string (optional)", "imageQuery": "string (optional)" }] }

     BF. **'chart_image_gallery'**:
        - BEST FOR: Visual evidence (charts, diagrams, infographics) for almost any research topic.
        - Schema: { "images": [{ "caption": "string", "sourceUrl": "string (optional)", "imageUrl": "string (optional)", "imageQuery": "string (optional)" }] }
  
  5. **GTM-Focused Dynamic Sections** (use these only when the user's request clearly relates to go-to-market, sales, marketing strategy, ICPs, funnels, or pricing):
     - **'persona_grid'**:
        - BEST FOR: Defining Ideal Customer Profiles (ICPs), buyer personas, and target roles.
        - Schema: { "personas": [{ "name": "string", "segment": "string", "goals": ["string"], "pains": ["string"], "triggers": ["string"], "objections": ["string"] }] }
        - Use when the user asks about target customers, personas, ICPs, or "who we are selling to".
     - **'funnel_breakdown'**:
        - BEST FOR: Acquisition or product funnels (Awareness → Activation → Retention, etc.).
        - Schema: { "stages": [{ "name": "string", "description": "string", "metric": "string", "currentValue": "string", "conversionToNext": "string", "issues": ["string"] }] }
        - Use when the topic involves funnels, activation, conversion rates, onboarding, or retention.
     - **'channel_mix_board'**:
        - BEST FOR: Comparing acquisition/growth channels (paid search, social, email, outbound, etc.).
        - Schema: { "channels": [{ "name": "string", "role": "string", "strength": "core"|"experimental"|"emerging", "metrics": { "cac": "string", "roi": "string", "cvr": "string" }, "notes": "string" }] }
        - Use when the user asks about marketing mix, channels to use, or where to invest budget.
     - **'messaging_matrix'**:
        - BEST FOR: Positioning and messaging for different customer segments.
        - Schema: { "segments": [{ "name": "string", "primaryPain": "string", "coreMessage": "string", "altMessages": ["string"], "proofPoints": ["string"] }] }
        - Use when the user asks for value propositions, messaging, positioning, or narratives for multiple audiences.
     - **'competitor_battlecards'**:
        - BEST FOR: Competitive analysis and sales battlecards.
        - Schema: { "competitors": [{ "name": "string", "segment": "string", "strengths": ["string"], "weaknesses": ["string"], "landMotions": ["string"], "counterStrategies": ["string"] }] }
        - Use when the topic involves competitors, win/loss analysis, or how to compete with specific products.
     - **'experiment_backlog'**:
        - BEST FOR: Growth/marketing experiment ideas and prioritization.
        - Schema: { "experiments": [{ "title": "string", "hypothesis": "string", "metric": "string", "impact": "high"|"medium"|"low", "effort": "high"|"medium"|"low", "confidence": "high"|"medium"|"low", "status": "idea"|"planned"|"running"|"completed", "notes": "string" }] }
        - Use when the user asks for test ideas, growth experiments, or an experimentation roadmap.
     - **'content_calendar'**:
        - BEST FOR: Planning awareness/education content across channels and weeks.
        - Schema: { "timeframe": "string", "items": [{ "week": "string", "channel": "string", "title": "string", "format": "string", "goal": "string" }] }
        - Use when the prompt mentions content strategy, editorial calendar, or posting schedule.
     - **'pricing_tiers'**:
        - BEST FOR: Pricing and packaging recommendations (good/better/best tiers).
        - Schema: { "tiers": [{ "name": "string", "price": "string", "targetSegment": "string", "keyFeatures": ["string"], "limitations": ["string"], "notes": "string" }] }
        - Use when the user asks about pricing, plans, or packaging for the product.
     - **'opportunity_grid'**:
        - BEST FOR: Comparing regions, verticals, or segments by opportunity size and fit.
        - Schema: { "opportunities": [{ "name": "string", "type": "region"|"segment"|"vertical", "opportunitySize": "string", "fit": "high"|"medium"|"low", "risks": ["string"], "recommendedMotion": "string" }] }
        - Use when the user asks which markets/segments/regions to prioritize.
     - **'gtm_playbook'**:
        - BEST FOR: High-level go-to-market or launch plans organized by phases.
        - Schema: { "phases": [{ "name": "string", "timeframe": "string", "owner": "string", "objectives": ["string"], "keyActions": ["string"], "successMetrics": ["string"] }] }
        - Use when the topic is explicitly about a GTM plan, launch plan, or rollout strategy.

  6. **Additional Analysis Widgets** (use these for specialized research visualization):
     - **'risk_matrix'**:
        - BEST FOR: Risk assessment, project planning, security analysis.
        - Schema: { "risks": [{ "name": "string", "severity": "high"|"medium"|"low"|"critical", "likelihood": "string", "impact": "string", "mitigation": "string" }] }
     - **'decision_tree'**:
        - BEST FOR: Decision-making guides, flowcharts, diagnostic tools.
        - Schema: { "nodes": { "root": { "question": "string", "description": "string", "options": [{ "label": "string", "next": "string" }] }, "nodeId": { "question": "string", "options": [...] OR "result": "string" } } }
     - **'stakeholder_map'**:
        - BEST FOR: Organizational analysis, project stakeholders, influence mapping.
        - Schema: { "stakeholders": [{ "name": "string", "role": "string", "influence": "high"|"medium"|"low", "interest": "string", "icon": "emoji (optional)" }] }
     - **'milestone_tracker'**:
        - BEST FOR: Project tracking, roadmaps, progress visualization.
        - Schema: { "milestones": [{ "title": "string", "date": "string", "status": "completed"|"in_progress"|"pending" }] }
     - **'resource_allocation'**:
        - BEST FOR: Budget breakdowns, team allocation, capacity planning.
        - Schema: { "resources": [{ "name": "string", "allocation": number (0-100), "description": "string (optional)" }] }
     - **'heat_map'**:
        - BEST FOR: Comparative data grids, intensity visualization, correlation matrices.
        - Schema: { "rows": ["string"], "columns": ["string"], "values": [[number]] }
     - **'bubble_chart'**:
        - BEST FOR: Multi-dimensional comparisons, market positioning, portfolio analysis.
        - Schema: { "bubbles": [{ "label": "string", "x": number (0-100), "y": number (0-100), "size": number, "value": "string (optional)", "tooltip": "string (optional)" }] }
     - **'before_after'**:
        - BEST FOR: Transformation stories, improvement visualization, case studies.
        - Schema: { "before": { "title": "string", "description": "string", "metrics": [{ "label": "string", "value": "string" }] }, "after": { "title": "string", "description": "string", "metrics": [{ "label": "string", "value": "string" }] } }
     - **'pros_cons_neutral'**:
        - BEST FOR: Balanced analysis, product reviews, decision support.
        - Schema: { "pros": ["string"], "cons": ["string"], "neutral": ["string"] }
     - **'feature_comparison'**:
        - BEST FOR: Product comparisons, tool selection, feature matrices.
        - Schema: { "options": ["string (product/option names)"], "features": [{ "name": "string", "values": [boolean or "string"] }] }
     - **'rating_breakdown'**:
        - BEST FOR: Reviews, evaluations, multi-criteria scoring.
        - Schema: { "ratings": [{ "category": "string", "score": number (0-5) }], "average": number (optional) }
     - **'skill_tree'**:
        - BEST FOR: Learning paths, competency frameworks, career development.
        - Schema: { "skills": [{ "name": "string", "icon": "emoji (optional)", "level": number, "progress": number (0-100), "subskills": [{ "name": "string", "status": "string" }] }] }
     - **'dependency_graph'**:
        - BEST FOR: Technical dependencies, project prerequisites, task sequencing.
        - Schema: { "nodes": [{ "name": "string", "status": "complete"|"in_progress"|"blocked"|"pending", "dependencies": ["string (node names)"] }] }
     - **'cost_benefit'**:
        - BEST FOR: Financial analysis, investment decisions, ROI calculations.
        - Schema: { "costs": [{ "name": "string", "amount": number }], "benefits": [{ "name": "string", "amount": number }] }
     - **'impact_effort'**:
        - BEST FOR: Prioritization matrices, effort estimation, quick wins identification.
        - Schema: { "items": [{ "name": "string", "impact": number (1-10), "effort": number (1-10) }] }
     - **'learning_path'**:
        - BEST FOR: Educational roadmaps, skill development paths, certification journeys, course progressions.
        - Schema: { "steps": [{ "title": "string", "duration": "string (optional)", "description": "string (optional)", "resources": ["string"] (optional) }] }
     - **'recipe_steps'**:
        - BEST FOR: Cooking recipes, chemistry procedures, DIY projects, step-by-step processes with ingredients/materials.
        - Schema: { "ingredients": ["string"] (optional), "steps": [{ "instruction": "string", "tip": "string (optional)" } | "string"] }
     - **'product_showcase'**:
        - BEST FOR: Product comparisons, e-commerce displays, feature highlights, service offerings.
        - Schema: { "products": [{ "name": "string", "icon": "emoji (optional)", "price": "string (optional)", "description": "string (optional)", "features": ["string"] (optional), "rating": number (1-5, optional) }] }
     - **'poll_results'**:
        - BEST FOR: Survey data, opinion polls, voting results, preference distributions.
        - Schema: { "question": "string (optional)", "options": [{ "label": "string", "votes": number | "percentage": number }], "totalResponses": number (optional) }
     - **'org_chart'**:
        - BEST FOR: Team structures, company hierarchies, organizational relationships, reporting chains.
        - Schema: { "nodes": [{ "name": "string", "title": "string (optional)", "role": "string (optional)", "icon": "emoji (optional)", "level": number (0=top) }] }
     - **'mood_board'**:
        - BEST FOR: Design inspiration, creative concepts, visual themes, aesthetic collections.
        - Schema: { "items": [{ "icon": "emoji", "label": "string", "description": "string (optional)", "color": "hex color (optional)" }], "theme": "string (optional)" }
     - **'event_agenda'**:
        - BEST FOR: Conference schedules, meeting agendas, event timelines, workshop programs.
        - Schema: { "events": [{ "time": "string", "duration": "string (optional)", "title": "string", "speaker": "string (optional)", "location": "string (optional)" }] }
     - **'testimonials'**:
        - BEST FOR: Customer reviews, user feedback, expert endorsements, success stories.
        - Schema: { "testimonials": [{ "quote": "string", "author": "string", "role": "string (optional)", "company": "string (optional)", "rating": number (1-5, optional) }] }
     - **'tips_grid'**:
        - BEST FOR: Quick tips, life hacks, advice collections, best practices.
        - Schema: { "tips": [{ "icon": "emoji (optional)", "title": "string (optional)", "text": "string" } | "string"] }
     - **'numbered_list'**:
        - BEST FOR: Ranked lists, ordered procedures, sequential steps, prioritized items.
        - Schema: { "items": [{ "title": "string (optional)", "description": "string" } | "string"] }
     - **'resource_links'**:
        - BEST FOR: Curated link collections, reference materials, tool recommendations, reading lists.
        - Schema: { "links": [{ "title": "string", "url": "string", "icon": "emoji (optional)", "description": "string (optional)" }] }
     - **'glossary'**:
        - BEST FOR: Technical term definitions, vocabulary lists, concept explanations, jargon guides.
        - Schema: { "terms": [{ "term": "string", "definition": "string", "example": "string (optional)" }] }
     - **'trivia_facts'**:
        - BEST FOR: Fun facts, statistics highlights, interesting data points, surprising information.
        - Schema: { "facts": [{ "icon": "emoji (optional)", "value": "string (optional)", "text": "string", "source": "string (optional)" } | "string"] }
     - **'highlight_box'**:
        - BEST FOR: Important callouts, warnings, tips, success messages, key takeaways.
        - Schema: { "type": "info" | "success" | "warning" | "error" | "tip", "icon": "emoji (optional)", "title": "string (optional)", "text": "string" }
     - **'progress_tracker'**:
        - BEST FOR: Project status, workflow stages, completion tracking, milestone progress.
        - Schema: { "stages": [{ "label": "string", "icon": "emoji (optional)", "current": boolean (optional, marks active stage) }] }
  
  7. **Game Concept**: Propose a simple educational game concept in the 'gameConcept' field.
  
  8. **Job Listings & Career Topics**:
     - If Phase 1b found relevant job listings OR the topic clearly involves careers, roles, or hiring (e.g. "jobs", "careers", "roles", "positions", "hiring", "salary"), you MUST populate the 'jobListings' array with the best matches.
     - Prefer 3–9 high-quality remote-friendly roles that directly relate to the topic.
     - For career-focused topics, ensure at least one dynamic section near the top of 'dynamicSections' introduces the job board or career opportunities (for example, a 'text' section titled "Where to Apply" or an 'action_items' section with concrete next steps based on the job listings).

  8b. **News & Images (Brave)**:
     - If Phase 1b used 'news_search' (you will see SYSTEM_DATA_INJECTION: news_search), you SHOULD include exactly one 'news_gallery' dynamic section.
     - The UI will automatically fetch relevant images (via Brave image search) when 'news_gallery.articles' are present.
     - If Phase 1b used 'brave_image_search' (you will see SYSTEM_DATA_INJECTION: brave_image_search), you SHOULD attach images directly in JSON using 'imageUrl'.
       * For 'news_gallery', set 'articles[i].imageUrl' to a relevant Brave result thumbnail URL.
       * For 'entity_logo_wall', set 'entities[i].imageUrl' to a relevant Brave result thumbnail URL.
       * For 'key_people_gallery', set 'people[i].imageUrl' to a relevant Brave result thumbnail URL.
       * For 'chart_image_gallery', set 'images[i].imageUrl' to a relevant Brave result thumbnail URL.
       * Prefer thumbnail.src for fast loading. Ensure the URL starts with https.

  9. **Wiza Prospects & Company Lists**:
     - If Phase 1b used 'wiza_prospect_search' (you will see SYSTEM_DATA_INJECTION: wiza_prospect_search with JSON results), parse that data and create at least one dynamic section that summarizes the best prospects/companies.
     - Prefer a 'table' dynamic section titled something like "Target Prospects & Companies" with content schema: { "headers": ["Name", "Title", "Company", "Location", "Email Status"], "rows": [["string"]] }.
     - You may also create a 'top_picks' section highlighting 3–7 especially relevant companies or personas from the Wiza results.
     - If the Wiza injection contains an error (e.g. {"error": "..."} or status code != 200), you MUST include a 'highlight_box' dynamic section explaining the failure and what filters/query to try next.

  10. **EVERYDAY & LIFESTYLE WIDGETS** (Use these for casual/personal topics):
      
      **Casual Topic Indicators** - Use these widgets when the query:
      - Starts with "how do I...", "what is the best...", "should I...", "where can I..."
      - Involves: pets, hobbies, cooking, travel, entertainment, shopping, health, parenting, DIY, gifts
      - Sounds like a personal question rather than a professional research topic
      
      **Widget Schemas for Everyday Topics**:
      
      - **'buying_guide'**: Product comparisons, shopping advice.
        Schema: { "products": [{ "name": "string", "price": "string", "rating": number (1-5), "pros": ["string"], "cons": ["string"], "bestFor": "string" }], "verdict": "string" }
      
      - **'streaming_guide'**: Where to watch movies/shows.
        Schema: { "title": "string", "type": "movie"|"series", "platforms": [{ "name": "string", "available": boolean, "subscription": "string (optional)" }], "synopsis": "string (optional)" }
      
      - **'gift_ideas'**: Gift recommendations for occasions.
        Schema: { "occasion": "string", "recipient": "string (optional)", "budget": "string (optional)", "gifts": [{ "name": "string", "price": "string", "category": "string", "whyGreat": "string" }] }
      
      - **'diy_project'**: Craft tutorials, home improvement.
        Schema: { "title": "string", "difficulty": "beginner"|"intermediate"|"advanced", "time": "string", "cost": "string (optional)", "materials": ["string"], "tools": ["string"], "steps": [{ "step": number, "instruction": "string", "tip": "string (optional)" }] }
      
      - **'pet_care'**: Pet breed info, care guides.
        Schema: { "animal": "string", "breed": "string (optional)", "size": "string", "lifespan": "string", "temperament": ["string"], "careLevel": "easy"|"moderate"|"demanding", "needs": { "exercise": "string", "grooming": "string", "diet": "string" }, "tips": ["string"] }
      
      - **'hobby_starter'**: Getting started with new hobbies.
        Schema: { "hobby": "string", "difficulty": "beginner"|"intermediate"|"advanced", "timeToLearn": "string", "initialCost": "string", "whatYouNeed": ["string"], "firstSteps": [{ "step": number, "title": "string", "description": "string" }], "resources": [{ "name": "string", "type": "string" }] }
      
      - **'budget_breakdown'**: Cost estimates, expense breakdowns.
        Schema: { "title": "string", "total": "string", "categories": [{ "name": "string", "amount": number, "percentage": number (optional) }], "tips": ["string"] (optional) }
      
      - **'life_hack_cards'**: Quick tips, life hacks, shortcuts.
        Schema: { "category": "string", "hacks": [{ "title": "string", "description": "string", "icon": "emoji" }] }
      
      - **'review_summary'**: Aggregated product/service reviews.
        Schema: { "item": "string", "overallRating": number (1-5), "totalReviews": "string", "breakdown": [{ "category": "string", "score": number (1-5) }], "topPros": ["string"], "topCons": ["string"], "verdict": "string" }
      
      - **'podcast_playlist'**: Podcast recommendations.
        Schema: { "topic": "string", "podcasts": [{ "name": "string", "host": "string (optional)", "description": "string" }] }
      
      - **'season_guide'**: Seasonal activities and recommendations.
        Schema: { "season": "spring"|"summer"|"fall"|"winter"|"any", "activities": [{ "name": "string", "description": "string", "icon": "emoji (optional)" }], "tips": ["string"] (optional) }
      
      - **'celebration_planner'**: Party planning, event organization.
        Schema: { "occasion": "string", "checklist": [{ "task": "string", "category": "venue"|"food"|"decor"|"entertainment"|"other", "priority": "high"|"medium"|"low" }], "ideas": [{ "category": "string", "suggestions": ["string"] }] }
      
      - **'parenting_tips'**: Child development, age-appropriate activities.
        Schema: { "ageGroup": "string", "topic": "string", "tips": [{ "title": "string", "description": "string", "icon": "emoji (optional)" }] }
      
      **AVOID for Casual Topics** (unless explicitly relevant):
      - 'gtm_playbook', 'stakeholder_map', 'risk_matrix', 'funnel_breakdown'
      - 'channel_mix_board', 'messaging_matrix', 'experiment_backlog'
      - 'tradingview_chart', 'sankey_flow', 'influence_network'
  
  `;

  onUpdate?.('tool', `[PHASE 2] Synthesizing Final Report with ${smartModel}...`);

  // Wrapper for Phase 2 synthesis with fallback
  const synthesizeReport = async (model: string): Promise<any> => {
    try {
      return await researchAi.models.generateContent({
        model: model,
        contents: phase2Prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });
    } catch (e) {
      if (checkRateLimit(e)) {
        handleResearchError(e);
      }
      if (model !== MODEL_FAST) {
        console.warn(`Report synthesis failed on ${model}, falling back to Flash...`, e);
        onUpdate?.('tool', '⚠️ Synthesis retrying on faster model...');
        return await synthesizeReport(MODEL_FAST);
      }
      throw e;
    }
  };

  let response;
  try {
    response = await synthesizeReport(smartModel);
  } catch (e) {
    console.error("Synthesis failed completely", e);
    throw e;
  }

  const jsonText = response.text || "{}";
  let reportData: ResearchReport;
  try {
    let cleanJson = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = cleanJson.indexOf('{');
    const end = cleanJson.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      cleanJson = cleanJson.substring(start, end + 1);
    }
    reportData = JSON.parse(cleanJson);
  } catch (e) {
    console.error("JSON Parse Error", e);
    throw new Error("Failed to parse report JSON");
  }

  // Enforce variety for the funSection game mechanic so repeated runs don't feel identical.
  // Even if the model repeats, we override with a deterministic picker that avoids recent mechanics.
  try {
    const rawMechanic = (reportData as any)?.gameConcept?.mechanic;
    const normalizedMechanic = typeof rawMechanic === 'string' ? rawMechanic : '';
    const isKnownMechanic = (GAME_MECHANICS as unknown as string[]).includes(normalizedMechanic);
    const isRepeat = recentGameMechanics.includes(normalizedMechanic);
    const enforcedMechanic = (!isKnownMechanic || isRepeat)
      ? pickGameMechanic(topic, recentGameMechanics)
      : normalizedMechanic;

    const inferGameType = (mechanic: string): 'quiz' | 'simulation' | 'puzzle' => {
      if (mechanic === 'duolingo_quiz') return 'quiz';
      if (mechanic === 'tetris' || mechanic === 'merge_2048' || mechanic === 'memory_match' || mechanic === 'word_puzzle') return 'puzzle';
      return 'simulation';
    };

    if ((reportData as any).gameConcept && typeof (reportData as any).gameConcept === 'object') {
      (reportData as any).gameConcept.mechanic = enforcedMechanic;
      if (!((reportData as any).gameConcept.type === 'quiz' || (reportData as any).gameConcept.type === 'simulation' || (reportData as any).gameConcept.type === 'puzzle')) {
        (reportData as any).gameConcept.type = inferGameType(enforcedMechanic);
      }
    }
  } catch (e) {
    console.warn('Failed to enforce game mechanic variety', e);
  }

  // Inject Sources (Merge all phases including Phase 1g)
  const allSources = [...p1a.sources, ...p1c.sources, ...p1e_sources, ...p1f.sources, ...p1g_sources];
  // Deduplicate by URI
  const uniqueMap = new Map();
  for (const s of allSources) {
    if (!uniqueMap.has(s.uri)) {
      uniqueMap.set(s.uri, s);
    }
  }
  reportData.sources = Array.from(uniqueMap.values());
  reportData.youtubeVideos = videos;
  if (videoAnalysisData) {
    reportData.videoAnalysis = videoAnalysisData;
  }

  // Persist Wiza prospects (if any) so the dashboard can show lead counts and a modal.
  try {
    const rawBlocks = extractInjectedJsonBlocks(p1b_tools.text || '', 'wiza_prospect_search');
    const merged = mergeWizaProspects(rawBlocks);
    if (merged) {
      (reportData as any).wizaProspects = merged;
    }
  } catch (e) {
    console.warn('Failed to persist Wiza prospects into report', e);
  }

  const normalizeDynamicSections = (sections: any[] | undefined | null): any[] => {
    if (!Array.isArray(sections)) return [];

    const out: any[] = [];
    const typeCounts = new Map<string, number>();

    const isWizaProspectsSection = (s: any): boolean => {
      const type = typeof s?.type === 'string' ? s.type : '';
      const title = typeof s?.title === 'string' ? s.title : '';
      if (type === 'table') {
        const headers = Array.isArray(s?.content?.headers) ? s.content.headers.map((h: any) => String(h || '').toLowerCase()) : [];
        const titleHit = /\b(prospect|prospects|leads|targets|target|companies|company)\b/i.test(title);
        const headerHit = headers.some((h: string) => h.includes('email') || h.includes('company') || h.includes('title') || h.includes('location'));
        return titleHit || headerHit;
      }
      if (type === 'top_picks') {
        return /\b(prospect|prospects|leads|targets|target|companies|company)\b/i.test(title);
      }
      return false;
    };

    const sectionBucketKey = (s: any): string => {
      const type = typeof s?.type === 'string' ? s.type : '';
      if (!type) return '';
      if ((type === 'table' || type === 'top_picks') && isWizaProspectsSection(s)) {
        return `${type}_wiza`;
      }
      return type;
    };

    for (const s of sections) {
      const bucket = sectionBucketKey(s);
      if (!bucket) continue;

      const prev = typeCounts.get(bucket) || 0;
      const rawType = typeof s?.type === 'string' ? s.type : '';
      const maxForType = rawType === 'text' ? 2 : 1;
      if (prev >= maxForType) continue;

      typeCounts.set(bucket, prev + 1);
      out.push(s);
    }

    return out;
  };

  const countDistinctTypes = (sections: any[]): number => {
    const set = new Set<string>();
    for (const s of sections) {
      if (typeof s?.type === 'string') set.add(s.type);
    }
    return set.size;
  };

  const mergeDynamicSections = (base: any[], extra: any[], maxTotal: number): any[] => {
    const merged: any[] = [];
    const typeCounts = new Map<string, number>();

    const isWizaProspectsSection = (s: any): boolean => {
      const type = typeof s?.type === 'string' ? s.type : '';
      const title = typeof s?.title === 'string' ? s.title : '';
      if (type === 'table') {
        const headers = Array.isArray(s?.content?.headers) ? s.content.headers.map((h: any) => String(h || '').toLowerCase()) : [];
        const titleHit = /\b(prospect|prospects|leads|targets|target|companies|company)\b/i.test(title);
        const headerHit = headers.some((h: string) => h.includes('email') || h.includes('company') || h.includes('title') || h.includes('location'));
        return titleHit || headerHit;
      }
      if (type === 'top_picks') {
        return /\b(prospect|prospects|leads|targets|target|companies|company)\b/i.test(title);
      }
      return false;
    };

    const sectionBucketKey = (s: any): string => {
      const type = typeof s?.type === 'string' ? s.type : '';
      if (!type) return '';
      if ((type === 'table' || type === 'top_picks') && isWizaProspectsSection(s)) {
        return `${type}_wiza`;
      }
      return type;
    };

    const tryAdd = (s: any): boolean => {
      if (!s || typeof s !== 'object') return false;
      const bucket = sectionBucketKey(s);
      if (!bucket) return false;
      const prev = typeCounts.get(bucket) || 0;
      const rawType = typeof s.type === 'string' ? s.type : '';
      const maxForType = rawType === 'text' ? 2 : 1;
      if (prev >= maxForType) return false;
      typeCounts.set(bucket, prev + 1);
      merged.push(s);
      return true;
    };

    for (const s of base) {
      if (merged.length >= maxTotal) break;
      tryAdd(s);
    }
    for (const s of extra) {
      if (merged.length >= maxTotal) break;
      tryAdd(s);
    }

    return merged;
  };

  const MAX_DYNAMIC_SECTIONS = 12;
  const MIN_DISTINCT_TYPES = 5;
  const MIN_SECTIONS_FOR_VARIETY = 7;

  const initialSections = normalizeDynamicSections((reportData as any).dynamicSections);
  (reportData as any).dynamicSections = initialSections;

  const distinctTypes = countDistinctTypes(initialSections);
  const needsVarietyBoost =
    initialSections.length >= MIN_SECTIONS_FOR_VARIETY && distinctTypes < MIN_DISTINCT_TYPES;

  if (needsVarietyBoost) {
    try {
      onUpdate?.('tool', '🧩 Improving widget variety...');
      const usedTypes = Array.from(new Set(initialSections.map((s: any) => s?.type).filter(Boolean)));
      const refreshPrompt = `Generate ONLY a JSON array of additional dynamicSections objects.

Context:
- Topic: ${reportData.topic}
- Category: ${reportData.category || ''}
- Summary: ${(reportData as any).expandedSummary || reportData.summary || reportData.tldr}

Rules:
- Output ONLY JSON array (no markdown).
- Create 4 to 8 sections.
- Each section must be highly relevant and non-redundant.
- Avoid these section types already used: ${usedTypes.join(', ')}
- Prefer using a broader variety of section types from the available library (advanced widgets, matrices, grids, decision-support views).
- Do not include a section type more than once (exception: 'text' may appear twice).

Each item schema:
{ "title": string, "type": string, "content": any, "icon": string }
`;

      const refreshResp = await researchAi.models.generateContent({
        model: MODEL_FAST,
        contents: refreshPrompt,
        config: { responseMimeType: 'application/json' }
      });

      let extraSections: any[] = [];
      try {
        const raw = (refreshResp.text || '[]').replace(/```json/g, '').replace(/```/g, '').trim();
        extraSections = JSON.parse(raw);
      } catch {
        extraSections = [];
      }

      if (Array.isArray(extraSections) && extraSections.length > 0) {
        const normalizedExtra = normalizeDynamicSections(extraSections);
        (reportData as any).dynamicSections = mergeDynamicSections(
          initialSections,
          normalizedExtra,
          MAX_DYNAMIC_SECTIONS
        );
      }
    } catch (e) {
      console.warn('Dynamic section variety boost failed', e);
    }
  }

  // Ensure narrationScript exists for the summary play button (best-effort fallback).
  if (!(reportData as any).narrationScript) {
    try {
      onUpdate?.('tool', '🎙️ Generating narration script...');
      const narrationPrompt = `Write a single-speaker narration script that reads naturally aloud.

Topic: ${reportData.topic}

Use this summary as source material:
${(reportData as any).expandedSummary || reportData.summary || reportData.tldr}

Requirements:
- 60-120 seconds spoken
- No markdown
- No bullet points
- No speaker labels
- No stage directions
- Make it sound like a concise podcast monologue with a clear opening and closing`;

      const narrationResp = await researchAi.models.generateContent({
        model: MODEL_FAST,
        contents: narrationPrompt,
      });

      const narrationText = narrationResp.text?.trim();
      if (narrationText) {
        (reportData as any).narrationScript = narrationText;
      }
    } catch (e) {
      console.warn('Narration script generation failed', e);
    }
  }

  // Generate Fun Section (Game)
  if ((reportData as any).gameConcept) {
    onUpdate?.('tool', '🎮 Generating Interactive Game Module...');
    const gameHtml = await generateEducationalGame(reportData.topic, reportData.summary, (reportData as any).gameConcept);
    reportData.funSection = gameHtml;

    const mechanic = (reportData as any).gameConcept?.mechanic;
    if (typeof mechanic === 'string') {
      saveRecentGameMechanics(mechanic);
    }
  }

  // Generate a topic-specific generative UI widget (non-game) for every report
  try {
    onUpdate?.('tool', '🧩 Generating Topic Widget...');
    const widgetHtml = await generateTopicWidgetHtml(
      reportData.topic,
      reportData.summary,
      reportData.category,
      userLocation
    );
    (reportData as any).topicWidget = widgetHtml;
  } catch (e) {
    console.warn('Topic widget HTML generation failed', e);
  }

  try {
    const sections: any[] = Array.isArray((reportData as any).dynamicSections) ? (reportData as any).dynamicSections : [];
    const nextSections = [...sections];

    const fetchWizaProspectsTable = async () => {
      let listId: number | undefined;
      for (let attempt = 0; attempt < 12; attempt++) {
        const res = await authFetch('/api/wiza-generate-table', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: topic, size: 10, ...(listId ? { listId } : {}), userLocation }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok && res.status !== 202) {
          throw new Error(data?.error || 'Wiza prospects failed');
        }

        const nextListId = typeof data?.wiza?.listId === 'number' ? data.wiza.listId : undefined;
        if (nextListId) listId = nextListId;

        if (res.status === 200) {
          return data;
        }
        if (res.status === 202) {
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
      }
      throw new Error('Wiza prospects timed out');
    };

    if (wizaToolPlan.useProspects) {
      onUpdate?.('tool', `🧙 Wiza prospects enrichment...`);
      try {
        const data = await fetchWizaProspectsTable();
        const columns = Array.isArray(data?.tableSpec?.columns) ? data.tableSpec.columns : [];
        const rows = Array.isArray(data?.tableSpec?.rows) ? data.tableSpec.rows : [];
        if (columns.length && rows.length) {
          (reportData as any).wizaProspects = data;
          nextSections.push({
            title: 'Prospects (Wiza)',
            type: 'table',
            icon: '🧙',
            content: { headers: columns, rows },
          });
        }
        (reportData as any).wizaProspects = data;
      } catch (e: any) {
        nextSections.push({
          title: 'Wiza Prospects',
          type: 'text',
          icon: '🧙',
          content: `Wiza prospects enrichment failed: ${String(e?.message || e)}`,
        });
        (reportData as any).wizaProspects = { error: String(e?.message || e) };
      }
    }

    if (wizaToolPlan.useCompany) {
      onUpdate?.('tool', `🧙 Wiza company enrichment...`);
      try {
        const res = await authFetch('/api/wiza-company-enrich-table', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: topic, size: 10 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detailsText = typeof data?.details === 'string' ? data.details : '';
          if (detailsText.includes('Insufficient API credits') || detailsText.includes('need 2 credits')) {
            nextSections.push({
              title: 'Wiza Companies',
              type: 'text',
              icon: '🧙',
              content: 'Wiza company enrichment was skipped due to insufficient Wiza credits.',
            });
          } else {
            throw new Error(data?.error || 'Wiza company enrichment failed');
          }
        } else {
          const columns = Array.isArray(data?.tableSpec?.columns) ? data.tableSpec.columns : [];
          const rows = Array.isArray(data?.tableSpec?.rows) ? data.tableSpec.rows : [];
          if (columns.length && rows.length) {
            nextSections.push({
              title: 'Wiza Companies',
              type: 'table',
              icon: '🧙',
              content: { headers: columns, rows },
            });
          }
        }
        (reportData as any).wizaCompanies = data;
      } catch (e: any) {
        nextSections.push({
          title: 'Wiza Companies',
          type: 'text',
          icon: '🧙',
          content: `Wiza company enrichment failed: ${String(e?.message || e)}`,
        });
        (reportData as any).wizaCompanies = { error: String(e?.message || e) };
      }
    }

    if (nextSections.length !== sections.length) {
      (reportData as any).dynamicSections = nextSections;
    }
  } catch (e) {
    console.warn('Wiza enrichment attachment failed', e);
  }

  // ========== PHASE 3: GENERATE HEADER IMAGE & EXTRACT COLORS ==========
  // This happens BEFORE returning so the report loads with visuals ready
  onUpdate?.('tool', '🎨 Generating Header Image...');

  try {
    // Generate the header image using the prompt from the report (ONLY AI-GENERATED IMAGE)
    const imagePrompt = reportData.headerImagePrompt || `Modern, minimal illustration representing "${reportData.topic}". Clean vector art, professional, abstract geometric shapes.`;
    const result = await generateImage(imagePrompt);
    const headerImageUrl = result.imageDataUrl;
    reportData.headerImageUrl = headerImageUrl;

    onUpdate?.('tool', '🎨 Extracting Color Theme...');

    // Extract colors from the generated image
    const theme = await extractImageColors(headerImageUrl);
    if (theme) {
      reportData.theme = theme;
      onUpdate?.('tool', '✅ Theme extracted successfully');
    }

    // Log activity
    if (projectId && ownerUid) {
      try {
        await logProjectActivity(
          ownerUid,
          projectId,
          'asset_created',
          `Generated report header image for "${reportData.topic}"`,
          {
            assetType: 'image',
            topic: reportData.topic,
            prompt: imagePrompt,
            tags: ['image', 'header', 'ai-generated', 'research']
          }
        );
      } catch (logErr) {
        console.error("Failed to log header image activity", logErr);
      }
    }
  } catch (e) {
    console.error("Image/color generation failed:", e);
    onUpdate?.('tool', '⚠️ Image generation skipped');
  }

  // ========== PHASE 3b: FETCH PEXELS IMAGES FOR SECTIONS ==========
  // Use stock photos for slides and sections instead of AI generation
  onUpdate?.('tool', '🖼️ Fetching stock images from Pexels...');

  try {
    let pexelsCount = 0;

    // Process slides
    if (reportData.slides && Array.isArray(reportData.slides)) {
      for (const slide of reportData.slides) {
        if (slide.imagePrompt) {
          const searchQuery = slide.title || slide.imagePrompt;
          const pexelsUrl = await searchPexelsImage(searchQuery);
          if (pexelsUrl) {
            slide.imageUrl = pexelsUrl;
            pexelsCount++;
          }
        }
      }
    }

    // Process dynamic sections
    if (reportData.dynamicSections && Array.isArray(reportData.dynamicSections)) {
      for (const section of reportData.dynamicSections) {
        if (section.imagePrompt) {
          const searchQuery = section.title || section.imagePrompt;
          const pexelsUrl = await searchPexelsImage(searchQuery);
          if (pexelsUrl) {
            section.imageUrl = pexelsUrl;
            pexelsCount++;
          }
        }
      }
    }

    if (pexelsCount > 0) {
      onUpdate?.('tool', `✅ Fetched ${pexelsCount} stock images from Pexels`);
    }
  } catch (e) {
    console.error("Pexels image fetch failed:", e);
    onUpdate?.('tool', '⚠️ Stock image fetch skipped');
  }

  // ========== PHASE 3c: FILL MISSING CARD IMAGES WITH BRAVE ==========
  try {
    await fillMissingSectionImagesWithBrave(reportData, onUpdate);
  } catch (e) {
    console.warn("Brave image fill failed:", e);
  }

  reportData.userLocation = userLocation;
  return reportData;
};

// ========== PODCAST GENERATION (TTS) ==========

export interface PodcastScript {
  title: string;
  description: string;
  speakers: { name: string; role: string; voiceName: string }[];
  segments: { speaker: string; text: string }[];
  estimatedDuration: string;
}

export interface PodcastAudio {
  audioData: string; // base64 encoded audio
  mimeType: string;
  duration?: number;
}

// Convert PCM audio to WAV format
const pcmToWav = (pcmData: Uint8Array, sampleRate: number = 24000, numChannels: number = 1, bitsPerSample: number = 16): Uint8Array => {
  const dataLength = pcmData.length;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true); // byte rate
  view.setUint16(32, numChannels * bitsPerSample / 8, true); // block align
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  // Copy PCM data
  const wavData = new Uint8Array(buffer);
  wavData.set(pcmData, 44);

  return wavData;
};

export const generatePodcastScript = async (
  projectName: string,
  projectDescription: string,
  researchSummaries: { topic: string; summary: string; keyPoints: string[] }[],
  style: 'conversational' | 'educational' | 'debate' | 'interview' = 'conversational',
  targetDuration: 'short' | 'medium' | 'long' = 'medium',
  uploadedFiles?: { displayName: string; name: string; mimeType: string; summary?: string }[],
  projectContext?: string
): Promise<PodcastScript> => {
  const durationGuide = {
    short: '2-3 minutes (~400-600 words)',
    medium: '5-7 minutes (~1000-1400 words)',
    long: '10-15 minutes (~2000-3000 words)'
  };

  const styleGuide = {
    conversational: 'Two hosts having a friendly, engaging discussion. They build on each other\'s points, ask follow-up questions, and share genuine reactions.',
    educational: 'A knowledgeable host explains concepts to a curious co-host who asks clarifying questions. Focus on making complex topics accessible.',
    debate: 'Two hosts present different perspectives on the topic, respectfully challenging each other\'s views while finding common ground.',
    interview: 'One host interviews the other who is positioned as an expert. Include thoughtful questions and detailed answers.'
  };

  const researchContext = researchSummaries.map((r, i) => `
Research ${i + 1}: "${r.topic}"
Summary: ${r.summary}
Key Points:
${r.keyPoints.map(kp => `- ${kp}`).join('\n')}
`).join('\n---\n');

  const filesContext = uploadedFiles && uploadedFiles.length > 0 ? `

Uploaded Reference Files:
${uploadedFiles.map((f, i) => `
File ${i + 1}: "${f.displayName || f.name}" (${f.mimeType})
${f.summary ? `Summary: ${f.summary}` : 'Available for reference'}
`).join('\n---\n')}
` : '';

  const prompt = `Generate a podcast script for the project "${projectName}".

Project Description: ${projectDescription}

${projectContext ? `FULL PROJECT CONTEXT:
${projectContext}
` : ''}

Research gathered so far:
${researchContext || 'No research yet - generate an introductory episode about the project goals and what will be explored.'}${filesContext}


Style: ${styleGuide[style]}
Target Duration: ${durationGuide[targetDuration]}

Create an engaging, natural-sounding podcast conversation between two hosts. 
- Host 1 is a male-presenting host; give Host 1 a clearly male first name and set its "voiceName" to a male TTS voice (for example "Puck").
- Host 2 is a female-presenting host; give Host 2 a clearly female first name and set its "voiceName" to a female TTS voice (for example "Kore").
- Include natural speech patterns, brief reactions ("Right!", "That's fascinating", "Exactly"), and smooth transitions
- Make it feel like a real podcast, not a scripted reading
- Cover the key insights from the research in an accessible way
- End with a teaser or call to action

Return ONLY valid JSON in this exact format:
{
  "title": "Episode title",
  "description": "Brief episode description",
  "speakers": [
    { "name": "Host1Name", "role": "Lead Host", "voiceName": "Puck" },
    { "name": "Host2Name", "role": "Co-Host", "voiceName": "Kore" }
  ],
  "segments": [
    { "speaker": "Host1Name", "text": "Welcome to..." },
    { "speaker": "Host2Name", "text": "Thanks for having me..." }
  ],
  "estimatedDuration": "X minutes"
}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.9,
        maxOutputTokens: 8000
      }
    });

    const text = response.text?.trim() || '';
    let cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = cleanJson.indexOf('{');
    const end = cleanJson.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      cleanJson = cleanJson.substring(start, end + 1);
    }

    return JSON.parse(cleanJson) as PodcastScript;
  } catch (error) {
    console.error('Failed to generate podcast script:', error);
    throw new Error('Failed to generate podcast script');
  }
};

export const generatePodcastAudio = async (
  script: PodcastScript,
  onProgress?: (message: string) => void
): Promise<PodcastAudio> => {
  onProgress?.('Preparing podcast script for audio generation...');

  // Build the conversation transcript for TTS
  const transcript = script.segments
    .map(seg => `${seg.speaker}: ${seg.text}`)
    .join('\n');

  // Build the multi-speaker voice config
  const speakerVoiceConfigs = script.speakers.map(speaker => ({
    speaker: speaker.name,
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: speaker.voiceName }
    }
  }));

  const ttsPrompt = `TTS the following podcast conversation. Make it sound natural and engaging with appropriate pacing and emotion:

${transcript}`;

  onProgress?.('Generating audio with AI voices...');

  try {
    const tryModels = [MODEL_TTS, MODEL_TTS_FALLBACK];
    let response: any;
    let inline: { data: string; mimeType?: string } | null = null;

    for (const model of tryModels) {
      response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: ttsPrompt }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs
            }
          }
        } as any
      });

      inline = extractInlineAudioData(response);
      if (inline?.data) break;
    }

    const pcmData = inline?.data;

    if (!pcmData) {
      const parts = (response as any)?.candidates?.[0]?.content?.parts || [];
      console.warn('TTS response missing audio inlineData (podcast)', {
        hasText: !!(response as any)?.text,
        partKeys: parts.map((p: any) => Object.keys(p || {})),
        firstPart: parts[0],
      });
      throw new Error('No audio data received from TTS model');
    }

    onProgress?.('Converting audio to WAV format...');

    // Convert base64 PCM to Uint8Array
    const pcmBytes = Uint8Array.from(atob(pcmData), c => c.charCodeAt(0));

    // Convert PCM to WAV
    const wavBytes = pcmToWav(pcmBytes, 24000, 1, 16);

    // Convert WAV bytes back to base64 without blowing the stack on large arrays
    // (avoid String.fromCharCode(...wavBytes) which can cause RangeError)
    let binary = '';
    const chunkSize = 0x8000; // 32KB chunks
    for (let i = 0; i < wavBytes.length; i += chunkSize) {
      const chunk = wavBytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const wavBase64 = btoa(binary);

    onProgress?.('Audio generated successfully!');

    return {
      audioData: wavBase64,
      mimeType: 'audio/wav'
    };
  } catch (error) {
    console.error('Failed to generate podcast audio:', error);
    throw new Error('Failed to generate podcast audio. The TTS model may not be available yet.');
  }
};

export const generateSingleSpeakerAudio = async (
  text: string,
  voiceName: string = 'Kore',
  style?: string
): Promise<PodcastAudio> => {
  const styledPrompt = style
    ? `Say ${style}: ${text}`
    : text;

  try {
    const tryModels = [MODEL_TTS, MODEL_TTS_FALLBACK];
    let response: any;
    let inline: { data: string; mimeType?: string } | null = null;

    for (const model of tryModels) {
      response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: styledPrompt }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName }
            }
          }
        } as any
      });

      inline = extractInlineAudioData(response);
      if (inline?.data) break;
    }

    const pcmData = inline?.data;

    if (!pcmData) {
      const parts = (response as any)?.candidates?.[0]?.content?.parts || [];
      console.warn('TTS response missing audio inlineData (single speaker)', {
        hasText: !!(response as any)?.text,
        partKeys: parts.map((p: any) => Object.keys(p || {})),
        firstPart: parts[0],
      });
      throw new Error('No audio data received from TTS model');
    }

    // Convert base64 PCM to Uint8Array
    const pcmBytes = Uint8Array.from(atob(pcmData), c => c.charCodeAt(0));

    // Convert PCM to WAV
    const wavBytes = pcmToWav(pcmBytes, 24000, 1, 16);

    // Convert WAV bytes back to base64 in chunks to avoid RangeError on large arrays
    let binary = '';
    const chunkSize = 0x8000; // 32KB chunks
    for (let i = 0; i < wavBytes.length; i += chunkSize) {
      const chunk = wavBytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const wavBase64 = btoa(binary);

    return {
      audioData: wavBase64,
      mimeType: 'audio/wav'
    };
  } catch (error) {
    console.error('Failed to generate single speaker audio:', error);
    throw new Error('Failed to generate audio');
  }
};

// ============================================
// FILE UPLOAD & MANAGEMENT (Gemini Files API + File Search)
// ============================================

// Global File Search store for project data files used by assistants.
// We lazily create or re-use a single store for the current API key.
const FILE_SEARCH_STORE_DISPLAY_NAME = 'researcher-project-files';
let cachedFileSearchStoreName: string | null = null;

const ensureFileSearchStoreName = async (): Promise<string> => {
  if (cachedFileSearchStoreName) return cachedFileSearchStoreName;

  const client = new GoogleGenAI({ apiKey: primaryApiKey });

  try {
    const stores = await client.fileSearchStores.list();
    for await (const store of stores as any) {
      if ((store as any).displayName === FILE_SEARCH_STORE_DISPLAY_NAME) {
        cachedFileSearchStoreName = (store as any).name;
        return (store as any).name;
      }
    }
  } catch (err) {
    console.error('Failed to list File Search stores:', err);
  }

  const created = await client.fileSearchStores.create({
    config: { displayName: FILE_SEARCH_STORE_DISPLAY_NAME },
  });
  cachedFileSearchStoreName = (created as any).name;
  return (created as any).name;
};

export const getFileSearchStoreName = async (): Promise<string> => {
  return ensureFileSearchStoreName();
};

export const indexKnowledgeBaseFileToFileSearch = async (params: {
  projectId: string;
  kbFileId: string;
  displayName: string;
  mimeType: string;
  file: Blob;
}): Promise<{ documentName: string | null }> => {
  const { projectId, kbFileId, displayName, mimeType, file } = params;
  const client = new GoogleGenAI({ apiKey: primaryApiKey });

  const sanitizedProjectId = String(projectId || '').replace(/"/g, '');
  const sanitizedKbId = String(kbFileId || '').replace(/"/g, '');
  const sanitizedDisplayName = String(displayName || 'Knowledge base document').replace(/"/g, '');

  const lowerMime = String(mimeType || '').toLowerCase();
  if (lowerMime.startsWith('image/') || lowerMime.startsWith('video/') || lowerMime.startsWith('audio/')) {
    return { documentName: null };
  }

  const fileSearchStoreName = await ensureFileSearchStoreName();

  const customMetadata: Array<{ key: string; stringValue?: string; numericValue?: number }> = [
    { key: 'project_id', stringValue: sanitizedProjectId },
    { key: 'display_name', stringValue: sanitizedDisplayName },
    { key: 'kb_id', stringValue: sanitizedKbId },
    { key: 'origin', stringValue: 'knowledge_base' },
  ].filter((m: any) => typeof m?.stringValue === 'string' && String(m.stringValue).length > 0);

  let operation = await client.fileSearchStores.uploadToFileSearchStore({
    fileSearchStoreName,
    file,
    config: {
      displayName: sanitizedDisplayName,
      mimeType: lowerMime || undefined,
      customMetadata,
      chunkingConfig: {
        whiteSpaceConfig: {
          maxTokensPerChunk: 400,
          maxOverlapTokens: 60,
        },
      },
    },
  } as any);

  while (!operation.done) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    operation = await client.operations.get({ operation } as any);
  }

  const documentName = (operation as any)?.response?.documentName;
  return { documentName: documentName ? String(documentName) : null };
};

/**
 * Upload a file to Gemini Files API for use in prompts
 * @param file - The file to upload (from input element)
 * @param displayName - Optional display name for the file
 * @returns UploadedFile metadata
 */
export const uploadFileToGemini = async (
  file: File,
  displayName?: string,
  projectId?: string
): Promise<UploadedFile> => {
  const client = new GoogleGenAI({ apiKey: primaryApiKey });

  try {
    // 1) Upload to Gemini Files API (temporary storage)
    const uploadedFile = await client.files.upload({
      file,
      config: {
        mimeType: file.type,
        displayName: displayName || file.name,
      },
    });

    // 2) Ensure File Search store exists and import the file into it
    try {
      const lowerMime = String(uploadedFile.mimeType || file.type || '').toLowerCase();

      // File Search indexing is for text-like documents. Importing images/video/audio
      // can trigger opaque backend 500 errors; those file types should still be usable
      // directly via Files API parts.
      if (lowerMime.startsWith('image/') || lowerMime.startsWith('video/') || lowerMime.startsWith('audio/')) {
        // Poll until file is in ACTIVE state - video/audio files need processing time
        const maxWaitMs = 120000; // 2 minutes max wait for large videos
        const pollIntervalMs = 2000;
        const startTime = Date.now();

        let fileState = (uploadedFile as any).state;
        while (fileState === 'PROCESSING' && Date.now() - startTime < maxWaitMs) {
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
          try {
            const fileStatus = await client.files.get({ name: uploadedFile.name });
            fileState = (fileStatus as any).state;
          } catch (e) {
            console.warn('Failed to poll file state:', e);
            break;
          }
        }

        if (fileState !== 'ACTIVE') {
          console.warn(`File ${uploadedFile.name} is still in ${fileState} state after ${Date.now() - startTime}ms`);
        }

        return {
          name: uploadedFile.name,
          uri: uploadedFile.uri,
          mimeType: uploadedFile.mimeType,
          sizeBytes:
            typeof uploadedFile.sizeBytes === 'string'
              ? parseInt(uploadedFile.sizeBytes)
              : uploadedFile.sizeBytes,
          displayName: uploadedFile.displayName || file.name,
          uploadedAt: Date.now(),
          expiresAt: uploadedFile.expirationTime
            ? new Date(uploadedFile.expirationTime).getTime()
            : undefined,
        };
      }

      const fileSearchStoreName = await ensureFileSearchStoreName();
      const metadataDisplayName = (uploadedFile.displayName || file.name).replace(/"/g, '');
      const sanitizedProjectId = projectId ? projectId.replace(/"/g, '') : '';

      const customMetadata: Array<{ key: string; stringValue?: string; numericValue?: number }> = [
        { key: 'display_name', stringValue: metadataDisplayName },
      ];
      if (sanitizedProjectId) {
        customMetadata.push({ key: 'project_id', stringValue: sanitizedProjectId });
      }

      let operation = await client.fileSearchStores.importFile({
        fileSearchStoreName,
        fileName: uploadedFile.name,
        config: {
          customMetadata,
          chunkingConfig: {
            whiteSpaceConfig: {
              maxTokensPerChunk: 400,
              maxOverlapTokens: 60,
            },
          },
        } as any,
      });

      // Poll until indexing is complete so the file is ready for retrieval.
      while (!operation.done) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        operation = await client.operations.get({ operation });
      }
    } catch (importError) {
      console.error('Failed to import file into File Search store:', {
        importError,
        fileName: uploadedFile?.name,
        mimeType: uploadedFile?.mimeType,
        displayName: uploadedFile?.displayName,
        projectId,
      });
      // We still return the uploaded file so the UI can proceed; retrieval may be limited.
    }

    const result = {
      name: uploadedFile.name,
      uri: uploadedFile.uri,
      mimeType: uploadedFile.mimeType,
      sizeBytes:
        typeof uploadedFile.sizeBytes === 'string'
          ? parseInt(uploadedFile.sizeBytes)
          : uploadedFile.sizeBytes,
      displayName: uploadedFile.displayName || file.name,
      uploadedAt: Date.now(),
      expiresAt: uploadedFile.expirationTime
        ? new Date(uploadedFile.expirationTime).getTime()
        : undefined,
    };

    // Log activity if projectId is available
    if (projectId && auth.currentUser) {
      try {
        // Log file upload activity
        logProjectActivity(
          auth.currentUser.uid,
          projectId,
          'file_uploaded',
          `Uploaded file "${uploadedFile.displayName || file.name}"`,
          {
            fileName: uploadedFile.displayName || file.name,
            fileType: uploadedFile.mimeType,
            fileSize: typeof uploadedFile.sizeBytes === 'string' ? parseInt(uploadedFile.sizeBytes) : uploadedFile.sizeBytes,
            fileId: uploadedFile.name, // Gemini file name acts as ID
            tags: ['file', 'uploaded', ...(uploadedFile.mimeType?.split('/')[0] ? [uploadedFile.mimeType.split('/')[0]] : [])]
          }
        ).catch(err => console.error('Failed to log file upload activity:', err));
      } catch (err) {
        console.error('Failed to log file upload activity:', err);
      }
    }

    return result;
  } catch (error) {
    console.error('Failed to upload file to Gemini:', error);
    throw new Error('Failed to upload file');
  }
};

/**
 * Get metadata for an uploaded file
 * @param fileName - The file name returned from upload
 * @returns UploadedFile metadata
 */
export const getFileMetadata = async (fileName: string): Promise<UploadedFile> => {
  const ai = new GoogleGenAI({ apiKey: primaryApiKey });

  try {
    const file = await ai.files.get({ name: fileName });

    return {
      name: file.name,
      uri: file.uri,
      mimeType: file.mimeType,
      sizeBytes: typeof file.sizeBytes === 'string' ? parseInt(file.sizeBytes) : file.sizeBytes,
      displayName: file.displayName || fileName,
      uploadedAt: file.createTime ? new Date(file.createTime).getTime() : Date.now(),
      expiresAt: file.expirationTime ? new Date(file.expirationTime).getTime() : undefined
    };
  } catch (error) {
    console.error('Failed to get file metadata:', error);
    throw new Error('Failed to get file metadata');
  }
};

/**
 * List all uploaded files
 * @returns Array of UploadedFile metadata
 */
export const listUploadedFiles = async (): Promise<UploadedFile[]> => {
  const ai = new GoogleGenAI({ apiKey: primaryApiKey });

  try {
    const files: UploadedFile[] = [];
    const listResponse = await ai.files.list({ config: { pageSize: 100 } });

    for await (const file of listResponse) {
      files.push({
        name: file.name,
        uri: file.uri,
        mimeType: file.mimeType,
        sizeBytes: typeof file.sizeBytes === 'string' ? parseInt(file.sizeBytes) : file.sizeBytes,
        displayName: file.displayName || file.name,
        uploadedAt: file.createTime ? new Date(file.createTime).getTime() : Date.now(),
        expiresAt: file.expirationTime ? new Date(file.expirationTime).getTime() : undefined
      });
    }

    return files;
  } catch (error) {
    console.error('Failed to list files:', error);
    return [];
  }
};

/**
 * Delete an uploaded file
 * @param fileName - The file name to delete
 */
export const deleteUploadedFile = async (fileName: string, projectId?: string): Promise<void> => {
  const ai = new GoogleGenAI({ apiKey: primaryApiKey });

  try {
    await ai.files.delete({ name: fileName });

    // Log activity if projectId is available
    if (projectId && auth.currentUser) {
      try {
        logProjectActivity(
          auth.currentUser.uid,
          projectId,
          'file_deleted',
          `Deleted file "${fileName}"`,
          {
            fileName: fileName,
            fileId: fileName,
            tags: ['file', 'deleted']
          }
        ).catch(err => console.error('Failed to log file deletion activity:', err));
      } catch (err) {
        console.error('Failed to log file deletion activity:', err);
      }
    }
  } catch (error: any) {
    console.error('Failed to delete file:', error);

    // If the file has already expired or is not accessible anymore, Gemini
    // returns PERMISSION_DENIED/NOT_FOUND with a 403/404. In that case we
    // still want to treat the delete as a success locally so the file is
    // removed from the Data tab and project metadata.
    try {
      const code =
        error?.error?.code ??
        error?.code ??
        error?.statusCode ??
        undefined;

      const status =
        error?.error?.status ??
        error?.status ??
        undefined;

      const message: string = error?.message || '';

      const alreadyGone =
        code === 403 ||
        code === 404 ||
        status === 'PERMISSION_DENIED' ||
        status === 'NOT_FOUND' ||
        message.includes('You do not have permission to access the File') ||
        message.includes('may not exist');

      if (alreadyGone) {
        console.warn(
          `Gemini file ${fileName} could not be deleted remotely (likely expired or missing); treating as soft success and removing local metadata only.`
        );
        return;
      }
    } catch (introspectionError) {
      console.error('Error while inspecting Gemini delete error', introspectionError);
    }

    // For all other errors (network issues, auth, etc.) surface a failure so
    // the caller can show an error message.
    throw new Error('Failed to delete file');
  }
};

/**
 * Generate a summary of an uploaded file using Gemini AI
 * @param fileUri - The URI of the uploaded file
 * @param mimeType - The MIME type of the file
 * @param displayName - The display name of the file
 * @returns AI-generated summary of the file content
 */
export const generateFileSummary = async (
  fileUri: string,
  mimeType: string,
  displayName: string
): Promise<string> => {
  const client = new GoogleGenAI({ apiKey: primaryApiKey });

  try {
    const mime = mimeType || '';

    // Audio files: use the Gemini audio understanding pathway via Files API
    // so the model can access the actual waveform and produce grounded summaries.
    if (mime.startsWith('audio/')) {
      const prompt = `You are summarizing the audio file "${displayName}" (${mime}).

Transcribe the speech (if any) and summarize the main topics and key points in 2-3 sentences.`;

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { fileData: { fileUri, mimeType } },
              { text: prompt },
            ],
          },
        ],
      });

      return response.text || '';
    }

    // Video files: also use Files API directly so Gemini can process both
    // audio and visual streams, following the video understanding guide.
    if (mime.startsWith('video/')) {
      const prompt = `You are summarizing the video file "${displayName}" (${mime}).

Describe the key events in this video, providing both audio and visual details, and summarize the main storyline and topics in 2-3 sentences. If appropriate, include timestamps for the most important moments.`;

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { fileData: { fileUri, mimeType } },
              { text: prompt },
            ],
          },
        ],
      });

      return response.text || '';
    }

    // Image files: use Files API directly so Gemini can see the pixels.
    if (mime.startsWith('image/')) {
      const prompt = `You are describing the image file "${displayName}" (${mime}).

Describe the main subjects, visual content, and any visible text in 2-3 sentences.`;

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { fileData: { fileUri, mimeType } },
              { text: prompt },
            ],
          },
        ],
      });

      return response.text || '';
    }

    // Non-audio, non-video, non-image files: use File Search RAG based on metadata.
    const fileSearchStoreName = await ensureFileSearchStoreName();

    let taskPrompt = '';
    if (mime.includes('pdf') || mime.includes('document') || mime.includes('text')) {
      taskPrompt =
        'Summarize the document in 2-3 sentences. Focus on the main topics, key points, and purpose of the document.';
    } else if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) {
      taskPrompt =
        'Describe the spreadsheet in 2-3 sentences. Explain what data it contains and its general structure.';
    } else {
      taskPrompt =
        'Analyze and summarize the content of the file in 2-3 sentences, focusing on the most important information.';
    }

    const sanitizedDisplayName = displayName.replace(/"/g, '');

    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `You have access to a File Search store of project files.\n\nFocus ONLY on the document whose metadata field display_name equals "${sanitizedDisplayName}".\n\n${taskPrompt}`,
            },
          ],
        },
      ],
      config: {
        tools: [
          {
            fileSearch: {
              fileSearchStoreNames: [fileSearchStoreName],
              metadataFilter: `display_name="${sanitizedDisplayName}"`,
            },
          },
        ],
      },
    });

    return response.text || '';
  } catch (error) {
    console.error('Failed to generate file summary via File Search:', error);
    return '';
  }
};

/**
 * Analyze an uploaded file with a specific task using Gemini AI
 * Used by Live API tool calling to retrieve and analyze file contents
 * @param fileUri - The URI of the uploaded file
 * Internal helper to ensure we have a Gemini File API URI.
 * If the provided URI is already a Gemini URI (starts with https://generativelanguage.googleapis.com), it returns it.
 * Otherwise, it assumes it's a public URL, fetches it, and uploads it to Gemini.
 */
async function ensureGeminiUri(
  uri: string,
  mimeType: string,
  displayName: string
): Promise<string> {
  // If it's already a Gemini URI, return as-is
  if (uri.startsWith('https://generativelanguage.googleapis.com')) {
    return uri;
  }

  console.log(`[geminiService] Converting public URL to Gemini URI for: ${displayName}`);

  try {
    // 1) Fetch the file content
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`Failed to fetch file from URL: ${response.statusText}`);
    const blob = await response.blob();

    // Create a File object from the blob
    const file = new File([blob], displayName, { type: mimeType });

    // 2) Upload to Gemini Files API
    // We use a simplified version of uploadFileToGemini logic here to avoid circular dependencies or complex state
    const client = new GoogleGenAI({ apiKey: primaryApiKey });
    const uploadedFile = await client.files.upload({
      file,
      config: {
        mimeType: mimeType || blob.type,
        displayName: displayName,
      },
    });

    // 3) Wait for ACTIVE state if it's a media file
    const lowerMime = (mimeType || blob.type || '').toLowerCase();
    if (lowerMime.includes('video') || lowerMime.includes('audio')) {
      const maxWaitMs = 60000;
      const pollIntervalMs = 2000;
      const startTime = Date.now();

      let fileState = (uploadedFile as any).state;
      while (fileState === 'PROCESSING' && Date.now() - startTime < maxWaitMs) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        const fileStatus = await client.files.get({ name: uploadedFile.name });
        fileState = (fileStatus as any).state;
      }
    }

    return uploadedFile.uri;
  } catch (error: any) {
    console.error('[geminiService] ensureGeminiUri failed:', error);
    // Fallback to original URI if upload fails (might fail Gemini-side anyway but best effort)
    return uri;
  }
}

/**
 * Analyzes a file using Gemini's multimodal capabilities or File Search RAG.
 * Automatically handles public URLs by uploading them to Gemini Files API if needed.
 */
export const analyzeFileWithGemini = async (
  fileUri: string,
  mimeType: string,
  task: string,
  displayName: string
): Promise<string> => {
  const client = new GoogleGenAI({ apiKey: primaryApiKey });

  try {
    const mime = (mimeType || '').toLowerCase();

    // 1) Relaxed MIME detection and on-the-fly Gemini URI conversion for Multimodal analysis

    // AUDIO
    if (mime.includes('audio')) {
      const actualUri = await ensureGeminiUri(fileUri, mimeType, displayName);
      const prompt = `You are analyzing the audio file "${displayName}" (${mime}).

Task: ${task}

First, generate a concise transcript of the speech (if any). Then fulfill the task, grounding your answer strictly in the actual audio content.`;

      const response = await client.models.generateContent({
        model: MODEL_FAST,
        contents: [
          {
            role: 'user',
            parts: [
              { fileData: { fileUri: actualUri, mimeType } },
              { text: prompt },
            ],
          },
        ],
        config: {
          temperature: 0.3,
          maxOutputTokens: 4096,
        },
      });

      return response.text || 'Analysis failed - no response generated';
    }

    // VIDEO
    if (mime.includes('video')) {
      const actualUri = await ensureGeminiUri(fileUri, mimeType, displayName);
      const prompt = `You are analyzing the video file "${displayName}" (${mime}).

Task: ${task}

First, understand the video by considering both the visuals and the audio track. Reference important events with approximate timestamps when helpful. Then fulfill the task, grounding your answer strictly in the actual video content.`;

      const response = await client.models.generateContent({
        model: MODEL_FAST,
        contents: [
          {
            role: 'user',
            parts: [
              { fileData: { fileUri: actualUri, mimeType } },
              { text: prompt },
            ],
          },
        ],
        config: {
          temperature: 0.3,
          maxOutputTokens: 4096,
        },
      });

      return response.text || 'Analysis failed - no response generated';
    }

    // IMAGE
    if (mime.includes('image')) {
      const actualUri = await ensureGeminiUri(fileUri, mimeType, displayName);
      const prompt = `You are analyzing the image file "${displayName}" (${mime}).

Task: ${task}

Use the actual visual content of the image (objects, layout, text, colors) to fulfill the task, and ground your answer in what is present in the image.`;

      const response = await client.models.generateContent({
        model: MODEL_FAST,
        contents: [
          {
            role: 'user',
            parts: [
              { fileData: { fileUri: actualUri, mimeType } },
              { text: prompt },
            ],
          },
        ],
        config: {
          temperature: 0.3,
          maxOutputTokens: 4096,
        },
      });

      return response.text || 'Analysis failed - no response generated';
    }

    // 2) Other file types (PDF, text, etc.): use File Search RAG
    const fileSearchStoreName = await ensureFileSearchStoreName();
    const sanitizedDisplayName = displayName.replace(/"/g, '');

    const prompt = `You are analyzing the file "${displayName}" (${mimeType}) that lives in a File Search store.

Task: ${task}

Use File Search to retrieve only the chunks associated with this file (metadata display_name=${sanitizedDisplayName}).
Provide a thorough and helpful response grounded in the actual contents of the file. Be specific and reference concrete details from the document.`;

    const response = await client.models.generateContent({
      model: MODEL_FAST,
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      config: {
        tools: [
          {
            fileSearch: {
              fileSearchStoreNames: [fileSearchStoreName],
              metadataFilter: `display_name="${sanitizedDisplayName}"`,
            },
          },
        ],
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    });

    return response.text || 'Analysis failed - no response generated';
  } catch (error: any) {
    console.error('[analyzeFileWithGemini] Error:', error);
    return `⚠️ Analysis error: ${error?.message || 'Unknown error'}`;
  }
};

// ========== GLOBAL KNOWLEDGE BASE SEARCH ==========

/**
 * Search across all indexed documents in a project's knowledge base.
 * Uses File Search (RAG) with project_id metadata filtering.
 *
 * @param query - The user's question or search query
 * @param projectId - The project ID to filter documents by
 * @returns Object with answer text and citations
 */
export const searchKnowledgeBase = async (
  query: string,
  projectId: string
): Promise<{ answer: string; citations: any[] }> => {
  if (!query || !query.trim()) {
    return { answer: 'No query provided.', citations: [] };
  }
  if (!projectId || !projectId.trim()) {
    return { answer: 'No project ID provided.', citations: [] };
  }

  const client = new GoogleGenAI({ apiKey: primaryApiKey });

  try {
    const fileSearchStoreName = await ensureFileSearchStoreName();
    const sanitizedProjectId = String(projectId).replace(/"/g, '');

    const prompt = `You are a knowledgeable research assistant with access to a document store containing the user's project files.

TASK: Answer the following question by searching and synthesizing information from the user's indexed documents.

QUESTION: ${query}

INSTRUCTIONS:
- Use the File Search tool to retrieve relevant document chunks filtered by project_id="${sanitizedProjectId}".
- Provide a comprehensive and accurate answer grounded in the actual document contents.
- If multiple documents contain relevant information, synthesize them into a cohesive response.
- Cite specific documents when referencing information.
- If no relevant information is found, clearly state that.
- Be specific and reference concrete details from the documents.`;

    const response = await client.models.generateContent({
      model: MODEL_FAST,
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      config: {
        tools: [
          {
            fileSearch: {
              fileSearchStoreNames: [fileSearchStoreName],
              metadataFilter: `project_id="${sanitizedProjectId}"`,
            },
          },
        ],
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    });

    const answer = response.text || 'No answer generated.';

    // Extract grounding metadata / citations if available
    const groundingMetadata = (response as any).candidates?.[0]?.groundingMetadata;
    const citations: any[] = [];

    if (groundingMetadata?.groundingChunks) {
      for (const chunk of groundingMetadata.groundingChunks) {
        if (chunk.retrievedContext) {
          citations.push({
            title: chunk.retrievedContext.title || 'Unknown Document',
            uri: chunk.retrievedContext.uri || '',
          });
        }
      }
    }

    return { answer, citations };
  } catch (error) {
    console.error('Failed to search knowledge base:', error);
    throw new Error(
      `Failed to search knowledge base: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

// ========== SOCIAL POST GENERATION ==========

export const generateSocialPostContent = async (
  currentContent: string,
  platform?: string,
  projectContext?: string
): Promise<string> => {
  try {
    const prompt = `You are an expert social media manager.
    
TASK: Generate or improve a social media post based on the user's input.
PLATFORM: ${platform || 'General (applies to Twitter, LinkedIn, Instagram, etc.)'}
USER INPUT: "${currentContent || ''}"

${projectContext ? `FULL PROJECT CONTEXT:
Use this information to make the post highly specific, factual, and relevant to the project:
${projectContext}
` : ''}

INSTRUCTIONS:
- If the user input is empty, generate an engaging starter post about the project using the provided context.
- If the user input is a short prompt (e.g., "Launch announcement for Project X"), write a complete, engaging post about it, using details from the Project Context.
- If the user input is already a draft, improve it (fix grammar, make it more engaging, add emojis) and expand comfortably if needed, ensuring factual accuracy against the Project Context.
- Keep the tone professional yet consistently engaging.
- Use appropriate emojis.
- Do NOT include hashtags unless they are highly relevant.
- Return ONLY the post text. Do not wrap in quotes or markdown blocks.`;

    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,
        maxOutputTokens: 500,
      },
    });

    return response.text?.trim() || currentContent;
  } catch (error) {
    console.error("Failed to generate social post content:", error);
    return currentContent; // Fallback to original
  }
};

// ========== COMPUTER USE (PRO USERS ONLY) ==========

export interface ComputerUseSession {
  id: string;
  status: 'starting' | 'in_progress' | 'awaiting_confirmation' | 'completed' | 'failed' | 'cancelled';
  screenshotBase64?: string;
  currentUrl?: string;
  pendingAction?: {
    name: string;
    args: Record<string, any>;
    safetyDecision?: { decision: string; explanation: string };
  };
  actions: Array<{
    name: string;
    timestamp: number;
    args?: Record<string, any>;
    result?: any;
    error?: string;
  }>;
  thoughts?: string[];
  turns: number;
  finalResult?: string;
  modelThoughts?: string;
  replayUrl?: string;
  liveViewUrl?: string;
  error?: string;
}



export interface ComputerUseUpdate {
  type: 'status' | 'action' | 'confirmation' | 'complete' | 'error';
  session: ComputerUseSession;
}

/**
 * Perform a Computer Use task (Pro users only).
 * Starts a browser automation session and polls for updates.
 * 
 * @param goal - The task goal (e.g., "Search for pricing on google.com")
 * @param initialUrl - Optional starting URL (defaults to google.com)
 * @param onUpdate - Callback for session updates
 * @returns The final session state
 */
export const performComputerUseTask = async (
  goal: string,
  initialUrl?: string,
  onUpdate?: (update: ComputerUseUpdate) => void
): Promise<ComputerUseSession> => {
  // Check subscription status before starting
  const subscribed = await isUserSubscribed().catch(() => false);
  if (!subscribed) {
    throw new Error('Computer Use is a Pro feature. Please upgrade to access browser automation.');
  }

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Start the session using V2 API
  const startRes = await authFetch('/api/computer-use-v2?action=start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal,
      initialUrl: initialUrl,
    }),
  });

  if (!startRes.ok) {
    const text = await startRes.text().catch(() => startRes.statusText);
    throw new Error(`Failed to start Computer Use session: ${text || startRes.status}`);
  }

  const startData = await startRes.json();
  const sessionId = startData.sessionId;
  if (!sessionId) {
    throw new Error('No session ID returned from Computer Use API');
  }

  // Poll for updates
  const timeoutMs = 10 * 60 * 1000; // 10 minutes max
  const startTs = Date.now();
  let pollDelayMs = 2000;
  let lastSession: ComputerUseSession | null = null;

  while (Date.now() - startTs < timeoutMs) {
    await sleep(pollDelayMs);
    pollDelayMs = Math.min(pollDelayMs + 1000, 5000); // Gradually increase delay

    const pollRes = await authFetch(`/api/computer-use-v2?action=status&sessionId=${encodeURIComponent(sessionId)}`);
    if (!pollRes.ok) {
      const text = await pollRes.text().catch(() => pollRes.statusText);
      throw new Error(`Failed to poll Computer Use session: ${text || pollRes.status}`);
    }

    const session = (await pollRes.json()) as ComputerUseSession;
    lastSession = session;

    // Notify callback
    if (onUpdate) {
      if (session.status === 'awaiting_confirmation') {
        onUpdate({ type: 'confirmation', session });
      } else if (session.status === 'completed') {
        onUpdate({ type: 'complete', session });
      } else if (session.status === 'failed' || session.status === 'cancelled') {
        onUpdate({ type: 'error', session });
      } else {
        onUpdate({ type: 'status', session });
      }
    }

    // Check terminal states
    if (['completed', 'failed', 'cancelled'].includes(session.status)) {
      return session;
    }

    // If awaiting confirmation, pause polling (UI should call confirmComputerUseAction)
    if (session.status === 'awaiting_confirmation') {
      return session;
    }
  }

  // Timeout
  if (lastSession) {
    lastSession.status = 'failed';
    lastSession.error = 'Session timed out';
    return lastSession;
  }

  throw new Error('Computer Use session timed out');
};

/**
 * Confirm or deny a pending safety action.
 * @param sessionId - The session ID
 * @param confirmed - Whether the user confirms the action
 */
export const confirmComputerUseAction = async (
  sessionId: string,
  confirmed: boolean
): Promise<ComputerUseSession> => {
  const res = await authFetch('/api/computer-use-v2?action=confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, confirmed }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to confirm action: ${text || res.status}`);
  }

  return await res.json();
};

/**
 * Cancel an active Computer Use session.
 * @param sessionId - The session ID to cancel
 */
export const cancelComputerUseSession = async (sessionId: string): Promise<void> => {
  const res = await authFetch('/api/computer-use-v2?action=cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to cancel session: ${text || res.status}`);
  }
};

/**
 * Send a follow-up command to an existing Computer Use session.
 * This allows session reuse instead of creating a new session for each command.
 * @param sessionId - The existing session ID
 * @param command - The new command to execute
 * @returns Updated session state
 */
export const sendComputerUseCommand = async (
  sessionId: string,
  command: string
): Promise<ComputerUseSession> => {
  const res = await authFetch('/api/computer-use-v2?action=send-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, command }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to send command: ${text || res.status}`);
  }

  return await res.json();
};

export const generateVeoVideo = async (
  prompt: string,
  aspectRatio: string,
  quality: 'speed' | 'quality',
  images: {
    image?: { base64: string, mimeType: string }, // Starting frame (Image-to-Video)
    referenceImages?: Array<{ base64: string, mimeType: string, referenceType?: 'asset' | 'character' | 'style' }> // Style/Character references
  } = {}
): Promise<Blob> => {
  try {
    // Prepare video generation config
    const config: any = {
      aspectRatio: aspectRatio === '9:16' ? '9:16' : '16:9',
    };

    // Default to 8 seconds for all modes
    config.durationSeconds = 8;

    // Handle reference images (style/character/content references)
    if (images.referenceImages && images.referenceImages.length > 0) {
      config.referenceImages = images.referenceImages.slice(0, 3).map(img => ({
        image: {
          imageBytes: img.base64,
          mimeType: img.mimeType || 'image/png'
        },
        referenceType: img.referenceType || 'asset'
      }));
      console.log(`[Veo] Using ${config.referenceImages.length} config reference images`);
    }

    // Use the correct model based on quality preference
    const model = quality === 'speed' ? 'veo-3.1-fast-generate-preview' : 'veo-3.1-generate-preview';

    console.log(`[Veo] Starting video generation with model: ${model}, aspectRatio: ${config.aspectRatio}, startImage: ${!!images.image}, refs: ${config.referenceImages?.length || 0}`);

    // Build the request - include single image at top level if provided
    const request: any = {
      model: model,
      prompt: prompt,
      config: config
    };

    // Add single image as starting frame (image-to-video)
    if (images.image) {
      request.image = images.image;
    }

    // Start the video generation operation
    let operation = await ai.models.generateVideos(request);

    console.log(`[Veo] Operation started: ${operation.name}`);

    // Poll the operation status until the video is ready
    const maxAttempts = 60; // Max 10 minutes (60 * 10 seconds)
    let attempts = 0;

    while (!operation.done && attempts < maxAttempts) {
      console.log(`[Veo] Waiting for video generation... (attempt ${attempts + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds

      operation = await ai.operations.getVideosOperation({
        operation: operation,
      });
      attempts++;
    }

    if (!operation.done) {
      throw new Error('Video generation timed out after 10 minutes');
    }

    console.log('[Veo] Video generation completed');

    // Check for errors in the response
    if (operation.error) {
      throw new Error(`Veo generation failed: ${operation.error.message || JSON.stringify(operation.error)}`);
    }

    // Get the generated video
    const generatedVideo = operation.response?.generatedVideos?.[0];
    if (!generatedVideo?.video) {
      throw new Error('No video content returned from Veo model');
    }

    // Download the video
    const videoFile = generatedVideo.video;

    // If video has bytes directly
    if (videoFile.videoBytes) {
      return new Blob([videoFile.videoBytes], { type: 'video/mp4' });
    }

    // If video needs to be downloaded via files API
    if (videoFile.uri) {
      console.log(`[Veo] Downloading video from: ${videoFile.uri}`);
      const response = await fetch(videoFile.uri, {
        headers: {
          'x-goog-api-key': primaryApiKey
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to download video: ${response.status}`);
      }
      return await response.blob();
    }

    // Try using the files download method
    try {
      await ai.files.download({
        file: videoFile,
        downloadPath: undefined // We'll handle the return value
      });

      // If the file has bytes after download attempt
      if (videoFile.videoBytes) {
        return new Blob([videoFile.videoBytes], { type: 'video/mp4' });
      }
    } catch (downloadError) {
      console.error('[Veo] Files download failed, trying URI:', downloadError);
    }

    throw new Error('Unable to retrieve video content from Veo response');

  } catch (error) {
    console.error('generateVeoVideo failed:', error);
    throw error;
  }
};

// ---------------------------------------------------------
// AI Website Editing
// ---------------------------------------------------------

export interface WebsiteEditResult {
  newHtml: string;
  summary: string;
}

/**
 * Apply targeted HTML/CSS edits to a website using AI based on natural language instructions.
 * Uses Gemini to understand the intent and modify the HTML accordingly.
 */
export async function editWebsiteWithAI(
  currentHtml: string,
  editInstruction: string,
  projectContext?: string
): Promise<WebsiteEditResult> {
  const systemInstruction = `You are an expert web developer. Your task is to modify HTML/CSS code based on user instructions.

RULES:
1. Return ONLY valid HTML. No explanations, no markdown code blocks.
2. Preserve the overall structure and styling of the original HTML.
3. Make targeted, minimal changes that fulfill the user's request.
4. If the instruction is unclear, make reasonable assumptions based on context.
5. Maintain responsive design and accessibility.
6. Do not add external dependencies unless specifically requested.

${projectContext ? `PROJECT CONTEXT:\n${projectContext}\n` : ''}`;

  const userPrompt = `CURRENT HTML:
\`\`\`html
${currentHtml}
\`\`\`

EDIT INSTRUCTION: ${editInstruction}

Apply the requested changes and return the complete modified HTML.`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction,
        temperature: 0.3, // Lower temperature for more precise edits
      }
    });

    let newHtml = response.text || '';

    // Clean up response if wrapped in code blocks
    if (newHtml.startsWith('```html')) {
      newHtml = newHtml.slice(7);
    }
    if (newHtml.startsWith('```')) {
      newHtml = newHtml.slice(3);
    }
    if (newHtml.endsWith('```')) {
      newHtml = newHtml.slice(0, -3);
    }
    newHtml = newHtml.trim();

    // Generate a summary of changes
    const summaryResponse = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: [{
        role: 'user',
        parts: [{ text: `Briefly describe in one sentence what was changed: "${editInstruction}"` }]
      }],
      config: { temperature: 0.5 }
    });

    return {
      newHtml,
      summary: summaryResponse.text || editInstruction
    };
  } catch (error: any) {
    throw new Error(`Failed to apply website edit: ${error.message}`);
  }
}

/**
 * Generate Text-to-Speech audio from text using Gemini TTS model.
 * Returns a base64 string of the audio data.
 */
export const generateTextToSpeech = async (
  text: string,
  voiceName: string = 'Kore'
): Promise<string> => {
  if (!text.trim()) {
    throw new Error('Text is required for speech generation');
  }

  // Use the specific TTS model
  const modelToUse = process.env.MODEL_TTS || 'gemini-2.5-flash-preview-tts';

  try {
    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: [
        {
          role: 'user',
          parts: [{ text: text.trim() }],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        // @ts-ignore - SpeechConfig types might be missing in some SDK versions
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName,
            },
          },
        },
      } as any,
    });

    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          return part.inlineData.data;
        }
      }
    }

    throw new Error('No audio data returned from Gemini TTS');
  } catch (error) {
    console.error('Gemini TTS generation failed:', error);
    throw error;
  }
};

// ============================================
// PROJECT COMPONENT ANALYSIS (Spider Chart)
// ============================================

const projectComponentScoreSchema = {
  type: 'object' as const,
  properties: {
    components: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          label: { type: 'string' as const, description: 'Short name (1-2 words max)' },
          value: { type: 'integer' as const, description: 'Weight/priority score from 0 to 100', minimum: 0, maximum: 100 },
        },
        required: ['label', 'value'],
      },
      minItems: 5,
      maxItems: 8,
    },
  },
  required: ['components'],
};

// Test edit
export const analyzeProjectComponents_OLD = async (projectContext: string): Promise<ProjectComponentScore[]> => {
  try {
    const prompt = `You are a project analysis expert. Analyze the following project context and identify the 6-8 most important sub-components or dimensions that make up this project. For each, assign a weight/priority score from 0 to 100 based on the current state of the project.

Consider dimensions such as (but adapt based on actual context):
- Research Depth (how thorough the research is)
- Task Progress (completion rate and organization)
- Content Quality (notes, drafts, blog posts)
- Source Coverage (number and diversity of sources)
- Asset Richness (files, images, videos uploaded)
- SEO Readiness (keyword research, optimization)
- Collaboration (team activity, shared resources)
- Planning (project structure, goals clarity)

Score each dimension based on what actually exists in the project. If a dimension has no data, score it low (5-15). If it's strong, score it high (70-100).

PROJECT CONTEXT:
${projectContext}

Return ONLY valid JSON with a "components" array.`;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: prompt,
      config: {
        temperature: 0.3,
        maxOutputTokens: 1000,
        responseMimeType: 'application/json',
        responseJsonSchema: projectComponentScoreSchema,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });

    const text = response.text?.trim() || '';
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed.components)) {
      return parsed.components.map((c: any) => ({
        label: String(c.label || 'Unknown').slice(0, 25),
        value: Math.max(0, Math.min(100, Number(c.value) || 0)),
      }));
    }

    throw new Error('Invalid response structure');
  } catch (error) {
    console.error('Project component analysis failed:', error);
    throw error;
  }
};

// ============================================
// PROJECT TOPIC ANALYSIS (Spider Chart – Back)
// ============================================

export const analyzeProjectTopics_OLD = async (projectContext: string): Promise<ProjectComponentScore[]> => {
  try {
    const prompt = `You are a subject-matter analyst. Given the following project context, identify the 6-8 most important KEY TOPICS, SUBJECTS, or SUB-TOPICS that this project covers. These should be the actual content themes — not meta-dimensions like "research depth" or "task progress".

For example, if the project is about "Electric Vehicles", the topics might be:
- Battery Tech (85)
- Charging Infra (70)
- Market Trends (60)
- Policy & Regs (45)
- Consumer Adoption (55)
- Supply Chain (40)

For each topic, assign a prominence/coverage score from 0 to 100 based on how much the project has explored that topic. Higher = more coverage in research, notes, and drafts. Keep labels to 1-2 words max.

PROJECT CONTEXT:
${projectContext}

Return ONLY valid JSON with a "components" array.`;

    const response = await ai.models.generateContent({
      model: MODEL_LITE,
      contents: prompt,
      config: {
        temperature: 0.3,
        maxOutputTokens: 1000,
        responseMimeType: 'application/json',
        responseJsonSchema: projectComponentScoreSchema,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });

    const text = response.text?.trim() || '';
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed.components)) {
      return parsed.components.map((c: any) => ({
        label: String(c.label || 'Unknown').slice(0, 25),
        value: Math.max(0, Math.min(100, Number(c.value) || 0)),
      }));
    }

    throw new Error('Invalid response structure');
  } catch (error) {
    console.error('Project topic analysis failed:', error);
    throw error;
  }
};

// ============================================
// VIDEO EDIT INTENT ANALYSIS (AI Routing)
// ============================================

export interface EditRoutingDecision {
  engine: 'xai' | 'luma';
  lumaMode?: string;        // e.g. "flex_1", "reimagine_2", "adhere_1"
  reasoning: string;        // Brief explanation shown to user
  shouldGenerateImage?: boolean; // If Luma & no user image → generate one
  imagePrompt?: string;     // Prompt for Gemini image generation
}

/**
 * Use Gemini Thinking to decide whether a video-edit prompt should go to
 * xAI (localized element edits) or Luma (scene-level / world changes),
 * and if Luma, which mode to use.
 *
 * Multimodal: analyzes the actual video content and reference image (if any)
 * alongside the text prompt for the most informed routing decision.
 */
export const analyzeEditIntent = async (
  editPrompt: string,
  hasReferenceImage: boolean,
  videoUrl?: string,
  referenceImageBase64?: string,
  referenceImageMimeType?: string,
): Promise<EditRoutingDecision> => {
  const systemInstruction = `You are a video-editing routing engine. You will receive the user's edit prompt, the SOURCE VIDEO they want to edit, and optionally a REFERENCE IMAGE they uploaded to guide the edit.

Analyze ALL inputs — the video content, the reference image (if present), and the text prompt — to decide:

1. **Engine**: "xai" or "luma"
   - Choose "xai" when the edit is LOCALIZED: swapping, recoloring, adding, or removing individual objects/elements WITHOUT changing the overall scene (e.g. "change the bicycle to a motorcycle", "make his shirt red", "remove the tree on the left").
   - Choose "luma" when the edit is a SCENE-LEVEL or WORLD CHANGE: altering the background, environment, art style, lighting mood, or the overall feel of the video (e.g. "transport this to Mars", "make it look like a watercolor painting", "change the background to a snowy forest", "make it nighttime").
   - If a reference image is provided, strongly prefer "luma" since it can use the image as a first-frame guide.

2. **Luma Mode** (only if engine is "luma"):
   - "flex_1" / "flex_2" / "flex_3": Flexible transformation. Use when the user wants a creative re-interpretation that can deviate from the original. Higher number = more creative freedom.
   - "adhere_1" / "adhere_2" / "adhere_3": Strict adherence. Use when the user wants to preserve the original motion, composition, and structure while applying visual changes (style transfer, color grading, lighting). Higher number = stricter adherence.
   - "reimagine_1" / "reimagine_2" / "reimagine_3": Full reimagination. Use when the user wants to completely transform the scene into something very different. Higher number = more dramatic change.

3. **shouldGenerateImage**: true if engine is "luma" AND the user has NOT uploaded a reference image AND the prompt would benefit from a generated reference first-frame to guide Luma. Consider the video content when deciding — if the transformation is dramatic, a generated first frame will greatly help.

4. **imagePrompt**: If shouldGenerateImage is true, write a concise image-generation prompt describing the desired FIRST FRAME of the edited video. Base this on what you see in the source video combined with the user's edit request. This should be a single static scene description, not a video description.

5. **reasoning**: One sentence explaining your choice (shown to the user). Reference what you observed in the video/image if relevant.

User has reference image: ${hasReferenceImage ? 'YES' : 'NO'}`;

  try {
    // Build multimodal content parts
    const contentParts: any[] = [];

    // 1. Add the source video if URL provided (via fileData for URLs)
    if (videoUrl) {
      // For blob storage URLs, fetch and pass as inline data
      try {
        const videoResponse = await fetch(videoUrl);
        if (videoResponse.ok) {
          const videoBuffer = await videoResponse.arrayBuffer();
          const videoBase64 = btoa(
            new Uint8Array(videoBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          );
          contentParts.push({
            inlineData: {
              mimeType: 'video/mp4',
              data: videoBase64,
            },
          });
        }
      } catch (videoErr) {
        console.warn('Could not fetch video for analysis, proceeding with text-only:', videoErr);
      }
    }

    // 2. Add the reference image if provided
    if (referenceImageBase64 && referenceImageMimeType) {
      contentParts.push({
        inlineData: {
          mimeType: referenceImageMimeType,
          data: referenceImageBase64,
        },
      });
      contentParts.push({ text: '[The above image is the REFERENCE IMAGE the user uploaded to guide the edit.]' });
    }

    // 3. Add the text prompt
    contentParts.push({ text: `User's edit request: "${editPrompt}"` });

    const response = await ai.models.generateContent({
      model: MODEL_SUPER_FAST,
      contents: contentParts,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.2,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT' as any,
          properties: {
            engine: { type: 'STRING' as any, enum: ['xai', 'luma'] },
            lumaMode: { type: 'STRING' as any },
            reasoning: { type: 'STRING' as any },
            shouldGenerateImage: { type: 'BOOLEAN' as any },
            imagePrompt: { type: 'STRING' as any },
          },
          required: ['engine', 'reasoning'],
        },
      },
    });

    const text = response.text?.trim() || '';
    const parsed = JSON.parse(text) as EditRoutingDecision;

    // Validate engine
    if (!['xai', 'luma'].includes(parsed.engine)) {
      parsed.engine = 'luma'; // Default to Luma when uncertain
    }

    // Clean up xAI decisions — remove Luma-only fields
    if (parsed.engine === 'xai') {
      parsed.lumaMode = undefined;
      parsed.shouldGenerateImage = false;
      parsed.imagePrompt = undefined;
    }

    // Default Luma mode if missing
    if (parsed.engine === 'luma' && !parsed.lumaMode) {
      parsed.lumaMode = 'flex_1';
    }

    return parsed;
  } catch (error) {
    console.error('Edit intent analysis failed, defaulting to Luma flex_1:', error);
    return {
      engine: 'luma',
      lumaMode: 'flex_1',
      reasoning: 'AI routing unavailable — defaulting to Luma flexible mode.',
      shouldGenerateImage: !hasReferenceImage,
      imagePrompt: !hasReferenceImage ? editPrompt : undefined,
    };
  }
};

// ============================================
// FIRST-FRAME IMAGE GENERATION (for Luma)
// ============================================

/**
 * Generate a reference first-frame image using Gemini image generation.
 * Returns a Blob (PNG) that can be uploaded to Blob storage for Luma's first_frame.
 */
export const generateFirstFrameImage = async (
  imagePrompt: string,
): Promise<Blob> => {
  if (!imagePrompt?.trim()) {
    throw new Error('Image prompt is required for first-frame generation');
  }

  const modelToUse = MODEL_IMAGE_FAST; // gemini-2.5-flash-image

  try {
    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: `Generate a single high-quality still image that will serve as the first frame of a video. The image should be photorealistic and cinematic.\n\nScene description: ${imagePrompt.trim()}`,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          const binaryString = atob(part.inlineData.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return new Blob([bytes], { type: 'image/png' });
        }
      }
    }

    throw new Error('No image data returned from Gemini');
  } catch (error) {
    console.error('First-frame image generation failed:', error);
    throw error;
  }
};

// ============================================
// PROJECT COMPONENT ANALYSIS (Server-Side Proxy)
// ============================================

export const analyzeProjectComponents = async (projectContext: string): Promise<ProjectComponentScore[]> => {
  try {
    const prompt = `You are a project analysis expert. Analyze the following project context and identify the 6-8 most important sub-components or dimensions that make up this project. For each, assign a weight/priority score from 0 to 100 based on the current state of the project.

Consider dimensions such as (but adapt based on actual context):
- Research Depth (how thorough the research is)
- Task Progress (completion rate and organization)
- Content Quality (notes, drafts, blog posts)
- Source Coverage (number and diversity of sources)
- Asset Richness (files, images, videos uploaded)
- SEO Readiness (keyword research, optimization)
- Collaboration (team activity, shared resources)
- Planning (project structure, goals clarity)

Score each dimension based on what actually exists in the project. If a dimension has no data, score it low (5-15). If it's strong, score it high (70-100).

PROJECT CONTEXT:
${projectContext}

Return ONLY valid JSON with a "components" array.`;

    // Use server-side proxy to avoid client-side API key restrictions
    const response = await authFetch('/api/agent?op=generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_LITE,
        contents: prompt,
        config: {
          temperature: 0.3,
          maxOutputTokens: 1000,
          responseMimeType: 'application/json',
          responseJsonSchema: projectComponentScoreSchema,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API failed: ${errText}`);
    }

    const data = await response.json();
    const text = data.text?.trim() || '';
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed.components)) {
      return parsed.components.map((c: any) => ({
        label: String(c.label || 'Unknown').slice(0, 25),
        value: Math.max(0, Math.min(100, Number(c.value) || 0)),
      }));
    }

    throw new Error('Invalid response structure');
  } catch (error) {
    console.error('Project component analysis failed:', error);
    throw error;
  }
};

export const analyzeProjectTopics = async (projectContext: string): Promise<ProjectComponentScore[]> => {
  try {
    const prompt = `You are a subject-matter analyst. Given the following project context, identify the 6-8 most important KEY TOPICS, SUBJECTS, or SUB-TOPICS that this project covers. These should be the actual content themes — not meta-dimensions like "research depth" or "task progress".

For example, if the project is about "Electric Vehicles", the topics might be:
- Battery Tech (85)
- Charging Infra (70)
- Market Trends (60)
- Policy & Regs (45)
- Consumer Adoption (55)
- Supply Chain (40)

For each topic, assign a prominence/coverage score from 0 to 100 based on how much the project has explored that topic. Higher = more coverage in research, notes, and drafts. Keep labels to 1-2 words max.

PROJECT CONTEXT:
${projectContext}

Return ONLY valid JSON with a "components" array.`;

    // Use server-side proxy
    const response = await authFetch('/api/agent?op=generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_LITE,
        contents: prompt,
        config: {
          temperature: 0.3,
          maxOutputTokens: 1000,
          responseMimeType: 'application/json',
          responseJsonSchema: projectComponentScoreSchema,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API failed: ${errText}`);
    }

    const data = await response.json();
    const text = data.text?.trim() || '';
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed.components)) {
      return parsed.components.map((c: any) => ({
        label: String(c.label || 'Unknown').slice(0, 25),
        value: Math.max(0, Math.min(100, Number(c.value) || 0)),
      }));
    }

    throw new Error('Invalid response structure');
  } catch (error) {
    console.error('Project topic analysis failed:', error);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// generateChatAIResponse — Powers @it AI mentions in the Project Chat
// ─────────────────────────────────────────────────────────────────────────────

export const generateChatAIResponse = async (
  project: ResearchProject,
  chatHistory: Array<{ authorName: string; text: string; createdAt: number }>,
  userMessage: string
): Promise<string> => {
  // Build a rich project context summary
  const researchSummary = (project.researchSessions || [])
    .slice(0, 10)
    .map(s => `- ${s.topic}: ${s.researchReport?.tldr || '(no summary)'}`)
    .join('\n');

  const notesSummary = (project.notes || [])
    .slice(0, 10)
    .map(n => `- ${n.title}: ${(n.content || '').slice(0, 150)}`)
    .join('\n');

  const tasksSummary = (project.tasks || [])
    .slice(0, 15)
    .map(t => `- [${t.status}] ${t.title}`)
    .join('\n');

  const knowledgeSummary = (project.knowledgeBase || [])
    .slice(0, 8)
    .map(f => `- ${f.name}${f.summary ? `: ${f.summary.slice(0, 100)}` : ''}`)
    .join('\n');

  const systemInstruction = `You are IT, an intelligent AI assistant embedded in a collaborative project workspace called "${project.name}".
You participate directly in the team's chat, responding when tagged with @it.
You have full knowledge of the project and help the team brainstorm, answer questions, summarize progress, explain tasks, and provide strategic insights.

## Project Overview
Name: ${project.name}
${project.description ? `Description: ${project.description}` : ''}

## Research Sessions (${(project.researchSessions || []).length} total)
${researchSummary || 'No research sessions yet.'}

## Notes (${(project.notes || []).length} total)
${notesSummary || 'No notes yet.'}

## Tasks (${(project.tasks || []).length} total)
${tasksSummary || 'No tasks yet.'}

## Knowledge Base Files (${(project.knowledgeBase || []).length} files)
${knowledgeSummary || 'No files uploaded yet.'}

## Collaboration
Collaborators: ${(project.collaborators || []).length + 1} people

## Your Response Style
- Be conversational, concise, and helpful. This is a team chat, not a formal report.
- Keep responses focused and relevant. Aim for 1-3 short paragraphs max unless detail is specifically needed.
- Use markdown sparingly — just bold for emphasis or bullet points where helpful.
- You can make suggestions, answer questions, summarize context, or suggest next steps.
- If you don't have enough context for a question, say so clearly.
- Address the person who tagged you directly when appropriate.`;

  // Format the last 20 messages as conversation history
  const historyContext = chatHistory
    .slice(-20)
    .map(m => `${m.authorName}: ${m.text}`)
    .join('\n');

  const userPrompt = `Recent conversation:
${historyContext}

The user just said: "${userMessage}"

Please respond as IT, the AI assistant for this project.`;

  try {
    const response = await generateContentFast(
      [{ role: 'user', parts: [{ text: userPrompt }] }],
      { temperature: 0.8 },
      systemInstruction
    );

    const text = response.text?.trim();
    if (!text) throw new Error('Empty AI response');
    return text;
  } catch (error) {
    console.error('[generateChatAIResponse] Failed:', error);
    throw error;
  }
};

