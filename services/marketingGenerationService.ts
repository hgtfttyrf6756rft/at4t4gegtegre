import { ContentPiece, BrandContext } from '../types';
import { generateImage, generateSocialPostImage, getPexelsImage } from './geminiService';
import { mediaService } from './mediaService';

// Helper to wait briefly
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to convert data URL to Blob
const dataUrlToBlob = (dataUrl: string): Blob => {
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

export interface ProgressCallback {
  (pieceId: string, updates: Partial<ContentPiece>): void;
}

export const generateMarketingAssets = async (
  pieces: ContentPiece[],
  brandContext: BrandContext | undefined,
  onProgress: ProgressCallback
): Promise<ContentPiece[]> => {
  // Execute all piece generation simultaneously
  const results = await Promise.allSettled(
    pieces.map(piece => generatePieceWithFallback(piece, brandContext, onProgress))
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(`Uncaught error generating piece ${pieces[i].id}:`, result.reason);
      return {
        ...pieces[i],
        status: 'error',
        errorMessage: result.reason.message || 'Unknown generation error',
        isGenerating: false,
      };
    }
  });
};

export const generatePieceWithFallback = async (
  piece: ContentPiece,
  brandContext: BrandContext | undefined,
  onProgress: ProgressCallback,
  maxRetries = 2
): Promise<ContentPiece> => {
  let attempt = 0;
  let lastError: Error | null = null;
  
  onProgress(piece.id, { isGenerating: true, status: 'generating', errorMessage: undefined });

  // 1) If it's a text-only piece, mark as ready immediately
  if (piece.type === 'text') {
    onProgress(piece.id, { isGenerating: false, status: 'ready' });
    return { ...piece, status: 'ready', isGenerating: false };
  }

  // Define delays for exponential backoff
  const delays = [1000, 2000, 4000];

  while (attempt <= maxRetries) {
    try {
      onProgress(piece.id, { generationAttempts: attempt + 1 });
      
      const themeColors = brandContext?.colors?.length ? brandContext.colors.join(', ') : '';
      const style = brandContext?.visualStyle || brandContext?.tone || 'modern, professional';

      // ─ Attempt 1: Full context generateImage
      let assetUrl: string;
      if (attempt === 0) {
        const prompt = piece.prompt || piece.caption;
        const fullPrompt = `${prompt}. Visual style: ${style}. ${themeColors ? `Brand colors: ${themeColors}.` : ''} Optimized for ${piece.platform} ${piece.type}. High quality, no text in image.`;
        
        const { imageDataUrl } = await generateImage(fullPrompt, { aspectRatio: getAspectRatio(piece.type, piece.platform) });
        assetUrl = await mediaService.uploadToBlob(dataUrlToBlob(imageDataUrl));
      } 
      // ─ Attempt 2: Simplified context generateSocialPostImage
      else if (attempt === 1) {
        const prompt = piece.prompt || piece.caption || `High quality ${piece.platform} post visual.`;
        const { imageDataUrl } = await generateSocialPostImage(prompt, { aspectRatio: getAspectRatio(piece.type, piece.platform) });
        assetUrl = await mediaService.uploadToBlob(dataUrlToBlob(imageDataUrl));
      } 
      // ─ Attempt 3: Stock image fallback via Pexels
      else {
        const query = piece.prompt || 'business background';
        assetUrl = await getPexelsImage(query);
      }

      onProgress(piece.id, { 
        status: 'ready', 
        isGenerating: false, 
        assetUrl, 
        errorMessage: undefined 
      });
      
      return {
        ...piece,
        status: 'ready',
        isGenerating: false,
        assetUrl,
      };

    } catch (err: any) {
      console.warn(`[MarketingGenerationService] Error generating piece ${piece.id} on attempt ${attempt}:`, err);
      lastError = err;
      attempt++;
      if (attempt <= maxRetries) {
        // Wait before next retry
        await delay(delays[attempt - 1] || 2000);
      }
    }
  }

  // All attempts failed
  onProgress(piece.id, { 
    status: 'error', 
    isGenerating: false, 
    errorMessage: lastError?.message || 'Failed to generate asset after all retries.'
  });

  return {
    ...piece,
    status: 'error',
    isGenerating: false,
    errorMessage: lastError?.message || 'Failed to generate asset after all retries.'
  };
};

function getAspectRatio(type: string, platform: string) {
  if (type === 'story' || type === 'reel' || platform.toLowerCase() === 'tiktok') {
    return '9:16';
  }
  if (platform.toLowerCase() === 'youtube') {
    return '16:9';
  }
  return '1:1'; // Default for IG/FB posts
}
