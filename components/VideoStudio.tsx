import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ResearchProject } from '../types';
import { generateVeoVideo, ensureVeoKey, analyzeEditIntent, generateFirstFrameImage, EditRoutingDecision, generateImage, getPexelsImage, refinePromptWithGemini3, editImageWithGeminiNano, editImageWithReferences, generateVideoTitleFromContext } from '../services/geminiService';
import { xaiService } from '../services/xaiService';
import { lumaService } from '../services/lumaService';
import { sunoService, SunoSong } from '../services/sunoService';
import klingService from '../services/klingService';
import { storageService } from '../services/storageService';
import { contextService } from '../services/contextService';
import { createVideoOverview, listVideoOverviewJobs, getVideoOverviewStatus, resumeVideoOverviewPolling, stitchVideos, createSocialReel } from '../services/creatomateService';
import { geminiAudioService } from '../services/geminiAudioService';
import { deductCredits, checkCreditsWithModal, hasEnoughCredits, CreditOperation } from '../services/creditService';
import { useSubscription } from '../hooks/useSubscription';
import { PASTEL_THEMES, ThemeType } from '../constants';

interface VideoStudioProps {
    project: ResearchProject;
    onProjectUpdate?: (project: ResearchProject) => void;
    isDarkMode: boolean;
    activeTheme?: ThemeType;
    isSubscribed?: boolean;
    onShare?: (asset: any) => void;
}

const THEME_COLORS: Record<string, string> = {
    orange: '#ea580c', // orange-600
    green: '#059669',  // emerald-600
    blue: '#0284c7',   // sky-600
    purple: '#7c3aed', // violet-600
    khaki: '#d97706',  // amber-600
    pink: '#db2777',   // pink-600
};

type StudioTool = 'product_ad' | 'animate_image' | 'in_my_head' | 'music_video' | 'overview';

interface ToolState {
    loading: boolean;
    status: string;
    error: string | null;
    videoUrl: string | null;
    videoBlob: Blob | null;
    generatedAsset?: any;
    isSharing?: boolean;
}

const initialToolState: ToolState = {
    loading: false,
    status: '',
    error: null,
    videoUrl: null,
    videoBlob: null,
    generatedAsset: null,
};

