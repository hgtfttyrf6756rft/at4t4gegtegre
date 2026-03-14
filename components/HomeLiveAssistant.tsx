import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, LiveServerMessage, Modality, StartSensitivity, EndSensitivity, createPartFromUri, Type } from '@google/genai';
import { ResearchProject, UploadedFile, UserProfile, ProjectActivity, MarketingSession, MarketingPhase, MarketingBrief, ContentPiece, PhoneAgentConfig, HomeAssistantFile } from '../types';
import { MarketingAgentPanel } from './MarketingAgentPanel';
import { storageService } from '../services/storageService';
import { contextService, ChatMessage as ContextChatMessage } from '../services/contextService';
import { createPcmBlob, decode, decodeAudioData } from '../services/audioUtils';
import { getFileSearchStoreName, uploadFileToGemini, isUserSubscribed, ComputerUseSession, performComputerUseTask, confirmComputerUseAction, cancelComputerUseSession, sendComputerUseCommand, generateImage, editImageWithReferences, generateVeoVideo, generatePodcastScript, generatePodcastAudio, ImageReference } from '../services/geminiService';
import { generateMagicProjectPlan, generateDraftResearchTopicsAlt, generateSeoSeedKeywords } from '../services/geminiService';
import { classifyProjectAgent } from '../services/agentClassifyService';
import { getFallbackChain, isRetryableError, MODEL_FALLBACK_CHAINS } from '../services/modelSelector';
import { createVideoFromImageUrl, pollVideoUntilComplete, downloadVideoBlob } from '../services/soraService';
import { authFetch } from '../services/authFetch';
import { auth } from '../services/firebase';
import ComputerUseViewer from './ComputerUseViewer';
import { AnimatedEyeIcon } from './AnimatedEyeIcon';
import { createVideoFromText, createVideoFromImage, SoraModel } from '../services/soraService';
import { createVideoOverview } from '../services/creatomateService';
import { mediaService } from '../services/mediaService';
import { generateMarketingAssets, generatePieceWithFallback } from '../services/marketingGenerationService';
import { deductCredits, hasEnoughCredits, getUserCredits, CREDIT_COSTS, CreditOperation } from '../services/creditService';
import { checkUsageLimit, incrementUsage, UsageType } from '../services/usageService';
import { InsufficientCreditsModal } from './InsufficientCreditsModal';
import { UsageLimitModal } from './UsageLimitModal';
import { ThoughtProcess } from './ThoughtProcess';
import { worldLabsService, WorldGenerationRequest } from '../services/worldLabsService';
import { useActivityLog } from '../hooks/useActivityLog';
import { subscribeToActivity, saveHomeAssistantFile, getHomeAssistantFiles } from '../services/firebase';


interface ExtendedChatMessage extends ContextChatMessage {
  isGenerating?: boolean;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  computerUseSession?: ComputerUseSession;
  computerUseGoal?: string;
  computerUseExistingSessionId?: string;
}

interface HomeLiveAssistantProps {
  projects: ResearchProject[];
  scheduledPosts?: Array<{
    id: string;
    scheduledAt: number;
    platforms: string[];
    textContent: string;
    status: string;
    projectId?: string;
  }>;
  isDarkMode: boolean;
  onClose: () => void;
  isSubscribed?: boolean;
  onUpgrade?: () => void;
  social?: any;
  /** Pre-filled message injected as the first user turn when opened from the prompt container */
  initialMessage?: string;
  /** Pre-uploaded files attached to that first message */
  initialAttachments?: Array<{ file: File; uploaded: UploadedFile }>;
  // Social platform connection state
  facebookConnected?: boolean;
  facebookAccessToken?: string | null;
  facebookProfile?: any;
  fbPages?: any[];
  fbPageId?: string;
  igAccounts?: any[];
  selectedIgId?: string;
  xConnected?: boolean;
  xProfile?: any;
  tiktokConnected?: boolean;
  tiktokProfile?: any;
  youtubeConnected?: boolean;
  youtubeProfile?: any;
  linkedinConnected?: boolean;
  linkedinProfile?: any;
  // Social platform connect handlers
  handleFacebookConnect?: () => void;
  handleXConnect?: () => void;
  handleTiktokConnect?: () => void;
  handleYoutubeConnect?: () => void;
  handleLinkedinConnect?: () => void;
  loadInstagramAccounts?: () => void;
  loadFacebookPages?: () => Promise<void>;
  // Callback to request parent to refresh social connection state after OAuth
  onRequestSocialRefresh?: () => Promise<void>;
}

type AssistantMode = 'chat' | 'voice' | 'video';
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const buildSearchTokens = (value: string) =>
  (value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2);

const scoreByTokens = (text: string, tokens: string[]) => {
  if (!tokens.length) return 0;
  const haystack = (text || '').toLowerCase();
  let score = 0;
  tokens.forEach(token => {
    if (!token) return;
    if (haystack.includes(token)) {
      score += token.length >= 6 ? 2 : 1;
    }
  });
  return score;
};

const uploadToBlob = async (blob: Blob, filename: string): Promise<string> => {
  try {
    const { upload } = await import('@vercel/blob/client');
    const newBlob = await upload(filename, blob, {
      access: 'public',
      handleUploadUrl: '/api/media?op=upload-token',
    });
    return newBlob.url;
  } catch (error) {
    console.error('Blob upload failed:', error);
    throw error;
  }
};

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

const ensureImageRef = async (input: string): Promise<ImageReference> => {
  if (input.startsWith('data:')) {
    const arr = input.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    return { base64: arr[1], mimeType: mime };
  } else if (input.includes('generativelanguage.googleapis.com/v1beta/files/') || input.startsWith('gs://')) {
    // It's a Gemini-hosted file, return as fileUri to avoid 403 CORS/Auth issues on direct fetch
    return { fileUri: input, mimeType: 'image/png' };
  } else {
    // It's a URL (e.g. Vercel Blob), fetch it and convert to base64
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Failed to fetch image from URL: ${input}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve({ base64, mimeType: blob.type || 'image/png' });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
};

const analyzeFileWithGemini = async (fileName: string, task: string, projectId?: string): Promise<string> => {
  try {
    const res = await authFetch('/api/gemini/analyze-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, task, projectId })
    });
    if (!res.ok) throw new Error('File analysis failed');
    const data = await res.json();
    return data.analysis || 'No analysis returned.';
  } catch (error) {
    console.error('Error analyzing file:', error);
    throw error;
  }
};

const shouldUseComputerUse = (message: string): { needed: boolean; goal?: string } => {
  const lower = message.toLowerCase();
  const triggers = ['open browser', 'search on google', 'go to website', 'browse', 'automation', 'use computer', 'click on'];
  const needed = triggers.some(t => lower.includes(t));
  return { needed, goal: needed ? message : undefined };
};

