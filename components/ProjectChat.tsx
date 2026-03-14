import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { upload } from '@vercel/blob/client';
import {
    ResearchProject, ProjectChatMessage, ChatReference, ChatAttachment,
    ChatReferenceType, ProjectCollaborator, ProjectNote, ProjectTask,
    KnowledgeBaseFile, AssetItem, EmailTemplate, SavedResearch, TabId
} from '../types';
import {
    auth, sendChatMessage, subscribeToChatMessages,
    deleteChatMessage, editChatMessage, toggleChatReaction,
} from '../services/firebase';
import { generateChatAIResponse, generateVeoVideo } from '../services/geminiService';
import { xaiService } from '../services/xaiService';
import { authFetch } from '../services/authFetch';
import { storageService } from '../services/storageService';
import type { OnlineUser } from '../hooks/usePresence';

// ─── Constants ──────────────────────────────────────────────────────────────

const EMOJI_PALETTE = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '💯', '🙌', '😍', '🤔', '👏', '✅'];

const FULL_EMOJI_SET = [
    '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇',
    '🥰', '😍', '🤩', '😘', '😗', '😋', '😛', '😜', '🤪', '😎', '🤗', '🤭',
    '🤔', '🤫', '🤐', '😬', '😮', '😯', '😲', '😳', '🥺', '😢', '😭', '😤',
    '😡', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽',
    '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾',
    '👋', '🤚', '🖐️', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇',
    '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🤲', '🤝', '🙏',
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕',
    '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '🔥', '⭐', '🌟', '✨',
    '💫', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈',
    '✅', '❌', '⚠️', '💡', '📌', '📎', '🔗', '🔒', '🔓', '📝', '📊', '📈',
    '🚀', '💻', '📱', '🖥️', '⌨️', '🖱️', '💾', '📁', '📂', '🗂️', '📄', '📃',
];

const REFERENCE_TYPE_ICONS: Record<ChatReferenceType, string> = {
    note: '📝',
    task: '✅',
    file: '📄',
    asset: '🖼️',
    calendar_event: '📅',
    scheduled_post: '📣',
    email_template: '✉️',
    research_session: '🔬',
};

const REFERENCE_TYPE_LABELS: Record<ChatReferenceType, string> = {
    note: 'Notes',
    task: 'Tasks',
    file: 'Files',
    asset: 'Assets',
    calendar_event: 'Calendar',
    scheduled_post: 'Scheduled Posts',
    email_template: 'Email Templates',
    research_session: 'Research',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateLabel = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
};