const TOOL_CARDS: { id: StudioTool; title: string; subtitle: string; emoji: string; gradient: string; accent: string; iconPath: string }[] = [
    {
        id: 'product_ad',
        title: 'Product Ad',
        subtitle: 'Upload product + references → cinematic ad video',
        emoji: '🎬',
        gradient: 'from-violet-600/20 to-fuchsia-600/20',
        accent: '#a855f7',
        iconPath: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
    },
    {
        id: 'animate_image',
        title: 'Animate Image',
        subtitle: 'Bring any image to life with motion',
        emoji: '✨',
        gradient: 'from-cyan-600/20 to-blue-600/20',
        accent: '#06b6d4',
        iconPath: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
    },
    {
        id: 'in_my_head',
        title: 'Real vs. AI',
        subtitle: 'Alter any video with a text prompt',
        emoji: '🧠',
        gradient: 'from-orange-600/20 to-rose-600/20',
        accent: '#f97316',
        iconPath: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
    },
    {
        id: 'music_video',
        title: 'Music Video',
        subtitle: 'Generate songs with AI or upload audio',
        emoji: '🎵',
        gradient: 'from-emerald-600/20 to-teal-600/20',
        accent: '#10b981',
        iconPath: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3',
    },
    {
        id: 'overview',
        title: 'Video Overview',
        subtitle: 'Project context → cinematic overview with AI voice',
        emoji: '🌍',
        gradient: 'from-amber-600/20 to-orange-600/20',
        accent: '#f59e0b',
        iconPath: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
];

// Helper to convert File to base64 data string
const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

export const VideoStudio: React.FC<VideoStudioProps> = ({
    project,
    onProjectUpdate,
    isDarkMode,
    activeTheme,
    isSubscribed,
    onShare,
}) => {
    const { subscription, openUpgradeModal } = useSubscription();

    const isToolLocked = (toolId: string) => {
        return false;
    };

    const normalizedTheme = activeTheme?.toLowerCase().trim();

    // Explicit map to guarantee colors regardless of external constants
    const THEME_HEX_MAP: Record<string, string> = {
        'orange': '#ea580c',
        'green': '#059669',
        'blue': '#0284c7',
        'purple': '#7c3aed',
        'khaki': '#d97706',
        'pink': '#db2777'
    };

    const themeHex = normalizedTheme ? THEME_HEX_MAP[normalizedTheme] : undefined;

    const currentTheme = normalizedTheme && normalizedTheme !== 'dark' && normalizedTheme !== 'light'
        ? PASTEL_THEMES[normalizedTheme as ThemeType]
        : null;

    // NUCLEAR OPTION: Inject a style tag to force the background color with !important
    const forcedThemeClass = `theme-forced-${normalizedTheme}`;
    const forcedStyleTag = themeHex ? (
        <style dangerouslySetInnerHTML={{
            __html: `
            .${forcedThemeClass} {
                background-color: ${themeHex} !important;
                color: white !important;
            }
            .${forcedThemeClass}:hover {
                opacity: 0.9 !important;
            }
        `}} />
    ) : null;

    const [expandedTool, setExpandedTool] = useState<StudioTool | null>(null);
    const [selectedTool, setSelectedTool] = useState<StudioTool>('product_ad');

    // ────── Product Ad state ──────
    const [adProductImage, setAdProductImage] = useState<File | null>(null);
    const [adProductPreview, setAdProductPreview] = useState<string | null>(null);
    const [isEditingAdProduct, setIsEditingAdProduct] = useState(false);
    const [adProductEditPrompt, setAdProductEditPrompt] = useState('');
    const [isGeneratingAdProductEdit, setIsGeneratingAdProductEdit] = useState(false);
    const [adRefImages, setAdRefImages] = useState<File[]>([]);
    const [adRefPreviews, setAdRefPreviews] = useState<string[]>([]);
    const [adPrompt, setAdPrompt] = useState('');
    const [adAspect, setAdAspect] = useState<'16:9' | '9:16'>('16:9');
    const [adState, setAdState] = useState<ToolState>(initialToolState);
    const adFileRef = useRef<HTMLInputElement>(null);
    const adRefFileRef = useRef<HTMLInputElement>(null);

    // ────── Animate Image state ──────
    const [animImage, setAnimImage] = useState<File | null>(null);
    const [animPreview, setAnimPreview] = useState<string | null>(null);
    const [animPrompt, setAnimPrompt] = useState('');
    const [animAspect, setAnimAspect] = useState<'16:9' | '9:16'>('16:9');
    const [animState, setAnimState] = useState<ToolState>(initialToolState);
    const animFileRef = useRef<HTMLInputElement>(null);

    // ────── In My Head state ──────
    const [editVideoUrl, setEditVideoUrl] = useState('');
    const [editVideoFile, setEditVideoFile] = useState<File | null>(null);
    const [editVideoPreview, setEditVideoPreview] = useState<string | null>(null);
    const [editPrompt, setEditPrompt] = useState('');
    const [editFirstFrameFile, setEditFirstFrameFile] = useState<File | null>(null);
    const [editFirstFramePreview, setEditFirstFramePreview] = useState<string | null>(null);
    const [editState, setEditState] = useState<ToolState>(initialToolState);
    const [editRouting, setEditRouting] = useState<EditRoutingDecision | null>(null);
    const editVideoFileRef = useRef<HTMLInputElement>(null);
    const editFirstFrameRef = useRef<HTMLInputElement>(null);

    // First frame extraction & editing state
    const [isExtractingFrame, setIsExtractingFrame] = useState(false);
    const [isEditingFrame, setIsEditingFrame] = useState(false);
    const [frameEditPrompt, setFrameEditPrompt] = useState('');
    const [isGeneratingFrameEdit, setIsGeneratingFrameEdit] = useState(false);

    // ────── Asset Picker State ──────
    const [assetPickerTarget, setAssetPickerTarget] = useState<'in_my_head' | 'in_my_head_video' | 'animate_image' | 'product_ad' | 'product_ad_ref' | null>(null);
    const [assetSearch, setAssetSearch] = useState('');

    // ────── Overview state ──────
    const [overviewPrompt, setOverviewPrompt] = useState('');
    const [overviewSlides, setOverviewSlides] = useState(8);
    const [overviewAspect, setOverviewAspect] = useState<'16:9' | '9:16'>('16:9');
    const [overviewState, setOverviewState] = useState<ToolState>(initialToolState);
    const [overviewProgress, setOverviewProgress] = useState<number | null>(null);
    const overviewProgressInterval = useRef<any>(null);
    const [activeVideoOverviewJob, setActiveVideoOverviewJob] = useState<any | null>(null);
    const [overviewAvatarFile, setOverviewAvatarFile] = useState<File | null>(null);
    const [overviewAvatarPreview, setOverviewAvatarPreview] = useState<string | null>(null);
    const overviewAvatarRef = useRef<HTMLInputElement>(null);

    // Voice Cloning state
    const [overviewUseClonedVoice, setOverviewUseClonedVoice] = useState(false);
    const [overviewVoiceFile, setOverviewVoiceFile] = useState<File | null>(null);
    const [overviewClonedVoiceId, setOverviewClonedVoiceId] = useState<string | null>(null);
    const [overviewIsCloningVoice, setOverviewIsCloningVoice] = useState(false);
    const [overviewIsPreviewingVoice, setOverviewIsPreviewingVoice] = useState(false);
    const [overviewVoicePreviewUrl, setOverviewVoicePreviewUrl] = useState<string | null>(null);
    const overviewVoiceRef = useRef<HTMLInputElement>(null);

    const handleAssetSelect = async (assetUrl: string, assetName: string) => {
        try {
            // Set loading state based on target
            if (assetPickerTarget === 'in_my_head') setEditState(s => ({ ...s, loading: true, status: 'Loading asset...' }));
            else if (assetPickerTarget === 'in_my_head_video') setEditState(s => ({ ...s, loading: true, status: 'Loading asset...' }));
            else if (assetPickerTarget === 'animate_image') setAnimState(s => ({ ...s, loading: true, status: 'Loading asset...' }));
            else if (assetPickerTarget === 'product_ad' || assetPickerTarget === 'product_ad_ref') setAdState(s => ({ ...s, loading: true, status: 'Loading asset...' }));

            // Special handling for video assets: Don't download as blob, just use URL
            if (assetPickerTarget === 'in_my_head_video') {
                setEditVideoUrl(assetUrl);
                setEditVideoFile(null);
                if (editVideoPreview) URL.revokeObjectURL(editVideoPreview);
                setEditVideoPreview(assetUrl); // Use URL directly for preview

                // Auto-extract first frame
                // Note: CORS issues might prevent canvas extraction from remote URL
                // We'll try, but handle failure gracefully
                handleExtractFirstFrame(assetUrl);

                setEditState(s => ({ ...s, loading: false, status: '' }));
                setAssetPickerTarget(null);
                return;
            }

            const response = await fetch(assetUrl);
            const blob = await response.blob();
            const file = new File([blob], assetName, { type: blob.type });

            if (assetPickerTarget === 'in_my_head') {
                setEditFirstFrameFile(file);
                if (editFirstFramePreview) URL.revokeObjectURL(editFirstFramePreview);
                setEditFirstFramePreview(URL.createObjectURL(file));
                setEditState(s => ({ ...s, loading: false, status: '' }));
            } else if (assetPickerTarget === 'animate_image') {
                setAnimImage(file);
                if (animPreview) URL.revokeObjectURL(animPreview);
                setAnimPreview(URL.createObjectURL(file));
                setAnimState(s => ({ ...s, loading: false, status: '' }));
            } else if (assetPickerTarget === 'product_ad') {
                setAdProductImage(file);
                if (adProductPreview) URL.revokeObjectURL(adProductPreview);
                setAdProductPreview(URL.createObjectURL(file));
                setAdState(s => ({ ...s, loading: false, status: '' }));
            } else if (assetPickerTarget === 'product_ad_ref') {
                const newRefFiles = [...adRefImages, file].slice(0, 2);
                setAdRefImages(newRefFiles);
                adRefPreviews.forEach(u => URL.revokeObjectURL(u));
                setAdRefPreviews(newRefFiles.map(f => URL.createObjectURL(f)));
                setAdState(s => ({ ...s, loading: false, status: '' }));
            }

            setAssetPickerTarget(null);
        } catch (e) {
            console.error("Failed to load asset", e);
            const errorMsg = 'Failed to load selected asset';
            if (assetPickerTarget === 'in_my_head') setEditState(s => ({ ...s, loading: false, status: '', error: errorMsg }));
            else if (assetPickerTarget === 'in_my_head_video') setEditState(s => ({ ...s, loading: false, status: '', error: errorMsg }));
            else if (assetPickerTarget === 'animate_image') setAnimState(s => ({ ...s, loading: false, status: '', error: errorMsg }));
            else if (assetPickerTarget === 'product_ad' || assetPickerTarget === 'product_ad_ref') setAdState(s => ({ ...s, loading: false, status: '', error: errorMsg }));
        }
    };


    // ────── Music Video state ──────
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [audioName, setAudioName] = useState('');
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animFrameRef = useRef<number>(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // ────── Suno AI state ──────
    const [sunoMode, setSunoMode] = useState<'upload' | 'generate'>('generate');
    const [sunoPrompt, setSunoPrompt] = useState('');
    const [sunoStyle, setSunoStyle] = useState('');
    const [sunoTitle, setSunoTitle] = useState('');
    const [sunoInstrumental, setSunoInstrumental] = useState(false);
    const [sunoLyrics, setSunoLyrics] = useState('');
    const [sunoState, setSunoState] = useState<ToolState>(initialToolState);
    const [sunoGeneratedSongs, setSunoGeneratedSongs] = useState<SunoSong[]>([]);
    const [sunoLyricsLoading, setSunoLyricsLoading] = useState(false);
    const sunoAudioRef = useRef<HTMLAudioElement | null>(null);
    const [sunoPlayingId, setSunoPlayingId] = useState<string | null>(null);
    const [sunoCurrentTime, setSunoCurrentTime] = useState(0);

    // ────── Music Video Generation (Kling) state ──────
    const [mvRefImages, setMvRefImages] = useState<File[]>([]);
    const [mvRefPreviews, setMvRefPreviews] = useState<string[]>([]);
    const [mvUploadPrompt, setMvUploadPrompt] = useState('');
    const [mvState, setMvState] = useState<ToolState & { songId: string | null }>({
        loading: false, status: '', error: null, videoUrl: null, videoBlob: null, songId: null,
    });

    // Cleanup blob URLs on unmount
    useEffect(() => {
        return () => {
            if (adProductPreview) URL.revokeObjectURL(adProductPreview);
            adRefPreviews.forEach(u => URL.revokeObjectURL(u));
            if (animPreview) URL.revokeObjectURL(animPreview);
            if (editVideoPreview) URL.revokeObjectURL(editVideoPreview);
            if (audioUrl) URL.revokeObjectURL(audioUrl);
            if (adState.videoUrl) URL.revokeObjectURL(adState.videoUrl);
            if (animState.videoUrl) URL.revokeObjectURL(animState.videoUrl);
            if (editState.videoUrl) URL.revokeObjectURL(editState.videoUrl);
        };
    }, []);

    // ─────────────────────────────────────────────
    //  PRODUCT AD handler
    // ─────────────────────────────────────────────
    const handleProductAdGenerate = async () => {
        if (!adProductImage) return;
        const operation: CreditOperation = 'productAdGeneration';
        const hasCredits = await hasEnoughCredits(operation);
        if (!hasCredits) {
            setAdState({ ...initialToolState, error: 'Insufficient credits for Product Ad generation.' });
            return;
        }

        const success = await deductCredits(operation);
        if (!success) {
            setAdState({ ...initialToolState, error: 'Failed to deduct credits' });
            return;
        }

        setAdState({ ...initialToolState, loading: true, status: 'Preparing images...' });
        try {
            await ensureVeoKey().catch(() => { });

            const productBase64 = await fileToBase64(adProductImage);
            const referenceImages: { base64: string; mimeType: string }[] = [
                { base64: productBase64, mimeType: adProductImage.type },
            ];

            for (const ref of adRefImages.slice(0, 2)) {
                const b64 = await fileToBase64(ref);
                referenceImages.push({ base64: b64, mimeType: ref.type });
            }

            const prompt = adPrompt.trim() || `Cinematic product advertisement video showcasing the product in elegant lighting with smooth camera movements.`;

            setAdState(s => ({ ...s, status: 'Generating video with Veo 3.1 (1-2 min)...' }));

            // For Product Ad: Use all images as STYLE/CHARACTER references to guide generation
            // We do NOT use 'image' (starting frame) because we want the model to generate the video from scratch
            // based on the product appearance, not just animate the static image.
            const blob = await generateVeoVideo(prompt, adAspect, 'quality', {
                referenceImages: referenceImages.map(img => ({ ...img, referenceType: 'asset' as const }))
            });

            const url = URL.createObjectURL(blob);
            setAdState({ loading: false, status: 'Complete!', error: null, videoUrl: url, videoBlob: blob });
        } catch (err: any) {
            setAdState({ loading: false, status: '', error: err?.message || 'Video generation failed', videoUrl: null, videoBlob: null });
        }
    };

    // ─────────────────────────────────────────────
    //  ANIMATE IMAGE handler
    // ─────────────────────────────────────────────
    const handleAnimateGenerate = async () => {
        if (!animImage) return;
        const operation: CreditOperation = 'animateImageGeneration';
        const hasCredits = await hasEnoughCredits(operation);
        if (!hasCredits) {
            setAnimState({ ...initialToolState, error: 'Insufficient credits for Animate Image.' });
            return;
        }

        const success = await deductCredits(operation);
        if (!success) {
            setAnimState({ ...initialToolState, error: 'Failed to deduct credits' });
            return;
        }

        setAnimState({ ...initialToolState, loading: true, status: 'Uploading image...' });
        try {
            await ensureVeoKey().catch(() => { });

            const base64 = await fileToBase64(animImage);

            // For Animate Image: Use source image as STARTING FRAME (Image-to-Video)
            const prompt = animPrompt.trim() || 'Smoothly animate this image with natural, cinematic motion.';

            setAnimState(s => ({ ...s, status: 'Veo is dreaming (1-2 min)...' }));
            const blob = await generateVeoVideo(prompt, animAspect, 'quality', {
                image: { base64, mimeType: animImage.type }
            });
            const url = URL.createObjectURL(blob);
            setAnimState({ loading: false, status: 'Complete!', error: null, videoUrl: url, videoBlob: blob });
        } catch (err: any) {
            setAnimState({ loading: false, status: '', error: err?.message || 'Animation failed', videoUrl: null, videoBlob: null });
        }
    };

    // ─────────────────────────────────────────────
    //  IN MY HEAD handler (AI-routed xAI / Luma)
    // ─────────────────────────────────────────────
    const handleEditGenerate = async () => {
        const videoSource = editVideoUrl.trim() || (editVideoFile ? URL.createObjectURL(editVideoFile) : '');
        if (!videoSource) return;
        if (!editPrompt.trim()) return;

        const operation: CreditOperation = 'realVsAiGeneration';
        const hasCredits = await hasEnoughCredits(operation);
        if (!hasCredits) {
            setEditState({ ...initialToolState, error: 'Insufficient credits for Real vs AI feature.' });
            return;
        }

        const success = await deductCredits(operation);
        if (!success) {
            setEditState({ ...initialToolState, error: 'Failed to deduct credits' });
            return;
        }

        setEditState({ ...initialToolState, loading: true, status: 'Preparing...' });
        setEditRouting(null);

        try {
            // 1. Upload video to blob storage if it's a local file
            let publicVideoUrl = editVideoUrl.trim();
            if (editVideoFile && !publicVideoUrl) {
                setEditState(s => ({ ...s, status: 'Uploading video...' }));
                const kbFile = await storageService.uploadKnowledgeBaseFile(
                    project.id,
                    editVideoFile,
                    undefined,
                    { skipIndexing: true }
                );
                publicVideoUrl = kbFile.url;
            }
            if (!publicVideoUrl) throw new Error('Unable to get video URL');

            // 2. Upload reference image if provided
            let firstFrameUrl = '';
            let refImageBase64: string | undefined;
            let refImageMimeType: string | undefined;
            if (editFirstFrameFile) {
                setEditState(s => ({ ...s, status: 'Uploading reference image...' }));
                const kbFile = await storageService.uploadKnowledgeBaseFile(
                    project.id,
                    editFirstFrameFile,
                    undefined,
                    { skipIndexing: true }
                );
                firstFrameUrl = kbFile.url;

                // Also read as base64 for AI analysis
                const reader = new FileReader();
                const base64Promise = new Promise<string>((resolve) => {
                    reader.onloadend = () => {
                        const result = reader.result as string;
                        resolve(result.split(',')[1]); // strip data:mime;base64, prefix
                    };
                    reader.readAsDataURL(editFirstFrameFile);
                });
                refImageBase64 = await base64Promise;
                refImageMimeType = editFirstFrameFile.type;
            }

            // 3. AI Routing — Gemini analyzes video + image + prompt
            setEditState(s => ({ ...s, status: 'AI is analyzing your edit...' }));
            const routing = await analyzeEditIntent(
                editPrompt.trim(),
                !!editFirstFrameFile,
                publicVideoUrl,
                refImageBase64,
                refImageMimeType,
            );
            setEditRouting(routing);

            // 4. Execute based on routing decision
            if (routing.engine === 'xai') {
                // xAI Grok Video Edit (localized)
                setEditState(s => ({ ...s, status: 'Grok is editing (polling)...' }));
                const result = await xaiService.editVideo({
                    prompt: editPrompt.trim(),
                    video_url: publicVideoUrl,
                });

                const completed = await xaiService.pollUntilComplete(
                    result.request_id,
                    (status) => setEditState(s => ({ ...s, status: `Grok: ${status}...` }))
                );

                if (!completed.url) throw new Error('No video URL returned from xAI');
                setEditState({ loading: false, status: 'Complete!', error: null, videoUrl: completed.url, videoBlob: null });

            } else {
                // Luma Dream Machine Video Edit (scene-level)

                // 4a. Generate first-frame image if AI recommends and user didn't upload one
                if (routing.shouldGenerateImage && routing.imagePrompt && !firstFrameUrl) {
                    setEditState(s => ({ ...s, status: 'Generating reference frame with Gemini...' }));
                    try {
                        const imageBlob = await generateFirstFrameImage(routing.imagePrompt);
                        const imageFile = new File([imageBlob], 'ai-first-frame.png', { type: 'image/png' });
                        const kbFile = await storageService.uploadKnowledgeBaseFile(
                            project.id,
                            imageFile,
                            undefined,
                            { skipIndexing: true }
                        );
                        firstFrameUrl = kbFile.url;
                    } catch (imgErr) {
                        console.warn('First-frame generation failed, proceeding without:', imgErr);
                    }
                }

                setEditState(s => ({ ...s, status: `Luma is dreaming (${routing.lumaMode || 'flex_1'})...` }));
                const result = await lumaService.modifyVideo({
                    prompt: editPrompt.trim(),
                    media: { url: publicVideoUrl },
                    first_frame: firstFrameUrl ? { url: firstFrameUrl } : undefined,
                    model: 'ray-2',
                    mode: (routing.lumaMode || 'flex_1') as any,
                });

                // Poll Luma
                const maxAttempts = 60;
                for (let i = 0; i < maxAttempts; i++) {
                    await new Promise(r => setTimeout(r, 5000));
                    const gen = await lumaService.getGeneration(result.id);

                    if (gen.state === 'completed' && gen.assets?.video) {
                        setEditState({ loading: false, status: 'Complete!', error: null, videoUrl: gen.assets.video, videoBlob: null });
                        return;
                    }
                    if (gen.state === 'failed') {
                        throw new Error(gen.failure_reason || 'Luma generation failed');
                    }
                    setEditState(s => ({ ...s, status: `Luma: ${gen.state} (${i + 1}/${maxAttempts})...` }));
                }

                throw new Error('Luma generation timed out');
            }
        } catch (err: any) {
            setEditState({ loading: false, status: '', error: err?.message || 'Video edit failed', videoUrl: null, videoBlob: null });
        }
    };

    // ─────────────────────────────────────────────
    //  MUSIC VIDEO — Audio Waveform Visualizer
    // ─────────────────────────────────────────────
    const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setAudioFile(file);
        setAudioName(file.name);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        const url = URL.createObjectURL(file);
        setAudioUrl(url);
        setIsPlaying(false);
    };

    // ─────────────────────────────────────────────
    //  SUNO AI — Song & Lyrics Generation
    // ─────────────────────────────────────────────
    const handleSunoGenerateLyrics = async () => {
        if (!sunoPrompt.trim()) return;
        setSunoLyricsLoading(true);
        try {
            const result = await sunoService.generateLyrics({ prompt: sunoPrompt.trim() });
            // Poll for lyrics
            const completed = await sunoService.pollUntilComplete(
                result.taskId,
                (status) => setSunoState(s => ({ ...s, status: `Generating lyrics: ${status}...` })),
                'lyrics'
            );
            if (completed.lyrics) {
                setSunoLyrics(completed.lyrics);
                if (completed.title && !sunoTitle) setSunoTitle(completed.title);
            }
        } catch (err: any) {
            setSunoState(s => ({ ...s, error: err?.message || 'Failed to generate lyrics' }));
        } finally {
            setSunoLyricsLoading(false);
            setSunoState(s => ({ ...s, status: '' }));
        }
    };

    const handleSunoGenerate = async () => {
        if (!sunoPrompt.trim()) return;
        setSunoState({ loading: true, status: 'Submitting to Suno AI...', error: null, videoUrl: null, videoBlob: null });
        setSunoGeneratedSongs([]);
        try {
            const result = await sunoService.generateSong({
                prompt: sunoPrompt.trim(),
                style: sunoStyle.trim() || undefined,
                title: sunoTitle.trim() || undefined,
                instrumental: sunoInstrumental,
                lyrics: sunoLyrics.trim() || undefined,
            });

            // Poll for completion
            const completed = await sunoService.pollUntilComplete(
                result.taskId,
                (status) => setSunoState(s => ({ ...s, status: `Suno: ${status}...` })),
                'music'
            );

            if (completed.songs && completed.songs.length > 0) {
                setSunoGeneratedSongs(completed.songs);
                setSunoState({ loading: false, status: 'Complete!', error: null, videoUrl: null, videoBlob: null });
            } else {
                throw new Error('No songs returned from Suno');
            }
        } catch (err: any) {
            setSunoState({ loading: false, status: '', error: err?.message || 'Song generation failed', videoUrl: null, videoBlob: null });
        }
    };

    // Combined handler: Generate Song → then immediately generate Music Video
    const handleGenerateFullMusicVideo = async () => {
        if (!sunoPrompt.trim()) return;
        const operation: CreditOperation = 'musicVideoGeneration';
        const hasCredits = await hasEnoughCredits(operation);
        if (!hasCredits) {
            setMvState({ ...mvState, loading: false, error: 'Insufficient credits for Music Video generation.', videoUrl: null, videoBlob: null });
            return;
        }

        const success = await deductCredits(operation);
        if (!success) {
            setMvState({ ...mvState, loading: false, error: 'Failed to deduct credits', videoUrl: null, videoBlob: null });
            return;
        }

        setMvState({ loading: true, status: '🎵 Step 1/6: Generating song with Suno AI...', error: null, songId: 'generating', videoUrl: null, videoBlob: null });
        setSunoGeneratedSongs([]);

        try {
            // Step 1: Generate song with Suno
            const result = await sunoService.generateSong({
                prompt: sunoPrompt.trim(),
                style: sunoStyle.trim() || undefined,
                title: sunoTitle.trim() || undefined,
                instrumental: sunoInstrumental,
                lyrics: sunoLyrics.trim() || undefined,
            });

            setMvState(s => ({ ...s, status: '🎵 Step 1/6: Waiting for Suno to finish...' }));
            const completed = await sunoService.pollUntilComplete(
                result.taskId,
                (status) => setMvState(s => ({ ...s, status: `🎵 Step 1/6: ${status}...` })),
                'music'
            );

            if (!completed.songs || completed.songs.length === 0) {
                throw new Error('No songs returned from Suno');
            }

            // Store the generated songs for preview
            setSunoGeneratedSongs(completed.songs);
            const song = completed.songs[0];

            if (!song.audio_url) {
                throw new Error('Song generated but has no audio URL');
            }

            // Step 2+: Continue with the music video pipeline
            await handleGenerateMusicVideo({
                audioUrl: song.audio_url,
                id: song.id,
                title: song.title,
                style: song.style,
                lyrics: song.lyrics,
                duration: song.duration,
            }, true);
        } catch (err: any) {
            setMvState({ loading: false, status: '', error: err?.message || 'Music video generation failed', songId: 'generating', videoUrl: null, videoBlob: null });
        }
    };

    // ─────────────────────────────────────────────
    //  MUSIC VIDEO — Kling Video Generation + Lip-Sync Pipeline (Dual-Clip + Stitching)
    // ─────────────────────────────────────────────
    const handleGenerateMusicVideo = async (source: { audioUrl: string, id: string, title?: string, style?: string, lyrics?: string, duration?: number, manualPrompt?: string, audioFile?: File }, skipDeduction: boolean = false) => {
        if (!source.audioUrl) return;

        if (!skipDeduction) {
            const operation: CreditOperation = 'musicVideoGeneration';
            const hasCredits = await hasEnoughCredits(operation);
            if (!hasCredits) {
                setMvState({ ...mvState, loading: false, error: 'Insufficient credits for Music Video generation.', videoUrl: null, videoBlob: null });
                return;
            }

            const success = await deductCredits(operation);
            if (!success) {
                setMvState({ ...mvState, loading: false, error: 'Failed to deduct credits', videoUrl: null, videoBlob: null });
                return;
            }
        }

        let finalAudioUrl = source.audioUrl;

        // ── Handle Local Blob URL (Upload to Storage) ──
        if (source.audioUrl.startsWith('blob:')) {
            if (source.audioFile) {
                setMvState(s => ({ ...s, loading: true, status: '☁️ Uploading audio file for processing...', error: null, songId: source.id, videoUrl: null }));
                try {
                    const kbFile = await storageService.uploadKnowledgeBaseFile(
                        project.id,
                        source.audioFile,
                        undefined,
                        { skipIndexing: true }
                    );
                    finalAudioUrl = kbFile.url;
                } catch (e: any) {
                    console.error('[MV] Audio upload failed', e);
                    setMvState(s => ({ ...s, loading: false, error: 'Failed to upload audio file: ' + (e.message || 'Unknown error') }));
                    return;
                }
            } else {
                setMvState(s => ({ ...s, loading: false, error: 'Missing source file for upload' }));
                return;
            }
        }

        setMvState(s => ({ ...s, loading: true, status: '🎧 Step 2/6: Processing audio & prompts...', error: null, songId: source.id, videoUrl: null }));

        try {
            let prompt1 = '';
            let prompt2 = '';
            let prompt3 = '';
            let prompt4 = '';

            if (source.manualPrompt) {
                // Step 2 (Skipped Analysis): Use manual prompt
                prompt1 = source.manualPrompt;
                prompt2 = source.manualPrompt;
                prompt3 = source.manualPrompt;
                prompt4 = source.manualPrompt;
                setMvState(s => ({ ...s, status: '📝 Step 2/8: Using manual prompt for scenes...' }));
                // Small delay to let user see status
                await new Promise(r => setTimeout(r, 800));
            } else {
                // Step 2: Analyze audio & generating prompts for 4 clips
                setMvState(s => ({ ...s, status: '🎧 Step 2/8: Analyzing audio & writing scenes...' }));

                const lyrics = source.lyrics || source.title || 'A music video';
                const style = source.style || 'cinematic';

                const analysisPrompt = `
                    Analyze this audio. The song style is "${style}". Lyrics snippet: "${lyrics.slice(0, 200)}...".
                    Create 4 distinct, vivid, cinematic video scene descriptions for a music video.
                    - Scene 1: For the first 10 seconds (Intro).
                    - Scene 2: For 10-20 seconds (Verse).
                    - Scene 3: For 20-30 seconds (Build-up/Pre-Chorus).
                    - Scene 4: For 30-40 seconds (Chorus/Climax).
                    
                    Focus on setting, lighting, mood, camera movement. Each scene should feel distinct but visually cohesive.
                    Return JSON ONLY: { "scene1": "...", "scene2": "...", "scene3": "...", "scene4": "..." }
                `;

                const audioAnalysisJson = await geminiAudioService.analyzeAudio(finalAudioUrl, analysisPrompt);
                let scenes: any = { scene1: '', scene2: '', scene3: '', scene4: '' };
                try {
                    const cleaned = audioAnalysisJson.replace(/```json/g, '').replace(/```/g, '').trim();
                    scenes = JSON.parse(cleaned);
                } catch (e) {
                    console.warn('Failed to parse audio analysis JSON, using raw text fallback');
                    scenes = { scene1: `Cinematic music video intro: ${style}`, scene2: `Music video verse scene: ${style}`, scene3: `Intense build-up scene: ${style}`, scene4: `Climactic chorus performance: ${style}` };
                }

                prompt1 = scenes.scene1 || `Music video scene for ${style}`;
                prompt2 = scenes.scene2 || `Music video scene for ${style}`;
                prompt3 = scenes.scene3 || `Music video scene for ${style}`;
                prompt4 = scenes.scene4 || `Music video scene for ${style}`;
            }

            // Step 3: Prepare Reference Images (Concurrent Upload)
            const useMultiImage = mvRefImages.length > 0;
            let uploadedImageUrls: string[] = [];
            if (useMultiImage) {
                setMvState(s => ({ ...s, status: '🖼️ Step 3/8: Uploading reference images...' }));
                for (const file of mvRefImages.slice(0, 4)) {
                    const kbFile = await storageService.uploadKnowledgeBaseFile(project.id, file, undefined, { skipIndexing: true });
                    uploadedImageUrls.push(kbFile.url);
                }
            } else {
                // Generate a reference image for consistency if none provided?
                // Or just let Kling generate from text. 
                // Creating a consistent character might be better, but for now let's use text-to-video if no images.
            }

            // Step 4: Launch 4 Kling Generation Tasks in Sequence (Parallel causes Kling API Limits)
            setMvState(s => ({ ...s, status: '🎬 Step 4/8: Generating 4 video clips sequentially...' }));

            const generateClip = async (prompt: string, clipName: string) => {
                let taskId: string;
                if (useMultiImage) {
                    const res = await klingService.generateMultiVideo(uploadedImageUrls, prompt, '10', 'pro', '16:9');
                    taskId = res.taskId;
                } else {
                    // Generate a unique image for each prompt first.
                    const img = await generateImage(prompt, { aspectRatio: '16:9', useProModel: true });

                    // Upload image to Blob to avoid 413 Payload Too Large with base64 strings
                    const b64Data = img.imageDataUrl.replace(/^data:[^;]+;base64,/, '');
                    const byteCharacters = atob(b64Data);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: 'image/png' });
                    const file = new File([blob], `scene_${Date.now()}.png`, { type: 'image/png' });

                    const kbFile = await storageService.uploadKnowledgeBaseFile(project.id, file, undefined, { skipIndexing: true });

                    const res = await klingService.generateVideo(kbFile.url, prompt, '10', 'pro');
                    taskId = res.taskId;
                }
                return klingService.pollVideoUntilComplete(taskId, (s) =>
                    setMvState(prev => ({ ...prev, status: `${clipName}: ${s}...` }))
                    , useMultiImage);
            };

            const clip1 = await generateClip(prompt1, 'Clip 1 (1/4)');
            const clip2 = await generateClip(prompt2, 'Clip 2 (2/4)');
            const clip3 = await generateClip(prompt3, 'Clip 3 (3/4)');
            const clip4 = await generateClip(prompt4, 'Clip 4 (4/4)');

            // Step 5: Identify Faces & Lip-Sync
            setMvState(s => ({ ...s, status: '👄 Step 5/8: Analyzing faces in clips...' }));

            const identify = async (videoUrl: string, videoId?: string) => {
                return klingService.identifyFace(videoUrl, videoId);
            };

            const faces1 = await identify(clip1.videoUrl!, clip1.videoId || undefined);
            const faces2 = await identify(clip2.videoUrl!, clip2.videoId || undefined);
            const faces3 = await identify(clip3.videoUrl!, clip3.videoId || undefined);
            const faces4 = await identify(clip4.videoUrl!, clip4.videoId || undefined);

            // (Lip-Sync continues)
            setMvState(s => ({ ...s, status: '👄 Step 6/8: Applying lip-sync to clips...' }));

            const createLipSyncTask = async (faceResult: any, startTime: number, endTime: number) => {
                if (!faceResult.faces?.length) return null; // No face, return original video
                const face = faceResult.faces[0];
                const duration = endTime - startTime;
                // Kling constraint: audio must be >= 2s. Our clips are 10s.
                return klingService.createLipSync(
                    faceResult.sessionId,
                    face.faceId,
                    finalAudioUrl!,
                    startTime,
                    endTime,
                    face.startTime || 0 // insert at face start
                );
            };

            // Clip 1: 0-10s. Clip 2: 10-20s. Clip 3: 20-30s. Clip 4: 30-40s.
            const lipSyncTask1 = await createLipSyncTask(faces1, 0, 10000);
            const lipSyncTask2 = await createLipSyncTask(faces2, 10000, 20000);
            const lipSyncTask3 = await createLipSyncTask(faces3, 20000, 30000);
            const lipSyncTask4 = await createLipSyncTask(faces4, 30000, 40000);

            setMvState(s => ({ ...s, status: '👄 Step 7/8: Waiting for lip-sync results sequentially...' }));

            const pollLipSync = async (task: any, originalUrl: string, name: string) => {
                if (!task) return originalUrl; // No face identified
                const res = await klingService.pollLipSyncUntilComplete(task.taskId, (s) =>
                    setMvState(prev => ({ ...prev, status: `${name} Lip-sync: ${s}...` }))
                );
                return res.videoUrl;
            };

            const url1 = await pollLipSync(lipSyncTask1, clip1.videoUrl!, 'Clip 1 (1/4)');
            const url2 = await pollLipSync(lipSyncTask2, clip2.videoUrl!, 'Clip 2 (2/4)');
            const url3 = await pollLipSync(lipSyncTask3, clip3.videoUrl!, 'Clip 3 (3/4)');
            const url4 = await pollLipSync(lipSyncTask4, clip4.videoUrl!, 'Clip 4 (4/4)');

            if (!url1 || !url2 || !url3 || !url4) throw new Error('Failed to generate video segments');

            // Step 8: Stitch with Creatomate + Subtitles
            setMvState(s => ({ ...s, status: '🧵 Step 8/8: Stitching 4 clips & adding subtitles...' }));
            const stitchedFinal = await stitchVideos({
                videoUrls: [url1, url2, url3, url4],
                width: 1920,
                height: 1080,
                enableSubtitles: true
            });

            setMvState(s => ({ ...s, status: '💾 Saving to project...' }));

            // Auto-save generated video
            const newAsset = {
                id: crypto.randomUUID(),
                type: 'video',
                title: source.title || `Music Video - ${new Date().toLocaleString()}`,
                url: stitchedFinal.url,
                timestamp: Date.now(),
                researchTopic: 'Music Video',
                source: 'studio'
            };

            const updatedProject = { ...project };
            if (!updatedProject.researchSessions) updatedProject.researchSessions = [];
            if (updatedProject.researchSessions.length === 0) {
                updatedProject.researchSessions.push({
                    id: crypto.randomUUID(),
                    topic: 'General',
                    assets: [],
                    timestamp: Date.now(),
                    lastModified: Date.now(),
                    researchReport: {} as any,
                    websiteVersions: []
                });
            }
            if (!updatedProject.researchSessions[0].assets) updatedProject.researchSessions[0].assets = [];

            updatedProject.researchSessions[0].assets.push(newAsset as any);
            onProjectUpdate?.(updatedProject);

            setMvState({
                loading: false,
                status: 'Complete!',
                error: null,
                songId: source.id,
                videoUrl: stitchedFinal.url,
                videoBlob: null,
                generatedAsset: newAsset
            });

        } catch (err: any) {
            console.error('[MV] Pipeline error:', err);
            setMvState(s => ({ ...s, loading: false, status: '', error: err?.message || 'Music video generation failed' }));
        }
    };

    const startVisualization = useCallback(() => {
        if (!audioRef.current || !canvasRef.current) return;

        const audioEl = audioRef.current;
        if (!audioContextRef.current) {
            const ctx = new AudioContext();
            const src = ctx.createMediaElementSource(audioEl);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            src.connect(analyser);
            analyser.connect(ctx.destination);
            audioContextRef.current = ctx;
            analyserRef.current = analyser;
        }

        const analyser = analyserRef.current!;
        const canvas = canvasRef.current!;
        const canvasCtx = canvas.getContext('2d')!;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            animFrameRef.current = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            const width = canvas.width;
            const height = canvas.height;
            canvasCtx.clearRect(0, 0, width, height);

            const barWidth = (width / bufferLength) * 2.5;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * height;
                const hue = (i / bufferLength) * 280 + 180;
                canvasCtx.fillStyle = `hsla(${hue}, 80%, 60%, 0.85)`;
                canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
        };

        draw();
    }, []);

    const togglePlayback = useCallback(() => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
            cancelAnimationFrame(animFrameRef.current);
        } else {
            audioRef.current.play();
            startVisualization();
        }
        setIsPlaying(!isPlaying);
    }, [isPlaying, startVisualization]);

    const activeTool = TOOL_CARDS.find(t => t.id === selectedTool) || TOOL_CARDS[0];

    const renderSidebarButton = (tool: typeof TOOL_CARDS[0]) => {
        const isActive = selectedTool === tool.id;
        const locked = isToolLocked(tool.id);

        return (
            <button
                key={tool.id}
                onClick={() => {
                    if (locked) {
                        openUpgradeModal('button', 'unlimited');
                        return;
                    }
                    setSelectedTool(tool.id);
                    setExpandedTool(tool.id);
                }}
                className={`group relative flex items-center gap-3 w-full px-3 py-3 rounded-xl transition-all duration-200 ${isActive
                    ? (isDarkMode ? 'bg-white/[0.08] shadow-lg' : 'bg-gray-100 shadow-sm')
                    : (isDarkMode ? 'hover:bg-white/[0.04]' : 'hover:bg-gray-50')
                    } ${locked ? 'opacity-60 grayscale' : ''}`}
                style={isActive ? { boxShadow: isDarkMode ? `0 0 20px ${tool.accent}20, inset 0 0 0 1px ${tool.accent}30` : `inset 0 0 0 1px ${tool.accent}20` } : {}}
                title={tool.title}
            >
                <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all ${isActive ? 'scale-110' : 'opacity-60 group-hover:opacity-90'}`}
                    style={isActive ? { background: `${tool.accent}20` } : {}}
                >
                    <svg className="w-[18px] h-[18px]" fill="none" stroke={isActive ? tool.accent : isDarkMode ? '#9ca3af' : '#6b7280'} viewBox="0 0 24 24" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={tool.iconPath} />
                    </svg>
                    {locked && (
                        <div className="absolute -top-1 -right-1 bg-gray-900 rounded-full p-0.5 border border-gray-700">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                        </div>
                    )}
                </div>
                <div className="hidden sm:block min-w-0">
                    <div className="flex items-center gap-2">
                        <p className={`text-sm font-semibold truncate transition-colors ${isActive
                            ? (isDarkMode ? 'text-white' : 'text-gray-900')
                            : (isDarkMode ? 'text-gray-400 group-hover:text-gray-200' : 'text-gray-600 group-hover:text-gray-900')
                            }`}>
                            {tool.title}
                        </p>
                        {locked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-500 font-medium">UNLIMITED</span>}
                    </div>
                </div>
                {/* Active indicator bar */}
                {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full" style={{ background: tool.accent }} />
                )}
            </button>
        );
    };

    const handleShareVideoState = async (
        state: ToolState,
        toolId: string,
        setState: React.Dispatch<React.SetStateAction<ToolState>>,
        customPrompt?: string
    ) => {
        if (!project || !onShare || !state.videoUrl) return;
        if (state.generatedAsset) {
            onShare(state.generatedAsset);
            return;
        }

        setState(s => ({ ...s, isSharing: true }));
        try {
            let blob = state.videoBlob;
            if (!blob) {
                const response = await fetch(state.videoUrl);
                blob = await response.blob();
            }
            const baseTitle = customPrompt || (
                toolId === 'product_ad' ? (adPrompt || 'Product Ad') :
                    toolId === 'animate_image' ? (animPrompt || 'Animated Image') :
                        toolId === 'in_my_head' ? (editPrompt || 'Edited Video') :
                            toolId === 'music_video' ? (sunoPrompt || 'Music Video') :
                                toolId === 'overview' ? (overviewPrompt || 'Project Overview') : 'Generated Video');
            const safeTitle = baseTitle.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80).trim() || 'Video';
            const fileName = `${safeTitle}-${Date.now()}.mp4`;

            const file = new File([blob], fileName, { type: 'video/mp4' });
            const kbFile = await storageService.uploadKnowledgeBaseFile(project.id, file);

            const existingKb = project.knowledgeBase || [];
            const updatedKnowledgeBase = [...existingKb, kbFile];
            await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });

            onProjectUpdate?.({
                ...project,
                knowledgeBase: updatedKnowledgeBase,
                lastModified: Date.now(),
            });

            setState(s => ({ ...s, generatedAsset: kbFile, isSharing: false }));
            onShare(kbFile);
        } catch (err) {
            console.error("Shared failed:", err);
            setState(s => ({ ...s, isSharing: false }));
            alert("Failed to save and share video.");
        }
    };

    const renderVideoOutput = (state: ToolState, toolId: string, setState: React.Dispatch<React.SetStateAction<ToolState>>) => {
        if (state.error) {
            return (
                <div className={`mt-5 p-4 rounded-2xl border ${isDarkMode ? 'bg-red-950/30 border-red-500/20 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
                    <div className="flex items-center gap-2 mb-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <p className="text-sm font-semibold">Generation Failed</p>
                    </div>
                    <p className="text-xs mt-1 opacity-80 pl-6 mb-2">
                        {state.error.length > 100 ? state.error.substring(0, 100) + '...' : state.error}
                    </p>
                    {state.error.length > 100 && (
                        <details className="text-xs pl-6 cursor-pointer">
                            <summary className="opacity-70 hover:opacity-100 transition-opacity">Show full error details</summary>
                            <div className="mt-2 p-2 rounded bg-black/5 dark:bg-black/20 font-mono text-[10px] break-all whitespace-pre-wrap">
                                {state.error}
                            </div>
                        </details>
                    )}
                </div>
            );
        }

        if (state.loading) {
            return (
                <div className="mt-5 flex flex-col items-center gap-4 py-12">
                    <div className="relative">
                        <div className="w-14 h-14 rounded-full border-[3px] border-t-transparent animate-spin"
                            style={{ borderColor: `${activeTool.accent}40`, borderTopColor: 'transparent' }}
                        />
                        <div className="absolute inset-2 rounded-full border-[3px] border-b-transparent animate-spin" style={{ borderColor: `${activeTool.accent}80`, borderBottomColor: 'transparent', animationDirection: 'reverse', animationDuration: '0.8s' }} />
                    </div>
                    <p className={`text-sm font-medium animate-pulse ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{state.status}</p>
                </div>
            );
        }

        if (state.videoUrl) {
            return (
                <div className="mt-5 space-y-3">
                    <div className="relative rounded-2xl overflow-hidden group" style={{ boxShadow: `0 0 40px ${activeTool.accent}15` }}>
                        <video src={state.videoUrl} controls autoPlay loop className="w-full max-h-[450px] bg-black" />
                        <div className="absolute top-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {onShare && (
                                <button
                                    onClick={() => handleShareVideoState(state, toolId, setState)}
                                    disabled={state.isSharing}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all bg-blue-600/90 backdrop-blur-md text-white border border-white/10 hover:bg-blue-500 shadow-lg shadow-blue-900/20 disabled:opacity-50"
                                >
                                    {state.isSharing ? 'Saving...' : '🚀 Share'}
                                </button>
                            )}
                            {state.videoBlob && (
                                <a
                                    href={state.videoUrl}
                                    download={`studio-video-${Date.now()}.mp4`}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all bg-black/60 backdrop-blur-md text-white border border-white/10 hover:bg-black/80"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    Download
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        return null;
    };

    const buttonClass = `w-full px-5 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed border-0 text-white hover:shadow-lg active:scale-[0.98]`;

    const inputClass = `w-full rounded-xl border px-4 py-3 text-sm transition-all duration-200 focus:outline-none focus:ring-2 ${isDarkMode
        ? 'bg-white/[0.04] border-white/[0.08] text-white placeholder-gray-500 focus:ring-white/10 focus:border-white/15 focus:bg-white/[0.06]'
        : 'bg-gray-50/80 border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-blue-500/30 focus:border-blue-300'
        }`;

    const labelClass = `block text-[11px] font-semibold uppercase tracking-[0.08em] mb-2.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`;

    const renderImageUploadBox = (
        preview: string | null,
        onClick: () => void,
        label: string,
        small?: boolean,
        className?: string,
        imgClassName?: string
    ) => (
        <div
            onClick={onClick}
            className={`border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 flex flex-col items-center justify-center group/upload ${className || (small ? 'p-3 h-24 w-24' : 'p-4 h-40')
                } ${isDarkMode
                    ? 'border-white/[0.08] hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.04]'
                    : 'border-gray-200 hover:border-gray-300 bg-gray-50/30 hover:bg-gray-50/60'
                }`}
        >
            {preview ? (
                <img src={preview} alt="Preview" className={`rounded-lg object-contain ${imgClassName || (small ? 'h-16 w-16' : 'h-full max-h-32')}`} />
            ) : (
                <div className="flex flex-col items-center gap-1.5">
                    <svg className={`w-5 h-5 transition-colors ${isDarkMode ? 'text-gray-600 group-hover/upload:text-gray-400' : 'text-gray-300 group-hover/upload:text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className={`text-[10px] text-center font-medium ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>{label}</span>
                </div>
            )}
        </div>
    );

    // Handle extracting the first frame from the source video (In My Head)
    const handleExtractFirstFrame = async (sourceOverride?: string) => {
        const src = sourceOverride || editVideoPreview;
        if (!src && !editVideoFile) return;
        setIsExtractingFrame(true);
        try {
            let videoSrc = src;
            // If we have a file but no URL (shouldn't happen given logic, but safe check)
            if (editVideoFile && !videoSrc) {
                videoSrc = URL.createObjectURL(editVideoFile);
            }

            if (!videoSrc) throw new Error("No video source found");

            console.log("Starting frame extraction for:", videoSrc);
            const video = document.createElement('video');
            video.src = videoSrc;
            video.crossOrigin = 'anonymous'; // Try anonymous for remote videos
            video.muted = true;
            video.playsInline = true;
            video.autoplay = true; // Ensure it starts loading

            await new Promise((resolve, reject) => {
                video.onloadeddata = () => {
                    console.log("Video loaded data");
                    resolve(true);
                };
                video.onerror = (e) => {
                    console.error("Video load error:", e);
                    reject(e);
                };
                video.oncanplay = () => video.play(); // Force play to load frames
                video.load();
            });

            // Seek slightly to ensuring frame context (avoid 0.0 quirks)
            video.pause();
            video.currentTime = 0.1;
            await new Promise((resolve) => {
                video.onseeked = () => {
                    console.log("Video seeked to 0.1");
                    resolve(true);
                };
            });

            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(video, 0, 0);

                canvas.toBlob((blob) => {
                    if (blob) {
                        const file = new File([blob], "extracted_frame.png", { type: "image/png" });
                        setEditFirstFrameFile(file);
                        if (editFirstFramePreview) URL.revokeObjectURL(editFirstFramePreview);
                        setEditFirstFramePreview(URL.createObjectURL(file));
                    }
                    // Cleanup local blob url if we created one specifically for extraction
                    if (editVideoFile && !editVideoPreview) {
                        URL.revokeObjectURL(src!);
                    }
                    setIsExtractingFrame(false);
                }, 'image/png');
            } else {
                setIsExtractingFrame(false);
            }
        } catch (e: any) {
            console.error("Frame extraction error", e);
            setIsExtractingFrame(false);
            alert("Could not extract frame. Note: Remote videos might have CORS restrictions. Try with a locally uploaded video if this fails.");
        }
    };

    // Handle editing the extracted frame with Gemini Nano
    const handleEditFrameWithGemini = async () => {
        if (!editFirstFrameFile || !frameEditPrompt) return;
        setIsGeneratingFrameEdit(true);
        try {
            const reader = new FileReader();
            reader.readAsDataURL(editFirstFrameFile);
            reader.onloadend = async () => {
                if (typeof reader.result === 'string') {
                    const base64data = reader.result;
                    // strip prefix
                    const parts = base64data.split(',');
                    const base64Content = parts.length > 1 ? parts[1] : parts[0];
                    // Safe mime type extraction
                    const mimeMatch = base64data.match(/data:([^;]+);/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

                    const blob = await editImageWithGeminiNano(base64Content, mimeType, frameEditPrompt);
                    const file = new File([blob], `edited_frame_${Date.now()}.png`, { type: "image/png" });

                    setEditFirstFrameFile(file);
                    if (editFirstFramePreview) URL.revokeObjectURL(editFirstFramePreview);
                    setEditFirstFramePreview(URL.createObjectURL(file));

                    // Clear prompt/mode
                    setIsGeneratingFrameEdit(false);
                    setIsEditingFrame(false);
                    setFrameEditPrompt('');
                }
            };
        } catch (e) {
            console.error("Gemini Edit Error", e);
            alert("Failed to edit image with Gemini.");
            setIsGeneratingFrameEdit(false);
            setIsEditingFrame(false);
        }
    };

    // Handle editing the Product Ad image with Gemini Nano
    const handleEditAdProductWithGemini = async () => {
        if (!adProductImage || !adProductEditPrompt) return;
        setIsGeneratingAdProductEdit(true);
        try {
            const reader = new FileReader();
            reader.readAsDataURL(adProductImage);
            reader.onloadend = async () => {
                if (typeof reader.result === 'string') {
                    const base64data = reader.result;
                    const parts = base64data.split(',');
                    const base64Content = parts.length > 1 ? parts[1] : parts[0];
                    const mimeMatch = base64data.match(/data:([^;]+);/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

                    const blob = await editImageWithGeminiNano(base64Content, mimeType, adProductEditPrompt);
                    const file = new File([blob], `edited_product_${Date.now()}.png`, { type: "image/png" });

                    setAdProductImage(file);
                    if (adProductPreview) URL.revokeObjectURL(adProductPreview);
                    setAdProductPreview(URL.createObjectURL(file));

                    setIsGeneratingAdProductEdit(false);
                    setIsEditingAdProduct(false);
                    setAdProductEditPrompt('');
                }
            };
        } catch (e) {
            console.error("Gemini Edit Error", e);
            alert("Failed to edit product image with Gemini.");
            setIsGeneratingAdProductEdit(false);
            setIsEditingAdProduct(false);
        }
    };


    const handleCloneVoice = async () => {
        if (!overviewVoiceFile) return;
        setOverviewIsCloningVoice(true);
        try {
            const kbFile = await storageService.uploadKnowledgeBaseFile(project.id, overviewVoiceFile, undefined, { skipIndexing: true });
            if (kbFile.url.startsWith('blob:')) throw new Error('Offline mode upload failed');

            const res = await fetch('/api/media?op=qwen-clone-voice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audioUrl: kbFile.url })
            });

            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            if (data.voiceId) setOverviewClonedVoiceId(data.voiceId);
        } catch (e: any) {
            console.error('Clone voice error:', e);
            alert('Failed to clone voice: ' + e.message);
        } finally {
            setOverviewIsCloningVoice(false);
        }
    };

    const handlePreviewClonedVoice = async () => {
        if (!overviewClonedVoiceId) return;
        setOverviewIsPreviewingVoice(true);
        try {
            const res = await fetch('/api/media?op=qwen-synthesize-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: "This is a test of your new voice.", voiceId: overviewClonedVoiceId })
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            if (data.audioData) {
                const binaryString = window.atob(data.audioData);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: data.mimeType || 'audio/wav' });
                const url = URL.createObjectURL(blob);
                if (overviewVoicePreviewUrl) URL.revokeObjectURL(overviewVoicePreviewUrl);
                setOverviewVoicePreviewUrl(url);
            }
        } catch (e: any) {
            console.error('Preview voice error:', e);
            alert('Failed to preview voice: ' + e.message);
        } finally {
            setOverviewIsPreviewingVoice(false);
        }
    };

    // ─────────────────────────────────────────────
    //  VIDEO OVERVIEW handler
    // ─────────────────────────────────────────────
    const handleOverviewGenerate = async () => {
        if (!overviewPrompt.trim()) return;

        // Determine operation cost
        const operation: CreditOperation = 'videoOverviewGeneration';

        // Credit Check
        const hasCredits = await hasEnoughCredits(operation, overviewSlides);
        if (!hasCredits) {
            setOverviewState(s => ({ ...s, error: `Insufficient credits. Need ${100 * overviewSlides} credits for ${overviewSlides} slides.` }));
            return;
        }

        const success = await deductCredits(operation, overviewSlides);
        if (!success) {
            setOverviewState(s => ({ ...s, error: 'Failed to deduct credits' }));
            return;
        }

        setOverviewState(s => ({ ...s, loading: true, status: 'queued', error: null }));
        setOverviewProgress(0);

        try {
            // Upload custom avatar if selected
            let avatarUrl: string | undefined;
            if (overviewAvatarFile) {
                setOverviewState(s => ({ ...s, status: 'Uploading avatar image...' }));
                try {
                    const kbFile = await storageService.uploadKnowledgeBaseFile(project.id, overviewAvatarFile, undefined, { skipIndexing: true });
                    avatarUrl = kbFile.url;

                    // CRITICAL: If upload failed and returned a local blob URL, we cannot proceed with server-side generation
                    if (avatarUrl.startsWith('blob:')) {
                        throw new Error('Avatar upload failed (offline/fallback mode). Cannot use custom avatar for server-side generation. Please check Vercel Blob configuration.');
                    }
                } catch (e: any) {
                    setOverviewState(s => ({ ...s, error: 'Failed to upload avatar: ' + (e.message || 'Unknown error'), loading: false }));
                    return;
                }
            }

            const userPrompt = overviewPrompt.trim();
            const ctx = contextService.buildProjectContext(project);
            const refineStatus = avatarUrl ? 'Refining prompt...' : 'Refining prompt...';
            setOverviewState(s => ({ ...s, status: refineStatus }));

            const magicPrompt = await refinePromptWithGemini3(userPrompt, ctx.fullContext, 'video');

            const titleContext = `Project: ${project.name}
Description: ${project.description}
Video type: overview
User request: ${userPrompt}

PROJECT CONTEXT:
${ctx.fullContext}

Video generation prompt:
${magicPrompt}`;

            const videoContextDescription = `PROJECT CONTEXT:
${ctx.fullContext}

ADDITIONAL NOTES:
${project.notes?.slice(0, 10).map(n => n.content).join('\n') || ''}

KNOWLEDGE BASE:
${project.knowledgeBase?.slice(0, 5).map(f => f.summary).join('\n') || ''}`;

            const aspectString = overviewAspect === '16:9' ? '1280x720' : '720x1280';
            const reqVoiceName = overviewUseClonedVoice && overviewClonedVoiceId ? 'cloned:' + overviewClonedVoiceId : undefined;

            const result = await createVideoOverview({
                projectId: project.id,
                prompt: magicPrompt,
                aspect: aspectString,
                contextDescription: videoContextDescription,
                slideCount: overviewSlides,
                voiceName: reqVoiceName,
                avatarUrl,
                onStatusUpdate: (status, progress) => {
                    let displayStatus = progress || status;
                    if (status === 'generating_avatar' || status === 'processing') {
                        if (!overviewProgressInterval.current) {
                            setOverviewProgress(10);
                            overviewProgressInterval.current = setInterval(() => {
                                setOverviewProgress(prev => {
                                    if (prev === null || prev >= 95) return prev;
                                    return Math.round((prev + 0.5) * 10) / 10;
                                });
                            }, 5000);
                        }
                        displayStatus = 'Generating avatar (Warning: this takes 10-20 mins)...';
                    }
                    setOverviewState(s => ({ ...s, status: displayStatus }));
                },
            });

            const response = await fetch(result.url);
            const blob = await response.blob();
            const localUrl = URL.createObjectURL(blob);

            setOverviewState(s => ({
                ...s,
                loading: false,
                status: 'completed',
                videoUrl: localUrl,
                videoBlob: blob,
            }));

            if (overviewProgressInterval.current) {
                clearInterval(overviewProgressInterval.current);
                overviewProgressInterval.current = null;
            }
            setOverviewProgress(100);

            // Auto-save
            try {
                const rawTitle = (await generateVideoTitleFromContext(titleContext)).trim();
                const baseTitle = rawTitle || 'Project Overview';
                const safeTitle = baseTitle.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80).trim() || 'Project Overview';
                const fileName = `${safeTitle}.mp4`;

                const file = new File([blob], fileName, { type: 'video/mp4' });
                const kbFile = await storageService.uploadKnowledgeBaseFile(project.id, file);

                const existingKb = project.knowledgeBase || [];
                const updatedKnowledgeBase = [...existingKb, kbFile];
                await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });

                onProjectUpdate?.({
                    ...project,
                    knowledgeBase: updatedKnowledgeBase,
                    lastModified: Date.now(),
                });

                setOverviewState(s => ({ ...s, status: 'Saved to projectAssets' }));
            } catch (saveErr) {
                console.warn('Failed to auto-save overview video:', saveErr);
            }

        } catch (err: any) {
            if (overviewProgressInterval.current) {
                clearInterval(overviewProgressInterval.current);
                overviewProgressInterval.current = null;
            }
            console.error('Overview video generation failed:', err);
            setOverviewState(s => ({
                ...s,
                loading: false,
                status: 'failed',
                error: err?.message || 'Failed to generate overview video'
            }));
            setOverviewProgress(null);
        }
    };

    // Resume in-progress overview jobs on mount
    useEffect(() => {
        const resumeJobs = async () => {
            try {
                const trackedJobs = JSON.parse(localStorage.getItem('videoOverviewJobs') || '[]');
                if (trackedJobs.length === 0) return;

                const status = await getVideoOverviewStatus(trackedJobs[0]);
                if (status.status === 'completed' || status.status === 'failed') return;

                setActiveVideoOverviewJob(status);
                setOverviewProgress(status.progress ? parseInt(status.progress) : 0);
                setOverviewState(s => ({ ...s, loading: true, status: status.progress || status.status }));

                const result = await resumeVideoOverviewPolling(status.jobId, (s, p) => {
                    setOverviewState(state => ({ ...state, status: p || s }));
                    if (p) {
                        const num = parseInt(p);
                        if (!isNaN(num)) setOverviewProgress(num);
                    }
                });

                if (result) {
                    const response = await fetch(result.url);
                    const blob = await response.blob();
                    const localUrl = URL.createObjectURL(blob);
                    setOverviewState(s => ({
                        ...s,
                        loading: false,
                        status: 'completed',
                        videoUrl: localUrl,
                        videoBlob: blob,
                    }));
                }
            } catch (e) {
                console.warn('Failed to resume video overview jobs:', e);
            }
        };
        resumeJobs();
    }, [project.id]);


    const renderAspectSelector = (
        value: '16:9' | '9:16',
        onChange: (v: '16:9' | '9:16') => void,
    ) => (
        <div className="flex gap-4">
            {(['16:9', '9:16'] as const).map(ar => {
                const isSelected = value === ar;
                const isLandscape = ar === '16:9';

                return (
                    <button
                        key={ar}
                        onClick={() => onChange(ar)}
                        className="group flex flex-col items-center gap-2"
                    >
                        <div
                            className={`relative rounded-xl border-2 transition-all flex items-center justify-center
                            ${isLandscape ? 'w-24 h-14' : 'w-14 h-24'}
                            ${isSelected
                                    ? isDarkMode
                                        ? 'bg-[#0a84ff]/20 border-[#0a84ff] shadow-[0_0_15px_rgba(10,132,255,0.3)]'
                                        : 'bg-blue-50 border-blue-500 shadow-sm'
                                    : isDarkMode
                                        ? 'bg-[#1d1d1f] border-[#3d3d3f] hover:border-[#5d5d5f]'
                                        : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                                }`}
                        >
                            {/* Inner shape box */}
                            <div className={`rounded-sm border pointer-events-none transition-colors
                                ${isLandscape ? 'w-10 h-6' : 'w-6 h-10'}
                                ${isSelected
                                    ? isDarkMode ? 'border-[#0a84ff]/60 bg-[#0a84ff]/20' : 'border-blue-400 bg-blue-100'
                                    : isDarkMode ? 'border-gray-600 bg-gray-700/30' : 'border-gray-300 bg-gray-200'
                                }`}
                            />

                            {/* Checkmark indicator */}
                            {isSelected && (
                                <div className="absolute -top-2 -right-2 w-5 h-5 bg-[#0a84ff] rounded-full flex items-center justify-center text-white shadow-md">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                </div>
                            )}
                        </div>
                        <span className={`text-[11px] font-bold uppercase tracking-wider transition-colors ${isSelected
                            ? isDarkMode ? 'text-[#0a84ff]' : 'text-blue-600'
                            : isDarkMode ? 'text-gray-500 group-hover:text-gray-400' : 'text-gray-400 group-hover:text-gray-600'
                            }`}>
                            {isLandscape ? '16:9 Wide' : '9:16 Tall'}
                        </span>
                    </button>
                );
            })}
        </div>
    );

    // ═══════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════

    return (
        <div className="relative">
            {forcedStyleTag}

            {/* ─── Mobile Tool Selector (horizontal scroll pills) ─── */}
            <div className="sm:hidden flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-none -mx-1 px-1">
                {TOOL_CARDS.map(tool => {
                    const isActive = selectedTool === tool.id;
                    const locked = isToolLocked(tool.id);
                    return (
                        <button
                            key={tool.id}
                            onClick={() => {
                                if (locked) {
                                    openUpgradeModal('button', 'unlimited');
                                    return;
                                }
                                setSelectedTool(tool.id);
                                setExpandedTool(tool.id);
                            }}
                            className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold transition-all duration-200 border ${isActive
                                ? 'border-transparent shadow-lg'
                                : isDarkMode
                                    ? 'bg-white/[0.04] border-white/[0.06] text-gray-400 hover:text-white hover:bg-white/[0.08]'
                                    : 'bg-white border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                                } ${locked ? 'grayscale opacity-70' : ''}`}
                            style={isActive ? {
                                background: `${tool.accent}`,
                                color: (tool.id === 'overview') ? '#000' : '#fff',
                                boxShadow: `0 4px 20px ${tool.accent}40`
                            } : {}}
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d={tool.iconPath} />
                            </svg>
                            {tool.title}
                            {locked && <span className="ml-1 opacity-60">🔒</span>}
                        </button>
                    );
                })}
            </div>

            {/* ─── Desktop: Sidebar + Workspace ─── */}
            <div className="flex gap-0 sm:gap-5">

                {/* ══ Left Sidebar ══ */}
                <div className={`hidden sm:flex flex-col w-[200px] flex-shrink-0 rounded-2xl p-2 gap-1 ${isDarkMode ? 'bg-white/[0.02] border border-white/[0.05]' : 'bg-gray-50/80 border border-gray-200/80'}`}>
                    <div className="px-3 pt-2 pb-3 mb-1">
                        <h2 className={`text-base font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            Studio
                        </h2>
                    </div>
                    {TOOL_CARDS.map(tool => renderSidebarButton(tool))}
                </div>

                {/* ══ Workspace ══ */}
                <div className="flex-1 min-w-0">
                    {/* Workspace Header */}
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${activeTool.accent}15` }}>
                            <svg className="w-5 h-5" fill="none" stroke={activeTool.accent} viewBox="0 0 24 24" strokeWidth={1.8}>
                                <path strokeLinecap="round" strokeLinejoin="round" d={activeTool.iconPath} />
                            </svg>
                        </div>
                        <div>
                            <h3 className={`text-lg font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                {activeTool.title}
                            </h3>
                            <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                {activeTool.subtitle}
                            </p>
                        </div>
                    </div>

                    {/* Workspace Content */}
                    <div className={`p-6 sm:p-8 rounded-2xl border backdrop-blur-sm ${isDarkMode ? 'bg-white/[0.02] border-white/[0.06]' : 'bg-white/80 border-gray-200/80 shadow-sm'}`}
                        style={{ boxShadow: isDarkMode ? `0 0 60px ${activeTool.accent}08` : undefined }}
                    >
                        {/* ═════ PRODUCT AD ═════ */}
                        {selectedTool === 'product_ad' && (
                            <div className="space-y-5">
                                <div>
                                    <label className={labelClass}>1. Product Image</label>
                                    <input type="file" ref={adFileRef} className="hidden" accept="image/*"
                                        onChange={e => {
                                            const f = e.target.files?.[0];
                                            if (f) {
                                                setAdProductImage(f);
                                                if (adProductPreview) URL.revokeObjectURL(adProductPreview);
                                                setAdProductPreview(URL.createObjectURL(f));
                                            }
                                        }}
                                    />
                                    <div className="flex flex-col sm:flex-row items-start gap-4">
                                        <div className="w-full sm:max-w-[280px]">
                                            <div className="relative group">
                                                {renderImageUploadBox(adProductPreview, () => adFileRef.current?.click(), 'Upload Product', false, 'min-h-[160px] h-auto w-full max-w-[280px]', 'max-h-[400px] w-full')}

                                                {adProductPreview && (
                                                    /* Edit Bar Overlay */
                                                    <div className="absolute inset-x-0 bottom-0 p-3 bg-black/60 backdrop-blur-md flex items-center gap-3 rounded-b-xl">
                                                        {isEditingAdProduct ? (
                                                            <>
                                                                <input
                                                                    type="text"
                                                                    autoFocus
                                                                    placeholder="Describe product edit..."
                                                                    className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/50 focus:outline-none focus:ring-1 focus:ring-white/30"
                                                                    value={adProductEditPrompt}
                                                                    onChange={e => setAdProductEditPrompt(e.target.value)}
                                                                    onKeyDown={e => e.key === 'Enter' && handleEditAdProductWithGemini()}
                                                                />
                                                                <button
                                                                    onClick={handleEditAdProductWithGemini}
                                                                    disabled={isGeneratingAdProductEdit || !adProductEditPrompt.trim()}
                                                                    className="bg-white text-black px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-200 disabled:opacity-50"
                                                                >
                                                                    {isGeneratingAdProductEdit ? '...' : 'Apply'}
                                                                </button>
                                                                <button
                                                                    onClick={() => { setIsEditingAdProduct(false); setAdProductEditPrompt(''); }}
                                                                    className="text-white/70 hover:text-white p-1"
                                                                >
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <button
                                                                onClick={() => setIsEditingAdProduct(true)}
                                                                className="flex-1 flex items-center gap-2 text-white/90 hover:text-white transition-colors"
                                                            >
                                                                <span className="text-lg">✨</span>
                                                                <span className="text-xs font-medium">Edit product with AI...</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <button
                                                onClick={() => setAssetPickerTarget('product_ad')}
                                                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${isDarkMode
                                                    ? 'border-[#3d3d3f] text-gray-300 hover:bg-white/5'
                                                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                    }`}
                                            >
                                                Select from Assets
                                            </button>
                                            {adProductImage && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setAdProductImage(null);
                                                        if (adProductPreview) URL.revokeObjectURL(adProductPreview);
                                                        setAdProductPreview(null);
                                                        if (adFileRef.current) adFileRef.current.value = '';
                                                        setIsEditingAdProduct(false);
                                                        setAdProductEditPrompt('');
                                                    }}
                                                    className={`text-xs underline text-left ${isDarkMode ? 'text-red-400 hover:text-red-300' : 'text-red-500 hover:text-red-600'}`}
                                                >
                                                    Remove product image
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className={labelClass}>2. Reference Style Images (optional, up to 2)</label>
                                    <input type="file" ref={adRefFileRef} className="hidden" accept="image/*" multiple
                                        onChange={e => {
                                            const files = Array.from(e.target.files || []).slice(0, 2);
                                            setAdRefImages(files);
                                            adRefPreviews.forEach(u => URL.revokeObjectURL(u));
                                            setAdRefPreviews(files.map(f => URL.createObjectURL(f)));
                                        }}
                                    />
                                    <div className="flex items-start gap-4">
                                        <div className="flex gap-3">
                                            {adRefPreviews.map((p, i) => (
                                                <div key={i} className="relative">
                                                    {renderImageUploadBox(p, () => adRefFileRef.current?.click(), '', true)}
                                                </div>
                                            ))}
                                            {adRefPreviews.length < 2 && (
                                                renderImageUploadBox(null, () => adRefFileRef.current?.click(), '+ Ref', true)
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <button
                                                onClick={() => setAssetPickerTarget('product_ad_ref')}
                                                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${isDarkMode
                                                    ? 'border-[#3d3d3f] text-gray-300 hover:bg-white/5'
                                                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                    }`}
                                            >
                                                Select from Assets
                                            </button>
                                            {adRefImages.length > 0 && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setAdRefImages([]);
                                                        adRefPreviews.forEach(u => URL.revokeObjectURL(u));
                                                        setAdRefPreviews([]);
                                                        if (adRefFileRef.current) adRefFileRef.current.value = '';
                                                    }}
                                                    className={`text-xs underline text-left ${isDarkMode ? 'text-gray-500 hover:text-gray-400' : 'text-gray-500 hover:text-gray-700'}`}
                                                >
                                                    Clear refs
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className={labelClass}>3. Ad Copy / Prompt (optional)</label>
                                    <textarea
                                        value={adPrompt}
                                        onChange={e => setAdPrompt(e.target.value)}
                                        placeholder="Describe the ad style, mood, or specific text..."
                                        className={`${inputClass} h-24 resize-none`}
                                    />
                                </div>

                                <div>
                                    <label className={labelClass}>4. Aspect Ratio</label>
                                    {renderAspectSelector(adAspect, setAdAspect)}
                                </div>

                                <button
                                    onClick={handleProductAdGenerate}
                                    disabled={adState.loading || !adProductImage}
                                    className={buttonClass}
                                    style={{ background: activeTool.accent, boxShadow: `0 4px 20px ${activeTool.accent}30` }}
                                >
                                    {adState.loading ? 'Generating...' : 'Generate Product Ad'}
                                </button>

                                {renderVideoOutput(adState, 'product_ad', setAdState)}
                            </div>
                        )}

                        {/* ═════ ANIMATE IMAGE ═════ */}
                        {selectedTool === 'animate_image' && (
                            <div className="space-y-5">
                                <div>
                                    <label className={labelClass}>1. Source Image</label>
                                    <input type="file" ref={animFileRef} className="hidden" accept="image/*"
                                        onChange={e => {
                                            const f = e.target.files?.[0];
                                            if (f) {
                                                setAnimImage(f);
                                                if (animPreview) URL.revokeObjectURL(animPreview);
                                                setAnimPreview(URL.createObjectURL(f));
                                            }
                                        }}
                                    />
                                    <div className="flex items-start gap-4">
                                        <div className="w-32">
                                            {renderImageUploadBox(animPreview, () => animFileRef.current?.click(), 'Upload Image', true)}
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <button
                                                onClick={() => setAssetPickerTarget('animate_image')}
                                                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${isDarkMode
                                                    ? 'border-[#3d3d3f] text-gray-300 hover:bg-white/5'
                                                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                    }`}
                                            >
                                                Select from Assets
                                            </button>
                                            {animImage && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setAnimImage(null);
                                                        if (animPreview) URL.revokeObjectURL(animPreview);
                                                        setAnimPreview(null);
                                                        if (animFileRef.current) animFileRef.current.value = '';
                                                    }}
                                                    className={`text-xs underline text-left ${isDarkMode ? 'text-gray-500 hover:text-gray-400' : 'text-gray-500 hover:text-gray-700'}`}
                                                >
                                                    Remove image
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className={labelClass}>2. Motion Prompt (optional)</label>
                                    <textarea
                                        value={animPrompt}
                                        onChange={e => setAnimPrompt(e.target.value)}
                                        placeholder="Describe the motion you want..."
                                        className={`${inputClass} h-20 resize-none`}
                                    />
                                </div>

                                <div>
                                    <label className={labelClass}>3. Aspect Ratio</label>
                                    {renderAspectSelector(animAspect, setAnimAspect)}
                                </div>

                                <button
                                    onClick={handleAnimateGenerate}
                                    disabled={animState.loading || !animImage}
                                    className={buttonClass}
                                    style={{ background: activeTool.accent, boxShadow: `0 4px 20px ${activeTool.accent}30` }}
                                >
                                    {animState.loading ? 'Animating...' : 'Animate Image'}
                                </button>

                                {renderVideoOutput(animState, 'animate_image', setAnimState)}
                            </div>
                        )}

                        {/* ═════ IN MY HEAD (EDIT VIDEO) ═════ */}
                        {selectedTool === 'in_my_head' && (
                            <div className="space-y-6">
                                <div>
                                    <label className={labelClass}>1. Video to Edit</label>
                                    <div className="space-y-3">
                                        <input
                                            type="text"
                                            value={editVideoUrl}
                                            onChange={e => setEditVideoUrl(e.target.value)}
                                            placeholder="Paste video URL..."
                                            className={inputClass}
                                        />
                                        <div className="flex items-center gap-3">
                                            <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>or</span>
                                            <input type="file" ref={editVideoFileRef} className="hidden" accept="video/*"
                                                onChange={e => {
                                                    const f = e.target.files?.[0];
                                                    if (f) {
                                                        setEditVideoFile(f);
                                                        if (editVideoPreview) URL.revokeObjectURL(editVideoPreview);
                                                        const objUrl = URL.createObjectURL(f);
                                                        setEditVideoPreview(objUrl);
                                                        setEditVideoUrl('');

                                                        // Auto-extract first frame
                                                        handleExtractFirstFrame(objUrl);
                                                    }
                                                }}
                                            />
                                            <button
                                                onClick={() => editVideoFileRef.current?.click()}
                                                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${isDarkMode ? 'border-[#3d3d3f] text-gray-300 hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                    }`}
                                            >
                                                Upload Video
                                            </button>
                                            <button
                                                onClick={() => setAssetPickerTarget('in_my_head_video')}
                                                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${isDarkMode ? 'border-[#3d3d3f] text-gray-300 hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                    }`}
                                            >
                                                Assets
                                            </button>
                                            {editVideoFile && (
                                                <span className={`text-xs truncate max-w-[200px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                    {editVideoFile.name}
                                                </span>
                                            )}
                                        </div>
                                        {editVideoPreview && (
                                            <video src={editVideoPreview} controls className={`rounded-xl max-h-[200px] border ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`} />
                                        )}
                                    </div>
                                </div>



                                <div>
                                    <label className={labelClass}>2. Reference Image (Optional)</label>
                                    <p className={`text-xs mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                        Upload a reference image to guide the edit. AI will auto-select the best engine & mode.
                                    </p>
                                    <input type="file" ref={editFirstFrameRef} className="hidden" accept="image/*"
                                        onChange={e => {
                                            const f = e.target.files?.[0];
                                            if (f) {
                                                setEditFirstFrameFile(f);
                                                if (editFirstFramePreview) URL.revokeObjectURL(editFirstFramePreview);
                                                setEditFirstFramePreview(URL.createObjectURL(f));
                                            }
                                        }}
                                    />
                                    <div className="flex flex-col gap-4">
                                        <div className="w-full max-w-[600px] relative group border rounded-xl overflow-hidden bg-black/5">
                                            {/* Image Preview / Upload Box - LARGE (600px) */}
                                            {renderImageUploadBox(
                                                editFirstFramePreview,
                                                () => editFirstFrameRef.current?.click(),
                                                'Upload Image used as First Frame',
                                                false,
                                                'w-full h-auto min-h-[300px] flex items-center justify-center p-0', // Container: auto height, min 300px
                                                'w-full h-auto max-h-[600px] object-contain' // Image: max width 600px, responsive height
                                            )}



                                            {/* Chat-Style Edit Overlay - Always Visible */}
                                            {editFirstFrameFile && (
                                                <div className="absolute left-0 right-0 bottom-0 bg-black/40 backdrop-blur-md border-t border-white/10 p-3 z-20 flex items-center gap-3 animate-slideUp">
                                                    <div className="flex-1 relative">
                                                        <input
                                                            type="text"
                                                            value={frameEditPrompt}
                                                            onChange={e => setFrameEditPrompt(e.target.value)}
                                                            placeholder="Describe changes (e.g. 'remove text', 'make sky blue')..."
                                                            className="w-full bg-transparent text-sm text-white placeholder-white/60 border-none focus:ring-0 p-0 font-medium h-9"
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' && frameEditPrompt.trim()) {
                                                                    handleEditFrameWithGemini();
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => handleEditFrameWithGemini()}
                                                            disabled={!frameEditPrompt.trim() || isGeneratingFrameEdit}
                                                            className="px-4 py-1.5 bg-white text-black text-sm font-semibold rounded-full hover:bg-gray-200 disabled:opacity-50 transition-colors shadow-sm flex items-center gap-2"
                                                        >
                                                            {isGeneratingFrameEdit ? (
                                                                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                                                            ) : (
                                                                'Edit'
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Action Buttons Row (Below Image/Edit Panel) */}
                                            <div className="flex flex-wrap items-center gap-3">
                                                <button
                                                    onClick={() => setAssetPickerTarget('in_my_head')}
                                                    className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${isDarkMode
                                                        ? 'border-[#3d3d3f] text-gray-300 hover:bg-white/5'
                                                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                        }`}
                                                >
                                                    Select from Assets
                                                </button>

                                                {(editVideoFile || editVideoUrl || editVideoPreview) && !editFirstFrameFile && (
                                                    <button
                                                        onClick={() => handleExtractFirstFrame()}
                                                        disabled={isExtractingFrame}
                                                        className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all flex items-center justify-center gap-2 ${isDarkMode
                                                            ? 'border-[#3d3d3f] text-gray-300 hover:bg-white/5'
                                                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                            }`}
                                                    >
                                                        {isExtractingFrame ? (
                                                            <>
                                                                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                                                Extracting...
                                                            </>
                                                        ) : (
                                                            'Use First Frame'
                                                        )}
                                                    </button>
                                                )}

                                                {editFirstFrameFile && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditFirstFrameFile(null);
                                                            if (editFirstFramePreview) URL.revokeObjectURL(editFirstFramePreview);
                                                            setEditFirstFramePreview(null);
                                                            if (editFirstFrameRef.current) editFirstFrameRef.current.value = '';
                                                            setIsEditingFrame(false);
                                                        }}
                                                        className={`text-sm underline px-2 ${isDarkMode ? 'text-red-400 hover:text-red-300' : 'text-red-500 hover:text-red-600'}`}
                                                    >
                                                        Remove Image
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <label className={labelClass}>3. Edit Prompt</label>
                                            <textarea
                                                value={editPrompt}
                                                onChange={e => setEditPrompt(e.target.value)}
                                                placeholder="Describe the edit — e.g. 'Replace the background with a sunset beach'"
                                                className={`${inputClass} h-24 resize-none`}
                                            />
                                        </div>

                                        {/* AI Routing Decision Display */}
                                        {editRouting && (
                                            <div className={`mt-3 p-3 rounded-xl border text-xs ${isDarkMode
                                                ? 'border-[#3d3d3f] bg-[#1d1d1f]/60'
                                                : 'border-gray-200 bg-gray-50'
                                                }`}>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className={`font-semibold ${isDarkMode ? 'text-[#0a84ff]' : 'text-blue-600'}`}>
                                                        {editRouting.engine === 'xai' ? '⚡ Grok (xAI)' : `🌙 Luma (${editRouting.lumaMode || 'flex_1'})`}
                                                    </span>
                                                </div>
                                                <p className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>
                                                    {editRouting.reasoning}
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    <button
                                        onClick={handleEditGenerate}
                                        disabled={editState.loading || (!editVideoUrl.trim() && !editVideoFile) || !editPrompt.trim()}
                                        className={buttonClass}
                                        style={{ background: activeTool.accent, boxShadow: `0 4px 20px ${activeTool.accent}30` }}
                                    >
                                        {editState.loading ? 'Processing...' : 'Edit Video'}
                                    </button>

                                    {renderVideoOutput(editState, 'in_my_head', setEditState)}
                                </div>
                            </div>
                        )}

                        {/* ═════ MUSIC VIDEO ═════ */}
                        {selectedTool === 'music_video' && (
                            <div className="space-y-5">
                                {/* Mode Toggle: Upload vs Generate */}
                                <div className={`flex rounded-xl overflow-hidden border ${isDarkMode ? 'border-white/[0.08]' : 'border-gray-200'}`}>
                                    <button
                                        onClick={() => setSunoMode('generate')}
                                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold transition-all duration-200 ${sunoMode === 'generate'
                                            ? isDarkMode
                                                ? 'bg-emerald-500/20 text-emerald-400 border-r border-white/[0.08]'
                                                : 'bg-emerald-50 text-emerald-700 border-r border-gray-200'
                                            : isDarkMode
                                                ? 'bg-white/[0.02] text-gray-500 hover:text-gray-300 border-r border-white/[0.08]'
                                                : 'bg-gray-50/50 text-gray-400 hover:text-gray-600 border-r border-gray-200'
                                            }`}
                                    >
                                        <span>✨</span> Generate with AI
                                    </button>
                                    <button
                                        onClick={() => setSunoMode('upload')}
                                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold transition-all duration-200 ${sunoMode === 'upload'
                                            ? isDarkMode
                                                ? 'bg-emerald-500/20 text-emerald-400'
                                                : 'bg-emerald-50 text-emerald-700'
                                            : isDarkMode
                                                ? 'bg-white/[0.02] text-gray-500 hover:text-gray-300'
                                                : 'bg-gray-50/50 text-gray-400 hover:text-gray-600'
                                            }`}
                                    >
                                        <span>📁</span> Upload Audio
                                    </button>
                                </div>

                                {/* ── GENERATE WITH AI (Suno) ── */}
                                {sunoMode === 'generate' && (
                                    <div className="space-y-4">
                                        {/* Song Description */}
                                        <div>
                                            <label className={labelClass}>1. Song Description</label>
                                            <textarea
                                                value={sunoPrompt}
                                                onChange={e => setSunoPrompt(e.target.value)}
                                                placeholder="Describe the song — e.g. 'A dreamy lo-fi track about late night coding sessions'"
                                                className={`${inputClass} h-24 resize-none`}
                                            />
                                        </div>

                                        {/* Style / Genre */}
                                        <div>
                                            <label className={labelClass}>2. Style / Genre (optional)</label>
                                            <input
                                                type="text"
                                                value={sunoStyle}
                                                onChange={e => setSunoStyle(e.target.value)}
                                                placeholder="e.g. lo-fi, ambient, hip-hop, cinematic, pop"
                                                className={inputClass}
                                            />
                                        </div>

                                        {/* Options Row */}
                                        <div className="flex gap-3">
                                            <div className="flex-1">
                                                <label className={labelClass}>Title (optional)</label>
                                                <input
                                                    type="text"
                                                    value={sunoTitle}
                                                    onChange={e => setSunoTitle(e.target.value)}
                                                    placeholder="Song title"
                                                    className={inputClass}
                                                />
                                            </div>
                                            <div className="flex items-end pb-1">
                                                <button
                                                    onClick={() => setSunoInstrumental(!sunoInstrumental)}
                                                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border ${sunoInstrumental
                                                        ? isDarkMode
                                                            ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                                                            : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                                        : isDarkMode
                                                            ? 'bg-white/[0.03] border-white/[0.08] text-gray-400 hover:text-gray-200'
                                                            : 'bg-gray-50 border-gray-200 text-gray-500 hover:text-gray-700'
                                                        }`}
                                                >
                                                    🎵 Instrumental
                                                </button>
                                            </div>
                                        </div>

                                        {/* Lyrics Section */}
                                        {!sunoInstrumental && (
                                            <div>
                                                <div className="flex items-center justify-between mb-1">
                                                    <label className={labelClass}>3. Lyrics (optional)</label>
                                                    <button
                                                        onClick={handleSunoGenerateLyrics}
                                                        disabled={sunoLyricsLoading || !sunoPrompt.trim()}
                                                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all duration-200 ${sunoLyricsLoading
                                                            ? isDarkMode ? 'text-gray-500' : 'text-gray-400'
                                                            : isDarkMode
                                                                ? 'text-emerald-400 hover:bg-emerald-500/10'
                                                                : 'text-emerald-600 hover:bg-emerald-50'
                                                            }`}
                                                    >
                                                        {sunoLyricsLoading ? '⏳ Generating...' : '✨ Generate Lyrics'}
                                                    </button>
                                                </div>
                                                <textarea
                                                    value={sunoLyrics}
                                                    onChange={e => setSunoLyrics(e.target.value)}
                                                    placeholder="Write lyrics or click 'Generate Lyrics' to auto-create them from your description..."
                                                    className={`${inputClass} h-32 resize-none font-mono text-xs`}
                                                />
                                            </div>
                                        )}

                                        {/* ── Reference Images for Music Video ── */}
                                        <div>
                                            <label className={labelClass}>Reference Images (optional)</label>
                                            <p className={`text-xs mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                Upload photos of faces, logos, or scenes to use as reference in the generated music video (up to 4).
                                            </p>
                                            <div className="flex flex-wrap gap-2">
                                                {mvRefPreviews.map((preview, i) => (
                                                    <div key={i} className="relative group">
                                                        <img
                                                            src={preview}
                                                            alt={`Ref ${i + 1}`}
                                                            className={`w-16 h-16 object-cover rounded-lg border ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}
                                                        />
                                                        <button
                                                            onClick={() => {
                                                                URL.revokeObjectURL(preview);
                                                                setMvRefImages(imgs => imgs.filter((_, idx) => idx !== i));
                                                                setMvRefPreviews(ps => ps.filter((_, idx) => idx !== i));
                                                            }}
                                                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                                {mvRefImages.length < 4 && (
                                                    <label className={`w-16 h-16 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer transition-all ${isDarkMode ? 'border-white/10 hover:border-white/20 text-gray-500' : 'border-gray-300 hover:border-gray-400 text-gray-400'}`}>
                                                        <span className="text-xl">+</span>
                                                        <input
                                                            type="file"
                                                            accept="image/jpeg,image/png,image/jpg"
                                                            multiple
                                                            className="hidden"
                                                            onChange={(e) => {
                                                                const files = Array.from(e.target.files || []).slice(0, 4 - mvRefImages.length);
                                                                if (files.length === 0) return;
                                                                setMvRefImages(prev => [...prev, ...files]);
                                                                setMvRefPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))]);
                                                                e.target.value = '';
                                                            }}
                                                        />
                                                    </label>
                                                )}
                                            </div>
                                        </div>

                                        {/* Error Display */}
                                        {mvState.error && (
                                            <div className={`p-3 rounded-xl text-sm ${isDarkMode ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                                                {mvState.error}
                                            </div>
                                        )}

                                        {/* Generate Music Video Button */}
                                        <button
                                            onClick={handleGenerateFullMusicVideo}
                                            disabled={mvState.loading || !sunoPrompt.trim()}
                                            className={buttonClass}
                                            style={{ background: activeTool.accent, boxShadow: `0 4px 20px ${activeTool.accent}30` }}
                                        >
                                            {mvState.loading ? (mvState.status || 'Generating...') : '🎬 Generate Music Video'}
                                        </button>

                                        {/* Music Video Pipeline Output */}
                                        {mvState.videoUrl && !mvState.loading && (
                                            <div className="space-y-2">
                                                <p className={`text-xs font-semibold ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                                                    ✅ Music video ready!
                                                </p>
                                                <video
                                                    src={mvState.videoUrl}
                                                    controls
                                                    className="w-full rounded-lg"
                                                    style={{ maxHeight: '300px' }}
                                                />
                                                <a
                                                    href={mvState.videoUrl}
                                                    download="music-video.mp4"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
                                                >
                                                    ⬇ Download Video
                                                </a>
                                                {onShare && (
                                                    <button
                                                        onClick={() => handleShareVideoState(mvState as ToolState, 'music_video', setMvState as React.Dispatch<React.SetStateAction<ToolState>>)}
                                                        disabled={mvState.isSharing}
                                                        className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 ${isDarkMode
                                                            ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
                                                            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
                                                            }`}
                                                    >
                                                        {mvState.isSharing ? 'Saving...' : '🚀 Share'}
                                                    </button>
                                                )}
                                            </div>

                                        )}

                                        {/* Generated Songs */}
                                        {sunoGeneratedSongs.length > 0 && (
                                            <div className="space-y-3">
                                                <label className={labelClass}>Generated Songs</label>
                                                {sunoGeneratedSongs.map((song, idx) => (
                                                    <div
                                                        key={song.id || idx}
                                                        className={`rounded-xl overflow-hidden border transition-all duration-200 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.02]' : 'border-gray-200 bg-gray-50/50'
                                                            }`}
                                                    >
                                                        <div className="flex items-start gap-3 p-4">
                                                            {/* Cover Art */}
                                                            {song.image_url && (
                                                                <img
                                                                    src={song.image_url}
                                                                    alt={song.title || 'Song cover'}
                                                                    className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                                                                />
                                                            )}
                                                            <div className="flex-1 min-w-0">
                                                                <p className={`font-semibold text-sm truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                    {song.title || `Song ${idx + 1}`}
                                                                </p>
                                                                {song.style && (
                                                                    <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                                        {song.style}
                                                                    </p>
                                                                )}
                                                                {song.duration > 0 && (
                                                                    <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                                        {Math.floor(song.duration / 60)}:{String(Math.floor(song.duration % 60)).padStart(2, '0')}
                                                                    </p>
                                                                )}

                                                                {/* Scrubber / Progress Bar */}
                                                                {sunoPlayingId === song.id && (
                                                                    <div className="mt-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                                                        <span className={`text-[10px] font-mono tabular-nums ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                                            {Math.floor(sunoCurrentTime / 60)}:{String(Math.floor(sunoCurrentTime % 60)).padStart(2, '0')}
                                                                        </span>
                                                                        <input
                                                                            type="range"
                                                                            min={0}
                                                                            max={song.duration || sunoAudioRef.current?.duration || 0}
                                                                            value={sunoCurrentTime}
                                                                            onChange={(e) => {
                                                                                const time = parseFloat(e.target.value);
                                                                                setSunoCurrentTime(time);
                                                                                if (sunoAudioRef.current) {
                                                                                    sunoAudioRef.current.currentTime = time;
                                                                                }
                                                                            }}
                                                                            className="flex-1 h-1 rounded-lg appearance-none cursor-pointer accent-emerald-500 bg-gray-200 dark:bg-white/10"
                                                                        />
                                                                        <span className={`text-[10px] font-mono tabular-nums ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                                            {Math.floor(song.duration / 60)}:{String(Math.floor(song.duration % 60)).padStart(2, '0')}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                                {/* Play/Pause */}
                                                                {song.audio_url && (
                                                                    <button
                                                                        onClick={() => {
                                                                            if (sunoPlayingId === song.id) {
                                                                                sunoAudioRef.current?.pause();
                                                                                setSunoPlayingId(null);
                                                                            } else {
                                                                                if (sunoAudioRef.current) {
                                                                                    sunoAudioRef.current.src = song.audio_url;
                                                                                    sunoAudioRef.current.play();
                                                                                }
                                                                                setSunoPlayingId(song.id);
                                                                            }
                                                                        }}
                                                                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
                                                                    >
                                                                        {sunoPlayingId === song.id ? '⏸' : '▶'}
                                                                    </button>
                                                                )}
                                                                {/* Download */}
                                                                {song.audio_url && (
                                                                    <a
                                                                        href={song.audio_url}
                                                                        download={`${song.title || 'suno-song'}.mp3`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
                                                                    >
                                                                        ⬇
                                                                    </a>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {/* Lyrics accordion */}
                                                        {song.lyrics && (
                                                            <details className={`border-t ${isDarkMode ? 'border-white/[0.06]' : 'border-gray-200'}`}>
                                                                <summary className={`px-4 py-2 text-xs font-medium cursor-pointer ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>
                                                                    View Lyrics
                                                                </summary>
                                                                <pre className={`px-4 pb-3 text-xs whitespace-pre-wrap font-mono ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                                    {song.lyrics}
                                                                </pre>
                                                            </details>
                                                        )}

                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Hidden audio element for playback */}
                                        <audio
                                            ref={sunoAudioRef}
                                            onEnded={() => {
                                                setSunoPlayingId(null);
                                                setSunoCurrentTime(0);
                                            }}
                                            onTimeUpdate={(e) => setSunoCurrentTime(e.currentTarget.currentTime)}
                                            style={{ display: 'none' }}
                                        />
                                    </div>
                                )}

                                {/* ── UPLOAD AUDIO (existing) ── */}
                                {sunoMode === 'upload' && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className={labelClass}>1. Audio File</label>
                                            <input
                                                type="file"
                                                accept="audio/*,audio/mp3,audio/mpeg,audio/wav,audio/x-wav,audio/x-m4a,audio/mp4,.mp3,.wav,.m4a,.m4v"
                                                onChange={handleAudioUpload}
                                                className="hidden"
                                                id="audio-upload"
                                            />
                                            <label
                                                htmlFor="audio-upload"
                                                className={`flex items-center gap-3 p-4 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${isDarkMode
                                                    ? 'border-white/[0.08] hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.04]'
                                                    : 'border-gray-200 hover:border-gray-300 bg-gray-50/30 hover:bg-gray-50/60'
                                                    }`}
                                            >
                                                <span className="text-2xl">🎧</span>
                                                <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                    {audioName || 'Upload audio file (MP3, WAV, etc.)'}
                                                </span>
                                            </label>
                                        </div>

                                        {audioUrl && (
                                            <>
                                                <div>
                                                    <label className={labelClass}>2. Waveform</label>
                                                    <div className={`rounded-xl overflow-hidden border ${isDarkMode ? 'border-white/10 bg-black' : 'border-gray-200 bg-gray-900'}`}>
                                                        <canvas
                                                            ref={canvasRef}
                                                            width={600}
                                                            height={200}
                                                            className="w-full h-[200px]"
                                                        />
                                                    </div>
                                                </div>

                                                <audio ref={audioRef} src={audioUrl} onEnded={() => { setIsPlaying(false); cancelAnimationFrame(animFrameRef.current); }} />

                                                <button
                                                    onClick={togglePlayback}
                                                    className={buttonClass}
                                                    style={{ background: activeTool.accent, boxShadow: `0 4px 20px ${activeTool.accent}30` }}
                                                >
                                                    {isPlaying ? '⏸ Pause' : '▶ Play & Visualize'}
                                                </button>
                                            </>
                                        )}

                                        {/* Generate Video Button for Uploaded Audio */}
                                        {audioUrl && (
                                            <div className={`border-t pt-4 mt-4 ${isDarkMode ? 'border-white/[0.06]' : 'border-gray-200'}`}>

                                                {/* ── Visual Prompt (Manual) ── */}
                                                <div className="mb-4">
                                                    <label className={labelClass}>3. Visual Prompt (optional)</label>
                                                    <textarea
                                                        value={mvUploadPrompt}
                                                        onChange={e => setMvUploadPrompt(e.target.value)}
                                                        placeholder="Describe the scenes you want to generate (overrides AI analysis)..."
                                                        className={`${inputClass} h-20 resize-none text-sm`}
                                                    />
                                                </div>

                                                {/* ── Reference Images for Uploaded Audio ── */}
                                                <div className="mb-6">
                                                    <label className={labelClass}>4. Reference Images (optional)</label>
                                                    <p className={`text-xs mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                        Upload photos of faces, logos, or scenes to use as reference in the generated music video (up to 4).
                                                    </p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {mvRefPreviews.map((preview, i) => (
                                                            <div key={i} className="relative group">
                                                                <img
                                                                    src={preview}
                                                                    alt={`Ref ${i + 1}`}
                                                                    className={`w-16 h-16 object-cover rounded-lg border ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}
                                                                />
                                                                <button
                                                                    onClick={() => {
                                                                        URL.revokeObjectURL(preview);
                                                                        setMvRefImages(imgs => imgs.filter((_, idx) => idx !== i));
                                                                        setMvRefPreviews(ps => ps.filter((_, idx) => idx !== i));
                                                                    }}
                                                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        ))}
                                                        {mvRefImages.length < 4 && (
                                                            <label className={`w-16 h-16 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer transition-all ${isDarkMode ? 'border-white/10 hover:border-white/20 text-gray-500' : 'border-gray-300 hover:border-gray-400 text-gray-400'}`}>
                                                                <span className="text-xl">+</span>
                                                                <input
                                                                    type="file"
                                                                    accept="image/jpeg,image/png,image/jpg"
                                                                    multiple
                                                                    className="hidden"
                                                                    onChange={(e) => {
                                                                        const files = Array.from(e.target.files || []).slice(0, 4 - mvRefImages.length);
                                                                        if (files.length === 0) return;
                                                                        setMvRefImages(prev => [...prev, ...files]);
                                                                        setMvRefPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))]);
                                                                        e.target.value = '';
                                                                    }}
                                                                />
                                                            </label>
                                                        )}
                                                    </div>
                                                </div>

                                                {mvState.songId === audioName && mvState.videoUrl && !mvState.loading ? (
                                                    <div className="space-y-2">
                                                        <p className={`text-xs font-semibold ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                                                            ✅ {mvState.status || 'Music video ready!'}
                                                        </p>
                                                        <video
                                                            src={mvState.videoUrl}
                                                            controls
                                                            className="w-full rounded-lg"
                                                            style={{ maxHeight: '300px' }}
                                                        />
                                                        <a
                                                            href={mvState.videoUrl}
                                                            download={`${audioName || 'music-video'}.mp4`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
                                                        >
                                                            ⬇ Download Video
                                                        </a>
                                                        {onShare && (
                                                            <button
                                                                onClick={() => handleShareVideoState(mvState as ToolState, 'music_video', setMvState as React.Dispatch<React.SetStateAction<ToolState>>, mvUploadPrompt.trim() || 'Uploaded Audio Music Video')}
                                                                disabled={mvState.isSharing}
                                                                className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 ${isDarkMode
                                                                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
                                                                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
                                                                    }`}
                                                            >
                                                                {mvState.isSharing ? 'Saving...' : '🚀 Share'}
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : mvState.songId === audioName && mvState.loading ? (
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${isDarkMode ? 'border-emerald-400' : 'border-emerald-600'}`} />
                                                        <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                            {mvState.status || 'Generating music video...'}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <button
                                                            onClick={() => handleGenerateMusicVideo({
                                                                audioUrl: audioUrl,
                                                                id: audioName, // Use filename as ID for upload
                                                                title: audioName,
                                                                style: 'uploaded audio',
                                                                duration: audioRef.current?.duration,
                                                                manualPrompt: mvUploadPrompt.trim() || undefined,
                                                                audioFile: audioFile || undefined
                                                            })}
                                                            disabled={mvState.loading}
                                                            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${isDarkMode
                                                                ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30 text-white border border-purple-500/20'
                                                                : 'bg-gradient-to-r from-purple-50 to-pink-50 hover:from-purple-100 hover:to-pink-100 text-purple-700 border border-purple-200'
                                                                }`}
                                                        >
                                                            🎬 Generate Music Video from Audio
                                                        </button>
                                                        {mvState.songId === audioName && mvState.error && (
                                                            <p className={`mt-2 text-xs ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>
                                                                {mvState.error}
                                                            </p>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}


                        {/* ═════ VIDEO OVERVIEW ═════ */}
                        {selectedTool === 'overview' && (
                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <label className={labelClass}>0. Video Avatar (Optional)</label>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div
                                            onClick={() => {
                                                setOverviewAvatarFile(null);
                                                setOverviewAvatarPreview(null);
                                                if (overviewAvatarRef.current) overviewAvatarRef.current.value = '';
                                            }}
                                            className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col items-center justify-center gap-2 group ${!overviewAvatarFile
                                                ? (isDarkMode ? 'border-orange-500/50 bg-orange-500/10' : 'border-orange-200 bg-orange-50')
                                                : (isDarkMode ? 'border-white/10 hover:border-white/20 bg-white/[0.02]' : 'border-gray-200 hover:border-gray-300 bg-gray-50/50')
                                                }`}
                                        >
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center text-lg shadow-lg">🤖</div>
                                            <span className={`text-xs font-bold ${!overviewAvatarFile ? (isDarkMode ? 'text-orange-400' : 'text-orange-600') : (isDarkMode ? 'text-gray-400 group-hover:text-gray-200' : 'text-gray-500 group-hover:text-gray-800')}`}>AI Default</span>
                                        </div>

                                        <div
                                            onClick={() => overviewAvatarRef.current?.click()}
                                            className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col items-center justify-center gap-2 group ${overviewAvatarFile
                                                ? (isDarkMode ? 'border-orange-500/50 bg-orange-500/10' : 'border-orange-200 bg-orange-50')
                                                : (isDarkMode ? 'border-white/10 hover:border-white/20 bg-white/[0.02]' : 'border-gray-200 hover:border-gray-300 bg-gray-50/50')
                                                }`}
                                        >
                                            {overviewAvatarPreview ? (
                                                <img src={overviewAvatarPreview} className="w-10 h-10 rounded-full object-cover shadow-lg border-2 border-orange-500" alt="Avatar" />
                                            ) : (
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 border-dashed ${isDarkMode ? 'border-gray-600 text-gray-500' : 'border-gray-300 text-gray-400'}`}>
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                                </div>
                                            )}
                                            <span className={`text-xs font-bold ${overviewAvatarFile ? (isDarkMode ? 'text-orange-400' : 'text-orange-600') : (isDarkMode ? 'text-gray-400 group-hover:text-gray-200' : 'text-gray-500 group-hover:text-gray-800')}`}>
                                                {overviewAvatarFile ? 'Custom Face' : 'Upload Face'}
                                            </span>
                                        </div>
                                    </div>
                                    <input
                                        type="file"
                                        ref={overviewAvatarRef}
                                        className="hidden"
                                        accept="image/png,image/jpeg,image/webp"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                setOverviewAvatarFile(file);
                                                setOverviewAvatarPreview(URL.createObjectURL(file));
                                            }
                                        }}
                                    />
                                    <p className={`text-[10px] leading-tight ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                        Upload a clear, front-facing photo. Kling AI will animate this face.
                                    </p>
                                </div>

                                <div>
                                    <label className={labelClass}>0.5 Narrator Voice (Optional)</label>
                                    <div className={`p-4 rounded-xl border transition-all ${isDarkMode ? 'bg-white/[0.02] border-white/10' : 'bg-gray-50/50 border-gray-200'}`}>
                                        <div className="flex items-center justify-between">
                                            <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>Use my own voice</span>
                                            <input type="checkbox" checked={overviewUseClonedVoice} onChange={e => setOverviewUseClonedVoice(e.target.checked)} className="w-4 h-4 rounded accent-[#ea580c] cursor-pointer border-gray-300" />
                                        </div>
                                        {overviewUseClonedVoice && (
                                            <div className="space-y-3 mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-gray-700">
                                                <input type="file" ref={overviewVoiceRef} className="hidden" accept="audio/*,audio/mp3,audio/mpeg,audio/wav,audio/x-wav,audio/x-m4a,audio/mp4,.mp3,.wav,.m4a,.m4v" onChange={(e) => {
                                                    if (e.target.files?.[0]) setOverviewVoiceFile(e.target.files[0]);
                                                    setOverviewClonedVoiceId(null);
                                                    if (overviewVoicePreviewUrl) URL.revokeObjectURL(overviewVoicePreviewUrl);
                                                }} />
                                                <div className="flex items-center gap-3">
                                                    <button onClick={() => overviewVoiceRef.current?.click()} className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${isDarkMode ? 'border-gray-600 hover:bg-white/5 text-gray-300' : 'border-gray-300 hover:bg-gray-100 text-gray-700'}`}>
                                                        {overviewVoiceFile ? 'Change Audio File' : 'Upload Voice Audio'}
                                                    </button>
                                                    {overviewVoiceFile && <span className={`text-xs truncate max-w-[120px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{overviewVoiceFile.name}</span>}
                                                </div>
                                                {overviewVoiceFile && !overviewClonedVoiceId && (
                                                    <button onClick={handleCloneVoice} disabled={overviewIsCloningVoice} className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all ${isDarkMode ? 'bg-[#ea580c]/20 text-[#ea580c] border border-[#ea580c]/30 hover:bg-[#ea580c]/30' : 'bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100'}`}>
                                                        {overviewIsCloningVoice ? 'Cloning Voice ⏳' : 'Clone Voice 🎙️'}
                                                    </button>
                                                )}
                                                {overviewClonedVoiceId && (
                                                    <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 p-2.5 rounded-xl">
                                                        <span className="text-xs text-green-600 dark:text-green-400 font-bold flex-1">✅ Voice Cloned Successfully</span>
                                                        <button onClick={handlePreviewClonedVoice} disabled={overviewIsPreviewingVoice} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isDarkMode ? 'bg-[#ea580c] hover:bg-[#ea580c]/90 text-white shadow-lg' : 'bg-orange-600 hover:bg-orange-700 text-white shadow-md'}`}>
                                                            {overviewIsPreviewingVoice ? 'Generating...' : '▶ Preview'}
                                                        </button>
                                                    </div>
                                                )}
                                                {overviewVoicePreviewUrl && (
                                                    <audio src={overviewVoicePreviewUrl} controls className="w-full h-10 mt-2 rounded-lg" />
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <label className={labelClass}>1. What should this video be about?</label>
                                    <textarea
                                        value={overviewPrompt}
                                        onChange={e => setOverviewPrompt(e.target.value)}
                                        placeholder="e.g. A professional overview of our project features and market fit..."
                                        className={`${inputClass} h-24 resize-none`}
                                    />
                                    <p className={`text-[10px] mt-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                        Tip: We'll use your project context, notes, and knowledge base to generate a script and voiceover.
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                    <div>
                                        <label className={labelClass}>2. Number of Slides</label>
                                        <div className="flex items-center gap-4">
                                            <input
                                                type="range"
                                                min="4"
                                                max="15"
                                                step="1"
                                                value={overviewSlides}
                                                onChange={e => setOverviewSlides(parseInt(e.target.value))}
                                                className="flex-1 accent-[#ea580c]"
                                            />
                                            <span className={`text-sm font-mono w-8 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{overviewSlides}</span>
                                        </div>
                                    </div>
                                </div>

                                <button
                                    onClick={handleOverviewGenerate}
                                    disabled={overviewState.loading || !overviewPrompt.trim()}
                                    className={buttonClass}
                                    style={{ background: activeTool.accent, boxShadow: `0 4px 20px ${activeTool.accent}30` }}
                                >
                                    <div className="flex items-center justify-center gap-2">
                                        {overviewState.loading ? (
                                            <>
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                <span>{overviewState.status || 'Generating...'}</span>
                                            </>
                                        ) : (
                                            <>
                                                <span>🌍</span>
                                                <span>Generate Overview Video</span>
                                            </>
                                        )}
                                    </div>
                                </button>

                                {overviewState.loading && overviewProgress !== null && (
                                    <div className={`w-full rounded-full h-1.5 overflow-hidden ${isDarkMode ? 'bg-white/[0.06]' : 'bg-gray-200'}`}>
                                        <div
                                            className="h-full transition-all duration-1000 ease-out rounded-full"
                                            style={{ width: `${overviewProgress}%`, background: activeTool.accent }}
                                        />
                                    </div>
                                )}

                                {renderVideoOutput(overviewState, 'overview', setOverviewState)}

                                {overviewState.error && (
                                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs text-center">
                                        {overviewState.error}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>{/* end workspace content */}
                </div>{/* end workspace */}
            </div>{/* end flex sidebar+workspace */}

            {/* Safelist for dynamic theme classes that might be purged */}
            <div className="hidden bg-orange-600 hover:bg-orange-700 bg-emerald-600 hover:bg-emerald-700 bg-sky-600 hover:bg-sky-700 bg-violet-600 hover:bg-violet-700 bg-amber-600 hover:bg-amber-700 bg-pink-600 hover:bg-pink-700" />


            {/* Asset Picker Modal */}
            {
                assetPickerTarget && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                        onClick={() => setAssetPickerTarget(null)}
                    >
                        <div className={`w-full max-w-4xl max-h-[80vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col ${isDarkMode ? 'bg-[#1d1d1f] border border-[#3d3d3f]' : 'bg-white border border-gray-200'}`}
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className={`px-6 py-4 border-b flex items-center justify-between ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                                <div>
                                    <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                        {assetPickerTarget === 'in_my_head_video' ? 'Select Source Video' : 'Select Reference Image'}
                                    </h3>
                                    <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Choose from your project assets</p>
                                </div>
                                <button onClick={() => setAssetPickerTarget(null)} className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>

                            {/* Search */}
                            <div className={`px-6 py-3 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                                <input
                                    type="text"
                                    placeholder="Search assets..."
                                    value={assetSearch}
                                    onChange={e => setAssetSearch(e.target.value)}
                                    className={`w-full px-4 py-2 rounded-xl text-sm border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-black/50 border-[#3d3d3f] text-white focus:ring-[#0a84ff]/50' : 'bg-gray-50 border-gray-200 text-gray-900 focus:ring-blue-500/50'}`}
                                />
                            </div>

                            {/* Grid */}
                            <div className="flex-1 overflow-y-auto p-6">
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                    {(() => {
                                        // Collect all image assets
                                        // Collect assets based on target type
                                        const targetType = assetPickerTarget === 'in_my_head_video' ? 'video' : 'image';
                                        const allAssets: { url: string; name: string; id: string; type: string }[] = [];
                                        const seenUrls = new Set<string>();

                                        const addAsset = (url: string | undefined, name: string, id: string, type: string) => {
                                            if (!url) return;
                                            if (seenUrls.has(url)) return;

                                            // Filter based on target type
                                            const isVideoTarget = targetType === 'video';

                                            let isMatch = false;
                                            if (isVideoTarget) {
                                                if (type === 'video') isMatch = true;
                                                if (type.startsWith('video/')) isMatch = true;
                                            } else {
                                                // Image target
                                                if (type.startsWith('image/')) isMatch = true;
                                                if (['header', 'slide', 'social', 'notemap', 'world', 'blog'].includes(type) && !type.startsWith('video')) isMatch = true;
                                            }

                                            if (isMatch) {
                                                seenUrls.add(url);
                                                allAssets.push({ url, name, id, type });
                                            }
                                        };

                                        // 1. Project Level Uploads
                                        (project.uploadedFiles || []).forEach(f => {
                                            addAsset(f.url, f.name, f.id || f.name, f.mimeType || 'doc');
                                        });

                                        // 2. Knowledge Base (often same as uploaded files but worth checking)
                                        (project.knowledgeBase || []).forEach(f => {
                                            addAsset(f.url, f.name, f.id, f.type);
                                        });

                                        // 3. Research Sessions & Generated Assets
                                        (project.researchSessions || []).forEach(session => {
                                            // Session Uploads
                                            (session.uploadedFiles || []).forEach(f => {
                                                addAsset(f.url, f.name, f.id, f.type || 'doc');
                                            });

                                            // Session Assets (Direct)
                                            (session.assets || []).forEach(a => {
                                                addAsset(a.url, a.title, a.id, a.type);
                                            });

                                            // Report Assets
                                            const report = session.researchReport;
                                            if (report) {
                                                if (report.headerImageUrl) {
                                                    addAsset(report.headerImageUrl, 'Hero Image', `header-${session.id}`, 'header');
                                                }

                                                if (report.videoPost?.videoUrl) {
                                                    addAsset(report.videoPost.videoUrl, report.videoPost.caption || 'Social Video', `video-${session.id}`, 'video');
                                                }

                                                (report.slides || []).forEach((slide, idx) => {
                                                    if (slide.imageUrl) {
                                                        addAsset(slide.imageUrl, slide.title || `Slide ${idx + 1}`, `slide-${session.id}-${idx}`, 'slide');
                                                    }
                                                });

                                                (report.socialCampaign?.posts || []).forEach((post, idx) => {
                                                    if (post.imageUrl) {
                                                        addAsset(post.imageUrl, `${post.platform} Post`, `social-${session.id}-${idx}`, 'social');
                                                    }
                                                });

                                                // Note map nodes
                                                (session.noteMapState || []).forEach((node, idx) => {
                                                    if (node.imageUrl) {
                                                        addAsset(node.imageUrl, node.title || `Note ${idx + 1}`, `notemap-${session.id}-${node.id}`, 'notemap');
                                                    }
                                                });
                                            }
                                        });

                                        // Filter by search
                                        const filtered = allAssets.filter(a => a.name.toLowerCase().includes(assetSearch.toLowerCase()));

                                        if (filtered.length === 0) {
                                            return (
                                                <div className="col-span-full py-12 text-center">
                                                    <p className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>No matching {targetType === 'video' ? 'video' : 'image'} assets found.</p>
                                                </div>
                                            );
                                        }

                                        return filtered.map(asset => (
                                            <button
                                                key={asset.id}
                                                onClick={() => handleAssetSelect(asset.url, asset.name)}
                                                className={`relative group aspect-square rounded-xl overflow-hidden border transition-all ${isDarkMode ? 'border-[#3d3d3f] hover:border-[#0a84ff]' : 'border-gray-200 hover:border-blue-500'}`}
                                            >
                                                {(asset.type === 'video' || asset.type.startsWith('video/')) ? (
                                                    <video src={asset.url} className="w-full h-full object-cover pointer-events-none" />
                                                ) : (
                                                    <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                                                )}
                                                <div className="absolute inset-x-0 bottom-0 p-2 bg-black/60 backdrop-blur-sm">
                                                    <p className="text-[10px] text-white truncate">{asset.name}</p>
                                                </div>
                                                {/* Play Icon Overlay for Videos */}
                                                {(asset.type === 'video' || asset.type.startsWith('video/')) && (
                                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                        <div className="w-8 h-8 bg-black/50 rounded-full flex items-center justify-center backdrop-blur-sm">
                                                            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                                        </div>
                                                    </div>
                                                )}
                                            </button>
                                        ));
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};
