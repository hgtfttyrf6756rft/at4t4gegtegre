import { isRateLimitError } from './modelSelector.js';

export interface ResearchError {
  type: 'rate_limit' | 'api_error' | 'unknown';
  message: string;
  shouldPromptUpgrade: boolean;
  originalError: any;
}

export function categorizeError(error: any, isSubscribed: boolean): ResearchError {
  if (isRateLimitError(error)) {
    return {
      type: 'rate_limit',
      message: isSubscribed 
        ? 'The AI service is temporarily overloaded. Please try again in a moment.'
        : 'You\'ve reached the usage limit for free accounts. Upgrade to Pro for unlimited access to premium AI models.',
      shouldPromptUpgrade: !isSubscribed,
      originalError: error,
    };
  }

  const errorMessage = error?.message || String(error);
  
  if (errorMessage.includes('API') || errorMessage.includes('key') || errorMessage.includes('unauthorized')) {
    return {
      type: 'api_error',
      message: 'There was an issue with the AI service. Please try again.',
      shouldPromptUpgrade: false,
      originalError: error,
    };
  }

  return {
    type: 'unknown',
    message: 'An unexpected error occurred. Please try again.',
    shouldPromptUpgrade: false,
    originalError: error,
  };
}

export function getErrorDisplayMessage(error: ResearchError): string {
  return error.message;
}

export function shouldShowUpgradePrompt(error: ResearchError): boolean {
  return error.shouldPromptUpgrade;
}
