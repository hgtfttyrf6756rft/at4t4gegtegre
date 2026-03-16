import React, { useState, useMemo, useRef, useEffect } from 'react';
import { authFetch } from '../services/authFetch';
import { contextService } from '../services/contextService';
import { logProjectActivity } from '../services/firebase';

const IMAGE_FILE_REGEX = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i;
const isImageAsset = (asset: any) => {
    const type = (asset.type || '').toLowerCase();
    if (type.startsWith('image/')) return true;
    const name = (asset.name || '').toLowerCase();
    return IMAGE_FILE_REGEX.test(name);
};
const isVideoAsset = (asset: any) => {
    const type = (asset.type || '').toLowerCase();
    return type.startsWith('video/');
};
import { mediaService } from '../services/mediaService';
import { ResearchProject, UserProfile } from '../types';
import { generateSocialPostContent, generateSocialPostImage, generateImagePromptFromText, generateVeoVideo, refinePromptWithGemini3, generateImageWithReferences, ImageReference } from '../services/geminiService';
import { createVideoFromText, createVideoFromImage, pollVideoUntilComplete, downloadVideoBlob, VideoJob } from '../services/soraService';
import { deductCredits } from '../services/creditService';

const fetchImageRefAsBase64 = async (url: string): Promise<{ base64: string; mimeType: string }> => {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
        const blob = await res.blob();
        const mimeType = blob.type || 'image/png';
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                if (typeof reader.result === 'string') {
                    const base64 = reader.result.split(',')[1];
                    resolve({ base64, mimeType });
                } else {
                    reject(new Error('Failed to read blob as base64'));
                }
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('fetchImageRefAsBase64 error:', error);
        throw error;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type PostType = 'TEXT' | 'IMAGE' | 'VIDEO';
type MediaSource = 'UPLOAD' | 'ASSET' | 'GENERATE';
type VideoModel = 'sora' | 'veo';
type VideoRefSource = 'none' | 'generate' | 'upload' | 'asset' | 'profile';
type Platform = 'youtube' | 'x' | 'linkedin' | 'facebook' | 'instagram' | 'tiktok';

interface PlatformConfig {
    id: Platform;
    name: string;
    icon: string;
    logoUrl?: string;
    color: string;
    supportsText: boolean;
    supportsImage: boolean;
    supportsVideo: boolean;
}

interface PublishResult {
    platform: Platform;
    success: boolean;
    error?: string;
    postId?: string;
}

interface UnifiedSocialPublisherProps {
    project: ResearchProject;
    isDarkMode: boolean;
    activeTheme?: 'light' | 'dark' | 'orange' | 'green' | 'blue' | 'purple' | 'khaki' | 'pink';
    currentTheme?: {
        primary: string;
        primaryHover: string;
        accent: string;
        ring: string;
        text: string;
        border: string;
        bgSecondary: string;
    };
    // Connection status
    facebookConnected: boolean;
    facebookProfile: any;
    facebookAccessToken: string | null;
    igAccounts: any[];
    selectedIgId: string;
    setSelectedIgId: (id: string) => void;
    handleFacebookConnect: () => void;
    handleFacebookLogout: () => void;
    loadInstagramAccounts: () => void;
    tiktokConnected: boolean;
    tiktokCreatorInfo: any;
    handleTiktokConnect: () => void;
    handleTiktokDisconnect: () => void;
    youtubeConnected: boolean;
    youtubeChannel: any;
    handleYoutubeConnect: () => void;
    handleYoutubeDisconnect: () => void;
    linkedinConnected: boolean;
    linkedinProfile: any;
    handleLinkedinConnect: () => void;
    handleLinkedinDisconnect: () => void;
    xConnected: boolean;
    xProfile: any;
    handleXConnect: () => void;
    handleXDisconnect: () => void;
    // Facebook Pages
    fbPages: any[];
    loadFacebookPages: () => void;
    fbPagesLoading: boolean;

    headerRight?: React.ReactNode;
    initialState?: {
        postType?: PostType;
        textContent?: string;
        mediaSource?: MediaSource;
        selectedAssetId?: string;
        platform?: Platform;
        uploadedFile?: File;
        assetUrl?: string;
        assetType?: string;
    };
    userProfile?: UserProfile | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform Configurations
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORMS: PlatformConfig[] = [
    { id: 'x', name: 'X', icon: '𝕏', logoUrl: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/X-Logo-Round-Color.png', color: '#000000', supportsText: true, supportsImage: true, supportsVideo: true },
    { id: 'linkedin', name: 'LinkedIn', icon: '💼', logoUrl: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/LinkedIn_logo_initials.png', color: '#0A66C2', supportsText: true, supportsImage: true, supportsVideo: true },
    { id: 'facebook', name: 'Facebook', icon: '📘', logoUrl: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/2021_Facebook_icon.svg.webp', color: '#1877F2', supportsText: true, supportsImage: true, supportsVideo: true },
    { id: 'instagram', name: 'Instagram', icon: '📷', logoUrl: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Instagram_logo_2016.svg.webp', color: '#E4405F', supportsText: false, supportsImage: true, supportsVideo: true },
    { id: 'tiktok', name: 'TikTok', icon: '🎵', logoUrl: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/tiktok-6338432_1280.webp', color: '#000000', supportsText: false, supportsImage: true, supportsVideo: true },
    { id: 'youtube', name: 'YouTube', icon: '▶️', logoUrl: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/YouTube_full-color_icon_%282017%29.svg.png', color: '#FF0000', supportsText: false, supportsImage: false, supportsVideo: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export const UnifiedSocialPublisher: React.FC<UnifiedSocialPublisherProps> = ({
    project,
    isDarkMode,
    facebookConnected,
    facebookProfile,
    facebookAccessToken,
    igAccounts,
    selectedIgId,
    setSelectedIgId,
    handleFacebookConnect,
    handleFacebookLogout,
    loadInstagramAccounts,
    tiktokConnected,
    tiktokCreatorInfo,
    handleTiktokConnect,
    handleTiktokDisconnect,
    youtubeConnected,
    youtubeChannel,
    handleYoutubeConnect,
    handleYoutubeDisconnect,
    linkedinConnected,
    linkedinProfile,
    handleLinkedinConnect,
    handleLinkedinDisconnect,
    xConnected,
    xProfile,
    handleXConnect,
    handleXDisconnect,
    fbPages,
    loadFacebookPages,
    fbPagesLoading,
    headerRight,
    initialState,
    userProfile,
    activeTheme,
    currentTheme,
}) => {
    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    // Step management
    const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

    // Step 1: Content
    const [postType, setPostType] = useState<PostType>('TEXT');
    const [textContent, setTextContent] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [mediaSource, setMediaSource] = useState<MediaSource>('UPLOAD');
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [selectedAssetId, setSelectedAssetId] = useState('');
    const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([]);
    const [tempAsset, setTempAsset] = useState<any | null>(null);

    // Effect to handle initial state, e.g. from "Share" button in Assets tab
    useEffect(() => {
        if (initialState) {
            if (initialState.postType) setPostType(initialState.postType);
            if (initialState.textContent) setTextContent(initialState.textContent);
            if (initialState.mediaSource) setMediaSource(initialState.mediaSource);

            // Handle temporary assets passed via URL (e.g. generated but unsaved images)
            if (initialState.selectedAssetId && initialState.assetUrl) {
                setTempAsset({
                    id: initialState.selectedAssetId,
                    url: initialState.assetUrl,
                    type: initialState.assetType || 'image/png',
                    name: 'Generated Asset',
                });
            }

            if (initialState.selectedAssetId) setSelectedAssetId(initialState.selectedAssetId);
            if (initialState.platform) setSelectedPlatforms([initialState.platform]);
            // If we have a file pre-loaded (though tricky to pass non-serializable File objects across some boundaries, 
            // but internally in React it's fine)
            if (initialState.uploadedFile) setUploadedFile(initialState.uploadedFile);
        }
    }, [initialState]);
    const [imagePrompt, setImagePrompt] = useState('');
    const [useProfilePicture, setUseProfilePicture] = useState(false);
    const [imageAspectRatio, setImageAspectRatio] = useState('1:1');
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);

    // Image reference state
    const [imageRefSource, setImageRefSource] = useState<'none' | 'upload' | 'asset' | 'profile'>('none');
    const [imageRefFile, setImageRefFile] = useState<File | null>(null);
    const [imageRefUrl, setImageRefUrl] = useState<string>('');

    // Video generation state
    const [videoModel, setVideoModel] = useState<VideoModel>('veo');
    const [videoPrompt, setVideoPrompt] = useState('');
    const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16'>('16:9');
    const [videoDuration, setVideoDuration] = useState<4 | 6 | 8 | 12>(8);
    const [videoQuality, setVideoQuality] = useState<'speed' | 'quality'>('speed');
    const [videoRefSource, setVideoRefSource] = useState<VideoRefSource>('none');
    const [videoRefImageUrl, setVideoRefImageUrl] = useState('');
    const [videoRefImageFile, setVideoRefImageFile] = useState<File | null>(null);
    const [videoRefPrompt, setVideoRefPrompt] = useState('');
    const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
    const [videoGenProgress, setVideoGenProgress] = useState(0);
    const [videoGenStatus, setVideoGenStatus] = useState('');
    const [isGeneratingVideoRefImage, setIsGeneratingVideoRefImage] = useState(false);
    const [isGeneratingVideoRefPrompt, setIsGeneratingVideoRefPrompt] = useState(false);

    // Last Frame State (Veo only)
    const [videoLastFrameSource, setVideoLastFrameSource] = useState<VideoRefSource>('none');
    const [videoLastFrameUrl, setVideoLastFrameUrl] = useState('');
    const [videoLastFrameFile, setVideoLastFrameFile] = useState<File | null>(null);
    const [videoLastFramePrompt, setVideoLastFramePrompt] = useState('');
    const [isGeneratingVideoLastFrameImage, setIsGeneratingVideoLastFrameImage] = useState(false);
    const [isGeneratingVideoLastFramePrompt, setIsGeneratingVideoLastFramePrompt] = useState(false);

    useEffect(() => {
        if (videoModel === 'veo') {
            if (videoRefSource !== 'none') {
                setVideoDuration(8);
                setVideoAspectRatio('16:9');
            } else if (videoDuration > 8) {
                setVideoDuration(8);
            }
        } else if (videoModel === 'sora' && videoDuration === 6) {
            setVideoDuration(8);
        }
    }, [videoModel, videoDuration, videoRefSource]);

    // Step 2: Platform-specific options
    // YouTube
    const [ytTitle, setYtTitle] = useState('');
    const [ytDescription, setYtDescription] = useState('');
    const [ytCategory, setYtCategory] = useState('22');
    const [ytTags, setYtTags] = useState('');
    const [ytPrivacy, setYtPrivacy] = useState<'public' | 'private' | 'unlisted'>('private');
    const [ytMadeForKids, setYtMadeForKids] = useState(false);
    const [ytNotifySubscribers, setYtNotifySubscribers] = useState(true);

    // LinkedIn
    const [liVisibility, setLiVisibility] = useState<'PUBLIC' | 'CONNECTIONS'>('PUBLIC');
    const [liText, setLiText] = useState('');

    // Facebook
    const [fbPageId, setFbPageId] = useState('');
    const [fbVideoTitle, setFbVideoTitle] = useState('');
    const [fbVideoDescription, setFbVideoDescription] = useState('');
    const [fbText, setFbText] = useState('');

    // TikTok
    const [ttPrivacy, setTtPrivacy] = useState('PUBLIC_TO_EVERYONE');
    const [ttDisableDuet, setTtDisableDuet] = useState(false);
    const [ttDisableStitch, setTtDisableStitch] = useState(false);
    const [ttDisableComment, setTtDisableComment] = useState(false);
    const [ttText, setTtText] = useState('');

    // Instagram
    const [igShareToFeed, setIgShareToFeed] = useState(true);
    const [igMediaType, setIgMediaType] = useState<'FEED' | 'STORY' | 'REEL'>('FEED');
    const [igCaption, setIgCaption] = useState('');

    // X (Twitter)
    const [xText, setXText] = useState('');

    // Step 3: Publishing
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishResults, setPublishResults] = useState<PublishResult[]>([]);
    const [currentPublishingPlatform, setCurrentPublishingPlatform] = useState<Platform | null>(null);

    // Scheduling
    const [showSchedulePicker, setShowSchedulePicker] = useState(false);
    const [scheduledDate, setScheduledDate] = useState<string>('');
    const [scheduledTime, setScheduledTime] = useState<string>('');
    const [isScheduling, setIsScheduling] = useState(false);
    const [scheduleResult, setScheduleResult] = useState<{ success: boolean; message: string } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to top on step change
    useEffect(() => {
        if (containerRef.current) {
            // Use a slight delay to allow the new step to render and layout to settle
            const timer = setTimeout(() => {
                if (containerRef.current) {
                    containerRef.current.scrollIntoView({ behavior: 'auto', block: 'start' });
                }
            }, 50);
            return () => clearTimeout(timer);
        }
    }, [currentStep]);

    // ─────────────────────────────────────────────────────────────────────────
    // Computed values
    // ─────────────────────────────────────────────────────────────────────────

    const projectAssets = useMemo(() => {
        const assets: any[] = [];

        // 1. Knowledge Base
        (project.knowledgeBase || []).forEach(file => {
            assets.push({
                id: file.id,
                url: file.url,
                type: file.type,
                name: file.name
            });
        });

        // 2. Uploaded Files
        (project.uploadedFiles || []).forEach(file => {
            assets.push({
                id: file.uri || file.name,
                url: file.uri,
                type: file.mimeType,
                name: file.displayName || file.name
            });
        });

        // 3. Initial State Asset (if not already included)
        // This ensures that if we share an asset by URL/ID that isn't found in the lists above (e.g. transient state), 
        // it still shows up and is selected.
        if (initialState?.selectedAssetId && initialState.assetUrl) {
            const exists = assets.find(a => a.id === initialState.selectedAssetId || a.name === initialState.selectedAssetId);
            if (!exists) {
                assets.push({
                    id: initialState.selectedAssetId,
                    url: initialState.assetUrl,
                    type: initialState.assetType || 'image/png', // fallback
                    name: 'Shared Asset'
                });
            }
        }

        // 4. Research Sessions
        (project.researchSessions || []).forEach(session => {
            // Session uploads
            (session.uploadedFiles || []).forEach(file => {
                assets.push({
                    id: `session-file-${session.id}-${file.id || file.url}`,
                    url: file.url,
                    type: file.type,
                    name: file.name
                });
            });

            const report = session.researchReport;
            if (report) {
                // Header Image
                if (report.headerImageUrl && !report.headerImageUrl.includes('placehold.co')) {
                    assets.push({
                        id: `header-${session.id}`,
                        url: report.headerImageUrl,
                        type: 'image/png',
                        name: `Hero - ${session.topic}`
                    });
                }

                // Slides
                (report.slides || []).forEach((slide, idx) => {
                    if (slide.imageUrl && !slide.imageUrl.includes('placehold.co')) {
                        assets.push({
                            id: `slide-${session.id}-${idx}`,
                            url: slide.imageUrl,
                            type: 'image/png',
                            name: slide.title || `Slide ${idx + 1}`
                        });
                    }
                    if (slide.imageUrls) {
                        slide.imageUrls.forEach((url, imgIdx) => {
                            if (url && !url.includes('placehold.co')) {
                                assets.push({
                                    id: `slide-${session.id}-${idx}-${imgIdx}`,
                                    url: url,
                                    type: 'image/png',
                                    name: `${slide.title || `Slide ${idx + 1}`} - Image ${imgIdx + 1}`
                                });
                            }
                        });
                    }
                });

                // Blog Post
                if (report.blogPost?.imageUrl && !report.blogPost.imageUrl.includes('placehold.co')) {
                    assets.push({
                        id: `blog-${session.id}`,
                        url: report.blogPost.imageUrl,
                        type: 'image/png',
                        name: `Blog Cover - ${report.blogPost.title}`
                    });
                }

                // Social Campaign
                (report.socialCampaign?.posts || []).forEach((post, idx) => {
                    if (post.imageUrl && !post.imageUrl.includes('placehold.co')) {
                        assets.push({
                            id: `social-${session.id}-${idx}`,
                            url: post.imageUrl,
                            type: 'image/png',
                            name: `${post.platform} Post Image`
                        });
                    }
                });

                // Video Post
                if (report.videoPost?.videoUrl) {
                    assets.push({
                        id: `video-${session.id}`,
                        url: report.videoPost.videoUrl,
                        type: 'video/mp4',
                        name: report.videoPost.caption || 'Research Video'
                    });
                }

                // Books
                (report.books || []).forEach(book => {
                    (book.pages || []).forEach(page => {
                        if (page.imageUrl) {
                            assets.push({
                                id: `book-page-${session.id}-${book.id}-${page.pageNumber}`,
                                url: page.imageUrl,
                                type: 'image/png',
                                name: `${book.title} - Page ${page.pageNumber}`
                            });
                        }
                    });
                });
            }

            // Note Map
            (session.noteMapState || []).forEach((node, idx) => {
                if (node.imageUrl && !node.imageUrl.includes('placehold.co')) {
                    assets.push({
                        id: `notemap-${session.id}-${node.id || idx}`,
                        url: node.imageUrl,
                        type: 'image/png',
                        name: node.title || `Note ${idx + 1}`
                    });
                }
            });
        });
        return assets;
    }, [project]);

    const selectedAsset = useMemo(() => {
        if (!selectedAssetId) return null;
        if (tempAsset && (tempAsset.id === selectedAssetId || (tempAsset.name && tempAsset.name === selectedAssetId))) return tempAsset;
        return projectAssets.find((a: any) => a.id === selectedAssetId || a.name === selectedAssetId);
    }, [projectAssets, selectedAssetId, tempAsset]);

    const availablePlatforms = useMemo(() => {
        return PLATFORMS.filter(p => {
            if (postType === 'TEXT') return p.supportsText;
            if (postType === 'IMAGE') return p.supportsImage;
            if (postType === 'VIDEO') return p.supportsVideo;
            return false;
        });
    }, [postType]);

    const mediaPreviewUrl = useMemo(() => {
        if (uploadedFile) {
            return URL.createObjectURL(uploadedFile);
        }
        if (selectedAsset) {
            return (selectedAsset as any).url || (selectedAsset as any).uri || '';
        }
        return '';
    }, [uploadedFile, selectedAsset]);

    const canContinue = useMemo(() => {
        if (selectedPlatforms.length === 0) return false;

        if (postType === 'TEXT') {
            return textContent.trim().length > 0;
        } else {
            return !!(uploadedFile || selectedAsset);
        }
    }, [postType, textContent, uploadedFile, selectedAsset, selectedPlatforms]);

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    const fetchImageAsBase64 = async (url: string): Promise<string> => {
        try {
            if (url.startsWith('data:image')) {
                return url.split(',')[1];
            }
            const response = await fetch(url);
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const res = reader.result as string;
                    resolve(res.split(',')[1]);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.error('Error fetching image for base64:', error);
            throw error;
        }
    };

    const isPlatformConnected = (platform: Platform): boolean => {
        switch (platform) {
            case 'facebook': return facebookConnected;
            case 'instagram': return facebookConnected && igAccounts.length > 0;
            case 'tiktok': return tiktokConnected;
            case 'youtube': return youtubeConnected;
            case 'linkedin': return linkedinConnected;
            case 'x': return xConnected;
            default: return false;
        }
    };

    const getPlatformProfile = (platform: Platform): any => {
        switch (platform) {
            case 'facebook': return facebookProfile;
            case 'instagram': return igAccounts.find((a: any) => String(a.igId) === selectedIgId);
            case 'tiktok': return tiktokCreatorInfo;
            case 'youtube': return youtubeChannel;
            case 'linkedin': return linkedinProfile;
            case 'x': return xProfile;
            default: return null;
        }
    };

    const handleConnectPlatform = (platform: Platform) => {
        switch (platform) {
            case 'facebook':
                handleFacebookConnect();
                break;
            case 'instagram':
                if (!facebookConnected) handleFacebookConnect();
                else loadInstagramAccounts();
                break;
            case 'tiktok':
                handleTiktokConnect();
                break;
            case 'youtube':
                handleYoutubeConnect();
                break;
            case 'linkedin':
                handleLinkedinConnect();
                break;
            case 'x':
                handleXConnect();
                break;
        }
    };

    const handleDisconnectPlatform = (platform: Platform) => {
        switch (platform) {
            case 'facebook':
                handleFacebookLogout();
                break;
            case 'instagram':
                handleFacebookLogout();
                break;
            case 'tiktok':
                handleTiktokDisconnect();
                break;
            case 'youtube':
                handleYoutubeDisconnect();
                break;
            case 'linkedin':
                handleLinkedinDisconnect();
                break;
            case 'x':
                handleXDisconnect();
                break;
        }
    };

    const togglePlatform = (platform: Platform) => {
        setSelectedPlatforms(prev =>
            prev.includes(platform)
                ? prev.filter(p => p !== platform)
                : [...prev, platform]
        );
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setUploadedFile(file);
            setSelectedAssetId('');
        }
    };

    const handleAssetSelect = (assetId: string) => {
        setSelectedAssetId(assetId);
        setUploadedFile(null);
    };

    // Upload media to Vercel Blob storage and return public URL
    const [isUploadingMedia, setIsUploadingMedia] = useState(false);

    const uploadMediaToBlob = async (file: File): Promise<string> => {
        setIsUploadingMedia(true);
        try {
            return await mediaService.uploadToBlob(file);
        } catch (error: any) {
            console.error('[Blob Upload] Error:', error);
            throw new Error(error?.message || 'Failed to upload media');
        } finally {
            setIsUploadingMedia(false);
        }
    };

    // Helper to get media URL - uploads to blob if needed
    const getMediaUrlForPublishing = async (): Promise<string> => {
        // If we have a selected asset with a URL, use that
        if (selectedAsset) {
            const asset = selectedAsset as any;
            const url = asset.url || asset.uri || '';

            setIsUploadingMedia(true);
            try {
                const remoteUrl = await mediaService.ensureRemoteUrl(url);
                return remoteUrl || '';
            } catch (e) {
                console.error('Failed to prepare image for sharing:', e);
                throw new Error('Failed to prepare image. Try saving it to the project first.');
            } finally {
                setIsUploadingMedia(false);
            }
        }

        // If we have an uploaded file, upload to blob first
        if (uploadedFile) {
            return await uploadMediaToBlob(uploadedFile);
        }

        return '';
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Step Navigation
    // ─────────────────────────────────────────────────────────────────────────

    const handleContinue = () => {
        if (currentStep === 1 && canContinue) {
            // Pre-populate step 2 fields from step 1 content
            setYtDescription(textContent);
            setFbVideoTitle(textContent.substring(0, 100));
            setFbVideoDescription(textContent);
            setFbText(textContent);
            setLiText(textContent);
            setTtText(textContent);
            setXText(textContent);
            setIgCaption(textContent);

            // Check if we need to show Step 2 (Platform Setup)
            // Rule: Only show if there are disconnected platforms
            const unconnectedPlatforms = selectedPlatforms.filter(p => !isPlatformConnected(p));

            if (unconnectedPlatforms.length > 0) {
                // Show Step 2, but we'll filter it to only show unconnected ones
                setCurrentStep(2);
            } else {
                // All connected, skip directly to Step 3
                setCurrentStep(3);
            }
        } else if (currentStep === 2) {
            setCurrentStep(3);
        }
    };

    const handleBack = () => {
        if (currentStep === 3) {
            // If we skipped Step 2, go back to Step 1
            const unconnectedPlatforms = selectedPlatforms.filter(p => !isPlatformConnected(p));
            if (unconnectedPlatforms.length === 0) {
                setCurrentStep(1);
            } else {
                setCurrentStep(2);
            }
        } else if (currentStep > 1) {
            setCurrentStep((currentStep - 1) as 1 | 2);
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Scheduling Logic
    // ─────────────────────────────────────────────────────────────────────────

    const handleSchedule = async () => {
        if (!scheduledDate || !scheduledTime) return;

        // Convert local date/time to Unix timestamp
        const localDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
        const scheduledAtUnix = Math.floor(localDateTime.getTime() / 1000);

        // Validation
        const now = Math.floor(Date.now() / 1000);
        const minTime = now + 600; // 10 minutes
        const maxTime = now + 7 * 24 * 60 * 60; // 7 days

        if (scheduledAtUnix < minTime) {
            setScheduleResult({
                success: false,
                message: 'Scheduled time must be at least 10 minutes in the future',
            });
            return;
        }
        if (scheduledAtUnix > maxTime) {
            setScheduleResult({
                success: false,
                message: 'Scheduled time cannot be more than 7 days in the future (free tier limit)',
            });
            return;
        }

        // Validate that we have media for image/video posts
        const hasMedia = selectedAsset || uploadedFile;
        if ((postType === 'IMAGE' || postType === 'VIDEO') && !hasMedia) {
            setScheduleResult({
                success: false,
                message: `Please select ${postType === 'IMAGE' ? 'an image' : 'a video'} before scheduling`,
            });
            return;
        }

        // Validate Facebook connection if Facebook is selected
        if (selectedPlatforms.includes('facebook') && !facebookAccessToken) {
            setScheduleResult({
                success: false,
                message: 'Please connect Facebook before scheduling',
            });
            return;
        }

        // Validate Instagram connection if Instagram is selected
        if (selectedPlatforms.includes('instagram') && (!facebookAccessToken || !selectedIgId)) {
            setScheduleResult({
                success: false,
                message: 'Please connect Instagram before scheduling',
            });
            return;
        }

        setIsScheduling(true);
        setShowSchedulePicker(false);

        try {
            // Upload media to blob if needed, get public URL
            let mediaUrl: string | undefined;
            if (postType !== 'TEXT') {
                console.log('[Schedule] Getting media URL...', { hasAsset: !!selectedAsset, hasUpload: !!uploadedFile });
                mediaUrl = await getMediaUrlForPublishing();
                if (!mediaUrl) {
                    throw new Error('Failed to get media URL');
                }
                console.log('[Schedule] Media URL obtained:', mediaUrl.substring(0, 50) + '...');
            }

            // Build platform overrides
            const platformOverrides: Record<string, any> = {};

            for (const platform of selectedPlatforms) {
                switch (platform) {
                    case 'facebook':
                        platformOverrides.facebook = {
                            pageId: fbPageId || fbPages[0]?.id || '',
                            accessToken: facebookAccessToken,
                            message: fbText || textContent,
                        };
                        break;
                    case 'instagram':
                        platformOverrides.instagram = {
                            igId: selectedIgId,
                            accessToken: facebookAccessToken,
                            caption: igCaption || textContent,
                            mediaType: igMediaType,
                        };
                        break;
                    case 'linkedin':
                        platformOverrides.linkedin = {
                            accessToken: localStorage.getItem('linkedin_access_token'),
                            text: liText || textContent,
                            visibility: liVisibility,
                        };
                        break;
                    case 'tiktok':
                        platformOverrides.tiktok = {
                            accessToken: localStorage.getItem('tiktok_access_token'),
                            title: ttText || textContent,
                            privacyLevel: ttPrivacy,
                        };
                        break;
                    case 'x':
                        platformOverrides.x = {
                            accessToken: localStorage.getItem('x_access_token'),
                            text: xText || textContent,
                        };
                        break;
                    case 'youtube':
                        platformOverrides.youtube = {
                            title: ytTitle,
                            description: ytDescription || textContent,
                            privacy: ytPrivacy,
                        };
                        break;
                }
            }

            // mediaUrl was already obtained above using getMediaUrlForPublishing()

            const response = await authFetch('/api/social?op=schedule-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: project.id,
                    userId: project.ownerUid || 'anonymous',
                    scheduledAt: scheduledAtUnix,
                    platforms: selectedPlatforms,
                    postType,
                    textContent,
                    mediaUrl,
                    platformOverrides,
                }),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.error || 'Failed to schedule post');
            }

            // Format the scheduled time for display
            const formattedTime = localDateTime.toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
            });

            // Log activity
            try {
                await logProjectActivity(
                    project.ownerUid || 'anonymous',
                    project.id,
                    'post_scheduled',
                    `Scheduled ${postType} to ${selectedPlatforms.join(', ')} for ${formattedTime}`,
                    {
                        platforms: selectedPlatforms,
                        scheduledAt: scheduledAtUnix,
                        postType
                    }
                );
            } catch (err) {
                console.error('Failed to log activity:', err);
            }

            setScheduleResult({
                success: true,
                message: `✅ Post scheduled for ${formattedTime}. It will be published automatically to ${selectedPlatforms.join(', ')}.`,
            });
        } catch (error: any) {
            console.error('[Schedule] Error:', error);
            setScheduleResult({
                success: false,
                message: `❌ Failed to schedule: ${error.message}`,
            });
        } finally {
            setIsScheduling(false);
        }
    };

    const handleGenerateContent = async () => {
        if (isGenerating) return;

        setIsGenerating(true);
        try {
            // Use the first selected platform for context, or general if none
            const platform = selectedPlatforms.length > 0 ? selectedPlatforms[0] : undefined;
            const ctx = contextService.buildProjectContext(project);

            // Refine the user's rough idea into a better instruction for the content generator
            const refinedInstruction = await refinePromptWithGemini3(textContent, ctx.fullContext, 'text');

            const generated = await generateSocialPostContent(refinedInstruction, platform, ctx.fullContext);
            if (generated) {
                setTextContent(generated);
            }
        } catch (err) {
            console.error('Failed to generate content:', err);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleGenerateImage = async () => {
        if (isGeneratingImage || (!imagePrompt.trim() && !textContent.trim())) return;

        const prompt = imagePrompt.trim() || textContent.trim();
        setIsGeneratingImage(true);
        try {
            const ctx = contextService.buildProjectContext(project);
            // Refine prompt, passing true if we have a reference image
            const hasRefs = imageRefSource !== 'none';
            const refinedPrompt = await refinePromptWithGemini3(
                prompt,
                ctx.fullContext,
                'image',
                undefined,
                hasRefs
            );

            let imageDataUrl: string;

            // Collect references
            const manualRefs: ImageReference[] = [];

            // Legacy/Profile check or new source check
            if (imageRefSource === 'profile' && userProfile?.photoURL) {
                try {
                    const { base64, mimeType } = await fetchImageRefAsBase64(userProfile.photoURL);
                    manualRefs.push({ base64, mimeType });
                } catch (err) {
                    console.error('Failed to load profile picture:', err);
                }
            } else if (imageRefSource === 'upload' && imageRefFile) {
                try {
                    const buffer = await imageRefFile.arrayBuffer();
                    const base64 = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            const result = reader.result as string;
                            resolve(result.split(',')[1]);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(new Blob([buffer]));
                    });
                    manualRefs.push({ base64, mimeType: imageRefFile.type || 'image/png' });
                } catch (err) {
                    console.error('Failed to load uploaded reference:', err);
                }
            } else if (imageRefSource === 'asset' && imageRefUrl) {
                try {
                    // Start of Selection
                    let base64 = '';
                    let mimeType = 'image/png';

                    if (imageRefUrl.startsWith('data:')) {
                        const match = imageRefUrl.match(/^data:(.+?);base64,(.+)$/);
                        if (match) {
                            mimeType = match[1];
                            base64 = match[2];
                        }
                    } else {
                        const res = await fetch(imageRefUrl);
                        const blob = await res.blob();
                        base64 = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => {
                                const result = reader.result as string;
                                resolve(result.split(',')[1]);
                            };
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                        mimeType = blob.type || 'image/png';
                    }

                    if (base64) {
                        manualRefs.push({ base64, mimeType });
                    }
                } catch (err) {
                    console.error('Failed to load asset reference:', err);
                }
            }
            // Keep legacy support for useProfilePicture if it was set elsewhere, though we are removing the UI
            else if (useProfilePicture && userProfile?.photoURL) {
                try {
                    const { base64, mimeType } = await fetchImageRefAsBase64(userProfile.photoURL);
                    manualRefs.push({ base64, mimeType });
                } catch (err) {
                    console.error('Failed to load profile picture:', err);
                }
            }

            if (manualRefs.length > 0) {
                console.log('[UnifiedSocialPublisher] Generating image with references:', manualRefs.length);
                // Use advanced generator with refs
                const result = await generateImageWithReferences(refinedPrompt, manualRefs, {
                    aspectRatio: imageAspectRatio,
                    useProModel: true
                });
                imageDataUrl = result.imageDataUrl;
            } else {
                // Use standard generator
                const result = await generateSocialPostImage(refinedPrompt, {
                    aspectRatio: imageAspectRatio,
                    useProModel: true
                });
                imageDataUrl = result.imageDataUrl;
            }

            if (imageDataUrl) {
                // Convert Data URL to File object so it can be uploaded/previewed
                const res = await fetch(imageDataUrl);
                const blob = await res.blob();
                const file = new File([blob], `generated-image-${Date.now()}.png`, { type: blob.type || 'image/png' });

                setUploadedFile(file);
                setSelectedAssetId('');
            }
        } catch (error) {
            console.error('Failed to generate image:', error);
            alert('Failed to generate image. Please try again.');
        } finally {
            setIsGeneratingImage(false);
        }
    };

    const handleCreateImagePrompt = async () => {
        if (isGeneratingPrompt || !textContent.trim()) return;
        setIsGeneratingPrompt(true);
        try {
            const ctx = contextService.buildProjectContext(project);
            const prompt = await generateImagePromptFromText(textContent, ctx.fullContext);
            if (prompt) {
                setImagePrompt(prompt);
            }
        } catch (err) {
            console.error('Failed to generate image prompt:', err);
        } finally {
            setIsGeneratingPrompt(false);
        }
    };

    // Video generation handlers
    const handleCreateVideoPrompt = async () => {
        if (isGeneratingPrompt || !textContent.trim()) return;
        setIsGeneratingPrompt(true);
        try {
            const ctx = contextService.buildProjectContext(project);
            const prompt = await generateImagePromptFromText(textContent, ctx.fullContext);
            if (prompt) {
                setVideoPrompt(prompt);
            }
        } catch (err) {
            console.error('Failed to generate video prompt:', err);
        } finally {
            setIsGeneratingPrompt(false);
        }
    };

    const handleCreateVideoRefPrompt = async () => {
        if (isGeneratingVideoRefPrompt || !textContent.trim()) return;
        setIsGeneratingVideoRefPrompt(true);
        try {
            const ctx = contextService.buildProjectContext(project);
            const prompt = await generateImagePromptFromText(textContent, ctx.fullContext);
            if (prompt) {
                setVideoRefPrompt(prompt);
            }
        } catch (err) {
            console.error('Failed to generate video ref prompt:', err);
        } finally {
            setIsGeneratingVideoRefPrompt(false);
        }
    };

    const handleGenerateVideoRefImage = async () => {
        if (isGeneratingVideoRefImage || !videoRefPrompt.trim()) return;
        setIsGeneratingVideoRefImage(true);
        try {
            // Deduct credits for image generation
            const creditSuccess = await deductCredits('imageGenerationPro');
            if (!creditSuccess) {
                alert('Insufficient credits for image generation.');
                setIsGeneratingVideoRefImage(false);
                return;
            }

            const ctx = contextService.buildProjectContext(project);
            const refinedPrompt = await refinePromptWithGemini3(videoRefPrompt, ctx.fullContext, 'image');

            const result = await generateSocialPostImage(refinedPrompt, {
                aspectRatio: videoAspectRatio,
                useProModel: true
            });
            const imageDataUrl = result.imageDataUrl;
            if (imageDataUrl) {
                setVideoRefImageUrl(imageDataUrl);
                // Convert to file for Sora/Veo
                const res = await fetch(imageDataUrl);
                const blob = await res.blob();
                const file = new File([blob], `video-ref-${Date.now()}.png`, { type: 'image/png' });
                setVideoRefImageFile(file);
            }
        } catch (error) {
            console.error('Failed to generate reference image:', error);
            alert('Failed to generate reference image. Please try again.');
        } finally {
            setIsGeneratingVideoRefImage(false);
        }
    };

    // Last Frame Handlers
    const handleCreateVideoLastFramePrompt = async () => {
        if (isGeneratingVideoLastFramePrompt || !textContent.trim()) return;
        setIsGeneratingVideoLastFramePrompt(true);
        try {
            const ctx = contextService.buildProjectContext(project);
            const prompt = await generateImagePromptFromText(textContent, ctx.fullContext);
            if (prompt) {
                setVideoLastFramePrompt(prompt);
            }
        } catch (err) {
            console.error('Failed to generate video last frame prompt:', err);
        } finally {
            setIsGeneratingVideoLastFramePrompt(false);
        }
    };

    const handleGenerateVideoLastFrameImage = async () => {
        if (isGeneratingVideoLastFrameImage || !videoLastFramePrompt.trim()) return;
        setIsGeneratingVideoLastFrameImage(true);
        try {
            const ctx = contextService.buildProjectContext(project);
            const refinedPrompt = await refinePromptWithGemini3(videoLastFramePrompt, ctx.fullContext, 'image');

            const result = await generateSocialPostImage(refinedPrompt, {
                aspectRatio: videoAspectRatio,
                useProModel: true
            });
            const imageDataUrl = result.imageDataUrl;
            if (imageDataUrl) {
                setVideoLastFrameUrl(imageDataUrl);
                const res = await fetch(imageDataUrl);
                const blob = await res.blob();
                const file = new File([blob], `video-last-${Date.now()}.png`, { type: 'image/png' });
                setVideoLastFrameFile(file);
            }
        } catch (error) {
            console.error('Failed to generate last frame image:', error);
            alert('Failed to generate last frame image. Please try again.');
        } finally {
            setIsGeneratingVideoLastFrameImage(false);
        }
    };

    const handleVideoLastFrameFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!IMAGE_FILE_REGEX.test(file.name)) {
            alert('Please select a valid image file');
            return;
        }

        setVideoLastFrameFile(file);
        const reader = new FileReader();
        reader.onload = (e) => setVideoLastFrameUrl(e.target?.result as string);
        reader.readAsDataURL(file);
    };

    const handleVideoLastFrameAssetSelect = (assetUrl: string) => {
        setVideoLastFrameUrl(assetUrl);
        // We'll need to fetch the blob if we want to send it as a file, 
        // but for now mostly relying on URL logic or same flow as ref image
        fetch(assetUrl).then(res => res.blob()).then(blob => {
            setVideoLastFrameFile(new File([blob], `asset-last-${Date.now()}.png`, { type: blob.type }));
        });
    };

    const handleVideoRefFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setVideoRefImageFile(file);
            const url = URL.createObjectURL(file);
            setVideoRefImageUrl(url);
        }
    };

    const handleVideoRefAssetSelect = (assetUrl: string) => {
        setVideoRefImageUrl(assetUrl);
        setVideoRefImageFile(null); // Will fetch from URL during generation
    };


    const handleImageRefFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setImageRefFile(file);
            const url = URL.createObjectURL(file);
            setImageRefUrl(url);
        }
    };

    const handleImageRefAssetSelect = (assetUrl: string) => {
        setImageRefUrl(assetUrl);
        setImageRefFile(null); // Will fetch from URL during generation
    };

    const handleGenerateVideo = async () => {
        if (isGeneratingVideo || !videoPrompt.trim()) return;
        setIsGeneratingVideo(true);
        setVideoGenProgress(0);
        setVideoGenStatus('Starting video generation...');

        try {
            // Deduct credits for video generation
            const creditSuccess = await deductCredits('videoClipGeneration');
            if (!creditSuccess) {
                alert('Insufficient credits for video generation.');
                setIsGeneratingVideo(false);
                return;
            }

            if (videoModel === 'sora') {
                // Sora generation
                // Sora generation
                const size = videoAspectRatio === '16:9' ? '1280x720' : '720x1280';
                const seconds = String(videoDuration) as '4' | '8' | '12';
                const model = videoQuality === 'quality' ? 'sora-2-pro' : 'sora-2';

                const ctx = contextService.buildProjectContext(project);
                const refinedPrompt = await refinePromptWithGemini3(videoPrompt, ctx.fullContext, 'video');

                let job: VideoJob;
                if (videoRefSource !== 'none' && videoRefImageFile) {
                    setVideoGenStatus('Uploading reference image...');
                    job = await createVideoFromImage({ model, prompt: refinedPrompt, seconds, size }, videoRefImageFile);
                } else {
                    job = await createVideoFromText({ model, prompt: refinedPrompt, seconds, size });
                }

                setVideoGenStatus('Generating video (this may take a few minutes)...');

                const completedJob = await pollVideoUntilComplete(job.id, (status) => {
                    setVideoGenProgress(status.progress || 0);
                    setVideoGenStatus(`Progress: ${status.progress || 0}%`);
                });

                if (completedJob.status === 'completed') {
                    setVideoGenStatus('Downloading video...');
                    const videoBlob = await downloadVideoBlob(completedJob.id, 'video');
                    const videoFile = new File([videoBlob], `sora-video-${Date.now()}.mp4`, { type: 'video/mp4' });
                    setUploadedFile(videoFile);
                    setSelectedAssetId('');
                    setVideoGenStatus('Video generated successfully!');
                } else {
                    throw new Error(completedJob.error?.message || 'Video generation failed');
                }
            } else {
                // Veo generation
                setVideoGenStatus('Generating video with Veo 3.1...');

                // Helper to get base64 from file or URL
                const getBase64 = async (file: File | null, url: string): Promise<{ base64: string, mime: string } | null> => {
                    if (file) {
                        const buffer = await file.arrayBuffer();
                        return {
                            base64: btoa(String.fromCharCode(...new Uint8Array(buffer))),
                            mime: file.type
                        };
                    } else if (url) {
                        try {
                            if (url.startsWith('data:')) {
                                const match = url.match(/^data:(.+?);base64,(.+)$/);
                                if (match) return { base64: match[2], mime: match[1] };
                            } else {
                                const res = await fetch(url);
                                const blob = await res.blob();
                                const buffer = await blob.arrayBuffer();
                                return {
                                    base64: btoa(String.fromCharCode(...new Uint8Array(buffer))),
                                    mime: blob.type
                                };
                            }
                        } catch (e) {
                            console.error('Error fetching image for base64:', e);
                        }
                    }
                    return null;
                };

                let base64Image: string | null = null;
                let mimeType: string | null = null;

                if (videoRefSource !== 'none') {
                    if (videoRefSource === 'profile' && userProfile?.photoURL) {
                        const b64 = await fetchImageAsBase64(userProfile.photoURL);
                        if (b64) {
                            base64Image = b64;
                            mimeType = 'image/png';
                        }
                    } else {
                        const result = await getBase64(videoRefImageFile, videoRefImageUrl);
                        if (result) {
                            base64Image = result.base64;
                            mimeType = result.mime;
                        }
                    }
                }

                let lastFrameImage: string | null = null;
                let lastFrameMimeType: string | null = null;

                if (videoLastFrameSource !== 'none') {
                    const result = await getBase64(videoLastFrameFile, videoLastFrameUrl);
                    if (result) {
                        lastFrameImage = result.base64;
                        lastFrameMimeType = result.mime;
                    }
                }

                // If sora branch didn't run, we still need refinement for Veo
                const ctx = contextService.buildProjectContext(project);
                const refinedPrompt = await refinePromptWithGemini3(videoPrompt, ctx.fullContext, 'video');

                const videoBlob = await generateVeoVideo(
                    refinedPrompt,
                    videoAspectRatio,
                    videoQuality as 'speed' | 'quality',
                    base64Image && mimeType ? { image: { base64: base64Image, mimeType } } : {}
                );

                const videoFile = new File([videoBlob], `veo-video-${Date.now()}.mp4`, { type: 'video/mp4' });
                setUploadedFile(videoFile);
                setSelectedAssetId('');
                setVideoGenStatus('Video generated successfully!');
            }

            setVideoGenProgress(100);
        } catch (error: any) {
            console.error('Failed to generate video:', error);
            setVideoGenStatus(`Error: ${error?.message || 'Failed to generate video'}`);
            alert('Failed to generate video. Please try again.');
        } finally {
            setIsGeneratingVideo(false);
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Publishing Logic
    // ─────────────────────────────────────────────────────────────────────────

    const getMediaFile = async (): Promise<Blob | null> => {
        if (uploadedFile) return uploadedFile;
        if (selectedAsset) {
            const url = (selectedAsset as any).url || (selectedAsset as any).uri;
            if (url) {
                try {
                    const res = await fetch(url);
                    return await res.blob();
                } catch {
                    return null;
                }
            }
        }
        return null;
    };

    const publishToYouTube = async (): Promise<PublishResult> => {
        try {
            const file = await getMediaFile();
            if (!file) throw new Error('No video file');

            const mimeType = file.type || 'video/mp4';

            const initRes = await authFetch('/api/google?op=youtube-upload-init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: ytTitle || 'Untitled Video',
                    description: ytDescription || textContent,
                    privacyStatus: ytPrivacy,
                    tags: ytTags.split(',').map(t => t.trim()).filter(Boolean),
                    categoryId: ytCategory,
                    madeForKids: ytMadeForKids,
                    notifySubscribers: ytNotifySubscribers,
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
                body: file,
            });

            if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);

            return { platform: 'youtube', success: true };
        } catch (e: any) {
            return { platform: 'youtube', success: false, error: e.message };
        }
    };

    const publishToLinkedIn = async (): Promise<PublishResult> => {
        try {
            if (postType === 'TEXT') {
                const res = await authFetch('/api/linkedin?op=post-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: liText || textContent, visibility: liVisibility }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error || 'Failed');
                return { platform: 'linkedin', success: true, postId: data.postId };
            } else {
                // Image or Video
                const file = await getMediaFile();
                if (!file) throw new Error('No media file');

                const regRes = await authFetch('/api/linkedin?op=register-upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mediaType: postType }),
                });
                const regData = await regRes.json().catch(() => ({}));
                if (!regRes.ok) throw new Error(regData?.error || 'Failed to register');

                const { uploadUrl, asset } = regData;

                const uploadRes = await authFetch(`/api/linkedin?op=upload-media&uploadUrl=${encodeURIComponent(uploadUrl)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': file.type },
                    body: file,
                });
                if (!uploadRes.ok) throw new Error('Failed to upload media');

                const postRes = await authFetch('/api/linkedin?op=post-media', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: liText || textContent,
                        asset,
                        mediaType: postType,
                        visibility: liVisibility,
                    }),
                });
                const postData = await postRes.json().catch(() => ({}));
                if (!postRes.ok) throw new Error(postData?.error || 'Failed');
                return { platform: 'linkedin', success: true, postId: postData.postId };
            }
        } catch (e: any) {
            return { platform: 'linkedin', success: false, error: e.message };
        }
    };

    const publishToX = async (): Promise<PublishResult> => {
        try {
            let mediaId = '';

            if (postType !== 'TEXT') {
                const file = await getMediaFile();
                if (!file) throw new Error('No media file');

                const category = postType === 'VIDEO' ? 'tweet_video' : 'tweet_image';

                const initRes = await authFetch('/api/social?op=x-upload-init', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mediaType: file.type,
                        totalBytes: file.size,
                        mediaCategory: category,
                    }),
                });
                if (!initRes.ok) throw new Error('Failed to init upload');
                const initData = await initRes.json();
                mediaId = initData.id_str || initData.media_id_string || initData.id;

                // Chunk upload
                const CHUNK_SIZE = 1024 * 1024;
                const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
                for (let i = 0; i < totalChunks; i++) {
                    const chunk = file.slice(i * CHUNK_SIZE, Math.min(file.size, (i + 1) * CHUNK_SIZE));
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
                const finalizeData = await finalizeRes.json();

                // Wait for video processing if needed
                if (finalizeData.processing_info) {
                    let processingState = finalizeData.processing_info.state;
                    let checkAfterSecs = finalizeData.processing_info.check_after_secs || 1;

                    // Poll until succeeded or failed (max 60 seconds)
                    const maxAttempts = 30;
                    let attempts = 0;

                    while (processingState !== 'succeeded' && processingState !== 'failed' && attempts < maxAttempts) {
                        await new Promise(r => setTimeout(r, checkAfterSecs * 1000));
                        attempts++;

                        // Check status
                        const statusRes = await authFetch(`/api/social?op=x-upload-status&mediaId=${mediaId}`, {
                            method: 'GET',
                        });

                        if (statusRes.ok) {
                            const statusData = await statusRes.json();
                            processingState = statusData.processing_info?.state || 'succeeded';
                            checkAfterSecs = statusData.processing_info?.check_after_secs || 2;
                        } else {
                            // If status check fails, assume processing complete
                            break;
                        }
                    }

                    if (processingState === 'failed') {
                        throw new Error('Video processing failed');
                    }
                }
            }

            const postRes = await authFetch('/api/social?op=x-post-tweet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: xText || textContent,
                    mediaIds: mediaId ? [mediaId] : [],
                }),
            });
            if (!postRes.ok) {
                const errData = await postRes.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to post');
            }

            return { platform: 'x', success: true };
        } catch (e: any) {
            return { platform: 'x', success: false, error: e.message };
        }
    };

    const publishToFacebook = async (): Promise<PublishResult> => {
        try {
            if (!facebookAccessToken) throw new Error('Not connected');

            const pageId = fbPageId || fbPages[0]?.id;
            if (!pageId) throw new Error('No page selected');

            let op = '';
            const body: any = { fbUserAccessToken: facebookAccessToken, pageId };

            if (postType === 'TEXT') {
                op = 'fb-publish-post';
                body.message = fbText || textContent;
            } else if (postType === 'IMAGE') {
                op = 'fb-publish-photo';
                const mediaUrl = await getMediaUrlForPublishing();
                if (!mediaUrl) throw new Error('No image - please select or upload an image');
                body.url = mediaUrl;
                body.caption = fbText || textContent;
            } else if (postType === 'VIDEO') {
                op = 'fb-publish-video';
                const mediaUrl = await getMediaUrlForPublishing();
                if (!mediaUrl) throw new Error('No video - please select or upload a video');
                body.file_url = mediaUrl;
                body.title = fbVideoTitle || textContent.substring(0, 100);
                body.description = fbVideoDescription || textContent;
            }

            console.log('[FB Publish] Sending request:', { op, hasUrl: !!body.url || !!body.file_url });

            const res = await authFetch(`/api/social?op=${op}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed');

            return { platform: 'facebook', success: true, postId: data.id };
        } catch (e: any) {
            return { platform: 'facebook', success: false, error: e.message };
        }
    };

    const publishToInstagram = async (): Promise<PublishResult> => {
        try {
            if (!facebookAccessToken) throw new Error('Not connected');
            if (!selectedIgId) throw new Error('No account selected');

            // Get media URL - handles both assets and uploaded files
            const mediaUrl = await getMediaUrlForPublishing();
            if (!mediaUrl) throw new Error('No media - please select or upload media');

            console.log('[IG Publish] Sending request:', { igId: selectedIgId, mediaUrl: mediaUrl.substring(0, 50) + '...' });

            const res = await authFetch('/api/social?op=ig-publish-robust', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fbUserAccessToken: facebookAccessToken,
                    igId: selectedIgId,
                    mediaType: igMediaType === 'REEL' ? 'REELS' : igMediaType === 'STORY' ? 'STORIES' : 'FEED',
                    mediaUrls: [mediaUrl],
                    caption: igCaption || textContent,
                    shareToFeed: igShareToFeed,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed');

            return { platform: 'instagram', success: true, postId: data.mediaId || data.containerId };
        } catch (e: any) {
            return { platform: 'instagram', success: false, error: e.message };
        }
    };

    const publishToTikTok = async (): Promise<PublishResult> => {
        try {
            // TikTok requires file upload - use same approach as working advanced tab
            const file = await getMediaFile();
            if (!file) throw new Error('No media file for TikTok');

            const isVideo = file.type?.startsWith('video/');

            if (isVideo) {
                // VIDEO: Use FILE_UPLOAD - upload binary directly to TikTok
                console.log('[TikTok] Using FILE_UPLOAD for video');

                const initRes = await authFetch('/api/tiktok?op=tiktok-post-video-init', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        videoSize: file.size,
                        chunkSize: file.size,
                        totalChunkCount: 1,
                        title: ttText || textContent || '',
                        privacyLevel: ttPrivacy || 'SELF_ONLY',
                        disableDuet: ttDisableDuet,
                        disableStitch: ttDisableStitch,
                        disableComment: ttDisableComment,
                    }),
                });
                const initData = await initRes.json().catch(() => ({}));
                if (!initRes.ok) throw new Error(initData?.error || 'Failed to initialize TikTok upload');

                const { publishId, uploadUrl } = initData;
                if (!uploadUrl) throw new Error('TikTok did not return upload URL');

                // Upload the video directly to TikTok's upload URL (browser to TikTok)
                const uploadRes = await fetch(uploadUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'video/mp4',
                        'Content-Range': `bytes 0-${file.size - 1}/${file.size}`,
                    },
                    body: file,
                });

                if (uploadRes.status !== 201) {
                    throw new Error(`TikTok upload failed: ${uploadRes.status}`);
                }

                return { platform: 'tiktok', success: true, postId: publishId };
            } else {
                // PHOTO: Use FILE_UPLOAD - same as video, upload binary directly
                // (PULL_FROM_URL requires verified domains which Vercel Blob isn't)
                console.log('[TikTok] Using FILE_UPLOAD for photo');

                const initRes = await authFetch('/api/tiktok?op=tiktok-post-photo-init', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        photoCount: 1,
                        title: ttText || textContent || '',
                        description: ttText || textContent || '',
                        privacyLevel: ttPrivacy || 'SELF_ONLY',
                        autoAddMusic: true,
                    }),
                });
                const initData = await initRes.json().catch(() => ({}));
                console.log('[TikTok] Photo init response:', initData);

                if (!initRes.ok) throw new Error(initData?.error || 'Failed to initialize TikTok photo upload');

                const { publishId, uploadUrls } = initData;
                if (!uploadUrls || uploadUrls.length === 0) throw new Error('TikTok did not return upload URLs');

                // Upload the photo directly to TikTok's upload URL
                const uploadRes = await fetch(uploadUrls[0], {
                    method: 'PUT',
                    headers: {
                        'Content-Type': file.type || 'image/jpeg',
                        'Content-Length': String(file.size),
                    },
                    body: file,
                });

                if (uploadRes.status !== 200 && uploadRes.status !== 201) {
                    throw new Error(`TikTok photo upload failed: ${uploadRes.status}`);
                }

                return { platform: 'tiktok', success: true, postId: publishId };
            }
        } catch (e: any) {
            return { platform: 'tiktok', success: false, error: e.message };
        }
    };

    const handlePublish = async () => {
        setIsPublishing(true);
        setPublishResults([]);

        const results: PublishResult[] = [];

        for (const platform of selectedPlatforms) {
            if (!isPlatformConnected(platform)) {
                results.push({ platform, success: false, error: 'Not connected' });
                setPublishResults([...results]);
                continue;
            }

            setCurrentPublishingPlatform(platform);

            let result: PublishResult;
            switch (platform) {
                case 'youtube':
                    result = await publishToYouTube();
                    break;
                case 'linkedin':
                    result = await publishToLinkedIn();
                    break;
                case 'x':
                    result = await publishToX();
                    break;
                case 'facebook':
                    result = await publishToFacebook();
                    break;
                case 'instagram':
                    result = await publishToInstagram();
                    break;
                case 'tiktok':
                    result = await publishToTikTok();
                    break;
                default:
                    result = { platform, success: false, error: 'Unknown platform' };
            }

            results.push(result);
            setPublishResults([...results]);
        }

        // Log activities for successful publishes
        const successfulPlatforms = results.filter(r => r.success);
        if (successfulPlatforms.length > 0) {
            const userId = (userProfile as any)?.uid || project.ownerUid || 'anonymous';
            try {
                // Log each successful platform publish
                Promise.all(successfulPlatforms.map(r =>
                    logProjectActivity(
                        userId,
                        project.id,
                        'post_published',
                        `Published post to ${PLATFORMS.find(p => p.id === r.platform)?.name || r.platform}`,
                        {
                            platform: r.platform,
                            postId: r.postId,
                            postType: postType,
                            textContent: textContent.substring(0, 500)
                        }
                    )
                )).catch(err => console.error('Failed to log post_published activities:', err));
            } catch (err) {
                console.error('Failed to log post_published activities:', err);
            }
        }

        setCurrentPublishingPlatform(null);
        setIsPublishing(false);
    };

    // Load Facebook pages when needed
    useEffect(() => {
        if (facebookConnected && fbPages.length === 0 && selectedPlatforms.includes('facebook')) {
            loadFacebookPages();
        }
    }, [facebookConnected, selectedPlatforms]);

    // ─────────────────────────────────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────────────────────────────────

    const cardClass = `rounded-2xl border ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200'}`;
    const labelClass = `text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`;
    const inputClass = `w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode
        ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
        : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400'}`;
    const btnPrimary = `px-6 py-2.5 rounded-full text-sm font-semibold transition-all ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light'
        ? `${currentTheme.primary} ${currentTheme.primaryHover} text-white`
        : 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
        }`;
    const btnSecondary = `px-4 py-2 rounded-full text-sm font-medium transition-colors ${isDarkMode
        ? 'bg-white/5 hover:bg-white/10 text-white border border-white/10'
        : 'bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-200'}`;

    return (
        <div className="space-y-6">
            {/* Progress Steps and Mode Toggle */}
            <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-4 relative">
                {/* Spacer for centering steps if headerRight exists */}
                <div className="hidden sm:block w-32" />

                <div className="flex items-center justify-center gap-4">
                    {[1, 2, 3].map(step => (
                        <div key={step} className="flex items-center gap-2">
                            <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${currentStep >= step
                                    ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} text-white` : 'bg-[#0071e3] text-white'
                                    : isDarkMode
                                        ? 'bg-white/10 text-white/50'
                                        : 'bg-gray-200 text-gray-500'
                                    }`}
                            >
                                {step}
                            </div>
                            <span className={`text-sm ${currentStep >= step ? (isDarkMode ? 'text-white' : 'text-gray-900') : (isDarkMode ? 'text-white/50' : 'text-gray-400')}`}>
                                {step === 1 ? 'Create' : step === 2 ? 'Setup' : 'Publish'}
                            </span>
                            {step < 3 && (
                                <div className={`w-8 h-0.5 ${currentStep > step ? (activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.primary : 'bg-[#0071e3]') : isDarkMode ? 'bg-white/10' : 'bg-gray-200'}`} />
                            )}
                        </div>
                    ))}
                </div>

                <div className="flex items-center justify-end sm:w-32">
                    {headerRight}
                </div>
            </div>

            {/* Step 1: Content Creation */}
            {currentStep === 1 && (
                <div className={`${cardClass} p-6`}>
                    <h3 className={`text-lg font-bold mb-6 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        Create Your Content
                    </h3>

                    {/* Post Type Selector */}
                    <div className="mb-6">
                        <label className={`${labelClass} block mb-3`}>Post Type</label>
                        <div className="flex gap-3">
                            {(['TEXT', 'IMAGE', 'VIDEO'] as PostType[]).map(type => {
                                const icons = {
                                    TEXT: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/font.png',
                                    IMAGE: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/picture.png',
                                    VIDEO: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/3d-video.png'
                                };
                                const labels = {
                                    TEXT: 'Text',
                                    IMAGE: 'Image',
                                    VIDEO: 'Video'
                                };

                                return (
                                    <button
                                        key={type}
                                        onClick={() => {
                                            setPostType(type);
                                            setSelectedPlatforms([]);
                                            setUploadedFile(null);
                                            setSelectedAssetId('');
                                        }}
                                        className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all flex items-center justify-center ${postType === type
                                            ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} text-white` : 'bg-[#0071e3] text-white'
                                            : isDarkMode
                                                ? 'bg-white/5 text-white/70 hover:bg-white/10'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
                                    >
                                        <img src={icons[type]} alt={labels[type]} className="w-5 h-5 object-contain" />
                                        <span className="ml-2">{labels[type]}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Text Input */}
                    <div className="mb-6">
                        <label className={`${labelClass} block mb-2`}>
                            {postType === 'TEXT' ? 'Post Content' : 'Caption / Description'}
                        </label>
                        <div className="relative">
                            <textarea
                                value={textContent}
                                onChange={e => setTextContent(e.target.value)}
                                placeholder={postType === 'TEXT' ? 'What do you want to share?' : 'Add a caption...'}
                                rows={4}
                                className={`${inputClass} pr-24`} // Add padding to avoid overlap with button
                            />
                            <div className="absolute bottom-3 right-3 z-10">
                                <button
                                    onClick={handleGenerateContent}
                                    disabled={isGenerating}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm transition-all ${isDarkMode
                                        ? 'bg-purple-600 hover:bg-purple-500 text-white border border-purple-500/50'
                                        : 'bg-purple-600 hover:bg-purple-700 text-white border border-purple-500'
                                        } ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 active:scale-95'}`}
                                >
                                    {isGenerating ? (
                                        <>
                                            <div className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
                                            <span>Thinking...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>✨</span>
                                            <span>Generate</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Media Section (for IMAGE/VIDEO) */}
                    {postType !== 'TEXT' && (
                        <div className="mb-6">
                            <label className={`${labelClass} block mb-3`}>Media Source</label>

                            {/* Source Tabs */}
                            <div className="flex gap-2 mb-4">
                                <button
                                    onClick={() => setMediaSource('UPLOAD')}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mediaSource === 'UPLOAD'
                                        ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} text-white` : 'bg-[#0071e3] text-white'
                                        : isDarkMode ? 'bg-white/5 text-white/70' : 'bg-gray-100 text-gray-600'
                                        }`}
                                >
                                    📤 Upload
                                </button>
                                <button
                                    onClick={() => setMediaSource('ASSET')}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mediaSource === 'ASSET'
                                        ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} text-white` : 'bg-[#0071e3] text-white'
                                        : isDarkMode ? 'bg-white/5 text-white/70' : 'bg-gray-100 text-gray-600'
                                        }`}
                                >
                                    📁 From Assets
                                </button>
                                <button
                                    onClick={() => setMediaSource('GENERATE')}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mediaSource === 'GENERATE'
                                        ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} text-white` : 'bg-[#0071e3] text-white'
                                        : isDarkMode ? 'bg-white/5 text-white/70' : 'bg-gray-100 text-gray-600'
                                        }`}
                                >
                                    ✨ Generate
                                </button>
                            </div>

                            {/* Upload Input */}
                            {mediaSource === 'UPLOAD' && (
                                <div>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept={postType === 'IMAGE' ? 'image/*' : 'video/*'}
                                        onChange={handleFileUpload}
                                        className="hidden"
                                    />
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className={`w-full py-8 border-2 border-dashed rounded-xl transition-all ${isDarkMode
                                            ? 'border-white/20 hover:border-white/40 text-white/60'
                                            : 'border-gray-300 hover:border-gray-400 text-gray-500'
                                            }`}
                                    >
                                        <div className="text-center">
                                            <div className="text-3xl mb-2">{postType === 'IMAGE' ? '🖼️' : '🎬'}</div>
                                            <div className="font-medium">Click to upload {postType.toLowerCase()}</div>
                                            {uploadedFile && (
                                                <div className="mt-2 text-sm text-green-500">
                                                    ✓ {uploadedFile.name}
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                </div>
                            )}

                            {/* Asset Grid */}
                            {mediaSource === 'ASSET' && (
                                <div>
                                    {projectAssets.filter(postType === 'IMAGE' ? isImageAsset : isVideoAsset).length === 0 ? (
                                        <div className={`text-center py-8 ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                                            No compatible assets found. Upload {postType.toLowerCase()}s to the Knowledge Base or Data tab first.
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                                            {projectAssets.filter(postType === 'IMAGE' ? isImageAsset : isVideoAsset).map((asset: any) => {
                                                const id = asset.id || asset.name;
                                                const isSelected = selectedAssetId === id;
                                                const thumbUrl = asset.url || asset.uri || '';

                                                return (
                                                    <button
                                                        key={id}
                                                        onClick={() => handleAssetSelect(id)}
                                                        className={`aspect-square rounded-xl overflow-hidden border-2 transition-all ${isSelected
                                                            ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.border} ${currentTheme.ring}` : 'border-[#0071e3] ring-2 ring-[#0071e3]/30'
                                                            : isDarkMode ? 'border-white/10 hover:border-white/30' : 'border-gray-200 hover:border-gray-400'
                                                            }`}
                                                    >
                                                        {postType === 'IMAGE' ? (
                                                            <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="relative w-full h-full">
                                                                <video
                                                                    src={thumbUrl}
                                                                    className="w-full h-full object-cover"
                                                                    preload="metadata"
                                                                    muted
                                                                    playsInline
                                                                    onLoadedMetadata={(e) => {
                                                                        const video = e.currentTarget;
                                                                        video.currentTime = 0.1;
                                                                    }}
                                                                />
                                                                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                                                    <span className="text-3xl">▶️</span>
                                                                </div>
                                                                <div className={`absolute bottom-0 left-0 right-0 px-1.5 py-1 text-[10px] font-medium truncate ${isDarkMode ? 'bg-black/70 text-white' : 'bg-white/90 text-gray-900'
                                                                    }`}>
                                                                    {asset.name || 'Video'}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Generate Section */}
                            {mediaSource === 'GENERATE' && (
                                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                    {postType === 'IMAGE' ? (
                                        <>
                                            {/* Image Generation UI */}
                                            <div className="mb-4">
                                                <div className="flex justify-between items-center mb-2">
                                                    <label className={labelClass}>Image Prompt</label>
                                                    <button
                                                        onClick={handleCreateImagePrompt}
                                                        disabled={isGeneratingPrompt || !textContent.trim()}
                                                        className={`text-xs hover:underline flex items-center gap-1.5 ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.text : 'text-[#0071e3]'} ${isGeneratingPrompt || !textContent.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        {isGeneratingPrompt ? (
                                                            <div className={`animate-spin h-2.5 w-2.5 border-2 border-t-transparent rounded-full ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.border.replace('border-', 'border-') : 'border-[#0071e3]'}`} />
                                                        ) : (
                                                            <span>✨</span>
                                                        )}
                                                        <span>Describe post content</span>
                                                    </button>
                                                </div>
                                                <textarea
                                                    value={imagePrompt}
                                                    onChange={e => setImagePrompt(e.target.value)}
                                                    placeholder="Describe the image you want to generate..."
                                                    rows={3}
                                                    className={inputClass}
                                                />
                                                {/* Reference Image Section */}
                                                <div className="mt-4 mb-2">
                                                    <label className={`${labelClass} block mb-2`}>Reference Image (Optional)</label>
                                                    <div className="grid grid-cols-4 gap-2 mb-3">
                                                        {(['none', 'upload', 'asset'] as const).map(src => (
                                                            <button
                                                                key={src}
                                                                onClick={() => setImageRefSource(src)}
                                                                className={`py-1.5 rounded-lg text-xs font-medium border transition-all ${imageRefSource === src
                                                                    ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.border} text-white` : 'bg-[#0071e3] border-[#0071e3] text-white'
                                                                    : isDarkMode ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                                    }`}
                                                            >
                                                                {src === 'none' ? 'None' : src === 'upload' ? '📤 Upload' : '📁 Asset'}
                                                            </button>
                                                        ))}
                                                        {userProfile?.photoURL && (
                                                            <button
                                                                onClick={() => setImageRefSource('profile')}
                                                                className={`py-1.5 rounded-lg text-xs font-medium border transition-all ${imageRefSource === 'profile'
                                                                    ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.border} text-white` : 'bg-[#0071e3] border-[#0071e3] text-white'
                                                                    : isDarkMode ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                                    }`}
                                                            >
                                                                👤 Profile
                                                            </button>
                                                        )}
                                                    </div>

                                                    {imageRefSource === 'profile' && userProfile?.photoURL && (
                                                        <div className="mb-3 flex items-center justify-center p-4 border border-dashed rounded-xl bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10">
                                                            <div className="flex flex-col items-center gap-2">
                                                                <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-200 shadow-md">
                                                                    <img src={userProfile.photoURL} alt="Profile" className="w-full h-full object-cover" />
                                                                </div>
                                                                <span className={`text-xs ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>Using profile picture as reference</span>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {imageRefSource === 'upload' && (
                                                        <input type="file" accept="image/*" onChange={handleImageRefFileUpload} className={`w-full text-sm ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`} />
                                                    )}

                                                    {imageRefSource === 'asset' && projectAssets.filter(isImageAsset).length > 0 && (
                                                        <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                                            {projectAssets.filter(isImageAsset).map((asset: any) => (
                                                                <button
                                                                    key={asset.id}
                                                                    onClick={() => handleImageRefAssetSelect(asset.url)}
                                                                    className={`aspect-square rounded-lg overflow-hidden border-2 flex-shrink-0 transition-all ${imageRefUrl === asset.url ? (activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.border : 'border-[#0071e3]') + ' scale-95' : 'border-transparent hover:border-white/20'}`}
                                                                >
                                                                    <img src={asset.url} alt="" className="w-full h-full object-cover" />
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {imageRefSource === 'asset' && projectAssets.filter(isImageAsset).length === 0 && (
                                                        <div className={`text-center py-4 text-xs ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`}>
                                                            No image assets found.
                                                        </div>
                                                    )}

                                                    {imageRefUrl && imageRefSource !== 'none' && (
                                                        <div className="mt-2">
                                                            <img src={imageRefUrl} alt="Reference" className="h-20 rounded-lg object-cover" />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="mb-4">
                                                <label className={`${labelClass} block mb-2`}>Aspect Ratio</label>
                                                <div className="grid grid-cols-4 gap-2">
                                                    {['1:1', '16:9', '9:16', '4:3'].map(ratio => (
                                                        <button
                                                            key={ratio}
                                                            onClick={() => setImageAspectRatio(ratio)}
                                                            className={`py-2 rounded-lg text-xs font-medium border transition-all ${imageAspectRatio === ratio
                                                                ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.border} text-white` : 'bg-[#0071e3] border-[#0071e3] text-white'
                                                                : isDarkMode ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                                }`}
                                                        >
                                                            {ratio}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <button
                                                onClick={handleGenerateImage}
                                                disabled={isGeneratingImage || (!imagePrompt.trim() && !textContent.trim())}
                                                className={`w-full py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${isDarkMode ? 'bg-purple-600 hover:bg-purple-500' : 'bg-purple-600 hover:bg-purple-700'
                                                    } text-white disabled:opacity-50`}
                                            >
                                                {isGeneratingImage ? (
                                                    <>
                                                        <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                                                        <span>Generating...</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span>✨</span>
                                                        <span>Generate Image</span>
                                                    </>
                                                )}
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            {/* Video Generation UI */}
                                            {/* Model Toggle */}
                                            <div className="mb-4">
                                                <label className={`${labelClass} block mb-2`}>AI Model</label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button
                                                        onClick={() => setVideoModel('veo')}
                                                        className={`py-2.5 px-4 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2 ${videoModel === 'veo'
                                                            ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.border} text-white` : 'bg-[#0071e3] border-[#0071e3] text-white'
                                                            : isDarkMode ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                            }`}
                                                    >
                                                        <span>🎬</span>
                                                        <span>Veo 3.1</span>
                                                    </button>
                                                    <button
                                                        onClick={() => setVideoModel('sora')}
                                                        className={`py-2.5 px-4 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2 ${videoModel === 'sora'
                                                            ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.border} text-white` : 'bg-[#0071e3] border-[#0071e3] text-white'
                                                            : isDarkMode ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                            }`}
                                                    >
                                                        <span>🎥</span>
                                                        <span>Sora 2</span>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Reference Image (First Frame) */}
                                            <div className="mb-4">
                                                <label className={`${labelClass} block mb-2`}>
                                                    {videoModel === 'veo' ? 'First Frame (Optional)' : 'Reference Image (Optional)'}
                                                </label>
                                                <div className="grid grid-cols-4 gap-2 mb-3">
                                                    {(['none', 'generate', 'upload', 'asset'] as const).map(src => (
                                                        <button
                                                            key={src}
                                                            onClick={() => setVideoRefSource(src)}
                                                            className={`py-1.5 rounded-lg text-xs font-medium border transition-all ${videoRefSource === src
                                                                ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.border} text-white` : 'bg-[#0071e3] border-[#0071e3] text-white'
                                                                : isDarkMode ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                                }`}
                                                        >
                                                            {src === 'none' ? 'None' : src === 'generate' ? '✨ Gen' : src === 'upload' ? '📤 Upload' : '📁 Asset'}
                                                        </button>
                                                    ))}
                                                    {userProfile?.photoURL && (
                                                        <button
                                                            onClick={() => setVideoRefSource('profile')}
                                                            className={`py-1.5 rounded-lg text-xs font-medium border transition-all ${videoRefSource === 'profile'
                                                                ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.border} text-white` : 'bg-[#0071e3] border-[#0071e3] text-white'
                                                                : isDarkMode ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                                }`}
                                                        >
                                                            👤 Profile
                                                        </button>
                                                    )}
                                                </div>

                                                {videoRefSource === 'profile' && userProfile?.photoURL && (
                                                    <div className="mb-3 flex items-center justify-center p-4 border border-dashed rounded-xl bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10">
                                                        <div className="flex flex-col items-center gap-2">
                                                            <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-200 shadow-md">
                                                                <img src={userProfile.photoURL} alt="Profile" className="w-full h-full object-cover" />
                                                            </div>
                                                            <span className={`text-xs ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>Using profile picture as reference</span>
                                                        </div>
                                                    </div>
                                                )}

                                                {videoRefSource === 'generate' && (
                                                    <div className="space-y-3">
                                                        <div className="space-y-1.5">
                                                            <div className="flex justify-between items-center">
                                                                <label className="text-xs font-medium text-white/50">Image Prompt</label>
                                                                <button
                                                                    onClick={handleCreateVideoRefPrompt}
                                                                    disabled={isGeneratingVideoRefPrompt || !textContent.trim()}
                                                                    className={`text-[10px] hover:underline flex items-center gap-1.5 ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.text : 'text-[#0071e3]'} ${isGeneratingVideoRefPrompt || !textContent.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                                >
                                                                    {isGeneratingVideoRefPrompt ? (
                                                                        <div className={`animate-spin h-2.5 w-2.5 border-2 border-t-transparent rounded-full ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.border : 'border-[#0071e3]'}`} />
                                                                    ) : (
                                                                        <span>✨</span>
                                                                    )}
                                                                    <span>Generate from content</span>
                                                                </button>
                                                            </div>
                                                            <textarea
                                                                value={videoRefPrompt}
                                                                onChange={e => setVideoRefPrompt(e.target.value)}
                                                                placeholder="Describe the starting frame..."
                                                                rows={2}
                                                                className={inputClass}
                                                            />
                                                        </div>
                                                        <button
                                                            onClick={handleGenerateVideoRefImage}
                                                            disabled={isGeneratingVideoRefImage || !videoRefPrompt.trim()}
                                                            className={`w-full py-2 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2 ${isDarkMode ? 'bg-purple-600/20 border-purple-500/30 text-purple-300' : 'bg-purple-50 border-purple-200 text-purple-700'} disabled:opacity-50`}
                                                        >
                                                            {isGeneratingVideoRefImage ? (
                                                                <><div className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" /><span>Generating...</span></>
                                                            ) : (
                                                                <><span>✨</span><span>Generate First Frame</span></>
                                                            )}
                                                        </button>
                                                    </div>
                                                )}

                                                {videoRefSource === 'upload' && (
                                                    <input type="file" accept="image/*" onChange={handleVideoRefFileUpload} className={`w-full text-sm ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`} />
                                                )}

                                                {videoRefSource === 'asset' && projectAssets.filter(isImageAsset).length > 0 && (
                                                    <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                                        {projectAssets.filter(isImageAsset).map((asset: any) => (
                                                            <button
                                                                key={asset.id}
                                                                onClick={() => handleVideoRefAssetSelect(asset.url)}
                                                                className={`aspect-square rounded-lg overflow-hidden border-2 flex-shrink-0 transition-all ${videoRefImageUrl === asset.url ? (activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.border : 'border-[#0071e3]') + ' scale-95' : 'border-transparent hover:border-white/20'}`}
                                                            >
                                                                <img src={asset.url} alt="" className="w-full h-full object-cover" />
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}

                                                {videoRefSource === 'asset' && projectAssets.filter(isImageAsset).length === 0 && (
                                                    <div className={`text-center py-4 text-xs ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`}>
                                                        No image assets found.
                                                    </div>
                                                )}

                                                {videoRefImageUrl && videoRefSource !== 'none' && (
                                                    <div className="mt-2">
                                                        <img src={videoRefImageUrl} alt="Reference" className="h-20 rounded-lg object-cover" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Last Frame (Veo Only) */}
                                            {videoModel === 'veo' && (
                                                <div className="mb-4">
                                                    <label className={`${labelClass} block mb-2`}>Last Frame (Optional)</label>
                                                    <div className="grid grid-cols-4 gap-2 mb-3">
                                                        {(['none', 'generate', 'upload', 'asset'] as const).map(src => (
                                                            <button
                                                                key={src}
                                                                onClick={() => setVideoLastFrameSource(src)}
                                                                className={`py-1.5 rounded-lg text-xs font-medium border transition-all ${videoLastFrameSource === src
                                                                    ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.border} text-white` : 'bg-[#0071e3] border-[#0071e3] text-white'
                                                                    : isDarkMode ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                                    }`}
                                                            >
                                                                {src === 'none' ? 'None' : src === 'generate' ? '✨ Gen' : src === 'upload' ? '📤 Upload' : '📁 Asset'}
                                                            </button>
                                                        ))}
                                                    </div>

                                                    {videoLastFrameSource === 'generate' && (
                                                        <div className="space-y-3">
                                                            <div className="space-y-1.5">
                                                                <div className="flex justify-between items-center">
                                                                    <label className="text-xs font-medium text-white/50">Image Prompt</label>
                                                                    <button
                                                                        onClick={handleCreateVideoLastFramePrompt}
                                                                        disabled={isGeneratingVideoLastFramePrompt || !textContent.trim()}
                                                                        className={`text-[10px] hover:underline flex items-center gap-1.5 ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.text : 'text-[#0071e3]'} ${isGeneratingVideoLastFramePrompt || !textContent.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                                    >
                                                                        {isGeneratingVideoLastFramePrompt ? (
                                                                            <div className={`animate-spin h-2.5 w-2.5 border-2 border-t-transparent rounded-full ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.border.replace('border-', 'border-') : 'border-[#0071e3]'}`} />
                                                                        ) : (
                                                                            <span>✨</span>
                                                                        )}
                                                                        <span>Generate from content</span>
                                                                    </button>
                                                                </div>
                                                                <textarea
                                                                    value={videoLastFramePrompt}
                                                                    onChange={e => setVideoLastFramePrompt(e.target.value)}
                                                                    placeholder="Describe the ending frame..."
                                                                    rows={2}
                                                                    className={inputClass}
                                                                />
                                                            </div>
                                                            <button
                                                                onClick={handleGenerateVideoLastFrameImage}
                                                                disabled={isGeneratingVideoLastFrameImage || !videoLastFramePrompt.trim()}
                                                                className={`w-full py-2 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2 ${isDarkMode ? 'bg-purple-600/20 border-purple-500/30 text-purple-300' : 'bg-purple-50 border-purple-200 text-purple-700'} disabled:opacity-50`}
                                                            >
                                                                {isGeneratingVideoLastFrameImage ? (
                                                                    <><div className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" /><span>Generating...</span></>
                                                                ) : (
                                                                    <><span>✨</span><span>Generate Last Frame</span></>
                                                                )}
                                                            </button>
                                                        </div>
                                                    )}

                                                    {videoLastFrameSource === 'upload' && (
                                                        <input type="file" accept="image/*" onChange={handleVideoLastFrameFileUpload} className={`w-full text-sm ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`} />
                                                    )}

                                                    {videoLastFrameSource === 'asset' && projectAssets.filter(isImageAsset).length > 0 && (
                                                        <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                                            {projectAssets.filter(isImageAsset).map((asset: any) => (
                                                                <button
                                                                    key={asset.id}
                                                                    onClick={() => handleVideoLastFrameAssetSelect(asset.url)}
                                                                    className={`aspect-square rounded-lg overflow-hidden border-2 flex-shrink-0 transition-all ${videoLastFrameUrl === asset.url ? (activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.border : 'border-[#0071e3]') + ' scale-95' : 'border-transparent hover:border-white/20'}`}
                                                                >
                                                                    <img src={asset.url} alt="" className="w-full h-full object-cover" />
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {videoLastFrameSource === 'asset' && projectAssets.filter(isImageAsset).length === 0 && (
                                                        <div className={`text-center py-4 text-xs ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`}>
                                                            No image assets found.
                                                        </div>
                                                    )}

                                                    {videoLastFrameUrl && videoLastFrameSource !== 'none' && (
                                                        <div className="mt-2">
                                                            <img src={videoLastFrameUrl} alt="Last Frame" className="h-20 rounded-lg object-cover" />
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Video Prompt */}
                                            <div className="mb-4">
                                                <div className="flex justify-between items-center mb-2">
                                                    <label className={labelClass}>Video Prompt</label>
                                                    <button
                                                        onClick={handleCreateVideoPrompt}
                                                        disabled={isGeneratingPrompt || !textContent.trim()}
                                                        className={`text-xs hover:underline flex items-center gap-1.5 ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.text : 'text-[#0071e3]'} ${isGeneratingPrompt || !textContent.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        {isGeneratingPrompt ? (
                                                            <div className={`animate-spin h-2.5 w-2.5 border-2 border-t-transparent rounded-full ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.border.replace('border-', 'border-') : 'border-[#0071e3]'}`} />
                                                        ) : (
                                                            <span>✨</span>
                                                        )}
                                                        <span>Describe post content</span>
                                                    </button>
                                                </div>
                                                <textarea
                                                    value={videoPrompt}
                                                    onChange={e => setVideoPrompt(e.target.value)}
                                                    placeholder="Describe the video you want to generate..."
                                                    rows={3}
                                                    className={inputClass}
                                                />
                                            </div>

                                            {/* Aspect Ratio & Duration */}
                                            <div className="grid grid-cols-2 gap-4 mb-4">
                                                <div>
                                                    <label className={`${labelClass} block mb-2`}>Aspect Ratio</label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {(['16:9', '9:16'] as const).map(ratio => (
                                                            <button
                                                                key={ratio}
                                                                onClick={() => setVideoAspectRatio(ratio)}
                                                                className={`py-2 rounded-lg text-xs font-medium border transition-all ${videoAspectRatio === ratio
                                                                    ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.border} text-white` : 'bg-[#0071e3] border-[#0071e3] text-white'
                                                                    : isDarkMode ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                                    }`}
                                                            >
                                                                {ratio}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className={`${labelClass} block mb-2`}>Duration</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        {(videoModel === 'veo' ? [4, 6, 8] : [4, 8, 12]).map(dur => (
                                                            <button
                                                                key={dur}
                                                                onClick={() => setVideoDuration(dur as any)}
                                                                className={`py-2 px-3 rounded-lg text-xs font-medium border transition-all ${videoDuration === dur
                                                                    ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.border} text-white` : 'bg-[#0071e3] border-[#0071e3] text-white'
                                                                    : isDarkMode ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                                    }`}
                                                            >
                                                                {dur}s
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Quality Toggle (Veo and Sora) */}
                                            {(videoModel === 'veo' || videoModel === 'sora') && (
                                                <div className="mb-4">
                                                    <label className={`${labelClass} block mb-2`}>Generation Mode</label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {(['speed', 'quality'] as const).map(mode => (
                                                            <button
                                                                key={mode}
                                                                onClick={() => setVideoQuality(mode)}
                                                                className={`py-2 rounded-lg text-xs font-medium border transition-all ${videoQuality === mode
                                                                    ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} ${currentTheme.border} text-white` : 'bg-[#0071e3] border-[#0071e3] text-white'
                                                                    : isDarkMode ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                                    }`}
                                                            >
                                                                {mode.charAt(0).toUpperCase() + mode.slice(1)}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}


                                            {/* Progress */}
                                            {isGeneratingVideo && (
                                                <div className="mb-4">
                                                    <div className={`text-xs mb-1 ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>{videoGenStatus}</div>
                                                    <div className={`h-2 rounded-full overflow-hidden ${isDarkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
                                                        <div className="h-full bg-purple-500 transition-all" style={{ width: `${videoGenProgress}%` }} />
                                                    </div>
                                                </div>
                                            )}

                                            {/* Generate Button */}
                                            <button
                                                onClick={handleGenerateVideo}
                                                disabled={isGeneratingVideo || !videoPrompt.trim()}
                                                className={`w-full py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${isDarkMode ? 'bg-purple-600 hover:bg-purple-500' : 'bg-purple-600 hover:bg-purple-700'
                                                    } text-white disabled:opacity-50`}
                                            >
                                                {isGeneratingVideo ? (
                                                    <>
                                                        <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                                                        <span>Generating Video...</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span>🎬</span>
                                                        <span>Generate Video</span>
                                                    </>
                                                )}
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Media Preview */}
                            {mediaPreviewUrl && (
                                <div className="mt-4">
                                    <div className="flex justify-between items-center mb-2">
                                        <label className={labelClass}>
                                            Preview
                                        </label>
                                        <button
                                            onClick={() => {
                                                const link = document.createElement('a');
                                                link.href = mediaPreviewUrl;
                                                link.download = postType === 'IMAGE' ? `generated-image-${Date.now()}.png` : `generated-video-${Date.now()}.mp4`;
                                                document.body.appendChild(link);
                                                link.click();
                                                document.body.removeChild(link);
                                            }}
                                            className={`text-xs hover:underline flex items-center gap-1.5 ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? currentTheme.text : 'text-[#0071e3]'}`}
                                        >
                                            <span>⬇️</span>
                                            <span>Download</span>
                                        </button>
                                    </div>
                                    <div className={`rounded-xl overflow-hidden border ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                                        {postType === 'IMAGE' ? (
                                            <img src={mediaPreviewUrl} alt="Preview" className="max-h-64 w-auto mx-auto" />
                                        ) : (
                                            <video src={mediaPreviewUrl} controls className="max-h-64 w-full" />
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Platform Selection */}
                    <div className="mb-6">
                        <label className={`${labelClass} block mb-3`}>Select Platforms</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {availablePlatforms.map(platform => {
                                const isSelected = selectedPlatforms.includes(platform.id);
                                const isConnected = isPlatformConnected(platform.id);

                                return (
                                    <button
                                        key={platform.id}
                                        onClick={() => togglePlatform(platform.id)}
                                        className={`p-4 rounded-xl border transition-all text-left ${isSelected
                                            ? activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.border} ${currentTheme.bgSecondary}` : 'border-[#0071e3] bg-[#0071e3]/10'
                                            : isDarkMode
                                                ? 'border-white/10 hover:border-white/30'
                                                : 'border-gray-200 hover:border-gray-400'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            {platform.logoUrl ? (
                                                <img src={platform.logoUrl} alt="" className="w-6 h-6 object-contain" />
                                            ) : (
                                                <span className="text-2xl">{platform.icon}</span>
                                            )}
                                            <div>
                                                <div className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                    {platform.name}
                                                </div>
                                                <div className={`text-xs ${isConnected ? 'text-green-500' : 'text-amber-500'}`}>
                                                    {isConnected ? '✓ Connected' : '○ Not connected'}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Continue Button */}
                    <div className="flex justify-end">
                        <button
                            onClick={handleContinue}
                            disabled={!canContinue}
                            className={`${btnPrimary} disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            Continue →
                        </button>
                    </div>
                </div>
            )
            }

            {/* Step 2: Platform Setup */}
            {
                currentStep === 2 && (
                    <div className={`${cardClass} p-6`}>
                        <h3 className={`text-lg font-bold mb-6 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            Setup Connections
                        </h3>

                        {selectedPlatforms
                            .map(pId => ({ id: pId, isConnected: isPlatformConnected(pId) }))
                            .sort((a, b) => (a.isConnected === b.isConnected ? 0 : a.isConnected ? -1 : 1))
                            .map(({ id: platformId, isConnected }) => {
                                const platform = PLATFORMS.find(p => p.id === platformId)!;
                                const profile = getPlatformProfile(platformId);

                                return (
                                    <div
                                        key={platformId}
                                        className={`mb-4 p-4 rounded-xl border transition-all ${isDarkMode ? 'border-white/10' : 'border-gray-200'} ${!isConnected ? (isDarkMode ? 'bg-amber-500/5 border-amber-500/20' : 'bg-amber-50 border-amber-200') : ''}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                {platform.logoUrl ? (
                                                    <img src={platform.logoUrl} alt="" className="w-6 h-6 object-contain" />
                                                ) : (
                                                    <span className="text-2xl">{platform.icon}</span>
                                                )}
                                                <div>
                                                    <div className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                        {platform.name}
                                                    </div>
                                                    {isConnected && profile ? (
                                                        <div className={`text-xs ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
                                                            {profile.name || profile.username || profile.creatorUsername || 'Connected'}
                                                        </div>
                                                    ) : !isConnected && (
                                                        <div className="text-xs text-amber-500 font-medium">
                                                            Action Required: Connect Account
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {!isConnected ? (
                                                <button
                                                    onClick={() => handleConnectPlatform(platformId)}
                                                    className={btnPrimary.replace('px-6 py-2.5', 'px-4 py-2')}
                                                >
                                                    Connect
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handleDisconnectPlatform(platformId)}
                                                    className={`text-xs px-4 py-2 rounded-full transition-colors font-medium ${isDarkMode
                                                        ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20'
                                                        : 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-100'
                                                        }`}
                                                >
                                                    Disconnect
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}

                        {/* All Connected Message */}
                        {selectedPlatforms.every(p => isPlatformConnected(p)) && selectedPlatforms.length > 0 && (
                            <div className="text-center py-6 mb-6">
                                <div className="text-3xl mb-2">✅</div>
                                <h4 className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                    All Platforms Ready
                                </h4>
                                <p className={`text-xs ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                                    All your accounts are connected and ready for publishing.
                                </p>
                            </div>
                        )}

                        {/* Navigation */}
                        <div className="flex justify-between">
                            <button onClick={handleBack} className={btnSecondary}>
                                ← Back
                            </button>
                            <button
                                onClick={handleContinue}
                                disabled={!selectedPlatforms.every(p => isPlatformConnected(p))}
                                className={`${btnPrimary} disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                Continue →
                            </button>
                        </div>
                    </div>
                )
            }

            {/* Step 3: Publish */}
            {
                currentStep === 3 && (
                    <div className={`${cardClass} p-6`}>
                        <h3 className={`text-lg font-bold mb-6 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            Review & Publish
                        </h3>

                        {/* Content Summary */}
                        <div className={`mb-6 p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
                            <div className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
                                Global Caption
                            </div>
                            <textarea
                                value={textContent}
                                onChange={e => {
                                    const newVal = e.target.value;
                                    const oldVal = textContent;
                                    setTextContent(newVal);
                                    // Sync platform-specific descriptions if they haven't been manually changed
                                    if (ytDescription === oldVal) setYtDescription(newVal);
                                    if (fbVideoDescription === oldVal) setFbVideoDescription(newVal);
                                    if (fbVideoTitle === oldVal.substring(0, 100)) setFbVideoTitle(newVal.substring(0, 100));
                                    if (fbText === oldVal) setFbText(newVal);
                                    if (liText === oldVal) setLiText(newVal);
                                    if (ttText === oldVal) setTtText(newVal);
                                    if (xText === oldVal) setXText(newVal);
                                    if (igCaption === oldVal) setIgCaption(newVal);
                                }}
                                placeholder="Enter global caption..."
                                rows={4}
                                className={inputClass}
                            />
                            {mediaPreviewUrl && (
                                <div className="mt-3">
                                    {postType === 'IMAGE' ? (
                                        <img src={mediaPreviewUrl} alt="" className="max-h-32 rounded-lg" />
                                    ) : (
                                        <video src={mediaPreviewUrl} className="max-h-32 rounded-lg" />
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Platform Configuration Options */}
                        <div className="mb-6 space-y-4">
                            <div className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                Platform Settings
                            </div>

                            {/* Instagram Options */}
                            {selectedPlatforms.includes('instagram') && (
                                <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                                    <div className="flex items-center gap-2 mb-3">
                                        {PLATFORMS.find(p => p.id === 'instagram')?.logoUrl ? (
                                            <img src={PLATFORMS.find(p => p.id === 'instagram')?.logoUrl} alt="" className="w-5 h-5 object-contain" />
                                        ) : (
                                            <span className="text-xl">📷</span>
                                        )}
                                        <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Instagram</span>
                                    </div>

                                    <div className="mb-3">
                                        <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Account</label>
                                        <select value={selectedIgId} onChange={e => setSelectedIgId(e.target.value)} className={inputClass}>
                                            {igAccounts.length === 0 && <option value="">No accounts found</option>}
                                            {igAccounts.map((acc: any) => (
                                                <option key={acc.igId} value={acc.igId}>{acc.igUsername || acc.igId}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className={`text-sm block mb-2 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Post Type</label>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setIgMediaType('FEED')}
                                                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${igMediaType === 'FEED' ? (activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} text-white` : 'bg-[#0071e3] text-white') : isDarkMode ? 'bg-white/10 text-white/70' : 'bg-gray-200 text-gray-600'}`}
                                            >
                                                Feed
                                            </button>
                                            {postType === 'VIDEO' && (
                                                <>
                                                    <button
                                                        onClick={() => setIgMediaType('STORY')}
                                                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${igMediaType === 'STORY' ? (activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} text-white` : 'bg-[#0071e3] text-white') : isDarkMode ? 'bg-white/10 text-white/70' : 'bg-gray-200 text-gray-600'}`}
                                                    >
                                                        Story
                                                    </button>
                                                    <button
                                                        onClick={() => setIgMediaType('REEL')}
                                                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${igMediaType === 'REEL' ? (activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.primary} text-white` : 'bg-[#0071e3] text-white') : isDarkMode ? 'bg-white/10 text-white/70' : 'bg-gray-200 text-gray-600'}`}
                                                    >
                                                        Reel
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mt-3">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={igShareToFeed}
                                                onChange={e => setIgShareToFeed(e.target.checked)}
                                                className={`rounded border-gray-300 focus:ring-2 ${activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light' ? `${currentTheme.text} ${currentTheme.ring}` : 'text-[#0071e3] focus:ring-[#0071e3]'}`}
                                            />
                                            <span className={`text-sm ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Share to Feed</span>
                                        </label>
                                    </div>

                                    <div className="mt-3">
                                        <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Instagram Caption Override</label>
                                        <textarea
                                            value={igCaption}
                                            onChange={e => setIgCaption(e.target.value)}
                                            placeholder="Enter Instagram caption (prefilled from global)"
                                            rows={3}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Facebook Options */}
                            {selectedPlatforms.includes('facebook') && (
                                <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                                    <div className="flex items-center gap-2 mb-3">
                                        {PLATFORMS.find(p => p.id === 'facebook')?.logoUrl ? (
                                            <img src={PLATFORMS.find(p => p.id === 'facebook')?.logoUrl} alt="" className="w-5 h-5 object-contain" />
                                        ) : (
                                            <span className="text-xl">📘</span>
                                        )}
                                        <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Facebook</span>
                                    </div>

                                    <div className="mb-3">
                                        <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Post to Page</label>
                                        {fbPagesLoading ? (
                                            <div className={`text-sm ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>Loading pages...</div>
                                        ) : (
                                            <select value={fbPageId} onChange={e => setFbPageId(e.target.value)} className={inputClass}>
                                                {fbPages.length === 0 && <option value="">No pages found</option>}
                                                {fbPages.map((page: any) => (
                                                    <option key={page.id} value={page.id}>{page.name}</option>
                                                ))}
                                            </select>
                                        )}
                                    </div>

                                    {postType === 'VIDEO' && (
                                        <div className="mb-3">
                                            <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Video Title</label>
                                            <input
                                                value={fbVideoTitle}
                                                onChange={e => setFbVideoTitle(e.target.value)}
                                                placeholder="Enter video title"
                                                className={inputClass}
                                            />
                                        </div>
                                    )}

                                    <div>
                                        <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
                                            {postType === 'VIDEO' ? 'Video Description Override' : 'Post Message Override'}
                                        </label>
                                        <textarea
                                            value={postType === 'VIDEO' ? fbVideoDescription : fbText}
                                            onChange={e => postType === 'VIDEO' ? setFbVideoDescription(e.target.value) : setFbText(e.target.value)}
                                            placeholder="Enter Facebook content (prefilled from global)"
                                            rows={3}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* YouTube Options */}
                            {selectedPlatforms.includes('youtube') && (
                                <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                                    <div className="flex items-center gap-2 mb-3">
                                        {PLATFORMS.find(p => p.id === 'youtube')?.logoUrl ? (
                                            <img src={PLATFORMS.find(p => p.id === 'youtube')?.logoUrl} alt="" className="w-5 h-5 object-contain" />
                                        ) : (
                                            <span className="text-xl">▶️</span>
                                        )}
                                        <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>YouTube</span>
                                    </div>

                                    <div className="mb-3">
                                        <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Video Title</label>
                                        <input value={ytTitle} onChange={e => setYtTitle(e.target.value)} placeholder="Enter video title" className={inputClass} />
                                    </div>

                                    <div className="mb-3">
                                        <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Description Override</label>
                                        <textarea
                                            value={ytDescription}
                                            onChange={e => setYtDescription(e.target.value)}
                                            placeholder="Video description (prefilled with your caption)"
                                            rows={3}
                                            className={inputClass}
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Category</label>
                                            <select value={ytCategory} onChange={e => setYtCategory(e.target.value)} className={inputClass}>
                                                <option value="1">Film & Animation</option>
                                                <option value="2">Autos & Vehicles</option>
                                                <option value="10">Music</option>
                                                <option value="15">Pets & Animals</option>
                                                <option value="17">Sports</option>
                                                <option value="19">Travel & Events</option>
                                                <option value="20">Gaming</option>
                                                <option value="22">People & Blogs</option>
                                                <option value="23">Comedy</option>
                                                <option value="24">Entertainment</option>
                                                <option value="25">News & Politics</option>
                                                <option value="26">Howto & Style</option>
                                                <option value="27">Education</option>
                                                <option value="28">Science & Technology</option>
                                                <option value="29">Nonprofits & Activism</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Privacy</label>
                                            <select value={ytPrivacy} onChange={e => setYtPrivacy(e.target.value as any)} className={inputClass}>
                                                <option value="private">Private</option>
                                                <option value="unlisted">Unlisted</option>
                                                <option value="public">Public</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* LinkedIn Options */}
                            {selectedPlatforms.includes('linkedin') && (
                                <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                                    <div className="flex items-center gap-2 mb-3">
                                        {PLATFORMS.find(p => p.id === 'linkedin')?.logoUrl ? (
                                            <img src={PLATFORMS.find(p => p.id === 'linkedin')?.logoUrl} alt="" className="w-5 h-5 object-contain" />
                                        ) : (
                                            <span className="text-xl">🔗</span>
                                        )}
                                        <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>LinkedIn</span>
                                    </div>

                                    <div className="mb-3">
                                        <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Visibility</label>
                                        <select value={liVisibility} onChange={e => setLiVisibility(e.target.value as any)} className={inputClass}>
                                            <option value="PUBLIC">Public</option>
                                            <option value="CONNECTIONS">Connections Only</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Post Text Override</label>
                                        <textarea
                                            value={liText}
                                            onChange={e => setLiText(e.target.value)}
                                            placeholder="Enter LinkedIn post text (prefilled from global)"
                                            rows={3}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* TikTok Options */}
                            {selectedPlatforms.includes('tiktok') && (
                                <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                                    <div className="flex items-center gap-2 mb-3">
                                        {PLATFORMS.find(p => p.id === 'tiktok')?.logoUrl ? (
                                            <img src={PLATFORMS.find(p => p.id === 'tiktok')?.logoUrl} alt="" className="w-5 h-5 object-contain" />
                                        ) : (
                                            <span className="text-xl">🎵</span>
                                        )}
                                        <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>TikTok</span>
                                    </div>

                                    <div className="mb-3">
                                        <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Privacy</label>
                                        <select value={ttPrivacy} onChange={e => setTtPrivacy(e.target.value)} className={inputClass}>
                                            <option value="PUBLIC_TO_EVERYONE">Public</option>
                                            <option value="MUTUAL_FOLLOW_FRIENDS">Friends Only</option>
                                            <option value="SELF_ONLY">Private (Self Only)</option>
                                        </select>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 mb-3">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={!ttDisableComment} onChange={e => setTtDisableComment(!e.target.checked)} />
                                            <span className="text-xs">Comments</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={!ttDisableDuet} onChange={e => setTtDisableDuet(!e.target.checked)} />
                                            <span className="text-xs">Duet</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={!ttDisableStitch} onChange={e => setTtDisableStitch(!e.target.checked)} />
                                            <span className="text-xs">Stitch</span>
                                        </label>
                                    </div>

                                    <div>
                                        <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Title / Caption Override</label>
                                        <textarea
                                            value={ttText}
                                            onChange={e => setTtText(e.target.value)}
                                            placeholder="Enter TikTok title (prefilled from global)"
                                            rows={2}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* X (Twitter) Options */}
                            {selectedPlatforms.includes('x') && (
                                <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                                    <div className="flex items-center gap-2 mb-3">
                                        {PLATFORMS.find(p => p.id === 'x')?.logoUrl ? (
                                            <img src={PLATFORMS.find(p => p.id === 'x')?.logoUrl} alt="" className="w-5 h-5 object-contain" />
                                        ) : (
                                            <span className="text-xl">🐦</span>
                                        )}
                                        <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>X (Twitter)</span>
                                    </div>
                                    <div>
                                        <label className={`text-sm block mb-1 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Tweet Text Override</label>
                                        <textarea
                                            value={xText}
                                            onChange={e => setXText(e.target.value)}
                                            placeholder="Enter tweet text (prefilled from global)"
                                            rows={3}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Platform Status */}
                        <div className="mb-6">
                            <div className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                Publishing to:
                            </div>
                            <div className="space-y-2">
                                {selectedPlatforms.map(platformId => {
                                    const platform = PLATFORMS.find(p => p.id === platformId)!;
                                    const result = publishResults.find(r => r.platform === platformId);
                                    const isPublishingPlatform = currentPublishingPlatform === platformId;

                                    return (
                                        <div key={platformId} className={`flex items-center justify-between p-3 rounded-lg ${isDarkMode ? 'bg-white/5' : 'bg-gray-100'}`}>
                                            <div className="flex items-center gap-3">
                                                {platform.logoUrl ? (
                                                    <img src={platform.logoUrl} alt="" className="w-5 h-5 object-contain" />
                                                ) : (
                                                    <span className="text-xl">{platform.icon}</span>
                                                )}
                                                <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{platform.name}</span>
                                            </div>
                                            <div className="text-sm">
                                                {isPublishingPlatform && <span className="text-blue-500">Publishing...</span>}
                                                {result?.success && <span className="text-green-500">✓ Published</span>}
                                                {result && !result.success && <span className="text-red-500">✗ {result.error}</span>}
                                                {!isPublishingPlatform && !result && <span className={isDarkMode ? 'text-white/40' : 'text-gray-400'}>Pending</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Navigation */}
                        <div className="flex justify-between">
                            <button onClick={handleBack} disabled={isPublishing || isScheduling} className={`${btnSecondary} disabled:opacity-50`}>
                                ← Back
                            </button>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => {
                                        setScheduleResult(null); // Clear previous result
                                        setShowSchedulePicker(true);
                                    }}
                                    disabled={isPublishing || isScheduling || publishResults.length > 0}
                                    className={`${btnSecondary} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    📅 Schedule
                                </button>
                                <button
                                    onClick={handlePublish}
                                    disabled={isPublishing || isScheduling || publishResults.length > 0}
                                    className={`${btnPrimary} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    {isPublishing ? 'Publishing...' : publishResults.length > 0 ? 'Published!' : '🚀 Publish Now'}
                                </button>
                            </div>
                        </div>

                        {/* Schedule Result */}
                        {scheduleResult && (
                            <div className={`mt-4 p-4 rounded-lg ${scheduleResult.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                {scheduleResult.message}
                            </div>
                        )}

                        {/* Schedule Picker Modal */}
                        {showSchedulePicker && (
                            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSchedulePicker(false)}>
                                <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl`} onClick={e => e.stopPropagation()}>
                                    <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>📅 Schedule Post</h3>

                                    <div className="space-y-4">
                                        <div>
                                            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Date</label>
                                            <input
                                                type="date"
                                                value={scheduledDate}
                                                onChange={e => setScheduledDate(e.target.value)}
                                                min={new Date(Date.now() + 10 * 60 * 1000).toISOString().split('T')[0]}
                                                max={new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                                                className={`w-full px-4 py-3 rounded-lg border ${isDarkMode ? 'bg-white/10 border-white/20 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                                            />
                                        </div>
                                        <div>
                                            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>Time</label>
                                            <input
                                                type="time"
                                                value={scheduledTime}
                                                onChange={e => setScheduledTime(e.target.value)}
                                                className={`w-full px-4 py-3 rounded-lg border ${isDarkMode ? 'bg-white/10 border-white/20 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                                            />
                                        </div>
                                        <p className={`text-sm ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                                            ⏰ Your local timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                                        </p>
                                        <p className={`text-sm ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                                            📌 Schedule between 10 minutes and 7 days from now
                                        </p>
                                    </div>

                                    <div className="flex justify-end gap-3 mt-6">
                                        <button
                                            onClick={() => setShowSchedulePicker(false)}
                                            className={btnSecondary}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSchedule}
                                            disabled={!scheduledDate || !scheduledTime || isScheduling}
                                            className={`${btnPrimary} disabled:opacity-50`}
                                        >
                                            {isScheduling ? 'Scheduling...' : '📅 Confirm Schedule'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )
            }
        </div >
    );
};


