import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, LiveServerMessage, Modality, StartSensitivity, EndSensitivity, createPartFromUri, Type } from '@google/genai';
import { ResearchProject, KnowledgeBaseFile, SessionConversation, ChatMessage as PersistedChatMessage, BookAsset, BookPage, TableAsset, UploadedFile, SavedResearch, ProjectTask, ProjectNote, DualTheme, CapturedLead, LeadFormAsset, LeadFormField, AssetItem, SavedWebsiteVersion } from '../types';
import { contextService, ChatMessage as ContextChatMessage } from '../services/contextService';
import { createPcmBlob, decode, decodeAudioData } from '../services/audioUtils';
import { generateImage, analyzeFileWithGemini, generateStructuredBlogPost, refineWebsiteCode, generatePodcastScript, generatePodcastAudio, generateBookFromProjectContext, generateImageWithReferences, ImageReference, generateVeoVideo, getFileSearchStoreName, generateTableFromProjectContext, detectWizaTableIntent, uploadFileToGemini, refinePromptWithGemini3, performDeepResearch, ComputerUseSession, performComputerUseTask, confirmComputerUseAction, cancelComputerUseSession, sendComputerUseCommand, searchKnowledgeBase, streamLeadFormWebsite, ai, getOrCreateProjectContextCache, resolveCitations } from '../services/geminiService';
import ComputerUseViewer from './ComputerUseViewer';
import { AnimatedEyeIcon } from './AnimatedEyeIcon';
import { createVideoFromText, createVideoFromImage, createVideoFromImageUrl, pollVideoUntilComplete, downloadVideoBlob, SoraModel } from '../services/soraService';
import { createVoiceoverVideoWithCreatomate, createVideoOverview } from '../services/creatomateService';
import { storageService } from '../services/storageService';
import { authFetch } from '../services/authFetch';
import { mediaService } from '../services/mediaService';
import { checkUsageLimit, incrementUsage, UsageType } from '../services/usageService';
import { deductCredits, hasEnoughCredits, getUserCredits, CREDIT_COSTS, CreditOperation } from '../services/creditService';
import { checkPostLimit, incrementPostCount, FREE_TIER_DAILY_POST_LIMIT } from '../services/postLimitService';
import { InsufficientCreditsModal } from './InsufficientCreditsModal';
import { UsageLimitModal } from './UsageLimitModal';

const logToVercel = async (message: string, level: string = 'error', metadata?: any) => {
  try {
    console[level === 'error' ? 'error' : 'log'](`[REMOTE_LOG_ATTEMPT] ${message}`, metadata);
    await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, level, metadata: metadata ? String(metadata) : undefined })
    });
  } catch (e) {
    console.error('Failed to send remote log:', e);
  }
};
import { SocialAuthPrompt } from './SocialAuthPrompt';
import { PDFDocument } from 'pdf-lib';
import { uploadFileToStorage } from '../services/firebase';
import { UserProfile, ProjectActivity } from '../types';
import { useActivityLog } from '../hooks/useActivityLog';
import { ThoughtProcess } from './ThoughtProcess';
import { generateEmailHtml } from './EmailBuilder';
import { worldLabsService, WorldGenerationRequest } from '../services/worldLabsService';
import { getFallbackChain, isRetryableError, MODEL_FALLBACK_CHAINS } from '../services/modelSelector';
import { personalizationService } from '../services/personalizationService';
import { AssistantPlugin } from './AssistantPlugin';
import { AssistantStudio } from './AssistantStudio';
import { assistantVersionService } from '../services/assistantVersionService';
import { AssistantVersion } from '../types';
import { auth } from '../services/firebase';

interface ExtendedChatMessage extends ContextChatMessage {
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  isGenerating?: boolean;
  computerUseSession?: ComputerUseSession;
  computerUseGoal?: string;
  computerUseExistingSessionId?: string;
}

interface ProjectLiveAssistantProps {
  project: ResearchProject;
  isDarkMode: boolean;
  activeTheme?: 'light' | 'dark' | 'orange' | 'green' | 'blue' | 'purple' | 'khaki' | 'pink';
  currentTheme?: {
    primary: string;
    primaryHover: string;
    accent: string;
    ring: string;
    cardBg: string;
    border: string;
    bgSecondary: string;
    text: string;
    textSecondary: string;
    hoverBg: string;
  };
  onClose: () => void;
  onLocalPodcastAdd?: (file: KnowledgeBaseFile) => void;
  onProjectUpdate?: (project: ResearchProject) => void;
  onRunSeoAnalysis?: (params: {
    keyword?: string;
    location?: string;
  }) => Promise<{
    keyword: string;
    location: string;
    seoData: any;
    advice: string | null;
    error?: string | null;
  }>;
  isSubscribed?: boolean;
  onUpgrade?: () => void;
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
  // Context
  activeTab?: string;
  activeAssetTab?: string;
  googleSheetsAccessToken?: string | null;
  googleDocsAccessToken?: string | null;
  pinnedAsset?: any;
}

type AssistantMode = 'chat' | 'voice' | 'video';
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type DocsEditorBridge = {
  getDraft: () => { documentId: string | null; title: string | null; text: string };
  setDraftText: (text: string) => void;
  appendDraftText: (text: string, separator?: string) => void;
  replaceDraftText: (find: string, replace: string, opts?: { useRegex?: boolean; caseSensitive?: boolean }) => void;
  insertInlineImage: (url: string, widthPx?: number, heightPx?: number) => void;
  save: () => Promise<boolean>;
};

type TableEditorBridge = {
  getTable: () => { table: null | { id: string; title: string; description?: string; columns: string[]; rows: string[][]; googleSpreadsheetId?: string | null; googleSheetTitle?: string | null; createdAt?: number | null } };
  setTableTitle: (title: string) => void;
  setTableDescription: (description: string) => void;
  setCell: (rowIndex: number, colIndex: number, value: string) => void;
  addRow: (index?: number) => void;
  deleteRow: (rowIndex: number) => void;
  addColumn: (name?: string, index?: number) => void;
  deleteColumn: (colIndex: number) => void;
  renameColumn: (colIndex: number, name: string) => void;
  setColumns: (columns: string[]) => void;
  setRows: (rows: string[][]) => void;
};

const IMAGE_FILE_REGEX = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i;
const MAX_IMAGE_REFERENCES = 14;

const getColumnLabel = (index: number): string => {
  let label = '';
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode((n % 26) + 65) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
};

const formatSheetTitleForA1 = (title: string) => {
  const raw = (title || '').toString();
  const escaped = raw.replace(/'/g, "''");
  return `'${escaped}'`;
};

const sheetPrefix = (title: string) => `${formatSheetTitleForA1(title)}!`;

const buildConservativeClearRange = (sheetTitle: string, table: { columns: string[]; rows: string[][] }) => {
  const cols = Math.max(table.columns.length || 1, 52);
  const rows = Math.max((table.rows?.length || 0) + 1, 1000);
  const lastCol = getColumnLabel(cols - 1);
  return `${sheetPrefix(sheetTitle)}A1:${lastCol}${rows}`;
};

interface ImageCandidateFile {
  key: string;
  label: string;
  labelLower: string;
  uri: string;
  mimeType: string;
  summary: string;
  searchText: string;
}

const buildSearchTokens = (value: string) =>
  (value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2);

const scoreByTokens = (text: string, tokens: string[]) => {
  if (!tokens.length) return 0;
  const haystack = text.toLowerCase();
  let score = 0;
  tokens.forEach(token => {
    if (!token) return;
    if (haystack.includes(token)) {
      score += token.length >= 6 ? 2 : 1;
    }
  });
  return score;
};

const getDocsEditorBridge = (): DocsEditorBridge | null => {
  if (typeof window === 'undefined') return null;
  return ((window as any).__researchrDocsEditor as DocsEditorBridge | undefined) || null;
};

const getTableEditorBridge = (): TableEditorBridge | null => {
  if (typeof window === 'undefined') return null;
  return ((window as any).__researchrTableEditor as TableEditorBridge | undefined) || null;
};

const extractSeoTopKeywords = (seoData: any): Array<{ keyword: string; volume?: number; competition?: any }> => {
  const list: any[] = (seoData && (seoData.top || seoData.local || seoData.global)) || [];
  if (!Array.isArray(list)) return [];
  return list
    .map((row: any) => ({
      keyword: String(row?.text || row?.keyword || '').trim(),
      volume: typeof row?.volume === 'number' ? row.volume : Number(row?.volume) || undefined,
      competition: row?.competition_level ?? row?.competition_index ?? undefined,
    }))
    .filter((row: any) => row.keyword)
    .slice(0, 6);
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(blob);
  });

export const ProjectLiveAssistant: React.FC<ProjectLiveAssistantProps> = ({
  project,
  isDarkMode,
  activeTheme,
  currentTheme,
  onClose,
  onLocalPodcastAdd,
  onProjectUpdate,
  onRunSeoAnalysis,
  isSubscribed = false,
  onUpgrade,
  activeTab,
  activeAssetTab,
  googleSheetsAccessToken,
  googleDocsAccessToken,
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
  pinnedAsset,
}) => {
  // Project ref to allow tools to access the latest project state during live session callbacks
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionResumptionHandleRef = useRef<string | null>(null);

  // --- SUBSCRIBE TO ACTIVITY LOG ---
  const { activities } = useActivityLog({
    ownerUid: project.ownerUid || '',
    projectId: project.id,
    enabled: !!project.id && !!project.ownerUid
  });

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    storageService.getUserProfile().then(profile => {
      if (profile) setUserProfile(profile);
    });
  }, []);

  // Credit System State
  const [insufficientCreditsModal, setInsufficientCreditsModal] = useState<{
    isOpen: boolean;
    operation: CreditOperation;
    cost: number;
    current: number;
  } | null>(null);

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



  const [mode, setMode] = useState<AssistantMode>('chat');
  const [gmailConnected, setGmailConnected] = useState(false);
  const [outlookConnected, setOutlookConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<ExtendedChatMessage[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Studio state
  const [studioOpen, setStudioOpen] = useState(false);
  const [activeVersion, setActiveVersion] = useState<AssistantVersion | null>(null);
  const [versionsLoaded, setVersionsLoaded] = useState(false);

  // Load active version on mount
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId || !project?.id) return;
    assistantVersionService.getActiveVersion(userId, project.id).then(v => {
      setActiveVersion(v);
      setVersionsLoaded(true);
    });
  }, [project?.id]);

  // Check email connection status on mount
  useEffect(() => {
    const checkEmailStatus = async () => {
      try {
        const gmailRes = await authFetch('/api/email?op=status&provider=gmail');
        const gmailData = await gmailRes.json();
        setGmailConnected(gmailData.connected || false);

        const outlookRes = await authFetch('/api/email?op=status&provider=outlook');
        const outlookData = await outlookRes.json();
        setOutlookConnected(outlookData.connected || false);
      } catch (e) {
        console.warn('Failed to check email connection status:', e);
      }
    };
    checkEmailStatus();
  }, []);

  // Load chat history when project changes
  useEffect(() => {
    if (project?.id) {
      const key = `chat_history_${project.id}`;
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setMessages(parsed);
          } else {
            setMessages([]);
          }
        } else {
          setMessages([]);
        }
      } catch (e) {
        console.error('Failed to load chat history:', e);
        setMessages([]);
      }
    } else {
      setMessages([]);
    }
  }, [project?.id]);

  // Save chat history when messages change
  useEffect(() => {
    if (project?.id) {
      const key = `chat_history_${project.id}`;
      // Sanitize messages before saving (remove isGenerating flags effectively)
      // We don't want to persist 'loading' states that might get stuck
      const sanitized = messages.map(m => ({
        ...m,
        isGenerating: false, // Ensure no stuck loading states
        thinking: m.thinking // Keep thinking logs if useful
      }));

      // Debounce saving is handled implicitly by React state batching, but we can just save directly here for simplicity relative to typing speed.
      // Ideally we'd debounce, but let's trust localStorage speed for now or add a timeout if sluggish.
      // Given the 'live' nature, immediate save on message completion (which triggers this) is fine.
      // But typing triggers this? No, 'messages' updates on 'addMessage' or 'updateMessage'.
      // Streaming updates 'messages' frequently.
      // We should probably debounce.

      const timeoutId = setTimeout(() => {
        localStorage.setItem(key, JSON.stringify(sanitized));
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
  }, [messages, project?.id]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptBuffer, setTranscriptBuffer] = useState('');
  const [userTranscriptBuffer, setUserTranscriptBuffer] = useState('');
  const [usageLimitModal, setUsageLimitModal] = useState<{
    isOpen: boolean;
    usageType: UsageType;
    current: number;
    limit: number;
  } | null>(null);

  const [pendingAttachments, setPendingAttachments] = useState<
    Array<{ id: string; file: File; status: 'uploading' | 'ready' | 'error'; uploaded?: UploadedFile; error?: string; previewUrl?: string }>
  >([]);
  const attachmentsInputRef = useRef<HTMLInputElement | null>(null);
  const [activeComputerUseMessageId, setActiveComputerUseMessageId] = useState<string | null>(null);
  const [activeComputerUseSessionId, setActiveComputerUseSessionId] = useState<string | null>(null);
  const [showStripeConnectPrompt, setShowStripeConnectPrompt] = useState(false);
  const [thinkingProcess, setThinkingProcess] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [plannerIntent, setPlannerIntent] = useState<string | null>(null);
  const [isDraggingAssetOver, setIsDraggingAssetOver] = useState(false);

  // Video Mode State
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // mediaStreamRef is already defined around line 2424
  const frameIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);

  // ─── Mirror Mode State ───────────────────────────────────────────────────────
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastTranscriptUpdate, setLastTranscriptUpdate] = useState(0);

  const framesRef = useRef<string[]>([]);
  const isProcessingRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const lastProcessedTimeRef = useRef<number>(0);
  // Track media introduced in current conversation session for intelligent media targeting
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

  // Helper to add media to conversation tracking
  const trackConversationMedia = useCallback((media: Omit<ConversationMedia, 'addedAt'>) => {
    setCurrentConversationMedia(prev => [
      { ...media, addedAt: Date.now() },
      ...prev // Most recent first
    ].slice(0, 20)); // Keep last 20
  }, []);

  // Handle incoming pinned asset from other tabs
  useEffect(() => {
    if (pinnedAsset && !pendingAttachments.some(a => a.uploaded?.url === (pinnedAsset.url || pinnedAsset.uri))) {
      setPendingAttachments(prev => {
        // Double check in callback to prevent race conditions
        if (prev.some(a => a.uploaded?.url === (pinnedAsset.url || pinnedAsset.uri))) {
          return prev;
        }

        // Ensure it has a url, uri, name, and type
        const url = pinnedAsset.url || pinnedAsset.uri || '';
        const name = pinnedAsset.title || pinnedAsset.name || pinnedAsset.topic || 'Pinned Asset';

        let mimeType = pinnedAsset.mimeType || pinnedAsset.type || 'application/octet-stream';
        // Normalize custom types
        if (mimeType === 'image') mimeType = 'image/jpeg';
        else if (mimeType === 'video') mimeType = 'video/mp4';
        else if (mimeType === 'blog' || mimeType === 'doc') mimeType = 'text/markdown';
        else if (mimeType === 'table') mimeType = 'text/csv';

        const fakeFile = new File([''], name, { type: mimeType });

        // Mock a basic UploadedFile structure if it's missing fields
        const mockUploadedFile: UploadedFile = {
          ...pinnedAsset,
          url: url,
          uri: pinnedAsset.uri || url,
          name: name,
          displayName: name,
          mimeType: mimeType,
          uploadedAt: pinnedAsset.uploadedAt || Date.now(),
          size: pinnedAsset.size || 0
        };

        const newAttachment = {
          id: Math.random().toString(36).substring(7),
          file: fakeFile,
          status: 'ready' as const,
          uploaded: mockUploadedFile,
          previewUrl: url
        };

        return [...prev, newAttachment];
      });
    }
  }, [pinnedAsset]);

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

  /**
   * Continuous auth detection: monitors localStorage for token changes.
   * Uses storage event for cross-tab changes and polling for same-tab changes.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Handler for storage events (from OAuth popups or other tabs)
    const handleStorageChange = (event: StorageEvent) => {
      if (!event.key) return;

      const tokenKeys = ['fb_access_token', 'x_access_token', 'tiktok_access_token', 'youtube_access_token', 'linkedin_access_token'];
      if (tokenKeys.includes(event.key) && event.newValue) {
        console.log(`[SocialAuth] Storage event detected: ${event.key}`);
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
        console.log('[SocialAuth] Polling detected new auth tokens, syncing...');
        onRequestSocialRefresh?.();
      }
    }, 2000);

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(pollInterval);
    };
  }, [onRequestSocialRefresh]);

  /**
   * Check if a platform has an auth token in localStorage.
   * This is used to detect when OAuth completes before parent props update.
   */
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

  /**
   * Poll for auth completion after triggering OAuth.
   * Used to immediately detect when user connects via popup.
   */
  const pollForAuthCompletion = useCallback(async (platform: SocialPlatform, maxWaitMs = 60000): Promise<boolean> => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, 500)); // Poll every 500ms
      if (checkPlatformAuthToken(platform)) {
        console.log(`[SocialAuth] Auth detected for ${platform} via polling`);
        return true;
      }
    }
    return false;
  }, [checkPlatformAuthToken]);

  /**
   * Connect to a social platform with immediate state refresh.
   * This triggers OAuth, polls for completion, then updates state immediately.
   */
  const handleConnectWithRefresh = useCallback(async (platform: SocialPlatform) => {
    console.log(`[SocialAuth] Connecting to ${platform} with refresh...`);

    // Trigger the OAuth popup via parent handler
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

    // Poll for auth completion
    const connected = await pollForAuthCompletion(platform);

    if (connected) {
      console.log(`[SocialAuth] ${platform} connected successfully, updating state...`);

      // Immediately update socialStateRef so AI knows it's connected
      switch (platform) {
        case 'facebook':
          socialStateRef.current.facebookConnected = true;
          break;
        case 'instagram':
          // Instagram uses igAccounts array - we'll let parent refresh this
          break;
        case 'x':
          socialStateRef.current.xConnected = true;
          break;
        case 'tiktok':
          socialStateRef.current.tiktokConnected = true;
          break;
        case 'youtube':
          socialStateRef.current.youtubeConnected = true;
          break;
        case 'linkedin':
          socialStateRef.current.linkedinConnected = true;
          break;
      }

      // Request parent to refresh props for full sync
      if (onRequestSocialRefresh) {
        try {
          await onRequestSocialRefresh();
          console.log(`[SocialAuth] Parent state refreshed`);
        } catch (e) {
          console.error(`[SocialAuth] Failed to refresh parent state:`, e);
        }
      }

      // Also load Instagram accounts if Facebook connected (IG uses FB token)
      if (platform === 'facebook' && loadInstagramAccounts) {
        loadInstagramAccounts();
      }
      if (platform === 'facebook' && loadFacebookPages) {
        loadFacebookPages();
      }

      return true;
    }

    console.log(`[SocialAuth] Auth polling timed out for ${platform}`);
    return false;
  }, [handleFacebookConnect, handleXConnect, handleTiktokConnect, handleYoutubeConnect, handleLinkedinConnect, pollForAuthCompletion, onRequestSocialRefresh, loadInstagramAccounts, loadFacebookPages]);

  const [lastComputerUseSessionId, setLastComputerUseSessionId] = useState<string | null>(null);

  /**
   * Detect if the user's message requires browser automation.
   * Only triggers for Pro users on specific task patterns.
   * IMPORTANT: Skips detection if the AI was asking for user input (context awareness).
   */
  const shouldUseComputerUse = useCallback((message: string, hasRecentSession: boolean = false, lastAiMessage?: string): { needed: boolean; goal?: string; url?: string } => {
    console.log('[ComputerUse] Checking message:', message);
    console.log('[ComputerUse] isSubscribed:', isSubscribed);

    if (!isSubscribed) {
      console.log('[ComputerUse] Skipped - user not subscribed');
      return { needed: false };
    }

    // CONTEXT AWARENESS: Skip browser detection if AI was asking for user input
    if (lastAiMessage) {
      const askingForInputPatterns = [
        /what (caption|subject|title|description|message|content|text) would you like/i,
        /what would you like (the|to|as|for) (caption|subject|title|description)/i,
        /please (provide|enter|type|give|share) (a|the|your)? ?(caption|subject|title|description)/i,
        /enter (a|the|your)? ?(caption|subject|title|description)/i,
        /what do you want (to say|it to say|the caption|the message)/i,
        /\?$/  // Any question mark at end indicates AI was asking something
      ];

      for (const pattern of askingForInputPatterns) {
        if (pattern.test(lastAiMessage)) {
          console.log('[ComputerUse] Skipped - AI was asking for user input, treating message as content');
          return { needed: false };
        }
      }
    }

    const lowerMessage = message.toLowerCase();

    // Common websites that indicate browser automation
    const commonSites = [
      'pinterest', 'amazon', 'ebay', 'walmart', 'target', 'bestbuy', 'best buy',
      'google', 'youtube', 'facebook', 'twitter', 'instagram', 'linkedin', 'tiktok',
      'reddit', 'craigslist', 'yelp', 'zillow', 'redfin', 'airbnb', 'booking',
      'expedia', 'netflix', 'spotify', 'github', 'stackoverflow', 'wikipedia',
      'cnn', 'bbc', 'nytimes', 'washingtonpost', 'etsy', 'shopify', 'aliexpress',
      'newegg', 'costco', 'ikea', 'homedepot', 'lowes', 'wayfair',
    ];

    // Check for simple site navigation patterns first
    for (const site of commonSites) {
      // Patterns: "go to pinterest", "open amazon", "visit ebay", "browse walmart", "browse to bestbuy"
      const simpleNavPattern = new RegExp(`\\b(go\\s+to|open|visit|browse(\\s+to)?|navigate\\s+to|take\\s+me\\s+to|show\\s+me)\\s+(the\\s+)?${site}\\b`, 'i');
      if (simpleNavPattern.test(message)) {
        console.log(`[ComputerUse] DETECTED! Simple nav to ${site}`);
        return { needed: true, goal: message };
      }
    }

    // Check for domain patterns (e.g., "go to example.com", "browse to google.com")
    const domainNavPattern = /\b(go\s+to|open|visit|browse(\s+to)?|navigate\s+to|take\s+me\s+to|show\s+me)\s+(the\s+)?(www\.)?[a-z0-9][-a-z0-9]*\.(com|org|net|io|co|dev|ai|app)\b/i;
    if (domainNavPattern.test(message)) {
      const urlMatch = message.match(/\b([a-z0-9][-a-z0-9]*\.(com|org|net|io|co|dev|ai|app))\b/i);
      const url = urlMatch ? `https://www.${urlMatch[1]}` : undefined;
      console.log('[ComputerUse] DETECTED! Domain navigation:', url);
      return { needed: true, goal: message, url };
    }

    // If we have a recent session, be more permissive with interaction commands
    if (hasRecentSession) {
      const interactionPatterns = [
        /\b(click|press|select|choose|tap)\b/i,
        /\b(scroll|swipe|move)\b/i,
        /\b(type|enter|input|fill)\b/i,
        /\b(go back|go forward|refresh|reload)\b/i,
        /\b(open)\s+(link|tab|page|result|item|product)\b/i,
        /\b(open)\s+(the\s+)?(first|second|third|last|next|previous)\b/i,
      ];
      for (const pattern of interactionPatterns) {
        if (pattern.test(message)) {
          console.log(`[ComputerUse] DETECTED! Contextual command for recent session: ${message}`);
          return { needed: true, goal: message };
        }
      }
    }

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
      /\b(use (the )?browser|open (the )?browser|browser automation|automate|scrape|screenshot)/i,
      // Search on specific sites or domains
      /\b(search|searching|find)\b.*(on|at)\b.*(bestbuy|best buy|amazon|walmart|target|ebay|bing|google|yahoo|duckduckgo|youtube)/i,
      // Search on generic domain pattern
      /\b(search|searching|find)\b.*(on|at)\b.*([a-z0-9-]+\.(com|org|net|io|co|dev|app|ai))/i,
      // Explicit "use the browser" or "automate"
      /\b(use\s+the\s+browser|automate\s+this|browse\s+the\s+web|web\s+automation)/i,
      // Research patterns that need real-time data
      /\b(research|look\s+up|find\s+out)\b.*(online|on\s+the\s+web|website|internet)/i,
    ];

    for (const pattern of browserPatterns) {
      const matches = pattern.test(message);
      console.log(`[ComputerUse] Pattern ${pattern.toString()} matches: ${matches}`);
      if (matches) {
        // Extract URL if present
        const urlMatch = message.match(/https?:\/\/[^\s]+|www\.[^\s]+|\b([a-z0-9-]+\.(com|org|net|io|co))\b/i);
        const url = urlMatch ? (urlMatch[0].startsWith('http') ? urlMatch[0] : `https://${urlMatch[0]}`) : undefined;

        console.log('[ComputerUse] DETECTED! Goal:', message, 'URL:', url);
        return { needed: true, goal: message, url };
      }
    }

    console.log('[ComputerUse] No pattern matched');
    return { needed: false };
  }, [isSubscribed]);
  // Helper to analyze request intent using fast Flash model (Brain before Hands)
  const analyzeRequestIntent = async (
    userMessage: string,
    projectContext: any,
    recentHistory: any[]
  ): Promise<{
    thoughtProcess: string;
    recommendedTools: string[];
    intent: 'email' | 'social' | 'content_creation' | 'project_management' | 'other';
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

Output JSON ONLY:
{
  "thoughtProcess": "Brief reasoning...",
  "intent": "email" | "social" | "content_creation" | "project_management" | "other",
  "recommendedTools": ["tool_name_1", "tool_name_2"],
  "disambiguationNeeded": true/false
}`;

      const stream = await ai.models.generateContentStream({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            role: 'user',
            parts: [{
              text: `User Request: "${userMessage}"
Project Context: ${JSON.stringify({ name: projectContext.name, templates: projectContext.emailTemplates?.map((t: any) => t.name) || [] })}
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
            // Handle thought parts if present (Gemini 3)
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

      // Parse JSON
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

  /**
   * Analyze which media the user is referring to when they want to post/schedule.
   * Uses Gemini thinking to reason about conversation context and media references.
   */
  const analyzeMediaIntent = async (
    userMessage: string,
    conversationMedia: { id: string; url: string; publicUrl?: string; type: 'image' | 'video'; source: string; name: string; addedAt: number }[],
    recentMessages: { role: string; text: string; imageUrl?: string }[]
  ): Promise<{
    targetMediaUrl?: string;
    targetMediaType?: 'image' | 'video';
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
  }> => {
    try {
      // Build media context for the AI
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
      console.log('[analyzeMediaIntent] Result:', parsed);
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

  const imageCandidateFiles = useMemo<ImageCandidateFile[]>(() => {
    const files: ImageCandidateFile[] = [];
    const usedKeys = new Set<string>();

    const pushCandidate = (
      key: string | undefined,
      label: string | undefined,
      uri: string | undefined,
      mimeType: string | undefined,
      summary?: string,
    ) => {
      if (!key || !uri) return;
      if (usedKeys.has(key)) return;
      const safeLabel = (label || 'Project image').trim();
      const mime = (mimeType || 'image/png').toLowerCase();
      if (!mime.startsWith('image/')) return;
      const searchText = `${safeLabel} ${summary || ''}`.toLowerCase();
      files.push({
        key,
        label: safeLabel,
        labelLower: safeLabel.toLowerCase(),
        uri,
        mimeType: mimeType || 'image/png',
        summary: summary || '',
        searchText,
      });
      usedKeys.add(key);
    };

    (project.uploadedFiles || []).forEach(file => {
      if (!file?.uri) return;
      const name = file.displayName || file.name || '';
      const mime = file.mimeType || '';
      const isImage = mime.toLowerCase().startsWith('image/') || IMAGE_FILE_REGEX.test(name.toLowerCase());
      if (!isImage) return;
      pushCandidate(file.uri || file.name, name || 'Uploaded image', file.uri, mime || 'image/png', file.summary || '');
    });

    (project.knowledgeBase || []).forEach(file => {
      if (!file?.url) return;
      const mime = file.type || '';
      const name = file.name || '';
      const summary = file.summary || file.extractedText || '';
      const isImage = mime.toLowerCase().startsWith('image/') || IMAGE_FILE_REGEX.test(name.toLowerCase());
      if (!isImage) return;
      pushCandidate(file.id || file.url, name || 'Generated image', file.url, mime || 'image/png', summary);
    });

    return files;
  }, [project.uploadedFiles, project.knowledgeBase]);

  // Social platform connection check helper
  type SocialPlatform = 'facebook' | 'instagram' | 'x' | 'tiktok' | 'youtube' | 'linkedin';

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

  // Helper for natural language date parsing (Robust)
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
        // Already today, but mark as found so we don't auto-advance past times
        foundDate = true;
      } else {
        // Handle "next [weekday]" or "on [weekday]"
        const weekDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayMatch = lc.match(/(?:next|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
        if (dayMatch) {
          const desiredDayStr = dayMatch[1];
          const isNext = lc.includes('next'); // "next friday" vs "on friday"
          const currentDay = targetDate.getDay();
          const desiredDay = weekDays.indexOf(desiredDayStr);

          let daysToAdd = (desiredDay - currentDay + 7) % 7;
          if (daysToAdd === 0 && isNext) daysToAdd = 7; // "next friday" on a friday = next week
          else if (daysToAdd === 0 && !isNext) { /* "on friday" on a friday = today */ }
          else if (isNext) daysToAdd += 7; // "next friday" usually means subsequent week if we strictly follow "next" logic? 
          // Actually "next Friday" usually means the first Friday that occurs. If today is Mon, next Fri is this week.
          // BUT some people mean "not this coming one but the one after".
          // Let's stick to: "on friday" = nearest future friday. "next friday" = +7 days from nearest?
          // Simplification: "next [day]" -> If today is Mon, next Fri is +4. If today is Fri, next Fri is +7.
          if (daysToAdd === 0) daysToAdd = 7;

          targetDate.setDate(targetDate.getDate() + daysToAdd);
          foundDate = true;
        }
      }

      // 3. Extract Time Logic
      // Matches: "9:30am", "9am", "9:30", "15:00", "9:30 pm", "9:30 a.m."
      const timeMatch = lc.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
      let foundTime = false;

      if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2] || '0');
        const meridian = timeMatch[3] ? timeMatch[3].replace(/\./g, '') : null;

        if (meridian === 'pm' && hours < 12) hours += 12;
        if (meridian === 'am' && hours === 12) hours = 0;

        // Contextual guess for raw numbers (e.g. "at 5")
        if (!meridian && hours < 12) {
          // Ambiguous. "at 5" -> 5pm usually? "at 9" -> 9am usually?
          // Let's leave as is (AM) unless small number like 1-6?
          // Safest to assume 24h or AM, relying on user to specify PM.
          // Or, if "tonight at 5", we add 12?
          if (lc.includes('tonight') || lc.includes('evening') || lc.includes('afternoon')) {
            if (hours < 12) hours += 12;
          }
        }

        targetDate.setHours(hours, minutes, 0, 0);
        foundTime = true;
      }

      // Special time keywords overrides if no specific time found
      if (!foundTime) {
        if (lc.includes('tonight')) {
          targetDate.setHours(20, 0, 0, 0); // 8 PM
          foundTime = true;
          if (!foundDate && !lc.includes('tomorrow')) foundDate = true; // Implies today
        } else if (lc.includes('morning')) {
          targetDate.setHours(9, 0, 0, 0);
          foundTime = true;
        } else if (lc.includes('evening')) {
          targetDate.setHours(18, 0, 0, 0);
          foundTime = true;
        }
      }

      if (foundDate || foundTime) {
        // Default time if only date found
        if (foundDate && !foundTime) {
          targetDate.setHours(10, 0, 0, 0); // Default 10am
        }

        // Heuristic: If time is in past and no date specified, assume tomorrow
        // e.g. "at 9am" said at 10am -> tomorrow 9am
        if (!foundDate && foundTime && targetDate.getTime() < now.getTime()) {
          targetDate.setDate(targetDate.getDate() + 1);
        }

        return targetDate.getTime();
      }

      // 4. Fallback to basic date parsing
      const parsed = Date.parse(input);
      if (!isNaN(parsed)) return parsed;

      return null;
    } catch (e) {
      console.error('[parseScheduleDate] Error parsing:', input, e);
      return null;
    }
  };

  // Reusable helper to execute a scheduled post (used by both Chat and Voice flows)
  // This matches UnifiedSocialPublisher.handleSchedule() logic exactly
  const executeSchedulePost = useCallback(async (
    args: any,
    addMessage: (role: 'user' | 'model', text: string) => void,
    onSuccess: (postId: string) => void
  ) => {
    console.log('[executeSchedulePost] ======= ENTRY POINT =======');
    console.log('[executeSchedulePost] Raw args:', JSON.stringify(args));

    const text = String(args.text || '').trim();
    const mediaUrlArg = args.mediaUrl;
    const contentTypeArg = args.contentType || 'text';
    const platformsRaw = args.platforms || args.platform;
    const platforms = (Array.isArray(platformsRaw) ? platformsRaw : [platformsRaw])
      .filter(p => p != null && p !== '')
      .map(p => String(p).toLowerCase());
    const scheduledTimeInput = args.scheduledTime || args.scheduledAt;

    console.log('[executeSchedulePost] Parsed values:', {
      text: text.substring(0, 50),
      mediaUrlArg: mediaUrlArg?.substring(0, 50),
      contentTypeArg,
      platforms,
      scheduledTimeInput
    });

    // Parse Date
    let scheduledAtUnix = 0;
    const parsedTime = parseScheduleDate(String(scheduledTimeInput));

    if (parsedTime) {
      scheduledAtUnix = Math.floor(parsedTime / 1000);
    } else {
      // Fallback if specific date string like "2025-10-10" was passed
      const d = new Date(String(scheduledTimeInput));
      if (!isNaN(d.getTime())) {
        scheduledAtUnix = Math.floor(d.getTime() / 1000);
      }
    }

    if (!scheduledAtUnix) {
      addMessage('model', "When would you like to schedule this post? (e.g., 'tomorrow at 10am' or 'next Monday')");
      return;
    }

    // Validate time (10 mins to 7 days)
    const nowUnix = Math.floor(Date.now() / 1000);
    if (scheduledAtUnix < nowUnix + 600) {
      addMessage('model', "The scheduled time must be at least 10 minutes in the future.");
      return;
    }
    if (scheduledAtUnix > nowUnix + 7 * 24 * 3600) {
      addMessage('model', "The scheduled time cannot be more than 7 days ahead.");
      return;
    }

    addMessage('model', `Scheduling post for ${new Date(scheduledAtUnix * 1000).toLocaleString()}...`);

    // Build Payload for /api/social?op=schedule-create
    const postType = contentTypeArg === 'video' ? 'VIDEO' : contentTypeArg === 'image' ? 'IMAGE' : 'TEXT';

    // Upload media to Vercel Blob if needed (like getMediaUrlForPublishing)
    let mediaUrl: string | undefined;
    if (postType !== 'TEXT' && mediaUrlArg) {
      try {
        const resolved = await mediaService.ensureRemoteUrl(String(mediaUrlArg));
        mediaUrl = resolved || undefined;
      } catch (e) {
        console.error('[Schedule] Failed to ensure remote URL:', e);
        mediaUrl = String(mediaUrlArg);
      }
      console.log('[Schedule] Media URL obtained:', mediaUrl?.substring(0, 50) + '...');
    }

    // Platform overrides - include accessToken like UnifiedSocialPublisher
    const platformOverrides: Record<string, any> = {};
    const currentSocialState = socialStateRef.current;

    for (const p of platforms) {
      switch (p) {
        case 'facebook':
          platformOverrides.facebook = {
            pageId: fbPageId || (fbPages.length > 0 ? fbPages[0].id : ''),
            accessToken: facebookAccessToken, // CRITICAL: Include access token
            message: text
          };
          break;
        case 'instagram':
          platformOverrides.instagram = {
            igId: currentSocialState.igAccounts.length > 0 ? currentSocialState.igAccounts[0].igId : (selectedIgId || ''),
            accessToken: facebookAccessToken, // CRITICAL: Include access token
            caption: text,
            mediaType: postType === 'VIDEO' ? 'REELS' : 'FEED'
          };
          break;
        case 'x':
          platformOverrides.x = {
            accessToken: typeof window !== 'undefined' ? localStorage.getItem('x_access_token') : null,
            text: text
          };
          break;
        case 'linkedin':
          platformOverrides.linkedin = {
            accessToken: typeof window !== 'undefined' ? localStorage.getItem('linkedin_access_token') : null,
            text: text,
            visibility: 'PUBLIC'
          };
          break;
        case 'tiktok':
          platformOverrides.tiktok = {
            accessToken: typeof window !== 'undefined' ? localStorage.getItem('tiktok_access_token') : null,
            title: text,
            privacyLevel: 'PUBLIC_TO_EVERYONE'
          };
          break;
        case 'youtube':
          platformOverrides.youtube = {
            title: text.substring(0, 100),
            description: text,
            privacy: 'public'
          };
          break;
      }
    }

    // Call schedule-create
    try {
      console.log('[Schedule] Calling schedule-create API...', {
        projectId: projectRef.current.id,
        platforms,
        postType,
        hasMediaUrl: !!mediaUrl,
        scheduledAt: new Date(scheduledAtUnix * 1000).toISOString()
      });

      const res = await authFetch('/api/social?op=schedule-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projectRef.current.id,
          userId: projectRef.current.ownerUid || 'anonymous',
          scheduledAt: scheduledAtUnix,
          platforms: platforms,
          postType,
          textContent: text,
          mediaUrl,
          platformOverrides
        })
      });

      const data = await res.json().catch(() => ({}));
      console.log('[Schedule] API Response:', { ok: res.ok, data });

      if (!res.ok) throw new Error(data?.error || 'Scheduling failed');

      // Success
      const newPostId = data.id || crypto.randomUUID();

      // Update local project state for immediate UI feedback
      const newScheduledPost = {
        id: newPostId,
        platforms: platforms,
        scheduledAt: scheduledAtUnix * 1000,
        contentType: contentTypeArg,
        textContent: text,
        mediaUrl: mediaUrl,
        status: 'scheduled',
        createdAt: Date.now()
      };

      const existingPosts = projectRef.current.scheduledPosts || [];
      const updatedProject = {
        ...projectRef.current,
        scheduledPosts: [...existingPosts, newScheduledPost],
        lastModified: Date.now()
      };

      // Save to storageService like UnifiedSocialPublisher does
      await storageService.updateResearchProject(updatedProject.id, { scheduledPosts: updatedProject.scheduledPosts });
      onProjectUpdate?.(updatedProject);
      projectRef.current = updatedProject;

      console.log('[Schedule] Success! Post ID:', newPostId, 'Total scheduled:', updatedProject.scheduledPosts.length);
      onSuccess(newPostId);
    } catch (e: any) {
      console.error('[Schedule] Execute Schedule failed', e);
      addMessage('model', `Failed to schedule post: ${e.message}`);
    }

  }, [projectRef, fbPageId, fbPages, facebookAccessToken, selectedIgId, onProjectUpdate, socialStateRef]);

  // Effect to monitor sequential auth progress for Voice Mode
  useEffect(() => {
    const queue = voiceAuthQueueRef.current;
    if (!queue || !queue.currentTarget) return;

    if (isPlatformConnected(queue.currentTarget)) {
      // Current target connected!
      // Move to next
      const next = queue.remainingPlatforms.shift();

      if (next) {
        // Advancing to next platform
        queue.currentTarget = next;
        voiceAuthQueueRef.current = { ...queue };

        // Trigger UI update to show next button
        // Ideally we speak via a mechanism, but 'useEffect' implies reaction.
        // We can't easily trigger Voice Output here without a function provided.
        // But we CAN update pendingAuthPlatforms to show the button.
        setPendingAuthPlatforms([next]);
      } else {
        // Queue empty! Execute the schedule action.
        queue.currentTarget = null;
        const args = queue.originalArgs;
        voiceAuthQueueRef.current = null;
        setPendingAuthPlatforms([]); // Clear buttons

        // Execute
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
            // Success!
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
  }, [facebookConnected, igAccounts, xConnected, tiktokConnected, youtubeConnected, linkedinConnected, isPlatformConnected, executeSchedulePost]);

  // Social media posting function
  const postToSocialPlatform = useCallback(async (
    platform: SocialPlatform,
    contentType: 'text' | 'image' | 'video',
    text?: string,
    mediaUrl?: string,
    privacyLevel?: string,
  ): Promise<{ success: boolean; needsAuth?: boolean; platform: string; error?: string; postId?: string }> => {
    // Check connection status first
    if (!isPlatformConnected(platform)) {
      return { success: false, needsAuth: true, platform };
    }

    try {
      // Get media blob if needed
      let mediaBlob: Blob | null = null;
      let publicMediaUrl = mediaUrl; // Use this for platforms that need a public URL

      if (mediaUrl && contentType !== 'text') {
        // For Gemini Files API URLs, we cannot download them directly
        // The files are only accessible for AI model input, not HTTP download
        // We need to check if we have the original file in readyAttachments or lastGeneratedAsset
        if (mediaUrl.includes('generativelanguage.googleapis.com')) {
          console.log('[postToSocialPlatform] Detected Gemini file URL - looking for original blob');

          // Try to find the original blob from readyAttachments
          const att = readyAttachments.find(a => a.uploaded?.uri === mediaUrl);
          if (att?.file) {
            mediaBlob = att.file;
            console.log('[postToSocialPlatform] Found original file in attachments:', att.file.name);

            // Upload to Vercel Blob to get a public URL
            try {
              publicMediaUrl = await mediaService.uploadToBlob(att.file);
              console.log('[postToSocialPlatform] Uploaded to Vercel Blob:', publicMediaUrl);
            } catch (blobError) {
              console.error('[postToSocialPlatform] Failed to upload to blob:', blobError);
            }
          } else {
            // If we don't have the original file, we can't post to social media
            // because Gemini files cannot be downloaded
            console.error('[postToSocialPlatform] Cannot access Gemini file - original file not found');
            throw new Error('The media file has expired or is not accessible. Please re-upload the file.');
          }
        } else {
          // Regular URL - just fetch it
          const res = await fetch(mediaUrl);
          if (!res.ok) {
            console.error('[postToSocialPlatform] Failed to fetch media:', res.status, res.statusText);
            throw new Error(`Failed to download media: ${res.status} ${res.statusText}`);
          }
          mediaBlob = await res.blob();
          publicMediaUrl = mediaUrl;
          console.log('[postToSocialPlatform] Downloaded media blob:', mediaBlob.size, 'bytes, type:', mediaBlob.type);
        }
      }

      // CRITICAL: Auto-detect actual content type from mediaBlob
      // This prevents issues where lastGeneratedAsset has stale type info
      let actualContentType = contentType;
      if (mediaBlob) {
        const blobMimeType = mediaBlob.type;
        if (blobMimeType.startsWith('video/')) {
          actualContentType = 'video';
        } else if (blobMimeType.startsWith('image/')) {
          actualContentType = 'image';
        }
        if (actualContentType !== contentType) {
          console.log(`[postToSocialPlatform] Content type corrected from '${contentType}' to '${actualContentType}' based on blob type '${blobMimeType}'`);
          contentType = actualContentType;
        }
      }

      switch (platform) {
        case 'facebook': {
          if (!facebookAccessToken) throw new Error('Not connected');
          const pageId = fbPageId || fbPages[0]?.id;
          if (!pageId) throw new Error('No Facebook page selected');

          let op = '';
          const body: any = { fbUserAccessToken: facebookAccessToken, pageId };

          if (contentType === 'text') {
            op = 'fb-publish-post';
            body.message = text || '';
          } else if (contentType === 'image') {
            if (!publicMediaUrl) throw new Error('No image URL provided');
            op = 'fb-publish-photo';
            body.url = publicMediaUrl;
            body.caption = text || '';
          } else if (contentType === 'video') {
            if (!publicMediaUrl) throw new Error('No video URL provided');
            op = 'fb-publish-video';
            body.file_url = publicMediaUrl;
            body.title = (text || '').substring(0, 100);
            body.description = text || '';
          }

          const res = await authFetch(`/api/social?op=${op}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || 'Failed');
          return { success: true, platform, postId: data.id };
        }

        case 'instagram': {
          if (!facebookAccessToken) throw new Error('Not connected');
          if (!selectedIgId) throw new Error('No Instagram account selected');
          if (!publicMediaUrl) throw new Error('Instagram requires media');

          const res = await authFetch('/api/social?op=ig-publish-robust', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fbUserAccessToken: facebookAccessToken,
              igId: selectedIgId,
              mediaType: contentType === 'video' ? 'REELS' : 'FEED',
              mediaUrls: [publicMediaUrl],
              caption: text || '',
              shareToFeed: true,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || 'Failed');
          return { success: true, platform, postId: data.mediaId || data.containerId };
        }

        case 'x': {
          let mediaId = '';

          if (contentType !== 'text' && mediaBlob) {
            const category = contentType === 'video' ? 'tweet_video' : 'tweet_image';

            const initRes = await authFetch('/api/social?op=x-upload-init', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mediaType: mediaBlob.type,
                totalBytes: mediaBlob.size,
                mediaCategory: category,
              }),
            });
            if (!initRes.ok) throw new Error('Failed to init upload');
            const initData = await initRes.json();
            mediaId = initData.id_str || initData.media_id_string || initData.id;

            // Chunk upload
            const CHUNK_SIZE = 1024 * 1024;
            const totalChunks = Math.ceil(mediaBlob.size / CHUNK_SIZE);
            for (let i = 0; i < totalChunks; i++) {
              const chunk = mediaBlob.slice(i * CHUNK_SIZE, Math.min(mediaBlob.size, (i + 1) * CHUNK_SIZE));
              const appendRes = await authFetch(`/api/social?op=x-upload-append&mediaId=${mediaId}&segmentIndex=${i}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: chunk,
              });
              if (!appendRes.ok) throw new Error(`Chunk ${i} failed`);
            }

            const finalizeRes = await authFetch('/api/social?op=x-upload-finalize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mediaId }),
            });
            if (!finalizeRes.ok) throw new Error('Finalize failed');

            // For videos, poll for processing status (critical for large videos)
            if (contentType === 'video') {
              const finalizeData = await finalizeRes.json().catch(() => ({}));

              if (finalizeData.processing_info) {
                console.log('[X] Video processing started, polling for completion...');
                let processingState = finalizeData.processing_info.state;
                let checkAfterSecs = finalizeData.processing_info.check_after_secs || 1;

                // Poll until succeeded or failed (max 30 attempts, ~60 seconds)
                const maxAttempts = 30;
                let attempts = 0;

                while (processingState !== 'succeeded' && processingState !== 'failed' && attempts < maxAttempts) {
                  await new Promise(r => setTimeout(r, checkAfterSecs * 1000));
                  attempts++;

                  const statusRes = await authFetch(`/api/social?op=x-upload-status&mediaId=${mediaId}`, {
                    method: 'GET',
                  });

                  if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    processingState = statusData.processing_info?.state || 'succeeded';
                    checkAfterSecs = statusData.processing_info?.check_after_secs || 2;
                    console.log(`[X] Processing status (attempt ${attempts}):`, processingState);
                  } else {
                    // If status check fails, assume processing complete
                    console.log('[X] Status check failed, assuming complete');
                    break;
                  }
                }

                if (processingState === 'failed') {
                  throw new Error('X video processing failed');
                }
                console.log('[X] Video processing complete');
              }
            }
          }

          const postRes = await authFetch('/api/social?op=x-post-tweet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: text || '',
              mediaIds: mediaId ? [mediaId] : [],
            }),
          });
          if (!postRes.ok) {
            const errData = await postRes.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to post');
          }
          const postData = await postRes.json().catch(() => ({}));
          return { success: true, platform, postId: postData.id || postData.data?.id };
        }

        case 'tiktok': {
          if (contentType === 'text' || !mediaBlob) throw new Error('TikTok requires media (video or photo)');

          console.log('[TikTok] Starting post:', { contentType, blobType: mediaBlob.type, blobSize: mediaBlob.size, publicMediaUrl });

          if (contentType === 'video') {
            // VIDEO: Use FILE_UPLOAD - upload binary directly to TikTok
            console.log('[TikTok] Using FILE_UPLOAD for video');

            const initRes = await authFetch('/api/social?op=tiktok-post-video-init', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                videoSize: mediaBlob.size,
                chunkSize: mediaBlob.size,
                totalChunkCount: 1,
                title: text || '',
                privacyLevel: privacyLevel || 'SELF_ONLY', // Use AI-specified or default to private
              }),
            });
            const initData = await initRes.json().catch(() => ({}));
            console.log('[TikTok] Video init response:', initData);

            if (!initRes.ok) throw new Error(initData?.error || 'Failed to initialize TikTok video upload');

            const { publishId, uploadUrl } = initData;
            if (!uploadUrl) throw new Error('TikTok did not return upload URL');

            console.log('[TikTok] Uploading video to:', uploadUrl);
            const uploadRes = await fetch(uploadUrl, {
              method: 'PUT',
              headers: {
                'Content-Type': 'video/mp4',
                'Content-Range': `bytes 0-${mediaBlob.size - 1}/${mediaBlob.size}`,
              },
              body: mediaBlob,
            });

            console.log('[TikTok] Upload response status:', uploadRes.status);
            if (uploadRes.status !== 201) {
              const errorText = await uploadRes.text().catch(() => '');
              console.error('[TikTok] Upload failed:', errorText);
              throw new Error(`TikTok video upload failed: ${uploadRes.status}`);
            }

            console.log('[TikTok] Video uploaded successfully, publishId:', publishId);
            return { success: true, platform, postId: publishId };

          } else if (contentType === 'image') {
            // PHOTO: Use FILE_UPLOAD - same as video, upload binary directly
            // (PULL_FROM_URL requires verified domains which Vercel Blob isn't)
            console.log('[TikTok] Using FILE_UPLOAD for photo');

            const initRes = await authFetch('/api/social?op=tiktok-post-photo-init', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                photoCount: 1,
                title: text || '',
                description: text || '',
                privacyLevel: privacyLevel || 'SELF_ONLY', // Use AI-specified or default to private
                autoAddMusic: true,
              }),
            });
            const initData = await initRes.json().catch(() => ({}));
            console.log('[TikTok] Photo init response:', initData);

            if (!initRes.ok) throw new Error(initData?.error || 'Failed to initialize TikTok photo upload');

            const { publishId, uploadUrls } = initData;
            if (!uploadUrls || uploadUrls.length === 0) throw new Error('TikTok did not return upload URLs for photo');

            console.log('[TikTok] Uploading photo to:', uploadUrls[0]);
            const uploadRes = await fetch(uploadUrls[0], {
              method: 'PUT',
              headers: {
                'Content-Type': mediaBlob.type || 'image/jpeg',
                'Content-Length': String(mediaBlob.size),
              },
              body: mediaBlob,
            });

            console.log('[TikTok] Photo upload response status:', uploadRes.status);
            if (uploadRes.status !== 200 && uploadRes.status !== 201) {
              const errorText = await uploadRes.text().catch(() => '');
              console.error('[TikTok] Photo upload failed:', errorText);
              throw new Error(`TikTok photo upload failed: ${uploadRes.status}`);
            }

            console.log('[TikTok] Photo uploaded successfully, publishId:', publishId);
            return { success: true, platform, postId: publishId };
          } else {
            throw new Error(`Unsupported TikTok content type: ${contentType}`);
          }
        }

        case 'youtube': {
          if (contentType !== 'video' || !mediaBlob) throw new Error('YouTube requires video');

          const mimeType = mediaBlob.type || 'video/mp4';
          const initRes = await authFetch('/api/google?op=youtube-upload-init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: (text || 'Untitled Video').substring(0, 100),
              description: text || '',
              privacyStatus: privacyLevel || 'private', // Use AI-specified or default to private
              mimeType,
            }),
          });
          const initData = await initRes.json().catch(() => ({}));
          if (!initRes.ok) throw new Error(initData?.error || 'Failed to init upload');

          const uploadUrl = initData.uploadUrl;
          if (!uploadUrl) throw new Error('No upload URL');

          const putRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': mimeType },
            body: mediaBlob,
          });
          if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
          return { success: true, platform };
        }

        case 'linkedin': {
          if (contentType === 'text') {
            const res = await authFetch('/api/social?op=linkedin-post-text', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: text || '', visibility: 'PUBLIC' }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed');
            return { success: true, platform, postId: data.postId };
          } else if (mediaBlob) {
            const regRes = await authFetch('/api/social?op=linkedin-register-upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mediaType: contentType === 'image' ? 'IMAGE' : 'VIDEO' }),
            });
            const regData = await regRes.json().catch(() => ({}));
            if (!regRes.ok) throw new Error(regData?.error || 'Failed to register');

            const { uploadUrl, asset } = regData;

            const uploadRes = await authFetch(`/api/social?op=linkedin-upload-media&uploadUrl=${encodeURIComponent(uploadUrl)}`, {
              method: 'POST',
              headers: { 'Content-Type': mediaBlob.type },
              body: mediaBlob,
            });
            if (!uploadRes.ok) throw new Error('Failed to upload media');

            const postRes = await authFetch('/api/social?op=linkedin-post-media', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: text || '',
                asset,
                mediaType: contentType === 'image' ? 'IMAGE' : 'VIDEO',
                visibility: 'PUBLIC',
              }),
            });
            const postData = await postRes.json().catch(() => ({}));
            if (!postRes.ok) throw new Error(postData?.error || 'Failed');
            return { success: true, platform, postId: postData.postId };
          }
          throw new Error('Invalid content type for LinkedIn');
        }

        default:
          throw new Error(`Unknown platform: ${platform}`);
      }
    } catch (error: any) {
      console.error(`Error posting to ${platform}:`, error);
      return { success: false, platform, error: error.message || 'Failed to post' };
    }
  }, [isPlatformConnected, facebookAccessToken, fbPageId, fbPages, selectedIgId]);

  // Track platforms needing auth for inline prompt
  const [pendingAuthPlatforms, setPendingAuthPlatforms] = useState<SocialPlatform[]>([]);

  // Scroll to bottom when auth prompt appears
  useEffect(() => {
    if (pendingAuthPlatforms.length > 0) {
      console.log('[SocialAuthPrompt] Platforms needing auth:', pendingAuthPlatforms);
      // Scroll to make the auth prompt visible
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [pendingAuthPlatforms]);

  // Track last generated/attached media for easy posting (e.g., "post that to Instagram")
  const [lastGeneratedAsset, setLastGeneratedAsset] = useState<{
    url: string;
    publicUrl?: string; // Public URL for social media posting (Vercel Blob)
    type: 'image' | 'video';
    name?: string;
    timestamp: number;
  } | null>(null);


  // Schedule post to multiple platforms
  const schedulePostToSocial = useCallback(async (
    platforms: SocialPlatform[],
    scheduledAt: string, // ISO 8601 or relative time
    contentType: 'text' | 'image' | 'video',
    text?: string,
    mediaUrl?: string,
  ): Promise<{ success: boolean; needsAuth?: boolean; disconnectedPlatforms?: SocialPlatform[]; error?: string; scheduledId?: string }> => {
    // Check which platforms are not connected
    const disconnectedPlatforms = platforms.filter(p => !isPlatformConnected(p));
    if (disconnectedPlatforms.length > 0) {
      return { success: false, needsAuth: true, disconnectedPlatforms };
    }

    try {
      // Parse scheduledAt - try ISO format first, then try relative parsing
      let scheduledDate: Date;
      const isoDate = new Date(scheduledAt);
      if (!isNaN(isoDate.getTime())) {
        scheduledDate = isoDate;
      } else {
        // Simple relative time parsing
        const now = new Date();
        const lower = scheduledAt.toLowerCase();
        if (lower.includes('tomorrow')) {
          scheduledDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        } else if (lower.includes('next week')) {
          scheduledDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        } else {
          // Try to parse time like "2pm", "14:00"
          const timeMatch = lower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/);
          if (timeMatch) {
            let hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2] || '0', 10);
            const ampm = timeMatch[3];
            if (ampm === 'pm' && hours < 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;
            scheduledDate = new Date(now);
            scheduledDate.setHours(hours, minutes, 0, 0);
            if (scheduledDate <= now) {
              scheduledDate.setDate(scheduledDate.getDate() + 1);
            }
          } else {
            return { success: false, error: 'Could not parse scheduled time' };
          }
        }
      }

      const scheduledAtUnix = scheduledDate.getTime();

      // Map contentType to postType format
      const postType = contentType.toUpperCase() as 'TEXT' | 'IMAGE' | 'VIDEO';

      // Build platform overrides with auth tokens
      const platformOverrides: any = {};
      for (const plat of platforms) {
        switch (plat) {
          case 'facebook':
            platformOverrides.facebook = {
              accessToken: facebookAccessToken,
              pageId: fbPageId || fbPages[0]?.id,
              message: text || '',
            };
            break;
          case 'instagram':
            platformOverrides.instagram = {
              accessToken: facebookAccessToken,
              igId: selectedIgId,
              caption: text || '',
            };
            break;
          case 'x':
            platformOverrides.x = {
              text: text || '',
            };
            break;
          case 'tiktok':
            platformOverrides.tiktok = {
              title: text || '',
              privacyLevel: 'SELF_ONLY',
            };
            break;
          case 'youtube':
            platformOverrides.youtube = {
              title: (text || 'Scheduled Video').substring(0, 100),
              description: text || '',
              privacy: 'private',
            };
            break;
          case 'linkedin':
            platformOverrides.linkedin = {
              text: text || '',
              visibility: 'PUBLIC',
            };
            break;
        }
      }

      const response = await authFetch('/api/social?op=schedule-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          userId: project.ownerUid || 'anonymous',
          scheduledAt: scheduledAtUnix,
          platforms,
          postType,
          textContent: text || '',
          mediaUrl: mediaUrl || '',
          platformOverrides,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to schedule post');
      }

      return { success: true, scheduledId: data.id };
    } catch (error: any) {
      console.error('Error scheduling post:', error);
      return { success: false, error: error.message || 'Failed to schedule' };
    }
  }, [isPlatformConnected, facebookAccessToken, fbPageId, fbPages, selectedIgId, project.id, project.ownerUid]);

  const imageReferenceCacheRef = useRef<Map<string, ImageReference>>(new Map());

  const resolveImageReferences = useCallback(
    async (prompt: string): Promise<{ references: ImageReference[]; labels: string[] }> => {
      const tokens = buildSearchTokens(prompt);
      if (!tokens.length || !imageCandidateFiles.length) {
        return { references: [], labels: [] };
      }

      const ranked = imageCandidateFiles
        .map(file => ({
          file,
          score: scoreByTokens(file.searchText, tokens),
        }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_IMAGE_REFERENCES);

      const references: ImageReference[] = [];
      const labels: string[] = [];

      for (const { file } of ranked) {
        let reference = imageReferenceCacheRef.current.get(file.key);
        if (!reference) {
          try {
            const response = await fetch(file.uri);
            if (!response.ok) {
              console.warn('Failed to fetch reference image', file.uri);
              continue;
            }
            const blob = await response.blob();
            const base64 = await blobToBase64(blob);
            reference = { base64, mimeType: file.mimeType || 'image/png' };
            imageReferenceCacheRef.current.set(file.key, reference);
          } catch (err) {
            console.warn('Error downloading reference image', file.uri, err);
            continue;
          }
        }
        references.push(reference);
        labels.push(file.label);
        if (references.length >= MAX_IMAGE_REFERENCES) break;
      }

      return { references, labels };
    },
    [imageCandidateFiles]
  );

  const generateProjectTableAsset = useCallback(
    async (prompt: string): Promise<TableAsset> => {
      // Credit Check
      const hasCredits = await checkCredits('tableGeneration');
      if (!hasCredits) throw new Error('Insufficient credits');

      const success = await deductCredits('tableGeneration');
      if (!success) throw new Error('Failed to deduct credits');

      const bridge = getTableEditorBridge();
      if (!bridge) {
        throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
      }

      const userPrompt = (prompt || '').trim() || project.name || 'Table';
      const intent = await detectWizaTableIntent(userPrompt);
      let effectiveMode: 'people' | 'company' | 'none' = intent.mode;

      const tableSpec = effectiveMode === 'people'
        ? await (async () => {
          const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
          let listId: number | undefined;
          for (let attempt = 0; attempt < 12; attempt++) {
            const res = await authFetch('/api/wiza-generate-table', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: userPrompt, size: 10, ...(listId ? { listId } : {}) }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok && res.status !== 202) {
              throw new Error(data?.error || 'Failed to generate Wiza contacts table');
            }
            const nextListId = typeof data?.wiza?.listId === 'number' ? data.wiza.listId : undefined;
            if (nextListId) listId = nextListId;
            if (res.status === 200) {
              if (!data?.tableSpec) throw new Error('Wiza generate table returned no tableSpec');
              return data.tableSpec;
            }
            if (res.status === 202) {
              if (!listId) throw new Error('Wiza list is building but no listId was returned');
              await sleep(1500);
              continue;
            }
            throw new Error('Unexpected response from Wiza generate table');
          }
          throw new Error('Wiza is taking too long to build the list. Please try again.');
        })()
        : effectiveMode === 'company'
          ? await (async () => {
            const res = await authFetch('/api/wiza-company-enrich-table', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: userPrompt, size: 10 }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              const detailsText = typeof data?.details === 'string' ? data.details : '';
              if (detailsText.includes('Insufficient API credits') || detailsText.includes('need 2 credits')) {
                effectiveMode = 'none';
                return await generateTableFromProjectContext(project, userPrompt);
              }
              throw new Error(data?.error || 'Failed to enrich companies via Wiza');
            }
            if (!data?.tableSpec) throw new Error('Wiza company enrichment returned no tableSpec');
            return data.tableSpec;
          })()
          : await generateTableFromProjectContext(project, userPrompt);

      // Create Table Asset
      const tableAsset: TableAsset = {
        id: typeof crypto !== 'undefined' && (crypto as any).randomUUID
          ? (crypto as any).randomUUID()
          : `table-${Date.now()}`,
        title: String(tableSpec.title || 'Table'),
        description: String(tableSpec.description || ''),
        columns: Array.isArray(tableSpec.columns) ? tableSpec.columns.map((c: any) => String(c ?? '')) : [],
        rows: Array.isArray(tableSpec.rows)
          ? tableSpec.rows.map((r: any) => (Array.isArray(r) ? r.map((v: any) => String(v ?? '')) : []))
          : [],
        createdAt: Date.now(),
      };

      bridge.setTableTitle(tableAsset.title);
      bridge.setTableDescription(tableAsset.description || '');
      bridge.setColumns(tableAsset.columns);
      bridge.setRows(tableAsset.rows);

      return tableAsset;
    },
    [project]
  );

  const refineProjectTableAsset = useCallback(
    async (currentTable: any, instruction: string): Promise<any> => {
      const hasCredits = await checkCredits('aiTableEdit');
      if (!hasCredits) throw new Error('Insufficient credits');

      const success = await deductCredits('aiTableEdit');
      if (!success) throw new Error('Failed to deduct credits');

      // Use Gemini to refine the table data
      const prompt = `
You are a data editor. I have a JSON table and an instruction to modify it.
Process the instruction and output the NEW JSON table structure.
Maintain integrity of data that is not changing.
Follow the instruction precisely (e.g. valid instructions: "simplify column X", "add row", "delete duplicate rows").

CURRENT TABLE JSON:
${JSON.stringify({ title: currentTable.title, columns: currentTable.columns, rows: currentTable.rows }, null, 2)}

INSTRUCTION: "${instruction}"

OUTPUT FORMAT:
Return ONLY valid JSON with this structure:
{
  "title": "...",
  "description": "...",
  "columns": ["Col1", "Col2"...],
  "rows": [["Row1Col1", "Row1Col2"...], ...]
}
Do not include markdown triple backticks.
`;

      const result = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { temperature: 0.1 } // Low temp for precise data manipulation
      });

      const responseText = result.text || '';
      const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

      try {
        const newTableSpec = JSON.parse(cleanJson);
        if (!Array.isArray(newTableSpec.columns) || !Array.isArray(newTableSpec.rows)) {
          throw new Error('Invalid table structure returned');
        }
        return newTableSpec;
      } catch (e) {
        console.error('Failed to parse refined table JSON:', responseText);
        throw new Error('Failed to process table update. Please try again.');
      }
    },
    []
  );

  const saveTableToLatestSession = useCallback(
    async (table: TableAsset) => {
      const sessions = project.researchSessions || [];
      const latestSession = sessions[sessions.length - 1];
      if (!latestSession) {
        throw new Error('No research sessions available');
      }

      const existingTables: TableAsset[] = Array.isArray(latestSession.researchReport?.tables)
        ? (latestSession.researchReport?.tables as TableAsset[])
        : [];

      const nextTables = [table, ...existingTables.filter(t => String(t?.id || '') !== String(table.id || ''))];
      const updatedReport = {
        ...latestSession.researchReport,
        tables: nextTables,
      };

      await storageService.updateResearchInProject(project.id, latestSession.id, { researchReport: updatedReport });

      const updatedSessions = sessions.map(session =>
        session.id === latestSession.id ? { ...session, researchReport: updatedReport } : session
      );

      onProjectUpdate?.({
        ...project,
        researchSessions: updatedSessions,
        lastModified: Date.now(),
      });
    },
    [project, onProjectUpdate]
  );

  const saveTableBackToGoogleSheet = useCallback(
    async (table: { columns: string[]; rows: string[][]; googleSpreadsheetId?: string | null; googleSheetTitle?: string | null }) => {
      const spreadsheetId = String(table.googleSpreadsheetId || '').trim();
      const sheetTitle = String(table.googleSheetTitle || '').trim();
      if (!spreadsheetId || !sheetTitle) {
        throw new Error('This table is not linked to a Google Sheet. Load or export it to Google Sheets first in the Tables tab.');
      }

      const clearRange = buildConservativeClearRange(sheetTitle, { columns: table.columns, rows: table.rows });
      let clearUrl = '/api/google-sheets-values-clear';
      if (googleSheetsAccessToken) clearUrl += `?accessToken=${encodeURIComponent(googleSheetsAccessToken)}`;
      const clearRes = await authFetch(clearUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId, range: clearRange }),
      });
      const clearData = await clearRes.json().catch(() => ({}));
      if (!clearRes.ok) {
        if (clearData?.needsReauth) {
          throw new Error('Google connection needs Sheets permission. Reconnect Google to re-authorize.');
        }
        throw new Error(clearData?.error || 'Failed to clear sheet range');
      }

      const values = [
        (table.columns || []).map(c => c || ''),
        ...(table.rows || []).map(r => (r || []).map(c => c || '')),
      ];

      let updateUrl = '/api/google-sheets-values-update';
      if (googleSheetsAccessToken) updateUrl += `?accessToken=${encodeURIComponent(googleSheetsAccessToken)}`;
      const updateRes = await authFetch(updateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId, range: `${sheetPrefix(sheetTitle)}A1`, values, valueInputOption: 'USER_ENTERED' }),
      });
      const updateData = await updateRes.json().catch(() => ({}));
      if (!updateRes.ok) {
        if (updateData?.needsReauth) {
          throw new Error('Google connection needs Sheets permission. Reconnect Google to re-authorize.');
        }
        throw new Error(updateData?.error || 'Failed to update sheet');
      }
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

    const currentCount = pendingAttachments.length;
    const room = MAX_IMAGE_REFERENCES - currentCount;
    if (room <= 0) return;

    const toAdd = selected.slice(0, room);
    const newEntries = toAdd.map(file => ({
      id: crypto.randomUUID(),
      file,
      status: 'uploading' as const,
      previewUrl: file.type?.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));

    setPendingAttachments(prev => [...prev, ...newEntries]);

    for (const entry of newEntries) {
      try {
        // Upload to Gemini for AI context
        const uploaded = await uploadFileToGemini(entry.file, entry.file.name, project.id);

        // For image/video files, also upload to Vercel Blob to get a public URL for social posting
        let publicUrl: string | undefined;
        if (entry.file.type?.startsWith('image/') || entry.file.type?.startsWith('video/')) {
          try {
            const { upload } = await import('@vercel/blob/client');
            const blobResult = await upload(entry.file.name, entry.file, {
              access: 'public',
              handleUploadUrl: '/api/blob/upload',
            });
            publicUrl = blobResult.url;
            console.log('[handlePickAttachments] Also uploaded to Vercel Blob:', publicUrl);
          } catch (blobError: any) {
            console.error('[handlePickAttachments] FAILED to upload to Vercel Blob:', blobError?.message || blobError);
            console.error('[handlePickAttachments] Social posting will fail without BLOB_READ_WRITE_TOKEN configured');
            // Continue anyway - Gemini upload still works for AI context
          }
        }

        // Store both URIs - Gemini for AI, public URL for social media
        const uploadedWithPublicUrl = { ...uploaded, publicUrl };
        setPendingAttachments(prev =>
          prev.map(p => (p.id === entry.id ? { ...p, status: 'ready', uploaded: uploadedWithPublicUrl } : p))
        );

        // CRITICAL: Update lastGeneratedAsset IMMEDIATELY when upload completes
        // This ensures the correct file is used even if message is sent quickly
        if (entry.file.type?.startsWith('image/') || entry.file.type?.startsWith('video/')) {
          const isVideo = entry.file.type?.startsWith('video/');
          console.log('[handlePickAttachments] Setting lastGeneratedAsset:', {
            type: isVideo ? 'video' : 'image',
            publicUrl: publicUrl || 'MISSING - Vercel Blob upload failed!',
            geminiUri: uploaded.uri
          });
          setLastGeneratedAsset({
            url: uploaded.uri,
            publicUrl: publicUrl,
            type: isVideo ? 'video' : 'image',
            name: entry.file.name,
            timestamp: Date.now()
          });
          // Also track for intelligent media targeting
          trackConversationMedia({
            id: entry.id,
            url: uploaded.uri,
            publicUrl: publicUrl,
            type: isVideo ? 'video' : 'image',
            source: 'attached',
            name: entry.file.name
          });
        }
      } catch (e: any) {
        setPendingAttachments(prev =>
          prev.map(p => (p.id === entry.id ? { ...p, status: 'error', error: String(e?.message || e) } : p))
        );
      }
    }
  };

  const fetchImageReferenceFromUrl = useCallback(async (url: string, mimeHint?: string): Promise<ImageReference | null> => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      const base64 = await blobToBase64(blob);
      return { base64, mimeType: blob.type || mimeHint || 'image/png' };
    } catch (err) {
      console.warn('Failed to fetch image reference from URL', url, err);
      return null;
    }
  }, []);

  const checkUsageAndProceed = useCallback(async (type: UsageType): Promise<boolean> => {
    const result = await checkUsageLimit(type, isSubscribed);
    if (!result.allowed) {
      setUsageLimitModal({ isOpen: true, usageType: type, current: result.current, limit: result.limit });
      return false;
    }
    await incrementUsage(type);
    return true;
  }, [isSubscribed]);

  const base64ToBlob = (base64: string, mimeType: string): Blob => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const hasHydratedConversationRef = useRef(false);

  // Load last saved project-level conversation when assistant opens
  useEffect(() => {
    if (hasHydratedConversationRef.current) return;

    const conversations = project.projectConversations || [];
    if (!conversations.length) return;

    const projectConversations = conversations.filter(
      (conv) => conv.sessionId === project.id && conv.mode === 'chat'
    );
    if (!projectConversations.length) return;

    const latestConv = projectConversations.reduce<SessionConversation | null>((latest, conv) => {
      if (!latest) return conv;
      return conv.startedAt > latest.startedAt ? conv : latest;
    }, null);

    if (!latestConv || !latestConv.messages || !latestConv.messages.length) return;

    const initialMessages: ExtendedChatMessage[] = latestConv.messages.map((msg) => ({
      id: crypto.randomUUID(),
      role: msg.role,
      text: msg.text,
      timestamp: msg.timestamp,
      imageUrl: (msg as any).imageUrl,
      audioUrl: (msg as any).audioUrl,
    }));

    setMessages(initialMessages);
    hasHydratedConversationRef.current = true;
  }, [project.id]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const addMessage = useCallback(
    (role: 'user' | 'model', text: string, imageUrl?: string, audioUrl?: string) => {
      const trimmedText = text.trim();
      if (!trimmedText && !imageUrl && !audioUrl) return '';

      let newId = crypto.randomUUID();

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (
          last &&
          last.role === role &&
          (last.text || '').trim() === trimmedText &&
          (last.imageUrl || undefined) === (imageUrl || undefined) &&
          (last.audioUrl || undefined) === (audioUrl || undefined)
        ) {
          return prev;
        }

        const newMessage: ExtendedChatMessage = {
          id: newId,
          role,
          text: trimmedText,
          timestamp: Date.now(),
          imageUrl,
          audioUrl,
        };
        return [...prev, newMessage];
      });

      return newId;
    },
    []
  );

  // Persist project-level chat history whenever messages change
  useEffect(() => {
    if (!messages.length) return;

    const persistConversation = async () => {
      const persistedMessages: PersistedChatMessage[] = messages.map((msg) => ({
        role: msg.role,
        text: msg.text,
        timestamp: msg.timestamp,
        imageUrl: msg.imageUrl,
        audioUrl: msg.audioUrl,
      }));

      const startedAt = persistedMessages[0]?.timestamp ?? Date.now();
      const endedAt = persistedMessages[persistedMessages.length - 1]?.timestamp;

      const newConversation: SessionConversation = {
        id: `project-${project.id}`,
        sessionId: project.id,
        messages: persistedMessages,
        mode,
        startedAt,
        endedAt,
      };

      const existing = project.projectConversations || [];
      const filtered = existing.filter(
        (conv) => conv.sessionId !== project.id || conv.mode !== 'chat'
      );
      const updatedConversations = [...filtered, newConversation];

      try {
        await storageService.updateResearchProject(project.id, {
          projectConversations: updatedConversations,
        });
      } catch (e) {
        console.error('Failed to persist project chat history', e);
      }
    };

    void persistConversation();
  }, [messages, mode, project.id]);

  const fetchImageAsBase64 = async (url: string): Promise<string> => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          // Return raw base64 without data prefix
          resolve(result.split(',')[1] || result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.error('Failed to fetch image base64:', e);
      return '';
    }
  };

  const generateProjectImageAsset = useCallback(
    async (prompt: string, manualReferences: ImageReference[] = [], manualLabels: string[] = []): Promise<{
      imageUrl: string;
      kbFileUrl?: string;
      referenceLabels: string[];
    }> => {
      const hasCredits = await checkCredits('imageGenerationFast');
      if (!hasCredits) throw new Error('Insufficient credits');

      const success = await deductCredits('imageGenerationFast');
      if (!success) throw new Error('Failed to deduct credits');

      // Only auto-resolve references if the user is asking to EDIT an existing image
      // For fresh generation requests (e.g., "generate image of a mountain"), skip reference resolution
      const shouldUseReferences = isEditRequest(prompt);
      const { references: autoReferences, labels: autoLabels } = shouldUseReferences
        ? await resolveImageReferences(prompt)
        : { references: [], labels: [] };
      const references = [...manualReferences, ...autoReferences];
      const referenceLabels = [...manualLabels, ...autoLabels];

      const imageResult = references.length
        ? await generateImageWithReferences(prompt, references, undefined)
        : await generateImageWithContext(prompt);
      const imageUrl = typeof imageResult === 'string' ? imageResult : imageResult.imageDataUrl;
      let kbFileUrl: string | undefined;
      try {
        const imgRes = await fetch(imageUrl);
        const blob = await imgRes.blob();
        const file = new File([blob], `chat-image-${Date.now()}.png`, { type: blob.type || 'image/png' });
        const kb = await storageService.uploadKnowledgeBaseFile(project.id, file);
        kbFileUrl = kb.url;

        const existingKb = project.knowledgeBase || [];
        const updatedKnowledgeBase = [...existingKb, kb];
        try {
          await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
        } catch (persistError) {
          console.error('Failed to persist chat-generated image into project knowledge base', persistError);
        }

        onProjectUpdate?.({
          ...project,
          knowledgeBase: updatedKnowledgeBase,
          lastModified: Date.now(),
        });
      } catch (err) {
        console.error('Failed to save chat-generated image to project:', err);
      }
      return { imageUrl: kbFileUrl || imageUrl, kbFileUrl, referenceLabels };
    },
    [project, onProjectUpdate, resolveImageReferences]
  );

  const generateProjectVideoAsset = useCallback(
    async (prompt: string, aspect: string, mode: string) => {
      const operation = 'videoSequenceGeneration';
      const hasCredits = await checkCredits(operation);
      if (!hasCredits) throw new Error('Insufficient credits for video generation.');
      const success = await deductCredits(operation);
      if (!success) throw new Error('Failed to deduct credits');

      const trimmedPrompt = prompt.trim();
      const aspectSize = (aspect || '720x1280') as any;

      // Build a richer project/research context description (research, files, notes) for voiceover fallback
      const projectContext = contextService.buildProjectContext(project);
      const contextDescription = `${projectContext.fullContext}\n\nUser request for this video:\n${trimmedPrompt}`;

      // Primary path: Sora text-to-video
      try {
        const model = mode === 'quality' ? 'sora-2-pro' : 'sora-2';
        const job = await createVideoFromText({
          model: model as any,
          prompt: trimmedPrompt,
          seconds: '12',
          size: aspectSize,
        });

        const finalJob = await pollVideoUntilComplete(job.id, () => { }, 5000);
        if (finalJob.status !== 'completed') {
          throw new Error(finalJob.error?.message || `Video job ended with status: ${finalJob.status}`);
        }

        const blob = await downloadVideoBlob(finalJob.id, 'video');
        const file = new File([blob], `chat-video-${Date.now()}.mp4`, { type: 'video/mp4' });
        const kb = await storageService.uploadKnowledgeBaseFile(project.id, file);

        const existingKb = project.knowledgeBase || [];
        const updatedKnowledgeBase = [...existingKb, kb];
        try {
          await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
        } catch (persistError) {
          console.error('Failed to persist chat-generated video into project knowledge base', persistError);
        }

        onProjectUpdate?.({
          ...project,
          knowledgeBase: updatedKnowledgeBase,
          lastModified: Date.now(),
        });

        return { videoUrl: kb.url, kbFileId: kb.id };
      } catch (soraError: any) {
        console.error('Sora project video generation failed, falling back to Veo 3.1 then Creatomate...', soraError);
      }

      // Veo 3.1 fallback (Gemini API)
      try {
        const aspectRatio: '16:9' | '9:16' =
          aspect === '1280x720' || aspect === '1792x1024' ? '16:9' : '9:16';

        const veoBlob = await generateVeoVideo(trimmedPrompt, aspectRatio, 'speed', {});
        const veoFile = new File([veoBlob], `chat-video-veo-${Date.now()}.mp4`, { type: 'video/mp4' });
        const veoKb = await storageService.uploadKnowledgeBaseFile(project.id, veoFile);

        const existingKb = project.knowledgeBase || [];
        const updatedKnowledgeBase = [...existingKb, veoKb];
        try {
          await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
        } catch (persistError) {
          console.error('Failed to persist Veo-generated video into project knowledge base', persistError);
        }

        onProjectUpdate?.({
          ...project,
          knowledgeBase: updatedKnowledgeBase,
          lastModified: Date.now(),
        });

        return { videoUrl: veoKb.url, kbFileId: veoKb.id };
      } catch (veoError: any) {
        console.error('Veo project video generation failed, falling back to Creatomate voiceover video...', veoError);
      }

      // Final fallback: Creatomate RenderScript video with Pexels assets + voiceover
      const fallback = await createVoiceoverVideoWithCreatomate({
        prompt: trimmedPrompt,
        aspect: aspectSize,
        durationSeconds: 12,
        contextDescription,
      });

      const res = await fetch(fallback.url);
      const blob = await res.blob();
      const file = new File([blob], `chat-video-creatomate-${Date.now()}.mp4`, { type: 'video/mp4' });
      const kb = await storageService.uploadKnowledgeBaseFile(project.id, file);

      const existingKb = project.knowledgeBase || [];
      const updatedKnowledgeBase = [...existingKb, kb];
      try {
        await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
      } catch (persistError) {
        console.error('Failed to persist Creatomate video into project knowledge base', persistError);
      }

      onProjectUpdate?.({
        ...project,
        knowledgeBase: updatedKnowledgeBase,
        lastModified: Date.now(),
      });

      return { videoUrl: kb.url, kbFileId: kb.id };
    },
    [project, onProjectUpdate]
  );

  const generateProjectPodcastAsset = useCallback(
    async (prompt: string, style?: string, duration?: string) => {
      const durationValue = duration === 'short' || duration === 'long' ? duration : 'medium';
      const operation = durationValue === 'short' ? 'podcastShort' : durationValue === 'long' ? 'podcastLong' : 'podcastMedium';
      
      const hasCredits = await checkCredits(operation as any);
      if (!hasCredits) throw new Error('Insufficient credits for podcast generation.');
      const success = await deductCredits(operation as any);
      if (!success) throw new Error('Failed to deduct credits');

      const sessions = project.researchSessions || [];
      const researchSummaries = sessions.map(session => ({
        topic: session.topic,
        summary: session.researchReport?.summary || session.researchReport?.tldr || '',
        keyPoints: session.researchReport?.keyPoints?.map(kp => kp.title) || [],
      }));

      const uploadedFiles =
        project.uploadedFiles?.map(f => ({
          displayName: f.displayName,
          name: f.name,
          mimeType: f.mimeType,
          summary: f.summary,
        })) || [];

      const styleValue: 'conversational' | 'educational' | 'debate' | 'interview' =
        style === 'educational' || style === 'debate' || style === 'interview' ? style : 'conversational';

      const notes = project.notes || [];
      const noteSnippets = notes
        .slice(0, 10)
        .map(note => {
          const title = note.title || 'Untitled note';
          const body = (note.content || '').trim();
          const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
          return `${title}: ${snippet || 'No content'}`;
        })
        .join('\n');

      const descriptionWithNotes = noteSnippets
        ? `${project.description}\n\nKey project notes:\n${noteSnippets}`
        : project.description;

      const script = await generatePodcastScript(
        project.name,
        descriptionWithNotes,
        researchSummaries,
        styleValue,
        durationValue,
        uploadedFiles
      );

      const audio = await generatePodcastAudio(script);

      const mimeType = audio.mimeType || 'audio/wav';
      const audioBlob = base64ToBlob(audio.audioData, mimeType);
      const safeTitle = script.title || 'podcast';
      const fileName = `${safeTitle.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.wav`;
      const file = new File([audioBlob], fileName, { type: mimeType });

      let kbFile: KnowledgeBaseFile | undefined;
      try {
        // First, create a knowledge base file (local blob-backed for now)
        kbFile = await storageService.uploadKnowledgeBaseFile(project.id, file);

        // Then persist it into the project's knowledge base so it behaves
        // like podcasts created from the dedicated Podcast tab.
        try {
          const existingKb = project.knowledgeBase || [];
          const updatedKnowledgeBase = [...existingKb, kbFile];
          await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
        } catch (persistError) {
          console.error('Failed to persist podcast into project knowledge base', persistError);
        }

        // Finally, notify the dashboard so Assets can surface it immediately
        if (onLocalPodcastAdd) {
          onLocalPodcastAdd(kbFile);
        }
      } catch (e) {
        console.error('Failed to save chat-generated podcast to project:', e);
      }

      const audioUrl = kbFile?.url || URL.createObjectURL(audioBlob);

      return { script, audio, audioUrl, kbFile };
    },
    [project, onLocalPodcastAdd]
  );

  const generateProjectBookAsset = useCallback(
    async (prompt: string, pageCount?: number) => {
      const hasCredits = await checkCredits('bookGeneration');
      if (!hasCredits) throw new Error('Insufficient credits');

      const success = await deductCredits('bookGeneration');
      if (!success) throw new Error('Failed to deduct credits');

      const targetPages = Math.max(4, Math.min(24, pageCount || 8));
      const bookSpec = await generateBookFromProjectContext(project, prompt, targetPages);

      if (!bookSpec.pages || !bookSpec.pages.length) {
        throw new Error('No pages generated for book');
      }

      const sessions = project.researchSessions || [];
      const latestSession = sessions[sessions.length - 1];
      const sessionId = latestSession?.id;

      const existingKb = project.knowledgeBase || [];
      const newKbFiles: KnowledgeBaseFile[] = [];
      const pages: BookPage[] = [];

      const bookId = typeof crypto !== 'undefined' && (crypto as any).randomUUID
        ? (crypto as any).randomUUID()
        : `book-${Date.now()}`;

      let previousImageBase64: string | null = null;

      for (const page of bookSpec.pages.slice(0, targetPages)) {
        const references: ImageReference[] = [];
        if (previousImageBase64) {
          references.push({ base64: previousImageBase64, mimeType: 'image/png' });
        }

        const pagePrompt = `${bookSpec.title || project.name} – page ${page.pageNumber}: ${page.imagePrompt || page.text || prompt}`;
        const imageResult = await generateImageWithReferences(pagePrompt, references, undefined);
        const imageUrl = imageResult.imageDataUrl;

        try {
          const res = await fetch(imageUrl);
          const blob = await res.blob();
          const fileName = `chat-book-${bookId}-page-${page.pageNumber}-${Date.now()}.png`;
          const file = new File([blob], fileName, { type: blob.type || 'image/png' });
          const kbFile = await storageService.uploadKnowledgeBaseFile(project.id, file, sessionId);
          newKbFiles.push(kbFile);

          let base64: string | null = null;
          if (imageUrl.startsWith('data:')) {
            const parts = imageUrl.split(',');
            base64 = parts[1] || null;
          } else {
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve, reject) => {
              reader.onload = () => {
                const result = reader.result as string;
                const encoded = result.split(',')[1];
                resolve(encoded);
              };
              reader.onerror = (err) => reject(err);
            });
            reader.readAsDataURL(file);
            base64 = await base64Promise;
          }
          previousImageBase64 = base64;

          pages.push({
            id: kbFile.id,
            pageNumber: page.pageNumber,
            imageUrl: kbFile.url,
            prompt: pagePrompt,
            text: page.text,
          });
        } catch (pageError: any) {
          console.error('Failed to generate or persist chat book page image', pageError);
        }
      }

      if (!pages.length) {
        throw new Error('Failed to generate any book pages');
      }

      const pagesSorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);

      let pdfKbFile: KnowledgeBaseFile | null = null;
      try {
        const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        // Helper to convert blob to PNG bytes if needed (e.g. for WebP)
        const convertToPng = (blob: Blob): Promise<ArrayBuffer> => {
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              if (!ctx) return reject(new Error('Canvas context not available'));
              ctx.drawImage(img, 0, 0);
              canvas.toBlob(b => {
                if (b) b.arrayBuffer().then(resolve).catch(reject);
                else reject(new Error('Canvas conversion failed'));
              }, 'image/png');
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(blob);
          });
        };

        for (const page of pagesSorted) {
          try {
            const res = await fetch(page.imageUrl);
            const blob = await res.blob();
            let arrayBuffer = await blob.arrayBuffer();
            let isPng = blob.type === 'image/png';
            let isJpg = blob.type === 'image/jpeg' || blob.type === 'image/jpg';

            // If unexpected format (like WebP), convert to PNG via canvas
            if (!isPng && !isJpg) {
              try {
                arrayBuffer = await convertToPng(blob);
                isPng = true;
              } catch (convErr) {
                console.warn('Image conversion to PNG failed', convErr);
                // Fallback: try embedding as-is (might fail if WebP)
              }
            }

            let image;
            if (isJpg) {
              image = await pdfDoc.embedJpg(arrayBuffer);
            } else {
              // Assume PNG (or try transparent fallback)
              image = await pdfDoc.embedPng(arrayBuffer);
            }

            // A4 dimensions roughly
            const pageWidth = 595.28;
            const pageHeight = 841.89;
            const pdfPage = pdfDoc.addPage([pageWidth, pageHeight]);

            // Draw Image (Top half)
            const { width, height } = image.scale(1);
            const maxWidth = pageWidth - 40; // 20px padding
            const scaleFactor = Math.min(maxWidth / width, (pageHeight * 0.6) / height);
            const drawWidth = width * scaleFactor;
            const drawHeight = height * scaleFactor;

            pdfPage.drawImage(image, {
              x: (pageWidth - drawWidth) / 2,
              y: pageHeight - drawHeight - 40, // 40px from top
              width: drawWidth,
              height: drawHeight,
            });

            // Draw Text (Bottom half)
            if (page.text) {
              const text = page.text;
              const fontSize = 12;
              const lineHeight = 16;
              const textX = 40;
              let textY = pageHeight - drawHeight - 70; // Start below image
              const maxTextWidth = pageWidth - 80;

              // Simple word wrap
              const words = text.split(' ');
              let line = '';
              for (const word of words) {
                const testLine = line + word + ' ';
                const width = font.widthOfTextAtSize(testLine, fontSize);
                if (width > maxTextWidth) {
                  pdfPage.drawText(line, { x: textX, y: textY, size: fontSize, font, color: rgb(0, 0, 0) });
                  line = word + ' ';
                  textY -= lineHeight;
                } else {
                  line = testLine;
                }
                // Stop if we run off the page
                if (textY < 40) break;
              }
              if (line) {
                pdfPage.drawText(line, { x: textX, y: textY, size: fontSize, font, color: rgb(0, 0, 0) });
              }
            }
          } catch (pagePdfError) {
            console.error('Failed to add page image/text to chat book PDF', pagePdfError);
          }
        }

        const pdfBytes = await pdfDoc.save();
        const pdfArrayBuffer = (pdfBytes.buffer as ArrayBuffer).slice(
          pdfBytes.byteOffset,
          pdfBytes.byteOffset + pdfBytes.byteLength
        );
        const pdfBlob = new Blob([pdfArrayBuffer], { type: 'application/pdf' });
        const pdfFileName = `chat-book-${bookId}.pdf`;
        const pdfFile = new File([pdfBlob], pdfFileName, { type: 'application/pdf' });
        pdfKbFile = await storageService.uploadKnowledgeBaseFile(project.id, pdfFile, sessionId);
        newKbFiles.push(pdfKbFile);
      } catch (pdfError) {
        console.error('Failed to generate or upload chat book PDF', pdfError);
      }

      // Deduplicate by ID to prevent double saves
      const existingIds = new Set(existingKb.map(f => f.id));
      const uniqueNewKbFiles = newKbFiles.filter(f => !existingIds.has(f.id));
      const updatedKnowledgeBase = [...existingKb, ...uniqueNewKbFiles];

      let updatedProject: ResearchProject = {
        ...project,
        knowledgeBase: updatedKnowledgeBase,
        lastModified: Date.now(),
      };

      let bookAsset: BookAsset | null = null;
      if (sessionId && latestSession && latestSession.researchReport) {
        const existingBooks = latestSession.researchReport.books || [];
        bookAsset = {
          id: bookId,
          title: bookSpec.title || prompt.trim() || project.name,
          description: bookSpec.description,
          pages,
          createdAt: Date.now(),
          pdfUrl: pdfKbFile?.url,
          pdfFileId: pdfKbFile?.id,
        };

        const updatedReport = {
          ...latestSession.researchReport,
          books: [bookAsset, ...existingBooks],
        };

        try {
          await storageService.updateResearchInProject(project.id, sessionId, { researchReport: updatedReport });
        } catch (err) {
          console.error('Failed to save chat-generated book into project research session:', err);
        }

        const updatedSessions = sessions.map(session =>
          session.id === sessionId ? { ...session, researchReport: updatedReport } : session
        );

        updatedProject = {
          ...updatedProject,
          researchSessions: updatedSessions,
        };
      }

      try {
        await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
      } catch (e) {
        console.error('Failed to sync chat-generated book into project knowledge base', e);
      }

      onProjectUpdate?.(updatedProject);

      return { book: bookAsset, pdfUrl: pdfKbFile?.url };
    },
    [project, onProjectUpdate]
  );

  const generateProjectBlogAsset = useCallback(
    async (prompt: string) => {
      // Credit Check
      const hasCredits = await checkCredits('blogGeneration');
      if (!hasCredits) return;

      const success = await deductCredits('blogGeneration');
      if (!success) {
        // Silently fail or let the user know? 
        // Ideally we should push a system message, but for now we stop to avoid cost.
        return;
      }

      const sessions = project.researchSessions || [];
      const latest = sessions[sessions.length - 1];
      const latestReport = latest?.researchReport;

      const topic = latestReport?.topic || project.name;
      const projectCtx = contextService.buildProjectContext(project);
      const summarySource = latestReport?.summary || prompt;
      const combinedSummary = `${summarySource}\n\nPROJECT CONTEXT:\n${projectCtx.fullContext.slice(0, 4000)}`;

      const keyPoints = latestReport?.keyPoints || [];
      const blog = await generateStructuredBlogPost(topic, combinedSummary, keyPoints);

      if (blog && latest && latestReport) {
        const updatedReport = {
          ...latestReport,
          blogPost: blog,
        };

        try {
          await storageService.updateResearchInProject(project.id, latest.id, {
            researchReport: updatedReport,
          });
        } catch (err) {
          console.error('Failed to save chat-generated blog into project research session:', err);
        }

        const updatedSessions = sessions.map(session =>
          session.id === latest.id ? { ...session, researchReport: updatedReport } : session
        );

        onProjectUpdate?.({
          ...project,
          researchSessions: updatedSessions,
          lastModified: Date.now(),
        });
      }

      return { blog };
    },
    [project, onProjectUpdate]
  );

  const generateProjectWebsiteAsset = useCallback(
    async (prompt: string) => {
      const hasCredits = await checkCredits('websiteGeneration');
      if (!hasCredits) return;
      const success = await deductCredits('websiteGeneration');
      if (!success) return;

      const recentResearch = (project.researchSessions || []).slice(-3).map(session => {
        const summary = session.researchReport?.summary || '';
        const keyPoints = (session.researchReport?.keyPoints || [])
          .slice(0, 3)
          .map(kp => `• ${kp.title}: ${kp.details}`)
          .join('\n');
        return `Session: ${session.topic}\nSummary: ${summary}\n${keyPoints}`;
      }).join('\n\n');

      const uploads = (project.uploadedFiles || [])
        .slice(-4)
        .map(file => `• ${file.displayName || file.name}`)
        .join('\n');
      const notes = (project.notes || [])
        .slice(0, 4)
        .map(note => `• ${note.title}`)
        .join('\n');
      const tasks = (project.tasks || [])
        .filter(t => t.status !== 'done')
        .slice(0, 4)
        .map(task => `• ${task.title}`)
        .join('\n');

      const specification = `PROJECT WEBSITE BRIEF
Project: ${project.name}
Mission: ${project.description}
User Goal: ${prompt.trim()}

Research Signals:
${recentResearch || 'No research sessions yet.'}

Active Tasks:
${tasks || 'No open tasks logged.'}

Pinned Notes:
${notes || 'No pinned notes available.'}

Uploaded Files of Interest:
${uploads || 'No uploaded files referenced.'}

Requirements:
- Modern, responsive layout with bold storytelling.
- Highlight key research insights and calls-to-action derived from context above.
- Include sections for hero, highlights, proof, and actionable next steps.`;

      const topSession = project.researchSessions?.[0];
      let contextText = `${project.name} | ${project.description}`;
      if (topSession) {
        const highlights = (topSession.researchReport?.keyPoints || [])
          .slice(0, 5)
          .map(kp => `${kp.title}: ${kp.details}`)
          .join('\n');
        contextText = `Research Topic: ${topSession.topic}
Summary: ${topSession.researchReport?.summary || ''}
Highlights:
${highlights}`;
      }

      const theme = (project.researchSessions?.[0]?.researchReport as any)?.theme;
      const finalHtml = await refineWebsiteCode(
        specification,
        contextText,
        theme,
        () => { },
        () => { }
      );

      const newWebsiteVersion: any = {
        id: typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `website-${Date.now()}`,
        timestamp: Date.now(),
        html: finalHtml,
        description: prompt.trim().substring(0, 60) || 'Project website experience',
      };

      const sessions = project.researchSessions || [];
      const latest = sessions[sessions.length - 1];
      if (latest) {
        const existingVersions = latest.websiteVersions || [];
        try {
          await storageService.updateResearchInProject(project.id, latest.id, {
            websiteVersions: [newWebsiteVersion, ...existingVersions],
          });
        } catch (err) {
          console.error('Failed to save chat-generated website to project session', err);
        }

        const updatedSessions = sessions.map(session =>
          session.id === latest.id
            ? { ...session, websiteVersions: [newWebsiteVersion, ...existingVersions] }
            : session
        );

        onProjectUpdate?.({
          ...project,
          researchSessions: updatedSessions,
          lastModified: Date.now(),
        });
      }

      return { html: finalHtml, description: newWebsiteVersion.description };
    },
    [project, onProjectUpdate]
  );

  const captureFrame = useCallback((): { data: string; mimeType: string } | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Set canvas dimensions to match video
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    // Draw current video frame to canvas
    ctx.drawImage(video, 0, 0);

    // Convert to JPEG base64
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    const base64 = dataUrl.split(',')[1];

    return { data: base64, mimeType: 'image/jpeg' };
  }, []);

  const connectVoice = async (targetMode: AssistantMode = 'voice') => {
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

      const constraints = {
        audio: true,
        video: targetMode === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      if (targetMode === 'video' && videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => { });
        setIsVideoLoading(false);
      }

      // Build system instruction with file list and tool instructions
      const baseVoiceInstruction = contextService.getProjectSystemInstruction(project, 'voice', userProfile, activities || []);

      // List available files so the model knows what can be analyzed (Data tab + Knowledge Base)
      let filesContext = '';
      const dataFiles = project.uploadedFiles || [];
      const kbFiles = project.knowledgeBase || [];

      if (dataFiles.length > 0) {
        filesContext += `\n\nAVAILABLE FILES IN PROJECT DATA TAB (use analyze_project_file tool to read/analyze these):\n`;
        dataFiles.forEach((file, idx) => {
          filesContext += `${idx + 1}. "${file.displayName || file.name}" (${file.mimeType || 'unknown type'})\n`;
        });
      }

      if (kbFiles.length > 0) {
        filesContext += `\n\nAVAILABLE KNOWLEDGE BASE FILES (auto-summarized research assets, generated images/videos, documents). You can also use analyze_project_file on these by name when the user requests a deeper analysis.\n`;
        kbFiles.forEach((file, idx) => {
          filesContext += `${idx + 1}. "${file.name}" (${file.type || 'unknown type'})\n`;
        });
      }

      if (filesContext) {
        filesContext += `\nIMPORTANT: When the user asks about a specific file, you MUST call the analyze_project_file tool with the file name to retrieve and analyze its contents. Do NOT make up information about files - always use the tool first.
- If the user asks a general question that may span multiple documents (e.g., "What do my files say about pricing?"), use the search_knowledge_base tool to search across all indexed project documents.`;
      }

      // Build social connection status for the AI
      const socialConnectionStatus = `
SOCIAL MEDIA CONNECTION STATUS (REAL-TIME):
- Facebook: ${facebookConnected ? '✓ CONNECTED' : '✗ NOT CONNECTED'}${facebookConnected && fbPages?.length > 0 ? ` (Pages: ${fbPages.map((p: any) => p.name).join(', ')})` : ''}
- Instagram: ${facebookConnected && igAccounts.length > 0 ? '✓ CONNECTED' : '✗ NOT CONNECTED'}${igAccounts.length > 0 ? ` (Accounts: ${igAccounts.map((a: any) => '@' + (a.username || a.name)).join(', ')})` : ''}
- X (Twitter): ${xConnected ? '✓ CONNECTED' : '✗ NOT CONNECTED'}
- TikTok: ${tiktokConnected ? '✓ CONNECTED' : '✗ NOT CONNECTED'}
- YouTube: ${youtubeConnected ? '✓ CONNECTED' : '✗ NOT CONNECTED'}
- LinkedIn: ${linkedinConnected ? '✓ CONNECTED' : '✗ NOT CONNECTED'}

STRIPE PAYMENT CONNECTION STATUS (REAL-TIME):
- Stripe: ${((window as any).__userProfile as UserProfile | undefined)?.stripeConnect?.accountId ? '✓ CONNECTED' : '✗ NOT CONNECTED - User must click "Connect Stripe" button to set up payments'}
${((window as any).__userProfile as UserProfile | undefined)?.stripeConnect?.chargesEnabled ? '  - Charges: ✓ Enabled (can accept payments)' : ''}
${((window as any).__userProfile as UserProfile | undefined)?.stripeConnect?.accountId && !((window as any).__userProfile as UserProfile | undefined)?.stripeConnect?.chargesEnabled ? '  - Charges: ✗ Pending (onboarding incomplete)' : ''}

IMPORTANT: Stripe is SEPARATE from social media connections. When user wants to CREATE A PRODUCT or SELL something:
1. Check the STRIPE CONNECTION STATUS above (NOT social media)
2. If Stripe is NOT CONNECTED, tell them to click the "Connect Stripe" button that will appear
3. If Stripe IS CONNECTED, proceed with the create_stripe_product tool
4. Do NOT show social media connect buttons for product creation

=== GUIDED SOCIAL MEDIA SHARING FLOW ===

When the user expresses ANY intent to share on social media (keywords: "post", "share", "publish", "put this on", "upload to", "social media", "instagram", "tiktok", "facebook", "twitter", "x", "linkedin", "youtube"), you MUST guide them through this conversational flow.
IMPORTANT: If the user asks to "animate this", "make it a video", "create a video", or "generate a video", this is a CREATION request, NOT a posting request. Use the generation tools (generate_video_from_image/prompt) FIRST. Only start the posting flow AFTER the video is generated and the user confirms they want to share it.

**STEP 1: IDENTIFY CONTENT**
First, determine what content they want to post:
- If they have recently generated media (check RECENTLY GENERATED MEDIA section) → Ask: "I see you just created [that image/video]. Would you like to share that?"
- If they mention specific content → Acknowledge it
- If unclear → Ask: "What would you like to share? I can help you create an image, video, or text post."

**STEP 2: CREATE CONTENT IF NEEDED**
If they need new content:
- For images → Use generate_image_with_gemini tool with their description
- For videos → Use generate_video_from_image or generate_video_from_prompt tool
- After generating → Show them what was created and ask: "Here's your [image/video]! Should I post this, or would you like me to modify it?"

**STEP 3: GET CAPTION**
Once content is confirmed:
- Ask: "What caption or message would you like to go with this?"
- If they want help → Suggest 2-3 caption options based on the content and project context
- Accept their caption or let them modify your suggestions

**STEP 4: SELECT PLATFORMS**
After caption is set:
- Ask: "Which platforms would you like me to post to? You can choose: ${facebookConnected ? 'Facebook, ' : ''}${facebookConnected && igAccounts.length > 0 ? 'Instagram, ' : ''}${xConnected ? 'X, ' : ''}${tiktokConnected ? 'TikTok, ' : ''}${youtubeConnected ? 'YouTube, ' : ''}${linkedinConnected ? 'LinkedIn' : ''}"
- If platform not connected → Offer to help them connect: "I see [platform] isn't connected yet. Would you like to connect it now?"
- Multiple platforms → Confirm: "Got it! I'll post to [list platforms]."

**STEP 5: POST NOW OR SCHEDULE?**
Ask: "Would you like me to post this now, or schedule it for later?"

If SCHEDULE:
- Ask: "When would you like it to go out? You can say something like 'tomorrow at 9am' or 'next Monday at 2pm'."
- Confirm: "I'll schedule your post for [datetime]. Is that correct?"
- Then use schedule_post tool with the gathered info

If POST NOW:
- Confirm: "Posting to [platforms] now!"
- Use post_to_social tool with useLastGenerated: true if using recent media

**CONFIRMATION**
After posting/scheduling:
- Report success: "Done! Your [image/video/post] has been [posted/scheduled] to [platforms]."
- If any platform failed → Report which ones succeeded/failed

**SHORTCUTS (Skip Steps)**
If the user provides everything upfront (e.g., "Post my sunset image to Instagram with caption 'Beautiful day!'"):
- Skip the clarification steps and proceed directly
- Still confirm before posting: "I'll post your sunset image to Instagram with the caption 'Beautiful day!' - shall I go ahead?"

**IMPORTANT RULES:**
- ALWAYS be conversational and friendly
- NEVER post without user confirmation
- If user says "that", "this", "the image", "the video" → Use recently generated media (useLastGenerated: true)
- Keep guiding until the post is complete
      - If user abandons mid-flow, ask if they want to continue later

CAMERA CAPTURE & GENERATION (video mode only):

IMAGE FROM CAMERA – Call capture_and_generate_image when the user:
- Points at their drawings or physical objects and says "turn this into...", "make this look like...", "transform this". Pass the user's description as the \`prompt\`.

VIDEO FROM CAMERA – Call capture_and_generate_video for non-social video creation from the camera view.

SOCIAL REEL FROM CAMERA – Call create_social_reel for Instagram/TikTok reels based on the camera view.

NOTEBOOK & PAPER INTERACTION – Use these tools when the user shows a physical notebook or paper:

1. ANALYZE PAPER – Call analyze_paper_note when the user says:
   - "Summarize what I've written here"
   - "Explain this diagram/sketch"
   - "Check if my notes on [topic] are correct"
   - "What does this paper say?"
   - "Give me feedback on this drawing"

2. EXTRACT TO PROJECT NOTES – Call extract_paper_to_note when the user says:
   - "Save this to my notes"
   - "Digitize this page"
   - "Put this into my project notebook"
   - "Keep a copy of this handwriting"

3. DIGITIZE SKETCH – Call digitize_paper_sketch when the user says:
   - "Turn this sketch into a professional illustration"
   - "Make a 3D render of this architectural drawing"
   - "Digitize this concept art"
   - "Transform this doodle into a clean vector graphic"

4. GENERATE WEBSITE FROM SKETCH – Call generate_website_from_sketch when the user says:
   - "Build a website from this sketch"
   - "Turn this wireframe into code"
   - "Make a webpage out of this drawing"

IMPORTANT: Always capture and process immediately when these intents are detected. The AI will receive the camera frame automatically when these tools are called.
`;

      // Add context about recently generated media
      const voiceGeneratedMediaContext = lastGeneratedAsset
        ? `\n\nRECENTLY GENERATED MEDIA:
You just generated a ${lastGeneratedAsset.type} (${lastGeneratedAsset.name}) ${Math.floor((Date.now() - lastGeneratedAsset.timestamp) / 1000)} seconds ago.
- If the user says "post that to [platform]", "post it to [platform]", or "share that on [platform]" → use contentType: '${lastGeneratedAsset.type}' and useLastGenerated: true
- If the user says "create a video from it", "animate this", "make it a video", "turn it into a video" AND the last asset was an IMAGE → call generate_video_from_image with imageUrl: '${lastGeneratedAsset.publicUrl || lastGeneratedAsset.url}' and prompt: "Animate this image".
- The system will automatically use this recently generated ${lastGeneratedAsset.type}
`
        : '';

      const systemInstruction = `${baseVoiceInstruction}${filesContext}

DOCS & TABLES EDITING (voice mode tools):
- If the user asks to edit the document in Assets > Docs, use these tools: get_docs_draft, set_docs_draft_text, append_docs_draft_text, replace_docs_draft_text, insert_docs_inline_image, save_docs_draft.
- If the user asks to edit the table in Assets > Tables, use these tools: get_table_draft, set_table_cell, add_table_row, delete_table_row, add_table_column, delete_table_column, rename_table_column, set_table_title, set_table_description, set_table_draft, set_table_rows, set_table_columns, set_table_row, set_table_column, edit_project_table.
- If the tools report the editor is not available, ask the user to open the relevant tab and load a Doc/table first.
- VISUAL INTELLIGENCE: When editing tables or documents, you CAN look at the camera feed if the user shows you a document, receipt, or screen, and use that visual data to update the table/doc (e.g. "update the table with the numbers on this page").

WEBSITE GENERATION & EDITING:
- To create a completely new website from a sketch shown on camera, use: generate_website_from_sketch
- To edit an existing website in the Assets > Websites tab, use: refine_website_code
- VISUAL INTELLIGENCE: You CAN and SHOULD use the live camera feed when the user points to a sketch, drawing, or reference image and asks to update the website to match it.

${socialConnectionStatus}
GENERAL VISUAL INTELLIGENCE:
- You have full access to a live video stream from the user.
- If the user asks you to "generate a book about this", "make a table from this", "write a blog about this", or "create a podcast from this", you MUST use the visual information in the camera frame to fulfill their request.
- Seamlessly apply this visual context to the prompt arguments of tools like generate_project_book, generate_project_table, generate_project_blog, and generate_project_podcast.
${voiceGeneratedMediaContext}`;

      // Define tools for file analysis and media generation/editing
      const analyzeFileTool = {
        name: 'analyze_project_file',
        description: 'Retrieves and analyzes the contents of an uploaded file from the project Data tab. Call this when the user asks about a specific file.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            fileName: {
              type: Type.STRING,
              description: 'The display name or name of the file to analyze'
            },
            task: {
              type: Type.STRING,
              description: 'What to do with the file (e.g., summarize, extract key points, answer questions about it)'
            }
          },
          required: ['fileName']
        }
      };

      const searchKnowledgeBaseTool = {
        name: 'search_knowledge_base',
        description: 'Search across ALL indexed documents in the project knowledge base to answer a question. Use this when the user asks a general question that may span multiple documents (e.g., "What do my documents say about pricing?"). Do NOT use this for single-file analysis; use analyze_project_file for that.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'The question or topic to search for across all project documents.'
            }
          },
          required: ['query']
        }
      };

      const getTableDraftTool = {
        name: 'get_table_draft',
        description: 'Get the current table being edited in the Assets > Tables tab (title/columns/rows).',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        }
      };

      const setTableCellTool = {
        name: 'set_table_cell',
        description: 'Set a cell value in the Tables tab editor by row/column index.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            rowIndex: { type: Type.NUMBER, description: '0-based row index.' },
            colIndex: { type: Type.NUMBER, description: '0-based column index.' },
            value: { type: Type.STRING, description: 'New cell value.' },
          },
          required: ['rowIndex', 'colIndex', 'value']
        }
      };

      const addTableRowTool = {
        name: 'add_table_row',
        description: 'Add a row to the table in the Tables tab editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            index: { type: Type.NUMBER, description: 'Optional insertion index (0-based). Defaults to append.' }
          }
        }
      };

      const deleteTableRowTool = {
        name: 'delete_table_row',
        description: 'Delete a row from the table in the Tables tab editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            rowIndex: { type: Type.NUMBER, description: '0-based row index to delete.' }
          },
          required: ['rowIndex']
        }
      };

      const addTableColumnTool = {
        name: 'add_table_column',
        description: 'Add a column to the table in the Tables tab editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Optional column name.' },
            index: { type: Type.NUMBER, description: 'Optional insertion index (0-based). Defaults to append.' }
          }
        }
      };

      const deleteTableColumnTool = {
        name: 'delete_table_column',
        description: 'Delete a column from the table in the Tables tab editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            colIndex: { type: Type.NUMBER, description: '0-based column index to delete.' }
          },
          required: ['colIndex']
        }
      };

      const renameTableColumnTool = {
        name: 'rename_table_column',
        description: 'Rename a column in the table editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            colIndex: { type: Type.NUMBER, description: '0-based column index.' },
            name: { type: Type.STRING, description: 'New column name.' }
          },
          required: ['colIndex', 'name']
        }
      };

      const setTableTitleTool = {
        name: 'set_table_title',
        description: 'Set the table title in the Tables tab editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'New table title.' }
          },
          required: ['title']
        }
      };

      const setTableDescriptionTool = {
        name: 'set_table_description',
        description: 'Set the table description in the Tables tab editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING, description: 'New table description.' }
          },
          required: ['description']
        }
      };

      const setTableDraftTool = {
        name: 'set_table_draft',
        description: 'Replace the entire table in the Tables tab editor at once (title/description/columns/rows).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Optional table title.' },
            description: { type: Type.STRING, description: 'Optional table description.' },
            columns: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Full list of column headers.'
            },
            rows: {
              type: Type.ARRAY,
              items: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              description: 'Full 2D array of rows (each row is an array of strings).'
            },
          },
          required: ['columns', 'rows']
        }
      };

      const setTableRowsTool = {
        name: 'set_table_rows',
        description: 'Replace all table rows at once (keeps existing columns).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            rows: {
              type: Type.ARRAY,
              items: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              description: 'Full 2D array of rows.'
            },
          },
          required: ['rows']
        }
      };

      const setTableColumnsTool = {
        name: 'set_table_columns',
        description: 'Replace all table columns/headers at once (keeps existing rows).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            columns: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Full list of column headers.'
            },
          },
          required: ['columns']
        }
      };

      const setTableRowTool = {
        name: 'set_table_row',
        description: 'Replace an entire row by index.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            rowIndex: { type: Type.NUMBER, description: '0-based row index.' },
            row: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Full row values (array of strings).'
            },
          },
          required: ['rowIndex', 'row']
        }
      };

      const setTableColumnTool = {
        name: 'set_table_column',
        description: 'Replace an entire column by index (optionally rename the column).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            colIndex: { type: Type.NUMBER, description: '0-based column index.' },
            name: { type: Type.STRING, description: 'Optional new column header.' },
            column: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Column values for each row (array of strings). Missing entries become empty strings.'
            },
          },
          required: ['colIndex', 'column']
        }
      };

      const generateProjectTableTool = {
        name: 'generate_project_table',
        description: 'Generate a new table using your project context and load it into the Assets > Tables editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: { type: Type.STRING, description: 'What the table should contain.' }
          },
          required: ['prompt']
        }
      };

      const saveProjectTableTool = {
        name: 'save_project_table',
        description: 'Save the currently loaded table from Assets > Tables into the latest research session tables list.',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        }
      };

      const saveProjectTableToGoogleSheetTool = {
        name: 'save_table_to_google_sheet',
        description: 'Save the currently loaded table back to its linked Google Sheet (if linked).',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        }
      };

      const getDocsDraftTool = {
        name: 'get_docs_draft',
        description: 'Get the currently loaded Google Doc draft from the Assets > Docs tab editor (documentId/title/text).',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        }
      };

      const setDocsDraftTextTool = {
        name: 'set_docs_draft_text',
        description: 'Overwrite the entire Docs tab editor content with new text. Only works if a Google Doc is currently loaded in the Docs tab.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: 'The full new document text (use plain text; inline images can be inserted separately).' }
          },
          required: ['text']
        }
      };

      const appendDocsDraftTextTool = {
        name: 'append_docs_draft_text',
        description: 'Append text to the end of the Docs tab editor content. Only works if a Google Doc is loaded.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: 'Text to append.' },
            separator: { type: Type.STRING, description: 'Optional separator to insert before appended text (default: newline).' },
          },
          required: ['text']
        }
      };

      const replaceDocsDraftTextTool = {
        name: 'replace_docs_draft_text',
        description: 'Replace text inside the Docs tab editor content. Supports optional regex mode.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            find: { type: Type.STRING, description: 'Text (or regex pattern if useRegex=true) to find.' },
            replace: { type: Type.STRING, description: 'Replacement text.' },
            useRegex: { type: Type.BOOLEAN, description: 'If true, treat find as a regex pattern.' },
            caseSensitive: { type: Type.BOOLEAN, description: 'If true, use case-sensitive matching.' },
          },
          required: ['find', 'replace']
        }
      };

      const insertDocsInlineImageTool = {
        name: 'insert_docs_inline_image',
        description: 'Insert an inline image into the Docs tab editor at the current cursor position. The image URL must be publicly accessible (http/https).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            url: { type: Type.STRING, description: 'Public image URL (http/https).' },
            widthPx: { type: Type.NUMBER, description: 'Optional width in pixels.' },
            heightPx: { type: Type.NUMBER, description: 'Optional height in pixels.' },
          },
          required: ['url']
        }
      };

      const saveDocsDraftTool = {
        name: 'save_docs_draft',
        description: 'Save the current Docs tab editor content to the selected Google Doc (writes text + inline images).',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        }
      };

      const runProjectSeoTool = {
        name: 'run_project_seo_analysis',
        description: 'Switch to the project SEO tab, run the RapidAPI keyword analysis, display results, and return key takeaways. Use this when the user asks for SEO stats, keyword volume, or SEO opportunities.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            keyword: {
              type: Type.STRING,
              description: 'Primary keyword to analyze.'
            },
            location: {
              type: Type.STRING,
              description: 'Country code for keyword stats (e.g., US, GB, CA).'
            }
          }
        }
      };

      const generateImageTool = {
        name: 'generate_image_with_gemini',
        description: 'Generate a new 1024x1024 image with Gemini based on a text prompt and project context.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Description of the image to generate.'
            },
            referenceImageUrl: {
              type: Type.STRING,
              description: 'Optional URL of an image to use as a style/structure reference (e.g. user logo, profile pic).'
            }
          },
          required: ['prompt']
        }
      };

      const editImageTool = {
        name: 'edit_image_with_gemini',
        description: 'Edit an existing image using Gemini AI. AUTOMATICALLY DETECTS attached or dropped images - no URL needed for recently attached/dropped media. Use this when user wants to modify, enhance, or change an existing image (e.g., "make it daytime", "add clouds", "change the background", "remove the person").',
        parameters: {
          type: Type.OBJECT,
          properties: {
            imageUrl: {
              type: Type.STRING,
              description: 'Optional URL of image to edit. If omitted, uses the most recently attached or dropped image.'
            },
            instruction: {
              type: Type.STRING,
              description: 'How to edit or change the image (e.g., "make it daytime", "add a sunset sky").'
            }
          },
          required: ['instruction']
        }
      };

      const editVideoTool = {
        name: 'edit_video_with_xai',
        description: 'Edit an existing video using xAI Grok. AUTOMATICALLY DETECTS attached or dropped videos. Max input video length: 8.7 seconds. Use this when user wants to modify an existing video (e.g., "make it slow motion", "zoom in", "add effects").',
        parameters: {
          type: Type.OBJECT,
          properties: {
            videoUrl: {
              type: Type.STRING,
              description: 'Optional URL of video to edit. If omitted, uses the most recently attached or dropped video.'
            },
            instruction: {
              type: Type.STRING,
              description: 'How to edit or change the video.'
            }
          },
          required: ['instruction']
        }
      };

      const generateVideoFromImageTool = {
        name: 'generate_video_from_image',
        description: 'Generate a video from an image using Sora 2 (with Veo 3.1 fallback). You can provide a direct URL, reference an existing asset by ID from knowledge base, or reference by filename. The AI can use images it previously generated, uploaded images, or any asset in the project.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            imageUrl: {
              type: Type.STRING,
              description: 'Direct image URL to animate into a video.'
            },
            assetId: {
              type: Type.STRING,
              description: 'ID of an existing knowledge base asset (image) to animate.'
            },
            assetName: {
              type: Type.STRING,
              description: 'Filename or partial name of an existing knowledge base asset to search for and animate.'
            },
            prompt: {
              type: Type.STRING,
              description: 'Description of the motion, camera, and style for the video.'
            },
            aspect: {
              type: Type.STRING,
              description: 'Video resolution/aspect ratio.',
              enum: ['720x1280', '1280x720']
            },
            mode: {
              type: Type.STRING,
              description: 'Speed/quality tradeoff: speed -> sora-2, quality -> sora-2-pro.',
              enum: ['speed', 'quality']
            }
          },
          required: ['prompt']
        }
      };

      const generateVideoFromPromptTool = {
        name: 'generate_video_from_prompt',
        description: 'Generate a 12 second Sora video from a pure text prompt.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Description of the scene and motion for the video.'
            },
            aspect: {
              type: Type.STRING,
              description: 'Video resolution/aspect ratio.',
              enum: ['720x1280', '1280x720']
            },
            mode: {
              type: Type.STRING,
              description: 'Speed/quality tradeoff: speed -> sora-2, quality -> sora-2-pro.',
              enum: ['speed', 'quality']
            }
          },
          required: ['prompt']
        }
      };

      const generateVideoOverviewTool = {
        name: 'generate_video_overview',
        description: 'Generate a comprehensive AI-avatar powered project overview video. Uses HeyGen avatar with Gemini TTS voice, background slides, and project context. Best for project summaries, explainer videos, and professional presentations. Takes 10-20 minutes to generate.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'What the overview video should focus on (topic, angle, key points).'
            },
            aspect: {
              type: Type.STRING,
              description: 'Video aspect ratio.',
              enum: ['16:9', '9:16']
            },
            slideCount: {
              type: Type.NUMBER,
              description: 'Number of slides in the video (8-16). Defaults to 12.'
            }
          },
          required: ['prompt']
        }
      };


      const generateProjectBlogTool = {
        name: 'generate_project_blog',
        description: 'Generate a project-level blog article using all project context and save it into the latest research session.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'What the blog should focus on (angle, audience, style).'
            }
          },
          required: ['prompt']
        }
      };

      const generateProjectWebsiteTool = {
        name: 'generate_project_website',
        description: 'Generate a project-wide website experience using research, notes, tasks, and uploaded files, and save it to project assets.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'What the website should emphasize (goal, sections, tone).'
            }
          },
          required: ['prompt']
        }
      };

      const generateProjectPodcastTool = {
        name: 'generate_project_podcast',
        description: 'Generate a project-wide podcast episode using research, notes, tasks, and uploaded files, and save it to project assets.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'What the podcast should focus on (topic, angle, audience).'
            },
            style: {
              type: Type.STRING,
              description: 'Podcast style.',
              enum: ['conversational', 'educational', 'debate', 'interview']
            },
            duration: {
              type: Type.STRING,
              description: 'Approximate podcast length.',
              enum: ['short', 'medium', 'long']
            }
          },
          required: ['prompt']
        }
      };

      // --- NEW TOOLS: Tasks, Notes, Schedule ---
      const createProjectTaskTool = {
        name: 'create_project_task',
        description: 'Create a new task in the project task list.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Task title.' },
            description: { type: Type.STRING, description: 'Task description/details.' },
            priority: { type: Type.STRING, description: 'Priority level.', enum: ['low', 'medium', 'high'] }
          },
          required: ['title']
        }
      };

      const updateProjectTaskTool = {
        name: 'update_project_task',
        description: 'Update an existing task (mark as done, change priority, etc).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING, description: 'The ID of the task to update (from context).' },
            status: { type: Type.STRING, enum: ['todo', 'in_progress', 'done'] },
            priority: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
            title: { type: Type.STRING },
            description: { type: Type.STRING }
          },
          required: ['taskId']
        }
      };

      const deleteProjectTaskTool = {
        name: 'delete_project_task',
        description: 'Delete a task from the project.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING, description: 'ID of the task to delete.' }
          },
          required: ['taskId']
        }
      };

      const createProjectNoteTool = {
        name: 'create_project_note',
        description: 'Create a new note in the project notebook.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Note title.' },
            content: { type: Type.STRING, description: 'Note content.' }
          },
          required: ['title', 'content']
        }
      };

      const appendProjectNoteTool = {
        name: 'append_project_note',
        description: 'Append text to an existing note.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            noteId: { type: Type.STRING, description: 'ID of the note to append to.' },
            text: { type: Type.STRING, description: 'Text to append.' }
          },
          required: ['noteId', 'text']
        }
      };

      const deleteProjectNoteTool = {
        name: 'delete_project_note',
        description: 'Delete a note from the project.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            noteId: { type: Type.STRING, description: 'ID of the note to delete.' }
          },
          required: ['noteId']
        }
      };

      const deleteScheduledPostTool = {
        name: 'delete_scheduled_post',
        description: 'Cancel/Delete a scheduled social media post.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            postId: { type: Type.STRING, description: 'ID of the scheduled post to delete.' }
          },
          required: ['postId']
        }
      };

      const startProjectResearchTool = {
        name: 'start_new_research_session',
        description: 'Start a new deep research session on a topic using the Deep Research Agent. Takes time to complete.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            topic: { type: Type.STRING, description: 'The research topic or question.' }
          },
          required: ['topic']
        }
      };

      // ===== Tools for Chat/Voice Feature Parity =====
      const getProjectResearchSessionsTool = {
        name: 'get_project_research_sessions',
        description: 'Get a summary of ALL research sessions in the project. Use this when the user asks about their research, research sessions, research findings, or wants a summary of what research has been done.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            includeFull: {
              type: Type.BOOLEAN,
              description: 'If true, include full session details. If false or omitted, return a summary.'
            }
          },
          required: []
        }
      };

      const getResearchSessionDetailsTool = {
        name: 'get_research_session_details',
        description: 'Get FULL details for a SPECIFIC research session by topic name or index.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            topic: {
              type: Type.STRING,
              description: 'The topic name to search for (partial match supported).'
            },
            index: {
              type: Type.NUMBER,
              description: 'The 1-based index of the session (e.g., 1 for first session).'
            }
          },
          required: []
        }
      };

      const getProjectOverviewTool = {
        name: 'get_project_overview',
        description: 'Get an overview of the current project including name, description, creation date, and counts of research sessions, tasks, notes, and files.',
        parameters: {
          type: Type.OBJECT,
          properties: {},
          required: []
        }
      };

      const getProjectFileTool = {
        name: 'get_project_file',
        description: 'Retrieve and analyze a specific file from the project by name.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            fileName: {
              type: Type.STRING,
              description: 'The name or partial name of the file to find and analyze.'
            }
          },
          required: ['fileName']
        }
      };

      const generateProjectBookTool = {
        name: 'generate_project_book',
        description: 'Generate an illustrated book using project research, notes, tasks, and assets, then save its pages and a compiled PDF into project assets.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'What the book should focus on (audience, narrative, concepts, characters).'
            },
            pageCount: {
              type: Type.NUMBER,
              description: 'Approximate number of pages (4–24). Optional.'
            }
          },
          required: ['prompt']
        }
      };

      // --- Email Tools ---
      const sendEmailTool = {
        name: 'send_email',
        description: 'Send an email immediately via Gmail or Outlook. IMPORTANT: First check if user has Gmail or Outlook connected. If not connected, tell the user to connect their email in the Email tab first. Ask for recipient email, subject, and what the email should be about before sending.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            provider: {
              type: Type.STRING,
              description: 'Email provider to use: "gmail" or "outlook".',
              enum: ['gmail', 'outlook']
            },
            to: {
              type: Type.STRING,
              description: 'Recipient email address.'
            },
            subject: {
              type: Type.STRING,
              description: 'Email subject line.'
            },
            body: {
              type: Type.STRING,
              description: 'Email body content in HTML format. Can include formatting like <p>, <b>, <ul>, etc.'
            }
          },
          required: ['provider', 'to', 'subject', 'body']
        }
      };

      const scheduleEmailTool = {
        name: 'schedule_email',
        description: 'Schedule an email to be sent at a specific future time via Gmail or Outlook. Must be at least 10 minutes in the future and within 7 days. Ask for recipient, subject, content, and when to send.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            provider: {
              type: Type.STRING,
              description: 'Email provider to use: "gmail" or "outlook".',
              enum: ['gmail', 'outlook']
            },
            to: {
              type: Type.STRING,
              description: 'Recipient email address, or comma-separated list for multiple recipients.'
            },
            subject: {
              type: Type.STRING,
              description: 'Email subject line.'
            },
            body: {
              type: Type.STRING,
              description: 'Email body content in HTML format.'
            },
            scheduledTime: {
              type: Type.STRING,
              description: 'When to send the email. Natural language like "tomorrow at 9am", "next Monday at 2pm", "in 2 hours", or ISO 8601 datetime.'
            }
          },
          required: ['provider', 'to', 'subject', 'body', 'scheduledTime']
        }
      };

      const sendBulkEmailTool = {
        name: 'send_bulk_email',
        description: 'Send an email to multiple recipients from captured leads. Use this when user wants to email leads from their Forms tab. Ask what the email should be about and optionally which lead form to target.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            provider: {
              type: Type.STRING,
              description: 'Email provider to use: "gmail" or "outlook".',
              enum: ['gmail', 'outlook']
            },
            formId: {
              type: Type.STRING,
              description: 'Optional: ID of a specific lead form to filter recipients. If not provided, sends to all leads.'
            },
            subject: {
              type: Type.STRING,
              description: 'Email subject line.'
            },
            body: {
              type: Type.STRING,
              description: 'Email body content in HTML format. Can use {name} placeholder for personalization.'
            }
          },
          required: ['provider', 'subject', 'body']
        }
      };

      // --- PDF Generation Tool ---
      const generatePdfTool = {
        name: 'generate_pdf',
        description: 'Generate an illustrated PDF document (ebook, guide, report, brochure, etc.) using project context and AI. This tool has NO usage limits for Pro subscribers - always proceed to generate when requested. Ask user what type of document they want, the topic/focus, and optionally how many pages (4-24). The PDF will be saved to project assets and a download link provided.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'What the PDF should be about - topic, focus, audience, style. Be descriptive.'
            },
            pageCount: {
              type: Type.NUMBER,
              description: 'Number of pages (4-24). Defaults to 8 if not specified.'
            },
            documentType: {
              type: Type.STRING,
              description: 'Type of document to generate.',
              enum: ['ebook', 'guide', 'report', 'brochure', 'presentation', 'whitepaper', 'manual']
            }
          },
          required: ['prompt']
        }
      };

      // --- TOOL: Lead Form Generation ---
      const generateFormTool = {
        name: 'generate_lead_form',
        description: 'Generate a lead capture form website. This tool costs 45 credits. Ask for title, design prompt, and fields (or suggest defaults). The form will be hosted publicly and submissions are saved automatically.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: 'Title of the form (e.g., "Contact Us", "Get a Free Quote").'
            },
            prompt: {
              type: Type.STRING,
              description: 'Design vision/style for the form (colors, layout, branding).'
            },
            fields: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING, description: 'Field label (e.g., "Full Name", "Email Address").' },
                  type: { type: Type.STRING, description: 'Field type.', enum: ['text', 'email', 'phone', 'textarea', 'select', 'checkbox'] },
                  required: { type: Type.BOOLEAN, description: 'Whether field is required.' },
                  placeholder: { type: Type.STRING, description: 'Placeholder text for the field.' },
                  options: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Options for select fields.' }
                },
                required: ['label', 'type']
              },
              description: 'Array of form fields to include.'
            }
          },
          required: ['title', 'prompt', 'fields']
        }
      };

      // --- Email Template Scheduling Tool ---
      const scheduleTemplateEmailTool = {
        name: 'schedule_template_email',
        description: `PRIORITY TOOL for sending emails to email lists. Use this tool FIRST when:

TRIGGER KEYWORDS (high priority):
- "schedule the [name] email" → templateName: name
- "send email to leads/table/list"
- "email the [name] template to [source]"
- "send newsletter to my prospects table"
- Any mention of: "email template", "email to leads", "email list", "send to table"

EMAIL LIST SOURCES - always ask which source if not specified:
- "leads" or "form" → Use captured leads from lead forms
- "table" → Use a table from Assets > Tables (find email column)
- "file" → Use uploaded CSV/Excel file

If user doesn't specify source, ASK which email list to use.
DO NOT use schedule_post for email - use THIS tool instead.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            templateName: {
              type: Type.STRING,
              description: 'Name of the email template to use. If not specified, ask user to choose one or create one.'
            },
            formName: {
              type: Type.STRING,
              description: 'Name of the lead form to use as source (fuzzy match). Use "leads" or "form" keyword.'
            },
            tableName: {
              type: Type.STRING,
              description: 'Name of the table to use as source (fuzzy match).'
            },
            fileName: {
              type: Type.STRING,
              description: 'Name of the uploaded file to use as source (fuzzy match).'
            },
            emailSource: {
              type: Type.STRING,
              description: 'Explicit source type: "form", "table", "file", or "ask".',
              enum: ['form', 'table', 'file', 'ask']
            },
            scheduledAt: {
              type: Type.STRING,
              description: 'When to send the email (natural language or ISO). Default: "now".'
            }
          },
          required: ['templateName']
        }
      };

      // --- TOOL: Stripe Product Creation ---
      const createStripeProductTool = {
        name: 'create_stripe_product',
        description: `Create a Stripe product with a payment link for selling. IMPORTANT:
1. Check STRIPE PAYMENT CONNECTION STATUS in context (not social media!) - if Stripe is NOT CONNECTED, call this tool anyway and a "Connect Stripe" button will appear
2. If Stripe IS CONNECTED, just call this tool with the product details - no need to ask permission
3. Ask for: product name, description, and price before calling
4. For product image: use an attached image, use an asset from knowledge base, use last generated image, or proceed without
5. Product will be saved to Assets → Products with payment link`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: 'Product name (e.g., "Premium Coaching Session", "E-book Download").'
            },
            description: {
              type: Type.STRING,
              description: 'Product description.'
            },
            price: {
              type: Type.NUMBER,
              description: 'Price in dollars (e.g., 29.99, 199). NOT in cents.'
            },
            currency: {
              type: Type.STRING,
              description: 'Currency code (default: usd).',
              enum: ['usd', 'eur', 'gbp', 'cad', 'aud']
            },
            imageUrl: {
              type: Type.STRING,
              description: 'Direct URL for product image (optional).'
            },
            assetName: {
              type: Type.STRING,
              description: 'Name of an image in the knowledge base to use as product image (fuzzy match).'
            },
            useLastGenerated: {
              type: Type.BOOLEAN,
              description: 'Use the most recently generated image as the product image.'
            }
          },
          required: ['name', 'price']
        }
      };

      // --- TOOL: World Generation ---
      const generateWorldTool = {
        name: 'generate_world',
        description: `Generate an immersive 3D world using World Labs AI. WORKFLOW:
1. Ask user for a detailed text description of the world they want to create (lighting, mood, environment, atmosphere)
2. Optionally, user can provide an image or video as a reference/structure guide
3. For image input: use attached images, conversation media, or knowledge base assets
4. For video input: use attached videos or conversation media
5. Generation takes ~5 minutes - world will appear in Assets → Worlds when ready
6. Call this tool with the prompt and inputType to start generation`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Detailed description of the world (e.g., "A bioluminescent forest at night with floating crystals and neon flora")'
            },
            inputType: {
              type: Type.STRING,
              enum: ['text', 'image', 'video'],
              description: 'Type of input: text-only, image-guided, or video-guided'
            },
            imageUrl: {
              type: Type.STRING,
              description: 'URL of image to use as structure guide (optional)'
            },
            videoUrl: {
              type: Type.STRING,
              description: 'URL of video to use as structure guide (optional)'
            },
            assetName: {
              type: Type.STRING,
              description: 'Name of an asset in knowledge base to use as guide (fuzzy match)'
            },
            useLastGenerated: {
              type: Type.BOOLEAN,
              description: 'Use the most recently generated image/video as guide'
            }
          },
          required: ['prompt', 'inputType']
        }
      };

      // --- TOOL: Camera Capture & Generate ---
      const captureAndGenerateImageTool = {
        name: 'capture_and_generate_image',
        description: 'Capture the current camera frame and generate a new image based on it. Use this when the user says "turn this into...", "make me look like...", or "transform this". User MUST be in video mode.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'The user\'s instruction for the transformation (e.g., "turn this into a cyberpunk city").'
            }
          },
          required: ['prompt']
        }
      };

      // --- TOOL: Camera Capture → Image → Veo Video (no social posting) ---
      const captureAndGenerateVideoTool = {
        name: 'capture_and_generate_video',
        description: 'Capture the current camera frame, generate a refined image from it using Gemini, then animate it into a short video using Veo 3.1. Use when the user says "create a video from this", "animate this", "make a video of what you see", or "turn this into a video/clip". Does NOT post to social media — use create_social_reel for that.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Creative direction for the image and resulting video (e.g., "a futuristic cityscape at sunset with cinematic motion").'
            },
            aspectRatio: {
              type: Type.STRING,
              enum: ['9:16', '16:9'],
              description: 'Video aspect ratio. Use 9:16 for vertical/portrait, 16:9 for landscape. Defaults to 16:9.'
            }
          },
          required: ['prompt']
        }
      };

      const analyzePaperNoteTool = {
        name: 'analyze_paper_note',
        description: 'Analyze physical paper/notebook content shown on camera. Extracts text, diagrams, and handwriting, then provides a structured summary or interpretation. Use for summaries, research, or understanding what is written/drawn.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            focus: {
              type: Type.STRING,
              description: 'What the user wants to know about the paper (e.g., "summarize this", "explain this diagram", "is this correct?").'
            }
          }
        }
      };

      const extractPaperToNoteTool = {
        name: 'extract_paper_to_note',
        description: 'Capture the content from a physical paper/notebook shown on camera and save it as a new Project Note. Uses high-accuracy OCR to digitize handwriting and printed text.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: 'Optional title for the new note. If not provided, an appropriate one will be generated.'
            }
          }
        }
      };

      const digitizePaperSketchTool = {
        name: 'digitize_paper_sketch',
        description: 'Take a physical sketch, drawing, or diagram shown on camera and turn it into a high-quality, professional digital asset in the project knowledge base.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Description of the desired digital style (e.g., "minimalist vector illustration", "3D architectural render", "colorful digital painting").'
            }
          },
          required: ['prompt']
        }
      };

      const createSocialReelTool = {
        name: 'create_social_reel',
        description: 'Create a social media reel from the current camera view. Captures the camera frame, generates an AI image based on it, creates a short video using Veo 3.1 image-to-video, then posts or schedules it to the specified platforms. Use this when the user says "create a social media reel based on this", "make a reel from what you see", or "generate a reel for Instagram/TikTok". User MUST be in video mode. IMPORTANT: You MUST ask which platforms before calling this if not specified.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Creative direction for the reel based on what the camera sees (e.g., "cinematic product showcase", "dynamic social media ad", "trendy reel with zoom effects").'
            },
            platforms: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Platforms to publish to: facebook, instagram, x, tiktok, youtube, linkedin. REQUIRED - ask the user if not specified.'
            },
            caption: {
              type: Type.STRING,
              description: 'Caption text for the social media post.'
            },
            scheduleAt: {
              type: Type.STRING,
              description: 'Optional. ISO 8601 datetime or natural language time to schedule instead of posting immediately (e.g., "tomorrow at 9am").'
            },
            aspectRatio: {
              type: Type.STRING,
              description: 'Aspect ratio for the reel. Defaults to 9:16 (vertical/portrait) for social media reels.',
              enum: ['9:16', '16:9']
            }
          },
          required: ['prompt', 'platforms']
        }
      };

      const editProjectTableTool = {
        name: 'edit_project_table',
        description: 'Edit the current table in Assets > Tables using AI instructions (e.g., "add a column for email", "fill missing values").',
        parameters: {
          type: Type.OBJECT,
          properties: {
            instruction: { type: Type.STRING, description: 'How to edit the table.' }
          },
          required: ['instruction']
        }
      };

      const refineWebsiteTool = {
        name: 'refine_website_code',
        description: 'Refine or edit the current website in Assets > Websites using AI instructions. Use this when the user says "add a contact form to the website", "make the background blue", etc.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            instruction: { type: Type.STRING, description: 'How to edit or refine the website code.' }
          },
          required: ['instruction']
        }
      };

      const generateWebsiteFromSketchTool = {
        name: 'generate_website_from_sketch',
        description: 'Take a physical wireframe or UI sketch shown on camera and turn it into a fully functional, styled website code (HTML/Tailwind/React). Use this when the user says "build a website from this drawing", "make a webpage out of this wireframe", etc.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Optional additional instructions for the website generation, such as specific colors, themes, or functionality requirements.'
            }
          }
        }
      };

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
          },
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: 4096, // Capped budget to prevent token overflow
          },
          // Enable session resumption for longer sessions
          sessionResumption: sessionResumptionHandleRef.current ? { handle: sessionResumptionHandleRef.current } : {},
          // Enable context window compression to prevent early disconnection
          contextWindowCompression: {
            slidingWindow: {},
          },
          tools: [
            { googleSearch: {} },
            {
              functionDeclarations: [
                analyzeFileTool,
                searchKnowledgeBaseTool,
                generateImageTool,
                editImageTool,
                editVideoTool,
                generateVideoFromImageTool,
                generateVideoFromPromptTool,
                generateVideoOverviewTool,
                generateProjectBlogTool,
                generateProjectWebsiteTool,
                generateProjectPodcastTool,
                createProjectTaskTool,
                updateProjectTaskTool,
                deleteProjectTaskTool,
                createProjectNoteTool,
                appendProjectNoteTool,
                deleteProjectNoteTool,
                deleteScheduledPostTool,
                startProjectResearchTool,
                runProjectSeoTool,
                getDocsDraftTool,
                setDocsDraftTextTool,
                appendDocsDraftTextTool,
                replaceDocsDraftTextTool,
                insertDocsInlineImageTool,
                saveDocsDraftTool,
                getTableDraftTool,
                setTableCellTool,
                addTableRowTool,
                deleteTableRowTool,
                addTableColumnTool,
                deleteTableColumnTool,
                renameTableColumnTool,
                setTableTitleTool,
                setTableDescriptionTool,
                setTableDraftTool,
                setTableRowsTool,
                setTableColumnsTool,
                setTableRowTool,
                setTableColumnTool,
                generateProjectTableTool,
                editProjectTableTool,
                saveProjectTableTool,
                saveProjectTableToGoogleSheetTool,
                // Tools for Chat/Voice Feature Parity
                generateProjectBookTool,
                refineWebsiteTool,
                getProjectResearchSessionsTool,
                generateVideoFromImageTool,
                generateVideoFromPromptTool,
                generateVideoOverviewTool,
                createSocialReelTool,
                captureAndGenerateImageTool,
                captureAndGenerateVideoTool,
                analyzePaperNoteTool,
                extractPaperToNoteTool,
                digitizePaperSketchTool,
                generateWebsiteFromSketchTool,
                scheduleEmailTool,
                sendBulkEmailTool,
                scheduleTemplateEmailTool,
                // PDF & Form Tools
                generatePdfTool,
                generateFormTool,
                // Get connected accounts tool
                {
                  name: 'get_connected_accounts',
                  description: 'Get the list of connected social media accounts and pages. Use this BEFORE posting to Facebook or Instagram to get the available pages/accounts. Returns the list of pages for each platform.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      platform: {
                        type: Type.STRING,
                        description: 'Platform to get accounts for. Use "all" to get all connected accounts.',
                        enum: ['facebook', 'instagram', 'all']
                      }
                    },
                    required: ['platform']
                  }
                },
                // Social media posting tool
                {
                  name: 'post_to_social',
                  description: 'Post content to one or more social media platforms at once. Use the platforms array to post to multiple platforms in a single call. IMPORTANT: For Facebook, you MUST call get_connected_accounts first to get available pages. If any platform is not connected, will prompt for auth.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      platforms: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'Array of platforms to post to. Example: ["facebook", "instagram", "tiktok"]. Valid: facebook, instagram, x, tiktok, youtube, linkedin'
                      },
                      platform: {
                        type: Type.STRING,
                        description: 'Single platform to post to (deprecated - use platforms array instead).',
                        enum: ['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'linkedin']
                      },
                      contentType: {
                        type: Type.STRING,
                        description: 'Type of content to post.',
                        enum: ['text', 'image', 'video']
                      },
                      text: {
                        type: Type.STRING,
                        description: 'Caption or post text content.'
                      },
                      pageId: {
                        type: Type.STRING,
                        description: 'Facebook Page ID to post to. Use this OR pageName.'
                      },
                      pageName: {
                        type: Type.STRING,
                        description: 'Facebook Page name to post to (case-insensitive, fuzzy matched). When user says a page name, use this.'
                      },
                      igAccountId: {
                        type: Type.STRING,
                        description: 'Instagram Account ID to post to. Use this OR igAccountName.'
                      },
                      igAccountName: {
                        type: Type.STRING,
                        description: 'Instagram account username to post to (case-insensitive). When user says an account name, use this.'
                      },
                      mediaUrl: {
                        type: Type.STRING,
                        description: 'URL of the image or video to post (from knowledge base or generated asset).'
                      },
                      assetId: {
                        type: Type.STRING,
                        description: 'Knowledge base asset ID to post (optional, alternative to mediaUrl).'
                      },
                      assetName: {
                        type: Type.STRING,
                        description: 'Name of the asset to find and post (e.g., "sunset image", "marketing video"). Will fuzzy-match against knowledge base asset names.'
                      },
                      useLastGenerated: {
                        type: Type.BOOLEAN,
                        description: 'Set to true to use the most recently generated or attached image/video. Useful when the user says "post that to Instagram".'
                      },
                      privacyLevel: {
                        type: Type.STRING,
                        description: 'Privacy setting for TikTok/YouTube. Defaults to "PUBLIC_TO_EVERYONE" / "public" if not specified.',
                        enum: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY', 'public', 'private', 'unlisted']
                      }
                    },
                    required: ['platform', 'contentType']
                  }
                },
                // Social media scheduling tool
                {
                  name: 'schedule_post',
                  description: 'CALL THIS FUNCTION when user wants to SCHEDULE a post for LATER (not immediately). Trigger words: "schedule", "post at", "post for", "tomorrow", "8am", "next week", any time reference. Set useLastGenerated=true when user says "this" or "the image/video".',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      platforms: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'Platforms to post to: facebook, instagram, x, tiktok, youtube, linkedin'
                      },
                      scheduledAt: {
                        type: Type.STRING,
                        description: 'ISO 8601 datetime string for when to publish (e.g., "2025-12-24T14:00:00" or natural language like "tomorrow at 2pm", "7:15am today")'
                      },
                      contentType: {
                        type: Type.STRING,
                        description: 'Type of content to schedule.',
                        enum: ['text', 'image', 'video']
                      },
                      text: {
                        type: Type.STRING,
                        description: 'Caption or post text content.'
                      },
                      mediaUrl: {
                        type: Type.STRING,
                        description: 'URL of the image or video to schedule (from knowledge base or generated asset).'
                      },
                      assetId: {
                        type: Type.STRING,
                        description: 'Knowledge base asset ID to schedule (optional, alternative to mediaUrl).'
                      },
                      assetName: {
                        type: Type.STRING,
                        description: 'Name of the asset to find and schedule (e.g., "sunset image", "marketing video"). Will fuzzy-match against knowledge base asset names.'
                      },
                      useLastGenerated: {
                        type: Type.BOOLEAN,
                        description: 'Set to true to use the most recently generated or attached image/video. ALWAYS set this to true when user says "schedule this video/image".'
                      }
                    },
                    required: ['platforms', 'scheduledAt', 'contentType']
                  }
                },
                // Email Tools
                {
                  name: 'send_email',
                  description: 'Send an email immediately via Gmail or Outlook. Ask for recipient, subject, and content. Tell user to connect email in Email tab if not connected.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      provider: {
                        type: Type.STRING,
                        description: 'Email provider: "gmail" or "outlook".',
                        enum: ['gmail', 'outlook']
                      },
                      to: {
                        type: Type.STRING,
                        description: 'Recipient email address.'
                      },
                      subject: {
                        type: Type.STRING,
                        description: 'Email subject line.'
                      },
                      body: {
                        type: Type.STRING,
                        description: 'Email body content.'
                      }
                    },
                    required: ['provider', 'to', 'subject', 'body']
                  }
                },
                {
                  name: 'schedule_email',
                  description: 'Schedule an email for later. Must be 10 min to 7 days in future. Ask for recipient, subject, content, and when to send.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      provider: {
                        type: Type.STRING,
                        description: 'Email provider: "gmail" or "outlook".',
                        enum: ['gmail', 'outlook']
                      },
                      to: {
                        type: Type.STRING,
                        description: 'Recipient email address(es).'
                      },
                      subject: {
                        type: Type.STRING,
                        description: 'Email subject line.'
                      },
                      body: {
                        type: Type.STRING,
                        description: 'Email body content.'
                      },
                      scheduledTime: {
                        type: Type.STRING,
                        description: 'When to send: "tomorrow at 9am", "next Monday", etc.'
                      }
                    },
                    required: ['provider', 'to', 'subject', 'body', 'scheduledTime']
                  }
                },
                {
                  name: 'send_bulk_email',
                  description: 'Send email to multiple leads from Forms tab. Ask what the email is about.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      provider: {
                        type: Type.STRING,
                        description: 'Email provider: "gmail" or "outlook".',
                        enum: ['gmail', 'outlook']
                      },
                      formId: {
                        type: Type.STRING,
                        description: 'Optional: Form ID to filter leads.'
                      },
                      subject: {
                        type: Type.STRING,
                        description: 'Email subject line.'
                      },
                      body: {
                        type: Type.STRING,
                        description: 'Email body. Use {name} for personalization.'
                      }
                    },
                    required: ['provider', 'subject', 'body']
                  }
                },
                // PDF Generation Tool
                {
                  name: 'generate_pdf',
                  description: 'Generate an illustrated PDF document (ebook, guide, report, etc.) using project context. This tool has NO limits for Pro subscribers - always proceed to generate when requested. Ask what the PDF should be about and optionally page count (4-24).',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: {
                        type: Type.STRING,
                        description: 'What the PDF should be about - topic, focus, audience.'
                      },
                      pageCount: {
                        type: Type.NUMBER,
                        description: 'Number of pages (4-24). Defaults to 8.'
                      },
                      documentType: {
                        type: Type.STRING,
                        description: 'Type of document.',
                        enum: ['ebook', 'guide', 'report', 'brochure', 'presentation', 'whitepaper', 'manual']
                      }
                    },
                    required: ['prompt']
                  }
                },
                // Form Generation Tool
                {
                  name: 'generate_form',
                  description: 'Generate a lead capture form website. This tool costs 45 credits. Ask for title, design prompt, and fields (or suggest defaults).',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING, description: 'Title of the form (e.g. "Contact Us")' },
                      prompt: { type: Type.STRING, description: 'Design prompt (e.g. "Modern blue theme")' },
                      fields: {
                        type: Type.ARRAY,
                        description: 'List of fields to include',
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            label: { type: Type.STRING },
                            type: { type: Type.STRING, enum: ['text', 'email', 'phone', 'textarea', 'select', 'checkbox'] },
                            required: { type: Type.BOOLEAN }
                          },
                          required: ['label', 'type']
                        }
                      }
                    },
                    required: ['title', 'prompt', 'fields']
                  }
                },
                // Email Template Scheduling Tool
                {
                  name: 'schedule_template_email',
                  description: `PRIORITY TOOL for sending emails to email lists. Use this tool FIRST when:

TRIGGER KEYWORDS (high priority):
- "schedule the [name] email" → templateName: name
- "send email to leads/table/list"
- "email the [name] template to [source]"
- "send newsletter to my prospects table"
- Any mention of: "email template", "email to leads", "email list", "send to table"

EMAIL LIST SOURCES - always ask which source if not specified:
- "leads" or "form" → Use captured leads from lead forms
- "table" → Use a table from Assets > Tables (find email column)
- "file" → Use uploaded CSV/Excel file

If user doesn't specify source, ASK which email list to use.
DO NOT use schedule_post for email - use THIS tool instead.`,
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      templateName: {
                        type: Type.STRING,
                        description: 'Name of a saved email template to use (e.g., "awesome", "welcome"). Optional if subject/body provided.'
                      },
                      subject: {
                        type: Type.STRING,
                        description: 'Email subject line. Use if no templateName, or to override template subject.'
                      },
                      body: {
                        type: Type.STRING,
                        description: 'Email body content (HTML or plain text). Use if no templateName provided.'
                      },
                      emailSource: {
                        type: Type.STRING,
                        enum: ['leads', 'table', 'file', 'ask'],
                        description: 'Where to get emails: "leads" (forms), "table" (Assets>Tables), "file" (uploaded CSV). Default: "ask"'
                      },
                      formName: {
                        type: Type.STRING,
                        description: 'For emailSource="leads": Specific form name to filter leads by.'
                      },
                      tableName: {
                        type: Type.STRING,
                        description: 'For emailSource="table": Name of table in Assets>Tables containing emails.'
                      },
                      fileName: {
                        type: Type.STRING,
                        description: 'For emailSource="file": Name of uploaded CSV/Excel file containing emails.'
                      },
                      scheduledAt: {
                        type: Type.STRING,
                        description: 'When to send: "now", "in 15 minutes", "tomorrow at 9am", or ISO date string. Default: now'
                      },
                      provider: {
                        type: Type.STRING,
                        enum: ['gmail', 'outlook'],
                        description: 'Email provider to use. Default: gmail'
                      }
                    },
                    required: []
                  }
                },
              ]
            }
          ],
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
              prefixPaddingMs: 20,
              silenceDurationMs: 200,
            }
          }
        },
        callbacks: {
          onopen: () => {
            console.log("Voice Session Opened");
            setConnectionStatus('connected');

            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);

            scriptProcessor.onaudioprocess = (e) => {
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
            const { serverContent } = msg;

            // Log the full message to see what's available
            console.log('Live API message:', msg);

            if ((msg as any).sessionResumptionUpdate?.newHandle) {
              sessionResumptionHandleRef.current = (msg as any).sessionResumptionUpdate.newHandle;
            }

            // Handle user input transcription (if available)
            const clientContent = (msg as any).clientContent;
            if (clientContent?.inputTranscription?.text) {
              const userText = clientContent.inputTranscription.text;
              setUserTranscriptBuffer(prev => prev + userText);
            }

            // When user turn is complete, add their message
            if (clientContent?.turnComplete) {
              setUserTranscriptBuffer(prev => {
                const trimmed = prev.trim();
                if (trimmed) {
                  addMessage('user', trimmed);
                }
                return '';
              });
            }

            // Handle tool calls for file analysis and asset generation
            try {
              const toolCall = (msg as any).toolCall;
              if (toolCall && toolCall.functionCalls && toolCall.functionCalls.length > 0) {
                console.log('Tool call received:', toolCall);
                const functionResponses: any[] = [];

                for (const fc of toolCall.functionCalls) {
                  const args = fc.args || {};

                  if (fc.name === 'get_docs_draft') {
                    try {
                      const bridge = getDocsEditorBridge();
                      if (!bridge) throw new Error('Docs editor is not available. Open the Assets > Docs tab and load a Doc first.');
                      const draft = bridge.getDraft();
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true, draft },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'set_docs_draft_text') {
                    try {
                      const bridge = getDocsEditorBridge();
                      if (!bridge) throw new Error('Docs editor is not available. Open the Assets > Docs tab and load a Doc first.');
                      bridge.setDraftText(String(args.text ?? ''));
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'append_docs_draft_text') {
                    try {
                      const bridge = getDocsEditorBridge();
                      if (!bridge) throw new Error('Docs editor is not available. Open the Assets > Docs tab and load a Doc first.');
                      bridge.appendDraftText(String(args.text ?? ''), typeof args.separator === 'string' ? args.separator : undefined);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'replace_docs_draft_text') {
                    try {
                      const bridge = getDocsEditorBridge();
                      if (!bridge) throw new Error('Docs editor is not available. Open the Assets > Docs tab and load a Doc first.');
                      bridge.replaceDraftText(
                        String(args.find ?? ''),
                        String(args.replace ?? ''),
                        {
                          useRegex: Boolean(args.useRegex),
                          caseSensitive: Boolean(args.caseSensitive),
                        },
                      );
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'insert_docs_inline_image') {
                    try {
                      const bridge = getDocsEditorBridge();
                      if (!bridge) throw new Error('Docs editor is not available. Open the Assets > Docs tab and load a Doc first.');
                      const url = String(args.url ?? '').trim();
                      const widthPx = typeof args.widthPx === 'number' ? args.widthPx : undefined;
                      const heightPx = typeof args.heightPx === 'number' ? args.heightPx : undefined;
                      bridge.insertInlineImage(url, widthPx, heightPx);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'save_docs_draft') {
                    try {
                      const bridge = getDocsEditorBridge();
                      if (!bridge) throw new Error('Docs editor is not available. Open the Assets > Docs tab and load a Doc first.');
                      const ok = await bridge.save();
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: ok },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'get_table_draft') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      const table = bridge.getTable();
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true, table },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'set_table_cell') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      bridge.setCell(Number(args.rowIndex), Number(args.colIndex), String(args.value ?? ''));
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'add_table_row') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      bridge.addRow(typeof args.index === 'number' ? args.index : undefined);
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'delete_table_row') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      bridge.deleteRow(Number(args.rowIndex));
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'add_table_column') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      bridge.addColumn(typeof args.name === 'string' ? args.name : undefined, typeof args.index === 'number' ? args.index : undefined);
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'delete_table_column') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      bridge.deleteColumn(Number(args.colIndex));
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'rename_table_column') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      bridge.renameColumn(Number(args.colIndex), String(args.name ?? ''));
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'set_table_title') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      bridge.setTableTitle(String(args.title ?? ''));
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'set_table_description') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      bridge.setTableDescription(String(args.description ?? ''));
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'set_table_draft') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');

                      const title = typeof args.title === 'string' ? args.title : undefined;
                      const description = typeof args.description === 'string' ? args.description : undefined;
                      const columns = Array.isArray(args.columns) ? args.columns.map((c: any) => String(c ?? '')) : null;
                      const rows = Array.isArray(args.rows)
                        ? args.rows.map((r: any) => (Array.isArray(r) ? r.map((v: any) => String(v ?? '')) : []))
                        : null;

                      if (!columns || !rows) throw new Error('columns and rows are required.');
                      if (title !== undefined) bridge.setTableTitle(title);
                      if (description !== undefined) bridge.setTableDescription(description);
                      bridge.setColumns(columns);
                      bridge.setRows(rows);

                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'set_table_rows') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      const rows = Array.isArray(args.rows)
                        ? args.rows.map((r: any) => (Array.isArray(r) ? r.map((v: any) => String(v ?? '')) : []))
                        : null;
                      if (!rows) throw new Error('rows is required.');
                      bridge.setRows(rows);
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'set_table_columns') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      const columns = Array.isArray(args.columns) ? args.columns.map((c: any) => String(c ?? '')) : null;
                      if (!columns) throw new Error('columns is required.');
                      bridge.setColumns(columns);
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'set_table_row') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      const rowIndex = Number(args.rowIndex);
                      const row = Array.isArray(args.row) ? args.row.map((v: any) => String(v ?? '')) : null;
                      if (!Number.isFinite(rowIndex) || rowIndex < 0) throw new Error('rowIndex must be a non-negative number.');
                      if (!row) throw new Error('row is required.');

                      const current = bridge.getTable();
                      const table = (current as any)?.table;
                      if (!table) throw new Error('No table is currently loaded.');
                      const rows: string[][] = Array.isArray(table.rows) ? table.rows.map((r: any) => (Array.isArray(r) ? r.map((v: any) => String(v ?? '')) : [])) : [];
                      if (rowIndex >= rows.length) throw new Error('rowIndex is out of bounds.');
                      rows[rowIndex] = row;
                      bridge.setRows(rows);

                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'set_table_column') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      const colIndex = Number(args.colIndex);
                      const name = typeof args.name === 'string' ? args.name : undefined;
                      const column = Array.isArray(args.column) ? args.column.map((v: any) => String(v ?? '')) : null;
                      if (!Number.isFinite(colIndex) || colIndex < 0) throw new Error('colIndex must be a non-negative number.');
                      if (!column) throw new Error('column is required.');

                      const current = bridge.getTable();
                      const table = (current as any)?.table;
                      if (!table) throw new Error('No table is currently loaded.');

                      const rows: string[][] = Array.isArray(table.rows) ? table.rows.map((r: any) => (Array.isArray(r) ? r.map((v: any) => String(v ?? '')) : [])) : [];
                      if (rows.length === 0) {
                        bridge.setRows([]);
                      } else {
                        const nextRows = rows.map((r, i) => {
                          const next = [...r];
                          next[colIndex] = column[i] ?? '';
                          return next;
                        });
                        bridge.setRows(nextRows);
                      }

                      if (name !== undefined) {
                        bridge.renameColumn(colIndex, name);
                      }

                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: String(e?.message || e) } });
                    }
                  } else if (fc.name === 'analyze_project_file') {
                    const fileName = (args.fileName || '').toString();
                    const task = args.task || 'summarize and describe the contents';

                    const searchName = fileName.toLowerCase();
                    const dataFiles = project.uploadedFiles || [];
                    const kbFiles = project.knowledgeBase || [];

                    // Try Data tab uploads first
                    let matchedUri: string | null = null;
                    let matchedMime: string | null = null;
                    let matchedDisplay: string | null = null;

                    for (const f of dataFiles) {
                      const displayName = (f.displayName || '').toLowerCase();
                      const name = (f.name || '').toLowerCase();
                      if (!displayName && !name) continue;
                      if (
                        (displayName && (displayName.includes(searchName) || searchName.includes(displayName))) ||
                        (name && (name.includes(searchName) || searchName.includes(name)))
                      ) {
                        matchedUri = f.uri;
                        matchedMime = f.mimeType || 'application/octet-stream';
                        matchedDisplay = f.displayName || f.name;
                        break;
                      }
                    }

                    // Fallback to Knowledge Base files (generated assets, documents)
                    if (!matchedUri) {
                      for (const f of kbFiles) {
                        const name = (f.name || '').toLowerCase();
                        if (!name) continue;
                        if (name.includes(searchName) || searchName.includes(name)) {
                          matchedUri = f.url;
                          matchedMime = f.type || 'application/octet-stream';
                          matchedDisplay = f.name;
                          break;
                        }
                      }
                    }

                    if (matchedUri && matchedMime && matchedDisplay) {
                      try {
                        // Use Gemini to analyze the file content
                        const analysisResult = await analyzeFileWithGemini(
                          matchedUri,
                          matchedMime,
                          task,
                          matchedDisplay
                        );

                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: {
                            success: true,
                            fileName: matchedDisplay,
                            mimeType: matchedMime,
                            analysis: analysisResult
                          }
                        });
                      } catch (analysisError) {
                        console.error('File analysis error:', analysisError);
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: {
                            success: false,
                            error: 'Failed to analyze file content',
                            fileName: matchedDisplay
                          }
                        });
                      }
                    } else {
                      // File not found
                      const availableData = dataFiles.map(f => f.displayName || f.name).filter(Boolean);
                      const availableKb = kbFiles.map(f => f.name).filter(Boolean);
                      const availableFiles = [...availableData, ...availableKb].join(', ');
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: `File "${fileName}" not found. Available files: ${availableFiles || 'none'}`
                        }
                      });
                    }
                  } else if (fc.name === 'search_knowledge_base') {
                    const query = String(args.query || '');
                    try {
                      const result = await searchKnowledgeBase(query, projectRef.current.id);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          answer: result.answer,
                          citations: result.citations,
                          note: result.citations.length > 0 ? `Found relevant information in ${result.citations.length} document(s).` : 'No specific document citations.'
                        }
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: String(e?.message || e)
                        }
                      });
                    }
                  } else if (fc.name === 'generate_image_with_gemini') {
                    const prompt = (args.prompt || '').toString();
                    const refUrl = args.referenceImageUrl ? String(args.referenceImageUrl) : undefined;

                    try {
                      const ctx = contextService.buildProjectContext(project);
                      const refinedPrompt = await refinePromptWithGemini3(prompt, ctx.fullContext, 'image');

                      let imageUrl: string;
                      if (refUrl) {
                        const base64 = await fetchImageAsBase64(refUrl);
                        if (base64) {
                          const result = await generateImageWithReferences(refinedPrompt, [{ base64, mimeType: 'image/png' }]);
                          imageUrl = result.imageDataUrl;
                        } else {
                          imageUrl = await generateImageWithContext(refinedPrompt);
                        }
                      } else {
                        imageUrl = await generateImageWithContext(refinedPrompt);
                      }
                      let kbFileId: string | undefined;
                      try {
                        const res = await fetch(imageUrl);
                        const blob = await res.blob();
                        const file = new File([blob], `live-image-${Date.now()}.png`, { type: blob.type || 'image/png' });
                        const kb = await storageService.uploadKnowledgeBaseFile(project.id, file);
                        kbFileId = kb.id;

                        // Persist to project
                        const existingKb = projectRef.current.knowledgeBase || [];
                        const updatedKnowledgeBase = [...existingKb, kb];
                        await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });

                        const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                        onProjectUpdate?.(updatedProject);
                        projectRef.current = updatedProject;
                      } catch (saveError) {
                        console.error('Failed to save generated image to project:', saveError);
                      }

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          prompt,
                          imageUrl,
                          kbFileId
                        }
                      });
                      // Track for easy posting
                      setLastGeneratedAsset({ url: imageUrl, type: 'image', name: prompt.slice(0, 50), timestamp: Date.now() });
                      trackConversationMedia({ id: kbFileId, url: imageUrl, type: 'image', source: 'generated', name: prompt.slice(0, 50) });

                      // Inject image into the chat stream immediately for Video Mode visibility
                      setMessages((prev) => [
                        ...prev,
                        {
                          id: `img-gen-${Date.now()}`,
                          role: 'model',
                          text: '',
                          timestamp: Date.now(),
                          imageUrl: imageUrl,
                        }
                      ]);
                    } catch (imageError) {
                      console.error('Live image generation error:', imageError);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: 'Failed to generate image with Gemini',
                          prompt
                        }
                      });
                    }
                  } else if (fc.name === 'edit_image_with_gemini') {
                    const imageUrl = (args.imageUrl || '').toString();
                    const instruction = (args.instruction || '').toString();

                    try {
                      // Credit Check for image editing
                      const hasCredits = await checkCredits('imageGenerationFast');
                      if (!hasCredits) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { success: false, error: 'Insufficient credits for image editing' }
                        });
                        continue;
                      }

                      // First, try to find the image from attachments or conversation media
                      let imageReference: { base64?: string; fileUri?: string; mimeType: string } | null = null;

                      // Priority 1: Check pending attachments (user just attached an image)
                      const imageAttachment = readyAttachments.find(a =>
                        a.uploaded?.mimeType?.startsWith('image/') && a.previewUrl
                      );

                      if (imageAttachment?.previewUrl) {
                        try {
                          const res = await fetch(imageAttachment.previewUrl);
                          const blob = await res.blob();
                          const base64 = await blobToBase64(blob);
                          imageReference = { base64, mimeType: blob.type || 'image/png' };
                          console.log('[edit_image_with_gemini] Using attached image');
                        } catch (e) {
                          console.warn('[edit_image_with_gemini] Failed to fetch attachment preview:', e);
                        }
                      }

                      // Priority 2: Check conversation media (recently dropped/attached)
                      if (!imageReference && currentConversationMedia.length > 0) {
                        const recentImage = currentConversationMedia.find(m => m.type === 'image');
                        if (recentImage) {
                          try {
                            const url = recentImage.publicUrl || recentImage.url;

                            // Check if it's a Gemini URI (matches https://generativelanguage... or starts with gs://)
                            // or if it's a known Gemini URI format from our app
                            const isGeminiUri = url.includes('generativelanguage.googleapis.com') || url.startsWith('gs://');

                            if (isGeminiUri) {
                              // Use fileUri directly
                              imageReference = { fileUri: url, mimeType: 'image/png' }; // Default to png if unknown, will be overwritten if available
                              console.log('[edit_image_with_gemini] Using tracked conversation media (Gemini URI)');
                            } else {
                              // Regular URL, fetch it
                              const res = await fetch(url);
                              if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
                              const blob = await res.blob();
                              const base64 = await blobToBase64(blob);
                              imageReference = { base64, mimeType: blob.type || 'image/png' };
                              console.log('[edit_image_with_gemini] Using tracked conversation media (fetched)');
                            }
                          } catch (e) {
                            console.warn('[edit_image_with_gemini] Failed to fetch tracked media:', e);
                          }
                        }
                      }

                      // Priority 3: Try to fetch from the provided imageUrl
                      if (!imageReference && imageUrl) {
                        try {
                          const res = await fetch(imageUrl);
                          if (res.ok) {
                            const blob = await res.blob();
                            const base64 = await blobToBase64(blob);
                            imageReference = { base64, mimeType: blob.type || 'image/png' };
                            console.log('[edit_image_with_gemini] Using URL from args');
                          }
                        } catch (e) {
                          console.warn('[edit_image_with_gemini] Failed to fetch imageUrl:', e);
                        }
                      }

                      // Priority 4: Check lastGeneratedAsset
                      if (!imageReference && lastGeneratedAsset?.type === 'image') {
                        try {
                          const url = lastGeneratedAsset.publicUrl || lastGeneratedAsset.url;
                          const res = await fetch(url);
                          if (res.ok) {
                            const blob = await res.blob();
                            const base64 = await blobToBase64(blob);
                            imageReference = { base64, mimeType: blob.type || 'image/png' };
                            console.log('[edit_image_with_gemini] Using lastGeneratedAsset');
                          }
                        } catch (e) {
                          console.warn('[edit_image_with_gemini] Failed to fetch lastGeneratedAsset:', e);
                        }
                      }

                      if (!imageReference) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { success: false, error: 'No image found to edit. Please attach an image or refer to a recently generated one.' }
                        });
                        continue;
                      }

                      const result = await generateImageWithReferences(instruction, [imageReference]);
                      const newImageUrl = result.imageDataUrl;

                      // Persist
                      let kbFileId: string | undefined;
                      try {
                        const res = await fetch(newImageUrl);
                        const blob = await res.blob();
                        const file = new File([blob], `edited-image-${Date.now()}.png`, { type: blob.type || 'image/png' });
                        const kb = await storageService.uploadKnowledgeBaseFile(project.id, file);
                        kbFileId = kb.id;

                        const existingKb = projectRef.current.knowledgeBase || [];
                        const updatedKnowledgeBase = [...existingKb, kb];
                        await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });

                        const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                        onProjectUpdate?.(updatedProject);
                        projectRef.current = updatedProject;

                        // Inject edited image into the chat stream immediately for Video Mode visibility
                        setMessages((prev) => [
                          ...prev,
                          {
                            id: `img-edit-${Date.now()}`,
                            role: 'model',
                            text: '',
                            timestamp: Date.now(),
                            imageUrl: newImageUrl,
                          }
                        ]);
                      } catch (saveError) {
                        console.error('Failed to save edited image:', saveError);
                      }

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          imageUrl: newImageUrl,
                          kbFileId
                        }
                      });
                      setLastGeneratedAsset({ url: newImageUrl, type: 'image', name: `Edited: ${instruction.slice(0, 30)}`, timestamp: Date.now() });
                      trackConversationMedia({ id: kbFileId, url: newImageUrl, type: 'image', source: 'generated', name: `Edited: ${instruction}` });

                    } catch (editError: any) {
                      console.error('Edit image error:', editError);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: `Failed to edit image: ${editError.message || editError}` }
                      });
                    }
                  } else if (fc.name === 'capture_and_generate_image') {
                    const prompt = (args.prompt || '').toString();

                    // 1. Capture Frame
                    const frame = captureFrame();
                    if (!frame) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: 'Camera not active or frame could not be captured. Please switch to Video Mode and ensure your camera is on.'
                        }
                      });
                      continue;
                    }

                    try {
                      // 2. Generate Image using Frame as Reference
                      const result = await generateImageWithReferences(
                        prompt,
                        [{ base64: frame.data, mimeType: frame.mimeType }]
                      );
                      const imageUrl = result.imageDataUrl;

                      // 3. Save to Project
                      let kbFileId: string | undefined;
                      try {
                        const res = await fetch(imageUrl);
                        const blob = await res.blob();
                        const file = new File([blob], `cam-gen-${Date.now()}.png`, { type: blob.type || 'image/png' });
                        const kb = await storageService.uploadKnowledgeBaseFile(project.id, file);
                        kbFileId = kb.id;

                        const existingKb = projectRef.current.knowledgeBase || [];
                        const updatedKnowledgeBase = [...existingKb, kb];
                        await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase }); // Persist to DB

                        const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() }; // Local update
                        onProjectUpdate?.(updatedProject);
                        projectRef.current = updatedProject;
                      } catch (saveError) {
                        console.error('Failed to save camera generated image:', saveError);
                      }

                      // 4. Respond
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          imageUrl,
                          kbFileId
                        }
                      });

                      // 5. Track
                      setLastGeneratedAsset({ url: imageUrl, type: 'image', name: prompt.slice(0, 50), timestamp: Date.now() });
                      trackConversationMedia({ id: kbFileId, url: imageUrl, type: 'image', source: 'generated', name: prompt.slice(0, 50) });
                    } catch (genError: any) {
                      console.error('Camera generation error:', genError);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: `Generation failed: ${genError.message || genError}`
                        }
                      });
                    }
                  } else if (fc.name === 'capture_and_generate_video') {
                    // ═══════════════════════════════════════════════════════════════
                    // CAMERA → IMAGE → VEO VIDEO (no social posting)
                    // ═══════════════════════════════════════════════════════════════
                    const prompt = (args.prompt || '').toString();
                    const aspectRatio: '9:16' | '16:9' = args.aspectRatio === '9:16' ? '9:16' : '16:9';

                    // 1. Capture camera frame
                    const frame = captureFrame();
                    if (!frame) {
                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: { success: false, error: 'Camera not active or frame could not be captured. Please ensure you are in Video Mode with your camera on.' }
                      });
                      continue;
                    }

                    try {
                      // 2. Generate image from frame using Gemini image model
                      addMessage('model', '🎨 Generating image from camera view...');
                      const ctx = contextService.buildProjectContext(project);
                      const refinedPrompt = await refinePromptWithGemini3(
                        prompt,
                        ctx.fullContext,
                        'image'
                      );

                      const imageResult = await generateImageWithReferences(
                        refinedPrompt,
                        [{ base64: frame.data, mimeType: frame.mimeType }]
                      );
                      const imageUrl = imageResult.imageDataUrl;

                      // Save image to KB
                      let imageKbId: string | undefined;
                      let imageKbUrl = imageUrl;
                      try {
                        const imgRes = await fetch(imageUrl);
                        const imgBlob = await imgRes.blob();
                        const imgFile = new File([imgBlob], `cam-img-${Date.now()}.png`, { type: imgBlob.type || 'image/png' });
                        const imgKb = await storageService.uploadKnowledgeBaseFile(project.id, imgFile);
                        imageKbId = imgKb.id;
                        imageKbUrl = imgKb.url;

                        const existingKb = projectRef.current.knowledgeBase || [];
                        const updatedKb = [...existingKb, imgKb];
                        await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKb });
                        const updatedProject = { ...projectRef.current, knowledgeBase: updatedKb, lastModified: Date.now() };
                        onProjectUpdate?.(updatedProject);
                        projectRef.current = updatedProject;
                      } catch (saveErr) {
                        console.error('[capture_and_generate_video] Failed to save generated image:', saveErr);
                      }

                      // Inject the intermediate image into chat
                      setMessages((prev) => [
                        ...prev,
                        { id: `cam-img-${Date.now()}`, role: 'model', text: '', timestamp: Date.now(), imageUrl }
                      ]);

                      // 3. Generate Veo video from the image
                      addMessage('model', '🎬 Animating into video with Veo 3.1...');

                      // Check video usage limit
                      const videoCheck = await checkUsageLimit('video', isSubscribed);
                      if (!videoCheck.allowed) {
                        setUsageLimitModal({ isOpen: true, usageType: 'video', current: videoCheck.current, limit: videoCheck.limit });
                        functionResponses.push({
                          id: fc.id, name: fc.name,
                          response: { success: false, error: 'Video generation limit reached. Please upgrade to Pro.' }
                        });
                        continue;
                      }
                      await incrementUsage('video');

                      // Convert image to base64 for Veo
                      const imgFetchRes = await fetch(imageUrl);
                      const imgBlobForVeo = await imgFetchRes.blob();
                      const arrayBuffer = await imgBlobForVeo.arrayBuffer();
                      const base64ForVeo = btoa(
                        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                      );

                      const videoBlob = await generateVeoVideo(
                        `Animate this into a dynamic, visually engaging short video: ${prompt}`,
                        aspectRatio,
                        'speed',
                        { image: { base64: base64ForVeo, mimeType: imgBlobForVeo.type || 'image/png' } }
                      );

                      if (!videoBlob) throw new Error('Veo video generation returned empty result.');

                      // Save video to KB
                      const videoFile = new File([videoBlob], `cam-video-${Date.now()}.mp4`, { type: 'video/mp4' });
                      const videoKb = await storageService.uploadKnowledgeBaseFile(project.id, videoFile);

                      const existingKb2 = projectRef.current.knowledgeBase || [];
                      const updatedKb2 = [...existingKb2, videoKb];
                      await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKb2 });
                      const updatedProject2 = { ...projectRef.current, knowledgeBase: updatedKb2, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject2);
                      projectRef.current = updatedProject2;

                      setLastGeneratedAsset({ url: videoKb.url, type: 'video', name: `Video: ${prompt.slice(0, 40)}`, timestamp: Date.now() });
                      trackConversationMedia({ id: videoKb.id, url: videoKb.url, type: 'video', source: 'generated', name: `Video: ${prompt.slice(0, 40)}` });

                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: { success: true, imageUrl, videoUrl: videoKb.url, videoKbId: videoKb.id }
                      });

                    } catch (genVideoError: any) {
                      console.error('[capture_and_generate_video] Error:', genVideoError);
                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: { success: false, error: `Failed: ${genVideoError.message || genVideoError}` }
                      });
                    }
                  } else if (fc.name === 'create_project_note') {
                    try {
                      const newNote: ProjectNote = {
                        id: `note-${Date.now()}`,
                        title: String(args.title || 'New Note'),
                        content: String(args.content || ''),
                        createdAt: Date.now(),
                        lastModified: Date.now()
                      };
                      const updatedNotes = [...(projectRef.current.notes || []), newNote];
                      await storageService.updateResearchProject(project.id, { notes: updatedNotes });
                      const updatedProject = { ...projectRef.current, notes: updatedNotes, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true, noteId: newNote.id, title: newNote.title } });
                    } catch (err: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: err.message || String(err) } });
                    }
                  } else if (fc.name === 'append_project_note') {
                    try {
                      const noteId = String(args.noteId);
                      const textToAppend = String(args.text || '');
                      const existingNotes = projectRef.current.notes || [];
                      const noteIndex = existingNotes.findIndex(n => n.id === noteId);
                      if (noteIndex === -1) throw new Error('Note not found');
                      const updatedNotes = [...existingNotes];
                      updatedNotes[noteIndex] = { ...updatedNotes[noteIndex], content: updatedNotes[noteIndex].content + '\n' + textToAppend, lastModified: Date.now() };
                      await storageService.updateResearchProject(project.id, { notes: updatedNotes });
                      const updatedProject = { ...projectRef.current, notes: updatedNotes, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true, noteId } });
                    } catch (err: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: err.message || String(err) } });
                    }
                  } else if (fc.name === 'delete_project_note') {
                    try {
                      const noteId = String(args.noteId);
                      const updatedNotes = (projectRef.current.notes || []).filter(n => n.id !== noteId);
                      await storageService.updateResearchProject(project.id, { notes: updatedNotes });
                      const updatedProject = { ...projectRef.current, notes: updatedNotes, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (err: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: err.message || String(err) } });
                    }
                  } else if (fc.name === 'create_project_task') {
                    try {
                      const newTask: ProjectTask = {
                        id: `task-${Date.now()}`,
                        title: String(args.title || 'New Task'),
                        description: args.description ? String(args.description) : undefined,
                        status: 'todo',
                        createdAt: Date.now(),
                        priority: 'medium',
                        order: 0,
                        lastModified: Date.now()
                      };
                      const updatedTasks = [...(projectRef.current.tasks || []), newTask];
                      await storageService.updateResearchProject(project.id, { tasks: updatedTasks });
                      const updatedProject = { ...projectRef.current, tasks: updatedTasks, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true, taskId: newTask.id, title: newTask.title } });
                    } catch (err: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: err.message || String(err) } });
                    }
                  } else if (fc.name === 'update_project_task') {
                    try {
                      const taskId = String(args.taskId);
                      const existingTasks = projectRef.current.tasks || [];
                      const taskIndex = existingTasks.findIndex(t => t.id === taskId);
                      if (taskIndex === -1) throw new Error('Task not found');
                      const updatedTasks = [...existingTasks];
                      const t = updatedTasks[taskIndex];
                      updatedTasks[taskIndex] = {
                        ...t,
                        status: args.status ? (String(args.status) as any) : t.status,
                        title: args.title ? String(args.title) : t.title,
                        description: args.description ? String(args.description) : t.description
                      };
                      await storageService.updateResearchProject(project.id, { tasks: updatedTasks });
                      const updatedProject = { ...projectRef.current, tasks: updatedTasks, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true, taskId } });
                    } catch (err: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: err.message || String(err) } });
                    }
                  } else if (fc.name === 'delete_project_task') {
                    try {
                      const taskId = String(args.taskId);
                      const updatedTasks = (projectRef.current.tasks || []).filter(t => t.id !== taskId);
                      await storageService.updateResearchProject(project.id, { tasks: updatedTasks });
                      const updatedProject = { ...projectRef.current, tasks: updatedTasks, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    } catch (err: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: err.message || String(err) } });
                    }
                  } else if (fc.name === 'analyze_paper_note') {
                    // ═══════════════════════════════════════════════════════════════
                    // ANALYZE PAPER: Camera Frame → Gemini Analysis
                    // ═══════════════════════════════════════════════════════════════
                    const focus = args.focus || 'summarize the content of this paper';
                    const frame = captureFrame();
                    if (!frame) {
                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: { success: false, error: 'Camera not active or frame could not be captured. Ensure you are in Video Mode.' }
                      });
                      continue;
                    }
                    try {
                      addMessage('model', '📝 Analyzing paper content...');
                      const prompt = `Carefully analyze the content of this image (it's a physical paper or notebook). Focus on: ${focus}. Extract text, describe diagrams, and provide a clear, structured interpretation. If there are multiple pages or sections, distinguish them carefully.`;
                      const result = await ai.models.generateContent({
                        model: 'gemini-1.5-flash',
                        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { data: frame.data, mimeType: frame.mimeType } }] }]
                      });
                      const text = result.text || '';
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true, analysis: text } });
                    } catch (err: any) {
                      console.error('[analyze_paper_note] Error:', err);
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: err.message || String(err) } });
                    }
                  } else if (fc.name === 'extract_paper_to_note') {
                    // ═══════════════════════════════════════════════════════════════
                    // EXTRACT TO NOTE: Camera Frame → OCR → Project Note
                    // ═══════════════════════════════════════════════════════════════
                    const titleArg = args.title;
                    const frame = captureFrame();
                    if (!frame) {
                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: { success: false, error: 'Camera frame capture failed.' }
                      });
                      continue;
                    }
                    try {
                      addMessage('model', '📥 Extracting paper content to note...');
                      const ocrPrompt = `Perform high-accuracy OCR on this paper/notebook image. Extract all handwritten and printed text precisely as it appears. Formatting is important. Output ONLY the extracted markdown-compatible text. If there are sketches, describe them briefly in brackets like [Diagram: description].`;
                      const ocrResult = await ai.models.generateContent({
                        model: 'gemini-1.5-flash',
                        contents: [{ role: 'user', parts: [{ text: ocrPrompt }, { inlineData: { data: frame.data, mimeType: frame.mimeType } }] }]
                      });
                      const extractedText = ocrResult.text || '';

                      // Auto-generate title if not provided
                      let finalTitle = titleArg;
                      if (!finalTitle) {
                        const titleRes = await ai.models.generateContent({
                          model: 'gemini-1.5-flash',
                          contents: [{ role: 'user', parts: [{ text: `Generate a short, descriptive 3-5 word title for this note content: "${extractedText.slice(0, 500)}". Output ONLY the title text, no quotes or metadata.` }] }]
                        });
                        finalTitle = (titleRes.text || '').trim().replace(/^"|"$/g, '');
                      }

                      // Create the note object
                      const newNote: ProjectNote = {
                        id: `note-${Date.now()}`,
                        title: finalTitle || 'Paper Extraction',
                        content: extractedText,
                        createdAt: Date.now(),
                        lastModified: Date.now()
                      };

                      // Persist to project
                      const existingNotes = projectRef.current.notes || [];
                      const updatedNotes = [...existingNotes, newNote];
                      await storageService.updateResearchProject(project.id, { notes: updatedNotes });
                      const updatedProject = { ...projectRef.current, notes: updatedNotes, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;

                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: { success: true, noteId: newNote.id, title: newNote.title, contentPreview: extractedText.slice(0, 100) }
                      });
                    } catch (err: any) {
                      console.error('[extract_paper_to_note] Error:', err);
                      logToVercel('[extract_paper_to_note] Error', 'error', err?.message || String(err));
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: err.message || String(err) } });
                    }
                  } else if (fc.name === 'digitize_paper_sketch') {
                    // ═══════════════════════════════════════════════════════════════
                    // DIGITIZE SKETCH: Camera Frame → Pro Image → Knowledge Base
                    // ═══════════════════════════════════════════════════════════════
                    const stylePrompt = args.prompt;
                    const frame = captureFrame();
                    if (!frame) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'Camera frame capture failed.' } });
                      continue;
                    }
                    try {
                      addMessage('model', '✨ Digitizing your sketch...');
                      const transformationPrompt = `Digitize and transform this physical sketch into a professional, clean digital asset. CRITICAL: Only include the bounds of the page/sketch itself. Completely remove and crop out any background elements like the table, hands, or surroundings, making the digitized sketch fill the entire image frame. Style: ${stylePrompt}. Maintain the core structure, layout, and concepts of the user's hand-drawn sketch while making it look like a high-quality masterpiece.`;
                      const result = await generateImageWithReferences(
                        transformationPrompt,
                        [{ base64: frame.data, mimeType: frame.mimeType }]
                      );
                      const imageUrl = result.imageDataUrl;

                      // Save to project Knowledge Base
                      const imgFetch = await fetch(imageUrl);
                      const imgBlob = await imgFetch.blob();
                      const imgFile = new File([imgBlob], `digitized-sketch-${Date.now()}.png`, { type: imgBlob.type || 'image/png' });
                      const kbAsset = await storageService.uploadKnowledgeBaseFile(project.id, imgFile);

                      // Update local project state
                      const existingKb = projectRef.current.knowledgeBase || [];
                      const updatedKb = [...existingKb, kbAsset];
                      await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKb });
                      const updatedProject = { ...projectRef.current, knowledgeBase: updatedKb, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;

                      // Track for ease of use in other tools
                      setLastGeneratedAsset({ url: imageUrl, type: 'image', name: `Digitized Sketch: ${stylePrompt.slice(0, 30)}`, timestamp: Date.now() });
                      trackConversationMedia({ id: kbAsset.id, url: imageUrl, type: 'image', source: 'generated', name: `Digitized Sketch: ${stylePrompt}` });

                      // Show in chat immediately
                      setMessages((prev) => [
                        ...prev,
                        { id: `digitized-${Date.now()}`, role: 'model', text: `Here is your digitized sketch in ${stylePrompt} style!`, timestamp: Date.now(), imageUrl }
                      ]);

                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: { success: true, imageUrl, kbFileId: kbAsset.id }
                      });
                    } catch (err: any) {
                      console.error('[digitize_paper_sketch] Error:', err);
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: err.message || String(err) } });
                    }
                  } else if (fc.name === 'generate_website_from_sketch') {
                    // ═══════════════════════════════════════════════════════════════
                    // GENERATE WEBSITE: Camera Frame → HTML/React Code
                    // ═══════════════════════════════════════════════════════════════
                    const stylePrompt = args.prompt || '';
                    const frame = captureFrame();
                    if (!frame) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'Camera frame capture failed. Ensure your camera is on.' } });
                      continue;
                    }
                    try {
                      addMessage('model', '💻 Building a website from your sketch using Gemini 3 Flash...');
                      const prompt = `You are an expert frontend developer and designer. Analyze this UI wireframe/sketch drawn on paper. 
                    Generate a fully functional, highly styled, and responsive single-file website (HTML document with embedded CSS/JS) based on this drawing. 
                    Use modern design principles, vibrant colors, and Tailwind CSS via CDN if helpful. 
                    Make educated guesses for any text or images if they are just squiggles or placeholders. 
                    ${stylePrompt ? `Additional instructions from the user: ${stylePrompt}` : ''}
                    Output ONLY the raw HTML code, nothing else. No markdown formatting blocks around the code.`;

                      const result = await ai.models.generateContent({
                        model: 'gemini-3-flash-preview',
                        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { data: frame.data, mimeType: frame.mimeType } }] }]
                      });

                      let htmlCode = result.text || '';
                      htmlCode = htmlCode.replace(/^```[a-z]*\n/gi, '').replace(/```$/g, '').trim();

                      // Save as an asset in the project
                      const newAsset: AssetItem = {
                        id: `website-${Date.now()}`,
                        type: 'website',
                        title: 'Sketched Website',
                        description: stylePrompt || 'Generated from a physical notebook sketch.',
                        url: '', // We use data for raw html apps usually, or could save it to FB storage
                        data: {
                          html: htmlCode
                        },
                        researchId: project.activeResearchTopic || 'sketch',
                        researchTopic: 'Notebook Sketch',
                        timestamp: Date.now()
                      };

                      const existingAssets = projectRef.current.researchSessions?.[0]?.assets || [];

                      // Simple logic: we attach it to the first research session or a placeholder if none exists
                      let sessions = projectRef.current.researchSessions || [];
                      if (sessions.length === 0) {
                        sessions = [{
                          id: 'session-default',
                          timestamp: Date.now(),
                          lastModified: Date.now(),
                          topic: 'Notebook Sketches',
                          researchReport: { topic: 'Notebook', headerImagePrompt: '', tldr: '', summary: '', keyPoints: [], marketImplications: '' },
                          websiteVersions: [],
                          assets: [newAsset]
                        }];
                      } else {
                        const updatedAssets = [...existingAssets, newAsset];
                        sessions[0] = { ...sessions[0], assets: updatedAssets };
                      }

                      await storageService.updateResearchProject(project.id, { researchSessions: sessions });
                      const updatedProject = { ...projectRef.current, researchSessions: sessions, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;

                      // omitted setting lastGeneratedAsset as it only accepts image/video for social posting

                      // Show a message in chat
                      setMessages((prev) => [
                        ...prev,
                        { id: `website-gen-${Date.now()}`, role: 'model', text: `I've generated the website based on your sketch! You can view it in the Assets > Apps tab.`, timestamp: Date.now() }
                      ]);

                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: { success: true, assetId: newAsset.id, message: 'Website generated and saved to assets.' }
                      });
                    } catch (err: any) {
                      console.error('[generate_website_from_sketch] Error:', err);
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: err.message || String(err) } });
                    }
                  } else if (fc.name === 'create_social_reel') {
                    // ═══════════════════════════════════════════════════════════════
                    // CREATE SOCIAL REEL: Camera Frame → Image → Veo Video → Post
                    // ═══════════════════════════════════════════════════════════════
                    const prompt = (args.prompt || 'Create an engaging social media reel').toString();
                    const targetPlatforms: SocialPlatform[] = Array.isArray(args.platforms)
                      ? args.platforms.map((p: any) => String(p).toLowerCase() as SocialPlatform)
                      : [];
                    const caption = (args.caption || '').toString().trim();
                    const scheduleAt = (args.scheduleAt || '').toString().trim();
                    const aspectRatio: '9:16' | '16:9' = args.aspectRatio === '16:9' ? '16:9' : '9:16';

                    // Validate platforms
                    if (targetPlatforms.length === 0) {
                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: { success: false, error: 'No platforms specified. Please ask the user which platforms to post to (e.g., Instagram, TikTok, Facebook).' }
                      });
                      continue;
                    }

                    const validPlatforms: SocialPlatform[] = ['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'linkedin'];
                    const invalidPlatforms = targetPlatforms.filter(p => !validPlatforms.includes(p));
                    if (invalidPlatforms.length > 0) {
                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: { success: false, error: `Invalid platform(s): ${invalidPlatforms.join(', ')}. Valid: ${validPlatforms.join(', ')}` }
                      });
                      continue;
                    }

                    // Check auth for all target platforms
                    const currentSocialState = socialStateRef.current;
                    const needsAuthPlatforms = targetPlatforms.filter(p => {
                      switch (p) {
                        case 'facebook': return !currentSocialState.facebookConnected;
                        case 'instagram': return !currentSocialState.facebookConnected || currentSocialState.igAccounts.length === 0;
                        case 'x': return !currentSocialState.xConnected;
                        case 'tiktok': return !currentSocialState.tiktokConnected;
                        case 'youtube': return !currentSocialState.youtubeConnected;
                        case 'linkedin': return !currentSocialState.linkedinConnected;
                        default: return true;
                      }
                    });

                    if (needsAuthPlatforms.length > 0) {
                      setPendingAuthPlatforms(needsAuthPlatforms);
                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: { success: false, needsAuth: true, platforms: needsAuthPlatforms, message: `Please connect your accounts first: ${needsAuthPlatforms.map(p => p.toUpperCase()).join(', ')}` }
                      });
                      continue;
                    }

                    try {
                      // Step 1: Capture camera frame
                      console.log('[create_social_reel] Step 1: Capturing camera frame...');
                      const frame = captureFrame();
                      if (!frame) {
                        functionResponses.push({
                          id: fc.id, name: fc.name,
                          response: { success: false, error: 'Camera not active or frame could not be captured. Please switch to Video Mode and ensure your camera is on.' }
                        });
                        continue;
                      }

                      // Step 2: Generate image from frame using Gemini
                      console.log('[create_social_reel] Step 2: Generating image from camera frame...');
                      addMessage('model', '🎨 Capturing your camera view and generating a creative image...');

                      const ctx = contextService.buildProjectContext(project);
                      const refinedPrompt = await refinePromptWithGemini3(
                        `Create a visually striking social media reel image: ${prompt}`,
                        ctx.fullContext,
                        'image'
                      );

                      const imageResult = await generateImageWithReferences(
                        refinedPrompt,
                        [{ base64: frame.data, mimeType: frame.mimeType }]
                      );
                      const imageUrl = imageResult.imageDataUrl;

                      // Save image to KB
                      let imageKbId: string | undefined;
                      let imageKbUrl: string = imageUrl;
                      try {
                        const imgRes = await fetch(imageUrl);
                        const imgBlob = await imgRes.blob();
                        const imgFile = new File([imgBlob], `social-reel-img-${Date.now()}.png`, { type: imgBlob.type || 'image/png' });
                        const imgKb = await storageService.uploadKnowledgeBaseFile(project.id, imgFile);
                        imageKbId = imgKb.id;
                        imageKbUrl = imgKb.url;

                        const existingKb = projectRef.current.knowledgeBase || [];
                        const updatedKb = [...existingKb, imgKb];
                        await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKb });
                        const updatedProject = { ...projectRef.current, knowledgeBase: updatedKb, lastModified: Date.now() };
                        onProjectUpdate?.(updatedProject);
                        projectRef.current = updatedProject;
                      } catch (saveErr) {
                        console.error('[create_social_reel] Failed to save generated image:', saveErr);
                      }

                      // Step 3: Create Veo 3.1 video from the image
                      console.log('[create_social_reel] Step 3: Creating Veo 3.1 video from image...');
                      addMessage('model', '🎬 Creating video reel from the image using Veo 3.1...');

                      // Check video usage limit
                      const videoCheck = await checkUsageLimit('video', isSubscribed);
                      if (!videoCheck.allowed) {
                        setUsageLimitModal({
                          isOpen: true,
                          usageType: 'video',
                          current: videoCheck.current,
                          limit: videoCheck.limit,
                        });
                        functionResponses.push({
                          id: fc.id, name: fc.name,
                          response: { success: false, error: 'Video generation limit reached. Please upgrade to Pro.' }
                        });
                        continue;
                      }
                      await incrementUsage('video');

                      // Convert image to base64 for Veo
                      const imgFetchRes = await fetch(imageUrl);
                      const imgBlob2 = await imgFetchRes.blob();
                      const arrayBuffer = await imgBlob2.arrayBuffer();
                      const base64 = btoa(
                        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                      );

                      const videoBlob = await generateVeoVideo(
                        `Animate this image into a dynamic, engaging social media reel: ${prompt}`,
                        aspectRatio,
                        'speed',
                        { image: { base64, mimeType: imgBlob2.type || 'image/png' } }
                      );

                      if (!videoBlob) {
                        throw new Error('Veo 3.1 video generation returned empty result.');
                      }

                      // Save video to KB
                      const videoFile = new File(
                        [videoBlob],
                        `social-reel-${Date.now()}.mp4`,
                        { type: 'video/mp4' }
                      );
                      const videoKb = await storageService.uploadKnowledgeBaseFile(project.id, videoFile);

                      const existingKb2 = projectRef.current.knowledgeBase || [];
                      const updatedKb2 = [...existingKb2, videoKb];
                      await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKb2 });
                      const updatedProject2 = { ...projectRef.current, knowledgeBase: updatedKb2, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject2);
                      projectRef.current = updatedProject2;

                      // Track the video asset
                      setLastGeneratedAsset({ url: videoKb.url, type: 'video', name: `Reel: ${prompt.slice(0, 40)}`, timestamp: Date.now() });
                      trackConversationMedia({ id: videoKb.id, url: videoKb.url, type: 'video', source: 'generated', name: `Reel: ${prompt.slice(0, 40)}` });

                      // Inject video into chat
                      setMessages((prev) => [
                        ...prev,
                        {
                          id: `social-reel-${Date.now()}`,
                          role: 'model',
                          text: '',
                          timestamp: Date.now(),
                          videoUrl: videoKb.url,
                        }
                      ]);

                      // Step 4: Post or Schedule to platforms
                      console.log('[create_social_reel] Step 4: Publishing to platforms:', targetPlatforms);

                      if (scheduleAt) {
                        // Schedule the post
                        addMessage('model', `📅 Scheduling reel to ${targetPlatforms.map(p => p.toUpperCase()).join(', ')}...`);
                        await executeSchedulePost(
                          {
                            platforms: targetPlatforms,
                            scheduledAt: scheduleAt,
                            contentType: 'video',
                            text: caption,
                            mediaUrl: videoKb.url,
                          },
                          addMessage,
                          () => { }
                        );

                        functionResponses.push({
                          id: fc.id, name: fc.name,
                          response: {
                            success: true,
                            message: `Reel created and scheduled to ${targetPlatforms.map(p => p.toUpperCase()).join(', ')} for ${scheduleAt}`,
                            videoUrl: videoKb.url,
                            imageUrl: imageKbUrl,
                          }
                        });
                      } else {
                        // Post immediately
                        addMessage('model', `📤 Posting reel to ${targetPlatforms.map(p => p.toUpperCase()).join(', ')}...`);
                        const results: { platform: string; success: boolean; postId?: string; error?: string }[] = [];

                        for (const platform of targetPlatforms) {
                          try {
                            const result = await postToSocialPlatform(platform, 'video', caption, videoKb.url);
                            results.push({ platform, success: result.success, postId: result.postId, error: result.error });
                          } catch (err: any) {
                            results.push({ platform, success: false, error: err.message });
                          }
                        }

                        const successCount = results.filter(r => r.success).length;
                        const summary = successCount > 0
                          ? `✅ Reel posted to ${results.filter(r => r.success).map(r => r.platform.toUpperCase()).join(', ')}!`
                          : `❌ Failed to post reel: ${results.map(r => `${r.platform}: ${r.error}`).join(', ')}`;

                        functionResponses.push({
                          id: fc.id, name: fc.name,
                          response: {
                            success: successCount > 0,
                            results,
                            message: summary,
                            videoUrl: videoKb.url,
                            imageUrl: imageKbUrl,
                          }
                        });
                      }
                    } catch (reelError: any) {
                      console.error('[create_social_reel] Pipeline error:', reelError);
                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: { success: false, error: `Reel creation failed: ${reelError.message || reelError}` }
                      });
                    }
                  } else if (fc.name === 'edit_video_with_xai') {
                    // Edit video using xAI Grok
                    const videoUrl = (args.videoUrl || '').toString();
                    const instruction = (args.instruction || '').toString();

                    try {
                      // Credit Check for video editing
                      const hasCredits = await checkCredits('videoEditXai');
                      if (!hasCredits) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { success: false, error: 'Insufficient credits for video editing' }
                        });
                        continue;
                      }

                      // Find video from attachments or conversation media
                      // xAI requires a PUBLICLY ACCESSIBLE URL
                      let resolvedVideoUrl: string | null = null;

                      // Priority 1: Check pending attachments - upload to KB for public URL
                      const videoAttachment = readyAttachments.find(a =>
                        a.file?.type?.startsWith('video/')
                      );

                      if (videoAttachment?.file) {
                        // Upload to KB storage to get a public URL (xAI can't access Gemini file URIs)
                        try {
                          console.log('[edit_video_with_xai] Uploading attached video to KB...');
                          const kbFile = await storageService.uploadKnowledgeBaseFile(projectRef.current.id, videoAttachment.file);
                          resolvedVideoUrl = kbFile.url;
                          console.log('[edit_video_with_xai] Uploaded video to KB, got public URL');

                          // Also save to project KB
                          const existingKb = projectRef.current.knowledgeBase || [];
                          const updatedKnowledgeBase = [...existingKb, kbFile];
                          await storageService.updateResearchProject(projectRef.current.id, { knowledgeBase: updatedKnowledgeBase });
                          const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                          onProjectUpdate?.(updatedProject);
                          projectRef.current = updatedProject;

                          // Track for future use
                          trackConversationMedia({ id: kbFile.id, url: resolvedVideoUrl, type: 'video', source: 'attached', name: videoAttachment.file.name });
                        } catch (uploadErr) {
                          console.error('[edit_video_with_xai] Failed to upload video:', uploadErr);
                          functionResponses.push({
                            id: fc.id,
                            name: fc.name,
                            response: { success: false, error: 'Failed to upload video for editing. Please try again.' }
                          });
                          continue;
                        }
                      }

                      // Priority 2: Check conversation media (recently dropped/attached)
                      if (!resolvedVideoUrl && currentConversationMedia.length > 0) {
                        const recentVideo = currentConversationMedia.find(m => m.type === 'video');
                        if (recentVideo) {
                          resolvedVideoUrl = recentVideo.publicUrl || recentVideo.url;
                          console.log('[edit_video_with_xai] Using tracked conversation media');
                        }
                      }

                      // Priority 3: Try to use the provided videoUrl
                      if (!resolvedVideoUrl && videoUrl) {
                        resolvedVideoUrl = videoUrl;
                        console.log('[edit_video_with_xai] Using URL from args');
                      }

                      // Priority 4: Check lastGeneratedAsset
                      if (!resolvedVideoUrl && lastGeneratedAsset?.type === 'video') {
                        resolvedVideoUrl = lastGeneratedAsset.publicUrl || lastGeneratedAsset.url;
                        console.log('[edit_video_with_xai] Using lastGeneratedAsset');
                      }

                      if (!resolvedVideoUrl) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { success: false, error: 'No video found to edit. Please attach or drop a video first (max 8.7 seconds).' }
                        });
                        continue;
                      }

                      // Deduct credits
                      const success = await deductCredits('videoEditXai');
                      if (!success) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { success: false, error: 'Failed to deduct credits' }
                        });
                        continue;
                      }

                      // Use xAI Grok video editing
                      const { xaiService } = await import('../services/xaiService');

                      addMessage('model', `🎬 Editing video with xAI Grok...\n\n*Instruction: "${instruction}"*`);

                      const editResponse = await xaiService.editVideo({
                        prompt: instruction,
                        video_url: resolvedVideoUrl
                      });

                      if (!editResponse.request_id) {
                        throw new Error('No request ID returned from xAI');
                      }

                      // Poll for completion
                      const result = await xaiService.pollUntilComplete(
                        editResponse.request_id,
                        (status) => console.log(`[edit_video_with_xai] Poll status: ${status}`)
                      );

                      if (!result.url) {
                        throw new Error('Video editing failed - no output URL');
                      }

                      // Download and save to knowledge base
                      let kbFileId: string | undefined;
                      try {
                        const res = await fetch(result.url);
                        const blob = await res.blob();
                        const file = new File([blob], `live-video-edit-${Date.now()}.mp4`, { type: 'video/mp4' });
                        const kb = await storageService.uploadKnowledgeBaseFile(project.id, file);
                        kbFileId = kb.id;

                        // Persist to project
                        const existingKb = projectRef.current.knowledgeBase || [];
                        const updatedKnowledgeBase = [...existingKb, kb];
                        await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });

                        const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                        onProjectUpdate?.(updatedProject);
                        projectRef.current = updatedProject;

                        // Track the edited video for future posts/scheduling
                        trackConversationMedia({
                          id: kbFileId,
                          url: kb.url,
                          publicUrl: kb.url,
                          type: 'video',
                          source: 'generated',
                          name: `Edited: ${instruction.slice(0, 30)}`
                        });
                      } catch (saveError) {
                        console.error('Failed to save edited video to project:', saveError);
                      }

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          videoUrl: result.url,
                          instruction,
                          kbFileId
                        }
                      });
                    } catch (editError: any) {
                      console.error('Live video edit error:', editError);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: editError?.message || 'Failed to edit video with xAI',
                          instruction
                        }
                      });
                    }
                  } else if (fc.name === 'create_project_task') {
                    const title = (args.title || 'Untitled Task').toString();
                    const description = (args.description || '').toString();
                    const priority = (args.priority || 'medium').toString() as 'low' | 'medium' | 'high';

                    const newTask: ProjectTask = {
                      id: crypto.randomUUID(),
                      title,
                      description,
                      priority,
                      status: 'todo',
                      order: (projectRef.current.tasks?.length || 0),
                      createdAt: Date.now(),
                      lastModified: Date.now(),
                      aiGenerated: true
                    };

                    const updatedTasks = [...(projectRef.current.tasks || []), newTask];
                    const updatedProject = { ...projectRef.current, tasks: updatedTasks, lastModified: Date.now() };

                    onProjectUpdate?.(updatedProject);
                    projectRef.current = updatedProject;

                    functionResponses.push({ id: fc.id, name: fc.name, response: { success: true, taskId: newTask.id } });

                  } else if (fc.name === 'update_project_task') {
                    const taskId = (args.taskId || '').toString();
                    if (!taskId) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'taskId required' } });
                    } else {
                      const tasks = projectRef.current.tasks || [];
                      const updatedTasks = tasks.map(t => {
                        if (t.id !== taskId) return t;
                        return {
                          ...t,
                          ...(args.title ? { title: String(args.title) } : {}),
                          ...(args.description ? { description: String(args.description) } : {}),
                          ...(args.status ? { status: String(args.status) as any } : {}),
                          ...(args.priority ? { priority: String(args.priority) as any } : {}),
                          lastModified: Date.now()
                        };
                      });

                      const updatedProject = { ...projectRef.current, tasks: updatedTasks, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });
                    }

                  } else if (fc.name === 'delete_project_task') {
                    const taskId = (args.taskId || '').toString();
                    const tasks = projectRef.current.tasks || [];
                    const updatedTasks = tasks.filter(t => t.id !== taskId);

                    const updatedProject = { ...projectRef.current, tasks: updatedTasks, lastModified: Date.now() };
                    onProjectUpdate?.(updatedProject);
                    projectRef.current = updatedProject;
                    functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });

                  } else if (fc.name === 'create_project_note') {
                    const title = (args.title || 'Untitled Note').toString();
                    const content = (args.content || '').toString();

                    const newNote: ProjectNote = {
                      id: crypto.randomUUID(),
                      title,
                      content,
                      createdAt: Date.now(),
                      lastModified: Date.now(),
                      aiGenerated: true
                    };

                    const updatedNotes = [...(projectRef.current.notes || []), newNote];
                    const updatedProject = { ...projectRef.current, notes: updatedNotes, lastModified: Date.now() };
                    onProjectUpdate?.(updatedProject);
                    projectRef.current = updatedProject;
                    functionResponses.push({ id: fc.id, name: fc.name, response: { success: true, noteId: newNote.id } });

                  } else if (fc.name === 'append_project_note') {
                    const noteId = (args.noteId || '').toString();
                    const text = (args.text || '').toString();
                    const notes = projectRef.current.notes || [];
                    const updatedNotes = notes.map(n => {
                      if (n.id !== noteId) return n;
                      return { ...n, content: n.content + '\n' + text, lastModified: Date.now() };
                    });

                    const updatedProject = { ...projectRef.current, notes: updatedNotes, lastModified: Date.now() };
                    onProjectUpdate?.(updatedProject);
                    projectRef.current = updatedProject;
                    functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });

                  } else if (fc.name === 'delete_project_note') {
                    const noteId = (args.noteId || '').toString();
                    const notes = projectRef.current.notes || [];
                    const updatedNotes = notes.filter(n => n.id !== noteId);

                    const updatedProject = { ...projectRef.current, notes: updatedNotes, lastModified: Date.now() };
                    onProjectUpdate?.(updatedProject);
                    projectRef.current = updatedProject;
                    functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });

                  } else if (fc.name === 'delete_scheduled_post') {
                    const postId = (args.postId || '').toString();
                    const posts = projectRef.current.scheduledPosts || [];
                    const updatedPosts = posts.filter(p => p.id !== postId);

                    const updatedProject = { ...projectRef.current, scheduledPosts: updatedPosts, lastModified: Date.now() };
                    onProjectUpdate?.(updatedProject);
                    projectRef.current = updatedProject;
                    functionResponses.push({ id: fc.id, name: fc.name, response: { success: true } });

                  } else if (fc.name === 'start_new_research_session') {
                    const topic = (args.topic || '').toString();
                    if (!topic) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'Topic is required' } });
                    } else {
                      try {
                        // Deduct credits for deep research
                        const creditSuccess = await deductCredits('deepResearch');
                        if (!creditSuccess) {
                          functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'Insufficient credits for deep research' } });
                          continue;
                        }

                        // Note: This is a heavy operation, so we await it.
                        // Ideally we would send an intermediate "I'm starting research..." message, but the tool protocol waits.
                        const report = await performDeepResearch(topic, undefined, undefined, undefined, undefined, project.id, project.ownerUid);

                        const newResearch: SavedResearch = {
                          id: crypto.randomUUID(),
                          topic: report.topic,
                          timestamp: Date.now(),
                          lastModified: Date.now(),
                          researchReport: report,
                          websiteVersions: []
                        };

                        const updatedProject = {
                          ...projectRef.current,
                          researchSessions: [...(projectRef.current.researchSessions || []), newResearch],
                          lastModified: Date.now()
                        };

                        onProjectUpdate?.(updatedProject);
                        projectRef.current = updatedProject;

                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: {
                            success: true,
                            researchId: newResearch.id,
                            summary: report.tldr || report.summary
                          }
                        });
                      } catch (e: any) {
                        console.error('Deep research failed:', e);
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { success: false, error: e.message || 'Research failed' }
                        });
                      }
                    }

                  } else if (fc.name === 'generate_video_from_image') {
                    let imageUrl = (args.imageUrl || '').toString();
                    const assetId = (args.assetId || '').toString();
                    const assetName = (args.assetName || '').toString();
                    const prompt = (args.prompt || '').toString();

                    const ctx = contextService.buildProjectContext(project);
                    const refinedPrompt = await refinePromptWithGemini3(prompt, ctx.fullContext, 'video');

                    const aspect = (args.aspect || '720x1280').toString();
                    const mode = (args.mode || 'speed').toString();

                    try {
                      const videoCheck = await checkUsageLimit('video', isSubscribed);
                      if (!videoCheck.allowed) {
                        setUsageLimitModal({
                          isOpen: true,
                          usageType: 'video',
                          current: videoCheck.current,
                          limit: videoCheck.limit,
                        });
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: {
                            success: false,
                            error: 'Video generation limit reached. Please upgrade to Pro for more.',
                          },
                        });
                        continue;
                      }

                      await incrementUsage('video');

                      await incrementUsage('video');

                      // Resolve image URL from various sources
                      if (!imageUrl) {
                        // 1. Check UseLastGenerated / Asset Name
                        if (assetId || assetName) {
                          const knowledgeBase = project.knowledgeBase || [];
                          let matchedAsset = null;
                          if (assetId) {
                            matchedAsset = knowledgeBase.find((kb) => kb.id === assetId);
                          } else if (assetName) {
                            const searchTerm = assetName.toLowerCase();
                            matchedAsset = knowledgeBase.find((kb) => (kb.name || '').toLowerCase().includes(searchTerm));
                          }
                          if (matchedAsset && matchedAsset.url) imageUrl = matchedAsset.url;
                        }

                        // 2. Check Last Generated Asset
                        if (!imageUrl && lastGeneratedAsset && lastGeneratedAsset.type.startsWith('image')) {
                          imageUrl = typeof lastGeneratedAsset === 'string' ? lastGeneratedAsset : (lastGeneratedAsset.publicUrl || lastGeneratedAsset.url);
                          console.log('[generate_video_from_image] Using last generated asset:', imageUrl);
                        }

                        // 3. Check Conversation Media
                        if (!imageUrl && currentConversationMedia.length > 0) {
                          const media = currentConversationMedia.find(m => m.type === 'image');
                          if (media) {
                            imageUrl = media.publicUrl || media.url;
                            console.log('[generate_video_from_image] Using conversation media:', imageUrl);
                          }
                        }

                        // 4. Check Attachments
                        if (!imageUrl && (pendingAttachments.length > 0 || readyAttachments.length > 0)) {
                          const allAttachments = [...(readyAttachments || []), ...pendingAttachments];
                          const attachment = allAttachments.find((a: any) => {
                            const mimeType = a.file?.type || a.uploaded?.mimeType || '';
                            return mimeType.startsWith('image/');
                          });
                          if (attachment?.uploaded?.url) {
                            imageUrl = attachment.uploaded.url;
                            console.log('[generate_video_from_image] Using attached image:', imageUrl);
                          }
                        }
                      }

                      if (!imageUrl) {
                        throw new Error('No image found to animate. Please attach an image, refer to a previous image, or provide an image URL.');
                      }

                      // Fetch the image and wrap it in a File
                      const imageRes = await fetch(imageUrl);
                      if (!imageRes.ok) throw new Error(`Failed to fetch input image: ${imageRes.statusText}`);

                      const imageBlob = await imageRes.blob();
                      if (!imageBlob.type.startsWith('image/') && !imageBlob.type.includes('octet-stream')) {
                        throw new Error(`Invalid image type: ${imageBlob.type}. Please use a valid image file.`);
                      }

                      const imageFile = new File(
                        [imageBlob],
                        `chat-video-image-${Date.now()}.png`,
                        { type: imageBlob.type || 'image/png' }
                      );


                      const model = mode === 'quality' ? 'sora-2-pro' : 'sora-2';
                      let videoBlob: Blob | null = null;

                      // Try Sora 2 first
                      try {
                        const job = await createVideoFromImage(
                          {
                            model: model as any,
                            prompt: refinedPrompt || 'Animate this image into a dynamic social clip.',
                            seconds: '12',
                            size: (aspect || '720x1280') as any,
                          },
                          imageFile,
                        );

                        const finalJob = await pollVideoUntilComplete(job.id, () => { }, 5000);
                        if (finalJob.status !== 'completed') {
                          throw new Error(finalJob.error?.message || `Sora video job ended with status: ${finalJob.status}`);
                        }

                        videoBlob = await downloadVideoBlob(finalJob.id, 'video');
                      } catch (soraError: any) {
                        console.warn('Sora image-to-video failed, falling back to Veo 3.1...', soraError);

                        // Veo 3.1 fallback - convert image to base64 for first frame
                        const arrayBuffer = await imageBlob.arrayBuffer();
                        const base64 = btoa(
                          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                        );
                        const aspectRatio: '16:9' | '9:16' =
                          aspect === '1280x720' || aspect === '1792x1024' ? '16:9' : '9:16';

                        videoBlob = await generateVeoVideo(
                          refinedPrompt || 'Animate this image into a dynamic video.',
                          aspectRatio,
                          'speed',
                          { image: { base64, mimeType: imageBlob.type || 'image/png' } }
                        );
                      }

                      if (!videoBlob) {
                        throw new Error('Video generation failed (both Sora and Veo).');
                      }

                      const videoFile = new File(
                        [videoBlob],
                        `chat-video-from-image-${Date.now()}.mp4`,
                        { type: 'video/mp4' }
                      );

                      const kb = await storageService.uploadKnowledgeBaseFile(project.id, videoFile);

                      // Persist to project
                      const existingKb = projectRef.current.knowledgeBase || [];
                      const updatedKnowledgeBase = [...existingKb, kb];
                      await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });

                      const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          prompt,
                          imageUrl,
                          videoUrl: kb.url,
                          fileId: kb.id,
                        }
                      });

                      // Inject video into the chat stream immediately
                      setMessages((prev) => [
                        ...prev,
                        {
                          id: `video-gen-${Date.now()}`,
                          role: 'model',
                          text: '',
                          timestamp: Date.now(),
                          videoUrl: kb.url,
                        }
                      ]);
                      // Track for easy posting
                      setLastGeneratedAsset({ url: kb.url, type: 'video', name: prompt.slice(0, 50), timestamp: Date.now() });
                      trackConversationMedia({ id: kb.id, url: kb.url, type: 'video', source: 'generated', name: prompt.slice(0, 50) });
                    } catch (videoError) {
                      console.error('Live image-to-video generation error:', videoError);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: 'Failed to generate video from image',
                          prompt,
                          imageUrl,
                        }
                      });
                    }
                  } else if (fc.name === 'generate_video_from_prompt') {
                    const prompt = (args.prompt || '').toString();
                    const ctx = contextService.buildProjectContext(project);
                    const refinedPrompt = await refinePromptWithGemini3(prompt, ctx.fullContext, 'video');
                    const aspect = (args.aspect || '720x1280').toString();
                    const mode = (args.mode || 'speed').toString();

                    try {
                      const videoCheck = await checkUsageLimit('video', isSubscribed);
                      if (!videoCheck.allowed) {
                        setUsageLimitModal({
                          isOpen: true,
                          usageType: 'video',
                          current: videoCheck.current,
                          limit: videoCheck.limit,
                        });
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: {
                            success: false,
                            error: 'Video generation limit reached. Please upgrade to Pro for more.',
                          },
                        });
                        continue;
                      }

                      await incrementUsage('video');

                      const result = await generateProjectVideoAsset(refinedPrompt, aspect, mode);

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          prompt,
                          videoUrl: result.videoUrl,
                          fileId: result.kbFileId,
                        },
                      });

                      // Inject video into the chat stream immediately
                      setMessages((prev) => [
                        ...prev,
                        {
                          id: `video-gen-${Date.now()}`,
                          role: 'model',
                          text: '',
                          timestamp: Date.now(),
                          videoUrl: result.videoUrl,
                        }
                      ]);
                      // Track for easy posting
                      setLastGeneratedAsset({ url: result.videoUrl, type: 'video', name: prompt.slice(0, 50), timestamp: Date.now() });
                    } catch (videoError) {
                      console.error('Live text-to-video generation error:', videoError);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: 'Failed to generate video from prompt',
                          prompt,
                        },
                      });
                    }
                  } else if (fc.name === 'generate_video_overview') {
                    const prompt = (args.prompt || '').toString();
                    const aspectArg = (args.aspect || '16:9').toString();
                    const slideCountArg = typeof args.slideCount === 'number' ? args.slideCount : 12;

                    // Convert aspect ratio to Creatomate format
                    const aspectString = aspectArg === '9:16' ? '720x1280' : '1280x720';

                    try {
                      const videoCheck = await checkUsageLimit('video', isSubscribed);
                      if (!videoCheck.allowed) {
                        setUsageLimitModal({
                          isOpen: true,
                          usageType: 'video',
                          current: videoCheck.current,
                          limit: videoCheck.limit,
                        });
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: {
                            success: false,
                            error: 'Video generation limit reached. Please upgrade to Pro for more.',
                          },
                        });
                        continue;
                      }

                      await incrementUsage('video');

                      // Build context description for the video overview
                      const ctx = contextService.buildProjectContext(project);
                      const contextDescription = ctx.fullContext || project.description || project.name || '';

                      // Add a generating message to chat
                      const generatingMsgId = `overview-gen-${Date.now()}`;
                      setMessages((prev) => [
                        ...prev,
                        {
                          id: generatingMsgId,
                          role: 'model',
                          text: '🎬 Generating AI avatar overview video... This will take 10-20 minutes.',
                          timestamp: Date.now(),
                          isGenerating: true,
                        }
                      ]);

                      const result = await createVideoOverview({
                        projectId: project.id,
                        prompt: prompt,
                        aspect: aspectString,
                        contextDescription: contextDescription,
                        slideCount: slideCountArg,
                        voiceName: 'Kore',
                        onStatusUpdate: (status, progress) => {
                          // Update the generating message with progress
                          setMessages((prev) => prev.map((msg) =>
                            msg.id === generatingMsgId
                              ? { ...msg, text: `🎬 ${progress || status}` }
                              : msg
                          ));
                        },
                      });

                      // Remove the generating message
                      setMessages((prev) => prev.filter((msg) => msg.id !== generatingMsgId));

                      // Save to knowledge base
                      const videoRes = await fetch(result.url);
                      const videoBlob = await videoRes.blob();
                      const videoFile = new File([videoBlob], `project-overview-${Date.now()}.mp4`, { type: 'video/mp4' });

                      // Explicitly upload to Vercel Blob via storageService before saving to project
                      // This ensures the asset is permanent and not just a temporary Creatomate URL
                      const kb = await storageService.uploadKnowledgeBaseFile(project.id, videoFile);

                      // Persist to project
                      const existingKb = projectRef.current.knowledgeBase || [];
                      const updatedKnowledgeBase = [...existingKb, kb];
                      await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });

                      const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          prompt,
                          videoUrl: kb.url,
                          fileId: kb.id,
                          message: 'AI avatar overview video generated successfully!'
                        },
                      });

                      // Inject video into the chat stream
                      setMessages((prev) => [
                        ...prev,
                        {
                          id: `overview-video-${Date.now()}`,
                          role: 'model',
                          text: '',
                          timestamp: Date.now(),
                          videoUrl: kb.url,
                        }
                      ]);

                      // Track for easy posting
                      setLastGeneratedAsset({ url: kb.url, type: 'video', name: `Overview: ${prompt.slice(0, 40)}`, timestamp: Date.now() });
                    } catch (overviewError: any) {
                      // Remove generating message on error
                      setMessages((prev) => prev.filter((msg) => !msg.isGenerating));

                      console.error('Video overview generation error:', overviewError);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: overviewError?.message || 'Failed to generate video overview',
                          prompt,
                        },
                      });
                    }
                  } else if (fc.name === 'generate_project_book') {
                    const prompt = (args.prompt || '').toString();
                    const pageCountArg = typeof args.pageCount === 'number' ? args.pageCount : undefined;
                    try {
                      const result = await generateProjectBookAsset(prompt, pageCountArg);
                      const title = result.book?.title || prompt || project.name || 'Project book';
                      const pageTotal = result.book?.pages?.length ?? 0;
                      const lines: string[] = [
                        `I generated an illustrated book "${title}" based on your project context and saved it to your latest research session under the Books tab.`,
                      ];
                      if (pageTotal > 0) {
                        lines.push(`The book has ${pageTotal} pages, and I also compiled a PDF you can download from the Books tab.`);
                      }
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          prompt,
                          bookTitle: title,
                          pageCount: pageTotal,
                        },
                      });
                    } catch (bookError) {
                      console.error('Live book generation error:', bookError);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: 'Failed to generate book',
                          prompt,
                        },
                      });
                    }
                  } else if (fc.name === 'generate_project_podcast') {
                    const topic = (args.topic || args.prompt || '').toString();
                    const style = (args.style || 'conversational').toString() as any;
                    const duration = (args.duration || 'short').toString() as any;

                    // Credit Check
                    const operation: CreditOperation = duration === 'long' ? 'podcastLong' : duration === 'medium' ? 'podcastMedium' : 'podcastShort';
                    const hasCredits = await checkCredits(operation);
                    if (!hasCredits) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: 'Insufficient credits', cancelled: true }
                      });
                      continue;
                    }

                    const success = await deductCredits(operation);
                    if (!success) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: 'Failed to deduct credits' }
                      });
                      continue;
                    }

                    try {
                      // 1. Prepare context (Research, Files, Notes)
                      const researchSummaries = (project.researchSessions || []).map(r => ({
                        topic: r.topic,
                        summary: r.researchReport?.summary || r.researchReport?.tldr || '',
                        keyPoints: r.researchReport?.keyPoints?.map(kp => kp.title) || []
                      }));

                      const uploadedFiles = project.uploadedFiles?.map(f => ({
                        displayName: f.displayName,
                        name: f.name,
                        mimeType: f.mimeType,
                        summary: f.summary
                      }));

                      const noteSnippets = (project.notes || [])
                        .slice(0, 10)
                        .map(n => `${n.title}: ${(n.content || '').slice(0, 200)}`)
                        .join('\n');

                      const descriptionWithNotes = noteSnippets
                        ? `${project.description}\n\nKey project notes:\n${noteSnippets}`
                        : project.description;

                      // 2. Generate Script
                      const script = await generatePodcastScript(
                        project.name,
                        descriptionWithNotes,
                        researchSummaries,
                        style,
                        duration,
                        uploadedFiles
                      );

                      // 3. Generate Audio
                      const audio = await generatePodcastAudio(script);

                      // 4. Convert Base64 to File
                      const binaryString = atob(audio.audioData);
                      const bytes = new Uint8Array(binaryString.length);
                      for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                      }
                      const audioBlob = new Blob([bytes], { type: audio.mimeType || 'audio/wav' });

                      const safeTitle = script.title || 'podcast';
                      const fileName = `${safeTitle.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.wav`;
                      const file = new File([audioBlob], fileName, { type: audio.mimeType || 'audio/wav' });

                      // 5. Upload & Persist
                      const kbFile = await storageService.uploadKnowledgeBaseFile(project.id, file);

                      // CRITICAL: Verify we got a valid persistent URL (Vercel Blob), NOT a local blob: URL
                      if (kbFile.url.startsWith('blob:')) {
                        throw new Error('Upload failed (returned local blob URL). Persistence aborted to prevent broken assets.');
                      }

                      const existingKb = projectRef.current.knowledgeBase || [];
                      const updatedKnowledgeBase = [...existingKb, kbFile];

                      await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });

                      const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;

                      // 6. Respond
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          title: script.title,
                          audioUrl: kbFile.url,
                          duration: script.estimatedDuration
                        }
                      });

                      // Track for easy posting
                      setLastGeneratedAsset({ url: kbFile.url, type: 'video', name: `Podcast: ${script.title}`, timestamp: Date.now() });

                    } catch (podcastError: any) {
                      console.error('Live podcast generation error:', podcastError);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: podcastError.message || 'Failed to generate podcast',
                        }
                      });
                    }
                  } else if (fc.name === 'generate_project_blog') {
                    // ========== Blog Generation Handler ==========
                    const prompt = String(args.prompt || '').trim();
                    try {
                      if (!prompt) throw new Error('Blog topic/prompt is required');
                      addMessage('model', `📝 Generating blog article about "${prompt}"...`);
                      const { blog } = await generateProjectBlogAsset(prompt);
                      if (blog) {
                        let blogText = `# ${blog.title}\n\n`;
                        if (blog.subtitle) blogText += `_${blog.subtitle}_\n\n`;
                        blogText += blog.content || '';
                        addMessage('model', blogText);
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { success: true, title: blog.title }
                        });
                      } else {
                        throw new Error('Blog generation returned empty result');
                      }
                    } catch (e: any) {
                      console.error('Live blog generation error:', e);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: e.message || 'Failed to generate blog' }
                      });
                    }
                  } else if (fc.name === 'generate_project_table') {
                    const prompt = String(args.prompt || '').trim();
                    try {
                      if (!prompt) throw new Error('Missing prompt');
                      const table = await generateProjectTableAsset(prompt);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          tableId: table.id,
                          title: table.title,
                          columnCount: table.columns.length,
                          rowCount: table.rows.length,
                        },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'edit_project_table') {
                    try {
                      const instruction = String(args.instruction || '').trim();
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor unavailable. Open Assets > Tables first.');

                      const cur = bridge.getTable();
                      if (!cur || !cur.table) throw new Error('No table currently loaded.');

                      const newTableSpec = await refineProjectTableAsset(cur.table, instruction);

                      bridge.setTableTitle(newTableSpec.title || cur.table.title || 'Table');
                      bridge.setTableDescription(newTableSpec.description || cur.table.description || '');
                      bridge.setColumns(newTableSpec.columns);
                      bridge.setRows(newTableSpec.rows);

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true, message: 'Table updated successfully.' },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'save_project_table') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
                      const out = bridge.getTable();
                      const t = (out as any)?.table;
                      if (!t) throw new Error('No table is currently loaded in the Tables tab.');

                      const tableAsset: TableAsset = {
                        id: String(t.id || `table-${Date.now()}`),
                        title: String(t.title || 'Table'),
                        description: typeof t.description === 'string' ? t.description : undefined,
                        columns: Array.isArray(t.columns) ? t.columns.map((c: any) => String(c ?? '')) : [],
                        rows: Array.isArray(t.rows) ? t.rows.map((r: any) => (Array.isArray(r) ? r.map((v: any) => String(v ?? '')) : [])) : [],
                        createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
                        googleSpreadsheetId: typeof t.googleSpreadsheetId === 'string' ? t.googleSpreadsheetId : undefined,
                        googleSheetTitle: typeof t.googleSheetTitle === 'string' ? t.googleSheetTitle : undefined,
                      };

                      await saveTableToLatestSession(tableAsset);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true, tableId: tableAsset.id, title: tableAsset.title },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'save_table_to_google_sheet') {
                    try {
                      const bridge = getTableEditorBridge();
                      if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load a table first.');
                      const out = bridge.getTable();
                      const t = (out as any)?.table;
                      if (!t) throw new Error('No table is currently loaded in the Tables tab.');
                      await saveTableBackToGoogleSheet(t);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'generate_lead_form') {
                    // --- Lead Form Generation Handler ---
                    const title = String(args.title || 'Contact Form').trim();
                    const prompt = String(args.prompt || 'Modern, professional design').trim();
                    const fields = Array.isArray(args.fields) ? args.fields : [];

                    try {
                      if (!title) throw new Error('Form title is required');
                      if (fields.length === 0) throw new Error('At least one field is required');

                      // Map fields to the expected format
                      const formFields = fields.map((f: any) => ({
                        label: String(f.label || 'Field'),
                        type: String(f.type || 'text') as any,
                        required: Boolean(f.required),
                        placeholder: String(f.placeholder || ''),
                        options: Array.isArray(f.options) ? f.options.map((o: any) => String(o)) : undefined
                      }));

                      // Generate unique IDs
                      const formId = crypto.randomUUID();
                      const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;

                      // Import and call streamLeadFormWebsite
                      const { streamLeadFormWebsite } = await import('../services/geminiService');

                      let generatedHtml = '';
                      const finalHtml = await streamLeadFormWebsite(
                        prompt,
                        formFields,
                        formId,
                        slug,
                        projectRef.current.id,
                        title,
                        (chunk) => { generatedHtml += chunk; }
                      );

                      // Save form to Firestore via API
                      const publicUrl = `${window.location.origin}/form/${slug}`;
                      const formData = {
                        id: formId,
                        title,
                        slug,
                        projectId: projectRef.current.id,
                        fields: formFields,
                        html: finalHtml,
                        publicUrl,
                        createdAt: Date.now(),
                        leadCount: 0
                      };

                      await authFetch('/api/websites?op=save-form', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(formData)
                      });

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          formId,
                          title,
                          publicUrl,
                          fieldCount: formFields.length
                        }
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) }
                      });
                    }
                  } else if (fc.name === 'create_stripe_product') {
                    // --- Stripe Product Creation Handler (Chat Mode) ---
                    const productName = String(args.name || '').trim();
                    const description = String(args.description || '').trim();
                    const price = Number(args.price) || 0;
                    const currency = String(args.currency || 'usd').toLowerCase();
                    let imageUrl = String(args.imageUrl || '').trim();
                    const assetName = String(args.assetName || '').trim();
                    const useLastGenerated = Boolean(args.useLastGenerated);

                    try {
                      if (!productName) throw new Error('Product name is required');
                      if (price <= 0) throw new Error('Price must be greater than 0');

                      // Check Stripe connection
                      const userProfile = (window as any).__userProfile as UserProfile | undefined;
                      const stripeAccountId = userProfile?.stripeConnect?.accountId;

                      if (!stripeAccountId) {
                        // Return response asking user to connect Stripe
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: {
                            success: false,
                            needsStripeConnect: true,
                            error: 'Stripe is not connected. Please click the "Connect Stripe" button below to set up payments before creating products.'
                          }
                        });

                        // Set state to show Stripe connect button
                        setShowStripeConnectPrompt(true);
                        continue;
                      }

                      // Resolve image URL from various sources
                      if (!imageUrl && useLastGenerated && lastGeneratedAsset) {
                        imageUrl = typeof lastGeneratedAsset === 'string' ? lastGeneratedAsset : (lastGeneratedAsset.publicUrl || lastGeneratedAsset.url);
                        console.log('[create_stripe_product] Using last generated asset:', imageUrl);
                      }

                      if (!imageUrl && assetName) {
                        // Search knowledge base for matching asset
                        const kb = project.knowledgeBase || [];
                        const match = kb.find((f: KnowledgeBaseFile) =>
                          f.type?.startsWith('image/') &&
                          f.name?.toLowerCase().includes(assetName.toLowerCase())
                        );
                        if (match) {
                          imageUrl = match.url;
                          console.log('[create_stripe_product] Found asset by name:', assetName, '->', match.name);
                        }
                      }

                      // Check conversation media for recent images
                      if (!imageUrl && currentConversationMedia.length > 0) {
                        const recentImage = currentConversationMedia.find(m => m.type === 'image');
                        if (recentImage) {
                          imageUrl = recentImage.publicUrl || recentImage.url;
                          console.log('[create_stripe_product] Using conversation media:', imageUrl);
                        }
                      }

                      // Use attached file if available
                      if (!imageUrl && pendingAttachments.length > 0) {
                        const imageAttachment = pendingAttachments.find(a =>
                          a.file?.type?.startsWith('image/') && a.status === 'ready'
                        );
                        if (imageAttachment?.uploaded?.url) {
                          imageUrl = imageAttachment.uploaded.url;
                          console.log('[create_stripe_product] Using attached image:', imageUrl);
                        }
                      }

                      // Create product via API
                      const productRes = await authFetch('/api/billing?op=create-product', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          accountId: stripeAccountId,
                          name: productName,
                          description: description || undefined,
                          price: price, // API expects dollars, converts to cents
                          currency,
                          images: imageUrl ? [imageUrl] : undefined,
                        })
                      });

                      if (!productRes.ok) {
                        const errData = await productRes.json().catch(() => ({}));
                        throw new Error(errData.error || 'Failed to create product');
                      }

                      const productData = await productRes.json();

                      // Create payment link
                      let paymentLinkUrl = '';
                      try {
                        const linkRes = await authFetch('/api/billing?op=create-payment-link', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            accountId: stripeAccountId,
                            priceId: productData.priceId,
                            quantity: 1,
                          })
                        });

                        if (linkRes.ok) {
                          const linkData = await linkRes.json();
                          paymentLinkUrl = linkData.url || '';
                        }
                      } catch (linkErr) {
                        console.warn('[create_stripe_product] Payment link creation failed:', linkErr);
                      }

                      // Save product to project
                      const newProduct = {
                        id: productData.id,
                        name: productData.name,
                        description: productData.description || undefined,
                        priceId: productData.priceId,
                        active: true,
                        unitAmount: productData.unitAmount,
                        currency: productData.currency,
                        createdAt: Date.now(),
                        images: productData.images || (imageUrl ? [imageUrl] : []),
                        paymentLinkUrl,
                      };

                      const updatedProducts = [...(project.stripeProducts || []), newProduct];
                      await storageService.updateResearchProject(project.id, { stripeProducts: updatedProducts });

                      // Update project state
                      const updatedProject = { ...project, stripeProducts: updatedProducts };
                      onProjectUpdate?.(updatedProject);

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          productId: productData.id,
                          productName: productData.name,
                          price: `$${(productData.unitAmount / 100).toFixed(2)} ${productData.currency.toUpperCase()}`,
                          paymentLinkUrl: paymentLinkUrl || 'Available in Products tab',
                          savedToAssets: true
                        }
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) }
                      });
                    }
                  } else if (fc.name === 'generate_world') {
                    // ========== World Generation Handler (Chat Mode) ==========
                    try {
                      const prompt = String(args.prompt || '').trim();
                      const inputType = String(args.inputType || 'text').toLowerCase() as 'text' | 'image' | 'video';
                      let imageUrl = String(args.imageUrl || '').trim();
                      let videoUrl = String(args.videoUrl || '').trim();
                      const assetName = String(args.assetName || '').trim();
                      const useLastGenerated = Boolean(args.useLastGenerated);

                      if (!prompt) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { success: false, error: 'Please describe the world you want to create.' }
                        });
                        continue;
                      }

                      // Credit Check
                      const hasCredits = await checkCredits('worldGeneration');
                      if (!hasCredits) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { success: false, error: 'Insufficient credits', cancelled: true }
                        });
                        continue;
                      }

                      const success = await deductCredits('worldGeneration');
                      if (!success) throw new Error('Failed to deduct credits');

                      // Resolve media URL from various sources
                      let mediaUrl = inputType === 'video' ? videoUrl : imageUrl;

                      if (!mediaUrl && useLastGenerated && lastGeneratedAsset) {
                        mediaUrl = typeof lastGeneratedAsset === 'string' ? lastGeneratedAsset : (lastGeneratedAsset.publicUrl || lastGeneratedAsset.url);
                        console.log('[generate_world] Using last generated asset:', mediaUrl);
                      }

                      if (!mediaUrl && assetName) {
                        const kb = projectRef.current.knowledgeBase || [];
                        const isVideo = inputType === 'video';
                        const match = kb.find((f: KnowledgeBaseFile) => {
                          const typeMatch = isVideo ? f.type?.startsWith('video/') : f.type?.startsWith('image/');
                          return typeMatch && f.name?.toLowerCase().includes(assetName.toLowerCase());
                        });
                        if (match) {
                          mediaUrl = match.url;
                          console.log('[generate_world] Found asset by name:', assetName, '->', match.name);
                        }
                      }

                      // Check conversation media
                      if (!mediaUrl && currentConversationMedia.length > 0) {
                        const targetType = inputType === 'video' ? 'video' : 'image';
                        const media = currentConversationMedia.find(m => m.type === targetType);
                        if (media) {
                          mediaUrl = media.publicUrl || media.url;
                          console.log('[generate_world] Using conversation media:', mediaUrl);
                        }
                      }

                      // Check attachments
                      if (!mediaUrl && pendingAttachments.length > 0) {
                        const isVideo = inputType === 'video';
                        const attachment = pendingAttachments.find(a => {
                          const mimeType = a.file?.type || a.uploaded?.mimeType || '';
                          return isVideo ? mimeType.startsWith('video/') : mimeType.startsWith('image/');
                        });
                        if (attachment?.uploaded?.url) {
                          mediaUrl = attachment.uploaded.url;
                          console.log('[generate_world] Using attached media:', mediaUrl);
                        }
                      }

                      // Validate media for non-text types
                      if ((inputType === 'image' || inputType === 'video') && !mediaUrl) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { success: false, error: `Please provide ${inputType === 'video' ? 'a video' : 'an image'} to use as a structure guide, or specify inputType: "text" for text-only generation.` }
                        });
                        continue;
                      }

                      // Build request
                      const request: WorldGenerationRequest = {
                        world_prompt: {
                          type: inputType,
                          text_prompt: prompt,
                        }
                      };

                      if (inputType === 'image' && mediaUrl) {
                        request.world_prompt.image_prompt = { source: 'uri', uri: mediaUrl };
                      } else if (inputType === 'video' && mediaUrl) {
                        request.world_prompt.video_prompt = { source: 'uri', uri: mediaUrl };
                      }

                      // Start generation
                      const operation = await worldLabsService.generateWorld(request);

                      // Save to project with 'generating' status
                      const newWorld = {
                        id: operation.operation_id,
                        prompt,
                        status: 'generating' as const,
                        createdAt: Date.now(),
                        previewUrl: '',
                        data: { operation_id: operation.operation_id }
                      };
                      const updatedWorlds = [newWorld, ...(projectRef.current.worlds || [])];
                      await storageService.updateResearchProject(projectRef.current.id, { worlds: updatedWorlds });
                      onProjectUpdate?.({ ...projectRef.current, worlds: updatedWorlds });

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          message: 'World generation started! It will appear in Assets → Worlds when ready (~5 minutes).',
                          operationId: operation.operation_id,
                          prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
                          inputType,
                          hasMediaGuide: !!mediaUrl
                        }
                      });
                    } catch (e: any) {
                      console.error('generate_world error:', e);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) }
                      });
                    }
                  } else if (fc.name === 'generate_project_website') {
                    const prompt = String(args.prompt || '').trim();
                    try {
                      if (!prompt) throw new Error('Website prompt is required');

                      // Credit Check
                      const hasCredits = await checkCredits('websiteGeneration');
                      if (!hasCredits) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { success: false, error: 'Insufficient credits', cancelled: true }
                        });
                        continue;
                      }

                      const success = await deductCredits('websiteGeneration');
                      if (!success) throw new Error('Failed to deduct credits');

                      // Build website specification
                      const recentResearch = (projectRef.current.researchSessions || []).slice(-3).map(session => {
                        const summary = session.researchReport?.summary || '';
                        const keyPoints = (session.researchReport?.keyPoints || []).slice(0, 3).map(kp => `• ${kp.title}: ${kp.details}`).join('\\n');
                        return `Session: ${session.topic}\\nSummary: ${summary}\\n${keyPoints}`;
                      }).join('\\n\\n');

                      const uploads = (projectRef.current.uploadedFiles || []).slice(-4).map(file => `• ${file.displayName || file.name}`).join('\\n');
                      const notes = (projectRef.current.notes || []).slice(0, 4).map(note => `• ${note.title}`).join('\\n');
                      const tasks = (projectRef.current.tasks || []).filter(t => t.status !== 'done').slice(0, 4).map(task => `• ${task.title}`).join('\\n');

                      const specification = `PROJECT WEBSITE BRIEF\\nProject: ${projectRef.current.name}\\nMission: ${projectRef.current.description}\\nUser Goal: ${prompt}\\n\\nResearch Signals:\\n${recentResearch || 'No research sessions yet.'}\\n\\nActive Tasks:\\n${tasks || 'No open tasks logged.'}\\n\\nPinned Notes:\\n${notes || 'No pinned notes available.'}\\n\\nUploaded Files of Interest:\\n${uploads || 'No uploaded files referenced.'}\\n\\nRequirements:\\n- Modern, responsive layout with bold storytelling.\\n- Highlight key research insights and calls-to-action derived from context above.\\n- Include sections for hero, highlights, proof, and actionable next steps.`;

                      const ctx = contextService.buildProjectContext(projectRef.current);
                      const context = ctx.fullContext;

                      const projectTheme: DualTheme = (projectRef.current as any).theme || {
                        light: { primary: '#0071e3', secondary: '#5e5ce6', background: '#ffffff', surface: '#f5f5f7', text: '#1d1d1f' },
                        dark: { primary: '#0a84ff', secondary: '#bf5af2', background: '#000000', surface: '#1d1d1f', text: '#f5f5f7' }
                      };

                      const finalHtml = await refineWebsiteCode(specification, context, projectTheme, () => { }, () => { });

                      const newWebsiteVersion = {
                        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `website-${Date.now()}`,
                        timestamp: Date.now(),
                        html: finalHtml,
                        description: prompt.substring(0, 60) || 'Project website'
                      };

                      const latestSession = (projectRef.current.researchSessions || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
                      if (latestSession) {
                        const updatedVersions = [newWebsiteVersion, ...(latestSession.websiteVersions || [])];
                        await storageService.updateResearchInProject(projectRef.current.id, latestSession.id, { websiteVersions: updatedVersions });
                      }

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          websiteId: newWebsiteVersion.id,
                          description: newWebsiteVersion.description,
                          saved: latestSession ? 'Saved to latest research session' : 'Saved locally',
                        },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'refine_website_code') {
                    const instruction = String(args.instruction || '').trim();
                    try {
                      if (!instruction) throw new Error('Instruction is required to refine the website');

                      // Find the latest website version
                      let latestSession = (projectRef.current.researchSessions || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
                      let latestWebsiteVersion: SavedWebsiteVersion | null = null;

                      if (latestSession && latestSession.websiteVersions && latestSession.websiteVersions.length > 0) {
                        latestWebsiteVersion = [...latestSession.websiteVersions].sort((a, b) => b.timestamp - a.timestamp)[0];
                      }

                      if (!latestWebsiteVersion) {
                        // Search all sessions
                        for (const session of projectRef.current.researchSessions || []) {
                          if (session.websiteVersions && session.websiteVersions.length > 0) {
                            const sessionLatest = [...session.websiteVersions].sort((a, b) => b.timestamp - a.timestamp)[0];
                            if (!latestWebsiteVersion || sessionLatest.timestamp > latestWebsiteVersion.timestamp) {
                              latestWebsiteVersion = sessionLatest;
                              latestSession = session;
                            }
                          }
                        }
                      }

                      if (!latestWebsiteVersion || !latestSession) {
                        throw new Error('No existing website found to edit. Use generate_project_website first.');
                      }

                      // Credit Check
                      const hasCredits = await checkCredits('websiteEdit');
                      if (!hasCredits) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { success: false, error: 'Insufficient credits', cancelled: true }
                        });
                        continue;
                      }

                      const success = await deductCredits('websiteEdit');
                      if (!success) throw new Error('Failed to deduct credits');

                      const { editWebsiteWithAI } = await import('../services/geminiService');

                      const result = await editWebsiteWithAI(
                        latestWebsiteVersion.html,
                        instruction,
                        contextService.buildProjectContext(projectRef.current).fullContext
                      );

                      const newWebsiteVersion = {
                        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `website-${Date.now()}`,
                        timestamp: Date.now(),
                        html: result.newHtml,
                        description: `Edit: ${instruction.substring(0, 40)}`
                      };

                      const updatedVersions = [newWebsiteVersion, ...(latestSession.websiteVersions || [])];
                      await storageService.updateResearchInProject(projectRef.current.id, latestSession.id, { websiteVersions: updatedVersions });

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          websiteId: newWebsiteVersion.id,
                          summary: result.summary,
                          message: 'Website updated successfully and saved to research session'
                        },
                      });
                    } catch (e: any) {
                      console.error('Website edit failed', e);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'convert_website_to_pdf') {
                    const websiteId = String(args.websiteId || '').trim();
                    try {
                      if (!websiteId) throw new Error('Website ID is required');

                      let websiteHtml: string | null = null;
                      let websiteDescription = '';

                      for (const session of (projectRef.current.researchSessions || [])) {
                        const found = (session.websiteVersions || []).find(v => v.id === websiteId);
                        if (found) {
                          websiteHtml = found.html;
                          websiteDescription = found.description;
                          break;
                        }
                      }

                      if (!websiteHtml) throw new Error(`Website with ID ${websiteId} not found`);

                      const secret = process.env.NEXT_PUBLIC_CONVERTAPI_SECRET;
                      if (!secret) throw new Error('ConvertAPI secret not configured');

                      // Create form data with HTML content
                      const formData = new FormData();
                      formData.append('File', new Blob([websiteHtml], { type: 'text/html' }), 'website.html');
                      formData.append('PageSize', 'letter');
                      formData.append('ViewportWidth', '1920');
                      formData.append('ViewportHeight', '1080');
                      formData.append('MarginTop', '0');
                      formData.append('MarginBottom', '0');
                      formData.append('MarginLeft', '0');
                      formData.append('MarginRight', '0');
                      formData.append('ConversionDelay', '7');
                      formData.append('JavaScript', 'true');
                      formData.append('LoadLazyContent', 'true');
                      formData.append('Background', 'true');
                      formData.append('Scale', '100');

                      // Call ConvertAPI REST endpoint with download=attachment
                      const apiResponse = await fetch(`https://v2.convertapi.com/convert/html/to/pdf?Secret=${secret}&download=attachment`, {
                        method: 'POST',
                        body: formData
                      });

                      if (!apiResponse.ok) throw new Error(`ConvertAPI error: ${apiResponse.statusText}`);

                      const pdfBlob = await apiResponse.blob();

                      const fileName = `website-${websiteDescription.substring(0, 30).replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.pdf`;
                      const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
                      const kb = await storageService.uploadKnowledgeBaseFile(projectRef.current.id, pdfFile);

                      const existingKb = projectRef.current.knowledgeBase || [];
                      const updatedKnowledgeBase = [...existingKb, kb];
                      await storageService.updateResearchProject(projectRef.current.id, { knowledgeBase: updatedKnowledgeBase });
                      const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                      onProjectUpdate?.(updatedProject);
                      projectRef.current = updatedProject;

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          pdfUrl: kb.url,
                          fileName: kb.name,
                          message: 'PDF created and saved to project assets',
                        },
                      });
                    } catch (e: any) {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: false, error: String(e?.message || e) },
                      });
                    }
                  } else if (fc.name === 'run_project_seo_analysis') {
                    const keyword = String(args.keyword || args.prompt || '').trim() || project.name || 'SEO';
                    const location = String(args.location || 'US').trim() || 'US';

                    try {
                      if (!onRunSeoAnalysis) {
                        throw new Error('SEO automation is not available in this view.');
                      }

                      const result = await onRunSeoAnalysis({ keyword, location });
                      const returnedError = (result as any)?.error ? String((result as any).error) : '';
                      if (returnedError) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: {
                            success: false,
                            error: returnedError,
                            keyword: result.keyword || keyword,
                            location: result.location || location,
                          }
                        });
                        continue;
                      }
                      const advice = (result?.advice || '').trim() || null;
                      const topKeywords = extractSeoTopKeywords(result?.seoData);

                      if (advice) {
                        const contentLines: string[] = [];
                        contentLines.push(`Keyword: ${result.keyword}`);
                        contentLines.push(`Location: ${result.location}`);
                        contentLines.push('');
                        contentLines.push(advice);
                        if (topKeywords.length > 0) {
                          contentLines.push('');
                          contentLines.push('Top keywords:');
                          topKeywords.forEach(row => {
                            const vol = typeof row.volume === 'number' ? row.volume : '-';
                            contentLines.push(`- ${row.keyword} (volume: ${vol}, competition: ${row.competition ?? '-'})`);
                          });
                        }

                        await storageService.addNote(project.id, {
                          title: `SEO: ${result.keyword} (${result.location})`,
                          content: contentLines.join('\n'),
                          color: 'green',
                          aiGenerated: true,
                        });
                      }

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          keyword: result.keyword,
                          location: result.location,
                          advice,
                          topKeywords,
                        }
                      });
                    } catch (seoError: any) {
                      console.error('Live SEO tool error:', seoError);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: seoError?.message || 'Failed to run SEO analysis',
                          keyword,
                          location,
                        }
                      });
                    }
                  } else if (fc.name === 'get_connected_accounts') {
                    // Return connected social accounts for the user to choose from
                    const requestedPlatform = String(args.platform || 'all').toLowerCase();

                    const currentSocialState = socialStateRef.current;
                    const accounts: any = {
                      facebook: {
                        connected: currentSocialState.facebookConnected,
                        pages: fbPages?.map((p: any) => ({
                          id: p.id,
                          name: p.name,
                          picture: p.picture?.data?.url
                        })) || []
                      },
                      instagram: {
                        connected: currentSocialState.facebookConnected && currentSocialState.igAccounts.length > 0,
                        accounts: currentSocialState.igAccounts?.map((a: any) => ({
                          id: a.id,
                          username: a.username || a.name,
                          picture: a.profile_picture_url
                        })) || []
                      },
                      x: { connected: currentSocialState.xConnected },
                      tiktok: { connected: currentSocialState.tiktokConnected },
                      youtube: { connected: currentSocialState.youtubeConnected },
                      linkedin: { connected: currentSocialState.linkedinConnected }
                    };

                    let responseText = '';
                    if (requestedPlatform === 'facebook' || requestedPlatform === 'all') {
                      if (accounts.facebook.connected && accounts.facebook.pages.length > 0) {
                        responseText += `Facebook Pages: ${accounts.facebook.pages.map((p: any) => p.name).join(', ')}. `;
                      } else if (!accounts.facebook.connected) {
                        responseText += `Facebook is not connected. `;
                      } else {
                        responseText += `Facebook is connected but no pages found. `;
                      }
                    }
                    if (requestedPlatform === 'instagram' || requestedPlatform === 'all') {
                      if (accounts.instagram.connected && accounts.instagram.accounts.length > 0) {
                        responseText += `Instagram accounts: ${accounts.instagram.accounts.map((a: any) => '@' + a.username).join(', ')}. `;
                      } else if (!accounts.instagram.connected) {
                        responseText += `Instagram is not connected. `;
                      }
                    }
                    if (requestedPlatform === 'all') {
                      responseText += `X: ${accounts.x.connected ? 'connected' : 'not connected'}. `;
                      responseText += `TikTok: ${accounts.tiktok.connected ? 'connected' : 'not connected'}. `;
                      responseText += `YouTube: ${accounts.youtube.connected ? 'connected' : 'not connected'}. `;
                      responseText += `LinkedIn: ${accounts.linkedin.connected ? 'connected' : 'not connected'}. `;
                    }

                    functionResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: {
                        success: true,
                        accounts,
                        summary: responseText.trim()
                      }
                    });
                  } else if (fc.name === 'post_to_social') {
                    // Social media posting handler - UNIFIED with Chat Mode
                    // Support both 'platforms' array and single 'platform' for backwards compatibility
                    let targetPlatforms: SocialPlatform[] = [];
                    if (args.platforms && Array.isArray(args.platforms)) {
                      targetPlatforms = args.platforms.map((p: any) => String(p).toLowerCase() as SocialPlatform);
                    } else if (args.platform) {
                      targetPlatforms = [String(args.platform).toLowerCase() as SocialPlatform];
                    }

                    let contentType = String(args.contentType || 'text').toLowerCase() as 'text' | 'image' | 'video';
                    const text = String(args.text || '').trim();
                    const mediaUrl = String(args.mediaUrl || '').trim();
                    const assetId = String(args.assetId || '').trim();
                    const assetName = String(args.assetName || '').trim();
                    const useLastGenerated = Boolean(args.useLastGenerated);
                    const pageId = String(args.pageId || '').trim();
                    const igAccountId = String(args.igAccountId || '').trim();
                    const privacyLevel = String(args.privacyLevel || '').trim();

                    try {
                      const validPlatforms: SocialPlatform[] = ['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'linkedin'];
                      const invalidPlatforms = targetPlatforms.filter(p => !validPlatforms.includes(p));
                      if (invalidPlatforms.length > 0) {
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: `Invalid platform(s): ${invalidPlatforms.join(', ')}` } });
                        continue;
                      }

                      if (targetPlatforms.length === 0) {
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'No platforms specified' } });
                        continue;
                      }

                      // Check which platforms need auth
                      const currentSocialState = socialStateRef.current;
                      const needsAuthPlatforms = targetPlatforms.filter(p => {
                        switch (p) {
                          case 'facebook': return !currentSocialState.facebookConnected;
                          case 'instagram': return !currentSocialState.facebookConnected || currentSocialState.igAccounts.length === 0;
                          case 'x': return !currentSocialState.xConnected;
                          case 'tiktok': return !currentSocialState.tiktokConnected;
                          case 'youtube': return !currentSocialState.youtubeConnected;
                          case 'linkedin': return !currentSocialState.linkedinConnected;
                          default: return true;
                        }
                      });

                      if (needsAuthPlatforms.length > 0) {
                        setPendingAuthPlatforms(needsAuthPlatforms);
                        functionResponses.push({
                          id: fc.id, name: fc.name,
                          response: { success: false, needsAuth: true, platforms: needsAuthPlatforms, message: `Please connect: ${needsAuthPlatforms.join(', ')}` }
                        });
                        continue;
                      }

                      // Resolve media URL
                      let resolvedMediaUrl = mediaUrl;
                      let resolvedContentType = contentType;

                      // Check asset ID
                      if (!resolvedMediaUrl && assetId && contentType !== 'text') {
                        const kb = project.knowledgeBase || [];
                        const asset = kb.find(k => k.id === assetId);
                        if (asset?.url) resolvedMediaUrl = asset.url;
                      }

                      // Check asset name (fuzzy match)
                      if (!resolvedMediaUrl && assetName && contentType !== 'text') {
                        const kb = project.knowledgeBase || [];
                        const searchTerm = assetName.toLowerCase();
                        const mediaAssets = kb.filter(k => k.url && (k.type?.startsWith('image') || k.type?.startsWith('video')));
                        const matchedAsset = mediaAssets.find(k => {
                          const name = (k.name || '').toLowerCase();
                          return name.includes(searchTerm) || searchTerm.includes(name);
                        });
                        if (matchedAsset?.url) {
                          resolvedMediaUrl = matchedAsset.url;
                          resolvedContentType = matchedAsset.type?.startsWith('video') ? 'video' : 'image';
                        }
                      }

                      // Check useLastGenerated
                      if (!resolvedMediaUrl && useLastGenerated && lastGeneratedAsset) {
                        resolvedMediaUrl = lastGeneratedAsset.publicUrl || lastGeneratedAsset.url;
                        resolvedContentType = lastGeneratedAsset.type;
                      }

                      // Check recent messages for imageUrl
                      if (!resolvedMediaUrl && contentType !== 'text') {
                        const recentModelMessages = messages.filter(m => m.role === 'model').slice(-5);
                        for (const msg of recentModelMessages.reverse()) {
                          if (msg.imageUrl) {
                            resolvedMediaUrl = msg.imageUrl;
                            resolvedContentType = 'image';
                            break;
                          }
                        }
                      }

                      // Check attached files
                      if (!resolvedMediaUrl && contentType !== 'text' && readyAttachments.length > 0) {
                        const att = readyAttachments.find(a => a.uploaded?.mimeType?.startsWith('image/') || a.uploaded?.mimeType?.startsWith('video/'));
                        if (att?.uploaded) {
                          resolvedMediaUrl = (att.uploaded as any).publicUrl || att.uploaded.uri;
                          resolvedContentType = att.uploaded.mimeType?.startsWith('video/') ? 'video' : 'image';
                        }
                      }

                      // Validate media for non-text posts
                      if (contentType !== 'text' && !resolvedMediaUrl) {
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'I need an image or video to post' } });
                        continue;
                      }

                      // Post to each platform
                      const results: { platform: string; success: boolean; postId?: string; error?: string }[] = [];

                      for (const platform of targetPlatforms) {
                        if (platform === 'youtube' && resolvedContentType !== 'video') {
                          results.push({ platform, success: false, error: 'YouTube only supports video' });
                          continue;
                        }

                        try {
                          const result = await postToSocialPlatform(platform, resolvedContentType || contentType, text, resolvedMediaUrl || undefined, privacyLevel || undefined);
                          if (result.success) {
                            results.push({ platform, success: true, postId: result.postId });
                          } else {
                            results.push({ platform, success: false, error: result.error || 'Failed' });
                          }
                        } catch (err: any) {
                          results.push({ platform, success: false, error: err.message });
                        }
                      }

                      const successCount = results.filter(r => r.success).length;
                      const failedCount = results.filter(r => !r.success).length;

                      functionResponses.push({
                        id: fc.id, name: fc.name,
                        response: {
                          success: successCount > 0,
                          results,
                          message: successCount > 0
                            ? `Posted to ${results.filter(r => r.success).map(r => r.platform.toUpperCase()).join(', ')}`
                            : `Failed to post: ${results.map(r => r.error).join(', ')}`
                        }
                      });
                    } catch (postError: any) {
                      console.error('post_to_social error:', postError);
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: postError.message } });
                    }
                  } else if (fc.name === 'schedule_post') {
                    // Schedule post handler for voice mode
                    const platforms = Array.isArray(args.platforms) ? args.platforms.map((p: any) => String(p).toLowerCase()) : [];
                    const scheduledAt = String(args.scheduledAt || '').trim();
                    let contentType = String(args.contentType || 'text').toLowerCase();
                    const text = String(args.text || '').trim();
                    let mediaUrl = String(args.mediaUrl || '').trim();
                    const assetId = String(args.assetId || '').trim();
                    const assetName = String(args.assetName || '').trim();
                    const useLastGenerated = Boolean(args.useLastGenerated);

                    try {
                      if (platforms.length === 0) {
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'At least one platform is required' } });
                        continue;
                      }

                      // Check actual connection status (using REF in voice mode contexts is critical)
                      const currentSocialState = socialStateRef.current;
                      const needsAuth: SocialPlatform[] = [];
                      if (platforms.includes('facebook') && !currentSocialState.facebookConnected) needsAuth.push('facebook');
                      if (platforms.includes('instagram') && (!currentSocialState.facebookConnected || currentSocialState.igAccounts.length === 0)) needsAuth.push('instagram');
                      if (platforms.includes('x') && !currentSocialState.xConnected) needsAuth.push('x');
                      if (platforms.includes('tiktok') && !currentSocialState.tiktokConnected) needsAuth.push('tiktok');
                      if (platforms.includes('youtube') && !currentSocialState.youtubeConnected) needsAuth.push('youtube');
                      if (platforms.includes('linkedin') && !currentSocialState.linkedinConnected) needsAuth.push('linkedin');

                      if (needsAuth.length > 0) {
                        // Start Voice Sequential Auth Queue
                        voiceAuthQueueRef.current = {
                          originalArgs: args,
                          remainingPlatforms: [...needsAuth],
                          currentTarget: null
                        };

                        // Pick first one
                        const first = voiceAuthQueueRef.current.remainingPlatforms.shift();
                        if (first) {
                          voiceAuthQueueRef.current.currentTarget = first;
                          setPendingAuthPlatforms([first]);

                          functionResponses.push({
                            id: fc.id,
                            name: fc.name,
                            response: {
                              success: false, // Techincally false until done, but we are guiding flow
                              needsAuth: true,
                              message: `To schedule this post, please connect your ${first} account now.`
                            }
                          });
                        }
                        continue;
                      }

                      // 🧠 INTELLIGENT MEDIA TARGETING for scheduling (same logic as post_to_social)
                      // Only invoke if we have conversation media and no explicit mediaUrl was provided
                      if (!mediaUrl && !assetId && !assetName && currentConversationMedia.length > 0 && contentType !== 'text') {
                        try {
                          console.log('[schedule_post voice] 🧠 Invoking analyzeMediaIntent with', currentConversationMedia.length, 'tracked media items');
                          const mediaAnalysis = await analyzeMediaIntent(
                            text || 'schedule this post',
                            currentConversationMedia,
                            messages.slice(-10).map(m => ({ role: m.role, text: m.text || '', imageUrl: m.imageUrl }))
                          );
                          console.log('[schedule_post voice] 🧠 AI Media Analysis:', mediaAnalysis);

                          if (mediaAnalysis.targetMediaUrl && mediaAnalysis.confidence !== 'low') {
                            mediaUrl = mediaAnalysis.targetMediaUrl;
                            contentType = mediaAnalysis.targetMediaType || 'image';
                            console.log('[schedule_post voice] 🎯 AI selected media:', mediaUrl);
                          } else if (mediaAnalysis.confidence === 'low' && currentConversationMedia.length > 1) {
                            const mediaList = currentConversationMedia.slice(0, 5).map((m, i) => `${i + 1}. ${m.name} (${m.type})`).join('\n');
                            functionResponses.push({
                              id: fc.id, name: fc.name,
                              response: { success: false, error: `I'm not sure which media to schedule. Please specify:\n${mediaList}` }
                            });
                            continue;
                          }
                        } catch (aiError) {
                          console.error('[schedule_post voice] analyzeMediaIntent failed:', aiError);
                        }
                      }

                      // --- HEURISTIC FALLBACK (if AI analysis didn't resolve media) ---
                      // Media Resolution Logic (enhanced with assetName and useLastGenerated)
                      const referenceWords = ['this', 'that', 'it', 'the image', 'the video', 'the file', 'my image', 'my video', 'the attachment', 'attached', 'uploaded'];
                      const lowerText = text.toLowerCase().trim();
                      const isTextReferenceToMedia = referenceWords.some(w => lowerText === w || lowerText.includes(w));

                      let resolvedMediaUrl = mediaUrl;
                      let resolvedContentType = contentType;

                      // 1. Check assetName (fuzzy match like post_to_social)
                      if (!resolvedMediaUrl && assetName && contentType !== 'text') {
                        const kb = project.knowledgeBase || [];
                        const searchTerm = assetName.toLowerCase();
                        const mediaAssets = kb.filter(k =>
                          k.url && (k.type?.startsWith('image') || k.type?.startsWith('video'))
                        );
                        const matchedAsset = mediaAssets.find(k => {
                          const name = (k.name || '').toLowerCase();
                          return name.includes(searchTerm) || searchTerm.includes(name) ||
                            name.split(/[\s\-_]+/).some(word => searchTerm.includes(word));
                        });
                        if (matchedAsset?.url) {
                          resolvedMediaUrl = matchedAsset.url;
                          const isVideo = matchedAsset.type?.startsWith('video');
                          resolvedContentType = isVideo ? 'video' : 'image';
                          console.log('[schedule_post voice] Found asset by name:', assetName, '->', matchedAsset.name);
                        }
                      }

                      // 2. Check assetId
                      if (!resolvedMediaUrl && assetId && contentType !== 'text') {
                        const kb = project.knowledgeBase || [];
                        const asset = kb.find(k => k.id === assetId);
                        if (asset?.url) resolvedMediaUrl = asset.url;
                      }

                      // 3. Check useLastGenerated
                      if (!resolvedMediaUrl && useLastGenerated && lastGeneratedAsset) {
                        resolvedMediaUrl = lastGeneratedAsset.publicUrl || lastGeneratedAsset.url;
                        resolvedContentType = lastGeneratedAsset.type;
                        console.log('[schedule_post voice] Using last generated asset:', lastGeneratedAsset);
                      }

                      // 4. Check readyAttachments for media references
                      if (!resolvedMediaUrl && (contentType !== 'text' || isTextReferenceToMedia) && readyAttachments.length > 0) {
                        const imageOrVideoAtt = readyAttachments.find(a =>
                          a.uploaded?.mimeType?.startsWith('image/') || a.uploaded?.mimeType?.startsWith('video/')
                        );
                        if (imageOrVideoAtt?.uploaded?.uri) {
                          resolvedMediaUrl = (imageOrVideoAtt.uploaded as any).publicUrl || imageOrVideoAtt.uploaded.uri;
                          resolvedContentType = imageOrVideoAtt.uploaded.mimeType?.startsWith('video/') ? 'video' : 'image';
                          console.log('[schedule_post voice] Using attached file:', resolvedMediaUrl);
                        }
                      }

                      // 5. Fallback: check lastGeneratedAsset for text references to media
                      if (!resolvedMediaUrl && isTextReferenceToMedia && lastGeneratedAsset) {
                        resolvedMediaUrl = lastGeneratedAsset.publicUrl || lastGeneratedAsset.url;
                        resolvedContentType = lastGeneratedAsset.type;
                        console.log('[schedule_post voice] Using last generated asset for text reference');
                      }

                      // Validate we have media for non-text posts
                      if (contentType !== 'text' && !resolvedMediaUrl) {
                        throw new Error('I need an image or video to schedule. Please generate one first, attach a file, or specify an asset to use.');
                      }

                      // Update args for executeSchedulePost
                      const effectiveArgs = {
                        ...args,
                        mediaUrl: resolvedMediaUrl,
                        contentType: resolvedContentType,
                        text: isTextReferenceToMedia && resolvedMediaUrl ? '' : text
                      };

                      // Use unified scheduling helper
                      await executeSchedulePost(
                        effectiveArgs,
                        (role, text) => {
                          addMessage(role, text);
                        },
                        (postId) => {
                          functionResponses.push({ id: fc.id, name: fc.name, response: { success: true, postId } });
                        }
                      );
                    } catch (e: any) {
                      console.error('Voice Schedule failed', e);
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: e.message } });
                    }
                  } else if (fc.name === 'get_project_research_sessions') {
                    // Return summary of all research sessions
                    try {
                      const sessions = project.researchSessions || [];
                      const includeFull = Boolean(args.includeFull);
                      if (includeFull) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: {
                            success: true,
                            sessions: sessions.map((s, i) => ({
                              index: i + 1,
                              topic: s.topic,
                              completedAt: s.timestamp,
                              summary: s.researchReport?.summary?.slice(0, 500) || '',
                              keyPointsCount: s.researchReport?.keyPoints?.length || 0,
                              sourcesCount: s.researchReport?.sources?.length || 0,
                            })),
                          },
                        });
                      } else {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: {
                            success: true,
                            count: sessions.length,
                            topics: sessions.map((s, i) => `${i + 1}. ${s.topic}`).join('\n'),
                          },
                        });
                      }
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: e.message } });
                    }
                  } else if (fc.name === 'get_research_session_details') {
                    // Return full details for a specific research session
                    try {
                      const sessions = project.researchSessions || [];
                      const topic = String(args.topic || '').toLowerCase().trim();
                      const index = typeof args.index === 'number' ? args.index - 1 : -1;
                      let session = null;
                      if (index >= 0 && index < sessions.length) {
                        session = sessions[index];
                      } else if (topic) {
                        session = sessions.find(s => s.topic.toLowerCase().includes(topic));
                      }
                      if (session) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: {
                            success: true,
                            topic: session.topic,
                            completedAt: session.timestamp,
                            summary: session.researchReport?.summary || '',
                            keyPoints: session.researchReport?.keyPoints || [],
                            sources: (session.researchReport?.sources || []).slice(0, 10),
                          },
                        });
                      } else {
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'Session not found' } });
                      }
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: e.message } });
                    }
                  } else if (fc.name === 'get_project_overview') {
                    // Return project overview
                    try {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: true,
                          name: project.name,
                          description: project.description || '',
                          createdAt: project.createdAt,
                          researchSessionsCount: (project.researchSessions || []).length,
                          tasksCount: (project.tasks || []).length,
                          notesCount: (project.notes || []).length,
                          filesCount: (project.knowledgeBase || []).length,
                        },
                      });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: e.message } });
                    }
                  } else if (fc.name === 'get_project_file') {
                    // Find and return info about a specific file
                    try {
                      const fileName = String(args.fileName || '').toLowerCase().trim();
                      const kb = project.knowledgeBase || [];
                      const file = kb.find(f => (f.name || '').toLowerCase().includes(fileName));
                      if (file) {
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: {
                            success: true,
                            name: file.name,
                            type: file.type || 'unknown',
                            url: file.url || '',
                            summary: file.summary || '',
                            uploadedAt: file.uploadedAt,
                          },
                        });
                      } else {
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: `File "${args.fileName}" not found` } });
                      }
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: e.message } });
                    }
                  } else if (fc.name === 'generate_project_book') {
                    // Placeholder for book generation (can be fully implemented later)
                    try {
                      const prompt = String(args.prompt || '').trim();
                      const pageCount = typeof args.pageCount === 'number' ? args.pageCount : 8;
                      addMessage('model', `📚 Generating a ${pageCount}-page book about: "${prompt}". This feature requires the Books tab to be open and will be available in a future update.`);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          success: false,
                          error: 'Book generation is not yet fully supported in voice mode. Please use the Books tab in the UI.',
                        },
                      });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: e.message } });
                    }
                  } else if (fc.name === 'send_email') {
                    // --- Send Email Handler ---
                    try {
                      const provider = String(args.provider || 'gmail').toLowerCase();
                      const to = String(args.to || '').trim();
                      const subject = String(args.subject || '').trim();
                      const body = String(args.body || '').trim();

                      if (!to) throw new Error('Recipient email is required');
                      if (!subject) throw new Error('Email subject is required');
                      if (!body) throw new Error('Email content is required');

                      addMessage('model', `📧 Sending email to ${to} via ${provider.charAt(0).toUpperCase() + provider.slice(1)}...`);

                      const response = await authFetch(`/api/email?op=send&provider=${provider}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          to,
                          subject,
                          html: body.includes('<') ? body : `<p>${body.replace(/\n/g, '<br/>')}</p>`
                        })
                      });

                      if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        if (response.status === 401 || errorData.error?.includes('token')) {
                          throw new Error(`${provider.charAt(0).toUpperCase() + provider.slice(1)} is not connected. Please connect in the Email tab first.`);
                        }
                        throw new Error(errorData.error || 'Failed to send email');
                      }

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true, message: `Email sent to ${to}`, subject }
                      });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: e.message } });
                    }
                  } else if (fc.name === 'schedule_email') {
                    // --- Schedule Email Handler ---
                    try {
                      const provider = String(args.provider || 'gmail').toLowerCase();
                      const to = String(args.to || '').trim();
                      const subject = String(args.subject || '').trim();
                      const body = String(args.body || '').trim();
                      const scheduledTimeStr = String(args.scheduledTime || '').trim();

                      if (!to) throw new Error('Recipient email is required');
                      if (!subject) throw new Error('Email subject is required');
                      if (!body) throw new Error('Email content is required');
                      if (!scheduledTimeStr) throw new Error('Scheduled time is required');

                      const parsedTime = parseScheduleDate(scheduledTimeStr);
                      if (!parsedTime) throw new Error(`Could not understand time "${scheduledTimeStr}"`);

                      const scheduledAtUnix = Math.floor(parsedTime / 1000);
                      const nowUnix = Math.floor(Date.now() / 1000);

                      if (scheduledAtUnix < nowUnix + 600) throw new Error('Scheduled time must be at least 10 minutes in the future');
                      if (scheduledAtUnix > nowUnix + 7 * 24 * 3600) throw new Error('Scheduled time cannot exceed 7 days');

                      const scheduledDate = new Date(scheduledAtUnix * 1000);
                      addMessage('model', `📅 Scheduling email for ${scheduledDate.toLocaleString()}...`);

                      const response = await authFetch('/api/email?op=email-schedule-create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          projectId: projectRef.current?.id,
                          scheduledAt: scheduledAtUnix,
                          provider,
                          to: to.includes(',') ? to.split(',').map(e => e.trim()) : to,
                          subject,
                          html: body.includes('<') ? body : `<p>${body.replace(/\n/g, '<br/>')}</p>`
                        })
                      });

                      if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || 'Failed to schedule email');
                      }

                      const result = await response.json();
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true, emailId: result.emailId, scheduledFor: scheduledDate.toISOString(), to, subject }
                      });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: e.message } });
                    }
                  } else if (fc.name === 'send_bulk_email') {
                    // --- Bulk Email Handler ---
                    try {
                      const provider = String(args.provider || 'gmail').toLowerCase();
                      const formId = args.formId ? String(args.formId) : null;
                      const subject = String(args.subject || '').trim();
                      const bodyTemplate = String(args.body || '').trim();

                      if (!subject) throw new Error('Email subject is required');
                      if (!bodyTemplate) throw new Error('Email content is required');

                      const leads = projectRef.current?.capturedLeads || [];
                      if (leads.length === 0) throw new Error('No captured leads found in this project');

                      const targetLeads = formId ? leads.filter((l: any) => l.formId === formId) : leads;
                      const leadsWithEmail = targetLeads.filter((l: any) => l.email);

                      if (leadsWithEmail.length === 0) throw new Error('No leads with email addresses found');

                      addMessage('model', `📧 Sending email to ${leadsWithEmail.length} leads via ${provider.charAt(0).toUpperCase() + provider.slice(1)}...`);

                      let successCount = 0;
                      let failCount = 0;

                      for (const lead of leadsWithEmail) {
                        try {
                          const personalizedBody = bodyTemplate.replace(/\{name\}/gi, lead.data?.name || lead.data?.fullName || 'there');
                          const htmlBody = personalizedBody.includes('<') ? personalizedBody : `<p>${personalizedBody.replace(/\n/g, '<br/>')}</p>`;

                          const response = await authFetch(`/api/email?op=send&provider=${provider}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ to: lead.data?.email, subject, html: htmlBody })
                          });

                          if (response.ok) successCount++;
                          else failCount++;
                        } catch { failCount++; }

                        await new Promise(resolve => setTimeout(resolve, 500));
                      }

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: successCount > 0, sent: successCount, failed: failCount, subject }
                      });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: e.message } });
                    }
                  } else if (fc.name === 'generate_pdf') {
                    // --- PDF Generation Handler ---
                    try {
                      const hasCredits = await checkCredits('bookGeneration');
                      if (!hasCredits) {
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'Insufficient credits for PDF generation' } });
                        continue;
                      }

                      const success = await deductCredits('bookGeneration');
                      if (!success) {
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'Failed to deduct credits' } });
                        continue;
                      }

                      const prompt = String(args.prompt || '').trim();
                      const pageCount = Math.max(4, Math.min(24, Number(args.pageCount) || 8));
                      const documentType = String(args.documentType || 'guide');

                      if (!prompt) throw new Error('PDF topic/prompt is required');

                      addMessage('model', `📄 Generating a ${pageCount}-page ${documentType} PDF about "${prompt}"...`);

                      const projectWithActivities = { ...project, activities };
                      const ctx = contextService.buildProjectContext(projectWithActivities);
                      const refinedPrompt = await refinePromptWithGemini3(
                        `Create a ${documentType} about: ${prompt}`,
                        ctx.fullContext,
                        'text'
                      );

                      const bookSpec = await generateBookFromProjectContext(
                        projectWithActivities,
                        refinedPrompt,
                        pageCount,
                        ctx.fullContext
                      );

                      if (!bookSpec.pages || !bookSpec.pages.length) {
                        throw new Error('No pages generated');
                      }

                      const latestSession = projectRef.current.researchSessions?.[projectRef.current.researchSessions.length - 1];
                      const sessionId = latestSession?.id;
                      const pdfId = `pdf-${Date.now()}`;

                      const existingKb = projectRef.current.knowledgeBase || [];
                      const newKbFiles: KnowledgeBaseFile[] = [];
                      const pages: { pageNumber: number; imageUrl: string }[] = [];

                      let previousImageBase64: string | null = null;

                      for (let i = 0; i < Math.min(bookSpec.pages.length, pageCount); i++) {
                        const page = bookSpec.pages[i];
                        const refs: ImageReference[] = previousImageBase64
                          ? [{ base64: previousImageBase64, mimeType: 'image/png' }]
                          : [];

                        const pagePrompt = `${bookSpec.title || documentType} page ${page.pageNumber}: ${page.imagePrompt || page.text || prompt}`;
                        const result = await generateImageWithReferences(pagePrompt, refs);

                        try {
                          const res = await fetch(result.imageDataUrl);
                          const blob = await res.blob();
                          const file = new File([blob], `${documentType}-${pdfId}-page-${page.pageNumber}.png`, { type: 'image/png' });
                          const kbFile = await storageService.uploadKnowledgeBaseFile(projectRef.current.id, file, sessionId);
                          newKbFiles.push(kbFile);

                          if (result.imageDataUrl.startsWith('data:')) {
                            previousImageBase64 = result.imageDataUrl.split(',')[1] || null;
                          }
                          pages.push({ pageNumber: page.pageNumber, imageUrl: kbFile.url });
                        } catch { }
                      }

                      if (pages.length === 0) throw new Error('Failed to generate pages');

                      // Compile PDF
                      const pdfDoc = await PDFDocument.create();
                      for (const page of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
                        try {
                          const res = await fetch(page.imageUrl);
                          const arrayBuffer = await (await res.blob()).arrayBuffer();
                          const image = await pdfDoc.embedPng(arrayBuffer).catch(() => pdfDoc.embedJpg(arrayBuffer));
                          const { width, height } = image.scale(1);
                          const pdfPage = pdfDoc.addPage([width, height]);
                          pdfPage.drawImage(image, { x: 0, y: 0, width, height });
                        } catch { }
                      }

                      const pdfBytes = await pdfDoc.save();
                      const pdfBlob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
                      const pdfFile = new File([pdfBlob], `${documentType}-${pdfId}.pdf`, { type: 'application/pdf' });
                      const pdfKbFile = await storageService.uploadKnowledgeBaseFile(projectRef.current.id, pdfFile, sessionId);
                      newKbFiles.push(pdfKbFile);

                      // Update project
                      const updatedKb = [...existingKb, ...newKbFiles];
                      await storageService.updateResearchProject(projectRef.current.id, { knowledgeBase: updatedKb, lastModified: Date.now() });
                      onProjectUpdate?.({ ...projectRef.current, knowledgeBase: updatedKb, lastModified: Date.now() });

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true, title: bookSpec.title, pages: pages.length, pdfUrl: pdfKbFile.url }
                      });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: e.message } });
                    }
                  } else if (fc.name === 'generate_form') {
                    try {
                      const title = String(args.title || 'Untitled Form');
                      const prompt = String(args.prompt || '');
                      const fields = Array.isArray(args.fields) ? args.fields : [];

                      const formId = `form-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://freshfront.co';

                      // Create placeholder
                      const placeholderRes = await authFetch('/api/websites?op=create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          html: '<html><body>Loading...</body></html>',
                          projectId: projectRef.current.id,
                          versionId: formId,
                          title: title,
                          formId: formId,
                          type: 'form'
                        })
                      });

                      if (!placeholderRes.ok) throw new Error('Failed to create form placeholder');
                      const { slug } = await placeholderRes.json();
                      const publicUrl = `${origin}/w/${slug}`;

                      // Generate
                      let generatedHtml = '';
                      const finalHtml = await streamLeadFormWebsite(
                        prompt,
                        fields,
                        formId,
                        slug,
                        projectRef.current.id,
                        title,
                        (chunk) => { generatedHtml += chunk; },
                        undefined,
                        []
                      );

                      // Update website
                      await authFetch('/api/websites?op=update', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          slug: slug,
                          html: finalHtml,
                          title: title,
                          formId: formId,
                          type: 'form'
                        })
                      });

                      // Save Asset
                      const newLeadForm: LeadFormAsset = {
                        id: formId,
                        title: title,
                        prompt: prompt,
                        fields: fields,
                        html: finalHtml,
                        publicUrl,
                        slug,
                        createdAt: Date.now(),
                        projectId: projectRef.current.id
                      };

                      await authFetch('/api/websites?op=save-form', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ form: newLeadForm })
                      });

                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true, title, publicUrl }
                      });
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: e.message } });
                    }
                  } else if (fc.name === 'schedule_template_email') {
                    // ========== Voice Mode: Email Template Scheduling ==========
                    try {
                      const templateName = String(args.templateName || '').trim().toLowerCase();
                      const formName = args.formName ? String(args.formName).trim().toLowerCase() : null;
                      const tableName = args.tableName ? String(args.tableName).trim().toLowerCase() : null;
                      const fileName = args.fileName ? String(args.fileName).trim().toLowerCase() : null;
                      const emailSource = String(args.emailSource || '').toLowerCase();
                      const scheduledAt = String(args.scheduledAt || 'now').trim();

                      // Smart provider selection
                      let provider = String(args.provider || '').toLowerCase();
                      if (!provider) {
                        if (gmailConnected && !outlookConnected) provider = 'gmail';
                        else if (outlookConnected && !gmailConnected) provider = 'outlook';
                        else provider = 'gmail'; // Default fallback
                      }

                      const customSubject = String(args.subject || '').trim();
                      const customBody = String(args.body || '').trim();

                      if (!projectRef.current) {
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'Project not found' } });
                        continue;
                      }

                      let subject = '';
                      let html = '';
                      let templateLabel = 'Custom Email';

                      // Determine email content source
                      if (templateName) {
                        const templates = projectRef.current.emailTemplates || [];

                        // Smart template matching: strip common words and try multiple strategies
                        const stopWords = ['the', 'a', 'an', 'my', 'email', 'template', 'called', 'named', 'to', 'for', 'send', 'schedule'];
                        const searchWords = templateName.split(/\s+/).filter(w => !stopWords.includes(w.toLowerCase()));
                        const cleanedSearch = searchWords.join(' ').toLowerCase();

                        // Try matching strategies in order of specificity
                        let template = templates.find(t => t.name.toLowerCase() === cleanedSearch)
                          || templates.find(t => t.name.toLowerCase() === templateName)
                          || templates.find(t => t.name.toLowerCase().includes(cleanedSearch))
                          || templates.find(t => cleanedSearch.includes(t.name.toLowerCase()))
                          || templates.find(t => searchWords.some(w => t.name.toLowerCase().includes(w)))
                          || templates.find(t => t.name.toLowerCase().includes(templateName));

                        if (!template) {
                          const available = templates.map(t => t.name).join(', ') || 'none';
                          functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: `Template "${templateName}" not found. Available: ${available}` } });
                          continue;
                        }

                        subject = customSubject || template.subject || template.name;

                        // Construct HTML body from blocks if available
                        html = ''; // Reset to ensure clean state

                        if (template.blocks && template.blocks.length > 0) {
                          try {
                            const generated = generateEmailHtml(template.blocks);
                            if (generated && generated.trim().length > 0) {
                              html = generated;
                            } else {
                              console.warn('[ProjectLiveAssistant] generateEmailHtml returned empty string for template:', template.name);
                            }
                          } catch (err) {
                            console.error('[ProjectLiveAssistant] Failed to generate HTML from blocks:', err);
                          }
                        }

                        // Fallback to custom body or legacy body if html is still empty
                        if (!html || html.trim().length === 0) {
                          html = customBody || template.body || '';
                        }

                        // If still empty, try to construct a basic representation from blocks as last resort
                        if ((!html || html.trim().length === 0) && template.blocks && template.blocks.length > 0) {
                          html = template.blocks.map((b: any) => {
                            if (b.type === 'text' || b.type === 'header' || b.type === 'footer') return `<p>${b.content?.text || ''}</p>`;
                            if (b.type === 'image') return `<img src="${b.content?.src || b.content?.url || ''}" alt="${b.content?.alt || ''}" style="max-width: 100%; display: block;" />`;
                            if (b.type === 'button') return `<a href="${b.content?.url}" style="padding: 10px 20px; background: #007bff; color: white;">${b.content?.text}</a>`;
                            return '';
                          }).join('');
                        }

                        if (!html || html.trim().length === 0) {
                          functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: `Error: The email template "${templateName}" appears to be empty. Please edit the template to add content blocks (Text, Image, etc.) and save it again.` } });
                          continue;
                        }
                        templateLabel = template.name;
                      } else if (customSubject && customBody) {
                        subject = customSubject;
                        html = customBody;
                      } else {
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'Specify a template name or provide subject and body' } });
                        continue;
                      }

                      // Get emails from source
                      let emails: string[] = [];
                      let sourceLabel = '';

                      // Source: Leads
                      if (emailSource === 'leads' || formName || (!tableName && !fileName)) {
                        const leadsRes = await authFetch(`/api/websites?op=get-leads&projectId=${projectRef.current.id}`);
                        if (!leadsRes.ok) throw new Error('Failed to fetch leads');
                        const leadsData = await leadsRes.json();
                        let leads = leadsData.leads || [];

                        if (formName) {
                          leads = leads.filter((l: any) => l.formTitle?.toLowerCase().includes(formName));
                          sourceLabel = `leads from ${formName}`;
                        } else {
                          sourceLabel = 'all leads';
                        }

                        if (leads.length === 0) {
                          functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: formName ? `No leads for form "${formName}"` : 'No leads found' } });
                          continue;
                        }

                        emails = leads.map((l: any) => l.data?.email || l.data?.Email || Object.values(l.data || {}).find((v: any) => typeof v === 'string' && v.includes('@'))).filter(Boolean) as string[];
                      }
                      // Source: Table
                      else if (emailSource === 'table' || tableName) {
                        let foundTable: any = null;
                        for (const session of projectRef.current.researchSessions || []) {
                          for (const table of session.researchReport?.tables || []) {
                            if (table.title?.toLowerCase().includes(tableName || '')) {
                              foundTable = table;
                              break;
                            }
                          }
                          if (foundTable) break;
                        }

                        if (!foundTable) {
                          functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: `Table "${tableName}" not found` } });
                          continue;
                        }

                        const emailColIdx = foundTable.columns?.findIndex((c: string) => c.toLowerCase().includes('email')) ?? -1;
                        if (emailColIdx === -1) {
                          functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: `No email column in table "${foundTable.title}"` } });
                          continue;
                        }

                        emails = (foundTable.rows || []).map((row: string[]) => row[emailColIdx]).filter((e: string) => e && e.includes('@'));
                        sourceLabel = `table ${foundTable.title}`;
                      }
                      // Source: File
                      else if (emailSource === 'file' || fileName) {
                        const file = (projectRef.current.uploadedFiles || []).find(f => f.name?.toLowerCase().includes(fileName || ''));
                        if (!file) {
                          functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: `File "${fileName}" not found` } });
                          continue;
                        }

                        if (file.summary) {
                          const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                          emails = (file.summary.match(emailRegex) || []) as string[];
                        }
                        sourceLabel = `file ${file.name}`;
                      }

                      if (emails.length === 0) {
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: 'No email addresses found' } });
                        continue;
                      }

                      const isNow = scheduledAt.toLowerCase() === 'now' || !scheduledAt;

                      if (isNow) {
                        let successCount = 0;
                        for (const email of emails) {
                          try {
                            const res = await authFetch(`/api/email?op=send&provider=${provider}`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ to: email, subject, html })
                            });
                            if (res.ok) successCount++;
                          } catch { }
                        }
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: true, sent: successCount, template: templateLabel } });
                      } else {
                        const scheduledTime = parseScheduleDate(scheduledAt);
                        const scheduledAtUnix = Math.floor(new Date(scheduledTime).getTime() / 1000);
                        await authFetch('/api/email?op=email-schedule-create', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            projectId: projectRef.current.id,
                            to: emails,
                            subject,
                            html,
                            provider,
                            scheduledAt: scheduledAtUnix
                          })
                        });
                        functionResponses.push({ id: fc.id, name: fc.name, response: { success: true, scheduled: new Date(scheduledTime).toISOString(), recipients: emails.length, template: templateLabel } });
                      }
                    } catch (e: any) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { success: false, error: e.message } });
                    }
                  }
                }

                // Send tool responses back to the session
                if (functionResponses.length > 0) {
                  const session = await sessionPromise;
                  session.sendToolResponse({ functionResponses });
                  console.log('Tool response sent:', functionResponses);
                }
                return; // Don't process further for tool call messages
              }
            } catch (toolError) {
              console.error('Tool handling error:', toolError);
            }

            if (serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }

            if (serverContent?.outputTranscription?.text) {
              const text = serverContent.outputTranscription.text;
              setTranscriptBuffer(prev => prev + text);
            }

            // Handle Thinking/Reasoning Parts (Streaming)
            if (serverContent?.modelTurn?.parts) {
              for (const part of serverContent.modelTurn.parts) {
                if ((part as any).thought) {
                  // Stream thoughts to the user (visible as italics or distinct prefix)
                  console.log('Model Thought:', (part as any).text);
                  setTranscriptBuffer(prev => {
                    // Avoid duplicating "Thinking:" prefix if already thinking
                    const prefix = prev.includes('Thinking process:') ? '' : '\n*Thinking process:* ';
                    return prev + prefix + (part.text || '') + ' ';
                  });
                }
              }
            }

            if (serverContent?.turnComplete) {
              // When a model turn completes, commit the accumulated transcript
              // into the shared messages state so it shows up in the transcript UI.
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
          },
          onclose: () => {
            setConnectionStatus('disconnected');
            setIsSpeaking(false);
            setIsProcessing(false); // Ensure no stuck loading state
            if (sourcesRef.current) {
              sourcesRef.current.forEach((s: AudioBufferSourceNode) => {
                s.onended = null;
                s.stop();
                s.disconnect();
              });
              sourcesRef.current.clear();
            }
          },
          onerror: (err) => {
            console.error("Voice API Error", err);
            logToVercel('Voice API Error', 'error', err?.message || String(err));
            setError("Voice connection error. Please try again.");
            setConnectionStatus('error');
            setIsProcessing(false); // Ensure no stuck loading state
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (e: any) {
      console.error("Failed to connect voice:", e);
      logToVercel('Failed to connect voice', 'error', e?.message || String(e));
      setError("Failed to initialize voice. Check microphone permissions.");
      setConnectionStatus('error');
      setIsProcessing(false);
    }
  };

  const disconnectVoice = () => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
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
    sourcesRef.current.forEach(s => s.stop());
    sourcesRef.current.clear();
    sessionRef.current = null;
    setConnectionStatus('disconnected');
    setIsSpeaking(false);
    setIsProcessing(false); // Ensure no stuck loading state
  };

  const isImageRequest = (text: string): boolean => {
    const imageKeywords = [
      'generate image', 'create image', 'make image', 'draw', 'illustrate',
      'generate a picture', 'create a picture', 'make a picture',
      'generate an image', 'create an image', 'make an image',
      'create visual', 'generate visual', 'design image',
      'generate artwork', 'create artwork', 'make artwork',
      'image of', 'picture of', 'illustration of',
      'visualize', 'render image', 'produce image'
    ];
    const lowerText = text.toLowerCase();
    return imageKeywords.some(keyword => lowerText.includes(keyword));
  };

  // Detect if user wants to EDIT an existing image vs create a fresh new one
  const isEditRequest = (text: string): boolean => {
    const editKeywords = [
      'edit', 'modify', 'change', 'adjust', 'fix', 'update', 'alter', 'tweak',
      'make it', 'make the', 'make this', 'add a', 'add the', 'add in', 'add some',
      'remove', 'delete', 'erase', 'take out', 'get rid of',
      'replace', 'swap', 'switch',
      'more', 'less', 'bigger', 'smaller', 'brighter', 'darker', 'lighter',
      'different color', 'another color', 'change the color',
      'redo', 'try again with', 'but with', 'same but'
    ];
    const lower = text.toLowerCase();
    return editKeywords.some(kw => lower.includes(kw));
  };

  const generateImageWithContext = async (prompt: string): Promise<string> => {
    // Credit Check (Default to fast for chat)
    const hasCredits = await checkCredits('imageGenerationFast');
    if (!hasCredits) throw new Error('Insufficient credits');

    const success = await deductCredits('imageGenerationFast');
    if (!success) throw new Error('Failed to deduct credits');

    const projectWithActivities = { ...project, activities };
    const projectContext = contextService.buildProjectContext(projectWithActivities);
    const enhancedPrompt = `
Create an image based on this request: "${prompt}"

PROJECT CONTEXT (use this to inform the visual style, subject matter, and theme):
- Project: ${project.name}
- Description: ${project.description}
- Research Topics: ${project.researchSessions.map(s => s.topic).join(', ')}

Key themes from research:
${project.researchSessions.slice(0, 3).map(s => `- ${s.topic}: ${s.researchReport.tldr || 'No summary'}`).join('\n') || 'No research available'}

Create a visually compelling image that aligns with the project's theme and the user's request.
`;
    const result = await generateImage(enhancedPrompt);
    return result.imageDataUrl;
  };

  /**
   * Handle assets dropped from the Assets tab into the chat area.
   * Analyzes the dropped file using Gemini multimodal analysis with project context.
   * Provides type-specific analysis prompts for different asset types.
   */
  const handleAssetDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingAssetOver(false);

    // Check for native file drops (Desktop -> Browser)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      console.log('[AssetDrop] Detected native file drop:', e.dataTransfer.files.length);
      handlePickAttachments(e.dataTransfer.files);
      return;
    }

    // Try to parse dropped asset data
    const assetDataStr = e.dataTransfer.getData('application/json');
    if (!assetDataStr) {
      console.warn('[AssetDrop] No asset data found in drop event');
      return;
    }

    let asset: {
      id?: string;
      name?: string;
      displayName?: string;
      url?: string;
      uri?: string;
      type?: string;
      mimeType?: string;
      data?: any;
    };

    try {
      asset = JSON.parse(assetDataStr);
    } catch (parseErr) {
      console.error('[AssetDrop] Failed to parse asset data:', parseErr);
      return;
    }

    const assetName = asset.displayName || asset.name || 'Dropped File';
    const assetUri = asset.uri || asset.url;
    const assetType = asset.type?.toLowerCase() || '';
    const mimeType = asset.mimeType || '';
    const mimeTypeLower = mimeType.toLowerCase();

    // Exclude worlds from drag-drop analysis
    if (assetType === 'world' || assetType.includes('world')) {
      addMessage('model', '🌍 World assets cannot be analyzed via drag-drop. Please view worlds in the Worlds tab where you can explore and interact with them.');
      return;
    }

    if (!assetUri) {
      addMessage('model', '⚠️ Could not analyze the dropped file: No file URL available.');
      return;
    }

    // Determine the type icon for display
    const getTypeEmoji = (): string => {
      if (assetType === 'social' || assetType === 'header' || assetType === 'slide' || mimeTypeLower.startsWith('image/')) return '🖼️';
      if (assetType === 'video' || mimeTypeLower.startsWith('video/')) return '🎬';
      if (assetType === 'podcast' || mimeTypeLower.startsWith('audio/')) return '🎧';
      if (assetType === 'book' || mimeTypeLower.includes('pdf')) return '📄';
      if (assetType === 'blog') return '📝';
      if (assetType === 'table') return '📊';
      if (assetType === 'website') return '🌐';
      if (assetType === 'doc' || mimeTypeLower.includes('document') || mimeTypeLower.includes('text')) return '📑';
      if (assetType === 'notemap') return '🗺️';
      if (assetType === 'product') return '🛍️';
      if (assetType === 'leadform') return '📋';
      return '📎';
    };

    // Add user message showing file was dropped
    addMessage('user', `${getTypeEmoji()} Dropped: ${assetName}`);
    setIsProcessing(true);

    // Track dropped media for intelligent media targeting (images and videos only)
    const isImageType = assetType === 'social' || assetType === 'header' || assetType === 'slide' || assetType === 'notemap' || mimeTypeLower.startsWith('image/');
    const isVideoType = assetType === 'video' || mimeTypeLower.startsWith('video/');
    if (isImageType || isVideoType) {
      trackConversationMedia({
        id: asset.id || `dropped-${Date.now()}`,
        url: assetUri,
        publicUrl: asset.url || assetUri,
        type: isVideoType ? 'video' : 'image',
        source: 'dropped',
        name: assetName
      });
      console.log('[AssetDrop] Tracked dropped media:', assetName, isVideoType ? 'video' : 'image');
    }

    try {
      // Build project context for enriched analysis
      const projectContext = contextService.buildProjectContext(project);
      const contextSnippet = projectContext.fullContext.slice(0, 3000);

      // Build type-specific analysis prompt
      let analysisTask = '';

      // Image types (social posts, headers, slides, generated images)
      if (assetType === 'social' || assetType === 'header' || assetType === 'slide' || assetType === 'notemap' || mimeTypeLower.startsWith('image/')) {
        analysisTask = `Analyze this image in detail.

PROJECT CONTEXT:
Project: ${project.name}
Description: ${project.description}
${contextSnippet}

IMAGE ANALYSIS - Please provide:
1. **Visual Description**: Describe the main subjects, composition, colors, and visual style
2. **Text & Graphics**: Identify any text, logos, or graphic elements visible
3. **Brand Alignment**: How well does this image align with the project's theme and purpose?
4. **Usage Suggestions**: Where could this image be effectively used (social media, website hero, presentation, etc.)?
5. **Enhancement Ideas**: Any suggestions for improving or repurposing this visual?`;
      }

      // Video assets
      else if (assetType === 'video' || mimeTypeLower.startsWith('video/')) {
        analysisTask = `Analyze this video thoroughly.

PROJECT CONTEXT:
Project: ${project.name}
Description: ${project.description}
${contextSnippet}

VIDEO ANALYSIS - Please provide:
1. **Content Overview**: Describe the key scenes, subjects, and visual narrative
2. **Audio Content**: Summarize any speech, narration, or important audio elements with timestamps
3. **Key Moments**: Identify the most impactful or important moments (with approximate timestamps)
4. **Production Quality**: Comment on lighting, camera work, editing, and overall quality
5. **Project Relevance**: How does this video relate to the project goals?
6. **Optimization Tips**: Suggestions for improving the video or extracting clips for different platforms`;
      }

      // Audio/Podcast assets
      else if (assetType === 'podcast' || mimeTypeLower.startsWith('audio/')) {
        analysisTask = `Analyze this audio file in detail.

PROJECT CONTEXT:
Project: ${project.name}
Description: ${project.description}
${contextSnippet}

AUDIO ANALYSIS - Please provide:
1. **Transcription**: Provide a concise transcription of the main speech content
2. **Key Topics**: What are the main topics and themes discussed?
3. **Speaker Insights**: Note any key quotes, insights, or memorable statements
4. **Audio Quality**: Comment on recording quality, clarity, and production value
5. **Content Structure**: Describe the flow and organization of the content
6. **Actionable Takeaways**: What are the key takeaways relevant to the project?`;
      }

      // PDF/Book assets
      else if (assetType === 'book' || mimeTypeLower.includes('pdf')) {
        analysisTask = `Analyze this PDF/document thoroughly.

PROJECT CONTEXT:
Project: ${project.name}
Description: ${project.description}
${contextSnippet}

DOCUMENT ANALYSIS - Please provide:
1. **Document Summary**: What is this document about? Provide a comprehensive summary
2. **Key Sections**: Outline the main sections and what each covers
3. **Important Data**: Extract any key statistics, figures, or data points
4. **Key Insights**: What are the most important findings or conclusions?
5. **Project Application**: How can the information in this document support the project?
6. **Action Items**: Any specific action items or recommendations from the document?`;
      }

      // Blog assets
      else if (assetType === 'blog') {
        analysisTask = `Analyze this blog post content.

PROJECT CONTEXT:
Project: ${project.name}
Description: ${project.description}
${contextSnippet}

BLOG ANALYSIS - Please provide:
1. **Content Summary**: What is the main topic and thesis of the blog?
2. **Key Points**: List the main arguments or points made
3. **SEO Assessment**: Evaluate headline, structure, and keyword usage
4. **Engagement Potential**: Rate the content's potential to engage readers
5. **Improvement Suggestions**: How could this blog be enhanced?
6. **Distribution Strategy**: Suggest platforms and methods to share this content`;
      }

      // Table/Spreadsheet assets
      else if (assetType === 'table' || mimeTypeLower.includes('spreadsheet') || mimeTypeLower.includes('csv') || mimeTypeLower.includes('excel')) {
        analysisTask = `Analyze this table/spreadsheet data.

PROJECT CONTEXT:
Project: ${project.name}
Description: ${project.description}
${contextSnippet}

TABLE ANALYSIS - Please provide:
1. **Data Overview**: What kind of data is in this table? Describe the columns and structure
2. **Key Metrics**: Identify the most important numbers or data points
3. **Trends & Patterns**: Note any significant trends, patterns, or anomalies
4. **Data Quality**: Comment on completeness, consistency, and potential issues
5. **Insights**: What insights can be drawn from this data for the project?
6. **Visualization Ideas**: Suggest ways to visualize or present this data`;
      }

      // Website assets
      else if (assetType === 'website') {
        analysisTask = `Analyze this website/webpage.

PROJECT CONTEXT:
Project: ${project.name}
Description: ${project.description}
${contextSnippet}

WEBSITE ANALYSIS - Please provide:
1. **Purpose & Messaging**: What is the website's main purpose and key message?
2. **Design Review**: Comment on layout, visual design, and user experience
3. **Content Quality**: Evaluate the written content, headlines, and CTAs
4. **Brand Consistency**: How well does it align with the project's brand?
5. **Conversion Elements**: Identify calls-to-action and conversion paths
6. **Improvement Recommendations**: Specific suggestions to enhance the site`;
      }

      // Product assets
      else if (assetType === 'product') {
        analysisTask = `Analyze this product listing.

PROJECT CONTEXT:
Project: ${project.name}
Description: ${project.description}
${contextSnippet}

PRODUCT ANALYSIS - Please provide:
1. **Product Overview**: What is this product and who is it for?
2. **Value Proposition**: What makes this product valuable or unique?
3. **Pricing Strategy**: Comment on the pricing if visible
4. **Marketing Angle**: How is the product being positioned?
5. **Improvement Ideas**: Suggestions for better product presentation
6. **Cross-sell Opportunities**: Related products or bundles to consider`;
      }

      // Lead form assets
      else if (assetType === 'leadform') {
        analysisTask = `Analyze this lead capture form.

PROJECT CONTEXT:
Project: ${project.name}
Description: ${project.description}
${contextSnippet}

LEAD FORM ANALYSIS - Please provide:
1. **Form Purpose**: What is this form designed to capture?
2. **Field Review**: Are the fields appropriate? Too many or too few?
3. **UX Assessment**: How easy is it for users to complete?
4. **Conversion Optimization**: Suggestions to improve form completion rates
5. **Data Usage**: How can the captured data support the project?
6. **Follow-up Strategy**: Recommended next steps after form submission`;
      }

      // Generic document/text files
      else if (assetType === 'doc' || mimeTypeLower.includes('document') || mimeTypeLower.includes('text') || mimeTypeLower.includes('word')) {
        analysisTask = `Analyze this document thoroughly.

PROJECT CONTEXT:
Project: ${project.name}
Description: ${project.description}
${contextSnippet}

DOCUMENT ANALYSIS - Please provide:
1. **Content Summary**: What is this document about?
2. **Key Information**: Extract the most important points and data
3. **Structure Review**: How is the document organized?
4. **Quality Assessment**: Comment on writing quality and clarity
5. **Project Relevance**: How does this content relate to the project?
6. **Next Steps**: Recommended actions based on this document`;
      }

      // Fallback for any other type
      else {
        analysisTask = `Analyze this file and provide detailed insights.

PROJECT CONTEXT:
Project: ${project.name}
Description: ${project.description}
${contextSnippet}

ANALYSIS - Please provide:
1. **Content Description**: What is in this file?
2. **Key Elements**: Identify the most important aspects
3. **Quality Assessment**: Comment on the quality and completeness
4. **Project Relevance**: How does this relate to the project goals?
5. **Usage Suggestions**: How could this asset be used or improved?`;
      }

      const analysis = await analyzeFileWithGemini(
        assetUri,
        mimeType || 'application/octet-stream',
        analysisTask,
        assetName
      );

      addMessage('model', analysis);
    } catch (err: any) {
      console.error('[AssetDrop] Failed to analyze dropped asset:', err);
      addMessage('model', `⚠️ Failed to analyze file: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  }, [project, addMessage]);

  const handleSendMessage = async () => {
    if ((!inputText.trim() && readyAttachments.length === 0) || isProcessing || isGeneratingImage) return;
    if (isUploadingAttachments) {
      setError('Please wait for attachments to finish uploading.');
      return;
    }

    const userMessage = inputText.trim();
    setIsProcessing(true);
    setInputText('');
    addMessage('user', userMessage);

    // In voice mode with an active Live session, send text via Live API instead of generateContent.
    // To avoid protocol issues, send a simple string (supported by the SDK) and
    // hint about any referenced uploaded file in the text itself.
    if (mode === 'voice' && sessionRef.current) {
      try {
        let textForLive = userMessage;

        if (readyAttachments.length > 0) {
          const lines = readyAttachments.map(a => {
            const u = a.uploaded;
            return u ? `- ${u.displayName || a.file.name} (${u.mimeType || a.file.type || 'unknown'}): ${u.uri}` : `- ${a.file.name}`;
          });
          textForLive += `\n\n[User attached files:\n${lines.join('\n')}\nUse them as context if possible.]`;

          // Track attached images/videos for easy posting
          const imageOrVideoAtt = readyAttachments.find(a =>
            a.uploaded?.mimeType?.startsWith('image/') || a.uploaded?.mimeType?.startsWith('video/')
          );
          if (imageOrVideoAtt?.uploaded?.uri) {
            const isVideo = imageOrVideoAtt.uploaded.mimeType?.startsWith('video/');
            setLastGeneratedAsset({
              url: imageOrVideoAtt.uploaded.uri,
              type: isVideo ? 'video' : 'image',
              name: imageOrVideoAtt.uploaded.displayName || imageOrVideoAtt.file.name,
              timestamp: Date.now()
            });
          }
        }

        if (project.uploadedFiles && project.uploadedFiles.length > 0) {
          const normalizedMessage = userMessage.toLowerCase();
          const matchedFile = project.uploadedFiles.find(file => {
            const displayName = (file.displayName || '').toLowerCase();
            const name = (file.name || '').toLowerCase();
            return (displayName && normalizedMessage.includes(displayName)) ||
              (name && normalizedMessage.includes(name));
          });

          if (matchedFile) {
            // Append context so the live model knows which uploaded file you mean and has its details
            textForLive += `\n\n[Context: The user is asking about the uploaded project file "${matchedFile.displayName || matchedFile.name}".`;
            textForLive += `\nFile type: ${matchedFile.mimeType || 'unknown'}`;
            textForLive += `\nFile URI: ${matchedFile.uri}`;
            if (matchedFile.summary) {
              textForLive += `\nFile summary: ${matchedFile.summary}`;
            }
            textForLive += `\nFocus your answer on this specific file.]`;
          }
        }

        sessionRef.current.sendClientContent({ turns: textForLive, turnComplete: true });
        clearAttachments();
      } catch (e) {
        console.error('Failed to send text to Live session:', e);
        setError('Failed to send message over live connection.');
      }
      return;
    }

    // Check if we have an active Computer Use session
    // If so, route this message as a follow-up command to the existing session
    if (activeComputerUseSessionId) {
      // Allow cancellation via text
      if (['stop', 'cancel', 'end session', 'exit'].includes(userMessage.toLowerCase())) {
        // Let the flow continue to normal handling or handle specific cancellation logic here?
        // Actually, ComputerUseViewer handles cancellation via its own button, but users might type it.
        // For now, let's treat "stop" as a command to the AGENT to stop, unless we want to force kill.
        // Given existing UI has a Stop button, we can interpret text as instructions for the agent.
      }

      console.log('[ComputerUse] Routing follow-up command to session:', activeComputerUseSessionId);
      try {
        await sendComputerUseCommand(activeComputerUseSessionId, userMessage);
        clearAttachments();
        setIsProcessing(false);
        return; // Stop here, do not process as a standard chat message
      } catch (e) {
        console.error('[ComputerUse] Failed to send follow-up command:', e);
        // Fall through to normal chat if it failed? Or show error?
        // Best to show error and let user retry.
        // Best to show error and let user retry.
        addMessage('model', '⚠️ Failed to send command to the browser agent. Please try again.');
        setIsProcessing(false);
        return;
      }
    }

    // Check if Computer Use (browser automation) is needed - Pro users only
    const computerUseCheck = shouldUseComputerUse(userMessage, !!lastComputerUseSessionId);
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
          computerUseSession: undefined, // Will be populated when viewer mounts
          computerUseExistingSessionId: lastComputerUseSessionId || undefined, // Try to reuse previous session
        },
      ]);
      setActiveComputerUseMessageId(cuMessageId);
      clearAttachments();
      setIsProcessing(false);
      return;
    }

    // Chat mode: keep existing behavior, including image generation path
    if (isImageRequest(userMessage)) {
      const canProceed = await checkUsageAndProceed('image');
      if (!canProceed) {
        setIsProcessing(false);
        return;
      }

      setIsGeneratingImage(true);
      setError(null);

      try {
        addMessage('model', 'Generating your image...');

        // Detect logo/profile picture intent
        const lowerMsg = userMessage.toLowerCase();
        let manualRefs: ImageReference[] = [];
        if (userProfile?.photoURL && (lowerMsg.includes('my logo') || lowerMsg.includes('my profile picture') || lowerMsg.includes('my icon') || lowerMsg.includes('my brand image'))) {
          const base64 = await fetchImageAsBase64(userProfile.photoURL);
          if (base64) {
            manualRefs.push({ base64, mimeType: 'image/png' });
          }
        }

        const { imageUrl } = await generateProjectImageAsset(userMessage, manualRefs);
        // Track for easy posting
        setLastGeneratedAsset({ url: imageUrl, type: 'image', name: userMessage.slice(0, 50), timestamp: Date.now() });

        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage && lastMessage.role === 'model' && lastMessage.text === 'Generating your image...') {
            newMessages[newMessages.length - 1] = {
              ...lastMessage,
              text: 'Here\'s the image I created based on your request (saved to project assets):',
              imageUrl
            };
          }
          return newMessages;
        });
      } catch (e) {
        console.error("Image generation error:", e);
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage && lastMessage.role === 'model' && lastMessage.text === 'Generating your image...') {
            newMessages[newMessages.length - 1] = {
              ...lastMessage,
              text: 'Sorry, I couldn\'t generate the image. Please try again with a different description.'
            };
          }
          return newMessages;
        });
      } finally {
        setIsGeneratingImage(false);
        setIsProcessing(false);
      }
      return;
    }

    setError(null);

    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      const ai = new GoogleGenAI({ apiKey });

      // Build social connection status for the AI
      const socialConnectionStatus = `
SOCIAL MEDIA CONNECTION STATUS (REAL-TIME):
- Facebook: ${facebookConnected ? `✓ CONNECTED (${fbPages?.length || 0} pages available)` : '✗ NOT CONNECTED'}${fbPageId ? ` - Selected Page ID: ${fbPageId}` : ''}
- Instagram: ${facebookConnected && igAccounts.length > 0 ? `✓ CONNECTED (${igAccounts.length} accounts)` : '✗ NOT CONNECTED'}${selectedIgId ? ` - Selected: ${selectedIgId}` : ''}
- X (Twitter): ${xConnected ? '✓ CONNECTED' : '✗ NOT CONNECTED'}
- TikTok: ${tiktokConnected ? '✓ CONNECTED' : '✗ NOT CONNECTED'}
- YouTube: ${youtubeConnected ? '✓ CONNECTED' : '✗ NOT CONNECTED'}
- LinkedIn: ${linkedinConnected ? '✓ CONNECTED' : '✗ NOT CONNECTED'}

STRIPE PAYMENT CONNECTION STATUS (REAL-TIME):
- Stripe: ${((window as any).__userProfile as UserProfile | undefined)?.stripeConnect?.accountId ? '✓ CONNECTED' : '✗ NOT CONNECTED - User must click "Connect Stripe" button to set up payments'}
${((window as any).__userProfile as UserProfile | undefined)?.stripeConnect?.chargesEnabled ? '  - Charges: ✓ Enabled (can accept payments)' : ''}
${((window as any).__userProfile as UserProfile | undefined)?.stripeConnect?.accountId && !((window as any).__userProfile as UserProfile | undefined)?.stripeConnect?.chargesEnabled ? '  - Charges: ✗ Pending (onboarding incomplete)' : ''}

IMPORTANT: Stripe is SEPARATE from social media connections. When user wants to CREATE A PRODUCT or SELL something:
1. Check the STRIPE CONNECTION STATUS above (NOT social media)
2. If Stripe is NOT CONNECTED, tell them a "Connect Stripe" button will appear and they should click it
3. If Stripe IS CONNECTED, proceed with the create_stripe_product tool immediately
4. Do NOT show social media connect buttons for product creation - Stripe has its OWN connect button

================================================================================
INTELLIGENT TOOL SELECTION - REASON BEFORE ACTING
================================================================================

Before responding to ANY user request, ALWAYS reason through these steps:

STEP 1 - IDENTIFY THE PRIMARY INTENT:
[ ] CONTENT CREATION: User wants to generate NEW content (image, video, blog, table, website)
[ ] CONTENT EDITING: User wants to MODIFY existing content (edit image, change colors, add elements)
[ ] SOCIAL POSTING: User wants to SHARE/POST/SCHEDULE to a specific platform
[ ] INFORMATION: User wants answers, search results, research
[ ] PROJECT MANAGEMENT: User wants to manage tasks, notes, files

STEP 2 - CONTEXT SIGNALS TO CHECK:
* Does user mention a PLATFORM NAME (Instagram, TikTok, etc.)? -> Likely SOCIAL POSTING
* Does user say "animate", "turn into video", "make a video"? -> VIDEO GENERATION (NOT posting!)
* Does user use EDIT words ("change", "add", "remove", "brighter", "darker")? -> CONTENT EDITING
* Is user describing something COMPLETELY NEW to create? -> CONTENT CREATION
* Did user just generate content and now reference "it/this/that"? -> Check what action they want!

STEP 3 - DISAMBIGUATION RULES (CRITICAL!):
+------------------------------------------------------------------------------+
| USER SAYS                        | CORRECT TOOL            | WRONG TOOL      |
+----------------------------------+-------------------------+-----------------+
| "make it into a video"           | generate_project_video  | schedule_post   |
| "animate this image"             | generate_project_video  | post_to_social  |
| "turn it into an animated video" | generate_project_video  | schedule_post   |
| "generate image of a cat"        | generate_image (NEW)    | edit_image      |
| "generate new landscape"         | generate_image (NEW)    | use old image   |
| "make it brighter"               | edit_image_with_gemini  | generate_image  |
| "add clouds to the image"        | edit_image_with_gemini  | generate_image  |
| "post this to Instagram"         | post_to_social          | generate_video  |
| "share on TikTok"                | post_to_social          | generate_video  |
| "schedule for 8am tomorrow"      | schedule_post           | post_to_social  |
+----------------------------------+-------------------------+-----------------+
| EMAIL vs SOCIAL - CRITICAL ROUTING:                                          |
+----------------------------------+-------------------------+-----------------+
| "schedule the awesome email"     | schedule_template_email | schedule_post   |
| "send email to my leads"         | schedule_template_email | schedule_post   |
| "email the newsletter template"  | schedule_template_email | schedule_post   |
| "send my template to subscribers"| schedule_template_email | schedule_post   |
| "schedule email for 3pm"         | schedule_template_email | schedule_post   |
| "schedule to instagram at 3pm"   | schedule_post           | schedule_email  |
| "post to facebook tomorrow"      | schedule_post           | schedule_email  |
+------------------------------------------------------------------------------+

================================================================================
COMPLETE TOOL CATALOG - KNOW YOUR CAPABILITIES
================================================================================

>> CONTENT GENERATION (Creating NEW content)
+-----------------------------------------------------------------------------+
| generate_image_with_gemini - Create NEW images from text descriptions      |
|   NATURAL LANGUAGE TRIGGERS:                                                |
|   • "generate an image of a sunset" → generate_image_with_gemini           |
|   • "create a picture of a cat" → generate_image_with_gemini               |
|   • "draw me a logo" → generate_image_with_gemini                          |
|   • "make an image for my post" → generate_image_with_gemini               |
|   NOT FOR: Editing existing images ("make it brighter" → edit_image)        |
+-----------------------------------------------------------------------------+
| edit_image_with_gemini - MODIFY an existing image                          |
|   NATURAL LANGUAGE TRIGGERS:                                                |
|   • "make it brighter" → edit_image_with_gemini                            |
|   • "add clouds to the image" → edit_image_with_gemini                     |
|   • "change the background" → edit_image_with_gemini                       |
|   • "remove the person" → edit_image_with_gemini                           |
|   NOT FOR: Creating completely new images ("generate image" → generate)     |
+-----------------------------------------------------------------------------+
| generate_project_video - Create video from text OR ANIMATE an image        |
|   NATURAL LANGUAGE TRIGGERS:                                                |
|   • "make a video about..." → generate_project_video                       |
|   • "animate this image" → generate_project_video(useLastImage: true)      |
|   • "turn it into a video" → generate_project_video                        |
|   • "create an animated video" → generate_project_video                    |
|   NOT FOR: Posting videos ("post to TikTok" → post_to_social)              |
+-----------------------------------------------------------------------------+
| generate_project_blog - Write a blog article                               |
|   NATURAL LANGUAGE TRIGGERS:                                                |
|   • "write a blog about marketing" → generate_project_blog                 |
|   • "create an article about AI" → generate_project_blog                   |
|   • "generate a blog post" → generate_project_blog                         |
+-----------------------------------------------------------------------------+
| generate_project_table - Create a data table                               |
|   NATURAL LANGUAGE TRIGGERS:                                                |
|   • "create a table of prospects" → generate_project_table                 |
|   • "make a spreadsheet of products" → generate_project_table              |
|   • "generate a list of contacts" → generate_project_table                 |
+-----------------------------------------------------------------------------+
| generate_project_website - Build a website                                 |
|   NATURAL LANGUAGE TRIGGERS:                                                |
|   • "create a landing page" → generate_project_website                     |
|   • "build me a website" → generate_project_website                        |
|   • "make a webpage for my product" → generate_project_website             |
+-----------------------------------------------------------------------------+
| generate_project_podcast - Create audio podcast                            |
|   NATURAL LANGUAGE TRIGGERS:                                                |
|   • "make a podcast episode" → generate_project_podcast                    |
|   • "create audio content" → generate_project_podcast                      |
|   • "generate a podcast about..." → generate_project_podcast               |
+-----------------------------------------------------------------------------+

>> SOCIAL MEDIA (Posting to platforms like Facebook, Instagram, TikTok, etc.)
+-----------------------------------------------------------------------------+
| post_to_social - POST IMMEDIATELY to social platforms                      |
|   NATURAL LANGUAGE TRIGGERS:                                                |
|   • "post this to Instagram" → post_to_social(platforms: ['instagram'])    |
|   • "share on Facebook and Twitter" → post_to_social(platforms: ['fb','x'])|
|   • "upload to TikTok" → post_to_social(platforms: ['tiktok'])             |
|   • "put this on LinkedIn" → post_to_social(platforms: ['linkedin'])       |
|   REQUIRES: Platform name AND content (text/image/video)                   |
+-----------------------------------------------------------------------------+
| schedule_post - Schedule SOCIAL MEDIA for LATER posting                    |
|   NATURAL LANGUAGE TRIGGERS:                                                |
|   • "schedule for tomorrow at 8am" → schedule_post(scheduledAt: 'tomorrow')|
|   • "post at 3pm" → schedule_post(scheduledAt: '3pm')                      |
|   • "schedule to Facebook for next week" → schedule_post                   |
|   REQUIRES: Time/date AND platform AND content                             |
|   ⚠️ NOT for email! If user says "email" or "template", use below!         |
+-----------------------------------------------------------------------------+

>> EMAIL (Sending emails to leads, tables, or lists - NOT social media!)
+-----------------------------------------------------------------------------+
| schedule_template_email - Send/schedule EMAIL to lists (leads/tables/CSV)  |
|   NATURAL LANGUAGE TRIGGERS:                                                |
|   • "schedule the awesome email" → schedule_template_email(templateName:   |
|       'awesome') - EXTRACT just the template name, NOT the whole phrase!   |
|   • "send email to my leads" → schedule_template_email(emailSource: 'ask') |
|   • "email the newsletter to prospects" → schedule_template_email(tableName|
|       : 'prospects')                                                        |
|   • "send my welcome template in 15 minutes" → schedule_template_email     |
|       (templateName: 'welcome', scheduledAt: 'in 15 minutes')              |
|   ⚠️ Keywords: email, template, leads, newsletter, subscribers, email list |
|   ⚠️ If user mentions these, use THIS tool, NOT schedule_post!             |
+-----------------------------------------------------------------------------+

>> PROJECT MANAGEMENT
+-----------------------------------------------------------------------------+
| create_project_task / update_project_task / delete_project_task            |
| create_project_note / append_project_note / delete_project_note            |
| search_knowledge_base - Search uploaded documents                          |
| analyze_project_file - Analyze a specific uploaded file                    |
| start_new_research_session - Begin new research on a topic                 |
+-----------------------------------------------------------------------------+

>> DOCUMENT & TABLE EDITING
+-----------------------------------------------------------------------------+
| Docs: get_docs_draft, set_docs_draft_text, append_docs_draft_text,         |
|       replace_docs_draft_text, insert_docs_inline_image, save_docs_draft   |
| Tables: get_table_draft, set_table_cell, add_table_row, set_table_rows,    |
|         add_table_column, rename_table_column, save_table_to_google_sheet  |
+-----------------------------------------------------------------------------+

>> OTHER CAPABILITIES
+-----------------------------------------------------------------------------+
| run_project_seo_analysis - SEO keyword analysis                            |
| web_search - Search the web for current information                        |
| file_search - Search inside uploaded documents                             |
+-----------------------------------------------------------------------------+

SOCIAL POSTING WORKFLOW (GUIDED CONVERSATIONAL FLOW):

=== WHEN USER EXPRESSES SOCIAL SHARING INTENT ===
(Keywords: "post", "share", "publish", "put this on", "upload to", "schedule", platform names)

You MUST guide them through this CONVERSATIONAL FLOW:

**STEP 1: IDENTIFY CONTENT**
First, determine WHAT they want to post:
- If they have recently generated media (see RECENTLY GENERATED MEDIA) → Ask: "I see you just created [that image/video]. Would you like to share that?"  
- If they attached media → Acknowledge: "I'll use your attached [image/video]."
- If unclear → Ask: "What would you like to share? I can help you create an image, video, or text post."

**STEP 2: CREATE CONTENT IF NEEDED**
If no media exists and they want image/video:
- For images → Use generate_image_with_gemini
- For videos → Use generate_project_video
- After generating → Ask: "Here's your [image/video]! Should I post this?"

**STEP 3: GET CAPTION (MANDATORY - DO NOT SKIP)**
Once content is confirmed, if no caption provided:
- ASK: "What caption or message would you like for this post?"
- If they want help → Suggest 2-3 options based on content and project context
- Wait for their response before proceeding

**STEP 4: ASK FOR PLATFORMS (if not specified)**
If user didn't specify platforms:
- Ask: "Which platforms would you like me to post to?"
- For Facebook with multiple pages → Ask which page
- If platform not connected → Tell them and show connect button

**STEP 5: POST NOW OR SCHEDULE?**
If not already clear from their request:
- Ask: "Would you like me to post this now, or schedule it for later?"
- If SCHEDULE → Ask: "When would you like it to go out? (e.g., 'tomorrow at 9am')"

**STEP 6: EXECUTE**
Only after gathering all info, call the appropriate tool:
- post_to_social for immediate posting
- schedule_post for scheduled posting

**SHORTCUTS** - If user provides everything (e.g., "Post my sunset image to Instagram at 8am tomorrow with caption 'Beautiful day!'"):
- Skip clarification steps, but still confirm before posting

**IMPORTANT:**
- ALWAYS ask for caption if not provided
- NEVER post without user confirmation on what's being posted
- If user says "this", "that", "the image" → use useLastGenerated: true

STEP-BY-STEP WORKFLOW RULES:

>>> STEP 1: ASK FOR CAPTION (MANDATORY - DO NOT SKIP) <<<
        If the user has NOT provided a caption/text in their message:
      - DO NOT call post_to_social yet!
        - Ask: "What caption would you like for this [platform] post?"
          - Wait for their response before proceeding

            >>> STEP 2: ASK FOR PRIVACY SETTING(MANDATORY FOR TIKTOK / YOUTUBE) << <
              For TikTok and YouTube, ask the user:
- "Would you like this to be public or private?"
              - Default to private if they don't specify

                >>> STEP 3: CONFIRM AND POST << <
                  Only after you have BOTH caption AND privacy preference (if applicable):
                    - Call post_to_social with all the details
                      - Include the caption in the 'text' parameter

EXAMPLE FLOW:
  User: [uploads video] "post this to tiktok"
  AI: "Great! I'll post this video to TikTok. What caption would you like for this post?"
  User: "Check out my new video! #fyp"
  AI: "Would you like this to be public or private?"
  User: "public"
  AI: [calls post_to_social with text = "Check out my new video! #fyp", privacyLevel = "PUBLIC_TO_EVERYONE"]
  AI: "✅ Posted to TikTok! Caption: 'Check out my new video! #fyp'"

  WRONG(DO NOT DO THIS):
  User: [uploads video] "post this to tiktok"
  AI: [immediately calls post_to_social without asking for caption] ❌ WRONG!

  2. For Facebook / Instagram posting:
  - Follow caption steps above first
    - Then call post_to_social with the platform, caption, and content
      - If no page / account is selected, you'll get a response listing available pages
        - Present the pages to the user and ask which one to use
          - When user replies with page name / number, call post_to_social again with the pageId

  3. For X / LinkedIn:
  - Follow caption steps above, then call post_to_social directly

  4. If platform is NOT CONNECTED:
  - Tell user to connect, the UI will show a connect button

  5. DETECTING ATTACHED MEDIA:
  - If user says "post this", "post that", "post it", "post the image/video" → they're referring to an attached file
    - Check if there are attached files in the current message
      - If yes, use contentType: 'image' or 'video'(based on file type) and set useLastGenerated: true
        - Example: User uploads image + says "post this to instagram" → use contentType: 'image', useLastGenerated: true, NOT text: 'this'

EXAMPLE CONVERSATION:
  User: \"Post 'Hello world' to Facebook\"
  AI: [calls post_to_social with platforms: ['facebook']]
  System: \"You have 2 pages: 1. My Business, 2. Personal Page\"
  AI: \"I found 2 Facebook pages. Which would you like to post to: 1. My Business, or 2. Personal Page?\"
  User: \"My Business\"
  AI: [calls post_to_social with platforms: ['facebook'], pageId for \"My Business\" and text \"Hello world\"]
  System: \"Successfully posted!\"
  AI: \"Done! Your post 'Hello world' is now live on My Business.\"

  User: [attaches video] \"post this to tiktok and instagram\"
  AI: \"What caption would you like for this post?\"
  User: \"Check out this video! #fyp\"
  AI: [calls post_to_social with platforms: ['tiktok', 'instagram'], contentType: 'video', text: 'Check out this video! #fyp', useLastGenerated: true]
  System: \"✅ Posted to: TIKTOK, INSTAGRAM\"
  AI: \"Done! Posted to TikTok and Instagram with caption 'Check out this video! #fyp'\"

  MULTI - PLATFORM POSTING:
Use the platforms ARRAY to post to multiple platforms at once:
  - platforms: ['facebook', 'instagram'] → Posts to both
    - platforms: ['tiktok', 'youtube', 'x'] → Posts to all three
DO NOT make separate post_to_social calls for each platform!

⚠️⚠️⚠️ CRITICAL TOOL ROUTING - EMAIL vs SOCIAL MEDIA ⚠️⚠️⚠️

BEFORE calling ANY scheduling tool, FIRST determine the TARGET:

📧 EMAIL KEYWORDS → Use schedule_template_email tool:
- "email", "template", "leads", "newsletter", "email list"
- "send email", "schedule email", "email template"
- "send to leads", "email my leads", "email subscribers"
- "the [name] email", "the [name] template"
- Examples:
  • "schedule the awesome email" → schedule_template_email(templateName: "awesome")
  • "send email to my leads" → schedule_template_email(emailSource: "ask")
  • "email the newsletter to prospects table" → schedule_template_email(tableName: "prospects")

📱 SOCIAL MEDIA KEYWORDS → Use schedule_post tool:
- Platform names: "facebook", "instagram", "tiktok", "youtube", "x", "linkedin"
- "post to", "schedule to", "share on"
- Examples:
  • "schedule this to instagram" → schedule_post
  • "post this tomorrow" → schedule_post

🚨 DISAMBIGUATION RULES:
1. If user mentions "email" + "template" → ALWAYS use schedule_template_email
2. If user mentions "leads" or "email list" → ALWAYS use schedule_template_email
3. If user mentions a social platform name → Use schedule_post
4. If unclear → ASK: "Would you like to send an email or schedule a social media post?"

For schedule_template_email, extract the TEMPLATE NAME from natural language:
- "schedule the awesome email" → templateName: "awesome" (NOT "the awesome email")
- "send my welcome template" → templateName: "welcome"
- Strip words like "the", "my", "email", "template" to find the actual template name

SCHEDULING POSTS(schedule_post TOOL):
When the user wants to SCHEDULE a SOCIAL MEDIA post for the FUTURE(not post immediately), use the schedule_post tool.

SCHEDULING DETECTION - Use schedule_post when user says:
  - "schedule this to..."
    - "post this tomorrow at..."
    - "post at 8am"
    - "schedule for next week"
    - Any time reference in the future(e.g., "7am today", "tomorrow", "next Friday")

CRITICAL SCHEDULING WORKFLOW:
  1. If user says "schedule this [media] to [platforms] for [time]":
  - Ask for caption if not provided
    - DO NOT output any scheduling confirmation text yourself!

  2. Once user provides caption, YOU MUST call the schedule_post function tool!
    - platforms: array of platform names
      - scheduledAt: the time mentioned(e.g., "7am today", "tomorrow at 2pm")
        - contentType: 'video' or 'image' based on the attached / generated media
          - text: the caption the user provided
            - useLastGenerated: true(to use the attached / generated media)

  3. EXAMPLE SCHEDULING CONVERSATION:
  User: [uploads video] "schedule this to facebook, instagram, tiktok for 8:00am today"
  AI: "What caption would you like for this scheduled post?"
  User: "Check out my morning routine!"
  AI: [MUST call schedule_post function, NOT output text!]

⚠️ ABSOLUTELY FORBIDDEN - DO NOT DO THIS:
- User provides caption → AI outputs "Scheduling post for 8:00 AM..." ❌ WRONG!
  - User provides caption → AI outputs "✅ Post scheduled successfully!" ❌ WRONG!
    - You MUST call the schedule_post function tool, the SYSTEM will show the confirmation!
      - If you output scheduling text without calling the tool, NOTHING ACTUALLY GETS SCHEDULED!
`;

      // Add context about recently generated media with video generation disambiguation
      const generatedMediaContext = lastGeneratedAsset
        ? `\n\nRECENTLY GENERATED MEDIA:
You just generated a ${lastGeneratedAsset.type} (${lastGeneratedAsset.name}) ${Math.floor((Date.now() - lastGeneratedAsset.timestamp) / 1000)} seconds ago.
- If the user says "post that to [platform]", "post it to [platform]", or "share that on [platform]" → use contentType: '${lastGeneratedAsset.type}' and useLastGenerated: true
  - The system will automatically use this recently generated ${lastGeneratedAsset.type}

⚠️ VIDEO GENERATION vs SOCIAL POSTING - CRITICAL DISAMBIGUATION:
⚠️ VIDEO GENERATION vs SOCIAL POSTING - CRITICAL DISAMBIGUATION:
If user says any of these, use generate_project_video tool (NOT schedule_post!):
- "make it into a video" / "make it into an animated video"
- "animate this" / "animate the image" / "animate it"
- "turn it into a video" / "turn this into a video"
- "create a video from this" / "create a video from it" / "generate a video from it"
- "video from it" / "video of it"
These are VIDEO GENERATION requests, NOT social media posting requests!
Even if the user says "create a video for TikTok", this is a GENERATION request (to make a vertical video), NOT a posting request.
Only use schedule_post or post_to_social if the user explicitly says "POST", "SCHEDULE", or "SHARE".

Only use schedule_post / post_to_social when user explicitly mentions:
- "post this to [platform name]"
  - "schedule this to [platform name]"
  - "share this on [platform name]"
    `
        : '';

      // Add context about current attachments
      const currentAttachmentsContext = readyAttachments.length > 0
        ? `\n\nCURRENT ATTACHMENTS IN THIS MESSAGE:
The user has attached ${readyAttachments.length} file(s) to their current message:
${readyAttachments.map((att, i) => {
          const type = att.uploaded?.mimeType?.startsWith('video/') ? 'video' :
            att.uploaded?.mimeType?.startsWith('image/') ? 'image' : 'file';
          return `${i + 1}. ${type}: "${att.file.name}"`;
        }).join('\n')
        }

CRITICAL: When the user says "post this", "post that", "post it" in this message, they are referring to these attached files, NOT the word "this" / "that" / "it".
- Use contentType: 'video'(if video attached) or 'image'(if image attached)
- Set useLastGenerated: true to use the attachment
  - DO NOT use text: "this" or text: "that"
`
        : '';

      // Add conversation summary for better context awareness
      const conversationSummaryContext = messages.length > 2
        ? `

================================================================================
CONVERSATION CONTEXT - RECENT HISTORY
================================================================================
Last ${Math.min(messages.length, 5)} messages (newest first):
${messages.slice(-5).reverse().map((m, i) => {
          const truncatedText = m.text?.substring(0, 100) || '';
          const hasMedia = m.imageUrl ? ' [+ media]' : '';
          return `${i + 1}. [${m.role.toUpperCase()}]: ${truncatedText}${m.text && m.text.length > 100 ? '...' : ''}${hasMedia}`;
        }).join('\n')
        }

Intent Context:
- ${lastGeneratedAsset ? `Just generated: ${lastGeneratedAsset.type} (${lastGeneratedAsset.name}) ${Math.floor((Date.now() - lastGeneratedAsset.timestamp) / 1000)}s ago` : 'No recent content generation'}
- ${readyAttachments.length > 0 ? `User has ${readyAttachments.length} attachment(s) ready` : 'No attachments'}

IMPORTANT: Use this context to understand what "it", "this", "that" refer to in the user's current message.
`
        : '';

      const currentUiContext = activeTab === 'assets' && activeAssetTab === 'docs'
        ? `\n\nCURRENT UI CONTEXT: The user is currently viewing the Docs Editor in the Assets tab. You can read, edit, and append text to the current document using the docs tools (get_docs_draft, set_docs_draft_text, etc.). PRIORITIZE these tools for any editing requests. The user can see the document changes in real-time.\n`
        : activeTab === 'assets' && activeAssetTab === 'tables'
          ? `\n\nCURRENT UI CONTEXT: The user is currently viewing the Table Editor. Use table tools.\n`
          : `\n\nCURRENT UI CONTEXT: Active Tab: ${activeTab}, Active Asset Filter: ${activeAssetTab}\n`;

      let systemInstruction = contextService.getProjectSystemInstruction(project, 'chat', userProfile, activities || []) + '\n' + socialConnectionStatus + conversationSummaryContext + generatedMediaContext + currentAttachmentsContext + currentUiContext;

      const conversationHistory = (() => {
        const sanitized: { role: string; parts: { text: string }[] }[] = [];
        let lastRole = '';

        // Limit to last 30 messages to avoid overwhelming the model
        const recentMessages = messages.slice(-30);

        for (const msg of recentMessages) {
          const text = (msg.text || '').trim();
          // Skip empty model messages (previously failed turns)
          if (msg.role === 'model' && !text) continue;

          if (msg.role === lastRole && sanitized.length > 0) {
            // Merge consecutive messages from same role to satisfy API requirements
            sanitized[sanitized.length - 1].parts[0].text += `\n\n${text || ' '} `;
          } else {
            // Ensure at least a space for user messages if empty (unlikely but safe)
            sanitized.push({
              role: msg.role,
              parts: [{ text: text || (msg.role === 'user' ? ' ' : '') }]
            });
            lastRole = msg.role;
          }
        }
        console.log('[ProjectLiveAssistant] Sanitized history:', sanitized.length, 'messages');
        return sanitized;
      })();

      // Build parts for the current user message
      const userParts: any[] = [{ text: userMessage }];

      // Track attached images/videos for easy posting
      const imageOrVideoAtt = readyAttachments.find(a =>
        a.uploaded?.mimeType?.startsWith('image/') || a.uploaded?.mimeType?.startsWith('video/')
      );
      if (imageOrVideoAtt?.uploaded?.uri) {
        const isVideo = imageOrVideoAtt.uploaded.mimeType?.startsWith('video/');
        setLastGeneratedAsset({
          url: imageOrVideoAtt.uploaded.uri,
          publicUrl: (imageOrVideoAtt.uploaded as any).publicUrl, // Public URL from Vercel Blob
          type: isVideo ? 'video' : 'image',
          name: imageOrVideoAtt.uploaded.displayName || imageOrVideoAtt.file.name,
          timestamp: Date.now()
        });
      }

      for (const att of readyAttachments) {
        const u = att.uploaded;
        // Case 1: Already uploaded/project file (has URI)
        if (u?.uri) {
          userParts.push({
            text: `(Attached file: ${u.displayName || att.file.name})`
          });
          userParts.push(createPartFromUri(u.uri, u.mimeType || att.file.type || 'application/octet-stream'));
        }
        // Case 2: Local file (Blob/File) - Convert to Base64 for inlineData
        // Supports all Gemini-compatible media types: images, PDFs, audio, video
        else if (att.file) {
          const mimeType = att.file.type;
          const fileSize = att.file.size;

          // Check file type categories
          const isImage = mimeType.startsWith('image/');
          const isPdf = mimeType === 'application/pdf';
          const isAudio = mimeType.startsWith('audio/');
          const isVideo = mimeType.startsWith('video/');
          const isText = mimeType.startsWith('text/') ||
            mimeType === 'application/json' ||
            mimeType === 'application/xml' ||
            mimeType === 'application/yaml';

          // Warn about large files (inline data limit is ~20MB total)
          if (fileSize > 15 * 1024 * 1024) {
            console.warn(`Large file attachment (${(fileSize / 1024 / 1024).toFixed(1)}MB): ${att.file.name}`);
            userParts.push({
              text: `(Note: Large file "${att.file.name}" (${(fileSize / 1024 / 1024).toFixed(1)}MB) may take longer to process)`
            });
          }

          // Handle binary media files (images, PDFs, audio, video)
          if (isImage || isPdf || isAudio || isVideo) {
            try {
              const base64 = await blobToBase64(att.file);
              const data = base64.split(',')[1]; // Remove data:xxx;base64, prefix

              userParts.push({
                inlineData: {
                  mimeType: mimeType,
                  data: data
                }
              });

              // Add contextual label so Gemini knows to analyze this file
              const typeLabel = isImage ? 'image' : isPdf ? 'document' : isAudio ? 'audio file' : 'video';
              userParts.push({
                text: `(Attached ${typeLabel}: ${att.file.name}. Analyze this file to answer the user's question.)`
              });
            } catch (e) {
              console.error('Failed to process media attachment', e);
              userParts.push({ text: `(Failed to process attachment: ${att.file.name})` });
            }
          }
          // Handle text-based files directly
          else if (isText) {
            try {
              const textContent = await att.file.text();
              // Truncate very long text files to avoid token limits
              const maxChars = 50000;
              const truncated = textContent.length > maxChars
                ? textContent.slice(0, maxChars) + '\n\n[... content truncated ...]'
                : textContent;

              userParts.push({
                text: `(Attached text file: ${att.file.name}):\n\`\`\`\n${truncated}\n\`\`\``
              });
            } catch (e) {
              console.error('Failed to read text attachment', e);
              userParts.push({ text: `(Failed to read text file: ${att.file.name})` });
            }
          }
          // Unsupported file types
          else {
            console.warn('Unsupported attachment type:', mimeType);
            userParts.push({
              text: `(Unsupported file type: ${att.file.name} - ${mimeType}. Supported types: images, PDFs, audio, video, text files)`
            });
          }
        }
      }

      // Only include files if the user explicitly mentions them by name
      const normalizedMessage = userMessage.toLowerCase();
      const dataFiles = project.uploadedFiles || [];
      const kbFiles = project.knowledgeBase || [];

      let matchedUri: string | null = null;
      let matchedMime: string | null = null;
      let matchedDisplay: string | null = null;

      // Search Data tab uploads
      for (const file of dataFiles) {
        const displayName = (file.displayName || '').toLowerCase();
        const name = (file.name || '').toLowerCase();
        if (
          (displayName && normalizedMessage.includes(displayName)) ||
          (name && normalizedMessage.includes(name))
        ) {
          matchedUri = file.uri;
          matchedMime = file.mimeType || 'application/octet-stream';
          matchedDisplay = file.displayName || file.name;
          break;
        }
      }

      // Fallback to Knowledge Base files (generated assets & documents)
      if (!matchedUri) {
        for (const file of kbFiles) {
          const name = (file.name || '').toLowerCase();
          if (name && normalizedMessage.includes(name)) {
            matchedUri = file.url;
            matchedMime = file.type || 'application/octet-stream';
            matchedDisplay = file.name;
            break;
          }
        }
      }

      if (matchedUri && matchedMime && matchedDisplay) {
        userParts.push({
          text: `You have access to this project file(it may be an uploaded data file or a generated asset stored in the knowledge base): "${matchedDisplay}".Use this file to answer the user's question.`
        });
        userParts.push(createPartFromUri(matchedUri, matchedMime));
      }

      conversationHistory.push({
        role: 'user',
        parts: userParts
      });

      clearAttachments();

      const searchKnowledgeBaseChatTool = {
        name: 'search_knowledge_base',
        description: 'Search across ALL indexed documents in the project knowledge base to answer a question. Use this when the user asks a general question that may span multiple documents (e.g., "What do my documents say about pricing?").',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'The question or topic to search for across all project documents.'
            }
          },
          required: ['query']
        }
      };

      const getProjectResearchSessionsTool = {
        name: 'get_project_research_sessions',
        description: 'Get a summary of ALL research sessions in the project. Use this when the user asks about their research, research sessions, research findings, or wants a summary of what research has been done. This returns data from the Research Library in the Overview tab.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            includeFull: {
              type: Type.BOOLEAN,
              description: 'If true, include full session details. If false or omitted, return a summary.'
            }
          },
          required: []
        }
      };

      const getResearchSessionDetailsTool = {
        name: 'get_research_session_details',
        description: 'Get FULL details for a SPECIFIC research session by topic name or index. Use this when the user asks about a particular research topic (e.g., "Tell me about the AI research session" or "What did we find in research session 2?").',
        parameters: {
          type: Type.OBJECT,
          properties: {
            topic: {
              type: Type.STRING,
              description: 'The topic name to search for (partial match supported).'
            },
            index: {
              type: Type.NUMBER,
              description: 'The 1-based index of the session (e.g., 1 for first session).'
            }
          },
          required: []
        }
      };

      const getProjectOverviewTool = {
        name: 'get_project_overview',
        description: 'Get an overview of the current project including name, description, creation date, and counts of research sessions, tasks, notes, and files. Use this when the user asks "what is this project about?" or "tell me about this project" or wants a high-level summary.',
        parameters: {
          type: Type.OBJECT,
          properties: {},
          required: []
        }
      };

      const getProjectFileTool = {
        name: 'get_project_file',
        description: 'Retrieve and analyze a specific file from the project by name. Use this when the user mentions a specific file name and wants information about it (e.g., "tell me about the image X", "analyze the file Y", "what is in the document Z"). This works for images (PNG, JPG), PDFs, and other uploaded files.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            fileName: {
              type: Type.STRING,
              description: 'The name or partial name of the file to find and analyze.'
            }
          },
          required: ['fileName']
        }
      };

      const generateProjectImageTool = {
        name: 'generate_project_image',
        description: 'Generate a new image based on the user\'s request and full project context, save it to project assets, and include a preview in the chat.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Description of the image to generate.'
            },
            referenceImageUrl: {
              type: Type.STRING,
              description: 'Optional URL of an image to use as a style/structure reference.'
            }
          },
          required: ['prompt']
        }
      };

      const editProjectImageTool = {
        name: 'edit_project_image',
        description: 'Edit an existing/attached image using Gemini AI. AUTOMATICALLY DETECTS attached images - no URL needed. Use this when user wants to MODIFY an existing image (e.g., "make it daytime", "add clouds", "change the background", "remove the person", "make it brighter"). Do NOT use for generating NEW images.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            instruction: {
              type: Type.STRING,
              description: 'How to edit or change the image (e.g., "make it daytime", "add clouds").'
            },
            imageUrl: {
              type: Type.STRING,
              description: 'Optional URL of image to edit. If omitted, uses the most recently attached image.'
            }
          },
          required: ['instruction']
        }
      };

      const editProjectVideoTool = {
        name: 'edit_project_video',
        description: 'Edit an existing/attached video using xAI Grok. AUTOMATICALLY DETECTS attached videos. Max input video: 8.7 seconds. Use when user wants to MODIFY an existing video.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            instruction: {
              type: Type.STRING,
              description: 'How to edit or change the video.'
            },
            videoUrl: {
              type: Type.STRING,
              description: 'Optional URL of video to edit. If omitted, uses the most recently attached video.'
            }
          },
          required: ['instruction']
        }
      };

      const generateProjectVideoTool = {
        name: 'generate_project_video',
        description: 'Generate a short Sora video. Can generate from text OR animate an existing image. To animate an image, set imageUrl or useLastGenerated=true when user refers to an image ("animate this", "make a video of the image").',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Description of the video (subject, motion, style).'
            },
            aspect: {
              type: Type.STRING,
              description: 'Video resolution/aspect ratio.',
              enum: ['720x1280', '1280x720']
            },
            mode: {
              type: Type.STRING,
              description: 'Speed/quality tradeoff: speed -> sora-2, quality -> sora-2-pro.',
              enum: ['speed', 'quality']
            },
            model: {
              type: Type.STRING,
              description: 'Video generation model to use. Default is "sora". Use "veo" for Google Veo.',
              enum: ['sora', 'veo']
            },
            imageUrl: {
              type: Type.STRING,
              description: 'URL of an image to animate into a video (optional).'
            },
            assetName: {
              type: Type.STRING,
              description: 'Name of the asset to find and animate (e.g. "sunset image").'
            },
            useLastGenerated: {
              type: Type.BOOLEAN,
              description: 'Set to true to use the most recently generated or attached image.'
            }
          },
          required: ['prompt']
        }
      };

      const generateProjectBlogTool = {
        name: 'generate_project_blog',
        description: 'Generate a project-level blog article using research, notes, tasks, and assets, and save it into the latest research session.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'What the blog should focus on (angle, audience, style).'
            }
          },
          required: ['prompt']
        }
      };

      const generateProjectWebsiteTool = {
        name: 'generate_project_website',
        description: 'Generate a project-wide website experience using research, notes, tasks, and uploaded files, and save it to project assets.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'What the website should emphasize (goal, sections, tone).'
            }
          },
          required: ['prompt']
        }
      };

      const generateProjectPodcastTool = {
        name: 'generate_project_podcast',
        description: 'Generate a podcast episode using project research, notes, tasks, and assets, and save it to project assets.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'What the podcast should cover.'
            },
            style: {
              type: Type.STRING,
              description: 'Podcast style.',
              enum: ['conversational', 'educational', 'debate', 'interview']
            },
            duration: {
              type: Type.STRING,
              description: 'Approximate length.',
              enum: ['short', 'medium', 'long']
            }
          },
          required: ['prompt']
        }
      };

      const generateProjectBookTool = {
        name: 'generate_project_book',
        description: 'Generate an illustrated book using project research, notes, tasks, and assets, then save its pages and a compiled PDF into project assets (Books tab).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'What the book should focus on (audience, narrative, concepts, characters).'
            },
            pageCount: {
              type: Type.NUMBER,
              description: 'Approximate number of pages (4–24). Optional.'
            }
          },
          required: ['prompt']
        }
      };

      const runProjectSeoTool = {
        name: 'run_project_seo_analysis',
        description: 'Switch to the project SEO tab, run the RapidAPI keyword analysis, display results, and save key takeaways as a project note.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            keyword: {
              type: Type.STRING,
              description: 'Primary keyword to analyze.'
            },
            location: {
              type: Type.STRING,
              description: 'Country code for keyword stats (e.g., US, GB, CA).'
            }
          }
        }
      };

      const getDocsDraftTool = {
        name: 'get_docs_draft',
        description: 'Get the currently loaded Google Doc draft from the Assets > Docs tab editor (documentId/title/text).',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        }
      };

      const setDocsDraftTextTool = {
        name: 'set_docs_draft_text',
        description: 'Overwrite the entire Docs tab editor content with new text. Only works if a Google Doc is currently loaded in the Docs tab.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: 'The full new document text (plain text).' }
          },
          required: ['text']
        }
      };

      const appendDocsDraftTextTool = {
        name: 'append_docs_draft_text',
        description: 'Append text to the end of the Docs tab editor content. Only works if a Google Doc is loaded.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: 'Text to append.' },
            separator: { type: Type.STRING, description: 'Optional separator to insert before appended text (default: newline).' },
          },
          required: ['text']
        }
      };

      const replaceDocsDraftTextTool = {
        name: 'replace_docs_draft_text',
        description: 'Replace text inside the Docs tab editor content. Supports optional regex mode.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            find: { type: Type.STRING, description: 'Text (or regex pattern if useRegex=true) to find.' },
            replace: { type: Type.STRING, description: 'Replacement text.' },
            useRegex: { type: Type.BOOLEAN, description: 'If true, treat find as a regex pattern.' },
            caseSensitive: { type: Type.BOOLEAN, description: 'If true, use case-sensitive matching.' },
          },
          required: ['find', 'replace']
        }
      };

      const insertDocsInlineImageTool = {
        name: 'insert_docs_inline_image',
        description: 'Insert an inline image into the Docs tab editor at the current cursor position. The image URL must be publicly accessible (http/https).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            url: { type: Type.STRING, description: 'Public image URL (http/https).' },
            widthPx: { type: Type.NUMBER, description: 'Optional width in pixels.' },
            heightPx: { type: Type.NUMBER, description: 'Optional height in pixels.' },
          },
          required: ['url']
        }
      };

      const saveDocsDraftTool = {
        name: 'save_docs_draft',
        description: 'Save the current Docs tab editor content to the selected Google Doc (writes text + inline images).',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        }
      };

      const getTableDraftTool = {
        name: 'get_table_draft',
        description: 'Get the current table being edited in the Assets > Tables tab (title/columns/rows).',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        }
      };

      const setTableCellTool = {
        name: 'set_table_cell',
        description: 'Set a cell value in the Tables tab editor by row/column index.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            rowIndex: { type: Type.NUMBER, description: '0-based row index.' },
            colIndex: { type: Type.NUMBER, description: '0-based column index.' },
            value: { type: Type.STRING, description: 'New cell value.' },
          },
          required: ['rowIndex', 'colIndex', 'value']
        }
      };

      const addTableRowTool = {
        name: 'add_table_row',
        description: 'Add a row to the table in the Tables tab editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            index: { type: Type.NUMBER, description: 'Optional insertion index (0-based). Defaults to append.' }
          }
        }
      };

      const deleteTableRowTool = {
        name: 'delete_table_row',
        description: 'Delete a row from the table in the Tables tab editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            rowIndex: { type: Type.NUMBER, description: '0-based row index to delete.' }
          },
          required: ['rowIndex']
        }
      };

      const addTableColumnTool = {
        name: 'add_table_column',
        description: 'Add a column to the table in the Tables tab editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Optional column name.' },
            index: { type: Type.NUMBER, description: 'Optional insertion index (0-based). Defaults to append.' }
          }
        }
      };

      const deleteTableColumnTool = {
        name: 'delete_table_column',
        description: 'Delete a column from the table in the Tables tab editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            colIndex: { type: Type.NUMBER, description: '0-based column index to delete.' }
          },
          required: ['colIndex']
        }
      };

      const renameTableColumnTool = {
        name: 'rename_table_column',
        description: 'Rename a column in the table editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            colIndex: { type: Type.NUMBER, description: '0-based column index.' },
            name: { type: Type.STRING, description: 'New column name.' }
          },
          required: ['colIndex', 'name']
        }
      };

      const setTableTitleTool = {
        name: 'set_table_title',
        description: 'Set the table title in the Tables tab editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'New table title.' }
          },
          required: ['title']
        }
      };

      const setTableDescriptionTool = {
        name: 'set_table_description',
        description: 'Set the table description in the Tables tab editor.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING, description: 'New table description.' }
          },
          required: ['description']
        }
      };

      const setTableDraftTool = {
        name: 'set_table_draft',
        description: 'Replace the entire table in the Tables tab editor at once (title/description/columns/rows).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Optional table title.' },
            description: { type: Type.STRING, description: 'Optional table description.' },
            columns: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Full list of column headers.'
            },
            rows: {
              type: Type.ARRAY,
              items: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              description: 'Full 2D array of rows (each row is an array of strings).'
            },
          },
          required: ['columns', 'rows']
        }
      };

      const setTableRowsTool = {
        name: 'set_table_rows',
        description: 'Replace all table rows at once (keeps existing columns).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            rows: {
              type: Type.ARRAY,
              items: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              description: 'Full 2D array of rows.'
            },
          },
          required: ['rows']
        }
      };

      const setTableColumnsTool = {
        name: 'set_table_columns',
        description: 'Replace all table columns/headers at once (keeps existing rows).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            columns: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Full list of column headers.'
            },
          },
          required: ['columns']
        }
      };

      const setTableRowTool = {
        name: 'set_table_row',
        description: 'Replace an entire row by index.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            rowIndex: { type: Type.NUMBER, description: '0-based row index.' },
            row: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Full row values (array of strings).'
            },
          },
          required: ['rowIndex', 'row']
        }
      };

      const setTableColumnTool = {
        name: 'set_table_column',
        description: 'Replace an entire column by index (optionally rename the column).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            colIndex: { type: Type.NUMBER, description: '0-based column index.' },
            name: { type: Type.STRING, description: 'Optional new column header.' },
            column: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Column values for each row (array of strings). Missing entries become empty strings.'
            },
          },
          required: ['colIndex', 'column']
        }
      };

      const generateProjectTableTool = {
        name: 'generate_project_table',
        description: 'Generate a NEW table based on a prompt (e.g., "leads for software companies"). SAVES to Assets > Tables automatically. The generated table will be returned and opened.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Description of the table to generate (e.g., "List of top 10 tech companies with revenue and CEO").'
            }
          },
          required: ['prompt']
        }
      };

      const editProjectTableTool = {
        name: 'edit_project_table',
        description: 'Modify the currently open table based on instructions (e.g., "simplify column A", "add row for X", "delete duplicates"). Use this when the user wants to EDIT existing table data.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            instruction: {
              type: Type.STRING,
              description: 'Clear instruction on how to modify the table data.'
            }
          },
          required: ['instruction']
        }
      };

      const saveProjectTableTool = {
        name: 'save_project_table',
        description: 'Save the currently loaded table from Assets > Tables into the latest research session tables list.',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        }
      };

      const saveProjectTableToGoogleSheetTool = {
        name: 'save_table_to_google_sheet',
        description: 'Save the currently loaded table back to its linked Google Sheet (if linked).',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        }
      };

      // Tool to get connected social accounts (Facebook pages, Instagram accounts, etc.)
      const getConnectedAccountsTool = {
        name: 'get_connected_accounts',
        description: 'Get the list of connected social media accounts and pages. Use this BEFORE posting to Facebook or Instagram to get the available pages/accounts. Returns the list of pages for each platform.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            platform: {
              type: Type.STRING,
              description: 'Platform to get accounts for. Use "all" to get all connected accounts.',
              enum: ['facebook', 'instagram', 'all']
            }
          },
          required: ['platform']
        }
      };

      // Social media posting tool
      const postToSocialTool = {
        name: 'post_to_social',
        description: 'Post content to one or more social media platforms at once. Use the platforms array to post to multiple platforms in a single call. IMPORTANT: For Facebook, you MUST call get_connected_accounts first to get available pages. If any platform is not connected, will prompt for auth.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            platforms: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Array of platforms to post to. Example: ["facebook", "instagram", "tiktok"]. Valid: facebook, instagram, x, tiktok, youtube, linkedin'
            },
            platform: {
              type: Type.STRING,
              description: 'Single platform to post to (deprecated - use platforms array instead).',
              enum: ['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'linkedin']
            },
            contentType: {
              type: Type.STRING,
              description: 'Type of content to post.',
              enum: ['text', 'image', 'video']
            },
            text: {
              type: Type.STRING,
              description: 'Caption or post text content.'
            },
            pageId: {
              type: Type.STRING,
              description: 'Facebook Page ID to post to. Use this OR pageName.'
            },
            pageName: {
              type: Type.STRING,
              description: 'Facebook Page name to post to (case-insensitive, fuzzy matched). When user says a page name, use this. Example: "My Business Page"'
            },
            igAccountId: {
              type: Type.STRING,
              description: 'Instagram Account ID to post to. Use this OR igAccountName.'
            },
            igAccountName: {
              type: Type.STRING,
              description: 'Instagram account username to post to (case-insensitive). When user says an account name, use this. Example: "mybusiness"'
            },
            mediaUrl: {
              type: Type.STRING,
              description: 'URL of the image or video to post (from knowledge base or generated asset).'
            },
            assetId: {
              type: Type.STRING,
              description: 'Knowledge base asset ID to post (optional, alternative to mediaUrl).'
            },
            assetName: {
              type: Type.STRING,
              description: 'Name of the asset to find and post (e.g., "sunset image", "marketing video"). Will fuzzy-match against knowledge base asset names.'
            },
            useLastGenerated: {
              type: Type.BOOLEAN,
              description: 'Set to true to use the most recently generated or attached image/video. Useful when the user says "post that to Instagram".'
            },
            privacyLevel: {
              type: Type.STRING,
              description: 'Privacy setting for TikTok/YouTube. Defaults to "PUBLIC_TO_EVERYONE" / "public" if not specified. For TikTok: "PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY". For YouTube: "public", "private", "unlisted".',
              enum: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY', 'public', 'private', 'unlisted']
            }
          },
          required: ['platform', 'contentType']
        }
      };

      // Social media scheduling tool
      const schedulePostTool = {
        name: 'schedule_post',
        description: `Schedule a post to SOCIAL MEDIA platforms (Facebook, Instagram, X, TikTok, YouTube, LinkedIn) for publishing at a later time.

IMPORTANT: Do NOT use this tool for email templates or sending emails to leads.
- If user mentions "email template", "email to leads", "send template to leads" → use schedule_template_email instead
- This tool is ONLY for social media: facebook, instagram, x, tiktok, youtube, linkedin

Trigger words for this tool: "schedule to facebook/instagram/twitter/tiktok/youtube/linkedin", "post at", "post for tomorrow"
Set useLastGenerated=true when user says "this" or "the image/video".`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            platforms: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Platforms to post to: facebook, instagram, x, tiktok, youtube, linkedin'
            },
            scheduledAt: {
              type: Type.STRING,
              description: 'ISO 8601 datetime string for when to publish (e.g., "2025-12-24T14:00:00" or natural language like "tomorrow at 2pm", "7:15am today")'
            },
            contentType: {
              type: Type.STRING,
              description: 'Type of content to schedule.',
              enum: ['text', 'image', 'video']
            },
            text: {
              type: Type.STRING,
              description: 'Caption or post text content.'
            },
            mediaUrl: {
              type: Type.STRING,
              description: 'URL of the image or video to schedule (from knowledge base or generated asset).'
            },
            assetId: {
              type: Type.STRING,
              description: 'Knowledge base asset ID to schedule (optional, alternative to mediaUrl).'
            },
            assetName: {
              type: Type.STRING,
              description: 'Name of the asset to find and schedule (e.g., "sunset image", "marketing video"). Will fuzzy-match against knowledge base asset names.'
            },
            useLastGenerated: {
              type: Type.BOOLEAN,
              description: 'Set to true to use the most recently generated or attached image/video. ALWAYS set this to true when user says "schedule this video/image".'
            }
          },
          required: ['platforms', 'scheduledAt', 'contentType']
        }
      };

      // --- Task Management Tools ---
      const createProjectTaskTool = {
        name: 'create_project_task',
        description: 'Create a new task in the project task list.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Task title.' },
            description: { type: Type.STRING, description: 'Task description/details.' },
            priority: { type: Type.STRING, description: 'Priority level.', enum: ['low', 'medium', 'high'] }
          },
          required: ['title']
        }
      };

      const updateProjectTaskTool = {
        name: 'update_project_task',
        description: 'Update an existing task (mark as done, change priority, etc).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING, description: 'The ID of the task to update (from context).' },
            status: { type: Type.STRING, enum: ['todo', 'in_progress', 'done'] },
            priority: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
            title: { type: Type.STRING },
            description: { type: Type.STRING }
          },
          required: ['taskId']
        }
      };

      const deleteProjectTaskTool = {
        name: 'delete_project_task',
        description: 'Delete a task from the project.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING, description: 'ID of the task to delete.' }
          },
          required: ['taskId']
        }
      };

      // --- Note Management Tools ---
      const createProjectNoteTool = {
        name: 'create_project_note',
        description: 'Create a new note in the project notebook.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Note title.' },
            content: { type: Type.STRING, description: 'Note content.' }
          },
          required: ['title', 'content']
        }
      };

      const appendProjectNoteTool = {
        name: 'append_project_note',
        description: 'Append text to an existing note.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            noteId: { type: Type.STRING, description: 'ID of the note to append to.' },
            text: { type: Type.STRING, description: 'Text to append.' }
          },
          required: ['noteId', 'text']
        }
      };

      const deleteProjectNoteTool = {
        name: 'delete_project_note',
        description: 'Delete a note from the project.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            noteId: { type: Type.STRING, description: 'ID of the note to delete.' }
          },
          required: ['noteId']
        }
      };

      // --- Scheduling Management ---
      const deleteScheduledPostTool = {
        name: 'delete_scheduled_post',
        description: 'Cancel/Delete a scheduled social media post.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            postId: { type: Type.STRING, description: 'ID of the scheduled post to delete.' }
          },
          required: ['postId']
        }
      };

      // --- Research Tool ---
      const startProjectResearchTool = {
        name: 'start_new_research_session',
        description: 'Start a new deep research session on a topic using the Deep Research Agent. Takes time to complete.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            topic: { type: Type.STRING, description: 'The research topic or question.' }
          },
          required: ['topic']
        }
      };

      // --- Email Tools ---
      const sendEmailTool = {
        name: 'send_email',
        description: 'Send an email immediately via Gmail or Outlook. IMPORTANT: First check if user has Gmail or Outlook connected. If not connected, tell the user to connect their email in the Email tab first. Ask for recipient email, subject, and what the email should be about before sending.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            provider: {
              type: Type.STRING,
              description: 'Email provider to use: "gmail" or "outlook".',
              enum: ['gmail', 'outlook']
            },
            to: {
              type: Type.STRING,
              description: 'Recipient email address.'
            },
            subject: {
              type: Type.STRING,
              description: 'Email subject line.'
            },
            body: {
              type: Type.STRING,
              description: 'Email body content in HTML format. Can include formatting like <p>, <b>, <ul>, etc.'
            }
          },
          required: ['provider', 'to', 'subject', 'body']
        }
      };

      const scheduleEmailTool = {
        name: 'schedule_email',
        description: 'Schedule an email to be sent at a specific future time via Gmail or Outlook. Must be at least 10 minutes in the future and within 7 days. Ask for recipient, subject, content, and when to send.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            provider: {
              type: Type.STRING,
              description: 'Email provider to use: "gmail" or "outlook".',
              enum: ['gmail', 'outlook']
            },
            to: {
              type: Type.STRING,
              description: 'Recipient email address, or comma-separated list for multiple recipients.'
            },
            subject: {
              type: Type.STRING,
              description: 'Email subject line.'
            },
            body: {
              type: Type.STRING,
              description: 'Email body content in HTML format.'
            },
            scheduledTime: {
              type: Type.STRING,
              description: 'When to send the email. Natural language like "tomorrow at 9am", "next Monday at 2pm", "in 2 hours", or ISO 8601 datetime.'
            }
          },
          required: ['provider', 'to', 'subject', 'body', 'scheduledTime']
        }
      };

      const sendBulkEmailTool = {
        name: 'send_bulk_email',
        description: 'Send an email to multiple recipients from captured leads. Use this when user wants to email leads from their Forms tab. Ask what the email should be about and optionally which lead form to target.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            provider: {
              type: Type.STRING,
              description: 'Email provider to use: "gmail" or "outlook".',
              enum: ['gmail', 'outlook']
            },
            formId: {
              type: Type.STRING,
              description: 'Optional: ID of a specific lead form to filter recipients. If not provided, sends to all leads.'
            },
            subject: {
              type: Type.STRING,
              description: 'Email subject line.'
            },
            body: {
              type: Type.STRING,
              description: 'Email body content in HTML format. Can use {name} placeholder for personalization.'
            }
          },
          required: ['provider', 'subject', 'body']
        }
      };

      // --- PDF Generation Tool ---
      const generatePdfTool = {
        name: 'generate_pdf',
        description: 'Generate an illustrated PDF document (ebook, guide, report, brochure, etc.) using project context and AI. This tool has NO usage limits for Pro subscribers - always proceed to generate when requested. Ask user what type of document they want, the topic/focus, and optionally how many pages (4-24). The PDF will be saved to project assets and a download link provided.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'What the PDF should be about - topic, focus, audience, style. Be descriptive.'
            },
            pageCount: {
              type: Type.NUMBER,
              description: 'Number of pages (4-24). Defaults to 8 if not specified.'
            },
            documentType: {
              type: Type.STRING,
              description: 'Type of document to generate.',
              enum: ['ebook', 'guide', 'report', 'brochure', 'presentation', 'whitepaper', 'manual']
            }
          },
          required: ['prompt']
        }
      };

      const generateFormTool = {
        name: 'generate_form',
        description: 'Generate a lead capture form website. This tool costs 45 credits. Ask for title, design prompt, and fields (or suggest defaults). The form will be hosted at a unique URL and saved to Assets.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Title of the form (e.g. "Contact Us")' },
            prompt: { type: Type.STRING, description: 'Design prompt (e.g. "Modern blue theme")' },
            fields: {
              type: Type.ARRAY,
              description: 'List of fields to include',
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ['text', 'email', 'phone', 'textarea', 'select', 'checkbox'] },
                  required: { type: Type.BOOLEAN }
                },
                required: ['label', 'type']
              }
            }
          },
          required: ['title', 'prompt', 'fields']
        }
      };

      // --- Stripe Product Creation Tool ---
      const createStripeProductTool = {
        name: 'create_stripe_product',
        description: `Create a Stripe product with payment link for selling. IMPORTANT:
1. Check STRIPE PAYMENT CONNECTION STATUS in context (NOT social media connections!) 
2. If Stripe is NOT CONNECTED: Call this tool anyway - a "Connect Stripe" button will automatically appear for the user. Do NOT show X/Twitter or other social media connect buttons.
3. If Stripe IS CONNECTED: Just call this tool with the product details
4. Ask for: product name, description, and price before calling
5. For product image: use an attached image, use an asset from knowledge base, use last generated image, or proceed without
6. Product will be saved to Assets → Products with payment link

BRAINSTORMING: Help users think through:
- What makes their product unique?
- Ideal price point for their audience
- Compelling product description`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: 'Product name (e.g., "Complete Marketing Guide", "1-Hour Coaching Session")'
            },
            description: {
              type: Type.STRING,
              description: 'Product description for customers'
            },
            price: {
              type: Type.NUMBER,
              description: 'Price in dollars (e.g., 29.99, 199). NOT in cents.'
            },
            currency: {
              type: Type.STRING,
              description: 'Currency code.',
              enum: ['usd', 'eur', 'gbp', 'cad', 'aud']
            },
            imageUrl: {
              type: Type.STRING,
              description: 'Direct URL for product image (from uploaded asset or external).'
            },
            assetName: {
              type: Type.STRING,
              description: 'Name of an image in the knowledge base to use as product image (fuzzy match).'
            },
            useLastGenerated: {
              type: Type.BOOLEAN,
              description: 'Use the most recently generated image as the product image.'
            }
          },
          required: ['name', 'price']
        }
      };

      // --- World Generation Tool ---
      const generateWorldTool = {
        name: 'generate_world',
        description: `Generate an immersive 3D world using World Labs AI. WORKFLOW:
1. Ask user for a detailed text description of the world they want to create (lighting, mood, environment, atmosphere)
2. Optionally, user can provide an image or video as a reference/structure guide
3. For image input: use attached images, dropped images, conversation media, or knowledge base assets
4. For video input: use attached videos or conversation media
5. Generation takes ~5 minutes - world will appear in Assets → Worlds when ready
6. Call this tool with the prompt and inputType to start generation`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Detailed description of the world (e.g., "A bioluminescent forest at night with floating crystals and neon flora")'
            },
            inputType: {
              type: Type.STRING,
              enum: ['text', 'image', 'video'],
              description: 'Type of input: text-only, image-guided, or video-guided'
            },
            imageUrl: {
              type: Type.STRING,
              description: 'URL of image to use as structure guide (optional)'
            },
            videoUrl: {
              type: Type.STRING,
              description: 'URL of video to use as structure guide (optional)'
            },
            assetName: {
              type: Type.STRING,
              description: 'Name of an asset in knowledge base to use as guide (fuzzy match)'
            },
            useLastGenerated: {
              type: Type.BOOLEAN,
              description: 'Use the most recently generated image/video as guide'
            }
          },
          required: ['prompt', 'inputType']
        }
      };

      // --- Email Template Scheduling Tool ---
      const scheduleTemplateEmailTool = {
        name: 'schedule_template_email',
        description: `PRIORITY TOOL for sending emails to email lists. Use this tool FIRST when:

TRIGGER KEYWORDS (high priority):
- "schedule the [name] email" → templateName: name
- "send email to leads/table/list"
- "email the [name] template to [source]"
- "send newsletter to my prospects table"
- Any mention of: "email template", "email to leads", "email list", "send to table"

EMAIL LIST SOURCES - always ask which source if not specified:
- "leads" or "form" → Use captured leads from lead forms
- "table" → Use a table from Assets > Tables (find email column)
- "file" → Use uploaded CSV/Excel file

If user doesn't specify source, ASK which email list to use.
DO NOT use schedule_post for email - use THIS tool instead.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            templateName: {
              type: Type.STRING,
              description: 'Name of a saved email template to use (e.g., "awesome", "welcome"). Optional if subject/body provided.'
            },
            subject: {
              type: Type.STRING,
              description: 'Email subject line. Use if no templateName, or to override template subject.'
            },
            body: {
              type: Type.STRING,
              description: 'Email body content (HTML or plain text). Use if no templateName provided.'
            },
            emailSource: {
              type: Type.STRING,
              enum: ['leads', 'table', 'file', 'ask'],
              description: 'Where to get email addresses from: "leads" (from forms), "table" (Assets>Tables), "file" (uploaded CSV). Default: "ask" to prompt user.'
            },
            formName: {
              type: Type.STRING,
              description: 'For emailSource="leads": Specific form name to filter leads by.'
            },
            tableName: {
              type: Type.STRING,
              description: 'For emailSource="table": Name of table in Assets>Tables containing email addresses.'
            },
            fileName: {
              type: Type.STRING,
              description: 'For emailSource="file": Name of uploaded CSV/Excel file containing emails.'
            },
            scheduledAt: {
              type: Type.STRING,
              description: 'When to send: "now", "in 15 minutes", "tomorrow at 9am", or ISO date string. Default: now'
            },
            provider: {
              type: Type.STRING,
              enum: ['gmail', 'outlook'],
              description: 'Email provider to use. Default: gmail'
            }
          },
          required: []
        }
      };

      const tools = [
        { googleSearch: {} },
        {
          functionDeclarations: [
            searchKnowledgeBaseChatTool,
            getProjectResearchSessionsTool,
            getResearchSessionDetailsTool,
            getProjectOverviewTool,
            getProjectFileTool,
            generateProjectImageTool,
            editProjectImageTool,
            editProjectVideoTool,
            generateProjectVideoTool,
            generateProjectBlogTool,
            generateProjectWebsiteTool,
            generateProjectPodcastTool,
            runProjectSeoTool,
            getDocsDraftTool,
            setDocsDraftTextTool,
            appendDocsDraftTextTool,
            replaceDocsDraftTextTool,
            insertDocsInlineImageTool,
            saveDocsDraftTool,
            getTableDraftTool,
            setTableCellTool,
            addTableRowTool,
            deleteTableRowTool,
            addTableColumnTool,
            deleteTableColumnTool,
            renameTableColumnTool,
            setTableTitleTool,
            setTableDescriptionTool,
            setTableDraftTool,
            setTableRowsTool,
            setTableColumnsTool,
            setTableRowTool,
            setTableColumnTool,
            generateProjectTableTool,
            editProjectTableTool,
            saveProjectTableTool,
            saveProjectTableToGoogleSheetTool,
            getConnectedAccountsTool,
            postToSocialTool,
            schedulePostTool,
            // Task, Note, and Research Management (feature parity with Voice Mode)
            createProjectTaskTool,
            updateProjectTaskTool,
            deleteProjectTaskTool,
            createProjectNoteTool,
            appendProjectNoteTool,
            deleteProjectNoteTool,
            deleteScheduledPostTool,
            startProjectResearchTool,
            // Email Tools
            sendEmailTool,
            scheduleEmailTool,
            sendBulkEmailTool,
            // PDF Generation
            generatePdfTool,
            // Form Generation
            generateFormTool,
            // Stripe Product Creation
            createStripeProductTool,
            // World Generation
            generateWorldTool,
            // Email Template Scheduling
            scheduleTemplateEmailTool,
          ]
        },
        // Note: codeExecution removed - multi-tool (function calling + code execution)
        // is only supported in the Live API, not generateContentStream
      ];

      // Enable File Search in chat ONLY when the user's query seems to be asking
      // about uploaded file contents (PDFs, docs, etc.). This prevents the model
      // from ignoring system instruction context when fileSearch finds nothing.
      const fileSearchKeywords = [
        'file', 'document', 'pdf', 'upload', 'doc', 'docs', 'spreadsheet', 'excel',
        'csv', 'attached', 'attachment', 'data file', 'the file', 'my files',
        'my documents', 'in the file', 'from the file', 'in the document',
        'what does the', 'what do the', 'according to the', 'report', 'paper',
        'article', 'transcript', 'manuscript', 'text file', 'word document',
        'powerpoint', 'presentation', 'slides', 'readme', 'manual', 'guide'
      ];
      const lowerMessage = userMessage.toLowerCase();
      const shouldEnableFileSearch = fileSearchKeywords.some(kw => lowerMessage.includes(kw));

      try {
        if (shouldEnableFileSearch && project?.id) {
          const storeName = await getFileSearchStoreName();
          if (storeName) {
            tools.unshift({
              fileSearch: {
                fileSearchStoreNames: [storeName],
                metadataFilter: `project_id="${String(project.id).replace(/\"/g, '')}"`,
              }
            } as any);
            console.log('[ProjectLiveAssistant] File Search enabled for query about documents');
          }
        } else {
          console.log('[ProjectLiveAssistant] File Search NOT enabled - query does not appear to be about documents');
        }
      } catch (e) {
        console.warn('Failed to enable File Search tool for chat mode:', e);
      }

      // Create a placeholder assistant message that we'll stream into
      const streamingMessageId = crypto.randomUUID();
      setStreamingMessageId(streamingMessageId);
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

      // ========== SCHEDULING CONTEXT DETECTION ==========
      // Check if we're in a scheduling conversation by looking at recent conversation history
      // If AI asked for caption (indicating scheduling in progress), force schedule_post tool
      // ========== SCHEDULING CONTEXT DETECTION ==========
      // Check if we're in a scheduling conversation by looking at IMMEDIATE history only
      // If AI asked for caption (indicating scheduling in progress), force schedule_post tool
      let isSchedulingContext = false;
      const lastModelMsg = conversationHistory.filter(m => m.role === 'model').pop();
      const lowerCurrentMsg = userMessage.toLowerCase();

      // 🧠 THINK FIRST: Analyze intent before acting
      const intentAnalysis = await analyzeRequestIntent(
        userMessage,
        project,
        messages.slice(-5)
      );

      console.log('🧠 Thought Process:', intentAnalysis.thoughtProcess);
      console.log('🎯 Detected Intent:', intentAnalysis.intent);

      // Inject the thought process as a system hint for the main model
      // This guides the "Hands" based on the "Brain's" plan
      systemInstruction += `\n\n🧠 BRAIN PRE-ANALYSIS (FOLLOW THIS PLAN):\n${intentAnalysis.thoughtProcess}\nDetected Intent: ${intentAnalysis.intent}\nRecommended Tools: ${intentAnalysis.recommendedTools.join(', ')}`;

      // If planner says disambiguation needed, we could potentially handle it here or let the model use the info to ask better questions.


      // 1. Check if last model response was asking for a caption
      if (lastModelMsg) {
        const text = lastModelMsg.parts?.[0]?.text?.toLowerCase() || '';
        const captionAskPatterns = [
          /what\s+caption/i,
          /caption\s+would\s+you/i,
          /like\s+for\s+(this|the)\s+(scheduled|post)/i,
          /caption\s+for\s+(this|the)/i,
          /text\s+for\s+(this|the)\s+post/i,
          /what\s+(should|would)\s+(the|i)\s+caption/i,
          /when\s+would\s+you\s+like\s+to\s+schedule/i,
          /what\s+time/i,
          /scheduled\s+time/i
        ];
        if (captionAskPatterns.some(p => p.test(text))) {
          isSchedulingContext = true;
          console.log('[Scheduling] Detected caption request in last message - forcing schedule_post tool');
        }
      }

      // 2. Check if current message is an explicit schedule command
      const schedulePatterns = [
        /schedule\s+(this|that|the|it)/i,
        /post\s+(this|that|it)\s+(to|on)/i,
        /for\s*\d{1,2}(:\d{2})?\s*(am|pm)/i,
        /tomorrow\s+at/i,
        /today\s+at/i,
        /next\s+(week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i
      ];
      if (schedulePatterns.some(p => p.test(lowerCurrentMsg))) {
        isSchedulingContext = true;
      }

      // 3. ESCAPE HATCH: If user wants to do something else (search, generate, cancel, EMAIL), DISABLE forced context
      const escapePatterns = [
        /^cancel/i, /^stop/i, /^no\s+wait/i, /^wait/i, /^nevermind/i, /^actually/i,
        /search\s+(for|knowledge|docs|files|web)/i,
        /find\s+/i,
        /generate\s+(image|video|blog|website|table)/i,
        // Video generation / animation phrases - should NOT trigger schedule_post
        /make\s+(it|this|that)\s+(into|a|an)\s*(animated)?\s*video/i,
        /animate\s+(it|this|that|the)/i,
        /turn\s+(it|this|that)\s+into\s+a?\s*video/i,
        /create\s+(a|an)?\s*video/i,
        /(animated|animation)\s*video/i,
        /into\s+(a|an)?\s*(animated)?\s*video/i,
        /brows(e|er)/i, /open\s+browser/i, /navigate/i,
        /do\s+something\s+else/i,
        /help/i, /what\s+can\s+you\s+do/i,
        /^no$/i, /^nope$/i,
        // EMAIL-related patterns - should use schedule_template_email instead
        /email\s+template/i,
        /email\s+to\s+leads/i,
        /email\s+to\s+(my\s+)?list/i,
        /send\s+(the\s+)?.*email/i,
        /schedule\s+(the\s+)?.*email/i,
        /template\s+to\s+leads/i,
        /email\s+.*table/i,
        /email\s+my\s+/i,
        /to\s+leads/i,
        /newsletter/i
      ];

      if (escapePatterns.some(p => p.test(lowerCurrentMsg))) {
        console.log('[Scheduling] Escape pattern detected - disabling forced scheduling context');
        isSchedulingContext = false;
      }

      if (isSchedulingContext) {
        console.log('[Scheduling] Context detected! Forcing toolConfig mode to ANY for schedule_post');
      }

      // Determine toolConfig based on scheduling context
      const toolConfig = isSchedulingContext
        ? {
          functionCallingConfig: {
            mode: 'ANY' as any,
            allowedFunctionNames: ['schedule_post']
          }
        }
        : {
          functionCallingConfig: {
            mode: 'AUTO' as any
          }
        };

      // ------------------------------------------------------------------
      // MODEL & TOOL COMPATIBILITY FIX
      // Gemini 3 does not yet support combining built-in tools (googleSearch, fileSearch)
      // with custom functions. We must dynamically select the model or filter tools.
      // ------------------------------------------------------------------

      // 1. Check if built-in tools are needed
      // Expanded regex to catch more natural language search requests (e.g. "top vc firms", "market trends", "latest news")
      const searchKeywords = /web\s*search|google|internet|latest|current|weather|stock|market|price|trend|ranking|top\s+|best\s+|vs\s+|compare|venture\s*capital|startups?|companies|2025|2026|find\s+out|research/i;
      const needsGoogleSearch = intentAnalysis.recommendedTools.includes('web_search') ||
        intentAnalysis.recommendedTools.includes('google_search') ||
        searchKeywords.test(userMessage);

      // shouldEnableFileSearch is already calculated based on file/doc keywords (line 9158)
      const needsBuiltInTools = needsGoogleSearch || shouldEnableFileSearch;

      // 2. Select Model
      // - Gemini 2.5 Flash: Supports EVERYTHING (Built-in Tools + Functions)
      // - Gemini 3 Flash: Smarter, but NO MIXING (Functions OR Built-in, not both)
      const targetModel = needsBuiltInTools ? 'gemini-2.5-flash' : 'gemini-3-flash-preview';

      // 3. Filter Tools for Compatibility
      // STRICT SEPARATION: The standard Gemini API (REST) does not support mixing Built-in Tools (Search) 
      // with Function Declarations. We must explicitly separate them.

      // Define the tool sets explicitly to avoid filtering errors
      const searchTools = [{ googleSearch: {} }];
      // The function declarations are in the second element of the tools array (index 1)
      const functionTools = tools.length > 1 ? [tools[1]] : [];

      // Select the correct tool set
      const runtimeTools = needsBuiltInTools ? searchTools : functionTools;

      console.log(`[ProjectLiveAssistant] Using model: ${targetModel}, Built-in Tools Needed: ${needsBuiltInTools}`);

      // Get fallback chain starting from the target model
      const fallbackModels = needsBuiltInTools
        ? MODEL_FALLBACK_CHAINS.standard // 2.5 Flash chain for built-in tools
        : MODEL_FALLBACK_CHAINS.fast;    // 3 Flash chain for function calling

      let stream: any = null;
      let lastError: any = null;
      let usedModel = targetModel;

      for (const modelName of fallbackModels) {
        try {
          console.log(`[ProjectLiveAssistant] Trying model: ${modelName}`);

          // Recalculate config for each model attempt
          const modelConfig: any = {
            systemInstruction: systemInstruction,
            temperature: 0,
            maxOutputTokens: 8192,
            tools: runtimeTools,
            toolConfig: needsBuiltInTools ? undefined : toolConfig,
          };

          // Only add thinkingConfig for Gemini 3 models
          if (modelName.includes('gemini-3')) {
            modelConfig.thinkingConfig = { includeThoughts: true };
          }

          stream = await ai.models.generateContentStream({
            model: modelName,
            contents: conversationHistory,
            config: modelConfig,
          });

          usedModel = modelName;
          console.log(`[ProjectLiveAssistant] ✅ Success with model: ${modelName}`);
          break; // Success, exit loop
        } catch (err: any) {
          lastError = err;
          console.warn(`[ProjectLiveAssistant] Model ${modelName} failed:`, err.message || err);
          if (!isRetryableError(err)) {
            // Non-retryable error, don't try other models
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

            // Incrementally update the streaming assistant message
            setMessages(prev =>
              prev.map(msg =>
                msg.id === streamingMessageId
                  ? { ...msg, text: (msg.text || '') + textChunk }
                  : msg
              )
            );
          } else if (part.functionCall) {
            const fc = part.functionCall;
            const fcId = (fc as any)?.id;
            if (fcId !== undefined && fcId !== null) {
              const idKey = String(fcId);
              const existingIndex = aggregatedFunctionCalls.findIndex((f: any) => String((f as any)?.id) === idKey);
              if (existingIndex >= 0) {
                aggregatedFunctionCalls[existingIndex] = fc;
              } else {
                aggregatedFunctionCalls.push(fc);
              }
            } else {
              aggregatedFunctionCalls.push(fc);
            }
          }
        }
      }

      // Debug: Log what we received from the stream
      console.log('[ProjectLiveAssistant] Stream complete. fullText length:', fullText.length, 'functionCalls:', aggregatedFunctionCalls.length, 'grounding:', !!latestGroundingMetadata);

      // Stop spinner on the streaming message and ensure we have text
      setMessages(prev =>
        prev.map(msg => {
          if (msg.id !== streamingMessageId) return msg;

          let finalText = (msg.text || '').trim();

          // If no text was generated and no functions were called, use fallback
          // This handles cases where the API returns 200 but no useful content
          if (!finalText && !fullText.trim()) {
            console.warn('[ProjectLiveAssistant] No text generated, using fallback. FunctionCalls:', aggregatedFunctionCalls.length);
            // Only show fallback if there are also no function calls to process
            if (aggregatedFunctionCalls.length === 0) {
              finalText = 'I was unable to generate a response. This might be due to a large conversation history. Please try clearing the chat or asking in a different way.';
            }
          }

          // ══════════════════════════════════════════════════════════════
          // APPLY INLINE CITATIONS (Google Search / File Search)
          // ══════════════════════════════════════════════════════════════
          if (latestGroundingMetadata) {
            try {
              finalText = resolveCitations({
                text: finalText,
                candidates: [{ groundingMetadata: latestGroundingMetadata }]
              } as any);
            } catch (ce) {
              console.warn('Failed to resolve citations:', ce);
            }
          }

          return { ...msg, text: finalText, isGenerating: false };
        })
      );

      // If File Search (or other grounding) returned citations, append a clean sources list
      try {
        const chunks = latestGroundingMetadata?.groundingChunks;
        if (Array.isArray(chunks) && chunks.length > 0) {
          const sources: string[] = [];

          chunks.forEach((c: any, idx: number) => {
            const webUri = c?.web?.uri;
            const webTitle = c?.web?.title;
            const mapsUri = c?.maps?.desktopUri;
            const mapsTitle = c?.maps?.sourceConfig?.title;
            const retrievedUri = c?.retrievedContext?.uri;
            const retrievedTitle = c?.retrievedContext?.title;
            // const retrievedText = c?.retrievedContext?.text;

            let sourceLine = '';
            if (webUri || webTitle) {
              sourceLine = `[${idx + 1}] ${webTitle || 'Web Source'} [view](${webUri})`;
            } else if (mapsUri || mapsTitle) {
              sourceLine = `[${idx + 1}] ${mapsTitle || 'Map Source'} [view](${mapsUri})`;
            } else if (retrievedUri || retrievedTitle) {
              sourceLine = `[${idx + 1}] ${retrievedTitle || 'Project Document'} [view](${retrievedUri})`;
            } else {
              sourceLine = `[${idx + 1}] Source ${idx + 1}`;
            }

            if (sourceLine) sources.push(sourceLine);
          });

          if (sources.length > 0) {
            const deduped = Array.from(new Set(sources)).slice(0, 15);
            const citationBlock = `\n\n**Sources:**\n${deduped.join('\n')}`;
            setMessages(prev =>
              prev.map(msg =>
                msg.id === streamingMessageId
                  ? { ...msg, text: (msg.text || '') + citationBlock }
                  : msg
              )
            );
          }
        }
      } catch (e) {
        console.warn('Failed to append citations from grounding metadata:', e);
      }

      if (aggregatedFunctionCalls.length > 0) {
        // Preserve existing tool behavior, now using the aggregated function calls
        for (const fc of aggregatedFunctionCalls) {
          const args = fc.args || {};

          // ------------------------------------------------------------------
          // RELIABILITY FIX: Client-side Intent Redirection
          // Catch "schedule email" requests incorrectly routed to schedule_post
          // ------------------------------------------------------------------
          if (fc.name === 'schedule_post') {
            const rawText = String(args.text || '').toLowerCase();
            const platform = String(args.platform || '').toLowerCase();
            const platforms = Array.isArray(args.platforms) ? args.platforms.map((p: any) => String(p).toLowerCase()) : [];

            // Strong email indicators
            const emailKeywords = ['email', 'template', 'leads', 'newsletter', 'subscriber', 'send to list'];
            const hasEmailKeyword = emailKeywords.some(w => rawText.includes(w));

            // Social indicators (don't redirect if these are present)
            const socialKeywords = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'twitter'];
            const hasSocialIntent = platforms.some(p => socialKeywords.includes(p)) ||
              socialKeywords.includes(platform) ||
              socialKeywords.some(w => rawText.includes(w));

            if (hasEmailKeyword && !hasSocialIntent) {
              console.log('[Routing Fix] 🔀 Redirecting schedule_post -> schedule_template_email based on intent');
              fc.name = 'schedule_template_email';

              // Map 'text' to 'templateName' if not already set
              if (!args.templateName && args.text) {
                // Heuristic: if text starts with "schedule", strip it to get template name
                let potentialName = args.text;
                if (potentialName.toLowerCase().startsWith('schedule ')) {
                  potentialName = potentialName.substring(9);
                }
                args.templateName = potentialName;
              }

              // Ensure emailSource is at least 'ask' if strictly missing
              if (!args.emailSource) {
                args.emailSource = 'ask';
              }
            }
          }
          // ------------------------------------------------------------------
          if (fc.name === 'search_knowledge_base') {
            const query = String(args.query || '');
            try {
              const result = await searchKnowledgeBase(query, project.id);
              let text = result.answer;
              if (result.citations.length > 0) {
                text += '\n\n**Sources:**\n';
                result.citations.forEach((c: any, idx: number) => {
                  text += `${idx + 1}. ${c.title}\n`;
                });
              }
              if (!fullText.trim()) {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: (m.text || '') + (m.text ? '\n\n' : '') + text, isGenerating: false } : m));
              } else {
                addMessage('model', text);
              }
            } catch (e: any) {
              const errText = `Failed to search knowledge base: ${e?.message || e}`;
              if (!fullText.trim()) {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: (m.text || '') + (m.text ? '\n\n' : '') + errText, isGenerating: false } : m));
              } else {
                addMessage('model', errText);
              }
            }
          } else if (fc.name === 'get_project_research_sessions') {
            // Return research sessions from the project
            const sessions = project.researchSessions || [];
            const includeFull = args.includeFull === true;
            let text = '';
            if (sessions.length === 0) {
              text = 'This project has no research sessions yet. Research sessions are created when you run Deep Research from the Overview tab.';
            } else {
              text = `## Research Sessions (${sessions.length} total)\n\n`;
              sessions.forEach((session: any, idx: number) => {
                const topic = session.topic || 'Untitled Research';
                const summary = session.summary || '';
                const date = session.createdAt ? new Date(session.createdAt).toLocaleDateString() : 'Unknown date';
                text += `### ${idx + 1}. ${topic}\n`;
                text += `**Date:** ${date}\n`;
                if (summary) {
                  text += `**Summary:** ${includeFull ? summary : summary.slice(0, 300) + (summary.length > 300 ? '...' : '')}\n`;
                }
                if (includeFull && session.keyFindings && session.keyFindings.length > 0) {
                  text += `**Key Findings:**\n`;
                  session.keyFindings.forEach((f: string) => {
                    text += `- ${f}\n`;
                  });
                }
                text += '\n';
              });
            }
            if (!fullText.trim()) {
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: (m.text || '') + text, isGenerating: false } : m));
            } else {
              addMessage('model', text);
            }
          } else if (fc.name === 'get_research_session_details') {
            // Return details for a specific research session
            const sessions = project.researchSessions || [];
            const topicQuery = (args.topic || '').toString().toLowerCase();
            const indexArg = args.index as number | undefined;
            let session: any = null;
            let sessionIdx = -1;

            if (indexArg !== undefined && indexArg >= 1 && indexArg <= sessions.length) {
              sessionIdx = indexArg - 1;
              session = sessions[sessionIdx];
            } else if (topicQuery) {
              sessionIdx = sessions.findIndex((s: any) => (s.topic || '').toLowerCase().includes(topicQuery));
              if (sessionIdx >= 0) {
                session = sessions[sessionIdx];
              }
            }

            let text = '';
            if (!session) {
              text = `Could not find a research session matching your query. Available sessions:\n`;
              sessions.forEach((s: any, idx: number) => {
                text += `${idx + 1}. ${s.topic || 'Untitled'}\n`;
              });
            } else {
              const topic = session.topic || 'Untitled Research';
              const summary = session.summary || 'No summary available.';
              const date = session.createdAt ? new Date(session.createdAt).toLocaleDateString() : 'Unknown date';
              text = `## Research Session: ${topic}\n\n`;
              text += `**Date:** ${date}\n\n`;
              text += `**Summary:**\n${summary}\n\n`;
              if (session.keyFindings && session.keyFindings.length > 0) {
                text += `**Key Findings:**\n`;
                session.keyFindings.forEach((f: string) => {
                  text += `- ${f}\n`;
                });
                text += '\n';
              }
              if (session.sources && session.sources.length > 0) {
                text += `**Sources:**\n`;
                session.sources.slice(0, 10).forEach((src: any) => {
                  text += `- ${src.title || src.url || 'Unnamed source'}\n`;
                });
              }
              if (session.conversation && session.conversation.length > 0) {
                text += `\n**Conversation excerpts available** (${session.conversation.length} messages)`;
              }
            }
            if (!fullText.trim()) {
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: (m.text || '') + text, isGenerating: false } : m));
            } else {
              addMessage('model', text);
            }
          } else if (fc.name === 'get_project_overview') {
            // Return project overview info
            const sessions = project.researchSessions || [];
            const tasks = project.tasks || [];
            const notes = project.notes || [];
            const files = project.uploadedFiles || [];
            const kb = project.knowledgeBase || [];
            let text = `## Project: ${project.name || 'Untitled'}\n\n`;
            text += `**Description:** ${project.description || 'No description provided.'}\n\n`;
            text += `**Created:** ${project.createdAt ? new Date(project.createdAt).toLocaleDateString() : 'Unknown'}\n`;
            text += `**Last Updated:** ${project.lastModified ? new Date(project.lastModified).toLocaleDateString() : 'Unknown'}\n\n`;
            text += `**Contents:**\n`;
            text += `- ${sessions.length} Research Session${sessions.length !== 1 ? 's' : ''}\n`;
            text += `- ${tasks.length} Task${tasks.length !== 1 ? 's' : ''}\n`;
            text += `- ${notes.length} Note${notes.length !== 1 ? 's' : ''}\n`;
            text += `- ${files.length} Uploaded File${files.length !== 1 ? 's' : ''}\n`;
            text += `- ${kb.length} Knowledge Base Item${kb.length !== 1 ? 's' : ''}\n`;
            if (sessions.length > 0) {
              text += `\n**Research Topics:**\n`;
              sessions.slice(0, 5).forEach((s: any) => {
                text += `- ${s.topic || 'Untitled'}\n`;
              });
              if (sessions.length > 5) text += `...and ${sessions.length - 5} more\n`;
            }
            if (!fullText.trim()) {
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: (m.text || '') + text, isGenerating: false } : m));
            } else {
              addMessage('model', text);
            }
          } else if (fc.name === 'get_project_file') {
            // Find and return info about a specific file from the project
            const fileNameQuery = (args.fileName || '').toString().toLowerCase();
            const allFiles = [
              ...(project.uploadedFiles || []).map((f: any) => ({ ...f, source: 'Data Tab' })),
              ...(project.knowledgeBase || []).map((f: any) => ({ ...f, source: 'Knowledge Base' }))
            ];
            const matchedFile = allFiles.find((f: any) =>
              (f.name || f.displayName || '').toLowerCase().includes(fileNameQuery) ||
              (f.displayName || '').toLowerCase().includes(fileNameQuery)
            );

            let text = '';
            if (!matchedFile) {
              text = `Could not find a file matching "${args.fileName}". Available files:\n`;
              allFiles.slice(0, 10).forEach((f: any) => {
                text += `- ${f.name || f.displayName || 'Unnamed'} (${f.source})\n`;
              });
              if (allFiles.length > 10) text += `...and ${allFiles.length - 10} more\n`;
            } else {
              const fileName = matchedFile.name || matchedFile.displayName || 'Unnamed file';
              const fileType = matchedFile.mimeType || matchedFile.type || 'Unknown type';
              text = `## File: ${fileName}\n\n`;
              text += `**Type:** ${fileType}\n`;
              text += `**Source:** ${matchedFile.source}\n`;
              if (matchedFile.description) text += `**Description:** ${matchedFile.description}\n`;
              if (matchedFile.createdAt) text += `**Uploaded:** ${new Date(matchedFile.createdAt).toLocaleDateString()}\n`;

              // For images, include the image in the response if we have a URL
              if (matchedFile.url || matchedFile.uri) {
                const imageUrl = matchedFile.url || matchedFile.uri;
                if (fileType.startsWith('image/')) {
                  text += `\n*Image preview included below.*`;
                  if (!fullText.trim()) {
                    setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: text, imageUrl: imageUrl, isGenerating: false } : m));
                  } else {
                    addMessage('model', text, imageUrl);
                  }
                  continue; // Skip the default text-only update below
                } else {
                  text += `\n**URL:** ${imageUrl}`;
                }
              }
            }
            if (!fullText.trim()) {
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: (m.text || '') + text, isGenerating: false } : m));
            } else {
              addMessage('model', text);
            }
          } else if (fc.name === 'generate_project_image') {
            try {
              const prompt = (args.prompt || userMessage).toString();
              const refUrl = args.referenceImageUrl ? String(args.referenceImageUrl) : undefined;
              let manualRefs: ImageReference[] = [];

              if (refUrl) {
                const base64 = await fetchImageAsBase64(refUrl);
                if (base64) manualRefs.push({ base64, mimeType: 'image/png' });
              }

              const { imageUrl } = await generateProjectImageAsset(prompt, manualRefs);
              // Track for easy posting
              setLastGeneratedAsset({ url: imageUrl, type: 'image', name: prompt.slice(0, 50), timestamp: Date.now() });
              const text = 'I generated an image based on your request and saved it to your project assets.';

              // Remove the empty streaming placeholder to prevent "double indicators" / stuck thinking dots
              setMessages(prev => prev.filter(m => m.id !== streamingMessageId));

              addMessage('model', text, imageUrl);
              setIsProcessing(false); // Force unlock UI
            } catch (err: any) {
              console.error('Image generation failed:', err);
              addMessage('model', `Failed to generate image: ${err.message || 'Unknown error'}`);
              setIsProcessing(false); // Force unlock UI
            }
          } else if (fc.name === 'edit_project_image') {
            // Edit attached image using Gemini
            try {
              const instruction = (args.instruction || '').toString();
              const imageUrlArg = (args.imageUrl || '').toString();

              // Find image from pending attachments (has the actual File object)
              let imageReference: { base64?: string; fileUri?: string; mimeType: string } | null = null;

              // Check pending attachments - use the file directly
              const imageAtt = pendingAttachments.find(a =>
                a.file?.type?.startsWith('image/') && a.status === 'ready'
              );

              if (imageAtt?.file) {
                const base64 = await blobToBase64(imageAtt.file);
                imageReference = { base64, mimeType: imageAtt.file.type || 'image/png' };
                console.log('[edit_project_image] Using attached image file');
              }

              // Priority 2: Check conversation media (recently dropped/attached)
              if (!imageReference && currentConversationMedia.length > 0) {
                const recentImage = currentConversationMedia.find(m => m.type === 'image');
                if (recentImage) {
                  try {
                    const url = recentImage.publicUrl || recentImage.url;

                    // Check if it's a Gemini URI
                    const isGeminiUri = url.includes('generativelanguage.googleapis.com') || url.startsWith('gs://');

                    if (isGeminiUri) {
                      imageReference = { fileUri: url, mimeType: 'image/png' } as any;
                      console.log('[edit_project_image] Using tracked conversation media (Gemini URI)');
                    } else {
                      const res = await fetch(url);
                      if (res.ok) {
                        const blob = await res.blob();
                        const base64 = await blobToBase64(blob);
                        imageReference = { base64, mimeType: blob.type || 'image/png' };
                        console.log('[edit_project_image] Using tracked conversation media (fetched)');
                      }
                    }
                  } catch (e) {
                    console.warn('[edit_project_image] Failed to fetch tracked media:', e);
                  }
                }
              }

              // Fallback to lastGeneratedAsset
              if (!imageReference && lastGeneratedAsset?.type === 'image') {
                try {
                  const urlToFetch = lastGeneratedAsset.publicUrl || lastGeneratedAsset.url;
                  const res = await fetch(urlToFetch);
                  if (res.ok) {
                    const blob = await res.blob();
                    const base64 = await blobToBase64(blob);
                    imageReference = { base64, mimeType: blob.type || 'image/png' };
                    console.log('[edit_project_image] Using lastGeneratedAsset');
                  }
                } catch (e) {
                  console.warn('[edit_project_image] Failed to fetch lastGeneratedAsset:', e);
                }
              }

              // Fallback to provided URL
              if (!imageReference && imageUrlArg) {
                try {
                  const res = await fetch(imageUrlArg);
                  if (res.ok) {
                    const blob = await res.blob();
                    const base64 = await blobToBase64(blob);
                    imageReference = { base64, mimeType: blob.type || 'image/png' };
                    console.log('[edit_project_image] Using URL from args');
                  }
                } catch (e) {
                  console.warn('[edit_project_image] Failed to fetch imageUrl:', e);
                }
              }

              if (!imageReference) {
                addMessage('model', 'No image found to edit. Please attach or drop an image first.');
                setIsProcessing(false);
                continue;
              }

              // Credit check
              const hasCredits = await checkCredits('imageGenerationFast');
              if (!hasCredits) {
                addMessage('model', 'Insufficient credits for image editing.');
                setIsProcessing(false);
                continue;
              }
              await deductCredits('imageGenerationFast');

              // Use Gemini's native image editing
              const { editImageWithReferences } = await import('../services/geminiService');
              const editResult = await editImageWithReferences(
                instruction,
                [imageReference],
                { useProModel: true }
              );

              const editedUrl = editResult.imageDataUrl;

              // Save to KB
              try {
                const res = await fetch(editedUrl);
                const blob = await res.blob();
                const file = new File([blob], `voice-image-edit-${Date.now()}.png`, { type: 'image/png' });
                const kb = await storageService.uploadKnowledgeBaseFile(project.id, file);

                const existingKb = projectRef.current.knowledgeBase || [];
                const updatedKnowledgeBase = [...existingKb, kb];
                await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });

                const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                onProjectUpdate?.(updatedProject);
                projectRef.current = updatedProject;

                setLastGeneratedAsset({ url: editedUrl, type: 'image', name: instruction.slice(0, 50), timestamp: Date.now() });
              } catch (saveError) {
                console.error('Failed to save edited image:', saveError);
              }

              setMessages(prev => prev.filter(m => m.id !== streamingMessageId));
              addMessage('model', `I edited the image: "${instruction}"`, editedUrl);
              setIsProcessing(false);
            } catch (err: any) {
              console.error('Image edit failed:', err);
              addMessage('model', `Failed to edit image: ${err.message || 'Unknown error'}`);
              setIsProcessing(false);
            }
          } else if (fc.name === 'edit_project_video') {
            // Edit attached video using xAI Grok
            try {
              const instruction = (args.instruction || '').toString();
              const videoUrlArg = (args.videoUrl || '').toString();

              // Find video URL - xAI requires a PUBLICLY ACCESSIBLE URL
              let resolvedVideoUrl: string | null = null;

              // Check pending attachments - need to upload to KB first for public URL
              const videoAtt = pendingAttachments.find(a =>
                a.file?.type?.startsWith('video/') && a.status === 'ready'
              );

              if (videoAtt?.file) {
                // Upload to KB storage to get a public URL (xAI can't access Gemini file URIs)
                try {
                  addMessage('model', '📤 Uploading video for editing...');
                  const kbFile = await storageService.uploadKnowledgeBaseFile(project.id, videoAtt.file);
                  resolvedVideoUrl = kbFile.url;
                  console.log('[edit_project_video] Uploaded video to KB, got public URL:', resolvedVideoUrl);

                  // Also save to project KB
                  const existingKb = projectRef.current.knowledgeBase || [];
                  const updatedKnowledgeBase = [...existingKb, kbFile];
                  await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
                  const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                  onProjectUpdate?.(updatedProject);
                  projectRef.current = updatedProject;
                } catch (uploadErr) {
                  console.error('[edit_project_video] Failed to upload video:', uploadErr);
                  addMessage('model', 'Failed to upload video for editing. Please try again.');
                  setIsProcessing(false);
                  continue;
                }
              }

              // Fallback to lastGeneratedAsset
              if (!resolvedVideoUrl && lastGeneratedAsset?.type === 'video') {
                resolvedVideoUrl = lastGeneratedAsset.publicUrl || lastGeneratedAsset.url;
                console.log('[edit_project_video] Using lastGeneratedAsset');
              }

              // Fallback to provided URL
              if (!resolvedVideoUrl && videoUrlArg) {
                resolvedVideoUrl = videoUrlArg;
                console.log('[edit_project_video] Using URL from args');
              }

              if (!resolvedVideoUrl) {
                addMessage('model', 'No video found to edit. Please attach a video first (max 8.7 seconds).');
                setIsProcessing(false);
                continue;
              }

              // Credit check
              const hasCredits = await checkCredits('videoEditXai');
              if (!hasCredits) {
                addMessage('model', 'Insufficient credits for video editing.');
                setIsProcessing(false);
                continue;
              }
              await deductCredits('videoEditXai');

              addMessage('model', `🎬 Editing video with xAI Grok...\n\n*Instruction: "${instruction}"*`);

              const { xaiService } = await import('../services/xaiService');
              const editResponse = await xaiService.editVideo({
                prompt: instruction,
                video_url: resolvedVideoUrl
              });

              if (!editResponse.request_id) {
                throw new Error('No request ID returned from xAI');
              }

              const result = await xaiService.pollUntilComplete(
                editResponse.request_id,
                (status) => console.log(`[edit_project_video] Poll status: ${status}`)
              );

              if (!result.url) {
                throw new Error('Video editing failed - no output URL');
              }

              // Save to KB
              try {
                const res = await fetch(result.url);
                const blob = await res.blob();
                const file = new File([blob], `voice-video-edit-${Date.now()}.mp4`, { type: 'video/mp4' });
                const kb = await storageService.uploadKnowledgeBaseFile(project.id, file);

                const existingKb = projectRef.current.knowledgeBase || [];
                const updatedKnowledgeBase = [...existingKb, kb];
                await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });

                const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                onProjectUpdate?.(updatedProject);
                projectRef.current = updatedProject;

                setLastGeneratedAsset({ url: result.url, type: 'video', name: instruction.slice(0, 50), timestamp: Date.now() });
              } catch (saveError) {
                console.error('Failed to save edited video:', saveError);
              }

              setMessages(prev => prev.filter(m => m.id !== streamingMessageId));
              addMessage('model', `I edited the video: "${instruction}"\n\n[View edited video](${result.url})`);
              setIsProcessing(false);
            } catch (err: any) {
              console.error('Video edit failed:', err);
              addMessage('model', `Failed to edit video: ${err.message || 'Unknown error'}`);
              setIsProcessing(false);
            }
          } else if (fc.name === 'generate_project_video') {
            try {
              const videoCheck = await checkUsageLimit('video', isSubscribed);
              if (!videoCheck.allowed) {
                setUsageLimitModal({ isOpen: true, usageType: 'video', current: videoCheck.current, limit: videoCheck.limit });
                addMessage('model', 'You have reached your video generation limit. Please upgrade to Pro for more.');
                setIsProcessing(false);
                continue;
              }
              await incrementUsage('video');

              const prompt = (args.prompt || userMessage).toString();
              const aspect = (args.aspect || '720x1280').toString();
              const mode = (args.mode || 'speed').toString();

              const assetName = args.assetName ? String(args.assetName) : undefined;
              const useLastGenerated = Boolean(args.useLastGenerated);
              let resolvedImageUrl = args.imageUrl ? String(args.imageUrl) : undefined;

              // 1. Check useLastGenerated
              if (!resolvedImageUrl && useLastGenerated && lastGeneratedAsset && lastGeneratedAsset.type === 'image') {
                resolvedImageUrl = lastGeneratedAsset.url;
              }

              // 2. Check assetName for image matches
              if (!resolvedImageUrl && assetName) {
                const kb = project.knowledgeBase || [];
                const searchTerm = assetName.toLowerCase();
                const matchedAsset = kb.find(k =>
                  (k.type?.startsWith('image') || (k as any).mimeType?.startsWith('image')) &&
                  (k.name?.toLowerCase().includes(searchTerm) || searchTerm.includes(k.name?.toLowerCase() || ''))
                );
                if (matchedAsset?.url) resolvedImageUrl = matchedAsset.url;
              }

              // 3. Check attachments
              if (!resolvedImageUrl && readyAttachments.length > 0) {
                const imgAtt = readyAttachments.find(a => a.uploaded?.mimeType?.startsWith('image/') || a.file?.type.startsWith('image/'));
                if (imgAtt?.uploaded?.uri) resolvedImageUrl = imgAtt.uploaded.uri;
                else if (imgAtt?.file) {
                  try {
                    const toBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(reader.result as string);
                      reader.onerror = reject;
                      reader.readAsDataURL(file);
                    });
                    resolvedImageUrl = await toBase64(imgAtt.file);
                  } catch (e) { console.error('Failed to convert attachment', e); }
                }
              }

              const modelNameArg = (args.model || 'sora').toString();

              let videoUrl = '';

              try {
                // VEO 3.1 LOGIC
                if (modelNameArg === 'veo') {
                  const aspectRatio: '16:9' | '9:16' =
                    aspect === '1280x720' || aspect === '1792x1024' ? '16:9' : '9:16';

                  setMessages(prev => prev.map(m => m.id === streamingMessageId ? {
                    ...m,
                    text: `Generating video with Veo 3.1...\nPrompt: "${prompt}"\n\n(This typically takes 1-2 minutes)`,
                    isGenerating: true
                  } : m));

                  let imageInput: { base64: string, mimeType: string } | undefined;
                  if (resolvedImageUrl) {
                    // Fetch base64 for Veo
                    const base64 = await fetchImageAsBase64(resolvedImageUrl);
                    if (base64) {
                      imageInput = { base64, mimeType: 'image/png' }; // Assumes png or handled by helper, or generic
                    }
                  }

                  const veoBlob = await generateVeoVideo(prompt, aspectRatio, 'quality', imageInput ? { image: imageInput } : {});
                  const fileName = `veo-video-${Date.now()}.mp4`;
                  const videoFile = new File([veoBlob], fileName, { type: 'video/mp4' });
                  const kb = await storageService.uploadKnowledgeBaseFile(project.id, videoFile);

                  // Persist to project
                  const existingKb = projectRef.current.knowledgeBase || [];
                  const updatedKnowledgeBase = [...existingKb, kb];
                  await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
                  const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                  onProjectUpdate?.(updatedProject);
                  projectRef.current = updatedProject;

                  videoUrl = kb.url;

                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `video-gen-${Date.now()}`,
                      role: 'model',
                      text: '',
                      timestamp: Date.now(),
                      videoUrl: kb.url,
                    }
                  ]);

                  setLastGeneratedAsset({ url: videoUrl, type: 'video', name: prompt.slice(0, 50), timestamp: Date.now() });
                  const text = `I generated a Veo video based on your request and saved it to your project assets.\n\nVideo URL: ${videoUrl}`;

                  setMessages(prev => prev.filter(m => m.id !== streamingMessageId));
                  addMessage('model', text);
                  setIsProcessing(false);

                  // Skip Sora logic
                  resolvedImageUrl = undefined;
                  // ... actually we should structure this with else if or return
                  // forcing flow break:
                  throw { handled: true };
                }

                if (resolvedImageUrl) {
                  // Notify user explicitly about image usage
                  setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: `Animating your image with prompt: "${prompt}"...\n\n(This typically takes 2-3 minutes)`, isGenerating: true } : m));

                  const opts = { prompt, size: aspect as any, model: (mode === 'quality' ? 'sora-2-pro' : 'sora-2') as SoraModel };
                  const job = await createVideoFromImageUrl(opts, resolvedImageUrl);
                  const finalJob = await pollVideoUntilComplete(job.id);

                  if (finalJob.status === 'completed') {
                    const blob = await downloadVideoBlob(job.id);
                    const fileName = `sora-image-to-video-${Date.now()}.mp4`;
                    const videoFile = new File([blob], fileName, { type: 'video/mp4' });
                    const kb = await storageService.uploadKnowledgeBaseFile(project.id, videoFile);

                    // Persist to project
                    const existingKb = projectRef.current.knowledgeBase || [];
                    const updatedKnowledgeBase = [...existingKb, kb];
                    await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
                    const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                    onProjectUpdate?.(updatedProject);
                    projectRef.current = updatedProject;

                    videoUrl = kb.url;

                    // Inject video into chat stream immediately
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: `video-gen-${Date.now()}`,
                        role: 'model',
                        text: '',
                        timestamp: Date.now(),
                        videoUrl: kb.url,
                      }
                    ]);
                  } else {
                    throw new Error(finalJob.error?.message || 'Video generation failed');
                  }
                } else {
                  // Text-to-Video
                  const opts = { prompt, size: aspect as any, model: (mode === 'quality' ? 'sora-2-pro' : 'sora-2') as SoraModel };
                  const job = await createVideoFromText(opts);
                  const finalJob = await pollVideoUntilComplete(job.id);
                  if (finalJob.status === 'completed') {
                    const blob = await downloadVideoBlob(job.id);
                    const fileName = `sora-text-to-video-${Date.now()}.mp4`;
                    const videoFile = new File([blob], fileName, { type: 'video/mp4' });
                    const kb = await storageService.uploadKnowledgeBaseFile(project.id, videoFile);

                    // Persist to project
                    const existingKb = projectRef.current.knowledgeBase || [];
                    const updatedKnowledgeBase = [...existingKb, kb];
                    await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
                    const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                    onProjectUpdate?.(updatedProject);
                    projectRef.current = updatedProject;

                    videoUrl = kb.url;

                    // Inject video into chat stream immediately
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: `video-gen-${Date.now()}`,
                        role: 'model',
                        text: '',
                        timestamp: Date.now(),
                        videoUrl: kb.url,
                      }
                    ]);
                  } else {
                    throw new Error(finalJob.error?.message || 'Video generation failed');
                  }
                }
              } catch (soraError: any) {
                if (soraError?.handled) return;
                console.warn('Sora 2 generation failed, falling back to Veo 3.1...', soraError);
                // Notify user of fallback - don't show technical error details
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? {
                  ...m,
                  text: `Switching to an alternative video generator...\n\n(This typically takes 2-3 minutes)`,
                  isGenerating: true
                } : m));

                try {
                  // Prepare Veo params
                  const requestedAspect = aspect || '720x1280'; // existing default was 720x1280
                  const isPortrait = requestedAspect.startsWith('720') || requestedAspect.includes('9:16');
                  const veoAspect = isPortrait ? '9:16' : '16:9';
                  const veoQuality = mode === 'quality' ? 'quality' : 'speed';

                  let imageBase64: string | null = null;
                  let imageMime: string | null = null;

                  if (resolvedImageUrl) {
                    try {
                      const res = await fetch(resolvedImageUrl);
                      const blob = await res.blob();
                      imageMime = blob.type;
                      const reader = new FileReader();
                      imageBase64 = await new Promise<string>((resolve, reject) => {
                        reader.onload = () => {
                          const result = reader.result as string;
                          // Remove data URL prefix
                          resolve(result.split(',')[1]);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                      });
                    } catch (imgErr) {
                      console.error('Failed to fetch/convert image for Veo fallback:', imgErr);
                      // Continue without image if we can't load it, or just generic text-to-video logic
                    }
                  }

                  const veoBlob = await generateVeoVideo(prompt, veoAspect, veoQuality, { image: { base64: imageBase64, mimeType: imageMime } });

                  const fileName = `veo-video-${Date.now()}.mp4`;
                  const videoFile = new File([veoBlob], fileName, { type: 'video/mp4' });
                  const kb = await storageService.uploadKnowledgeBaseFile(project.id, videoFile);

                  // Persist to project
                  const existingKb = projectRef.current.knowledgeBase || [];
                  const updatedKnowledgeBase = [...existingKb, kb];
                  await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
                  const updatedProject = { ...projectRef.current, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() };
                  onProjectUpdate?.(updatedProject);
                  projectRef.current = updatedProject;

                  videoUrl = kb.url;

                  // Inject video into chat stream immediately
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `video-gen-${Date.now()}`,
                      role: 'model',
                      text: '',
                      timestamp: Date.now(),
                      videoUrl: kb.url,
                    }
                  ]);

                } catch (veoError: any) {
                  console.error('Veo fallback failed:', veoError);
                  throw new Error(`Video generation failed (Sora: ${soraError.message}, Veo: ${veoError.message})`);
                }
              }

              setLastGeneratedAsset({ url: videoUrl, type: 'video', name: prompt.slice(0, 50), timestamp: Date.now() });
              const text = `I generated a Sora video based on your request and saved it to your project assets.\n\nVideo URL: ${videoUrl}`;

              setMessages(prev => prev.filter(m => m.id !== streamingMessageId));
              addMessage('model', text);
              setIsProcessing(false);
            } catch (err: any) {
              console.error('Video generation failed:', err);
              // Show user-friendly error without technical details
              addMessage('model', 'Sorry, I was unable to generate the video. Please try again with a different prompt or check your account settings.');
              setIsProcessing(false);
            }
          } else if (fc.name === 'generate_project_blog') {
            const prompt = (args.prompt || userMessage).toString();
            const { blog } = await generateProjectBlogAsset(prompt);
            if (blog) {
              let blogText = `# ${blog.title}\n\n`;
              if (blog.subtitle) {
                blogText += `_${blog.subtitle}_\n\n`;
              }
              blogText += blog.content || '';
              addMessage('model', blogText);
            } else {
              addMessage('model', 'I attempted to generate a blog post, but something went wrong.');
            }
          } else if (fc.name === 'generate_project_website') {
            const websiteCheck = await checkUsageLimit('website', isSubscribed);
            if (!websiteCheck.allowed) {
              setUsageLimitModal({ isOpen: true, usageType: 'website', current: websiteCheck.current, limit: websiteCheck.limit });
              addMessage('model', 'You have reached your website generation limit. Please upgrade to Pro for more.');
              continue;
            }
            await incrementUsage('website');
            const prompt = (args.prompt || userMessage).toString();
            const result = await generateProjectWebsiteAsset(prompt);
            const text = `I generated a project website experience "${result.description}" and saved it to your project assets.\n\nYou can view it from the Assets tab under Sites.`;
            addMessage('model', text);
          } else if (fc.name === 'generate_project_podcast') {
            const podcastCheck = await checkUsageLimit('podcast', isSubscribed);
            if (!podcastCheck.allowed) {
              setUsageLimitModal({ isOpen: true, usageType: 'podcast', current: podcastCheck.current, limit: podcastCheck.limit });
              addMessage('model', 'You have reached your podcast generation limit. Please upgrade to Pro for more.');
              continue;
            }
            await incrementUsage('podcast');
            const prompt = (args.prompt || userMessage).toString();
            const style = (args.style || '').toString();
            const duration = (args.duration || '').toString();
            try {
              const result = await generateProjectPodcastAsset(prompt, style, duration);
              const lines: string[] = [
                `I generated a podcast episode "${result.script.title}" based on your project.`,
                'You can listen to it directly here or from the Assets tab under Podcasts.',
              ];
              addMessage('model', lines.join('\n\n'), undefined, result.audioUrl);
            } catch (podcastError) {
              console.error('Chat podcast generation error:', podcastError);
              addMessage('model', 'I tried to generate a podcast episode, but something went wrong.');
            }
          } else if (fc.name === 'generate_project_book') {
            const prompt = (args.prompt || userMessage).toString();
            const pageCountArg = typeof args.pageCount === 'number' ? args.pageCount : undefined;
            try {
              const result = await generateProjectBookAsset(prompt, pageCountArg);
              const title = result.book?.title || prompt || project.name || 'Project book';
              const pageTotal = result.book?.pages?.length ?? 0;
              const lines: string[] = [
                `I generated an illustrated book "${title}" based on your project context and saved it to your latest research session under the Books tab.`,
              ];
              if (pageTotal > 0) {
                lines.push(`The book has ${pageTotal} pages, and I also compiled a PDF you can download from the Books tab.`);
              }
              addMessage('model', lines.join('\n\n'));
            } catch (bookError) {
              console.error('Chat book generation error:', bookError);
              addMessage('model', 'I tried to generate an illustrated book for your project, but something went wrong.');
            }
          } else if (fc.name === 'generate_project_table') {
            const prompt = (args.prompt || userMessage).toString();
            try {
              const table = await generateProjectTableAsset(prompt);
              addMessage('model', `Generated a new table and loaded it into Assets > Tables: "${table.title}".`);
            } catch (e: any) {
              addMessage('model', `Failed to generate table: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'edit_project_table') {
            const instruction = String(args.instruction || '').trim();
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor unavailable. Open Assets > Tables and load a table first.');
              const cur = bridge.getTable();
              if (!cur || !cur.table) throw new Error('No table loaded.');

              addMessage('model', `Refining table data: "${instruction}"...`);

              const newTableSpec = await refineProjectTableAsset(cur.table, instruction);

              bridge.setTableTitle(newTableSpec.title || cur.table.title || 'Table');
              bridge.setTableDescription(newTableSpec.description || cur.table.description || '');
              bridge.setColumns(newTableSpec.columns);
              bridge.setRows(newTableSpec.rows);

              addMessage('model', 'Table updated successfully based on your instructions.');
            } catch (e: any) {
              addMessage('model', `Failed to edit table: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'save_project_table') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              const out = bridge.getTable();
              const t = (out as any)?.table;
              if (!t) throw new Error('No table is currently loaded in the Tables tab.');

              const tableAsset: TableAsset = {
                id: String(t.id || `table-${Date.now()}`),
                title: String(t.title || 'Table'),
                description: typeof t.description === 'string' ? t.description : undefined,
                columns: Array.isArray(t.columns) ? t.columns.map((c: any) => String(c ?? '')) : [],
                rows: Array.isArray(t.rows) ? t.rows.map((r: any) => (Array.isArray(r) ? r.map((v: any) => String(v ?? '')) : [])) : [],
                createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
                googleSpreadsheetId: typeof t.googleSpreadsheetId === 'string' ? t.googleSpreadsheetId : undefined,
                googleSheetTitle: typeof t.googleSheetTitle === 'string' ? t.googleSheetTitle : undefined,
              };

              await saveTableToLatestSession(tableAsset);
              addMessage('model', 'Saved the current table to your latest research session (Project assets > Tables).');
            } catch (e: any) {
              addMessage('model', `Failed to save table: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'save_table_to_google_sheet') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load a table first.');
              const out = bridge.getTable();
              const t = (out as any)?.table;
              if (!t) throw new Error('No table is currently loaded in the Tables tab.');
              await saveTableBackToGoogleSheet(t);
              addMessage('model', 'Saved the table back to Google Sheets.');
            } catch (e: any) {
              addMessage('model', `Failed to save to Google Sheets: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'get_docs_draft') {
            try {
              const bridge = getDocsEditorBridge();
              if (!bridge) throw new Error('Docs editor is not available. Open the Assets > Docs tab and load a Doc first.');
              const draft = bridge.getDraft();
              addMessage('model', `Docs draft loaded:\n- documentId: ${draft.documentId || 'none'}\n- title: ${draft.title || 'none'}\n- length: ${draft.text?.length || 0} chars`);
            } catch (e: any) {
              addMessage('model', `Docs draft read failed: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'set_docs_draft_text') {
            try {
              const bridge = getDocsEditorBridge();
              if (!bridge) throw new Error('Docs editor is not available. Open the Assets > Docs tab and load a Doc first.');
              bridge.setDraftText(String(args.text ?? ''));
              addMessage('model', 'Updated the Docs tab editor content.');
            } catch (e: any) {
              addMessage('model', `Failed to update Docs editor: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'append_docs_draft_text') {
            try {
              const bridge = getDocsEditorBridge();
              if (!bridge) throw new Error('Docs editor is not available. Open the Assets > Docs tab and load a Doc first.');
              bridge.appendDraftText(String(args.text ?? ''), typeof args.separator === 'string' ? args.separator : undefined);
              addMessage('model', 'Appended text to the Docs tab editor.');
            } catch (e: any) {
              addMessage('model', `Failed to append to Docs editor: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'replace_docs_draft_text') {
            try {
              const bridge = getDocsEditorBridge();
              if (!bridge) throw new Error('Docs editor is not available. Open the Assets > Docs tab and load a Doc first.');
              bridge.replaceDraftText(
                String(args.find ?? ''),
                String(args.replace ?? ''),
                {
                  useRegex: Boolean(args.useRegex),
                  caseSensitive: Boolean(args.caseSensitive),
                },
              );
              addMessage('model', 'Replaced text in the Docs tab editor.');
            } catch (e: any) {
              addMessage('model', `Failed to replace text in Docs editor: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'insert_docs_inline_image') {
            try {
              const bridge = getDocsEditorBridge();
              if (!bridge) throw new Error('Docs editor is not available. Open the Assets > Docs tab and load a Doc first.');
              const url = String(args.url ?? '').trim();
              const widthPx = typeof args.widthPx === 'number' ? args.widthPx : undefined;
              const heightPx = typeof args.heightPx === 'number' ? args.heightPx : undefined;
              bridge.insertInlineImage(url, widthPx, heightPx);
              addMessage('model', 'Inserted an inline image into the Docs tab editor.');
            } catch (e: any) {
              addMessage('model', `Failed to insert inline image: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'save_docs_draft') {
            try {
              const bridge = getDocsEditorBridge();
              if (!bridge) throw new Error('Docs editor is not available. Open the Assets > Docs tab and load a Doc first.');
              const ok = await bridge.save();
              addMessage('model', ok ? 'Saved the Docs tab draft to Google Docs.' : 'Attempted to save to Google Docs, but it failed.');
            } catch (e: any) {
              addMessage('model', `Failed to save Docs draft: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'get_table_draft') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              const out = bridge.getTable();
              const t = (out as any)?.table;
              if (!t) {
                addMessage('model', 'No table is currently loaded in the Tables tab.');
              } else {
                addMessage('model', `Table draft loaded:\n- title: ${t.title || '(untitled)'}\n- columns: ${(t.columns || []).length}\n- rows: ${(t.rows || []).length}`);
              }
            } catch (e: any) {
              addMessage('model', `Table draft read failed: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'set_table_cell') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              bridge.setCell(Number(args.rowIndex), Number(args.colIndex), String(args.value ?? ''));
              addMessage('model', 'Updated a table cell in the Tables tab.');
            } catch (e: any) {
              addMessage('model', `Failed to update table cell: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'add_table_row') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              bridge.addRow(typeof args.index === 'number' ? args.index : undefined);
              addMessage('model', 'Added a row to the table.');
            } catch (e: any) {
              addMessage('model', `Failed to add row: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'delete_table_row') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              bridge.deleteRow(Number(args.rowIndex));
              addMessage('model', 'Deleted a row from the table.');
            } catch (e: any) {
              addMessage('model', `Failed to delete row: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'add_table_column') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              bridge.addColumn(typeof args.name === 'string' ? args.name : undefined, typeof args.index === 'number' ? args.index : undefined);
              addMessage('model', 'Added a column to the table.');
            } catch (e: any) {
              addMessage('model', `Failed to add column: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'delete_table_column') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              bridge.deleteColumn(Number(args.colIndex));
              addMessage('model', 'Deleted a column from the table.');
            } catch (e: any) {
              addMessage('model', `Failed to delete column: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'rename_table_column') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              bridge.renameColumn(Number(args.colIndex), String(args.name ?? ''));
              addMessage('model', 'Renamed a column in the table.');
            } catch (e: any) {
              addMessage('model', `Failed to rename column: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'set_table_title') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              bridge.setTableTitle(String(args.title ?? ''));
              addMessage('model', 'Updated the table title.');
            } catch (e: any) {
              addMessage('model', `Failed to set table title: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'set_table_description') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              bridge.setTableDescription(String(args.description ?? ''));
              addMessage('model', 'Updated the table description.');
            } catch (e: any) {
              addMessage('model', `Failed to set table description: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'set_table_draft') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');

              const title = typeof args.title === 'string' ? args.title : undefined;
              const description = typeof args.description === 'string' ? args.description : undefined;
              const columns = Array.isArray(args.columns) ? args.columns.map((c: any) => String(c ?? '')) : null;
              const rows = Array.isArray(args.rows)
                ? args.rows.map((r: any) => (Array.isArray(r) ? r.map((v: any) => String(v ?? '')) : []))
                : null;

              if (!columns || !rows) throw new Error('columns and rows are required.');
              if (title !== undefined) bridge.setTableTitle(title);
              if (description !== undefined) bridge.setTableDescription(description);
              bridge.setColumns(columns);
              bridge.setRows(rows);

              addMessage('model', 'Replaced the entire table draft in the Tables tab.');
            } catch (e: any) {
              addMessage('model', `Failed to replace table draft: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'set_table_rows') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              const rows = Array.isArray(args.rows)
                ? args.rows.map((r: any) => (Array.isArray(r) ? r.map((v: any) => String(v ?? '')) : []))
                : null;
              if (!rows) throw new Error('rows is required.');
              bridge.setRows(rows);
              addMessage('model', 'Replaced all table rows.');
            } catch (e: any) {
              addMessage('model', `Failed to replace rows: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'set_table_columns') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              const columns = Array.isArray(args.columns) ? args.columns.map((c: any) => String(c ?? '')) : null;
              if (!columns) throw new Error('columns is required.');
              bridge.setColumns(columns);
              addMessage('model', 'Replaced all table columns/headers.');
            } catch (e: any) {
              addMessage('model', `Failed to replace columns: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'set_table_row') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              const rowIndex = Number(args.rowIndex);
              const row = Array.isArray(args.row) ? args.row.map((v: any) => String(v ?? '')) : null;
              if (!Number.isFinite(rowIndex) || rowIndex < 0) throw new Error('rowIndex must be a non-negative number.');
              if (!row) throw new Error('row is required.');
              const current = bridge.getTable();
              const table = (current as any)?.table;
              if (!table) throw new Error('No table is currently loaded.');
              const rows: string[][] = Array.isArray(table.rows) ? table.rows.map((r: any) => (Array.isArray(r) ? r.map((v: any) => String(v ?? '')) : [])) : [];
              if (rowIndex >= rows.length) throw new Error('rowIndex is out of bounds.');
              rows[rowIndex] = row;
              bridge.setRows(rows);
              addMessage('model', 'Replaced a full row in the table.');
            } catch (e: any) {
              addMessage('model', `Failed to replace row: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'set_table_column') {
            try {
              const bridge = getTableEditorBridge();
              if (!bridge) throw new Error('Table editor is not available. Open the Assets > Tables tab and load/generate a table first.');
              const colIndex = Number(args.colIndex);
              const name = typeof args.name === 'string' ? args.name : undefined;
              const column = Array.isArray(args.column) ? args.column.map((v: any) => String(v ?? '')) : null;
              if (!Number.isFinite(colIndex) || colIndex < 0) throw new Error('colIndex must be a non-negative number.');
              if (!column) throw new Error('column is required.');

              const current = bridge.getTable();
              const table = (current as any)?.table;
              if (!table) throw new Error('No table is currently loaded.');
              const rows: string[][] = Array.isArray(table.rows) ? table.rows.map((r: any) => (Array.isArray(r) ? r.map((v: any) => String(v ?? '')) : [])) : [];
              const nextRows = rows.map((r, i) => {
                const next = [...r];
                next[colIndex] = column[i] ?? '';
                return next;
              });
              bridge.setRows(nextRows);
              if (name !== undefined) {
                bridge.renameColumn(colIndex, name);
              }
              addMessage('model', 'Replaced a full column in the table.');
            } catch (e: any) {
              addMessage('model', `Failed to replace column: ${String(e?.message || e)}`);
            }
          } else if (fc.name === 'run_project_seo_analysis') {
            const keyword = String(args.keyword || args.prompt || '').trim() || project.name || 'SEO';
            const location = String(args.location || 'US').trim() || 'US';
            try {
              if (!onRunSeoAnalysis) {
                throw new Error('SEO automation is not available in this view.');
              }

              addMessage('model', `Opening the SEO tab and running analysis for "${keyword}" (${location})...`);
              const result = await onRunSeoAnalysis({ keyword, location });

              const returnedError = (result as any)?.error ? String((result as any).error) : '';
              if (returnedError) {
                addMessage('model', `SEO analysis failed: ${returnedError}`);
                continue;
              }

              const advice = (result?.advice || '').trim() || '';
              const topKeywords = extractSeoTopKeywords(result?.seoData);
              const contentLines: string[] = [];
              contentLines.push(`Keyword: ${result.keyword}`);
              contentLines.push(`Location: ${result.location}`);
              contentLines.push('');
              if (advice) {
                contentLines.push(advice);
              }
              if (topKeywords.length > 0) {
                contentLines.push('');
                contentLines.push('Top keywords:');
                topKeywords.forEach(row => {
                  const vol = typeof row.volume === 'number' ? row.volume : '-';
                  contentLines.push(`- ${row.keyword} (volume: ${vol}, competition: ${row.competition ?? '-'})`);
                });
              }

              await storageService.addNote(project.id, {
                title: `SEO: ${result.keyword} (${result.location})`,
                content: contentLines.join('\n'),
                color: 'green',
                aiGenerated: true,
              });

              addMessage('model', 'Done. The SEO tab is updated with the latest stats, and I saved the key takeaways as a new Project Note.');
            } catch (seoError: any) {
              console.error('Chat SEO tool error:', seoError);
              addMessage('model', `I tried to run SEO analysis, but it failed: ${seoError?.message || 'unknown error'}`);
            }
          } else if (fc.name === 'get_connected_accounts') {
            // Return connected social accounts for the user to choose from
            const requestedPlatform = String(args.platform || 'all').toLowerCase();

            const accounts: any = {
              facebook: {
                connected: facebookConnected,
                pages: fbPages?.map((p: any) => ({
                  id: p.id,
                  name: p.name,
                  picture: p.picture?.data?.url
                })) || [],
                selectedPageId: fbPageId || null
              },
              instagram: {
                connected: facebookConnected && igAccounts.length > 0,
                accounts: igAccounts?.map((a: any) => ({
                  id: a.id,
                  username: a.username || a.name,
                  picture: a.profile_picture_url
                })) || [],
                selectedAccountId: selectedIgId || null
              },
              x: { connected: xConnected },
              tiktok: { connected: tiktokConnected },
              youtube: { connected: youtubeConnected },
              linkedin: { connected: linkedinConnected }
            };

            let response = '';

            if (requestedPlatform === 'facebook' || requestedPlatform === 'all') {
              if (accounts.facebook.connected && accounts.facebook.pages.length > 0) {
                response += `**Facebook Pages Available:**\n`;
                accounts.facebook.pages.forEach((p: any, i: number) => {
                  response += `${i + 1}. ${p.name} (ID: ${p.id})\n`;
                });
                response += `\nPlease tell me which page you'd like to post to by name or number.\n\n`;
              } else if (!accounts.facebook.connected) {
                response += `Facebook is not connected. Please connect your Facebook account first.\n\n`;
              } else {
                response += `Facebook is connected but no pages were found.\n\n`;
              }
            }

            if (requestedPlatform === 'instagram' || requestedPlatform === 'all') {
              if (accounts.instagram.connected && accounts.instagram.accounts.length > 0) {
                response += `**Instagram Accounts Available:**\n`;
                accounts.instagram.accounts.forEach((a: any, i: number) => {
                  response += `${i + 1}. @${a.username} (ID: ${a.id})\n`;
                });
                response += `\nPlease tell me which account you'd like to post to.\n\n`;
              } else if (!accounts.instagram.connected) {
                response += `Instagram is not connected. Please connect via Facebook first.\n\n`;
              }
            }

            if (!response) {
              response = 'No accounts found for the requested platform.';
            }

            addMessage('model', response);
          } else if (fc.name === 'post_to_social') {
            // Social media posting handler for chat mode - supports multi-platform
            // Support both 'platforms' array and single 'platform' for backwards compatibility
            let targetPlatforms: SocialPlatform[] = [];
            if (args.platforms && Array.isArray(args.platforms)) {
              targetPlatforms = args.platforms.map((p: any) => String(p).toLowerCase() as SocialPlatform);
            } else if (args.platform) {
              targetPlatforms = [String(args.platform).toLowerCase() as SocialPlatform];
            }

            let contentType = String(args.contentType || 'text').toLowerCase() as 'text' | 'image' | 'video';
            let text = String(args.text || '').trim();
            let mediaUrl = String(args.mediaUrl || '').trim();
            const assetId = String(args.assetId || '').trim();
            const assetName = String(args.assetName || '').trim();
            const useLastGenerated = Boolean(args.useLastGenerated);
            const pageId = String(args.pageId || '').trim();
            const igAccountId = String(args.igAccountId || '').trim();
            const privacyLevel = String(args.privacyLevel || '').trim();

            try {
              // ══════════════════════════════════════════════════════════════
              // CHECK POST LIMITS (Free: 3/day, Pro: Unlimited)
              // ══════════════════════════════════════════════════════════════
              const postLimitCheck = await checkPostLimit(isSubscribed);
              if (!postLimitCheck.canPost) {
                const resetDate = new Date(postLimitCheck.resetTime).toLocaleString();
                addMessage('model', `⚠️ **Daily Post Limit Reached**\\n\\nYou've used all ${postLimitCheck.limit} posts for today (${postLimitCheck.postsToday}/${postLimitCheck.limit}).\\n\\nYour limit resets at: ${resetDate}\\n\\n✨ **Upgrade to Pro** for unlimited posting to all platforms!`);
                if (onUpgrade) {
                  setTimeout(() => onUpgrade(), 500);
                }
                continue;
              }

              // Validate platforms
              const validPlatforms: SocialPlatform[] = ['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'linkedin'];
              const invalidPlatforms = targetPlatforms.filter(p => !validPlatforms.includes(p));
              if (invalidPlatforms.length > 0) {
                addMessage('model', `Invalid platform(s): ${invalidPlatforms.join(', ')}. Valid options: ${validPlatforms.join(', ')}`);
                continue;
              }

              if (targetPlatforms.length === 0) {
                addMessage('model', 'No platforms specified. Please specify which platform(s) to post to.');
                continue;
              }

              // Check which platforms need auth
              const needsAuthPlatforms = targetPlatforms.filter(p => !isPlatformConnected(p));
              if (needsAuthPlatforms.length > 0) {
                console.log('[post_to_social] Platforms need auth:', needsAuthPlatforms);
                setPendingAuthPlatforms(needsAuthPlatforms);
                addMessage('model', `Please connect these accounts first: ${needsAuthPlatforms.map(p => p.toUpperCase()).join(', ')}`);
                continue;
              }

              // Helper for fuzzy matching page/account names
              const fuzzyMatchPage = (query: string, pages: any[]): any | null => {
                if (!query || !pages?.length) return null;
                const lowerQuery = query.toLowerCase().trim();
                // Exact match first
                let match = pages.find(p => p.name?.toLowerCase() === lowerQuery);
                if (match) return match;
                // Substring match
                match = pages.find(p => p.name?.toLowerCase().includes(lowerQuery) || lowerQuery.includes(p.name?.toLowerCase()));
                if (match) return match;
                // Number match (user says "1" for first page)
                const num = parseInt(lowerQuery);
                if (!isNaN(num) && num >= 1 && num <= pages.length) {
                  return pages[num - 1];
                }
                return null;
              };

              const fuzzyMatchIgAccount = (query: string, accounts: any[]): any | null => {
                if (!query || !accounts?.length) return null;
                const lowerQuery = query.toLowerCase().trim().replace(/^@/, ''); // Remove @ prefix
                // Exact match
                let match = accounts.find(a => (a.username || a.name || '').toLowerCase() === lowerQuery);
                if (match) return match;
                // Substring match
                match = accounts.find(a => (a.username || a.name || '').toLowerCase().includes(lowerQuery));
                if (match) return match;
                // Number match
                const num = parseInt(lowerQuery);
                if (!isNaN(num) && num >= 1 && num <= accounts.length) {
                  return accounts[num - 1];
                }
                return null;
              };

              // For Facebook, resolve page
              if (targetPlatforms.includes('facebook')) {
                let resolvedPageId = pageId || fbPageId;
                const pageName = String(args.pageName || '').trim();

                // If pageName provided, fuzzy match it
                if (!resolvedPageId && pageName && fbPages?.length > 0) {
                  const matched = fuzzyMatchPage(pageName, fbPages);
                  if (matched) {
                    resolvedPageId = matched.id;
                    addMessage('model', `Using Facebook Page: **${matched.name}**`);
                  } else {
                    addMessage('model', `I couldn't find a page matching "${pageName}". Available pages:\n\n${fbPages.map((p: any, i: number) => `${i + 1}. **${p.name}**`).join('\n')}\n\nWhich page would you like me to post to?`);
                    continue;
                  }
                }

                // Auto-select if only one page
                if (!resolvedPageId && fbPages?.length === 1) {
                  resolvedPageId = fbPages[0].id;
                  addMessage('model', `Using your only Facebook Page: **${fbPages[0].name}**`);
                }

                // Still no page? Ask user
                if (!resolvedPageId && fbPages?.length > 1) {
                  addMessage('model', `You have ${fbPages.length} Facebook pages. Which one would you like me to post to?\n\n${fbPages.map((p: any, i: number) => `${i + 1}. **${p.name}**`).join('\n')}`);
                  continue;
                } else if (!resolvedPageId) {
                  addMessage('model', `Facebook is connected but no pages are available. Please make sure you have a Facebook Page connected.`);
                  continue;
                }

                // Store resolved pageId for use in posting
                args.pageId = resolvedPageId;
              }

              // For Instagram, resolve account
              if (targetPlatforms.includes('instagram')) {
                let resolvedIgId = igAccountId || selectedIgId;
                const igName = String(args.igAccountName || '').trim();

                // If igAccountName provided, fuzzy match it
                if (!resolvedIgId && igName && igAccounts?.length > 0) {
                  const matched = fuzzyMatchIgAccount(igName, igAccounts);
                  if (matched) {
                    resolvedIgId = matched.id;
                    addMessage('model', `Using Instagram account: **@${matched.username || matched.name}**`);
                  } else {
                    addMessage('model', `I couldn't find an account matching "${igName}". Available accounts:\n\n${igAccounts.map((a: any, i: number) => `${i + 1}. **@${a.username || a.name}**`).join('\n')}\n\nWhich account would you like me to post to?`);
                    continue;
                  }
                }

                // Auto-select if only one account
                if (!resolvedIgId && igAccounts?.length === 1) {
                  resolvedIgId = igAccounts[0].id;
                  addMessage('model', `Using your only Instagram account: **@${igAccounts[0].username || igAccounts[0].name}**`);
                }

                // Still no account? Ask user
                if (!resolvedIgId && igAccounts?.length > 1) {
                  addMessage('model', `You have ${igAccounts.length} Instagram accounts. Which one would you like me to post to?\n\n${igAccounts.map((a: any, i: number) => `${i + 1}. **@${a.username || a.name}**`).join('\n')}`);
                  continue;
                } else if (!resolvedIgId) {
                  addMessage('model', `Instagram is connected but no business accounts are available. Please make sure you have an Instagram Business account linked to a Facebook Page.`);
                  continue;
                }

                // Store resolved igAccountId for use in posting
                args.igAccountId = resolvedIgId;
              }

              // 🧠 INTELLIGENT MEDIA TARGETING: Use AI to determine which media the user is referring to
              // Only invoke if we have conversation media to analyze and no explicit mediaUrl/assetId was provided
              if (!mediaUrl && !assetId && currentConversationMedia.length > 0 && contentType !== 'text') {
                try {
                  console.log('[post_to_social] 🧠 Invoking analyzeMediaIntent with', currentConversationMedia.length, 'tracked media items');
                  const mediaAnalysis = await analyzeMediaIntent(
                    text || 'post this to social media',
                    currentConversationMedia,
                    messages.slice(-10).map(m => ({ role: m.role, text: m.text || '', imageUrl: m.imageUrl }))
                  );
                  console.log('[post_to_social] 🧠 AI Media Analysis:', mediaAnalysis);

                  if (mediaAnalysis.targetMediaUrl && mediaAnalysis.confidence !== 'low') {
                    mediaUrl = mediaAnalysis.targetMediaUrl;
                    contentType = mediaAnalysis.targetMediaType || 'image';
                    console.log('[post_to_social] 🎯 AI selected media:', mediaUrl, 'with confidence:', mediaAnalysis.confidence);
                  } else if (mediaAnalysis.confidence === 'low' && currentConversationMedia.length > 1) {
                    // AI couldn't determine - ask user for clarification
                    const mediaList = currentConversationMedia.slice(0, 5).map((m, i) => `${i + 1}. ${m.name} (${m.type}, ${m.source})`).join('\n');
                    addMessage('model', `I'm not sure which media you'd like to post. You've shared multiple items:\n\n${mediaList}\n\nPlease specify which one, or say "the first one", "the video", etc.`);
                    continue;
                  }
                } catch (aiError) {
                  console.error('[post_to_social] analyzeMediaIntent failed, falling back to heuristics:', aiError);
                }
              }

              // --- FALLBACK HEURISTICS (if AI analysis didn't resolve media) ---
              // Auto-detect media when user says "post this/that/it" with attachments
              // Reference words that indicate user wants to post an attached file
              const referenceWords = ['this', 'that', 'it', 'the image', 'the video', 'the file', 'my image', 'my video', 'the attachment', 'attached', 'uploaded'];
              const lowerText = text.toLowerCase().trim();
              const isTextReferenceToMedia = referenceWords.some(w => lowerText === w || lowerText.includes(w));

              // If text looks like a reference and there are attachments, use the attachment
              if (!mediaUrl && contentType === 'text' && isTextReferenceToMedia && readyAttachments.length > 0) {
                const imageOrVideoAtt = readyAttachments.find(a =>
                  a.uploaded?.mimeType?.startsWith('image/') || a.uploaded?.mimeType?.startsWith('video/')
                );
                if (imageOrVideoAtt?.uploaded?.uri) {
                  // Auto-upgrade to media post
                  console.log('[post_to_social] Fallback: Auto-detected media reference, upgrading from text to media post');
                  // Prefer publicUrl (Vercel Blob) over Gemini URI
                  mediaUrl = (imageOrVideoAtt.uploaded as any).publicUrl || imageOrVideoAtt.uploaded.uri;
                  contentType = imageOrVideoAtt.uploaded.mimeType?.startsWith('video/') ? 'video' : 'image';
                  text = ''; // Clear the reference text
                }
              }

              // Also check if contentType is text but there's a lastGeneratedAsset and reference word
              if (!mediaUrl && contentType === 'text' && isTextReferenceToMedia && lastGeneratedAsset) {
                console.log('[post_to_social] Fallback: Auto-detected media reference to last generated asset');
                mediaUrl = lastGeneratedAsset.url;
                contentType = lastGeneratedAsset.type;
                text = ''; // Clear the reference text
              }

              // Resolve media URL - priority: mediaUrl > assetId > assetName > useLastGenerated > check recent messages for imageUrl
              let resolvedMediaUrl = mediaUrl;
              let resolvedContentType = contentType;

              // Check asset ID
              if (!resolvedMediaUrl && assetId && contentType !== 'text') {
                const kb = project.knowledgeBase || [];
                const asset = kb.find(k => k.id === assetId);
                if (asset?.url) {
                  resolvedMediaUrl = asset.url;
                } else {
                  addMessage('model', `Could not find asset with ID "${assetId}".`);
                  continue;
                }
              }

              // Check asset name (fuzzy match)
              if (!resolvedMediaUrl && assetName && contentType !== 'text') {
                const kb = project.knowledgeBase || [];
                const searchTerm = assetName.toLowerCase();
                // Filter to only images and videos (KnowledgeBaseFile uses 'type' field)
                const mediaAssets = kb.filter(k =>
                  k.url && (k.type?.startsWith('image') || k.type?.startsWith('video'))
                );
                // Fuzzy match by name
                const matchedAsset = mediaAssets.find(k => {
                  const name = (k.name || '').toLowerCase();
                  return name.includes(searchTerm) || searchTerm.includes(name) ||
                    name.split(/[\s\-_]+/).some(word => searchTerm.includes(word));
                });
                if (matchedAsset?.url) {
                  resolvedMediaUrl = matchedAsset.url;
                  // Detect content type from asset
                  const isVideo = matchedAsset.type?.startsWith('video');
                  resolvedContentType = isVideo ? 'video' : 'image';
                  console.log('[post_to_social] Found asset by name:', assetName, '->', matchedAsset.name);
                } else {
                  addMessage('model', `Could not find an image or video asset matching "${assetName}". Please check the asset name.`);
                  continue;
                }
              }

              // Check useLastGenerated FIRST - this has the publicUrl from dual upload
              if (!resolvedMediaUrl && useLastGenerated && lastGeneratedAsset) {
                // Prefer publicUrl for social posting (Vercel Blob), fallback to Gemini URI
                console.log('[post_to_social] lastGeneratedAsset:', {
                  url: lastGeneratedAsset.url,
                  publicUrl: lastGeneratedAsset.publicUrl,
                  type: lastGeneratedAsset.type,
                  hasPublicUrl: !!lastGeneratedAsset.publicUrl
                });
                if (!lastGeneratedAsset.publicUrl) {
                  console.warn('[post_to_social] WARNING: publicUrl is missing! Vercel Blob upload may have failed.');
                }
                resolvedMediaUrl = lastGeneratedAsset.publicUrl || lastGeneratedAsset.url;
                resolvedContentType = lastGeneratedAsset.type;
                console.log('[post_to_social] Using last generated asset with URL:', resolvedMediaUrl);
              }

              // Fallback: check recent messages for an imageUrl (for "post that to X" scenarios)
              if (!resolvedMediaUrl && contentType !== 'text') {
                const recentModelMessages = messages.filter(m => m.role === 'model').slice(-5);
                for (const msg of recentModelMessages.reverse()) {
                  if (msg.imageUrl) {
                    resolvedMediaUrl = msg.imageUrl;
                    resolvedContentType = 'image';
                    console.log('[post_to_social] Using image from recent message:', msg.imageUrl);
                    break;
                  }
                }
              }

              // Check attached files LAST (may have stale Gemini URIs without publicUrl)
              if (!resolvedMediaUrl && contentType !== 'text' && readyAttachments.length > 0) {
                const imageOrVideoAtt = readyAttachments.find(a =>
                  a.uploaded?.mimeType?.startsWith('image/') || a.uploaded?.mimeType?.startsWith('video/')
                );
                if (imageOrVideoAtt?.uploaded) {
                  // Prefer publicUrl if available (from dual upload)
                  resolvedMediaUrl = (imageOrVideoAtt.uploaded as any).publicUrl || imageOrVideoAtt.uploaded.uri;
                  resolvedContentType = imageOrVideoAtt.uploaded.mimeType?.startsWith('video/') ? 'video' : 'image';
                  console.log('[post_to_social] Using attached file with URL:', resolvedMediaUrl);
                }
              }

              // Validate we have media for non-text posts
              if (contentType !== 'text' && !resolvedMediaUrl) {
                addMessage('model', `I need an image or video to post. Please generate one first, attach a file, or specify an asset to use.`);
                continue;
              }

              // Post to each platform
              const results: { platform: string; success: boolean; postId?: string; error?: string }[] = [];
              addMessage('model', `Posting to ${targetPlatforms.map(p => p.toUpperCase()).join(', ')}...`);

              for (const platform of targetPlatforms) {
                // Platform-specific content type validation
                if (platform === 'youtube' && resolvedContentType !== 'video') {
                  results.push({ platform, success: false, error: 'YouTube only supports video posts' });
                  continue;
                }

                try {
                  // IMPORTANT: Use resolvedContentType (actual file type) not contentType (AI's guess)
                  const result = await postToSocialPlatform(platform, resolvedContentType || contentType, text, resolvedMediaUrl || undefined, privacyLevel || undefined);

                  if (result.success) {
                    results.push({ platform, success: true, postId: result.postId });
                  } else if (result.needsAuth) {
                    results.push({ platform, success: false, error: 'Needs authentication' });
                    setPendingAuthPlatforms([platform]);
                  } else {
                    results.push({ platform, success: false, error: result.error || 'Unknown error' });
                  }
                } catch (err: any) {
                  results.push({ platform, success: false, error: err.message || 'Unknown error' });
                }
              }

              // Build summary message
              const successResults = results.filter(r => r.success);
              const failedResults = results.filter(r => !r.success);

              let summaryMessage = '';
              if (successResults.length > 0) {
                summaryMessage += `✅ Posted to: ${successResults.map(r => r.platform.toUpperCase()).join(', ')}`;
                // Note about privacy for TikTok/YouTube
                const privatePlatforms = successResults.filter(r => r.platform === 'tiktok' || r.platform === 'youtube');
                if (privatePlatforms.length > 0) {
                  summaryMessage += `\n📝 Posts on ${privatePlatforms.map(r => r.platform.toUpperCase()).join(', ')} are private. Change visibility in the app.`;
                }

                // Increment post count for free users (Pro users have unlimited)
                if (!isSubscribed) {
                  await incrementPostCount();
                  const updatedCheck = await checkPostLimit(isSubscribed);
                  summaryMessage += `\n\n📊 Posts used today: ${updatedCheck.postsToday}/${updatedCheck.limit}`;
                }
              }
              if (failedResults.length > 0) {
                if (summaryMessage) summaryMessage += '\n';
                summaryMessage += `❌ Failed: ${failedResults.map(r => `${r.platform.toUpperCase()} (${r.error})`).join(', ')}`;
              }

              addMessage('model', summaryMessage);
            } catch (postError: any) {
              console.error('post_to_social error:', postError);
              addMessage('model', `❌ Error posting: ${postError.message || 'Unknown error'}`);
            }
          } else if (fc.name === 'schedule_post') {
            // Schedule post handler for chat mode
            console.log('[schedule_post chat] Handler invoked with args:', JSON.stringify(args));
            console.log('[schedule_post chat] lastGeneratedAsset:', lastGeneratedAsset);
            console.log('[schedule_post chat] readyAttachments:', readyAttachments.length);

            // ══════════════════════════════════════════════════════════════
            // CHECK SCHEDULING PERMISSION (Free: BLOCKED, Pro: Allowed)
            // ══════════════════════════════════════════════════════════════
            const postLimitCheck = await checkPostLimit(isSubscribed);
            if (!postLimitCheck.canSchedule) {
              addMessage('model', `🚫 **Scheduling Not Available**\\n\\nPost scheduling is a **Pro feature**.\\n\\n✨ **Upgrade to Pro** to schedule posts to all platforms!`);
              if (onUpgrade) {
                setTimeout(() => onUpgrade(), 500);
              }
              continue;
            }

            const platforms = Array.isArray(args.platforms) ? args.platforms.map((p: any) => String(p).toLowerCase()) : [];
            let scheduledAt = String(args.scheduledAt || '').trim();

            // Context Recovery: If scheduledAt is missing (e.g. user said "done" after auth), try to find it in recent history
            if (!scheduledAt) {
              const timePatterns = [
                // "for 9am today", "at 5pm tomorrow", "on friday at 2pm"
                /(?:for|at|on)\s+((?:today|tomorrow|next\s+\w+|\w+day|\d{1,2}(?:\/\d{1,2})?)(?:\s+at\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)?)/i,
                // "9am", "5:00 PM"
                /(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i
              ];
              // Look at last 5 user messages
              const recentUserMsgs = messages.filter(m => m.role === 'user').slice(-5).reverse();
              for (const msg of recentUserMsgs) {
                // Skip the immediate "done" message or short confirmations
                if (msg.text.length < 20 && (msg.text.toLowerCase().includes('done') || msg.text.toLowerCase().includes('connected'))) continue;

                for (const pattern of timePatterns) {
                  const match = msg.text.match(pattern);
                  if (match && match[1]) {
                    scheduledAt = match[1].trim();
                    console.log('[schedule_post chat] Recovered scheduledAt from history:', scheduledAt);
                    break;
                  }
                }
                if (scheduledAt) break;
              }
            }

            const contentType = String(args.contentType || 'text').toLowerCase();
            const text = String(args.text || '').trim();
            const mediaUrl = String(args.mediaUrl || '').trim();
            const assetId = String(args.assetId || '').trim();
            const assetName = String(args.assetName || '').trim();
            const useLastGenerated = Boolean(args.useLastGenerated);

            // Enforce Caption: If text is missing or generic (e.g. "schedule this"), ask for it
            const lowerText = text.toLowerCase();
            const isGeneric = !text || /^(schedule|post)?\s*(this|that|it|the\s+(video|image|file))$/i.test(text);
            const intentNoCaption = /no\s+caption|without\s+caption/i.test(text);

            if (isGeneric && !intentNoCaption) {
              // Check history in case user ALREADY said "no caption" (e.g. in previous turn)
              const recentMsgs = messages.slice(-5).filter(m => m.role === 'user');
              const historyNoCaption = recentMsgs.some(m => {
                const txt = ((m as any).parts?.[0]?.text || (m as any).text || '').toLowerCase();
                return /no\s+caption|without\s+caption/i.test(txt);
              });

              if (!historyNoCaption) {
                console.log('[schedule_post] Text is generic/empty, asking for caption');
                addMessage('model', "What caption would you like for this post?");
                continue;
              }
            }

            try {
              if (platforms.length === 0) {
                addMessage('model', 'At least one platform is required for scheduling.');
                continue;
              }

              // Check actual connection status
              const needsAuth: string[] = [];
              if (platforms.includes('facebook') && !isPlatformConnected('facebook')) needsAuth.push('facebook');
              if (platforms.includes('instagram') && (!isPlatformConnected('facebook') || !isPlatformConnected('instagram'))) needsAuth.push('instagram');
              if (platforms.includes('x') && !isPlatformConnected('x')) needsAuth.push('x');
              if (platforms.includes('tiktok') && !isPlatformConnected('tiktok')) needsAuth.push('tiktok');
              if (platforms.includes('youtube') && !isPlatformConnected('youtube')) needsAuth.push('youtube');
              if (platforms.includes('linkedin') && !isPlatformConnected('linkedin')) needsAuth.push('linkedin');

              if (needsAuth.length > 0) {
                setPendingAuthPlatforms(needsAuth as SocialPlatform[]);
                addMessage('model', `Please connect your social accounts first to schedule this post: ${needsAuth.map(p => p.toUpperCase()).join(', ')}`);
                continue;
              }

              // 🧠 INTELLIGENT MEDIA TARGETING for chat mode scheduling
              // Only invoke if we have conversation media and no explicit mediaUrl/assetId was provided
              let resolvedMediaUrl = mediaUrl;
              let resolvedContentType = contentType;

              // DEBUG: Log state to understand what's happening
              console.log('[schedule_post chat] 🧠 Media targeting check:', {
                resolvedMediaUrl,
                assetId,
                assetName,
                conversationMediaCount: currentConversationMedia.length,
                contentType,
                conversationMedia: currentConversationMedia.map(m => ({ name: m.name, type: m.type, source: m.source }))
              });

              // Always try AI analysis if there's conversation media and no explicit media was provided
              // Removed contentType check - the AI should determine the correct type based on tracked media
              if (!resolvedMediaUrl && !assetId && !assetName && currentConversationMedia.length > 0) {
                try {
                  console.log('[schedule_post chat] 🧠 Invoking analyzeMediaIntent with', currentConversationMedia.length, 'tracked media items');
                  const mediaAnalysis = await analyzeMediaIntent(
                    text || 'schedule this post',
                    currentConversationMedia,
                    messages.slice(-10).map(m => ({ role: m.role, text: m.text || '', imageUrl: m.imageUrl }))
                  );
                  console.log('[schedule_post chat] 🧠 AI Media Analysis:', mediaAnalysis);

                  if (mediaAnalysis.targetMediaUrl && mediaAnalysis.confidence !== 'low') {
                    resolvedMediaUrl = mediaAnalysis.targetMediaUrl;
                    resolvedContentType = mediaAnalysis.targetMediaType || 'image';
                    console.log('[schedule_post chat] 🎯 AI selected media:', resolvedMediaUrl);
                  } else if (mediaAnalysis.confidence === 'low' && currentConversationMedia.length > 1) {
                    const mediaList = currentConversationMedia.slice(0, 5).map((m, i) => `${i + 1}. ${m.name} (${m.type})`).join('\n');
                    addMessage('model', `I'm not sure which media to schedule. Please specify:\n\n${mediaList}`);
                    continue;
                  } else if (currentConversationMedia.length === 1) {
                    // If there's only one item, just use it
                    const singleMedia = currentConversationMedia[0];
                    resolvedMediaUrl = singleMedia.publicUrl || singleMedia.url;
                    resolvedContentType = singleMedia.type;
                    console.log('[schedule_post chat] 🎯 Using only tracked media:', resolvedMediaUrl);
                  }
                } catch (aiError) {
                  console.error('[schedule_post chat] analyzeMediaIntent failed:', aiError);
                  // Fallback: if there's only one tracked media, use it
                  if (currentConversationMedia.length === 1) {
                    const singleMedia = currentConversationMedia[0];
                    resolvedMediaUrl = singleMedia.publicUrl || singleMedia.url;
                    resolvedContentType = singleMedia.type;
                    console.log('[schedule_post chat] 🎯 Fallback to only tracked media:', resolvedMediaUrl);
                  }
                }
              }

              // --- HEURISTIC FALLBACK (if AI analysis didn't resolve media) ---
              // Media Resolution Logic (enhanced with assetName and useLastGenerated)
              const referenceWords = ['this', 'that', 'it', 'the image', 'the video', 'the file', 'my image', 'my video', 'the attachment', 'attached', 'uploaded'];
              const lowerText2 = text.toLowerCase().trim();
              const isTextReferenceToMedia = referenceWords.some(w => lowerText2 === w || lowerText2.includes(w));

              // 1. Check assetName (fuzzy match)
              if (!resolvedMediaUrl && assetName && contentType !== 'text') {
                const kb = project.knowledgeBase || [];
                const searchTerm = assetName.toLowerCase();
                const mediaAssets = kb.filter(k =>
                  k.url && (k.type?.startsWith('image') || k.type?.startsWith('video'))
                );
                const matchedAsset = mediaAssets.find(k => {
                  const name = (k.name || '').toLowerCase();
                  return name.includes(searchTerm) || searchTerm.includes(name) ||
                    name.split(/[\s\-_]+/).some(word => searchTerm.includes(word));
                });
                if (matchedAsset?.url) {
                  resolvedMediaUrl = matchedAsset.url;
                  const isVideo = matchedAsset.type?.startsWith('video');
                  resolvedContentType = isVideo ? 'video' : 'image';
                  console.log('[schedule_post chat] Found asset by name:', assetName, '->', matchedAsset.name);
                }
              }

              // 2. Check assetId
              if (!resolvedMediaUrl && assetId && contentType !== 'text') {
                const kb = project.knowledgeBase || [];
                const asset = kb.find(k => k.id === assetId);
                if (asset?.url) resolvedMediaUrl = asset.url;
              }

              // 3. Check useLastGenerated
              if (!resolvedMediaUrl && useLastGenerated && lastGeneratedAsset) {
                resolvedMediaUrl = lastGeneratedAsset.publicUrl || lastGeneratedAsset.url;
                resolvedContentType = lastGeneratedAsset.type;
                console.log('[schedule_post chat] Using last generated asset:', lastGeneratedAsset);
              }

              // 4. Check readyAttachments for media references
              if (!resolvedMediaUrl && (contentType !== 'text' || isTextReferenceToMedia) && readyAttachments.length > 0) {
                const imageOrVideoAtt = readyAttachments.find(a =>
                  a.uploaded?.mimeType?.startsWith('image/') || a.uploaded?.mimeType?.startsWith('video/')
                );
                if (imageOrVideoAtt?.uploaded?.uri) {
                  resolvedMediaUrl = (imageOrVideoAtt.uploaded as any).publicUrl || imageOrVideoAtt.uploaded.uri;
                  resolvedContentType = imageOrVideoAtt.uploaded.mimeType?.startsWith('video/') ? 'video' : 'image';
                  console.log('[schedule_post chat] Using attached file:', resolvedMediaUrl);
                }
              }

              // 5. Fallback: check lastGeneratedAsset for text references to media
              if (!resolvedMediaUrl && isTextReferenceToMedia && lastGeneratedAsset) {
                resolvedMediaUrl = lastGeneratedAsset.publicUrl || lastGeneratedAsset.url;
                resolvedContentType = lastGeneratedAsset.type;
                console.log('[schedule_post chat] Using last generated asset for text reference');
              }

              // 6. LAST RESORT FALLBACK: If we still need media (based on intent) and haven't found it,
              // check the Knowledge Base for the most recent image or video.
              // This handles cases where state key (lastGeneratedAsset) was lost due to reload/tab switch.
              if (!resolvedMediaUrl && (useLastGenerated || isTextReferenceToMedia || contentType !== 'text')) {
                const kb = project.knowledgeBase || [];
                // Filter for media assets
                const mediaAssets = kb.filter(k =>
                  k.url && (k.type?.startsWith('image/') || k.type?.startsWith('video/'))
                );
                // Use the last one (assuming chronological append)
                const latest = mediaAssets[mediaAssets.length - 1];

                if (latest?.url) {
                  resolvedMediaUrl = latest.url;
                  resolvedContentType = latest.type?.startsWith('video/') ? 'video' : 'image';
                  console.log('[schedule_post chat] Recovered latest asset from KB (fallback):', latest.name);
                  addMessage('model', `(Using latest file: ${latest.name})`);
                }
              }

              // Validate we have media for non-text posts
              if (contentType !== 'text' && !resolvedMediaUrl) {
                addMessage('model', 'I need an image or video to schedule. Please generate one first, attach a file, or specify an asset to use.');
                continue;
              }

              // Update args for executeSchedulePost
              const effectiveArgs = {
                ...args,
                mediaUrl: resolvedMediaUrl,
                contentType: resolvedContentType,
                text: isTextReferenceToMedia && resolvedMediaUrl ? '' : text
              };

              // Use unified scheduling helper
              await executeSchedulePost(
                effectiveArgs,
                addMessage,
                (postId) => {
                  addMessage('model', `✅ Post scheduled successfully!`);
                }
              );
            } catch (scheduleError: any) {
              console.error('schedule_post error:', scheduleError);
              addMessage('model', `❌ Failed to schedule post: ${scheduleError.message || 'Unknown error'}`);
            }

            // ========== Task Management Handlers ==========
          } else if (fc.name === 'create_project_task') {
            try {
              const taskData = {
                title: String(args.title || 'Untitled Task'),
                description: String(args.description || ''),
                priority: (['low', 'medium', 'high'].includes(String(args.priority || '').toLowerCase()))
                  ? String(args.priority).toLowerCase() as 'low' | 'medium' | 'high'
                  : 'medium',
                status: 'todo' as const,
                createdAt: Date.now(),
              };
              await storageService.addTask(project.id, taskData);
              addMessage('model', `✅ Created task: "${taskData.title}" (Priority: ${taskData.priority})`);
              onProjectUpdate?.(await storageService.getResearchProject(project.id) as any);
            } catch (e: any) {
              addMessage('model', `Failed to create task: ${e?.message || 'Unknown error'}`);
            }
          } else if (fc.name === 'update_project_task') {
            try {
              const taskId = String(args.taskId || '');
              if (!taskId) throw new Error('Task ID is required');
              const updates: any = {};
              if (args.status) updates.status = String(args.status);
              if (args.priority) updates.priority = String(args.priority);
              if (args.title) updates.title = String(args.title);
              if (args.description !== undefined) updates.description = String(args.description);
              await storageService.updateTask(project.id, taskId, updates);
              addMessage('model', `✅ Updated task (ID: ${taskId})`);
              onProjectUpdate?.(await storageService.getResearchProject(project.id) as any);
            } catch (e: any) {
              addMessage('model', `Failed to update task: ${e?.message || 'Unknown error'}`);
            }
          } else if (fc.name === 'delete_project_task') {
            try {
              const taskId = String(args.taskId || '');
              if (!taskId) throw new Error('Task ID is required');
              await storageService.deleteTask(project.id, taskId);
              addMessage('model', `✅ Deleted task (ID: ${taskId})`);
              onProjectUpdate?.(await storageService.getResearchProject(project.id) as any);
            } catch (e: any) {
              addMessage('model', `Failed to delete task: ${e?.message || 'Unknown error'}`);
            }

            // ========== Note Management Handlers ==========
          } else if (fc.name === 'create_project_note') {
            try {
              const noteData = {
                title: String(args.title || 'Untitled Note'),
                content: String(args.content || ''),
              };
              await storageService.addNote(project.id, noteData);
              addMessage('model', `✅ Created note: "${noteData.title}"`);
              onProjectUpdate?.(await storageService.getResearchProject(project.id) as any);
            } catch (e: any) {
              addMessage('model', `Failed to create note: ${e?.message || 'Unknown error'}`);
            }
          } else if (fc.name === 'append_project_note') {
            try {
              const noteId = String(args.noteId || '');
              const textToAppend = String(args.text || '');
              if (!noteId) throw new Error('Note ID is required');
              const note = project.notes?.find(n => n.id === noteId);
              if (!note) throw new Error(`Note with ID ${noteId} not found`);
              await storageService.updateNote(project.id, noteId, {
                content: (note.content || '') + '\n\n' + textToAppend
              });
              addMessage('model', `✅ Appended text to note: "${note.title}"`);
              onProjectUpdate?.(await storageService.getResearchProject(project.id) as any);
            } catch (e: any) {
              addMessage('model', `Failed to append to note: ${e?.message || 'Unknown error'}`);
            }
          } else if (fc.name === 'delete_project_note') {
            try {
              const noteId = String(args.noteId || '');
              if (!noteId) throw new Error('Note ID is required');
              await storageService.deleteNote(project.id, noteId);
              addMessage('model', `✅ Deleted note (ID: ${noteId})`);
              onProjectUpdate?.(await storageService.getResearchProject(project.id) as any);
            } catch (e: any) {
              addMessage('model', `Failed to delete note: ${e?.message || 'Unknown error'}`);
            }

            // ========== Scheduled Post Management ==========
          } else if (fc.name === 'delete_scheduled_post') {
            try {
              const postId = String(args.postId || '');
              if (!postId) throw new Error('Post ID is required');
              const updatedScheduledPosts = (project.scheduledPosts || []).filter((p: any) => p.id !== postId);
              await storageService.updateResearchProject(project.id, { scheduledPosts: updatedScheduledPosts } as any);
              addMessage('model', `✅ Cancelled scheduled post (ID: ${postId})`);
              onProjectUpdate?.(await storageService.getResearchProject(project.id) as any);
            } catch (e: any) {
              addMessage('model', `Failed to cancel scheduled post: ${e?.message || 'Unknown error'}`);
            }

            // ========== Research Session ==========
          } else if (fc.name === 'start_new_research_session') {
            try {
              const topic = String(args.topic || '');
              if (!topic) throw new Error('Research topic is required');
              addMessage('model', `🔬 Starting deep research on: "${topic}"...\n\nThis may take a few minutes. I'll analyze multiple sources and compile the findings.`);
              // Trigger the research - this uses the existing deep research infrastructure
              const researchResult = await (window as any).startDeepResearch?.(topic, project.id);
              if (researchResult) {
                addMessage('model', `✅ Research session complete! Check the Research Library in the Overview tab for detailed findings on "${topic}".`);
                onProjectUpdate?.(await storageService.getResearchProject(project.id) as any);
              } else {
                addMessage('model', `Research has been initiated. Check the Overview tab for updates.`);
              }
            } catch (e: any) {
              addMessage('model', `Failed to start research: ${e?.message || 'Unknown error'}`);
            }

            // ========== Email Handlers ==========
          } else if (fc.name === 'send_email') {
            try {
              let provider = String(args.provider || '').toLowerCase();
              if (!provider) {
                if (gmailConnected && !outlookConnected) provider = 'gmail';
                else if (outlookConnected && !gmailConnected) provider = 'outlook';
                else provider = 'gmail'; // Default fallback
              }
              const to = String(args.to || '').trim();
              const subject = String(args.subject || '').trim();
              const body = String(args.body || '').trim();

              if (!to) {
                addMessage('model', 'Please provide the recipient email address.');
                continue;
              }
              if (!subject) {
                addMessage('model', 'Please provide the email subject.');
                continue;
              }
              if (!body) {
                addMessage('model', 'Please provide the email content.');
                continue;
              }

              addMessage('model', `📧 Sending email to ${to} via ${provider.charAt(0).toUpperCase() + provider.slice(1)}...`);

              // Send email via API
              const response = await authFetch(`/api/email?op=send&provider=${provider}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to,
                  subject,
                  html: body.includes('<') ? body : `<p>${body.replace(/\n/g, '<br/>')}</p>`
                })
              });

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                if (response.status === 401 || errorData.error?.includes('token') || errorData.error?.includes('connect')) {
                  addMessage('model', `❌ ${provider.charAt(0).toUpperCase() + provider.slice(1)} is not connected. Please go to the Email tab and connect your ${provider.charAt(0).toUpperCase() + provider.slice(1)} account first.`);
                } else {
                  addMessage('model', `❌ Failed to send email: ${errorData.error || response.statusText}`);
                }
                continue;
              }

              addMessage('model', `✅ Email sent successfully to **${to}**!\n\n**Subject:** ${subject}`);
            } catch (e: any) {
              console.error('send_email error:', e);
              addMessage('model', `❌ Failed to send email: ${e?.message || 'Unknown error'}`);
            }

          } else if (fc.name === 'schedule_email') {
            try {
              let provider = String(args.provider || '').toLowerCase();
              if (!provider) {
                if (gmailConnected && !outlookConnected) provider = 'gmail';
                else if (outlookConnected && !gmailConnected) provider = 'outlook';
                else provider = 'gmail'; // Default fallback
              }
              const to = String(args.to || '').trim();
              const subject = String(args.subject || '').trim();
              const body = String(args.body || '').trim();
              const scheduledTimeStr = String(args.scheduledTime || '').trim();

              if (!to) {
                addMessage('model', 'Please provide the recipient email address(es).');
                continue;
              }
              if (!subject) {
                addMessage('model', 'Please provide the email subject.');
                continue;
              }
              if (!body) {
                addMessage('model', 'Please provide the email content.');
                continue;
              }
              if (!scheduledTimeStr) {
                addMessage('model', 'Please specify when to send the email (e.g., "tomorrow at 9am").');
                continue;
              }

              // Parse the scheduled time
              const parsedTime = parseScheduleDate(scheduledTimeStr);
              if (!parsedTime) {
                addMessage('model', `Could not understand the time "${scheduledTimeStr}". Please try something like "tomorrow at 9am" or "next Monday at 2pm".`);
                continue;
              }

              const scheduledAtUnix = Math.floor(parsedTime / 1000);
              const nowUnix = Math.floor(Date.now() / 1000);

              if (scheduledAtUnix < nowUnix + 600) {
                addMessage('model', 'The scheduled time must be at least 10 minutes in the future.');
                continue;
              }
              if (scheduledAtUnix > nowUnix + 7 * 24 * 3600) {
                addMessage('model', 'The scheduled time cannot be more than 7 days ahead.');
                continue;
              }

              const scheduledDate = new Date(scheduledAtUnix * 1000);
              addMessage('model', `📅 Scheduling email for ${scheduledDate.toLocaleString()}...`);

              // Schedule email via API
              const response = await authFetch('/api/email?op=email-schedule-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  projectId: project.id,
                  scheduledAt: scheduledAtUnix,
                  provider,
                  to: to.includes(',') ? to.split(',').map(e => e.trim()) : to,
                  subject,
                  html: body.includes('<') ? body : `<p>${body.replace(/\n/g, '<br/>')}</p>`
                })
              });

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                if (response.status === 401 || errorData.error?.includes('token') || errorData.error?.includes('connect')) {
                  addMessage('model', `❌ ${provider.charAt(0).toUpperCase() + provider.slice(1)} is not connected. Please go to the Email tab and connect your account first.`);
                } else {
                  addMessage('model', `❌ Failed to schedule email: ${errorData.error || response.statusText}`);
                }
                continue;
              }

              const result = await response.json();
              addMessage('model', `✅ Email scheduled successfully!\n\n**To:** ${to}\n**Subject:** ${subject}\n**Scheduled for:** ${scheduledDate.toLocaleString()}\n**ID:** ${result.emailId || 'N/A'}`);
            } catch (e: any) {
              console.error('schedule_email error:', e);
              addMessage('model', `❌ Failed to schedule email: ${e?.message || 'Unknown error'}`);
            }

          } else if (fc.name === 'send_bulk_email') {
            try {
              let provider = String(args.provider || '').toLowerCase();
              if (!provider) {
                if (gmailConnected && !outlookConnected) provider = 'gmail';
                else if (outlookConnected && !gmailConnected) provider = 'outlook';
                else provider = 'gmail'; // Default fallback
              }
              const formId = args.formId ? String(args.formId) : null;
              const subject = String(args.subject || '').trim();
              const bodyTemplate = String(args.body || '').trim();

              if (!subject) {
                addMessage('model', 'Please provide the email subject.');
                continue;
              }
              if (!bodyTemplate) {
                addMessage('model', 'Please provide the email content.');
                continue;
              }

              // Get captured leads from project
              const leads = project.capturedLeads || [];
              if (leads.length === 0) {
                addMessage('model', '❌ No captured leads found in this project. Create a lead form and collect some leads first!');
                continue;
              }

              // Filter by form if specified
              const targetLeads = formId
                ? leads.filter((lead: any) => lead.formId === formId)
                : leads;

              if (targetLeads.length === 0) {
                addMessage('model', formId
                  ? `❌ No leads found for the specified form. Try without a form filter to email all ${leads.length} leads.`
                  : '❌ No leads with email addresses found.');
                continue;
              }

              // Get unique emails
              const uniqueEmails = [...new Set(targetLeads.filter((l: any) => l.email).map((l: any) => l.email))];
              if (uniqueEmails.length === 0) {
                addMessage('model', '❌ None of the leads have email addresses.');
                continue;
              }

              addMessage('model', `📧 Sending email to ${uniqueEmails.length} lead${uniqueEmails.length > 1 ? 's' : ''} via ${provider.charAt(0).toUpperCase() + provider.slice(1)}...`);

              let successCount = 0;
              let failCount = 0;

              for (const lead of targetLeads.filter((l: CapturedLead) => l.data?.email)) {
                try {
                  // Personalize body with lead name if available
                  const personalizedBody = bodyTemplate.replace(/\{name\}/gi, lead.data?.name || lead.data?.fullName || 'there');
                  const htmlBody = personalizedBody.includes('<') ? personalizedBody : `<p>${personalizedBody.replace(/\n/g, '<br/>')}</p>`;

                  const response = await authFetch(`/api/email?op=send&provider=${provider}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      to: lead.data.email,
                      subject,
                      html: htmlBody
                    })
                  });

                  if (response.ok) {
                    successCount++;
                  } else {
                    failCount++;
                    console.error(`Failed to send to ${lead.data.email}:`, await response.text());
                  }
                } catch (sendErr) {
                  failCount++;
                  console.error(`Error sending to ${lead.data?.email}:`, sendErr);
                }

                // Small delay between sends to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
              }

              if (successCount > 0) {
                addMessage('model', `✅ Bulk email complete!\n\n**Sent:** ${successCount} emails\n${failCount > 0 ? `**Failed:** ${failCount} emails` : ''}\n**Subject:** ${subject}`);
              } else {
                addMessage('model', `❌ Failed to send emails. Please make sure ${provider.charAt(0).toUpperCase() + provider.slice(1)} is connected in the Email tab.`);
              }
            } catch (e: any) {
              console.error('send_bulk_email error:', e);
              addMessage('model', `❌ Failed to send bulk email: ${e?.message || 'Unknown error'}`);
            }

            // ========== PDF Generation Handler ==========
          } else if (fc.name === 'generate_pdf') {
            try {
              const hasCredits = await checkCredits('bookGeneration');
              if (!hasCredits) {
                addMessage('model', '❌ Insufficient credits to generate a PDF book.');
                continue;
              }

              const success = await deductCredits('bookGeneration');
              if (!success) {
                addMessage('model', '❌ Failed to deduct credits.');
                continue;
              }

              const prompt = String(args.prompt || '').trim();
              const pageCount = Math.max(4, Math.min(24, Number(args.pageCount) || 8));
              const documentType = String(args.documentType || 'guide');

              if (!prompt) {
                addMessage('model', 'Please describe what the PDF should be about.');
                continue;
              }

              addMessage('model', `📄 Generating a ${pageCount}-page ${documentType} PDF about: "${prompt}"...\n\nThis may take a few minutes as I create illustrated pages.`);

              // Build context
              const ctx = contextService.buildProjectContext(project);

              // Refine the prompt
              const refinedPrompt = await refinePromptWithGemini3(
                `Create a ${documentType} about: ${prompt}`,
                ctx.fullContext,
                'text'
              );

              // Generate the book spec
              const bookSpec = await generateBookFromProjectContext(
                project,
                refinedPrompt,
                pageCount,
                ctx.fullContext
              );

              if (!bookSpec.pages || !bookSpec.pages.length) {
                throw new Error('No pages generated');
              }

              const latestSession = project.researchSessions?.[project.researchSessions.length - 1];
              const sessionId = latestSession?.id;
              const pdfId = typeof crypto !== 'undefined' && (crypto as any).randomUUID
                ? (crypto as any).randomUUID()
                : `pdf-${Date.now()}`;

              const existingKb = project.knowledgeBase || [];
              let interimKnowledgeBase = [...existingKb];
              const newKbFiles: KnowledgeBaseFile[] = [];
              const pages: { pageNumber: number; imageUrl: string }[] = [];

              let previousImageBase64: string | null = null;

              // Generate each page
              for (let i = 0; i < Math.min(bookSpec.pages.length, pageCount); i++) {
                const page = bookSpec.pages[i];
                const references: ImageReference[] = [];
                if (previousImageBase64) {
                  references.push({ base64: previousImageBase64, mimeType: 'image/png' });
                }

                const pagePrompt = `${bookSpec.title || documentType} page ${page.pageNumber}: ${page.imagePrompt || page.text || prompt}`;
                const result = await generateImageWithReferences(pagePrompt, references);
                const imageUrl = result.imageDataUrl;

                try {
                  const res = await fetch(imageUrl);
                  const blob = await res.blob();
                  const fileName = `${documentType}-${pdfId}-page-${page.pageNumber}-${Date.now()}.png`;
                  const file = new File([blob], fileName, { type: blob.type || 'image/png' });
                  const kbFile = await storageService.uploadKnowledgeBaseFile(project.id, file, sessionId);
                  newKbFiles.push(kbFile);
                  interimKnowledgeBase = [...interimKnowledgeBase, kbFile];

                  // Update base64 for continuity
                  if (imageUrl.startsWith('data:')) {
                    previousImageBase64 = imageUrl.split(',')[1] || null;
                  }

                  pages.push({ pageNumber: page.pageNumber, imageUrl: kbFile.url });
                } catch (pageErr) {
                  console.error(`Failed to generate page ${page.pageNumber}:`, pageErr);
                }
              }

              if (pages.length === 0) {
                throw new Error('Failed to generate any pages');
              }

              // Compile PDF
              const pdfDoc = await PDFDocument.create();
              const sortedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);

              for (const page of sortedPages) {
                try {
                  const res = await fetch(page.imageUrl);
                  const blob = await res.blob();
                  const arrayBuffer = await blob.arrayBuffer();
                  const contentType = (blob.type || 'image/png').toLowerCase();

                  let image: any;
                  if (contentType.includes('jpeg') || contentType.includes('jpg')) {
                    image = await pdfDoc.embedJpg(arrayBuffer);
                  } else {
                    try {
                      image = await pdfDoc.embedPng(arrayBuffer);
                    } catch {
                      image = await pdfDoc.embedJpg(arrayBuffer);
                    }
                  }

                  const { width, height } = image.scale(1);
                  const pdfPage = pdfDoc.addPage([width, height]);
                  pdfPage.drawImage(image, { x: 0, y: 0, width, height });
                } catch (embedErr) {
                  console.error('Failed to embed page in PDF:', embedErr);
                }
              }

              const pdfBytes = await pdfDoc.save();
              // Check for potential duplicates (same title created < 1 min ago)
              let bookAsset: BookAsset | undefined;
              const existingBooks = (latestSession?.researchReport?.books || []) as BookAsset[];
              const recentDuplicate = existingBooks.find(b =>
                (b.title === (bookSpec.title || prompt.slice(0, 50))) &&
                (Date.now() - (b.createdAt || 0) < 60000)
              );

              if (recentDuplicate && recentDuplicate.pdfUrl) {
                console.log('Skipping duplicate book generation, using existing:', recentDuplicate.title);
                addMessage('model', `I noticed you just generated this PDF. Here is the link again:\n\n[📥 **Download PDF**](${recentDuplicate.pdfUrl})`);
                return;
              }

              const pdfBlob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
              const pdfFileName = `${documentType}-${pdfId}.pdf`;
              const pdfFile = new File([pdfBlob], pdfFileName, { type: 'application/pdf' });

              // Upload PDF to knowledge base
              const pdfKbFile = await storageService.uploadKnowledgeBaseFile(project.id, pdfFile, sessionId);
              newKbFiles.push(pdfKbFile);

              // Update project knowledge base - deduplicate by ID to prevent double saves
              const existingIds = new Set(existingKb.map(f => f.id));
              const uniqueNewKbFiles = newKbFiles.filter(f => !existingIds.has(f.id));
              const updatedKnowledgeBase = [...existingKb, ...uniqueNewKbFiles];
              let updatedProject: ResearchProject = {
                ...project,
                knowledgeBase: updatedKnowledgeBase,
                lastModified: Date.now(),
              };

              // Also save as BookAsset in the research session so it appears in PDFs tab
              if (sessionId && latestSession?.researchReport) {
                const existingBooks = latestSession.researchReport.books || [];
                const bookAsset: BookAsset = {
                  id: pdfId,
                  title: bookSpec.title || prompt.slice(0, 50),
                  description: bookSpec.description || `${documentType} with ${pages.length} pages`,
                  pages: pages.map((p, idx) => ({
                    id: `page-${idx + 1}`,
                    pageNumber: p.pageNumber,
                    imageUrl: p.imageUrl,
                    prompt: bookSpec.pages[idx]?.text || bookSpec.pages[idx]?.title || '',
                    text: bookSpec.pages[idx]?.title || '',
                  })),
                  createdAt: Date.now(),
                  pdfUrl: pdfKbFile.url,
                  pdfFileId: pdfKbFile.id,
                };

                const updatedReport = {
                  ...latestSession.researchReport,
                  books: [bookAsset, ...existingBooks],
                };

                await storageService.updateResearchInProject(project.id, sessionId, { researchReport: updatedReport });

                const updatedSessions = (project.researchSessions || []).map(session =>
                  session.id === sessionId ? { ...session, researchReport: updatedReport } : session
                );

                updatedProject = {
                  ...updatedProject,
                  researchSessions: updatedSessions,
                };
              }

              await storageService.updateResearchProject(project.id, {
                knowledgeBase: updatedKnowledgeBase,
                researchSessions: updatedProject.researchSessions,
                lastModified: Date.now()
              });
              onProjectUpdate?.(updatedProject);

              // Create inline message with download button
              const pdfUrl = pdfKbFile.url;
              const successMessage = `✅ **${bookSpec.title || documentType.charAt(0).toUpperCase() + documentType.slice(1)} Generated!**

**${pages.length} pages** created and saved to your project assets.

[📥 **Download PDF**](${pdfUrl})

*You can also find this in your Assets → PDFs tab.*`;

              addMessage('model', successMessage);

            } catch (e: any) {
              console.error('generate_pdf error:', e);
              addMessage('model', `❌ Failed to generate PDF: ${e?.message || 'Unknown error'}`);
            }

            // ========== Form Generation Handler ==========
          } else if (fc.name === 'generate_form') {
            try {
              // Check credits
              if (!await hasEnoughCredits('formGeneration')) {
                addMessage('model', '❌ Insufficient credits to generate a lead form (requires 45 credits).');
                continue;
              }

              const title = String(args.title || 'Untitled Form');
              const prompt = String(args.prompt || '');
              const fields = Array.isArray(args.fields) ? args.fields : [];

              addMessage('model', `📝 Generating lead form "${title}" with ${fields.length} fields...\n\nDesign: "${prompt}"`);

              // Deduct credits
              await deductCredits('formGeneration');

              const formId = `form-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const origin = typeof window !== 'undefined' ? window.location.origin : 'https://freshfront.co';

              // Create placeholder
              const placeholderRes = await authFetch('/api/websites?op=create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  html: '<html><body>Loading...</body></html>',
                  projectId: project.id,
                  versionId: formId,
                  title: title,
                  formId: formId,
                  type: 'form'
                })
              });

              if (!placeholderRes.ok) throw new Error('Failed to create form placeholder');
              const { slug } = await placeholderRes.json();
              const publicUrl = `${origin}/w/${slug}`;

              // Generate
              let generatedHtml = '';
              const finalHtml = await streamLeadFormWebsite(
                prompt,
                fields,
                formId,
                slug,
                project.id,
                title,
                (chunk) => { generatedHtml += chunk; },
                undefined,
                []
              );

              // Update website
              await authFetch('/api/websites?op=update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  slug: slug,
                  html: finalHtml,
                  title: title,
                  formId: formId,
                  type: 'form'
                })
              });

              // Save Asset
              const newLeadForm: LeadFormAsset = {
                id: formId,
                title: title,
                prompt: prompt,
                fields: fields,
                html: finalHtml,
                publicUrl,
                slug,
                createdAt: Date.now(),
                projectId: project.id
              };

              await authFetch('/api/websites?op=save-form', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ form: newLeadForm })
              });

              addMessage('model', `✅ **${title}** created successfully!\n\n[Open Lead Form](${publicUrl})`);

            } catch (e: any) {
              console.error('generate_form error:', e);
              addMessage('model', `❌ Failed to generate form: ${e?.message || 'Unknown error'}`);
            }

            // ========== Stripe Product Creation Handler ==========
          } else if (fc.name === 'create_stripe_product') {
            try {
              const productName = String(args.name || '').trim();
              const description = String(args.description || '').trim();
              const price = Number(args.price) || 0;
              const currency = String(args.currency || 'usd').toLowerCase();
              let imageUrl = String(args.imageUrl || '').trim();
              const assetName = String(args.assetName || '').trim();
              const useLastGenerated = Boolean(args.useLastGenerated);

              if (!productName) {
                addMessage('model', 'Please provide a product name.');
                continue;
              }
              if (price <= 0) {
                addMessage('model', 'Please provide a valid price (greater than 0).');
                continue;
              }

              // Check Stripe connection
              const userProfile = (window as any).__userProfile as UserProfile | undefined;
              const stripeAccountId = userProfile?.stripeConnect?.accountId;

              if (!stripeAccountId) {
                addMessage('model', `❌ **Stripe not connected!**

Before creating products, you need to connect your Stripe account:

1. Go to the **Products** tab in Assets
2. Click **"Connect Stripe"**
3. Complete the Stripe onboarding

Once connected, come back and I can help you create your product!`);
                continue;
              }

              // Resolve image URL from various sources
              if (!imageUrl && useLastGenerated && lastGeneratedAsset) {
                imageUrl = typeof lastGeneratedAsset === 'string' ? lastGeneratedAsset : lastGeneratedAsset.url;
                console.log('[create_stripe_product] Using last generated asset:', imageUrl);
              }

              if (!imageUrl && assetName) {
                // Search knowledge base for matching asset
                const kb = project.knowledgeBase || [];
                const match = kb.find((f: KnowledgeBaseFile) =>
                  f.type?.startsWith('image/') &&
                  f.name?.toLowerCase().includes(assetName.toLowerCase())
                );
                if (match) {
                  imageUrl = match.url;
                  console.log('[create_stripe_product] Found asset by name:', assetName, '->', match.name);
                }
              }

              // Use attached file if available
              if (!imageUrl && readyAttachments.length > 0) {
                const imageAttachment = readyAttachments.find((a: any) =>
                  a.file?.type?.startsWith('image/') || a.uploaded?.mimeType?.startsWith('image/')
                );
                if (imageAttachment?.uploaded?.url) {
                  imageUrl = imageAttachment.uploaded.url;
                  console.log('[create_stripe_product] Using attached image:', imageUrl);
                }
              }

              addMessage('model', `💳 Creating product: **${productName}** at $${price.toFixed(2)} ${currency.toUpperCase()}...`);

              // Create product via API
              const productRes = await authFetch('/api/billing?op=create-product', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  accountId: stripeAccountId,
                  name: productName,
                  description: description || undefined,
                  price: price, // API expects dollars, converts to cents
                  currency,
                  images: imageUrl ? [imageUrl] : undefined,
                })
              });

              if (!productRes.ok) {
                const errData = await productRes.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to create product');
              }

              const productData = await productRes.json();

              // Create payment link
              const linkRes = await authFetch('/api/billing?op=create-payment-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  accountId: stripeAccountId,
                  priceId: productData.priceId,
                  quantity: 1,
                })
              });

              let paymentLinkUrl = '';
              if (linkRes.ok) {
                const linkData = await linkRes.json();
                paymentLinkUrl = linkData.url || '';
              }

              // Save product to project
              const newProduct = {
                id: productData.id,
                name: productData.name,
                description: productData.description || undefined,
                priceId: productData.priceId,
                active: true,
                unitAmount: productData.unitAmount,
                currency: productData.currency,
                createdAt: Date.now(),
                images: productData.images || (imageUrl ? [imageUrl] : []),
                paymentLinkUrl,
              };

              const updatedProducts = [...(project.stripeProducts || []), newProduct];
              await storageService.updateResearchProject(project.id, { stripeProducts: updatedProducts });
              onProjectUpdate?.({ ...project, stripeProducts: updatedProducts });

              // Format success message with payment link
              const priceFormatted = `$${(productData.unitAmount / 100).toFixed(2)} ${productData.currency.toUpperCase()}`;
              const successMessage = `✅ **Product Created Successfully!**

**${productName}**
${description ? `_${description}_\n` : ''}
**Price:** ${priceFormatted}
${imageUrl ? `**Image:** ✓ Added` : '**Image:** None (you can add one in the Products tab)'}

${paymentLinkUrl ? `**🔗 Payment Link:**
[${paymentLinkUrl}](${paymentLinkUrl})

Share this link with customers to start selling!` : '*(Payment link will be available in the Products tab)*'}

You can manage this product in **Assets → Products**.`;

              addMessage('model', successMessage);

            } catch (e: any) {
              console.error('create_stripe_product error:', e);
              addMessage('model', `❌ Failed to create product: ${e?.message || 'Unknown error'}`);
            }

            // ========== World Generation Handler ==========
          } else if (fc.name === 'generate_world') {
            try {
              const prompt = String(args.prompt || '').trim();
              const inputType = String(args.inputType || 'text').toLowerCase() as 'text' | 'image' | 'video';
              let imageUrl = String(args.imageUrl || '').trim();
              let videoUrl = String(args.videoUrl || '').trim();
              const assetName = String(args.assetName || '').trim();
              const useLastGenerated = Boolean(args.useLastGenerated);

              if (!prompt) {
                addMessage('model', 'Please describe the world you want to create.');
                continue;
              }

              // Credit Check
              const hasCredits = await checkCredits('worldGeneration');
              if (!hasCredits) continue;

              const success = await deductCredits('worldGeneration');
              if (!success) {
                addMessage('model', '❌ Failed to deduct credits for world generation.');
                continue;
              }

              // Resolve media URL from various sources
              let mediaUrl = inputType === 'video' ? videoUrl : imageUrl;

              if (!mediaUrl && useLastGenerated && lastGeneratedAsset) {
                mediaUrl = typeof lastGeneratedAsset === 'string' ? lastGeneratedAsset : lastGeneratedAsset.url;
                console.log('[generate_world] Using last generated asset:', mediaUrl);
              }

              if (!mediaUrl && assetName) {
                const kb = project.knowledgeBase || [];
                const isVideo = inputType === 'video';
                const match = kb.find((f: KnowledgeBaseFile) => {
                  const typeMatch = isVideo ? f.type?.startsWith('video/') : f.type?.startsWith('image/');
                  return typeMatch && f.name?.toLowerCase().includes(assetName.toLowerCase());
                });
                if (match) {
                  mediaUrl = match.url;
                  console.log('[generate_world] Found asset by name:', assetName, '->', match.name);
                }
              }

              // Check conversation media
              if (!mediaUrl && currentConversationMedia.length > 0) {
                const targetType = inputType === 'video' ? 'video' : 'image';
                const media = currentConversationMedia.find(m => m.type === targetType);
                if (media) {
                  mediaUrl = media.publicUrl || media.url;
                  console.log('[generate_world] Using conversation media:', mediaUrl);
                }
              }

              // Check attachments
              if (!mediaUrl && readyAttachments.length > 0) {
                const isVideo = inputType === 'video';
                const attachment = readyAttachments.find((a: any) => {
                  const mimeType = a.file?.type || a.uploaded?.mimeType || '';
                  return isVideo ? mimeType.startsWith('video/') : mimeType.startsWith('image/');
                });
                if (attachment?.uploaded?.url) {
                  mediaUrl = attachment.uploaded.url;
                  console.log('[generate_world] Using attached media:', mediaUrl);
                }
              }

              // Validate media for non-text types
              if ((inputType === 'image' || inputType === 'video') && !mediaUrl) {
                addMessage('model', `Please provide ${inputType === 'video' ? 'a video' : 'an image'} to use as a structure guide, or switch to text-only mode.`);
                continue;
              }

              addMessage('model', `🌍 Starting world generation...\n\n**Prompt:** ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}\n**Type:** ${inputType}${mediaUrl ? '\n**Guide:** ✓ Using media reference' : ''}\n\n_Generation takes ~5 minutes. You'll see the world in Assets → Worlds when ready!_`);

              // Build request
              const request: WorldGenerationRequest = {
                world_prompt: {
                  type: inputType,
                  text_prompt: prompt,
                }
              };

              if (inputType === 'image' && mediaUrl) {
                request.world_prompt.image_prompt = { source: 'uri', uri: mediaUrl };
              } else if (inputType === 'video' && mediaUrl) {
                request.world_prompt.video_prompt = { source: 'uri', uri: mediaUrl };
              }

              // Start generation
              const operation = await worldLabsService.generateWorld(request);

              // Save to project with 'generating' status
              const newWorld = {
                id: operation.operation_id,
                prompt,
                status: 'generating' as const,
                createdAt: Date.now(),
                previewUrl: '',
                data: { operation_id: operation.operation_id }
              };
              const updatedWorlds = [newWorld, ...(project.worlds || [])];
              await storageService.updateResearchProject(project.id, { worlds: updatedWorlds });
              onProjectUpdate?.({ ...project, worlds: updatedWorlds });

              addMessage('model', `✅ World generation started!\n\nYour world is being generated and will appear in **Assets → Worlds** when ready (~5 minutes).\n\nYou can continue working on other things while it generates.`);

            } catch (e: any) {
              console.error('generate_world error:', e);
              addMessage('model', `❌ Failed to start world generation: ${e?.message || 'Unknown error'}`);
            }

            // ========== Email Template Scheduling Handler ==========
          } else if (fc.name === 'schedule_template_email') {
            try {
              const templateName = String(args.templateName || '').trim().toLowerCase();
              const formName = args.formName ? String(args.formName).trim().toLowerCase() : null;
              const tableName = args.tableName ? String(args.tableName).trim().toLowerCase() : null;
              const fileName = args.fileName ? String(args.fileName).trim().toLowerCase() : null;
              const emailSource = String(args.emailSource || 'ask').toLowerCase();
              const scheduledAt = String(args.scheduledAt || 'now').trim();

              // Smart provider selection
              let provider = String(args.provider || '').toLowerCase();
              if (!provider) {
                if (gmailConnected && !outlookConnected) provider = 'gmail';
                else if (outlookConnected && !gmailConnected) provider = 'outlook';
                else provider = 'gmail'; // Default fallback
              }

              const customSubject = String(args.subject || '').trim();
              const customBody = String(args.body || '').trim();

              let subject = '';
              let html = '';
              let templateLabel = 'Custom Email';

              // Determine email content source
              if (templateName) {
                const templates = project.emailTemplates || [];

                // Smart template matching: strip common words and try multiple strategies
                const stopWords = ['the', 'a', 'an', 'my', 'email', 'template', 'called', 'named', 'to', 'for', 'send', 'schedule'];
                const searchWords = templateName.split(/\s+/).filter(w => !stopWords.includes(w.toLowerCase()));
                const cleanedSearch = searchWords.join(' ').toLowerCase();

                // Try matching strategies in order of specificity
                let template = templates.find(t => t.name.toLowerCase() === cleanedSearch) // Exact match after cleaning
                  || templates.find(t => t.name.toLowerCase() === templateName) // Exact match with original
                  || templates.find(t => t.name.toLowerCase().includes(cleanedSearch)) // Cleaned search in name
                  || templates.find(t => cleanedSearch.includes(t.name.toLowerCase())) // Name word in cleaned search
                  || templates.find(t => searchWords.some(w => t.name.toLowerCase().includes(w))) // Any word match
                  || templates.find(t => t.name.toLowerCase().includes(templateName)); // Original includes

                if (!template) {
                  const available = templates.map(t => t.name).join(', ') || 'none';
                  addMessage('model', `❌ Template "${templateName}" not found.\n\n**Available templates:** ${available || 'No templates saved yet. Create one in the Email tab first.'}\n\nAlternatively, provide a subject and body directly.`);
                  continue;
                }

                subject = customSubject || template.subject || template.name;

                // Construct HTML body from blocks if available (same as voice mode)
                html = ''; // Reset to ensure clean state

                if (template.blocks && template.blocks.length > 0) {
                  try {
                    const generated = generateEmailHtml(template.blocks);
                    if (generated && generated.trim().length > 0) {
                      html = generated;
                    } else {
                      console.warn('[ProjectLiveAssistant] generateEmailHtml returned empty string for template:', template.name);
                    }
                  } catch (err) {
                    console.error('[ProjectLiveAssistant] Failed to generate HTML from blocks:', err);
                  }
                }

                // Fallback to custom body or legacy body if html is still empty
                if (!html || html.trim().length === 0) {
                  html = customBody || template.body || '';
                }

                // If still empty, try to construct a basic representation from blocks as last resort
                if ((!html || html.trim().length === 0) && template.blocks && template.blocks.length > 0) {
                  html = template.blocks.map((b: any) => {
                    if (b.type === 'text' || b.type === 'header' || b.type === 'footer') return `<p>${b.content?.text || ''}</p>`;
                    if (b.type === 'image') return `<img src="${b.content?.src || b.content?.url || ''}" alt="${b.content?.alt || ''}" style="max-width: 100%; display: block;" />`;
                    if (b.type === 'button') return `<a href="${b.content?.url}" style="padding: 10px 20px; background: #007bff; color: white;">${b.content?.text}</a>`;
                    return '';
                  }).join('');
                }

                if (!html || html.trim().length === 0) {
                  addMessage('model', `❌ The email template "${template.name}" appears to be empty. Please edit the template to add content blocks (Text, Image, etc.) and save it again.`);
                  continue;
                }

                templateLabel = template.name;
              } else if (customSubject && customBody) {
                subject = customSubject;
                html = customBody;
              } else {
                addMessage('model', `📧 To send an email, I need:\n\n1. **A saved template name** (e.g., "schedule the awesome email")\n   - OR -\n2. **Email content**: Please provide a subject and body.\n\n**Your saved templates:** ${(project.emailTemplates || []).map(t => t.name).join(', ') || 'None yet. Create one in the Email tab.'}`);
                continue;
              }

              // ========== Get emails from source ==========
              let emails: string[] = [];
              let sourceLabel = '';

              if (emailSource === 'ask' || (!formName && !tableName && !fileName && emailSource !== 'leads' && emailSource !== 'table' && emailSource !== 'file')) {
                // List available sources and ask user
                const leadsRes = await authFetch(`/api/websites?op=get-leads&projectId=${project.id}`);
                const leadsData = leadsRes.ok ? await leadsRes.json() : { leads: [] };
                const leadsByForm = (leadsData.leads || []).reduce((acc: Record<string, number>, l: any) => {
                  const form = l.formTitle || 'Unknown Form';
                  acc[form] = (acc[form] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>);

                // Get tables from research sessions
                const tables: { name: string; session: string; rows: number }[] = [];
                for (const session of project.researchSessions || []) {
                  for (const table of session.researchReport?.tables || []) {
                    tables.push({ name: table.title, session: session.topic, rows: table.rows?.length || 0 });
                  }
                }

                // Get uploaded files (CSV/Excel)
                const files = (project.uploadedFiles || []).filter(f =>
                  f.name?.toLowerCase().endsWith('.csv') ||
                  f.name?.toLowerCase().endsWith('.xlsx') ||
                  f.name?.toLowerCase().endsWith('.xls')
                );

                let sourcesMsg = `📧 **Which email list should I send to?**\n\n`;

                if (Object.keys(leadsByForm).length > 0) {
                  sourcesMsg += `**📝 Lead Forms:**\n${Object.entries(leadsByForm).map(([form, count]) => `- "${form}" (${count} leads)`).join('\n')}\n\n`;
                }

                if (tables.length > 0) {
                  sourcesMsg += `**📊 Tables (Assets):**\n${tables.map(t => `- "${t.name}" (${t.rows} rows)`).join('\n')}\n\n`;
                }

                if (files.length > 0) {
                  sourcesMsg += `**📁 Uploaded Files:**\n${files.map(f => `- "${f.name}"`).join('\n')}\n\n`;
                }

                if (Object.keys(leadsByForm).length === 0 && tables.length === 0 && files.length === 0) {
                  sourcesMsg = `❌ No email lists found.\n\n**To create an email list:**\n- Capture leads using a form in Assets → Forms\n- Create a table with an "email" column in Assets → Tables\n- Upload a CSV file with email addresses`;
                } else {
                  sourcesMsg += `**Please specify:** "send to leads from [form name]" or "send to [table name] table"`;
                }

                addMessage('model', sourcesMsg);
                continue;
              }

              // ========== Source: Leads ==========
              if (emailSource === 'leads' || formName) {
                let leads: any[] = [];

                if (formName) {
                  // Resolve form name to ID for efficient fetching
                  try {
                    const formsRes = await authFetch(`/api/websites?op=list-forms&projectId=${project.id}`);
                    const formsData = formsRes.ok ? await formsRes.json() : { forms: [] };
                    const forms = formsData.forms || [];

                    // Simple case-insensitive matching
                    const matchedForm = forms.find((f: any) => f.title?.toLowerCase().includes(formName));

                    if (matchedForm) {
                      // Fetch leads specific to this form
                      const leadsRes = await authFetch(`/api/websites?op=get-leads&formId=${matchedForm.id}`);
                      if (leadsRes.ok) {
                        const leadsData = await leadsRes.json();
                        leads = leadsData.leads || [];
                        sourceLabel = `leads from "${matchedForm.title}"`;
                      }
                    } else {
                      addMessage('model', `❌ Form matching "${formName}" not found. Available forms: ${forms.map((f: any) => f.title).join(', ') || 'None'}`);
                      continue;
                    }
                  } catch (err) {
                    console.error('Failed to resolve form for email:', err);
                    addMessage('model', '❌ Failed to resolve form details.');
                    continue;
                  }
                } else {
                  // Fetch all leads for project
                  try {
                    const leadsRes = await authFetch(`/api/websites?op=get-leads&projectId=${project.id}`);
                    if (leadsRes.ok) {
                      const leadsData = await leadsRes.json();
                      leads = leadsData.leads || [];
                      sourceLabel = 'all leads';
                    }
                  } catch (err) {
                    console.error('Failed to fetch leads:', err);
                  }
                }

                if (leads.length === 0) {
                  addMessage('model', formName
                    ? `❌ No leads found in form "${formName}".`
                    : '❌ No leads found. Capture some leads using your forms first.');
                  continue;
                }

                emails = leads.map((l: any) => l.data?.email || l.data?.Email || Object.values(l.data || {}).find((v: any) => typeof v === 'string' && v.includes('@'))).filter(Boolean) as string[];
              }

              // ========== Source: Table ==========
              else if (emailSource === 'table' || tableName) {
                let foundTable: any = null;
                const searchName = tableName || '';

                for (const session of project.researchSessions || []) {
                  for (const table of session.researchReport?.tables || []) {
                    if (table.title?.toLowerCase().includes(searchName)) {
                      foundTable = table;
                      break;
                    }
                  }
                  if (foundTable) break;
                }

                if (!foundTable) {
                  addMessage('model', `❌ Table "${tableName}" not found in Assets.\n\nAvailable tables: ${(project.researchSessions || []).flatMap(s => s.researchReport?.tables?.map(t => t.title) || []).join(', ') || 'None'}`);
                  continue;
                }

                // Find email column (case-insensitive)
                const emailColIdx = foundTable.columns?.findIndex((c: string) => c.toLowerCase().includes('email')) ?? -1;
                if (emailColIdx === -1) {
                  addMessage('model', `❌ No "email" column found in table "${foundTable.title}".\n\nColumns: ${foundTable.columns?.join(', ') || 'None'}`);
                  continue;
                }

                emails = (foundTable.rows || []).map((row: string[]) => row[emailColIdx]).filter((e: string) => e && e.includes('@'));
                sourceLabel = `table "${foundTable.title}"`;
              }

              // ========== Source: File ==========
              else if (emailSource === 'file' || fileName) {
                const searchName = fileName || '';
                const file = (project.uploadedFiles || []).find(f => f.name?.toLowerCase().includes(searchName));

                if (!file) {
                  const csvFiles = (project.uploadedFiles || []).filter(f => f.name?.toLowerCase().endsWith('.csv') || f.name?.toLowerCase().includes('.xls'));
                  addMessage('model', `❌ File "${fileName}" not found.\n\nAvailable files: ${csvFiles.map(f => f.name).join(', ') || 'None'}`);
                  continue;
                }

                // Try to extract emails from file summary or content
                if (file.summary) {
                  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                  emails = (file.summary.match(emailRegex) || []) as string[];
                }

                if (emails.length === 0) {
                  addMessage('model', `❌ Could not extract email addresses from "${file.name}". Make sure the file has been processed and contains valid email addresses.`);
                  continue;
                }
                sourceLabel = `file "${file.name}"`;
              }

              if (emails.length === 0) {
                addMessage('model', '❌ No valid email addresses found in the selected source.');
                continue;
              }

              addMessage('model', `📧 Found **${emails.length} email(s)** from ${sourceLabel}. Sending **"${templateLabel}"**...`);

              // 5. Schedule or send immediately
              const isNow = scheduledAt.toLowerCase() === 'now' || !scheduledAt;

              if (isNow) {
                // Send immediately to all recipients
                let successCount = 0;
                let failCount = 0;

                for (const email of emails) {
                  try {
                    const res = await authFetch(`/api/email?op=send&provider=${provider}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ to: email, subject, html })
                    });
                    if (res.ok) successCount++;
                    else failCount++;
                  } catch {
                    failCount++;
                  }
                }

                addMessage('model', `✅ Sent **"${templateLabel}"** to ${successCount} leads!${failCount > 0 ? ` (${failCount} failed)` : ''}`);
              } else {
                // Parse scheduled time
                let scheduledTime: string | number = scheduledAt;

                // Check if it's already a valid date string (e.g. ISO from model)
                const directDate = new Date(scheduledAt);
                const isValidDate = !isNaN(directDate.getTime());
                const isISO = scheduledAt.includes('T') && scheduledAt.includes('Z'); // Simple heuristics

                if (isValidDate && isISO) {
                  scheduledTime = directDate.toISOString();
                } else {
                  try {
                    scheduledTime = parseScheduleDate(scheduledAt);
                  } catch (e) {
                    console.warn('parseScheduleDate failed, using raw:', scheduledAt);
                  }
                }

                const scheduledAtUnix = Math.floor(new Date(scheduledTime).getTime() / 1000);

                console.log('[Email Scheduling] Time Debug:', {
                  original: scheduledAt,
                  parsed: scheduledTime,
                  unix: scheduledAtUnix,
                  isISO
                });

                // Schedule via QStash for each recipient
                await authFetch('/api/email?op=email-schedule-create', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    projectId: project.id,
                    to: emails,
                    subject,
                    html: html || ' ',
                    provider,
                    scheduledAt: scheduledAtUnix
                  })
                });

                addMessage('model', `✅ Scheduled **"${templateLabel}"** for **${new Date(scheduledTime).toLocaleString()}** to ${emails.length} leads!`);
              }

            } catch (e: any) {
              console.error('schedule_template_email error:', e);
              addMessage('model', `❌ Failed to send emails: ${e?.message || 'Unknown error'}`);
            }

          }
        }
      } else {
        // Fallback logic handled in the stream completion block above
      }

    } catch (e) {
      console.error("Chat error:", e);
      setError("Failed to get response. Please try again.");
    } finally {
      setIsProcessing(false);
      setStreamingMessageId(null);
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

    if ((mode === 'voice' || mode === 'video') && connectionStatus === 'connected') {
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

    // Clear from localStorage
    if (project?.id) {
      const key = `chat_history_${project.id}`;
      localStorage.removeItem(key);
    }
  }, [messages.length, project?.id]);

  useEffect(() => {
    return () => {
      disconnectVoice();
    };
  }, []);

  const projectContext = contextService.buildProjectContext(project);

  return (
    <div className="fixed inset-0 sm:inset-auto sm:bottom-4 sm:right-4 z-50 pointer-events-none flex sm:block items-end justify-center sm:justify-end">
      <div
        className={`pointer-events-auto flex flex-col overflow-hidden transition-all duration-300
          ${mode === 'video'
            ? 'fixed inset-0 w-full h-full rounded-none z-[100] bg-black'
            : `w-full h-full sm:w-[360px] sm:h-[560px] rounded-none sm:rounded-3xl shadow-2xl border backdrop-blur-2xl ${isDarkMode ? 'bg-[#050509]/80 border-white/10' : 'bg-white/80 border-black/10'}`
          }
        `}
      >
        <header className={`flex items-center justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b ${isDarkMode ? 'border-white/10 bg-black/5' : 'border-gray-200 bg-gray-50/50'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setStudioOpen(true)}
              className="flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-[#bf5af2] rounded-full transition-transform active:scale-95"
              title="Open Assistant Studio"
            >
              <AnimatedEyeIcon
                className={`w-9 h-9 sm:w-10 sm:h-10 animate-fly-in-icon ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light'
                  ? `${currentTheme.primary} text-white`
                  : 'bg-[#5e5ce6] text-white'
                  }`}
              />
            </button>
            <div className="min-w-0">
              <h2 className={`font-semibold text-sm sm:text-base truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                {project.agent?.name || 'AI Assistant'}
              </h2>
              <p className={`text-[10px] sm:text-xs truncate ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                {activeVersion ? (
                  <span className="flex items-center gap-1">
                    <span className="text-[#bf5af2]">✦ {activeVersion.name}</span>
                    <span>· {project.researchSessions.length} research</span>
                  </span>
                ) : (
                  <>{project.researchSessions.length} research loaded</>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Studio button */}
            <button
              onClick={() => setStudioOpen(true)}
              title="Assistant Studio"
              className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-[#2d2d2f] text-[#86868b] hover:text-[#bf5af2]' : 'hover:bg-gray-200 text-gray-500 hover:text-purple-600'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>
            </button>

            {/* Plugin: header-actions slot */}
            {activeVersion?.plugins?.['header-actions'] && (
              <AssistantPlugin
                slot="header-actions"
                code={activeVersion.plugins['header-actions']}
                project={project}
                isDarkMode={isDarkMode}
                apiKeys={activeVersion.apiKeys || {}}
                onReset={() => setActiveVersion(null)}
              />
            )}

            {(mode === 'voice' || mode === 'video') && connectionStatus === 'connected' ? (
              // Show End button when voice/video is connected
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
              // Show mode toggle when not in active voice session
              <div className={`flex items-center gap-0.5 p-1 rounded-full ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'}`}>
                <button
                  onClick={() => handleModeChange('chat')}
                  className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${mode === 'chat'
                    ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} text-white` : 'bg-[#5e5ce6] text-white'
                    : isDarkMode ? 'text-[#86868b] hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => handleModeChange('voice')}
                  className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${mode === 'voice'
                    ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} text-white` : 'bg-[#5e5ce6] text-white'
                    : isDarkMode ? 'text-[#86868b] hover:text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  Voice
                </button>
                <button
                  onClick={() => handleModeChange('video')}
                  className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${mode === 'video'
                    ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} text-white` : 'bg-[#5e5ce6] text-white'
                    : isDarkMode ? 'text-[#86868b] hover:text-white' : 'text-gray-600 hover:text-gray-900'
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
            <div
              className={`flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 space-y-4 relative ${isDarkMode ? 'bg-[#000000]' : 'bg-gray-50'}`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingAssetOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingAssetOver(false); }}
              onDrop={handleAssetDrop}
            >
              {/* Drop Zone Overlay */}
              {isDraggingAssetOver && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#5e5ce6]/20 backdrop-blur-sm border-2 border-dashed border-[#5e5ce6] rounded-lg pointer-events-none">
                  <div className={`text-center p-6 rounded-xl ${isDarkMode ? 'bg-[#1d1d1f]/90' : 'bg-white/90'}`}>
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center bg-gradient-to-r from-[#5e5ce6]/30 to-[#bf5af2]/30">
                      <svg className="w-8 h-8 text-[#5e5ce6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <p className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      Drop asset to analyze
                    </p>
                    <p className={`text-sm mt-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                      AI will analyze the file with project context
                    </p>
                  </div>
                </div>
              )}
              {messages.length === 0 && (
                <div className="text-center py-6 sm:py-8">
                  <div className={`w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'}`}>
                    <svg className={`w-7 h-7 sm:w-8 sm:h-8 ${isDarkMode ? 'text-[#424245]' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <h3 className={`text-base sm:text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    Ask about your project
                  </h3>
                  <p className={`text-xs sm:text-sm max-w-md mx-auto px-4 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                    I have access to {project.researchSessions.length} research sessions, {project.notes?.length || 0} notes, {project.tasks?.length || 0} tasks, and {project.uploadedFiles?.length || 0} files
                  </p>

                  <div className="mt-5 sm:mt-6 flex flex-wrap gap-2 justify-center px-2">
                    {['Summarize findings', 'Key insights', 'Create an image', 'Compare topics'].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => setInputText(suggestion)}
                        className={`px-3 py-2 rounded-full text-xs sm:text-sm transition-colors border ${suggestion === 'Create an image'
                          ? (
                            isDarkMode
                              ? 'bg-gradient-to-r from-[#5e5ce6]/20 to-[#bf5af2]/20 text-[#a5a5ff] border-[#5e5ce6]/30 hover:border-[#5e5ce6]/50'
                              : 'bg-white text-[#3730a3] border-[#5e5ce6]/40 shadow-sm hover:bg-[#eef2ff] hover:border-[#5e5ce6]/60'
                          )
                          : isDarkMode
                            ? 'bg-[#2d2d2f] text-[#e5e5ea] hover:bg-[#3d3d3f] border-[#3d3d3f]/50'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300 border-gray-300'
                          }`}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message) => {
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
                        existingSessionId={message.computerUseExistingSessionId || activeComputerUseSessionId || undefined} // Reuse existing session
                        onSessionCreated={(sessionId) => {
                          console.log('[ComputerUse] Session created:', sessionId);
                          setActiveComputerUseSessionId(sessionId);
                          setLastComputerUseSessionId(sessionId); // Track as last active
                        }}
                        onComplete={(result) => {
                          setMessages(prev =>
                            prev.map(m =>
                              m.id === message.id
                                ? { ...m, text: `✅ Browser automation completed:\n\n${result}`, computerUseGoal: undefined }
                                : m
                            )
                          );
                          setActiveComputerUseMessageId(null);
                          // Do not clear lastComputerUseSessionId here, so we can reuse it
                          setActiveComputerUseSessionId(null); // Clear session on complete
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
                          setActiveComputerUseSessionId(null); // Clear session on cancel
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
                          setActiveComputerUseSessionId(null); // Clear session on error
                        }}
                      />
                    </div>
                  );
                }

                // Helper to detect social platform mentions in message and extract platform
                const detectSocialConnectRequest = (text: string): SocialPlatform[] => {
                  const platforms: SocialPlatform[] = [];
                  const lowerText = text.toLowerCase();
                  // Detect patterns like "connect to post", "connect your account", "please connect"
                  if (lowerText.includes('connect') && (lowerText.includes('post') || lowerText.includes('account'))) {
                    if (lowerText.includes('facebook')) platforms.push('facebook');
                    if (lowerText.includes('instagram')) platforms.push('instagram');
                    if (lowerText.includes('x') || lowerText.includes('twitter')) platforms.push('x');
                    if (lowerText.includes('tiktok')) platforms.push('tiktok');
                    if (lowerText.includes('youtube')) platforms.push('youtube');
                    if (lowerText.includes('linkedin')) platforms.push('linkedin');
                  }
                  return platforms;
                };

                const detectedPlatforms = message.role === 'model' ? detectSocialConnectRequest(message.text) : [];

                return (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-4 py-3 ${message.role === 'user'
                      ? (activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3] text-white' : `${currentTheme.primary} text-white`)
                      : isDarkMode ? 'bg-[#2d2d2f] text-[#e5e5ea]' : 'bg-gray-200 text-gray-900'
                      }`}>
                      <div className="text-sm overflow-x-auto" style={{ wordWrap: 'break-word', overflowWrap: 'break-word' }}>
                        <ReactMarkdown
                          className={`${isDarkMode ? 'prose prose-invert' : 'prose'} max-w-none prose-pre:overflow-x-auto prose-code:break-all`}
                          components={{
                            a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />
                          }}
                        >
                          {message.text}
                        </ReactMarkdown>
                      </div>

                      {/* Inline Social Connect Buttons - shown when message mentions connecting to post */}
                      {detectedPlatforms.length > 0 && (
                        <div className={`mt-3 pt-3 border-t ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-300'}`}>
                          <div className="flex flex-wrap gap-2">
                            {detectedPlatforms.map((platform) => {
                              const platformInfo: Record<SocialPlatform, { name: string; logo: string }> = {
                                facebook: { name: 'Facebook', logo: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/2021_Facebook_icon.svg.webp' },
                                instagram: { name: 'Instagram', logo: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/Instagram_logo_2016.svg.webp' },
                                x: { name: 'X', logo: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/X-Logo-Round-Color.png' },
                                tiktok: { name: 'TikTok', logo: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/tiktok-6338432_1280.webp' },
                                youtube: { name: 'YouTube', logo: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/YouTube_full-color_icon_%282017%29.svg.png' },
                                linkedin: { name: 'LinkedIn', logo: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/LinkedIn_logo_initials.png' },
                              };
                              const info = platformInfo[platform];
                              const isConnected = isPlatformConnected(platform);

                              // If already connected, show a "Post Now" button that actually posts
                              if (isConnected) {
                                // Find the user's original request to extract the post text
                                // Look at the message right before this AI response
                                const messageIndex = messages.findIndex(m => m.id === message.id);
                                const previousUserMessage = messageIndex > 0 ? messages.slice(0, messageIndex).reverse().find(m => m.role === 'user') : null;

                                // Extract post text from user's message (e.g., "post 'hi' to facebook" -> "hi")
                                const extractPostText = (userText: string): string => {
                                  if (!userText) return '';
                                  // Match patterns like: post "hi", post 'wassup', post hi to, share "test"
                                  const patterns = [
                                    /(?:post|share|tweet|publish)\s*[\"']([^\"']+)[\"']/i,
                                    /(?:post|share|tweet|publish)\s+(.+?)\s+(?:to|on)\s+/i,
                                    /[\"']([^\"']+)[\"']\s+(?:to|on)\s+/i,
                                  ];
                                  for (const pattern of patterns) {
                                    const match = userText.match(pattern);
                                    if (match && match[1]) return match[1].trim();
                                  }
                                  // Fallback: just use everything after "post" if no quotes
                                  const simpleMatch = userText.match(/(?:post|share|tweet|publish)\s+(.+)/i);
                                  if (simpleMatch) {
                                    // Remove platform mentions
                                    return simpleMatch[1]
                                      .replace(/\s*(to|on)\s+(facebook|instagram|x|twitter|tiktok|youtube|linkedin)/gi, '')
                                      .trim();
                                  }
                                  return '';
                                };

                                const extractedText = previousUserMessage ? extractPostText(previousUserMessage.text) : '';

                                // Special handling for Facebook - need to select a page
                                if (platform === 'facebook') {
                                  const hasPages = fbPages && fbPages.length > 0;
                                  const hasSelectedPage = fbPageId && fbPageId.length > 0;

                                  // If no pages loaded, show connect state
                                  if (!hasPages) {
                                    return (
                                      <div key={platform} className="flex flex-col gap-2">
                                        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isDarkMode
                                          ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                          : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                                          }`}>
                                          <img src={info.logo} alt={info.name} className="w-5 h-5 rounded object-contain" />
                                          <span>⚠️ No Facebook Pages found. Please connect a Facebook Page in the Social tab.</span>
                                        </div>
                                      </div>
                                    );
                                  }

                                  // If pages exist but none selected, show page selector
                                  if (!hasSelectedPage) {
                                    return (
                                      <div key={platform} className="flex flex-col gap-2">
                                        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isDarkMode
                                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                          : 'bg-green-50 text-green-700 border border-green-200'
                                          }`}>
                                          <img src={info.logo} alt={info.name} className="w-5 h-5 rounded object-contain" />
                                          <span>✓ Facebook Connected - Select a Page:</span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                          {fbPages.map((page: any) => (
                                            <button
                                              key={page.id}
                                              onClick={async () => {
                                                // Check if this is a reference to media
                                                const referenceWords = ['this', 'that', 'it', 'the image', 'the video', 'the file'];
                                                const lowerExtracted = extractedText.toLowerCase().trim();
                                                const isMediaReference = referenceWords.some(w => lowerExtracted === w || lowerExtracted.includes(w));

                                                // Determine content type and media URL
                                                let contentType: 'text' | 'image' | 'video' = 'text';
                                                let mediaUrl: string | undefined;
                                                let postText = extractedText;

                                                // Check attachments first
                                                if (isMediaReference && readyAttachments.length > 0) {
                                                  const imageOrVideoAtt = readyAttachments.find(a =>
                                                    a.uploaded?.mimeType?.startsWith('image/') || a.uploaded?.mimeType?.startsWith('video/')
                                                  );
                                                  if (imageOrVideoAtt?.uploaded?.uri) {
                                                    contentType = imageOrVideoAtt.uploaded.mimeType?.startsWith('video/') ? 'video' : 'image';
                                                    mediaUrl = imageOrVideoAtt.uploaded.uri;
                                                    postText = '';
                                                  }
                                                }

                                                // Check lastGeneratedAsset if no attachment found
                                                if (isMediaReference && !mediaUrl && lastGeneratedAsset) {
                                                  contentType = lastGeneratedAsset.type;
                                                  mediaUrl = lastGeneratedAsset.url;
                                                  postText = '';
                                                }

                                                if (extractedText || mediaUrl) {
                                                  const displayText = mediaUrl ? `${contentType}` : `"${extractedText}"`;
                                                  addMessage('model', `Posting ${displayText} to Facebook Page "${page.name}"...`);
                                                  try {
                                                    // Post directly using the page's access token
                                                    const result = await postToSocialPlatform(platform, contentType, postText, mediaUrl);
                                                    if (result.success) {
                                                      addMessage('model', `✅ Successfully posted to ${page.name}!`);
                                                    } else if (result.error) {
                                                      addMessage('model', `❌ Failed to post: ${result.error}`);
                                                    }
                                                  } catch (err: any) {
                                                    addMessage('model', `❌ Error posting: ${err.message || 'Unknown error'}`);
                                                  }
                                                } else {
                                                  addMessage('model', `Selected page: ${page.name}. Please tell me what you'd like to post.`);
                                                }
                                              }}
                                              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105 ${isDarkMode
                                                ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.primaryHover} text-white` : 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
                                                : activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.primaryHover} text-white shadow-md` : 'bg-[#0071e3] hover:bg-[#0077ed] text-white shadow-md'
                                                }`}
                                            >
                                              {page.picture?.data?.url && (
                                                <img src={page.picture.data.url} alt={page.name} className="w-5 h-5 rounded-full" />
                                              )}
                                              {extractedText ? `🚀 Post to ${page.name}` : `📝 Select ${page.name}`}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  }
                                }

                                return (
                                  <div key={platform} className="flex flex-col gap-2">
                                    <div
                                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isDarkMode
                                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                        : 'bg-green-50 text-green-700 border border-green-200'
                                        }`}
                                    >
                                      <img
                                        src={info.logo}
                                        alt={info.name}
                                        className="w-5 h-5 rounded object-contain"
                                      />
                                      <span>✓ {info.name} Connected</span>
                                    </div>
                                    {extractedText && (
                                      <button
                                        onClick={async () => {
                                          // Check if this is a reference to media
                                          const referenceWords = ['this', 'that', 'it', 'the image', 'the video', 'the file'];
                                          const lowerExtracted = extractedText.toLowerCase().trim();
                                          const isMediaReference = referenceWords.some(w => lowerExtracted === w || lowerExtracted.includes(w));

                                          // Determine content type and media URL
                                          let contentType: 'text' | 'image' | 'video' = 'text';
                                          let mediaUrl: string | undefined;
                                          let postText = extractedText;

                                          // Check attachments first
                                          if (isMediaReference && readyAttachments.length > 0) {
                                            const imageOrVideoAtt = readyAttachments.find(a =>
                                              a.uploaded?.mimeType?.startsWith('image/') || a.uploaded?.mimeType?.startsWith('video/')
                                            );
                                            if (imageOrVideoAtt?.uploaded?.uri) {
                                              contentType = imageOrVideoAtt.uploaded.mimeType?.startsWith('video/') ? 'video' : 'image';
                                              // Prefer publicUrl for social posting (Vercel Blob), fallback to Gemini URI
                                              mediaUrl = (imageOrVideoAtt.uploaded as any).publicUrl || imageOrVideoAtt.uploaded.uri;
                                              postText = ''; // Clear reference text
                                              console.log('[PostButton] Using attachment with URL:', mediaUrl);
                                            }
                                          }

                                          // Check lastGeneratedAsset if no attachment found
                                          if (isMediaReference && !mediaUrl && lastGeneratedAsset) {
                                            contentType = lastGeneratedAsset.type;
                                            // Prefer publicUrl for social posting
                                            mediaUrl = lastGeneratedAsset.publicUrl || lastGeneratedAsset.url;
                                            postText = '';
                                            console.log('[PostButton] Using lastGeneratedAsset with URL:', mediaUrl);
                                          }

                                          console.log('[PostButton] Final values:', { contentType, mediaUrl, postText, isMediaReference, readyAttachmentsCount: readyAttachments.length, hasLastGeneratedAsset: !!lastGeneratedAsset });

                                          const displayText = mediaUrl ? `${contentType}` : `"${extractedText}"`;
                                          addMessage('model', `Posting ${displayText} to ${info.name}...`);
                                          try {
                                            const result = await postToSocialPlatform(platform, contentType, postText, mediaUrl);
                                            if (result.success) {
                                              let successMsg = `✅ Successfully posted to ${info.name}!`;
                                              if (result.postId) {
                                                successMsg += ` (Post ID: ${result.postId})`;
                                              }
                                              if (platform === 'tiktok' || platform === 'youtube') {
                                                successMsg += `\n📝 Note: Posted as private. Change visibility in ${platform === 'tiktok' ? 'TikTok' : 'YouTube'}.`;
                                              }
                                              addMessage('model', successMsg);
                                            } else if (result.error) {
                                              addMessage('model', `❌ Failed to post: ${result.error}`);
                                            }
                                          } catch (err: any) {
                                            addMessage('model', `❌ Error posting: ${err.message || 'Unknown error'}`);
                                          }
                                        }}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105 ${isDarkMode
                                          ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.primaryHover} text-white` : 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
                                          : activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.primaryHover} text-white shadow-md` : 'bg-[#0071e3] hover:bg-[#0077ed] text-white shadow-md'
                                          }`}
                                      >
                                        {/* Dynamic label based on available media */}
                                        {(() => {
                                          const refWords = ['this', 'that', 'it', 'the image', 'the video', 'the file'];
                                          const isRef = refWords.some(w => extractedText.toLowerCase().trim() === w || extractedText.toLowerCase().trim().includes(w));
                                          if (isRef && lastGeneratedAsset) {
                                            return `🚀 Post ${lastGeneratedAsset.type} to ${info.name}`;
                                          }
                                          if (isRef && readyAttachments.length > 0) {
                                            const att = readyAttachments.find(a => a.uploaded?.mimeType?.startsWith('image/') || a.uploaded?.mimeType?.startsWith('video/'));
                                            if (att) {
                                              return `🚀 Post ${att.uploaded?.mimeType?.startsWith('video/') ? 'video' : 'image'} to ${info.name}`;
                                            }
                                          }
                                          return `🚀 Post "${extractedText}" to ${info.name}`;
                                        })()}
                                      </button>
                                    )}
                                  </div>
                                );
                              }

                              return (
                                <button
                                  key={platform}
                                  onClick={async () => {
                                    console.log('[InlineConnect] Connect clicked for', platform, '- using handleConnectWithRefresh');
                                    addMessage('model', `Opening ${platform} login... Complete the authentication in the popup.`);

                                    // Use handleConnectWithRefresh which polls for auth completion and updates state immediately
                                    const success = await handleConnectWithRefresh(platform);

                                    if (success) {
                                      addMessage('model', `✓ Successfully connected to ${platform}! You can now post to this platform.`);
                                    } else {
                                      addMessage('model', `⚠️ Authentication timed out for ${platform}. Please try again or connect from the Social tab.`);
                                    }
                                  }}
                                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105 ${isDarkMode
                                    ? 'bg-white/10 hover:bg-white/20 text-white'
                                    : 'bg-white hover:bg-gray-50 text-gray-900 shadow-sm'
                                    }`}
                                  style={{
                                    border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'}`,
                                  }}
                                >
                                  <img
                                    src={info.logo}
                                    alt={info.name}
                                    className="w-5 h-5 rounded object-contain"
                                  />
                                  Connect {info.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {message.imageUrl && (
                        <div className="mt-3">
                          <img
                            src={message.imageUrl}
                            alt="Generated image"
                            onClick={() => setPreviewImage(message.imageUrl)}
                            className="max-w-full rounded-xl border border-[#3d3d3f]/50 cursor-pointer hover:opacity-90 transition-opacity"
                          />
                          <a
                            href={message.imageUrl}
                            download="generated-image.png"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-1.5 mt-2 text-xs ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.accent : 'text-[#0071e3] hover:text-[#0077ed]'}`}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download
                          </a>
                        </div>
                      )}
                      {message.videoUrl && (
                        <div className="mt-3">
                          <video
                            src={message.videoUrl}
                            controls
                            playsInline
                            className="max-w-full rounded-xl border border-[#3d3d3f]/50"
                          />
                          <a
                            href={message.videoUrl}
                            download="generated-video.mp4"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-1.5 mt-2 text-xs ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.accent : 'text-[#0071e3] hover:text-[#0077ed]'}`}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download Video
                          </a>
                        </div>
                      )}
                      {message.audioUrl && message.role === 'model' && (
                        <div className="mt-3">
                          <audio
                            src={message.audioUrl}
                            controls
                            preload="auto"
                            className="w-full"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Thought Process Display */}
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

              {isProcessing && !isGeneratingImage && !messages.some(m => m.role === 'model' && m.isGenerating && (m.text || '').trim()) && (
                <div className="flex justify-start">
                  <div className={`rounded-2xl px-4 py-3 ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'}`}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 bg-[#5e5ce6] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-[#5e5ce6] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-[#5e5ce6] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Note: Social connect buttons are now rendered inline within messages that mention connecting */}


              {isGeneratingImage && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-4 py-3 bg-gradient-to-r from-[#5e5ce6]/20 to-[#bf5af2]/20 border border-[#5e5ce6]/30">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 border-2 border-[#5e5ce6] border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-[#a5a5ff]">Creating image...</span>
                    </div>
                  </div>
                </div>
              )}

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
            {mode === 'voice' && connectionStatus === 'connected' ? (
              // Connected: Show full transcript like chat mode
              <div className={`flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 ${isDarkMode ? 'bg-[#000000]' : 'bg-gray-50'}`}>
                {messages.length === 0 && (
                  <div className="text-center py-6 sm:py-8">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center bg-[#5e5ce6]/20">
                      <svg className="w-7 h-7 sm:w-8 sm:h-8 text-[#5e5ce6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    </div>
                    <h3 className={`text-base sm:text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {isSpeaking ? 'Speaking...' : 'Listening...'}
                    </h3>
                    <p className={`text-xs sm:text-sm max-w-md mx-auto px-4 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                      Start speaking to have a conversation
                    </p>
                  </div>
                )}

                {messages.map((message) => {
                  if (message.role === 'model' && message.isGenerating && !(message.text || '').trim() && !message.videoUrl && !message.imageUrl) {
                    return null;
                  }

                  return (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-4 py-3 ${message.role === 'user'
                        ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light'
                          ? `${currentTheme.primary} text-white`
                          : 'bg-[#0071e3] text-white'
                        : isDarkMode ? 'bg-[#2d2d2f] text-[#e5e5ea]' : 'bg-gray-200 text-gray-900'
                        }`}>
                        <div className="text-sm">
                          <ReactMarkdown
                            className={isDarkMode ? 'prose prose-invert max-w-none' : 'prose max-w-none'}
                            components={{
                              a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />
                            }}
                          >
                            {message.text}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {isSpeaking && (
                  <div className="flex justify-start">
                    <div className={`rounded-2xl px-4 py-3 ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'}`}>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 bg-[#5e5ce6] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-[#5e5ce6] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-[#5e5ce6] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Social Auth Prompt - shown when posting requires authentication (voice mode) */}
                {pendingAuthPlatforms.length > 0 && (
                  <div className="px-2 mb-2">
                    <SocialAuthPrompt
                      platforms={pendingAuthPlatforms}
                      isDarkMode={isDarkMode}
                      onConnect={(platform) => {
                        const handler = getConnectHandler(platform);
                        console.log('[SocialAuthPrompt voice] Connect clicked for', platform, 'handler:', handler ? 'found' : 'undefined');
                        if (handler) {
                          handler();
                          // OAuth popup was opened - clear this platform from pending
                          setPendingAuthPlatforms(prev => prev.filter(p => p !== platform));
                        } else {
                          console.warn('[SocialAuthPrompt voice] No handler found for platform:', platform);
                          alert(`Connect handler not available for ${platform}. Please try connecting from the Social tab.`);
                        }
                      }}
                      onDismiss={() => setPendingAuthPlatforms([])}
                    />
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            ) : mode === 'voice' ? (
              // Not connected: Show centered voice UI with start button
              <div className={`flex-1 overflow-y-auto flex items-center justify-center ${isDarkMode ? 'bg-[#000000]' : 'bg-gray-50'}`}>
                <div className="p-6 sm:p-8">
                  <div className="w-full flex flex-col items-center text-center space-y-5 sm:space-y-6">
                    <div className="relative flex items-center justify-center mx-auto">
                      <div className={`w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center transition-all duration-300 ${connectionStatus === 'connecting'
                        ? 'bg-[#ff9f0a]/50 animate-pulse'
                        : isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'
                        }`}>
                        <span className="text-4xl sm:text-5xl">
                          {connectionStatus === 'connecting' ? '🔄' : '🎙️'}
                        </span>
                      </div>
                    </div>

                    <div>
                      <h3 className={`text-lg sm:text-xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {connectionStatus === 'connecting' ? 'Connecting...' : 'Voice Mode'}
                      </h3>
                      <p className={`text-xs sm:text-sm max-w-sm mx-auto px-4 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                        Start a real-time voice conversation
                      </p>
                    </div>

                    {error && (
                      <p className="text-xs sm:text-sm text-[#ff453a] bg-[#ff453a]/10 px-4 py-2 rounded-xl">{error}</p>
                    )}

                    <button
                      onClick={() => connectVoice('voice')}
                      disabled={connectionStatus === 'connecting'}
                      className={`flex items-center gap-2 font-medium py-3 px-5 sm:px-6 rounded-full transition-all active:scale-95 disabled:opacity-50 text-sm sm:text-base text-white ${connectionStatus === 'connecting'
                        ? 'bg-[#5e5ce6] hover:bg-[#6e6ef6]'
                        : activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light'
                          ? `${currentTheme.primary} ${currentTheme.primaryHover}`
                          : 'bg-[#5e5ce6] hover:bg-[#6e6ef6]'
                        }`}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                      {connectionStatus === 'connecting' ? 'Connecting...' : 'Start'}
                    </button>

                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Video Mode Overlay */}
                <div className="flex-1 relative bg-black flex flex-col overflow-hidden">
                  <video
                    ref={videoRef}
                    className="absolute inset-0 w-full h-full object-cover"
                    autoPlay
                    playsInline
                    muted
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  <canvas ref={canvasRef} className="hidden" />

                  {/* Top Bar Status + Mirror Toggle */}
                  <div className="absolute top-0 left-0 right-0 p-4 flex items-center gap-2 z-10 bg-gradient-to-b from-black/50 to-transparent">
                    <div className="flex items-center gap-2 bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
                      <span className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                      <span className="text-white text-xs font-medium">
                        {connectionStatus === 'connected' ? 'Live' : connectionStatus === 'connecting' ? 'Connecting...' : 'Ready'}
                      </span>
                    </div>
                  </div>

                  {/* Center Content: Start Button / Loading */}
                  <div className="relative z-10 flex-1 flex items-center justify-center">
                    {connectionStatus === 'disconnected' && (
                      <button
                        onClick={() => connectVoice('video')}
                        className="px-8 py-4 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 rounded-full text-white font-semibold text-lg transition-all transform hover:scale-105 shadow-2xl flex items-center gap-3 active:scale-95 group"
                      >
                        <span className="text-2xl group-hover:scale-110 transition-transform">📹</span>
                        <span>Start Session</span>
                      </button>
                    )}
                    {connectionStatus === 'connecting' && (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                        <div className="text-white font-medium animate-pulse">Connecting Camera...</div>
                      </div>
                    )}
                  </div>

                  {/* Bottom: Transcript / Chat */}
                  <div className="absolute bottom-0 left-0 right-0 p-6 pt-24 bg-gradient-to-t from-black/90 via-black/40 to-transparent z-10 flex flex-col gap-3 items-start justify-end max-h-[50%] overflow-y-auto mask-image-linear-to-t pointer-events-none">
                    {/* Render last 3 messages */}
                    {messages.slice(-3).map((msg, i) => (
                      <div key={msg.id || i} className={`max-w-[85%] p-3 rounded-2xl backdrop-blur-md text-sm shadow-lg pointer-events-auto flex flex-col gap-2 ${msg.role === 'user'
                        ? 'bg-black/40 text-white self-end border border-white/10'
                        : 'bg-white/90 text-black self-start'
                        }`}>
                        {msg.text && <span>{msg.text}</span>}
                        {msg.imageUrl && (
                          <div className="relative group cursor-pointer" onClick={() => setPreviewImage(msg.imageUrl)}>
                            <img
                              src={msg.imageUrl}
                              alt="Generated content"
                              className="rounded-lg max-h-40 border border-white/20 object-cover"
                            />
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                              </svg>
                            </div>
                          </div>
                        )}
                        {msg.videoUrl && (
                          <video
                            src={msg.videoUrl}
                            className="rounded-lg max-h-40 border border-white/20"
                            controls
                            playsInline
                          />
                        )}
                      </div>
                    ))}

                    {/* Live buffers */}
                    {userTranscriptBuffer && (
                      <div className="max-w-[85%] p-3 rounded-2xl backdrop-blur-md text-sm shadow-lg bg-black/40 text-white/70 self-end border border-white/10 italic pointer-events-auto">
                        {userTranscriptBuffer}
                      </div>
                    )}
                    {transcriptBuffer && (
                      <div className="max-w-[85%] p-3 rounded-2xl backdrop-blur-md text-sm shadow-lg bg-white/90 text-black self-start border border-white/10 italic pointer-events-auto">
                        {transcriptBuffer}
                      </div>
                    )}
                  </div>
                </div>

              </>
            )}
          </>
        )}

        {/* Shared text input footer (chat + voice) */}
        <div className={`p-3 sm:p-4 border-t safe-area-pb ${isDarkMode ? 'border-[#3d3d3f]/50 bg-[#1d1d1f]' : 'border-gray-200 bg-white'}`}>
          {pendingAttachments.length > 0 && (
            <div className="mb-2 overflow-x-auto pb-1 custom-scrollbar">
              <div className="flex flex-nowrap gap-2 min-w-min">
                {pendingAttachments.map(att => (
                  <div
                    key={att.id}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] border whitespace-nowrap ${isDarkMode ? 'border-[#3d3d3f]/60 bg-black/20 text-white' : 'border-gray-200 bg-gray-50 text-gray-900'}`}
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
                    <span className={`${att.status === 'ready' ? 'text-green-500' : att.status === 'error' ? 'text-red-500' : (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}`}>
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
            </div>
          )}

          {/* Stripe Connect Prompt */}
          {showStripeConnectPrompt && (
            <div className={`flex items-center gap-3 p-3 rounded-xl mb-2 ${isDarkMode ? 'bg-[#635BFF]/10 border border-[#635BFF]/30' : 'bg-[#635BFF]/5 border border-[#635BFF]/20'}`}>
              <svg className="w-6 h-6 text-[#635BFF] flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
              </svg>
              <div className="flex-1">
                <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Connect Stripe to sell products</p>
                <p className={`text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Set up payments to start selling</p>
              </div>
              <button
                onClick={async () => {
                  try {
                    const userProfile = (window as any).__userProfile as UserProfile | undefined;
                    // Create a new Stripe Connect account
                    const res = await authFetch('/api/billing?op=create-account', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        email: userProfile?.email || '',
                        country: 'US', // Default, user can change in Stripe onboarding
                      }),
                    });
                    const data = await res.json();

                    if (data.accountId) {
                      // Save to user profile
                      await storageService.updateUserProfile({
                        stripeConnect: {
                          accountId: data.accountId,
                          chargesEnabled: data.chargesEnabled || false,
                          payoutsEnabled: data.payoutsEnabled || false,
                          detailsSubmitted: data.detailsSubmitted || false,
                          createdAt: Date.now(),
                        },
                      });

                      // Create onboarding link and redirect
                      const linkRes = await authFetch('/api/billing?op=create-account-link', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          accountId: data.accountId,
                          returnUrl: window.location.href,
                          refreshUrl: window.location.href,
                        }),
                      });
                      const linkData = await linkRes.json();

                      if (linkData.url) {
                        window.location.href = linkData.url;
                      }
                    }
                  } catch (e) {
                    console.error('Failed to create Stripe account:', e);
                    addMessage('model', '❌ Failed to set up Stripe. Please try again or connect via Assets → Products tab.');
                  }
                  setShowStripeConnectPrompt(false);
                }}
                className="px-4 py-2 bg-[#635BFF] text-white text-sm font-medium rounded-lg hover:bg-[#5851db] transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
                </svg>
                Connect Stripe
              </button>
              <button
                onClick={() => setShowStripeConnectPrompt(false)}
                className={`p-1 rounded-full ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                aria-label="Dismiss"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
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
              disabled={isProcessing || isGeneratingImage || isUploadingAttachments}
              className={`p-3 rounded-xl sm:rounded-2xl transition-all active:scale-95 flex-shrink-0 border ${isDarkMode ? 'bg-[#2d2d2f] text-white border-[#3d3d3f]/50 hover:bg-[#3d3d3f]' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'} disabled:opacity-50 disabled:cursor-not-allowed`}
              title="Attach files"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.44 11.05l-8.49 8.49a5 5 0 01-7.07-7.07l8.49-8.49a3.5 3.5 0 114.95 4.95l-8.84 8.84a2 2 0 11-2.83-2.83l8.49-8.49" />
              </svg>
            </button>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={mode === 'voice' ? 'Type a message to the live assistant…' : 'Ask about your research...'}
              rows={1}
              className={`flex-1 resize-none rounded-xl sm:rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 ${activeTheme === 'dark' || activeTheme === 'light'
                ? 'focus:ring-[#0071e3]'
                : currentTheme?.ring
                } border ${isDarkMode ? 'bg-[#2d2d2f] text-white placeholder-[#636366] border-[#3d3d3f]/50' : 'bg-gray-100 text-gray-900 placeholder-gray-500 border-gray-300'}`}
            />
            {/* Send Button */}
            <button
              onClick={handleSendMessage}
              disabled={(!inputText.trim() && readyAttachments.length === 0) || isProcessing || isGeneratingImage || isUploadingAttachments}
              className={`p-3 text-white rounded-xl sm:rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 flex-shrink-0 ${activeTheme === 'dark' || activeTheme === 'light'
                ? 'bg-[#0071e3] hover:bg-[#0077ed]'
                : `${currentTheme?.primary} ${currentTheme?.primaryHover}`
                }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div >

      <style>{`
        @keyframes slide-up {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
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

      {
        usageLimitModal && (
          <UsageLimitModal
            isOpen={usageLimitModal.isOpen}
            onClose={() => setUsageLimitModal(null)}
            onUpgrade={() => {
              setUsageLimitModal(null);
              onUpgrade?.();
            }}
            isDarkMode={isDarkMode}
            usageType={usageLimitModal.usageType}
            current={usageLimitModal.current}
            limit={usageLimitModal.limit}
            isSubscribed={isSubscribed}
          />
        )
      }

      {/* Insufficient Credits Modal */}
      {
        insufficientCreditsModal && (
          <InsufficientCreditsModal
            isOpen={insufficientCreditsModal.isOpen}
            onClose={() => setInsufficientCreditsModal(null)}
            onUpgrade={() => {
              setInsufficientCreditsModal(null);
              onUpgrade?.();
            }}
            isDarkMode={isDarkMode}
            operation={insufficientCreditsModal.operation}
            creditsNeeded={insufficientCreditsModal.cost}
            currentCredits={insufficientCreditsModal.current}
          />
        )
      }

      {/* Image Preview Modal */}
      {
        previewImage && typeof document !== 'undefined' && createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-8"
            onClick={() => setPreviewImage(null)}
          >
            <div className="relative max-w-5xl w-full h-full flex items-center justify-center">
              <button
                type="button"
                className="absolute top-4 right-4 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors z-10"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPreviewImage(null);
                }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <img
                src={previewImage}
                alt="Preview"
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking the image itself
              />
            </div>
          </div>,
          document.body
        )
      }

      {/* Studio Overlay */}
      {studioOpen && typeof document !== 'undefined' && createPortal(
        <AssistantStudio
          project={project}
          isDarkMode={isDarkMode}
          onClose={() => {
            setStudioOpen(false);
            const userId = auth.currentUser?.uid;
            if (userId && project?.id) {
              assistantVersionService.getActiveVersion(userId, project.id).then(v => {
                setActiveVersion(v);
              });
            }
          }}
        />,
        document.body
      )}
    </div >
  );
};
