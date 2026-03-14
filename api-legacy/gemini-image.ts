import { GoogleGenAI } from '@google/genai';
import { requireAuth } from './_auth.js';

const MODEL_IMAGE_FAST = 'gemini-3.1-flash-image-preview';
const MODEL_IMAGE_SMART = 'gemini-3.1-flash-image-preview';

type ImageReference = {
  base64?: string;
  fileUri?: string;
  mimeType?: string;
};

type RequestBody = {
  prompt?: string;
  references?: ImageReference[];
  useProModel?: boolean;
  aspectRatio?: string;
  imageSize?: '1K' | '2K' | '4K';
  mode?: 'generate' | 'edit';
};

const styleGuide = `
STYLE GUIDE:
- High quality, professional presentation.
- Visually striking and aesthetically pleasing.
- Lighting: Professional studio lighting or natural cinematic lighting.
- COMPOSITION: Balanced and focused.
- COLORS: Use the specific colors mentioned in the prompt. If none are mentioned, match the mood of the topic.
- If the prompt requests text, ensure the text is rendered clearly in a modern sans-serif font within the image.
- Avoid distortions, blurs, or low-quality artifacts.`;

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

if (!apiKey) {
  console.warn('[api/gemini-image] Missing GEMINI_API_KEY or API_KEY environment variable.');
}

const client = apiKey ? new GoogleGenAI({ apiKey }) : null;

const toDataUrl = (base64: string, mimeType = 'image/png') => `data:${mimeType};base64,${base64}`;

