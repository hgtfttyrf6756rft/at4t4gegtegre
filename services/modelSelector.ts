import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from './firebase.js';

export interface ModelConfig {
  primary: string;
  secondary: string;
  image: string;
}

const FREE_MODELS: ModelConfig = {
  primary: 'gemini-2.5-pro',
  secondary: 'gemini-2.5-flash',
  image: 'gemini-3.1-flash-image-preview',
};

const PRO_MODELS: ModelConfig = {
  primary: 'gemini-3.1-pro-preview',
  secondary: 'gemini-2.5-flash',
  image: 'gemini-3.1-flash-image-preview',
};

let cachedSubscriptionStatus: boolean | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60000;

export async function isUserSubscribed(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  const now = Date.now();
  if (cachedSubscriptionStatus !== null && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedSubscriptionStatus;
  }

  try {
    const userRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userRef);

    if (userDoc.exists()) {
      cachedSubscriptionStatus = userDoc.data()?.subscribed || false;
      cacheTimestamp = now;
      return cachedSubscriptionStatus;
    }

    cachedSubscriptionStatus = false;
    cacheTimestamp = now;
    return false;
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return cachedSubscriptionStatus ?? false;
  }
}

export function clearSubscriptionCache(): void {
  cachedSubscriptionStatus = null;
  cacheTimestamp = 0;
}

export async function getModelConfig(): Promise<ModelConfig> {
  const isSubscribed = await isUserSubscribed();
  return isSubscribed ? PRO_MODELS : FREE_MODELS;
}

export async function getPrimaryModel(): Promise<string> {
  const config = await getModelConfig();
  return config.primary;
}

export async function getSecondaryModel(): Promise<string> {
  const config = await getModelConfig();
  return config.secondary;
}

export async function getImageModel(): Promise<string> {
  const config = await getModelConfig();
  return config.image;
}

export function isRateLimitError(error: any): boolean {
  if (!error) return false;

  const errorMessage = error.message?.toLowerCase() || '';
  const errorString = String(error).toLowerCase();

  return (
    error.status === 429 ||
    errorMessage.includes('429') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('quota exceeded') ||
    errorMessage.includes('resource exhausted') ||
    errorMessage.includes('resourceexhausted') ||
    errorString.includes('429') ||
    errorString.includes('rate limit') ||
    errorString.includes('quota')
  );
}

/**
 * Check if an error is retryable (should try fallback model)
 */
export function isRetryableError(error: any): boolean {
  if (!error) return false;
  if (isRateLimitError(error)) return true;

  const errorMessage = error.message?.toLowerCase() || '';
  const errorString = String(error).toLowerCase();
  const status = error.status || error.code;

  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    errorMessage.includes('internal') ||
    errorMessage.includes('unavailable') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('overloaded') ||
    errorString.includes('econnreset') ||
    errorString.includes('socket hang up')
  );
}

/**
 * Model fallback chains ordered from premium to cheapest.
 * User specified: no gemini-2.5-pro in the chain.
 */
export const MODEL_FALLBACK_CHAINS = {
  // Premium chain starting from Gemini 3 Pro
  premium: [
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ],
  // Fast chain starting from Gemini 3 Flash
  fast: [
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ],
  // Standard chain starting from Gemini 2.5 Flash
  standard: [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ],
  // Lite chain for lightweight tasks
  lite: [
    'gemini-3.1-flash-lite-preview',
    'gemini-2.0-flash-lite',
  ],
} as const;

export type FallbackChainType = keyof typeof MODEL_FALLBACK_CHAINS;

/**
 * Get the fallback chain for a given starting model.
 * Returns an array of models to try in order.
 */
export function getFallbackChain(startingModel: string): string[] {
  // Map starting model to appropriate chain
  if (startingModel.includes('gemini-3-pro')) {
    return [...MODEL_FALLBACK_CHAINS.premium];
  }
  if (startingModel.includes('gemini-3-flash')) {
    return [...MODEL_FALLBACK_CHAINS.fast];
  }
  if (startingModel.includes('gemini-3.1-flash-lite-preview') || startingModel.includes('gemini-2.5-flash-lite') || startingModel.includes('gemini-2.0-flash-lite')) {
    return [...MODEL_FALLBACK_CHAINS.lite];
  }
  if (startingModel.includes('gemini-2.5-flash') || startingModel.includes('gemini-2.0-flash')) {
    return [...MODEL_FALLBACK_CHAINS.standard];
  }
  // Default: just return the model itself
  return [startingModel];
}
