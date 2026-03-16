import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { NoteNode, ResearchProject, ResearchReport, SavedResearch, SavedWebsiteVersion, ProjectTask, ProjectNote, KnowledgeBaseFile, UploadedFile, ResearchDraft, ProjectAccessRole, AIInsight, BlogPost, NewsArticle, WizaProspectsResult, YoutubeVideo, UserProfile, EmailTemplate, AssetItem, ProjectComponentScore } from '../types';
import { storageService } from '../services/storageService';
import { computeSourceCount, computeAssetCount } from '../services/statsService';
import { createVoiceoverVideoWithCreatomate, createOverviewVideoWithCreatomate, createVideoOverview, listVideoOverviewJobs, resumeVideoOverviewPolling, VideoOverviewJobStatus, createSlideshowVideoWithCreatomate } from '../services/creatomateService';
import { generateResearchSuggestions, generateConfidenceScore, generateProjectSummary, uploadFileToGemini, deleteUploadedFile, generateFileSummary, AIConfidenceScore, generateDraftResearchTopicsAlt, reverifyProjectResearch, generateSeoInsightsFromData, generateStructuredBlogPost, generateNewsApiQuery, generateNewsApiQueries, searchYoutubeVideos, indexKnowledgeBaseFileToFileSearch, analyzeProjectComponents, analyzeProjectTopics } from '../services/geminiService';
import { fetchSeoKeywordData, SeoKeywordApiResult } from '../services/seoService';
import ReactMarkdown from 'react-markdown';
import { updateResearchProjectInFirestore, saveTikTokTokens, getTikTokTokens, deleteTikTokTokens, saveFacebookTokens, getFacebookTokens, deleteFacebookTokens, auth, uploadFileToStorage, getUserFromFirestore, logProjectActivity, subscribeToChatMessages } from '../services/firebase';
import { getOrganizationMembers, getOrganization, Organization } from '../services/organizationService';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { KanbanBoard } from './KanbanBoard';
import { NotesPanel } from './NotesPanel';
import { NoteMap } from './NoteMap';
import { KnowledgeBase } from './KnowledgeBase';
import { ProjectLiveAssistant } from './ProjectLiveAssistant';
import { LiveAssistantButton } from './LiveAssistantButton';
import PodcastStudio from './PodcastStudio';
import { ProjectAssets } from './ProjectAssets';
import { UnifiedSocialPublisher } from './UnifiedSocialPublisher';
import { ScheduleCalendar } from './ScheduleCalendar';
import { authFetch } from '../services/authFetch';
import { useCredits } from '../hooks/useCredits';
import { CreditInfoModal } from './CreditInfoModal';
import { CreditBalanceDisplay } from './InsufficientCreditsModal';
import { EmailBuilder } from './EmailBuilder';
import { GameCenter } from './GameCenter';
import { SpiderChart } from './SpiderChart';
import { usePresence } from '../hooks/usePresence';
import { useLiveCursors } from '../hooks/useLiveCursors';
import { useActivityLog } from '../hooks/useActivityLog';
import PresenceAvatars from './PresenceAvatars';
import CursorOverlay from './CursorOverlay';
import CommentButton from './CommentButton';
import ActivityFeed from './ActivityFeed';
import { GooglePickerButton } from './GooglePickerButton';
import { useRealtimeProject } from '../hooks/useRealtimeProject';
import { VideoStudio } from './VideoStudio';
import { ProjectChat } from './ProjectChat';
// import { SketchTab } from './SketchTab'; // Moved to ProjectLiveAssistant

import { PASTEL_THEMES, ThemeType } from '../constants';

interface ProjectDashboardProps {
    project: ResearchProject;
    onBack: () => void;
    onStartResearch: (topic?: string, options?: { background?: boolean }) => void;
    onLoadResearch: (research: SavedResearch, version?: SavedWebsiteVersion) => void;
    isDarkMode: boolean;
    activeTheme?: ThemeType;
    toggleTheme: () => void;
    onProjectUpdate?: (project: ResearchProject) => void;
    isSubscribed?: boolean;
    activeResearchLogs?: string[];
    activeResearchProjectId?: string;
    initialTab?: TabId;
    initialAssetType?: string;
    isActive?: boolean;
    onOpenAgentDeploy?: (project: ResearchProject) => void;
}

type TabId = 'overview' | 'tasks' | 'seo' | 'notes' | 'assets' | /* 'podcast' | */ 'data' | 'social' | 'email' | 'inspo' | 'live' | 'studio' | 'chat' /* | 'post' */;

const SEO_COUNTRIES: { code: string; label: string }[] = [
    { code: 'US', label: 'United States' },
    { code: 'GB', label: 'United Kingdom' },
    { code: 'CA', label: 'Canada' },
    { code: 'AU', label: 'Australia' },
    { code: 'NZ', label: 'New Zealand' },
    { code: 'DE', label: 'Germany' },
    { code: 'FR', label: 'France' },
    { code: 'IN', label: 'India' },
    { code: 'SG', label: 'Singapore' },
    { code: 'BR', label: 'Brazil' },
];

const PLATFORM_LOGOS: Record<string, string> = {
    facebook: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/2021_Facebook_icon.svg.webp',
    instagram: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/Instagram_logo_2016.svg.webp',
    tiktok: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/tiktok-6338432_1280.webp',
    youtube: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/YouTube_full-color_icon_%282017%29.svg.png',
    linkedin: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/LinkedIn_logo_initials.png',
    x: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/X-Logo-Round-Color.png',
    googledrive: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/Google_Drive_icon_%282020%29.svg.png',
    googledocs: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/Docs_2020.webp',
    googlesheets: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/Google_Sheets_logo_%282014-2020%29.svg.png',
    google: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png',
};

const getNumericMax = (rows: any[], key: string): number => {
    return rows.reduce((max, row) => {
        if (!row || typeof row[key] === 'undefined' || row[key] === null) return max;
        const raw = row[key];
        const value = typeof raw === 'number' ? raw : Number(raw) || 0;
        return value > max ? value : max;
    }, 0);
};

type SourceItem = { title: string; url?: string; uri?: string; snippet?: string };

type LeadItem = {
    id: string;
    name: string;
    title?: string;
    company?: string;
    location?: string;
    email?: string;
    emailStatus?: string;
    linkedinUrl?: string;
    raw: any;
};


const DataTab: React.FC<{
    project: ResearchProject;
    isDarkMode: boolean;
    onProjectUpdate: (project: ResearchProject) => void;
    readOnly?: boolean;
    activeTheme?: ThemeType;
    currentTheme?: typeof PASTEL_THEMES[ThemeType];
    initialFileId?: string | null;
    onRequestEdit: (file: UploadedFile) => void;
    onPinToChat: (file: any) => void;
}> = ({ project, isDarkMode, onProjectUpdate, readOnly = false, activeTheme, currentTheme, initialFileId = null, onRequestEdit, onPinToChat }) => {
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [expandedSummaryFile, setExpandedSummaryFile] = useState<string | null>(null);
    const [fileSearch, setFileSearch] = useState('');
    const [driveConnected, setDriveConnected] = useState<boolean>(false);
    const [driveStatusLoading, setDriveStatusLoading] = useState(false);
    const [drivePanelOpen, setDrivePanelOpen] = useState(false);
    const [driveQuery, setDriveQuery] = useState('');
    const [driveFiles, setDriveFiles] = useState<
        { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }[]
    >([]);
    const [driveNextPageToken, setDriveNextPageToken] = useState<string | null>(null);
    const [driveListLoading, setDriveListLoading] = useState(false);
    const [driveImportingFileId, setDriveImportingFileId] = useState<string | null>(null);
    const [driveError, setDriveError] = useState<string | null>(null);

    // SEO - X Search
    const [xSearchMode, setXSearchMode] = useState<'tweets' | 'users'>('tweets');
    const [xSearchQuery, setXSearchQuery] = useState('');
    const [xSearchResults, setXSearchResults] = useState<any>(null);
    const [xSearchLoading, setXSearchLoading] = useState(false);
    const [xSearchError, setXSearchError] = useState<string | null>(null);
    const [xConnected, setXConnected] = useState(false);
    const [xProfile, setXProfile] = useState<any>(null);

    // Data Tab - Mobile & Info State
    const [activeFileId, setActiveFileId] = useState<string | null>(null); // For mobile/touch delete toggle
    const [infoFileId, setInfoFileId] = useState<string | null>(null); // For 'i' popup overlay
    const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null); // For full screen preview

    // Mobile detection - prevent PDF iframe auto-downloads on Safari
    const [isMobile, setIsMobile] = useState(false);
    const [hasMounted, setHasMounted] = useState(false);
    useEffect(() => {
        setHasMounted(true);
        const checkMobile = () => setIsMobile(window.matchMedia('(max-width: 768px)').matches);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const uploadedFiles = project.uploadedFiles || [];
    const isReadOnly = !!readOnly;

    // Helper to handle file clicks
    const handleFileClick = (file: UploadedFile) => {
        // If we're on mobile (implied by touch/active check usually), we might want to toggle active check
        // But user requested "click to preview", so we prioritize preview.
        // We can leave delete/info buttons as stopPropagation to avoid triggering this.
        setPreviewFile(file);
    };

    const refreshDriveStatus = async () => {
        setDriveStatusLoading(true);
        setDriveError(null);
        try {
            const res = await authFetch('/api/google-drive-status', { method: 'GET' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'Failed to load Google Drive status');
            }
            setDriveConnected(Boolean(data?.connected));
        } catch (e: any) {
            setDriveConnected(false);
            setDriveError(e?.message || 'Failed to load Google Drive status');
        } finally {
            setDriveStatusLoading(false);
        }
    };

    useEffect(() => {
        refreshDriveStatus();
    }, []);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (!event.data || (event.data as any).type !== 'google-drive:connected') return;
            refreshDriveStatus();
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    useEffect(() => {
        if (initialFileId) {
            const file = uploadedFiles.find(f => f.uri === initialFileId || f.name === initialFileId);
            if (file) {
                setPreviewFile(file);
                // Wait for state update/render then scroll
                setTimeout(() => {
                    const element = document.getElementById(`file-${initialFileId.replace(/[^a-zA-Z0-9]/g, '-')}`);
                    if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        element.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
                        setTimeout(() => element.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2'), 3000);
                    }
                }, 100);
            }
        }
    }, [initialFileId, uploadedFiles]);

    const handleConnectGoogleDrive = async () => {
        if (isReadOnly) return;
        setDriveError(null);
        try {
            const returnTo = `${window.location.pathname}${window.location.search}`;
            const res = await authFetch(`/api/google-drive-auth-url?returnTo=${encodeURIComponent(returnTo)}`, {
                method: 'GET',
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'Failed to start Google Drive auth');
            }
            const url = String(data?.url || '').trim();
            if (!url) throw new Error('Missing auth url');

            const popup = window.open(url, 'googleDriveConnect', 'width=520,height=650');
            if (!popup) {
                window.location.assign(url);
            }
        } catch (e: any) {
            setDriveError(e?.message || 'Failed to connect Google Drive');
        }
    };

    const loadDriveFiles = async (options?: { reset?: boolean }) => {
        if (!driveConnected) return;
        if (isReadOnly) return;
        const reset = Boolean(options?.reset);
        setDriveListLoading(true);
        setDriveError(null);
        try {
            const pageToken = reset ? '' : (driveNextPageToken || '');
            const qs = new URLSearchParams();
            if (driveQuery.trim()) qs.set('q', driveQuery.trim());
            if (pageToken) qs.set('pageToken', pageToken);
            qs.set('pageSize', '25');

            const res = await authFetch(`/api/google-drive-files?${qs.toString()}`, { method: 'GET' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'Failed to list Drive files');
            }
            const files = Array.isArray(data?.files) ? data.files : [];
            setDriveFiles(prev => (reset ? files : [...prev, ...files]));
            setDriveNextPageToken(data?.nextPageToken ? String(data.nextPageToken) : null);
        } catch (e: any) {
            setDriveError(e?.message || 'Failed to list Drive files');
        } finally {
            setDriveListLoading(false);
        }
    };

    const handleImportDriveFile = async (fileId: string, accessToken?: string) => {
        if (isReadOnly) return;
        if (!fileId) return;
        setDriveImportingFileId(fileId);
        setDriveError(null);
        try {
            const res = await authFetch('/api/google-drive-import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id, fileId, accessToken }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'Failed to import file');
            }

            const kbFile = data?.knowledgeBaseFile as KnowledgeBaseFile | undefined;
            if (!kbFile || !kbFile.url) {
                throw new Error('Import succeeded but returned no file');
            }

            // Fetch the file content to upload it to Gemini (for AI context)
            const resFile = await fetch(kbFile.url);
            if (!resFile.ok) throw new Error('Failed to retrieve file content');

            const blob = await resFile.blob();
            const file = new File([blob], kbFile.name, { type: kbFile.type });

            // Upload to Gemini (handles File Search indexing)
            const geminiFile = await uploadFileToGemini(file, undefined, project.id);

            const uploadedFile: UploadedFile = {
                ...geminiFile,
                url: kbFile.url, // Use the persistent URL from the backend import
                summary: ''
            };

            // Generate AI summary
            try {
                const summary = await generateFileSummary(uploadedFile.uri, uploadedFile.mimeType, uploadedFile.displayName);
                if (summary && summary.trim().length > 0) {
                    uploadedFile.summary = summary;
                }
            } catch (summaryError) {
                console.error('Failed to generate summary for imported file:', summaryError);
            }

            // Update project state
            const nextUploadedFiles = [...(project.uploadedFiles || []), uploadedFile];

            // Also keep knowledgeBase in sync for backend/legacy purposes if needed
            const nextKb = [...(project.knowledgeBase || []), kbFile];

            const updatedProject: ResearchProject = {
                ...project,
                uploadedFiles: nextUploadedFiles,
                knowledgeBase: nextKb,
                lastModified: Date.now(),
            };

            const currentUser = storageService.getCurrentUser();
            if (currentUser) {
                // Use storageService to handle the update correctly
                await storageService.updateResearchProject(project.id, {
                    uploadedFiles: nextUploadedFiles,
                    knowledgeBase: nextKb,
                    lastModified: updatedProject.lastModified,
                });
            }
            onProjectUpdate(updatedProject);

            await logProjectActivity(project.ownerUid, project.id, {
                type: 'file_uploaded',
                description: `imported file "${uploadedFile.displayName || uploadedFile.name}" from Drive`,
                actorUid: auth.currentUser?.uid || 'unknown',
                actorName: auth.currentUser?.displayName || 'Unknown',
                actorPhoto: auth.currentUser?.photoURL || undefined,
                metadata: { fileId: uploadedFile.name, mimeType: uploadedFile.mimeType }
            });
        } catch (e: any) {
            setDriveError(e?.message || 'Failed to import file');
        } finally {
            setDriveImportingFileId(null);
        }
    };

    const handleImportDriveFiles = async (files: Array<{ id: string; name: string }>, accessToken: string) => {
        if (isReadOnly) return;
        setUploading(true);
        setUploadProgress('Importing files from Drive...');

        try {
            const newUploadedFiles: UploadedFile[] = [];
            const newKbFiles: KnowledgeBaseFile[] = [];

            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                setUploadProgress(`Importing ${f.name} (${i + 1}/${files.length})...`);

                try {
                    const res = await authFetch('/api/google-drive-import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId: project.id, fileId: f.id, accessToken }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data?.error || 'Failed to import file');

                    const kbFile = data?.knowledgeBaseFile as KnowledgeBaseFile | undefined;
                    if (!kbFile || !kbFile.url) throw new Error('Import succeeded but returned no file');

                    // Fetch content for Gemini
                    const resFile = await fetch(kbFile.url);
                    if (!resFile.ok) throw new Error('Failed to retrieve file content');
                    const blob = await resFile.blob();
                    const fileObj = new File([blob], kbFile.name, { type: kbFile.type });

                    const geminiFile = await uploadFileToGemini(fileObj, undefined, project.id);

                    const uploadedFile: UploadedFile = {
                        ...geminiFile,
                        url: kbFile.url,
                        summary: ''
                    };

                    try {
                        const summary = await generateFileSummary(uploadedFile.uri, uploadedFile.mimeType, uploadedFile.displayName);
                        if (summary && summary.trim().length > 0) uploadedFile.summary = summary;
                    } catch (err) {
                        console.error('Summary generation failed:', err);
                    }

                    newUploadedFiles.push(uploadedFile);
                    newKbFiles.push(kbFile);

                } catch (err) {
                    console.error(`Failed to import ${f.name}:`, err);
                    // Continue with other files
                }
            }

            if (newUploadedFiles.length > 0) {
                const nextUploadedFiles = [...(project.uploadedFiles || []), ...newUploadedFiles];
                const nextKb = [...(project.knowledgeBase || []), ...newKbFiles];

                const updatedProject: ResearchProject = {
                    ...project,
                    uploadedFiles: nextUploadedFiles,
                    knowledgeBase: nextKb,
                    lastModified: Date.now(),
                };

                const currentUser = storageService.getCurrentUser();
                if (currentUser) {
                    await storageService.updateResearchProject(project.id, {
                        uploadedFiles: nextUploadedFiles,
                        knowledgeBase: nextKb,
                        lastModified: updatedProject.lastModified,
                    });
                }
                onProjectUpdate(updatedProject);

                // Log activity for each imported file
                for (const file of newUploadedFiles) {
                    await logProjectActivity(project.ownerUid, project.id, {
                        type: 'file_uploaded',
                        description: `imported file "${file.displayName || file.name}" from Drive`,
                        actorUid: auth.currentUser?.uid || 'unknown',
                        actorName: auth.currentUser?.displayName || 'Unknown',
                        actorPhoto: auth.currentUser?.photoURL || undefined,
                        metadata: { fileId: file.name, mimeType: file.mimeType }
                    });
                }

                setUploadProgress('Import complete!');
            } else {
                setUploadProgress('No files were successfully imported.');
            }

            setTimeout(() => {
                setUploadProgress('');
                setUploading(false);
            }, 2000);

        } catch (e: any) {
            console.error('Batch import failed:', e);
            setDriveError(e?.message || 'Failed to import files');
            setUploading(false);
            setUploadProgress('');
        }
    };

    const processFiles = async (files: FileList | null) => {
        if (isReadOnly) return;
        if (!files || files.length === 0) return;

        setUploading(true);
        setUploadProgress('Uploading files...');

        try {
            const newFiles: UploadedFile[] = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                setUploadProgress(`Uploading ${file.name} (${i + 1}/${files.length})...`);

                // Upload file to Gemini
                // Also upload to Firebase Storage to get a public URL for thumbnails
                const [geminiFile, firebaseFile] = await Promise.all([
                    uploadFileToGemini(file, undefined, project.id),
                    (async () => {
                        try {
                            // Use Vercel Blob instead of Firebase Storage to avoid CORS issues
                            // We pass skipIndexing: true because uploadFileToGemini (above) already
                            // handles the AI ingestion/indexing part.
                            return await storageService.uploadKnowledgeBaseFile(
                                project.id,
                                file,
                                undefined,
                                { skipIndexing: true }
                            );
                        } catch (e) {
                            console.warn('Failed to upload to object storage:', e);
                        }
                        return null;
                    })()
                ]);

                const uploadedFile = {
                    ...geminiFile,
                    // Use remote URL if available, otherwise fallback to local blob URL for immediate use
                    url: firebaseFile?.url || URL.createObjectURL(file)
                };

                // Generate AI summary for the file
                setUploadProgress(`Generating summary for ${file.name}...`);
                try {
                    const summary = await generateFileSummary(uploadedFile.uri, uploadedFile.mimeType, uploadedFile.displayName);
                    // Only persist a summary if we actually got one; otherwise leave it empty
                    if (summary && summary.trim().length > 0) {
                        uploadedFile.summary = summary;
                    }
                } catch (summaryError) {
                    console.error('Failed to generate summary:', summaryError);
                    // On failure, do not set a fallback summary string so the UI shows nothing
                }

                newFiles.push(uploadedFile);
            }

            const updatedProject = {
                ...project,
                uploadedFiles: [...uploadedFiles, ...newFiles],
                lastModified: Date.now()
            };

            const currentUser = storageService.getCurrentUser();
            if (currentUser) {
                // Use storageService to handle the update correctly
                await storageService.updateResearchProject(project.id, {
                    uploadedFiles: updatedProject.uploadedFiles,
                    lastModified: updatedProject.lastModified
                });
            }
            onProjectUpdate(updatedProject);

            // Log activity for each new file
            for (const file of newFiles) {
                await logProjectActivity(project.ownerUid, project.id, {
                    type: 'file_uploaded',
                    description: `uploaded file "${file.displayName || file.name}"`,
                    actorUid: auth.currentUser?.uid || 'unknown',
                    actorName: auth.currentUser?.displayName || 'Unknown',
                    actorPhoto: auth.currentUser?.photoURL || undefined,
                    metadata: { fileId: file.name, mimeType: file.mimeType }
                });
            }

            setUploadProgress('Upload complete!');

            setTimeout(() => {
                setUploadProgress('');
                setUploading(false);
            }, 2000);
        } catch (error) {
            console.error('Upload failed:', error);
            setUploadProgress('Upload failed. Please try again.');
            setTimeout(() => {
                setUploadProgress('');
                setUploading(false);
            }, 3000);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        await processFiles(e.target.files);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isReadOnly) setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (isReadOnly) return;

        await processFiles(e.dataTransfer.files);
    };

    const handleDeleteFile = async (fileName: string) => {
        if (isReadOnly) return;
        if (!confirm('Delete this file? It will be removed from Gemini Files API.')) return;

        try {
            await deleteUploadedFile(fileName, project.id);

            const updatedProject = {
                ...project,
                uploadedFiles: uploadedFiles.filter(f => f.name !== fileName),
                lastModified: Date.now()
            };

            const currentUser = storageService.getCurrentUser();
            if (currentUser) {
                await updateResearchProjectInFirestore(currentUser, project.id, {
                    uploadedFiles: updatedProject.uploadedFiles,
                    lastModified: updatedProject.lastModified
                });
            }
            onProjectUpdate(updatedProject);

            await logProjectActivity(project.ownerUid, project.id, {
                type: 'file_deleted',
                description: `deleted file "${fileName}"`,
                actorUid: auth.currentUser?.uid || 'unknown',
                actorName: auth.currentUser?.displayName || 'Unknown',
                actorPhoto: auth.currentUser?.photoURL || undefined,
                metadata: { fileName }
            });
        } catch (error) {
            console.error('Delete failed:', error);
            alert('Failed to delete file');
        }
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getFileIcon = (mimeType: string | undefined) => {
        if (!mimeType) return '📎';
        if (mimeType.startsWith('image/')) return '🖼️';
        if (mimeType.startsWith('video/')) return '🎥';
        if (mimeType.startsWith('audio/')) return '🎵';
        if (mimeType.includes('pdf')) return '📄';
        if (mimeType.includes('document') || mimeType.includes('word')) return '📝';
        if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
        return '📎';
    };

    return (
        <div className="space-y-6">
            <div
                className={`p-6 sm:p-7 rounded-2xl sm:rounded-3xl border transition-all duration-200 ${isDragging
                    ? (isDarkMode ? 'border-[#0a84ff] bg-[#0a84ff]/10 border-dashed' : 'border-blue-500 bg-blue-50 border-dashed')
                    : (isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]/80' : 'bg-white border-gray-200 shadow-sm')
                    }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
                    <div>
                        <h2 className={`text-xl sm:text-2xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            Project Data Files
                        </h2>
                        <p className={`mt-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Upload files for the AI to reference as context (images, videos, audio, documents).
                        </p>
                        {isReadOnly && (
                            <p className={`mt-1 text-xs font-medium ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                                View-only collaborators can’t upload or remove files.
                            </p>
                        )}
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading || isReadOnly}
                            className={`inline-flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 rounded-full text-sm font-semibold transition-all shadow-sm disabled:cursor-not-allowed disabled:opacity-70 ${uploading
                                ? 'bg-gray-500 text-white'
                                : activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light'
                                    ? `${currentTheme.primary} ${currentTheme.primaryHover} text-white`
                                    : 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
                                }`}
                        >
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/10">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                            </span>
                            <span>{uploading ? 'Uploading…' : 'Upload Files'}</span>
                        </button>

                        <GooglePickerButton
                            clientId={(import.meta as any).env?.VITE_GOOGLE_DRIVE_CLIENT_ID || ''}
                            apiKey={(import.meta as any).env?.VITE_GOOGLE_DRIVE_API_KEY || ''}
                            appId={(import.meta as any).env?.VITE_GOOGLE_APP_ID}
                            viewId="DOCS"
                            multiselect={true}
                            onFilesSelected={(files, token) => {
                                handleImportDriveFiles(files, token);
                            }}
                            onFileSelected={(file, token) => {
                                handleImportDriveFiles([file], token);
                            }}
                            onError={(err) => setDriveError(err?.message || 'Google Picker error')}
                            disabled={isReadOnly}
                            className={`inline-flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 rounded-full text-sm font-semibold transition-all shadow-sm disabled:cursor-not-allowed disabled:opacity-70 ${isDarkMode
                                ? 'bg-[#2d2d2f] hover:bg-[#3d3d3f] text-white border border-[#3d3d3f]'
                                : 'bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-200'
                                }`}
                        >
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/10">
                                <img src={PLATFORM_LOGOS.googledrive} alt="Drive" className="w-4 h-4 object-contain" />
                            </span>
                            <span>Import from Drive</span>
                        </GooglePickerButton>



                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={handleFileUpload}
                        className="hidden"
                        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls"
                        disabled={isReadOnly}
                    />
                </div>

                {driveError && (
                    <div className={`mb-4 p-4 rounded-xl flex items-center justify-between gap-4 ${isDarkMode ? 'bg-red-900/20 border border-red-500/30' : 'bg-red-50 border border-red-200'}`}>
                        <p className={`text-sm font-medium ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>{driveError}</p>
                        {driveError.toLowerCase().includes('authorization') || driveError.toLowerCase().includes('refresh') || driveError.toLowerCase().includes('grant') ? (
                            <button
                                onClick={handleConnectGoogleDrive}
                                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isDarkMode ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                            >
                                Reconnect
                            </button>
                        ) : null}
                    </div>
                )}

                {driveConnected && drivePanelOpen && (
                    <div className={`mb-6 p-4 rounded-2xl border ${isDarkMode ? 'bg-[#161617] border-[#3d3d3f]/70' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                            <div className="flex-1">
                                <input
                                    value={driveQuery}
                                    onChange={(e) => setDriveQuery(e.target.value)}
                                    placeholder="Search Drive by name"
                                    className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none ${isDarkMode
                                        ? 'bg-[#1d1d1f] border-[#3d3d3f] text-white placeholder:text-gray-500'
                                        : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400'
                                        }`}
                                    disabled={isReadOnly}
                                />
                            </div>
                            <button
                                onClick={() => loadDriveFiles({ reset: true })}
                                disabled={driveListLoading || isReadOnly}
                                className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-70 ${isDarkMode
                                    ? 'bg-[#2d2d2f] hover:bg-[#3d3d3f] text-white border border-[#3d3d3f]'
                                    : 'bg-white hover:bg-gray-100 text-gray-900 border border-gray-200'
                                    }`}
                            >
                                {driveListLoading ? 'Loading…' : 'Search'}
                            </button>
                        </div>

                        <div className="mt-4 flex flex-col gap-2">
                            {driveFiles.length === 0 && !driveListLoading ? (
                                <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>No Drive files found.</div>
                            ) : (
                                driveFiles.map((f) => (
                                    <div
                                        key={f.id}
                                        className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 ${isDarkMode
                                            ? 'bg-[#1d1d1f] border-[#3d3d3f]/70'
                                            : 'bg-white border-gray-200'
                                            }`}
                                    >
                                        <div className="min-w-0">
                                            <div className={`text-sm font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                {f.name}
                                            </div>
                                            <div className={`mt-0.5 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                                <span className="truncate">{f.mimeType}</span>
                                                {f.size ? <span> · {formatFileSize(Number(f.size))}</span> : null}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleImportDriveFile(f.id)}
                                            disabled={isReadOnly || driveImportingFileId === f.id}
                                            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-70 bg-[#0071e3] hover:bg-[#0077ed] text-white`}
                                        >
                                            {driveImportingFileId === f.id ? 'Importing…' : 'Import'}
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        {driveNextPageToken && (
                            <div className="mt-4 flex justify-center">
                                <button
                                    onClick={() => loadDriveFiles({ reset: false })}
                                    disabled={driveListLoading || isReadOnly}
                                    className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-70 ${isDarkMode
                                        ? 'bg-[#2d2d2f] hover:bg-[#3d3d3f] text-white border border-[#3d3d3f]'
                                        : 'bg-white hover:bg-gray-100 text-gray-900 border border-gray-200'
                                        }`}
                                >
                                    {driveListLoading ? 'Loading…' : 'Load more'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {uploadProgress && (
                    <div className={`mb-4 p-4 rounded-xl ${isDarkMode ? 'bg-blue-900/20 border border-blue-500/30' : 'bg-blue-50 border border-blue-200'}`}>
                        <p className={`text-sm font-medium ${isDarkMode ? 'text-blue-300' : 'text-blue-700'}`}>
                            {uploadProgress}
                        </p>
                    </div>
                )}

                <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-600'} mb-4`}>
                    Files are stored in Gemini Files API for 48 hours. Max 2GB per file, 20GB total.
                </div>

                {uploadedFiles.length > 0 && (
                    <div className="mb-4">
                        <input
                            type="text"
                            value={fileSearch}
                            onChange={(e) => setFileSearch(e.target.value)}
                            placeholder="Search files by name..."
                            className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-colors ${isDarkMode
                                ? 'bg-[#1d1d1f] border-[#3d3d3f] text-white placeholder:text-gray-500 focus:border-[#0a84ff]'
                                : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-blue-500'
                                }`}
                        />
                    </div>
                )}

                {uploadedFiles.length === 0 ? (
                    <div className={`rounded-2xl border text-center py-12 px-4 ${isDarkMode
                        ? 'bg-[#161617] border-[#3d3d3f]/70 text-gray-400'
                        : 'bg-gray-50 border-dashed border-gray-200 text-gray-500'
                        }`}>
                        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center bg-gradient-to-br from-[#0071e3]/10 to-purple-500/10">
                            <svg className={`w-7 h-7 ${isDarkMode ? 'text-[#4f8dff]' : 'text-blue-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                        </div>
                        <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>No files uploaded yet</p>
                        <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Use <span className="font-medium">Upload Files</span> to add documents and media as rich AI context.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {uploadedFiles
                            .filter((file) => {
                                if (!fileSearch.trim()) return true;
                                return file.displayName.toLowerCase().includes(fileSearch.toLowerCase());
                            })
                            .map((file) => {
                                const isImage = file.url && file.mimeType.startsWith('image/');
                                const isVideo = file.url && file.mimeType.startsWith('video/');
                                const isActive = activeFileId === file.name;

                                const canEdit = !isReadOnly && (isImage || isVideo || (file.url && (file.mimeType === 'text/csv' || file.name.endsWith('.csv') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.mimeType?.includes('document') || file.mimeType?.includes('word') || file.name.endsWith('.doc') || file.name.endsWith('.docx') || file.mimeType?.includes('pdf') || file.name.endsWith('.pdf') || file.mimeType?.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md'))));

                                return (
                                    <div
                                        key={file.name}
                                        id={`file-${(file.uri || file.name).replace(/[^a-zA-Z0-9]/g, '-')}`}
                                        draggable={true}
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData('application/json', JSON.stringify({
                                                id: file.name,
                                                name: file.displayName,
                                                displayName: file.displayName,
                                                url: file.url,
                                                uri: file.uri || file.url,
                                                type: file.mimeType?.startsWith('image/') ? 'social' :
                                                    file.mimeType?.startsWith('video/') ? 'video' :
                                                        file.mimeType?.startsWith('audio/') ? 'podcast' : 'doc',
                                                mimeType: file.mimeType,
                                            }));
                                            e.dataTransfer.effectAllowed = 'copy';
                                        }}
                                        className={`group relative aspect-[3/4] rounded-2xl border overflow-hidden transition-all duration-300 ${isDarkMode
                                            ? 'bg-[#1c1c1e] border-[#3d3d3f] hover:border-[#5d5d5f]'
                                            : 'bg-white border-gray-200 hover:border-gray-300 shadow-sm hover:shadow-md'
                                            } cursor-grab active:cursor-grabbing`}
                                        onClick={() => {
                                            handleFileClick(file);
                                        }}
                                    >
                                        {/* THUMBNAIL AREA - 70% height */}
                                        <div className="absolute top-0 left-0 right-0 h-[70%] bg-white/5 flex items-center justify-center overflow-hidden">
                                            {isImage ? (
                                                <img
                                                    src={file.url}
                                                    alt={file.displayName}
                                                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                />
                                            ) : isVideo ? (
                                                <video
                                                    src={file.url}
                                                    className="w-full h-full object-cover pointer-events-none"
                                                    muted
                                                    playsInline
                                                />
                                            ) : (file.url && (file.mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) && !isMobile && hasMounted) ? (
                                                // PDF Iframe Thumbnail (Desktop Only)
                                                <div className="w-full h-full relative pointer-events-none bg-white">
                                                    <iframe
                                                        src={`${file.url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                                                        className="w-[150%] h-[150%] origin-top-left scale-[0.67] border-none"
                                                        tabIndex={-1}
                                                        title="PDF Preview"
                                                    />
                                                </div>
                                            ) : (file.url && (file.mimeType?.includes('word') || file.mimeType?.includes('document') || file.mimeType?.includes('sheet') || file.mimeType?.includes('excel') || file.mimeType === 'text/csv' || file.name.endsWith('.doc') || file.name.endsWith('.docx') || file.name.endsWith('.xls') || file.name.endsWith('.xlsx') || file.name.endsWith('.csv'))) ? (
                                                // Doc/Sheet Iframe Thumbnail (Google Viewer)
                                                <div className="w-full h-full relative pointer-events-none bg-white">
                                                    <iframe
                                                        src={`https://docs.google.com/viewer?url=${encodeURIComponent(file.url)}&embedded=true`}
                                                        className="w-[150%] h-[150%] origin-top-left scale-[0.67] border-none"
                                                        tabIndex={-1}
                                                        title="Doc Preview"
                                                    />
                                                </div>
                                            ) : (file.url && (file.mimeType?.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md'))) ? (
                                                // Text/Markdown Iframe Thumbnail
                                                <div className="w-full h-full relative pointer-events-none bg-white">
                                                    <iframe
                                                        src={file.url}
                                                        className="w-[150%] h-[150%] origin-top-left scale-[0.67] border-none"
                                                        tabIndex={-1}
                                                        title="Text Preview"
                                                    />
                                                </div>
                                            ) : (
                                                <div className={`text-5xl ${isDarkMode ? 'text-gray-600' : 'text-gray-300'} drop-shadow-sm transform group-hover:scale-110 transition-transform`}>
                                                    {getFileIcon(file.mimeType)}
                                                </div>
                                            )}

                                            {/* Video Play Icon Overlay */}
                                            {isVideo && (
                                                <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                                                    <div className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white">
                                                        <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* ACTION BUTTONS OVERLAY */}
                                        <div className={`absolute top-2 right-2 flex items-center gap-1.5 transition-all duration-200 z-20
                          ${isActive || infoFileId === file.name ? 'opacity-100 scale-100' : 'opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100'}
                        `}>
                                            {/* 1. INFO ICON */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setInfoFileId(infoFileId === file.name ? null : file.name);
                                                }}
                                                className={`w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md transition-all duration-200 shadow-sm border
                              ${isDarkMode
                                                        ? 'bg-black/40 hover:bg-black/60 text-white border-white/10'
                                                        : 'bg-white/80 hover:bg-white text-gray-600 border-gray-200'
                                                    }
                            `}
                                                title="File Info"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                            </button>

                                            {/* 2. PIN TO CHAT ICON */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onPinToChat(file);
                                                }}
                                                className={`w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md transition-all duration-200 shadow-sm border
                              ${isDarkMode
                                                        ? 'bg-black/40 hover:bg-blue-500/80 text-white border-white/10'
                                                        : 'bg-white/80 hover:bg-blue-100 hover:text-blue-600 text-gray-600 border-gray-200'
                                                    }
                            `}
                                                title="Pin to Chat"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                                </svg>
                                            </button>

                                            {/* 3. EDIT BUTTON */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRequestEdit(file);
                                                }}
                                                className={`w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md transition-all duration-200 shadow-sm
                              ${isDarkMode ? 'bg-black/50 hover:bg-blue-500/80 text-white' : 'bg-white/80 hover:bg-blue-50 hover:text-blue-600 text-gray-500'}
                            `}
                                                title="Edit file"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                </svg>
                                            </button>

                                            {/* 4. DELETE BUTTON */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteFile(file.name);
                                                }}
                                                className={`w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md transition-all duration-200 shadow-sm
                              ${isDarkMode ? 'bg-black/50 hover:bg-red-500/80 text-white' : 'bg-white/80 hover:bg-red-50 hover:text-red-600 text-gray-500'}
                            `}
                                                title="Delete file"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>

                                        {/* INFO POPOVER */}
                                        {infoFileId === file.name && (
                                            <div
                                                className="absolute top-12 right-2 left-2 z-30 p-3 rounded-xl shadow-xl backdrop-blur-xl animate-scale-in origin-top-right border flex flex-col gap-2"
                                                style={{
                                                    background: isDarkMode ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)',
                                                    borderColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                                                }}
                                                onClick={(e) => e.stopPropagation()} // Prevent card click
                                            >
                                                {/* Summary */}
                                                {file.summary ? (
                                                    <div className="text-xs leading-relaxed opacity-90 mb-1 max-h-[120px] overflow-y-auto">
                                                        <span className="font-semibold block mb-0.5 opacity-70">AI Summary</span>
                                                        {file.summary}
                                                    </div>
                                                ) : (
                                                    <div className="text-xs opacity-50 italic">No summary available</div>
                                                )}

                                                {/* Metadata */}
                                                <div className={`mt-auto pt-2 border-t flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-wider font-semibold opacity-60 ${isDarkMode ? 'border-white/10' : 'border-black/5'}`}>
                                                    <span>{formatFileSize(file.sizeBytes)}</span>
                                                    <span>{file.mimeType.split('/')[1] || 'FILE'}</span>
                                                    <span>{formatDate(file.uploadedAt).split(',')[0]}</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* FOOTER - 30% height */}
                                        <div className={`absolute bottom-0 left-0 right-0 h-[30%] px-3 py-2 flex flex-col justify-center border-t backdrop-blur-sm ${isDarkMode ? 'bg-[#1c1c1e]/95 border-white/5' : 'bg-white/95 border-black/5'}`}>
                                            <h3 className={`text-xs font-medium leading-snug line-clamp-2 ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                                                {file.displayName}
                                            </h3>
                                        </div>


                                    </div>
                                )
                            })}
                    </div>
                )}
            </div>



            {previewFile && createPortal(
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-8"
                    onClick={() => setPreviewFile(null)}
                >
                    <div
                        className={`w-full max-w-5xl h-[90vh] flex flex-col relative rounded-3xl shadow-2xl overflow-hidden ${isDarkMode ? 'bg-[#1c1c1e]' : 'bg-white'}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'border-white/10' : 'border-gray-100'}`}>
                            <h3 className={`text-lg font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{previewFile.displayName}</h3>
                            <button
                                onClick={() => setPreviewFile(null)}
                                className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="flex-1 bg-gray-100 relative flex items-center justify-center overflow-hidden">
                            {previewFile.mimeType.startsWith('image/') ? (
                                <img
                                    src={previewFile.url}
                                    alt={previewFile.displayName}
                                    className="max-w-full max-h-full object-contain"
                                />
                            ) : previewFile.mimeType.startsWith('video/') ? (
                                <video
                                    src={previewFile.url}
                                    controls
                                    className="max-w-full max-h-full"
                                />
                            ) : previewFile.mimeType.startsWith('audio/') ? (
                                <div className="w-full max-w-md p-8 bg-white rounded-xl shadow-lg flex flex-col items-center">
                                    <div className="w-20 h-20 bg-blue-100 text-blue-500 rounded-full flex items-center justify-center mb-4">
                                        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                                    </div>
                                    <h4 className="text-lg font-semibold mb-4 text-center text-gray-900">{previewFile.displayName}</h4>
                                    <audio src={previewFile.url} controls className="w-full" />
                                </div>
                            ) : (previewFile.mimeType === 'application/pdf' || previewFile.name.toLowerCase().endsWith('.pdf')) ? (
                                <iframe
                                    src={previewFile.url}
                                    className="w-full h-full border-none"
                                    title={previewFile.displayName}
                                />
                            ) : (previewFile.mimeType?.includes('word') || previewFile.mimeType?.includes('document') || previewFile.mimeType?.includes('sheet') || previewFile.mimeType?.includes('excel') || previewFile.mimeType === 'text/csv' || previewFile.name.endsWith('.doc') || previewFile.name.endsWith('.docx') || previewFile.name.endsWith('.xls') || previewFile.name.endsWith('.xlsx') || previewFile.name.endsWith('.csv')) ? (
                                <iframe
                                    src={`https://docs.google.com/viewer?url=${encodeURIComponent(previewFile.url)}&embedded=true`}
                                    className="w-full h-full border-none"
                                    title="Doc Preview"
                                />
                            ) : (
                                <iframe
                                    src={previewFile.url}
                                    className="w-full h-full border-none bg-white"
                                    title="File Preview"
                                />
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}

        </div>
    );
};

const roleLabelMap: Record<ProjectAccessRole, string> = {
    owner: 'Owner',
    editor: 'Editor',
    viewer: 'Viewer',
    admin: 'Admin',
};



const DraggableWidgetInner = React.memo(({
    id,
    children,
    className,
    isDragged,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDrop
}: {
    id: string;
    children: React.ReactNode;
    className?: string;
    isDragged: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragEnd: () => void;
    onDrop: (e: React.DragEvent) => void;
}) => {
    return (
        <div
            draggable
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDrop={onDrop}
            className={`transition-all duration-200 ${isDragged ? 'opacity-50 scale-[0.98]' : 'opacity-100 scale-100'} ${className || ''}`}
        >
            {children}
        </div>
    );
});

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({
    project,
    onBack,
    onStartResearch,
    onLoadResearch,
    isDarkMode,
    activeTheme = 'light',
    toggleTheme,
    onProjectUpdate,
    isSubscribed,
    activeResearchLogs,
    activeResearchProjectId,
    initialTab,
    initialAssetType,
    isActive = true,
    onOpenAgentDeploy,
}) => {
    /* const { credits: currentCredits } = useCredits(); */
    const { credits: currentCredits } = useCredits();

    // Get current theme configuration
    const currentTheme = PASTEL_THEMES[activeTheme] || PASTEL_THEMES.light;

    // Permission checks
    // Permission checks
    const currentUserUid = storageService.getCurrentUser();
    const role = project.currentUserRole || 'owner';
    const isOwner = !!currentUserUid && (project.ownerUid ? project.ownerUid === currentUserUid : role === 'owner');
    const isViewer = role === 'viewer';
    const canEdit = isOwner || role === 'editor' || role === 'admin';
    const readOnly = !canEdit;

    const currentAuthUser = auth.currentUser;

    const [showCreditInfo, setShowCreditInfo] = useState(false);
    const [showReverifyConfirm, setShowReverifyConfirm] = useState(false);
    const [isReverifying, setIsReverifying] = useState(false);
    const [showReverifySummary, setShowReverifySummary] = useState(false);
    const [reverifySummary, setReverifySummary] = useState<{
        totalChecked: number;
        numFresh: number;
        numUpdated: number;
        numStale: number;
        lines: string[];
    } | null>(null);
    const [showGameCenter, setShowGameCenter] = useState(false);
    const STORAGE_KEY = `project_dashboard_tab_${project.id}`;

    const [activeTab, setActiveTab] = useState<TabId>(() => {
        if (initialTab) return initialTab;
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem(STORAGE_KEY);
            // Validate saved tab is a valid TabId
            // Note: 'suno' and 'post' are commented out in TabId type definition but 'suno' might be old data?
            // The valid keys based on TabId type: 'overview' | 'tasks' | 'seo' | 'notes' | 'assets' | 'data' | 'social' | 'email' | 'inspo' | 'studio'
            if (saved && ['overview', 'tasks', 'seo', 'notes', 'assets', 'data', 'social', 'email', 'inspo', 'studio', 'sketch'].includes(saved)) {
                return saved as TabId;
            }
        }
        return 'overview';
    });

    const [jumpToItemId, setJumpToItemId] = useState<string | null>(null);

    useEffect(() => {
        if (jumpToItemId) {
            const timer = setTimeout(() => setJumpToItemId(null), 1000);
            return () => clearTimeout(timer);
        }
    }, [jumpToItemId]);


    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, activeTab);
        }
    }, [activeTab, STORAGE_KEY]);


    // Real-time presence
    const { otherUsers: onlineCollaborators, onlineUsers: allOnlineUsers, updateFocus } = usePresence({
        ownerUid: project.ownerUid || currentUserUid || '',
        projectId: project.id,
        currentUserUid,
        displayName: currentAuthUser?.displayName || null,
        photoURL: currentAuthUser?.photoURL || null,
        email: currentAuthUser?.email || null,
        activeTab,
        enabled: !!currentUserUid,
    });

    // Real-time project data for NoteMap logic
    const [realtimeProject, setRealtimeProject] = useState<ResearchProject | null>(null);
    useRealtimeProject({
        ownerUid: project.ownerUid || currentUserUid || '',
        projectId: project.id,
        onUpdate: (updatedProject) => setRealtimeProject(updatedProject)
    });

    // Live cursors (derives from presence data)
    const { cursors: liveCursors } = useLiveCursors({
        ownerUid: project.ownerUid || currentUserUid || '',
        projectId: project.id,
        currentUserUid,
        otherUsers: onlineCollaborators,
        enabled: !!currentUserUid && onlineCollaborators.length > 0,
    });





    // Activity Log
    const { activities: projectActivities, loading: activitiesLoading } = useActivityLog({
        ownerUid: project.ownerUid || currentUserUid || '',
        projectId: project.id,
        enabled: !!currentUserUid,
    });

    const [activeOverviewTab, setActiveOverviewTab] = useState<'focus' | 'research' | 'news'>('focus');
    const [editRequestAsset, setEditRequestAsset] = useState<AssetItem | null>(null);

    // Spider Chart state (front = components, back = topics)
    const [spiderData, setSpiderData] = useState<ProjectComponentScore[] | null>(project.projectComponentScores || null);
    const [spiderLoading, setSpiderLoading] = useState(false);
    const [spiderError, setSpiderError] = useState<string | null>(null);
    const [topicData, setTopicData] = useState<ProjectComponentScore[] | null>(project.projectTopicScores || null);
    const [topicLoading, setTopicLoading] = useState(false);
    const [topicError, setTopicError] = useState<string | null>(null);

    // Update local state if project updates from outside
    useEffect(() => {
        if (project.projectComponentScores) {
            setSpiderData(project.projectComponentScores);
        }
        if (project.projectTopicScores) {
            setTopicData(project.projectTopicScores);
        }
    }, [project.projectComponentScores, project.projectTopicScores]);

    const handleAnalyzeComponents = useCallback(async () => {
        setSpiderLoading(true);
        setSpiderError(null);
        try {
            const notes = project.notes || [];
            const tasks = project.tasks || [];
            const research = project.researchSessions || [];
            const files = project.uploadedFiles || [];
            const drafts = project.draftResearchSessions || [];
            const completedTasks = tasks.filter((t: any) => t.status === 'done').length;
            const totalTasks = tasks.length;
            const blogPostCount = research.filter((r: any) => r.researchReport?.blogPost).length;

            const contextStr = [
                `Project: ${project.name}`,
                project.description ? `Description: ${project.description}` : '',
                `Notes: ${notes.length} notes`,
                notes.length > 0 ? `Note titles: ${notes.slice(0, 10).map((n: any) => n.title || n.content?.slice(0, 40)).join(', ')}` : '',
                `Tasks: ${totalTasks} total, ${completedTasks} completed, ${totalTasks - completedTasks} remaining`,
                `Research sessions: ${research.length}`,
                research.length > 0 ? `Research topics: ${research.slice(0, 8).map((r: any) => r.topic).join(', ')}` : '',
                `Uploaded files: ${files.length}`,
                files.length > 0 ? `File types: ${[...new Set(files.map((f: any) => f.mimeType?.split('/')[0] || 'unknown'))].join(', ')}` : '',
                `Research drafts: ${drafts.length}`,
                drafts.length > 0 ? `Draft topics: ${drafts.slice(0, 6).map((d: any) => d.topic || d.title).join(', ')}` : '',
                project.seoSeedKeywords?.length ? `SEO keywords: ${project.seoSeedKeywords.length}` : 'SEO keywords: 0',
                blogPostCount > 0 ? `Blog posts: ${blogPostCount}` : 'Blog posts: 0',
            ].filter(Boolean).join('\n');

            const result = await analyzeProjectComponents(contextStr);
            setSpiderData(result);

            // Persist to Firestore
            if (project.ownerUid) {
                await updateResearchProjectInFirestore(project.ownerUid, project.id, {
                    projectComponentScores: result
                });
            } else {
                console.warn('Cannot persist spider data: missing ownerUid');
            }

            if (onProjectUpdate) {
                onProjectUpdate({ ...project, projectComponentScores: result });
            }
        } catch (err: any) {
            console.error('Spider chart analysis failed:', err);
            setSpiderError(err?.message || 'Analysis failed');
        } finally {
            setSpiderLoading(false);
        }
    }, [project, onProjectUpdate]);

    const [unreadMentions, setUnreadMentions] = useState(0);
    const lastChatViewTimestamp = useRef<number>(
        typeof window !== 'undefined'
            ? parseInt(localStorage.getItem(`last_chat_view_${project.id}`) || '', 10) || Date.now()
            : Date.now()
    );

    useEffect(() => {
        if (!project.ownerUid || !project.id || !auth.currentUser) return;

        const unsubscribe = subscribeToChatMessages(project.ownerUid, project.id, (msgs) => {
            // Only count mentions for the current user that happened after the last time they viewed the chat
            const mentions = msgs.filter(m =>
                m.mentions?.includes(auth.currentUser?.uid || '') &&
                m.createdAt > lastChatViewTimestamp.current &&
                !m.deleted
            );
            setUnreadMentions(mentions.length);
        });

        return () => unsubscribe();
    }, [project.ownerUid, project.id]);

    const handleAnalyzeTopics = useCallback(async () => {
        setTopicLoading(true);
        setTopicError(null);
        try {
            const notes = project.notes || [];
            const research = project.researchSessions || [];
            const drafts = project.draftResearchSessions || [];

            const contextStr = [
                `Project: ${project.name}`,
                project.description ? `Description: ${project.description}` : '',
                notes.length > 0 ? `Note titles: ${notes.slice(0, 15).map((n: any) => n.title || n.content?.slice(0, 60)).join(', ')}` : '',
                research.length > 0 ? `Research topics: ${research.slice(0, 10).map((r: any) => r.topic).join(', ')}` : '',
                research.length > 0 ? `Research summaries: ${research.slice(0, 5).map((r: any) => r.researchReport?.tldr || '').filter(Boolean).join(' | ')}` : '',
                drafts.length > 0 ? `Draft topics: ${drafts.slice(0, 8).map((d: any) => d.topic || d.title).join(', ')}` : '',
            ].filter(Boolean).join('\n');

            const result = await analyzeProjectTopics(contextStr);
            setTopicData(result);

            // Persist to Firestore
            if (project.ownerUid) {
                await updateResearchProjectInFirestore(project.ownerUid, project.id, {
                    projectTopicScores: result
                });
            }

            if (onProjectUpdate) {
                onProjectUpdate({ ...project, projectTopicScores: result });
            }
        } catch (err: any) {
            console.error('Topic analysis failed:', err);
            setTopicError(err?.message || 'Topic analysis failed');
        } finally {
            setTopicLoading(false);
        }
    }, [project, onProjectUpdate]);

    // Auto-analyze exactly once if no data exists
    const hasAutoAnalyzed = useRef(false);
    const hasAutoAnalyzedTopics = useRef(false);
    useEffect(() => {
        if (!project.projectComponentScores && !spiderData && !spiderLoading && !hasAutoAnalyzed.current) {
            hasAutoAnalyzed.current = true;
            handleAnalyzeComponents();
        }
    }, [project.projectComponentScores, spiderData, spiderLoading, handleAnalyzeComponents]);

    useEffect(() => {
        if (!project.projectTopicScores && !topicData && !topicLoading && !hasAutoAnalyzedTopics.current) {
            hasAutoAnalyzedTopics.current = true;
            handleAnalyzeTopics();
        }
    }, [project.projectTopicScores, topicData, topicLoading, handleAnalyzeTopics]);
    const handleRequestEdit = (file: UploadedFile) => {
        // Convert to AssetItem
        const asset: AssetItem = {
            id: file.name, // Use name as ID for reference
            type: file.mimeType === 'application/pdf' ? 'book' :
                (file.mimeType?.startsWith('video/') ? 'video' :
                    (file.mimeType?.startsWith('image/') ? 'header' : // Use 'header' as generic image type that triggers editor
                        (file.mimeType === 'text/csv' || file.name.endsWith('.csv') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls') ? 'table' : 'doc'))),
            url: file.url,
            title: file.displayName,
            description: file.summary || '',
            researchId: 'uploaded',
            researchTopic: 'Uploaded File',
            timestamp: file.uploadedAt
        };

        setEditRequestAsset(asset);

        // Update filter based on type so ProjectAssets opens correct tab
        setActiveTab('assets');
    };

    const [assetToPin, setAssetToPin] = useState<any>(null);
    const handlePinToChat = useCallback((asset: any) => {
        setAssetToPin(asset);
        // Delay opening the assistant slightly to ensure state is set
        setTimeout(() => setShowAssistant(true), 50);
    }, []);

    const [currentAssetsFilter, setCurrentAssetsFilter] = useState<string[]>(initialAssetType ? [initialAssetType] : []);
    const [assetCount, setAssetCount] = useState<number>(computeAssetCount(project));

    // Organization State
    const [organizationMembers, setOrganizationMembers] = useState<UserProfile[]>([]);
    const [organization, setOrganization] = useState<Organization | null>(null);

    // Fetch Organization Data
    useEffect(() => {
        const fetchOrg = async () => {
            if (!auth.currentUser) return;
            try {
                const userProfile = await getUserFromFirestore(auth.currentUser.uid);
                if (userProfile && userProfile.organizationId) {
                    const [org, members] = await Promise.all([
                        getOrganization(userProfile.organizationId),
                        getOrganizationMembers(userProfile.organizationId)
                    ]);
                    setOrganization(org);
                    // Filter out current user from the list
                    setOrganizationMembers(members.filter(m => m.email !== auth.currentUser?.email));
                }
            } catch (e) {
                console.error("Failed to load organization data", e);
            }
        };
        fetchOrg();
    }, []);

    useEffect(() => {
        console.log('[ProjectDashboard] useEffect triggered - initialTab:', initialTab, 'initialAssetType:', initialAssetType, 'project.id:', project.id);
        console.log('[ProjectDashboard] Setting activeTab to:', initialTab || 'overview');
        const nextTab = initialTab || 'overview';
        setActiveTab(nextTab);
        setCurrentAssetsFilter(initialAssetType ? [initialAssetType] : []);

        if (nextTab === 'chat') {
            setUnreadMentions(0);
            const now = Date.now();
            lastChatViewTimestamp.current = now;
            if (typeof window !== 'undefined') {
                localStorage.setItem(`last_chat_view_${project.id}`, now.toString());
            }
        }
    }, [initialTab, initialAssetType, project.id]);

    // Re-compute asset count when project changes
    useEffect(() => {
        setAssetCount(computeAssetCount(project));
    }, [project]);

    const [calendarConnected, setCalendarConnected] = useState(false);
    const [calendarStatusLoading, setCalendarStatusLoading] = useState(false);
    const [calendarLoading, setCalendarLoading] = useState(false);
    const [calendarError, setCalendarError] = useState<string | null>(null);
    const [calendarMobileExpanded, setCalendarMobileExpanded] = useState(true);
    const [calendarMonth, setCalendarMonth] = useState(() => {
        const d = new Date();
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        return d;
    });
    const [calendarSelectedDay, setCalendarSelectedDay] = useState(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    });
    const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
    const [scheduledPosts, setScheduledPosts] = useState<Array<{
        id: string;
        scheduledAt: number;
        platforms: string[];
        textContent: string;
        status: string;
    }>>([]);
    const [scheduledEmails, setScheduledEmails] = useState<Array<{
        id: string;
        scheduledAt: number;
        to: string | string[];
        subject: string;
        status: string;
        provider: 'gmail' | 'outlook';
    }>>([]);

    // Google Sync Tokens
    const [googleSheetsAccessToken, setGoogleSheetsAccessToken] = useState<string | null>(null);
    const [googleDocsAccessToken, setGoogleDocsAccessToken] = useState<string | null>(null);

    // Global drag-drop state for file uploads across all tabs
    const [globalDragging, setGlobalDragging] = useState(false);
    const [globalUploading, setGlobalUploading] = useState(false);
    const [globalUploadProgress, setGlobalUploadProgress] = useState('');
    const globalDragCounter = useRef(0);

    const [isCreateEventModalOpen, setIsCreateEventModalOpen] = useState(false);
    const [newEventTitle, setNewEventTitle] = useState('');
    const [newEventDescription, setNewEventDescription] = useState('');
    const [newEventStartLocal, setNewEventStartLocal] = useState('');
    const [newEventEndLocal, setNewEventEndLocal] = useState('');
    const [newEventAddMeet, setNewEventAddMeet] = useState(true);

    // Quick Add Task State
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [isQuickAddTaskModalOpen, setIsQuickAddTaskModalOpen] = useState(false);
    const [quickTaskTitle, setQuickTaskTitle] = useState('');
    const [quickTaskPriority, setQuickTaskPriority] = useState<'low' | 'medium' | 'high'>('high');

    const [facebookSdkReady, setFacebookSdkReady] = useState(false);
    const [facebookStatusLoading, setFacebookStatusLoading] = useState(false);
    const [facebookConnected, setFacebookConnected] = useState(false);
    const [facebookProfile, setFacebookProfile] = useState<any | null>(null);
    const [facebookError, setFacebookError] = useState<string | null>(null);
    const facebookAccessTokenRef = useRef<string | null>(null);

    // Facebook Page Posting State
    const [fbPages, setFbPages] = useState<any[]>([]);
    const [fbPagesLoading, setFbPagesLoading] = useState(false);
    const [fbPagesError, setFbPagesError] = useState<string | null>(null);
    const [selectedFbPageId, setSelectedFbPageId] = useState<string>('');

    const [fbPostType, setFbPostType] = useState<'TEXT' | 'PHOTO' | 'VIDEO'>('TEXT');
    const [fbPostMessage, setFbPostMessage] = useState('');
    const [fbPostLink, setFbPostLink] = useState('');
    const [fbPostMediaUrl, setFbPostMediaUrl] = useState('');
    const [fbPostTitle, setFbPostTitle] = useState(''); // For Video
    const [fbPostLoading, setFbPostLoading] = useState(false);
    const [fbPostError, setFbPostError] = useState<string | null>(null);
    const [fbPostResult, setFbPostResult] = useState<any | null>(null);

    const [igAccountsLoading, setIgAccountsLoading] = useState(false);
    const [igAccountsError, setIgAccountsError] = useState<string | null>(null);
    const [igAccounts, setIgAccounts] = useState<any[]>([]);
    const [selectedIgId, setSelectedIgId] = useState<string>('');

    const [igPublishImageUrl, setIgPublishImageUrl] = useState('');
    const [igPublishCaption, setIgPublishCaption] = useState('');
    const [igPublishAltText, setIgPublishAltText] = useState('');
    const [igPublishLoading, setIgPublishLoading] = useState(false);
    const [igPublishError, setIgPublishError] = useState<string | null>(null);
    const [igPublishResult, setIgPublishResult] = useState<any | null>(null);
    const [igPublishMediaType, setIgPublishMediaType] = useState<'FEED' | 'STORY' | 'REEL'>('FEED');
    const [igPublishMediaUrls, setIgPublishMediaUrls] = useState<string[]>([]);
    const [igPublishShareToFeed, setIgPublishShareToFeed] = useState(true);
    const [igPublishPollingStatus, setIgPublishPollingStatus] = useState<string | null>(null);
    const [igPublishPollingError, setIgPublishPollingError] = useState<string | null>(null);

    // TikTok state
    const [tiktokConnected, setTiktokConnected] = useState(false);
    const [tiktokLoading, setTiktokLoading] = useState(false);
    const [tiktokError, setTiktokError] = useState<string | null>(null);
    const tiktokAccessTokenRef = useRef<string | null>(null);
    const tiktokRefreshTokenRef = useRef<string | null>(null);
    const tiktokOpenIdRef = useRef<string | null>(null);

    const [tiktokCreatorInfo, setTiktokCreatorInfo] = useState<{
        creatorAvatarUrl: string;
        creatorUsername: string;
        creatorNickname: string;
        privacyLevelOptions: string[];
        commentDisabled: boolean;
        duetDisabled: boolean;
        stitchDisabled: boolean;
        maxVideoPostDurationSec: number;
    } | null>(null);

    const [tiktokVideoUrl, setTiktokVideoUrl] = useState('');
    const [tiktokVideoSource, setTiktokVideoSource] = useState<'URL' | 'ASSET' | 'UPLOAD'>('URL');
    const [tiktokSelectedAssetId, setTiktokSelectedAssetId] = useState('');
    const [tiktokUploadFile, setTiktokUploadFile] = useState<File | null>(null);
    const [tiktokVideoPostMode, setTiktokVideoPostMode] = useState<'direct' | 'inbox'>('direct');



    // TikTok Photo State
    const [tiktokPostMode, setTiktokPostMode] = useState<'video' | 'photo'>('video');
    const [tiktokPhotoUrls, setTiktokPhotoUrls] = useState<string[]>([]);
    const [tiktokPhotoTitle, setTiktokPhotoTitle] = useState('');
    const [tiktokPhotoDescription, setTiktokPhotoDescription] = useState('');
    const [tiktokAutoAddMusic, setTiktokAutoAddMusic] = useState(true);
    const [tiktokVideoTitle, setTiktokVideoTitle] = useState('');
    const [tiktokPrivacyLevel, setTiktokPrivacyLevel] = useState('PUBLIC_TO_EVERYONE');
    const [tiktokDisableDuet, setTiktokDisableDuet] = useState(false);
    const [tiktokDisableStitch, setTiktokDisableStitch] = useState(false);
    const [tiktokDisableComment, setTiktokDisableComment] = useState(false);
    const [tiktokPostLoading, setTiktokPostLoading] = useState(false);
    const [tiktokPostError, setTiktokPostError] = useState<string | null>(null);
    const [tiktokPostResult, setTiktokPostResult] = useState<{ publishId: string; status?: string } | null>(null);

    // YouTube State
    const [youtubeConnected, setYoutubeConnected] = useState(false);
    const [youtubeChannel, setYoutubeChannel] = useState<any>(null);
    const [youtubeUploadLoading, setYoutubeUploadLoading] = useState(false);
    const [youtubePostError, setYoutubePostError] = useState<string | null>(null);
    const [youtubePostSuccess, setYoutubePostSuccess] = useState<string | null>(null);

    const [youtubeVideoTitle, setYoutubeVideoTitle] = useState('');
    const [youtubeVideoDescription, setYoutubeVideoDescription] = useState('');
    const [youtubePrivacyStatus, setYoutubePrivacyStatus] = useState<'public' | 'private' | 'unlisted'>('public');

    const [youtubeVideoSource, setYoutubeVideoSource] = useState<'URL' | 'ASSET' | 'UPLOAD'>('UPLOAD');
    const [youtubeVideoUrl, setYoutubeVideoUrl] = useState('');
    const [youtubeSelectedAssetId, setYoutubeSelectedAssetId] = useState('');
    const [youtubeUploadFile, setYoutubeUploadFile] = useState<File | null>(null);

    const [youtubeMadeForKids, setYoutubeMadeForKids] = useState(false);
    const [youtubeCategoryId, setYoutubeCategoryId] = useState('22');
    const [youtubeNotifySubscribers, setYoutubeNotifySubscribers] = useState(true);
    const [youtubeTags, setYoutubeTags] = useState('');

    // LinkedIn State
    const [linkedinConnected, setLinkedinConnected] = useState(false);
    const [linkedinProfile, setLinkedinProfile] = useState<any>(null);
    const [linkedinPostLoading, setLinkedinPostLoading] = useState(false);
    const [linkedinPostError, setLinkedinPostError] = useState<string | null>(null);
    const [linkedinPostSuccess, setLinkedinPostSuccess] = useState<string | null>(null);

    const [linkedinPostType, setLinkedinPostType] = useState<'TEXT' | 'ARTICLE' | 'IMAGE' | 'VIDEO'>('TEXT');
    const [linkedinPostText, setLinkedinPostText] = useState('');
    const [linkedinArticleUrl, setLinkedinArticleUrl] = useState('');
    const [linkedinArticleTitle, setLinkedinArticleTitle] = useState('');
    const [linkedinArticleDescription, setLinkedinArticleDescription] = useState('');
    const [linkedinMediaSource, setLinkedinMediaSource] = useState<'URL' | 'ASSET' | 'UPLOAD'>('UPLOAD');
    const [linkedinMediaUrl, setLinkedinMediaUrl] = useState('');
    const [linkedinSelectedAssetId, setLinkedinSelectedAssetId] = useState('');
    const [linkedinUploadFile, setLinkedinUploadFile] = useState<File | null>(null);
    const [linkedinVisibility, setLinkedinVisibility] = useState<'PUBLIC' | 'CONNECTIONS'>('PUBLIC');

    // X (Twitter) State
    const [xConnected, setXConnected] = useState(false);
    const [xProfile, setXProfile] = useState<any>(null);
    const [xPostLoading, setXPostLoading] = useState(false);
    const [xPostError, setXPostError] = useState<string | null>(null);
    const [xPostSuccess, setXPostSuccess] = useState<string | null>(null);

    // X Search State
    const [xSearchMode, setXSearchMode] = useState<'tweets' | 'users'>('tweets');
    const [xSearchQuery, setXSearchQuery] = useState('');
    const [xSearchResults, setXSearchResults] = useState<any>(null);
    const [xSearchLoading, setXSearchLoading] = useState(false);
    const [xSearchError, setXSearchError] = useState<string | null>(null);

    const [xPostType, setXPostType] = useState<'TEXT' | 'IMAGE' | 'VIDEO'>('TEXT');
    const [xPostText, setXPostText] = useState('');
    const [xMediaSource, setXMediaSource] = useState<'URL' | 'ASSET' | 'UPLOAD'>('UPLOAD');
    const [xMediaUrl, setXMediaUrl] = useState('');
    const [xSelectedAssetId, setXSelectedAssetId] = useState('');
    const [xUploadFile, setXUploadFile] = useState<File | null>(null);

    // Unified Social Publisher Mode
    const [socialPublisherMode, setSocialPublisherMode] = useState<'unified' | 'advanced'>('unified');
    const [unifiedPublisherInitialState, setUnifiedPublisherInitialState] = useState<{
        postType?: 'TEXT' | 'IMAGE' | 'VIDEO';
        textContent?: string;
        mediaSource?: 'UPLOAD' | 'ASSET' | 'GENERATE';
        selectedAssetId?: string;
        assetUrl?: string;
        assetType?: string;
    } | undefined>(undefined);

    // Upload-Post State
    const [upPostProfileUsername, setUpPostProfileUsername] = useState('');

    // Email Builder Asset Picker State
    const [isEmailAssetPickerOpen, setIsEmailAssetPickerOpen] = useState(false);
    const [emailAssetSearch, setEmailAssetSearch] = useState('');
    const [assetsInitialFocus, setAssetsInitialFocus] = useState<string | null>(null);
    const [emailInitialFocus, setEmailInitialFocus] = useState(false);
    const emailAssetResolver = useRef<((url: string | null) => void) | null>(null);
    const [upPostProfiles, setUpPostProfiles] = useState<any[]>([]);
    const [upPostActiveProfile, setUpPostActiveProfile] = useState<any>(null);
    const [upPostLoading, setUpPostLoading] = useState(false);
    const [upPostError, setUpPostError] = useState<string | null>(null);
    const [upPostConnectUrl, setUpPostConnectUrl] = useState<string | null>(null);
    const [upPostMediaType, setUpPostMediaType] = useState<'video' | 'photo' | 'image' | 'text' | 'article'>('video');
    const [upPostMediaUrl, setUpPostMediaUrl] = useState('');
    const [upPostPhotoUrls, setUpPostPhotoUrls] = useState('');
    const [upPostTitle, setUpPostTitle] = useState('');
    const [upPostArticleUrl, setUpPostArticleUrl] = useState('');

    const projectAssets = useMemo(() => {
        return [
            ...(project.knowledgeBase || []),
            ...(project.uploadedFiles || [])
        ];
    }, [project.knowledgeBase, project.uploadedFiles]);
    const [upPostDescription, setUpPostDescription] = useState('');
    const [upPostPlatforms, setUpPostPlatforms] = useState<string[]>(['tiktok', 'instagram']);
    const [upPostScheduleDate, setUpPostScheduleDate] = useState('');
    const [upPostFacebookPageId, setUpPostFacebookPageId] = useState('');
    const [upPostFacebookPages, setUpPostFacebookPages] = useState<{ page_id: string; page_name: string }[]>([]);
    const [upPostPosting, setUpPostPosting] = useState(false);
    const [upPostResult, setUpPostResult] = useState<any>(null);
    const [upPostHistory, setUpPostHistory] = useState<any[]>([]);
    const [upPostHistoryLoading, setUpPostHistoryLoading] = useState(false);

    // Facebook/Instagram Targeting Search State
    const [targetingSearchType, setTargetingSearchType] = useState<'geo' | 'interest' | 'behavior' | 'demographic'>('geo');
    const [targetingGeoType, setTargetingGeoType] = useState<'country' | 'region' | 'city' | 'zip'>('country');
    const [targetingQuery, setTargetingQuery] = useState('');
    const [targetingResults, setTargetingResults] = useState<any[]>([]);
    const [targetingLoading, setTargetingLoading] = useState(false);
    const [targetingError, setTargetingError] = useState<string | null>(null);

    // Inspo tab state
    const [inspoLoading, setInspoLoading] = useState(false);
    const [inspoImages, setInspoImages] = useState<any[]>([]);
    const [inspoVideos, setInspoVideos] = useState<YoutubeVideo[]>([]);
    const [inspoError, setInspoError] = useState<string | null>(null);
    const [savingInspoImages, setSavingInspoImages] = useState<Set<string>>(new Set());

    // Facebook/Instagram Targeting Search Handler
    const handleTargetingSearch = async () => {
        if (!targetingQuery.trim() && targetingSearchType !== 'behavior') {
            setTargetingError('Please enter a search query');
            return;
        }
        if (!facebookConnected || !facebookAccessTokenRef.current) {
            setTargetingError('Please connect Facebook first to search targeting options');
            return;
        }

        setTargetingLoading(true);
        setTargetingError(null);
        setTargetingResults([]);

        try {
            const accessToken = facebookAccessTokenRef.current;
            let url = '';
            const apiVersion = 'v21.0';

            if (targetingSearchType === 'geo') {
                // Geographic targeting search
                const locationTypes = targetingGeoType === 'country' ? 'country' :
                    targetingGeoType === 'region' ? 'region' :
                        targetingGeoType === 'city' ? 'city' : 'zip';
                url = `https://graph.facebook.com/${apiVersion}/search?type=adgeolocation&location_types=["${locationTypes}"]&q=${encodeURIComponent(targetingQuery)}&access_token=${accessToken}&limit=20`;
            } else if (targetingSearchType === 'interest') {
                // Interest targeting search
                url = `https://graph.facebook.com/${apiVersion}/search?type=adinterest&q=${encodeURIComponent(targetingQuery)}&access_token=${accessToken}&limit=20`;
            } else if (targetingSearchType === 'behavior') {
                // Behavior targeting (browse all)
                url = `https://graph.facebook.com/${apiVersion}/search?type=adTargetingCategory&class=behaviors&access_token=${accessToken}&limit=50`;
            } else if (targetingSearchType === 'demographic') {
                // Demographic targeting (browse all)
                url = `https://graph.facebook.com/${apiVersion}/search?type=adTargetingCategory&class=demographics&access_token=${accessToken}&limit=50`;
            }

            const res = await fetch(url);
            const data = await res.json();

            if (data.error) {
                throw new Error(data.error.message || 'API error');
            }

            setTargetingResults(data.data || []);
            if ((data.data || []).length === 0) {
                setTargetingError('No results found');
            }
        } catch (err: any) {
            console.error('[Targeting Search] Error:', err);
            setTargetingError(err.message || 'Search failed');
        } finally {
            setTargetingLoading(false);
        }
    };

    const handleApiPing = async () => {
        try {
            const res = await authFetch('/api/social?op=ping', { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            console.log('[Social API] Ping Response:', data);
            alert(`API is ALIVE!\nStatus: ${res.status}\nNode: ${data.nodeVersion || 'unknown'}`);
        } catch (e: any) {
            console.error('[Social API] Ping Failed:', e);
            alert(`API is DOWN or unreachable.\nError: ${e.message}`);
        }
    };



    const handleDebugToken = async () => {
        try {
            const fbUserAccessToken = facebookAccessTokenRef.current;
            if (!fbUserAccessToken) {
                alert('Connect Facebook first.');
                return;
            }
            const res = await authFetch('/api/social?op=debug-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fbUserAccessToken }),
            });
            const data = await res.json().catch(() => ({}));
            console.log('[Social API] Debug Token Response:', data);
            alert(`Token Diagnostic:\nLength: ${data.length}\nPrefix: ${data.prefix}\nValid Format: ${data.validFormat}\n\nCheck console for details.`);
        } catch (e: any) {
            console.error('[Social API] Debug Token Failed:', e);
            alert(`Debug failed: ${e.message}`);
        }
    };

    const handleQuickAddTask = async () => {
        if (!quickTaskTitle.trim()) return;

        try {
            const newTask = await storageService.addTask(project.id, {
                title: quickTaskTitle,
                priority: quickTaskPriority,
                status: 'in_progress',
                description: ''
            });

            if (onProjectUpdate) {
                const updatedProject = {
                    ...project,
                    tasks: [...(project.tasks || []), newTask],
                    lastModified: Date.now()
                };
                onProjectUpdate(updatedProject);
            }

            setQuickTaskTitle('');
            setQuickTaskPriority('high');
            setIsQuickAddTaskModalOpen(false);
        } catch (e) {
            console.error("Failed to add quick task", e);
        }
    };

    /**
     * Refresh social connection states by re-checking localStorage tokens.
     * Called by ProjectLiveAssistant after OAuth completes in inline connector.
     */
    const refreshSocialConnections = useCallback(async () => {
        console.log('[SocialRefresh] Refreshing all social connection states...');

        // Re-check each platform's auth token
        if (typeof window !== 'undefined') {
            // Facebook/Instagram
            const fbToken = localStorage.getItem('fb_access_token');
            if (fbToken && !facebookConnected) {
                setFacebookConnected(true);
                facebookAccessTokenRef.current = fbToken;
                console.log('[SocialRefresh] Facebook connected');
            }

            // X (Twitter)
            const xToken = localStorage.getItem('x_access_token');
            if (xToken && !xConnected) {
                setXConnected(true);
                console.log('[SocialRefresh] X connected');
            }

            // TikTok
            const tiktokToken = localStorage.getItem('tiktok_access_token');
            if (tiktokToken && !tiktokConnected) {
                setTiktokConnected(true);
                console.log('[SocialRefresh] TikTok connected');
            }

            // YouTube
            const youtubeToken = localStorage.getItem('youtube_access_token');
            if (youtubeToken && !youtubeConnected) {
                setYoutubeConnected(true);
                console.log('[SocialRefresh] YouTube connected');
            }

            // LinkedIn
            const linkedinToken = localStorage.getItem('linkedin_access_token');
            if (linkedinToken && !linkedinConnected) {
                setLinkedinConnected(true);
                console.log('[SocialRefresh] LinkedIn connected');
            }
        }

        // Load additional data for connected platforms
        if (facebookConnected || localStorage.getItem('fb_access_token')) {
            await loadFacebookPages();
            loadInstagramAccounts();
        }

        console.log('[SocialRefresh] Refresh complete');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [facebookConnected, xConnected, tiktokConnected, youtubeConnected, linkedinConnected]);

    const loadInstagramAccounts = async () => {
        setIgAccountsLoading(true);
        setIgAccountsError(null);

        try {
            const fbUserAccessToken = facebookAccessTokenRef.current;
            if (!fbUserAccessToken) {
                throw new Error('Facebook is not connected. Connect Facebook first.');
            }

            console.log('[Client] Loading Instagram accounts...');
            console.log('[Client] Token prefix:', fbUserAccessToken.substring(0, 15) + '...');

            const res = await authFetch('/api/social?op=ig-accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fbUserAccessToken }),
            });

            let data: any = {};
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                data = await res.json().catch(() => ({}));
            } else {
                const text = await res.text().catch(() => '');
                console.error('[Client] Non-JSON response:', text.substring(0, 500));
                throw new Error(`Server returned ${res.status} ${res.statusText}. Check console for details.`);
            }

            console.log('[Client] ig-accounts response:', data);

            if (!res.ok) {
                throw new Error(data?.error || 'Failed to load Instagram accounts');
            }

            const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
            const diagnostics = data?.diagnostics;

            if (diagnostics) {
                console.log('[Client] Full Diagnostics:', JSON.stringify(diagnostics, null, 2));
                console.log(`[Client] Summary: Found ${diagnostics.pagesCount || 0} Facebook Pages`);
                console.log(`[Client] Instagram accounts found: ${accounts.length}`);

                // Log each page's details
                if (diagnostics.pages) {
                    diagnostics.pages.forEach((page: any, idx: number) => {
                        console.log(`[Client] Page ${idx + 1}: ${page.name} (${page.id})`);
                        console.log(`  - Has access token: ${page.hasAccessToken}`);
                        console.log(`  - instagram_business_account:`, page.instagram_business_account);
                        console.log(`  - connected_instagram_account:`, page.connected_instagram_account);
                        console.log(`  - instagram_accounts:`, page.instagram_accounts);
                    });
                }
            }

            if (accounts.length === 0 && (diagnostics?.pagesCount || 0) > 0) {
                console.warn('[Client] WARNING: Found Facebook Pages but no Instagram accounts!');
                console.warn('[Client] This might mean:');
                console.warn('  1. Your Pages are not connected to Instagram Business/Creator accounts');
                console.warn('  2. You need to connect Instagram to your Page in Meta Business Suite');
                console.warn('  3. The OAuth permissions might be missing required scopes');

                setIgAccountsError(
                    `Found ${diagnostics.pagesCount} Facebook Page(s) but none are connected to Instagram Business/Creator accounts. ` +
                    `Please connect your Instagram account to your Facebook Page in Meta Business Suite first.`
                );
            }

            setIgAccounts(accounts);

            // Client-side comparison check
            const FB = (window as any).FB;
            if (FB && facebookConnected) {
                console.log('[Client] Cross-checking with Facebook SDK...');
                FB.api('/me/accounts?fields=id,name,instagram_business_account{id,username}', (resp: any) => {
                    console.log('[Client] FB SDK Response:', resp);
                    if (resp?.data) {
                        console.log(`[Client] FB SDK found ${resp.data.length} pages`);
                        resp.data.forEach((page: any, idx: number) => {
                            console.log(`  Page ${idx + 1}: ${page.name} - IG Account:`, page.instagram_business_account);
                        });
                    }
                });
            }

            if (!selectedIgId && accounts.length) {
                const first = accounts[0];
                if (first?.igId) setSelectedIgId(String(first.igId));
            }

            return accounts; // Return for immediate use
        } catch (e: any) {
            console.error('[Client] Error loading Instagram accounts:', e);
            setIgAccounts([]);
            setSelectedIgId('');
            setIgAccountsError(e?.message || 'Failed to load Instagram accounts');
            return []; // Return empty array on error
        } finally {
            setIgAccountsLoading(false);
        }
    };

    // Upload-Post handlers
    const loadUpPostProfiles = async () => {
        setUpPostLoading(true);
        setUpPostError(null);
        try {
            const res = await authFetch('/api/social?op=uploadpost-get-users', { method: 'GET' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to load profiles');
            const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
            setUpPostProfiles(profiles);
            if (profiles.length && !upPostActiveProfile) {
                setUpPostActiveProfile(profiles[0]);
                setUpPostProfileUsername(profiles[0].username || '');
            }
        } catch (e: any) {
            setUpPostError(e?.message || 'Failed to load profiles');
        } finally {
            setUpPostLoading(false);
        }
    };

    const handleUpPostCreateProfile = async () => {
        const username = upPostProfileUsername.trim();
        if (!username) return;
        setUpPostLoading(true);
        setUpPostError(null);
        try {
            const res = await authFetch('/api/social?op=uploadpost-create-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username }),
            });

            let data: any = {};
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                data = await res.json().catch(() => ({}));
            } else {
                // If not JSON, it's likely a 404/500 HTML page or similar
                const text = await res.text();
                console.error('Non-JSON response:', text.substring(0, 200));
                throw new Error(`Server returned ${res.status} ${res.statusText} (likely config/rewrite issue)`);
            }

            if (!res.ok) throw new Error(data?.error || 'Failed to create profile');
            await loadUpPostProfiles();
        } catch (e: any) {
            setUpPostError(e?.message || 'Failed to create profile');
        } finally {
            setUpPostLoading(false);
        }
    };

    const handleUpPostGenerateConnectUrl = async () => {
        const username = upPostActiveProfile?.username;
        if (!username) return;
        setUpPostLoading(true);
        setUpPostError(null);
        try {
            const res = await authFetch('/api/social?op=uploadpost-generate-jwt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    redirect_url: window.location.href,
                    platforms: ['tiktok', 'instagram', 'facebook', 'linkedin', 'x'],
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to generate connect URL');
            setUpPostConnectUrl(data?.access_url || null);
            if (data?.access_url) {
                window.open(data.access_url, 'uploadpost_connect', 'width=600,height=700');
            }
        } catch (e: any) {
            setUpPostError(e?.message || 'Failed to generate connect URL');
        } finally {
            setUpPostLoading(false);
        }
    };

    const handleShowEmailAssetSelector = (): Promise<string | null> => {
        return new Promise((resolve) => {
            emailAssetResolver.current = resolve;
            setIsEmailAssetPickerOpen(true);
            setEmailAssetSearch('');
        });
    };

    const handleResolveEmailAsset = (url: string | null) => {
        if (emailAssetResolver.current) {
            emailAssetResolver.current(url);
            emailAssetResolver.current = null;
        }
        setIsEmailAssetPickerOpen(false);
    };

    const handleUpPostSubmit = async () => {
        if (!canEdit) return;
        const username = upPostActiveProfile?.username;
        if (!username) {
            setUpPostError('No profile selected. Create or select a profile first.');
            return;
        }
        if (!upPostPlatforms.length) {
            setUpPostError('Select at least one platform');
            return;
        }
        if (!upPostTitle.trim()) {
            setUpPostError('Title/caption is required');
            return;
        }

        setUpPostPosting(true);
        setUpPostError(null);
        setUpPostResult(null);

        try {
            let endpoint = '/api/social?op=uploadpost-upload-text';
            let body: any = {
                user: username,
                platforms: upPostPlatforms,
                title: upPostTitle.trim(),
                description: upPostDescription.trim() || undefined,
                scheduled_date: upPostScheduleDate || undefined,
                async_upload: true,
            };

            if (upPostPlatforms.includes('facebook') && upPostFacebookPageId) {
                body.facebook_page_id = upPostFacebookPageId;
            }

            if (upPostMediaType === 'video') {
                endpoint = '/api/social?op=uploadpost-upload-video';
                const videoUrlTrimmed = upPostMediaUrl.trim();
                if (!videoUrlTrimmed) {
                    throw new Error('Video URL is required');
                }
                body.videoUrl = videoUrlTrimmed;
            } else if (upPostMediaType === 'photo') {
                endpoint = '/api/social?op=uploadpost-upload-photos';
                const urls = upPostPhotoUrls.split('\n').map(u => u.trim()).filter(Boolean);
                if (!urls.length) {
                    throw new Error('At least one photo URL is required');
                }
                body.photoUrls = urls;
            }

            const res = await authFetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Upload failed');

            setUpPostResult(data);
            // Clear form on success
            setUpPostTitle('');
            setUpPostDescription('');
            setUpPostMediaUrl('');
            setUpPostPhotoUrls('');
            setUpPostScheduleDate('');
        } catch (e: any) {
            setUpPostError(e?.message || 'Upload failed');
            setUpPostPosting(false);
        }
    };

    const loadUpPostHistory = async () => {
        setUpPostHistoryLoading(true);
        try {
            const res = await authFetch('/api/social?op=uploadpost-history&page=1&limit=10', { method: 'GET' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to load history');
            setUpPostHistory(Array.isArray(data?.history) ? data.history : []);
        } catch (e: any) {
            console.error('Failed to load upload history:', e);
        } finally {
            setUpPostHistoryLoading(false);
        }
    };

    const loadUpPostFacebookPages = async () => {
        const username = upPostActiveProfile?.username;
        if (!username) return;
        try {
            const res = await authFetch(`/api/social?op=uploadpost-facebook-pages&profile=${encodeURIComponent(username)}`, { method: 'GET' });
            const data = await res.json().catch(() => ({}));
            if (res.ok && Array.isArray(data?.pages)) {
                setUpPostFacebookPages(data.pages);
                if (data.pages.length && !upPostFacebookPageId) {
                    setUpPostFacebookPageId(data.pages[0].page_id);
                }
            }
        } catch (e) {
            console.error('Failed to load Facebook pages:', e);
        }
    };

    useEffect(() => {
        // Post tab hidden - this effect is disabled
        if (false && activeTab === ('post' as any)) {
            loadUpPostProfiles();
            loadUpPostHistory();
        }
    }, [activeTab]);

    useEffect(() => {
        if (upPostActiveProfile && upPostPlatforms.includes('facebook')) {
            loadUpPostFacebookPages();
        }
    }, [upPostActiveProfile, upPostPlatforms]);

    const handleInstagramPublishDirect = async () => {
        if (!canEdit) return;
        setIgPublishLoading(true);
        setIgPublishError(null);
        setIgPublishResult(null);
        setIgPublishPollingStatus('Starting...');
        setIgPublishPollingError(null);

        try {
            const fbUserAccessToken = facebookAccessTokenRef.current;
            if (!fbUserAccessToken) throw new Error('Facebook is not connected.');
            const igId = selectedIgId.trim();
            if (!igId) throw new Error('Select an Instagram account.');

            // Consolidate media URLs from single input or carousel list
            let urls = igPublishMediaUrls.filter(u => u.trim());
            if (urls.length === 0 && igPublishImageUrl.trim()) {
                urls = [igPublishImageUrl.trim()];
            }
            if (urls.length === 0) throw new Error('At least one media URL is required.');

            console.log('[IG] Publishing', { igPublishMediaType, urls, caption: igPublishCaption });

            const res = await authFetch('/api/social?op=ig-publish-robust', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fbUserAccessToken,
                    igId,
                    mediaType: igPublishMediaType,
                    mediaUrls: urls,
                    caption: igPublishCaption,
                    shareToFeed: igPublishShareToFeed,
                }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'Failed to initiate Instagram publishing');
            }

            const { containerId, mediaId, status } = data;

            if (mediaId) {
                // Already published (likely single image legacy path or immediate success)
                setIgPublishResult({ mediaId });
                setIgPublishPollingStatus('PUBLISHED');
            } else if (containerId) {
                // Need to poll
                setIgPublishPollingStatus('PROCESSING');
                pollInstagramPublishStatus(containerId);
            } else {
                throw new Error('Unexpected response from publishing API');
            }

        } catch (e: any) {
            setIgPublishError(e?.message || 'Failed to publish to Instagram');
            setIgPublishPollingError(e?.message || 'Failed to publish');
        } finally {
            setIgPublishLoading(false);
        }
    };

    const pollInstagramPublishStatus = async (containerId: string) => {
        const fbUserAccessToken = facebookAccessTokenRef.current;
        if (!fbUserAccessToken) return;

        let attempts = 0;
        const maxAttempts = 30; // 3 minutes with 6s interval

        const check = async () => {
            attempts++;
            try {
                const res = await authFetch(`/api/social?op=ig-container-status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fbUserAccessToken, containerId, igId: selectedIgId.trim() })
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok) {
                    setIgPublishPollingError(data?.error || 'Failed to check status');
                    return;
                }

                const statusCode = data?.status_code;
                setIgPublishPollingStatus(statusCode || 'UNKNOWN');

                if (statusCode === 'FINISHED') {
                    // Now we can actually publish it
                    const igId = selectedIgId.trim();
                    setIgPublishPollingStatus('FINALIZING');

                    const publishRes = await authFetch('/api/social?op=ig-publish-container', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fbUserAccessToken, igId, containerId })
                    });
                    const publishData = await publishRes.json().catch(() => ({}));
                    if (!publishRes.ok) {
                        setIgPublishPollingError(publishData?.error || 'Failed to finish publishing');
                    } else {
                        setIgPublishResult(publishData);
                        setIgPublishPollingStatus('PUBLISHED');
                    }
                    return;
                }

                if (statusCode === 'ERROR') {
                    setIgPublishPollingError(data?.status || 'Container creation failed');
                    return;
                }

                if (attempts < maxAttempts) {
                    setTimeout(check, 6000);
                } else {
                    setIgPublishPollingError('Timed out waiting for media processing');
                }
            } catch (err) {
                console.error('Polling error:', err);
            }
        };

        // Initial wait
        setTimeout(check, 5000);
    };



    const loadFacebookPages = async () => {
        setFbPagesLoading(true);
        setFbPagesError(null);
        try {
            const fbUserAccessToken = facebookAccessTokenRef.current;
            if (!fbUserAccessToken) throw new Error('Facebook is not connected.');

            const res = await authFetch('/api/social?op=fb-pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fbUserAccessToken }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to load Facebook Pages');

            const pages = Array.isArray(data?.pages) ? data.pages : [];
            setFbPages(pages);
            if (pages.length > 0 && !selectedFbPageId) {
                setSelectedFbPageId(pages[0].id);
            }
            return pages; // Return for immediate use
        } catch (e: any) {
            setFbPagesError(e?.message || 'Failed to load Facebook Pages');
            return []; // Return empty array on error
        } finally {
            setFbPagesLoading(false);
        }
    };

    const handleFacebookPublish = async () => {
        if (!canEdit) return;
        setFbPostLoading(true);
        setFbPostError(null);
        setFbPostResult(null);

        try {
            const fbUserAccessToken = facebookAccessTokenRef.current;
            if (!fbUserAccessToken) throw new Error('Facebook is not connected.');
            const pageId = selectedFbPageId;
            if (!pageId) throw new Error('No Facebook Page selected.');

            let op = '';
            const body: any = { fbUserAccessToken, pageId };

            if (fbPostType === 'TEXT') {
                if (!fbPostMessage) throw new Error('Post message is required.');
                op = 'fb-publish-post';
                body.message = fbPostMessage;
                if (fbPostLink) body.link = fbPostLink;
            } else if (fbPostType === 'PHOTO') {
                if (!fbPostMediaUrl) throw new Error('Photo URL is required.');
                op = 'fb-publish-photo';
                body.url = fbPostMediaUrl;
                body.caption = fbPostMessage; // Caption uses the message field
            } else if (fbPostType === 'VIDEO') {
                if (!fbPostMediaUrl) throw new Error('Video URL is required.');
                op = 'fb-publish-video';
                body.file_url = fbPostMediaUrl;
                if (fbPostTitle) body.title = fbPostTitle;
                if (fbPostMessage) body.description = fbPostMessage; // Description uses message field
            }

            const res = await authFetch(`/api/social?op=${op}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to publish to Facebook Page');

            setFbPostResult(data);
            // Clear message helps specific clearing if desired, but keeping form state might be better UX for retry/duplication.
            // setFbPostMessage(''); 
        } catch (e: any) {
            setFbPostError(e?.message || 'Failed to publish');
        } finally {
            setFbPostLoading(false);
        }
    };

    const handleXSearch = async () => {
        if (!canEdit) return;
        if (!xSearchQuery.trim()) return;
        setXSearchLoading(true);
        setXSearchError(null);
        setXSearchResults(null);

        try {
            const currentUser = storageService.getCurrentUser();
            if (!currentUser) throw new Error('You must be logged in.');

            const op = xSearchMode === 'tweets' ? 'x-recent-search' : 'x-user-search';
            const res = await authFetch(`/api/social?op=${op}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUser, query: xSearchQuery.trim() })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to search X');

            setXSearchResults(data);

        } catch (e: any) {
            setXSearchError(e?.message || 'X search failed');
        } finally {
            setXSearchLoading(false);
        }
    };



    // TikTok handlers
    const handleTiktokConnect = async () => {
        if (!canEdit) return;
        setTiktokLoading(true);
        setTiktokError(null);

        try {
            // FIX: Add ?op=tiktok-auth-url to the URL
            const res = await authFetch('/api/social?op=tiktok-auth-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: Math.random().toString(36).substring(2) }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to get TikTok auth URL');

            const authUrl = data.authUrl as string;
            const state = data.state as string;

            // On some mobile browsers, popup blockers will prevent window.open with features.
            // Use a more permissive fallback that navigates the current tab when pop‑ups are blocked.
            const width = 600;
            const height = 700;
            const left = window.screenX + (window.outerWidth - width) / 2;
            const top = window.screenY + (window.outerHeight - height) / 2;

            let popup: Window | null = null;
            try {
                popup = window.open(
                    authUrl,
                    'TikTok Login',
                    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
                );
            } catch {
                popup = null;
            }

            if (!popup) {
                // Fallback for strict mobile popup blockers: navigate current window.
                window.location.href = authUrl;
                setTiktokLoading(false);
                return;
            }

            // Poll for the popup to close and check for code in URL
            const pollTimer = setInterval(async () => {
                try {
                    if (!popup || popup.closed) {
                        clearInterval(pollTimer);
                        setTiktokLoading(false);
                        return;
                    }

                    // Check if redirected back with code
                    const popupUrl = popup.location?.href;
                    if (popupUrl && popupUrl.includes('code=')) {
                        clearInterval(pollTimer);
                        popup.close();

                        const url = new URL(popupUrl);
                        const code = url.searchParams.get('code');
                        const returnedState = url.searchParams.get('state');

                        if (returnedState !== state) {
                            throw new Error('State mismatch. Please try again.');
                        }

                        if (!code) {
                            throw new Error('No authorization code received.');
                        }

                        // FIX: Add ?op=tiktok-exchange to the URL
                        const tokenRes = await authFetch('/api/social?op=tiktok-exchange', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ code }),
                        });
                        const tokenData = await tokenRes.json().catch(() => ({}));
                        if (!tokenRes.ok) throw new Error(tokenData?.error || 'Failed to exchange TikTok code');

                        tiktokAccessTokenRef.current = tokenData.accessToken;
                        tiktokRefreshTokenRef.current = tokenData.refreshToken;
                        tiktokOpenIdRef.current = tokenData.openId;
                        setTiktokConnected(true);

                        // Persist to Firestore
                        const currentUser = storageService.getCurrentUser();
                        if (currentUser) {
                            const now = Date.now();
                            await saveTikTokTokens(currentUser, {
                                accessToken: tokenData.accessToken,
                                refreshToken: tokenData.refreshToken,
                                openId: tokenData.openId,
                                expiresAt: now + (tokenData.expiresIn * 1000),
                                refreshExpiresAt: now + (tokenData.refreshExpiresIn * 1000),
                            });
                        }

                        // Load creator info
                        await loadTiktokCreatorInfo();
                    }
                } catch {
                    // Cross-origin errors are expected until redirect
                }
            }, 500);

        } catch (e: any) {
            setTiktokError(e?.message || 'Failed to connect TikTok');
        } finally {
            setTiktokLoading(false);
        }
    };

    const handleTiktokDisconnect = async () => {
        if (!canEdit) return;
        setTiktokLoading(true);
        setTiktokError(null);

        try {
            const accessToken = tiktokAccessTokenRef.current;
            if (accessToken) {
                // FIX: Add ?op=tiktok-revoke to the URL
                await authFetch('/api/social?op=tiktok-revoke', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accessToken }),
                });
            }

            // Clear from Firestore
            const currentUser = storageService.getCurrentUser();
            if (currentUser) {
                await deleteTikTokTokens(currentUser);
            }
        } catch (e: any) {
            // Ignore revoke errors, just disconnect locally
        } finally {
            tiktokAccessTokenRef.current = null;
            tiktokRefreshTokenRef.current = null;
            tiktokOpenIdRef.current = null;
            setTiktokConnected(false);
            setTiktokCreatorInfo(null);
            setTiktokLoading(false);
        }
    };

    const refreshTiktokToken = async (refreshToken: string) => {
        try {
            // FIX: Add ?op=tiktok-refresh to the URL
            const res = await authFetch('/api/social?op=tiktok-refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to refresh TikTok token');

            tiktokAccessTokenRef.current = data.accessToken;
            tiktokRefreshTokenRef.current = data.refreshToken;
            tiktokOpenIdRef.current = data.openId;
            setTiktokConnected(true);

            // Persist to Firestore
            const currentUser = storageService.getCurrentUser();
            if (currentUser) {
                const now = Date.now();
                await saveTikTokTokens(currentUser, {
                    accessToken: data.accessToken,
                    refreshToken: data.refreshToken,
                    openId: data.openId,
                    expiresAt: now + (data.expiresIn * 1000),
                    refreshExpiresAt: now + (data.refreshExpiresIn * 1000),
                });
            }

            return data.accessToken;
        } catch (e: any) {
            console.error('Failed to refresh TikTok token:', e);

            // If refresh fails, clear TikTok auth state so the rest of the dashboard
            // continues to work as if TikTok were simply not connected.
            tiktokAccessTokenRef.current = null;
            tiktokRefreshTokenRef.current = null;
            tiktokOpenIdRef.current = null;
            setTiktokConnected(false);
            setTiktokCreatorInfo(null);

            setTiktokError(
                e?.message?.includes('invalid') || e?.message?.includes('expired')
                    ? 'Your TikTok connection has expired. Please reconnect.'
                    : 'Failed to refresh TikTok token.'
            );

            return null;
        }
    };

    const loadStoredTiktokTokens = async () => {
        const currentUser = storageService.getCurrentUser();
        if (!currentUser) return;

        setTiktokLoading(true);
        try {
            const tokens = await getTikTokTokens(currentUser);
            if (tokens) {
                const now = Date.now();
                // If expired or expiring soon (within 5 mins), refresh
                if (now > tokens.expiresAt - 300000) {
                    if (now < tokens.refreshExpiresAt) {
                        await refreshTiktokToken(tokens.refreshToken);
                    } else {
                        // Both expired
                        setTiktokConnected(false);
                    }
                } else {
                    tiktokAccessTokenRef.current = tokens.accessToken;
                    tiktokRefreshTokenRef.current = tokens.refreshToken;
                    tiktokOpenIdRef.current = tokens.openId;
                    setTiktokConnected(true);
                    await loadTiktokCreatorInfo();
                }
            }
        } catch (e) {
            console.error('Failed to load TikTok tokens:', e);
        } finally {
            setTiktokLoading(false);
        }
    };

    const loadStoredFacebookTokens = async () => {
        const currentUser = storageService.getCurrentUser();
        if (!currentUser) return;

        try {
            console.log('[FB] Loading stored tokens from Firestore...');
            const storedTokens = await getFacebookTokens(currentUser);
            if (storedTokens && storedTokens.accessToken) {
                console.log('[FB] Found stored tokens, restoring connection...');
                facebookAccessTokenRef.current = storedTokens.accessToken;
                setFacebookConnected(true);

                if (storedTokens.profile) {
                    setFacebookProfile(storedTokens.profile);
                }
                if (storedTokens.pages && storedTokens.pages.length > 0) {
                    setFbPages(storedTokens.pages);
                }
                if (storedTokens.selectedPageId) {
                    setSelectedFbPageId(storedTokens.selectedPageId);
                }
                if (storedTokens.igAccounts && storedTokens.igAccounts.length > 0) {
                    setIgAccounts(storedTokens.igAccounts);
                }
                if (storedTokens.selectedIgId) {
                    setSelectedIgId(storedTokens.selectedIgId);
                }

                console.log('[FB] Connection restored from stored tokens');
            }
        } catch (e) {
            console.error('[FB] Failed to load stored tokens:', e);
        }
    };

    const loadTiktokCreatorInfo = async () => {
        try {
            const accessToken = tiktokAccessTokenRef.current;
            if (!accessToken) return;

            const res = await authFetch('/api/social?op=tiktok-creator-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken }),
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                const message = data?.error || res.statusText || 'Failed to load TikTok creator info';
                console.error('Failed to load TikTok creator info:', message);

                // If the token is invalid/expired or TikTok is not connected,
                // gracefully treat the user as "not connected" instead of breaking the dashboard.
                if (
                    res.status === 401 ||
                    /access token is invalid|not connected/i.test(message)
                ) {
                    tiktokAccessTokenRef.current = null;
                    tiktokRefreshTokenRef.current = null;
                    tiktokOpenIdRef.current = null;
                    setTiktokConnected(false);
                    setTiktokCreatorInfo(null);
                    setTiktokError('TikTok is not connected. Please reconnect.');
                } else {
                    setTiktokError(message);
                }

                return;
            }

            setTiktokCreatorInfo(data);
            if (data.privacyLevelOptions?.includes('PUBLIC_TO_EVERYONE')) {
                setTiktokPrivacyLevel('PUBLIC_TO_EVERYONE');
            } else if (data.privacyLevelOptions?.length) {
                setTiktokPrivacyLevel(data.privacyLevelOptions[0]);
            }
        } catch (e: any) {
            console.error('Failed to load TikTok creator info:', e);
            setTiktokCreatorInfo(null);
            setTiktokError(e?.message || 'Failed to load TikTok creator info');
        }
    };

    const handleTiktokPostVideo = async () => {
        if (!canEdit) return;
        setTiktokPostLoading(true);
        setTiktokPostError(null);
        setTiktokPostResult(null);

        try {
            const accessToken = tiktokAccessTokenRef.current;
            if (!accessToken) throw new Error('TikTok is not connected.');

            let publishId = '';

            // Fetch video file from URL, ASSET, or local UPLOAD
            let file: Blob | null = null;

            if (tiktokVideoSource === 'URL') {
                const videoUrl = tiktokVideoUrl.trim();
                if (!videoUrl) throw new Error('Video URL is required.');

                // Fetch the video from the URL
                const fileRes = await fetch(videoUrl);
                if (!fileRes.ok) throw new Error('Failed to fetch video from URL');
                file = await fileRes.blob();
            } else if (tiktokVideoSource === 'ASSET') {
                const assetId = tiktokSelectedAssetId;
                const asset = [...(project.knowledgeBase || []), ...(project.uploadedFiles || [])].find(
                    a => (a as any).id === assetId || (a as any).name === assetId
                );
                if (!asset) throw new Error('Selected asset not found.');
                const fileRes = await fetch((asset as any).url);
                file = await fileRes.blob();
            } else {
                // UPLOAD source
                file = tiktokUploadFile;
            }

            if (!file) throw new Error('No file selected for upload.');

            // Use direct post or inbox mode based on user selection
            if (tiktokVideoPostMode === 'direct') {
                // Direct post mode - posts immediately with metadata
                const initRes = await authFetch('/api/social?op=tiktok-post-video-init', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        accessToken,
                        videoSize: file.size,
                        chunkSize: file.size,
                        totalChunkCount: 1,
                        title: tiktokVideoTitle,
                        privacyLevel: tiktokPrivacyLevel,
                        disableDuet: tiktokDisableDuet,
                        disableStitch: tiktokDisableStitch,
                        disableComment: tiktokDisableComment,
                    }),
                });
                const initData = await initRes.json().catch(() => ({}));
                if (!initRes.ok) throw new Error(initData?.error || 'Failed to initialize TikTok upload');

                publishId = initData.publishId;
                const uploadUrl = initData.uploadUrl;

                // Upload the file to TikTok's upload URL
                const putRes = await fetch(uploadUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Range': `bytes 0-${file.size - 1}/${file.size}`,
                        'Content-Type': 'video/mp4',
                    },
                    body: file,
                });

                if (!putRes.ok) {
                    throw new Error(`Failed to upload video to TikTok (${putRes.status})`);
                }
            } else {
                // Inbox/draft mode - sends to inbox for user review
                const initRes = await authFetch('/api/social?op=tiktok-post-video-init-inbox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        accessToken,
                        videoSize: file.size,
                        chunkSize: file.size,
                        totalChunkCount: 1,
                    }),
                });
                const initData = await initRes.json().catch(() => ({}));
                if (!initRes.ok) throw new Error(initData?.error || 'Failed to initialize TikTok upload');

                publishId = initData.publishId;
                const uploadUrl = initData.uploadUrl;

                // Upload the file to TikTok's upload URL
                const putRes = await fetch(uploadUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Range': `bytes 0-${file.size - 1}/${file.size}`,
                        'Content-Type': 'video/mp4',
                    },
                    body: file,
                });

                if (!putRes.ok) {
                    throw new Error(`Failed to upload video to TikTok (${putRes.status})`);
                }
            }

            setTiktokPostResult({ publishId, status: 'PROCESSING' });

            // Poll for status
            pollTiktokPostStatus(publishId);
        } catch (e: any) {
            setTiktokPostError(e?.message || 'Failed to post to TikTok');
        } finally {
            setTiktokPostLoading(false);
        }
    };


    const handleTiktokPostPhotos = async () => {
        if (!canEdit) return;
        setTiktokPostLoading(true);
        setTiktokPostError(null);
        setTiktokPostResult(null);

        try {
            const accessToken = tiktokAccessTokenRef.current;
            if (!accessToken) throw new Error('TikTok is not connected.');

            const validUrls = tiktokPhotoUrls.filter(u => u.trim());
            if (!validUrls.length) throw new Error('At least one photo URL is required.');

            // FIX: Add ?op=tiktok-post-photo to the URL
            const res = await authFetch('/api/social?op=tiktok-post-photo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accessToken,
                    photoUrls: validUrls,
                    title: tiktokPhotoTitle,
                    description: tiktokPhotoDescription,
                    privacyLevel: tiktokPrivacyLevel,
                    disableComment: tiktokDisableComment,
                    autoAddMusic: tiktokAutoAddMusic,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to post photos to TikTok');

            setTiktokPostResult({ publishId: data.publishId, status: 'PROCESSING' });

            // Poll for status
            pollTiktokPostStatus(data.publishId);
        } catch (e: any) {
            setTiktokPostError(e?.message || 'Failed to post photos to TikTok');
        } finally {
            setTiktokPostLoading(false);
        }
    };

    const pollTiktokPostStatus = async (publishId: string) => {
        const accessToken = tiktokAccessTokenRef.current;
        if (!accessToken) return;

        let attempts = 0;
        const maxAttempts = 30;

        const poll = async () => {
            attempts++;
            try {
                // FIX: Add ?op=tiktok-post-status to the URL
                const res = await authFetch('/api/social?op=tiktok-post-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accessToken, publishId }),
                });
                const data = await res.json().catch(() => ({}));

                const status = data.status || 'UNKNOWN';
                setTiktokPostResult((prev) => prev ? { ...prev, status } : { publishId, status });

                if (status === 'PUBLISH_COMPLETE' || status === 'FAILED' || status === 'SEND_TO_USER_INBOX') {
                    if (status === 'FAILED') {
                        setTiktokPostError(`Post failed: ${data.failReason || 'Unknown reason'}`);
                    }
                    return;
                }

                if (attempts < maxAttempts) {
                    setTimeout(poll, 3000);
                }
            } catch (e) {
                // Stop polling on error
            }
        };

        setTimeout(poll, 2000);
    };

    // YouTube Functions
    const checkYoutubeStatus = async () => {
        try {
            const res = await authFetch('/api/google?op=youtube-status');
            const data = await res.json().catch(() => ({}));
            if (data.connected) {
                setYoutubeConnected(true);
                setYoutubeChannel(data.channel || null);
            } else {
                setYoutubeConnected(false);
                setYoutubeChannel(null);
            }
        } catch (e) {
            console.error('Failed to check YouTube status', e);
            setYoutubeConnected(false);
        }
    };

    const handleYoutubeConnect = async () => {
        try {
            const res = await authFetch('/api/google?op=youtube-auth-url');
            const data = await res.json().catch(() => ({}));
            if (data.url) {
                const url = data.url as string;
                const width = 600;
                const height = 700;
                const left = window.screen.width / 2 - width / 2;
                const top = window.screen.height / 2 - height / 2;

                let popup: Window | null = null;
                try {
                    popup = window.open(url, 'YouTubeAuth', `width=${width},height=${height},left=${left},top=${top}`);
                } catch {
                    popup = null;
                }

                if (!popup) {
                    // Mobile / strict popup-blocker fallback: navigate current tab.
                    window.location.href = url;
                }
            } else {
                alert('Failed to get auth URL');
            }
        } catch (e) {
            console.error('Failed to start YouTube auth', e);
        }
    };

    const handleYoutubeDisconnect = async () => {
        if (!confirm('Are you sure you want to disconnect YouTube?')) return;
        try {
            const res = await authFetch('/api/google?op=google-disconnect', { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setYoutubeConnected(false);
                setYoutubeChannel(null);
            } else {
                throw new Error(data.error || 'Failed to disconnect YouTube');
            }
        } catch (e: any) {
            console.error(e);
            alert(e.message || 'Failed to disconnect YouTube');
        }
    };

    const handleYoutubePost = async () => {
        setYoutubeUploadLoading(true);
        setYoutubePostError(null);
        setYoutubePostSuccess(null);

        try {
            // 1. Get file
            let file: Blob | null = null;
            if (youtubeVideoSource === 'URL') {
                const urlStr = youtubeVideoUrl.trim();
                if (!urlStr) throw new Error('Video URL is required');
                const fileRes = await fetch(urlStr);
                if (!fileRes.ok) throw new Error('Failed to fetch video from URL');
                file = await fileRes.blob();
            } else if (youtubeVideoSource === 'ASSET') {
                const asset = [...(project.knowledgeBase || []), ...(project.uploadedFiles || [])].find(
                    a => (a as any).id === youtubeSelectedAssetId || (a as any).name === youtubeSelectedAssetId
                );
                if (!asset) throw new Error('Selected asset not found');
                const fileRes = await fetch((asset as any).url);
                file = await fileRes.blob();
            } else {
                file = youtubeUploadFile;
            }

            if (!file) throw new Error('No video file selected');

            // 2. Initiate Upload
            const mimeType = file.type || 'video/mp4';
            const initRes = await authFetch('/api/google?op=youtube-upload-init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: youtubeVideoTitle || 'Untitled Video',
                    description: youtubeVideoDescription,
                    privacyStatus: youtubePrivacyStatus,
                    tags: youtubeTags.split(',').map(t => t.trim()).filter(Boolean),
                    categoryId: youtubeCategoryId,
                    madeForKids: youtubeMadeForKids,
                    notifySubscribers: youtubeNotifySubscribers,
                    mimeType: mimeType,
                }),
            });

            const initData = await initRes.json().catch(() => ({}));
            if (!initRes.ok) throw new Error(initData?.error || 'Failed to initiate YouTube upload');

            const uploadUrl = initData.uploadUrl;
            if (!uploadUrl) throw new Error('No upload URL returned from YouTube');

            // 3. Upload File
            // Using generic fetch for the upload
            try {
                const putRes = await fetch(uploadUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': mimeType,
                    },
                    body: file,
                });

                if (!putRes.ok) {
                    throw new Error(`Upload to YouTube failed: ${putRes.status}`);
                }

                // Success processing
                const result = await putRes.json().catch(() => ({}));
                setYoutubePostSuccess('Video uploaded successfully to YouTube!');
                setYoutubeVideoTitle('');
                setYoutubeVideoDescription('');
                setYoutubeUploadFile(null);
                setYoutubeVideoUrl('');
            } catch (uploadError: any) {
                console.error('YouTube Upload Error:', uploadError);
                if (uploadError.message === 'Failed to fetch' || uploadError.message.includes('NetworkError')) {
                    throw new Error('Network error or CORS issue. Please ensure "http://localhost:3001" is added to "Authorized JavaScript origins" in your Google Cloud Console for the OAuth Client ID.');
                }
                throw uploadError;
            }

            setYoutubeSelectedAssetId('');

        } catch (e: any) {
            setYoutubePostError(e?.message || 'Failed to upload video');
        } finally {
            setYoutubeUploadLoading(false);
        }
    };

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type === 'youtube:connected') {
                checkYoutubeStatus();
            }
            if (event.data?.type === 'x:connected') {
                checkXStatus();
            }
            if (event.data?.type === 'linkedin:connected') {
                checkLinkedinStatus();
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    useEffect(() => {
        if (activeTab === 'social') {
            checkYoutubeStatus();
            checkXStatus();
            checkLinkedinStatus();
        }
    }, [activeTab]);

    // LinkedIn Functions
    const checkLinkedinStatus = async () => {
        try {
            const res = await authFetch('/api/social?op=linkedin-status');
            const data = await res.json().catch(() => ({}));
            setLinkedinConnected(!!data.connected);
            setLinkedinProfile(data.profile || null);
        } catch (e) {
            console.error('Failed to check LinkedIn status:', e);
            setLinkedinConnected(false);
            setLinkedinProfile(null);
        }
    };

    const handleLinkedinConnect = async () => {
        try {
            const res = await authFetch('/api/social?op=linkedin-auth-url');
            const data = await res.json().catch(() => ({}));
            if (data.url) {
                const popup = window.open(data.url, 'linkedin-auth', 'width=600,height=700');
                if (!popup) {
                    window.location.href = data.url;
                }
            }
        } catch (e: any) {
            console.error('Failed to initiate LinkedIn connect:', e);
            setLinkedinPostError(e?.message || 'Failed to connect LinkedIn');
        }
    };

    const handleLinkedinDisconnect = async () => {
        if (!confirm('Are you sure you want to disconnect LinkedIn?')) return;
        try {
            const res = await authFetch('/api/social?op=linkedin-disconnect', { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setLinkedinConnected(false);
                setLinkedinProfile(null);
            } else {
                throw new Error(data.error || 'Failed to disconnect LinkedIn');
            }
        } catch (e: any) {
            console.error(e);
            alert(e.message || 'Failed to disconnect LinkedIn');
        }
    };

    const handleLinkedinPost = async () => {
        setLinkedinPostLoading(true);
        setLinkedinPostError(null);
        setLinkedinPostSuccess(null);

        try {
            if (linkedinPostType === 'TEXT') {
                if (!linkedinPostText.trim()) throw new Error('Post text is required');

                const res = await authFetch('/api/social?op=linkedin-post-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: linkedinPostText,
                        visibility: linkedinVisibility,
                    }),
                });

                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error || 'Failed to create post');

                setLinkedinPostSuccess('Posted successfully to LinkedIn!');
                setLinkedinPostText('');

            } else if (linkedinPostType === 'ARTICLE') {
                if (!linkedinArticleUrl.trim()) throw new Error('Article URL is required');

                const res = await authFetch('/api/social?op=linkedin-post-article', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: linkedinPostText,
                        articleUrl: linkedinArticleUrl,
                        articleTitle: linkedinArticleTitle || undefined,
                        articleDescription: linkedinArticleDescription || undefined,
                        visibility: linkedinVisibility,
                    }),
                });

                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error || 'Failed to create post');

                setLinkedinPostSuccess('Article shared successfully to LinkedIn!');
                setLinkedinPostText('');
                setLinkedinArticleUrl('');
                setLinkedinArticleTitle('');
                setLinkedinArticleDescription('');

            } else if (linkedinPostType === 'IMAGE' || linkedinPostType === 'VIDEO') {
                // Get file
                let file: Blob | null = null;
                if (linkedinMediaSource === 'URL') {
                    const urlStr = linkedinMediaUrl.trim();
                    if (!urlStr) throw new Error('Media URL is required');
                    const fileRes = await fetch(urlStr);
                    if (!fileRes.ok) throw new Error('Failed to fetch media from URL');
                    file = await fileRes.blob();
                } else if (linkedinMediaSource === 'ASSET') {
                    const asset = [...(project.knowledgeBase || []), ...(project.uploadedFiles || [])].find(
                        a => (a as any).id === linkedinSelectedAssetId || (a as any).name === linkedinSelectedAssetId
                    );
                    if (!asset) throw new Error('Selected asset not found');
                    const fileRes = await fetch((asset as any).url);
                    file = await fileRes.blob();
                } else {
                    file = linkedinUploadFile;
                }

                if (!file) throw new Error('No media file selected');

                // Register upload
                const registerRes = await authFetch('/api/social?op=linkedin-register-upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mediaType: linkedinPostType }),
                });

                const registerData = await registerRes.json().catch(() => ({}));
                if (!registerRes.ok) throw new Error(registerData?.error || 'Failed to register upload');

                const { uploadUrl, asset } = registerData;

                // Upload media via backend proxy to avoid CORS and handle auth
                const uploadRes = await authFetch(`/api/social?op=linkedin-upload-media&uploadUrl=${encodeURIComponent(uploadUrl)}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': file.type,
                    },
                    body: file,
                });

                if (!uploadRes.ok) {
                    throw new Error(`Failed to upload media: ${uploadRes.status}`);
                }

                // Create post with media
                const postRes = await authFetch('/api/social?op=linkedin-post-media', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: linkedinPostText,
                        asset,
                        mediaType: linkedinPostType,
                        visibility: linkedinVisibility,
                    }),
                });

                const postData = await postRes.json().catch(() => ({}));
                if (!postRes.ok) throw new Error(postData?.error || 'Failed to create post');

                setLinkedinPostSuccess(`${linkedinPostType === 'IMAGE' ? 'Image' : 'Video'} posted successfully to LinkedIn!`);
                setLinkedinPostText('');
                setLinkedinUploadFile(null);
                setLinkedinMediaUrl('');
                setLinkedinSelectedAssetId('');
            }

        } catch (e: any) {
            console.error('LinkedIn post error:', e);
            setLinkedinPostError(e?.message || 'Failed to post to LinkedIn');
        } finally {
            setLinkedinPostLoading(false);
        }
    };

    // --- X (Twitter) Integration Functions ---

    const checkXStatus = async () => {
        try {
            const res = await authFetch('/api/social?op=x-status');
            if (res.ok) {
                const data = await res.json();
                setXConnected(data.connected);
                if (data.profile) setXProfile(data.profile);
            }
        } catch (e) {
            console.error('Failed to check X status', e);
        }
    };

    const handleXConnect = async () => {
        try {
            const u = auth.currentUser;
            if (!u) return;

            const res = await authFetch(`/api/social?op=x-auth-url&uid=${u.uid}`);
            if (!res.ok) throw new Error('Failed to get auth URL');
            const { url } = await res.json();

            const width = 600;
            const height = 700;
            const left = window.screen.width / 2 - width / 2;
            const top = window.screen.height / 2 - height / 2;

            let popup: Window | null = null;
            try {
                popup = window.open(url, 'Connect X', `width=${width},height=${height},left=${left},top=${top}`);
            } catch {
                popup = null;
            }

            if (!popup) {
                // Mobile / strict popup-blocker fallback: navigate current tab.
                window.location.href = url;
            }
        } catch (e: any) {
            console.error(e);
            alert('Failed to initiate X connection');
        }
    };

    const handleXDisconnect = async () => {
        if (!confirm('Are you sure you want to disconnect X (Twitter)?')) return;
        try {
            const res = await authFetch('/api/social?op=x-disconnect', { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setXConnected(false);
                setXProfile(null);
            } else {
                throw new Error(data.error || 'Failed to disconnect X');
            }
        } catch (e: any) {
            console.error(e);
            alert(e.message || 'Failed to disconnect X');
        }
    };

    const handleShareToX = (asset: any) => {
        // Navigate to Social tab, set Unified mode, and configure initial state for image posting
        setActiveTab('social');
        setSocialPublisherMode('unified');

        // Determine post type based on asset type
        // Check for video: MIME type (video/*), literal type ('video'), or URL patterns
        let postType: 'TEXT' | 'IMAGE' | 'VIDEO' = 'IMAGE';
        const assetType = asset.type?.toLowerCase() || '';
        const mimeType = asset.mimeType?.toLowerCase() || '';
        const url = (asset.url || asset.uri || '').toLowerCase();

        if (
            assetType.startsWith('video/') ||
            mimeType.startsWith('video/') ||
            assetType === 'video' ||
            url.endsWith('.mp4') ||
            url.endsWith('.mov') ||
            url.endsWith('.webm')
        ) {
            postType = 'VIDEO';
        } else if (
            assetType.startsWith('image/') ||
            mimeType.startsWith('image/') ||
            assetType === 'header' ||
            assetType === 'slide' ||
            assetType === 'social' ||
            url.endsWith('.png') ||
            url.endsWith('.jpg') ||
            url.endsWith('.jpeg') ||
            url.endsWith('.webp')
        ) {
            postType = 'IMAGE';
        } else if (assetType === 'blog') {
            postType = 'TEXT';
        }

        // Set initial state for the unified publisher
        setUnifiedPublisherInitialState({
            postType,
            mediaSource: 'ASSET',
            selectedAssetId: asset.id || asset.name,
            assetUrl: asset.url || asset.uri,
            assetType: asset.type || asset.mimeType || 'image/png',
            textContent: assetType === 'blog' && asset.data?.content ? asset.data.content : undefined,
        });

        // Scroll to top of social section
        setTimeout(() => {
            const el = document.querySelector('[data-tab="social"]');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    };

    const handleXPost = async () => {
        setXPostLoading(true);
        setXPostError(null);
        setXPostSuccess(null);

        try {
            let mediaId = '';

            if (xPostType === 'IMAGE' || xPostType === 'VIDEO') {
                let file: Blob | null = null;

                if (xMediaSource === 'UPLOAD') {
                    file = xUploadFile;
                } else if (xMediaSource === 'ASSET' && xSelectedAssetId) {
                    const asset = projectAssets.find(a => (a as any).id === xSelectedAssetId || (a as any).name === xSelectedAssetId);
                    if (!asset) throw new Error('Selected asset not found');
                    const r = await fetch((asset as any).url);
                    file = await r.blob();
                }

                if (!file) throw new Error('No media file selected');

                // INIT
                // 'tweet_video' or 'tweet_image'
                const category = xPostType === 'VIDEO' ? 'tweet_video' : 'tweet_image';

                const initRes = await authFetch('/api/social?op=x-upload-init', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mediaType: file.type,
                        totalBytes: file.size,
                        mediaCategory: category
                    })
                });

                if (!initRes.ok) {
                    const err = await initRes.json().catch(() => ({}));
                    throw new Error(err.error || 'Failed to init upload');
                }
                const initData = await initRes.json();
                mediaId = initData.id_str || initData.media_id_string || initData.id; // Use string ID

                // APPEND (Chunks)
                const CHUNK_SIZE = 1024 * 1024; // 1MB
                const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

                for (let i = 0; i < totalChunks; i++) {
                    const start = i * CHUNK_SIZE;
                    const end = Math.min(file.size, start + CHUNK_SIZE);
                    const chunk = file.slice(start, end);

                    const appendRes = await authFetch(`/api/social?op=x-upload-append&mediaId=${mediaId}&segmentIndex=${i}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: chunk
                    });
                    if (!appendRes.ok) {
                        const err = await appendRes.text();
                        throw new Error(`Failed to upload chunk ${i}: ${err}`);
                    }
                }

                // FINALIZE
                const finalizeRes = await authFetch('/api/social?op=x-upload-finalize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mediaId })
                });

                if (!finalizeRes.ok) throw new Error('Failed to finalize upload');
                const finalizeData = await finalizeRes.json();

                // Basic wait for processing for videos
                if (finalizeData.processing_info && finalizeData.processing_info.state !== 'succeeded') {
                    // For now, valid hack: wait 5s for short videos
                    await new Promise(r => setTimeout(r, 5000));
                }
            }

            // POST TWEET
            const postRes = await authFetch('/api/social?op=x-post-tweet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: xPostText,
                    mediaIds: mediaId ? [mediaId] : []
                })
            });

            if (!postRes.ok) {
                const err = await postRes.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to post tweet');
            }

            setXPostSuccess('Tweet posted successfully!');
            setXPostText('');
            setXUploadFile(null);
            setXMediaUrl('');

        } catch (e: any) {
            console.error(e);
            setXPostError(e.message || 'Failed to post to X');
        } finally {
            setXPostLoading(false);
        }
    };

    const handleEmailBuilderUpload = async (file: File): Promise<string> => {
        if (!canEdit) throw new Error('Permission denied');
        try {
            if (!auth.currentUser) throw new Error("User not authenticated");
            const kbFile = await uploadFileToStorage(auth.currentUser.uid, project.id, file);

            // Convert KnowledgeBaseFile to UploadedFile
            const newUpload: UploadedFile = {
                id: kbFile.id,
                name: kbFile.name,
                uri: kbFile.storagePath,
                mimeType: kbFile.type,
                sizeBytes: kbFile.size,
                displayName: kbFile.name,
                uploadedAt: kbFile.uploadedAt,
                url: kbFile.url,
                summary: kbFile.summary
            };

            const updatedProject = {
                ...project,
                uploadedFiles: [...(project.uploadedFiles || []), newUpload]
            };

            if (onProjectUpdate) {
                onProjectUpdate(updatedProject);
            }

            await updateResearchProjectInFirestore(
                auth.currentUser.uid,
                project.id,
                { uploadedFiles: updatedProject.uploadedFiles }
            );

            return newUpload.url || '';
        } catch (error) {
            console.error("Error uploading asset:", error);
            throw error;
        }
    };

    const handleEmailBuilderSaveTemplate = async (template: EmailTemplate) => {
        if (!canEdit) return;

        try {
            if (!auth.currentUser) throw new Error("User not authenticated");

            // Check if template already exists
            const existingTemplates = project.emailTemplates || [];
            const existingIndex = existingTemplates.findIndex(t => t.id === template.id);

            let updatedTemplates;
            if (existingIndex >= 0) {
                updatedTemplates = [...existingTemplates];
                updatedTemplates[existingIndex] = template;
            } else {
                updatedTemplates = [...existingTemplates, template];
            }

            const updatedProject = {
                ...project,
                emailTemplates: updatedTemplates
            };

            if (onProjectUpdate) {
                onProjectUpdate(updatedProject);
            }

            await updateResearchProjectInFirestore(
                project.ownerUid || auth.currentUser.uid,
                project.id,
                { emailTemplates: updatedTemplates }
            );
        } catch (error) {
            console.error("Error saving email template:", error);
            alert("Failed to save template");
        }
    };

    // Helper to get access token for media upload (simplified - uses status check)
    const getLinkedinAccessToken = async (): Promise<string> => {
        // For media uploads, we need a fresh token - trigger a status check which refreshes if needed
        // Note: In production, this should be handled server-side
        return ''; // LinkedIn media upload uses the registered uploadUrl which includes auth
    };

    useEffect(() => {
        if (activeTab === 'social') {
            checkLinkedinStatus();
        }
    }, [activeTab]);

    const refreshFacebookStatus = async (manualResponse?: any) => {
        setFacebookStatusLoading(true);
        setFacebookError(null);

        try {
            const FB = (window as any).FB;
            if (!FB) {
                setFacebookConnected(false);
                setFacebookProfile(null);
                facebookAccessTokenRef.current = null;
                return false;
            }

            const status = manualResponse || await new Promise<any>((resolve) => {
                FB.getLoginStatus((resp: any) => {
                    resolve(resp);
                }, true);
            });

            // Special handling for localhost/HTTP where getLoginStatus fails but we might already have a token
            if (!manualResponse && status?.status === 'unknown' && window.location.protocol === 'http:' && facebookAccessTokenRef.current) {
                console.log('[FB] Protocol restricted (HTTP), preserving existing state');
                return true;
            }

            const isConnected = status?.status === 'connected' && Boolean(status?.authResponse?.accessToken);

            if (isConnected) {
                setFacebookConnected(true);
                facebookAccessTokenRef.current = status.authResponse.accessToken;
            } else {
                // SDK says not connected (or session expired). 
                // BUT we might have a valid long-lived token from storage.
                if (facebookAccessTokenRef.current) {
                    console.log('[FB] SDK session invalid, but checking stored long-lived token...');
                    try {
                        const me = await new Promise<any>((resolve, reject) => {
                            FB.api('/me', { fields: 'name,email,picture', access_token: facebookAccessTokenRef.current }, (resp: any) => {
                                if (!resp || resp.error) {
                                    reject(new Error(resp?.error?.message || 'Token invalid'));
                                    return;
                                }
                                resolve(resp);
                            });
                        });
                        // Token is valid!
                        console.log('[FB] Stored token is valid. Keeping session.');
                        setFacebookConnected(true);
                        setFacebookProfile(me);
                        return true;
                    } catch (valErr) {
                        console.warn('[FB] Stored token invalidated:', valErr);
                        // Token is dead, clear it
                        setFacebookConnected(false);
                        setFacebookProfile(null);
                        facebookAccessTokenRef.current = null;
                        return false;
                    }
                }

                // No stored token and SDK not connected -> clear
                setFacebookConnected(false);
                setFacebookProfile(null);
                facebookAccessTokenRef.current = null;
                return false;
            }

            const me = await new Promise<any>((resolve, reject) => {
                FB.api('/me', { fields: 'name,email,picture' }, (resp: any) => {
                    if (!resp || resp.error) {
                        reject(new Error(resp?.error?.message || 'Failed to fetch Facebook profile'));
                        return;
                    }
                    resolve(resp);
                });
            });

            setFacebookProfile(me);
            return true;
        } catch (e: any) {
            setFacebookConnected(false);
            setFacebookProfile(null);
            facebookAccessTokenRef.current = null;
            setFacebookError(e?.message || 'Failed to check Facebook status');
            return false;
        } finally {
            setFacebookStatusLoading(false);
        }
    };

    const handleFacebookConnect = async () => {
        setFacebookError(null);

        try {
            const FB = (window as any).FB;
            if (!FB) {
                console.error('[FB] SDK not loaded');
                throw new Error('Facebook SDK is not loaded. Please set VITE_FACEBOOK_APP_ID and refresh.');
            }

            const loginResp = await new Promise<any>((resolve, reject) => {
                const configId = ((import.meta as any).env.VITE_FACEBOOK_CONFIG_ID || '').trim();
                FB.login(
                    (resp: any) => {
                        console.log('[FB] Raw login response:', resp);
                        if (resp?.authResponse?.grantedScopes) {
                            console.log('[FB] Scopes granted by user:', resp.authResponse.grantedScopes);
                        }
                        if (!resp?.authResponse?.accessToken) {
                            reject(new Error('Facebook login was cancelled or did not return an access token.'));
                            return;
                        }
                        resolve(resp);
                    },
                    configId ? { config_id: configId } : {
                        scope: 'public_profile,email,instagram_basic,instagram_content_publish,instagram_manage_insights,pages_manage_posts,pages_show_list,read_insights,pages_read_engagement',
                        return_scopes: true,
                        extras: JSON.stringify({ setup: { channel: 'IG_API_ONBOARDING' } })
                    }
                );
            });

            const connected = await refreshFacebookStatus(loginResp);
            console.log('[FB] Status refresh result:', connected);

            // --- TOKEN EXCHANGE START ---
            // Attempt to exchange short-lived token for long-lived one (60 days)
            if (connected && facebookAccessTokenRef.current) {
                try {
                    const exchangeRes = await authFetch('/api/social?op=fb-exchange-token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ shortLivedToken: facebookAccessTokenRef.current })
                    });



                    if (exchangeRes.ok) {
                        const exchangeData = await exchangeRes.json();
                        if (exchangeData.accessToken) {
                            console.log('[FB] Successfully exchanged for long-lived token');
                            facebookAccessTokenRef.current = exchangeData.accessToken;
                            // Note: We don't update FB SDK state as it manages its own session, 
                            // but we use this ref for all our API calls and persistence.
                        }
                    } else {
                        console.warn('[FB] Token exchange failed (likely missing secret), using short-lived token');
                    }
                } catch (exchangeErr) {
                    console.warn('[FB] Token exchange error:', exchangeErr);
                }
            }
            // --- TOKEN EXCHANGE END ---

            // Load both Instagram accounts and Facebook pages after successful auth
            const [igData, pagesData] = await Promise.all([
                loadInstagramAccounts(),
                loadFacebookPages()
            ]);

            // Save tokens to Firestore for persistence across page refreshes
            // Use fresh data from function returns - state may not be updated yet
            if (connected && facebookAccessTokenRef.current) {
                const currentUser = storageService.getCurrentUser();
                if (currentUser) {
                    try {
                        const freshPages = pagesData || [];
                        const freshIgAccounts = igData || [];
                        await saveFacebookTokens(currentUser, {
                            accessToken: facebookAccessTokenRef.current,
                            profile: facebookProfile,
                            pages: freshPages,
                            selectedPageId: freshPages.length > 0 ? freshPages[0].id : '',
                            igAccounts: freshIgAccounts,
                            selectedIgId: freshIgAccounts.length > 0 && freshIgAccounts[0]?.igId ? String(freshIgAccounts[0].igId) : '',
                        });
                        console.log('[FB] Tokens saved to Firestore with fresh data:', { pages: freshPages.length, igAccounts: freshIgAccounts.length });
                    } catch (e) {
                        console.warn('[FB] Failed to save tokens to Firestore:', e);
                    }
                }
            }
        } catch (e: any) {
            setFacebookError(e?.message || 'Facebook login failed');
        }
    };

    const handleFacebookLogout = async () => {
        setFacebookError(null);

        try {
            const FB = (window as any).FB;
            if (!FB) {
                setFacebookConnected(false);
                setFacebookProfile(null);
                facebookAccessTokenRef.current = null;
                return;
            }

            await new Promise<void>((resolve) => {
                FB.logout(() => resolve());
            });

            setFacebookConnected(false);
            setFacebookProfile(null);
            facebookAccessTokenRef.current = null;
            setIgAccounts([]);
            setSelectedIgId('');
            setIgAccountsError(null);
            setIgPublishError(null);
            setIgPublishResult(null);
        } catch (e: any) {
            setFacebookError(e?.message || 'Failed to log out of Facebook');
        }
    };

    useEffect(() => {
        let cancelled = false;
        let timer: any;

        const check = () => {
            if (cancelled) return;
            const ready = Boolean((window as any).FB);
            setFacebookSdkReady(ready);
            if (!ready) {
                timer = setTimeout(check, 500);
            }
        };

        check();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, []);

    useEffect(() => {
        if (activeTab === 'social') {
            // Load stored tokens for platforms that persist to Firestore
            if (!tiktokConnected && !tiktokLoading) {
                loadStoredTiktokTokens();
            }
            if (!facebookConnected) {
                loadStoredFacebookTokens();
            }
        }
    }, [activeTab]);

    // Load stored tokens on component mount (eager loading for chat assistant)
    useEffect(() => {
        // Load stored social tokens immediately so chat assistant can use them
        if (!tiktokConnected && !tiktokLoading) {
            loadStoredTiktokTokens();
        }
        if (!facebookConnected) {
            loadStoredFacebookTokens();
        }
    }, []); // Empty dependency - run once on mount

    const getMonthStartEnd = (month: Date) => {
        const start = new Date(month);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setMonth(end.getMonth() + 1);
        return { start, end };
    };

    const dateKeyLocal = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const pad2 = (n: number) => String(n).padStart(2, '0');

    const localInputFromMs = (ms: number) => {
        const d = new Date(ms);
        const Y = d.getFullYear();
        const M = pad2(d.getMonth() + 1);
        const D = pad2(d.getDate());
        const h = pad2(d.getHours());
        const m = pad2(d.getMinutes());
        return `${Y}-${M}-${D}T${h}:${m}`;
    };

    const msFromLocalInput = (val: string) => {
        if (!val) return 0;
        return new Date(val).getTime();
    };

    const getDefaultScheduleInputs = (baseDate?: Date) => {
        const start = baseDate ? new Date(baseDate) : new Date();
        if (!baseDate) {
            start.setHours(start.getHours() + 1);
            start.setMinutes(0, 0, 0);
        } else {
            start.setHours(9, 0, 0, 0);
        }
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        return {
            start: localInputFromMs(start.getTime()),
            end: localInputFromMs(end.getTime()),
        };
    };

    const refreshCalendarStatus = async () => {
        setCalendarStatusLoading(true);
        setCalendarError(null);
        try {
            const res = await authFetch('/api/google-calendar-status', { method: 'GET' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'Failed to load Google Calendar status');
            }
            const connected = Boolean(data?.connected);
            setCalendarConnected(connected);
            return connected;
        } catch (e: any) {
            setCalendarConnected(false);
            setCalendarError(e?.message || 'Failed to load Google Calendar status');
            return false;
        } finally {
            setCalendarStatusLoading(false);
        }
    };

    const loadCalendarEvents = async (month: Date) => {
        const { start, end } = getMonthStartEnd(month);
        const qs = new URLSearchParams();
        qs.set('calendarId', 'primary');
        qs.set('timeMin', start.toISOString());
        qs.set('timeMax', end.toISOString());

        const res = await authFetch(`/api/google-calendar-events?${qs.toString()}`, { method: 'GET' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (data?.needsReauth) {
                throw new Error('Google authorization needs to be refreshed');
            }
            throw new Error(data?.error || 'Failed to load Google Calendar events');
        }
        const events = Array.isArray(data?.events) ? data.events : [];
        setCalendarEvents(events);
    };

    const handleRefreshCalendarWidget = async () => {
        setCalendarLoading(true);
        setCalendarError(null);
        try {
            const connected = await refreshCalendarStatus();
            if (connected) {
                await loadCalendarEvents(calendarMonth);
            }

            // Also fetch scheduled posts (regardless of Google Calendar connection)
            try {
                const postsRes = await authFetch('/api/social?op=schedule-list', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: project.id }),
                });
                const postsData = await postsRes.json().catch(() => ({}));
                if (postsRes.ok && Array.isArray(postsData?.posts)) {
                    setScheduledPosts(postsData.posts);
                }
            } catch (e) {
                console.error('Failed to load scheduled posts for calendar:', e);
            }

            // Also fetch scheduled emails
            try {
                const emailsRes = await authFetch('/api/email?op=email-schedule-list&projectId=' + encodeURIComponent(project.id), {
                    method: 'GET',
                });
                const emailsData = await emailsRes.json().catch(() => ({}));
                if (emailsRes.ok && Array.isArray(emailsData?.emails)) {
                    setScheduledEmails(emailsData.emails.filter((e: any) => e.status === 'scheduled'));
                }
            } catch (e) {
                console.error('Failed to load scheduled emails for calendar:', e);
            }
        } catch (e: any) {
            setCalendarError(e?.message || 'Failed to refresh calendar');
        } finally {
            setCalendarLoading(false);
        }
    };

    const handleCreateCalendarEvent = async () => {
        if (!newEventTitle.trim()) {
            setCalendarError('Please enter an event title');
            return;
        }
        const startMs = msFromLocalInput(newEventStartLocal);
        const endMs = msFromLocalInput(newEventEndLocal);

        if (!startMs || !endMs || endMs <= startMs) {
            setCalendarError('Please enter valid start and end times (end must be after start)');
            return;
        }

        setCalendarLoading(true);
        setCalendarError(null);

        try {
            const res = await authFetch('/api/google-calendar-event-upsert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: project.id,
                    summary: newEventTitle,
                    description: newEventDescription,
                    startMs,
                    endMs,
                    addMeet: newEventAddMeet,
                }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'Failed to create calendar event');
            }

            // Clear form and close modal
            setNewEventTitle('');
            setNewEventDescription('');
            setIsCreateEventModalOpen(false);

            // Refresh calendar
            await handleRefreshCalendarWidget();
        } catch (e: any) {
            setCalendarError(e?.message || 'Failed to create event');
        } finally {
            setCalendarLoading(false);
        }
    };

    const [showScheduledPostsModal, setShowScheduledPostsModal] = useState(false);



    const handleConnectGoogleForCalendarWidget = async () => {
        setCalendarError(null);
        try {
            const returnTo = `${window.location.pathname}${window.location.search}`;
            const res = await authFetch(`/api/google?op=google-calendar-auth-url&returnTo=${encodeURIComponent(returnTo)}`, {
                method: 'GET',
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'Failed to start Google auth');
            }
            const url = String(data?.url || '').trim();
            if (!url) throw new Error('Missing auth url');
            const popup = window.open(url, 'googleDriveConnect', 'width=520,height=650');
            if (!popup) {
                window.location.assign(url);
            }
        } catch (e: any) {
            setCalendarError(e?.message || 'Failed to connect Google');
        }
    };
    const [suggestedTopics, setSuggestedTopics] = useState<string[]>(project.suggestedTopics || []);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [currentProject, setCurrentProject] = useState(project);

    // IMPORTANT: Sync currentProject with project prop when project changes
    // This ensures we don't show stale data from a previous project
    useEffect(() => {
        setCurrentProject(project);
        setSuggestedTopics(project.suggestedTopics || []);
    }, [project.id]);

    const [confidenceScore, setConfidenceScore] = useState<AIConfidenceScore | null>(null);
    const [loadingConfidence, setLoadingConfidence] = useState(false);
    const [aiSummary, setAiSummary] = useState<string>('');
    const [loadingSummary, setLoadingSummary] = useState(false);
    const [focusTask, setFocusTask] = useState<ProjectTask | null>(null);
    const [orderedWidgets, setOrderedWidgets] = useState<string[]>(
        project.sidePanelOrder && project.sidePanelOrder.length > 0
            ? project.sidePanelOrder
            : ['research_progress', 'focus_mode', 'spider_chart', 'activity_feed', 'news', 'progress_summary', 'stats']
    );
    const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
    const lastDragOverId = useRef<string | null>(null);
    const scrollInterval = useRef<NodeJS.Timeout | null>(null);

    const stopAutoScroll = () => {
        if (scrollInterval.current) {
            clearInterval(scrollInterval.current);
            scrollInterval.current = null;
        }
    };

    // Sync orderedWidgets when project prop or currentProject changes
    useEffect(() => {
        if (project.sidePanelOrder && project.sidePanelOrder.length > 0) {
            setOrderedWidgets(project.sidePanelOrder);
        }
    }, [project.sidePanelOrder]);

    const handleWidgetDragStart = (e: React.DragEvent, id: string) => {
        // Only allow dragging if not clicking an interactive element inside
        if ((e.target as HTMLElement).closest('button, a, input, [role="button"]')) {
            // e.preventDefault(); // Don't prevent default here as it might break normal clicks, but we want to detect if we should start drag
        }
        setDraggedWidgetId(id);
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
        }
    };

    const handleWidgetDragOver = (e: React.DragEvent, id: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // Throttle reordering: only update if we've moved to a NEW target widget
        if (draggedWidgetId && draggedWidgetId !== id && lastDragOverId.current !== id) {
            lastDragOverId.current = id;
            const oldIndex = orderedWidgets.indexOf(draggedWidgetId);
            const newIndex = orderedWidgets.indexOf(id);
            if (oldIndex !== -1 && newIndex !== -1) {
                const newOrder = [...orderedWidgets];
                newOrder.splice(oldIndex, 1);
                newOrder.splice(newIndex, 0, draggedWidgetId);
                setOrderedWidgets(newOrder);
            }
        }

        // Auto-scroll logic
        const threshold = 150;
        const scrollAmount = 15;
        const { clientY } = e;
        const { innerHeight } = window;

        if (clientY < threshold) {
            // Scroll Up
            if (!scrollInterval.current) {
                scrollInterval.current = setInterval(() => {
                    window.scrollBy({ top: -scrollAmount, behavior: 'auto' });
                }, 16);
            }
        } else if (clientY > innerHeight - threshold) {
            // Scroll Down
            if (!scrollInterval.current) {
                scrollInterval.current = setInterval(() => {
                    window.scrollBy({ top: scrollAmount, behavior: 'auto' });
                }, 16);
            }
        } else {
            stopAutoScroll();
        }
    };

    const handleWidgetDragEnd = () => {
        setDraggedWidgetId(null);
        lastDragOverId.current = null;
        stopAutoScroll();
    };

    const handleWidgetDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        const finalOrder = orderedWidgets;

        // Persist to project state
        const updatedProject = {
            ...currentProject,
            sidePanelOrder: finalOrder
        };
        setCurrentProject(updatedProject);
        if (onProjectUpdate) {
            onProjectUpdate(updatedProject);
        }

        // Save to Firestore
        try {
            await updateResearchProjectInFirestore(
                project.ownerUid || auth.currentUser?.uid || 'unknown',
                project.id,
                { sidePanelOrder: finalOrder }
            );
        } catch (err) {
            console.error('Failed to save widget order:', err);
        }
        stopAutoScroll();
    };

    // Removed inline DraggableWidget component to prevent remounting issues

    const renderOverviewWidget = (widgetId: string) => {
        switch (widgetId) {
            case 'research_progress':
                return (
                    <DraggableWidgetInner
                        id="research_progress"
                        key="research_progress"
                        className={activeOverviewTab === 'research' ? 'block' : 'hidden lg:block'}
                        isDragged={draggedWidgetId === 'research_progress'}
                        onDragStart={(e) => handleWidgetDragStart(e, 'research_progress')}
                        onDragOver={(e) => handleWidgetDragOver(e, 'research_progress')}
                        onDragEnd={handleWidgetDragEnd}
                        onDrop={handleWidgetDrop}
                    >
                        {hasActiveResearchForThisProject && (
                            <div
                                role="button"
                                onClick={() => onStartResearch()}
                                className={`cursor-pointer rounded-2xl sm:rounded-3xl p-5 border transition-colors ${activeTheme === 'dark'
                                    ? 'bg-gradient-to-br from-[#0b1120] via-[#111827] to-[#020617] border-[#2563eb]/40 hover:border-[#3b82f6]'
                                    : activeTheme === 'light'
                                        ? 'bg-gradient-to-br from-blue-50 via-sky-50 to-indigo-50 border-blue-100 hover:border-blue-300'
                                        : `${currentTheme.cardBg} ${currentTheme.border} hover:shadow-md`
                                    }`}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                                        <h3 className={`text-sm font-semibold uppercase tracking-wider ${activeTheme === 'dark' ? 'text-blue-400' : activeTheme === 'light' ? 'text-blue-700' : currentTheme.text
                                            }`}>Research in Progress</h3>
                                    </div>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${activeTheme === 'dark' ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-700'}`}>Live</span>
                                </div>
                                <div className="space-y-3">
                                    {activeResearchLogs.slice(-3).map((log, i) => (
                                        <div key={i} className="flex items-start gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400/50 mt-1.5" />
                                            <p className={`text-xs leading-relaxed ${activeTheme === 'dark' ? 'text-white/70' : activeTheme === 'light' ? 'text-blue-900/70' : currentTheme.textSecondary}`}>
                                                {log}
                                            </p>
                                        </div>
                                    ))}
                                    {activeResearchLogs.length === 0 && (
                                        <p className={`text-xs italic ${activeTheme === 'dark' ? 'text-white/40' : 'text-blue-900/40'}`}>
                                            Initializing deep research agents...
                                        </p>
                                    )}
                                </div>
                                {activeResearchLogs.length > 0 && (
                                    <div className="mt-4 pt-4 border-t border-blue-500/10">
                                        <div className="flex items-center justify-between text-[10px]">
                                            <span className={activeTheme === 'dark' ? 'text-white/40' : 'text-blue-900/40'}>Gathering sources...</span>
                                            <span className={`font-medium ${activeTheme === 'dark' ? 'text-blue-400' : 'text-blue-700'}`}>Active</span>
                                        </div>
                                        <div className={`mt-2 h-1 rounded-full overflow-hidden ${activeTheme === 'dark' ? 'bg-blue-950' : 'bg-blue-100'}`}>
                                            <div className="h-full bg-blue-500 animate-[shimmer_2s_infinite] w-2/3" />
                                        </div>
                                    </div>
                                )}
                                {!hasActiveResearchForThisProject && (
                                    <p className={`text-xs mt-2 ${activeTheme === 'dark' ? 'text-white/40' : 'text-blue-900/40'}`}>
                                        Research will appear here once the background process
                                        finishes.
                                    </p>
                                )}
                            </div>
                        )}
                    </DraggableWidgetInner>
                );
            case 'focus_mode':
                return (
                    <DraggableWidgetInner
                        id="focus_mode"
                        key="focus_mode"
                        className={activeOverviewTab === 'focus' ? 'block' : 'hidden lg:block'}
                        isDragged={draggedWidgetId === 'focus_mode'}
                        onDragStart={(e) => handleWidgetDragStart(e, 'focus_mode')}
                        onDragOver={(e) => handleWidgetDragOver(e, 'focus_mode')}
                        onDragEnd={handleWidgetDragEnd}
                        onDrop={handleWidgetDrop}
                    >
                        <div
                            className={`rounded-2xl sm:rounded-3xl p-5 border ${activeTheme === 'dark'
                                ? 'bg-gradient-to-br from-[#0071e3]/20 to-[#5ac8fa]/20 border-[#0071e3]/30'
                                : activeTheme === 'light'
                                    ? 'bg-gradient-to-br from-blue-50 via-sky-50 to-cyan-50 border-blue-100'
                                    : `${currentTheme.cardBg} ${currentTheme.border}`
                                }`}
                        >
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 bg-[#0071e3] rounded-full animate-pulse" />
                                    <h3
                                        className={`text-sm font-semibold uppercase tracking-wider ${activeTheme === 'dark' ? 'text-[#5ac8fa]' : activeTheme === 'light' ? 'text-blue-600' : currentTheme.text
                                            }`}
                                    >
                                        Focus Mode
                                    </h3>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (calendarLoading || calendarStatusLoading) return;
                                            handleRefreshCalendarWidget().catch(() => undefined);
                                        }}
                                        className={`p-2 rounded-full transition-colors ${activeTheme === 'dark'
                                            ? 'hover:bg-white/10 text-white/70'
                                            : activeTheme === 'light'
                                                ? 'hover:bg-white/70 text-gray-600'
                                                : `${currentTheme.hoverBg} ${currentTheme.textSecondary} hover:${currentTheme.text}`
                                            }`}
                                        title="Sync calendar"
                                        aria-label="Sync calendar"
                                        disabled={calendarLoading || calendarStatusLoading}
                                    >
                                        <svg
                                            className={`w-4 h-4 ${calendarLoading || calendarStatusLoading ? 'animate-spin' : ''}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M4 4v6h6M20 20v-6h-6M20 10a8 8 0 00-14.906-3.09M4 14a8 8 0 0014.906 3.09"
                                            />
                                        </svg>
                                    </button>

                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setShowAddMenu(!showAddMenu);
                                            }}
                                            className={`p-2 rounded-full transition-colors ${activeTheme === 'dark' ? 'hover:bg-white/10 text-white/70' : activeTheme === 'light' ? 'hover:bg-white/70 text-gray-600' : `${currentTheme.hoverBg} ${currentTheme.textSecondary} hover:${currentTheme.text}`
                                                }`}
                                            title="Add..."
                                            aria-label="Add..."
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                            </svg>
                                        </button>

                                        {showAddMenu && (
                                            <>
                                                <div
                                                    className="fixed inset-0 z-10"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setShowAddMenu(false);
                                                    }}
                                                />
                                                <div className={`absolute right-0 mt-2 w-48 rounded-xl shadow-lg border z-20 overflow-hidden ${activeTheme === 'dark'
                                                    ? 'bg-[#1c1c1e] border-white/10'
                                                    : 'bg-white border-gray-200'
                                                    }`}>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setShowAddMenu(false);
                                                            const { start, end } = getDefaultScheduleInputs(calendarSelectedDay || new Date());
                                                            setNewEventTitle('');
                                                            setNewEventDescription('');
                                                            setNewEventStartLocal(start);
                                                            setNewEventEndLocal(end);
                                                            setNewEventAddMeet(true);
                                                            setIsCreateEventModalOpen(true);
                                                        }}
                                                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${activeTheme === 'dark'
                                                            ? 'text-white hover:bg-white/5'
                                                            : 'text-gray-700 hover:bg-gray-50'
                                                            }`}
                                                    >
                                                        <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                        </svg>
                                                        Add Event
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setShowAddMenu(false);
                                                            setIsQuickAddTaskModalOpen(true);
                                                        }}
                                                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${activeTheme === 'dark'
                                                            ? 'text-white hover:bg-white/5'
                                                            : 'text-gray-700 hover:bg-gray-50'
                                                            }`}
                                                    >
                                                        <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                                        </svg>
                                                        Add Task
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {inProgressCount > 0 && (
                                <div className="space-y-2">
                                    {tasks
                                        .filter(t => t.status === 'in_progress')
                                        .slice(0, 2)
                                        .map(task => (
                                            <div
                                                key={task.id}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActiveTab('tasks');
                                                }}
                                                className={`p-3 rounded-xl border cursor-pointer hover:opacity-80 transition-opacity ${activeTheme === 'dark'
                                                    ? 'bg-[#0071e3]/10 border-[#0071e3]/20'
                                                    : activeTheme === 'light'
                                                        ? 'bg-white/70 border-blue-100'
                                                        : `${currentTheme.bgSecondary} ${currentTheme.border}`
                                                    }`}
                                            >
                                                <p className={`text-sm font-medium ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text
                                                    }`}>{task.title}</p>
                                                {task.description && (
                                                    <p
                                                        className={`text-xs mt-1 line-clamp-1 ${activeTheme === 'dark' ? 'text-[#5ac8fa]/70' : activeTheme === 'light' ? 'text-blue-600/70' : currentTheme.textSecondary
                                                            }`}
                                                    >
                                                        {task.description}
                                                    </p>
                                                )}
                                            </div>
                                        ))}
                                </div>
                            )}

                            <div className={`mt-4 pt-4 border-t ${activeTheme === 'dark' ? 'border-white/10' : activeTheme === 'light' ? 'border-blue-100' : currentTheme.border
                                }`}>
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <div className={`text-xs font-semibold uppercase tracking-wider ${activeTheme === 'dark' ? 'text-white/70' : activeTheme === 'light' ? 'text-gray-700' : currentTheme.textSecondary
                                        }`}>
                                        Calendar
                                    </div>

                                    <div className="hidden sm:flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const prev = new Date(calendarMonth);
                                                prev.setMonth(prev.getMonth() - 1);
                                                prev.setDate(1);
                                                prev.setHours(0, 0, 0, 0);
                                                setCalendarMonth(prev);
                                            }}
                                            className={`p-1.5 rounded ${activeTheme === 'dark' ? 'hover:bg-white/10 text-white/70' : activeTheme === 'light' ? 'hover:bg-white/70 text-gray-700' : `${currentTheme.hoverBg} ${currentTheme.textSecondary}`
                                                }`}
                                            aria-label="Previous month"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const next = new Date(calendarMonth);
                                                next.setMonth(next.getMonth() + 1);
                                                next.setDate(1);
                                                next.setHours(0, 0, 0, 0);
                                                setCalendarMonth(next);
                                            }}
                                            className={`p-1.5 rounded ${activeTheme === 'dark' ? 'hover:bg-white/10 text-white/70' : activeTheme === 'light' ? 'hover:bg-white/70 text-gray-700' : `${currentTheme.hoverBg} ${currentTheme.textSecondary}`
                                                }`}
                                            aria-label="Next month"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </button>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setCalendarMobileExpanded(v => !v);
                                        }}
                                        className={`sm:hidden px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors ${activeTheme === 'dark' ? 'bg-white/10 text-white/80' : activeTheme === 'light' ? 'bg-white/70 text-gray-800' : `${currentTheme.bgSecondary} ${currentTheme.text}`
                                            }`}
                                        aria-label={calendarMobileExpanded ? 'Collapse calendar' : 'Expand calendar'}
                                    >
                                        {calendarMobileExpanded ? 'Collapse' : 'Expand'}
                                    </button>
                                </div>

                                <div className={`sm:hidden text-[11px] mb-2 ${activeTheme === 'dark' ? 'text-white/70' : activeTheme === 'light' ? 'text-gray-700' : currentTheme.textSecondary
                                    }`}>
                                    {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                                </div>

                                <div className={`hidden sm:block text-xs mb-2 ${activeTheme === 'dark' ? 'text-white/80' : activeTheme === 'light' ? 'text-gray-800' : currentTheme.text
                                    }`}>
                                    {calendarMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
                                </div>

                                {calendarMobileExpanded && (
                                    <div className={`sm:hidden text-xs mb-2 ${isDarkMode ? 'text-white/80' : 'text-gray-800'}`}>
                                        {calendarMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
                                    </div>
                                )}

                                {calendarMobileExpanded && (
                                    <div className="sm:hidden flex items-center justify-end gap-1 mb-2">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const prev = new Date(calendarMonth);
                                                prev.setMonth(prev.getMonth() - 1);
                                                prev.setDate(1);
                                                prev.setHours(0, 0, 0, 0);
                                                setCalendarMonth(prev);
                                            }}
                                            className={`p-1.5 rounded ${activeTheme === 'dark' ? 'hover:bg-white/10 text-white/70' : activeTheme === 'light' ? 'hover:bg-white/70 text-gray-700' : `${currentTheme.hoverBg} ${currentTheme.textSecondary}`
                                                }`}
                                            aria-label="Previous month"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const next = new Date(calendarMonth);
                                                next.setMonth(next.getMonth() + 1);
                                                next.setDate(1);
                                                next.setHours(0, 0, 0, 0);
                                                setCalendarMonth(next);
                                            }}
                                            className={`p-1.5 rounded ${activeTheme === 'dark' ? 'hover:bg-white/10 text-white/70' : activeTheme === 'light' ? 'hover:bg-white/70 text-gray-700' : `${currentTheme.hoverBg} ${currentTheme.textSecondary}`
                                                }`}
                                            aria-label="Next month"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </button>
                                    </div>
                                )}

                                {calendarError && (
                                    <div className={`mb-2 p-2 rounded-lg flex items-center justify-between gap-2 ${isDarkMode ? 'bg-red-900/20 border border-red-500/30 text-red-200' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                                        <span className="text-[11px] font-medium leading-tight">{calendarError}</span>
                                        {calendarError.toLowerCase().includes('authorization') || calendarError.toLowerCase().includes('refresh') || calendarError.toLowerCase().includes('grant') ? (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleConnectGoogleForCalendarWidget();
                                                }}
                                                className={`flex-shrink-0 px-2 py-1 rounded-md text-[10px] font-bold transition-all ${isDarkMode ? 'bg-red-500/20 text-red-100 hover:bg-red-500/30' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                                            >
                                                Reconnect
                                            </button>
                                        ) : null}
                                    </div>
                                )}

                                <div>
                                    {(() => {
                                        const monthStart = new Date(calendarMonth);
                                        monthStart.setDate(1);
                                        monthStart.setHours(0, 0, 0, 0);

                                        const byDay = new Map<string, any[]>();
                                        for (const ev of calendarEvents) {
                                            const start = ev?.start;
                                            const dateStr = typeof start?.date === 'string' ? start.date : '';
                                            const dateTimeStr = typeof start?.dateTime === 'string' ? start.dateTime : '';
                                            const key = dateStr || (dateTimeStr ? dateKeyLocal(new Date(dateTimeStr)) : '');
                                            if (!key) continue;
                                            const existing = byDay.get(key) || [];
                                            existing.push(ev);
                                            byDay.set(key, existing);
                                        }

                                        for (const post of scheduledPosts) {
                                            const postDate = new Date(post.scheduledAt * 1000);
                                            const key = dateKeyLocal(postDate);
                                            const existing = byDay.get(key) || [];
                                            existing.push({
                                                id: `scheduled-${post.id}`,
                                                summary: `📱 ${post.platforms?.join?.(', ') || 'Social'} post`,
                                                start: { dateTime: postDate.toISOString() },
                                                isScheduledPost: true,
                                                platforms: post.platforms,
                                                textContent: post.textContent,
                                                status: post.status,
                                            });
                                            byDay.set(key, existing);
                                        }

                                        for (const email of scheduledEmails) {
                                            const emailDate = new Date(email.scheduledAt * 1000);
                                            const key = dateKeyLocal(emailDate);
                                            const existing = byDay.get(key) || [];
                                            const recipientCount = Array.isArray(email.to) ? email.to.length : 1;
                                            existing.push({
                                                id: `scheduled-email-${email.id}`,
                                                summary: `✉️ ${email.subject}`,
                                                start: { dateTime: emailDate.toISOString() },
                                                isScheduledEmail: true,
                                                to: email.to,
                                                subject: email.subject,
                                                status: email.status,
                                                provider: email.provider,
                                                recipientCount,
                                            });
                                            byDay.set(key, existing);
                                        }

                                        const firstDow = monthStart.getDay();
                                        const gridStart = new Date(monthStart);
                                        gridStart.setDate(monthStart.getDate() - firstDow);
                                        gridStart.setHours(0, 0, 0, 0);

                                        const selectedKey = dateKeyLocal(calendarSelectedDay);
                                        const cells = new Array(42).fill(null).map((_, idx) => {
                                            const d = new Date(gridStart);
                                            d.setDate(gridStart.getDate() + idx);
                                            d.setHours(0, 0, 0, 0);
                                            const key = dateKeyLocal(d);
                                            const isCurrentMonth = d.getMonth() === monthStart.getMonth();
                                            const isSelected = key === selectedKey;
                                            const count = (byDay.get(key) || []).length;
                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setCalendarSelectedDay(d);
                                                    }}
                                                    className={`h-10 rounded-xl border flex flex-col items-center justify-center transition-colors ${isSelected
                                                        ? activeTheme === 'dark'
                                                            ? 'bg-white/15 border-white/20'
                                                            : activeTheme === 'light'
                                                                ? 'bg-white border-blue-200'
                                                                : `${currentTheme.bgSecondary} border shadow-inner ${currentTheme.border} ring-1 ring-${currentTheme.text}/20`
                                                        : activeTheme === 'dark'
                                                            ? 'bg-white/5 hover:bg-white/10 border-white/10'
                                                            : activeTheme === 'light'
                                                                ? 'bg-white/60 hover:bg-white border-blue-100'
                                                                : `bg-white/40 hover:${currentTheme.hoverBg} ${currentTheme.border}`
                                                        } ${!isCurrentMonth ? (activeTheme === 'dark' ? 'opacity-40' : 'opacity-50') : ''}`}
                                                >
                                                    <div className={`text-xs ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text
                                                        }`}>{d.getDate()}</div>
                                                    {count > 0 && <div className={`text-[10px] ${activeTheme === 'dark' ? 'text-white/70' : activeTheme === 'light' ? 'text-blue-700' : currentTheme.textSecondary
                                                        }`}>{count}</div>}
                                                </button>
                                            );
                                        });

                                        const selectedEvents = (byDay.get(selectedKey) || []).slice();
                                        selectedEvents.sort((a, b) => {
                                            const aStart = a?.start?.dateTime || a?.start?.date;
                                            const bStart = b?.start?.dateTime || b?.start?.date;
                                            const aDate = typeof aStart === 'string' ? new Date(aStart.includes('T') ? aStart : `${aStart}T00:00:00`) : new Date(0);
                                            const bDate = typeof bStart === 'string' ? new Date(bStart.includes('T') ? bStart : `${bStart}T00:00:00`) : new Date(0);
                                            return aDate.getTime() - bDate.getTime();
                                        });

                                        const allEvents = calendarEvents.slice();
                                        allEvents.sort((a, b) => {
                                            const aStart = a?.start?.dateTime || a?.start?.date;
                                            const bStart = b?.start?.dateTime || b?.start?.date;
                                            const aDate = typeof aStart === 'string' ? new Date(aStart.includes('T') ? aStart : `${aStart}T00:00:00`) : new Date(0);
                                            const bDate = typeof bStart === 'string' ? new Date(bStart.includes('T') ? bStart : `${bStart}T00:00:00`) : new Date(0);
                                            return aDate.getTime() - bDate.getTime();
                                        });

                                        return (
                                            <div>
                                                <div className={(calendarMobileExpanded ? 'block' : 'hidden') + ' sm:block'}>
                                                    <div className={`grid grid-cols-7 gap-1 text-[10px] mb-1 ${activeTheme === 'dark' ? 'text-white/50' : activeTheme === 'light' ? 'text-gray-500' : currentTheme.textSecondary
                                                        }`}>
                                                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => (
                                                            <div key={d} className="text-center">{d}</div>
                                                        ))}
                                                    </div>

                                                    <div className="grid grid-cols-7 gap-1">{cells}</div>

                                                    {selectedEvents.length > 0 && (
                                                        <div className={`mt-3 rounded-xl border p-3 ${activeTheme === 'dark' ? 'border-white/10 bg-black/10' : activeTheme === 'light' ? 'border-blue-100 bg-white/60' : `${currentTheme.border} bg-white/50`
                                                            }`}>
                                                            <div className={`text-[11px] font-medium mb-1 ${activeTheme === 'dark' ? 'text-white/80' : activeTheme === 'light' ? 'text-gray-800' : currentTheme.text
                                                                }`}>
                                                                {calendarSelectedDay.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                {selectedEvents.map((ev) => {
                                                                    const title = String(ev?.summary || 'Untitled');
                                                                    const startRaw = ev?.start?.dateTime || ev?.start?.date;
                                                                    const startDate = typeof startRaw === 'string' ? new Date(startRaw.includes('T') ? startRaw : `${startRaw}T00:00:00`) : null;
                                                                    const timeLabel = startDate ? (startRaw?.includes?.('T') ? startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'All day') : '';

                                                                    return (
                                                                        <div
                                                                            key={String(ev?.id || title)}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                ev.htmlLink && window.open(ev.htmlLink, '_blank');
                                                                            }}
                                                                            className={`flex items-center justify-between gap-2 p-1.5 -mx-1.5 rounded-lg transition-colors ${ev.htmlLink ? 'cursor-pointer hover:bg-white/5' : ''}`}
                                                                        >
                                                                            <div className={`text-[11px] truncate ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text
                                                                                }`}>{title}</div>
                                                                            <div className={`text-[10px] flex-shrink-0 ${activeTheme === 'dark' ? 'text-white/60' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.textSecondary
                                                                                }`}>{timeLabel}</div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {allEvents.length > 0 && (
                                                    <div className={`mt-3 rounded-xl border p-3 ${activeTheme === 'dark' ? 'border-white/10 bg-black/10' : activeTheme === 'light' ? 'border-blue-100 bg-white/60' : `${currentTheme.border} bg-white/50`
                                                        }`}>
                                                        <div className={`text-[11px] font-medium mb-2 ${activeTheme === 'dark' ? 'text-white/80' : activeTheme === 'light' ? 'text-gray-800' : currentTheme.text
                                                            }`}>
                                                            All events ({allEvents.length})
                                                        </div>
                                                        <div className={`space-y-1.5 overflow-y-auto overflow-x-hidden ${calendarMobileExpanded ? 'max-h-40' : 'max-h-48'} sm:max-h-40`}>
                                                            {allEvents.map((ev) => {
                                                                const title = String(ev?.summary || 'Untitled');
                                                                const startRaw = ev?.start?.dateTime || ev?.start?.date;
                                                                const startDate = typeof startRaw === 'string' ? new Date(startRaw.includes('T') ? startRaw : `${startRaw}T00:00:00`) : null;
                                                                const timeLabel = startDate ? startDate.toLocaleString(undefined, { month: 'short', day: 'numeric', ...(startRaw?.includes?.('T') ? { hour: 'numeric', minute: '2-digit' } : {}) }) : '';

                                                                return (
                                                                    <div
                                                                        key={String(ev?.id || title)}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            ev.htmlLink && window.open(ev.htmlLink, '_blank');
                                                                        }}
                                                                        className={`flex items-center justify-between gap-2 p-1.5 -mx-1.5 rounded-lg transition-colors ${ev.htmlLink ? 'cursor-pointer hover:bg-white/5' : ''}`}
                                                                    >
                                                                        <div className={`text-[11px] truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{title}</div>
                                                                        <div className={`text-[10px] flex-shrink-0 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>{timeLabel}</div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>

                                {!calendarConnected && (
                                    <div className={`mt-3 flex items-center justify-between gap-3 p-2 rounded-lg ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
                                        <div className={`text-[11px] ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
                                            Connect Google for calendar events
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleConnectGoogleForCalendarWidget();
                                            }}
                                            className={`px-2.5 py-1 rounded-full text-[10px] font-medium text-white ${activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3] hover:bg-[#0077ed]' : `${currentTheme.primary} ${currentTheme.primaryHover}`}`}
                                        >
                                            Connect
                                        </button>
                                    </div>
                                )}

                                {(calendarLoading || calendarStatusLoading) && (
                                    <div className={`mt-2 text-[11px] ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>Syncing…</div>
                                )}
                            </div>
                        </div>
                    </DraggableWidgetInner>
                );
            case 'spider_chart':
                return (
                    <DraggableWidgetInner
                        id="spider_chart"
                        key="spider_chart"
                        className={activeOverviewTab === 'focus' ? 'block' : 'hidden lg:block'}
                        isDragged={draggedWidgetId === 'spider_chart'}
                        onDragStart={(e) => handleWidgetDragStart(e, 'spider_chart')}
                        onDragOver={(e) => handleWidgetDragOver(e, 'spider_chart')}
                        onDragEnd={handleWidgetDragEnd}
                        onDrop={handleWidgetDrop}
                    >
                        <div className="mb-5">
                            <SpiderChart
                                data={spiderData}
                                loading={spiderLoading}
                                error={spiderError}
                                onAnalyze={handleAnalyzeComponents}
                                backData={topicData}
                                backLoading={topicLoading}
                                backError={topicError}
                                onAnalyzeBack={handleAnalyzeTopics}
                                isDarkMode={isDarkMode}
                                activeTheme={activeTheme || 'dark'}
                                currentTheme={currentTheme}
                            />
                        </div>
                    </DraggableWidgetInner>
                );
            case 'activity_feed':
                return (
                    <DraggableWidgetInner
                        id="activity_feed"
                        key="activity_feed"
                        className={activeOverviewTab === 'focus' ? 'block' : 'hidden lg:block'}
                        isDragged={draggedWidgetId === 'activity_feed'}
                        onDragStart={(e) => handleWidgetDragStart(e, 'activity_feed')}
                        onDragOver={(e) => handleWidgetDragOver(e, 'activity_feed')}
                        onDragEnd={handleWidgetDragEnd}
                        onDrop={handleWidgetDrop}
                    >
                        <ActivityFeed
                            activities={projectActivities}
                            loading={activitiesLoading}
                            isDarkMode={isDarkMode}
                            activeTheme={activeTheme}
                            currentTheme={currentTheme}
                        />
                    </DraggableWidgetInner>
                );
            case 'news':
                return (
                    <DraggableWidgetInner
                        id="news"
                        key="news"
                        className={activeOverviewTab === 'news' ? 'block space-y-4 lg:space-y-5' : 'hidden lg:block space-y-4 lg:space-y-5'}
                        isDragged={draggedWidgetId === 'news'}
                        onDragStart={(e) => handleWidgetDragStart(e, 'news')}
                        onDragOver={(e) => handleWidgetDragOver(e, 'news')}
                        onDragEnd={handleWidgetDragEnd}
                        onDrop={handleWidgetDrop}
                    >
                        <div className={`rounded-2xl sm:rounded-3xl p-5 ${activeTheme === 'dark'
                            ? 'bg-[#1d1d1f] border border-[#3d3d3f]/50'
                            : activeTheme === 'light'
                                ? 'bg-white border border-gray-200'
                                : `${currentTheme.cardBg} border ${currentTheme.border}`
                            }`}>
                            <div className="flex items-center justify-between gap-3 mb-4">
                                <div className="flex items-center gap-2">
                                    <h3 className={`text-sm font-semibold uppercase tracking-wider ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.text
                                        }`}>News</h3>
                                    <div className={`flex items-center gap-1 p-0.5 rounded-full ${activeTheme === 'dark'
                                        ? 'bg-black/30'
                                        : activeTheme === 'light'
                                            ? 'bg-gray-100'
                                            : `${currentTheme.bgSecondary} border ${currentTheme.border}`
                                        }`}>
                                        <button
                                            type="button"
                                            onClick={() => setNewsMode('news')}
                                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${newsMode === 'news'
                                                ? (activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3] text-white' : `${currentTheme.primary} text-white`)
                                                : activeTheme === 'dark'
                                                    ? 'text-[#86868b] hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'text-gray-700 hover:text-gray-900'
                                                        : `${currentTheme.textSecondary} hover:${currentTheme.text}`
                                                }`}
                                        >
                                            News
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setNewsMode('videos')}
                                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${newsMode === 'videos'
                                                ? (activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3] text-white' : `${currentTheme.primary} text-white`)
                                                : activeTheme === 'dark'
                                                    ? 'text-[#86868b] hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'text-gray-700 hover:text-gray-900'
                                                        : `${currentTheme.textSecondary} hover:${currentTheme.text}`
                                                }`}
                                        >
                                            Videos
                                        </button>
                                    </div>
                                </div>
                                {newsMode === 'news' ? (
                                    <button
                                        type="button"
                                        onClick={refreshNews}
                                        disabled={refreshingNews}
                                        className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${refreshingNews
                                            ? activeTheme === 'dark'
                                                ? 'bg-white/10 text-[#86868b] cursor-wait'
                                                : activeTheme === 'light'
                                                    ? 'bg-gray-100 text-gray-500 cursor-wait'
                                                    : `${currentTheme.bgSecondary} ${currentTheme.textSecondary} cursor-wait`
                                            : activeTheme === 'dark'
                                                ? 'bg-[#0071e3]/10 text-[#0071e3] hover:bg-[#0071e3]/20'
                                                : activeTheme === 'light'
                                                    ? 'bg-[#0071e3]/10 text-[#0071e3] hover:bg-[#0071e3]/20'
                                                    : `${currentTheme.bgSecondary} ${currentTheme.accent} hover:brightness-95`
                                            }`}
                                    >
                                        {refreshingNews ? 'Refreshing…' : 'Refresh'}
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (youtubeVideos.length > 0) {
                                                    const id = activeYoutubeVideoId || youtubeVideos[0]?.id;
                                                    if (id) setActiveYoutubeVideoId(id);
                                                }
                                                setVideoPlayerMode('modal');
                                            }}
                                            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${activeTheme === 'dark'
                                                ? 'bg-white/10 text-white/80 hover:bg-white/15'
                                                : activeTheme === 'light'
                                                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                    : `${currentTheme.bgSecondary} ${currentTheme.text} hover:${currentTheme.hoverBg}`
                                                }`}
                                        >
                                            Open
                                        </button>
                                        <button
                                            type="button"
                                            onClick={refreshVideos}
                                            disabled={refreshingVideos}
                                            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${refreshingVideos
                                                ? activeTheme === 'dark'
                                                    ? 'bg-white/10 text-[#86868b] cursor-wait'
                                                    : activeTheme === 'light'
                                                        ? 'bg-gray-100 text-gray-500 cursor-wait'
                                                        : `${currentTheme.bgSecondary} ${currentTheme.textSecondary} cursor-wait`
                                                : activeTheme === 'dark'
                                                    ? 'bg-[#0071e3]/10 text-[#0071e3] hover:bg-[#0071e3]/20'
                                                    : activeTheme === 'light'
                                                        ? 'bg-[#0071e3]/10 text-[#0071e3] hover:bg-[#0071e3]/20'
                                                        : `${currentTheme.bgSecondary} ${currentTheme.accent} hover:brightness-95`
                                                }`}
                                        >
                                            {refreshingVideos ? 'Refreshing…' : 'Refresh'}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {newsMode === 'news' ? (
                                newsArticles.length === 0 ? (
                                    <p className={`text-sm ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.textSecondary
                                        }`}>
                                        No news loaded yet. Click Refresh to fetch recent coverage.
                                    </p>
                                ) : (
                                    <div className="space-y-3">
                                        {newsArticles.slice(0, 6).map((a, idx) => (
                                            <a
                                                key={`${a.url}-${idx}`}
                                                href={a.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className={`block p-3 rounded-xl border transition-colors ${activeTheme === 'dark'
                                                    ? 'bg-black/20 border-[#3d3d3f]/60 hover:border-[#0071e3]/50'
                                                    : activeTheme === 'light'
                                                        ? 'bg-gray-50 border-gray-200 hover:border-blue-200'
                                                        : `bg-white/50 ${currentTheme.border} hover:shadow-sm`
                                                    }`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className={`text-sm font-medium leading-snug line-clamp-2 ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text
                                                            }`}>{a.title}</p>
                                                        {a.description && (
                                                            <p className={`mt-1 text-xs line-clamp-2 ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.textSecondary
                                                                }`}>{a.description}</p>
                                                        )}
                                                        <div className={`mt-2 text-[11px] flex items-center gap-2 ${activeTheme === 'dark' ? 'text-[#636366]' : activeTheme === 'light' ? 'text-gray-500' : currentTheme.textSecondary
                                                            }`}>
                                                            <span className="truncate">{a.source?.name || 'NewsAPI'}</span>
                                                            {a.publishedAt && <span className="whitespace-nowrap">• {new Date(a.publishedAt).toLocaleDateString()}</span>}
                                                        </div>
                                                    </div>
                                                    <span className={`text-xs ${activeTheme === 'dark' ? 'text-[#5ac8fa]' : activeTheme === 'light' ? 'text-blue-600' : currentTheme.accent
                                                        }`}>↗</span>
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                )
                            ) : (
                                <div className="space-y-3">
                                    {youtubeVideos.length === 0 ? (
                                        <p className={`text-sm ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.textSecondary
                                            }`}>
                                            No videos found yet. Click Refresh.
                                        </p>
                                    ) : (
                                        <div className="max-h-[420px] overflow-auto pr-1">
                                            <div className="space-y-3">
                                                {youtubeVideos.map((v) => (
                                                    <button
                                                        key={v.id}
                                                        type="button"
                                                        onClick={() => openVideoPlayer(v.id)}
                                                        className={`block w-full text-left p-3 rounded-xl border transition-colors ${activeTheme === 'dark'
                                                            ? 'bg-black/20 border-[#3d3d3f]/60 hover:border-[#0071e3]/50'
                                                            : activeTheme === 'light'
                                                                ? 'bg-gray-50 border-gray-200 hover:border-blue-200'
                                                                : `bg-white/50 ${currentTheme.border} hover:${currentTheme.ring}/50`
                                                            }`}
                                                    >
                                                        <div className="flex items-start gap-3">
                                                            <img src={v.thumbnail} alt={v.title} className="w-16 h-10 object-cover rounded-md flex-shrink-0" />
                                                            <div className="min-w-0">
                                                                <div className={`text-sm font-medium line-clamp-2 ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text
                                                                    }`}>{v.title}</div>
                                                                <div className={`mt-1 text-[11px] flex items-center gap-2 ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.textSecondary
                                                                    }`}>
                                                                    <span className="truncate">{v.channel}</span>
                                                                    <span className="whitespace-nowrap">• {v.duration}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </DraggableWidgetInner>
                );
            case 'progress_summary':
                return tasks.length > 0 ? (
                    <DraggableWidgetInner
                        id="progress_summary"
                        key="progress_summary"
                        className="hidden lg:block"
                        isDragged={draggedWidgetId === 'progress_summary'}
                        onDragStart={(e) => handleWidgetDragStart(e, 'progress_summary')}
                        onDragOver={(e) => handleWidgetDragOver(e, 'progress_summary')}
                        onDragEnd={handleWidgetDragEnd}
                        onDrop={handleWidgetDrop}
                    >
                        <div className={`${activeTheme === 'dark'
                            ? 'bg-[#1d1d1f] border border-[#3d3d3f]/50'
                            : activeTheme === 'light'
                                ? 'bg-white border border-gray-200'
                                : `${currentTheme.cardBg} border ${currentTheme.border}`
                            } rounded-2xl sm:rounded-3xl p-5`}>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className={`text-sm font-semibold uppercase tracking-wider ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.text
                                    }`}>Progress</h3>
                                <button
                                    onClick={() => setIsQuickAddTaskModalOpen(true)}
                                    className={`p-1.5 rounded-lg transition-colors ${activeTheme === 'dark'
                                        ? 'hover:bg-white/10 text-[#86868b] hover:text-white'
                                        : activeTheme === 'light'
                                            ? 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'
                                            : `${currentTheme.textSecondary} hover:${currentTheme.text} hover:${currentTheme.bgSecondary}`
                                        }`}
                                    title="Quick Add Task"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                </button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <div className="flex justify-between text-xs mb-2">
                                        <span className={activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.textSecondary}>Completion</span>
                                        <span className={`font-medium ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text}`}>{Math.round((doneCount / tasks.length) * 100)}%</span>
                                    </div>
                                    <div className={`h-2 rounded-full overflow-hidden ${activeTheme === 'dark' ? 'bg-[#2d2d2f]' : activeTheme === 'light' ? 'bg-gray-200' : 'bg-black/5'
                                        }`}>
                                        <div
                                            className={`h-full rounded-full transition-all ${activeTheme === 'dark' || activeTheme === 'light' ? 'bg-gradient-to-r from-[#0071e3] to-[#30d158]' : `bg-gradient-to-r ${currentTheme.primary} to-[#30d158]`}`}
                                            style={{ width: `${(doneCount / tasks.length) * 100}%` }}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center">
                                    <div className={`p-3 rounded-xl ${activeTheme === 'dark' ? 'bg-[#2d2d2f]' : activeTheme === 'light' ? 'bg-gray-100' : 'bg-white/50'
                                        }`}>
                                        <span className={`text-lg font-semibold ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.text
                                            }`}>{todoCount}</span>
                                        <p className={`text-[10px] uppercase mt-0.5 ${activeTheme === 'dark' ? 'text-[#636366]' : activeTheme === 'light' ? 'text-gray-500' : currentTheme.textSecondary
                                            }`}>To Do</p>
                                    </div>
                                    <div className={`p-3 rounded-xl ${activeTheme === 'dark' ? 'bg-[#0071e3]/10' : activeTheme === 'light' ? 'bg-[#0071e3]/10' : `${currentTheme.primary}/10`}`}>
                                        <span className={`text-lg font-semibold ${activeTheme === 'dark' ? 'text-[#0071e3]' : activeTheme === 'light' ? 'text-[#0071e3]' : currentTheme.accent}`}>{inProgressCount}</span>
                                        <p className={`text-[10px] uppercase mt-0.5 ${activeTheme === 'dark' ? 'text-[#0071e3]' : activeTheme === 'light' ? 'text-[#0071e3]' : currentTheme.accent}`}>Active</p>
                                    </div>
                                    <div className="p-3 bg-[#30d158]/10 rounded-xl">
                                        <span className="text-lg font-semibold text-[#30d158]">{doneCount}</span>
                                        <p className="text-[10px] text-[#30d158] uppercase mt-0.5">Done</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setActiveTab('tasks')}
                                    className="w-full mt-4 text-sm text-[#0071e3] hover:text-[#0077ed] transition-colors font-medium"
                                >
                                    View Task Board
                                </button>
                            </div>
                        </div>
                    </DraggableWidgetInner>
                ) : null;
            case 'stats':
                return (
                    <DraggableWidgetInner
                        id="stats"
                        key="stats"
                        className={activeOverviewTab === 'news' ? 'block' : 'hidden lg:block'}
                        isDragged={draggedWidgetId === 'stats'}
                        onDragStart={(e) => handleWidgetDragStart(e, 'stats')}
                        onDragOver={(e) => handleWidgetDragOver(e, 'stats')}
                        onDragEnd={handleWidgetDragEnd}
                        onDrop={handleWidgetDrop}
                    >
                        <div className={`${activeTheme === 'dark'
                            ? 'bg-[#1d1d1f] border border-[#3d3d3f]/50'
                            : activeTheme === 'light'
                                ? 'bg-white border border-gray-200'
                                : `${currentTheme.cardBg} border ${currentTheme.border}`
                            } rounded-2xl sm:rounded-3xl p-5`}>
                            <h3 className={`text-sm font-semibold uppercase tracking-wider mb-4 ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.text
                                }`}>Stats</h3>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.textSecondary
                                        }`}>Research Sessions</span>
                                    <span className={`text-lg font-semibold ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text
                                        }`}>{researchSessions.length}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={openAllSourcesModal}
                                    disabled={totalSources === 0}
                                    className="flex justify-between items-center w-full disabled:opacity-60 text-left"
                                >
                                    <span className={`text-sm ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.textSecondary
                                        }`}>Total Sources</span>
                                    <span className={`text-lg font-semibold ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text
                                        }`}>{totalSources}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('data')}
                                    className="flex justify-between items-center w-full text-left"
                                >
                                    <span className={`text-sm ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.textSecondary
                                        }`}>Uploaded Files</span>
                                    <span className={`text-lg font-semibold ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text
                                        }`}>{uploadedFileCount}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('notes')}
                                    className="flex justify-between items-center w-full text-left"
                                >
                                    <span className={`text-sm ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.textSecondary
                                        }`}>Notes</span>
                                    <span className={`text-lg font-semibold ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text
                                        }`}>{notes.length}</span>
                                </button>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.textSecondary
                                        }`}>Last Updated</span>
                                    <span className={`text-sm ${activeTheme === 'dark' ? 'text-[#e5e5ea]' : activeTheme === 'light' ? 'text-gray-700' : currentTheme.text
                                        }`}>{new Date(currentProject.lastModified).toLocaleDateString()}</span>
                                </div>
                            </div>
                        </div>
                    </DraggableWidgetInner>
                );
            default:
                return null;
        }
    };

    const [showAssistant, setShowAssistant] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [showSourcesModal, setShowSourcesModal] = useState(false);
    const [sourcesModalTitle, setSourcesModalTitle] = useState('');
    const [sourcesModalMode, setSourcesModalMode] = useState<'urls_only' | 'all_sources'>('urls_only');
    const [sourcesModalUrlItems, setSourcesModalUrlItems] = useState<SourceItem[]>([]);
    const [sourcesModalFileItems, setSourcesModalFileItems] = useState<SourceItem[]>([]);
    const [sourcesModalNoteItems, setSourcesModalNoteItems] = useState<SourceItem[]>([]);
    const [showLeadsModal, setShowLeadsModal] = useState(false);
    const [leadsModalTitle, setLeadsModalTitle] = useState('');
    const [leadsModalItems, setLeadsModalItems] = useState<LeadItem[]>([]);
    const [expandedLeadIds, setExpandedLeadIds] = useState<Set<string>>(new Set());
    const [localProjectPodcasts, setLocalProjectPodcasts] = useState<KnowledgeBaseFile[]>([]);
    const [activePodcast, setActivePodcast] = useState<any | null>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

    // Fetch user profile
    useEffect(() => {
        const loadProfile = async () => {
            try {
                const profile = await storageService.getUserProfile();
                setUserProfile(profile);
            } catch (error) {
                console.error('Failed to load user profile:', error);
            }
        };
        loadProfile();
    }, []);
    const suggestionsTriggerRef = useRef({
        projectId: project.id,
        researchCount: project.researchSessions?.length || 0,
        noteCount: (project.notes || []).length,
        fileCount: (project.uploadedFiles || []).length || 0,
    });
    const [isEditingMeta, setIsEditingMeta] = useState(false);
    const [editName, setEditName] = useState(project.name);
    const [editDescription, setEditDescription] = useState(project.description || '');
    const [savingMeta, setSavingMeta] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [shareEmail, setShareEmail] = useState('');
    const [shareRole, setShareRole] = useState<'editor' | 'viewer'>('editor');
    const [shareStatus, setShareStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [inviteLoading, setInviteLoading] = useState(false);
    const [removingCollaboratorId, setRemovingCollaboratorId] = useState<string | null>(null);

    // SEO analysis state (main tab)
    const [seoKeyword, setSeoKeyword] = useState('');
    const [seoLocation, setSeoLocation] = useState('US');
    const [isRunningSeo, setIsRunningSeo] = useState(false);
    const [seoError, setSeoError] = useState<string | null>(null);
    const [seoData, setSeoData] = useState<SeoKeywordApiResult | null>(null);
    const [seoAdvice, setSeoAdvice] = useState<string | null>(null);
    const [seoBlog, setSeoBlog] = useState<BlogPost | null>(null);
    const [isGeneratingSeoBlog, setIsGeneratingSeoBlog] = useState(false);
    const [seoBlogError, setSeoBlogError] = useState<string | null>(null);
    const [seoBlogSaveMessage, setSeoBlogSaveMessage] = useState<string | null>(null);

    const [seoIgHashtagQuery, setSeoIgHashtagQuery] = useState('');
    const [seoIgHashtagSearchLoading, setSeoIgHashtagSearchLoading] = useState(false);
    const [seoIgHashtagSearchError, setSeoIgHashtagSearchError] = useState<string | null>(null);
    const [seoIgHashtagResult, setSeoIgHashtagResult] = useState<any | null>(null);
    const [seoIgMediaLoading, setSeoIgMediaLoading] = useState(false);
    const [seoIgMediaError, setSeoIgMediaError] = useState<string | null>(null);
    const [seoIgTopMedia, setSeoIgTopMedia] = useState<any[]>([]);
    const [seoIgRecentMedia, setSeoIgRecentMedia] = useState<any[]>([]);

    // Instagram Business Discovery State
    const [seoDiscoveryUsername, setSeoDiscoveryUsername] = useState('');
    const [seoDiscoveryLoading, setSeoDiscoveryLoading] = useState(false);
    const [seoDiscoveryError, setSeoDiscoveryError] = useState<string | null>(null);
    const [seoDiscoveryResult, setSeoDiscoveryResult] = useState<any | null>(null);

    // State to pass table data to Assets tab
    const [seoTableToCreate, setSeoTableToCreate] = useState<import('../types').TableAsset | null>(null);

    const normalizeHashtag = (input: string) => {
        const raw = String(input || '').trim();
        if (!raw) return '';
        const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw;
        return withoutHash
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[^a-z0-9_]/g, '');
    };

    const withinHashtagQuota = (q: string) => {
        try {
            const key = 'igHashtagSearchHistory';
            const now = Date.now();
            const weekMs = 7 * 24 * 60 * 60 * 1000;

            const normalized = normalizeHashtag(q);
            if (!normalized) return false;

            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : [];
            const list = Array.isArray(parsed) ? parsed : [];

            const fresh = list
                .map((x: any) => ({ q: String(x?.q || ''), t: Number(x?.t || 0) }))
                .filter((x: any) => x.q && x.t && now - x.t < weekMs);

            const uniq = new Set(fresh.map((x: any) => normalizeHashtag(x.q)).filter(Boolean));
            if (uniq.has(normalized)) {
                localStorage.setItem(key, JSON.stringify(fresh));
                return true;
            }

            if (uniq.size >= 30) {
                localStorage.setItem(key, JSON.stringify(fresh));
                return false;
            }

            const next = [...fresh, { q: normalized, t: now }];
            localStorage.setItem(key, JSON.stringify(next));
            return true;
        } catch {
            return true;
        }
    };

    const handleSeoIgHashtagSearch = async () => {
        setSeoIgHashtagSearchLoading(true);
        setSeoIgHashtagSearchError(null);
        setSeoIgHashtagResult(null);
        setSeoIgTopMedia([]);
        setSeoIgRecentMedia([]);
        setSeoIgMediaError(null);

        try {
            const fbUserAccessToken = facebookAccessTokenRef.current;
            if (!fbUserAccessToken) throw new Error('Connect Facebook in the Social tab first.');
            const igUserId = selectedIgId.trim();
            if (!igUserId) throw new Error('Load/select an Instagram account in the Social tab first.');

            const q = normalizeHashtag(seoIgHashtagQuery);
            if (!q) throw new Error('Enter a hashtag to search.');
            if (!withinHashtagQuota(q)) {
                throw new Error('Hashtag lookup limit reached (30 unique hashtags per 7 days). Try an existing hashtag or wait.');
            }

            // 1. Search for Hashtag ID
            const res = await authFetch('/api/social?op=ig-hashtag-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fbUserAccessToken, igUserId, q }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Hashtag search failed');
            const result = data?.result;
            if (!result?.id) throw new Error('No hashtag found (or hashtag is restricted).');

            setSeoIgHashtagResult(result);

            // 2. Automatically fetch both Top and Recent media in parallel
            setSeoIgMediaLoading(true);
            const hashtagId = result.id;

            try {
                const [topRes, recentRes] = await Promise.all([
                    authFetch('/api/social?op=ig-hashtag-top-media', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fbUserAccessToken, igUserId, hashtagId, limit: 25 }),
                    }),
                    authFetch('/api/social?op=ig-hashtag-recent-media', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fbUserAccessToken, igUserId, hashtagId, limit: 25 }),
                    })
                ]);

                const topData = await topRes.json().catch(() => ({}));
                const recentData = await recentRes.json().catch(() => ({}));

                if (topRes.ok && Array.isArray(topData?.data)) {
                    setSeoIgTopMedia(topData.data);
                }
                if (recentRes.ok && Array.isArray(recentData?.data)) {
                    setSeoIgRecentMedia(recentData.data);
                }
            } catch (mediaErr: any) {
                console.error('Failed to auto-fetch media:', mediaErr);
                setSeoIgMediaError('Hashtag found, but failed to load some media items.');
            } finally {
                setSeoIgMediaLoading(false);
            }

        } catch (e: any) {
            setSeoIgHashtagSearchError(e?.message || 'Hashtag search failed');
        } finally {
            setSeoIgHashtagSearchLoading(false);
        }
    };

    const loadSeoIgHashtagMedia = async (kind: 'top' | 'recent') => {
        setSeoIgMediaLoading(true);
        setSeoIgMediaError(null);
        try {
            const fbUserAccessToken = facebookAccessTokenRef.current;
            if (!fbUserAccessToken) throw new Error('Connect Facebook in the Social tab first.');
            const igUserId = selectedIgId.trim();
            if (!igUserId) throw new Error('Load/select an Instagram account in the Social tab first.');
            const hashtagId = String(seoIgHashtagResult?.id || '').trim();
            if (!hashtagId) throw new Error('Search for a hashtag first.');

            const op = kind === 'top' ? 'ig-hashtag-top-media' : 'ig-hashtag-recent-media';
            const res = await authFetch(`/api/social?op=${op}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fbUserAccessToken, igUserId, hashtagId, limit: 25 }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to load hashtag media');
            const list = Array.isArray(data?.data) ? data.data : [];
            if (kind === 'top') setSeoIgTopMedia(list);
            else setSeoIgRecentMedia(list);
        } catch (e: any) {
            setSeoIgMediaError(e?.message || 'Failed to load hashtag media');
        } finally {
            setSeoIgMediaLoading(false);
        }
    };

    const handleSeoDiscoverySearch = async () => {
        setSeoDiscoveryLoading(true);
        setSeoDiscoveryError(null);
        setSeoDiscoveryResult(null);

        try {
            const fbUserAccessToken = facebookAccessTokenRef.current;
            if (!fbUserAccessToken) throw new Error('Connect Facebook in the Social tab first.');
            const igUserId = selectedIgId.trim();
            if (!igUserId) throw new Error('Load/select an Instagram account in the Social tab first.');
            if (!seoDiscoveryUsername.trim()) throw new Error('Enter a username.');

            const res = await authFetch('/api/social?op=ig-business-discovery', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fbUserAccessToken, igUserId, username: seoDiscoveryUsername.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Discovery search failed');

            setSeoDiscoveryResult(data.result);
        } catch (e: any) {
            setSeoDiscoveryError(e?.message || 'Search failed');
        } finally {
            setSeoDiscoveryLoading(false);
        }
    };

    const [showNewMenu, setShowNewMenu] = useState(false);
    const [notesAutoNew, setNotesAutoNew] = useState(false);
    const [assetsInitialFilter, setAssetsInitialFilter] = useState<string[]>([]);

    const handleAssetsFilterChange = useCallback((filters: string[]) => {
        setCurrentAssetsFilter(filters);
        setAssetsInitialFilter(filters);
    }, []);

    const [newsMode, setNewsMode] = useState<'news' | 'videos'>('news');
    const [videoPlayerMode, setVideoPlayerMode] = useState<'hidden' | 'modal' | 'mini'>('hidden');
    const [activeYoutubeVideoId, setActiveYoutubeVideoId] = useState<string | null>(null);
    const [refreshingVideos, setRefreshingVideos] = useState(false);
    const [isAnalyzingVideo, setIsAnalyzingVideo] = useState(false);
    const [videoAnalysisById, setVideoAnalysisById] = useState<Record<string, string>>({});
    const [videoAnalysisError, setVideoAnalysisError] = useState<string | null>(null);
    const [miniPlayerPos, setMiniPlayerPos] = useState<{ x: number; y: number } | null>(null);
    const [showProjectNoteMap, setShowProjectNoteMap] = useState(false);
    const projectNoteMapPersistTimeoutRef = useRef<number | null>(null);
    const latestProjectNoteMapStateRef = useRef<NoteNode[]>(currentProject.projectNoteMapState || []);
    const miniDragRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
    } | null>(null);

    const currentProjectRef = useRef<ResearchProject>(project);
    const refreshNewsRef = useRef<(() => Promise<void>) | null>(null);
    const autoNewsRefreshByProjectRef = useRef<Record<string, boolean>>({});
    const refreshVideosRef = useRef<(() => Promise<void>) | null>(null);
    const autoVideosRefreshByProjectRef = useRef<Record<string, boolean>>({});

    // Research Library filters & search
    const [researchSearch, setResearchSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [staleFilter, setStaleFilter] = useState<'all' | 'fresh' | 'stale'>('all');
    const [dateFrom, setDateFrom] = useState<string>('');
    const [dateTo, setDateTo] = useState<string>('');
    const autoDraftStartedRef = useRef<boolean>(false);


    // Sync scheduledPosts state into currentProject so chat context can access it
    useEffect(() => {
        setCurrentProject(prev => ({
            ...prev,
            scheduledPosts: scheduledPosts,
        }));
    }, [scheduledPosts]);

    // Sync SEO search results into currentProject so chat context can access them
    useEffect(() => {
        setCurrentProject(prev => ({
            ...prev,
            seoSearchResults: {
                seoAnalysis: seoData || seoAdvice ? {
                    keyword: seoKeyword,
                    location: seoLocation,
                    data: seoData,
                    advice: seoAdvice,
                } : undefined,
                igHashtagResearch: seoIgHashtagResult || seoIgTopMedia.length > 0 || seoIgRecentMedia.length > 0 ? {
                    query: normalizeHashtag(seoIgHashtagQuery),
                    hashtagId: seoIgHashtagResult?.id || null,
                    topMedia: seoIgTopMedia,
                    recentMedia: seoIgRecentMedia,
                } : undefined,
                igBusinessDiscovery: seoDiscoveryResult ? {
                    username: seoDiscoveryUsername,
                    result: seoDiscoveryResult,
                } : undefined,
                xSearch: xSearchResults ? {
                    mode: xSearchMode,
                    query: xSearchQuery,
                    results: xSearchResults,
                } : undefined,
                adTargetingSearch: targetingResults.length > 0 ? {
                    type: targetingSearchType,
                    query: targetingQuery,
                    results: targetingResults,
                } : undefined,
            },
        }));
    }, [
        seoKeyword, seoLocation, seoData, seoAdvice,
        seoIgHashtagQuery, seoIgHashtagResult, seoIgTopMedia, seoIgRecentMedia,
        seoDiscoveryUsername, seoDiscoveryResult,
        xSearchMode, xSearchQuery, xSearchResults,
        targetingSearchType, targetingQuery, targetingResults,
    ]);

    // Sync Google integrations into currentProject so chat context can access them
    // Note: driveFiles is in the DataTab component, so we only sync calendarEvents here
    useEffect(() => {
        setCurrentProject(prev => ({
            ...prev,
            googleIntegrations: {
                ...prev.googleIntegrations,
                calendarEvents: calendarEvents.length > 0 ? calendarEvents : undefined,
            },
        }));
    }, [calendarEvents]);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (!event.data || !event.data.type) return;

            if (event.data.type === 'google-calendar:connected') {
                handleRefreshCalendarWidget?.().catch(() => undefined);
            } else if (event.data.type === 'youtube:connected') {
                setYoutubeConnected(true);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    useEffect(() => {
        if (activeTab !== 'overview') return;
        handleRefreshCalendarWidget().catch(() => undefined);
    }, [activeTab]);

    useEffect(() => {
        if (activeTab !== 'social') return;
        refreshFacebookStatus()
            .then((connected) => {
                if (connected) {
                    return loadInstagramAccounts();
                }
            })
            .catch(() => undefined);
    }, [activeTab]);

    useEffect(() => {
        if (activeTab !== 'overview') return;
        if (!calendarConnected) return;

        setCalendarLoading(true);
        setCalendarError(null);
        loadCalendarEvents(calendarMonth)
            .catch((e: any) => {
                setCalendarError(e?.message || 'Failed to load Google Calendar events');
            })
            .finally(() => {
                setCalendarLoading(false);
            });
    }, [activeTab, calendarConnected, calendarMonth]);

    useEffect(() => {
        if (activeTab === 'notes' && notesAutoNew) {
            setNotesAutoNew(false);
        }
    }, [activeTab, notesAutoNew]);

    const [inspoIgPosts, setInspoIgPosts] = useState<any[]>([]);
    const [inspoTweets, setInspoTweets] = useState<any[]>([]);
    const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
    // xConnected is already defined in the component scope (around line 1166)

    // Check X status on mount (preload)
    useEffect(() => {
        const checkX = async () => {
            try {
                // Use authFetch directly which handles the auth token header
                // The endpoint expects GET /api/social?op=x-status
                const res = await authFetch('/api/social?op=x-status', { method: 'GET' });
                if (res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setXConnected(!!data.connected);
                }
            } catch (e) {
                console.warn('Failed to check X status:', e);
                setXConnected(false);
            }
        };
        checkX();
    }, []);

    // Load inspiration content (images from Pexels/Brave + YouTube videos + Social)
    const loadInspoContent = useCallback(async () => {
        if ((!currentProject.activeResearchTopic && !currentProject.name) || inspoLoading) return;

        setInspoLoading(true);
        setInspoError(null);

        const baseQuery = currentProject.activeResearchTopic || currentProject.name;

        try {
            // 1. Generate diverse search queries
            const { generateInspoSearchQueries } = await import('../services/geminiService');
            const queries = await generateInspoSearchQueries(currentProject.name, currentProject.description || '');

            // Ensure specific queries are used, plus the base one if needed
            const searchTerms = Array.from(new Set([baseQuery, ...queries])).slice(0, 4);
            console.log('Inspo search terms:', searchTerms);

            // 2. Define search functions for each platform
            const { searchImages } = await import('../services/imageSearchService');

            // Helper to run a search for a specific term safely
            const runSearch = async (term: string) => {
                const [images, videos, igPosts, tweets] = await Promise.all([
                    // Images
                    searchImages(term, 8).catch(e => { console.warn('Image search failed for', term, e); return []; }),

                    // YouTube
                    searchYoutubeVideos(term).catch(e => { console.warn('YT search failed for', term, e); return []; }),

                    // Instagram (only if connected)
                    (async () => {
                        if (!facebookAccessTokenRef.current || !selectedIgId) return [];
                        // For IG, we search hashtags (remove spaces/symbols)
                        const hashtag = term.replace(/[^a-zA-Z0-9]/g, '');
                        if (hashtag.length < 3) return [];

                        const searchRes = await authFetch(`/api/social?op=ig-hashtag-search&q=${encodeURIComponent(hashtag)}&accessToken=${facebookAccessTokenRef.current}&igId=${selectedIgId}`);
                        if (!searchRes.ok) return [];
                        const searchData = await searchRes.json();
                        if (!searchData?.id) return [];

                        const mediaRes = await authFetch(`/api/social?op=ig-hashtag-top-media&hashtagId=${searchData.id}&accessToken=${facebookAccessTokenRef.current}&igId=${selectedIgId}&limit=5`);
                        return mediaRes.ok ? (await mediaRes.json()).data || [] : [];
                    })().catch(e => { console.warn('IG search failed for', term, e); return []; }),

                    // X/Twitter (only if connected)
                    (async () => {
                        const userId = storageService.getCurrentUser();
                        if (!userId) {
                            console.log('Skipping X search: No user ID');
                            return [];
                        }

                        // Log intended search
                        console.log(`X Search Check: Term="${term}", Base="${baseQuery}", Query0="${queries?.[0]}"`);

                        // Optimization: X search is expensive/rate-limited.
                        // We ONLY use the first AI-generated query for X, avoiding the raw 'baseQuery'.
                        // This prevents "Too Many Requests" (500) and ensures relevance with "realistic" keywords.
                        const targetXQuery = queries.length > 0 ? queries[0] : null;

                        if (!targetXQuery || term !== targetXQuery) {
                            console.log(`Skipping X search for "${term}": Not the target optimized query "${targetXQuery}"`);
                            return [];
                        }

                        try {
                            console.log('Executing X Search for:', term);
                            const res = await authFetch('/api/social?op=x-recent-search', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ userId, query: term }),
                            });

                            const data = await res.json().catch(() => ({}));
                            console.log('X Search Response:', res.ok, data);

                            if (res.ok && data?.data) {
                                const mapped = data.data.map((t: any) => ({
                                    ...t,
                                    user: data.includes?.users?.find((u: any) => u.id === t.author_id)
                                }));
                                console.log('Mapped X Tweets:', mapped.length);
                                return mapped;
                            }
                            return [];
                        } catch (err) {
                            console.error('X Search Error:', err);
                            return [];
                        }
                    })().catch(e => { console.warn('X search failed for', term, e); return []; })
                ]);

                return { images, videos, igPosts, tweets };
            };

            // 3. Execute searches sequentially to avoid rate limits (429/500)
            const results = [];
            for (const term of searchTerms) {
                results.push(await runSearch(term));
                // Small delay between searches to be nice to APIs
                await new Promise(r => setTimeout(r, 800));
            }

            // 4. Aggregate and Deduplicate
            const allImages: any[] = [];
            const allVideos: any[] = [];
            const allIgPosts: any[] = [];
            const allTweets: any[] = [];

            const seenImageIds = new Set();
            const seenVideoIds = new Set();
            const seenIgIds = new Set();
            const seenTweetIds = new Set();

            results.forEach(r => {
                r.images.forEach((i: any) => { if (!seenImageIds.has(i.url)) { seenImageIds.add(i.url); allImages.push(i); } });
                r.videos.forEach((v: any) => { if (!seenVideoIds.has(v.id)) { seenVideoIds.add(v.id); allVideos.push(v); } });
                r.igPosts.forEach((p: any) => { if (!seenIgIds.has(p.id)) { seenIgIds.add(p.id); allIgPosts.push(p); } });
                r.tweets.forEach((t: any) => { if (!seenTweetIds.has(t.id)) { seenTweetIds.add(t.id); allTweets.push(t); } });
            });

            // Shuffle logic (simple sort by random) to interleave content
            allImages.sort(() => Math.random() - 0.5);
            allVideos.sort(() => Math.random() - 0.5);

            setInspoImages(allImages);
            setInspoVideos(allVideos);
            setInspoIgPosts(allIgPosts);
            setInspoTweets(allTweets);

            // Save to localStorage for persistence
            try {
                const cacheKey = `inspo_cache_${currentProject.id}`;
                localStorage.setItem(cacheKey, JSON.stringify({
                    images: allImages,
                    videos: allVideos,
                    igPosts: allIgPosts,
                    tweets: allTweets,
                    timestamp: Date.now(),
                }));
            } catch (e) {
                console.warn('Failed to cache inspo content:', e);
            }
        } catch (error) {
            console.error('Failed to load inspiration content:', error);
            setInspoError('Failed to load inspiration content');
        } finally {
            setInspoLoading(false);
        }
    }, [currentProject.activeResearchTopic, currentProject.name, currentProject.description, inspoLoading, selectedIgId]);

    // Load inspo content from cache on mount, or fetch if no cache
    // IMPORTANT: Clear state first to prevent data leakage between projects
    useEffect(() => {
        // Clear inspo state immediately when project changes
        setInspoImages([]);
        setInspoVideos([]);
        setInspoIgPosts([]);
        setInspoTweets([]);
        setInspoError(null);

        // Try to load from localStorage for this project
        try {
            const cacheKey = `inspo_cache_${project.id}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const data = JSON.parse(cached);
                if (data.images?.length > 0 || data.videos?.length > 0 || data.igPosts?.length > 0 || data.tweets?.length > 0) {
                    setInspoImages(data.images || []);
                    setInspoVideos(data.videos || []);
                    setInspoIgPosts(data.igPosts || []);
                    setInspoTweets(data.tweets || []);
                    return; // Don't auto-fetch, we have cached data
                }
            }
        } catch (e) {
            console.warn('Failed to load cached inspo content:', e);
        }

        // No cache found - content will be loaded on-demand when user visits inspo tab
    }, [project.id]); // Use project.id directly to avoid stale closure issues

    // Save inspo image to project assets
    const saveInspoImageToAssets = useCallback(async (imageUrl: string, title: string) => {
        if (!currentProject.id || savingInspoImages.has(imageUrl)) return;

        setSavingInspoImages(prev => new Set(prev).add(imageUrl));

        try {
            let blob: Blob;

            try {
                // Try direct fetch first
                const response = await fetch(imageUrl);
                if (!response.ok) throw new Error('Direct fetch failed');
                blob = await response.blob();
            } catch (directError) {
                console.warn('Direct fetch failed, trying proxy...', directError);
                // Fallback to proxy
                const proxyUrl = `/api/media?op=proxy-image&url=${encodeURIComponent(imageUrl)}`;
                const response = await fetch(proxyUrl);
                if (!response.ok) throw new Error('Proxy fetch failed');
                blob = await response.blob();
            }

            const extension = blob.type.split('/')[1] || 'jpg';
            const fileName = `${title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}_${Date.now()}.${extension}`;
            const file = new File([blob], fileName, { type: blob.type });

            // Upload to project assets
            await storageService.uploadKnowledgeBaseFile(currentProject.id, file, undefined, { skipIndexing: true });

            // Show success feedback (brief)
            alert('Image saved to Assets > Images!');
        } catch (error) {
            console.error('Failed to save inspo image:', error);
            alert('Failed to save image. The image may be protected or blocked.');
        } finally {
            setSavingInspoImages(prev => {
                const next = new Set(prev);
                next.delete(imageUrl);
                return next;
            });
        }
    }, [currentProject.id, savingInspoImages]);

    const notes = currentProject.notes || [];
    const researchSessions = currentProject.researchSessions || [];
    const tasks = currentProject.tasks || [];
    const draftResearchSessions = currentProject.draftResearchSessions || [];
    const visibleActiveLogs = (activeResearchLogs || []).slice(-4);
    const collaborators = currentProject.collaborators || [];

    const projectNoteMapKnowledgeBaseFiles = useMemo(() => {
        const merged: KnowledgeBaseFile[] = [];
        (currentProject.knowledgeBase || []).forEach(f => merged.push(f));
        (currentProject.researchSessions || []).forEach(session => {
            (session.uploadedFiles || []).forEach(f => merged.push(f));
        });

        const inferMimeFromUrl = (url: string): string => {
            const u = (url || '').toLowerCase();
            if (u.match(/\.(png)(\?|#|$)/)) return 'image/png';
            if (u.match(/\.(jpe?g)(\?|#|$)/)) return 'image/jpeg';
            if (u.match(/\.(gif)(\?|#|$)/)) return 'image/gif';
            if (u.match(/\.(webp)(\?|#|$)/)) return 'image/webp';
            if (u.match(/\.(svg)(\?|#|$)/)) return 'image/svg+xml';
            if (u.match(/\.(bmp)(\?|#|$)/)) return 'image/bmp';
            if (u.match(/\.(mp4)(\?|#|$)/)) return 'video/mp4';
            if (u.match(/\.(webm)(\?|#|$)/)) return 'video/webm';
            if (u.match(/\.(mov)(\?|#|$)/)) return 'video/quicktime';
            return 'application/octet-stream';
        };

        const isPreviewableUrl = (url: string): boolean => {
            const u = (url || '').trim();
            return !!u && (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('blob:'));
        };

        const addAssetUrl = (url: string, name: string) => {
            const u = (url || '').trim();
            if (!isPreviewableUrl(u)) return;
            const mime = inferMimeFromUrl(u);
            if (!mime.startsWith('image/') && !mime.startsWith('video/')) return;
            merged.push({
                id: `asset-${u}`,
                name: name || 'Asset',
                type: mime,
                size: 0,
                url: u,
                storagePath: '',
                uploadedAt: Date.now(),
                extractedText: '',
                summary: '',
            });
        };

        // Include assets that show up under the Assets tab (report media + notemap media).
        (currentProject.researchSessions || []).forEach(session => {
            const report = session.researchReport;
            if (report?.headerImageUrl) {
                addAssetUrl(report.headerImageUrl, `Header: ${session.topic || report.topic || 'Research'}`);
            }
            (report?.slides || []).forEach((s, idx) => {
                if ((s as any).imageUrl) addAssetUrl((s as any).imageUrl, `Slide ${idx + 1}: ${session.topic || report.topic || 'Research'}`);
                const urls = Array.isArray((s as any).imageUrls) ? (s as any).imageUrls : [];
                urls.forEach((u: string, j: number) => addAssetUrl(u, `Slide ${idx + 1}.${j + 1}: ${session.topic || report.topic || 'Research'}`));
            });
            (report?.socialCampaign?.posts || []).forEach((p, idx) => {
                const u = (p as any).imageUrl;
                if (u) addAssetUrl(u, `Social ${idx + 1}: ${(p as any).platform || 'Post'}`);
            });
            if ((report as any)?.blogPost?.imageUrl) {
                addAssetUrl((report as any).blogPost.imageUrl, `Blog cover: ${session.topic || report.topic || 'Research'}`);
            }

            (session.noteMapState || []).forEach(n => {
                const u = (n as any).imageUrl;
                if (u) addAssetUrl(u, `NoteMap: ${(n as any).title || 'Image'}`);
            });
        });

        (currentProject.projectNoteMapState || []).forEach(n => {
            const u = (n as any).imageUrl;
            if (u) addAssetUrl(u, `Project NoteMap: ${(n as any).title || 'Image'}`);
        });

        const dedup = new Map<string, KnowledgeBaseFile>();
        merged.forEach(f => {
            const url = (f.url || '').toString();
            if (!url) return;
            if (!dedup.has(url)) dedup.set(url, f);
        });
        return Array.from(dedup.values());
    }, [currentProject.knowledgeBase, currentProject.researchSessions]);

    const aggregatedResearchReport: ResearchReport | null = useMemo(() => {
        const sessions = (currentProject.researchSessions || []).filter(Boolean);
        const reports = sessions.map(s => s.researchReport).filter(Boolean) as ResearchReport[];
        if (!reports.length) return null;

        const combinedSummary = reports
            .map(r => {
                const topic = (r.topic || '').trim() || 'Research';
                const body = (r.tldr || r.summary || '').trim();
                if (!body) return '';
                return `## ${topic}\n${body}`;
            })
            .filter(Boolean)
            .join('\n\n')
            .trim();

        const keyPoints = reports
            .flatMap(r => r.keyPoints || [])
            .filter(Boolean)
            .slice(0, 20);

        const byVideoId = new Map<string, YoutubeVideo>();
        reports
            .flatMap(r => r.youtubeVideos || [])
            .filter(Boolean)
            .forEach(v => {
                const id = (v.id || '').trim();
                if (!id) return;
                if (!byVideoId.has(id)) byVideoId.set(id, v);
            });

        const topic = `${currentProject.name || 'Project'} (Project)`;

        return {
            topic,
            headerImagePrompt: '',
            tldr: (combinedSummary || '').slice(0, 1500),
            summary: combinedSummary || '',
            keyPoints: keyPoints.length
                ? keyPoints
                : [{ title: 'Research sessions', details: `${reports.length} session(s)`, priority: 'medium' }],
            marketImplications: '',
            youtubeVideos: Array.from(byVideoId.values()),
        };
    }, [currentProject.id, currentProject.name, currentProject.researchSessions]);

    const seedProjectNoteMapState: NoteNode[] | undefined = useMemo(() => {
        const saved = currentProject.projectNoteMapState || [];
        if (Array.isArray(saved) && saved.length) return saved;

        const projectNotes = currentProject.notes || [];
        if (!projectNotes.length) return undefined;

        const centerX = typeof window !== 'undefined' ? window.innerWidth / 2 : 500;
        const centerY = typeof window !== 'undefined' ? window.innerHeight / 2 : 500;

        const colorById: Record<string, string> = {
            default: '#334155',
            blue: '#1d4ed8',
            green: '#047857',
            yellow: '#b45309',
            pink: '#be185d',
            purple: '#6d28d9',
        };

        const nodes: NoteNode[] = [];

        const contextBody = aggregatedResearchReport?.summary || aggregatedResearchReport?.tldr || '';
        if (contextBody.trim()) {
            nodes.push({
                id: `proj-context-${currentProject.id}`,
                x: centerX - 225,
                y: centerY - 240,
                title: 'Project Context',
                content: contextBody.slice(0, 5000),
                width: 450,
                color: '#3b82f6',
                type: 'note',
            });
        }

        const spacingX = 360;
        const spacingY = 260;
        projectNotes.slice(0, 24).forEach((note, idx) => {
            const col = idx % 3;
            const row = Math.floor(idx / 3);
            nodes.push({
                id: `proj-note-${note.id}`,
                x: centerX - 540 + col * spacingX,
                y: centerY + row * spacingY,
                title: note.title || 'Note',
                content: note.content || '',
                width: 340,
                color: colorById[(note as any).color] || '#334155',
                type: 'note',
            });
        });

        return nodes;
    }, [currentProject.id, currentProject.notes, currentProject.projectNoteMapState, aggregatedResearchReport]);

    useEffect(() => {
        return () => {
            if (projectNoteMapPersistTimeoutRef.current) {
                window.clearTimeout(projectNoteMapPersistTimeoutRef.current);
                projectNoteMapPersistTimeoutRef.current = null;
            }

            const nodes = latestProjectNoteMapStateRef.current;
            if (Array.isArray(nodes) && nodes.length > 0) {
                storageService.updateResearchProject(currentProject.id, {
                    projectNoteMapState: nodes,
                    lastModified: Date.now(),
                }).catch((err) => {
                    console.error('Failed to persist project note map state', err);
                });
            }
        };
    }, []);

    const flushPersistProjectNoteMap = async () => {
        if (projectNoteMapPersistTimeoutRef.current) {
            window.clearTimeout(projectNoteMapPersistTimeoutRef.current);
            projectNoteMapPersistTimeoutRef.current = null;
        }

        const nodes = latestProjectNoteMapStateRef.current;
        if (!Array.isArray(nodes) || nodes.length === 0) return;

        try {
            await storageService.updateResearchProject(currentProject.id, {
                projectNoteMapState: nodes,
                lastModified: Date.now(),
            });
        } catch (err) {
            console.error('Failed to persist project note map state', err);
        }
    };

    const handleCloseProjectNoteMap = async () => {
        await flushPersistProjectNoteMap();
        setShowProjectNoteMap(false);
    };

    const schedulePersistProjectNoteMap = (nextNodes: NoteNode[]) => {
        if (projectNoteMapPersistTimeoutRef.current) {
            window.clearTimeout(projectNoteMapPersistTimeoutRef.current);
            projectNoteMapPersistTimeoutRef.current = null;
        }
        projectNoteMapPersistTimeoutRef.current = window.setTimeout(() => {
            storageService.updateResearchProject(currentProject.id, {
                projectNoteMapState: nextNodes,
                lastModified: Date.now(),
            }).catch((err) => {
                console.error('Failed to persist project note map state', err);
            });
        }, 750);
    };

    const newsArticles: NewsArticle[] = (currentProject as any).newsArticles || [];
    const [refreshingNews, setRefreshingNews] = useState(false);

    const youtubeVideos: YoutubeVideo[] = (currentProject as any).youtubeVideos || [];
    const effectiveYoutubeVideoId: string | null =
        activeYoutubeVideoId || youtubeVideos[0]?.id || null;

    const ensureMiniPlayerPos = () => {
        if (miniPlayerPos) return;
        if (typeof window === 'undefined') return;
        const MINI_W = 340;
        const MINI_H = 240;
        const padding = 16;
        const x = padding;
        const y = Math.max(padding, window.innerHeight - MINI_H - padding);
        setMiniPlayerPos({ x, y });
    };

    const openVideoPlayer = (videoId: string) => {
        setActiveYoutubeVideoId(videoId);
        setVideoAnalysisError(null);
        setVideoPlayerMode('modal');
    };

    const minimizeVideoPlayer = () => {
        if (!effectiveYoutubeVideoId) {
            setVideoPlayerMode('hidden');
            return;
        }
        ensureMiniPlayerPos();
        setVideoPlayerMode('mini');
    };

    const closeVideoPlayer = () => {
        setVideoPlayerMode('hidden');
    };

    const handleMiniPointerDown = (e: React.PointerEvent) => {
        if (videoPlayerMode !== 'mini') return;
        if (!miniPlayerPos) ensureMiniPlayerPos();
        const pos = miniPlayerPos || { x: 16, y: 16 };
        miniDragRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            originX: pos.x,
            originY: pos.y,
        };
        (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    };

    const handleMiniPointerMove = (e: React.PointerEvent) => {
        const st = miniDragRef.current;
        if (!st) return;
        if (st.pointerId !== e.pointerId) return;
        if (typeof window === 'undefined') return;

        const dx = e.clientX - st.startX;
        const dy = e.clientY - st.startY;
        const MINI_W = 340;
        const MINI_H = 240;
        const padding = 8;

        const maxX = Math.max(padding, window.innerWidth - MINI_W - padding);
        const maxY = Math.max(padding, window.innerHeight - MINI_H - padding);

        const nextX = Math.min(maxX, Math.max(padding, st.originX + dx));
        const nextY = Math.min(maxY, Math.max(padding, st.originY + dy));
        setMiniPlayerPos({ x: nextX, y: nextY });
    };

    const handleMiniPointerUp = (e: React.PointerEvent) => {
        const st = miniDragRef.current;
        if (!st) return;
        if (st.pointerId !== e.pointerId) return;
        (e.currentTarget as any).releasePointerCapture?.(e.pointerId);
        miniDragRef.current = null;
    };

    const handleAnalyzeActiveVideo = async () => {
        const videoId = effectiveYoutubeVideoId;
        if (!videoId) return;
        if (videoAnalysisById[videoId]) {
            setVideoAnalysisError(null);
            return;
        }

        setIsAnalyzingVideo(true);
        setVideoAnalysisError(null);
        try {
            const res = await authFetch('/api/youtube-video-analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
                    topic: currentProject.name || '',
                    projectDescription: currentProject.description || '',
                }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'Failed to analyze video');
            }
            const analysis = String(data?.analysis || '').trim();
            if (!analysis) {
                throw new Error('Empty analysis returned');
            }

            setVideoAnalysisById(prev => ({ ...prev, [videoId]: analysis }));
        } catch (e: any) {
            setVideoAnalysisError(e?.message || 'Failed to analyze video');
        } finally {
            setIsAnalyzingVideo(false);
        }
    };

    const refreshNews = async () => {
        if (refreshingNews) return;
        setRefreshingNews(true);
        try {
            const base = (currentProject.name || currentProject.description || '').trim() || 'technology';

            const now = Date.now();
            const from = new Date(now - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

            const baseTokens = base
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter(Boolean)
                .filter(t => t.length >= 4)
                .slice(0, 10);

            const projectTokens = new Set<string>(baseTokens);
            const anchorPhrases: string[] = [];

            const projectNameTrimmed = (currentProject.name || '').trim();
            if (projectNameTrimmed && projectNameTrimmed.length <= 80) {
                anchorPhrases.push(projectNameTrimmed);
            }

            if (base && base.length <= 80) {
                anchorPhrases.push(base);
            }

            if (/\bpod\b/i.test(base)) {
                projectTokens.add('pod');
                projectTokens.add('print');
                projectTokens.add('demand');
                projectTokens.add('merch');

                anchorPhrases.push('print on demand');
                anchorPhrases.push('print-on-demand');
            }

            // Heuristic fallback (kept as a backup if Gemini fails)
            let heuristicQ = base;
            if (/\bPOD\b/i.test(base)) {
                const withoutPod = base.replace(/\bPOD\b/gi, '').replace(/\s+/g, ' ').trim();
                const parts: string[] = ['("print on demand" OR POD)'];
                if (withoutPod) {
                    parts.push(withoutPod.length <= 80 && /\s/.test(withoutPod) ? `"${withoutPod}"` : withoutPod);
                }
                heuristicQ = parts.join(' AND ');
            } else if (base.length <= 80 && /\s/.test(base)) {
                heuristicQ = `"${base}"`;
            }

            // Primary: Gemini generates the query using gemini-3.1-flash-lite-preview
            let queries: string[] = [];
            try {
                queries = await generateNewsApiQueries(currentProject.name || '', currentProject.description || '');
            } catch (e) {
                console.warn('Failed to generate NewsAPI queries via Gemini:', e);
            }

            if (!queries.length) {
                try {
                    const single = await generateNewsApiQuery(currentProject.name || '', currentProject.description || '');
                    if (single) queries = [single];
                } catch {
                    // ignore
                }
            }

            if (!queries.length) {
                queries = [heuristicQ];
            }

            const collected: NewsArticle[] = [];
            const seen = new Set<string>();

            for (const q of queries) {
                if (collected.length >= 8) break;

                const res = await authFetch('/api/news-search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        endpoint: 'everything',
                        q,
                        from,
                        searchIn: 'title',
                        sortBy: 'relevancy',
                        language: 'en',
                        pageSize: 8,
                    }),
                });

                if (!res.ok) continue;

                const data = await res.json();
                const articles = Array.isArray(data?.articles) ? data.articles : [];
                for (const a of articles) {
                    const url = (a?.url || '').toString();
                    if (!url) continue;
                    if (seen.has(url)) continue;
                    seen.add(url);
                    collected.push({
                        source: a?.source ?? null,
                        title: a?.title ?? '',
                        description: a?.description ?? null,
                        url,
                        urlToImage: a?.urlToImage ?? null,
                        publishedAt: a?.publishedAt ?? null,
                    });
                    if (collected.length >= 8) break;
                }
            }

            const normalized = collected.slice(0, 8);

            await storageService.updateResearchProject(currentProject.id, {
                newsArticles: normalized,
                newsLastFetchedAt: Date.now(),
            });

            const nextProject = { ...currentProject, newsArticles: normalized, newsLastFetchedAt: Date.now() } as any;
            setCurrentProject(nextProject);
            onProjectUpdate?.(nextProject);
        } catch (e) {
            console.error('Failed to refresh project news', e);
        } finally {
            setRefreshingNews(false);
        }
    };

    refreshNewsRef.current = refreshNews;

    const refreshVideos = async () => {
        if (refreshingVideos) return;
        setRefreshingVideos(true);
        try {
            // Prefer already-generated video intelligence from research sessions.
            const sessions = currentProject.researchSessions || [];
            const fromSessions = sessions
                .flatMap(s => s.researchReport?.youtubeVideos || [])
                .filter(Boolean) as YoutubeVideo[];
            const dedup = new Map<string, YoutubeVideo>();
            for (const v of fromSessions) dedup.set(v.id, v);
            let videos = Array.from(dedup.values());

            // If no sessions have videos yet, do a lightweight fetch on entry.
            if (videos.length === 0) {
                const q = (currentProject.name || currentProject.description || '').trim() || 'technology';
                videos = await searchYoutubeVideos(q);
            }

            await storageService.updateResearchProject(currentProject.id, {
                youtubeVideos: videos,
                youtubeLastFetchedAt: Date.now(),
            });

            const nextProject = { ...currentProject, youtubeVideos: videos, youtubeLastFetchedAt: Date.now() } as any;
            setCurrentProject(nextProject);
            onProjectUpdate?.(nextProject);
        } catch (e) {
            console.error('Failed to refresh project videos', e);
        } finally {
            setRefreshingVideos(false);
        }
    };

    refreshVideosRef.current = refreshVideos;

    useEffect(() => {
        const projectId = currentProject?.id;
        if (!projectId) return;

        const existing = Array.isArray((currentProject as any).newsArticles)
            ? ((currentProject as any).newsArticles as any[])
            : [];

        if (existing.length > 0) return;
        if (refreshingNews) return;
        if (autoNewsRefreshByProjectRef.current[projectId]) return;

        autoNewsRefreshByProjectRef.current[projectId] = true;
        void refreshNewsRef.current?.();
    }, [currentProject?.id, refreshingNews]);

    useEffect(() => {
        const projectId = currentProject?.id;
        if (!projectId) return;

        const existing = Array.isArray((currentProject as any).youtubeVideos)
            ? ((currentProject as any).youtubeVideos as any[])
            : [];

        if (existing.length > 0) return;
        if (refreshingVideos) return;
        if (autoVideosRefreshByProjectRef.current[projectId]) return;

        autoVideosRefreshByProjectRef.current[projectId] = true;
        void refreshVideosRef.current?.();
    }, [currentProject?.id, refreshingVideos]);
    // Permissions defined at top of component
    const ownerDisplayName = currentProject.ownerUid
        ? currentProject.ownerUid === currentUserUid
            ? 'You'
            : currentProject.ownerUid
        : 'Project Owner';
    const sortedCollaborators = [...collaborators].sort(
        (a, b) => (b.addedAt || 0) - (a.addedAt || 0)
    );

    const seoSeedKeywords = useMemo(() => {
        const raw: any = currentProject.seoSeedKeywords;

        // No keywords stored
        if (!raw) return [];

        // Common case: already a string[]
        if (Array.isArray(raw)) {
            // Legacy guard: sometimes a single JSON array string was stored as the
            // first element, e.g. ['["kw1","kw2"]'].
            if (raw.length === 1) {
                const first = String(raw[0] || '').trim();
                if (first.startsWith('[') && first.endsWith(']')) {
                    try {
                        const parsed = JSON.parse(first);
                        if (Array.isArray(parsed)) {
                            return parsed
                                .map((s: any) => String(s || '').trim())
                                .filter((s: string) => s.length > 0);
                        }
                    } catch (e) {
                        console.warn('Failed to parse seoSeedKeywords JSON string from array element:', e);
                    }
                }
            }

            return raw
                .map((s: any) => String(s || '').trim())
                .filter((s: string) => s.length > 0);
        }

        // Legacy case: stored as a single JSON string like "[\"kw1\",\"kw2\"]"
        if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) {
                        return parsed
                            .map((s: any) => String(s || '').trim())
                            .filter((s: string) => s.length > 0);
                    }
                } catch (e) {
                    console.warn('Failed to parse seoSeedKeywords JSON string from project field:', e);
                }
            }

            // Fallback: treat as a single keyword
            return trimmed ? [trimmed] : [];
        }

        return [];
    }, [currentProject.seoSeedKeywords]);

    const seoSeedCount = seoSeedKeywords.length;

    const localSeoRows = useMemo(
        () => (seoData && Array.isArray(seoData.local) ? (seoData.local as any[]) : []),
        [seoData],
    );
    const globalSeoRows = useMemo(
        () => (seoData && Array.isArray(seoData.global) ? (seoData.global as any[]) : []),
        [seoData],
    );
    const topSeoRows = useMemo(
        () => (seoData && Array.isArray(seoData.top) ? (seoData.top as any[]) : []),
        [seoData],
    );

    const localMaxVolume = useMemo(() => getNumericMax(localSeoRows, 'volume'), [localSeoRows]);
    const localMaxCompIndex = useMemo(
        () => getNumericMax(localSeoRows, 'competition_index'),
        [localSeoRows],
    );
    const localMaxHighBid = useMemo(() => getNumericMax(localSeoRows, 'high_bid'), [localSeoRows]);
    const localMaxTrendAbs = useMemo(
        () =>
            localSeoRows.reduce((max, row) => {
                if (!row || typeof row.trend === 'undefined' || row.trend === null) return max;
                const raw = row.trend;
                const v = typeof raw === 'number' ? raw : Number(raw) || 0;
                const abs = Math.abs(v);
                return abs > max ? abs : max;
            }, 0),
        [localSeoRows],
    );

    const globalMaxVolume = useMemo(() => getNumericMax(globalSeoRows, 'volume'), [globalSeoRows]);
    const globalMaxCompIndex = useMemo(
        () => getNumericMax(globalSeoRows, 'competition_index'),
        [globalSeoRows],
    );
    const globalMaxHighBid = useMemo(
        () => getNumericMax(globalSeoRows, 'high_bid'),
        [globalSeoRows],
    );
    const globalMaxTrendAbs = useMemo(
        () =>
            globalSeoRows.reduce((max, row) => {
                if (!row || typeof row.trend === 'undefined' || row.trend === null) return max;
                const raw = row.trend;
                const v = typeof raw === 'number' ? raw : Number(raw) || 0;
                const abs = Math.abs(v);
                return abs > max ? abs : max;
            }, 0),
        [globalSeoRows],
    );

    const topMaxVolume = useMemo(() => getNumericMax(topSeoRows, 'volume'), [topSeoRows]);
    const topMaxCompIndex = useMemo(
        () => getNumericMax(topSeoRows, 'competition_index'),
        [topSeoRows],
    );
    const topMaxHighBid = useMemo(() => getNumericMax(topSeoRows, 'high_bid'), [topSeoRows]);
    const topMaxTrendAbs = useMemo(
        () =>
            topSeoRows.reduce((max, row) => {
                if (!row || typeof row.trend === 'undefined' || row.trend === null) return max;
                const raw = row.trend;
                const v = typeof raw === 'number' ? raw : Number(raw) || 0;
                const abs = Math.abs(v);
                return abs > max ? abs : max;
            }, 0),
        [topSeoRows],
    );

    const hasActiveResearchForThisProject = !!(
        activeResearchProjectId && activeResearchProjectId === currentProject.id
    );

    const todoCount = tasks.filter(t => t.status === 'todo').length;
    const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;
    const doneCount = tasks.filter(t => t.status === 'done').length;

    const categoryOptions = useMemo(() => {
        const categories = new Set<string>();
        researchSessions.forEach(session => {
            const cat = session.researchReport?.category;
            if (cat) categories.add(cat);
        });
        return Array.from(categories).sort();
    }, [researchSessions]);

    const isSessionStale = (session: SavedResearch) => {
        if (session.isStale === true) return true;
        const timestamp = session.lastModified || session.timestamp;
        if (!timestamp) return false;
        const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
        return ageDays >= 7;
    };

    const filteredResearchSessions = useMemo(() => {
        if (researchSessions.length === 0) return [] as SavedResearch[];
        return researchSessions.filter(session => {
            const report = session.researchReport;

            if (researchSearch.trim()) {
                const q = researchSearch.toLowerCase();
                const matchesTopic = session.topic.toLowerCase().includes(q);
                const matchesSummary =
                    (report?.tldr || '').toLowerCase().includes(q) ||
                    (report?.summary || '').toLowerCase().includes(q);
                const matchesSources = (report?.sources || []).some(s =>
                    (s.title || '').toLowerCase().includes(q) ||
                    (s.snippet || '').toLowerCase().includes(q)
                );
                if (!matchesTopic && !matchesSummary && !matchesSources) {
                    return false;
                }
            }

            if (categoryFilter !== 'all') {
                const cat = report?.category || 'Research';
                if (cat !== categoryFilter) return false;
            }

            if (staleFilter !== 'all') {
                const stale = isSessionStale(session);
                if (staleFilter === 'fresh' && stale) return false;
                if (staleFilter === 'stale' && !stale) return false;
            }

            if (dateFrom) {
                const from = new Date(dateFrom).getTime();
                if (session.timestamp < from) return false;
            }
            if (dateTo) {
                const to = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000;
                if (session.timestamp >= to) return false;
            }

            return true;
        });
    }, [researchSessions, researchSearch, categoryFilter, staleFilter, dateFrom, dateTo]);

    const uploadedFileCount = (currentProject.uploadedFiles || []).length;

    const totalSources = useMemo(() => {
        return computeSourceCount(currentProject);
    }, [researchSessions, currentProject.knowledgeBase, currentProject.uploadedFiles]);



    const tabs = useMemo(
        () => [
            {
                id: 'overview' as TabId,
                label: 'Overview',
                icon: (
                    <img
                        src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/books%20%281%29.png"
                        alt=""
                        className="w-6 h-6 sm:w-5 sm:h-5 object-contain"
                        aria-hidden="true"
                    />
                ),
                count: researchSessions.length,
            },
            {
                id: 'data' as TabId,
                label: 'Data',
                icon: (
                    <img
                        src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/3d-folder.png"
                        alt=""
                        className="w-6 h-6 sm:w-5 sm:h-5 object-contain"
                        aria-hidden="true"
                    />
                ),
                count: uploadedFileCount,
            },
            {
                id: 'notes' as TabId,
                label: 'Notes',
                icon: (
                    <img
                        src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/notes.png"
                        alt=""
                        className="w-6 h-6 sm:w-5 sm:h-5 object-contain"
                        aria-hidden="true"
                    />
                ),
                count: notes.length,
            },
            {
                id: 'tasks' as TabId,
                label: 'Tasks',
                icon: (
                    <img
                        src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/check.png"
                        alt=""
                        className="w-6 h-6 sm:w-5 sm:h-5 object-contain"
                        aria-hidden="true"
                    />
                ),
                count: tasks.length,
            },
            {
                id: 'studio' as TabId,
                label: 'Studio',
                icon: (
                    <img
                        src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/video.png"
                        alt="Studio"
                        className="w-6 h-6 sm:w-5 sm:h-5 object-contain"
                    />
                ),
                count: 0,
            },
            {
                id: 'assets' as TabId,
                label: 'Assets',
                icon: (
                    <img
                        src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/content%20%281%29.png"
                        alt=""
                        className="w-6 h-6 sm:w-5 sm:h-5 object-contain"
                        aria-hidden="true"
                    />
                ),
                count: assetCount,
            },
            {
                id: 'seo' as TabId,
                label: 'SEO',
                icon: (
                    <img
                        src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/medal.png"
                        alt=""
                        className="w-6 h-6 sm:w-5 sm:h-5 object-contain"
                        aria-hidden="true"
                    />
                ),
                count: seoSeedCount,
            },
            {
                id: 'social' as TabId,
                label: 'Post',
                icon: (
                    <img
                        src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/share.png"
                        alt=""
                        className="w-6 h-6 sm:w-5 sm:h-5 object-contain"
                        aria-hidden="true"
                    />
                ),
                count: facebookConnected ? 1 : 0,
            },
            {
                id: 'email' as TabId,
                label: 'Email',
                icon: (
                    <img
                        src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/mail.png"
                        alt=""
                        className="w-6 h-6 sm:w-5 sm:h-5 object-contain"
                        aria-hidden="true"
                    />
                ),
                count: 0,
            },
            {
                id: 'inspo' as TabId,
                label: 'Inspo',
                icon: (
                    <img
                        src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/bulb.png"
                        alt="Inspo"
                        className="w-6 h-6 sm:w-5 sm:h-5 object-contain"
                    />
                ),
                count: inspoImages.length + inspoVideos.length + inspoIgPosts.length,
            },
            {
                id: 'chat' as TabId,
                label: 'Chat',
                icon: (
                    <span className="text-xl sm:text-lg" aria-hidden="true">💬</span>
                ),
                count: unreadMentions,
            },

            /* Post tab hidden - functionality moved to Social tab
            {
              id: 'post' as TabId,
              label: 'Post',
              icon: (
                <svg className="w-6 h-6 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              ),
              count: 0,
            },
            */
        ],
        [
            researchSessions,
            tasks.length,
            notes.length,
            uploadedFileCount,
            localProjectPodcasts.length,
            assetCount,
            seoSeedCount,
            facebookConnected,
            inspoImages.length,
            inspoVideos.length,
            inspoIgPosts.length,
            unreadMentions,
        ]
    );

    const [orderedTabIds, setOrderedTabIds] = useState<TabId[]>([]);
    const [draggedTabId, setDraggedTabId] = useState<TabId | null>(null);

    useEffect(() => {
        if (currentProject.tabOrder && currentProject.tabOrder.length > 0) {
            // Validate IDs are known
            const knownIds = new Set(tabs.map(t => t.id));
            const validOrder = (currentProject.tabOrder as TabId[]).filter(id => knownIds.has(id));

            // If we have valid tabs, use them. If some are missing (new features), append them at end.
            const currentIdSet = new Set(validOrder);
            const missingTabs = tabs.filter(t => !currentIdSet.has(t.id)).map(t => t.id);

            // Update state only if it differs to avoid loops
            const finalOrder = [...validOrder, ...missingTabs];

            setOrderedTabIds(prev => {
                if (JSON.stringify(prev) === JSON.stringify(finalOrder)) return prev;
                return finalOrder;
            });
        } else if (orderedTabIds.length === 0 && tabs.length > 0) {
            setOrderedTabIds(tabs.map(t => t.id));
        }
    }, [currentProject.tabOrder, tabs]);

    const sortedTabs = useMemo(() => {
        if (orderedTabIds.length === 0) return tabs;

        const tabMap = new Map(tabs.map(t => [t.id, t]));
        const result: typeof tabs = [];
        const seenIds = new Set<string>();

        for (const id of orderedTabIds) {
            const tab = tabMap.get(id);
            if (tab) {
                result.push(tab);
                seenIds.add(id);
            }
        }

        // Append any tabs not in order (e.g. newly added features)
        for (const tab of tabs) {
            if (!seenIds.has(tab.id)) {
                result.push(tab);
            }
        }

        return result;
    }, [tabs, orderedTabIds]);

    const handleTabDragStart = (e: React.DragEvent, id: TabId) => {
        if (!canEdit) return;
        setDraggedTabId(id);
        e.dataTransfer.effectAllowed = 'move';
        // Optional: Set custom drag image if needed
        // e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
    };

    const handleTabDragOver = (e: React.DragEvent, targetId: TabId) => {
        e.preventDefault();
        if (!draggedTabId || draggedTabId === targetId) return;

        const currentOrder = sortedTabs.map(t => t.id);
        const draggedIndex = currentOrder.indexOf(draggedTabId);
        const targetIndex = currentOrder.indexOf(targetId);

        if (draggedIndex === -1 || targetIndex === -1) return;

        const newOrder = [...currentOrder];
        newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, draggedTabId);

        setOrderedTabIds(newOrder);
    };

    const handleTabDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        if (!canEdit) return;
        if (!draggedTabId) return;

        const finalOrder = sortedTabs.map(t => t.id);
        setDraggedTabId(null);

        // Optimistic update
        const updatedProject = {
            ...currentProject,
            tabOrder: finalOrder,
            lastModified: Date.now(),
        };

        handleProjectChange(updatedProject);

        try {
            await storageService.updateResearchProject(currentProject.id, {
                tabOrder: finalOrder,
                lastModified: updatedProject.lastModified,
            });
        } catch (err) {
            console.error('Failed to save tab order:', err);
        }
    };

    const handleShareAsset = (asset: any) => {
        setActiveTab('social');
        const type = asset.type === 'video' ? 'video' : 'photo';
        setUpPostMediaType(type);
        setUpPostMediaUrl(asset.url);
        setUpPostTitle(asset.title || '');
        setUpPostDescription(asset.description || asset.summary || '');
    };

    const handleProjectChange = (updatedProject: ResearchProject) => {
        setCurrentProject(updatedProject);
        onProjectUpdate?.(updatedProject);
    };

    // Global drag-drop handlers for file uploads across all tabs
    const handleGlobalDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        globalDragCounter.current++;
        if (e.dataTransfer.types.includes('Files')) {
            setGlobalDragging(true);
        }
    }, []);

    const handleGlobalDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        globalDragCounter.current--;
        if (globalDragCounter.current === 0) {
            setGlobalDragging(false);
        }
    }, []);

    const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleGlobalDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        globalDragCounter.current = 0;
        setGlobalDragging(false);

        if (!canEdit) return;

        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;

        setGlobalUploading(true);
        setGlobalUploadProgress('Uploading files...');

        try {
            const newFiles: UploadedFile[] = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                setGlobalUploadProgress(`Uploading ${file.name} (${i + 1}/${files.length})...`);

                // Upload file to Gemini and object storage
                const [geminiFile, storageFile] = await Promise.all([
                    uploadFileToGemini(file, undefined, currentProject.id),
                    (async () => {
                        try {
                            return await storageService.uploadKnowledgeBaseFile(
                                currentProject.id,
                                file,
                                undefined,
                                { skipIndexing: true }
                            );
                        } catch (e) {
                            console.warn('Failed to upload to object storage:', e);
                            return null;
                        }
                    })()
                ]);

                const uploadedFile = {
                    ...geminiFile,
                    url: storageFile?.url
                };

                // Generate AI summary for the file
                setGlobalUploadProgress(`Generating summary for ${file.name}...`);
                try {
                    const summary = await generateFileSummary(uploadedFile.uri, uploadedFile.mimeType, uploadedFile.displayName);
                    if (summary && summary.trim().length > 0) {
                        uploadedFile.summary = summary;
                    }
                } catch (summaryError) {
                    console.error('Failed to generate summary:', summaryError);
                }

                newFiles.push(uploadedFile);
            }

            const updatedProject = {
                ...currentProject,
                uploadedFiles: [...(currentProject.uploadedFiles || []), ...newFiles],
                lastModified: Date.now()
            };

            // Use storageService to handle the update correctly (handles ownership/sharing logic)
            await storageService.updateResearchProject(currentProject.id, {
                uploadedFiles: updatedProject.uploadedFiles
            });
            handleProjectChange(updatedProject);
            setGlobalUploadProgress('Upload complete!');

            setTimeout(() => {
                setGlobalUploadProgress('');
                setGlobalUploading(false);
            }, 2000);
        } catch (error) {
            console.error('Upload failed:', error);
            setGlobalUploadProgress('Upload failed. Please try again.');
            setTimeout(() => {
                setGlobalUploadProgress('');
                setGlobalUploading(false);
            }, 3000);
        }
    }, [canEdit, currentProject]);

    const resetShareFeedback = () => setShareStatus(null);

    const handleCloseShareModal = () => {
        if (inviteLoading) return;
        setShowShareModal(false);
        setShareEmail('');
        setShareRole('editor');
        setShareStatus(null);
        setRemovingCollaboratorId(null);
    };

    const handleInviteCollaborator = async () => {
        if (!isOwner || inviteLoading) return;
        const email = shareEmail.trim().toLowerCase();
        if (!email) {
            setShareStatus({ type: 'error', message: 'Email is required.' });
            return;
        }

        setInviteLoading(true);
        setShareStatus(null);
        try {
            const updatedProject = await storageService.addProjectCollaboratorByEmail(
                currentProject.id,
                email,
                shareRole
            );
            handleProjectChange(updatedProject);
            setShareEmail('');
            setShareRole('editor');
            setShareStatus({ type: 'success', message: `Invitation sent to ${email}.` });
        } catch (error: any) {
            console.error('Failed to invite collaborator:', error);
            setShareStatus({
                type: 'error',
                message: error?.message || 'Failed to invite collaborator. Please try again.',
            });
        } finally {
            setInviteLoading(false);
        }
    };

    const handleRemoveCollaborator = async (collaboratorUid: string) => {
        if (!isOwner) return;
        setRemovingCollaboratorId(collaboratorUid);
        setShareStatus(null);
        try {
            const updatedProject = await storageService.removeProjectCollaborator(
                currentProject.id,
                collaboratorUid
            );
            if (updatedProject) {
                handleProjectChange(updatedProject);
            }
        } catch (error: any) {
            console.error('Failed to remove collaborator:', error);
            setShareStatus({
                type: 'error',
                message: error?.message || 'Failed to remove collaborator. Please try again.',
            });
        } finally {
            setRemovingCollaboratorId(null);
        }
    };

    const handleSaveProjectMeta = async () => {
        const trimmedName = editName.trim();
        const trimmedDescription = editDescription.trim();
        if (!canEdit || !trimmedName || savingMeta) return;

        setSavingMeta(true);
        try {
            await storageService.updateResearchProject(currentProject.id, {
                name: trimmedName,
                description: trimmedDescription,
            });
            const updatedProject: ResearchProject = {
                ...currentProject,
                name: trimmedName,
                description: trimmedDescription,
            };
            handleProjectChange(updatedProject);
            setIsEditingMeta(false);
        } catch (err) {
            console.error('Failed to update project details:', err);
        } finally {
            setSavingMeta(false);
        }
    };

    const openAllSourcesModal = () => {
        const urlItems: SourceItem[] = [];
        const fileItems: SourceItem[] = [];
        const noteItems: SourceItem[] = [];

        researchSessions.forEach(session => {
            const report = session.researchReport;
            (report?.sources || []).forEach(src => {
                urlItems.push({
                    title: src.title,
                    url: src.url,
                    uri: src.uri,
                    snippet: src.snippet,
                });
            });
        });

        (currentProject.knowledgeBase || []).forEach(file => {
            fileItems.push({
                title: file.name,
                url: file.url,
                snippet: file.summary,
            });
        });

        notes.forEach(note => {
            noteItems.push({
                title: note.title,
                snippet: note.content,
            });
        });

        setSourcesModalTitle('All project sources');
        setSourcesModalMode('all_sources');
        setSourcesModalUrlItems(urlItems);
        setSourcesModalFileItems(fileItems);
        setSourcesModalNoteItems(noteItems);
        setShowSourcesModal(true);
    };

    const openSourcesModal = (
        title: string,
        sources: { title: string; uri: string; url?: string; snippet?: string }[]
    ) => {
        const items: SourceItem[] = sources.map(src => ({
            title: src.title,
            url: src.url,
            uri: src.uri,
            snippet: src.snippet,
        }));
        setSourcesModalTitle(title);
        setSourcesModalMode('urls_only');
        setSourcesModalUrlItems(items);
        setSourcesModalFileItems([]);
        setSourcesModalNoteItems([]);
        setShowSourcesModal(true);
    };

    const openLeadsModal = (title: string, wizaProspects: WizaProspectsResult | undefined | null) => {
        const profiles = Array.isArray(wizaProspects?.data?.profiles) ? wizaProspects?.data?.profiles : [];

        const items: LeadItem[] = profiles.map((p: any, idx: number) => {
            const id = String(p?.id || p?.linkedin_profile_url || p?.profile_url || p?.email || `${idx}`);
            const name = String(p?.full_name || p?.name || p?.fullName || p?.person_name || p?.contact_name || 'Prospect');
            const jobTitle = String(p?.title || p?.job_title || p?.jobTitle || p?.position || '').trim();
            const company = String(p?.company || p?.company_name || p?.job_company || p?.organization || '').trim();
            const location = String(p?.location || p?.company_location || p?.company_locality || '').trim();
            const email = String(p?.email || '').trim();
            const emailStatus = String(p?.email_status || p?.emailStatus || '').trim();
            const linkedinUrl = String(p?.linkedin_profile_url || p?.profile_url || p?.linkedin || '').trim();

            return {
                id,
                name,
                title: jobTitle || undefined,
                company: company || undefined,
                location: location || undefined,
                email: email || undefined,
                emailStatus: emailStatus || undefined,
                linkedinUrl: linkedinUrl || undefined,
                raw: p,
            };
        });

        setLeadsModalTitle(title);
        setLeadsModalItems(items);
        setExpandedLeadIds(new Set());
        setShowLeadsModal(true);
    };

    const generateSuggestions = async () => {
        if (!canEdit || loadingSuggestions) return;
        setLoadingSuggestions(true);
        try {
            const existingTopics = (currentProject.researchSessions || []).map(s => s.topic);
            const suggestions = await generateResearchSuggestions(
                currentProject.name,
                currentProject.description,
                existingTopics
            );
            setSuggestedTopics(suggestions);
            await storageService.updateResearchProject(currentProject.id, {
                suggestedTopics: suggestions,
            });
        } catch (err) {
            console.error('Failed to generate suggestions:', err);
        } finally {
            setLoadingSuggestions(false);
        }
    };

    const handleRunSeoAnalysis = async (keywordOverride?: string) => {
        const latestSession = (researchSessions || []).slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
        const baseKeyword = (keywordOverride ?? seoKeyword).trim() || currentProject.name || latestSession?.topic || '';
        if (!baseKeyword) return;

        setIsRunningSeo(true);
        setSeoError(null);
        setSeoAdvice(null);
        setSeoData(null);
        setSeoBlog(null);
        setSeoBlogError(null);
        setSeoBlogSaveMessage(null);

        try {
            const data = await fetchSeoKeywordData(baseKeyword, seoLocation || 'US', 'en', 15);
            setSeoData(data);

            const advice = await generateSeoInsightsFromData(currentProject, baseKeyword, seoLocation || 'US', data);
            const normalizedAdvice = advice && advice.trim().length > 0 ? advice : null;
            setSeoAdvice(normalizedAdvice);

            if (normalizedAdvice) {
                const now = Date.now();
                const existingInsights = currentProject.aiInsights || [];
                const newInsight: AIInsight = {
                    id: `seo-${now}-${Math.random().toString(36).slice(2, 8)}`,
                    type: 'summary',
                    content: normalizedAdvice,
                    actionable: true,
                    sourceData: {
                        kind: 'seo_insight',
                        keyword: baseKeyword,
                        location: seoLocation || 'US',
                        seoData: data,
                    },
                    createdAt: now,
                };

                const nextInsights = [...existingInsights, newInsight];

                const updatedProject: ResearchProject = {
                    ...currentProject,
                    aiInsights: nextInsights,
                    lastModified: now,
                };

                handleProjectChange(updatedProject);
                storageService.updateResearchProject(currentProject.id, {
                    aiInsights: nextInsights,
                }).catch((err) => {
                    // eslint-disable-next-line no-console
                    console.error('Failed to persist SEO insight to project context', err);
                });
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('SEO analysis failed', e);
            setSeoError(e?.message || 'SEO analysis failed');
        } finally {
            setIsRunningSeo(false);
        }
    };

    const handleRunSeoAnalysisWithResult = async (keywordOverride?: string, locationOverride?: string) => {
        const latestSession = (researchSessions || []).slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
        const baseKeyword = (keywordOverride ?? seoKeyword).trim() || currentProject.name || latestSession?.topic || '';
        const location = (locationOverride ?? (seoLocation || 'US')).trim() || 'US';
        if (!baseKeyword) {
            return {
                keyword: 'SEO',
                location,
                seoData: null,
                advice: null,
                error: 'Keyword is required for SEO analysis',
            };
        }

        setIsRunningSeo(true);
        setSeoError(null);
        setSeoAdvice(null);
        setSeoData(null);
        setSeoBlog(null);
        setSeoBlogError(null);
        setSeoBlogSaveMessage(null);

        try {
            const data = await fetchSeoKeywordData(baseKeyword, location, 'en', 15);
            setSeoData(data);

            const advice = await generateSeoInsightsFromData(currentProject, baseKeyword, location, data);
            const normalizedAdvice = advice && advice.trim().length > 0 ? advice : null;
            setSeoAdvice(normalizedAdvice);

            if (normalizedAdvice) {
                const now = Date.now();
                const existingInsights = currentProject.aiInsights || [];
                const newInsight: AIInsight = {
                    id: `seo-${now}-${Math.random().toString(36).slice(2, 8)}`,
                    type: 'summary',
                    content: normalizedAdvice,
                    actionable: true,
                    sourceData: {
                        kind: 'seo_insight',
                        keyword: baseKeyword,
                        location,
                        seoData: data,
                    },
                    createdAt: now,
                };

                const nextInsights = [...existingInsights, newInsight];

                const updatedProject: ResearchProject = {
                    ...currentProject,
                    aiInsights: nextInsights,
                    lastModified: now,
                };

                handleProjectChange(updatedProject);
                storageService.updateResearchProject(currentProject.id, {
                    aiInsights: nextInsights,
                }).catch((err) => {
                    console.error('Failed to persist SEO insight to project context', err);
                });
            }

            return {
                keyword: baseKeyword,
                location,
                seoData: data,
                advice: normalizedAdvice,
                error: null,
            };
        } catch (e: any) {
            console.error('SEO analysis failed', e);
            const error = e?.message || 'SEO analysis failed';
            setSeoError(error);
            return {
                keyword: baseKeyword,
                location,
                seoData: null,
                advice: null,
                error,
            };
        } finally {
            setIsRunningSeo(false);
        }
    };

    const runSeoAnalysisFromAssistant = async (params: { keyword?: string; location?: string }) => {
        const keyword = (params.keyword || '').trim();
        const location = (params.location || '').trim() || 'US';

        setActiveTab('seo');
        setSeoLocation(location);
        if (keyword) setSeoKeyword(keyword);

        return await handleRunSeoAnalysisWithResult(keyword || undefined, location);
    };

    React.useEffect(() => {
        if (activeTab !== 'seo') return;
        if (seoKeyword.trim()) return;
        const seeds = currentProject.seoSeedKeywords || [];
        if (seeds.length > 0) {
            setSeoKeyword(seeds[0]);
        }
    }, [activeTab, seoKeyword, currentProject.seoSeedKeywords]);

    const handleGenerateSeoBlog = async () => {
        if (!seoData && !seoAdvice) return;
        if (isGeneratingSeoBlog) return;

        const keyword = seoKeyword.trim() || currentProject.name || 'SEO blog';
        setIsGeneratingSeoBlog(true);
        setSeoBlogError(null);
        setSeoBlog(null);
        setSeoBlogSaveMessage(null);

        try {
            const parts: string[] = [];
            parts.push(`Primary keyword or theme: ${keyword}`);
            parts.push(`Location focus: ${seoLocation || 'US'}`);

            if (seoAdvice) {
                parts.push('\nSEO strategy notes:');
                parts.push(seoAdvice);
            }

            const localRows: any[] = seoData && Array.isArray(seoData.local) ? (seoData.local as any[]) : [];
            const topRows: any[] = seoData && Array.isArray(seoData.top) ? (seoData.top as any[]) : [];
            const keywordRows = (topRows.length > 0 ? topRows : localRows).slice(0, 6);

            if (keywordRows.length > 0) {
                parts.push('\nKey SEO opportunities (keyword, volume, competition):');
                keywordRows.forEach((row: any) => {
                    const text = row.text || row.keyword || keyword;
                    const vol = typeof row.volume === 'number' ? row.volume : row.volume ?? '-';
                    const compLevel = row.competition_level ?? '-';
                    const compIndex = row.competition_index ?? '-';
                    parts.push(`- ${text} (volume: ${vol}, competition: ${compLevel} / ${compIndex})`);
                });
            }

            const summary = parts.join('\n');

            const keyPoints = keywordRows.slice(0, 4).map((row: any) => {
                const text = row.text || row.keyword || keyword;
                const vol = typeof row.volume === 'number' ? row.volume : row.volume ?? '-';
                const compLevel = row.competition_level ?? '-';
                const trend = row.trend ?? '-';
                return {
                    title: text,
                    details: `Search volume: ${vol} | Competition: ${compLevel} | Trend: ${trend}`,
                    priority: 'medium',
                };
            });

            const blog = await generateStructuredBlogPost(keyword, summary, keyPoints);
            setSeoBlog(blog);

            const now = Date.now();
            const sessions = currentProject.researchSessions || [];
            const latest = sessions[sessions.length - 1];
            const latestReport = latest?.researchReport;

            if (latest && latestReport) {
                // Persist as a blog post attached to the latest research session so it
                // appears under Blogs in the Assets tab.
                const updatedSession: SavedResearch = {
                    ...latest,
                    researchReport: {
                        ...latestReport,
                        blogPost: blog,
                    },
                    lastModified: now,
                };

                const updatedSessions: SavedResearch[] = sessions.map((s) =>
                    s.id === latest.id ? updatedSession : s,
                );

                const updatedProject: ResearchProject = {
                    ...currentProject,
                    researchSessions: updatedSessions,
                    lastModified: now,
                };

                handleProjectChange(updatedProject);

                try {
                    await storageService.updateResearchInProject(currentProject.id, latest.id, {
                        researchReport: updatedSession.researchReport,
                        lastModified: updatedSession.lastModified,
                    });
                    setSeoBlogSaveMessage('Saved blog into latest research session');
                } catch (e: any) {
                    // eslint-disable-next-line no-console
                    console.error('Failed to save SEO blog into project research session:', e);
                    setSeoBlogSaveMessage('Failed to save to research session (still visible in this tab)');
                }
            } else {
                // Fallback: upload as a markdown KnowledgeBase file so it appears under
                // Blogs via the kbBlogs aggregator in the Assets tab.
                try {
                    const safeTitle = blog.title || keyword || 'seo-blog';
                    const slug = safeTitle
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-+|-+$/g, '') || 'seo-blog';
                    const fileName = `${slug}-${now}.md`;
                    const markdown = blog.content || '';

                    const blob = new Blob([markdown], { type: 'text/markdown' });
                    const file = new File([blob], fileName, { type: 'text/markdown' });

                    const kbFile = await storageService.uploadKnowledgeBaseFile(currentProject.id, file);
                    const existingKb = currentProject.knowledgeBase || [];
                    const updatedKnowledgeBase = [...existingKb, kbFile];

                    const updatedProject: ResearchProject = {
                        ...currentProject,
                        knowledgeBase: updatedKnowledgeBase,
                        lastModified: now,
                    };

                    handleProjectChange(updatedProject);
                    await storageService.updateResearchProject(currentProject.id, {
                        knowledgeBase: updatedKnowledgeBase,
                    });

                    setSeoBlogSaveMessage('Saved blog into project knowledge base');
                } catch (e: any) {
                    // eslint-disable-next-line no-console
                    console.error('Failed to save SEO blog into project knowledge base:', e);
                    setSeoBlogSaveMessage('Failed to save blog to assets (still visible in this tab)');
                }
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('SEO blog generation failed', e);
            setSeoBlogError(e?.message || 'SEO blog generation failed');
        } finally {
            setIsGeneratingSeoBlog(false);
        }
    };

    // Handler to create a table from SEO platform data and navigate to Assets > Tables
    const handleCreateTableFromSeo = (source: 'seo' | 'targeting' | 'x_tweets' | 'x_users' | 'instagram') => {
        const id = `table-seo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();

        let table: import('../types').TableAsset;

        switch (source) {
            case 'seo': {
                // Google SEO keyword data
                const relatedRows = seoData?.local || [];
                const columns = ['Keyword', 'Volume', 'Competition Level', 'Competition Index', 'Low Bid', 'High Bid', 'Trend'];
                const rows = relatedRows.slice(0, 50).map((row: any) => [
                    String(row.text || ''),
                    String(row.volume ?? ''),
                    String(row.competition_level || ''),
                    String(row.competition_index ?? ''),
                    String(row.low_bid ?? ''),
                    String(row.high_bid ?? ''),
                    String(row.trend ?? ''),
                ]);
                table = { id, title: `SEO Keywords: ${seoKeyword || 'Analysis'}`, columns, rows, createdAt: now };
                break;
            }
            case 'targeting': {
                // Facebook Ad Targeting results
                const columns = ['Name', 'Key/ID', 'Type', 'Audience Size'];
                const rows = targetingResults.slice(0, 50).map((result: any) => [
                    String(result.name || ''),
                    String(result.key || result.id || ''),
                    String(result.type || targetingSearchType || ''),
                    result.audience_size
                        ? String(result.audience_size)
                        : result.audience_size_lower_bound && result.audience_size_upper_bound
                            ? `${(result.audience_size_lower_bound / 1000000).toFixed(1)}M - ${(result.audience_size_upper_bound / 1000000).toFixed(1)}M`
                            : '',
                ]);
                table = { id, title: `Facebook Targeting: ${targetingQuery || targetingSearchType}`, columns, rows, createdAt: now };
                break;
            }
            case 'x_tweets': {
                // X/Twitter tweets
                const tweets = xSearchResults?.data || [];
                const users = xSearchResults?.includes?.users || [];
                const columns = ['Author', 'Username', 'Tweet', 'Date'];
                const rows = tweets.slice(0, 50).map((tweet: any) => {
                    const author = users.find((u: any) => u.id === tweet.author_id);
                    return [
                        String(author?.name || 'Unknown'),
                        String(author?.username ? `@${author.username}` : ''),
                        String(tweet.text || '').substring(0, 280),
                        tweet.created_at ? new Date(tweet.created_at).toLocaleDateString() : '',
                    ];
                });
                table = { id, title: `X Tweets: ${xSearchQuery || 'Search'}`, columns, rows, createdAt: now };
                break;
            }
            case 'x_users': {
                // X/Twitter users
                const users = xSearchResults?.data || [];
                const columns = ['Name', 'Username', 'Bio', 'Followers'];
                const rows = users.slice(0, 50).map((user: any) => [
                    String(user.name || ''),
                    String(user.username ? `@${user.username}` : ''),
                    String(user.description || '').substring(0, 200),
                    String(user.public_metrics?.followers_count?.toLocaleString() || ''),
                ]);
                table = { id, title: `X Users: ${xSearchQuery || 'Search'}`, columns, rows, createdAt: now };
                break;
            }
            case 'instagram': {
                // Instagram hashtag media
                const allMedia = [...(seoIgTopMedia || []), ...(seoIgRecentMedia || [])];
                const columns = ['Type', 'Caption', 'Likes', 'Comments', 'Link'];
                const rows = allMedia.slice(0, 50).map((m: any) => [
                    String(m.media_type || ''),
                    String(m.caption || '').substring(0, 200),
                    String(m.like_count ?? ''),
                    String(m.comments_count ?? ''),
                    String(m.permalink || ''),
                ]);
                table = { id, title: `Instagram: #${seoIgHashtagQuery || 'hashtag'}`, columns, rows, createdAt: now };
                break;
            }
            default:
                return;
        }

        setSeoTableToCreate(table);
        setAssetsInitialFilter(['tables']);
        setActiveTab('assets');
    };

    const handleTopicClick = async (topic: string) => {
        if (!canEdit) return;
        onStartResearch(topic);
        const updatedTopics = suggestedTopics.filter(t => t !== topic);
        setSuggestedTopics(updatedTopics);
        try {
            await storageService.updateResearchProject(currentProject.id, {
                suggestedTopics: updatedTopics,
            });
        } catch (err) {
            console.error('Failed to update suggested topics:', err);
        }
    };

    const handleDeleteResearch = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        if (!canEdit) return;
        if (!confirm('Are you sure you want to delete this research?')) return;
        try {
            await storageService.deleteResearchFromProject(currentProject.id, sessionId);
            const updated = {
                ...currentProject,
                researchSessions: currentProject.researchSessions.filter(s => s.id !== sessionId),
            };
            handleProjectChange(updated);
        } catch (err) {
            console.error('Failed to delete research:', err);
        }
    };

    const handleLocalPodcastAdd = (file: KnowledgeBaseFile) => {
        setLocalProjectPodcasts(prev => {
            if (prev.some(existing => existing.id === file.id)) {
                return prev;
            }
            return [file, ...prev];
        });
    };



    const handleReverifyProject = async () => {
        if (!canEdit || isReverifying) return;

        if (!researchSessions || researchSessions.length === 0) {
            alert("No research sessions found. Please run at least one research session before reverifying.");
            return;
        }

        setShowReverifyConfirm(true);
    };

    const processReverification = async () => {
        if (!canEdit || isReverifying) return;
        setIsReverifying(true);
        setShowReverifyConfirm(false);
        try {
            const results = await reverifyProjectResearch(currentProject);
            const byId = new Map<
                string,
                {
                    isStale: boolean;
                    updatedTldr?: string;
                    updatedSummary?: string;
                    staleReason?: string;
                    outdatedItems?: Array<{ claim: string; previous?: string; current?: string; evidenceUrl?: string }>;
                    refreshActions?: string[];
                    searchQueries?: string[];
                    urlsChecked?: string[];
                    error?: string;
                }
            >();
            results.forEach(r => {
                byId.set(r.sessionId, {
                    isStale: r.isStale,
                    updatedTldr: r.updatedTldr,
                    updatedSummary: r.updatedSummary,
                    staleReason: (r as any).staleReason,
                    outdatedItems: (r as any).outdatedItems,
                    refreshActions: (r as any).refreshActions,
                    searchQueries: (r as any).searchQueries,
                    urlsChecked: (r as any).urlsChecked,
                    error: (r as any).error,
                });
            });

            const now = Date.now();
            const updatedSessions = (currentProject.researchSessions || []).map(session => {
                const patch = byId.get(session.id);
                if (!patch) return session;

                const baseReport = session.researchReport;
                let newReport = baseReport;
                let changed = false;

                if (baseReport && (patch.updatedTldr || patch.updatedSummary)) {
                    newReport = { ...baseReport };
                    if (patch.updatedTldr) newReport.tldr = patch.updatedTldr;
                    if (patch.updatedSummary) newReport.summary = patch.updatedSummary;
                    changed = true;
                }

                const prevStale = Boolean((session as any).isStale);
                if (patch.isStale !== prevStale) {
                    changed = true;
                }

                if (!changed) {
                    return session;
                }

                return {
                    ...session,
                    researchReport: newReport,
                    isStale: patch.isStale,
                    lastModified: now,
                };
            });

            // Collect unique research draft topics from stale sessions' searchQueries
            const existingDrafts = new Set(
                (currentProject.draftResearchSessions || []).map(d => d.topic.toLowerCase().trim())
            );
            const existingTopics = new Set(
                (currentProject.researchSessions || []).map(s => s.topic.toLowerCase().trim())
            );

            const newDrafts: Array<{ id: string; topic: string; createdAt: number }> = [];
            results.forEach(r => {
                if (r.isStale && (r as any).searchQueries?.length) {
                    ((r as any).searchQueries as string[]).forEach(query => {
                        const normalized = query.toLowerCase().trim();
                        // Skip if already exists as draft, existing session, or already added
                        if (
                            !existingDrafts.has(normalized) &&
                            !existingTopics.has(normalized) &&
                            !newDrafts.some(d => d.topic.toLowerCase().trim() === normalized) &&
                            query.trim().length > 5 // Skip very short queries
                        ) {
                            newDrafts.push({
                                id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                                topic: query.trim(),
                                createdAt: Date.now(),
                            });
                        }
                    });
                }
            });

            const updatedProject: ResearchProject = {
                ...currentProject,
                researchSessions: updatedSessions,
                draftResearchSessions: [
                    ...(currentProject.draftResearchSessions || []),
                    ...newDrafts,
                ],
                lastModified: now,
            };

            await storageService.updateResearchProject(updatedProject.id, {
                researchSessions: updatedSessions,
                draftResearchSessions: updatedProject.draftResearchSessions,
                lastModified: updatedProject.lastModified,
            });

            handleProjectChange(updatedProject);

            const totalChecked = results.length;
            const numStale = results.filter(r => r.isStale).length;
            const numFresh = results.filter(r => !r.isStale).length;
            const numUpdated = results.filter(r => r.updatedTldr || r.updatedSummary).length;
            const numErrors = results.filter(r => (r as any).error).length;

            const summaryLines: string[] = [];
            if (results.length === 0) {
                summaryLines.push(
                    'We asked Gemini to recheck your research, but it did not return any specific updates this time.',
                    'Your sessions remain as-is—try rerunning in a minute if you were expecting changes.',
                );
            } else {
                if (numUpdated > 0) {
                    summaryLines.push(
                        `${numUpdated} research session${numUpdated === 1 ? '' : 's'} had their TL;DR or summary refreshed with newer information.`,
                    );
                }
                if (numStale > 0) {
                    summaryLines.push(
                        `${numStale} session${numStale === 1 ? '' : 's'} are now marked as stale because key facts or numbers changed.`,
                    );
                }
                if (newDrafts.length > 0) {
                    summaryLines.push(
                        `📝 ${newDrafts.length} new research draft${newDrafts.length === 1 ? '' : 's'} created from suggested topics to explore.`,
                    );
                }
                if (numFresh > 0) {
                    summaryLines.push(
                        `${numFresh} session${numFresh === 1 ? '' : 's'} are still up to date and were left unchanged.`,
                    );
                }
                if (numErrors > 0) {
                    summaryLines.push(
                        `${numErrors} session${numErrors === 1 ? '' : 's'} could not be verified (tool or parsing error).`,
                    );
                }
            }

            const topicById = new Map<string, string>();
            (currentProject.researchSessions || []).forEach(session => {
                topicById.set(session.id, session.topic);
            });

            const detailedLines: string[] = [];
            results.slice(0, 8).forEach(r => {
                const topic = topicById.get(r.sessionId) || 'Untitled session';
                const meta = byId.get(r.sessionId);
                if (meta?.error) {
                    detailedLines.push(`- ${topic} (could not verify)`);
                    return;
                }

                const flags: string[] = [];
                if (r.isStale) flags.push('stale');
                if (r.updatedTldr || r.updatedSummary) flags.push('updated');
                if (!flags.length) flags.push('checked');

                const reason = meta?.staleReason ? ` — ${meta.staleReason}` : '';
                detailedLines.push(`- ${topic} (${flags.join(', ')})${reason}`);
                if (meta?.outdatedItems?.length) {
                    detailedLines.push(`  - Outdated items: ${meta.outdatedItems.length}`);
                }
                if (meta?.refreshActions?.length) {
                    detailedLines.push(`  - Next: ${meta.refreshActions[0]}`);
                }
            });

            const lines = detailedLines.length
                ? [...summaryLines, '', ...detailedLines]
                : summaryLines;

            setReverifySummary({
                totalChecked: totalChecked || (currentProject.researchSessions?.length || 0),
                numUpdated,
                numStale,
                numFresh,
                lines: lines.length ? lines : ['Reverification completed, but no additional details were provided.'],
            });
            setShowReverifySummary(true);
        } catch (err) {
            console.error('Failed to reverify project research:', err);
            setReverifySummary({
                totalChecked: 0,
                numUpdated: 0,
                numStale: 0,
                numFresh: 0,
                lines: [
                    'We could not reverify this project right now.',
                    err instanceof Error ? err.message : 'Unknown error occurred.',
                ],
            });
            setShowReverifySummary(true);
        } finally {
            setIsReverifying(false);
        }
    };

    useEffect(() => {
        // On every project open, regenerate research suggestions so they stay
        // up to date with the latest project context.
        generateSuggestions();
    }, []);

    useEffect(() => {
        setCurrentProject(project);
        setLocalProjectPodcasts([]);
        setEditName(project.name);
        setEditDescription(project.description || '');
        setIsEditingMeta(false);
        setSavingMeta(false);
    }, [project]);

    useEffect(() => {
        currentProjectRef.current = currentProject;
    }, [currentProject]);

    useEffect(() => {
        setLocalProjectPodcasts(prev => prev.filter(file =>
            !(currentProject.knowledgeBase || []).some(kb => kb.id === file.id)
        ));
    }, [currentProject.knowledgeBase]);

    // DISABLED: Auto-start draft research (causes unwanted credit deductions)
    // Users should manually click draft cards to execute them
    /*
    useEffect(() => {
      const drafts = currentProject.draftResearchSessions || [];
      if (!drafts.length) return;
      if (autoDraftStartedRef.current) return;
      if (currentProject.activeResearchStatus === 'in_progress') return;
      if ((currentProject.researchSessions || []).length > 0) return;
     
      const draft = drafts[0];
      autoDraftStartedRef.current = true;
     
      const remainingDrafts = drafts.slice(1);
      const updatedProject: ResearchProject = {
        ...currentProject,
        draftResearchSessions: remainingDrafts,
        lastModified: Date.now(),
      };
      handleProjectChange(updatedProject);
     
      storageService
        .updateResearchProject(currentProject.id, {
          draftResearchSessions: remainingDrafts,
        })
        .catch(e => {
          console.error('Failed to update draft research sessions for auto-start:', e);
        });
     
      onStartResearch(draft.topic, { background: true });
    }, [
      currentProject.id,
      currentProject.draftResearchSessions,
      currentProject.activeResearchStatus,
      currentProject.researchSessions,
    ]);
    */

    const handleDraftClick = async (draft: ResearchDraft) => {
        const existingDrafts = currentProject.draftResearchSessions || [];
        const remainingDrafts = existingDrafts.filter(d => d.id !== draft.id);

        const updatedProject: ResearchProject = {
            ...currentProject,
            draftResearchSessions: remainingDrafts,
            lastModified: Date.now(),
        };

        handleProjectChange(updatedProject);

        try {
            await storageService.updateResearchProject(currentProject.id, {
                draftResearchSessions: remainingDrafts,
            });
        } catch (e) {
            console.error('Failed to update draft research sessions:', e);
        }

        onStartResearch(draft.topic);
    };

    /* Draft Research Topics Section (rendered in multiple places) */
    const draftsSection = draftResearchSessions.length > 0 ? (
        <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
                <span className={"text-xs font-medium uppercase tracking-wider " + (
                    activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-500' : currentTheme.textSecondary
                )}>
                    Draft research topics
                </span>
                <span className={"text-xs px-2 py-0.5 rounded-full " + (
                    activeTheme === 'dark' ? 'bg-[#111111] text-[#e5e5ea]' : activeTheme === 'light' ? 'bg-gray-100 text-gray-700' : `${currentTheme.bgSecondary} ${currentTheme.text}`
                )}>
                    {draftResearchSessions.length}
                </span>
            </div>
            <div className="space-y-3">
                {draftResearchSessions.map(draft => (
                    <div
                        key={draft.id}
                        role="button"
                        onClick={() => handleDraftClick(draft)}
                        className={`group border hover:border-[#0071e3]/50 rounded-xl sm:rounded-2xl p-4 sm:p-5 cursor-pointer transition-all duration-200 relative overflow-hidden ${activeTheme === 'dark'
                            ? 'bg-[#1d1d1f] border-[#3d3d3f]/50'
                            : activeTheme === 'light'
                                ? 'bg-white border-gray-200'
                                : `${currentTheme.cardBg} border ${currentTheme.border}`
                            }`}
                    >
                        <div className="absolute inset-0 z-0 pointer-events-none">
                            <div
                                className="absolute inset-y-0 right-0 w-2/3 bg-gradient-to-l from-[#0071e3]/40 via-transparent to-transparent opacity-20 group-hover:opacity-30 transition-opacity"
                            />
                        </div>
                        <div className="relative z-10 flex justify-between items-start">
                            <div className="flex-1 pr-4 min-w-0">
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-[#0071e3]/20 text-[#0071e3]">
                                        Draft
                                    </span>
                                    <span className={`text-xs ${activeTheme === 'dark' ? 'text-[#636366]' : activeTheme === 'light' ? 'text-gray-500' : currentTheme.textSecondary
                                        }`}>
                                        {new Date(draft.createdAt).toLocaleDateString()}
                                    </span>
                                </div>
                                <h3
                                    className={`font-semibold text-base sm:text-lg mb-1 truncate group-hover:text-[#0071e3] transition-colors ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text
                                        }`}
                                >
                                    {draft.topic}
                                </h3>
                                <p className={`text-sm line-clamp-2 ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-600' : currentTheme.textSecondary
                                    }`}>
                                    AI-created draft topic. Click to run a full deep research session and generate sources, notes, and assets.
                                </p>
                            </div>
                            <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-[#0071e3]/10 text-[#0071e3] text-xs font-semibold">
                                DR
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    ) : null;

    return (
        <div
            className={`relative min-h-screen h-screen overflow-y-auto ${activeTheme === 'dark'
                ? 'bg-[#000000] text-white'
                : activeTheme === 'light'
                    ? 'bg-gray-50 text-gray-900'
                    : `${currentTheme.bg} ${currentTheme.text}`
                }`}
            onDragEnter={handleGlobalDragEnter}
            onDragLeave={handleGlobalDragLeave}
            onDragOver={handleGlobalDragOver}
            onDrop={handleGlobalDrop}
        >
            {/* Top Hover Game Center Trigger */}
            <div className="fixed top-0 left-0 right-0 h-4 z-[99] group/trigger flex justify-center pointer-events-none">
                <div className="pointer-events-auto h-full w-64" /> {/* Hover zone */}
                <button
                    onClick={() => setShowGameCenter(true)}
                    className={`absolute top-0 left-1/2 -translate-x-1/2 pointer-events-auto transform -translate-y-full group-hover/trigger:translate-y-0 transition-transform duration-500 ease-out bg-[#f2f2f7] border border-[#d1d1d6] border-t-0 px-6 py-2.5 rounded-b-3xl shadow-2xl flex items-center gap-3 z-[100] ${activeTheme === 'orange' ? 'shadow-orange-500/40' :
                        activeTheme === 'green' ? 'shadow-emerald-500/40' :
                            activeTheme === 'blue' ? 'shadow-sky-500/40' :
                                activeTheme === 'purple' ? 'shadow-violet-500/40' :
                                    activeTheme === 'khaki' ? 'shadow-amber-500/40' :
                                        activeTheme === 'pink' ? 'shadow-pink-500/40' :
                                            'shadow-[#0071e3]/40'
                        }`}
                    title="Open Game Center"
                >
                    <span className="text-2xl hover:scale-125 transition-transform duration-300">🎮</span>
                    <span className="text-[11px] font-black text-[#000000] uppercase tracking-[0.3em] opacity-0 group-hover/trigger:opacity-100 transition-opacity delay-200">Arcade</span>
                </button>
            </div>

            {/* Global drag overlay */}
            {globalDragging && (
                <div className="fixed inset-0 z-50 bg-[#0071e3]/20 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                    <div className={`p-8 rounded-2xl border-2 border-dashed border-[#0071e3] ${activeTheme === 'dark' ? 'bg-[#1c1c1e]/90' : activeTheme === 'light' ? 'bg-white/90' : `${currentTheme.cardBg}/90`
                        }`}>
                        <div className="flex flex-col items-center gap-3">
                            <svg className="w-12 h-12 text-[#0071e3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                            <span className={`text-lg font-medium ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text
                                }`}>Drop files to upload</span>
                            <span className={`text-sm ${activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-500' : currentTheme.textSecondary
                                }`}>Files will be added to your project data</span>
                        </div>
                    </div>
                </div>
            )}
            {/* Global upload progress indicator */}
            {globalUploading && globalUploadProgress && (
                <div className="fixed top-4 right-4 z-50">
                    <div className={`px-4 py-3 rounded-xl shadow-lg ${activeTheme === 'dark'
                        ? 'bg-[#1c1c1e] border border-[#3a3a3c]'
                        : activeTheme === 'light'
                            ? 'bg-white border border-gray-200'
                            : `${currentTheme.cardBg} border ${currentTheme.border}`
                        }`}>
                        <div className="flex items-center gap-3">
                            <div className="w-5 h-5 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin" />
                            <span className={`text-sm ${activeTheme === 'dark' ? 'text-white' : activeTheme === 'light' ? 'text-gray-900' : currentTheme.text
                                }`}>{globalUploadProgress}</span>
                        </div>
                    </div>
                </div>
            )}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-32 sm:py-6">
                <header className="mb-6">
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <button
                            onClick={onBack}
                            className={`flex items-center gap-2 transition-colors text-sm font-medium ${activeTheme === 'dark' ? 'text-[#0071e3] hover:text-[#0077ed]' : activeTheme === 'light' ? 'text-[#0071e3] hover:text-[#0077ed]' : `${currentTheme.accent} hover:${currentTheme.text}`
                                }`}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                            </svg>
                            Projects
                        </button>

                        <div className="flex items-center gap-3 sm:gap-4 overflow-x-auto pb-1 sm:pb-0">
                            <CreditBalanceDisplay
                                credits={currentCredits}
                                onClick={() => setShowCreditInfo(true)}
                                isDarkMode={isDarkMode}
                            />
                            <div className={"hidden sm:block w-px h-6 sm:h-8 flex-shrink-0 " + (
                                activeTheme === 'dark' ? 'bg-[#3d3d3f]' : activeTheme === 'light' ? 'bg-gray-200' : currentTheme.border
                            )} />
                            <button
                                type="button"
                                onClick={openAllSourcesModal}
                                disabled={totalSources === 0}
                                className={"hidden sm:flex items-center gap-2 flex-shrink-0 rounded-full px-2 py-1 text-left " +
                                    (totalSources === 0
                                        ? 'opacity-50 cursor-default'
                                        : (activeTheme === 'dark' ? 'hover:bg-white/5 cursor-pointer' : activeTheme === 'light' ? 'hover:bg-white cursor-pointer' : `hover:${currentTheme.hoverBg} cursor-pointer`))}
                            >
                                <span className="text-xl sm:text-2xl font-semibold text-[#30d158]">{totalSources}</span>
                                <span className={"text-[10px] sm:text-xs uppercase " + (
                                    activeTheme === 'dark' ? 'text-[#86868b]' : activeTheme === 'light' ? 'text-gray-500' : currentTheme.textSecondary
                                )}>Sources</span>
                            </button>
                            <div className={"hidden sm:block w-px h-6 sm:h-8 flex-shrink-0 " + (
                                activeTheme === 'dark' ? 'bg-[#3d3d3f]' : activeTheme === 'light' ? 'bg-gray-200' : currentTheme.border
                            )} />
                            {project.deployConfig?.vercelPreviewUrl && (
                                <div className="hidden sm:flex items-center">
                                    <a
                                        href={project.deployConfig.vercelPreviewUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 py-1.5 px-3 mr-2 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                        View Site
                                    </a>
                                </div>
                            )}
                            {confidenceScore && (
                                <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full flex-shrink-0 ${confidenceScore.level === 'high' ? 'bg-[#30d158]/20 text-[#30d158]' :
                                    confidenceScore.level === 'medium' ? 'bg-[#ff9f0a]/20 text-[#ff9f0a]' :
                                        'bg-[#ff453a]/20 text-[#ff453a]'
                                    }`}>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                    </svg>
                                    <span className="text-xs font-medium uppercase">
                                        {confidenceScore.level} ({confidenceScore.score}%)
                                    </span>
                                </div>
                            )}
                            {onOpenAgentDeploy && (
                                <>
                                    <div className={"w-px h-6 sm:h-8 flex-shrink-0 " + (
                                        activeTheme === 'dark' ? 'bg-[#3d3d3f]' : activeTheme === 'light' ? 'bg-gray-200' : currentTheme.border
                                    )} />
                                    <button
                                        onClick={() => onOpenAgentDeploy(project)}
                                        className={
                                            "flex items-center justify-center sm:justify-start gap-0 sm:gap-2 px-2.5 sm:px-4 py-2.5 rounded-full text-sm font-medium border transition-all cursor-pointer " +
                                            (isDarkMode
                                                ? 'bg-[#1d1d1f] border-[#3d3d3f]/80 text-[#e5e5ea] hover:bg-[#2d2d2f]'
                                                : 'bg-white border-gray-200 text-gray-900 hover:bg-gray-50')
                                        }
                                        title="Open AI Canvas"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 9h16M9 20V9" />
                                        </svg>
                                        <span className="hidden sm:inline">Canvas</span>
                                    </button>
                                </>
                            )}
                            <div className={"w-px h-6 sm:h-8 flex-shrink-0 " + (
                                activeTheme === 'dark' ? 'bg-[#3d3d3f]' : activeTheme === 'light' ? 'bg-gray-200' : currentTheme.border
                            )} />
                            <button
                                onClick={() => setShowReverifyConfirm(true)}
                                disabled={!canEdit || isReverifying || researchSessions.length === 0}
                                className={
                                    "flex items-center justify-center sm:justify-start gap-0 sm:gap-2 px-2.5 sm:px-4 py-2.5 rounded-full text-sm font-medium border transition-all " +
                                    (canEdit
                                        ? (isDarkMode
                                            ? 'bg-[#1d1d1f] border-[#3d3d3f]/80 text-[#e5e5ea] hover:bg-[#2d2d2f]'
                                            : 'bg-white border-gray-200 text-gray-900 hover:bg-gray-50')
                                        : (isDarkMode
                                            ? 'bg-[#1d1d1f] border-[#3d3d3f]/40 text-[#636366] cursor-not-allowed opacity-70'
                                            : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed opacity-70'))
                                }
                                title="Reverify this project's research against the latest web data"
                                aria-label="Reverify project research"
                            >
                                <svg
                                    className={"w-4 h-4 " + (isReverifying ? 'animate-spin' : '')}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="2"
                                        d="M4 4v5h4M20 20v-5h-4M5 19a7 7 0 0012-5M19 5a7 7 0 00-12 5"
                                    />
                                </svg>
                                <span className="hidden sm:inline">{isReverifying ? 'Reverifying…' : 'Reverify'}</span>
                            </button>
                            {/* Presence Avatars */}
                            {onlineCollaborators.length > 0 && (
                                <>
                                    <div className={"w-px h-6 sm:h-8 flex-shrink-0 " + (
                                        activeTheme === 'dark' ? 'bg-[#3d3d3f]' : activeTheme === 'light' ? 'bg-gray-200' : currentTheme.border
                                    )} />
                                    <PresenceAvatars
                                        users={onlineCollaborators}
                                        isDarkMode={isDarkMode}
                                    />
                                </>
                            )}
                            <div className={"w-px h-6 sm:h-8 flex-shrink-0 " + (
                                activeTheme === 'dark' ? 'bg-[#3d3d3f]' : activeTheme === 'light' ? 'bg-gray-200' : currentTheme.border
                            )} />
                            <button
                                onClick={toggleTheme}
                                className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full transition-all flex-shrink-0 ${activeTheme === 'dark'
                                    ? 'bg-white/10 hover:bg-white/20 text-white'
                                    : activeTheme === 'light'
                                        ? 'bg-black/5 hover:bg-black/10 text-gray-900'
                                        : `${currentTheme.bgSecondary} ${currentTheme.hoverBg} ${currentTheme.text} border ${currentTheme.border}`
                                    }`}
                                title={`Switch to next theme`}
                            >
                                {currentTheme.nextEmoji}
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
                        <div className="flex-1 min-w-0">
                            {isEditingMeta ? (
                                <>
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        className={"w-full rounded-xl px-3 py-2 text-lg sm:text-2xl lg:text-3xl font-semibold tracking-tight focus:outline-none focus:ring-2 border " + (
                                            activeTheme === 'dark'
                                                ? 'focus:ring-[#0071e3]/60 bg-[#111111] border-[#3a3a3c] text-white placeholder-[#636366]'
                                                : activeTheme === 'light'
                                                    ? 'focus:ring-[#0071e3]/60 bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                                    : `${currentTheme.ring}/60 ${currentTheme.bgSecondary} border ${currentTheme.border} ${currentTheme.text} placeholder-gray-400`
                                        )}
                                        placeholder="Project title"
                                    />
                                    <textarea
                                        value={editDescription}
                                        onChange={(e) => setEditDescription(e.target.value)}
                                        rows={2}
                                        className={"mt-3 w-full rounded-xl px-3 py-2 text-sm sm:text-base resize-none focus:outline-none focus:ring-2 border " + (
                                            activeTheme === 'dark'
                                                ? 'focus:ring-[#0071e3]/60 bg-[#111111] border-[#3a3a3c] text-[#e5e5ea] placeholder-[#636366]'
                                                : activeTheme === 'light'
                                                    ? 'focus:ring-[#0071e3]/60 bg-white border-gray-300 text-gray-700 placeholder-gray-400'
                                                    : `${currentTheme.ring}/60 ${currentTheme.bgSecondary} border ${currentTheme.border} ${currentTheme.text} placeholder-gray-400`
                                        )}
                                        placeholder="Add a short description for this project"
                                    />
                                    <div className="mt-3 flex items-center gap-2">
                                        <button
                                            onClick={handleSaveProjectMeta}
                                            disabled={savingMeta || !editName.trim()}
                                            className={`inline-flex items-center justify-center px-4 py-2 rounded-full text-sm font-medium text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] ${activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3] hover:bg-[#0077ed]' : `${currentTheme.primary} ${currentTheme.primaryHover}`
                                                }`}
                                        >
                                            {savingMeta ? 'Saving…' : 'Save'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsEditingMeta(false);
                                                setEditName(currentProject.name);
                                                setEditDescription(currentProject.description || '');
                                            }}
                                            className={"px-3 py-2 rounded-full text-sm font-medium border transition-colors " + (
                                                activeTheme === 'dark'
                                                    ? 'border-[#3a3a3c] text-[#86868b] hover:text-white hover:border-[#636366] hover:bg-white/5'
                                                    : activeTheme === 'light'
                                                        ? 'border-gray-300 text-gray-600 hover:text-gray-900 hover:border-gray-400 hover:bg-gray-100'
                                                        : `${currentTheme.border} ${currentTheme.textSecondary} ${currentTheme.hoverBg} hover:${currentTheme.text}`
                                            )}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="flex items-start gap-2">
                                        <h1 className={`text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight truncate ${activeTheme === 'dark'
                                            ? 'text-white'
                                            : activeTheme === 'light'
                                                ? 'text-gray-900'
                                                : currentTheme.text
                                            }`}>
                                            {currentProject.name}
                                        </h1>
                                        {canEdit && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setIsEditingMeta(true);
                                                    setEditName(currentProject.name);
                                                    setEditDescription(currentProject.description || '');
                                                }}
                                                className={`mt-1 p-1.5 rounded-full text-xs border transition-colors flex-shrink-0 ${activeTheme === 'dark'
                                                    ? 'border-[#3a3a3c] text-[#86868b] hover:text-white hover:bg-white/5'
                                                    : activeTheme === 'light'
                                                        ? 'border-gray-300 text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                                                        : `${currentTheme.border} ${currentTheme.textSecondary} ${currentTheme.hoverBg}`
                                                    }`}
                                                title="Edit project details"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M4 20h4l9.268-9.268a2 2 0 00-2.828-2.828L5.172 17.172A4 4 0 004 20z" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                    <p className={`mt-2 text-sm sm:text-base line-clamp-2 ${activeTheme === 'dark'
                                        ? 'text-[#86868b]'
                                        : activeTheme === 'light'
                                            ? 'text-gray-600'
                                            : currentTheme.textSecondary
                                        }`}>
                                        {currentProject.description || 'No description'}
                                    </p>

                                    {aiSummary && showSuggestions && (
                                        <div className={"mt-4 flex items-start gap-3 p-4 rounded-2xl border " + (
                                            activeTheme === 'dark'
                                                ? 'bg-[#5e5ce6]/10 border-[#5e5ce6]/20'
                                                : activeTheme === 'light'
                                                    ? 'bg-indigo-50 border-indigo-200'
                                                    : `${currentTheme.bgSecondary} ${currentTheme.border}`
                                        )}>
                                            <svg className="w-5 h-5 text-[#5e5ce6] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                            </svg>
                                            <p className={"text-sm " + (
                                                activeTheme === 'dark' ? 'text-[#a5a5ff]' : activeTheme === 'light' ? 'text-indigo-700' : currentTheme.text
                                            )}>{aiSummary}</p>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                        <div className="relative flex items-center gap-2 sm:gap-3 flex-shrink-0">
                            {isOwner && (
                                <button
                                    onClick={() => {
                                        resetShareFeedback();
                                        setShowShareModal(true);
                                    }}
                                    className={"flex items-center gap-2 px-3 sm:px-4 py-2.5 rounded-full font-medium transition-all text-sm border " + (isDarkMode ? 'border-[#3d3d3f] text-[#f2f2f7] hover:bg-white/5' : 'border-gray-200 text-gray-800 hover:bg-gray-100')}
                                    title="Share project"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h10M7 12h4m-4 5h7" />
                                    </svg>
                                    <span>Share</span>
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    if (!canEdit) return;
                                    const nextState = !showSuggestions;
                                    setShowSuggestions(nextState);
                                    if (nextState) {
                                        generateSuggestions();
                                    }
                                }}
                                disabled={!canEdit}
                                className={
                                    "flex items-center gap-2 px-3 sm:px-4 py-2.5 rounded-full font-medium transition-all text-sm " +
                                    (canEdit
                                        ? (showSuggestions
                                            ? 'bg-[#5e5ce6] text-white'
                                            : (isDarkMode
                                                ? 'bg-[#2d2d2f] hover:bg-[#3d3d3f] text-[#86868b] hover:text-white'
                                                : 'bg-gray-200 hover:bg-gray-300 text-gray-600 hover:text-gray-900'))
                                        : (isDarkMode
                                            ? 'bg-[#2d2d2f] text-[#5e5ce6]/60 cursor-not-allowed opacity-70'
                                            : 'bg-gray-200 text-gray-400 cursor-not-allowed opacity-70'))
                                }
                                title={canEdit ? 'AI Research Suggestions' : 'View-only collaborators cannot use AI suggestions'}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                                <span>Suggestions</span>
                            </button>

                            <button
                                onClick={() => {
                                    if (!canEdit) return;
                                    setShowNewMenu((open) => !open);
                                }}
                                disabled={!canEdit}
                                className={"flex items-center gap-2 px-3 sm:px-5 py-2.5 rounded-full font-medium transition-all text-sm active:scale-[0.98] " + (canEdit ? (activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3] hover:bg-[#0077ed] text-white' : `${currentTheme.primary} ${currentTheme.primaryHover} text-white`) : 'bg-gray-400 text-white cursor-not-allowed opacity-70')}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                                </svg>
                                <span className="hidden sm:inline">{canEdit ? 'New' : 'Read Only'}</span>
                                <span className="sm:hidden">{canEdit ? 'New' : 'View'}</span>
                            </button>

                            {showNewMenu && canEdit && (
                                <div className="absolute right-0 top-full mt-2 z-50">
                                    <div
                                        className={
                                            "min-w-[190px] rounded-2xl border shadow-lg backdrop-blur-xl " +
                                            (activeTheme === 'dark'
                                                ? "bg-[#16161a]/90 border-[#3d3d3f]/80 text-[#f2f2f7]"
                                                : activeTheme === 'light'
                                                    ? "bg-white/90 border-gray-200 text-gray-900"
                                                    : `${currentTheme.cardBg} ${currentTheme.border} ${currentTheme.text}`)
                                        }
                                    >
                                        <div className="py-1.5">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    onStartResearch();
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className={`w-5 h-5 rounded-full flex items-center justify-center ${activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3]/10 text-[#0a84ff]' : `${currentTheme.primary.replace('bg-', 'bg-')}/10 ${currentTheme.accent}`}`}>
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V6m0 12v-2" />
                                                    </svg>
                                                </span>
                                                <span>Research</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    setNotesAutoNew(true);
                                                    setActiveTab('notes');
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                                                    </svg>
                                                </span>
                                                <span>Note</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    setActiveTab('tasks');
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                                    </svg>
                                                </span>
                                                <span>Task</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    setCurrentAssetsFilter(['images']);
                                                    setActiveTab('assets');
                                                    setAssetsInitialFocus('image');
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-fuchsia-500/10 flex items-center justify-center text-fuchsia-400">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.5-6 4 5 4.5-7L20 9" />
                                                    </svg>
                                                </span>
                                                <span>Image</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    setCurrentAssetsFilter(['podcasts']);
                                                    setActiveTab('assets');
                                                    setAssetsInitialFocus('podcast');
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                                    </svg>
                                                </span>
                                                <span>Podcast</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    setCurrentAssetsFilter(['videos']);
                                                    setActiveTab('assets');
                                                    setAssetsInitialFocus('video');
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                    </svg>
                                                </span>
                                                <span>Video</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    setCurrentAssetsFilter(['blogs']);
                                                    setActiveTab('assets');
                                                    setAssetsInitialFocus('blog');
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-400">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10l4 4v10a2 2 0 01-2 2z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 3v5h5M7 8h3m-3 4h10m-10 4h10" />
                                                    </svg>
                                                </span>
                                                <span>Blog</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    setCurrentAssetsFilter(['tables']);
                                                    setActiveTab('assets');
                                                    setAssetsInitialFocus('table');
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                    </svg>
                                                </span>
                                                <span>Table</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    setCurrentAssetsFilter(['forms']);
                                                    setActiveTab('assets');
                                                    setAssetsInitialFocus('form');
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-400">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                    </svg>
                                                </span>
                                                <span>Form</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    setCurrentAssetsFilter(['products']);
                                                    setActiveTab('assets');
                                                    setAssetsInitialFocus('product');
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                                                    </svg>
                                                </span>
                                                <span>Product</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    setCurrentAssetsFilter(['books']);
                                                    setActiveTab('assets');
                                                    setAssetsInitialFocus('book');
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                                    </svg>
                                                </span>
                                                <span>PDF</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    setActiveTab('email');
                                                    setEmailInitialFocus(true);
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                                    </svg>
                                                </span>
                                                <span>Email</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowNewMenu(false);
                                                    setCurrentAssetsFilter(['worlds']);
                                                    setActiveTab('assets');
                                                    setAssetsInitialFocus('world');
                                                }}
                                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${activeTheme === 'dark'
                                                    ? 'hover:bg-white/10 hover:text-white'
                                                    : activeTheme === 'light'
                                                        ? 'hover:bg-gray-100 hover:text-gray-900'
                                                        : `${currentTheme.hoverBg} hover:${currentTheme.text}`
                                                    }`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-500">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                                                    </svg>
                                                </span>
                                                <span>World</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Expandable Research Suggestions Grid */}
                    {
                        showSuggestions && (
                            <div
                                className={
                                    "mt-4 pb-2 overflow-hidden transition-all duration-300 " +
                                    (showSuggestions
                                        ? 'max-h-[800px] sm:max-h-[380px] opacity-100'
                                        : 'max-h-0 opacity-0')
                                }
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <span className={"text-xs font-medium uppercase tracking-wider " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>Research Suggestions</span>
                                    <button
                                        onClick={generateSuggestions}
                                        disabled={loadingSuggestions}
                                        className="text-xs text-[#0071e3] hover:text-[#0077ed] transition-colors flex items-center gap-1 disabled:opacity-50"
                                    >
                                        <svg className={`w-3 h-3 ${loadingSuggestions ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                        Refresh
                                    </button>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                                    {loadingSuggestions && suggestedTopics.length === 0 ? (
                                        [1, 2, 3, 4, 5, 6].map(i => (
                                            <div key={i} className={"rounded-2xl p-4 animate-pulse " + (isDarkMode ? 'bg-[#1d1d1f]' : 'bg-white border border-gray-200 shadow-sm')}>
                                                <div className={"h-4 mb-2 rounded w-3/4 " + (isDarkMode ? 'bg-[#3d3d3f]' : 'bg-gray-200')}></div>
                                                <div className={"h-3 rounded w-full " + (isDarkMode ? 'bg-[#3d3d3f]' : 'bg-gray-100')}></div>
                                            </div>
                                        ))
                                    ) : (
                                        suggestedTopics.map((topic, index) => {
                                            const accentIndex = index % 4;
                                            // Use theme primary for first color when in pastel theme
                                            const themeAwarePrimary = activeTheme !== 'dark' && activeTheme !== 'light' && currentTheme ? currentTheme.primary.replace('bg-', '') : '#0071e3';
                                            const lightBg = activeTheme !== 'dark' && activeTheme !== 'light' && currentTheme
                                                ? [`${currentTheme.primary}/10`, 'bg-emerald-50', 'bg-amber-50', 'bg-fuchsia-50'][accentIndex]
                                                : ['bg-blue-50', 'bg-emerald-50', 'bg-amber-50', 'bg-fuchsia-50'][accentIndex];
                                            const darkBg = activeTheme !== 'dark' && activeTheme !== 'light' && currentTheme
                                                ? [`${currentTheme.primary}/20`, 'bg-[#30d158]/20', 'bg-[#ff9f0a]/20', 'bg-[#bf5af2]/20'][accentIndex]
                                                : ['bg-[#0071e3]/20', 'bg-[#30d158]/20', 'bg-[#ff9f0a]/20', 'bg-[#bf5af2]/20'][accentIndex];
                                            const iconColor = activeTheme !== 'dark' && activeTheme !== 'light' && currentTheme
                                                ? [currentTheme.accent, 'text-[#30d158]', 'text-[#ff9f0a]', 'text-[#bf5af2]'][accentIndex]
                                                : ['text-[#0071e3]', 'text-[#30d158]', 'text-[#ff9f0a]', 'text-[#bf5af2]'][accentIndex];

                                            return (
                                                <button
                                                    key={index}
                                                    onClick={() => handleTopicClick(topic)}
                                                    className={"text-left rounded-2xl p-4 transition-all active:scale-[0.98] " + (
                                                        activeTheme === 'dark'
                                                            ? 'bg-[#1d1d1f] hover:bg-[#2d2d2f] border border-[#3d3d3f]/60 hover:border-[#0071e3]/60 text-[#e5e5ea]'
                                                            : activeTheme === 'light'
                                                                ? 'bg-white hover:bg-gray-50 border border-gray-200 hover:border-[#0071e3]/60 shadow-sm text-gray-800'
                                                                : `bg-white hover:bg-gray-50 border ${currentTheme.border} hover:${currentTheme.ring}/60 shadow-sm text-gray-800`
                                                    )}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <div className={"w-8 h-8 rounded-lg flex items-center justify-center shrink-0 " + (isDarkMode ? darkBg : lightBg)}>
                                                            <svg className={`w-4 h-4 ${iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                                            </svg>
                                                        </div>
                                                        <p className={"text-sm leading-relaxed " + (isDarkMode ? 'text-[#e5e5ea]' : 'text-gray-800')}>
                                                            {topic}
                                                        </p>
                                                    </div>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )
                    }
                </header >

                <div className={`sticky top-2 z-30 flex items-center gap-1 mb-6 p-1 rounded-full w-full overflow-x-auto backdrop-blur-md shadow-sm transition-all ${activeTheme === 'dark'
                    ? 'bg-[#1d1d1f]/80'
                    : activeTheme === 'light'
                        ? 'bg-gray-100/80'
                        : currentTheme.bgSecondary + '/90 border ' + currentTheme.border
                    }`}>
                    {sortedTabs.map(tab => (
                        <button
                            key={tab.id}
                            draggable={canEdit}
                            onDragStart={(e) => handleTabDragStart(e, tab.id)}
                            onDragOver={(e) => handleTabDragOver(e, tab.id)}
                            onDrop={handleTabDrop}
                            onClick={() => {
                                if (tab.id === 'assets') {
                                    setAssetsInitialFilter(['all']);
                                }
                                if (tab.id === 'chat') {
                                    setUnreadMentions(0);
                                    const now = Date.now();
                                    lastChatViewTimestamp.current = now;
                                    if (typeof window !== 'undefined') {
                                        localStorage.setItem(`last_chat_view_${project.id}`, now.toString());
                                    }
                                }
                                setActiveTab(tab.id);
                            }}
                            className={`flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-none ${draggedTabId === tab.id ? 'opacity-50 scale-95 ring-2 ring-dashed ring-gray-400' : ''
                                } ${activeTab === tab.id
                                    ? (activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3] text-white' : `${currentTheme.primary} text-white`)
                                    : activeTheme === 'dark'
                                        ? 'text-[#86868b] hover:text-white hover:bg-white/5'
                                        : activeTheme === 'light'
                                            ? 'text-gray-600 hover:text-gray-900 hover:bg-white'
                                            : `${currentTheme.textSecondary} ${currentTheme.hoverBg} hover:${currentTheme.text}`
                                }`}
                        >
                            {tab.icon}
                            <span className="hidden sm:inline">{tab.label}</span>
                            {tab.count !== undefined && tab.count > 0 && tab.id !== 'social' && (
                                <span
                                    className={`hidden sm:inline-flex text-xs px-1.5 py-0.5 rounded-full ${tab.id === 'chat'
                                        ? 'bg-red-500 text-white animate-pulse'
                                        : activeTab === tab.id
                                            ? 'bg-white/20 text-white'
                                            : activeTheme === 'dark'
                                                ? 'bg-white/10 text-[#86868b]'
                                                : activeTheme === 'light'
                                                    ? 'bg-gray-100 text-gray-600'
                                                    : `${currentTheme.bgSecondary} ${currentTheme.textSecondary}`
                                        }`}
                                >
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* OVERVIEW TAB */}
                <div style={{ display: activeTab === 'overview' ? 'block' : 'none' }}>
                    {(
                        <>
                            {/* Mobile Sub-tabs Header */}
                            <div className={`lg:hidden sticky top-[70px] z-20 -mx-4 px-4 py-2 mb-4 backdrop-blur-xl border-b transition-colors ${activeTheme === 'dark'
                                ? 'bg-[#000000]/80 border-[#3d3d3f]/60'
                                : activeTheme === 'light'
                                    ? 'bg-white/80 border-gray-200'
                                    : `${currentTheme.bgSecondary}/90 ${currentTheme.border}`
                                }`}>
                                <div className="flex items-center justify-between gap-1 p-1 rounded-lg bg-black/5 dark:bg-white/5">
                                    {(['focus', 'research', 'news'] as const).map((tab) => (
                                        <button
                                            key={tab}
                                            onClick={() => setActiveOverviewTab(tab)}
                                            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold capitalize transition-all ${activeOverviewTab === tab
                                                ? (activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3] text-white shadow-sm' : `${currentTheme.primary} text-white shadow-sm`)
                                                : (activeTheme === 'dark' ? 'text-[#86868b] hover:text-white' : activeTheme === 'light' ? 'text-gray-500 hover:text-gray-900' : `${currentTheme.textSecondary} hover:${currentTheme.text}`)
                                                }`}
                                        >
                                            {tab}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6">

                                {/* Mobile Only: Draft Research Topics (Order 2, below stats) - Show in Research Tab */}
                                <div className={`order-last lg:hidden mb-6 ${activeOverviewTab === 'research' ? 'block' : 'hidden'}`}>
                                    {draftsSection}
                                </div>

                                {/* Research Library column - Show in Research Tab on Mobile */}
                                <div className={`order-3 lg:order-2 lg:col-span-2 lg:row-span-2 space-y-5 lg:space-y-6 ${activeOverviewTab === 'research' ? 'block' : 'hidden lg:block'}`}>
                                    <section>
                                        <h2 className={`text-base sm:text-lg font-semibold mb-4 flex items-center gap-2 ${activeTheme === 'dark'
                                            ? 'text-white'
                                            : activeTheme === 'light'
                                                ? 'text-gray-900'
                                                : currentTheme.text
                                            }`}>
                                            <svg className={`w-5 h-5 ${activeTheme === 'dark' || activeTheme === 'light' ? 'text-[#0071e3]' : currentTheme.accent}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                            </svg>
                                            Research Library
                                            {researchSessions.length > 0 && (
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3]/20 text-[#0071e3]' : `${currentTheme.primary}/20 ${currentTheme.accent}`}`}>
                                                    {researchSessions.length}
                                                </span>
                                            )}
                                        </h2>
                                        {researchSessions.length > 0 && (
                                            <div className="mb-4 space-y-3">
                                                <div className="w-full">
                                                    <input
                                                        type="text"
                                                        value={researchSearch}
                                                        onChange={e => setResearchSearch(e.target.value)}
                                                        placeholder="Search by topic, summary, sources, or labels (e.g. competitive, market sizing)"
                                                        className={`w-full rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] focus:border-transparent ${activeTheme === 'dark'
                                                            ? 'bg-[#111111] border border-[#3d3d3f]/60 text-white placeholder:text-[#636366]'
                                                            : activeTheme === 'light'
                                                                ? 'bg-white border border-gray-300 text-gray-900 placeholder:text-gray-500'
                                                                : `${currentTheme.cardBg} border ${currentTheme.border} ${currentTheme.text} placeholder:${currentTheme.textSecondary}`
                                                            }`}
                                                    />
                                                </div>
                                                <div className="flex items-stretch gap-3 overflow-x-auto pb-1 -mx-1 px-1 text-xs sm:text-sm">
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                        <select
                                                            aria-label="Category"
                                                            value={categoryFilter}
                                                            onChange={e => setCategoryFilter(e.target.value)}
                                                            className={`rounded-full px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#0071e3] ${isDarkMode ? 'bg-[#111111] border border-[#3d3d3f]/60 text-white' : 'bg-white border border-gray-300 text-gray-900'}`}
                                                        >
                                                            <option value="all">All</option>
                                                            {categoryOptions.map(cat => (
                                                                <option key={cat} value={cat}>{cat}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                        <div className={`flex items-center gap-1 rounded-full px-2 py-1.5 ${activeTheme === 'dark'
                                                            ? 'bg-[#111111] border border-[#3d3d3f]/60'
                                                            : activeTheme === 'light'
                                                                ? 'bg-white border border-gray-300'
                                                                : `${currentTheme.cardBg} border ${currentTheme.border}`
                                                            }`}>
                                                            {(['all', 'fresh', 'stale'] as const).map(option => (
                                                                <button
                                                                    key={option}
                                                                    type="button"
                                                                    aria-label={`Show ${option} sessions`}
                                                                    onClick={() => setStaleFilter(option)}
                                                                    className={`px-2 py-0 rounded-full capitalize ${staleFilter === option
                                                                        ? (activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3] text-white' : `${currentTheme.primary} text-white`)
                                                                        : activeTheme === 'dark'
                                                                            ? 'text-[#86868b] hover:text-white'
                                                                            : activeTheme === 'light'
                                                                                ? 'text-gray-600 hover:text-gray-900'
                                                                                : `${currentTheme.textSecondary} hover:${currentTheme.text}`
                                                                        }`}
                                                                >
                                                                    {option}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                        <span className="uppercase tracking-wider whitespace-nowrap">Date</span>
                                                        <input
                                                            type="date"
                                                            value={dateFrom}
                                                            onChange={e => setDateFrom(e.target.value)}
                                                            className={`rounded-full px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#0071e3] ${activeTheme === 'dark'
                                                                ? 'bg-[#111111] border border-[#3d3d3f]/60 text-white'
                                                                : activeTheme === 'light'
                                                                    ? 'bg-white border border-gray-300 text-gray-900'
                                                                    : `${currentTheme.cardBg} border ${currentTheme.border} ${currentTheme.text}`
                                                                }`}
                                                        />
                                                        <span className={activeTheme === 'dark' ? 'text-[#3d3d3f]' : activeTheme === 'light' ? 'text-gray-400' : currentTheme.textSecondary}>–</span>
                                                        <input
                                                            type="date"
                                                            value={dateTo}
                                                            onChange={e => setDateTo(e.target.value)}
                                                            className={`rounded-full px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#0071e3] ${activeTheme === 'dark'
                                                                ? 'bg-[#111111] border border-[#3d3d3f]/60 text-white'
                                                                : activeTheme === 'light'
                                                                    ? 'bg-white border border-gray-300 text-gray-900'
                                                                    : `${currentTheme.cardBg} border ${currentTheme.border} ${currentTheme.text}`
                                                                }`}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {researchSessions.length === 0 ? (
                                            <div className={`rounded-2xl sm:rounded-3xl p-10 sm:p-12 text-center ${isDarkMode ? 'bg-[#1d1d1f] border border-[#3d3d3f]/50' : 'bg-white border border-gray-200'}`}>
                                                <div className={`w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-100'}`}>
                                                    <svg className={`w-8 h-8 ${isDarkMode ? 'text-[#424245]' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                                    </svg>
                                                </div>
                                                <h3 className={`text-lg font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>No research yet</h3>
                                                <p className={`text-sm mb-4 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>Start by clicking a suggested topic above</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {filteredResearchSessions.length === 0 && (
                                                    <div className={`rounded-2xl p-6 text-center text-sm ${isDarkMode ? 'bg-[#1d1d1f] border border-[#3d3d3f]/50 text-[#86868b]' : 'bg-white border border-gray-200 text-gray-600'}`}>
                                                        No research matches your filters.
                                                    </div>
                                                )}
                                                {filteredResearchSessions.map(session => {
                                                    const report = session.researchReport;

                                                    // Handle sessions without full report data
                                                    if (!report) {
                                                        const sessionIsStale = isSessionStale(session);
                                                        const hasSummary = (session as any).summary || (session as any).tldr;

                                                        return (
                                                            <div
                                                                key={session.id}
                                                                className={`group rounded-xl sm:rounded-2xl p-4 sm:p-5 transition-all duration-200 ${isDarkMode ? 'bg-[#1d1d1f]' : 'bg-white'
                                                                    } border ${sessionIsStale ? 'border-[#ff9f0a]/30' : isDarkMode ? 'border-[#3d3d3f]/50' : 'border-gray-200'
                                                                    }`}
                                                            >
                                                                <div className="flex justify-between items-start">
                                                                    <div className="flex-1 pr-4 min-w-0">
                                                                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-[#ff9f0a]/20 text-[#ff9f0a]">
                                                                                Incomplete Data
                                                                            </span>
                                                                            {sessionIsStale && (
                                                                                <span className="text-[10px] px-2 py-0.5 bg-[#ff9f0a]/20 text-[#ff9f0a] rounded">
                                                                                    Stale
                                                                                </span>
                                                                            )}
                                                                            <span className={`text-xs ${isDarkMode ? 'text-[#636366]' : 'text-gray-500'}`}>
                                                                                {new Date(session.timestamp).toLocaleDateString()}
                                                                            </span>
                                                                        </div>
                                                                        <h3 className={`font-semibold text-base sm:text-lg mb-1 truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                            {session.topic}
                                                                        </h3>
                                                                        <p className={`text-sm line-clamp-2 mb-3 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                                            {hasSummary ? ((session as any).summary || (session as any).tldr) : 'This research session is missing full report data. It may not have been saved correctly.'}
                                                                        </p>
                                                                        <div className="flex gap-2">
                                                                            <button
                                                                                onClick={() => onLoadResearch(session)}
                                                                                className={`px-3 py-1.5 text-white text-xs rounded-lg transition-colors flex items-center gap-1 ${activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3] hover:bg-[#0077ed]' : `${currentTheme.primary} ${currentTheme.primaryHover}`}`}
                                                                            >
                                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                                                </svg>
                                                                                View Anyway
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    if (confirm('This will delete this incomplete research session. Continue?')) {
                                                                                        handleDeleteResearch(e, session.id);
                                                                                    }
                                                                                }}
                                                                                className="px-3 py-1.5 bg-[#ff453a]/10 hover:bg-[#ff453a]/20 text-[#ff453a] text-xs rounded-lg transition-colors flex items-center gap-1"
                                                                            >
                                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                                </svg>
                                                                                Delete
                                                                            </button>
                                                                        </div>

                                                                        {/* Post Mode Selector - only show for file uploads */}
                                                                        {(tiktokVideoSource === 'UPLOAD' || tiktokVideoSource === 'ASSET') && (
                                                                            <div className="flex items-center gap-2 mb-2">
                                                                                <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Post Mode:</span>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => setTiktokVideoPostMode('direct')}
                                                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tiktokVideoPostMode === 'direct'
                                                                                        ? (isDarkMode ? 'bg-emerald-600 text-white' : 'bg-emerald-600 text-white')
                                                                                        : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200')
                                                                                        }`}
                                                                                >
                                                                                    Direct Post
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => setTiktokVideoPostMode('inbox')}
                                                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tiktokVideoPostMode === 'inbox'
                                                                                        ? (activeTheme === 'dark' || activeTheme === 'light' ? 'bg-blue-600 text-white' : `${currentTheme.primary} text-white`)
                                                                                        : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200')
                                                                                        }`}
                                                                                >
                                                                                    Inbox/Draft
                                                                                </button>
                                                                                <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                                                                    {tiktokVideoPostMode === 'direct' ? '(Posts immediately)' : '(Review in TikTok app)'}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    }

                                                    const theme = report.theme;
                                                    const reportActiveTheme = theme ? (isDarkMode ? theme.dark : theme.light) : undefined;
                                                    const headerImage = report.headerImageUrl;
                                                    const category = report.category || 'Research';
                                                    const sourceCount = report.sources?.length || 0;
                                                    const wizaProfiles = (report as any)?.wizaProspects?.data?.profiles;
                                                    const leadCount = Array.isArray(wizaProfiles) ? wizaProfiles.length : 0;
                                                    const sessionIsStale = isSessionStale(session);

                                                    return (
                                                        <div
                                                            key={session.id}
                                                            onClick={() => onLoadResearch(session)}
                                                            className={`group border rounded-xl sm:rounded-2xl p-4 sm:p-5 cursor-pointer transition-all duration-200 relative overflow-hidden ${activeTheme === 'dark'
                                                                ? 'bg-[#1d1d1f] hover:border-[#0071e3]/50'
                                                                : activeTheme === 'light'
                                                                    ? 'bg-white hover:border-[#0071e3]/50'
                                                                    : `${currentTheme.cardBg} hover:${currentTheme.ring.replace('ring-', 'border-')}/50`
                                                                } ${sessionIsStale ? 'border-[#ff9f0a]/30' : activeTheme === 'dark' ? 'border-[#3d3d3f]/50' : activeTheme === 'light' ? 'border-gray-200' : currentTheme.border
                                                                }`}
                                                            style={reportActiveTheme ? {
                                                                backgroundColor: reportActiveTheme.surface,
                                                                borderColor: reportActiveTheme.secondary
                                                            } : {}}
                                                        >
                                                            {headerImage && (
                                                                <div className="absolute inset-0 z-0 pointer-events-none">
                                                                    <div
                                                                        className="absolute inset-0 bg-cover bg-center opacity-15 group-hover:opacity-25 transition-opacity"
                                                                        style={{
                                                                            backgroundImage: `url(${headerImage})`,
                                                                            maskImage: 'linear-gradient(to left, rgba(0,0,0,1) 0%, transparent 70%)',
                                                                            WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,1) 0%, transparent 70%)'
                                                                        }}
                                                                    />
                                                                </div>
                                                            )}

                                                            <div className="relative z-10 flex justify-between items-start">
                                                                <div className="flex-1 pr-4 min-w-0">
                                                                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                                        <span
                                                                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3]/20 text-[#0071e3]' : `${currentTheme.bgSecondary} ${currentTheme.accent}`}`}
                                                                            style={reportActiveTheme ? { backgroundColor: reportActiveTheme.primary + '33', color: reportActiveTheme.primary } : {}}
                                                                        >
                                                                            {category}
                                                                        </span>
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                if (sourceCount > 0 && report.sources) {
                                                                                    openSourcesModal(`Sources for "${session.topic}"`, report.sources);
                                                                                }
                                                                            }}
                                                                            className={`text-[10px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${isDarkMode ? 'bg-[#2d2d2f] text-[#86868b]' : 'bg-gray-100 text-gray-600'
                                                                                } ${sourceCount === 0 ? 'opacity-60 cursor-default' : 'hover:bg-[#0071e3]/10 cursor-pointer'}`}
                                                                        >
                                                                            {sourceCount} sources
                                                                        </button>
                                                                        {leadCount > 0 && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    openLeadsModal(`Leads for "${session.topic}"`, (report as any)?.wizaProspects);
                                                                                }}
                                                                                className={`text-[10px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${isDarkMode ? 'bg-[#2d2d2f] text-[#86868b]' : 'bg-gray-100 text-gray-600'
                                                                                    } hover:bg-[#bf5af2]/10 cursor-pointer`}
                                                                            >
                                                                                {leadCount} leads
                                                                            </button>
                                                                        )}
                                                                        {sessionIsStale && (
                                                                            <span className="text-[10px] px-2 py-0.5 bg-[#ff9f0a]/20 text-[#ff9f0a] rounded">
                                                                                Stale
                                                                            </span>
                                                                        )}
                                                                        <span className={`text-xs ${isDarkMode ? 'text-[#636366]' : 'text-gray-500'}`}>
                                                                            {new Date(session.timestamp).toLocaleDateString()}
                                                                        </span>
                                                                    </div>
                                                                    <h3
                                                                        className={`font-semibold text-base sm:text-lg mb-1 truncate transition-colors ${isDarkMode ? 'text-white' : 'text-gray-900'} ${activeTheme === 'dark' || activeTheme === 'light' ? 'group-hover:text-[#0071e3]' : ''}`}
                                                                        style={reportActiveTheme ? { color: reportActiveTheme.primary } : {}}
                                                                    >
                                                                        {session.topic}
                                                                    </h3>
                                                                    <p className={`text-sm line-clamp-2 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                                        {report.tldr}
                                                                    </p>
                                                                </div>

                                                                <button
                                                                    onClick={(e) => handleDeleteResearch(e, session.id)}
                                                                    className={`opacity-0 group-hover:opacity-100 p-2 hover:text-[#ff453a] hover:bg-[#ff453a]/10 rounded-lg transition-all flex-shrink-0 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}
                                                                >
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                    </svg>
                                                                </button>

                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </section>
                                </div>

                                {/* Dynamic Right Column: Widgets are rendered from orderedWidgets state */}
                                <div className="order-1 lg:order-1 lg:col-start-3 lg:row-start-1 space-y-4 lg:space-y-5">
                                    {orderedWidgets.map(renderOverviewWidget)}
                                </div>

                            </div>

                        </>
                    )}
                </div>

                {/* TASKS TAB */}
                <div style={{ display: activeTab === 'tasks' ? 'block' : 'none' }}>
                    {(
                        <div className="h-auto sm:h-[calc(100vh-280px)]">
                            <KanbanBoard
                                project={currentProject}
                                onProjectUpdate={handleProjectChange}
                                isDarkMode={isDarkMode}
                                readOnly={readOnly}
                                initialTaskId={activeTab === 'tasks' ? jumpToItemId : null}
                                updateFocus={updateFocus}
                                onlineCollaborators={onlineCollaborators}
                            />
                        </div>
                    )}
                </div>

                {/* SEO TAB */}
                <div style={{ display: activeTab === 'seo' ? 'block' : 'none' }}>
                    {(
                        <div className="h-auto sm:min-h-[calc(100vh-280px)] space-y-4">


                            {/* Ad Targeting Search Section - Facebook */}
                            <div
                                className={`rounded-2xl p-5 border backdrop-blur-sm ${isDarkMode
                                    ? 'bg-[#1d1d1f]/90 border-[#3d3d3f]/60'
                                    : 'bg-white border-gray-200 shadow-sm'
                                    }`}
                            >
                                <div className="flex items-start gap-3 mb-4">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isDarkMode ? 'bg-[#1877F2]' : 'bg-[#1877F2]'}`}>
                                        <img src={PLATFORM_LOGOS.facebook} alt="Facebook" className="w-6 h-6 object-contain" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                            Ad Targeting Search
                                        </h3>
                                        <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                            Find valid targeting values for Facebook/Instagram ads.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {/* Search Type Selector */}
                                    <div className="flex flex-wrap gap-2">
                                        {(['geo', 'interest', 'behavior', 'demographic'] as const).map(type => (
                                            <button
                                                key={type}
                                                onClick={() => {
                                                    setTargetingSearchType(type);
                                                    setTargetingResults([]);
                                                    setTargetingError(null);
                                                }}
                                                disabled={!canEdit}
                                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${targetingSearchType === type
                                                    ? (activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0071e3] text-white' : `${currentTheme.primary} text-white`)
                                                    : isDarkMode ? 'bg-white/5 text-white/70 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                    }`}
                                            >
                                                {type === 'geo' ? '🌍 Geographic' :
                                                    type === 'interest' ? '❤️ Interests' :
                                                        type === 'behavior' ? '🎯 Behaviors' : '👥 Demographics'}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Geo Sub-type Selector */}
                                    {targetingSearchType === 'geo' && (
                                        <div className="flex gap-2">
                                            {(['country', 'region', 'city', 'zip'] as const).map(geoType => (
                                                <button
                                                    key={geoType}
                                                    onClick={() => setTargetingGeoType(geoType)}
                                                    disabled={!canEdit}
                                                    className={`px-2 py-1 rounded text-xs font-medium transition-all ${targetingGeoType === geoType
                                                        ? isDarkMode ? 'bg-white/20 text-white' : 'bg-gray-300 text-gray-900'
                                                        : isDarkMode ? 'bg-white/5 text-white/50' : 'bg-gray-100 text-gray-500'
                                                        }`}
                                                >
                                                    {geoType.charAt(0).toUpperCase() + geoType.slice(1)}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {/* Search Input */}
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={targetingQuery}
                                            onChange={e => setTargetingQuery(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleTargetingSearch()}
                                            placeholder={
                                                targetingSearchType === 'geo' ? `Search ${targetingGeoType}s (e.g., "United States", "California")...` :
                                                    targetingSearchType === 'interest' ? 'Search interests (e.g., "basketball", "cooking")...' :
                                                        targetingSearchType === 'behavior' ? 'Browse behaviors (press Search)...' :
                                                            'Browse demographics (press Search)...'
                                            }
                                            disabled={!facebookConnected || !canEdit}
                                            className={`flex-1 rounded-xl h-9 px-3 text-sm border focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${isDarkMode
                                                ? 'bg-[#111111] border-[#3d3d3f] text-white placeholder:text-gray-500'
                                                : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400'
                                                } disabled:opacity-50`}
                                        />
                                        <button
                                            onClick={handleTargetingSearch}
                                            disabled={targetingLoading || !facebookConnected || !canEdit}
                                            className={`h-9 px-4 rounded-xl text-sm font-medium transition-colors ${targetingLoading
                                                ? 'bg-gray-500/60 text-white cursor-wait'
                                                : activeTheme === 'dark' || activeTheme === 'light'
                                                    ? 'bg-[#0071e3] hover:bg-[#0077ed] text-white disabled:opacity-50'
                                                    : `${currentTheme.primary} ${currentTheme.primaryHover} text-white disabled:opacity-50`
                                                }`}
                                        >
                                            {targetingLoading ? '...' : 'Search'}
                                        </button>
                                    </div>

                                    {!facebookConnected && (
                                        <div className={`mt-3 p-3 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-3 ${isDarkMode ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-amber-50 border border-amber-100'}`}>
                                            <p className={`text-xs ${isDarkMode ? 'text-amber-200' : 'text-amber-700'}`}>
                                                Connect Facebook to use targeting search
                                            </p>
                                            <button
                                                type="button"
                                                onClick={handleFacebookConnect}
                                                disabled={!facebookSdkReady}
                                                className={`whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                                                    ? 'bg-[#1877F2] hover:bg-[#166fe5] text-white'
                                                    : 'bg-[#1877F2] hover:bg-[#166fe5] text-white'
                                                    }`}
                                            >
                                                Connect Facebook
                                            </button>
                                        </div>
                                    )}

                                    {/* Error Message */}
                                    {targetingError && (
                                        <p className={`text-xs ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                                            {targetingError}
                                        </p>
                                    )}

                                    {/* Results */}
                                    {targetingResults.length > 0 && (
                                        <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-[#3d3d3f]/60 bg-[#111111]' : 'border-gray-200 bg-gray-50'}`}>
                                            <div className="max-h-64 overflow-auto">
                                                <table className="w-full text-xs">
                                                    <thead className={isDarkMode ? 'bg-[#18181b] sticky top-0' : 'bg-gray-100 sticky top-0'}>
                                                        <tr>
                                                            <th className="px-3 py-2 text-left font-medium">Name</th>
                                                            <th className="px-3 py-2 text-left font-medium">Key/ID</th>
                                                            <th className="px-3 py-2 text-left font-medium">Type</th>
                                                            {targetingSearchType === 'geo' && (
                                                                <th className="px-3 py-2 text-left font-medium">Details</th>
                                                            )}
                                                            {(targetingSearchType === 'interest' || targetingSearchType === 'behavior' || targetingSearchType === 'demographic') && (
                                                                <th className="px-3 py-2 text-right font-medium">Audience</th>
                                                            )}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {targetingResults.map((result, idx) => (
                                                            <tr
                                                                key={result.key || result.id || idx}
                                                                className={isDarkMode
                                                                    ? `border-t border-[#27272a] ${idx % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent'}`
                                                                    : `border-t border-gray-100 ${idx % 2 === 0 ? 'bg-gray-50/60' : 'bg-white'}`}
                                                            >
                                                                <td className={`px-3 py-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                    {result.name}
                                                                </td>
                                                                <td className={`px-3 py-2 font-mono text-[10px] ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                                    {result.key || result.id}
                                                                </td>
                                                                <td className={`px-3 py-2 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                                    {result.type || targetingSearchType}
                                                                </td>
                                                                {targetingSearchType === 'geo' && (
                                                                    <td className={`px-3 py-2 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                                        {result.country_name || result.region || ''}
                                                                        {result.primary_city && ` (${result.primary_city})`}
                                                                    </td>
                                                                )}
                                                                {(targetingSearchType === 'interest' || targetingSearchType === 'behavior' || targetingSearchType === 'demographic') && (
                                                                    <td className={`px-3 py-2 text-right ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                                        {result.audience_size?.toLocaleString() ||
                                                                            (result.audience_size_lower_bound && result.audience_size_upper_bound
                                                                                ? `${(result.audience_size_lower_bound / 1000000).toFixed(1)}M - ${(result.audience_size_upper_bound / 1000000).toFixed(1)}M`
                                                                                : '-')}
                                                                    </td>
                                                                )}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                    {targetingResults.length > 0 && (
                                        <div className="mt-3 flex justify-end">
                                            <button
                                                type="button"
                                                onClick={() => handleCreateTableFromSeo('targeting')}
                                                disabled={!canEdit}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${isDarkMode
                                                    ? 'bg-[#5e5ce6]/20 text-[#5e5ce6] hover:bg-[#5e5ce6]/30'
                                                    : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                                    }`}
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                </svg>
                                                Create Table
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* X (Twitter) Research Section */}
                            <div
                                className={`rounded-2xl p-5 border backdrop-blur-sm ${isDarkMode
                                    ? 'bg-[#1d1d1f]/90 border-[#3d3d3f]/60'
                                    : 'bg-white border-gray-200 shadow-sm'
                                    }`}
                            >
                                <div className="flex items-start gap-3 mb-4">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden ${isDarkMode ? 'bg-black' : 'bg-black'}`}>
                                        <img src={PLATFORM_LOGOS.x} alt="X" className="w-6 h-6 object-contain" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                            X (Twitter) Research
                                        </h3>
                                        <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                            Search for recent tweets and X users.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-2 mb-3">
                                    <button
                                        onClick={() => setXSearchMode('tweets')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${xSearchMode === 'tweets'
                                            ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                            : (isDarkMode ? 'bg-[#1c1c1e] text-[#86868b] hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900')
                                            }`}
                                    >
                                        Tweets
                                    </button>
                                    <button
                                        onClick={() => setXSearchMode('users')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${xSearchMode === 'users'
                                            ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                            : (isDarkMode ? 'bg-[#1c1c1e] text-[#86868b] hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900')
                                            }`}
                                    >
                                        Users
                                    </button>
                                </div>

                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        className={`w-full h-9 px-3 rounded-xl text-sm border focus:ring-2 focus:border-transparent outline-none transition-all focus:ring-[#0071e3] ${isDarkMode
                                            ? 'bg-[#111111] border-[#3d3d3f] text-white placeholder-gray-500'
                                            : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                                            }`}
                                        placeholder={xSearchMode === 'tweets' ? "Search tweets..." : "Search users..."}
                                        value={xSearchQuery}
                                        onChange={(e) => setXSearchQuery(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && !xSearchLoading && handleXSearch()}
                                        disabled={!canEdit}
                                    />
                                    <button
                                        onClick={handleXSearch}
                                        disabled={xSearchLoading || !canEdit}
                                        className={`h-9 px-4 rounded-xl text-sm font-medium transition-colors ${xSearchLoading
                                            ? 'bg-gray-500/60 text-white cursor-wait'
                                            : activeTheme === 'dark' || activeTheme === 'light'
                                                ? 'bg-black text-white hover:bg-gray-800'
                                                : `${currentTheme.primary} ${currentTheme.primaryHover} text-white`
                                            }`}
                                    >
                                        {xSearchLoading ? '...' : 'Search'}
                                    </button>
                                </div>

                                {xSearchError && <p className="mt-2 text-xs text-red-400">{xSearchError}</p>}

                                {xSearchResults?.data && xSearchMode === 'tweets' && (
                                    <div className="mt-4 space-y-3">
                                        {xSearchResults.data.map((tweet: any) => {
                                            const author = xSearchResults.includes?.users?.find((u: any) => u.id === tweet.author_id);
                                            return (
                                                <div key={tweet.id} className={`p-3 rounded-xl border ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`}>
                                                    <div className="flex items-start gap-3">
                                                        {author?.profile_image_url && <img src={author.profile_image_url} alt="" className="w-8 h-8 rounded-full" />}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className={`text-xs font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{author?.name || 'Unknown'}</span>
                                                                <span className={`text-[10px] ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>@{author?.username}</span>
                                                                <span className={`text-[10px] ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>· {new Date(tweet.created_at).toLocaleDateString()}</span>
                                                            </div>
                                                            <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{tweet.text}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {xSearchResults?.data && xSearchMode === 'users' && (
                                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {xSearchResults.data.map((user: any) => (
                                            <div key={user.id} className={`p-3 rounded-xl border flex items-start gap-3 ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`}>
                                                {user.profile_image_url && <img src={user.profile_image_url} alt="" className="w-10 h-10 rounded-full" />}
                                                <div className="flex-1 min-w-0">
                                                    <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{user.name}</span>
                                                    <span className={`text-xs block ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>@{user.username}</span>
                                                    <p className={`text-xs mt-1 line-clamp-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>{user.description}</p>
                                                    <span className="text-[10px] text-gray-500">{user.public_metrics?.followers_count?.toLocaleString()} followers</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {xSearchResults?.data && (
                                    <div className="mt-3 flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() => handleCreateTableFromSeo(xSearchMode === 'tweets' ? 'x_tweets' : 'x_users')}
                                            disabled={!canEdit}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${isDarkMode
                                                ? 'bg-white/10 text-white hover:bg-white/20'
                                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                }`}
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            </svg>
                                            Create Table
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Instagram Hashtag Research Section */}
                            <div
                                className={`rounded-2xl p-5 border backdrop-blur-sm ${isDarkMode
                                    ? 'bg-[#1d1d1f]/90 border-[#3d3d3f]/60'
                                    : 'bg-white border-gray-200 shadow-sm'
                                    }`}
                            >
                                <div className="flex items-start gap-3 mb-4">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isDarkMode ? 'bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400' : 'bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400'}`}>
                                        <img src={PLATFORM_LOGOS.instagram} alt="Instagram" className="w-6 h-6 object-contain" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                            Instagram Hashtag Research
                                        </h3>
                                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                            Search a hashtag and preview top/recent public posts.
                                        </p>
                                        <p className={`text-[11px] mt-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                            Requires Facebook connection (Social tab). Limit: 30 unique hashtags per 7 days.
                                        </p>
                                    </div>

                                    {/* Buttons hidden as per request */}
                                    {/* <div className="flex items-center gap-2">
                                        {!facebookConnected ? (
                                            <button
                                                type="button"
                                                onClick={handleFacebookConnect}
                                                disabled={!facebookSdkReady || !canEdit}
                                                className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                                                    ? 'bg-[#1877F2] hover:bg-[#166fe5] text-white'
                                                    : 'bg-[#1877F2] hover:bg-[#166fe5] text-white'
                                                    }`}
                                            >
                                                Connect Facebook
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => setActiveTab('social')}
                                                className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors ${isDarkMode
                                                    ? 'bg-white/5 hover:bg-white/10 text-white border border-white/10'
                                                    : 'bg-white hover:bg-gray-100 text-gray-900 border border-gray-200'
                                                    }`}
                                            >
                                                Open Social
                                            </button>
                                        )}
                                    </div> */}
                                </div>

                                <div className="mt-4 grid grid-cols-1 gap-3">
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <input
                                            value={seoIgHashtagQuery}
                                            onChange={(e) => setSeoIgHashtagQuery(e.target.value)}
                                            placeholder="#yourhashtag"
                                            className={`flex-1 rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${isDarkMode
                                                ? 'bg-[#0b0b0c] border border-[#3d3d3f]/60 text-white placeholder:text-[#636366]'
                                                : 'bg-white border border-gray-300 text-gray-900 placeholder:text-gray-500'
                                                }`}
                                            disabled={seoIgHashtagSearchLoading || seoIgMediaLoading || !canEdit}
                                        />
                                        <button
                                            type="button"
                                            onClick={handleSeoIgHashtagSearch}
                                            disabled={seoIgHashtagSearchLoading || seoIgMediaLoading || !canEdit}
                                            className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-medium ${seoIgHashtagSearchLoading
                                                ? 'bg-gray-500/60 text-white cursor-wait'
                                                : activeTheme === 'dark' || activeTheme === 'light'
                                                    ? 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
                                                    : `${currentTheme.primary} ${currentTheme.primaryHover} text-white`
                                                }`}
                                        >
                                            {seoIgHashtagSearchLoading ? 'Searching…' : 'Search'}
                                        </button>
                                    </div>

                                    {seoIgHashtagSearchError && (
                                        <p className="text-xs text-red-400">{seoIgHashtagSearchError}</p>
                                    )}

                                    {seoIgMediaError && (
                                        <p className="text-xs text-red-400">{seoIgMediaError}</p>
                                    )}

                                    {seoIgHashtagResult?.id && (
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                            <p className={`text-xs ${isDarkMode ? 'text-[#e5e5ea]' : 'text-gray-700'}`}>
                                                Hashtag ID: <code className="font-mono">{String(seoIgHashtagResult.id)}</code>
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const keyword = normalizeHashtag(seoIgHashtagQuery);
                                                    if (!keyword) return;
                                                    setSeoKeyword(keyword);
                                                    handleRunSeoAnalysis(keyword);
                                                }}
                                                disabled={isRunningSeo || !canEdit}
                                                className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium ${isRunningSeo
                                                    ? 'bg-gray-500/60 text-white cursor-wait'
                                                    : 'bg-[#30d158] hover:bg-[#2ac553] text-white'
                                                    }`}
                                            >
                                                Analyze as SEO keyword
                                            </button>
                                        </div>
                                    )}

                                    {(seoIgTopMedia.length > 0 || seoIgRecentMedia.length > 0) && (
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                            <div
                                                className={`rounded-xl border ${isDarkMode ? 'border-[#3d3d3f]/60 bg-[#0b0b0c]' : 'border-gray-200 bg-white'
                                                    }`}
                                            >
                                                <div
                                                    className={`px-3 py-2 text-xs font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                                                        }`}
                                                >
                                                    Top media
                                                </div>
                                                <div className="max-h-64 overflow-auto p-3 space-y-2">
                                                    {seoIgTopMedia.slice(0, 12).map((m: any) => {
                                                        const imageUrl = m.media_type === 'VIDEO' ? (m.thumbnail_url || m.media_url) : m.media_url;
                                                        return (
                                                            <a
                                                                key={String(m?.id || Math.random())}
                                                                href={String(m?.permalink || '#')}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className={`block rounded-lg p-2 border transition-colors flex gap-3 ${isDarkMode
                                                                    ? 'border-white/10 hover:bg-white/5'
                                                                    : 'border-gray-200 hover:bg-gray-50'
                                                                    }`}
                                                            >
                                                                {imageUrl && (
                                                                    <img
                                                                        src={imageUrl}
                                                                        alt=""
                                                                        className="w-16 h-16 object-cover rounded-md flex-shrink-0 bg-gray-100 dark:bg-[#2d2d2f]"
                                                                    />
                                                                )}
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-center justify-between gap-2 mb-1">
                                                                        <span
                                                                            className={`text-[10px] uppercase font-bold tracking-wider ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'
                                                                                }`}
                                                                        >
                                                                            {String(m?.media_type || '')}
                                                                        </span>
                                                                        <span
                                                                            className={`text-[10px] ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'
                                                                                }`}
                                                                        >
                                                                            ♥ {Number(m?.like_count || 0)} · 💬 {Number(m?.comments_count || 0)}
                                                                        </span>
                                                                    </div>
                                                                    {m?.caption && (
                                                                        <div className={`text-xs line-clamp-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                            {String(m.caption)}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </a>
                                                        )
                                                    })}
                                                </div>
                                            </div>

                                            <div
                                                className={`rounded-xl border ${isDarkMode ? 'border-[#3d3d3f]/60 bg-[#0b0b0c]' : 'border-gray-200 bg-white'
                                                    }`}
                                            >
                                                <div
                                                    className={`px-3 py-2 text-xs font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                                                        }`}
                                                >
                                                    Recent media (24h)
                                                </div>
                                                <div className="max-h-64 overflow-auto p-3 space-y-2">
                                                    {seoIgRecentMedia.slice(0, 12).map((m: any) => {
                                                        const imageUrl = m.media_type === 'VIDEO' ? (m.thumbnail_url || m.media_url) : m.media_url;
                                                        return (
                                                            <a
                                                                key={String(m?.id || Math.random())}
                                                                href={String(m?.permalink || '#')}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className={`block rounded-lg p-2 border transition-colors flex gap-3 ${isDarkMode
                                                                    ? 'border-white/10 hover:bg-white/5'
                                                                    : 'border-gray-200 hover:bg-gray-50'
                                                                    }`}
                                                            >
                                                                {imageUrl && (
                                                                    <img
                                                                        src={imageUrl}
                                                                        alt=""
                                                                        className="w-16 h-16 object-cover rounded-md flex-shrink-0 bg-gray-100 dark:bg-[#2d2d2f]"
                                                                    />
                                                                )}
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-center justify-between gap-2 mb-1">
                                                                        <span
                                                                            className={`text-[10px] uppercase font-bold tracking-wider ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'
                                                                                }`}
                                                                        >
                                                                            {String(m?.media_type || '')}
                                                                        </span>
                                                                        <span
                                                                            className={`text-[10px] ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'
                                                                                }`}
                                                                        >
                                                                            ♥ {Number(m?.like_count || 0)} · 💬 {Number(m?.comments_count || 0)}
                                                                        </span>
                                                                    </div>
                                                                    {m?.caption && (
                                                                        <div className={`text-xs line-clamp-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                            {String(m.caption)}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </a>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {(seoIgTopMedia.length > 0 || seoIgRecentMedia.length > 0) && (
                                    <div className="mt-3 flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() => handleCreateTableFromSeo('instagram')}
                                            disabled={!canEdit}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${isDarkMode
                                                ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-pink-300 hover:from-purple-500/30 hover:to-pink-500/30'
                                                : 'bg-gradient-to-r from-purple-100 to-pink-100 text-purple-700 hover:from-purple-200 hover:to-pink-200'
                                                }`}
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            </svg>
                                            Create Table
                                        </button>
                                    </div>
                                )}
                            </div>



                            {/* Competitor Analysis Section */}
                            <div
                                className={`rounded-2xl p-5 border backdrop-blur-sm ${isDarkMode
                                    ? 'bg-[#1d1d1f]/90 border-[#3d3d3f]/60'
                                    : 'bg-white border-gray-200 shadow-sm'
                                    }`}
                            >
                                <div className="flex items-start gap-3 mb-4">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isDarkMode ? 'bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400' : 'bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400'}`}>
                                        <img src={PLATFORM_LOGOS.instagram} alt="Instagram" className="w-6 h-6 object-contain" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                            Competitor Analysis
                                        </h3>
                                        <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                            Search Instagram Business/Creator accounts to see stats and media.
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                                    <div className="flex-1 relative">
                                        <input
                                            type="text"
                                            className={`w-full h-9 px-3 rounded-lg text-sm border focus:ring-2 focus:ring-[#007AFF] focus:border-transparent outline-none transition-all ${isDarkMode
                                                ? 'bg-[#1c1c1e] border-[#3d3d3f] text-white placeholder-gray-500'
                                                : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                                                }`}
                                            placeholder="Enter Instagram username (e.g. bluebottle)"
                                            value={seoDiscoveryUsername}
                                            onChange={(e) => setSeoDiscoveryUsername(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && !seoDiscoveryLoading && handleSeoDiscoverySearch()}
                                            disabled={!canEdit}
                                        />
                                    </div>
                                    <button
                                        onClick={handleSeoDiscoverySearch}
                                        disabled={seoDiscoveryLoading || !canEdit}
                                        className={`h-9 px-4 rounded-lg text-sm font-medium transition-colors ${seoDiscoveryLoading
                                            ? 'bg-blue-500/50 text-white cursor-not-allowed'
                                            : activeTheme === 'dark' || activeTheme === 'light'
                                                ? 'bg-[#007AFF] hover:bg-[#0066d6] text-white shadow-sm'
                                                : `${currentTheme.primary} ${currentTheme.primaryHover} text-white shadow-sm`
                                            }`}
                                    >
                                        {seoDiscoveryLoading ? 'Searching…' : 'Search'}
                                    </button>
                                </div>

                                {seoDiscoveryError && (
                                    <p className="mt-2 text-xs text-red-400">{seoDiscoveryError}</p>
                                )}

                                {seoDiscoveryResult && (
                                    <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-1 duration-300">
                                        <div className="flex flex-wrap gap-4">
                                            <div className={`px-3 py-2 rounded-lg border ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-white'}`}>
                                                <div className={`text-[10px] uppercase font-bold tracking-wider mb-0.5 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Followers</div>
                                                <div className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{Number(seoDiscoveryResult.followers_count).toLocaleString()}</div>
                                            </div>
                                            <div className={`px-3 py-2 rounded-lg border ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-white'}`}>
                                                <div className={`text-[10px] uppercase font-bold tracking-wider mb-0.5 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Media Count</div>
                                                <div className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{Number(seoDiscoveryResult.media_count).toLocaleString()}</div>
                                            </div>
                                            {seoDiscoveryResult.id && (
                                                <div className={`px-3 py-2 rounded-lg border ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-white'}`}>
                                                    <div className={`text-[10px] uppercase font-bold tracking-wider mb-0.5 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>IG ID</div>
                                                    <div className="text-xs font-mono opacity-70">{seoDiscoveryResult.id}</div>
                                                </div>
                                            )}
                                        </div>

                                        {seoDiscoveryResult.media?.data && seoDiscoveryResult.media.data.length > 0 && (
                                            <div>
                                                <div className={`px-1 py-1 text-xs font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                    Recent Media
                                                </div>
                                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                                    {seoDiscoveryResult.media.data.map((m: any) => {
                                                        const imageUrl = m.media_type === 'VIDEO' ? (m.thumbnail_url || m.media_url) : m.media_url;
                                                        return (
                                                            <a
                                                                key={m.id}
                                                                href={m.permalink || '#'}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className={`group relative aspect-square rounded-lg border overflow-hidden block ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}
                                                            >
                                                                {imageUrl ? (
                                                                    <img src={imageUrl} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                                                                ) : (
                                                                    <div className="w-full h-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs opacity-50">No Image</div>
                                                                )}

                                                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2 flex flex-col justify-end">
                                                                    <div className="flex items-center justify-between text-[10px] text-white font-medium">
                                                                        <span>♥ {Number(m.like_count || 0)}</span>
                                                                        <span>💬 {Number(m.comments_count || 0)}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 text-[8px] font-bold text-white uppercase backdrop-blur-sm">
                                                                    {m.media_type}
                                                                </div>
                                                            </a>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* SEO Keyword Analysis Section - Google */}
                            <div
                                className={`rounded-2xl p-5 border backdrop-blur-sm ${isDarkMode
                                    ? 'bg-[#1d1d1f]/90 border-[#3d3d3f]/60'
                                    : 'bg-white border-gray-200 shadow-sm'
                                    }`}
                            >
                                <div className="flex items-start gap-3 mb-4">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isDarkMode ? 'bg-white/10' : 'bg-gray-100'}`}>
                                        <img src={PLATFORM_LOGOS.google} alt="Google" className="h-5 object-contain" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                            <div>
                                                <h3 className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                    SEO Keyword Analysis
                                                </h3>
                                                <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                    Analyze Google keyword metrics and get AI SEO advice.
                                                </p>
                                            </div>
                                            {seoSeedCount > 0 && (
                                                <span className={`text-xs px-2.5 py-1 rounded-full ${isDarkMode ? 'bg-[#2d2d2f] text-[#86868b]' : 'bg-gray-100 text-gray-600'}`}>
                                                    {seoSeedCount} starter keywords
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {seoSeedKeywords.length > 0 && (
                                    <div className="mb-3 flex flex-wrap gap-2">
                                        {seoSeedKeywords.map((seed, idx) => (
                                            <button
                                                key={idx}
                                                type="button"
                                                onClick={() => {
                                                    setSeoKeyword(seed);
                                                    handleRunSeoAnalysis(seed);
                                                }}
                                                disabled={isRunningSeo || !canEdit}
                                                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${isDarkMode
                                                    ? 'border-[#3d3d3f] bg-[#111111] text-[#e5e5ea] hover:border-[#5ac8fa]'
                                                    : 'border-gray-200 bg-gray-50 text-gray-800 hover:border-blue-400'
                                                    } ${isRunningSeo ? 'opacity-60 cursor-wait' : ''}`}
                                            >
                                                {seed}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <div className="sm:col-span-2">
                                        <label className={`block text-[11px] mb-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                            Keyword
                                        </label>
                                        <input
                                            type="text"
                                            value={seoKeyword}
                                            onChange={e => setSeoKeyword(e.target.value)}
                                            placeholder={currentProject.name || 'e.g. sustainable living tips'}
                                            disabled={!canEdit}
                                            className={`w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${isDarkMode
                                                ? 'bg-[#111111] border border-[#3d3d3f]/60 text-white placeholder:text-[#636366]'
                                                : 'bg-white border border-gray-300 text-gray-900 placeholder:text-gray-500'
                                                }`}
                                        />
                                    </div>
                                    <div>
                                        <label className={`block text-[11px] mb-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                            Location
                                        </label>
                                        <select
                                            value={seoLocation}
                                            onChange={e => setSeoLocation(e.target.value)}
                                            disabled={!canEdit}
                                            className={`w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${isDarkMode
                                                ? 'bg-[#111111] border border-[#3d3d3f]/60 text-white'
                                                : 'bg-white border border-gray-300 text-gray-900'
                                                }`}
                                        >
                                            {SEO_COUNTRIES.map(country => (
                                                <option key={country.code} value={country.code}>
                                                    {country.label} ({country.code})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="mt-3 flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleRunSeoAnalysis()}
                                        disabled={isRunningSeo || !canEdit}
                                        className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${isRunningSeo
                                            ? 'bg-gray-500/60 text-white cursor-wait'
                                            : activeTheme === 'dark' || activeTheme === 'light'
                                                ? 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
                                                : `${currentTheme.primary} ${currentTheme.primaryHover} text-white`
                                            }`}
                                    >
                                        {isRunningSeo && (
                                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <circle cx="12" cy="12" r="10" className="opacity-25" />
                                                <path d="M4 12a8 8 0 018-8" className="opacity-75" />
                                            </svg>
                                        )}
                                        {isRunningSeo ? 'Analyzing…' : 'Run Analysis'}
                                    </button>
                                    {seoData && !isRunningSeo && (
                                        <button
                                            type="button"
                                            onClick={handleGenerateSeoBlog}
                                            disabled={isGeneratingSeoBlog || !canEdit}
                                            className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${isGeneratingSeoBlog
                                                ? 'bg-gray-500/60 text-white cursor-wait'
                                                : isDarkMode
                                                    ? 'bg-[#2d2d2f] text-white hover:bg-[#3d3d3f]'
                                                    : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                                                }`}
                                        >
                                            {isGeneratingSeoBlog && (
                                                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <circle cx="12" cy="12" r="10" className="opacity-25" />
                                                    <path d="M4 12a8 8 0 018-8" className="opacity-75" />
                                                </svg>
                                            )}
                                            {isGeneratingSeoBlog ? 'Generating…' : 'Generate Blog Ideas'}
                                        </button>
                                    )}
                                </div>

                                {seoError && <p className="mt-2 text-xs text-red-400">{seoError}</p>}
                                {seoBlogError && <p className="mt-2 text-xs text-red-400">{seoBlogError}</p>}
                                {seoBlogSaveMessage && (
                                    <p className={`mt-2 text-xs ${seoBlogSaveMessage.toLowerCase().includes('failed') ? 'text-red-400' : 'text-emerald-400'}`}>
                                        {seoBlogSaveMessage}
                                    </p>
                                )}
                            </div>

                            {seoData && (
                                <div className="mt-4 space-y-4">
                                    {Array.isArray(localSeoRows) && localSeoRows.length > 0 && (
                                        <div>
                                            <h4
                                                className={`text-xs font-semibold mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                                                    }`}
                                            >
                                                Keyword ideas (location: {seoLocation || 'US'})
                                            </h4>
                                            <div
                                                className={`overflow-hidden rounded-xl border ${isDarkMode
                                                    ? 'border-[#3d3d3f]/60 bg-[#111111]'
                                                    : 'border-gray-200 bg-white'
                                                    }`}
                                            >
                                                <div className="max-h-56 overflow-auto">
                                                    <table className="min-w-[860px] w-full text-[11px]">
                                                        <thead className={isDarkMode ? 'bg-[#18181b]' : 'bg-gray-50'}>
                                                            <tr>
                                                                <th className="px-3 py-2 text-left font-medium">Keyword</th>
                                                                <th className="px-3 py-2 text-right font-medium">Volume</th>
                                                                <th className="px-3 py-2 text-right font-medium">Comp. level</th>
                                                                <th className="px-3 py-2 text-right font-medium">Comp. index</th>
                                                                <th className="px-3 py-2 text-right font-medium">Low bid</th>
                                                                <th className="px-3 py-2 text-right font-medium">High bid</th>
                                                                <th className="px-3 py-2 text-right font-medium">Trend</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {localSeoRows.slice(0, 12).map((row: any, idx: number) => {
                                                                const volPct =
                                                                    localMaxVolume > 0 && typeof row.volume === 'number'
                                                                        ? Math.max(0, Math.min(100, (row.volume / localMaxVolume) * 100))
                                                                        : 0;
                                                                const compIdxPct =
                                                                    localMaxCompIndex > 0 && typeof row.competition_index === 'number'
                                                                        ? Math.max(
                                                                            0,
                                                                            Math.min(
                                                                                100,
                                                                                (row.competition_index / localMaxCompIndex) * 100,
                                                                            ),
                                                                        )
                                                                        : 0;
                                                                const lowBidPct =
                                                                    localMaxHighBid > 0 && typeof row.low_bid === 'number'
                                                                        ? Math.max(0, Math.min(100, (row.low_bid / localMaxHighBid) * 100))
                                                                        : 0;
                                                                const highBidPct =
                                                                    localMaxHighBid > 0 && typeof row.high_bid === 'number'
                                                                        ? Math.max(0, Math.min(100, (row.high_bid / localMaxHighBid) * 100))
                                                                        : 0;
                                                                const trendVal =
                                                                    typeof row.trend === 'number'
                                                                        ? row.trend
                                                                        : Number(row.trend ?? 0) || 0;
                                                                const trendAbsMax = localMaxTrendAbs || Math.abs(trendVal) || 1;
                                                                const trendPct = Math.max(
                                                                    0,
                                                                    Math.min(100, (Math.abs(trendVal) / trendAbsMax) * 100),
                                                                );
                                                                const trendColor =
                                                                    trendVal > 0
                                                                        ? isDarkMode
                                                                            ? 'bg-emerald-400'
                                                                            : 'bg-emerald-500'
                                                                        : trendVal < 0
                                                                            ? isDarkMode
                                                                                ? 'bg-rose-400'
                                                                                : 'bg-rose-500'
                                                                            : isDarkMode
                                                                                ? 'bg-slate-500'
                                                                                : 'bg-slate-400';

                                                                return (
                                                                    <tr
                                                                        key={idx}
                                                                        className={
                                                                            isDarkMode
                                                                                ? `border-t border-[#27272a] ${idx % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent'}`
                                                                                : `border-t border-gray-100 ${idx % 2 === 0 ? 'bg-gray-50/60' : 'bg-white'}`
                                                                        }
                                                                    >
                                                                        <td className="px-3 py-1.5 align-top truncate max-w-[180px]">
                                                                            <span title={row.text}>{row.text}</span>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">{row.volume ?? '-'}</div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${isDarkMode ? 'bg-sky-400' : 'bg-sky-500'}`}
                                                                                    style={{ width: `${volPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 text-right align-top">
                                                                            {row.competition_level ?? '-'}
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">
                                                                                {row.competition_index ?? '-'}
                                                                            </div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${isDarkMode ? 'bg-violet-400' : 'bg-violet-500'}`}
                                                                                    style={{ width: `${compIdxPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">{row.low_bid ?? '-'}</div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${isDarkMode ? 'bg-amber-400' : 'bg-amber-500'}`}
                                                                                    style={{ width: `${lowBidPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">{row.high_bid ?? '-'}</div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${isDarkMode ? 'bg-amber-400' : 'bg-amber-500'}`}
                                                                                    style={{ width: `${highBidPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">{row.trend ?? '-'}</div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${trendColor}`}
                                                                                    style={{ width: `${trendPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {seoData?.local && Array.isArray(seoData.local) && seoData.local.length > 0 && (
                                        <div className="mt-3 flex justify-end">
                                            <button
                                                type="button"
                                                onClick={() => handleCreateTableFromSeo('seo')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${activeTheme === 'dark'
                                                    ? 'bg-[#0071e3]/20 text-[#0a84ff] hover:bg-[#0071e3]/30'
                                                    : activeTheme === 'light'
                                                        ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                                        : `${currentTheme.primary}/20 ${currentTheme.accent} hover:${currentTheme.primary}/30`
                                                    }`}
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                </svg>
                                                Create Table
                                            </button>
                                        </div>
                                    )}

                                    {Array.isArray(globalSeoRows) && globalSeoRows.length > 0 && (
                                        <div>
                                            <h4
                                                className={`text-xs font-semibold mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                                                    }`}
                                            >
                                                Global results
                                            </h4>
                                            <div
                                                className={`overflow-hidden rounded-xl border ${isDarkMode
                                                    ? 'border-[#3d3d3f]/60 bg-[#111111]'
                                                    : 'border-gray-200 bg-white'
                                                    }`}
                                            >
                                                <div className="max-h-56 overflow-auto">
                                                    <table className="min-w-[860px] w-full text-[11px]">
                                                        <thead className={isDarkMode ? 'bg-[#18181b]' : 'bg-gray-50'}>
                                                            <tr>
                                                                <th className="px-3 py-2 text-left font-medium">Keyword</th>
                                                                <th className="px-3 py-2 text-right font-medium">Volume</th>
                                                                <th className="px-3 py-2 text-right font-medium">Comp. level</th>
                                                                <th className="px-3 py-2 text-right font-medium">Comp. index</th>
                                                                <th className="px-3 py-2 text-right font-medium">Low bid</th>
                                                                <th className="px-3 py-2 text-right font-medium">High bid</th>
                                                                <th className="px-3 py-2 text-right font-medium">Trend</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {globalSeoRows.slice(0, 12).map((row: any, idx: number) => {
                                                                const volPct =
                                                                    globalMaxVolume > 0 && typeof row.volume === 'number'
                                                                        ? Math.max(0, Math.min(100, (row.volume / globalMaxVolume) * 100))
                                                                        : 0;
                                                                const compIdxPct =
                                                                    globalMaxCompIndex > 0 && typeof row.competition_index === 'number'
                                                                        ? Math.max(
                                                                            0,
                                                                            Math.min(
                                                                                100,
                                                                                (row.competition_index / globalMaxCompIndex) * 100,
                                                                            ),
                                                                        )
                                                                        : 0;
                                                                const lowBidPct =
                                                                    globalMaxHighBid > 0 && typeof row.low_bid === 'number'
                                                                        ? Math.max(0, Math.min(100, (row.low_bid / globalMaxHighBid) * 100))
                                                                        : 0;
                                                                const highBidPct =
                                                                    globalMaxHighBid > 0 && typeof row.high_bid === 'number'
                                                                        ? Math.max(0, Math.min(100, (row.high_bid / globalMaxHighBid) * 100))
                                                                        : 0;
                                                                const trendVal =
                                                                    typeof row.trend === 'number'
                                                                        ? row.trend
                                                                        : Number(row.trend ?? 0) || 0;
                                                                const trendAbsMax = globalMaxTrendAbs || Math.abs(trendVal) || 1;
                                                                const trendPct = Math.max(
                                                                    0,
                                                                    Math.min(100, (Math.abs(trendVal) / trendAbsMax) * 100),
                                                                );
                                                                const trendColor =
                                                                    trendVal > 0
                                                                        ? isDarkMode
                                                                            ? 'bg-emerald-400'
                                                                            : 'bg-emerald-500'
                                                                        : trendVal < 0
                                                                            ? isDarkMode
                                                                                ? 'bg-rose-400'
                                                                                : 'bg-rose-500'
                                                                            : isDarkMode
                                                                                ? 'bg-slate-500'
                                                                                : 'bg-slate-400';

                                                                return (
                                                                    <tr
                                                                        key={idx}
                                                                        className={
                                                                            isDarkMode
                                                                                ? `border-t border-[#27272a] ${idx % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent'}`
                                                                                : `border-t border-gray-100 ${idx % 2 === 0 ? 'bg-gray-50/60' : 'bg-white'}`
                                                                        }
                                                                    >
                                                                        <td className="px-3 py-1.5 align-top truncate max-w-[180px]">
                                                                            <span title={row.text}>{row.text}</span>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">{row.volume ?? '-'}</div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${isDarkMode ? 'bg-sky-400' : 'bg-sky-500'}`}
                                                                                    style={{ width: `${volPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 text-right align-top">
                                                                            {row.competition_level ?? '-'}
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">
                                                                                {row.competition_index ?? '-'}
                                                                            </div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${isDarkMode ? 'bg-violet-400' : 'bg-violet-500'}`}
                                                                                    style={{ width: `${compIdxPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">{row.low_bid ?? '-'}</div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${isDarkMode ? 'bg-amber-400' : 'bg-amber-500'}`}
                                                                                    style={{ width: `${lowBidPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">{row.high_bid ?? '-'}</div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${isDarkMode ? 'bg-amber-400' : 'bg-amber-500'}`}
                                                                                    style={{ width: `${highBidPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">{row.trend ?? '-'}</div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${trendColor}`}
                                                                                    style={{ width: `${trendPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {Array.isArray(topSeoRows) && topSeoRows.length > 0 && (
                                        <div>
                                            <h4
                                                className={`text-xs font-semibold mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
                                                    }`}
                                            >
                                                Top opportunity keywords
                                            </h4>
                                            <div
                                                className={`overflow-hidden rounded-xl border ${isDarkMode
                                                    ? 'border-[#3d3d3f]/60 bg-[#111111]'
                                                    : 'border-gray-200 bg-white'
                                                    }`}
                                            >
                                                <div className="max-h-48 overflow-auto">
                                                    <table className="min-w-[860px] w-full text-[11px]">
                                                        <thead className={isDarkMode ? 'bg-[#18181b]' : 'bg-gray-50'}>
                                                            <tr>
                                                                <th className="px-3 py-2 text-left font-medium">Keyword</th>
                                                                <th className="px-3 py-2 text-right font-medium">Volume</th>
                                                                <th className="px-3 py-2 text-right font-medium">Comp. level</th>
                                                                <th className="px-3 py-2 text-right font-medium">Comp. index</th>
                                                                <th className="px-3 py-2 text-right font-medium">Low bid</th>
                                                                <th className="px-3 py-2 text-right font-medium">High bid</th>
                                                                <th className="px-3 py-2 text-right font-medium">Trend</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {topSeoRows.slice(0, 10).map((row: any, idx: number) => {
                                                                const volPct =
                                                                    topMaxVolume > 0 && typeof row.volume === 'number'
                                                                        ? Math.max(0, Math.min(100, (row.volume / topMaxVolume) * 100))
                                                                        : 0;
                                                                const compIdxPct =
                                                                    topMaxCompIndex > 0 && typeof row.competition_index === 'number'
                                                                        ? Math.max(
                                                                            0,
                                                                            Math.min(
                                                                                100,
                                                                                (row.competition_index / topMaxCompIndex) * 100,
                                                                            ),
                                                                        )
                                                                        : 0;
                                                                const lowBidPct =
                                                                    topMaxHighBid > 0 && typeof row.low_bid === 'number'
                                                                        ? Math.max(0, Math.min(100, (row.low_bid / topMaxHighBid) * 100))
                                                                        : 0;
                                                                const highBidPct =
                                                                    topMaxHighBid > 0 && typeof row.high_bid === 'number'
                                                                        ? Math.max(0, Math.min(100, (row.high_bid / topMaxHighBid) * 100))
                                                                        : 0;
                                                                const trendVal =
                                                                    typeof row.trend === 'number'
                                                                        ? row.trend
                                                                        : Number(row.trend ?? 0) || 0;
                                                                const trendAbsMax = topMaxTrendAbs || Math.abs(trendVal) || 1;
                                                                const trendPct = Math.max(
                                                                    0,
                                                                    Math.min(100, (Math.abs(trendVal) / trendAbsMax) * 100),
                                                                );
                                                                const trendColor =
                                                                    trendVal > 0
                                                                        ? isDarkMode
                                                                            ? 'bg-emerald-400'
                                                                            : 'bg-emerald-500'
                                                                        : trendVal < 0
                                                                            ? isDarkMode
                                                                                ? 'bg-rose-400'
                                                                                : 'bg-rose-500'
                                                                            : isDarkMode
                                                                                ? 'bg-slate-500'
                                                                                : 'bg-slate-400';

                                                                return (
                                                                    <tr
                                                                        key={idx}
                                                                        className={
                                                                            isDarkMode
                                                                                ? `border-t border-[#27272a] ${idx % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent'}`
                                                                                : `border-t border-gray-100 ${idx % 2 === 0 ? 'bg-gray-50/60' : 'bg-white'}`
                                                                        }
                                                                    >
                                                                        <td className="px-3 py-1.5 align-top truncate max-w-[220px]">
                                                                            <span title={row.text}>{row.text}</span>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">{row.volume ?? '-'}</div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${isDarkMode ? 'bg-sky-400' : 'bg-sky-500'}`}
                                                                                    style={{ width: `${volPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 text-right align-top">
                                                                            {row.competition_level ?? '-'}
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">
                                                                                {row.competition_index ?? '-'}
                                                                            </div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${isDarkMode ? 'bg-violet-400' : 'bg-violet-500'}`}
                                                                                    style={{ width: `${compIdxPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">{row.low_bid ?? '-'}</div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${isDarkMode ? 'bg-amber-400' : 'bg-amber-500'}`}
                                                                                    style={{ width: `${lowBidPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">{row.high_bid ?? '-'}</div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${isDarkMode ? 'bg-amber-400' : 'bg-amber-500'}`}
                                                                                    style={{ width: `${highBidPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-3 py-1.5 align-top">
                                                                            <div className="text-right">{row.trend ?? '-'}</div>
                                                                            <div
                                                                                className={`mt-1 h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-[#1f1f22]' : 'bg-gray-100'
                                                                                    }`}
                                                                            >
                                                                                <div
                                                                                    className={`h-full rounded-full ${trendColor}`}
                                                                                    style={{ width: `${trendPct}%` }}
                                                                                />
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {(seoAdvice || seoBlog) && (
                                <div className="mt-4 border-t border-white/5 pt-4">
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                        {seoAdvice && (
                                            <div
                                                className={`rounded-2xl border overflow-hidden ${isDarkMode
                                                    ? 'border-[#3d3d3f]/60 bg-[#111111]'
                                                    : 'border-gray-200 bg-white'
                                                    }`}
                                            >
                                                <div className={`px-3 py-2 border-b flex items-center justify-between gap-2 ${isDarkMode ? 'border-[#3d3d3f]/60' : 'border-gray-200'}`}>
                                                    <div className={`text-xs font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>AI analysis</div>
                                                    <button
                                                        type="button"
                                                        onClick={async () => {
                                                            try {
                                                                await navigator.clipboard.writeText(seoAdvice);
                                                            } catch {
                                                                // ignore
                                                            }
                                                        }}
                                                        className={`text-[11px] px-2 py-1 rounded-lg border ${isDarkMode ? 'border-[#3d3d3f]/60 text-[#86868b] hover:border-[#636366] hover:text-white' : 'border-gray-300 text-gray-700 hover:border-gray-400'}`}
                                                        title="Copy analysis"
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                                <div className="p-3 max-h-[520px] overflow-y-auto">
                                                    <ReactMarkdown
                                                        className={`prose prose-xs sm:prose-sm max-w-none ${isDarkMode ? 'prose-invert' : ''
                                                            }`}
                                                    >
                                                        {seoAdvice}
                                                    </ReactMarkdown>
                                                </div>
                                            </div>
                                        )}

                                        {seoBlog && (
                                            <div
                                                className={`rounded-2xl border overflow-hidden ${isDarkMode
                                                    ? 'border-[#3d3d3f]/60 bg-[#111111]'
                                                    : 'border-gray-200 bg-white'
                                                    }`}
                                            >
                                                <div className={`px-3 py-2 border-b flex items-center justify-between gap-2 ${isDarkMode ? 'border-[#3d3d3f]/60' : 'border-gray-200'}`}>
                                                    <div className="min-w-0">
                                                        <div className={`text-xs font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Blog draft</div>
                                                        <div className={`text-[11px] truncate ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>{seoBlog.title}</div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={async () => {
                                                            try {
                                                                const text = `${seoBlog.title || ''}\n\n${seoBlog.content || ''}`.trim();
                                                                await navigator.clipboard.writeText(text);
                                                            } catch {
                                                                // ignore
                                                            }
                                                        }}
                                                        className={`text-[11px] px-2 py-1 rounded-lg border ${isDarkMode ? 'border-[#3d3d3f]/60 text-[#86868b] hover:border-[#636366] hover:text-white' : 'border-gray-300 text-gray-700 hover:border-gray-400'}`}
                                                        title="Copy blog markdown"
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                                <div className="p-3 max-h-[520px] overflow-y-auto">
                                                    {seoBlog.subtitle && (
                                                        <p
                                                            className={`text-xs sm:text-sm mb-3 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'
                                                                }`}
                                                        >
                                                            {seoBlog.subtitle}
                                                        </p>
                                                    )}
                                                    <ReactMarkdown
                                                        className={`prose prose-xs sm:prose-sm max-w-none ${isDarkMode ? 'prose-invert' : ''
                                                            }`}
                                                    >
                                                        {seoBlog.content || ''}
                                                    </ReactMarkdown>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}


                        </div>
                    )}
                </div>

                {/* NOTES TAB */}
                <div style={{ display: activeTab === 'notes' ? 'block' : 'none' }}>
                    {(

                        <div className="h-auto sm:h-[calc(100vh-280px)]">
                            <NotesPanel
                                project={currentProject}
                                onProjectUpdate={handleProjectChange}
                                isDarkMode={isDarkMode}
                                readOnly={readOnly}
                                autoOpenNewNote={notesAutoNew}
                                initialNoteId={activeTab === 'notes' ? jumpToItemId : null}
                                onOpenNoteMap={() => setShowProjectNoteMap(true)}
                                updateFocus={updateFocus}
                                onlineCollaborators={onlineCollaborators}
                            />

                            {showProjectNoteMap &&
                                createPortal(
                                    <div className="fixed inset-0 z-[120]">
                                        <div
                                            className="absolute inset-0 bg-black/70"
                                            onClick={handleCloseProjectNoteMap}
                                            aria-hidden="true"
                                        />
                                        <div
                                            role="dialog"
                                            aria-modal="true"
                                            className={
                                                "absolute inset-0 m-0 rounded-none border-0 shadow-2xl overflow-hidden " +
                                                (isDarkMode ? 'bg-[#0b0f19] text-white' : 'bg-white text-gray-900')
                                            }
                                        >
                                            <div className={"flex items-center justify-between px-4 py-3 border-b " + (isDarkMode ? 'border-white/10' : 'border-gray-200')}>
                                                <div className="flex flex-col">
                                                    <div className="text-sm font-semibold">Project NoteMap</div>
                                                    <div className={"text-xs " + (isDarkMode ? 'text-white/60' : 'text-gray-500')}>
                                                        {currentProject.name}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleCloseProjectNoteMap}
                                                    className={
                                                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors " +
                                                        (isDarkMode ? 'bg-white/10 hover:bg-white/15 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900')
                                                    }
                                                >
                                                    Close
                                                </button>
                                            </div>
                                            <div className="h-[calc(100vh-56px)]">
                                                <NoteMap
                                                    onlineCollaborators={onlineCollaborators}
                                                    liveNodes={realtimeProject?.projectNoteMapState}
                                                    ownerUid={project.ownerUid || ''}
                                                    currentUserUid={currentUserUid || ''}
                                                    researchReport={aggregatedResearchReport}
                                                    currentProjectId={currentProject.id}
                                                    projectKnowledgeBaseFiles={projectNoteMapKnowledgeBaseFiles}
                                                    projectUploadedFiles={currentProject.uploadedFiles}
                                                    savedState={seedProjectNoteMapState}
                                                    isDarkMode={isDarkMode}
                                                    onUpdateState={(nextNodes) => {
                                                        latestProjectNoteMapStateRef.current = nextNodes;
                                                        const updatedProject: ResearchProject = {
                                                            ...currentProject,
                                                            projectNoteMapState: nextNodes,
                                                            lastModified: Date.now(),
                                                        };
                                                        handleProjectChange(updatedProject);
                                                        schedulePersistProjectNoteMap(nextNodes);
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>,
                                    document.body
                                )}
                        </div>
                    )}
                </div>

                {/* ASSETS TAB */}
                <div style={{ display: activeTab === 'assets' ? 'block' : 'none' }}>
                    {(
                        <ProjectAssets
                            project={currentProject}
                            isDarkMode={isDarkMode}
                            onFiltersChange={handleAssetsFilterChange}
                            onLoadResearch={onLoadResearch}
                            localProjectPodcasts={localProjectPodcasts}
                            onPlayPodcast={podcast => {
                                setActivePodcast(podcast);
                            }}
                            onProjectUpdate={handleProjectChange}
                            assetCount={assetCount}
                            initialFilters={currentAssetsFilter}
                            onShareToX={handleShareToX}
                            onPinToChat={handlePinToChat}
                            initialTable={seoTableToCreate || undefined}
                            userProfile={userProfile}
                            isSubscribed={!!isSubscribed}
                            onAssetCountChange={setAssetCount}
                            editRequest={editRequestAsset}
                            onEditRequestCleared={() => setEditRequestAsset(null)}
                            initialFocus={assetsInitialFocus}
                            googleSheetsAccessToken={googleSheetsAccessToken}
                            setGoogleSheetsAccessToken={setGoogleSheetsAccessToken}
                            googleDocsAccessToken={googleDocsAccessToken}
                            setGoogleDocsAccessToken={setGoogleDocsAccessToken}
                        />
                    )}
                </div>

                {/* Podcast tab hidden - keeping generator in Assets tab */}
                {
                    false && activeTab === ('podcast' as any) && (
                        <div className="h-[calc(100vh-260px)] sm:h-[calc(100vh-280px)] -mx-4 sm:-mx-6 lg:-mx-8">
                            <PodcastStudio
                                project={currentProject}
                                savedResearch={researchSessions}
                                isDarkMode={isDarkMode}
                                onProjectUpdate={(updatedProject) => {
                                    setCurrentProject(updatedProject);
                                    onProjectUpdate?.(updatedProject);
                                }}
                                onLocalPodcastAdd={handleLocalPodcastAdd}
                                isSubscribed={!!isSubscribed}
                            />
                        </div>
                    )
                }

                {/* DATA TAB */}
                <div style={{ display: activeTab === 'data' ? 'block' : 'none' }}>
                    {(
                        <DataTab
                            project={currentProject}
                            isDarkMode={isDarkMode}
                            activeTheme={activeTheme}
                            currentTheme={currentTheme}
                            onProjectUpdate={(updatedProject) => {
                                handleProjectChange(updatedProject);
                            }}
                            readOnly={readOnly}
                            initialFileId={activeTab === 'data' ? jumpToItemId : null}
                            onRequestEdit={handleRequestEdit}
                            onPinToChat={handlePinToChat}
                        />
                    )}
                </div>



                <div style={{ display: activeTab === 'social' ? 'block' : 'none' }}>
                    {(() => {
                        // Mode toggle element (extracted to avoid TypeScript type narrowing)
                        const modeToggle = (
                            <div className={`flex items-center gap-1 p-1 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-gray-100'}`}>
                                <button
                                    onClick={() => setSocialPublisherMode('unified')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${socialPublisherMode === 'unified'
                                        ? isDarkMode ? 'bg-[#3d3d3f] text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm'
                                        : isDarkMode ? 'text-[#86868b] hover:text-white' : 'text-gray-500 hover:text-gray-900'
                                        }`}
                                >
                                    Unified
                                </button>
                                <button
                                    onClick={() => setSocialPublisherMode('advanced')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${socialPublisherMode === 'advanced'
                                        ? isDarkMode ? 'bg-[#3d3d3f] text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm'
                                        : isDarkMode ? 'text-[#86868b] hover:text-white' : 'text-gray-500 hover:text-gray-900'
                                        }`}
                                >
                                    Advanced
                                </button>
                            </div>
                        );

                        return (
                            <div className="max-w-4xl mx-auto space-y-6">
                                {/* Unified Publisher Mode */}
                                {socialPublisherMode === 'unified' && (
                                    <UnifiedSocialPublisher
                                        userProfile={userProfile}
                                        project={currentProject}
                                        isDarkMode={isDarkMode}
                                        activeTheme={activeTheme}
                                        currentTheme={currentTheme}
                                        facebookConnected={facebookConnected}
                                        facebookProfile={facebookProfile}
                                        facebookAccessToken={facebookAccessTokenRef.current}
                                        igAccounts={igAccounts}
                                        selectedIgId={selectedIgId}
                                        setSelectedIgId={setSelectedIgId}
                                        handleFacebookConnect={handleFacebookConnect}
                                        handleFacebookLogout={handleFacebookLogout}
                                        loadInstagramAccounts={loadInstagramAccounts}
                                        tiktokConnected={tiktokConnected}
                                        tiktokCreatorInfo={tiktokCreatorInfo}
                                        handleTiktokConnect={handleTiktokConnect}
                                        handleTiktokDisconnect={handleTiktokDisconnect}
                                        youtubeConnected={youtubeConnected}
                                        youtubeChannel={youtubeChannel}
                                        handleYoutubeConnect={handleYoutubeConnect}
                                        handleYoutubeDisconnect={handleYoutubeDisconnect}
                                        linkedinConnected={linkedinConnected}
                                        linkedinProfile={linkedinProfile}
                                        handleLinkedinConnect={handleLinkedinConnect}
                                        handleLinkedinDisconnect={handleLinkedinDisconnect}
                                        xConnected={xConnected}
                                        xProfile={xProfile}
                                        handleXConnect={handleXConnect}
                                        handleXDisconnect={handleXDisconnect}
                                        fbPages={fbPages}
                                        loadFacebookPages={loadFacebookPages}
                                        fbPagesLoading={fbPagesLoading}
                                        headerRight={modeToggle}
                                        initialState={unifiedPublisherInitialState}
                                    />
                                )}

                                {/* Scheduled Posts Calendar */}
                                {socialPublisherMode === 'unified' && (
                                    <div className="mt-6">
                                        <ScheduleCalendar
                                            projectId={currentProject.id}
                                            isDarkMode={isDarkMode}
                                            activeTheme={activeTheme}
                                            currentTheme={currentTheme}
                                        />
                                    </div>
                                )}

                                {/* Advanced Mode - Original per-platform UI */}
                                {socialPublisherMode === 'advanced' && (
                                    <>
                                        <div className="flex justify-end mb-4">
                                            {modeToggle}
                                        </div>
                                        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200'}`}>
                                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                                                <div>
                                                    <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Platform Connections</h3>
                                                    <p className={`text-sm mt-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                        Manage individual platform connections and post to each separately.
                                                    </p>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => refreshFacebookStatus()}
                                                        disabled={!facebookSdkReady || facebookStatusLoading}
                                                        className={`px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                                                            ? 'bg-white/5 hover:bg-white/10 text-white border border-white/10'
                                                            : 'bg-gray-50 hover:bg-gray-100 text-gray-900 border border-gray-200'
                                                            }`}
                                                    >
                                                        {facebookStatusLoading ? 'Refreshing…' : 'Refresh'}
                                                    </button>

                                                    {facebookConnected ? (
                                                        <button
                                                            type="button"
                                                            onClick={handleFacebookLogout}
                                                            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${isDarkMode
                                                                ? 'bg-red-500/15 hover:bg-red-500/25 text-red-200 border border-red-500/30'
                                                                : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                                                                }`}
                                                        >
                                                            Log out
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={handleFacebookConnect}
                                                            disabled={!facebookSdkReady}
                                                            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                                                                ? 'bg-[#1877F2] hover:bg-[#166fe5] text-white'
                                                                : 'bg-[#1877F2] hover:bg-[#166fe5] text-white'
                                                                }`}
                                                        >
                                                            Connect Facebook
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {!facebookSdkReady && (
                                                <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-amber-500/10 text-amber-200 border border-amber-500/20' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                                                    Facebook SDK is not loaded. Set <code className="font-mono">VITE_FACEBOOK_APP_ID</code> and refresh.
                                                </div>
                                            )}

                                            {facebookError && (
                                                <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                    {facebookError}
                                                </div>
                                            )}

                                            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div className={`rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                                    <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Status</p>
                                                    <p className={`mt-2 text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                        {facebookConnected ? 'Connected' : 'Not connected'}
                                                    </p>
                                                </div>

                                                <div className={`rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                                    <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Account</p>
                                                    {facebookConnected && facebookProfile ? (
                                                        <div className="mt-2 flex items-center gap-3">
                                                            {facebookProfile?.picture?.data?.url && (
                                                                <img
                                                                    src={facebookProfile.picture.data.url}
                                                                    alt=""
                                                                    className="w-10 h-10 rounded-full object-cover"
                                                                />
                                                            )}
                                                            <div>
                                                                <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{facebookProfile?.name || 'Facebook User'}</p>
                                                                {facebookProfile?.email && (
                                                                    <p className={`text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>{facebookProfile.email}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <p className={`mt-2 text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                            Not connected.
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            <div className={`mt-6 rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                                    <div>
                                                        <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Instagram publishing</p>
                                                        <p className={`mt-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                            Publish a single image post to an Instagram professional account.
                                                        </p>
                                                        <p className={`mt-1 text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                            Image must be a public URL (Meta will fetch it). JPEG recommended.
                                                        </p>
                                                    </div>

                                                    <div className="flex items-center gap-2">

                                                        <button
                                                            type="button"
                                                            onClick={loadInstagramAccounts}
                                                            disabled={!facebookConnected || igAccountsLoading}
                                                            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                                                                ? 'bg-[#1877F2] hover:bg-[#166fe5] text-white shadow-sm'
                                                                : 'bg-[#1877F2] hover:bg-[#166fe5] text-white shadow-sm'
                                                                }`}
                                                        >
                                                            {igAccountsLoading ? 'Loading…' : 'Load accounts'}
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="mt-4 grid grid-cols-1 gap-4">
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <div>
                                                            <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Instagram account</label>
                                                            <select
                                                                value={selectedIgId}
                                                                onChange={(e) => setSelectedIgId(e.target.value)}
                                                                disabled={!facebookConnected || igAccountsLoading}
                                                                className={
                                                                    "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                    (isDarkMode
                                                                        ? 'bg-transparent border-white/10 text-white focus:ring-white/30'
                                                                        : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200')
                                                                }
                                                            >
                                                                {!igAccounts.length && <option value="">No Instagram accounts found</option>}
                                                                {igAccounts.map((a: any) => {
                                                                    const igId = String(a?.igId || '');
                                                                    const label = a?.igUsername
                                                                        ? `${a.igUsername} (Page: ${a?.pageName || 'Unknown'})`
                                                                        : `${igId} (Page: ${a?.pageName || 'Unknown'})`;
                                                                    return (
                                                                        <option key={igId} value={igId}>
                                                                            {label}
                                                                        </option>
                                                                    );
                                                                })}
                                                            </select>
                                                        </div>

                                                        <div>
                                                            <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Placement / Type</label>
                                                            <div className="flex bg-black/5 dark:bg-white/5 p-1 rounded-xl">
                                                                {(['FEED', 'STORY', 'REEL'] as const).map(t => (
                                                                    <button
                                                                        key={t}
                                                                        type="button"
                                                                        onClick={() => setIgPublishMediaType(t)}
                                                                        className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${igPublishMediaType === t
                                                                            ? (isDarkMode ? 'bg-[#3d3d3f] text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm')
                                                                            : (isDarkMode ? 'text-[#86868b] hover:text-white' : 'text-gray-500 hover:text-gray-900')
                                                                            }`}
                                                                    >
                                                                        {t}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <label className={`text-sm font-medium block ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                {igPublishMediaType === 'FEED' ? 'Media URLs (First is primary, add more for Carousel)' : 'Media URL'}
                                                            </label>
                                                            {igPublishMediaType === 'FEED' && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setIgPublishMediaUrls([...igPublishMediaUrls, ''])}
                                                                    className="text-xs text-blue-500 hover:text-blue-400 font-medium"
                                                                >
                                                                    + Add slide
                                                                </button>
                                                            )}
                                                        </div>

                                                        <div className="space-y-2">
                                                            {/* Primary Single URL for backward compatibility / simplicity */}
                                                            <input
                                                                value={igPublishImageUrl}
                                                                onChange={(e) => setIgPublishImageUrl(e.target.value)}
                                                                placeholder="https://example.com/primary-media.jpg"
                                                                className={
                                                                    "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                    (isDarkMode
                                                                        ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                        : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                                }
                                                                disabled={igPublishLoading}
                                                            />

                                                            {/* Carousel children */}
                                                            {igPublishMediaType === 'FEED' && igPublishMediaUrls.map((u, idx) => (
                                                                <div key={idx} className="flex gap-2">
                                                                    <input
                                                                        value={u}
                                                                        onChange={(e) => {
                                                                            const next = [...igPublishMediaUrls];
                                                                            next[idx] = e.target.value;
                                                                            setIgPublishMediaUrls(next);
                                                                        }}
                                                                        placeholder={`Slide ${idx + 2} URL`}
                                                                        className={
                                                                            "flex-1 rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                            (isDarkMode
                                                                                ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                                : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                                        }
                                                                        disabled={igPublishLoading}
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setIgPublishMediaUrls(igPublishMediaUrls.filter((_, i) => i !== idx))}
                                                                        className="text-gray-500 hover:text-red-500 transition-colors"
                                                                    >
                                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                                        </svg>
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Caption</label>
                                                        <textarea
                                                            value={igPublishCaption}
                                                            onChange={(e) => setIgPublishCaption(e.target.value)}
                                                            rows={3}
                                                            className={
                                                                "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                (isDarkMode
                                                                    ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                            }
                                                            disabled={igPublishLoading}
                                                        />
                                                    </div>

                                                    {igPublishMediaType === 'REEL' && (
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                id="ig-share-to-feed"
                                                                checked={igPublishShareToFeed}
                                                                onChange={(e) => setIgPublishShareToFeed(e.target.checked)}
                                                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                            />
                                                            <label htmlFor="ig-share-to-feed" className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                                                                Share to Feed
                                                            </label>
                                                        </div>
                                                    )}

                                                    <div className="flex items-center justify-between gap-4">
                                                        <button
                                                            type="button"
                                                            onClick={handleInstagramPublishDirect}
                                                            disabled={!facebookConnected || igPublishLoading || (igPublishPollingStatus && igPublishPollingStatus !== 'PUBLISHED' && igPublishPollingStatus !== 'UNKNOWN' && !igPublishPollingError)}
                                                            className={`px-6 py-2.5 rounded-full text-sm font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                                                                ? 'bg-[#1877F2] hover:bg-[#166fe5] text-white shadow-lg shadow-blue-500/20'
                                                                : 'bg-[#1877F2] hover:bg-[#166fe5] text-white shadow-lg shadow-blue-500/20'
                                                                }`}
                                                        >
                                                            {igPublishLoading ? 'Connecting…' : igPublishPollingStatus && igPublishPollingStatus !== 'PUBLISHED' && !igPublishPollingError ? `Publishing: ${igPublishPollingStatus}` : 'Publish to Instagram'}
                                                        </button>

                                                        {igPublishPollingStatus && (
                                                            <div className="flex items-center gap-2">
                                                                <div className={`w-2 h-2 rounded-full ${igPublishPollingStatus === 'PUBLISHED' ? 'bg-emerald-500' : igPublishPollingError ? 'bg-red-500' : 'bg-blue-500 animate-pulse'}`} />
                                                                <span className={`text-xs font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                    {igPublishPollingStatus}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {igPublishError && (
                                                        <div className={`rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                            {igPublishError}
                                                        </div>
                                                    )}

                                                    {igPublishPollingError && (
                                                        <div className={`rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                            Polling Error: {igPublishPollingError}
                                                        </div>
                                                    )}

                                                    {igPublishResult && (
                                                        <div className={`rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                                                            Successfully published! Media ID: <code className="font-mono text-xs">{String(igPublishResult?.mediaId || igPublishResult?.id || '')}</code>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>


                                            {/* Facebook Page Publishing Section */}
                                            <div className={`mt-6 rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                                    <div>
                                                        <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Facebook Page Publishing</p>
                                                        <p className={`mt-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                            Publish text, photos, or videos to your Facebook Pages.
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={loadFacebookPages}
                                                            disabled={!facebookConnected || fbPagesLoading}
                                                            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                                                                ? 'bg-[#1877F2] hover:bg-[#166fe5] text-white shadow-sm'
                                                                : 'bg-[#1877F2] hover:bg-[#166fe5] text-white shadow-sm'
                                                                }`}
                                                        >
                                                            {fbPagesLoading ? 'Loading Pages...' : 'Load Pages'}
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Status and Errors for Page Loading */}
                                                {fbPagesError && (
                                                    <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                        {fbPagesError}
                                                    </div>
                                                )}

                                                {/* Main Form */}
                                                <div className="mt-6 grid grid-cols-1 gap-5">
                                                    {/* Page Selection */}
                                                    <div>
                                                        <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Select Page</label>
                                                        <select
                                                            value={selectedFbPageId}
                                                            onChange={(e) => setSelectedFbPageId(e.target.value)}
                                                            disabled={!facebookConnected || fbPagesLoading || fbPages.length === 0}
                                                            className={
                                                                "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                (isDarkMode
                                                                    ? 'bg-transparent border-white/10 text-white focus:ring-white/30'
                                                                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200')
                                                            }
                                                        >
                                                            {!fbPages.length && <option value="">No Pages loaded</option>}
                                                            {fbPages.map((p: any) => (
                                                                <option key={p.id} value={p.id}>
                                                                    {p.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    {/* Post Type Toggles */}
                                                    <div>
                                                        <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Post Type</label>
                                                        <div className="flex bg-black/5 dark:bg-white/5 p-1 rounded-xl">
                                                            {(['TEXT', 'PHOTO', 'VIDEO'] as const).map(t => (
                                                                <button
                                                                    key={t}
                                                                    type="button"
                                                                    onClick={() => setFbPostType(t)}
                                                                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${fbPostType === t
                                                                        ? (isDarkMode ? 'bg-[#3d3d3f] text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm')
                                                                        : (isDarkMode ? 'text-[#86868b] hover:text-white' : 'text-gray-500 hover:text-gray-900')
                                                                        }`}
                                                                >
                                                                    {t}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Content Fields */}
                                                    <div className="space-y-4">
                                                        {/* Media URL Field (Photo/Video) */}
                                                        {(fbPostType === 'PHOTO' || fbPostType === 'VIDEO') && (
                                                            <div>
                                                                <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                    {fbPostType === 'PHOTO' ? 'Photo URL' : 'Video URL'}
                                                                </label>
                                                                <input
                                                                    value={fbPostMediaUrl}
                                                                    onChange={(e) => setFbPostMediaUrl(e.target.value)}
                                                                    placeholder={fbPostType === 'PHOTO' ? "https://example.com/image.jpg" : "https://example.com/video.mp4"}
                                                                    className={
                                                                        "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                        (isDarkMode
                                                                            ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                            : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                                    }
                                                                    disabled={fbPostLoading}
                                                                />
                                                            </div>
                                                        )}

                                                        {/* Video Title */}
                                                        {fbPostType === 'VIDEO' && (
                                                            <div>
                                                                <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                    Video Title
                                                                </label>
                                                                <input
                                                                    value={fbPostTitle}
                                                                    onChange={(e) => setFbPostTitle(e.target.value)}
                                                                    placeholder="My Video Title"
                                                                    className={
                                                                        "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                        (isDarkMode
                                                                            ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                            : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                                    }
                                                                    disabled={fbPostLoading}
                                                                />
                                                            </div>
                                                        )}

                                                        {/* Message / Caption / Description */}
                                                        <div>
                                                            <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                {fbPostType === 'TEXT' ? 'Message' : fbPostType === 'PHOTO' ? 'Caption' : 'Description'}
                                                            </label>
                                                            <textarea
                                                                value={fbPostMessage}
                                                                onChange={(e) => setFbPostMessage(e.target.value)}
                                                                rows={3}
                                                                placeholder="Write something..."
                                                                className={
                                                                    "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                    (isDarkMode
                                                                        ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                        : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                                }
                                                                disabled={fbPostLoading}
                                                            />
                                                        </div>

                                                        {/* Link for Text Post */}
                                                        {fbPostType === 'TEXT' && (
                                                            <div>
                                                                <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                    Link (Optional)
                                                                </label>
                                                                <input
                                                                    value={fbPostLink}
                                                                    onChange={(e) => setFbPostLink(e.target.value)}
                                                                    placeholder="https://example.com"
                                                                    className={
                                                                        "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                        (isDarkMode
                                                                            ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                            : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                                    }
                                                                    disabled={fbPostLoading}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Submit Button */}
                                                    <div>
                                                        <button
                                                            type="button"
                                                            onClick={handleFacebookPublish}
                                                            disabled={!facebookConnected || fbPostLoading || !selectedFbPageId}
                                                            className={`w-full sm:w-auto px-6 py-2.5 rounded-full text-sm font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                                                                ? 'bg-[#1877F2] hover:bg-[#166fe5] text-white shadow-lg shadow-blue-500/20'
                                                                : 'bg-[#1877F2] hover:bg-[#166fe5] text-white shadow-lg shadow-blue-500/20'
                                                                }`}
                                                        >
                                                            {fbPostLoading ? 'Publishing...' : 'Publish to Facebook Page'}
                                                        </button>
                                                    </div>

                                                    {/* Post Result Status */}
                                                    {fbPostError && (
                                                        <div className={`rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                            {fbPostError}
                                                        </div>
                                                    )}
                                                    {fbPostResult && (
                                                        <div className={`rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                                                            Successfully published! ID: <code className="font-mono text-xs">{String(fbPostResult?.id || fbPostResult?.post_id || '')}</code>
                                                        </div>
                                                    )}

                                                </div>
                                            </div>

                                            <div className={`mt-4 rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                                    <div>
                                                        <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Hashtag helper</p>
                                                        <p className={`mt-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                            Generate useful hashtags from your caption, and optionally research a hashtag’s top/recent posts.
                                                        </p>
                                                        <p className={`mt-1 text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                            Hashtag research is limited to 30 unique hashtags per 7 days (Meta limitation).
                                                        </p>
                                                    </div>

                                                    {/* <div className="flex items-center gap-2">
                    <button
                      type="button"
                      // onClick={buildHashtagSuggestions}
                      disabled={!facebookConnected}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                        ? 'bg-white/5 hover:bg-white/10 text-white border border-white/10'
                        : 'bg-white hover:bg-gray-100 text-gray-900 border border-gray-200'
                        }`}
                    >
                      Suggest hashtags
                    </button>

                    <button
                      type="button"
                      // onClick={applySuggestedHashtagsToCaption}
                      disabled={!facebookConnected} // || !suggestedHashtags.length}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                        ? 'bg-[#1877F2] hover:bg-[#166fe5] text-white'
                        : 'bg-[#1877F2] hover:bg-[#166fe5] text-white'
                        }`}
                    >
                      Add to caption
                    </button>
                  </div> */}
                                                </div>

                                                {/* {suggestedHashtags.length > 0 && (
                  <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-white/5 text-white border border-white/10' : 'bg-white text-gray-900 border border-gray-200'}`}>
                    <div className="flex flex-wrap gap-2">
                      {suggestedHashtags.map((h) => (
                        <span key={h} className={isDarkMode ? 'text-blue-200' : 'text-blue-700'}>{h}</span>
                      ))}
                    </div>
                  </div>
                )} */}

                                                <div className="mt-4 grid grid-cols-1 gap-3">
                                                    <div>
                                                        <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Hashtag research</label>
                                                        <div className="flex flex-col sm:flex-row gap-2">
                                                            <input
                                                                value={seoIgHashtagQuery}
                                                                onChange={(e) => setSeoIgHashtagQuery(e.target.value)}
                                                                placeholder="#yourhashtag"
                                                                className={
                                                                    "flex-1 rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                    (isDarkMode
                                                                        ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                        : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                                }
                                                                disabled={!facebookConnected || seoIgHashtagSearchLoading || seoIgMediaLoading}
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={handleSeoIgHashtagSearch}
                                                                disabled={!facebookConnected || seoIgHashtagSearchLoading || seoIgMediaLoading}
                                                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                                                                    ? 'bg-white/5 hover:bg-white/10 text-white border border-white/10'
                                                                    : 'bg-white hover:bg-gray-100 text-gray-900 border border-gray-200'
                                                                    }`}
                                                            >
                                                                {seoIgHashtagSearchLoading ? 'Searching…' : 'Search'}
                                                            </button>

                                                        </div>
                                                    </div>

                                                    {seoIgHashtagSearchError && (
                                                        <div className={`rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                            {seoIgHashtagSearchError}
                                                        </div>
                                                    )}

                                                    {seoIgMediaError && (
                                                        <div className={`rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                            {seoIgMediaError}
                                                        </div>
                                                    )}

                                                    {seoIgHashtagResult?.id && (
                                                        <div className={`rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-white/5 text-white border border-white/10' : 'bg-white text-gray-900 border border-gray-200'}`}>
                                                            Found hashtag ID: <code className="font-mono">{String(seoIgHashtagResult.id)}</code>
                                                        </div>
                                                    )}

                                                    {(seoIgTopMedia.length > 0 || seoIgRecentMedia.length > 0) && (
                                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                                            <div className={`rounded-2xl p-4 border ${isDarkMode ? 'bg-transparent border-white/10' : 'bg-white border-gray-200'}`}>
                                                                <p className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Top media</p>
                                                                <div className="mt-3 space-y-2">
                                                                    {seoIgTopMedia.slice(0, 10).map((m: any) => (
                                                                        <a
                                                                            key={String(m?.id || Math.random())}
                                                                            href={String(m?.permalink || '#')}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            className={
                                                                                "block rounded-lg px-3 py-2 border transition-colors " +
                                                                                (isDarkMode ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50')
                                                                            }
                                                                        >
                                                                            <div className="flex items-center justify-between gap-3">
                                                                                <span className={`text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>{String(m?.media_type || '')}</span>
                                                                                <span className={`text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                                                    ♥ {Number(m?.like_count || 0)} · 💬 {Number(m?.comments_count || 0)}
                                                                                </span>
                                                                            </div>
                                                                            {m?.caption && (
                                                                                <div className={`mt-1 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                                    {String(m.caption).slice(0, 90)}{String(m.caption).length > 90 ? '…' : ''}
                                                                                </div>
                                                                            )}
                                                                        </a>
                                                                    ))}
                                                                    {!seoIgTopMedia.length && (
                                                                        <p className={`text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>No top media loaded.</p>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <div className={`rounded-2xl p-4 border ${isDarkMode ? 'bg-transparent border-white/10' : 'bg-white border-gray-200'}`}>
                                                                <p className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Recent media (last 24h)</p>
                                                                <div className="mt-3 space-y-2">
                                                                    {seoIgRecentMedia.slice(0, 10).map((m: any) => (
                                                                        <a
                                                                            key={String(m?.id || Math.random())}
                                                                            href={String(m?.permalink || '#')}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            className={
                                                                                "block rounded-lg px-3 py-2 border transition-colors " +
                                                                                (isDarkMode ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50')
                                                                            }
                                                                        >
                                                                            <div className="flex items-center justify-between gap-3">
                                                                                <span className={`text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>{String(m?.media_type || '')}</span>
                                                                                <span className={`text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                                                    ♥ {Number(m?.like_count || 0)} · 💬 {Number(m?.comments_count || 0)}
                                                                                </span>
                                                                            </div>
                                                                            {m?.caption && (
                                                                                <div className={`mt-1 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                                    {String(m.caption).slice(0, 90)}{String(m.caption).length > 90 ? '…' : ''}
                                                                                </div>
                                                                            )}
                                                                        </a>
                                                                    ))}
                                                                    {!seoIgRecentMedia.length && (
                                                                        <p className={`text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>No recent media loaded.</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* TikTok Section */}
                                        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200'}`}>
                                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                                                <div>
                                                    <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>TikTok</h2>
                                                    <p className={`text-sm mt-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                        Connect your TikTok account to post videos directly.
                                                    </p>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    {tiktokConnected ? (
                                                        <button
                                                            type="button"
                                                            onClick={handleTiktokDisconnect}
                                                            disabled={tiktokLoading}
                                                            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode
                                                                ? 'bg-red-500/15 hover:bg-red-500/25 text-red-200 border border-red-500/30'
                                                                : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                                                                }`}
                                                        >
                                                            {tiktokLoading ? 'Disconnecting…' : 'Disconnect'}
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={handleTiktokConnect}
                                                            disabled={tiktokLoading}
                                                            className="px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed bg-black hover:bg-gray-800 text-white"
                                                        >
                                                            {tiktokLoading ? 'Connecting…' : 'Connect TikTok'}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {tiktokError && (
                                                <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                    {tiktokError}
                                                </div>
                                            )}

                                            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div className={`rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                                    <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Status</p>
                                                    <p className={`mt-2 text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                        {tiktokConnected ? 'Connected' : 'Not connected'}
                                                    </p>
                                                </div>

                                                <div className={`rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                                    <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Account</p>
                                                    {tiktokConnected && tiktokCreatorInfo ? (
                                                        <div className="mt-2 flex items-center gap-3">
                                                            {tiktokCreatorInfo.creatorAvatarUrl && (
                                                                <img
                                                                    src={tiktokCreatorInfo.creatorAvatarUrl}
                                                                    alt=""
                                                                    className="w-10 h-10 rounded-full object-cover"
                                                                />
                                                            )}
                                                            <div>
                                                                <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                    {tiktokCreatorInfo.creatorNickname || tiktokCreatorInfo.creatorUsername || 'TikTok User'}
                                                                </p>
                                                                {tiktokCreatorInfo.creatorUsername && (
                                                                    <p className={`text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>@{tiktokCreatorInfo.creatorUsername}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <p className={`mt-2 text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                            Not connected.
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            {tiktokConnected && (
                                                <div className={`mt-6 rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'}`}>

                                                    {/* Mode Switcher */}
                                                    <div className="flex items-center gap-2 mb-6">
                                                        <button
                                                            type="button"
                                                            onClick={() => setTiktokPostMode('video')}
                                                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tiktokPostMode === 'video'
                                                                ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200')
                                                                }`}
                                                        >
                                                            Post Video
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setTiktokPostMode('photo')}
                                                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tiktokPostMode === 'photo'
                                                                ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200')
                                                                }`}
                                                        >
                                                            Post Photos
                                                        </button>
                                                    </div>

                                                    {tiktokPostMode === 'video' ? (
                                                        <>
                                                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                                                <div>
                                                                    <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Post video to TikTok</p>
                                                                    <p className={`mt-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                        Post a video from a public URL. The URL must be from a verified domain.
                                                                    </p>
                                                                    {tiktokCreatorInfo && (
                                                                        <p className={`mt-1 text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                                            Max duration: {Math.floor(tiktokCreatorInfo.maxVideoPostDurationSec / 60)} minutes
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <div className="grid grid-cols-1 gap-3">
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setTiktokVideoSource('URL')}
                                                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tiktokVideoSource === 'URL'
                                                                            ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                            : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200')
                                                                            }`}
                                                                    >
                                                                        Public URL
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setTiktokVideoSource('ASSET')}
                                                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tiktokVideoSource === 'ASSET'
                                                                            ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                            : (isDarkMode ? 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 shadow-sm' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200')
                                                                            }`}
                                                                    >
                                                                        Project Asset
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setTiktokVideoSource('UPLOAD')}
                                                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tiktokVideoSource === 'UPLOAD'
                                                                            ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                            : (isDarkMode ? 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 shadow-sm' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200')
                                                                            }`}
                                                                    >
                                                                        Upload File
                                                                    </button>
                                                                </div>

                                                                {/* Post Mode Selector - only show for file uploads */}
                                                                {(tiktokVideoSource === 'UPLOAD' || tiktokVideoSource === 'ASSET') && (
                                                                    <div className="flex items-center gap-2 mb-2">
                                                                        <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Post Mode:</span>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setTiktokVideoPostMode('direct')}
                                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tiktokVideoPostMode === 'direct'
                                                                                ? (isDarkMode ? 'bg-emerald-600 text-white' : 'bg-emerald-600 text-white')
                                                                                : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200')
                                                                                }`}
                                                                        >
                                                                            Direct Post
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setTiktokVideoPostMode('inbox')}
                                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tiktokVideoPostMode === 'inbox'
                                                                                ? (activeTheme === 'dark' || activeTheme === 'light' ? 'bg-blue-600 text-white' : `${currentTheme.primary} text-white`)
                                                                                : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200')
                                                                                }`}
                                                                        >
                                                                            Inbox/Draft
                                                                        </button>
                                                                        <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                                                            {tiktokVideoPostMode === 'direct' ? '(Posts immediately)' : '(Review in TikTok app)'}
                                                                        </span>
                                                                    </div>
                                                                )}

                                                                {tiktokVideoSource === 'URL' && (
                                                                    <div>
                                                                        <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Video URL</label>
                                                                        <input
                                                                            value={tiktokVideoUrl}
                                                                            onChange={(e) => setTiktokVideoUrl(e.target.value)}
                                                                            placeholder="https://example.com/video.mp4"
                                                                            className={
                                                                                "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                                (isDarkMode
                                                                                    ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                                            }
                                                                            disabled={tiktokPostLoading}
                                                                        />
                                                                    </div>
                                                                )}

                                                                {tiktokVideoSource === 'ASSET' && (
                                                                    <div>
                                                                        <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Select Video Asset</label>
                                                                        <select
                                                                            value={tiktokSelectedAssetId}
                                                                            onChange={(e) => setTiktokSelectedAssetId(e.target.value)}
                                                                            className={
                                                                                "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                                (isDarkMode
                                                                                    ? 'bg-[#111111] border-white/10 text-white focus:ring-white/30'
                                                                                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200')
                                                                            }
                                                                            disabled={tiktokPostLoading}
                                                                        >
                                                                            <option value="">-- Choose a video --</option>
                                                                            {[...(project.knowledgeBase || []), ...(project.uploadedFiles || [])]
                                                                                .filter(file => (file as any).type?.startsWith('video/') || (file as any).mimeType?.startsWith('video/'))
                                                                                .map(file => (
                                                                                    <option key={(file as any).id || (file as any).name} value={(file as any).id || (file as any).name}>
                                                                                        {(file as any).name || (file as any).displayName}
                                                                                    </option>
                                                                                ))
                                                                            }
                                                                        </select>
                                                                    </div>
                                                                )}

                                                                {tiktokVideoSource === 'UPLOAD' && (
                                                                    <div>
                                                                        <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Upload Video File</label>
                                                                        <input
                                                                            type="file"
                                                                            accept="video/mp4,video/webm"
                                                                            onChange={(e) => setTiktokUploadFile(e.target.files?.[0] || null)}
                                                                            className={
                                                                                "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                                (isDarkMode
                                                                                    ? 'bg-transparent border-white/10 text-white focus:ring-white/30'
                                                                                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200')
                                                                            }
                                                                            disabled={tiktokPostLoading}
                                                                        />
                                                                        {tiktokUploadFile && (
                                                                            <p className={`mt-1 text-xs ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                                                                                Selected: {tiktokUploadFile.name} ({(tiktokUploadFile.size / (1024 * 1024)).toFixed(1)} MB)
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>

                                                            <div>
                                                                <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Caption</label>
                                                                <textarea
                                                                    value={tiktokVideoTitle}
                                                                    onChange={(e) => setTiktokVideoTitle(e.target.value)}
                                                                    rows={3}
                                                                    placeholder="Video caption with #hashtags and @mentions"
                                                                    className={
                                                                        "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                        (isDarkMode
                                                                            ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                            : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                                    }
                                                                    disabled={tiktokPostLoading}
                                                                />
                                                            </div>

                                                            <div>
                                                                <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Privacy</label>
                                                                <select
                                                                    value={tiktokPrivacyLevel}
                                                                    onChange={(e) => setTiktokPrivacyLevel(e.target.value)}
                                                                    disabled={tiktokPostLoading}
                                                                    className={
                                                                        "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                        (isDarkMode
                                                                            ? 'bg-transparent border-white/10 text-white focus:ring-white/30'
                                                                            : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200')
                                                                    }
                                                                >
                                                                    {(tiktokCreatorInfo?.privacyLevelOptions || ['SELF_ONLY']).map((opt) => (
                                                                        <option key={opt} value={opt}>
                                                                            {opt.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            <div className="flex flex-wrap gap-4">
                                                                <label className={`flex items-center gap-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={tiktokDisableDuet}
                                                                        onChange={(e) => setTiktokDisableDuet(e.target.checked)}
                                                                        disabled={tiktokPostLoading || tiktokCreatorInfo?.duetDisabled}
                                                                        className="rounded"
                                                                    />
                                                                    Disable Duet
                                                                </label>
                                                                <label className={`flex items-center gap-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={tiktokDisableStitch}
                                                                        onChange={(e) => setTiktokDisableStitch(e.target.checked)}
                                                                        disabled={tiktokPostLoading || tiktokCreatorInfo?.stitchDisabled}
                                                                        className="rounded"
                                                                    />
                                                                    Disable Stitch
                                                                </label>
                                                                <label className={`flex items-center gap-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={tiktokDisableComment}
                                                                        onChange={(e) => setTiktokDisableComment(e.target.checked)}
                                                                        disabled={tiktokPostLoading || tiktokCreatorInfo?.commentDisabled}
                                                                        className="rounded"
                                                                    />
                                                                    Disable Comments
                                                                </label>
                                                            </div>

                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={handleTiktokPostVideo}
                                                                    disabled={tiktokPostLoading}
                                                                    className="px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed bg-black hover:bg-gray-800 text-white"
                                                                >
                                                                    {tiktokPostLoading ? 'Posting…' : 'Post video'}
                                                                </button>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                                                <div>
                                                                    <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Post photos to TikTok</p>
                                                                    <p className={`mt-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                        Post a slideshow (2-35 images) from public URLs.
                                                                    </p>
                                                                </div>
                                                            </div>

                                                            <div className="mt-4 grid grid-cols-1 gap-3">
                                                                <div>
                                                                    <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Photo URLs (one per line)</label>
                                                                    <textarea
                                                                        value={tiktokPhotoUrls.join('\n')}
                                                                        onChange={(e) => setTiktokPhotoUrls(e.target.value.split('\n'))}
                                                                        rows={5}
                                                                        placeholder={`https://example.com/image1.jpg\nhttps://example.com/image2.jpg`}
                                                                        className={
                                                                            "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                            (isDarkMode
                                                                                ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                                : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                                        }
                                                                        disabled={tiktokPostLoading}
                                                                    />
                                                                    <p className={`mt-1 text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>{tiktokPhotoUrls.filter(u => u.trim()).length} images (min 2)</p>
                                                                </div>

                                                                <div>
                                                                    <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Title</label>
                                                                    <input
                                                                        value={tiktokPhotoTitle}
                                                                        onChange={(e) => setTiktokPhotoTitle(e.target.value)}
                                                                        placeholder="Slideshow title"
                                                                        className={
                                                                            "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                            (isDarkMode
                                                                                ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                                : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                                        }
                                                                        disabled={tiktokPostLoading}
                                                                    />
                                                                </div>

                                                                <div>
                                                                    <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Description</label>
                                                                    <textarea
                                                                        value={tiktokPhotoDescription}
                                                                        onChange={(e) => setTiktokPhotoDescription(e.target.value)}
                                                                        rows={2}
                                                                        placeholder="Description"
                                                                        className={
                                                                            "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                            (isDarkMode
                                                                                ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                                                : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                                                        }
                                                                        disabled={tiktokPostLoading}
                                                                    />
                                                                </div>

                                                                <div>
                                                                    <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Privacy</label>
                                                                    <select
                                                                        value={tiktokPrivacyLevel}
                                                                        onChange={(e) => setTiktokPrivacyLevel(e.target.value)}
                                                                        disabled={tiktokPostLoading}
                                                                        className={
                                                                            "w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                                            (isDarkMode
                                                                                ? 'bg-transparent border-white/10 text-white focus:ring-white/30'
                                                                                : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200')
                                                                        }
                                                                    >
                                                                        {(tiktokCreatorInfo?.privacyLevelOptions || ['SELF_ONLY']).map((opt) => (
                                                                            <option key={opt} value={opt}>
                                                                                {opt.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>

                                                                <div className="flex flex-wrap gap-4">
                                                                    <label className={`flex items-center gap-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={tiktokDisableComment}
                                                                            onChange={(e) => setTiktokDisableComment(e.target.checked)}
                                                                            disabled={tiktokPostLoading || tiktokCreatorInfo?.commentDisabled}
                                                                            className="rounded"
                                                                        />
                                                                        Disable Comments
                                                                    </label>
                                                                    <label className={`flex items-center gap-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={tiktokAutoAddMusic}
                                                                            onChange={(e) => setTiktokAutoAddMusic(e.target.checked)}
                                                                            disabled={tiktokPostLoading}
                                                                            className="rounded"
                                                                        />
                                                                        Auto Add Music
                                                                    </label>
                                                                </div>

                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={handleTiktokPostPhotos}
                                                                        disabled={tiktokPostLoading}
                                                                        className="px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed bg-black hover:bg-gray-800 text-white"
                                                                    >
                                                                        {tiktokPostLoading ? 'Posting…' : 'Post photos'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}

                                                    {tiktokPostError && (
                                                        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                            {tiktokPostError}
                                                        </div>
                                                    )}

                                                    {tiktokPostResult && (
                                                        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${tiktokPostResult.status === 'PUBLISH_COMPLETE'
                                                            ? isDarkMode ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                            : tiktokPostResult.status === 'FAILED'
                                                                ? isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'
                                                                : isDarkMode ? 'bg-amber-500/10 text-amber-200 border border-amber-500/20' : 'bg-amber-50 text-amber-700 border and border-amber-200'
                                                            }`}>
                                                            <div className="flex items-center justify-between">
                                                                <span>
                                                                    {tiktokPostResult.status === 'PUBLISH_COMPLETE' && '✓ Published successfully!'}
                                                                    {tiktokPostResult.status === 'FAILED' && '✗ Post failed'}
                                                                    {tiktokPostResult.status === 'PROCESSING_UPLOAD' && '⏳ Uploading…'}
                                                                    {tiktokPostResult.status === 'PROCESSING_DOWNLOAD' && '⏳ Downloading video…'}
                                                                    {tiktokPostResult.status === 'SEND_TO_USER_INBOX' && '📥 Sent to your TikTok inbox for review'}
                                                                    {!['PUBLISH_COMPLETE', 'FAILED', 'PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD', 'SEND_TO_USER_INBOX'].includes(tiktokPostResult.status || '') && `Status: ${tiktokPostResult.status}`}
                                                                </span>
                                                                <code className="font-mono text-xs opacity-70">{tiktokPostResult.publishId}</code>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* YouTube Section */}
                                        <div className={`mt-6 rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'
                                            }`}>
                                            <div className="flex gap-6 items-start">
                                                <div className={`mt-1.5 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isDarkMode ? 'bg-[#1d1d1f] text-red-500' : 'bg-red-50 text-red-600'}`}>
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                                        <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                                                    </svg>
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>YouTube</h3>
                                                            <p className={`text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                                Connect your YouTube channel to upload Videos and Shorts.
                                                            </p>
                                                        </div>
                                                        {!youtubeConnected ? (
                                                            <button
                                                                type="button"
                                                                onClick={handleYoutubeConnect}
                                                                className="px-4 py-2 rounded-full text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
                                                            >
                                                                Connect YouTube
                                                            </button>
                                                        ) : (
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm text-green-500 font-medium">Connected</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={handleYoutubeDisconnect}
                                                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${isDarkMode
                                                                        ? 'bg-red-500/15 hover:bg-red-500/25 text-red-200 border border-red-500/30'
                                                                        : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                                                                        }`}
                                                                >
                                                                    Disconnect
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className={`mt-6 rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'
                                                        }`}>
                                                        <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Account</p>
                                                        {youtubeConnected && youtubeChannel ? (
                                                            <div className="mt-2 flex items-center gap-3">
                                                                {youtubeChannel.thumbnailUrl && (
                                                                    <img src={youtubeChannel.thumbnailUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                                                                )}
                                                                <div>
                                                                    <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                        {youtubeChannel.title || 'YouTube Channel'}
                                                                    </p>
                                                                    <p className={`text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                                        {youtubeChannel.subscriberCount} subscribers • {youtubeChannel.videoCount} videos
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <p className={`mt-2 text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                                Not connected.
                                                            </p>
                                                        )}
                                                    </div>

                                                    {youtubeConnected && (
                                                        <div className={`mt-6 rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'
                                                            }`}>
                                                            <h4 className={`text-sm font-medium mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Upload Video</h4>

                                                            <div className="grid grid-cols-1 gap-4">
                                                                <div className="grid grid-cols-1 gap-3">
                                                                    <div className="flex items-center gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setYoutubeVideoSource('UPLOAD')}
                                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${youtubeVideoSource === 'UPLOAD'
                                                                                ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                                : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 shadow-sm')
                                                                                }`}
                                                                        >
                                                                            Upload File
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setYoutubeVideoSource('ASSET')}
                                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${youtubeVideoSource === 'ASSET'
                                                                                ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                                : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 shadow-sm')
                                                                                }`}
                                                                        >
                                                                            Project Asset
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setYoutubeVideoSource('URL')}
                                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${youtubeVideoSource === 'URL'
                                                                                ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                                : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 shadow-sm')
                                                                                }`}
                                                                        >
                                                                            Public URL
                                                                        </button>
                                                                    </div>

                                                                    {youtubeVideoSource === 'UPLOAD' && (
                                                                        <input
                                                                            type="file"
                                                                            accept="video/*"
                                                                            onChange={(e) => setYoutubeUploadFile(e.target.files?.[0] || null)}
                                                                            className={`w-full text-sm my-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}
                                                                        />
                                                                    )}
                                                                    {youtubeVideoSource === 'URL' && (
                                                                        <input
                                                                            type="text"
                                                                            placeholder="https://..."
                                                                            value={youtubeVideoUrl}
                                                                            onChange={(e) => setYoutubeVideoUrl(e.target.value)}
                                                                            className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-transparent border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                        />
                                                                    )}
                                                                    {youtubeVideoSource === 'ASSET' && (
                                                                        <select
                                                                            value={youtubeSelectedAssetId}
                                                                            onChange={(e) => setYoutubeSelectedAssetId(e.target.value)}
                                                                            className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-[#111111] border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                        >
                                                                            <option value="">-- Select Asset --</option>
                                                                            {[...(project.knowledgeBase || []), ...(project.uploadedFiles || [])]
                                                                                .filter(f => (f as any).type?.startsWith('video/') || (f as any).mimeType?.startsWith('video/'))
                                                                                .map(f => (
                                                                                    <option key={(f as any).id || (f as any).name} value={(f as any).id || (f as any).name}>
                                                                                        {(f as any).name || (f as any).displayName}
                                                                                    </option>
                                                                                ))
                                                                            }
                                                                        </select>
                                                                    )}
                                                                </div>

                                                                <div>
                                                                    <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Title</label>
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Video Title"
                                                                        value={youtubeVideoTitle}
                                                                        onChange={(e) => setYoutubeVideoTitle(e.target.value)}
                                                                        className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-transparent border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                    />
                                                                </div>

                                                                <div>
                                                                    <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Description</label>
                                                                    <textarea
                                                                        placeholder="Description..."
                                                                        value={youtubeVideoDescription}
                                                                        onChange={(e) => setYoutubeVideoDescription(e.target.value)}
                                                                        rows={3}
                                                                        className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-transparent border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                    />
                                                                </div>


                                                                <div>
                                                                    <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Category</label>
                                                                    <select
                                                                        value={youtubeCategoryId}
                                                                        onChange={(e) => setYoutubeCategoryId(e.target.value)}
                                                                        className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-[#111111] border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                    >
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
                                                                    <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Tags</label>
                                                                    <input
                                                                        type="text"
                                                                        placeholder="comma, separated, tags"
                                                                        value={youtubeTags}
                                                                        onChange={(e) => setYoutubeTags(e.target.value)}
                                                                        className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-transparent border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                    />
                                                                </div>

                                                                <div className="flex flex-col gap-3">
                                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={youtubeMadeForKids}
                                                                            onChange={(e) => setYoutubeMadeForKids(e.target.checked)}
                                                                            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                                                                        />
                                                                        <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Made for Kids</span>
                                                                    </label>

                                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={youtubeNotifySubscribers}
                                                                            onChange={(e) => setYoutubeNotifySubscribers(e.target.checked)}
                                                                            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                                                                        />
                                                                        <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Notify Subscribers</span>
                                                                    </label>
                                                                </div>

                                                                <div>
                                                                    <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Privacy</label>
                                                                    <select
                                                                        value={youtubePrivacyStatus}
                                                                        onChange={(e) => setYoutubePrivacyStatus(e.target.value as any)}
                                                                        className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-[#111111] border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                    >
                                                                        <option value="private">Private</option>
                                                                        <option value="unlisted">Unlisted</option>
                                                                        <option value="public">Public</option>
                                                                    </select>
                                                                </div>

                                                                <button
                                                                    type="button"
                                                                    onClick={handleYoutubePost}
                                                                    disabled={youtubeUploadLoading}
                                                                    className="mt-2 w-full sm:w-auto px-6 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50"
                                                                >
                                                                    {youtubeUploadLoading ? 'Uploading...' : 'Upload to YouTube'}
                                                                </button>

                                                                {youtubePostError && (
                                                                    <div className={`mt-2 rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                                        {youtubePostError}
                                                                    </div>
                                                                )}
                                                                {youtubePostSuccess && (
                                                                    <div className={`mt-2 rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                                                                        {youtubePostSuccess}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* LinkedIn Section */}
                                        <div className={`mt-6 rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'
                                            }`}>
                                            <div className="flex gap-6 items-start">
                                                <div className={`mt-1.5 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isDarkMode ? 'bg-[#1d1d1f] text-blue-500' : 'bg-blue-50 text-blue-600'}`}>
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                                        <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                                                    </svg>
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>LinkedIn</h3>
                                                            <p className={`text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                                Share posts, articles, images, and videos to your LinkedIn profile.
                                                            </p>
                                                        </div>
                                                        {!linkedinConnected ? (
                                                            <button
                                                                type="button"
                                                                onClick={handleLinkedinConnect}
                                                                className="px-4 py-2 rounded-full text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                                                            >
                                                                Connect LinkedIn
                                                            </button>
                                                        ) : (
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm text-green-500 font-medium">Connected</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={handleLinkedinDisconnect}
                                                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${isDarkMode
                                                                        ? 'bg-red-500/15 hover:bg-red-500/25 text-red-200 border border-red-500/30'
                                                                        : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                                                                        }`}
                                                                >
                                                                    Disconnect
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className={`mt-6 rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'
                                                        }`}>
                                                        <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Account</p>
                                                        {linkedinConnected && linkedinProfile ? (
                                                            <div className="mt-2 flex items-center gap-3">
                                                                {linkedinProfile.picture && (
                                                                    <img src={linkedinProfile.picture} alt="" className="w-10 h-10 rounded-full object-cover" />
                                                                )}
                                                                <div>
                                                                    <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                        {linkedinProfile.name || 'LinkedIn User'}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <p className={`mt-2 text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                                Not connected.
                                                            </p>
                                                        )}
                                                    </div>

                                                    {linkedinConnected && (
                                                        <div className={`mt-6 rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'
                                                            }`}>
                                                            <h4 className={`text-sm font-medium mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Create Post</h4>

                                                            <div className="grid grid-cols-1 gap-4">
                                                                {/* Post Type Selector */}
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    {(['TEXT', 'ARTICLE', 'IMAGE', 'VIDEO'] as const).map(type => (
                                                                        <button
                                                                            key={type}
                                                                            type="button"
                                                                            onClick={() => setLinkedinPostType(type)}
                                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${linkedinPostType === type
                                                                                ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                                : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 shadow-sm')
                                                                                }`}
                                                                        >
                                                                            {type === 'TEXT' ? 'Text' : type === 'ARTICLE' ? 'Article' : type === 'IMAGE' ? 'Image' : 'Video'}
                                                                        </button>
                                                                    ))}
                                                                </div>

                                                                {/* Post Text */}
                                                                <div>
                                                                    <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                        {linkedinPostType === 'TEXT' ? 'Post Content' : 'Caption'}
                                                                    </label>
                                                                    <textarea
                                                                        placeholder={linkedinPostType === 'TEXT' ? "What's on your mind?" : "Add a caption..."}
                                                                        value={linkedinPostText}
                                                                        onChange={(e) => setLinkedinPostText(e.target.value)}
                                                                        rows={linkedinPostType === 'TEXT' ? 4 : 2}
                                                                        className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-transparent border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                    />
                                                                </div>

                                                                {/* Article URL (for ARTICLE type) */}
                                                                {linkedinPostType === 'ARTICLE' && (
                                                                    <>
                                                                        <div>
                                                                            <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Article URL *</label>
                                                                            <input
                                                                                type="url"
                                                                                placeholder="https://..."
                                                                                value={linkedinArticleUrl}
                                                                                onChange={(e) => setLinkedinArticleUrl(e.target.value)}
                                                                                className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-transparent border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Title (optional)</label>
                                                                            <input
                                                                                type="text"
                                                                                placeholder="Article title"
                                                                                value={linkedinArticleTitle}
                                                                                onChange={(e) => setLinkedinArticleTitle(e.target.value)}
                                                                                className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-transparent border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Description (optional)</label>
                                                                            <input
                                                                                type="text"
                                                                                placeholder="Brief description"
                                                                                value={linkedinArticleDescription}
                                                                                onChange={(e) => setLinkedinArticleDescription(e.target.value)}
                                                                                className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-transparent border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                            />
                                                                        </div>
                                                                    </>
                                                                )}

                                                                {/* Media Source (for IMAGE/VIDEO types) */}
                                                                {(linkedinPostType === 'IMAGE' || linkedinPostType === 'VIDEO') && (
                                                                    <div className="grid grid-cols-1 gap-3">
                                                                        <div className="flex items-center gap-2">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setLinkedinMediaSource('UPLOAD')}
                                                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${linkedinMediaSource === 'UPLOAD'
                                                                                    ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                                    : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 shadow-sm')
                                                                                    }`}
                                                                            >
                                                                                Upload File
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setLinkedinMediaSource('ASSET')}
                                                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${linkedinMediaSource === 'ASSET'
                                                                                    ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                                    : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 shadow-sm')
                                                                                    }`}
                                                                            >
                                                                                Project Asset
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setLinkedinMediaSource('URL')}
                                                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${linkedinMediaSource === 'URL'
                                                                                    ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                                    : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 shadow-sm')
                                                                                    }`}
                                                                            >
                                                                                Public URL
                                                                            </button>
                                                                        </div>

                                                                        {linkedinMediaSource === 'UPLOAD' && (
                                                                            <input
                                                                                type="file"
                                                                                accept={linkedinPostType === 'IMAGE' ? 'image/*' : 'video/*'}
                                                                                onChange={(e) => setLinkedinUploadFile(e.target.files?.[0] || null)}
                                                                                className={`w-full text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}
                                                                            />
                                                                        )}
                                                                        {linkedinMediaSource === 'URL' && (
                                                                            <input
                                                                                type="text"
                                                                                placeholder="https://..."
                                                                                value={linkedinMediaUrl}
                                                                                onChange={(e) => setLinkedinMediaUrl(e.target.value)}
                                                                                className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-transparent border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                            />
                                                                        )}
                                                                        {linkedinMediaSource === 'ASSET' && (
                                                                            <select
                                                                                value={linkedinSelectedAssetId}
                                                                                onChange={(e) => setLinkedinSelectedAssetId(e.target.value)}
                                                                                className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-[#111111] border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                            >
                                                                                <option value="">-- Select Asset --</option>
                                                                                {[...(project.knowledgeBase || []), ...(project.uploadedFiles || [])]
                                                                                    .filter(f => linkedinPostType === 'IMAGE'
                                                                                        ? ((f as any).type?.startsWith('image/') || (f as any).mimeType?.startsWith('image/'))
                                                                                        : ((f as any).type?.startsWith('video/') || (f as any).mimeType?.startsWith('video/'))
                                                                                    )
                                                                                    .map(f => (
                                                                                        <option key={(f as any).id || (f as any).name} value={(f as any).id || (f as any).name}>
                                                                                            {(f as any).name || (f as any).displayName}
                                                                                        </option>
                                                                                    ))
                                                                                }
                                                                            </select>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {/* Visibility */}
                                                                <div>
                                                                    <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Visibility</label>
                                                                    <select
                                                                        value={linkedinVisibility}
                                                                        onChange={(e) => setLinkedinVisibility(e.target.value as any)}
                                                                        className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-[#111111] border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                    >
                                                                        <option value="PUBLIC">Public</option>
                                                                        <option value="CONNECTIONS">Connections Only</option>
                                                                    </select>
                                                                </div>

                                                                <button
                                                                    type="button"
                                                                    onClick={handleLinkedinPost}
                                                                    disabled={linkedinPostLoading}
                                                                    className="mt-2 w-full sm:w-auto px-6 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50"
                                                                >
                                                                    {linkedinPostLoading ? 'Posting...' : 'Post to LinkedIn'}
                                                                </button>

                                                                {linkedinPostError && (
                                                                    <div className={`mt-2 rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                                        {linkedinPostError}
                                                                    </div>
                                                                )}
                                                                {linkedinPostSuccess && (
                                                                    <div className={`mt-2 rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                                                                        {linkedinPostSuccess}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        {/* X (Twitter) Section */}
                                        <div id="x-post-section" className={`mt-8 pt-8 border-t ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                                            <div className="flex gap-6 items-start">
                                                <div className={`mt-1.5 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isDarkMode ? 'bg-[#1d1d1f] text-white' : 'bg-black text-white'}`}>
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                                    </svg>
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>X (Twitter)</h3>
                                                            <p className={`text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                                Share posts with text, images, and videos. Chunked upload is supported for large files.
                                                            </p>
                                                        </div>
                                                        {!xConnected ? (
                                                            <button
                                                                type="button"
                                                                onClick={handleXConnect}
                                                                className="px-4 py-2 rounded-full text-sm font-medium bg-black dark:bg-white dark:text-black text-white hover:opacity-80 transition-opacity"
                                                            >
                                                                Connect X
                                                            </button>
                                                        ) : (
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm text-green-500 font-medium">Connected</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={handleXDisconnect}
                                                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${isDarkMode
                                                                        ? 'bg-red-500/15 hover:bg-red-500/25 text-red-200 border border-red-500/30'
                                                                        : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                                                                        }`}
                                                                >
                                                                    Disconnect
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className={`mt-6 rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'
                                                        }`}>
                                                        <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Account</p>
                                                        {xConnected && xProfile ? (
                                                            <div className="mt-2 flex items-center gap-3">
                                                                {xProfile.profile_image_url && (
                                                                    <img src={xProfile.profile_image_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                                                                )}
                                                                <div>
                                                                    <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                                        {xProfile.name || xProfile.username || 'X User'}
                                                                    </p>
                                                                    {xProfile.username && (
                                                                        <p className={`text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>@{xProfile.username}</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <p className={`mt-2 text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                                Not connected.
                                                            </p>
                                                        )}
                                                    </div>

                                                    {xConnected && (
                                                        <div className={`mt-6 rounded-2xl p-5 border ${isDarkMode ? 'bg-[#111111] border-white/10' : 'bg-gray-50 border-gray-200'
                                                            }`}>
                                                            <h4 className={`text-sm font-medium mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Create Tweet</h4>

                                                            <div className="grid grid-cols-1 gap-4">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    {(['TEXT', 'IMAGE', 'VIDEO'] as const).map(type => (
                                                                        <button
                                                                            key={type}
                                                                            type="button"
                                                                            onClick={() => setXPostType(type)}
                                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${xPostType === type
                                                                                ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                                : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 shadow-sm')
                                                                                }`}
                                                                        >
                                                                            {type === 'TEXT' ? 'Text' : type === 'IMAGE' ? 'Image' : 'Video'}
                                                                        </button>
                                                                    ))}
                                                                </div>

                                                                <div>
                                                                    <label className={`text-sm font-medium block mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                                                                        }`}>
                                                                        Tweet Content
                                                                    </label>
                                                                    <textarea
                                                                        placeholder="What's happening?"
                                                                        value={xPostText}
                                                                        onChange={(e) => setXPostText(e.target.value)}
                                                                        rows={3}
                                                                        disabled={!canEdit}
                                                                        className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-transparent border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                    />
                                                                </div>

                                                                {(xPostType === 'IMAGE' || xPostType === 'VIDEO') && (
                                                                    <div className="grid grid-cols-1 gap-3">
                                                                        <div className="flex items-center gap-2">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setXMediaSource('UPLOAD')}
                                                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${xMediaSource === 'UPLOAD'
                                                                                    ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                                    : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 shadow-sm')
                                                                                    }`}
                                                                            >
                                                                                Upload File
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setXMediaSource('ASSET')}
                                                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${xMediaSource === 'ASSET'
                                                                                    ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white')
                                                                                    : (isDarkMode ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 shadow-sm')
                                                                                    }`}
                                                                            >
                                                                                Project Asset
                                                                            </button>
                                                                        </div>

                                                                        {xMediaSource === 'UPLOAD' && (
                                                                            <input
                                                                                type="file"
                                                                                accept={xPostType === 'IMAGE' ? 'image/*' : 'video/*'}
                                                                                onChange={(e) => setXUploadFile(e.target.files?.[0] || null)}
                                                                                disabled={!canEdit}
                                                                                className={`w-full text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}
                                                                            />
                                                                        )}
                                                                        {xMediaSource === 'ASSET' && (
                                                                            <select
                                                                                value={xSelectedAssetId}
                                                                                onChange={(e) => setXSelectedAssetId(e.target.value)}
                                                                                disabled={!canEdit}
                                                                                className={`w-full rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 ${isDarkMode ? 'bg-[#111111] border-white/10 text-white' : 'bg-white border-gray-300'}`}
                                                                            >
                                                                                <option value="">-- Select Asset --</option>
                                                                                {[...(project.knowledgeBase || []), ...(project.uploadedFiles || [])]
                                                                                    .filter(f => xPostType === 'IMAGE'
                                                                                        ? ((f as any).type?.startsWith('image/') || (f as any).mimeType?.startsWith('image/'))
                                                                                        : ((f as any).type?.startsWith('video/') || (f as any).mimeType?.startsWith('video/'))
                                                                                    )
                                                                                    .map(f => (
                                                                                        <option key={(f as any).id || (f as any).name} value={(f as any).id || (f as any).name}>
                                                                                            {(f as any).name || (f as any).displayName}
                                                                                        </option>
                                                                                    ))
                                                                                }
                                                                            </select>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                <button
                                                                    type="button"
                                                                    onClick={handleXPost}
                                                                    disabled={xPostLoading || !canEdit}
                                                                    className="mt-2 w-full sm:w-auto px-6 py-2 rounded-full bg-blue-500 hover:bg-blue-600 text-white font-medium disabled:opacity-50"
                                                                >
                                                                    {xPostLoading ? 'Posting...' : 'Post to X'}
                                                                </button>

                                                                {xPostError && (
                                                                    <div className={`mt-2 rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                                                        {xPostError}
                                                                    </div>
                                                                )}
                                                                {xPostSuccess && (
                                                                    <div className={`mt-2 rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                                                                        {xPostSuccess}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })()
                    }

                    {/* Post tab hidden */}
                    {
                        false && activeTab === ('post' as any) && (
                            <div className="h-auto min-h-[calc(100vh-280px)]">
                                <div className="flex flex-col lg:flex-row gap-6">
                                    {/* Left Sidebar: Profiles */}
                                    <div className="w-full lg:w-64 flex-shrink-0 space-y-4">
                                        <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]/60' : 'bg-white border-gray-200'}`}>
                                            <h3 className={`text-sm font-semibold mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Profiles</h3>

                                            <div className="space-y-2 mb-4">
                                                {upPostProfiles.map(p => (
                                                    <button
                                                        key={p.username}
                                                        onClick={() => {
                                                            setUpPostActiveProfile(p);
                                                            setUpPostProfileUsername(p.username);
                                                        }}
                                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${upPostActiveProfile?.username === p.username
                                                            ? isDarkMode ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700'
                                                            : isDarkMode ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-50 text-gray-700'
                                                            }`}
                                                    >
                                                        <div className="font-medium">{p.username}</div>
                                                        <div className="text-xs opacity-70">{Object.keys(p.social_accounts || {}).length} accounts</div>
                                                    </button>
                                                ))}
                                                {upPostProfiles.length === 0 && !upPostLoading && (
                                                    <div className={`text-xs text-center py-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                        No profiles yet
                                                    </div>
                                                )}
                                            </div>

                                            <div className="pt-3 border-t border-gray-200 dark:border-gray-800">
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={upPostProfileUsername}
                                                        onChange={e => setUpPostProfileUsername(e.target.value)}
                                                        placeholder="New username"
                                                        className={`flex-1 min-w-0 px-2 py-1.5 text-sm rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-500 ${isDarkMode ? 'bg-[#111] border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                                                            }`}
                                                    />
                                                    <button
                                                        onClick={handleUpPostCreateProfile}
                                                        disabled={upPostLoading || !upPostProfileUsername.trim()}
                                                        className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                                                    >
                                                        Add
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        {upPostActiveProfile && (
                                            <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]/60' : 'bg-white border-gray-200'}`}>
                                                <h3 className={`text-sm font-semibold mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Social Accounts</h3>
                                                <div className="space-y-2 mb-4">
                                                    {Object.entries(upPostActiveProfile.social_accounts || {}).map(([platform, data]: [string, any]) => (
                                                        <div key={platform} className="flex items-center justify-between text-sm">
                                                            <span className="capitalize text-gray-500 dark:text-gray-400">{platform}</span>
                                                            <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{data.name || data.username || 'Connected'}</span>
                                                        </div>
                                                    ))}
                                                    {Object.keys(upPostActiveProfile.social_accounts || {}).length === 0 && (
                                                        <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>No accounts linked</div>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={handleUpPostGenerateConnectUrl}
                                                    className="w-full px-4 py-2 text-sm font-medium text-blue-600 bg-blue-100 rounded-lg hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                                                >
                                                    Link New Account
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Main Content: Post Form */}
                                    <div className="flex-1 min-w-0 space-y-6">
                                        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]/60' : 'bg-white border-gray-200'}`}>
                                            <div className="flex items-center gap-4 mb-6 border-b border-gray-200 dark:border-gray-800 pb-4">
                                                {(['video', 'photo', 'text'] as const).map(type => (
                                                    <button
                                                        key={type}
                                                        onClick={() => setUpPostMediaType(type)}
                                                        className={`text-sm font-medium capitalize pb-1 relative ${upPostMediaType === type
                                                            ? isDarkMode ? 'text-white' : 'text-gray-900'
                                                            : isDarkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
                                                            }`}
                                                    >
                                                        {type}
                                                        {upPostMediaType === type && (
                                                            <div className="absolute bottom-[-17px] left-0 right-0 h-0.5 bg-blue-500" />
                                                        )}
                                                    </button>
                                                ))}
                                            </div>

                                            <div className="space-y-4">
                                                {/* Media Inputs */}
                                                {upPostMediaType === 'video' && (
                                                    <div>
                                                        <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Video URL</label>
                                                        <input
                                                            type="text"
                                                            value={upPostMediaUrl}
                                                            onChange={e => setUpPostMediaUrl(e.target.value)}
                                                            placeholder="https://example.com/video.mp4"
                                                            disabled={!canEdit}
                                                            className={`w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 ${isDarkMode ? 'bg-[#111] border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                                                                }`}
                                                        />
                                                    </div>
                                                )}
                                                {upPostMediaType === 'photo' && (
                                                    <div>
                                                        <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Photo URLs (one per line)</label>
                                                        <textarea
                                                            value={upPostPhotoUrls}
                                                            onChange={e => setUpPostPhotoUrls(e.target.value)}
                                                            rows={3}
                                                            placeholder="https://example.com/photo1.jpg"
                                                            disabled={!canEdit}
                                                            className={`w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 ${isDarkMode ? 'bg-[#111] border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                                                                }`}
                                                        />
                                                    </div>
                                                )}

                                                {/* Common Fields */}
                                                <div>
                                                    <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Title / Caption</label>
                                                    <input
                                                        type="text"
                                                        value={upPostTitle}
                                                        onChange={e => setUpPostTitle(e.target.value)}
                                                        disabled={!canEdit}
                                                        className={`w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 ${isDarkMode ? 'bg-[#111] border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                                                            }`}
                                                    />
                                                </div>

                                                <div>
                                                    <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Description (Optional)</label>
                                                    <textarea
                                                        value={upPostDescription}
                                                        onChange={e => setUpPostDescription(e.target.value)}
                                                        rows={3}
                                                        disabled={!canEdit}
                                                        className={`w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 ${isDarkMode ? 'bg-[#111] border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                                                            }`}
                                                    />
                                                </div>

                                                <div>
                                                    <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Scheduled Date (Optional, UTC)</label>
                                                    <input
                                                        type="datetime-local"
                                                        value={upPostScheduleDate}
                                                        onChange={e => setUpPostScheduleDate(e.target.value)}
                                                        disabled={!canEdit}
                                                        className={`w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 ${isDarkMode ? 'bg-[#111] border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                                                            }`}
                                                    />
                                                </div>

                                                {/* Platforms */}
                                                <div>
                                                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Post to</label>
                                                    <div className="flex flex-wrap gap-3">
                                                        {['tiktok', 'instagram', 'facebook', 'linkedin', 'x', 'youtube'].map(p => (
                                                            <label key={p} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border cursor-pointer select-none transition-colors ${upPostPlatforms.includes(p)
                                                                ? 'bg-blue-600 border-blue-600 text-white'
                                                                : isDarkMode ? 'border-gray-700 bg-[#111] text-gray-400 hover:border-gray-600' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                                                }`}>
                                                                <input
                                                                    type="checkbox"
                                                                    className="hidden"
                                                                    checked={upPostPlatforms.includes(p)}
                                                                    onChange={e => {
                                                                        if (e.target.checked) setUpPostPlatforms(prev => [...prev, p]);
                                                                        else setUpPostPlatforms(prev => prev.filter(x => x !== p));
                                                                    }}
                                                                />
                                                                <span className="capitalize">{p === 'x' ? 'X (Twitter)' : p}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Facebook Pages */}
                                                {upPostPlatforms.includes('facebook') && upPostFacebookPages.length > 0 && (
                                                    <div>
                                                        <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Facebook Page</label>
                                                        <select
                                                            value={upPostFacebookPageId}
                                                            onChange={e => setUpPostFacebookPageId(e.target.value)}
                                                            disabled={!canEdit}
                                                            className={`w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 ${isDarkMode ? 'bg-[#111] border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                                                                }`}
                                                        >
                                                            {upPostFacebookPages.map(page => (
                                                                <option key={page.page_id} value={page.page_id}>{page.page_name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                )}

                                                {/* Error / Result */}
                                                {upPostError && (
                                                    <div className="p-3 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded-lg text-sm">
                                                        {upPostError}
                                                    </div>
                                                )}
                                                {upPostResult && (
                                                    <div className="p-3 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded-lg text-sm">
                                                        Request sent! ID: {upPostResult.id || 'Unknown'}
                                                    </div>
                                                )}

                                                {/* Submit */}
                                                <div className="pt-2">
                                                    <button
                                                        onClick={handleUpPostSubmit}
                                                        disabled={upPostPosting || !canEdit}
                                                        className={`w-full py-2.5 rounded-lg font-medium text-white transition-colors ${upPostPosting ? 'bg-gray-500 cursor-wait' : 'bg-black hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200'
                                                            }`}
                                                    >
                                                        {upPostPosting ? 'Posting...' : 'Post Now' + (upPostScheduleDate ? ' (Scheduled)' : '')}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right Sidebar: History */}
                                    <div className="w-full lg:w-80 flex-shrink-0">
                                        <div className={`p-4 rounded-2xl border h-full ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]/60' : 'bg-white border-gray-200'}`}>
                                            <div className="flex items-center justify-between mb-4">
                                                <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>History</h3>
                                                <button onClick={loadUpPostHistory} className="text-xs text-blue-500 hover:text-blue-400">Refresh</button>
                                            </div>

                                            <div className="space-y-3">
                                                {upPostHistoryLoading ? (
                                                    <div className="text-center py-4 text-gray-500 text-sm">Loading...</div>
                                                ) : upPostHistory.length === 0 ? (
                                                    <div className="text-center py-4 text-gray-500 text-sm">No history found</div>
                                                ) : (
                                                    upPostHistory.map((item, idx) => (
                                                        <div key={idx} className={`p-3 rounded-lg border text-sm ${isDarkMode ? 'border-gray-800 bg-black/20' : 'border-gray-100 bg-gray-50'}`}>
                                                            <div className="flex justify-between items-start mb-1">
                                                                <span className={`font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>{item.status}</span>
                                                                <span className="text-xs text-gray-500">{new Date(item.created_at).toLocaleDateString()}</span>
                                                            </div>
                                                            <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'} line-clamp-1`}>{item.title}</div>
                                                            <div className="mt-2 flex flex-wrap gap-1">
                                                                {(item.platforms || []).map((p: string) => (
                                                                    <span key={p} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-200 dark:bg-gray-700 dark:text-gray-300 text-gray-700 capitalize">
                                                                        {p}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                </div>



                {/* EMAIL TAB */}
                <div style={{ display: activeTab === 'email' ? 'block' : 'none' }}>
                    {(
                        <div className="h-[calc(100vh-220px)]">
                            <EmailBuilder
                                isDarkMode={isDarkMode}
                                initialFocus={emailInitialFocus}
                                projectId={project.id}
                                savedTemplates={project.emailTemplates || []}
                                products={project.stripeProducts || []}
                                assets={project.uploadedFiles || []}
                                onUploadAsset={async (file: File) => {
                                    if (!project.id) throw new Error("Project ID missing");

                                    // Use storageService.uploadKnowledgeBaseFile which uploads to Vercel Blob
                                    // (same as other image uploads in the app) to avoid CORS issues with Firebase Storage
                                    const kbFile = await storageService.uploadKnowledgeBaseFile(project.id, file, undefined, { skipIndexing: true });

                                    return kbFile.url;
                                }}
                                onSaveTemplate={handleEmailBuilderSaveTemplate}
                                onShowAssetSelector={handleShowEmailAssetSelector}
                                authFetch={authFetch}
                                savedTables={
                                    // Aggregate all tables from research sessions
                                    (project.researchSessions || []).flatMap(session =>
                                        (session.researchReport?.tables || []) as any[]
                                    )
                                }
                                projectName={project.name || ''}
                                projectDescription={project.description || ''}
                                logoUrl=""
                                uid={project.ownerUid}
                            />
                        </div>
                    )}
                </div>

                {/* Inspo Tab - Inspiration images and videos */}
                {/* INSPO TAB */}
                <div style={{ display: activeTab === 'inspo' ? 'block' : 'none' }}>
                    {(
                        <div className="h-[calc(100vh-220px)] overflow-y-auto p-6 relative">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Inspiration Board</h3>
                                    <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Curated content based on your project</p>
                                </div>
                                <button
                                    onClick={loadInspoContent}
                                    disabled={inspoLoading || !canEdit}
                                    className={`p-2 rounded-lg transition-colors ${isDarkMode
                                        ? 'hover:bg-white/10 text-gray-400 hover:text-white'
                                        : 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'
                                        }`}
                                    title="Refresh Content"
                                >
                                    <svg className={`w-5 h-5 ${inspoLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                </button>
                            </div>

                            {/* Floating Refresh Button */}
                            {/* Floating Refresh Button - Visible only when content exists */}
                            {/* Floating Refresh Button removed */}

                            {/* Error state */}
                            {inspoError && (
                                <div className={`p-4 rounded-xl mb-6 ${isDarkMode ? 'bg-red-500/10 border border-red-500/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
                                    <div className="flex items-center gap-2">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span>{inspoError}</span>
                                    </div>
                                </div>
                            )}

                            {/* Loading skeleton */}
                            {inspoLoading && inspoImages.length === 0 && inspoVideos.length === 0 && inspoIgPosts.length === 0 && inspoTweets.length === 0 && (
                                <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
                                    {[...Array(12)].map((_, i) => (
                                        <div
                                            key={i}
                                            className={`break-inside-avoid rounded-xl overflow-hidden ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'} animate-pulse`}
                                            style={{ height: `${150 + Math.random() * 150}px` }}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* Empty state */}
                            {!inspoLoading && inspoImages.length === 0 && inspoVideos.length === 0 && inspoIgPosts.length === 0 && inspoTweets.length === 0 && !inspoError && (
                                <div className={`flex flex-col items-center justify-center py-20 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                    <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                    </svg>
                                    <p className="text-lg font-medium mb-2">No inspiration found</p>
                                    <p className="text-sm mb-4">Click Refresh to load images and videos</p>
                                    <button
                                        onClick={loadInspoContent}
                                        className={`px-4 py-2 rounded-xl text-sm font-medium ${isDarkMode
                                            ? 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
                                            : 'bg-blue-500 hover:bg-blue-600 text-white'
                                            }`}
                                    >
                                        Load Inspiration
                                    </button>
                                </div>
                            )}

                            {/* Masonry grid with images and videos */}
                            {(inspoImages.length > 0 || inspoVideos.length > 0 || inspoIgPosts.length > 0 || inspoTweets.length > 0) && (
                                <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
                                    {/* Interleave images, videos, IG posts, and Tweets for variety */}
                                    {(() => {
                                        const combined: Array<{ type: 'image' | 'video' | 'instagram' | 'tweet'; data: any; key: string }> = [];

                                        // Add all images first as base
                                        inspoImages.forEach((img, i) => {
                                            combined.push({ type: 'image', data: img, key: `img-${i}` });
                                        });

                                        // Insert videos at intervals
                                        inspoVideos.forEach((vid, i) => {
                                            const insertAt = Math.min(2 + i * 4, combined.length);
                                            combined.splice(insertAt, 0, { type: 'video', data: vid, key: `vid-${i}` });
                                        });

                                        // Insert Instagram posts
                                        inspoIgPosts.forEach((post, i) => {
                                            // Try to space them out differently than videos
                                            const insertAt = Math.min(1 + i * 3, combined.length);
                                            combined.splice(insertAt, 0, { type: 'instagram', data: post, key: `ig-${post.id}` });
                                        });

                                        // Insert Tweets
                                        inspoTweets.forEach((tweet, i) => {
                                            // Space them out
                                            const insertAt = Math.min(3 + i * 4, combined.length);
                                            combined.splice(insertAt, 0, { type: 'tweet', data: tweet, key: `tw-${tweet.id}` });
                                        });

                                        return combined.map((item) => {
                                            if (item.type === 'tweet') {
                                                const tweet = item.data;
                                                return (
                                                    <a
                                                        key={item.key}
                                                        href={`https://twitter.com/i/web/status/${tweet.id}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className={`block break-inside-avoid rounded-xl p-4 mb-4 group cursor-pointer transition-transform hover:scale-[1.02] ${isDarkMode ? 'bg-[#1d1d1f] border border-[#3d3d3f]' : 'bg-white shadow-sm border border-gray-100'}`}
                                                    >
                                                        <div className="flex items-center gap-2 mb-2">
                                                            {tweet.user?.profile_image_url ? (
                                                                <img
                                                                    src={tweet.user.profile_image_url}
                                                                    alt={tweet.user.name}
                                                                    className="w-8 h-8 rounded-full object-cover"
                                                                />
                                                            ) : (
                                                                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs">X</div>
                                                            )}
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center gap-1">
                                                                    <p className={`text-sm font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{tweet.user?.name || 'Unknown'}</p>
                                                                    {tweet.user?.verified && <span className="text-blue-400 text-[10px]">☑️</span>}
                                                                </div>
                                                                <p className={`text-xs truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>@{tweet.user?.username}</p>
                                                            </div>
                                                            <div className="text-gray-400">
                                                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                                                            </div>
                                                        </div>
                                                        <p className={`text-sm mb-3 whitespace-pre-wrap ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>{tweet.text}</p>
                                                        <div className={`flex items-center gap-4 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                            <span title="Likes">❤️ {tweet.public_metrics?.like_count || 0}</span>
                                                            <span title="Retweets">🔁 {tweet.public_metrics?.retweet_count || 0}</span>
                                                            <span title="Date">{new Date(tweet.created_at).toLocaleDateString()}</span>
                                                        </div>
                                                    </a>
                                                );
                                            }

                                            if (item.type === 'instagram') {
                                                const post = item.data;
                                                return (
                                                    <a
                                                        key={item.key}
                                                        href={post.permalink}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className={`block break-inside-avoid rounded-xl overflow-hidden group cursor-pointer transition-transform hover:scale-[1.02] ${isDarkMode ? 'bg-[#1d1d1f]' : 'bg-white shadow-sm'}`}
                                                    >
                                                        <div className="relative">
                                                            {post.media_url && (
                                                                <img
                                                                    src={post.media_url}
                                                                    alt={post.caption || 'Instagram Post'}
                                                                    className="w-full h-auto object-cover"
                                                                    loading="lazy"
                                                                />
                                                            )}
                                                            <div className="absolute top-2 right-2 bg-black/50 p-1.5 rounded-full backdrop-blur-sm">
                                                                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                                                                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                                                                </svg>
                                                            </div>
                                                            <div className={`absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 to-transparent`}>
                                                                <p className="text-white text-xs font-medium line-clamp-2">{post.caption || 'Instagram Post'}</p>
                                                                <div className="text-white/70 text-[10px] mt-1 flex items-center gap-2">
                                                                    <span>❤️ {post.like_count || 0}</span>
                                                                    <span>💬 {post.comments_count || 0}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </a>
                                                );
                                            }

                                            if (item.type === 'image') {
                                                const img = item.data;
                                                const imageUrl = img.properties?.url || img.thumbnail?.src || img.url;
                                                const title = img.title || 'Image';
                                                const isSaving = savingInspoImages.has(imageUrl);

                                                return (
                                                    <div
                                                        key={item.key}
                                                        className={`block break-inside-avoid rounded-xl overflow-hidden group cursor-pointer transition-transform hover:scale-[1.02] ${isDarkMode ? 'bg-[#1d1d1f]' : 'bg-white shadow-sm'
                                                            }`}
                                                    >
                                                        <div className="relative">
                                                            <img
                                                                src={img.thumbnail?.src || imageUrl}
                                                                alt={title}
                                                                className="w-full h-auto object-cover"
                                                                loading="lazy"
                                                                onClick={() => window.open(imageUrl, '_blank')}
                                                                onError={(e) => {
                                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                                }}
                                                            />
                                                            {/* Hover overlay with title */}
                                                            <div className={`absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end justify-start p-3 opacity-0 group-hover:opacity-100 pointer-events-none`}>
                                                                <span className="text-white text-xs font-medium line-clamp-2 drop-shadow-lg">
                                                                    {title}
                                                                </span>
                                                            </div>
                                                            {/* Save button - appears on hover */}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    saveInspoImageToAssets(imageUrl, title);
                                                                }}
                                                                disabled={isSaving}
                                                                className={`absolute top-2 right-2 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all ${isSaving
                                                                    ? 'bg-gray-500 cursor-not-allowed'
                                                                    : 'bg-white/90 hover:bg-white shadow-lg hover:scale-110'
                                                                    }`}
                                                                title="Save to Assets"
                                                            >
                                                                {isSaving ? (
                                                                    <svg className="w-4 h-4 text-gray-600 animate-spin" fill="none" viewBox="0 0 24 24">
                                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                                                    </svg>
                                                                ) : (
                                                                    <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                                    </svg>
                                                                )}
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            } else {
                                                const vid = item.data as YoutubeVideo;

                                                if (playingVideoId === vid.id) {
                                                    return (
                                                        <div
                                                            key={item.key}
                                                            className="break-inside-avoid rounded-xl overflow-hidden mb-4 shadow-sm bg-black aspect-video"
                                                        >
                                                            <iframe
                                                                src={`https://www.youtube.com/embed/${vid.id}?autoplay=1`}
                                                                title={vid.title}
                                                                className="w-full h-full"
                                                                frameBorder="0"
                                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                                allowFullScreen
                                                            />
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div
                                                        key={item.key}
                                                        onClick={() => setPlayingVideoId(vid.id)}
                                                        className={`block break-inside-avoid rounded-xl overflow-hidden group cursor-pointer transition-transform hover:scale-[1.02] mb-4 ${isDarkMode ? 'bg-[#1d1d1f]' : 'bg-white shadow-sm'
                                                            }`}
                                                    >
                                                        <div className="relative">
                                                            <img
                                                                src={vid.thumbnail}
                                                                alt={vid.title}
                                                                className="w-full h-auto object-cover aspect-video"
                                                                loading="lazy"
                                                            />
                                                            {/* YouTube play overlay */}
                                                            <div className="absolute inset-0 flex items-center justify-center">
                                                                <div className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                                                    <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                                                        <path d="M8 5v14l11-7z" />
                                                                    </svg>
                                                                </div>
                                                            </div>
                                                            {/* Video info overlay */}
                                                            <div className={`absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 to-transparent`}>
                                                                <p className="text-white text-xs font-medium line-clamp-2">{vid.title}</p>
                                                                <p className="text-white/70 text-xs mt-1">{vid.channel}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                        });
                                    })()}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* STUDIO TAB */}
                <div style={{ display: activeTab === 'studio' ? 'block' : 'none' }}>
                    {(
                        <VideoStudio
                            project={currentProject}
                            onProjectUpdate={handleProjectChange}
                            isDarkMode={isDarkMode}
                            activeTheme={activeTheme}
                            onShare={handleShareAsset}
                        />
                    )}
                </div>

                {/* CHAT TAB */}
                <div style={{ display: activeTab === 'chat' ? 'block' : 'none' }}>
                    <ProjectChat
                        project={currentProject}
                        ownerUid={project.ownerUid || currentUserUid || ''}
                        isDarkMode={isDarkMode}
                        onlineUsers={allOnlineUsers}
                        currentUserUid={currentUserUid}
                        currentUserName={currentAuthUser?.displayName || null}
                        currentUserPhoto={currentAuthUser?.photoURL || null}
                        onNavigate={(tab, itemId) => {
                            if (tab === 'assets') {
                                setAssetsInitialFilter(['all']);
                            }
                            if (itemId) {
                                setJumpToItemId(itemId);
                            }
                            setActiveTab(tab);
                        }}
                    />
                </div>


            </div >

            {/* Email Asset Picker Modal */}
            {
                isEmailAssetPickerOpen && (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                        onClick={() => handleResolveEmailAsset(null)}
                    >
                        <div
                            className={`w-full max-w-4xl max-h-[80vh] rounded-2xl shadow-2xl overflow-hidden ${isDarkMode ? 'bg-[#1d1d1f] border border-[#3d3d3f]' : 'bg-white border border-gray-200'}`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                            Select Image
                                        </h3>
                                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                            Choose an image from your project assets
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => handleResolveEmailAsset(null)}
                                        className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-[#86868b]' : 'hover:bg-gray-100 text-gray-500'}`}
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>

                                {/* Search */}
                                <div className="mt-3">
                                    <input
                                        type="text"
                                        value={emailAssetSearch}
                                        onChange={(e) => setEmailAssetSearch(e.target.value)}
                                        placeholder="Search images..."
                                        className={`w-full text-sm rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${isDarkMode
                                            ? 'bg-[#111111] border border-[#3d3d3f]/60 text-white placeholder:text-[#636366]'
                                            : 'bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-500'
                                            }`}
                                    />
                                </div>
                            </div>

                            {/* Content */}
                            <div className="p-6 overflow-y-auto max-h-[calc(80vh-140px)]">
                                {(() => {
                                    // Aggregate assets from all sessions + uploaded files
                                    // Note: assetsBySession contains session assets. We also need project.uploadedFiles
                                    // But project.uploadedFiles might not be in AssetItem format.
                                    // Looking at ProjectAssets.tsx logic, it usually maps them.
                                    // Here we will do a best-effort aggregation.

                                    // Aggregate assets from all sessions + uploaded files
                                    const derivedSessionAssets = (project.researchSessions || []).flatMap(s => {
                                        const assets = s.assets || [];
                                        const files = (s.uploadedFiles || []).map(f => ({
                                            id: f.id,
                                            type: 'image', // Assume image for now, or check f.type/f.name
                                            title: f.name,
                                            url: f.url,
                                            timestamp: f.uploadedAt,
                                            researchTopic: s.topic,
                                            mimeType: f.type
                                        }));
                                        return [...assets, ...files];
                                    });

                                    const projectUploads = (project.uploadedFiles || []).map(f => ({
                                        id: f.url, // Use URL as ID for simple uploads
                                        type: f.mimeType?.startsWith('image/') ? 'image' : 'file',
                                        title: f.name,
                                        url: f.url,
                                        timestamp: Date.now(),
                                        researchTopic: 'Project Upload'
                                    }));

                                    // Include images from project.knowledgeBase (Assets > Images tab source)
                                    const knowledgeBaseImages = (project.knowledgeBase || [])
                                        .filter(f => f.type?.startsWith('image/'))
                                        .map(f => ({
                                            id: f.id || f.url,
                                            type: 'image',
                                            title: f.name,
                                            url: f.url,
                                            timestamp: f.uploadedAt || Date.now(),
                                            researchTopic: 'Knowledge Base',
                                            mimeType: f.type
                                        }));

                                    const allPotentialAssets = [...derivedSessionAssets, ...projectUploads, ...knowledgeBaseImages];

                                    const imageAssets = allPotentialAssets.filter((asset: any) => {
                                        // Check if it's an image
                                        const isImage =
                                            asset.type === 'image' ||
                                            ['header', 'slide', 'notemap', 'social'].includes(asset.type) ||
                                            (typeof asset.type === 'string' && asset.type.startsWith('image/')) ||
                                            (typeof asset.mimeType === 'string' && asset.mimeType.startsWith('image/')) ||
                                            (asset.data && asset.data.imageUrl);

                                        if (!isImage) return false;

                                        // Filter by search
                                        if (emailAssetSearch.trim()) {
                                            const query = emailAssetSearch.toLowerCase();
                                            const title = (asset.title || '').toLowerCase();
                                            const desc = (asset.description || '').toLowerCase();
                                            return title.includes(query) || desc.includes(query);
                                        }
                                        return true;
                                    });

                                    if (imageAssets.length === 0) {
                                        return (
                                            <div className="text-center py-12">
                                                <p className={`text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                    {emailAssetSearch ? 'No images found matching your search' : 'No image assets available'}
                                                </p>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                            {imageAssets.map((asset: any) => {
                                                const imageUrl = asset.url || asset.data?.imageUrl;
                                                if (!imageUrl) return null;

                                                return (
                                                    <button
                                                        key={asset.id}
                                                        onClick={() => handleResolveEmailAsset(imageUrl)}
                                                        className={`group relative aspect-square rounded-xl overflow-hidden border-2 border-transparent transition-all ${isDarkMode
                                                            ? 'hover:border-[#0071e3] bg-[#2d2d2f]'
                                                            : 'hover:border-[#0071e3] bg-gray-100'
                                                            }`}
                                                    >
                                                        <img
                                                            src={imageUrl}
                                                            alt={asset.title}
                                                            className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                                        />
                                                        {asset.title && (
                                                            <div className={`absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t ${isDarkMode ? 'from-black/80' : 'from-gray-900/80'}`}>
                                                                <p className="text-xs text-white font-medium truncate">{asset.title}</p>
                                                            </div>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Share Modal */}
            {
                showShareModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div
                            className="absolute inset-0 bg-black/50"
                            onClick={handleCloseShareModal}
                            aria-hidden="true"
                        />
                        <div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="share-modal-title"
                            className={
                                "relative z-10 w-full max-w-xl rounded-2xl border shadow-2xl " +
                                (isDarkMode ? 'bg-[#1b1b1f] border-white/10 text-white' : 'bg-white border-gray-200 text-gray-900')
                            }
                        >
                            <div className="flex items-start justify-between p-6 border-b border-white/5">
                                <div>
                                    <h2 id="share-modal-title" className="text-xl font-semibold">
                                        Share project
                                    </h2>
                                    <p className={(isDarkMode ? 'text-gray-400' : 'text-gray-500') + " text-sm mt-1"}>
                                        Invite teammates to collaborate. Editors can edit content, viewers can only view.
                                    </p>
                                </div>
                                <button
                                    onClick={handleCloseShareModal}
                                    className={
                                        "p-2 rounded-full transition-colors " +
                                        (isDarkMode ? 'hover:bg-white/10 text-gray-300' : 'hover:bg-gray-100 text-gray-500')
                                    }
                                    aria-label="Close share modal"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="p-6 space-y-6">
                                <div className="space-y-3">
                                    {organizationMembers.length > 0 && (
                                        <div className={"mb-6 p-4 rounded-xl border " + (isDarkMode ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50")}>
                                            <h3 className="text-sm font-medium uppercase tracking-wide text-gray-500 mb-3 flex items-center justify-between">
                                                <span>{organization?.name || 'Organization'} Members</span>
                                                <span className={"text-xs normal-case px-2 py-0.5 rounded-full " + (isDarkMode ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-700")}>
                                                    {organizationMembers.length} available
                                                </span>
                                            </h3>
                                            <div className="grid gap-2 max-h-48 overflow-y-auto pr-1">
                                                {organizationMembers.map(member => (
                                                    <div key={member.email} className={"flex items-center justify-between p-2 rounded-lg transition-colors group " + (isDarkMode ? "hover:bg-white/10" : "hover:bg-gray-200")}>
                                                        <div className="flex items-center gap-3 overflow-hidden">
                                                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold uppercase shrink-0">
                                                                {member.displayName?.substring(0, 2) || member.email?.substring(0, 2)}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className={"text-sm font-medium truncate " + (isDarkMode ? 'text-white' : 'text-gray-900')}>{member.displayName || member.email?.split('@')[0]}</p>
                                                                <p className={"text-xs truncate " + (isDarkMode ? 'text-gray-400' : 'text-gray-500')}>{member.email}</p>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => setShareEmail(member.email || '')}
                                                            className={"text-xs font-medium px-3 py-1.5 rounded-full transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 " + (
                                                                shareEmail === member.email
                                                                    ? 'bg-green-500 text-white shadow-sm'
                                                                    : isDarkMode
                                                                        ? 'bg-white text-black hover:bg-gray-200'
                                                                        : 'bg-black text-white hover:bg-gray-800'
                                                            )}
                                                        >
                                                            {shareEmail === member.email ? 'Selected' : 'Add'}
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <label className="text-sm font-medium block">Invite by email</label>
                                    <div className="flex flex-col sm:flex-row gap-3">
                                        <input
                                            type="email"
                                            value={shareEmail}
                                            onChange={(e) => {
                                                setShareEmail(e.target.value);
                                                if (shareStatus?.type) setShareStatus(null);
                                            }}
                                            placeholder="teammate@example.com"
                                            className={
                                                "flex-1 rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                (isDarkMode
                                                    ? 'bg-transparent border-white/10 text-white focus:ring-white/30 placeholder:text-gray-500'
                                                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200 placeholder:text-gray-400')
                                            }
                                            disabled={inviteLoading}
                                        />
                                        <select
                                            value={shareRole}
                                            onChange={(e) => setShareRole(e.target.value as 'editor' | 'viewer')}
                                            className={
                                                "rounded-lg px-3 py-2 border focus:outline-none focus:ring-2 " +
                                                (isDarkMode
                                                    ? 'bg-transparent border-white/10 text-white focus:ring-white/30'
                                                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-200')
                                            }
                                            disabled={inviteLoading}
                                        >
                                            <option value="editor">Editor</option>
                                            <option value="viewer">Viewer</option>
                                        </select>
                                        <button
                                            onClick={handleInviteCollaborator}
                                            disabled={inviteLoading || !shareEmail.trim()}
                                            className={
                                                "inline-flex items-center justify-center rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed " +
                                                (isDarkMode ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white')
                                            }
                                        >
                                            {inviteLoading ? 'Inviting…' : 'Invite'}
                                        </button>
                                    </div>
                                    {shareStatus && (
                                        <div
                                            className={
                                                "rounded-lg px-3 py-2 text-sm " +
                                                (shareStatus.type === 'success'
                                                    ? isDarkMode
                                                        ? 'bg-emerald-500/10 text-emerald-300'
                                                        : 'bg-emerald-50 text-emerald-600'
                                                    : isDarkMode
                                                        ? 'bg-red-500/10 text-red-300'
                                                        : 'bg-red-50 text-red-600')
                                            }
                                        >
                                            {shareStatus.message}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-sm font-medium uppercase tracking-wide text-gray-500">
                                                Collaborators
                                            </h3>
                                            <p className={(isDarkMode ? 'text-gray-500' : 'text-gray-500') + " text-xs"}>
                                                Owner: {ownerDisplayName}
                                            </p>
                                        </div>
                                    </div>

                                    {sortedCollaborators.length === 0 ? (
                                        <div
                                            className={
                                                "rounded-xl border p-6 text-center text-sm " +
                                                (isDarkMode
                                                    ? 'border-white/10 bg-white/5 text-gray-400'
                                                    : 'border-gray-200 bg-gray-50 text-gray-500')
                                            }
                                        >
                                            No collaborators yet. Invite someone above to get started.
                                        </div>
                                    ) : (
                                        <div
                                            className={
                                                "rounded-xl border divide-y " +
                                                (isDarkMode
                                                    ? 'border-white/10 divide-white/5 bg-white/5'
                                                    : 'border-gray-200 divide-gray-100 bg-gray-50')
                                            }
                                        >
                                            {sortedCollaborators.map((collaborator) => (
                                                <div
                                                    key={collaborator.uid}
                                                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4"
                                                >
                                                    <div>
                                                        <p className="text-sm font-medium">
                                                            {collaborator.email || collaborator.uid}
                                                        </p>
                                                        <p className={(isDarkMode ? 'text-gray-400' : 'text-gray-500') + " text-xs"}>
                                                            {roleLabelMap[collaborator.role]}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span
                                                            className={
                                                                "text-xs px-2 py-0.5 rounded-full capitalize " +
                                                                (collaborator.role === 'editor'
                                                                    ? isDarkMode
                                                                        ? 'bg-emerald-500/20 text-emerald-300'
                                                                        : 'bg-emerald-100 text-emerald-700'
                                                                    : isDarkMode
                                                                        ? 'bg-amber-500/20 text-amber-300'
                                                                        : 'bg-amber-100 text-amber-700')
                                                            }
                                                        >
                                                            {collaborator.role}
                                                        </span>
                                                        <button
                                                            onClick={() => handleRemoveCollaborator(collaborator.uid)}
                                                            disabled={removingCollaboratorId === collaborator.uid}
                                                            className={
                                                                "text-xs font-medium px-3 py-1 rounded-full transition-colors " +
                                                                (isDarkMode
                                                                    ? 'text-red-300 hover:text-red-200 hover:bg-red-500/10'
                                                                    : 'text-red-600 hover:text-red-700 hover:bg-red-50')
                                                            }
                                                        >
                                                            {removingCollaboratorId === collaborator.uid ? 'Removing…' : 'Remove'}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }





            {/* Quick Add Task Modal */}
            {
                isQuickAddTaskModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div
                            className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
                            onClick={() => setIsQuickAddTaskModalOpen(false)}
                        />
                        <div className={`relative w-full max-w-md rounded-2xl shadow-2xl p-6 ${activeTheme === 'dark'
                            ? 'bg-[#1c1c1e] ring-1 ring-white/10'
                            : 'bg-white'
                            }`}>
                            <h3 className={`text-lg font-semibold mb-4 ${activeTheme === 'dark' ? 'text-white' : 'text-gray-900'
                                }`}>
                                Quick Add Task
                            </h3>

                            <div className="space-y-4">
                                <div>
                                    <label className={`block text-xs font-medium mb-1.5 ${activeTheme === 'dark' ? 'text-white/60' : 'text-gray-500'
                                        }`}>
                                        Title
                                    </label>
                                    <input
                                        type="text"
                                        value={quickTaskTitle}
                                        onChange={e => setQuickTaskTitle(e.target.value)}
                                        placeholder="Task title..."
                                        autoFocus
                                        className={`w-full px-4 py-2.5 rounded-xl text-sm border focus:outline-none focus:ring-2 transition-all ${activeTheme === 'dark'
                                            ? 'bg-white/5 border-white/10 focus:border-blue-500/50 focus:ring-blue-500/20 text-white placeholder-white/30'
                                            : 'bg-white border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 text-gray-900'
                                            }`}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') handleQuickAddTask();
                                        }}
                                    />
                                </div>

                                <div>
                                    <label className={`block text-xs font-medium mb-1.5 ${activeTheme === 'dark' ? 'text-white/60' : 'text-gray-500'
                                        }`}>
                                        Priority
                                    </label>
                                    <div className="flex gap-2">
                                        {(['high', 'medium', 'low'] as const).map(p => (
                                            <button
                                                key={p}
                                                type="button"
                                                onClick={() => setQuickTaskPriority(p)}
                                                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${quickTaskPriority === p
                                                    ? p === 'high'
                                                        ? 'bg-red-500/20 text-red-400 border-red-500/30'
                                                        : p === 'medium'
                                                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                                            : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                                                    : activeTheme === 'dark'
                                                        ? 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
                                                        : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                                    }`}
                                            >
                                                {p.charAt(0).toUpperCase() + p.slice(1)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 mt-6">
                                <button
                                    onClick={() => setIsQuickAddTaskModalOpen(false)}
                                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTheme === 'dark'
                                        ? 'hover:bg-white/10 text-white/70'
                                        : 'hover:bg-gray-100 text-gray-600'
                                        }`}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleQuickAddTask}
                                    disabled={!quickTaskTitle.trim()}
                                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${!quickTaskTitle.trim()
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ''
                                        } ${activeTheme === 'dark'
                                            ? 'bg-[#0071e3] hover:bg-[#0077ED] text-white'
                                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                                        }`}
                                >
                                    Add Task
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
            {/* Game Center Modal */}
            <GameCenter
                isOpen={showGameCenter}
                onClose={() => setShowGameCenter(false)}
                isDarkMode={isDarkMode}
            />

            <LiveAssistantButton
                onClick={() => setShowAssistant(true)}
                visible={isActive === true && !showAssistant && !showProjectNoteMap && canEdit}
                className={`${activeTheme === 'dark' || activeTheme === 'light'
                    ? 'bg-[#0071e3] hover:bg-[#0077ed]'
                    : `${currentTheme.primary} ${currentTheme.primaryHover}`} shadow-lg text-white`}
            >
                <span className="absolute right-full mr-3 px-3 py-1.5 bg-[#1d1d1f] text-white text-sm rounded-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap hidden sm:block border border-[#3d3d3f]/50">
                    Ask AI
                </span>
            </LiveAssistantButton>

            {/* Live Cursors Overlay */}
            {
                liveCursors.length > 0 && (
                    <CursorOverlay cursors={liveCursors} />
                )
            }

            {
                activePodcast && activePodcast.url && (
                    <div
                        className={`fixed bottom-4 left-4 z-40 max-w-sm w-[320px] rounded-2xl shadow-lg border ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200'}`}
                    >
                        <div className="flex items-center justify-between px-4 pt-3">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm ${activeTheme === 'dark' || activeTheme === 'light' ? 'bg-[#0a84ff]/10 text-[#0a84ff]' : `${currentTheme.cardBg} ${currentTheme.accent}`}`}>
                                    🎧
                                </span>
                                <div className="flex flex-col min-w-0 max-w-full">
                                    <span className={`text-xs font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                        {activePodcast.title}
                                    </span>
                                    <span className={`text-[11px] truncate ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                        {activePodcast.researchTopic}
                                    </span>
                                </div>
                            </div>
                            <button
                                onClick={() => setActivePodcast(null)}
                                className={`p-1 rounded-full ${isDarkMode ? 'hover:bg-white/10 text-[#86868b]' : 'hover:bg-gray-100 text-gray-500'}`}
                                aria-label="Close podcast player"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="px-3 pb-3 pt-1">
                            <audio
                                src={activePodcast.url}
                                controls
                                autoPlay
                                preload="auto"
                                ref={audioRef}
                                className="w-full"
                            />
                        </div>
                    </div>
                )
            }

            {
                showAssistant && (
                    <ProjectLiveAssistant
                        project={currentProject}
                        isDarkMode={isDarkMode}
                        activeTheme={activeTheme}
                        currentTheme={currentTheme}
                        onClose={() => setShowAssistant(false)}
                        onLocalPodcastAdd={handleLocalPodcastAdd}
                        onProjectUpdate={onProjectUpdate}
                        onRunSeoAnalysis={runSeoAnalysisFromAssistant}
                        isSubscribed={isSubscribed}
                        activeTab={activeTab}
                        activeAssetTab={currentAssetsFilter[0] || 'all'}
                        pinnedAsset={assetToPin}

                        facebookConnected={facebookConnected}
                        facebookAccessToken={facebookAccessTokenRef.current}
                        facebookProfile={facebookProfile}
                        fbPages={fbPages}
                        fbPageId={selectedFbPageId}
                        igAccounts={igAccounts}
                        selectedIgId={selectedIgId}
                        xConnected={xConnected}
                        xProfile={xProfile}
                        tiktokConnected={tiktokConnected}
                        tiktokProfile={tiktokCreatorInfo}
                        youtubeConnected={youtubeConnected}
                        youtubeProfile={youtubeChannel}
                        linkedinConnected={linkedinConnected}
                        linkedinProfile={linkedinProfile}
                        // Social platform connect handlers
                        handleFacebookConnect={handleFacebookConnect}
                        handleXConnect={handleXConnect}
                        handleTiktokConnect={handleTiktokConnect}
                        handleYoutubeConnect={handleYoutubeConnect}
                        handleLinkedinConnect={handleLinkedinConnect}
                        loadInstagramAccounts={loadInstagramAccounts}
                        loadFacebookPages={loadFacebookPages}
                        onRequestSocialRefresh={refreshSocialConnections}
                        googleSheetsAccessToken={googleSheetsAccessToken}
                        googleDocsAccessToken={googleDocsAccessToken}
                    />
                )
            }

            {
                showSourcesModal && (
                    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                        <div
                            className={`w-full max-w-2xl max-h-[80vh] rounded-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200'
                                }`}
                        >
                            <div className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'
                                }`}>
                                <div>
                                    <h2 className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                        {sourcesModalTitle}
                                    </h2>
                                    <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                        {sourcesModalMode === 'all_sources'
                                            ? `${sourcesModalUrlItems.length + sourcesModalFileItems.length + sourcesModalNoteItems.length} source${(sourcesModalUrlItems.length + sourcesModalFileItems.length + sourcesModalNoteItems.length) !== 1 ? 's' : ''}`
                                            : `${sourcesModalUrlItems.length} source${sourcesModalUrlItems.length !== 1 ? 's' : ''}`}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowSourcesModal(false)}
                                    className={
                                        'p-2 rounded-lg transition-colors ' +
                                        (isDarkMode
                                            ? 'text-[#86868b] hover:text-white hover:bg-white/10'
                                            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100')
                                    }
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
                                {sourcesModalMode === 'all_sources' ? (
                                    <>
                                        {sourcesModalUrlItems.length > 0 && (
                                            <div className="space-y-2">
                                                <p className={`text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                    URLs
                                                </p>
                                                {sourcesModalUrlItems.map((source, idx) => {
                                                    const link = source.url || source.uri;
                                                    return (
                                                        <div
                                                            key={`url-${idx}`}
                                                            className={`rounded-xl p-3 border ${isDarkMode ? 'border-[#3d3d3f] bg-[#111111]' : 'border-gray-200 bg-gray-50'
                                                                }`}
                                                        >
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="flex-1 min-w-0">
                                                                    <p
                                                                        className={`text-sm font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'
                                                                            }`}
                                                                    >
                                                                        {source.title || link || `Source ${idx + 1}`}
                                                                    </p>
                                                                    {link && (
                                                                        <a
                                                                            href={link}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            className={`block text-xs mt-0.5 truncate ${isDarkMode ? 'text-[#5ac8fa]' : 'text-blue-600'
                                                                                }`}
                                                                        >
                                                                            {link}
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {source.snippet && (
                                                                <p
                                                                    className={`mt-2 text-xs leading-relaxed ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'
                                                                        }`}
                                                                >
                                                                    {source.snippet}
                                                                </p>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {(sourcesModalFileItems.length > 0 || sourcesModalNoteItems.length > 0) && (
                                            <div className="space-y-2">
                                                <p className={`text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                    Uploaded files & notes
                                                </p>

                                                {sourcesModalFileItems.map((source, idx) => {
                                                    const link = source.url || source.uri;
                                                    return (
                                                        <div
                                                            key={`file-${idx}`}
                                                            className={`rounded-xl p-3 border ${isDarkMode ? 'border-[#3d3d3f] bg-[#111111]' : 'border-gray-200 bg-gray-50'
                                                                }`}
                                                        >
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="flex-1 min-w-0">
                                                                    <p
                                                                        className={`text-sm font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'
                                                                            }`}
                                                                    >
                                                                        {source.title || link || 'Uploaded file'}
                                                                    </p>
                                                                    {link && (
                                                                        <a
                                                                            href={link}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            className={`block text-xs mt-0.5 truncate ${isDarkMode ? 'text-[#5ac8fa]' : 'text-blue-600'
                                                                                }`}
                                                                        >
                                                                            {link}
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {source.snippet && (
                                                                <p
                                                                    className={`mt-2 text-xs leading-relaxed ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'
                                                                        }`}
                                                                >
                                                                    {source.snippet}
                                                                </p>
                                                            )}
                                                        </div>
                                                    );
                                                })}

                                                {sourcesModalNoteItems.map((source, idx) => (
                                                    <div
                                                        key={`note-${idx}`}
                                                        className={`rounded-xl p-3 border ${isDarkMode ? 'border-[#3d3d3f] bg-[#111111]' : 'border-gray-200 bg-gray-50'
                                                            }`}
                                                    >
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="flex-1 min-w-0">
                                                                <p
                                                                    className={`text-sm font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'
                                                                        }`}
                                                                >
                                                                    {source.title || 'Note'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        {source.snippet && (
                                                            <p
                                                                className={`mt-2 text-xs leading-relaxed ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'
                                                                    }`}
                                                            >
                                                                {source.snippet}
                                                            </p>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="space-y-3">
                                        {sourcesModalUrlItems.map((source, idx) => {
                                            const link = source.url || source.uri;
                                            return (
                                                <div
                                                    key={idx}
                                                    className={`rounded-xl p-3 border ${isDarkMode ? 'border-[#3d3d3f] bg-[#111111]' : 'border-gray-200 bg-gray-50'
                                                        }`}
                                                >
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="flex-1 min-w-0">
                                                            <p
                                                                className={`text-sm font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'
                                                                    }`}
                                                            >
                                                                {source.title || link || `Source ${idx + 1}`}
                                                            </p>
                                                            {link && (
                                                                <a
                                                                    href={link}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className={`block text-xs mt-0.5 truncate ${isDarkMode ? 'text-[#5ac8fa]' : 'text-blue-600'
                                                                        }`}
                                                                >
                                                                    {link}
                                                                </a>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {source.snippet && (
                                                        <p
                                                            className={`mt-2 text-xs leading-relaxed ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'
                                                                }`}
                                                        >
                                                            {source.snippet}
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {
                isCreateEventModalOpen && (
                    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                        <div className={`w-full max-w-md rounded-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200'}`}>
                            <div className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                                <h2 className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Create Calendar Event</h2>
                                <button
                                    type="button"
                                    onClick={() => setIsCreateEventModalOpen(false)}
                                    className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'text-[#86868b] hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                            <div className="p-4 space-y-4">
                                {calendarError && (
                                    <div className="p-2 text-xs bg-red-500/10 text-red-500 rounded-lg">
                                        {calendarError}
                                    </div>
                                )}
                                <div>
                                    <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Event Title</label>
                                    <input
                                        type="text"
                                        value={newEventTitle}
                                        onChange={(e) => setNewEventTitle(e.target.value)}
                                        placeholder="e.g. Project Review"
                                        className={`w-full px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all ${isDarkMode ? 'bg-black/20 border-[#3d3d3f] text-white placeholder:text-white/20' : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400'}`}
                                    />
                                </div>
                                <div>
                                    <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Description (Optional)</label>
                                    <textarea
                                        value={newEventDescription}
                                        onChange={(e) => setNewEventDescription(e.target.value)}
                                        placeholder="Event details..."
                                        className={`w-full px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all min-h-[80px] ${isDarkMode ? 'bg-black/20 border-[#3d3d3f] text-white placeholder:text-white/20' : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400'}`}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>Start Time</label>
                                        <input
                                            type="datetime-local"
                                            value={newEventStartLocal}
                                            onChange={(e) => setNewEventStartLocal(e.target.value)}
                                            className={`w-full px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all ${isDarkMode ? 'bg-black/20 border-[#3d3d3f] text-white' : 'bg-white border-gray-200 text-gray-900'}`}
                                        />
                                    </div>
                                    <div>
                                        <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>End Time</label>
                                        <input
                                            type="datetime-local"
                                            value={newEventEndLocal}
                                            onChange={(e) => setNewEventEndLocal(e.target.value)}
                                            className={`w-full px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all ${isDarkMode ? 'bg-black/20 border-[#3d3d3f] text-white' : 'bg-white border-gray-200 text-gray-900'}`}
                                        />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="addMeet-overview"
                                        checked={newEventAddMeet}
                                        onChange={(e) => setNewEventAddMeet(e.target.checked)}
                                        className="w-4 h-4 rounded border-gray-300 text-[#0071e3] focus:ring-[#0071e3]"
                                    />
                                    <label htmlFor="addMeet-overview" className={`text-xs font-medium ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
                                        Add Google Meet video conferencing
                                    </label>
                                </div>
                                <div className="flex gap-2 pt-2">
                                    <button
                                        type="button"
                                        onClick={handleCreateCalendarEvent}
                                        disabled={calendarLoading}
                                        className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg ${calendarLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#0071e3] hover:bg-[#0077ed] text-white shadow-[#0071e3]/20'}`}
                                    >
                                        {calendarLoading ? 'Creating...' : 'Add event'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsCreateEventModalOpen(false)}
                                        className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${isDarkMode ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {
                showLeadsModal && (
                    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                        <div
                            className={`w-full max-w-3xl max-h-[80vh] rounded-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200'
                                }`}
                        >
                            <div
                                className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'
                                    }`}
                            >
                                <div>
                                    <h2 className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                        {leadsModalTitle}
                                    </h2>
                                    <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                        {leadsModalItems.length} lead{leadsModalItems.length !== 1 ? 's' : ''}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowLeadsModal(false)}
                                    className={
                                        'p-2 rounded-lg transition-colors ' +
                                        (isDarkMode
                                            ? 'text-[#86868b] hover:text-white hover:bg-white/10'
                                            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100')
                                    }
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
                                {leadsModalItems.length === 0 ? (
                                    <div className={`text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                        No leads saved on this research session.
                                    </div>
                                ) : (
                                    leadsModalItems.map((lead, idx) => {
                                        const expanded = expandedLeadIds.has(lead.id);
                                        return (
                                            <div
                                                key={`${lead.id}-${idx}`}
                                                className={`rounded-xl border ${isDarkMode ? 'border-[#3d3d3f] bg-[#111111]' : 'border-gray-200 bg-gray-50'}`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setExpandedLeadIds(prev => {
                                                            const next = new Set(prev);
                                                            if (next.has(lead.id)) next.delete(lead.id);
                                                            else next.add(lead.id);
                                                            return next;
                                                        });
                                                    }}
                                                    className="w-full text-left px-3 py-3 flex items-start justify-between gap-3"
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <p className={`text-sm font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                            {lead.name}
                                                        </p>
                                                        <p className={`text-xs mt-0.5 truncate ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                            {[lead.title, lead.company, lead.location].filter(Boolean).join(' · ') || 'Prospect'}
                                                        </p>
                                                        {lead.email && (
                                                            <p className={`text-xs mt-1 truncate ${isDarkMode ? 'text-[#5ac8fa]' : 'text-blue-600'}`}>
                                                                {lead.email}
                                                                {lead.emailStatus ? ` (${lead.emailStatus})` : ''}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className={`text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                                        {expanded ? 'Hide' : 'Details'}
                                                    </div>
                                                </button>

                                                {expanded && (
                                                    <div className="px-3 pb-3">
                                                        {lead.linkedinUrl && (
                                                            <a
                                                                href={lead.linkedinUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className={`block text-xs truncate ${isDarkMode ? 'text-[#5ac8fa]' : 'text-blue-600'}`}
                                                            >
                                                                {lead.linkedinUrl}
                                                            </a>
                                                        )}
                                                        <pre
                                                            className={`mt-2 text-[11px] whitespace-pre-wrap break-words rounded-lg p-2 border ${isDarkMode ? 'border-[#3d3d3f] bg-black/30 text-gray-200' : 'border-gray-200 bg-white text-gray-800'
                                                                }`}
                                                        >
                                                            {JSON.stringify(lead.raw, null, 2)}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {
                showScheduledPostsModal && (
                    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                        <div
                            className={`w-full max-w-2xl max-h-[80vh] rounded-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200'
                                }`}
                        >
                            <div
                                className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'
                                    }`}
                            >
                                <div>
                                    <h2 className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                        Scheduled Posts
                                    </h2>
                                    <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                        {scheduledPosts.length} pending
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowScheduledPostsModal(false)}
                                    className={
                                        'p-2 rounded-lg transition-colors ' +
                                        (isDarkMode
                                            ? 'text-[#86868b] hover:text-white hover:bg-white/10'
                                            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100')
                                    }
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                                {scheduledPosts.length === 0 ? (
                                    <div className={`text-sm text-center py-8 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                        No posts scheduled.
                                    </div>
                                ) : (
                                    scheduledPosts.slice().sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0)).map((post: any) => (
                                        <div
                                            key={post.id || Math.random()}
                                            className={`rounded-xl border p-3 flex gap-3 ${isDarkMode ? 'border-[#3d3d3f] bg-[#111111]' : 'border-gray-200 bg-gray-50'
                                                }`}
                                        >
                                            <div className="flex-shrink-0 pt-0.5">
                                                {/* Platform Icons */}
                                                <div className="flex -space-x-1">
                                                    {post.platforms.map((p: string) => {
                                                        if (!p) return null;
                                                        const logoUrl =
                                                            (p === 'twitter' || p === 'x') ? 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/X-Logo-Round-Color.png' :
                                                                (p === 'instagram') ? 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/Instagram_logo_2016.svg.webp' :
                                                                    (p === 'linkedin') ? 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/LinkedIn_logo_initials.png' :
                                                                        (p === 'tiktok') ? 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/tiktok-6338432_1280.webp' :
                                                                            (p === 'youtube') ? 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/YouTube_full-color_icon_%282017%29.svg.png' :
                                                                                (p === 'facebook') ? 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/2021_Facebook_icon.svg.webp' : null;

                                                        if (logoUrl) {
                                                            return <img key={p} src={logoUrl} alt={p} className="w-5 h-5 rounded-full border border-white/20 object-cover bg-white" />;
                                                        }
                                                        return (<div key={p} className="w-5 h-5 rounded-full bg-gray-500 flex items-center justify-center text-white text-[10px] border border-white/20">{p[0]?.toUpperCase() || '?'}</div>);
                                                    })}
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2 mb-1">
                                                    <span className={`text-xs font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                        {new Date(post.scheduledAt * 1000).toLocaleString(undefined, {
                                                            weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                                                        })}
                                                    </span>
                                                    <span className={`text-[10px] uppercase font-bold tracking-wider ${post.status === 'published' ? 'text-green-500' :
                                                        post.status === 'failed' ? 'text-red-500' :
                                                            post.status === 'publishing' ? 'text-blue-500' : 'text-gray-500'
                                                        }`}>
                                                        {post.status}
                                                    </span>
                                                </div>
                                                <p className={`text-xs line-clamp-2 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                    {post.textContent || 'No text content'}
                                                </p>
                                            </div>
                                            {post.mediaUrl && (
                                                <div className="flex-shrink-0 self-start">
                                                    {post.postType === 'VIDEO' ? (
                                                        <div className="h-12 w-12 flex items-center justify-center rounded-md border border-white/10 bg-gray-800 text-blue-500">
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                                        </div>
                                                    ) : (
                                                        <img src={post.mediaUrl} alt="" className="h-12 w-12 object-cover rounded-md border border-white/10" />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {
                videoPlayerMode !== 'hidden' &&
                typeof document !== 'undefined' &&
                createPortal(
                    <div
                        className={
                            'fixed inset-0 z-50 ' +
                            (videoPlayerMode === 'mini' ? 'pointer-events-none' : 'pointer-events-auto')
                        }
                    >
                        {videoPlayerMode === 'modal' && (
                            <div
                                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                                onClick={minimizeVideoPlayer}
                                aria-hidden="true"
                            />
                        )}

                        <div
                            className={
                                'pointer-events-auto ' +
                                (videoPlayerMode === 'modal'
                                    ? 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-5xl max-h-[85vh]'
                                    : 'fixed w-[340px]')
                            }
                            style={
                                videoPlayerMode === 'mini'
                                    ? {
                                        left: (miniPlayerPos?.x ?? 16),
                                        top: (miniPlayerPos?.y ?? 16),
                                    }
                                    : undefined
                            }
                        >
                            <div
                                className={`rounded-2xl border overflow-hidden flex flex-col shadow-2xl ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200'
                                    }`}
                            >
                                <div
                                    className={`p-3 border-b flex items-center ${videoPlayerMode === 'mini' ? 'justify-end' : 'justify-between'} ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'
                                        } ${videoPlayerMode === 'mini' ? 'cursor-grab select-none' : ''}`}
                                    onPointerDown={videoPlayerMode === 'mini' ? handleMiniPointerDown : undefined}
                                    onPointerMove={videoPlayerMode === 'mini' ? handleMiniPointerMove : undefined}
                                    onPointerUp={videoPlayerMode === 'mini' ? handleMiniPointerUp : undefined}
                                >
                                    {videoPlayerMode === 'mini' ? (
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onPointerDown={e => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                }}
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    setVideoPlayerMode('modal');
                                                }}
                                                aria-label="Expand video player"
                                                className="w-3.5 h-3.5 rounded-full bg-green-500 hover:bg-green-600 transition-colors"
                                            />
                                            <button
                                                type="button"
                                                onPointerDown={e => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                }}
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    closeVideoPlayer();
                                                }}
                                                aria-label="Close video player"
                                                className="w-3.5 h-3.5 rounded-full bg-red-500 hover:bg-red-600 transition-colors"
                                            />
                                        </div>
                                    ) : (
                                        <>
                                            <div className="min-w-0">
                                                <div className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Videos</div>
                                                {videoPlayerMode === 'modal' && (
                                                    <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                        Project-relevant YouTube videos
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={videoPlayerMode === 'modal' ? minimizeVideoPlayer : closeVideoPlayer}
                                                    className={
                                                        'p-2 rounded-lg transition-colors ' +
                                                        (isDarkMode ? 'hover:bg-white/10 text-[#e5e5ea]' : 'hover:bg-gray-100 text-gray-600')
                                                    }
                                                    aria-label={videoPlayerMode === 'modal' ? 'Minimize video player' : 'Close video player'}
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className={videoPlayerMode === 'modal' ? 'p-4 overflow-hidden flex-1' : 'p-2'}>
                                    {!effectiveYoutubeVideoId ? (
                                        <p className={`text-sm ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>No video selected.</p>
                                    ) : (
                                        <div className={videoPlayerMode === 'modal' ? 'h-full flex flex-col md:flex-row gap-4' : ''}>
                                            <div className={videoPlayerMode === 'modal' ? 'flex-1 min-h-0' : ''}>
                                                <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                                                    <div className="aspect-video bg-black">
                                                        <iframe
                                                            key={activeYoutubeVideoId || 'no-video'}
                                                            className="w-full h-full"
                                                            src={`https://www.youtube.com/embed/${effectiveYoutubeVideoId}?rel=0&modestbranding=1&autoplay=1&playsinline=1`}
                                                            title="YouTube video player"
                                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                            allowFullScreen
                                                        />
                                                    </div>
                                                </div>

                                                {videoPlayerMode === 'modal' && (
                                                    <>
                                                        <div className="mt-3 flex items-center justify-between gap-3">
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={handleAnalyzeActiveVideo}
                                                                    disabled={isAnalyzingVideo || youtubeVideos.length === 0}
                                                                    className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${isAnalyzingVideo
                                                                        ? isDarkMode
                                                                            ? 'bg-white/10 text-[#86868b] cursor-wait'
                                                                            : 'bg-gray-100 text-gray-500 cursor-wait'
                                                                        : 'bg-[#0071e3]/10 text-[#0071e3] hover:bg-[#0071e3]/20'
                                                                        }`}
                                                                >
                                                                    {isAnalyzingVideo ? 'Analyzing…' : 'Analyze'}
                                                                </button>
                                                                <div className={`text-xs ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                                    Tap a video to switch.
                                                                </div>
                                                            </div>
                                                            <a
                                                                href={`https://www.youtube.com/watch?v=${effectiveYoutubeVideoId}`}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${isDarkMode ? 'bg-white/10 text-white/80 hover:bg-white/15' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                                            >
                                                                Open in YouTube
                                                            </a>
                                                        </div>

                                                        {videoAnalysisError && (
                                                            <div className={`mt-3 text-sm ${isDarkMode ? 'text-red-300' : 'text-red-600'}`}>
                                                                {videoAnalysisError}
                                                            </div>
                                                        )}

                                                        {!!(effectiveYoutubeVideoId && (videoAnalysisById[effectiveYoutubeVideoId] || '').trim()) && (
                                                            <div className={`mt-3 rounded-xl border p-3 overflow-auto max-h-[30vh] ${isDarkMode ? 'border-[#3d3d3f] bg-black/20' : 'border-gray-200 bg-gray-50'}`}>
                                                                <ReactMarkdown className={isDarkMode ? 'prose prose-invert max-w-none' : 'prose max-w-none'}>
                                                                    {videoAnalysisById[effectiveYoutubeVideoId]}
                                                                </ReactMarkdown>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>

                                            {videoPlayerMode === 'modal' && (
                                                <div className="w-full md:w-[320px] min-h-0">
                                                    <div className="h-full max-h-[40vh] md:max-h-full overflow-auto pr-1 space-y-2">
                                                        {youtubeVideos.map(v => {
                                                            const isActive = (effectiveYoutubeVideoId || '') === v.id;
                                                            return (
                                                                <button
                                                                    key={v.id}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setActiveYoutubeVideoId(v.id);
                                                                        setVideoAnalysisError(null);
                                                                    }}
                                                                    className={`w-full text-left p-2.5 rounded-xl border transition-colors ${isActive
                                                                        ? isDarkMode
                                                                            ? 'bg-[#0071e3]/15 border-[#0071e3]/50'
                                                                            : 'bg-blue-50 border-blue-200'
                                                                        : isDarkMode
                                                                            ? 'bg-black/20 border-[#3d3d3f]/60 hover:border-[#0071e3]/50'
                                                                            : 'bg-gray-50 border-gray-200 hover:border-blue-200'
                                                                        }`}
                                                                >
                                                                    <div className="flex items-start gap-3">
                                                                        <img src={v.thumbnail} alt={v.title} className="w-20 h-12 object-cover rounded-lg flex-shrink-0" />
                                                                        <div className="min-w-0">
                                                                            <div className={`text-sm font-medium leading-snug line-clamp-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{v.title}</div>
                                                                            <div className={`mt-1 text-[11px] flex items-center gap-2 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'}`}>
                                                                                <span className="truncate">{v.channel}</span>
                                                                                <span className="whitespace-nowrap">• {v.duration}</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )
            }
            <CreditInfoModal
                isOpen={showCreditInfo}
                onClose={() => setShowCreditInfo(false)}
                isDarkMode={isDarkMode}
                currentCredits={currentCredits}
            />
            {/* Reverify Confirmation Modal */}
            {/* Reverify Confirmation Modal */}
            {
                showReverifyConfirm &&
                typeof document !== 'undefined' &&
                createPortal(
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowReverifyConfirm(false)} />
                        <div className={`relative w-full max-w-md rounded-2xl p-6 shadow-2xl scale-100 opacity-100 transition-all ${isDarkMode ? 'bg-[#1c1c1e] text-white' : 'bg-white text-gray-900'
                            }`}>
                            <div className="flex flex-col items-center text-center">
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isDarkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h4M20 20v-5h-4M5 19a7 7 0 0012-5M19 5a7 7 0 00-12 5" />
                                    </svg>
                                </div>
                                <h3 className="text-xl font-semibold mb-2">Reverify Project Research?</h3>
                                <p className={`mb-6 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                    This will check all your research sessions against the latest web data and update them if new information is found. This process may consume credits.
                                </p>
                                <div className="flex w-full gap-3">
                                    <button
                                        onClick={() => setShowReverifyConfirm(false)}
                                        className={`flex-1 px-4 py-2.5 rounded-xl font-medium transition-colors ${isDarkMode
                                            ? 'bg-[#2c2c2e] hover:bg-[#3a3a3c] text-white'
                                            : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                                            }`}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={processReverification}
                                        className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-white transition-colors ${activeTheme === 'dark' || activeTheme === 'light'
                                            ? 'bg-[#0071e3] hover:bg-[#0077ed]'
                                            : (currentTheme?.primary || 'bg-[#0071e3]') + ' ' + (currentTheme?.primaryHover || 'hover:bg-[#0077ed]')
                                            }`}
                                    >
                                        Reverify Now
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )
            }

            {/* Reverify Summary Modal */}
            {
                showReverifySummary && reverifySummary &&
                typeof document !== 'undefined' &&
                createPortal(
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowReverifySummary(false)} />
                        <div className={`relative w-full max-w-lg rounded-2xl flex flex-col max-h-[85vh] shadow-2xl ${isDarkMode ? 'bg-[#1c1c1e] text-white' : 'bg-white text-gray-900'
                            }`}>
                            <div className={`flex items-center justify-between px-6 py-4 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-100'}`}>
                                <h3 className="text-lg font-semibold">Reverification Complete</h3>
                                <button
                                    onClick={() => setShowReverifySummary(false)}
                                    className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'}`}
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="p-6 overflow-y-auto">
                                <div className="grid grid-cols-3 gap-4 mb-6">
                                    <div className={`p-3 rounded-xl text-center ${isDarkMode ? 'bg-green-500/10 text-green-400' : 'bg-green-50 text-green-600'}`}>
                                        <div className="text-2xl font-bold">{reverifySummary.numFresh}</div>
                                        <div className="text-xs font-medium uppercase tracking-wide opacity-80">Fresh</div>
                                    </div>
                                    <div className={`p-3 rounded-xl text-center ${isDarkMode ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>
                                        <div className="text-2xl font-bold">{reverifySummary.numUpdated}</div>
                                        <div className="text-xs font-medium uppercase tracking-wide opacity-80">Updated</div>
                                    </div>
                                    <div className={`p-3 rounded-xl text-center ${isDarkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
                                        <div className="text-2xl font-bold">{reverifySummary.numStale}</div>
                                        <div className="text-xs font-medium uppercase tracking-wide opacity-80">Stale</div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    {reverifySummary.lines.map((line, i) => (
                                        <p key={i} className={`text-sm leading-relaxed ${line.startsWith('-') ? 'pl-4' : ''} ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                                            {line}
                                        </p>
                                    ))}
                                </div>
                            </div>

                            <div className={`p-6 border-t ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-100'}`}>
                                <button
                                    onClick={() => setShowReverifySummary(false)}
                                    className={`w-full py-3 rounded-xl font-medium text-white transition-opacity hover:opacity-90 ${activeTheme === 'dark' || activeTheme === 'light'
                                        ? 'bg-[#0071e3]'
                                        : (currentTheme?.primary || 'bg-[#0071e3]')
                                        }`}
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )
            }

        </div >
    );
};

export default ProjectDashboard;