async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download fallback image: ${res.status}`);
  }
  const mimeType = res.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return toDataUrl(base64, mimeType);
}

const resolvePexelsApiKey = () => process.env.PEXELS_API_KEY;

async function getPexelsImage(prompt: string): Promise<string> {
  const apiKey = resolvePexelsApiKey();
  if (!apiKey) {
    throw new Error('PEXELS_API_KEY is not set');
  }

  const encodedQuery = encodeURIComponent(prompt || 'abstract background');
  const url = `https://api.pexels.com/v1/search?query=${encodedQuery}&per_page=1&orientation=landscape`;
  const res = await fetch(url, {
    headers: {
      Authorization: apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(`Pexels API error: ${res.status}`);
  }

  const data = await res.json();
  const photo = data.photos?.[0];
  const imageUrl =
    photo?.src?.landscape ||
    photo?.src?.large ||
    photo?.src?.large2x ||
    photo?.src?.medium ||
    photo?.src?.original;

  if (!imageUrl) {
    throw new Error('No Pexels photos found');
  }

  return fetchImageAsBase64(imageUrl);
}

async function generateImage(
  prompt: string,
  references: ImageReference[] = [],
  options?: { useProModel?: boolean; aspectRatio?: string; imageSize?: '1K' | '2K' | '4K'; mode?: 'generate' | 'edit' }
): Promise<any[]> {
  if (!client) {
    throw new Error('Gemini client is not configured');
  }

  const mode = options?.mode || 'generate';
  const normalizedPrompt =
    mode === 'edit'
      ? `Edit the provided image using the instruction below. Preserve the original image unless the prompt requests changes.\n\nINSTRUCTION:\n${prompt || 'Make a subtle improvement.'}`
      : references.length > 0
        ? (prompt || 'Create an image based on the provided reference.') // Don't enforce strict style guide for image-to-image/editing to allow more control
        : `${prompt || 'Create an abstract illustration.'}\n\n${styleGuide.trim()}`;

  const parts: any[] = [];

  if (mode === 'edit') {
    // Edit mode structure
    if (references.length) {
      references.slice(0, 5).forEach((ref) => {
        if (ref.fileUri) {
          parts.push({
            fileData: {
              fileUri: ref.fileUri,
              mimeType: ref.mimeType || 'image/png',
            },
          });
        } else if (ref.base64) {
          parts.push({
            inlineData: {
              data: ref.base64,
              mimeType: ref.mimeType || 'image/png',
            },
          });
        }
      });
    }
    parts.push({ text: normalizedPrompt });
  } else {
    // Generate mode: Text prompt FIRST, then images (as per user example/preference for "text-and-image-to-image")
    // This allows "Create a picture of... [image]" logic to work better
    parts.push({ text: normalizedPrompt });

    if (references.length) {
      references.slice(0, 5).forEach((ref) => {
        if (ref.fileUri) {
          parts.push({
            fileData: {
              fileUri: ref.fileUri,
              mimeType: ref.mimeType || 'image/png',
            },
          });
        } else if (ref.base64) {
          parts.push({
            inlineData: {
              data: ref.base64,
              mimeType: ref.mimeType || 'image/png',
            },
          });
        }
      });
    }
  }

  const attemptModel = async (model: string) => {
    const config: any = {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        ...(options?.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
        ...(model === MODEL_IMAGE_SMART && options?.imageSize ? { imageSize: options.imageSize } : {}),
      },
    };

    // Logic for gemini-3.1-flash-image-preview
    // (Thinking configuration might not be needed or supported in the same way, but let's keep it harmless or adjust)
    // For now, I'll remove the specific thinking level for SMART since it's now the same as FAST

    const response = await client.models.generateContent({
      model,
      contents: { parts },
      config,
    });

    const candidateParts = response.candidates?.[0]?.content?.parts || [];

    // New response format: return all parts with metadata
    const resultParts: any[] = [];

    for (const part of candidateParts) {
      if (part.text) {
        resultParts.push({
          type: 'text',
          text: part.text,
          thought: part.thought || false,
          thoughtSignature: (part as any).thoughtSignature || (part as any).thought_signature,
        });
      } else if (part.inlineData?.data) {
        resultParts.push({
          type: 'image',
          dataUrl: toDataUrl(part.inlineData.data, part.inlineData.mimeType || 'image/png'),
          mimeType: part.inlineData.mimeType || 'image/png',
          thought: part.thought || false,
          thoughtSignature: (part as any).thoughtSignature || (part as any).thought_signature,
        });
      }
    }

    // Must have at least one image part
    const hasImage = resultParts.some(p => p.type === 'image');
    if (!hasImage) {
      throw new Error('No inline image returned from Gemini');
    }

    return resultParts;
  };

  const primaryModel = options?.useProModel ? MODEL_IMAGE_SMART : MODEL_IMAGE_FAST;

  try {
    try {
      console.log(`[api/gemini-image] Attempting generation with primary model: ${primaryModel}`);
      return await attemptModel(primaryModel);
    } catch (primaryError) {
      console.warn(`[api/gemini-image] Primary model ${primaryModel} failed, falling back to Flash Image.`, primaryError);
      if (primaryModel !== MODEL_IMAGE_FAST) {
        console.log(`[api/gemini-image] Attempting fallback to: ${MODEL_IMAGE_FAST}`);
        return await attemptModel(MODEL_IMAGE_FAST);
      }
      throw primaryError;
    }
  } catch (error) {
    console.warn('[api/gemini-image] Gemini generation failed, falling back to Pexels.', error);
    const pexelsDataUrl = await getPexelsImage(prompt);
    // Return in the same format for consistency
    return [{
      type: 'image',
      dataUrl: pexelsDataUrl,
      mimeType: 'image/jpeg',
      thought: false,
    }];
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    try {
      const body = (await request.json()) as RequestBody;
      const prompt = body.prompt?.trim();
      if (!prompt) {
        return new Response(JSON.stringify({ error: 'Prompt is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parts = await generateImage(prompt, body.references || [], {
        useProModel: body.useProModel,
        aspectRatio: body.aspectRatio,
        imageSize: body.imageSize,
        mode: body.mode,
      });

      return new Response(JSON.stringify({ parts }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: any) {
      console.error('[api/gemini-image] Error handling request:', error);
      return new Response(JSON.stringify({ error: error.message || 'Failed to generate image' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