export const HomeLiveAssistant: React.FC<HomeLiveAssistantProps> = ({
  projects,
  scheduledPosts = [],
  isDarkMode,
  onClose,
  isSubscribed,
  onUpgrade,
  social,
  initialMessage,
  initialAttachments,
  // Social platform props
  facebookConnected = false,
  facebookAccessToken,
  facebookProfile,
  fbPages = [],
  fbPageId,
  igAccounts = [],
  selectedIgId,
  xConnected = false,
  xProfile,
  tiktokConnected = false,
  tiktokProfile,
  youtubeConnected = false,
  youtubeProfile,
  linkedinConnected = false,
  linkedinProfile,
  handleFacebookConnect,
  handleXConnect,
  handleTiktokConnect,
  handleYoutubeConnect,
  handleLinkedinConnect,
  loadInstagramAccounts,
  loadFacebookPages,
  onRequestSocialRefresh,
}) => {
  const [mode, setMode] = useState<AssistantMode>('chat');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<ExtendedChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('chat_history_home');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.error('Failed to load home chat history:', e);
    }
    return [];
  });
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptBuffer, setTranscriptBuffer] = useState('');
  const [userTranscriptBuffer, setUserTranscriptBuffer] = useState('');
  const [isVideoLoading, setIsVideoLoading] = useState(false);

  const [pendingAttachments, setPendingAttachments] = useState<
    Array<{ id: string; file: File; status: 'uploading' | 'ready' | 'error'; uploaded?: UploadedFile; error?: string; previewUrl?: string }>
  >([]);
  const attachmentsInputRef = useRef<HTMLInputElement | null>(null);
  const [localIsSubscribed, setLocalIsSubscribed] = useState(false);
  const [activeComputerUseMessageId, setActiveComputerUseMessageId] = useState<string | null>(null);
  const [activeComputerUseSessionId, setActiveComputerUseSessionId] = useState<string | null>(null);
  const [lastComputerUseSessionId, setLastComputerUseSessionId] = useState<string | null>(null);
  const [lastGeneratedAsset, setLastGeneratedAsset] = useState<{ type: 'image' | 'video'; url: string; publicUrl?: string; name?: string; timestamp: number } | null>(null);
  const [insufficientCreditsModal, setInsufficientCreditsModal] = useState<{
    isOpen: boolean;
    operation: CreditOperation;
    cost: number;
    current: number;
  } | null>(null);
  const [usageLimitModal, setUsageLimitModal] = useState<{
    isOpen: boolean;
    usageType: UsageType;
    current: number;
    limit: number;
  } | null>(null);
  const [thinkingProcess, setThinkingProcess] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [plannerIntent, setPlannerIntent] = useState<string | null>(null);
  const [homeAssistantFiles, setHomeAssistantFiles] = useState<HomeAssistantFile[]>([]);

  // ─── Marketing Agent State ──────────────────────────────────────────────────
  const [marketingSession, setMarketingSession] = useState<MarketingSession | null>(() => {
    try {
      const saved = localStorage.getItem('marketing_session_home');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return null;
  });
  const [isMarketingMode, setIsMarketingMode] = useState(false);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // ─── Social Auto-Publish Polling & Queuing ───────────────────────────────────
  type SocialPlatform = 'facebook' | 'instagram' | 'x' | 'tiktok' | 'youtube' | 'linkedin';
  const [pendingAuthPlatforms, setPendingAuthPlatforms] = useState<SocialPlatform[]>([]);
  
  // Queue state for Voice Mode sequential auth flow
  const voiceAuthQueueRef = useRef<{
    originalArgs: any;
    remainingPlatforms: SocialPlatform[];
    currentTarget: SocialPlatform | null;
  } | null>(null);

  // Ref to track social connection state for Live API callbacks (avoids stale closures)
  const socialStateRef = useRef({
    facebookConnected,
    igAccounts,
    xConnected,
    tiktokConnected,
    youtubeConnected,
    linkedinConnected
  });

  useEffect(() => {
    socialStateRef.current = {
      facebookConnected,
      igAccounts,
      xConnected,
      tiktokConnected,
      youtubeConnected,
      linkedinConnected
    };
  }, [facebookConnected, igAccounts, xConnected, tiktokConnected, youtubeConnected, linkedinConnected]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Handler for storage events (from OAuth popups or other tabs)
    const handleStorageChange = (event: StorageEvent) => {
      if (!event.key) return;
      const tokenKeys = ['fb_access_token', 'x_access_token', 'tiktok_access_token', 'youtube_access_token', 'linkedin_access_token'];
      if (tokenKeys.includes(event.key) && event.newValue) {
        onRequestSocialRefresh?.();
      }
    };

    // Periodic polling for same-tab localStorage changes (OAuth popup writes here)
    const pollInterval = setInterval(() => {
      const fbToken = localStorage.getItem('fb_access_token');
      const xToken = localStorage.getItem('x_access_token');
      const tikToken = localStorage.getItem('tiktok_access_token');
      const ytToken = localStorage.getItem('youtube_access_token');
      const liToken = localStorage.getItem('linkedin_access_token');

      let needsRefresh = false;

      if (fbToken && !socialStateRef.current.facebookConnected) {
        socialStateRef.current.facebookConnected = true;
        needsRefresh = true;
      }
      if (xToken && !socialStateRef.current.xConnected) {
        socialStateRef.current.xConnected = true;
        needsRefresh = true;
      }
      if (tikToken && !socialStateRef.current.tiktokConnected) {
        socialStateRef.current.tiktokConnected = true;
        needsRefresh = true;
      }
      if (ytToken && !socialStateRef.current.youtubeConnected) {
        socialStateRef.current.youtubeConnected = true;
        needsRefresh = true;
      }
      if (liToken && !socialStateRef.current.linkedinConnected) {
        socialStateRef.current.linkedinConnected = true;
        needsRefresh = true;
      }

      if (needsRefresh) {
        onRequestSocialRefresh?.();
      }
    }, 2000);

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(pollInterval);
    };
  }, [onRequestSocialRefresh]);

  const checkPlatformAuthToken = useCallback((platform: SocialPlatform): boolean => {
    if (typeof window === 'undefined') return false;
    switch (platform) {
      case 'facebook':
      case 'instagram':
        return !!localStorage.getItem('fb_access_token');
      case 'x':
        return !!localStorage.getItem('x_access_token');
      case 'tiktok':
        return !!localStorage.getItem('tiktok_access_token');
      case 'youtube':
        return !!localStorage.getItem('youtube_access_token');
      case 'linkedin':
        return !!localStorage.getItem('linkedin_access_token');
      default:
        return false;
    }
  }, []);

  const pollForAuthCompletion = useCallback(async (platform: SocialPlatform, maxWaitMs = 60000): Promise<boolean> => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, 500));
      if (checkPlatformAuthToken(platform)) return true;
    }
    return false;
  }, [checkPlatformAuthToken]);

  const handleConnectWithRefresh = useCallback(async (platform: SocialPlatform) => {
    switch (platform) {
      case 'facebook':
      case 'instagram':
        handleFacebookConnect?.();
        break;
      case 'x':
        handleXConnect?.();
        break;
      case 'tiktok':
        handleTiktokConnect?.();
        break;
      case 'youtube':
        handleYoutubeConnect?.();
        break;
      case 'linkedin':
        handleLinkedinConnect?.();
        break;
    }

    const connected = await pollForAuthCompletion(platform);

    if (connected) {
      switch (platform) {
        case 'facebook': socialStateRef.current.facebookConnected = true; break;
        case 'x': socialStateRef.current.xConnected = true; break;
        case 'tiktok': socialStateRef.current.tiktokConnected = true; break;
        case 'youtube': socialStateRef.current.youtubeConnected = true; break;
        case 'linkedin': socialStateRef.current.linkedinConnected = true; break;
      }

      if (onRequestSocialRefresh) {
        try {
          await onRequestSocialRefresh();
        } catch (e) {
          console.error(e);
        }
      }

      if (platform === 'facebook' && loadInstagramAccounts) loadInstagramAccounts();
      if (platform === 'facebook' && loadFacebookPages) loadFacebookPages();

      return true;
    }
    return false;
  }, [handleFacebookConnect, handleXConnect, handleTiktokConnect, handleYoutubeConnect, handleLinkedinConnect, pollForAuthCompletion, onRequestSocialRefresh, loadInstagramAccounts, loadFacebookPages]);

  const isPlatformConnected = useCallback((platform: SocialPlatform): boolean => {
    switch (platform) {
      case 'facebook': return facebookConnected;
      case 'instagram': return facebookConnected && igAccounts.length > 0;
      case 'x': return xConnected;
      case 'tiktok': return tiktokConnected;
      case 'youtube': return youtubeConnected;
      case 'linkedin': return linkedinConnected;
      default: return false;
    }
  }, [facebookConnected, igAccounts.length, xConnected, tiktokConnected, youtubeConnected, linkedinConnected]);

  const getConnectHandler = useCallback((platform: SocialPlatform): (() => void) | undefined => {
    switch (platform) {
      case 'facebook': return handleFacebookConnect;
      case 'instagram': return facebookConnected ? loadInstagramAccounts : handleFacebookConnect;
      case 'x': return handleXConnect;
      case 'tiktok': return handleTiktokConnect;
      case 'youtube': return handleYoutubeConnect;
      case 'linkedin': return handleLinkedinConnect;
      default: return undefined;
    }
  }, [handleFacebookConnect, handleXConnect, handleTiktokConnect, handleYoutubeConnect, handleLinkedinConnect, loadInstagramAccounts, facebookConnected]);


  // Activities aggregated across all user projects (for account-wide context)
  const [activitiesByProjectId, setActivitiesByProjectId] = useState<Record<string, ProjectActivity[]>>({});

  useEffect(() => {
    const ownerUid = auth.currentUser?.uid;
    if (!ownerUid || !projects.length) return;

    const unsubscribers: (() => void)[] = [];

    projects.forEach((project) => {
      const unsub = subscribeToActivity(
        ownerUid,
        project.id,
        (acts) => {
          setActivitiesByProjectId((prev) => ({
            ...prev,
            [project.id]: acts,
          }));
        },
        20 // limit per project
      );
      unsubscribers.push(unsub);
    });

    return () => unsubscribers.forEach((u) => u());
  }, [projects.map((p) => p.id).join(','), auth.currentUser?.uid]);

  useEffect(() => {
    storageService.getUserProfile().then(profile => {
      if (profile) setUserProfile(profile);
    });

    const uid = auth.currentUser?.uid;
    if (uid) {
      getHomeAssistantFiles(uid).then(files => {
        setHomeAssistantFiles(files);
        // Sync to conversation media context
        const mediaRecords: ConversationMedia[] = files
          .filter(f => f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/'))
          .map(f => ({
            id: f.id,
            url: f.uri || f.publicUrl || '',
            publicUrl: f.publicUrl,
            type: f.mimeType.startsWith('video/') ? 'video' : 'image',
            source: 'attached',
            name: f.name,
            addedAt: f.uploadedAt
          }));
        
        if (mediaRecords.length > 0) {
          setCurrentConversationMedia(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const newOnes = mediaRecords.filter(m => !existingIds.has(m.id));
            return [...newOnes, ...prev].slice(0, 40);
          });
        }
      });
    }
  }, [auth.currentUser?.uid]);

  const checkCredits = async (operation: CreditOperation): Promise<boolean> => {
    const hasCredits = await hasEnoughCredits(operation);
    if (!hasCredits) {
      const current = await getUserCredits();
      setInsufficientCreditsModal({
        isOpen: true,
        operation,
        cost: CREDIT_COSTS[operation],
        current
      });
      return false;
    }
    return true;
  };

  // Tracking media introduced in current conversation session
  interface ConversationMedia {
    id: string;
    url: string;
    publicUrl?: string;
    type: 'image' | 'video';
    source: 'dropped' | 'attached' | 'generated';
    name: string;
    addedAt: number;
  }
  const [currentConversationMedia, setCurrentConversationMedia] = useState<ConversationMedia[]>([]);

  const trackConversationMedia = useCallback((media: Omit<ConversationMedia, 'addedAt'>) => {
    setCurrentConversationMedia(prev => [
      { ...media, addedAt: Date.now() },
      ...prev
    ].slice(0, 20));
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<any>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  useEffect(() => {
    isUserSubscribed().then(setLocalIsSubscribed).catch(() => setLocalIsSubscribed(false));
  }, []);

  // Auto-send the initial message injected from the prompt container (fires once on mount)
  const initialMessageFiredRef = useRef(false);
  useEffect(() => {
    if (!initialMessage || initialMessageFiredRef.current) return;
    initialMessageFiredRef.current = true;
    // Pre-load the attachments into pending state, then send
    if (initialAttachments && initialAttachments.length > 0) {
      const entries = initialAttachments.map(a => ({
        id: crypto.randomUUID(),
        file: a.file,
        status: 'ready' as const,
        uploaded: a.uploaded,
        previewUrl: a.file.type?.startsWith('image/') ? URL.createObjectURL(a.file) : undefined,
      }));
      setPendingAttachments(entries);
      // Give state a tick to settle before sending
      setTimeout(() => handleSendMessage(initialMessage, entries), 50);
    } else {
      setTimeout(() => handleSendMessage(initialMessage), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save chat history to localStorage (debounced)
  useEffect(() => {
    const sanitized = messages.map(m => ({
      ...m,
      isGenerating: false,
    }));
    const timeoutId = setTimeout(() => {
      localStorage.setItem('chat_history_home', JSON.stringify(sanitized));
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [messages]);

  const postToSocialPlatform = async (platform: string, contentType: 'text' | 'image' | 'video', text: string, mediaUrl?: string) => {
    const errorPrefix = `Failed to post to ${platform}:`;

    try {
      if (platform === 'facebook') {
        const u = auth.currentUser;
        if (!u) throw new Error('Not logged in');
        const token = social?.facebookAccessTokenRef?.current;
        if (!token) throw new Error('Facebook not connected');

        let op = 'fb-publish-post';
        const body: any = { fbUserAccessToken: token };

        if (contentType === 'text') {
          body.message = text;
        } else if (contentType === 'image') {
          op = 'fb-publish-photo';
          body.url = mediaUrl;
          body.caption = text;
        } else if (contentType === 'video') {
          op = 'fb-publish-video';
          body.file_url = mediaUrl;
          body.description = text;
        }

        const res = await authFetch(`/api/social?op=${op}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Facebook API error');
        return true;

      } else if (platform === 'instagram') {
        const token = social?.facebookAccessTokenRef?.current;
        const igId = social?.selectedIgId;
        if (!token || !igId) throw new Error('Instagram not fully connected');

        const res = await authFetch('/api/social?op=ig-publish-robust', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fbUserAccessToken: token,
            igId,
            mediaType: contentType === 'video' ? 'VIDEO' : 'IMAGE',
            mediaUrls: [mediaUrl],
            caption: text,
            shareToFeed: true
          }),
        });
        if (!res.ok) throw new Error('Instagram API error');
        return true;

      } else if (platform === 'x') {
        const res = await authFetch('/api/social?op=x-post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            mediaUrl: mediaUrl || undefined,
            mediaType: contentType === 'video' ? 'video/mp4' : (contentType === 'image' ? 'image/jpeg' : undefined)
          }),
        });
        if (!res.ok) throw new Error('X API error');
        return true;

      } else if (platform === 'linkedin') {
        let postType = 'TEXT';
        if (contentType === 'image') postType = 'IMAGE';
        if (contentType === 'video') postType = 'VIDEO';

        const body: any = { text, visibility: 'PUBLIC' };

        if (postType !== 'TEXT') {
          body.mediaType = postType;
          if (!mediaUrl) throw new Error('Media URL required for image/video');
          // For LinkedIn media from voice assistant, we use a specialized endpoint or approach 
          // Here we use a simplified mock assumption since LinkedIn media upload requires multi-step in our backend
          body.mediaUrl = mediaUrl;
        }

        const res = await authFetch('/api/social?op=linkedin-post-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('LinkedIn API error');
        return true;
      } else if (platform === 'tiktok') {
        if (contentType !== 'video') throw new Error('TikTok requires video content');
        if (!mediaUrl) throw new Error('Media URL required for TikTok');

        const res = await authFetch('/api/social?op=tiktok-publish-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoUrl: mediaUrl,
            title: text || '',
            privacyLevel: 'SELF_ONLY'
          }),
        });
        if (!res.ok) throw new Error('TikTok API error');
        return true;

      } else if (platform === 'youtube') {
        if (contentType !== 'video') throw new Error('YouTube requires video content');
        if (!mediaUrl) throw new Error('Media URL required for YouTube');

        const res = await authFetch('/api/social?op=youtube-upload-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoUrl: mediaUrl,
            title: text || 'Untitled',
            description: text || '',
            privacyStatus: 'private'
          }),
        });
        if (!res.ok) throw new Error('YouTube API error');
        return true;
      }

      throw new Error(`Platform ${platform} not supported for direct posting yet`);
    } catch (e: any) {
      console.error(errorPrefix, e);
      throw new Error(`${errorPrefix} ${e.message}`);
    }
  };

  // Effect to monitor sequential auth progress for Voice Mode
  useEffect(() => {
    const queue = voiceAuthQueueRef.current;
    if (!queue || !queue.currentTarget) return;

    if (isPlatformConnected(queue.currentTarget)) {
      const next = queue.remainingPlatforms.shift();

      if (next) {
        queue.currentTarget = next;
        voiceAuthQueueRef.current = { ...queue };
        setPendingAuthPlatforms([next]);
      } else {
        queue.currentTarget = null;
        const args = queue.originalArgs;
        voiceAuthQueueRef.current = null;
        setPendingAuthPlatforms([]); 

        executeSchedulePost(
          args,
          (role, text) => {
            setMessages(prev => [...prev, {
              id: crypto.randomUUID(),
              role,
              text,
              timestamp: Date.now()
            }]);
          },
          (id) => {
            setMessages(prev => [...prev, {
              id: crypto.randomUUID(),
              role: 'model',
              text: `✅ All platforms connected! Post scheduled successfully.`,
              timestamp: Date.now()
            }]);
          }
        ).catch(e => {
          console.error("Auto-schedule failed after auth sequence", e);
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'model',
            text: `❌ Failed to schedule post after connecting platforms: ${e.message}`,
            timestamp: Date.now()
          }]);
        });
      }
    }
  }, [facebookConnected, igAccounts, xConnected, tiktokConnected, youtubeConnected, linkedinConnected, isPlatformConnected]);

  // Helper for natural language date parsing (Robust - matched with ProjectLiveAssistant)
  const parseScheduleDate = (input: string): number | null => {
    if (!input) return null;
    const now = new Date();
    const lc = input.toLowerCase().trim();

    try {
      // 1. Handle "in X [time units]" (Offset)
      const offsetMatch = lc.match(/^in\s+(\d+)\s+(minute|min|hour|hr|day)s?$/);
      if (offsetMatch) {
        const amount = parseInt(offsetMatch[1]);
        const unit = offsetMatch[2];
        const d = new Date(now);
        if (unit.startsWith('min')) d.setMinutes(d.getMinutes() + amount);
        if (unit.startsWith('hour')) d.setHours(d.getHours() + amount);
        if (unit.startsWith('day')) d.setDate(d.getDate() + amount);
        return d.getTime();
      }

      // 2. Extract Date Logic
      let targetDate = new Date(now);
      let foundDate = false;

      // Handle specific date keywords
      if (lc.includes('tomorrow')) {
        targetDate.setDate(targetDate.getDate() + 1);
        foundDate = true;
      } else if (lc.includes('today')) {
        foundDate = true;
      } else {
        // Handle "next [weekday]" or "on [weekday]"
        const weekDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayMatch = lc.match(/(?:next|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
        if (dayMatch) {
          const desiredDayStr = dayMatch[1];
          const isNext = lc.includes('next');
          const currentDay = targetDate.getDay();
          const desiredDay = weekDays.indexOf(desiredDayStr);

          let daysToAdd = (desiredDay - currentDay + 7) % 7;
          if (daysToAdd === 0 && isNext) daysToAdd = 7;
          else if (isNext) daysToAdd += 7;

          if (daysToAdd === 0 && !foundDate) daysToAdd = 0; // "today" logic

          targetDate.setDate(targetDate.getDate() + daysToAdd);
          foundDate = true;
        }
      }

      // 3. Extract Time Logic
      const timeMatch = lc.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
      let foundTime = false;

      if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2] || '0');
        const meridian = timeMatch[3] ? timeMatch[3].replace(/\./g, '') : null;

        if (meridian === 'pm' && hours < 12) hours += 12;
        if (meridian === 'am' && hours === 12) hours = 0;

        if (!meridian && hours < 12) {
          if (lc.includes('tonight') || lc.includes('evening') || lc.includes('afternoon')) {
            if (hours < 12) hours += 12;
          }
        }

        targetDate.setHours(hours, minutes, 0, 0);
        foundTime = true;
      }

      if (!foundTime) {
        if (lc.includes('tonight')) {
          targetDate.setHours(20, 0, 0, 0);
          foundTime = true;
          if (!foundDate && !lc.includes('tomorrow')) foundDate = true;
        } else if (lc.includes('morning')) {
          targetDate.setHours(9, 0, 0, 0);
          foundTime = true;
        } else if (lc.includes('evening')) {
          targetDate.setHours(18, 0, 0, 0);
          foundTime = true;
        }
      }

      if (foundDate || foundTime) {
        if (foundDate && !foundTime) {
          targetDate.setHours(10, 0, 0, 0);
        }
        if (!foundDate && foundTime && targetDate.getTime() < now.getTime()) {
          targetDate.setDate(targetDate.getDate() + 1);
        }
        return targetDate.getTime();
      }

      const parsed = Date.parse(input);
      if (!isNaN(parsed)) return parsed;

      return null;
    } catch (e) {
      console.error('[parseScheduleDate] Error parsing:', input, e);
      return null;
    }
  };

  /**
   * Analyze which media the user is referring to when they want to post/schedule.
   * Uses Gemini thinking to reason about conversation context and media references.
   */
  const analyzeMediaIntent = async (
    userMessage: string,
    conversationMedia: ConversationMedia[],
    recentMessages: { role: string; text: string; imageUrl?: string }[]
  ): Promise<{
    targetMediaUrl?: string;
    targetMediaType?: 'image' | 'video';
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
  }> => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      
      const mediaContext = conversationMedia.map((m, i) => ({
        index: i + 1,
        name: m.name,
        type: m.type,
        source: m.source,
        url: m.publicUrl || m.url,
        addedSecondsAgo: Math.round((Date.now() - m.addedAt) / 1000)
      }));

      const recentContext = recentMessages.slice(-5).map(m => ({
        role: m.role,
        text: m.text?.slice(0, 200),
        hasImage: !!m.imageUrl
      }));

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{
          role: 'user',
          parts: [{
            text: `You are analyzing which media the user wants to post to social media.

CONVERSATION MEDIA (most recent first):
${JSON.stringify(mediaContext, null, 2)}

RECENT MESSAGES:
${JSON.stringify(recentContext, null, 2)}

USER'S CURRENT REQUEST: "${userMessage}"

Which media is the user referring to? Consider:
1. Recency: did they just drop/attach something?
2. Explicit references: "the video", "my image", "the one I uploaded", "the first one"
3. Source references: "the image I dropped", "the attached file", "the generated video"
4. Name references: any part of a filename mentioned
5. Context: what was discussed before?

If the user says "this" or "that" with no other context, prefer the MOST RECENTLY added media.
If ambiguous, set confidence to "low".

Return JSON ONLY:
{
  "targetMediaUrl": "<url of the media or null if truly ambiguous>",
  "targetMediaType": "image" | "video",
  "confidence": "high" | "medium" | "low",
  "reasoning": "brief explanation of your choice"
}`
          }]
        }],
        config: {
          responseMimeType: 'application/json',
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: 1024
          },
          temperature: 0.3
        }
      });

      const text = response.text?.trim() || '{}';
      const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, ''));
      return {
        targetMediaUrl: parsed.targetMediaUrl || undefined,
        targetMediaType: parsed.targetMediaType || undefined,
        confidence: parsed.confidence || 'low',
        reasoning: parsed.reasoning || 'No reasoning provided'
      };
    } catch (error) {
      console.error('[analyzeMediaIntent] Error:', error);
      return { confidence: 'low', reasoning: 'Analysis failed' };
    }
  };

  const executeSchedulePost = useCallback(async (
    args: any,
    addMessage: (role: 'user' | 'model', text: string) => void,
    onSuccess: (postId: string) => void
  ) => {
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('Not logged in');

      const platformsRaw = args.platforms || args.platform;
      const platforms = (Array.isArray(platformsRaw) ? platformsRaw : [platformsRaw]).filter(Boolean);
      const scheduledAtInput = args.scheduledTime || args.scheduledAt;
      
      let finalDateUnix = 0;
      const parsedTime = parseScheduleDate(String(scheduledAtInput));
      if (parsedTime) {
        finalDateUnix = parsedTime;
      } else {
        const d = new Date(scheduledAtInput);
        if (!isNaN(d.getTime())) {
          finalDateUnix = d.getTime();
        } else {
          throw new Error('Invalid scheduled date format. Please specify a time like "tomorrow at 10am".');
        }
      }

      addMessage('model', `Scheduling post for ${new Date(finalDateUnix).toLocaleString()}...`);

      const res = await authFetch('/api/social?op=schedule-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: u.uid,
          platforms,
          textContent: args.text,
          mediaUrl: args.mediaUrl || null,
          mediaType: (args.contentType && args.contentType !== 'text') ? args.contentType : null,
          scheduledAt: finalDateUnix,
          status: 'pending'
        })
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to schedule post');
      }

      const data = await res.json();
      onSuccess(data.id || crypto.randomUUID());
      return true;
    } catch (e: any) {
      console.error('Schedule failed:', e);
      throw e;
    }
  }, []);

  // Persist marketing session to localStorage
  useEffect(() => {
    if (marketingSession) {
      localStorage.setItem('marketing_session_home', JSON.stringify(marketingSession));
    }
  }, [marketingSession]);

  /** Detect marketing intent in a user message */
  const detectMarketingIntent = useCallback((message: string): boolean => {
    const lower = message.toLowerCase();
    const triggers = [
      'marketing', 'campaign', 'post to', 'social media post', 'ad copy', 'promote',
      'schedule posts', 'publish', 'content calendar', 'reach audience', 'brand awareness',
      'grow my', 'advertise', 'hashtag', 'viral', 'engagement', 'marketing materials',
      'social campaign', 'marketing request', 'content strategy', 'target audience',
      'instagram post', 'tiktok post', 'linkedin post', 'facebook post', 'youtube video campaign',
    ];
    return triggers.some(t => lower.includes(t));
  }, []);

  /** Update a content piece inside the current marketing session by ID */
  const updateSessionContentPiece = useCallback((pieceId: string, updates: Partial<ContentPiece>) => {
    setMarketingSession(prev => {
      if (!prev?.campaignPlan) return prev;
      return {
        ...prev,
        updatedAt: Date.now(),
        campaignPlan: {
          ...prev.campaignPlan,
          contentPieces: prev.campaignPlan.contentPieces.map(p =>
            p.id === pieceId ? { ...p, ...updates } : p
          ),
        },
      };
    });
  }, []);

  const generateAllCampaignAssets = useCallback((pieces: ContentPiece[], brandCtx: any) => {
    setMarketingSession(prev => prev ? { ...prev, phase: 'generating', isGeneratingBatch: true } : prev);
    generateMarketingAssets(pieces, brandCtx, updateSessionContentPiece).then((finishedPieces) => {
      setMarketingSession(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          phase: 'publishing',
          isGeneratingBatch: false,
          campaignPlan: {
             ...prev.campaignPlan!,
             contentPieces: finishedPieces
          }
        };
      });
    });
  }, [updateSessionContentPiece]);

  const handleEditAsset = useCallback((assetId: string, instruction: string) => {
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

    updateSessionContentPiece(assetId, { isGenerating: true, errorMessage: undefined });
    setMarketingSession(prev => {
      if (!prev || !prev.campaignPlan) return prev;
      const target = prev.campaignPlan.contentPieces.find(p => p.id === assetId);
      if (!target || !target.assetUrl) return prev;
      
      // Fire and forget the edit
      editImageWithReferences(instruction, [{ url: target.assetUrl, mimeType: 'image/png' } as unknown as ImageReference])
        .then(res => mediaService.uploadToBlob(dataUrlToBlob(res.imageDataUrl)))
        .then(url => updateSessionContentPiece(assetId, { assetUrl: url, isGenerating: false }))
        .catch(e => {
          // Fallback to complete regeneration with new instruction if edit fails
          console.log('Edit failed, falling back to regenerate with instruction:', e);
          const overridePiece = { ...target, prompt: `${target.prompt || target.caption}. Instruction: ${instruction}` };
          generatePieceWithFallback(overridePiece, prev.brandContext, updateSessionContentPiece);
        });
        
      return prev;
    });
  }, [updateSessionContentPiece]);

  const handleRegenerateAsset = useCallback((pieceId: string) => {
    setMarketingSession(prev => {
      if (!prev || !prev.campaignPlan) return prev;
      const piece = prev.campaignPlan.contentPieces.find(p => p.id === pieceId);
      if (piece) generatePieceWithFallback(piece, prev.brandContext, updateSessionContentPiece);
      return prev;
    });
  }, [updateSessionContentPiece]);

  const handleRetryAsset = useCallback((pieceId: string) => {
    handleRegenerateAsset(pieceId);
  }, [handleRegenerateAsset]);

  const handleApproveAsset = useCallback((pieceId: string) => {
    updateSessionContentPiece(pieceId, { status: 'ready', errorMessage: undefined });
  }, [updateSessionContentPiece]);

  const handleEditCaption = useCallback((pieceId: string, newCaption: string) => {
    updateSessionContentPiece(pieceId, { caption: newCaption });
  }, [updateSessionContentPiece]);

  /**
   * Detect if the user's message requires browser automation.
   * Only triggers for Pro users on specific task patterns.
   */
  const shouldUseComputerUse = useCallback((message: string): { needed: boolean; goal?: string; url?: string } => {
    if (!isSubscribed) return { needed: false };

    const lower = message.toLowerCase();

    // Patterns that indicate browser automation is needed
    const browserPatterns = [
      // Shopping/pricing research
      /\b(find|search|look up|browse|compare)\b.*\b(price|pricing|cost|deal|discount|cheapest|best deal)/i,
      /\b(shop|shopping|buy|purchase)\b.*\b(on|at|from)\b.*\b(amazon|google|ebay|walmart|target)/i,
      // Real-time data
      /\b(check|get|find|look up)\b.*\b(live|current|real.?time|latest)\b.*\b(stock|weather|news|score)/i,
      // Form filling
      /\b(fill out|fill in|complete|submit)\b.*\b(form|application|registration)/i,
      // Web navigation with action
      /\b(go to|navigate to|open|visit)\b.*\.(com|org|net|io)\b.*\b(and|then)\b/i,
      // Explicit browser request
      /\b(use (the )?browser|open (the )?browser|browser automation|automate|scrape|screenshot)\b/i,
    ];

    for (const pattern of browserPatterns) {
      if (pattern.test(message)) {
        // Extract URL if present
        const urlMatch = message.match(/https?:\/\/[^\s]+|www\.[^\s]+|\b([a-z0-9-]+\.(com|org|net|io|co))\b/i);
        const url = urlMatch ? (urlMatch[0].startsWith('http') ? urlMatch[0] : `https://${urlMatch[0]}`) : undefined;

        return { needed: true, goal: message, url };
      }
    }

    return { needed: false };
  }, [isSubscribed]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const addMessage = useCallback(
    (role: 'user' | 'model', text: string): string => {
      const trimmedText = text.trim();
      if (!trimmedText) return '';

      let newId = crypto.randomUUID();

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === role && (last.text || '').trim() === trimmedText) {
          return prev;
        }

        const newMessage: ExtendedChatMessage = {
          id: newId,
          role,
          text: trimmedText,
          timestamp: Date.now(),
        };
        return [...prev, newMessage];
      });

      return newId;
    },
    []
  );

  const isUploadingAttachments = pendingAttachments.some(a => a.status === 'uploading');
  const readyAttachments = pendingAttachments.filter(a => a.status === 'ready' && a.uploaded);

  const clearAttachments = useCallback(() => {
    setPendingAttachments(prev => {
      for (const a of prev) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
      return [];
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments(prev => {
      const toRemove = prev.find(p => p.id === id);
      if (toRemove?.previewUrl) URL.revokeObjectURL(toRemove.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  }, []);

  const handlePickAttachments = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selected = Array.from(files);

    const newEntries = selected.map(file => ({
      id: crypto.randomUUID(),
      file,
      status: 'uploading' as const,
      previewUrl: (file.type?.startsWith('image/') || file.type?.startsWith('video/')) ? URL.createObjectURL(file) : undefined,
    }));

    setPendingAttachments(prev => [...prev, ...newEntries]);

    for (const entry of newEntries) {
      try {
        const uploaded = await uploadFileToGemini(entry.file, entry.file.name);
        setPendingAttachments(prev =>
          prev.map(p => (p.id === entry.id ? { ...p, status: 'ready', uploaded } : p))
        );

        // Auto-analyze and save to Firestore for persistence
        const uid = auth.currentUser?.uid;
        if (uid) {
          const type = entry.file.type || 'file';
          const task = `Briefly describe the contents of this ${type} file. If it's an image, describe the scene. If it's a video, describe the action. If it's a document (PDF, Word, etc.), summarize the main points. If it's data (CSV, Excel), describe the columns and data structure.`;
          
          const isMedia = type.startsWith('image/') || type.startsWith('video/');
          
          Promise.all([
            analyzeFileWithGemini(entry.file.name, task),
            isMedia ? uploadToBlob(entry.file, entry.file.name).catch(() => undefined) : Promise.resolve(undefined)
          ]).then(async ([analysis, publicUrl]) => {
            const fileRecord: HomeAssistantFile = {
              id: entry.id,
              uid,
              name: entry.file.name,
              mimeType: entry.file.type,
              uri: uploaded.uri,
              publicUrl: publicUrl,
              uploadedAt: Date.now(),
              size: entry.file.size,
              analysis: analysis
            };
            
            await saveHomeAssistantFile(uid, fileRecord);
            setHomeAssistantFiles(prev => [fileRecord, ...prev]);
            
            // Update the pending attachment with publicUrl if available
            if (publicUrl) {
              setPendingAttachments(prev =>
                prev.map(p => (p.id === entry.id ? { ...p, uploaded: { ...p.uploaded!, publicUrl } } : p))
              );
            }

            // If it's media, track it in conversationMedia too
            if (isMedia) {
              trackConversationMedia({
                id: fileRecord.id,
                url: fileRecord.uri || '',
                publicUrl: publicUrl,
                type: type.startsWith('video/') ? 'video' : 'image',
                source: 'attached',
                name: fileRecord.name
              });
            }
          }).catch(err => console.error('[HomeLiveAssistant] Processing failed:', err));
        }
      } catch (e: any) {
        setPendingAttachments(prev =>
          prev.map(p => (p.id === entry.id ? { ...p, status: 'error', error: String(e?.message || e) } : p))
        );
      }
    }
  };

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    return {
      mimeType: 'image/jpeg',
      data: dataUrl.split(',')[1]
    };
  }, []);

  const connectVoice = async (targetMode: AssistantMode = mode) => {
    setError(null);
    setConnectionStatus('connecting');

    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      const ai = new GoogleGenAI({ apiKey });

      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = outputCtx;
      inputContextRef.current = inputCtx;

      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);
      outputNodeRef.current = outputNode;

      const streamConstraints: MediaStreamConstraints = { audio: true };
      if (targetMode === 'video') {
        streamConstraints.video = { width: { ideal: 1280 }, height: { ideal: 720 } };
        setIsVideoLoading(true);
      }

      const stream = await navigator.mediaDevices.getUserMedia(streamConstraints);
      mediaStreamRef.current = stream;

      if (targetMode === 'video' && videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsVideoLoading(false);
      }

      const systemInstruction = contextService.getAccountSystemInstruction(projects, 'voice', scheduledPosts, userProfile, social, activitiesByProjectId);

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: 4096,
          },
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'analyze_project_file',
                  description: 'Retrieves and analyzes the contents of an uploaded file from a project Data tab. Call this when the user asks about a specific file.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      projectId: { type: Type.STRING, description: 'ID of the project containing the file.' },
                      fileName: { type: Type.STRING, description: 'The display name or name of the file to analyze' },
                      task: { type: Type.STRING, description: 'What to do with the file (e.g., summarize, extract key points).' }
                    },
                    required: ['fileName']
                  }
                },
                {
                  name: 'generate_image',
                  description: 'Generate a new image with Gemini AI based on a text prompt.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: { type: Type.STRING, description: 'Description of the image to generate.' },
                      aspectRatio: { type: Type.STRING, enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Aspect ratio.' }
                    },
                    required: ['prompt']
                  }
                },
                {
                  name: 'edit_image',
                  description: 'Edit an existing image using Gemini AI.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      imageUrl: { type: Type.STRING, description: 'URL of image to edit.' },
                      instruction: { type: Type.STRING, description: 'How to edit or change the image.' },
                      useLastGenerated: { type: Type.BOOLEAN, description: 'Use the most recently generated image.' }
                    },
                    required: ['instruction']
                  }
                },
                {
                  name: 'generate_video_from_image',
                  description: 'Generate a video from an image using Sora 2.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      imageUrl: { type: Type.STRING, description: 'Direct image URL to animate.' },
                      prompt: { type: Type.STRING, description: 'Description of the motion and style.' },
                      useLastGenerated: { type: Type.BOOLEAN, description: 'Use the most recently generated image.' }
                    },
                    required: ['prompt']
                  }
                },
                {
                  name: 'generate_video_from_prompt',
                  description: 'Generate a Sora video from a pure text prompt.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: { type: Type.STRING, description: 'Description of the scene and motion.' },
                      aspect: { type: Type.STRING, enum: ['720x1280', '1280x720'], description: 'Resolution.' }
                    },
                    required: ['prompt']
                  }
                },
                {
                  name: 'generate_pdf',
                  description: 'Generate an illustrated PDF document (ebook, guide, report, etc.) using project context.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: { type: Type.STRING, description: 'What the PDF should be about.' },
                      pageCount: { type: Type.NUMBER, description: 'Number of pages (4-24).' },
                      documentType: { type: Type.STRING, enum: ['ebook', 'guide', 'report', 'brochure', 'presentation', 'whitepaper', 'manual'] }
                    },
                    required: ['prompt']
                  }
                },
                {
                  name: 'create_project_task',
                  description: 'Create a new task in a project task list.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      projectId: { type: Type.STRING, description: 'ID of the project.' },
                      title: { type: Type.STRING, description: 'Task title.' },
                      description: { type: Type.STRING, description: 'Task details.' },
                      priority: { type: Type.STRING, enum: ['low', 'medium', 'high'] }
                    },
                    required: ['projectId', 'title']
                  }
                },
                {
                  name: 'create_project_note',
                  description: 'Create a new note in a project notebook.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      projectId: { type: Type.STRING, description: 'ID of the project.' },
                      title: { type: Type.STRING, description: 'Note title.' },
                      content: { type: Type.STRING, description: 'Note content.' }
                    },
                    required: ['projectId', 'title', 'content']
                  }
                },
                {
                  name: 'send_email',
                  description: 'Send an email via Gmail or Outlook.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      provider: { type: Type.STRING, enum: ['gmail', 'outlook'] },
                      to: { type: Type.STRING, description: 'Recipient email.' },
                      subject: { type: Type.STRING, description: 'Subject line.' },
                      body: { type: Type.STRING, description: 'Body content (HTML).' }
                    },
                    required: ['provider', 'to', 'subject', 'body']
                  }
                },
                {
                  name: 'analyze_project_file',
                  description: 'Retrieves and analyzes the contents of an uploaded file from a project Data tab. Call this when the user asks about a specific file.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      projectId: { type: Type.STRING, description: 'ID of the project containing the file.' },
                      fileName: { type: Type.STRING, description: 'The display name or name of the file to analyze' },
                      task: { type: Type.STRING, description: 'What to do with the file (e.g., summarize, extract key points).' }
                    },
                    required: ['fileName']
                  }
                },
                {
                  name: 'post_to_social',
                  description: 'Post content to social media platforms.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      platforms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Platforms: facebook, instagram, x, tiktok, youtube, linkedin' },
                      contentType: { type: Type.STRING, enum: ['text', 'image', 'video'] },
                      text: { type: Type.STRING, description: 'Caption text.' },
                      mediaUrl: { type: Type.STRING, description: 'URL of media.' },
                      useLastGenerated: { type: Type.BOOLEAN, description: 'Use most recently generated media.' }
                    },
                    required: ['platforms', 'contentType']
                  }
                },
                {
                  name: 'schedule_post',
                  description: 'Schedule a social media post for later.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      platforms: { type: Type.ARRAY, items: { type: Type.STRING } },
                      scheduledAt: { type: Type.STRING, description: 'ISO or natural language time.' },
                      contentType: { type: Type.STRING, enum: ['text', 'image', 'video'] },
                      text: { type: Type.STRING },
                      mediaUrl: { type: Type.STRING },
                      useLastGenerated: { type: Type.BOOLEAN }
                    },
                    required: ['platforms', 'scheduledAt', 'contentType']
                  }
                },
                {
                  name: 'research_market_trends',
                  description: 'Research current trending topics, viral content formats, and popular hashtags for a niche and target platforms. Call this first when starting a marketing campaign.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      niche: { type: Type.STRING, description: 'The business niche or industry (e.g., "coffee shop", "fitness coaching")' },
                      platforms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Social platforms to research (instagram, tiktok, facebook, x, youtube, linkedin)' },
                      targetAudience: { type: Type.STRING, description: 'Who the target audience is' },
                    },
                    required: ['niche']
                  }
                },
                {
                  name: 'research_seo_keywords',
                  description: 'Generate SEO keywords and hashtags for a topic.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      topic: { type: Type.STRING },
                      niche: { type: Type.STRING },
                      targetAudience: { type: Type.STRING }
                    },
                    required: ['topic']
                  }
                },
                {
                  name: 'get_best_posting_times',
                  description: 'Get optimal posting times for each social platform.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      platforms: { type: Type.ARRAY, items: { type: Type.STRING } },
                      niche: { type: Type.STRING },
                      goal: { type: Type.STRING, enum: ['awareness', 'leads', 'sales', 'engagement'] }
                    },
                    required: ['platforms', 'niche']
                  }
                },
                {
                  name: 'analyze_brand_file',
                  description: 'Analyze an uploaded file (logo, brand guide, audio, PDF, etc.) to extract brand context: colors, tone, key messages, visual style. Call for each uploaded file to inform campaign generation.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      fileName: { type: Type.STRING, description: 'Name of the uploaded file' },
                      fileUrl: { type: Type.STRING, description: 'URL of the file if available' },
                      fileType: { type: Type.STRING, description: 'MIME type or extension' },
                      projectId: { type: Type.STRING, description: 'Project ID if file is in a project' },
                      forceReanalyze: { type: Type.BOOLEAN, description: 'Set true to re-analyze even if analyzed recently' },
                    },
                    required: ['fileName']
                  }
                },
                {
                  name: 'build_campaign_plan',
                  description: 'Generate a structured campaign plan based on research and brand context.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      brief: { 
                        type: Type.OBJECT,
                        properties: {
                          businessName: { type: Type.STRING },
                          niche: { type: Type.STRING },
                          targetAudience: { type: Type.STRING },
                          platforms: { type: Type.ARRAY, items: { type: Type.STRING } },
                          goal: { type: Type.STRING },
                          tone: { type: Type.STRING }
                        }
                      },
                      includeResearch: { type: Type.BOOLEAN }
                    }
                  }
                },
                {
                  name: 'generate_ad_copy',
                  description: 'Generate platform-specific ad copy, captions, and headlines.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      platform: { type: Type.STRING, enum: ['instagram', 'tiktok', 'facebook', 'x', 'youtube', 'linkedin'] },
                      contentType: { type: Type.STRING, enum: ['image', 'video', 'reel', 'carousel', 'text', 'story'] },
                      niche: { type: Type.STRING },
                      tone: { type: Type.STRING },
                      keyMessage: { type: Type.STRING },
                      hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                      maxChars: { type: Type.NUMBER }
                    },
                    required: ['platform', 'contentType', 'keyMessage']
                  }
                },
                {
                  name: 'generate_content_calendar',
                  description: 'Generate a content posting calendar from the campaign plan.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      durationDays: { type: Type.NUMBER },
                      startDate: { type: Type.STRING }
                    },
                    required: ['durationDays']
                  }
                },
                {
                  name: 'generate_carousel',
                  description: 'Generate a multi-slide carousel for Instagram or LinkedIn.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      platform: { type: Type.STRING, enum: ['instagram', 'linkedin'] },
                      topic: { type: Type.STRING },
                      slideCount: { type: Type.NUMBER },
                      style: { type: Type.STRING }
                    },
                    required: ['platform', 'topic', 'slideCount']
                  }
                },
                {
                  name: 'reschedule_post',
                  description: 'Change the scheduled date/time of a post.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      postId: { type: Type.STRING, description: 'ID of the post to reschedule.' },
                      newScheduledAt: { type: Type.STRING, description: 'New ISO or natural language time.' },
                      platform: { type: Type.STRING }
                    },
                    required: ['postId', 'newScheduledAt']
                  }
                },
                {
                  name: 'edit_scheduled_post',
                  description: 'Edit the content or media of an existing post.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      postId: { type: Type.STRING },
                      newCaption: { type: Type.STRING },
                      newHashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                      editImageInstruction: { type: Type.STRING }
                    },
                    required: ['postId']
                  }
                },
                {
                  name: 'generate_world',
                  description: 'Generate an immersive 3D world using World Labs AI.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: { type: Type.STRING, description: 'Detailed description of the world.' },
                      inputType: { type: Type.STRING, enum: ['text', 'image', 'video'] },
                      useLastGenerated: { type: Type.BOOLEAN }
                    },
                    required: ['prompt', 'inputType']
                  }
                },
                {
                  name: 'create_stripe_product',
                  description: 'Create a Stripe product with a payment link for selling.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      description: { type: Type.STRING },
                      price: { type: Type.NUMBER, description: 'Price in dollars.' },
                      useLastGenerated: { type: Type.BOOLEAN }
                    },
                    required: ['name', 'price']
                  }
                },
                {
                  name: 'get_connected_accounts',
                  description: 'Get the list of connected social media accounts.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      platform: { type: Type.STRING, enum: ['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'linkedin', 'all'] }
                    },
                    required: ['platform']
                  }
                },
                {
                  name: 'create_project',
                  description: 'Create a brand-new research project pre-loaded with AI-generated notes, tasks, and draft research topics. Call this when the user asks to create, start, or set up a new project.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: { type: Type.STRING, description: 'The user\'s description of what the project is about. Be thorough.' },
                    },
                    required: ['prompt']
                  }
                },
                ...(targetMode === 'video' ? [{
                  name: 'capture_and_generate_image',
                  description: 'Capture a frame from the camera and use it as a reference to generate a new high-quality image.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: { type: Type.STRING, description: 'Description of the new image to generate.' }
                    },
                    required: ['prompt']
                  }
                }, {
                  name: 'create_social_reel',
                  description: 'Create a social media reel directly from the current camera view.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: { type: Type.STRING, description: 'What to create for the reel based on the current view.' },
                      platforms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Platforms: instagram, tiktok, youtube' }
                    },
                    required: ['prompt', 'platforms']
                  }
                }] : [])
              ]
            }
          ],
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
              prefixPaddingMs: 20,
              silenceDurationMs: 500,
            },
          },
        },
        callbacks: {
          onopen: () => {
            setConnectionStatus('connected');

            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);

            scriptProcessor.onaudioprocess = e => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);

            // If video mode, start frame streaming
            if (targetMode === 'video') {
              if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
              frameIntervalRef.current = setInterval(() => {
                const frame = captureFrame();
                if (frame) {
                  sessionPromise.then(session => {
                    session.sendRealtimeInput({ media: { mimeType: frame.mimeType, data: frame.data } });
                  });
                }
              }, 1000);
            }
          },
          onmessage: async (msg: LiveServerMessage) => {
            console.log('Home Live API message:', msg);
            const { serverContent } = msg;
            const clientContent = (msg as any).clientContent;

            // Accumulate user input transcription, mirroring ProjectLiveAssistant
            const inputText = clientContent?.inputTranscription?.text
              || serverContent?.inputTranscription?.text;
            if (inputText) {
              setUserTranscriptBuffer(prev => prev + inputText);
            }

            // When the user turn is complete, commit the buffered input to messages
            if (clientContent?.turnComplete) {
              setUserTranscriptBuffer(prev => {
                const trimmed = prev.trim();
                if (trimmed) {
                  addMessage('user', trimmed);
                }
                return '';
              });
            }

            if (serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }

            // Accumulate model output transcription chunks in a buffer
            if (serverContent?.outputTranscription?.text) {
              const text = serverContent.outputTranscription.text;
              setTranscriptBuffer(prev => prev + text);
            }

            // When the model turn completes, flush the transcript buffer into a single message
            if (serverContent?.turnComplete) {
              setTranscriptBuffer(prev => {
                const trimmed = prev.trim();
                if (trimmed) {
                  addMessage('model', trimmed);
                }
                return '';
              });
            }

            const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current && outputNodeRef.current) {
              setIsSpeaking(true);
              const ctx = audioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);

              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNodeRef.current);

              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsSpeaking(false);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            // Handle Function Calls in Voice/Video Mode
            const toolCall = serverContent?.modelTurn?.parts?.find(p => p.functionCall);
            if (toolCall?.functionCall) {
              const fc = toolCall.functionCall;
              const args = fc.args as any;
              console.log('Voice Tool Call:', fc.name, args);

              try {
                let result: any = { success: true };

                if (fc.name === 'generate_image') {
                  if (!(await checkCredits('imageGenerationFast'))) return;
                  await deductCredits('imageGenerationFast');
                  const { imageDataUrl } = await generateImage(args.prompt, { aspectRatio: args.aspectRatio });
                  const vercelUrl = await uploadToBlob(dataUrlToBlob(imageDataUrl), `gen-voice-${Date.now()}.png`);
                  trackConversationMedia({ id: crypto.randomUUID(), url: vercelUrl, publicUrl: vercelUrl, type: 'image', source: 'generated', name: 'Generated' });
                  result = { success: true, url: vercelUrl };
                } else if (fc.name === 'post_to_social') {
                  const missingPlatforms = args.platforms.filter((p: any) => !isPlatformConnected(p));
                  if (missingPlatforms.length > 0) {
                    voiceAuthQueueRef.current = {
                      originalArgs: args,
                      remainingPlatforms: [...missingPlatforms],
                      currentTarget: missingPlatforms[0]
                    };
                    setPendingAuthPlatforms([...missingPlatforms]);
                    const pNames = missingPlatforms.map((p: any) => p.charAt(0).toUpperCase() + p.slice(1)).join(' and ');
                    result = { error: `Authentication required for ${pNames}. Waiting for user to connect...` };
                  } else {
                    const attMedia = readyAttachments.find(a => a.uploaded?.uri)?.uploaded;
                    const sessionMediaRecord = currentConversationMedia.find(m => m.url);
                    const mediaUrl = (attMedia?.publicUrl || attMedia?.uri) || 
                                     (sessionMediaRecord?.publicUrl || sessionMediaRecord?.url) || 
                                     (args.useLastGenerated && lastGeneratedAsset ? (lastGeneratedAsset.publicUrl || lastGeneratedAsset.url) : args.mediaUrl);

                    for (const platform of args.platforms) {
                      await authFetch('/api/social/post', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ platform, contentType: args.contentType, text: args.text || '', mediaUrl })
                      });
                    }
                    result = { success: true, platforms: args.platforms };
                  }
                } else if (fc.name === 'create_project_task') {
                  await authFetch(`/api/projects/${args.projectId}/tasks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: args.title, description: args.description, priority: args.priority || 'medium' })
                  });
                  result = { success: true, task: args.title };
                } else if (fc.name === 'edit_image') {
                  const att = readyAttachments.find(a => a.uploaded?.mimeType?.startsWith('image/'))?.uploaded;
                  const sessionImageRecord = currentConversationMedia.find(m => m.type === 'image');
                  
                  const imageToEdit = (att?.publicUrl || att?.uri) || 
                                     (sessionImageRecord?.publicUrl || sessionImageRecord?.url) || 
                                     (args.useLastGenerated && lastGeneratedAsset?.type === 'image' ? (lastGeneratedAsset.publicUrl || lastGeneratedAsset.url) : args.imageUrl);
                  
                  if (!imageToEdit) throw new Error('No image specified to edit.');
                  const imageRef = await ensureImageRef(imageToEdit);
                  const { imageDataUrl } = await editImageWithReferences(args.instruction, [imageRef]);
                  const vercelUrl = await uploadToBlob(dataUrlToBlob(imageDataUrl), `edit-voice-${Date.now()}.png`);
                  setLastGeneratedAsset({ type: 'image', url: vercelUrl, publicUrl: vercelUrl, name: 'Edited Image', timestamp: Date.now() });
                  result = { success: true, url: vercelUrl };
                } else if (fc.name === 'generate_video_from_image' || fc.name === 'generate_video_from_prompt') {
                  if (!(await checkCredits('videoClipGeneration'))) return;
                  await deductCredits('videoClipGeneration');
                  const isFromImage = fc.name === 'generate_video_from_image';
                  const att = readyAttachments.find(a => a.uploaded?.mimeType?.startsWith('image/'))?.uploaded;
                  const sessionImageRecord = currentConversationMedia.find(m => m.type === 'image');
                  
                  // CRITICAL: Sora requires a public URL (Vercel Blob), Gemini URIs will fail
                  const sourceImage = isFromImage ? (
                                     (att?.publicUrl || att?.uri) || 
                                     (sessionImageRecord?.publicUrl || sessionImageRecord?.url) || 
                                     (args.useLastGenerated && lastGeneratedAsset?.type === 'image' ? (lastGeneratedAsset.publicUrl || lastGeneratedAsset.url) : args.imageUrl)
                  ) : undefined;
                  
                  if (isFromImage && !sourceImage) throw new Error('No source image for video.');

                  const gen = isFromImage
                    ? await createVideoFromImageUrl({ prompt: args.prompt, model: 'sora-2' }, sourceImage!)
                    : await createVideoFromText({ prompt: args.prompt, model: 'sora-2' });

                  const completed = await pollVideoUntilComplete(gen.id);
                  const videoBlob = await downloadVideoBlob(completed.id);
                  const vercelUrl = await uploadToBlob(videoBlob, `vid-voice-${Date.now()}.mp4`);
                  setLastGeneratedAsset({ type: 'video', url: vercelUrl, publicUrl: vercelUrl, name: 'Voice Video', timestamp: Date.now() });
                  result = { success: true, url: vercelUrl };
                } else if (fc.name === 'generate_pdf') {
                  if (!(await checkCredits('bookGeneration'))) return;
                  await deductCredits('bookGeneration');
                  const res = await authFetch('/api/pdf/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: args.prompt, pageCount: args.pageCount || 8, documentType: args.documentType || 'ebook' })
                  });
                  const blob = await res.blob();
                  const vercelUrl = await uploadToBlob(blob, `doc-voice-${Date.now()}.pdf`);
                  result = { success: true, url: vercelUrl };
                } else if (fc.name === 'create_project_note') {
                  await authFetch(`/api/projects/${args.projectId}/notes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: args.title, content: args.content })
                  });
                  result = { success: true, note: args.title };
                } else if (fc.name === 'generate_world') {
                  if (!(await checkCredits('worldGeneration'))) return;
                  await deductCredits('worldGeneration');
                  await worldLabsService.generateWorld({
                    world_prompt: {
                      type: args.inputType as any,
                      text_prompt: args.prompt
                    }
                  });
                  result = { success: true, status: 'World generation started' };
                } else if (fc.name === 'get_connected_accounts') {
                  const res = await authFetch(`/api/social?op=status&platform=${args.platform}`);
                  const data = await res.json();
                  result = { success: true, accounts: data };
                } else if (fc.name === 'send_email') {
                  await authFetch('/api/email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ op: 'send', provider: args.provider, to: args.to, subject: args.subject, body: args.body })
                  });
                  result = { success: true, sentTo: args.to };
                } else if (fc.name === 'create_stripe_product') {
                  const att = readyAttachments.find(a => a.uploaded?.mimeType?.startsWith('image/'))?.uploaded;
                  const sessionImageRecord = currentConversationMedia.find(m => m.type === 'image');
                  const productImageUrl = (att?.publicUrl || att?.uri) || 
                                          (sessionImageRecord?.publicUrl || sessionImageRecord?.url) || 
                                          (args.useLastGenerated && lastGeneratedAsset?.type === 'image' ? (lastGeneratedAsset.publicUrl || lastGeneratedAsset.url) : undefined);

                  const res = await authFetch('/api/billing?op=create-product', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: args.name, description: args.description, price: args.price, imageUrl: productImageUrl })
                  });
                  const data = await res.json();
                  result = { success: true, paymentLink: data.paymentLink };
                } else if (fc.name === 'schedule_post') {
                  const missingPlatforms = args.platforms.filter((p: any) => !isPlatformConnected(p));
                  if (missingPlatforms.length > 0) {
                    voiceAuthQueueRef.current = {
                      originalArgs: args,
                      remainingPlatforms: [...missingPlatforms],
                      currentTarget: missingPlatforms[0]
                    };
                    setPendingAuthPlatforms([...missingPlatforms]);
                    const pNames = missingPlatforms.map((p: any) => p.charAt(0).toUpperCase() + p.slice(1)).join(' and ');
                    result = { error: `Authentication required for ${pNames}. Waiting for user to connect...` };
                  } else {
                    const mediaUrl = args.useLastGenerated && lastGeneratedAsset ? lastGeneratedAsset.url : args.mediaUrl;
                    await authFetch('/api/social/schedule', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ platforms: args.platforms, scheduledAt: args.scheduledAt, contentType: args.contentType, text: args.text, mediaUrl })
                    });
                    result = { success: true, scheduledAt: args.scheduledAt };
                  }
                } else if (fc.name === 'research_market_trends') {
                  setIsMarketingMode(true);
                  const res = await authFetch(`/api/marketing?op=trend-research`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ niche: args.niche, platforms: args.platforms || [], targetAudience: args.targetAudience || '' })
                  });
                  const data = await res.json();
                  setMarketingSession(prev => {
                    const base: MarketingSession = prev ?? {
                      id: crypto.randomUUID(), createdAt: Date.now(), updatedAt: Date.now(),
                      phase: 'researching',
                      brief: { businessName: args.niche, niche: args.niche, targetAudience: args.targetAudience || '', platforms: args.platforms || [], goal: 'awareness', tone: 'engaging' },
                    };
                    return {
                      ...base, updatedAt: Date.now(), phase: 'researching',
                      researchResults: {
                        ...(base.researchResults || {} as any),
                        trends: data.trends || [],
                        hashtags: data.hashtags || [],
                        audienceInsights: data.audienceInsights || '',
                        researchedAt: Date.now(),
                      }
                    };
                  });
                  result = { success: true, trendsFound: data.trends?.length };
                } else if (fc.name === 'research_seo_keywords') {
                  const res = await authFetch(`/api/marketing?op=seo-keywords`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic: args.topic, niche: args.niche || '', targetAudience: args.targetAudience || '' })
                  });
                  const data = await res.json();
                  setMarketingSession(prev => {
                    if (!prev) return prev;
                    return {
                      ...prev, updatedAt: Date.now(),
                      researchResults: {
                        ...(prev.researchResults || {} as any),
                        seoKeywords: [...(data.primaryKeywords?.map((k: any) => k.keyword) || []), ...(data.longTailKeywords || [])],
                        hashtags: [...new Set([...(prev.researchResults?.hashtags || []), ...(data.hashtagKeywords || [])])],
                      }
                    };
                  });
                  result = { success: true, keywordsFound: data.primaryKeywords?.length };
                } else if (fc.name === 'get_best_posting_times') {
                  const res = await authFetch(`/api/marketing?op=best-posting-times`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ platforms: args.platforms || [], niche: args.niche || '', goal: args.goal || 'engagement' })
                  });
                  const data = await res.json();
                  setMarketingSession(prev => {
                    if (!prev) return prev;
                    return {
                      ...prev, updatedAt: Date.now(),
                      researchResults: {
                        ...(prev.researchResults || {} as any),
                        bestPostingTimes: data.postingTimes || {},
                      }
                    };
                  });
                  result = { success: true, platforms: Object.keys(data.postingTimes || {}) };
                } else if (fc.name === 'analyze_brand_file') {
                  const res = await authFetch(`/api/marketing?op=analyze-brand-file`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileName: args.fileName, fileUrl: args.fileUrl, fileType: args.fileType, projectId: args.projectId, forceReanalyze: args.forceReanalyze })
                  });
                  const data = await res.json();
                  setMarketingSession(prev => {
                    if (!prev) return prev;
                    const existing = prev.brandContext || {};
                    const bctx = data.brandContext || {};
                    return {
                      ...prev, updatedAt: Date.now(),
                      brandContext: {
                        ...existing,
                        colors: bctx.colors || existing.colors,
                        tone: bctx.tone || existing.tone,
                        keyMessages: [...new Set([...(existing.keyMessages || []), ...(bctx.keyMessages || [])])],
                        fileAnalyses: { ...(existing.fileAnalyses || {}), [args.fileName]: data.analysis },
                        analyzedAt: { ...(existing.analyzedAt || {}), [args.fileName]: Date.now() },
                      }
                    };
                  });
                  result = { success: true, analyzed: args.fileName };
                } else if (fc.name === 'analyze_project_file') {
                  const analysis = await analyzeFileWithGemini(args.fileName, args.task || 'Summarize this file', args.projectId);
                  result = { success: true, analysis };
                } else if (fc.name === 'build_campaign_plan') {
                  const res = await authFetch(`/api/marketing?op=campaign-plan`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      brief: args.brief || marketingSession?.brief,
                      brandContext: marketingSession?.brandContext,
                      researchResults: marketingSession?.researchResults,
                    })
                  });
                  const data = await res.json();
                  setMarketingSession(prev => ({
                    ...(prev ?? { id: crypto.randomUUID(), createdAt: Date.now(), brief: args.brief || { businessName: '', niche: '', targetAudience: '', platforms: [], goal: 'awareness', tone: 'engaging' } }),
                    updatedAt: Date.now(), phase: 'generating',
                    campaignPlan: { ...data, contentPieces: data.contentPieces?.map((p: any) => ({ ...p, status: 'pending' })) || [] },
                  } as MarketingSession));
                  result = { success: true, piecesPlanned: data.contentPieces?.length };
                } else if (fc.name === 'generate_ad_copy') {
                  const res = await authFetch(`/api/marketing?op=campaign-plan`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      brief: {
                        businessName: marketingSession?.brief?.businessName || args.niche || '',
                        niche: args.niche || marketingSession?.brief?.niche || '',
                        targetAudience: marketingSession?.brief?.targetAudience || '',
                        platforms: [args.platform],
                        goal: marketingSession?.brief?.goal || 'engagement',
                        tone: args.tone || marketingSession?.brief?.tone || 'engaging',
                      },
                      brandContext: marketingSession?.brandContext,
                    })
                  });
                  const data = await res.json();
                  const piece = data.contentPieces?.[0];
                  result = { success: true, caption: piece?.caption };
                } else if (fc.name === 'generate_content_calendar') {
                  const startTs = args.startDate ? new Date(args.startDate).getTime() : Date.now();
                  const plan = marketingSession?.campaignPlan;
                  if (plan) {
                    const scheduledPosts = plan.contentPieces.map((p, i) => ({
                      id: crypto.randomUUID(),
                      contentPieceId: p.id,
                      caption: p.caption,
                      hashtags: p.hashtags,
                      platform: p.platform,
                      scheduledAt: startTs + (Math.floor((i / plan.contentPieces.length) * args.durationDays) * 86400000),
                      status: 'scheduled' as const,
                      assetUrl: p.assetUrl,
                    }));
                    setMarketingSession(prev => prev ? { ...prev, updatedAt: Date.now(), phase: 'publishing', scheduledPosts } : prev);
                    result = { success: true, postsScheduled: scheduledPosts.length };
                  } else {
                    result = { error: 'No campaign plan found' };
                  }
                } else if (fc.name === 'generate_carousel') {
                  // Voice version might just confirm it's starting
                  result = { success: true, status: 'Carousel generation started' };
                } else if (fc.name === 'reschedule_post') {
                  const newTs = new Date(args.newScheduledAt).getTime();
                  setMarketingSession(prev => {
                    if (!prev?.scheduledPosts) return prev;
                    return { ...prev, updatedAt: Date.now(), scheduledPosts: prev.scheduledPosts.map(p => p.id === args.postId ? { ...p, scheduledAt: newTs } : p) };
                  });
                  // Sync with backend
                  try {
                    await authFetch('/api/social?op=schedule-update', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ postId: args.postId, scheduledAt: newTs, platform: args.platform })
                    });
                  } catch { /* best-effort */ }
                  result = { success: true, newScheduledAt: args.newScheduledAt };
                } else if (fc.name === 'edit_scheduled_post') {
                  updateSessionContentPiece(args.postId, {
                    ...(args.newCaption ? { caption: args.newCaption } : {}),
                    ...(args.newHashtags ? { hashtags: args.newHashtags } : {}),
                  });
                  if (args.editImageInstruction) {
                    const piece = marketingSession?.campaignPlan?.contentPieces?.find(p => p.id === args.postId);
                    const attachedImage = readyAttachments.find(a => a.uploaded?.mimeType?.startsWith('image/'))?.uploaded?.uri;
                    const sessionImage = currentConversationMedia.find(m => m.type === 'image')?.url;
                    const imgUrl = piece?.assetUrl || attachedImage || sessionImage || (lastGeneratedAsset?.type === 'image' ? lastGeneratedAsset.url : undefined);
                    
                    if (imgUrl) {
                      try {
                        const imageRef = await ensureImageRef(imgUrl);
                        const { imageDataUrl } = await editImageWithReferences(args.editImageInstruction, [imageRef]);
                        const newUrl = await uploadToBlob(dataUrlToBlob(imageDataUrl), `edit-post-${Date.now()}.png`);
                        updateSessionContentPiece(args.postId, { assetUrl: newUrl });
                        result = { success: true, postId: args.postId, updatedImageUrl: newUrl };
                      } catch (e) {
                        result = { error: 'Failed to edit image', details: String(e) };
                      }
                    } else {
                      result = { success: true, postId: args.postId, note: 'No image found to edit' };
                    }
                  } else {
                    result = { success: true, postId: args.postId };
                  }
                } else if (fc.name === 'create_project') {
                  // Voice version of create_project
                  const plan = await generateMagicProjectPlan(args.prompt);
                  let rawName = (plan.projectName || '').trim() || args.prompt;
                  let rawDesc = (plan.projectDescription || '').trim() || args.prompt;
                  const safeName = rawName === args.prompt ? `${args.prompt} – Research Project` : rawName.slice(0, 120);
                  const safeDesc = rawDesc === args.prompt ? `Deep research project exploring: ${args.prompt}` : rawDesc;

                  let seoSeedKeywords: string[] = [];
                  let agent: any;
                  try {
                    [seoSeedKeywords, agent] = await Promise.all([
                      generateSeoSeedKeywords(safeName, safeDesc, 5).catch(() => [] as string[]),
                      classifyProjectAgent(safeName, safeDesc).catch(() => undefined),
                    ]);
                  } catch { /* best-effort */ }

                  const newProject = await storageService.createResearchProject(safeName, safeDesc, { seoSeedKeywords, agent });

                  const tasksToAdd = (plan.tasks || []).slice(0, 8);
                  for (const t of tasksToAdd) {
                    try { await storageService.addTask(newProject.id, { title: t.title, description: t.description, status: 'todo', priority: t.priority, aiGenerated: true, sourceResearchId: undefined, tags: [] }); } catch { /* skip */ }
                  }
                  const notesToAdd = (plan.initialNotes || []).slice(0, 6);
                  for (const n of notesToAdd) {
                    try { await storageService.addNote(newProject.id, { title: n.title, content: n.content, color: undefined, pinned: false, aiGenerated: true, aiSuggestions: [], tags: [], linkedResearchId: undefined }); } catch { /* skip */ }
                  }
                  
                  let draftTopics: string[] = Array.isArray(plan.researchDraftTopics) ? plan.researchDraftTopics.map((t: any) => String(t).trim()).filter(Boolean) : [];
                  if (draftTopics.length < 5) {
                    try { const extra = await generateDraftResearchTopicsAlt(safeName, safeDesc, draftTopics); draftTopics = [...draftTopics, ...extra].slice(0, 8); } catch { /* skip */ }
                  }
                  if (draftTopics.length > 0) {
                    const drafts = draftTopics.map((topic, i) => ({ id: crypto.randomUUID(), topic, createdAt: Date.now() + i }));
                    try { await storageService.updateResearchProject(newProject.id, { draftResearchSessions: drafts }); } catch { /* skip */ }
                  }
                  
                  result = { success: true, projectName: safeName, projectId: newProject.id };
                  // Navigate to the newly created project to resume automation
                  setTimeout(() => {
                    window.location.href = `/project/${newProject.id}`;
                  }, 1500);
                }

                // Send tool response back to Gemini
                sessionRef.current?.sendRealtimeInput({
                  toolResponse: {
                    functionResponses: [{
                      name: fc.name,
                      response: result
                    }]
                  }
                } as any);
              } catch (err: any) {
                console.error('Voice tool error:', err);
                sessionRef.current?.sendRealtimeInput({
                  toolResponse: {
                    functionResponses: [{
                      name: fc.name,
                      response: { error: err.message }
                    }]
                  }
                } as any);
              }
            }
          },
          onclose: () => {
            setConnectionStatus('disconnected');
            setIsSpeaking(false);
          },
          onerror: err => {
            console.error('Home Voice API Error', err);
            setError('Voice connection error. Please try again.');
            setConnectionStatus('error');
          },
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (e) {
      console.error('Failed to connect home voice assistant:', e);
      setError('Failed to initialize voice. Check microphone permissions.');
      setConnectionStatus('error');
    }
  };

  const disconnectVoice = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (inputContextRef.current) {
      inputContextRef.current.close();
      inputContextRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    setConnectionStatus('disconnected');
    setIsSpeaking(false);
  };

  const handleReschedulePost = async (postId: string, newTime: number) => {
    // Update local state immediately for UI feedback
    setMarketingSession(prev => {
      if (!prev?.scheduledPosts) return prev;
      return {
        ...prev,
        updatedAt: Date.now(),
        scheduledPosts: prev.scheduledPosts.map(p =>
          p.id === postId ? { ...p, scheduledAt: newTime } : p
        )
      };
    });

    // Sync with backend (scheduled posts are usually persisted there)
    try {
      await authFetch('/api/social?op=schedule-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, scheduledAt: newTime })
      });
    } catch (e) {
      console.error('Failed to sync rescheduled post to backend:', e);
      // We keep the local update as it was best-effort or the user can retry
    }
  };



  // Helper to analyze request intent using fast Flash model (Brain before Hands)
  const analyzeRequestIntent = async (
    userMessage: string,
    recentHistory: any[],
    attachments?: typeof readyAttachments
  ): Promise<{
    thoughtProcess: string;
    recommendedTools: string[];
    intent: 'social' | 'marketing' | 'create_project' | 'direct_action' | 'other';
    disambiguationNeeded: boolean;
  }> => {
    try {
      setIsThinking(true);
      setThinkingProcess('');
      setPlannerIntent(null);

      const systemInstruction = `You are the Pre-Execution Planner for an AI Agent.
Your job is to "Think First" before the main agent acts.
Analyze the user's request and determine the best course of action.

CRITICAL CONTEXT AWARENESS - CHECK THIS FIRST:
Before recommending ANY tool, consider the conversation history:
- If the AI's PREVIOUS message ASKED the user for input (e.g., "What caption would you like?", "What subject line?", "Describe the product"), then the user's current message is CONTENT/DATA for that request, NOT a new instruction.
- When the user is replying to a prompt, treat their message as DATA (caption text, subject line, description), NOT as a command to trigger tools.
- NEVER recommend browser_automation or computer_use just because the user's reply contains keywords like "automation", "browse", "scrape", "browser" when they are clearly providing caption text or answering a question.
- Only recommend browser automation when the user is INITIATING A NEW REQUEST that explicitly requires live web interaction.

ROUTING RULES:
1. EMAIL vs SOCIAL:
   - Keywords "email", "template", "leads", "newsletter", "list" -> INTENT: EMAIL
   - Request "schedule the awesome email" -> TOOL: schedule_template_email
   - Request "schedule to instagram" -> TOOL: schedule_post (INTENT: SOCIAL)
   - NEVER suggest schedule_post for email requests!

2. AMBIGUITY CHECK:
   - "schedule this" (with no platform/template) -> Disambiguation Needed
   - "post it" (with no content) -> Disambiguation Needed

3. CAPTION/REPLY DETECTION:
   - If recent history shows AI asked "What caption?" or similar, user's current message IS the caption.
   - Set intent to "other" and recommendedTools to [] to let main agent use it as content.

4. WEB SEARCH / GROUNDING:
   - If request requires real-time info, facts, news, or external knowledge -> TOOL: google_search
   - Keywords: "search", "find", "latest", "news", "current", "who is", "price of", "weather"
   - If unrelated to project/documents and requires external knowledge -> TOOL: google_search

5. CREATE PROJECT:
   - If the user wants to start a complex, multi-step task like building a website, writing a book, doing deep research, or managing a big goal, recommend 'create_project'.
   - This sets up a dedicated workspace for them.

Output JSON ONLY:
{
  "thoughtProcess": "Brief reasoning...",
  "intent": "email" | "social" | "marketing" | "create_project" | "direct_action" | "other",
  "recommendedTools": ["tool_name_1", "tool_name_2"],
  "disambiguationNeeded": true/false
}`;

      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      const ai = new GoogleGenAI({ apiKey });

      const stream = await ai.models.generateContentStream({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            role: 'user',
            parts: [{
              text: `User Request: "${userMessage}"
Attachments Summary: ${attachments && attachments.length > 0 ? attachments.map(a => `${a.uploaded?.mimeType || 'file'}: ${a.file.name}`).join(', ') : 'None'}
Recent History: ${JSON.stringify(recentHistory.slice(-2))}`
            }]
          }
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          thinkingConfig: {
            includeThoughts: true
          }
        }
      });

      let fullText = '';

      for await (const chunk of stream) {
        const candidates = chunk.candidates;
        if (candidates && candidates.length > 0) {
          const parts = candidates[0].content.parts;
          for (const part of parts) {
            const isThought = (part as any).thought;
            if (isThought) {
              if (part.text) {
                setThinkingProcess(prev => prev + part.text);
              }
              continue;
            }
            if (part.text) {
              fullText += part.text;
            }
          }
        }
      }

      let result;
      try {
        const jsonStr = fullText.replace(/```json\n?|\n?```/g, '').trim();
        result = JSON.parse(jsonStr);
      } catch (e) {
        console.error('Failed to parse planner JSON:', e);
      }

      const analysis = result || { thoughtProcess: 'No result', recommendedTools: [], intent: 'other', disambiguationNeeded: false };
      setPlannerIntent(analysis.intent);
      return analysis;

    } catch (e) {
      console.error('Intent analysis failed:', e);
      return { thoughtProcess: 'Analysis error', recommendedTools: [], intent: 'other', disambiguationNeeded: false };
    } finally {
      setIsThinking(false);
    }
  };


  const handleSendMessage = async (textOverride?: string, attachmentsOverride?: typeof readyAttachments) => {
    const textToUse = typeof textOverride === 'string' ? textOverride : inputText;
    const currentReadyAttachments = attachmentsOverride || readyAttachments;
    
    if ((!textToUse.trim() && currentReadyAttachments.length === 0) || isProcessing) return;
    if (!attachmentsOverride && isUploadingAttachments) {
      setError('Please wait for attachments to finish uploading.');
      return;
    }

    const userMessage = textToUse.trim();
    setIsProcessing(true);
    if (typeof textOverride !== 'string') setInputText('');
    addMessage('user', userMessage);

    if (mode === 'voice' && sessionRef.current) {
      try {
        let textForLive = userMessage;
        if (currentReadyAttachments.length > 0) {
          const lines = currentReadyAttachments.map(a => {
            const u = a.uploaded;
            return u ? `- ${u.displayName || a.file.name} (${u.mimeType || a.file.type || 'unknown'}): ${u.uri}` : `- ${a.file.name}`;
          });
          textForLive += `\n\n[User attached files:\n${lines.join('\n')}\nUse them as context if possible.]`;
        }
        sessionRef.current.sendClientContent({ turns: textForLive, turnComplete: true });
        clearAttachments();
      } catch (e) {
        console.error('Failed to send text to home voice session:', e);
        setError('Failed to send message over live connection.');
      }
      return;
    }

    // Check if we have an active Computer Use session
    // If so, route this message as a follow-up command to the existing session
    if (activeComputerUseSessionId) {
      if (['stop', 'cancel', 'end session', 'exit'].includes(userMessage.toLowerCase())) {
        // Let ComputerUseViewer handle cancellation via its own button
      }

      console.log('[ComputerUse] Routing follow-up command to session:', activeComputerUseSessionId);
      try {
        await sendComputerUseCommand(activeComputerUseSessionId, userMessage);
        clearAttachments();
        setIsProcessing(false);
        return;
      } catch (e) {
        console.error('[ComputerUse] Failed to send follow-up command:', e);
        addMessage('model', '⚠️ Failed to send command to the browser agent. Please try again.');
        setIsProcessing(false);
        return;
      }
    }

    // Check if Computer Use (browser automation) is needed
    const computerUseCheck = shouldUseComputerUse(userMessage);
    if (computerUseCheck.needed && computerUseCheck.goal) {
      // Create a message with Computer Use viewer
      const cuMessageId = crypto.randomUUID();
      setMessages(prev => [
        ...prev,
        {
          id: cuMessageId,
          role: 'model',
          text: '🤖 Starting browser automation...',
          timestamp: Date.now(),
          computerUseGoal: computerUseCheck.goal,
          computerUseSession: undefined,
          computerUseExistingSessionId: lastComputerUseSessionId || undefined,
        },
      ]);
      setActiveComputerUseMessageId(cuMessageId);
      clearAttachments();
      setIsProcessing(false);
      return;
    }

    // Detect intent using Think First pipeline (The Brain)
    const recentHistory = messages.slice(-5).map(m => ({ role: m.role, text: m.text?.substring(0, 100) }));
    const intentAnalysis = await analyzeRequestIntent(userMessage, recentHistory, currentReadyAttachments);
    setPlannerIntent(intentAnalysis.intent);

    if (intentAnalysis.intent === 'marketing' || intentAnalysis.intent === 'social' || detectMarketingIntent(userMessage)) {
      setIsMarketingMode(true);
    }

    // DISAMBIGUATION: Analyze which media the user is referring to if intent is social/marketing
    // This helps when the user says "post this" and there are multiple assets in context.
    let mediaIntent: { targetMediaUrl?: string; targetMediaType?: 'image' | 'video'; confidence: string; reasoning: string } | null = null;
    const isReference = /this|that|it|the\s+(image|video|file)/i.test(userMessage);
    
    // Check if we have any media in context to disambiguate
    const sessionMedia: ConversationMedia[] = [];
    if (lastGeneratedAsset) {
      sessionMedia.push({
        id: 'last-gen',
        url: lastGeneratedAsset.url,
        publicUrl: lastGeneratedAsset.publicUrl,
        type: lastGeneratedAsset.type,
        source: 'generated',
        name: lastGeneratedAsset.name || 'Generated asset',
        addedAt: lastGeneratedAsset.timestamp
      });
    }
    // Add attachments too if any
    currentReadyAttachments.forEach(att => {
      if (att.uploaded?.uri) {
        const isVideo = att.uploaded.mimeType?.startsWith('video/');
        sessionMedia.push({
          id: att.id,
          url: att.uploaded.uri,
          publicUrl: (att.uploaded as any).publicUrl,
          type: isVideo ? 'video' : 'image',
          source: 'attached',
          name: att.uploaded.displayName || att.file.name,
          addedAt: Date.now()
        });
      }
    });

    if (isReference && (intentAnalysis.intent === 'social' || intentAnalysis.intent === 'marketing') && sessionMedia.length > 0) {
      console.log('[HomeLiveAssistant] Reference detected, analyzing media intent...');
      mediaIntent = await analyzeMediaIntent(userMessage, sessionMedia, messages.slice(-5));
      console.log('[HomeLiveAssistant] Media Intent Result:', mediaIntent);
      
      if (mediaIntent?.targetMediaUrl && mediaIntent.confidence === 'high') {
        // If we found a specific media item with high confidence, set it as the lastGeneratedAsset
        // so the post_to_social tool can pick it up automatically.
        setLastGeneratedAsset({
          url: mediaIntent.targetMediaUrl,
          publicUrl: mediaIntent.targetMediaUrl, // Using the same URL for public if not separate
          type: mediaIntent.targetMediaType || 'image',
          name: 'Selected asset',
          timestamp: Date.now()
        });
      }
    }

    setError(null);

    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      // Build dynamic context blocks (matching ProjectLiveAssistant)
      const generatedMediaContext = lastGeneratedAsset
        ? `\n\nRECENTLY GENERATED MEDIA:
You just generated a ${lastGeneratedAsset.type} (${lastGeneratedAsset.name}) ${Math.floor((Date.now() - lastGeneratedAsset.timestamp) / 1000)} seconds ago.
- If the user says "post that", "post it", or "share that" → use contentType: '${lastGeneratedAsset.type}' and useLastGenerated: true
- The system will automatically use this recently generated ${lastGeneratedAsset.type}

⚠️ VIDEO GENERATION vs SOCIAL POSTING - CRITICAL DISAMBIGUATION:
If user says "make it into a video", "animate this", "turn it into a video" → use generate_video_from_image/generate_video_from_prompt (NOT post_to_social!)
Only use post_to_social when user explicitly says "POST", "SCHEDULE", or "SHARE".
`
        : '';

      const currentAttachmentsContext = currentReadyAttachments.length > 0
        ? `\n\nCURRENT ATTACHMENTS IN THIS MESSAGE:
The user has attached ${currentReadyAttachments.length} file(s) to their current message:
${currentReadyAttachments.map((att, i) => {
          const type = att.uploaded?.mimeType?.startsWith('video/') ? 'video' :
            att.uploaded?.mimeType?.startsWith('image/') ? 'image' : 'file';
          return `${i + 1}. ${type}: "${att.file.name}"`;
        }).join('\n')}

CRITICAL: When the user says "post this", "post that", "post it" in this message, they are referring to these attached files.
- Use contentType: 'video' (if video attached) or 'image' (if image attached)
- Set useLastGenerated: true to use the attachment
- DO NOT use text: "this" or text: "that"
`
        : '';

      const conversationSummaryContext = messages.length > 2
        ? `\n\nCONVERSATION CONTEXT - RECENT HISTORY:
Last ${Math.min(messages.length, 5)} messages (newest first):
${messages.slice(-5).reverse().map((m, i) => {
          const truncatedText = m.text?.substring(0, 100) || '';
          const hasMedia = m.imageUrl ? ' [+ media]' : '';
          return `${i + 1}. [${m.role.toUpperCase()}]: ${truncatedText}${m.text && m.text.length > 100 ? '...' : ''}${hasMedia}`;
        }).join('\n')}

Intent Context:
- ${lastGeneratedAsset ? `Just generated: ${lastGeneratedAsset.type} (${lastGeneratedAsset.name}) ${Math.floor((Date.now() - lastGeneratedAsset.timestamp) / 1000)}s ago` : 'No recent content generation'}
- ${currentReadyAttachments.length > 0 ? `User has ${currentReadyAttachments.length} attachment(s) ready` : 'No attachments'}
- ${currentConversationMedia.length > 0 ? `SESSION MEDIA HISTORY:\n${currentConversationMedia.slice(0, 5).map(m => `- ${m.type}: "${m.name}" (${m.source}${m.publicUrl ? `, ${m.publicUrl}` : ''})`).join('\n')}` : 'No session media history yet'}

IMPORTANT: Use this context to understand what "it", "this", "that" refer to in the user's current message.
`
        : '';

      // Marketing session context — injected when a campaign is in progress
      const marketingContext = marketingSession
        ? `\n\nACTIVE MARKETING CAMPAIGN:\n` +
          `Phase: ${marketingSession.phase}\n` +
          `Niche: ${marketingSession.brief?.niche || 'not set'}\n` +
          `Target Audience: ${marketingSession.brief?.targetAudience || 'not set'}\n` +
          `Platforms: ${(marketingSession.brief?.platforms || []).join(', ') || 'not set'}\n` +
          `Goal: ${marketingSession.brief?.goal || 'not set'}\n` +
          `Tone: ${marketingSession.brief?.tone || 'not set'}\n` +
          (marketingSession.brandContext ? `Brand Colors: ${(marketingSession.brandContext.colors || []).join(', ')}\nBrand Tone: ${marketingSession.brandContext.tone || 'N/A'}\n` : '') +
          (marketingSession.researchResults?.hashtags?.length
            ? `Top Hashtags: ${marketingSession.researchResults.hashtags.slice(0, 8).join(' ')}\n` : '') +
          (marketingSession.researchResults?.seoKeywords?.length
            ? `SEO Keywords: ${marketingSession.researchResults.seoKeywords.slice(0, 6).join(', ')}\n` : '') +
          (marketingSession.campaignPlan?.contentPieces?.length
            ? `Campaign: ${marketingSession.campaignPlan.contentPieces.length} content pieces planned\n` : '') +
          (marketingSession.scheduledPosts?.length
            ? `Scheduled: ${marketingSession.scheduledPosts.length} posts in the queue\n` : '') +
          `\nAVAILABLE MARKETING TOOLS: research_market_trends, research_seo_keywords, get_best_posting_times, analyze_brand_file, build_campaign_plan, generate_ad_copy, generate_content_calendar, generate_carousel, reschedule_post, edit_scheduled_post.\n` +
          `WORKFLOW: 1) research_market_trends → 2) research_seo_keywords + get_best_posting_times → 3) analyze_brand_file (if files attached) → 4) build_campaign_plan → 5) generate_content_calendar → 6) schedule_post per piece.`
        : '';

      const preAnalysisContext = `

🧠 BRAIN PRE-ANALYSIS (FOLLOW THIS PLAN):
Reasoning: ${intentAnalysis.thoughtProcess}
Detected Intent: ${intentAnalysis.intent}
Recommended Tools: ${intentAnalysis.recommendedTools.join(', ') || 'None'}
Disambiguation Needed: ${intentAnalysis.disambiguationNeeded}

${mediaIntent?.targetMediaUrl && mediaIntent.confidence === 'high' ? `DISAMBIGUATION SUCCESS: The user is likely referring to the ${mediaIntent.targetMediaType} at ${mediaIntent.targetMediaUrl}. Reasoning: ${mediaIntent.reasoning}` : ''}

If disambiguation is needed, ask the user clarifying questions before using tools.
Otherwise, strongly consider using the recommended tools.
`;

      const fileContext = homeAssistantFiles.length > 0
        ? `\n\nACCOUNT-WIDE FILE SEARCH CONTEXT:
The user has previously uploaded and analyzed these files in their home assistant. You can reference their contents even if they are not explicitly attached to this message:
${homeAssistantFiles.slice(0, 15).map(f => `- ${f.name} (type: ${f.mimeType}): ${f.analysis || 'Analysis pending'}`).join('\n')}
`
        : '';

      const systemInstruction = contextService.getAccountSystemInstruction(projects, 'chat', scheduledPosts, userProfile, social, activitiesByProjectId)
        + generatedMediaContext + currentAttachmentsContext + conversationSummaryContext + marketingContext + preAnalysisContext + fileContext;

      // Sanitized conversation history: merge consecutive same-role messages, limit to 30
      const conversationHistory = (() => {
        const sanitized: { role: string; parts: { text: string }[] }[] = [];
        let lastRole = '';
        const recentMessages = messages.slice(-30);

        for (const msg of recentMessages) {
          const text = (msg.text || '').trim();
          if (msg.role === 'model' && !text) continue;
          if (msg.role === lastRole && sanitized.length > 0) {
            sanitized[sanitized.length - 1].parts[0].text += `\n\n${text || ' '} `;
          } else {
            sanitized.push({
              role: msg.role,
              parts: [{ text: text || (msg.role === 'user' ? ' ' : '') }]
            });
            lastRole = msg.role;
          }
        }
        return sanitized;
      })();

      const userParts: any[] = [{ text: userMessage }];

      // Track attached images/videos as lastGeneratedAsset for social posting
      const imageOrVideoAtt = currentReadyAttachments.find(a =>
        a.uploaded?.mimeType?.startsWith('image/') || a.uploaded?.mimeType?.startsWith('video/')
      );
      if (imageOrVideoAtt?.uploaded?.uri) {
        const isVideo = imageOrVideoAtt.uploaded.mimeType?.startsWith('video/');
        setLastGeneratedAsset({
          url: imageOrVideoAtt.uploaded.uri,
          publicUrl: imageOrVideoAtt.uploaded.publicUrl,
          type: isVideo ? 'video' : 'image',
          name: imageOrVideoAtt.uploaded.displayName || imageOrVideoAtt.file.name,
          timestamp: Date.now()
        });
        trackConversationMedia({
          id: imageOrVideoAtt.id,
          url: imageOrVideoAtt.uploaded.uri,
          publicUrl: imageOrVideoAtt.uploaded.publicUrl,
          type: isVideo ? 'video' : 'image',
          source: 'attached',
          name: imageOrVideoAtt.uploaded.displayName || imageOrVideoAtt.file.name
        });
      }

      for (const att of currentReadyAttachments) {
        const u = att.uploaded;
        const mimeType = u?.mimeType || att.file.type || 'application/octet-stream';
        const fileName = (u?.displayName || att.file.name).replace(/\s+/g, '_');

        // Optimization: Text-based files can be sent as text blocks to save processing/upload time
        const isTextFile = (
          mimeType === 'text/plain' ||
          mimeType === 'text/csv' ||
          mimeType === 'text/markdown' ||
          mimeType === 'text/html' ||
          mimeType === 'application/json' ||
          mimeType === 'application/xml' ||
          fileName.endsWith('.csv') ||
          fileName.endsWith('.txt') ||
          fileName.endsWith('.md')
        );

        if (isTextFile) {
          try {
            const content = await att.file.text();
            userParts.push({
              text: `\n\n[FILE ATTACHED: ${fileName}]\nContent:\n${content.substring(0, 30000)}${content.length > 30000 ? '\n...(truncated)...' : ''}\n[END FILE: ${fileName}]\n\n`
            });
            continue;
          } catch (e) {
            console.warn(`[HomeLiveAssistant] Failed to read ${fileName} as text, falling back to part-based logic`, e);
          }
        }

        // Case 1: Already uploaded to Gemini (preferred)
        if (u?.uri) {
          userParts.push(createPartFromUri(u.uri, mimeType));
          userParts.push({ text: `(Attached file: ${fileName})` });
        }
        // Case 2: Base64 fallback (for small files not yet uploaded or if upload failed)
        else if (att.file) {
          try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(att.file);
            });
            const base64 = dataUrl.split(',')[1];
            userParts.push({
              inlineData: { data: base64, mimeType }
            });
            userParts.push({ text: `(Attached file: ${fileName})` });
          } catch (e) {
            console.error(`[HomeLiveAssistant] Failed to convert ${fileName} to base64:`, e);
          }
        }
      }

      conversationHistory.push({
        role: 'user',
        parts: userParts,
      });

      clearAttachments();

      const streamingMessageId = crypto.randomUUID();
      setMessages(prev => [
        ...prev,
        {
          id: streamingMessageId,
          role: 'model',
          text: '',
          timestamp: Date.now(),
          isGenerating: true,
        },
      ]);

      // Define Advanced Tools for Feature Parity
      const analyzeFileTool = {
        name: 'analyze_project_file',
        description: 'Retrieves and analyzes the contents of an uploaded file from a project Data tab. Call this when the user asks about a specific file.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            projectId: { type: Type.STRING, description: 'ID of the project containing the file.' },
            fileName: { type: Type.STRING, description: 'The display name or name of the file to analyze' },
            task: { type: Type.STRING, description: 'What to do with the file (e.g., summarize, extract key points).' }
          },
          required: ['fileName']
        }
      };

      const generateImageTool = {
        name: 'generate_image',
        description: 'Generate a new image with Gemini AI based on a text prompt.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: { type: Type.STRING, description: 'Description of the image to generate.' },
            aspectRatio: { type: Type.STRING, enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Aspect ratio.' }
          },
          required: ['prompt']
        }
      };

      const editImageTool = {
        name: 'edit_image',
        description: 'Edit an existing/attached image using Gemini AI. AUTOMATICALLY DETECTS attached images - no URL needed. Use this when the user wants to MODIFY an existing image (e.g., "make it cartoon", "add clouds").',
        parameters: {
          type: Type.OBJECT,
          properties: {
            imageUrl: { type: Type.STRING, description: 'Optional URL of image to edit. If omitted, uses the most recently attached image.' },
            instruction: { type: Type.STRING, description: 'How to edit or change the image.' },
            useLastGenerated: { type: Type.BOOLEAN, description: 'Use the most recently generated or attached image.' }
          },
          required: ['instruction']
        }
      };

      const generateVideoFromImageTool = {
        name: 'generate_video_from_image',
        description: 'Generate a video from an existing/attached image using Sora 2. AUTOMATICALLY DETECTS attached images.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            imageUrl: { type: Type.STRING, description: 'Optional image URL to animate. If omitted, uses the recently attached or generated image.' },
            prompt: { type: Type.STRING, description: 'Description of the motion and style.' },
            useLastGenerated: { type: Type.BOOLEAN, description: 'Use the most recently generated or attached image.' }
          },
          required: ['prompt']
        }
      };

      const generateVideoFromPromptTool = {
        name: 'generate_video_from_prompt',
        description: 'Generate a Sora video from a pure text prompt.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: { type: Type.STRING, description: 'Description of the scene and motion.' },
            aspect: { type: Type.STRING, enum: ['720x1280', '1280x720'], description: 'Resolution.' }
          },
          required: ['prompt']
        }
      };

      const generatePdfTool = {
        name: 'generate_pdf',
        description: 'Generate an illustrated PDF document (ebook, guide, report, etc.) using project context.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: { type: Type.STRING, description: 'What the PDF should be about.' },
            pageCount: { type: Type.NUMBER, description: 'Number of pages (4-24).' },
            documentType: { type: Type.STRING, enum: ['ebook', 'guide', 'report', 'brochure', 'presentation', 'whitepaper', 'manual'] }
          },
          required: ['prompt']
        }
      };

      const createProjectTaskTool = {
        name: 'create_project_task',
        description: 'Create a new task in a project task list.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            projectId: { type: Type.STRING, description: 'ID of the project.' },
            title: { type: Type.STRING, description: 'Task title.' },
            description: { type: Type.STRING, description: 'Task details.' },
            priority: { type: Type.STRING, enum: ['low', 'medium', 'high'] }
          },
          required: ['projectId', 'title']
        }
      };

      const createProjectNoteTool = {
        name: 'create_project_note',
        description: 'Create a new note in a project notebook.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            projectId: { type: Type.STRING, description: 'ID of the project.' },
            title: { type: Type.STRING, description: 'Note title.' },
            content: { type: Type.STRING, description: 'Note content.' }
          },
          required: ['projectId', 'title', 'content']
        }
      };

      const sendEmailTool = {
        name: 'send_email',
        description: 'Send an email via Gmail or Outlook.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            provider: { type: Type.STRING, enum: ['gmail', 'outlook'] },
            to: { type: Type.STRING, description: 'Recipient email.' },
            subject: { type: Type.STRING, description: 'Subject line.' },
            body: { type: Type.STRING, description: 'Body content (HTML).' }
          },
          required: ['provider', 'to', 'subject', 'body']
        }
      };

      const postToSocialTool = {
        name: 'post_to_social',
        description: 'Post content to social media platforms.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            platforms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Platforms: facebook, instagram, x, tiktok, youtube, linkedin' },
            contentType: { type: Type.STRING, enum: ['text', 'image', 'video'] },
            text: { type: Type.STRING, description: 'Caption text.' },
            mediaUrl: { type: Type.STRING, description: 'URL of media.' },
            useLastGenerated: { type: Type.BOOLEAN, description: 'Use most recently generated media.' }
          },
          required: ['platforms', 'contentType']
        }
      };

      const schedulePostTool = {
        name: 'schedule_post',
        description: 'Schedule a social media post for later.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            platforms: { type: Type.ARRAY, items: { type: Type.STRING } },
            scheduledAt: { type: Type.STRING, description: 'ISO or natural language time.' },
            contentType: { type: Type.STRING, enum: ['text', 'image', 'video'] },
            text: { type: Type.STRING },
            mediaUrl: { type: Type.STRING },
            useLastGenerated: { type: Type.BOOLEAN }
          },
          required: ['platforms', 'scheduledAt', 'contentType']
        }
      };

      const generateWorldTool = {
        name: 'generate_world',
        description: 'Generate an immersive 3D world using World Labs AI.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: { type: Type.STRING, description: 'Detailed description of the world.' },
            inputType: { type: Type.STRING, enum: ['text', 'image', 'video'] },
            useLastGenerated: { type: Type.BOOLEAN }
          },
          required: ['prompt', 'inputType']
        }
      };

      const createStripeProductTool = {
        name: 'create_stripe_product',
        description: 'Create a Stripe product with a payment link for selling.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            description: { type: Type.STRING },
            price: { type: Type.NUMBER, description: 'Price in dollars.' },
            useLastGenerated: { type: Type.BOOLEAN }
          },
          required: ['name', 'price']
        }
      };

      const getConnectedAccountsTool = {
        name: 'get_connected_accounts',
        description: 'Get the list of connected social media accounts.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            platform: { type: Type.STRING, enum: ['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'linkedin', 'all'] }
          },
          required: ['platform']
        }
      };

      // ─── Marketing Agent Tools ─────────────────────────────────────────────
      const researchMarketTrendsTool = {
        name: 'research_market_trends',
        description: 'Research current trending topics, viral content formats, and popular hashtags for a niche and target platforms. Call this first when starting a marketing campaign.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            niche: { type: Type.STRING, description: 'The business niche or industry (e.g., "coffee shop", "fitness coaching")' },
            platforms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Social platforms to research (instagram, tiktok, facebook, x, youtube, linkedin)' },
            targetAudience: { type: Type.STRING, description: 'Who the target audience is' },
          },
          required: ['niche']
        }
      };

      const researchSeoKeywordsTool = {
        name: 'research_seo_keywords',
        description: 'Generate SEO keywords and hashtags for a topic. Use to inform captions and content.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            topic: { type: Type.STRING },
            niche: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
          },
          required: ['topic']
        }
      };

      const getBestPostingTimesTool = {
        name: 'get_best_posting_times',
        description: 'Get the optimal posting times for each social platform based on niche and goal.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            platforms: { type: Type.ARRAY, items: { type: Type.STRING } },
            niche: { type: Type.STRING },
            goal: { type: Type.STRING, enum: ['awareness', 'leads', 'sales', 'engagement'] },
          },
          required: ['platforms', 'niche']
        }
      };

      const analyzeBrandFileTool = {
        name: 'analyze_brand_file',
        description: 'Analyze an uploaded file (logo, brand guide, audio, PDF, etc.) to extract brand context: colors, tone, key messages, visual style. Call for each uploaded file to inform campaign generation.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            fileName: { type: Type.STRING, description: 'Name of the uploaded file' },
            fileUrl: { type: Type.STRING, description: 'URL of the file if available' },
            fileType: { type: Type.STRING, description: 'MIME type or extension' },
            projectId: { type: Type.STRING, description: 'Project ID if file is in a project' },
            forceReanalyze: { type: Type.BOOLEAN, description: 'Set true to re-analyze even if analyzed recently' },
          },
          required: ['fileName']
        }
      };

      const buildCampaignPlanTool = {
        name: 'build_campaign_plan',
        description: 'Generate a structured campaign plan with content pieces and schedule based on gathered research and brand context. Call after completing market research and brand analysis.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            brief: { type: Type.OBJECT, description: 'Marketing brief with businessName, niche, targetAudience, platforms, goal, tone' },
            includeResearch: { type: Type.BOOLEAN, description: 'Whether to include the gathered research results in the plan' },
          },
          required: ['brief']
        }
      };

      const generateAdCopyTool = {
        name: 'generate_ad_copy',
        description: 'Generate platform-specific ad copy, captions, headlines, and calls-to-action for a content piece. Use after build_campaign_plan.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            platform: { type: Type.STRING, enum: ['instagram', 'tiktok', 'facebook', 'x', 'youtube', 'linkedin'] },
            contentType: { type: Type.STRING, enum: ['image', 'video', 'reel', 'carousel', 'text', 'story'] },
            niche: { type: Type.STRING },
            tone: { type: Type.STRING },
            keyMessage: { type: Type.STRING, description: 'Core message for this piece' },
            hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
            maxChars: { type: Type.NUMBER, description: 'Max caption characters for this platform' },
          },
          required: ['platform', 'contentType', 'keyMessage']
        }
      };

      const generateAllAssetsTool = {
        name: 'generate_all_assets',
        description: 'Immediately generates all campaign images/videos in parallel. Call this to regenerate all assets or resume generation.',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        }
      };

      const generateContentCalendarTool = {
        name: 'generate_content_calendar',
        description: 'Generate a week or month-long content posting calendar from the campaign plan, optimized for best posting times.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            durationDays: { type: Type.NUMBER, description: 'Number of days to schedule (7 or 30)' },
            startDate: { type: Type.STRING, description: 'ISO date string for the first post date' },
          },
          required: ['durationDays']
        }
      };

      const generateCarouselTool = {
        name: 'generate_carousel',
        description: 'Generate a multi-slide carousel for Instagram or LinkedIn. Creates 3-10 images with copy for each slide.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            platform: { type: Type.STRING, enum: ['instagram', 'linkedin'] },
            topic: { type: Type.STRING },
            slideCount: { type: Type.NUMBER, description: '3 to 10 slides' },
            style: { type: Type.STRING, description: 'Visual style (e.g., "modern minimal", "bold colorful")' },
          },
          required: ['platform', 'topic', 'slideCount']
        }
      };

      const reschedulePostTool = {
        name: 'reschedule_post',
        description: 'Change the scheduled date/time of a post in the current campaign. Use when user says to move or change a post time.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            postId: { type: Type.STRING, description: 'ID of the scheduled post to reschedule' },
            newScheduledAt: { type: Type.STRING, description: 'New ISO datetime string' },
            platform: { type: Type.STRING },
          },
          required: ['postId', 'newScheduledAt']
        }
      };

      const editScheduledPostTool = {
        name: 'edit_scheduled_post',
        description: 'Edit the content (caption, hashtags, or media) of an already-scheduled or planned post.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            postId: { type: Type.STRING, description: 'The contentPieceId or scheduledPostId to edit' },
            newCaption: { type: Type.STRING },
            newHashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
            editImageInstruction: { type: Type.STRING, description: 'If set, will edit the associated image with this instruction' },
          },
          required: ['postId']
        }
      };
      // ────────────────────────────────────────────────────────────────────────

      const createProjectTool = {
        name: 'create_project',
        description: 'Create a brand-new research project pre-loaded with AI-generated notes, tasks, and draft research topics — exactly like the Magic Research button on the projects page. Call this when the user asks to create, start, or set up a new project.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: { type: Type.STRING, description: 'The user\'s description of what the project is about. Be thorough.' },
          },
          required: ['prompt']
        }
      };

      const searchPhoneNumbersTool = {
        name: 'search_phone_numbers',
        description: 'Search for available Twilio phone numbers by area code. Call this when the user wants to get a new phone number.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            areaCode: { type: Type.STRING, description: '3-digit area code (e.g. 305)' }
          },
          required: ['areaCode']
        }
      };

      const purchasePhoneNumberTool = {
        name: 'purchase_phone_number',
        description: 'Buy a specific Twilio phone number. Cost is 400 credits. Call this ONLY after the user has confirmed they want to buy a specific number from the search results.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            phoneNumber: { type: Type.STRING, description: 'The phone number to buy (formatted with +1, e.g. +13051234567)' }
          },
          required: ['phoneNumber']
        }
      };

      const configurePhoneAgentTool = {
        name: 'configure_phone_agent',
        description: 'Update the settings for the Phone Agent/Phone Line. Use this to set greetings, agent instructions, or lead capture fields.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            enabled: { type: Type.BOOLEAN },
            systemPrompt: { type: Type.STRING, description: 'For Personal Assistant mode: directions for the AI on how to handle calls.' },
            welcomeGreeting: { type: Type.STRING, description: 'The first message the AI says when someone calls.' },
            leadCaptureEnabled: { type: Type.BOOLEAN, description: 'Set to true for Lead Capture mode, false for Personal Assistant mode.' },
            leadFields: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  required: { type: Type.BOOLEAN }
                }
              }
            }
          }
        }
      };

      const listPhoneAgentVoicesTool = {
        name: 'list_phone_agent_voices',
        description: 'Get a list of available Gemini AI voices for the phone agent, sorted by gender.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            gender: { type: Type.STRING, enum: ['male', 'female', 'all'], description: 'Filter by gender.' }
          }
        }
      };

      const simulatePhoneCallTool = {
        name: 'simulate_phone_call',
        description: 'Simulate a phone call session to test how the agent responds. This is a text-based preview of the agent\'s conversational logic.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            userInput: { type: Type.STRING, description: 'The text input from a mock caller (e.g., "Hello, what do you do?").' }
          },
          required: ['userInput']
        }
      };

      const tools: any[] = [
        {
          functionDeclarations: [
            analyzeFileTool,
            generateImageTool,
            editImageTool,
            generateVideoFromImageTool,
            generateVideoFromPromptTool,
            generatePdfTool,
            createProjectTaskTool,
            createProjectNoteTool,
            createProjectTool,
            sendEmailTool,
            postToSocialTool,
            schedulePostTool,
            generateWorldTool,
            createStripeProductTool,
            getConnectedAccountsTool,
            // ── Marketing Tools ──
            researchMarketTrendsTool,
            researchSeoKeywordsTool,
            getBestPostingTimesTool,
            analyzeBrandFileTool,
            buildCampaignPlanTool,
            generateAdCopyTool,
            generateAllAssetsTool,
            generateContentCalendarTool,
            generateCarouselTool,
            reschedulePostTool,
            editScheduledPostTool,
            searchPhoneNumbersTool,
            purchasePhoneNumberTool,
            configurePhoneAgentTool,
            listPhoneAgentVoicesTool,
            simulatePhoneCallTool,
          ]
        }
      ];


      // NOTE: fileSearch built-in tool was previously injected here, but the Google GenAI API
      // does not allow combining built-in tools (fileSearch) with custom tools (functionDeclarations)
      // in the same request. This caused a 400 error when attachments were present.
      // Removed to match ProjectLiveAssistant.tsx behavior which does not use fileSearch.

      // Model fallback chain for resilience
      const fallbackModels = MODEL_FALLBACK_CHAINS.standard;
      let stream: any = null;
      let lastError: any = null;

      for (const modelName of fallbackModels) {
        try {
          console.log(`[HomeLiveAssistant] Trying model: ${modelName}`);
          stream = await ai.models.generateContentStream({
            model: modelName,
            contents: conversationHistory,
            config: {
              systemInstruction,
              temperature: 0.7,
              maxOutputTokens: 4096,
              tools,
              toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
            },
          });
          console.log(`[HomeLiveAssistant] ✅ Success with model: ${modelName}`);
          break; // Success, exit loop
        } catch (err: any) {
          lastError = err;
          console.warn(`[HomeLiveAssistant] Model ${modelName} failed:`, err.message || err);
          if (!isRetryableError(err)) {
            // Non-retryable error (e.g., invalid request), don't try other models
            throw err;
          }
          // Continue to next fallback model
        }
      }

      if (!stream) {
        throw lastError || new Error('All fallback models failed');
      }

      let fullText = '';
      const aggregatedFunctionCalls: any[] = [];
      let latestGroundingMetadata: any = null;

      for await (const chunk of stream as any) {
        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;

        if (candidate.groundingMetadata) {
          latestGroundingMetadata = candidate.groundingMetadata;
        }

        const parts = candidate.content?.parts || [];
        for (const part of parts) {
          if (part.text) {
            const textChunk: string = part.text;
            fullText += textChunk;
            setMessages(prev =>
              prev.map(msg =>
                msg.id === streamingMessageId
                  ? { ...msg, text: (msg.text || '') + textChunk }
                  : msg
              )
            );
          } else if (part.functionCall) {
            aggregatedFunctionCalls.push(part.functionCall);
          }
        }
      }

      // Handle Grounding
      try {
        const chunks = latestGroundingMetadata?.groundingChunks;
        if (Array.isArray(chunks) && chunks.length > 0) {
          const sources: string[] = [];
          chunks.forEach((c: any) => {
            const webTitle = c?.web?.title;
            const webUri = c?.web?.uri;
            if (webUri || webTitle) sources.push(webTitle ? `${webTitle} (${webUri || 'no url'})` : String(webUri));
          });
          if (sources.length > 0) {
            const deduped = Array.from(new Set(sources)).slice(0, 5);
            const citationBlock = `\n\nSources:\n${deduped.map(s => `- ${s}`).join('\n')}`;
            fullText += citationBlock;
            setMessages(prev =>
              prev.map(msg =>
                msg.id === streamingMessageId
                  ? { ...msg, text: (msg.text || '') + citationBlock }
                  : msg
              )
            );
          }
        }
      } catch (e) { console.warn('Grounding error', e); }

      // Handle Function Calls
      if (aggregatedFunctionCalls.length > 0) {
        console.log('Processing function calls:', aggregatedFunctionCalls);

        for (const fc of aggregatedFunctionCalls) {
          const args = fc.args as any;
          try {
            if (fc.name === 'analyze_project_file') {
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n🔍 Analyzing file: ${args.fileName}...` } : m));
              const analysis = await analyzeFileWithGemini(args.fileName, args.task || 'Summarize this file', args.projectId);
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`🔍 Analyzing file: ${args.fileName}...`, `✅ Analysis for **${args.fileName}**:\n\n${analysis}`) } : m));
            } else if (fc.name === 'generate_image') {
              if (!(await checkCredits('imageGenerationFast'))) return;
              await deductCredits('imageGenerationFast');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n🎨 Generating image...' } : m));
              const { imageDataUrl } = await generateImage(args.prompt, { aspectRatio: args.aspectRatio });
              const vercelUrl = await uploadToBlob(dataUrlToBlob(imageDataUrl), `gen-${Date.now()}.png`);
              setLastGeneratedAsset({ type: 'image', url: vercelUrl, publicUrl: vercelUrl, name: 'Generated Image', timestamp: Date.now() });
              trackConversationMedia({ id: crypto.randomUUID(), url: vercelUrl, publicUrl: vercelUrl, type: 'image', source: 'generated', name: 'Generated Image' });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, imageUrl: vercelUrl, text: m.text.replace('🎨 Generating image...', '✅ Image generated:') } : m));
            } else if (fc.name === 'edit_image') {
              if (!(await checkCredits('aiDocEdit'))) return;
              await deductCredits('aiDocEdit');
              const att = currentReadyAttachments.find(a => a.uploaded?.mimeType?.startsWith('image/'))?.uploaded;
              const sessionImageRecord = currentConversationMedia.find(m => m.type === 'image');
              
              const imageToEdit = (att?.publicUrl || att?.uri) || 
                                 (sessionImageRecord?.publicUrl || sessionImageRecord?.url) || 
                                 (args.useLastGenerated && lastGeneratedAsset?.type === 'image' ? (lastGeneratedAsset.publicUrl || lastGeneratedAsset.url) : args.imageUrl);
              
              if (!imageToEdit) throw new Error('No image specified to edit.');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n🎨 Editing image...' } : m));
              const imageRef = await ensureImageRef(imageToEdit);
              const { imageDataUrl } = await editImageWithReferences(args.instruction, [imageRef]);
              const vercelUrl = await uploadToBlob(dataUrlToBlob(imageDataUrl), `edit-${Date.now()}.png`);
              setLastGeneratedAsset({ type: 'image', url: vercelUrl, publicUrl: vercelUrl, name: 'Edited Image', timestamp: Date.now() });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, imageUrl: vercelUrl, text: m.text.replace('🎨 Editing image...', '✅ Image edited:') } : m));
            } else if (fc.name === 'generate_video_from_image') {
              if (!(await checkCredits('videoClipGeneration'))) return;
              await deductCredits('videoClipGeneration');
              const att = currentReadyAttachments.find(a => a.uploaded?.mimeType?.startsWith('image/'))?.uploaded;
              const sessionImageRecord = currentConversationMedia.find(m => m.type === 'image');
              
              // CRITICAL: Sora requires a public URL (Vercel Blob), Gemini URIs will fail
              const sourceImage = (att?.publicUrl || att?.uri) || 
                                 (sessionImageRecord?.publicUrl || sessionImageRecord?.url) || 
                                 (args.useLastGenerated && lastGeneratedAsset?.type === 'image' ? (lastGeneratedAsset.publicUrl || lastGeneratedAsset.url) : args.imageUrl);
              
              if (!sourceImage) throw new Error('No source image for video generation.');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n🎬 Generating video from image...' } : m));
              const generation = await createVideoFromImageUrl({ prompt: args.prompt, model: 'sora-2' }, sourceImage);
              const completed = await pollVideoUntilComplete(generation.id);
              const videoBlob = await downloadVideoBlob(completed.id);
              const vercelUrl = await uploadToBlob(videoBlob, `vid-${Date.now()}.mp4`);
              setLastGeneratedAsset({ type: 'video', url: vercelUrl, publicUrl: vercelUrl, name: 'Generated Video', timestamp: Date.now() });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, videoUrl: vercelUrl, text: m.text.replace('🎬 Generating video from image...', '✅ Video generated:') } : m));
            } else if (fc.name === 'generate_video_from_prompt') {
              if (!(await checkCredits('videoClipGeneration'))) return;
              await deductCredits('videoClipGeneration');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n🎬 Generating Sora video from prompt...' } : m));
              const generation = await createVideoFromText({ prompt: args.prompt, model: 'sora-2' });
              const completed = await pollVideoUntilComplete(generation.id);
              const videoBlob = await downloadVideoBlob(completed.id);
              const vercelUrl = await uploadToBlob(videoBlob, `vid-${Date.now()}.mp4`);
              setLastGeneratedAsset({ type: 'video', url: vercelUrl, publicUrl: vercelUrl, name: 'Generated Video', timestamp: Date.now() });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, videoUrl: vercelUrl, text: m.text.replace('🎬 Generating Sora video from prompt...', '✅ Video generated:') } : m));
            } else if (fc.name === 'generate_pdf') {
              if (!(await checkCredits('bookGeneration'))) return;
              await deductCredits('bookGeneration');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n📄 Generating PDF...' } : m));
              const res = await authFetch('/api/pdf/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: args.prompt, pageCount: args.pageCount || 8, documentType: args.documentType || 'ebook' })
              });
              const blob = await res.blob();
              const vercelUrl = await uploadToBlob(blob, `doc-${Date.now()}.pdf`);
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('📄 Generating PDF...', `✅ PDF generated: [Download PDF](${vercelUrl})`) } : m));
            } else if (fc.name === 'create_project_task') {
              const res = await authFetch(`/api/projects/${args.projectId}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: args.title, description: args.description, priority: args.priority || 'medium' })
              });
              if (!res.ok) throw new Error('Failed to create task');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n✅ Task **${args.title}** created in project.` } : m));
            } else if (fc.name === 'create_project_note') {
              const res = await authFetch(`/api/projects/${args.projectId}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: args.title, content: args.content })
              });
              if (!res.ok) throw new Error('Failed to create note');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n✅ Note **${args.title}** added to project.` } : m));
            } else if (fc.name === 'send_email') {
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n📧 Sending email via ${args.provider}...` } : m));
              const res = await authFetch('/api/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ op: 'send', provider: args.provider, to: args.to, subject: args.subject, body: args.body })
              });
              if (!res.ok) throw new Error('Email failed to send');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`📧 Sending email via ${args.provider}...`, `✅ Email sent to **${args.to}**.`) } : m));
            } else if (fc.name === 'post_to_social') {
              const missingPlatforms = args.platforms.filter((p: any) => !isPlatformConnected(p));
              if (missingPlatforms.length > 0) {
                voiceAuthQueueRef.current = {
                  originalArgs: args,
                  remainingPlatforms: [...missingPlatforms],
                  currentTarget: missingPlatforms[0]
                };
                setPendingAuthPlatforms([...missingPlatforms]);
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n⚠️ Please connect the required platforms (${missingPlatforms.join(', ')}) to continue.` } : m));
              } else {
                const attMedia = currentReadyAttachments.find(a => a.uploaded?.uri)?.uploaded;
                const sessionMediaRecord = currentConversationMedia.find(m => m.url);
                const mediaUrl = (attMedia?.publicUrl || attMedia?.uri) || 
                                 (sessionMediaRecord?.publicUrl || sessionMediaRecord?.url) || 
                                 (args.useLastGenerated && lastGeneratedAsset ? (lastGeneratedAsset.publicUrl || lastGeneratedAsset.url) : args.mediaUrl);
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n📤 Posting to ${args.platforms.join(', ')}...` } : m));
                const results: string[] = [];
                for (const platform of args.platforms) {
                  const res = await authFetch('/api/social/post', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ platform, contentType: args.contentType, text: args.text || '', mediaUrl })
                  });
                  const data = await res.json();
                  results.push(data.success ? `✅ ${platform}: Posted` : `❌ ${platform}: ${data.error || 'Failed'}`);
                }
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`📤 Posting to ${args.platforms.join(', ')}...`, results.join('\n')) } : m));
              }
            } else if (fc.name === 'generate_world') {
              if (!(await checkCredits('worldGeneration'))) return;
              await deductCredits('worldGeneration');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n🌍 Generating 3D world (takes ~5 mins)...' } : m));
              await worldLabsService.generateWorld({
                world_prompt: {
                  type: args.inputType as any,
                  text_prompt: args.prompt
                }
              });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n✅ World generation started! Check the Assets > Worlds tab in a few minutes.' } : m));
            } else if (fc.name === 'create_stripe_product') {
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n💳 Creating Stripe product...' } : m));
              const att = currentReadyAttachments.find(a => a.uploaded?.mimeType?.startsWith('image/'))?.uploaded;
              const sessionImageRecord = currentConversationMedia.find(m => m.type === 'image');
              const productImageUrl = (att?.publicUrl || att?.uri) || 
                                      (sessionImageRecord?.publicUrl || sessionImageRecord?.url) || 
                                      (args.useLastGenerated && lastGeneratedAsset?.type === 'image' ? (lastGeneratedAsset.publicUrl || lastGeneratedAsset.url) : undefined);

              const res = await authFetch('/api/billing?op=create-product', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: args.name, description: args.description, price: args.price, imageUrl: productImageUrl })
              });
              const data = await res.json();
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('💳 Creating Stripe product...', `✅ Product **${args.name}** created! [Payment Link](${data.paymentLink})`) } : m));
            } else if (fc.name === 'search_phone_numbers') {
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n🔎 Searching for phone numbers in area code **${args.areaCode}**...` } : m));
              const res = await authFetch('/api/agent?op=search-numbers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ areaCode: args.areaCode })
              });
              const data = await res.json();
              if (data.numbers && data.numbers.length > 0) {
                const numList = data.numbers.slice(0, 5).map((n: any) => `- **${n.friendlyName}** (${n.phoneNumber})`).join('\n');
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`🔎 Searching for phone numbers in area code **${args.areaCode}**...`, `✅ Found available numbers in **${args.areaCode}**:\n\n${numList}\n\nWhich one would you like to purchase for 400 credits?`) } : m));
              } else {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`🔎 Searching for phone numbers in area code **${args.areaCode}**...`, `❌ No numbers found in area code **${args.areaCode}**. Try a different one?`) } : m));
              }
            } else if (fc.name === 'purchase_phone_number') {
              const canAfford = await checkCredits('phoneProvisioning');
              if (!canAfford) return;

              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n💳 Purchasing number **${args.phoneNumber}**...` } : m));
              
              const res = await authFetch('/api/agent?op=buy-number', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  phoneNumber: args.phoneNumber,
                  existingConfig: userProfile?.agentPhoneConfig 
                })
              });
              const data = await res.json();

              if (data.success) {
                await deductCredits('phoneProvisioning');
                const profile = await storageService.getUserProfile();
                if (profile) setUserProfile(profile);
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`💳 Purchasing number **${args.phoneNumber}**...`, `✅ **Purchase Successful!** Your new AI Phone Line is: **${args.phoneNumber}**.\n\n400 credits have been deducted. Would you like to configure your agent instructions, choose a voice (I can list them for you), or test it with a simulated call?`) } : m));
              } else {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`💳 Purchasing number **${args.phoneNumber}**...`, `❌ **Purchase Failed**: ${data.error || 'Unknown error. Please try again or pick a different number.'}`) } : m));
              }
            } else if (fc.name === 'configure_phone_agent') {
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n⚙️ Updating Phone Agent configuration...' } : m));
              
              const currentConfig = userProfile?.agentPhoneConfig || {} as PhoneAgentConfig;
              const newConfig: PhoneAgentConfig = {
                ...currentConfig,
                enabled: args.enabled !== undefined ? args.enabled : (currentConfig.enabled ?? true),
                ...(args.systemPrompt !== undefined ? { systemPrompt: args.systemPrompt } : {}),
                ...(args.welcomeGreeting !== undefined ? { welcomeGreeting: args.welcomeGreeting } : {}),
                ...(args.leadCaptureEnabled !== undefined ? { leadCaptureEnabled: args.leadCaptureEnabled } : {}),
                ...(args.leadFields !== undefined ? { leadFields: args.leadFields } : {}),
                ...(args.voiceName !== undefined ? { voiceName: args.voiceName } : {}),
                ...(args.voiceGender !== undefined ? { voiceGender: args.voiceGender } : {}),
              };

              await storageService.updateUserProfile({ agentPhoneConfig: newConfig });
              const profile = await storageService.getUserProfile();
              if (profile) setUserProfile(profile);

              const modeLabel = newConfig.leadCaptureEnabled ? 'Lead Capture' : 'Personal Assistant';
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('⚙️ Updating Phone Agent configuration...', `✅ **Phone Agent Updated!** Mode set to: **${modeLabel}**.\n\nSettings have been synced to your profile. Any calls to your AI Phone Line will use these new instructions.`) } : m));
            } else if (fc.name === 'list_phone_agent_voices') {
              const femaleVoices = ['Achernar', 'Aoede', 'Autonoe', 'Callirrhoe', 'Despina', 'Erinome', 'Gacrux', 'Kore', 'Laomedeia', 'Leda', 'Pulcherrima', 'Sulafat', 'Vindemiatrix', 'Zephyr'];
              const maleVoices = ['Achird', 'Algenib', 'Alnilam', 'Charon', 'Enceladus', 'Fenrir', 'Iapetus', 'Orus', 'Puck', 'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Umbriel', 'Zubenelgenubi'];
              
              let response = 'Available Gemini AI Voices:\n\n';
              if (!args.gender || args.gender === 'all' || args.gender === 'female') {
                response += `**Female Voices:**\n${femaleVoices.join(', ')}\n\n`;
              }
              if (!args.gender || args.gender === 'all' || args.gender === 'male') {
                response += `**Male Voices:**\n${maleVoices.join(', ')}\n\n`;
              }
              response += 'You can set your preferred voice using `configure_phone_agent`.';
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n' + response } : m));
            } else if (fc.name === 'simulate_phone_call') {
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n📞 Simulating call from mock caller: "${args.userInput}"...` } : m));
              
              const res = await authFetch('/api/agent?op=simulate-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  userInput: args.userInput,
                  config: userProfile?.agentPhoneConfig 
                })
              });
              const data = await res.json();
              
              const simOutput = data.response || 'The agent did not respond. Check your instructions.';
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`📞 Simulating call from mock caller: "${args.userInput}"...`, `✅ **Simulation Result:**\n\n**Caller:** "${args.userInput}"\n**Agent:** "${simOutput}"`) } : m));
            } else if (fc.name === 'get_connected_accounts') {
              const res = await authFetch(`/api/social?op=status&platform=${args.platform}`);
              const data = await res.json();
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n🔗 Connected accounts for **${args.platform}**: ${JSON.stringify(data)}` } : m));
            } else if (fc.name === 'schedule_post') {
              const missingPlatforms = args.platforms.filter((p: any) => !isPlatformConnected(p));
              if (missingPlatforms.length > 0) {
                voiceAuthQueueRef.current = {
                  originalArgs: args,
                  remainingPlatforms: [...missingPlatforms],
                  currentTarget: missingPlatforms[0]
                };
                setPendingAuthPlatforms([...missingPlatforms]);
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n⚠️ Please connect the required platforms (${missingPlatforms.join(', ')}) to continue scheduling.` } : m));
              } else {
                const attachedMedia = currentReadyAttachments.find(a => a.uploaded?.uri)?.uploaded?.uri;
                const sessionMedia = currentConversationMedia.find(m => m.url)?.url;
                const mediaUrl = attachedMedia || sessionMedia || (args.useLastGenerated && lastGeneratedAsset ? lastGeneratedAsset.url : args.mediaUrl);
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n📅 Scheduling post for ${args.scheduledAt}...` } : m));
                await authFetch('/api/social/schedule', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ platforms: args.platforms, scheduledAt: args.scheduledAt, contentType: args.contentType, text: args.text, mediaUrl })
                });
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`📅 Scheduling post for ${args.scheduledAt}...`, `✅ Post scheduled for **${args.scheduledAt}** on ${args.platforms.join(', ')}.`) } : m));
              }

            // ─── Marketing Agent Handlers ──────────────────────────────────
            } else if (fc.name === 'research_market_trends') {
              setIsMarketingMode(true);
              setThinkingProcess('🔍 Researching market trends, viral content & hashtags…');
              setIsThinking(true);
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n🔍 Researching trends for **${args.niche}** on ${(args.platforms || []).join(', ') || 'all platforms'}…` } : m));
              const trendRes = await authFetch(`/api/marketing?op=trend-research`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ niche: args.niche, platforms: args.platforms || [], targetAudience: args.targetAudience || '' })
              });
              const trendData = await trendRes.json();
              setIsThinking(false);
              setMarketingSession(prev => {
                const base: MarketingSession = prev ?? {
                  id: crypto.randomUUID(), createdAt: Date.now(), updatedAt: Date.now(),
                  phase: 'researching',
                  brief: { businessName: args.niche, niche: args.niche, targetAudience: args.targetAudience || '', platforms: args.platforms || [], goal: 'awareness', tone: 'engaging' },
                };
                return {
                  ...base, updatedAt: Date.now(), phase: 'researching',
                  researchResults: {
                    ...(base.researchResults || {} as any),
                    trends: trendData.trends || [],
                    hashtags: trendData.hashtags || [],
                    audienceInsights: trendData.audienceInsights || '',
                    researchedAt: Date.now(),
                    seoKeywords: base.researchResults?.seoKeywords || [],
                    bestPostingTimes: base.researchResults?.bestPostingTimes || {},
                  }
                };
              });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`🔍 Researching trends for **${args.niche}** on ${(args.platforms || []).join(', ') || 'all platforms'}…`, `✅ **Trend Research Complete**: Found ${trendData.trends?.length || 0} trends, ${trendData.hashtags?.length || 0} hashtags for *${args.niche}*.`) } : m));

            } else if (fc.name === 'research_seo_keywords') {
              setIsThinking(true);
              setThinkingProcess('🔑 Researching SEO keywords and search volumes…');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n🔑 Researching SEO keywords for **${args.topic}**…` } : m));
              const seoRes = await authFetch(`/api/marketing?op=seo-keywords`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic: args.topic, niche: args.niche || '', targetAudience: args.targetAudience || '' })
              });
              const seoData = await seoRes.json();
              setIsThinking(false);
              setMarketingSession(prev => {
                if (!prev) return prev;
                return {
                  ...prev, updatedAt: Date.now(),
                  researchResults: {
                    ...(prev.researchResults || {} as any),
                    seoKeywords: [
                      ...(seoData.primaryKeywords?.map((k: any) => k.keyword) || []),
                      ...(seoData.longTailKeywords || []),
                    ],
                    hashtags: [...new Set([...(prev.researchResults?.hashtags || []), ...(seoData.hashtagKeywords || [])])],
                    researchedAt: Date.now(),
                    trends: prev.researchResults?.trends || [],
                    bestPostingTimes: prev.researchResults?.bestPostingTimes || {},
                  }
                };
              });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`🔑 Researching SEO keywords for **${args.topic}**…`, `✅ **SEO Research Complete**: Found ${seoData.primaryKeywords?.length || 0} primary keywords and ${seoData.longTailKeywords?.length || 0} long-tail variations.`) } : m));

            } else if (fc.name === 'get_best_posting_times') {
              setIsThinking(true);
              setThinkingProcess('⏰ Finding optimal posting windows per platform…');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n⏰ Finding best posting times for ${(args.platforms || []).join(', ')}…` } : m));
              const timeRes = await authFetch(`/api/marketing?op=best-posting-times`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platforms: args.platforms || [], niche: args.niche || '', goal: args.goal || 'engagement' })
              });
              const timeData = await timeRes.json();
              setIsThinking(false);
              setMarketingSession(prev => {
                if (!prev) return prev;
                return {
                  ...prev, updatedAt: Date.now(),
                  researchResults: {
                    ...(prev.researchResults || {} as any),
                    bestPostingTimes: timeData.postingTimes || {},
                    trends: prev.researchResults?.trends || [],
                    hashtags: prev.researchResults?.hashtags || [],
                    seoKeywords: prev.researchResults?.seoKeywords || [],
                    researchedAt: Date.now(),
                  }
                };
              });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`⏰ Finding best posting times for ${(args.platforms || []).join(', ')}…`, `✅ **Posting Windows Identified** for ${Object.keys(timeData.postingTimes || {}).length} platforms. ${timeData.nicheInsight || ''}`) } : m));

            } else if (fc.name === 'analyze_brand_file') {
              const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
              const lastAnalyzed = marketingSession?.brandContext?.analyzedAt?.[args.fileName] || 0;
              const isStale = Date.now() - lastAnalyzed > STALE_THRESHOLD_MS;
              if (!args.forceReanalyze && !isStale && marketingSession?.brandContext?.fileAnalyses?.[args.fileName]) {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n✅ **${args.fileName}** — using cached brand analysis (analyzed < 24h ago).` } : m));
              } else {
                setIsThinking(true);
                setThinkingProcess(`🎨 Extracting brand context from ${args.fileName}…`);
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n🎨 Analyzing brand file: **${args.fileName}**…` } : m));
                const brandRes = await authFetch(`/api/marketing?op=analyze-brand-file`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fileName: args.fileName, fileUrl: args.fileUrl, fileType: args.fileType, projectId: args.projectId })
                });
                const brandData = await brandRes.json();
                setIsThinking(false);
                setMarketingSession(prev => {
                  const base: MarketingSession = prev ?? {
                    id: crypto.randomUUID(), createdAt: Date.now(), updatedAt: Date.now(),
                    phase: 'briefing',
                    brief: { businessName: '', niche: '', targetAudience: '', platforms: [], goal: 'awareness', tone: 'engaging' },
                  };
                  const existing = base.brandContext || {};
                  const bctx = brandData.brandContext || {};
                  return {
                    ...base, updatedAt: Date.now(),
                    brandContext: {
                      colors: bctx.colors || existing.colors,
                      tone: bctx.tone || existing.tone,
                      keyMessages: [...new Set([...(existing.keyMessages || []), ...(bctx.keyMessages || [])])],
                      logoDescription: bctx.logoDescription || existing.logoDescription,
                      audioDescription: bctx.audioDescription || existing.audioDescription,
                      visualStyle: bctx.visualStyle || existing.visualStyle,
                      fileAnalyses: { ...(existing.fileAnalyses || {}), [args.fileName]: brandData.analysis },
                      analyzedAt: { ...(existing.analyzedAt || {}), [args.fileName]: Date.now() },
                    }
                  };
                });
                const bc = brandData.brandContext || {};
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`🎨 Analyzing brand file: **${args.fileName}**…`, `✅ **Brand Analysis Complete** for *${args.fileName}*: Tone: *${bc.tone || 'N/A'}* | Colors: ${(bc.colors || []).join(', ') || 'N/A'}`) } : m));
              }

            } else if (fc.name === 'build_campaign_plan') {
              setMarketingSession(prev => prev ? { ...prev, phase: 'planning', updatedAt: Date.now() } : prev);
              setIsThinking(true);
              setThinkingProcess('🗺️ Building your campaign plan…');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n🗺️ Building campaign plan…' } : m));
              const planRes = await authFetch(`/api/marketing?op=campaign-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  brief: args.brief || marketingSession?.brief,
                  brandContext: marketingSession?.brandContext,
                  researchResults: marketingSession?.researchResults,
                })
              });
              const planData = await planRes.json();
              setIsThinking(false);
              if (planData.error) throw new Error(planData.error);
              const pieces = planData.contentPieces?.map((p: any) => ({ ...p, id: p.id || crypto.randomUUID(), status: 'pending' })) || [];
              setMarketingSession(prev => ({
                ...(prev ?? { id: crypto.randomUUID(), createdAt: Date.now(), brief: args.brief || { businessName: '', niche: '', targetAudience: '', platforms: [], goal: 'awareness', tone: 'engaging' } }),
                updatedAt: Date.now(), phase: 'generating',
                campaignPlan: { ...planData, contentPieces: pieces },
              } as MarketingSession));
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('🗺️ Building campaign plan…', `✅ **Campaign Plan Built!** ${pieces.length} content pieces planned across ${new Set(pieces.map((p: any) => p.platform)).size} platforms. Check the Campaign Center panel for details.`) } : m));
              generateAllCampaignAssets(pieces, marketingSession?.brandContext);

            } else if (fc.name === 'generate_all_assets') {
              if (marketingSession?.campaignPlan?.contentPieces) {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n⏳ Generating all campaign assets in parallel...' } : m));
                generateAllCampaignAssets(marketingSession.campaignPlan.contentPieces, marketingSession.brandContext);
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('⏳ Generating all campaign assets in parallel...', '✅ Batch generation started!') } : m));
              } else {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n⚠️ No campaign plan piece found. Call build_campaign_plan first.' } : m));
              }

            } else if (fc.name === 'generate_ad_copy') {
              setIsThinking(true);
              setThinkingProcess(`✍️ Writing ${args.platform} ad copy…`);
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n✍️ Writing ${args.platform} ${args.contentType} copy…` } : m));
              // Use Gemini directly (via generateContentStream already ran) — the text is in fullText
              // here we build from args for quick targeted generation
              const copyRes = await authFetch(`/api/marketing?op=campaign-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  brief: {
                    businessName: marketingSession?.brief?.businessName || args.niche || '',
                    niche: args.niche || marketingSession?.brief?.niche || '',
                    targetAudience: marketingSession?.brief?.targetAudience || '',
                    platforms: [args.platform],
                    goal: marketingSession?.brief?.goal || 'engagement',
                    tone: args.tone || marketingSession?.brief?.tone || 'engaging',
                  },
                  brandContext: marketingSession?.brandContext,
                  researchResults: marketingSession?.researchResults,
                })
              });
              const copyData = await copyRes.json();
              setIsThinking(false);
              const adPiece = copyData.contentPieces?.[0];
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`✍️ Writing ${args.platform} ${args.contentType} copy…`, `✅ **Ad Copy for ${args.platform}**:\n\n${adPiece?.caption || 'Caption generated.'}\n\n${(adPiece?.hashtags || []).join(' ')}`) } : m));

            } else if (fc.name === 'generate_content_calendar') {
              setIsThinking(true);
              setThinkingProcess('📅 Generating content calendar…');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n📅 Generating ${args.durationDays}-day content calendar…` } : m));
              const startTs = args.startDate ? new Date(args.startDate).getTime() : Date.now();
              const plan = marketingSession?.campaignPlan;
              if (plan) {
                const postingTimes = marketingSession?.researchResults?.bestPostingTimes || {};
                const pieces = plan.contentPieces || [];
                const scheduledPosts = pieces.map((piece: ContentPiece, i: number) => {
                  const dayOffset = Math.floor((i / pieces.length) * args.durationDays) * 86400000;
                  const platformTimes = postingTimes[piece.platform] || [];
                  const bestTime = platformTimes[0];
                  let scheduledAt = startTs + dayOffset;
                  if (bestTime?.timeRange) {
                    const hourMatch = bestTime.timeRange.match(/(\d+)(am|pm)/i);
                    if (hourMatch) {
                      let hour = parseInt(hourMatch[1]);
                      if (hourMatch[2].toLowerCase() === 'pm' && hour !== 12) hour += 12;
                      const d = new Date(scheduledAt);
                      d.setHours(hour, 0, 0, 0);
                      scheduledAt = d.getTime();
                    }
                  }
                  return {
                    id: crypto.randomUUID(),
                    contentPieceId: piece.id,
                    caption: piece.caption,
                    hashtags: piece.hashtags,
                    platform: piece.platform,
                    scheduledAt,
                    status: 'scheduled' as const,
                    assetUrl: piece.assetUrl,
                  };
                });
                setMarketingSession(prev => prev ? { ...prev, updatedAt: Date.now(), phase: 'publishing', scheduledPosts } : prev);
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`📅 Generating ${args.durationDays}-day content calendar…`, `✅ **Content Calendar Created!** ${scheduledPosts.length} posts scheduled over ${args.durationDays} days. Check the Schedule tab in the Campaign Center.`) } : m));
              } else {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`📅 Generating ${args.durationDays}-day content calendar…`, `⚠️ No campaign plan found yet. Please run **build_campaign_plan** first.`) } : m));
              }
              setIsThinking(false);

            } else if (fc.name === 'generate_carousel') {
              setIsThinking(true);
              setThinkingProcess(`🎠 Generating ${args.slideCount}-slide carousel for ${args.platform}…`);
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n🎠 Generating ${args.slideCount}-slide carousel for **${args.platform}**: *${args.topic}*…` } : m));
              const slideUrls: string[] = [];
              for (let i = 0; i < (args.slideCount || 5); i++) {
                const slidePrompt = `Slide ${i + 1} of ${args.slideCount} for a ${args.platform} carousel about "${args.topic}". Style: ${args.style || 'modern minimal'}. ${i === 0 ? 'Cover slide with bold title.' : i === args.slideCount - 1 ? 'Final slide with call to action.' : `Slide showing key point ${i + 1}.`} Brand colors: ${(marketingSession?.brandContext?.colors || ['#6366f1']).join(', ')}.`;
                try {
                  if (i < 5) { // limit to 5 images to avoid excessive generation
                    const { imageDataUrl } = await generateImage(slidePrompt, { aspectRatio: '1:1' });
                    const url = await uploadToBlob(dataUrlToBlob(imageDataUrl), `carousel-${Date.now()}-${i}.png`);
                    slideUrls.push(url);
                  }
                } catch { /* skip slide on error */ }
              }
              setIsThinking(false);
              const firstUrl = slideUrls[0];
              if (firstUrl) setLastGeneratedAsset({ type: 'image', url: firstUrl, publicUrl: firstUrl, name: `Carousel – ${args.topic}`, timestamp: Date.now() });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, imageUrl: firstUrl, text: m.text.replace(`🎠 Generating ${args.slideCount}-slide carousel for **${args.platform}**: *${args.topic}*…`, `✅ **Carousel Generated** (${slideUrls.length} slides) for ${args.platform}: ${slideUrls.map((u, i) => `[Slide ${i + 1}](${u})`).join(' · ')}`) } : m));

            } else if (fc.name === 'reschedule_post') {
              const newTs = new Date(args.newScheduledAt).getTime();
              setMarketingSession(prev => {
                if (!prev?.scheduledPosts) return prev;
                return {
                  ...prev, updatedAt: Date.now(),
                  scheduledPosts: prev.scheduledPosts.map(p =>
                    p.id === args.postId ? { ...p, scheduledAt: newTs } : p
                  )
                };
              });
              // Also update in backend scheduler
              try {
                await authFetch('/api/social?op=schedule-update', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ postId: args.postId, scheduledAt: newTs, platform: args.platform })
                });
              } catch { /* best-effort */ }
              const newDateStr = new Date(newTs).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n📅 Post rescheduled to **${newDateStr}**` + (args.platform ? ` on ${args.platform}` : '') + `.` } : m));

            } else if (fc.name === 'edit_scheduled_post') {
              updateSessionContentPiece(args.postId, {
                ...(args.newCaption ? { caption: args.newCaption } : {}),
                ...(args.newHashtags ? { hashtags: args.newHashtags } : {}),
              });
              if (args.editImageInstruction) {
                const piece = marketingSession?.campaignPlan?.contentPieces?.find(p => p.id === args.postId);
                const imgUrl = piece?.assetUrl || (lastGeneratedAsset?.type === 'image' ? lastGeneratedAsset.url : undefined);
                if (imgUrl) {
                  setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n🎨 Editing image for post…` } : m));
                  const imageRef = await ensureImageRef(imgUrl);
                  const { imageDataUrl } = await editImageWithReferences(args.editImageInstruction, [imageRef]);
                  const newUrl = await uploadToBlob(dataUrlToBlob(imageDataUrl), `edit-post-${Date.now()}.png`);
                  updateSessionContentPiece(args.postId, { assetUrl: newUrl });
                  setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, imageUrl: newUrl, text: m.text.replace('🎨 Editing image for post…', '✅ Post image updated.') } : m));
                }
              }
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n✅ Post updated.` } : m));
            } else if (fc.name === 'create_project') {
              setIsThinking(true);
              setThinkingProcess('🚀 Creating your project with AI-generated content…');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n🚀 Creating project with AI-generated notes, tasks, and research topics…' } : m));
              try {
                const plan = await generateMagicProjectPlan(args.prompt);
                let rawName = (plan.projectName || '').trim() || args.prompt;
                let rawDesc = (plan.projectDescription || '').trim() || args.prompt;
                const safeName = rawName === args.prompt ? `${args.prompt} – Research Project` : rawName.slice(0, 120);
                const safeDesc = rawDesc === args.prompt ? `Deep research project exploring: ${args.prompt}` : rawDesc;

                let seoSeedKeywords: string[] = [];
                let agent: any;
                try {
                  [seoSeedKeywords, agent] = await Promise.all([
                    generateSeoSeedKeywords(safeName, safeDesc, 5).catch(() => [] as string[]),
                    classifyProjectAgent(safeName, safeDesc).catch(() => undefined),
                  ]);
                } catch { /* best-effort */ }

                const newProject = await storageService.createResearchProject(safeName, safeDesc, { seoSeedKeywords, agent });

                // Seed tasks
                const tasksToAdd = (plan.tasks || []).slice(0, 8);
                for (const t of tasksToAdd) {
                  try { await storageService.addTask(newProject.id, { title: t.title, description: t.description, status: 'todo', priority: t.priority, aiGenerated: true, sourceResearchId: undefined, tags: [] }); } catch { /* skip */ }
                }

                // Seed notes
                const notesToAdd = (plan.initialNotes || []).slice(0, 6);
                for (const n of notesToAdd) {
                  try { await storageService.addNote(newProject.id, { title: n.title, content: n.content, color: undefined, pinned: false, aiGenerated: true, aiSuggestions: [], tags: [], linkedResearchId: undefined }); } catch { /* skip */ }
                }

                // Seed draft research topics
                let draftTopics: string[] = Array.isArray(plan.researchDraftTopics) ? plan.researchDraftTopics.map((t: any) => String(t).trim()).filter(Boolean) : [];
                if (draftTopics.length < 5) {
                  try { const extra = await generateDraftResearchTopicsAlt(safeName, safeDesc, draftTopics); draftTopics = [...draftTopics, ...extra].slice(0, 8); } catch { /* skip */ }
                }
                if (draftTopics.length > 0) {
                  const now = Date.now();
                  const drafts = draftTopics.map((topic, i) => ({ id: crypto.randomUUID(), topic, createdAt: now + i }));
                  try { await storageService.updateResearchProject(newProject.id, { draftResearchSessions: drafts }); } catch { /* skip */ }
                }

                setIsThinking(false);
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('🚀 Creating project with AI-generated notes, tasks, and research topics…', `✅ **Project Created: "${safeName}"**\n\nI've generated ${tasksToAdd.length} tasks, ${notesToAdd.length} notes, and ${draftTopics.length} research draft topics for you. Taking you there now...`) } : m));
                
                // Redirect to the newly created project for seamless handoff
                setTimeout(() => {
                   window.location.href = `/project/${newProject.id}`;
                }, 1500);
              } catch (projErr: any) {
                setIsThinking(false);
                throw projErr;
              }
            } else if (fc.name === 'search_phone_numbers') {
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n🔎 Searching for phone numbers in area code **${args.areaCode}**...` } : m));
              const res = await authFetch('/api/agent?op=search-numbers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ areaCode: args.areaCode })
              });
              const data = await res.json();
              if (data.numbers && data.numbers.length > 0) {
                const numList = data.numbers.slice(0, 5).map((n: any) => `- **${n.friendlyName}** (${n.phoneNumber})`).join('\n');
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`🔎 Searching for phone numbers in area code **${args.areaCode}**...`, `✅ Found available numbers in **${args.areaCode}**:\n\n${numList}\n\nWhich one would you like to purchase for 400 credits?`) } : m));
              } else {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`🔎 Searching for phone numbers in area code **${args.areaCode}**...`, `❌ No numbers found in area code **${args.areaCode}**. Try a different one?`) } : m));
              }
            } else if (fc.name === 'purchase_phone_number') {
              const canAfford = await checkCredits('phoneProvisioning');
              if (!canAfford) return;

              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n💳 Purchasing number **${args.phoneNumber}**...` } : m));
              
              const res = await authFetch('/api/agent?op=buy-number', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  phoneNumber: args.phoneNumber,
                  existingConfig: userProfile?.agentPhoneConfig 
                })
              });
              const data = await res.json();

              if (data.success) {
                await deductCredits('phoneProvisioning');
                const profile = await storageService.getUserProfile();
                if (profile) setUserProfile(profile);
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`💳 Purchasing number **${args.phoneNumber}**...`, `✅ **Purchase Successful!** Your new AI Phone Line is: **${args.phoneNumber}**.\n\n400 credits have been deducted. Would you like to configure your agent instructions or lead capture settings now?`) } : m));
              } else {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`💳 Purchasing number **${args.phoneNumber}**...`, `❌ **Purchase Failed**: ${data.error || 'Unknown error. Please try again or pick a different number.'}`) } : m));
              }
            } else if (fc.name === 'configure_phone_agent') {
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n⚙️ Updating Phone Agent configuration...' } : m));
              
              const currentConfig = userProfile?.agentPhoneConfig || {} as PhoneAgentConfig;
              const newConfig: PhoneAgentConfig = {
                ...currentConfig,
                enabled: args.enabled !== undefined ? args.enabled : (currentConfig.enabled ?? true),
                ...(args.systemPrompt !== undefined ? { systemPrompt: args.systemPrompt } : {}),
                ...(args.welcomeGreeting !== undefined ? { welcomeGreeting: args.welcomeGreeting } : {}),
                ...(args.leadCaptureEnabled !== undefined ? { leadCaptureEnabled: args.leadCaptureEnabled } : {}),
                ...(args.leadFields !== undefined ? { leadFields: args.leadFields } : {}),
              };

              await storageService.updateUserProfile({ agentPhoneConfig: newConfig });
              const profile = await storageService.getUserProfile();
              if (profile) setUserProfile(profile);

              const modeLabel = newConfig.leadCaptureEnabled ? 'Lead Capture' : 'Personal Assistant';
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('⚙️ Updating Phone Agent configuration...', `✅ **Phone Agent Updated!** Mode set to: **${modeLabel}**.\n\nSettings have been synced to your profile. Any calls to your AI Phone Line will use these new instructions.`) } : m));
            }
            // ─── End Marketing Agent Handlers ─────────────────────────────────

          } catch (err: any) {
            console.error(`Error executing tool ${fc.name}:`, err);
            setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n❌ Tool error: ${err.message}` } : m));
          }
        }
      }

      setMessages(prev =>
        prev.map(msg =>
          msg.id === streamingMessageId ? { ...msg, isGenerating: false } : msg
        )
      );

      if (!fullText.trim() && aggregatedFunctionCalls.length === 0) {
        const fallbackText = 'I was unable to generate a response. Please try asking in a different way.';
        setMessages(prev =>
          prev.map(msg =>
            msg.id === streamingMessageId ? { ...msg, text: fallbackText } : msg
          )
        );
      }
    } catch (e) {
      console.error('Home chat error:', e);
      setError('Failed to get response. Please try again.');
      setIsProcessing(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleModeChange = (newMode: AssistantMode) => {
    if (newMode === mode) return;
    if (mode === 'voice' && connectionStatus === 'connected') {
      disconnectVoice();
    }
    setMode(newMode);
    setError(null);
  };

  const handleClearChat = useCallback(() => {
    if (messages.length === 0) return;
    if (!confirm('Clear all conversation history? This cannot be undone.')) return;
    setMessages([]);
    setTranscriptBuffer('');
    setUserTranscriptBuffer('');
  }, [messages.length]);

  useEffect(() => {
    return () => {
      disconnectVoice();
    };
  }, []);

  const totalProjects = projects.length;
  const totalResearch = projects.reduce((acc, p) => acc + (p.researchSessions?.length || 0), 0);
  const totalNotes = projects.reduce((acc, p) => acc + (p.notes?.length || 0), 0);
  const totalTasks = projects.reduce((acc, p) => acc + (p.tasks?.length || 0), 0);

  return (
    <div className="fixed inset-0 sm:inset-auto sm:bottom-6 sm:right-6 z-[10000] pointer-events-none flex sm:block items-end justify-center sm:justify-end">
      <div
        className={`pointer-events-auto w-full h-full sm:w-[360px] sm:h-[560px] rounded-none sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden border backdrop-blur-2xl transition-transform duration-200
          ${isDarkMode ? 'bg-[#050509]/80 border-white/10' : 'bg-white/80 border-black/10'}`}
      >
        <header className={`flex items-center justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b ${isDarkMode ? 'border-white/10 bg-black/5' : 'border-gray-200 bg-gray-50/50'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <AnimatedEyeIcon
              className="w-9 h-9 sm:w-10 sm:h-10 flex-shrink-0 animate-fly-in-icon bg-[#0a84ff] text-white"
            />
            <div className="min-w-0">
              <h2 className={`font-semibold text-sm sm:text-base flex items-center gap-2 truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Home AI Assistant
                {social && (
                  <div className="flex items-center gap-1 opacity-70">
                    {social.facebookConnected && <span title="Facebook/Instagram Connected">📘</span>}
                    {social.xConnected && <span title="X Connected">𝕏</span>}
                    {social.tiktokConnected && <span title="TikTok Connected">🎵</span>}
                    {social.linkedinConnected && <span title="LinkedIn Connected">💼</span>}
                    {social.youtubeConnected && <span title="YouTube Connected">▶️</span>}
                  </div>
                )}
              </h2>
              <p className={`text-[10px] sm:text-xs truncate ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                {totalProjects} projects, {totalResearch} research, {totalNotes} notes, {totalTasks} tasks
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {mode === 'voice' && connectionStatus === 'connected' ? (
              <button
                onClick={disconnectVoice}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium bg-[#ff453a] hover:bg-[#ff5a4f] text-white transition-all active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                End
              </button>
            ) : (
              <div className={`flex items-center gap-0.5 p-1 rounded-full ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'}`}>
                <button
                  onClick={() => handleModeChange('chat')}
                  className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${mode === 'chat'
                    ? 'bg-[#0a84ff] text-white'
                    : isDarkMode
                      ? 'text-[#86868b] hover:text-white'
                      : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => handleModeChange('voice')}
                  className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${mode === 'voice'
                    ? 'bg-[#0a84ff] text-white'
                    : isDarkMode
                      ? 'text-[#86868b] hover:text-white'
                      : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  Voice
                </button>
                <button
                  onClick={() => handleModeChange('video')}
                  className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${mode === 'video'
                    ? 'bg-[#0a84ff] text-white'
                    : isDarkMode
                      ? 'text-[#86868b] hover:text-white'
                      : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  Video
                </button>
              </div>
            )}

            {messages.length > 0 && (
              <button
                onClick={handleClearChat}
                className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-[#2d2d2f] text-[#86868b] hover:text-white' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-900'}`}
                title="Clear conversation"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}

            <button
              onClick={onClose}
              className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-[#2d2d2f] text-[#86868b] hover:text-white' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-900'}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        {mode === 'chat' ? (
          <>
            <div className={`flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 space-y-4 ${isDarkMode ? 'bg-[#000000]' : 'bg-gray-50'}`}>
              {messages.length === 0 && (
                <div className="text-center py-6 sm:py-8">
                  <div className={`${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'} w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center`}>
                    <svg className={`${isDarkMode ? 'text-[#424245]' : 'text-gray-400'} w-7 h-7 sm:w-8 sm:h-8`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <h3 className={`${isDarkMode ? 'text-white' : 'text-gray-900'} text-base sm:text-lg font-semibold mb-2`}>
                    Ask across all projects
                  </h3>
                  <p className={`${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'} text-xs sm:text-sm max-w-md mx-auto px-4`}>
                    I can see all of your projects, research sessions, notes, tasks, and assets. Ask questions that span multiple projects or compare them.
                  </p>
                </div>
              )}

              {messages.map(message => {
                if (message.role === 'model' && !(message.text || '').trim() && !message.imageUrl && !message.audioUrl && !message.computerUseGoal) {
                  return null;
                }

                // Render inline Computer Use viewer for browser automation messages
                if (message.computerUseGoal) {
                  return (
                    <div key={message.id} className="w-full">
                      <ComputerUseViewer
                        goal={message.computerUseGoal}
                        isDarkMode={isDarkMode}
                        onComplete={(result) => {
                          setMessages(prev =>
                            prev.map(m =>
                              m.id === message.id
                                ? { ...m, text: `✅ Browser automation completed:\n\n${result}`, computerUseGoal: undefined }
                                : m
                            )
                          );
                          setActiveComputerUseMessageId(null);
                        }}
                        onCancel={() => {
                          setMessages(prev =>
                            prev.map(m =>
                              m.id === message.id
                                ? { ...m, text: '❌ Browser automation was cancelled.', computerUseGoal: undefined }
                                : m
                            )
                          );
                          setActiveComputerUseMessageId(null);
                        }}
                        onError={(err) => {
                          setMessages(prev =>
                            prev.map(m =>
                              m.id === message.id
                                ? { ...m, text: `⚠️ Browser automation failed: ${err}`, computerUseGoal: undefined }
                                : m
                            )
                          );
                          setActiveComputerUseMessageId(null);
                        }}
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-4 py-3 ${message.role === 'user'
                        ? 'bg-[#0a84ff] text-white'
                        : isDarkMode
                          ? 'bg-[#2d2d2f] text-[#e5e5ea]'
                          : 'bg-gray-200 text-gray-900'
                        }`}
                    >
                      <div className="text-sm overflow-x-auto" style={{ wordWrap: 'break-word', overflowWrap: 'break-word' }}>
                        <ReactMarkdown className={`${isDarkMode ? 'prose prose-invert' : 'prose'} max-w-none prose-pre:overflow-x-auto prose-code:break-all`}>
                          {message.text}
                        </ReactMarkdown>

                        {message.imageUrl && (
                          <div className="mt-3 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 shadow-sm">
                            <img src={message.imageUrl} alt="Generated asset" className="w-full h-auto max-h-[400px] object-cover" />
                          </div>
                        )}

                        {message.videoUrl && (
                          <div className="mt-3 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-black shadow-sm">
                            <video src={message.videoUrl} controls className="w-full h-auto max-h-[400px]" />
                          </div>
                        )}

                        {message.audioUrl && (
                          <div className="mt-3">
                            <audio src={message.audioUrl} controls className="w-full" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {isProcessing && !messages.some(m => m.role === 'model' && m.isGenerating && (m.text || '').trim()) && (
                <div className="flex justify-start">
                  <div className={`${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'} rounded-2xl px-4 py-3`}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 bg-[#0a84ff] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-[#0a84ff] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-[#0a84ff] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Thought Process Display */}
              {isThinking && (
                <div className="mb-4">
                  <ThoughtProcess
                    thought={thinkingProcess}
                    isThinking={isThinking}
                    intent={plannerIntent || undefined}
                  />
                </div>
              )}

              {/* ─── Marketing Agent Campaign Center Panel ──────────────────── */}
              {(isMarketingMode || marketingSession) && (
                <div className="mt-4">
                  <MarketingAgentPanel
                    session={marketingSession}
                    isDarkMode={isDarkMode}
                    isProcessing={isProcessing}
                    onPublishPost={async (post) => {
                      try {
                        await executeSchedulePost(
                          {
                            platforms: [post.platform],
                            scheduledAt: new Date(post.scheduledAt).toISOString(),
                            contentType: 'text',
                            text: post.caption,
                            mediaUrl: post.assetUrl
                          },
                          addMessage,
                          (id) => {
                            console.log('Post published:', id);
                          }
                        );
                        setMarketingSession(prev => {
                          if (!prev?.scheduledPosts) return prev;
                          return {
                            ...prev,
                            updatedAt: Date.now(),
                            scheduledPosts: prev.scheduledPosts.map(p =>
                              p.id === post.id ? { ...p, status: 'published' } : p
                            )
                          };
                        });
                      } catch (e: any) {
                        setError(`Failed to publish post: ${e.message}`);
                      }
                    }}
                    onClearSession={() => {
                      setMarketingSession(null);
                      setIsMarketingMode(false);
                      localStorage.removeItem('marketing_session_home');
                    }}
                    onUpdateContentPiece={(pieceId, updates) => updateSessionContentPiece(pieceId, updates)}
                    onEditAsset={handleEditAsset}
                    onRegenerateAsset={handleRegenerateAsset}
                    onReschedulePost={handleReschedulePost}
                  />
                </div>
              )}
              {/* ──────────────────────────────────────────────────────────── */}

              <div ref={messagesEndRef} />

            </div>

            {error && (
              <div className="px-4 sm:px-5 py-2 bg-[#ff453a]/10 border-t border-[#ff453a]/20">
                <p className="text-xs sm:text-sm text-[#ff453a]">{error}</p>
              </div>
            )}
          </>
        ) : (
          <>
            {connectionStatus === 'connected' ? (
              <div className={`flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 ${isDarkMode ? 'bg-[#000000]' : 'bg-gray-50'}`}>
                {messages.length === 0 && (
                  <div className="text-center py-6 sm:py-8">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center bg-[#0a84ff]/20">
                      <svg className="w-7 h-7 sm:w-8 sm:h-8 text-[#0a84ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    </div>
                    <h3 className={`${isDarkMode ? 'text-white' : 'text-gray-900'} text-base sm:text-lg font-semibold mb-2`}>
                      {isSpeaking ? 'Speaking...' : 'Listening...'}
                    </h3>
                    <p className={`${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'} text-xs sm:text-sm max-w-md mx-auto px-4`}>
                      Start talking to ask questions across all of your projects.
                    </p>
                  </div>
                )}

                {messages.map(message => {
                  if (message.role === 'model' && message.isGenerating && !(message.text || '').trim()) {
                    return null;
                  }

                  return (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-4 py-3 ${message.role === 'user'
                          ? 'bg-[#0a84ff] text-white'
                          : isDarkMode
                            ? 'bg-[#2d2d2f] text-[#e5e5ea]'
                            : 'bg-gray-200 text-gray-900'
                          }`}
                      >
                        <div className="text-sm">
                          <ReactMarkdown className={isDarkMode ? 'prose prose-invert max-w-none' : 'prose max-w-none'}>
                            {message.text}
                          </ReactMarkdown>

                          {message.imageUrl && (
                            <div className="mt-3 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 shadow-sm">
                              <img src={message.imageUrl} alt="Generated asset" className="w-full h-auto max-h-[400px] object-cover" />
                            </div>
                          )}

                          {message.videoUrl && (
                            <div className="mt-3 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-black shadow-sm">
                              <video src={message.videoUrl} controls className="w-full h-auto max-h-[400px]" />
                            </div>
                          )}

                          {message.audioUrl && (
                            <div className="mt-3">
                              <audio src={message.audioUrl} controls className="w-full" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {isSpeaking && (
                  <div className="flex justify-start">
                    <div className={`${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'} rounded-2xl px-4 py-3`}>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 bg-[#0a84ff] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-[#0a84ff] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-[#0a84ff] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            ) : (
              <div className={`flex-1 overflow-y-auto flex flex-col items-center justify-center ${isDarkMode ? 'bg-[#000000]' : 'bg-gray-50'}`}>
                {mode === 'video' && (
                  <div className="relative w-full aspect-video bg-black overflow-hidden flex items-center justify-center">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-cover transition-opacity duration-300 ${isVideoLoading ? 'opacity-0' : 'opacity-100'}`}
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    {isVideoLoading && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-8 h-8 border-4 border-[#0a84ff] border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                    <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center z-10">
                      <div className="px-2 py-1 rounded bg-black/50 backdrop-blur-md text-[10px] text-white font-medium uppercase tracking-wider flex items-center gap-1.5 border border-white/10">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        Live Feed
                      </div>
                    </div>
                  </div>
                )}

                <div className="p-6 sm:p-8 flex-1 flex flex-col items-center justify-center">
                  <div className="p-0 sm:p-0 flex flex-col items-center text-center space-y-5 sm:space-y-6">
                    <div className="relative flex items-center justify-center mx-auto">
                      <div
                        className={`w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center transition-all duration-300 ${connectionStatus === 'connecting'
                          ? 'bg-[#ff9f0a]/50 animate-pulse'
                          : isDarkMode
                            ? 'bg-[#2d2d2f]'
                            : 'bg-gray-200'
                          }`}
                      >
                        <span className="text-4xl sm:text-5xl">
                          {connectionStatus === 'connecting' ? '🔄' : mode === 'video' ? '📹' : '🎙️'}
                        </span>
                      </div>
                    </div>

                    <div>
                      <h3 className={`${isDarkMode ? 'text-white' : 'text-gray-900'} text-lg sm:text-xl font-semibold mb-2`}>
                        {connectionStatus === 'connecting' ? 'Connecting...' : mode === 'video' ? 'Video Mode' : 'Voice Mode'}
                      </h3>
                      <p className={`${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'} text-xs sm:text-sm max-w-sm mx-auto px-4`}>
                        {mode === 'video'
                          ? 'Share your camera and have a real-time conversation about what you see.'
                          : 'Start a real-time conversation about anything across your projects.'}
                      </p>
                    </div>

                    {error && (
                      <p className="text-xs sm:text-sm text-[#ff453a] bg-[#ff453a]/10 px-4 py-2 rounded-xl">{error}</p>
                    )}

                    <button
                      onClick={() => connectVoice(mode)}
                      disabled={connectionStatus === 'connecting'}
                      className="flex items-center gap-2 bg-[#0a84ff] hover:bg-[#0b8cff] text-white font-medium py-3 px-5 sm:px-6 rounded-full transition-all active:scale-95 disabled:opacity-50 text-sm sm:text-base"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                      {connectionStatus === 'connecting' ? 'Connecting...' : 'Start'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div className={`p-3 sm:p-4 border-t safe-area-pb ${isDarkMode ? 'border-[#3d3d3f]/50 bg-[#1d1d1f]' : 'border-gray-200 bg-white'}`}>
          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingAttachments.map(att => (
                <div
                  key={att.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] border ${isDarkMode ? 'border-[#3d3d3f]/60 bg-black/20 text-white' : 'border-gray-200 bg-gray-50 text-gray-900'}`}
                  title={att.status === 'error' ? (att.error || 'Upload failed') : (att.uploaded?.uri || att.file.name)}
                >
                  {att.previewUrl && (
                    <img
                      src={att.previewUrl}
                      alt={att.uploaded?.displayName || att.file.name}
                      className="w-6 h-6 rounded object-cover flex-shrink-0"
                    />
                  )}
                  <span className="max-w-[160px] truncate">{att.uploaded?.displayName || att.file.name}</span>
                  <span
                    className={`${att.status === 'ready' ? 'text-green-500' : att.status === 'error' ? 'text-red-500' : (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}`}
                  >
                    {att.status === 'uploading' ? 'Uploading…' : att.status === 'ready' ? 'Ready' : 'Error'}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    className={`px-1.5 py-0.5 rounded-full ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                    aria-label="Remove attachment"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 sm:gap-3">
            <input
              ref={attachmentsInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.txt,.csv,.json"
              className="hidden"
              onChange={(e) => {
                void handlePickAttachments(e.target.files);
                if (attachmentsInputRef.current) attachmentsInputRef.current.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => attachmentsInputRef.current?.click()}
              disabled={isProcessing || isUploadingAttachments}
              className={`p-3 rounded-xl sm:rounded-2xl transition-all active:scale-95 flex-shrink-0 border ${isDarkMode ? 'bg-[#2d2d2f] text-white border-[#3d3d3f]/50 hover:bg-[#3d3d3f]' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'} disabled:opacity-50 disabled:cursor-not-allowed`}
              title="Attach files"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.44 11.05l-8.49 8.49a5 5 0 01-7.07-7.07l8.49-8.49a3.5 3.5 0 114.95 4.95l-8.84 8.84a2 2 0 11-2.83-2.83l8.49-8.49" />
              </svg>
            </button>
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={mode === 'voice' ? 'Type a message to the live assistant…' : 'Ask about your projects...'}
              rows={1}
              className={`flex-1 resize-none rounded-xl sm:rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a84ff] border ${isDarkMode
                ? 'bg-[#2d2d2f] text-white placeholder-[#636366] border-[#3d3d3f]/50'
                : 'bg-gray-100 text-gray-900 placeholder-gray-500 border-gray-300'
                }`}
              style={{ minHeight: '44px', maxHeight: '120px' }}
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={(!inputText.trim() && readyAttachments.length === 0) || isProcessing || isUploadingAttachments}
              className="p-3 bg-[#0a84ff] hover:bg-[#0b8cff] text-white rounded-xl sm:rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {insufficientCreditsModal?.isOpen && (
        <InsufficientCreditsModal
          isOpen={insufficientCreditsModal.isOpen}
          onClose={() => setInsufficientCreditsModal(null)}
          operation={insufficientCreditsModal.operation}
          creditsNeeded={insufficientCreditsModal.cost}
          currentCredits={insufficientCreditsModal.current}
          onUpgrade={onUpgrade}
          isDarkMode={isDarkMode}
        />
      )}
      {usageLimitModal?.isOpen && (
        <UsageLimitModal
          isOpen={usageLimitModal.isOpen}
          onClose={() => setUsageLimitModal(null)}
          usageType={usageLimitModal.usageType}
          current={usageLimitModal.current}
          limit={usageLimitModal.limit}
          onUpgrade={onUpgrade}
          isDarkMode={isDarkMode}
          isSubscribed={isSubscribed}
        />
      )}
      <style>{`
        @keyframes slide-up-home-assistant {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .safe-area-pb {
          padding-bottom: max(1rem, env(safe-area-inset-bottom));
        }
        @keyframes fly-in-icon {
          0% {
            transform: translate(280px, 480px) scale(0.5);
            opacity: 0;
          }
          100% {
            transform: translate(0, 0) scale(1);
            opacity: 1;
          }
        }
        .animate-fly-in-icon {
          animation: fly-in-icon 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
};