const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface ProjectChatProps {
    project: ResearchProject;
    ownerUid: string;
    isDarkMode: boolean;
    onlineUsers: OnlineUser[];
    currentUserUid: string | null;
    currentUserName: string | null;
    currentUserPhoto: string | null;
    onNavigate?: (tab: TabId, itemId?: string) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const ProjectChat: React.FC<ProjectChatProps> = ({
    project,
    ownerUid,
    isDarkMode,
    onlineUsers,
    currentUserUid,
    currentUserName,
    currentUserPhoto,
    onNavigate,
}) => {
    // State
    const [messages, setMessages] = useState<ProjectChatMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [sending, setSending] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const [uploading, setUploading] = useState(false);
    const [references, setReferences] = useState<ChatReference[]>([]);
    const [showReferencePicker, setShowReferencePicker] = useState(false);
    const [referenceTab, setReferenceTab] = useState<ChatReferenceType>('note');
    const [referenceSearch, setReferenceSearch] = useState('');
    const [savedAssetIds, setSavedAssetIds] = useState<Set<string>>(new Set());
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [replyingTo, setReplyingTo] = useState<ProjectChatMessage | null>(null);
    const [isAiTyping, setIsAiTyping] = useState(false);
    const [aiStatus, setAiStatus] = useState<string | null>(null);

    // Refs
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const emojiPickerRef = useRef<HTMLDivElement>(null);
    const reactionPickerRef = useRef<HTMLDivElement>(null);


    // ─── Subscribe to messages ────────────────────────────────────────────────

    useEffect(() => {
        if (!ownerUid || !project.id) {
            console.warn('[ProjectChat] Missing ownerUid or project.id', { ownerUid, projectId: project.id });
            return;
        }
        console.log('[ProjectChat] Subscribing to messages', { ownerUid, projectId: project.id });
        const unsubscribe = subscribeToChatMessages(ownerUid, project.id, (msgs) => {
            console.log(`[ProjectChat] Received ${msgs.length} messages from Firestore`);
            if (msgs.length > 0) {
                console.log('[ProjectChat] First message sample:', msgs[0]);
            }
            setMessages(msgs);
        });
        return () => unsubscribe();
    }, [ownerUid, project.id]);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Close pickers on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (showEmojiPicker && emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
                setShowEmojiPicker(false);
            }
            if (showReactionPicker && reactionPickerRef.current && !reactionPickerRef.current.contains(e.target as Node)) {
                setShowReactionPicker(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showEmojiPicker, showReactionPicker]);

    // ─── Members list ─────────────────────────────────────────────────────────

    const members = useMemo(() => {
        const collabs = (project.collaborators || []).filter(c => c.role === 'editor');
        const onlineUids = new Set(onlineUsers.map(u => u.uid));
        const memberList: { uid: string; name: string; photo?: string; email?: string; online: boolean; isOwner: boolean }[] = [];

        // Owner
        if (ownerUid) {
            const ownerOnline = onlineUsers.find(u => u.uid === ownerUid);
            memberList.push({
                uid: ownerUid,
                name: ownerOnline?.displayName || 'Owner',
                photo: ownerOnline?.photoURL || undefined,
                email: ownerOnline?.email || undefined,
                online: onlineUids.has(ownerUid),
                isOwner: true,
            });
        }

        // Editors
        for (const c of collabs) {
            if (c.uid === ownerUid) continue;
            const onlineInfo = onlineUsers.find(u => u.uid === c.uid);
            memberList.push({
                uid: c.uid,
                name: onlineInfo?.displayName || c.email || 'Collaborator',
                photo: onlineInfo?.photoURL || undefined,
                email: c.email,
                online: onlineUids.has(c.uid),
                isOwner: false,
            });
        }

        return memberList.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
    }, [project.collaborators, onlineUsers, ownerUid]);

    // ─── Reference items ──────────────────────────────────────────────────────

    const getReferenceItems = useCallback((type: ChatReferenceType): { id: string; title: string; preview?: string; metadata?: Record<string, any> }[] => {
        const q = referenceSearch.toLowerCase();
        const filterByTitle = (items: { id: string; title: string; preview?: string; metadata?: Record<string, any> }[]) =>
            q ? items.filter(i => i.title.toLowerCase().includes(q) || i.preview?.toLowerCase().includes(q)) : items;

        switch (type) {
            case 'note':
                return filterByTitle((project.notes || []).map(n => ({
                    id: n.id, title: n.title, preview: n.content?.slice(0, 80),
                    metadata: { color: n.color },
                })));
            case 'task':
                return filterByTitle((project.tasks || []).map(t => ({
                    id: t.id, title: t.title, preview: t.description?.slice(0, 80),
                    metadata: { status: t.status, priority: t.priority },
                })));
            case 'file':
                return filterByTitle((project.knowledgeBase || []).map(f => ({
                    id: f.id, title: f.name, preview: formatFileSize(f.size),
                    metadata: { type: f.type, url: f.url },
                })));
            case 'asset': {
                const allAssets: AssetItem[] = [];
                (project.researchSessions || []).forEach(s => {
                    (s.assets || []).forEach(a => allAssets.push(a));
                });
                return filterByTitle(allAssets.map(a => ({
                    id: a.id, title: a.title, preview: a.description?.slice(0, 80),
                    metadata: { type: a.type, url: a.url },
                })));
            }
            case 'calendar_event':
                return filterByTitle((project.googleIntegrations?.calendarEvents || []).map((e, i) => ({
                    id: e.id || `event-${i}`, title: e.summary || 'Untitled Event',
                    preview: e.start?.dateTime ? new Date(e.start.dateTime).toLocaleDateString() : e.start?.date || '',
                    metadata: { location: e.location, htmlLink: e.htmlLink },
                })));
            case 'scheduled_post':
                return filterByTitle((project.scheduledPosts || []).map(p => ({
                    id: p.id, title: p.textContent?.slice(0, 60) || 'Untitled Post',
                    preview: `${p.platforms.join(', ')} · ${new Date(p.scheduledAt).toLocaleDateString()}`,
                    metadata: { platforms: p.platforms, status: p.status },
                })));
            case 'email_template':
                return filterByTitle((project.emailTemplates || []).map(t => ({
                    id: t.id, title: t.name,
                    preview: t.subject || 'No subject',
                })));
            case 'research_session':
                return filterByTitle((project.researchSessions || []).map(s => ({
                    id: s.id, title: s.topic,
                    preview: s.researchReport?.tldr?.slice(0, 80) || '',
                    metadata: { timestamp: s.timestamp },
                })));
            default:
                return [];
        }
    }, [project, referenceSearch]);

    // ─── Send message ─────────────────────────────────────────────────────────

    const handleSend = async () => {
        if (!inputText.trim() && attachments.length === 0 && references.length === 0) return;

        // Detect mentions (@Name)
        const mentions: string[] = [];
        members.forEach(m => {
            if (inputText.includes(`@${m.name}`)) {
                mentions.push(m.uid);
            }
        });

        const trimmedText = inputText.trim();
        setSending(true);
        try {
            await sendChatMessage(ownerUid, project.id, {
                projectId: project.id,
                authorUid: currentUserUid || 'unknown',
                authorName: currentUserName || 'Unknown',
                authorPhoto: currentUserPhoto || undefined,
                text: trimmedText,
                attachments: attachments.length > 0 ? attachments : undefined,
                references: references.length > 0 ? references : undefined,
                mentions: mentions.length > 0 ? mentions : undefined,
                replyToId: replyingTo?.id,
                replyToSnippet: replyingTo ? {
                    authorName: replyingTo.authorName,
                    text: replyingTo.text
                } : undefined,
                createdAt: Date.now()
            });
            setInputText('');
            setAttachments([]);
            setReferences([]);
            setReplyingTo(null);

            // ── @it AI mention detection ──────────────────────────────────────
            const AI_MENTION_REGEX = /@it\b/i;
            if (AI_MENTION_REGEX.test(trimmedText)) {
                // Detect intent from message text
                const lower = trimmedText.toLowerCase();
                const isImageRequest = /generate\s+(?:an?\s+)?(?:image|photo|picture|drawing|illustration)|\bdraw\b|create\s+(?:an?\s+)?(?:image|photo|picture)|show\s+me\s+(?:an?\s+)?(?:image|picture)/i.test(lower);
                const isVideoRequest = /generate\s+(?:an?\s+)?video|create\s+(?:an?\s+)?video|make\s+(?:an?\s+)?video|\banimate\b/i.test(lower);

                // Extract the creative prompt (strip @it and intent keywords)
                const mediaPrompt = trimmedText
                    .replace(/@it\b/gi, '')
                    .replace(/generate\s+(?:an?\s+)?(?:image|photo|picture|video|drawing|illustration)?/gi, '')
                    .replace(/create\s+(?:an?\s+)?(?:image|photo|picture|video)?/gi, '')
                    .replace(/make\s+(?:an?\s+)?video/gi, '')
                    .replace(/show\s+me\s+(?:an?\s+)?(?:an?)?/gi, '')
                    .replace(/\banimate\b/gi, '')
                    .trim() || trimmedText;

                setIsAiTyping(true);

                if (isImageRequest) {
                    // ── Image Generation (via /api/gemini-image) ──
                    setAiStatus('Generating image...');
                    try {
                        const imgRes = await authFetch('/api/gemini-image', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ prompt: mediaPrompt, aspectRatio: '1:1' }),
                        });
                        if (!imgRes.ok) throw new Error(`Image API error: ${imgRes.status}`);
                        const imgData = await imgRes.json();
                        const imagePart = (imgData.parts || []).find((p: any) => p.type === 'image');
                        if (!imagePart?.dataUrl) throw new Error('No image returned');

                        // Convert base64 data URL to Blob and upload to Vercel Blob
                        const res = await fetch(imagePart.dataUrl);
                        const blob = await res.blob();
                        const blobResult = await upload(`it-image-${Date.now()}.png`, blob, {
                            access: 'public',
                            handleUploadUrl: '/api/media?op=upload-token',
                        });

                        await sendChatMessage(ownerUid, project.id, {
                            projectId: project.id,
                            authorUid: 'ai-assistant',
                            authorName: 'IT',
                            text: `Here's the image I generated for: *${mediaPrompt.slice(0, 80)}*`,
                            attachments: [{
                                id: `ai-img-${Date.now()}`,
                                name: `${mediaPrompt.slice(0, 40)}.png`,
                                url: blobResult.url,
                                mimeType: 'image/png',
                                size: blob.size,
                            }],
                            createdAt: Date.now(),
                        });
                    } catch (imgError) {
                        console.error('[ProjectChat] AI image generation failed:', imgError);
                        await sendChatMessage(ownerUid, project.id, {
                            projectId: project.id,
                            authorUid: 'ai-assistant',
                            authorName: 'IT',
                            text: "I couldn't generate that image. Please try again with a different prompt!",
                            createdAt: Date.now(),
                        });
                    }

                } else if (isVideoRequest) {
                    // ── Video Generation (Veo → xAI Grok fallback) ──
                    setAiStatus('Generating video with Veo (this may take ~1 minute)...');
                    let videoBlob: Blob | null = null;
                    let videoEngine = 'Veo';

                    try {
                        videoBlob = await generateVeoVideo(mediaPrompt, '16:9', 'speed');
                    } catch (veoError) {
                        console.warn('[ProjectChat] Veo failed, falling back to xAI Grok:', veoError);
                        setAiStatus('Veo unavailable, trying xAI Grok...');
                        videoEngine = 'xAI Grok';
                        try {
                            const xaiJob = await xaiService.generateVideo({
                                prompt: mediaPrompt,
                                duration: 10,
                                aspect_ratio: '16:9',
                                resolution: '720p',
                            });
                            setAiStatus('xAI video processing (polling for completion)...');
                            const xaiResult = await xaiService.pollUntilComplete(xaiJob.request_id, (status) => {
                                setAiStatus(`xAI Grok: ${status}...`);
                            });
                            if (!xaiResult.url) throw new Error('xAI did not return a video URL');
                            const proxyUrl = `/api/media?op=proxy-xai-video&url=${encodeURIComponent(xaiResult.url)}`;
                            const proxyRes = await fetch(proxyUrl);
                            videoBlob = await proxyRes.blob();
                        } catch (xaiError) {
                            console.error('[ProjectChat] xAI Grok video also failed:', xaiError);
                        }
                    }

                    if (videoBlob) {
                        setAiStatus(`Uploading ${videoEngine} video...`);
                        try {
                            const blobResult = await upload(`it-video-${Date.now()}.mp4`, videoBlob, {
                                access: 'public',
                                handleUploadUrl: '/api/media?op=upload-token',
                            });
                            await sendChatMessage(ownerUid, project.id, {
                                projectId: project.id,
                                authorUid: 'ai-assistant',
                                authorName: 'IT',
                                text: `Here's the video I generated with ${videoEngine} for: *${mediaPrompt.slice(0, 80)}*`,
                                attachments: [{
                                    id: `ai-vid-${Date.now()}`,
                                    name: `${mediaPrompt.slice(0, 40)}.mp4`,
                                    url: blobResult.url,
                                    mimeType: 'video/mp4',
                                    size: videoBlob.size,
                                }],
                                createdAt: Date.now(),
                            });
                        } catch (uploadError) {
                            console.error('[ProjectChat] Video upload failed:', uploadError);
                            await sendChatMessage(ownerUid, project.id, {
                                projectId: project.id,
                                authorUid: 'ai-assistant',
                                authorName: 'IT',
                                text: "Video was generated but upload failed. Please try again!",
                                createdAt: Date.now(),
                            });
                        }
                    } else {
                        await sendChatMessage(ownerUid, project.id, {
                            projectId: project.id,
                            authorUid: 'ai-assistant',
                            authorName: 'IT',
                            text: "I couldn't generate a video right now. Both Veo and xAI Grok are unavailable. Please try again later!",
                            createdAt: Date.now(),
                        });
                    }

                } else {
                    // ── Text Response ──
                    setAiStatus('Thinking...');
                    try {
                        const aiText = await generateChatAIResponse(
                            project,
                            messages.map(m => ({ authorName: m.authorName, text: m.text, createdAt: m.createdAt })),
                            trimmedText
                        );
                        await sendChatMessage(ownerUid, project.id, {
                            projectId: project.id,
                            authorUid: 'ai-assistant',
                            authorName: 'IT',
                            text: aiText,
                            createdAt: Date.now(),
                        });
                    } catch (aiError) {
                        console.error('[ProjectChat] AI response failed:', aiError);
                        await sendChatMessage(ownerUid, project.id, {
                            projectId: project.id,
                            authorUid: 'ai-assistant',
                            authorName: 'IT',
                            text: "Sorry, I ran into an error. Please try again!",
                            createdAt: Date.now(),
                        });
                    }
                }

                setIsAiTyping(false);
                setAiStatus(null);
            }
        } catch (error) {
            console.error("Failed to send message:", error);
        } finally {
            setSending(false);
        }
    };

    // ─── File upload ──────────────────────────────────────────────────────────

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                const blob = await upload(`chat-attachments/${Date.now()}-${file.name}`, file, {
                    access: 'public',
                    handleUploadUrl: '/api/media?op=upload-token',
                });
                setAttachments(prev => [...prev, {
                    id: `attach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    name: file.name,
                    url: blob.url,
                    mimeType: file.type,
                    size: file.size,
                }]);
            }
        } catch (err) {
            console.error('File upload failed:', err);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // ─── Reactions ────────────────────────────────────────────────────────────

    const handleReaction = async (messageId: string, emoji: string) => {
        if (!currentUserUid) return;
        try {
            await toggleChatReaction(ownerUid, project.id, messageId, emoji, currentUserUid);
            setShowReactionPicker(null);
        } catch (err) {
            console.error('[ProjectChat] Failed to toggle reaction:', err);
        }
    };

    const handleSaveAsset = async (att: ChatAttachment, text: string) => {
        if (!currentUserUid) return;

        try {
            const kbFile: KnowledgeBaseFile = {
                id: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                name: text.split('\n')[0].replace(/[*_`]/g, '').slice(0, 100) || att.name,
                type: att.mimeType,
                size: att.size || 0,
                url: att.url,
                storagePath: '',
                uploadedAt: Date.now()
            };

            const currentKb = project.knowledgeBase || [];
            await storageService.updateResearchProject(project.id, {
                knowledgeBase: [...currentKb, kbFile]
            });

            setSavedAssetIds(prev => new Set([...prev, att.id]));
        } catch (err) {
            console.error('[ProjectChat] Failed to save asset:', err);
        }
    };
    // ─── Edit/Delete ──────────────────────────────────────────────────────────

    const handleDelete = async (messageId: string) => {
        await deleteChatMessage(ownerUid, project.id, messageId);
    };

    const handleEdit = async () => {
        if (!editingMessageId || !editText.trim()) return;
        await editChatMessage(ownerUid, project.id, editingMessageId, editText.trim());
        setEditingMessageId(null);
        setEditText('');
    };

    // ─── Add reference ────────────────────────────────────────────────────────

    const addReference = (type: ChatReferenceType, item: { id: string; title: string; preview?: string; metadata?: Record<string, any> }) => {
        if (references.find(r => r.type === type && r.id === item.id)) return;
        setReferences(prev => [...prev, {
            type,
            id: item.id,
            title: item.title,
            preview: item.preview,
            metadata: item.metadata,
        }]);
        setShowReferencePicker(false);
        setReferenceSearch('');
    };

    // ─── Group messages by date ───────────────────────────────────────────────

    const groupedMessages = useMemo(() => {
        const groups: { date: string; messages: ProjectChatMessage[] }[] = [];
        let currentDate = '';
        for (const msg of messages) {
            const dateLabel = formatDateLabel(msg.createdAt);
            if (dateLabel !== currentDate) {
                currentDate = dateLabel;
                groups.push({ date: dateLabel, messages: [] });
            }
            groups[groups.length - 1].messages.push(msg);
        }
        return groups;
    }, [messages]);

    // ─── Reference Card Renderer (plain function, not a React component, to avoid remounting) ────

    const renderReferenceCard = (ref_: ChatReference) => {
        const icon = REFERENCE_TYPE_ICONS[ref_.type] || '📎';
        const meta = ref_.metadata || {};

        const handleRefClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            if (!onNavigate) return;
            switch (ref_.type) {
                case 'note':
                    onNavigate('notes' as TabId, ref_.id);
                    break;
                case 'task':
                    onNavigate('tasks' as TabId, ref_.id);
                    break;
                case 'file':
                    onNavigate('data' as TabId, ref_.id);
                    break;
                case 'asset':
                    onNavigate('assets' as TabId, ref_.id);
                    break;
                case 'calendar_event':
                    onNavigate('overview' as TabId, ref_.id);
                    break;
                case 'scheduled_post':
                    onNavigate('social' as TabId, ref_.id);
                    break;
                case 'email_template':
                    onNavigate('email' as TabId, ref_.id);
                    break;
                case 'research_session':
                    onNavigate('overview' as TabId, ref_.id);
                    break;
                default:
                    break;
            }
        };

        return (
            <button
                key={`${ref_.type}-${ref_.id}`}
                type="button"
                onClick={handleRefClick}
                className={`w-full flex items-start gap-2 p-2.5 rounded-xl border text-xs transition-all cursor-pointer text-left ${isDarkMode ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}
            >
                <span className="text-base mt-0.5">{icon}</span>
                <div className="flex-1 min-w-0">
                    <p className={`font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{ref_.title}</p>
                    {ref_.preview && <p className={`truncate mt-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{ref_.preview}</p>}
                    {ref_.type === 'task' && meta.status && (
                        <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${meta.status === 'done' ? 'bg-green-500/20 text-green-400' :
                            meta.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400' :
                                'bg-gray-500/20 text-gray-400'
                            }`}>{meta.status.replace('_', ' ')}</span>
                    )}
                </div>
            </button>
        );
    };


    // ─── Render ───────────────────────────────────────────────────────────────

    const bgPrimary = isDarkMode ? 'bg-[#000000]' : 'bg-gray-50';
    const bgCard = isDarkMode ? 'bg-[#1c1c1e]' : 'bg-white';
    const borderColor = isDarkMode ? 'border-white/10' : 'border-gray-200';
    const textPrimary = isDarkMode ? 'text-white' : 'text-gray-900';
    const textSecondary = isDarkMode ? 'text-[#86868b]' : 'text-gray-500';

    return (
        <div className={`flex h-[calc(100vh-200px)] rounded-3xl overflow-hidden border shadow-2xl ${bgCard} ${borderColor}`}>

            {/* ── Member Sidebar ──────────────────────────────────────────────── */}
            <div className={`${mobileSidebarOpen ? 'flex' : 'hidden'} md:flex flex-col w-64 border-r shrink-0 ${borderColor} ${isDarkMode ? 'bg-[#1c1c1e]' : 'bg-white'}`}>
                <div className={`p-4 border-b ${borderColor}`}>
                    <h3 className={`text-sm font-bold ${textPrimary}`}>Team Members</h3>
                    <p className={`text-xs mt-0.5 ${textSecondary}`}>
                        {members.filter(m => m.online).length} online
                    </p>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                    {/* IT — AI Assistant (pinned) */}
                    <div className={`flex items-center gap-3 p-2.5 rounded-xl ${isDarkMode ? 'bg-purple-900/20' : 'bg-purple-50'}`}>
                        <div className="relative shrink-0">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-base bg-gradient-to-br from-purple-500 to-indigo-600 shadow-md">
                                ✨
                            </div>
                            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 bg-green-500" style={{ borderColor: isDarkMode ? '#1c1c1e' : 'white' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${isDarkMode ? 'text-purple-300' : 'text-purple-700'}`}>
                                IT <span className={`ml-1 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded ${isDarkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'}`}>AI</span>
                            </p>
                            <p className="text-[10px] font-medium text-green-500">Always on · Tag with @it</p>
                        </div>
                    </div>
                    {members.map(m => (
                        <div key={m.uid} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all ${isDarkMode ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                            <div className="relative shrink-0">
                                {m.photo ? (
                                    <img src={m.photo} alt="" className="w-8 h-8 rounded-full object-cover" />
                                ) : (
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isDarkMode ? 'bg-white/10 text-white' : 'bg-gray-200 text-gray-700'}`}>
                                        {(m.name || '?')[0].toUpperCase()}
                                    </div>
                                )}
                                <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 ${isDarkMode ? 'border-[#1c1c1e]' : 'border-white'} ${m.online ? 'bg-green-500' : 'bg-gray-400'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate ${textPrimary}`}>
                                    {m.name}
                                    {m.uid === currentUserUid && <span className={`ml-1 text-[10px] ${textSecondary}`}>(you)</span>}
                                </p>
                                <p className={`text-[10px] font-medium ${m.online ? 'text-green-500' : textSecondary}`}>
                                    {m.isOwner ? 'Owner' : 'Editor'} · {m.online ? 'Online' : 'Offline'}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Main Chat Area ──────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0">

                {/* Header */}
                <div className={`flex items-center justify-between p-4 border-b ${borderColor}`}>
                    <div className="flex items-center gap-3">
                        <button onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)} className={`md:hidden p-2 rounded-xl ${isDarkMode ? 'hover:bg-white/10 text-white' : 'hover:bg-gray-100 text-gray-700'}`}>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        </button>
                        <div>
                            <h2 className={`text-lg font-bold ${textPrimary}`}>💬 Chat</h2>
                            <p className={`text-xs ${textSecondary}`}>{messages.length} messages</p>
                        </div>
                    </div>
                </div>

                {/* Messages */}
                <div className={`flex-1 overflow-y-auto p-4 space-y-1 ${bgPrimary}`}>
                    {messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                            <span className="text-5xl mb-4">💬</span>
                            <h3 className={`text-lg font-bold mb-1 ${textPrimary}`}>No messages yet</h3>
                            <p className={`text-sm ${textSecondary}`}>Start the conversation with your team!</p>
                        </div>
                    )}

                    {groupedMessages.map((group, gi) => (
                        <div key={gi}>
                            {/* Date Separator */}
                            <div className="flex items-center gap-3 my-4">
                                <div className={`flex-1 h-px ${isDarkMode ? 'bg-white/10' : 'bg-gray-200'}`} />
                                <span className={`text-[10px] font-bold uppercase tracking-widest ${textSecondary}`}>{group.date}</span>
                                <div className={`flex-1 h-px ${isDarkMode ? 'bg-white/10' : 'bg-gray-200'}`} />
                            </div>

                            {group.messages.map((msg) => {
                                const isOwn = msg.authorUid === currentUserUid;
                                const isDeleted = msg.deleted;
                                const isMentioned = msg.mentions?.includes(currentUserUid || '');
                                const isAiMessage = msg.authorUid === 'ai-assistant';
                                return (
                                    <div key={msg.id} className={`group flex gap-3 px-2 py-1.5 rounded-2xl transition-all ${isAiMessage
                                        ? (isDarkMode ? 'bg-purple-900/20 hover:bg-purple-900/30' : 'bg-purple-50 hover:bg-purple-100/80')
                                        : isMentioned
                                            ? (isDarkMode ? 'bg-blue-500/10' : 'bg-blue-50')
                                            : (isDarkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100/60')
                                        }`}>
                                        {/* Avatar */}
                                        <div className="shrink-0 mt-1">
                                            {isAiMessage ? (
                                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-base bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg shadow-purple-500/30">
                                                    ✨
                                                </div>
                                            ) : msg.authorPhoto ? (
                                                <img src={msg.authorPhoto} alt="" className="w-8 h-8 rounded-full object-cover" />
                                            ) : (
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isDarkMode ? 'bg-white/10 text-white' : 'bg-gray-200 text-gray-700'}`}>
                                                    {(msg.authorName || '?')[0].toUpperCase()}
                                                </div>
                                            )}
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline gap-2">
                                                <span className={`text-sm font-semibold ${isAiMessage ? (isDarkMode ? 'text-purple-400' : 'text-purple-700') : textPrimary}`}>
                                                    {isAiMessage ? '✨ IT' : msg.authorName}
                                                </span>
                                                {isAiMessage && <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${isDarkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'}`}>AI</span>}
                                                <span className={`text-[10px] ${textSecondary}`}>{formatTime(msg.createdAt)}</span>
                                                {msg.editedAt && <span className={`text-[10px] italic ${textSecondary}`}>(edited)</span>}
                                            </div>

                                            {/* Reply Snippet */}
                                            {msg.replyToSnippet && (
                                                <div className={`mt-1 mb-2 px-2.5 py-1.5 rounded-xl border-l-4 text-xs ${isDarkMode ? 'bg-white/5 border-white/20' : 'bg-gray-50 border-gray-200'} opacity-80 line-clamp-2`}>
                                                    <span className="font-bold block text-[10px] mb-0.5">{msg.replyToSnippet.authorName}</span>
                                                    {msg.replyToSnippet.text}
                                                </div>
                                            )}

                                            {isDeleted ? (
                                                <p className={`text-sm italic mt-0.5 ${textSecondary}`}>This message was deleted</p>
                                            ) : (
                                                <>
                                                    {editingMessageId === msg.id ? (
                                                        <div className="mt-1 flex gap-2">
                                                            <input
                                                                value={editText}
                                                                onChange={(e) => setEditText(e.target.value)}
                                                                onKeyDown={(e) => { if (e.key === 'Enter') handleEdit(); if (e.key === 'Escape') setEditingMessageId(null); }}
                                                                className={`flex-1 px-3 py-1.5 rounded-xl text-sm border outline-none ${isDarkMode ? 'bg-white/10 border-white/20 text-white' : 'bg-gray-100 border-gray-200 text-gray-900'}`}
                                                                autoFocus
                                                            />
                                                            <button onClick={handleEdit} className="px-3 py-1.5 rounded-xl bg-blue-500 text-white text-xs font-bold">Save</button>
                                                            <button onClick={() => setEditingMessageId(null)} className={`px-3 py-1.5 rounded-xl text-xs font-bold ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>Cancel</button>
                                                        </div>
                                                    ) : (
                                                        <p className={`text-sm mt-0.5 leading-relaxed whitespace-pre-wrap break-words ${isDarkMode ? 'text-[#e5e5ea]' : 'text-gray-700'}`}>{msg.text}</p>
                                                    )}

                                                    {/* Attachments */}
                                                    {msg.attachments && msg.attachments.length > 0 && (
                                                        <div className="flex flex-wrap gap-2 mt-2">
                                                            {msg.attachments.map(att => (
                                                                <div key={att.id} className="relative group/att">
                                                                    <a href={att.url} target="_blank" rel="noopener noreferrer"
                                                                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-all ${isDarkMode ? 'bg-white/5 border-white/10 text-blue-400 hover:bg-white/10' : 'bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-100'}`}>
                                                                        {att.mimeType?.startsWith('video/') ? (
                                                                            <video
                                                                                src={att.url}
                                                                                controls
                                                                                className="w-full max-w-sm rounded-xl mt-1"
                                                                                style={{ maxHeight: '240px' }}
                                                                            />
                                                                        ) : att.mimeType?.startsWith('image/') ? (
                                                                            <img src={att.url} alt={att.name} className={`rounded-xl mt-1 object-cover ${isAiMessage ? 'w-full max-w-sm' : 'w-16 h-16'}`} />
                                                                        ) : (
                                                                            <>
                                                                                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                                                                                <span className="truncate max-w-[120px]">{att.name}</span>
                                                                                <span className="opacity-60">{formatFileSize(att.size)}</span>
                                                                            </>
                                                                        )}
                                                                    </a>
                                                                    {isAiMessage && (
                                                                        <button
                                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSaveAsset(att, msg.text); }}
                                                                            disabled={savedAssetIds.has(att.id)}
                                                                            className={`absolute top-4 right-4 p-2 rounded-xl text-[10px] font-bold shadow-xl transition-all z-10 flex items-center gap-1.5 ${savedAssetIds.has(att.id)
                                                                                ? 'bg-green-500 text-white cursor-default'
                                                                                : 'bg-blue-600 hover:bg-blue-700 text-white opacity-0 group-hover/att:opacity-100 translate-y-1 group-hover/att:translate-y-0'
                                                                                }`}
                                                                        >
                                                                            {savedAssetIds.has(att.id) ? (
                                                                                <><span>✓</span> Saved to Assets</>
                                                                            ) : (
                                                                                <><span>📂</span> Save to Assets</>
                                                                            )}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Reference Cards */}
                                                    {msg.references && msg.references.length > 0 && (
                                                        <div className="space-y-1.5 mt-2 max-w-sm">
                                                            {msg.references.map(ref_ => renderReferenceCard(ref_))}
                                                        </div>
                                                    )}

                                                    {/* Reactions */}
                                                    {msg.reactions && msg.reactions.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-2">
                                                            {msg.reactions.map(r => (
                                                                <button
                                                                    key={r.emoji}
                                                                    onClick={() => handleReaction(msg.id, r.emoji)}
                                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all ${r.userIds.includes(currentUserUid || '')
                                                                        ? (isDarkMode ? 'bg-blue-500/20 border-blue-500/30 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-600')
                                                                        : (isDarkMode ? 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100')
                                                                        }`}
                                                                >
                                                                    {r.emoji} <span className="font-bold">{r.userIds.length}</span>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Hover actions */}
                                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 mt-1">
                                                        <button onClick={() => setReplyingTo(msg)}
                                                            className={`p-1 rounded-lg text-xs ${isDarkMode ? 'hover:bg-white/10 text-gray-500' : 'hover:bg-gray-100 text-gray-400'}`}
                                                            title="Reply">↩️</button>
                                                        <div className="relative">
                                                            <button onClick={() => setShowReactionPicker(showReactionPicker === msg.id ? null : msg.id)}
                                                                className={`p-1 rounded-lg text-xs ${isDarkMode ? 'hover:bg-white/10 text-gray-500' : 'hover:bg-gray-100 text-gray-400'}`}
                                                                title="React">😀</button>
                                                            {showReactionPicker === msg.id && (
                                                                <div ref={reactionPickerRef} className={`absolute bottom-full left-0 mb-1 flex gap-1 p-2 rounded-2xl border shadow-xl z-50 ${isDarkMode ? 'bg-[#2c2c2e] border-white/10' : 'bg-white border-gray-200'}`}>
                                                                    {EMOJI_PALETTE.map(e => (
                                                                        <button key={e} onClick={() => handleReaction(msg.id, e)} className="text-lg hover:scale-125 transition-transform">{e}</button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {isOwn && !isDeleted && (
                                                            <>
                                                                <button onClick={() => { setEditingMessageId(msg.id); setEditText(msg.text); }}
                                                                    className={`p-1 rounded-lg text-[10px] font-medium ${isDarkMode ? 'hover:bg-white/10 text-gray-500' : 'hover:bg-gray-100 text-gray-400'}`}>Edit</button>
                                                                <button onClick={() => handleDelete(msg.id)}
                                                                    className={`p-1 rounded-lg text-[10px] font-medium ${isDarkMode ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-50 text-red-400'}`}>Delete</button>
                                                            </>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                    <div ref={messagesEndRef} />

                    {/* AI Typing Indicator */}
                    {isAiTyping && (
                        <div className={`flex gap-3 px-2 py-1.5 rounded-2xl ${isDarkMode ? 'bg-purple-900/20' : 'bg-purple-50'}`}>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-base bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg shadow-purple-500/30 shrink-0">
                                ✨
                            </div>
                            <div className="flex flex-col justify-center py-1.5 gap-1">
                                <div className="flex items-center gap-1">
                                    <span className={`text-sm font-semibold ${isDarkMode ? 'text-purple-400' : 'text-purple-700'} mr-2`}>IT</span>
                                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                                {aiStatus && (
                                    <p className={`text-[10px] ${isDarkMode ? 'text-purple-400/70' : 'text-purple-600/70'}`}>{aiStatus}</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Composer ────────────────────────────────────────────────── */}
                <div className={`border-t p-3 ${borderColor} ${bgCard}`}>
                    {/* Reply Banner */}
                    {replyingTo && (
                        <div className={`flex items-center justify-between px-3 py-2 mb-2 rounded-xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                                <span className="text-xs">↩️ Replying to <span className="font-bold">{replyingTo.authorName}</span></span>
                                <p className={`text-[10px] truncate ${textSecondary}`}>{replyingTo.text}</p>
                            </div>
                            <button onClick={() => setReplyingTo(null)} className={`ml-2 text-xs ${textSecondary} hover:${textPrimary}`}>✕</button>
                        </div>
                    )}
                    {/* Pending attachments & references */}
                    {(attachments.length > 0 || references.length > 0) && (
                        <div className="flex flex-wrap gap-2 mb-2">
                            {attachments.map(att => (
                                <div key={att.id} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs border ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                                    📎 <span className="truncate max-w-[100px]">{att.name}</span>
                                    <button onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))} className="text-red-400 hover:text-red-300 ml-1">×</button>
                                </div>
                            ))}
                            {references.map(ref_ => (
                                <div key={`${ref_.type}-${ref_.id}`} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs border ${isDarkMode ? 'bg-blue-500/10 border-blue-500/20 text-blue-300' : 'bg-blue-50 border-blue-100 text-blue-600'}`}>
                                    {REFERENCE_TYPE_ICONS[ref_.type]} <span className="truncate max-w-[100px]">{ref_.title}</span>
                                    <button onClick={() => setReferences(prev => prev.filter(r => !(r.type === ref_.type && r.id === ref_.id)))} className="text-red-400 hover:text-red-300 ml-1">×</button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Reference Picker */}
                    {showReferencePicker && (
                        <div className={`mb-3 rounded-2xl border p-3 ${isDarkMode ? 'bg-[#2c2c2e] border-white/10' : 'bg-white border-gray-200 shadow-lg'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <h4 className={`text-xs font-bold ${textPrimary}`}>Reference Project Item</h4>
                                <button onClick={() => setShowReferencePicker(false)} className={`text-xs ${textSecondary} hover:${textPrimary}`}>✕</button>
                            </div>
                            {/* Type tabs */}
                            <div className="flex flex-wrap gap-1 mb-2">
                                {(Object.keys(REFERENCE_TYPE_LABELS) as ChatReferenceType[]).map(type => (
                                    <button
                                        key={type}
                                        onClick={() => { setReferenceTab(type); setReferenceSearch(''); }}
                                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${referenceTab === type
                                            ? (isDarkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-50 text-blue-600')
                                            : (isDarkMode ? 'text-gray-500 hover:text-white hover:bg-white/5' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50')}`}
                                    >
                                        {REFERENCE_TYPE_ICONS[type]} {REFERENCE_TYPE_LABELS[type]}
                                    </button>
                                ))}
                            </div>
                            {/* Search */}
                            <input
                                value={referenceSearch}
                                onChange={(e) => setReferenceSearch(e.target.value)}
                                placeholder="Search..."
                                className={`w-full px-3 py-1.5 rounded-xl text-xs border outline-none mb-2 ${isDarkMode ? 'bg-white/5 border-white/10 text-white placeholder-gray-600' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'}`}
                            />
                            {/* Items */}
                            <div className="max-h-40 overflow-y-auto space-y-1">
                                {getReferenceItems(referenceTab).map(item => (
                                    <button
                                        key={item.id}
                                        onClick={() => addReference(referenceTab, item)}
                                        className={`w-full text-left flex items-start gap-2 p-2 rounded-xl text-xs transition-all ${isDarkMode ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}
                                    >
                                        <span className="text-sm mt-0.5">{REFERENCE_TYPE_ICONS[referenceTab]}</span>
                                        <div className="flex-1 min-w-0">
                                            <p className={`font-medium truncate ${textPrimary}`}>{item.title}</p>
                                            {item.preview && <p className={`truncate ${textSecondary}`}>{item.preview}</p>}
                                        </div>
                                    </button>
                                ))}
                                {getReferenceItems(referenceTab).length === 0 && (
                                    <p className={`text-center text-xs py-4 ${textSecondary}`}>No items found</p>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="flex items-end gap-2">
                        {/* Action buttons */}
                        <div className="flex items-center gap-0.5 shrink-0">
                            {/* File attach */}
                            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                                className={`p-2 rounded-xl transition-all ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'} ${uploading ? 'opacity-50' : ''}`}
                                title="Attach file">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                            </button>
                            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />

                            {/* Reference button */}
                            <button onClick={() => setShowReferencePicker(!showReferencePicker)}
                                className={`p-2 rounded-xl transition-all ${showReferencePicker
                                    ? (isDarkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-600')
                                    : (isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500')}`}
                                title="Reference project item">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                            </button>

                            {/* Emoji */}
                            <div className="relative">
                                <button onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                                    className={`p-2 rounded-xl transition-all ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                                    title="Emoji">
                                    😀
                                </button>
                                {showEmojiPicker && (
                                    <div ref={emojiPickerRef} className={`absolute bottom-full left-0 mb-2 w-72 max-h-48 overflow-y-auto p-3 rounded-2xl border shadow-2xl z-50 ${isDarkMode ? 'bg-[#2c2c2e] border-white/10' : 'bg-white border-gray-200'}`}>
                                        <div className="grid grid-cols-8 gap-1">
                                            {FULL_EMOJI_SET.map(e => (
                                                <button key={e} onClick={() => { setInputText(prev => prev + e); setShowEmojiPicker(false); }}
                                                    className="text-xl hover:scale-125 transition-transform p-1 rounded-lg hover:bg-white/10">{e}</button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Text input */}
                        <textarea
                            ref={inputRef}
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                            placeholder="Write a message..."
                            rows={1}
                            className={`flex-1 px-4 py-2.5 rounded-2xl text-sm border outline-none resize-none transition-all ${isDarkMode
                                ? 'bg-white/5 border-white/10 text-white placeholder-gray-600 focus:border-blue-500/50 focus:bg-white/10'
                                : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-300 focus:bg-white'}`}
                            style={{ maxHeight: '120px' }}
                        />

                        {/* Send */}
                        <button
                            onClick={handleSend}
                            disabled={sending || (!inputText.trim() && attachments.length === 0 && references.length === 0)}
                            className={`p-2.5 rounded-2xl transition-all shrink-0 ${(inputText.trim() || attachments.length > 0 || references.length > 0) && !sending
                                ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20'
                                : (isDarkMode ? 'bg-white/5 text-gray-600' : 'bg-gray-100 text-gray-400')
                                }`}
                            title="Send">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
