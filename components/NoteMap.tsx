import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { KnowledgeBaseFile, NoteNode, ResearchReport, ThemePalette, UploadedFile } from '../types';
import { generateInitialNodes, generateNoteFusion, generateSubTopics, generateImage, generateImageWithReferences, editImage, generateNoteContent, ImageReference } from '../services/geminiService';
import { storageService } from '../services/storageService';
import { authFetch } from '../services/authFetch';
import { updatePresenceCursor, logProjectActivity } from '../services/firebase';
import type { OnlineUser } from '../hooks/usePresence';

interface NoteMapProps {
    researchReport: ResearchReport | null;
    currentProjectId: string | null;
    projectKnowledgeBaseFiles?: KnowledgeBaseFile[];
    projectUploadedFiles?: UploadedFile[];
    savedState?: NoteNode[];
    isDarkMode: boolean;
    theme?: ThemePalette;
    onUpdateState: (nodes: NoteNode[]) => void;
    // Realtime collaboration props
    onlineCollaborators?: OnlineUser[];
    ownerUid?: string;
    currentUserUid?: string;
    liveNodes?: NoteNode[];
}

// Cursor colors for each collaborator (Miro-inspired)
const COLLAB_CURSOR_COLORS = [
    '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b',
    '#ef4444', '#06b6d4', '#6366f1', '#ec4899',
];
function getCollabColor(uid: string): string {
    let hash = 0;
    for (let i = 0; i < uid.length; i++) {
        hash = ((hash << 5) - hash) + uid.charCodeAt(i);
        hash |= 0;
    }
    return COLLAB_CURSOR_COLORS[Math.abs(hash) % COLLAB_CURSOR_COLORS.length];
}

type ToolMode = 'cursor' | 'select' | 'pen' | 'text' | 'connect' | 'shape';
type ShapeType = 'rectangle' | 'circle' | 'arrow' | 'line';

// Utility to darken a hex color by a percentage
function darkenHex(hex: string, percent: number) {
    if (!hex) return '#000000';
    hex = hex.replace(/^#/, '');

    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    r = Math.floor(r * (1 - percent / 100));
    g = Math.floor(g * (1 - percent / 100));
    b = Math.floor(b * (1 - percent / 100));

    r = r < 0 ? 0 : r;
    g = g < 0 ? 0 : g;
    b = b < 0 ? 0 : b;

    const rr = (r.toString(16).length === 1) ? "0" + r.toString(16) : r.toString(16);
    const gg = (g.toString(16).length === 1) ? "0" + g.toString(16) : g.toString(16);
    const bb = (b.toString(16).length === 1) ? "0" + b.toString(16) : b.toString(16);

    return "#" + rr + gg + bb;
}

function normalizeHexColor(input: string): string | null {
    const value = (input || '').trim();
    if (!value) return null;
    const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return null;
    const hex = match[1].toLowerCase();
    if (hex.length === 6) return `#${hex}`;
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
}

function blendHexColors(a: string, b: string, fallback: string): string {
    const ha = normalizeHexColor(a);
    const hb = normalizeHexColor(b);
    if (!ha && !hb) return fallback;
    if (!ha) return hb as string;
    if (!hb) return ha;

    const r1 = parseInt(ha.slice(1, 3), 16);
    const g1 = parseInt(ha.slice(3, 5), 16);
    const b1 = parseInt(ha.slice(5, 7), 16);

    const r2 = parseInt(hb.slice(1, 3), 16);
    const g2 = parseInt(hb.slice(3, 5), 16);
    const b2 = parseInt(hb.slice(5, 7), 16);

    const r = Math.round((r1 + r2) / 2);
    const g = Math.round((g1 + g2) / 2);
    const bb = Math.round((b1 + b2) / 2);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`;
}

export const NoteMap: React.FC<NoteMapProps> = ({
    researchReport,
    currentProjectId,
    projectKnowledgeBaseFiles,
    projectUploadedFiles,
    savedState,
    isDarkMode,
    theme,
    onUpdateState,
    onlineCollaborators = [],
    ownerUid,
    currentUserUid,
    liveNodes
}) => {
    const [nodes, setNodes] = useState<NoteNode[]>([]);
    const nodesRef = useRef<NoteNode[]>([]);
    const dragStartSnapshotRef = useRef<NoteNode[] | null>(null);
    const drawingDragStartSnapshotRef = useRef<NoteNode[] | null>(null);
    const multiDragStartSnapshotRef = useRef<NoteNode[] | null>(null);
    const multiDragMovedRef = useRef(false);

    const HISTORY_LIMIT = 50;
    const [historyPast, setHistoryPast] = useState<NoteNode[][]>([]);
    const [historyFuture, setHistoryFuture] = useState<NoteNode[][]>([]);
    const hydratedProjectIdRef = useRef<string | null>(null);
    const hasHydratedFromPropsRef = useRef(false);
    const isDirtyRef = useRef(false);

    // Viewport State
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);

    // Gallery State
    const [isGalleryOpen, setIsGalleryOpen] = useState(false); // Minimized by default
    const [galleryScope, setGalleryScope] = useState<'research' | 'project'>('research');
    const [globalPromptOpen, setGlobalPromptOpen] = useState(false);
    const [globalPrompt, setGlobalPrompt] = useState('');
    const [userGalleryAssets, setUserGalleryAssets] = useState<{ url: string; label: string; kind: 'image' | 'video'; mime?: string }[]>([]);
    const [isGalleryUploading, setIsGalleryUploading] = useState(false);
    const galleryFileInputRef = useRef<HTMLInputElement | null>(null);

    const [youtubeAnalysisById, setYoutubeAnalysisById] = useState<Record<string, string>>({});
    const [youtubeAnalysisLoadingById, setYoutubeAnalysisLoadingById] = useState<Record<string, boolean>>({});
    const [youtubeAnalysisErrorById, setYoutubeAnalysisErrorById] = useState<Record<string, string>>({});

    // Tools State
    const [toolMode, setToolMode] = useState<ToolMode>('cursor');
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [colorIndex, setColorIndex] = useState(0);
    const COLOR_PALETTE = [
        '#3b82f6', // Blue
        '#ef4444', // Red
        '#10b981', // Emerald
        '#f59e0b', // Amber
        '#8b5cf6', // Violet
        '#ec4899', // Pink
        '#06b6d4', // Cyan
        '#f97316', // Orange
        '#84cc16', // Lime
        '#6366f1', // Indigo
        '#14b8a6', // Teal
        '#a855f7', // Purple
    ];
    const [drawingColor, setDrawingColor] = useState(COLOR_PALETTE[0]);
    const [brushSize, setBrushSize] = useState(4);
    const [currentStroke, setCurrentStroke] = useState<{ x: number, y: number }[] | null>(null);
    const [selectedShapeType, setSelectedShapeType] = useState<ShapeType>('rectangle');
    const [shapeStart, setShapeStart] = useState<{ x: number, y: number } | null>(null);
    const [shapeEnd, setShapeEnd] = useState<{ x: number, y: number } | null>(null);
    const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
    const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [selectionRect, setSelectionRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
    const [activeMultiDrag, setActiveMultiDrag] = useState<{ ids: string[]; startWorldX: number; startWorldY: number } | null>(null);
    const [activeDrawingDrag, setActiveDrawingDrag] = useState<{ id: string; lastWorldX: number; lastWorldY: number } | null>(null);
    const lastDrawnNodesRef = useRef<NoteNode[] | null>(null);
    const lastTextTapRef = useRef<{ id: string; ts: number } | null>(null);

    // Connection Tool State
    const [connectingNodeId, setConnectingNodeId] = useState<string | null>(null);
    const [tempConnectionPos, setTempConnectionPos] = useState<{ x: number, y: number } | null>(null);

    // FAB State
    const [isFabOpen, setIsFabOpen] = useState(false);

    // Pointers for Multi-touch / Pan
    const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map());
    const prevPinchDistRef = useRef<number | null>(null);
    const prevPinchCenterRef = useRef<{ x: number, y: number } | null>(null);
    const pinchModeRef = useRef<'none' | 'pan' | 'zoom'>('none');
    const panStartRef = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
    const panOriginRef = useRef<{ x: number, y: number }>({ x: 0, y: 0 });

    // Node Dragging State
    const [activeDrag, setActiveDrag] = useState<{ id: string, worldOffsetX: number, worldOffsetY: number, startScreenX: number, startScreenY: number } | null>(null);
    const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [imageEditId, setImageEditId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<{ title: string, content: string }>({ title: '', content: '' });
    const [imagePrompt, setImagePrompt] = useState('');

    const containerRef = useRef<HTMLDivElement>(null);
    const [fusing, setFusing] = useState(false);

    // Realtime Collaboration Logic
    // 1. Merge Remote Nodes
    useEffect(() => {
        if (!liveNodes || !Array.isArray(liveNodes)) return;

        // If no local nodes, hydrate immediately
        if (nodesRef.current.length === 0 && liveNodes.length > 0) {
            setNodes(liveNodes);
            nodesRef.current = liveNodes;
            return;
        }

        const liveMap = new Map(liveNodes.map(n => [n.id, n]));
        const localMap = new Map(nodesRef.current.map(n => [n.id, n]));

        // Check for active interactions to prevent overwriting user work
        const interacts = new Set<string>();
        if (activeDrag) interacts.add(activeDrag.id);
        if (activeMultiDrag) activeMultiDrag.ids.forEach(id => interacts.add(id));
        if (activeDrawingDrag) interacts.add(activeDrawingDrag.id);
        if (editingId) interacts.add(editingId);
        if (selectedShapeType && shapeStart) return;

        let hasChanges = false;
        const nextNodes: NoteNode[] = [];

        // Sync: Update/Add from Live
        liveNodes.forEach(liveNode => {
            const localNode = localMap.get(liveNode.id);
            if (localNode) {
                if (interacts.has(liveNode.id)) {
                    // Keeping local version due to interaction
                    nextNodes.push(localNode);
                } else {
                    // Update if different
                    if (JSON.stringify(localNode) !== JSON.stringify(liveNode)) {
                        nextNodes.push(liveNode);
                        hasChanges = true;
                    } else {
                        nextNodes.push(localNode);
                    }
                }
            } else {
                // New remote node
                nextNodes.push(liveNode);
                hasChanges = true;
            }
        });

        // Sync: Deletions (if local node missing from liveNodes, assume remote delete)
        // Only if we trust liveNodes is strictly up to date. 
        // For now, let's simplisticly assume liveNodes is the truth.
        if (nodesRef.current.length !== nextNodes.length) {
            hasChanges = true;
        }

        if (hasChanges) {
            setNodes(nextNodes);
            nodesRef.current = nextNodes;
        }
    }, [liveNodes, activeDrag, activeMultiDrag, activeDrawingDrag, editingId, shapeStart]);

    // 2. Broadcast State
    const lastBroadcastRef = useRef(0);
    const broadcastState = useCallback((e: React.PointerEvent | PointerEvent | null, force: boolean = false) => {
        if (!ownerUid || !currentProjectId || !currentUserUid) return;

        const now = Date.now();
        if (!force && now - lastBroadcastRef.current < 150) return; // Throttle 150ms
        lastBroadcastRef.current = now;

        const worldPos = e ? {
            x: (e.clientX - pan.x) / zoom,
            y: (e.clientY - pan.y) / zoom
        } : undefined;

        updatePresenceCursor(
            ownerUid,
            currentProjectId,
            currentUserUid,
            e?.clientX || 0,
            e?.clientY || 0,
            undefined,
            selectedIds.length === 1 ? selectedIds[0] : null,
            selectedIds.length === 1 ? 'note' : null,
            worldPos?.x,
            worldPos?.y,
            selectedIds
        );
    }, [ownerUid, currentProjectId, currentUserUid, pan.x, pan.y, zoom, selectedIds]);

    // Broadcast selection changes immediately
    useEffect(() => {
        broadcastState(null, true);
    }, [selectedIds, broadcastState]);


    const blobToBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Failed to read image blob'));
            reader.onload = () => {
                const result = String(reader.result || '');
                const commaIdx = result.indexOf(',');
                resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
            };
            reader.readAsDataURL(blob);
        });
    };

    const imageUrlToReference = async (imageUrl: string): Promise<ImageReference | null> => {
        const raw = (imageUrl || '').trim();
        if (!raw) return null;

        if (raw.startsWith('data:')) {
            const parts = raw.split(',');
            if (parts.length < 2) return null;
            const header = parts[0];
            const mimeType = header.split(':')[1]?.split(';')[0] || 'image/png';
            const base64 = parts[1];
            return { base64, mimeType };
        }

        if (/^https?:\/\//i.test(raw)) {
            try {
                const res = await fetch(raw);
                if (!res.ok) return null;
                const blob = await res.blob();
                const base64 = await blobToBase64(blob);
                const mimeType = blob.type || res.headers.get('content-type') || 'image/png';
                return { base64, mimeType };
            } catch {
                return null;
            }
        }

        return { base64: raw, mimeType: 'image/png' };
    };

    useEffect(() => {
        if (!currentProjectId) {
            setUserGalleryAssets([]);
            return;
        }
        try {
            const raw = localStorage.getItem(`notemap_gallery_assets_${currentProjectId}`);
            if (!raw) {
                setUserGalleryAssets([]);
                return;
            }
            const parsed = JSON.parse(raw) as { url: string; label: string; kind: 'image' | 'video'; mime?: string }[];
            if (Array.isArray(parsed)) setUserGalleryAssets(parsed);
        } catch {
            setUserGalleryAssets([]);
        }
    }, [currentProjectId]);

    useEffect(() => {
        if (!currentProjectId) return;
        try {
            localStorage.setItem(`notemap_gallery_assets_${currentProjectId}`, JSON.stringify(userGalleryAssets));
        } catch {
        }
    }, [currentProjectId, userGalleryAssets]);

    const handleGalleryUploadFiles = async (files: File[]) => {
        if (!files.length) return;
        setIsGalleryUploading(true);
        try {
            const uploaded: { url: string; label: string; kind: 'image' | 'video'; mime?: string }[] = [];
            for (const file of files) {
                const kind: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image';
                let url = '';
                try {
                    if (currentProjectId) {
                        const kb = await storageService.uploadKnowledgeBaseFile(currentProjectId, file);
                        url = kb.url;
                    } else {
                        url = URL.createObjectURL(file);
                    }
                } catch {
                    url = URL.createObjectURL(file);
                }
                uploaded.push({
                    url,
                    label: file.name || (kind === 'video' ? 'Video' : 'Image'),
                    kind,
                    mime: file.type,
                });
            }

            // Log activity for gallery upload
            if (currentProjectId && uploaded.length > 0) {
                logProjectActivity(
                    currentUserUid || 'anonymous',
                    currentProjectId,
                    'file_uploaded',
                    `Uploaded ${uploaded.length} file(s) to NoteMap gallery`,
                    {
                        count: uploaded.length,
                        files: uploaded.map(u => ({ name: u.label, type: u.kind })),
                        source: 'notemap_gallery'
                    }
                ).catch(err => console.error('Failed to log gallery upload:', err));
            }

            setUserGalleryAssets(prev => {
                const next = [...uploaded, ...prev];
                const dedup = new Map<string, { url: string; label: string; kind: 'image' | 'video'; mime?: string }>();
                for (const it of next) dedup.set(it.url, it);
                return Array.from(dedup.values());
            });
        } finally {
            setIsGalleryUploading(false);
        }
    };

    const collectConnectedNotes = (startId: string, opts?: { maxDepth?: number; maxNodes?: number }): NoteNode[] => {
        const maxDepth = Math.max(1, opts?.maxDepth ?? 2);
        const maxNodes = Math.max(1, opts?.maxNodes ?? 10);
        const all = nodesRef.current;
        const byId = new Map<string, NoteNode>();
        all.forEach(n => byId.set(n.id, n));

        const adjacency = new Map<string, Set<string>>();
        const ensure = (id: string) => {
            if (!adjacency.has(id)) adjacency.set(id, new Set<string>());
            return adjacency.get(id) as Set<string>;
        };

        all.forEach(n => {
            if ((n.type || 'note') !== 'note') return;
            const from = n.id;
            const targets = Array.isArray(n.connections) ? n.connections : [];
            targets.forEach(t => {
                if (!t) return;
                ensure(from).add(t);
                ensure(t).add(from);
            });
        });

        const seen = new Set<string>();
        const queue: { id: string; depth: number }[] = [{ id: startId, depth: 0 }];
        seen.add(startId);

        const result: NoteNode[] = [];
        while (queue.length) {
            const { id, depth } = queue.shift() as { id: string; depth: number };
            if (depth >= maxDepth) continue;
            const neighbors = Array.from(adjacency.get(id) || []);
            for (const nb of neighbors) {
                if (seen.has(nb)) continue;
                seen.add(nb);
                const node = byId.get(nb);
                if (node && (node.type || 'note') === 'note') {
                    result.push(node);
                    if (result.length >= maxNodes) return result;
                }
                queue.push({ id: nb, depth: depth + 1 });
            }
        }

        return result;
    };

    const buildConnectedNotesContext = (focusNode: NoteNode): string => {
        const connected = collectConnectedNotes(focusNode.id, { maxDepth: 2, maxNodes: 10 });
        if (!connected.length) return '';
        const lines = connected
            .map(n => {
                const body = (n.youtubeAnalysis || n.content || '').trim();
                const snippet = body.length > 650 ? body.slice(0, 650) + '…' : body;
                return `- ${n.title}: ${snippet}`;
            })
            .join('\n');
        return lines.trim();
    };

    const buildNoteGenerationContext = (node: NoteNode): string => {
        const base: string[] = [];
        if (researchReport) {
            base.push(`PROJECT/RESEARCH TOPIC: ${researchReport.topic}`);
            if ((researchReport.tldr || '').trim()) base.push(`TLDR:\n${researchReport.tldr}`);
            if ((researchReport.summary || '').trim()) base.push(`SUMMARY:\n${researchReport.summary}`);
            if (Array.isArray(researchReport.keyPoints) && researchReport.keyPoints.length) {
                const kp = researchReport.keyPoints
                    .slice(0, 8)
                    .map(k => `- ${k.title}: ${k.details}`)
                    .join('\n');
                base.push(`KEY POINTS:\n${kp}`);
            }
        }

        const connected = buildConnectedNotesContext(node);
        if (connected) {
            base.push(`CONNECTED NOTES:\n${connected}`);
        } else {
            const nearby = nodesRef.current
                .filter(n => n.id !== node.id && (n.type || 'note') === 'note')
                .map(n => {
                    const dx = (n.x || 0) - (node.x || 0);
                    const dy = (n.y || 0) - (node.y || 0);
                    return { n, d2: dx * dx + dy * dy };
                })
                .sort((a, b) => a.d2 - b.d2)
                .slice(0, 6)
                .map(({ n }) => `- ${n.title}: ${(n.youtubeAnalysis || n.content || '').substring(0, 500)}`)
                .join('\n');

            if (nearby) base.push(`NEARBY NOTES:\n${nearby}`);
        }
        return base.join('\n\n').trim();
    };

    const handleGenerateNoteContent = async (e: React.MouseEvent, nodeId: string) => {
        e.stopPropagation();

        const prevSnapshot = cloneNodesSnapshot(nodesRef.current);
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, isGenerating: true } : n));

        try {
            const node = nodesRef.current.find(n => n.id === nodeId);
            if (!node) return;

            const context = buildNoteGenerationContext(node);
            const markdown = await generateNoteContent(node, context);
            const text = (markdown || '').trim();
            const updated = nodesRef.current.map(n => n.id === nodeId ? { ...n, content: text || n.content, isGenerating: false, lastModified: Date.now() } : n);
            commitNodes(updated, { prevSnapshot });
        } catch (err) {
            console.error(err);
            setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, isGenerating: false } : n));
        }
    };

    // Collect all media from the report + user uploads for the gallery
    const galleryItems = useMemo(() => {
        const items: { url: string; label: string; kind: 'image' | 'video'; mime?: string }[] = [];
        if (!researchReport) {
            const unique = new Map<string, { url: string; label: string; kind: 'image' | 'video'; mime?: string }>();
            userGalleryAssets.forEach(it => unique.set(it.url, it));
            return Array.from(unique.values());
        }

        if (researchReport.headerImageUrl) items.push({ url: researchReport.headerImageUrl, label: 'Report Header', kind: 'image' });

        researchReport.slides?.forEach((s, i) => {
            if (s.imageUrl) items.push({ url: s.imageUrl, label: `Slide ${i + 1}`, kind: 'image' });
            if (s.imageUrls) s.imageUrls.forEach((u, j) => items.push({ url: u, label: `Slide ${i + 1}-${j + 1}`, kind: 'image' }));
        });

        researchReport.socialCampaign?.posts.forEach((p, i) => {
            if (p.imageUrl) items.push({ url: p.imageUrl, label: `${p.platform} Post`, kind: 'image' });
        });

        if (researchReport.blogPost?.imageUrl) items.push({ url: researchReport.blogPost.imageUrl, label: 'Blog Cover', kind: 'image' });

        const merged = [...userGalleryAssets, ...items];
        const unique = new Map<string, { url: string; label: string; kind: 'image' | 'video'; mime?: string }>();
        merged.forEach(it => unique.set(it.url, it));
        return Array.from(unique.values());
    }, [researchReport, userGalleryAssets]);

    const youtubeGalleryItems = useMemo(() => {
        const raw = researchReport?.youtubeVideos;
        if (!Array.isArray(raw)) return [];
        return raw
            .filter(v => !!(v && v.id && v.title))
            .map(v => ({
                id: v.id,
                title: v.title,
                thumbnail: v.thumbnail,
                channel: v.channel,
                duration: v.duration,
            }));
    }, [researchReport?.youtubeVideos]);

    const projectFileGalleryItems = useMemo(() => {
        const normalized: {
            key: string;
            name: string;
            url: string;
            mime: string;
            summary?: string;
            extractedText?: string;
        }[] = [];

        (projectKnowledgeBaseFiles || []).forEach(file => {
            const url = (file.url || '').toString();
            if (!url) return;
            normalized.push({
                key: `kb-${file.id}`,
                name: (file.name || 'File').toString(),
                url,
                mime: (file.type || 'application/octet-stream').toString(),
                summary: (file.summary || '').toString(),
                extractedText: (file.extractedText || '').toString(),
            });
        });

        (projectUploadedFiles || []).forEach(file => {
            const url = (file.uri || '').toString();
            if (!url) return;
            normalized.push({
                key: `uf-${file.uploadedAt}-${file.uri}`,
                name: (file.displayName || file.name || 'File').toString(),
                url,
                mime: (file.mimeType || 'application/octet-stream').toString(),
                summary: (file.summary || '').toString(),
            });
        });

        const dedup = new Map<string, typeof normalized[number]>();
        normalized.forEach(it => {
            if (!dedup.has(it.url)) dedup.set(it.url, it);
        });
        return Array.from(dedup.values());
    }, [projectKnowledgeBaseFiles, projectUploadedFiles]);

    const inferMediaKind = (name: string, url: string, mime: string): 'image' | 'video' | 'audio' | null => {
        const m = (mime || '').toLowerCase();
        if (m.startsWith('image/')) return 'image';
        if (m.startsWith('video/')) return 'video';
        if (m.startsWith('audio/')) return 'audio';

        const ref = `${name || ''} ${url || ''}`.toLowerCase();
        if (ref.match(/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/)) return 'image';
        if (ref.match(/\.(mp4|webm|mov|m4v|avi)(\?|#|$)/)) return 'video';
        if (ref.match(/\.(mp3|wav|m4a|aac|ogg)(\?|#|$)/)) return 'audio';
        return null;
    };

    const isDirectMediaUrl = (url: string): boolean => {
        const u = (url || '').trim();
        if (!u) return false;
        if (u.startsWith('blob:') || u.startsWith('data:')) return true;
        if (u.startsWith('http://') || u.startsWith('https://')) return true;
        return false;
    };

    const handleProjectFileDragStart = (
        e: React.DragEvent,
        item: {
            name: string;
            url: string;
            mime: string;
            summary?: string;
            extractedText?: string;
        }
    ) => {
        e.dataTransfer.setData('application/gemini-project-file-url', item.url);
        e.dataTransfer.setData('application/gemini-project-file-name', item.name);
        e.dataTransfer.setData('application/gemini-project-file-mime', item.mime);
        if (item.summary) e.dataTransfer.setData('application/gemini-project-file-summary', item.summary);
        if (item.extractedText) e.dataTransfer.setData('application/gemini-project-file-extracted-text', item.extractedText);
        e.dataTransfer.effectAllowed = 'copy';
    };

    const analyzeYoutubeVideo = async (videoId: string): Promise<string> => {
        const cached = (youtubeAnalysisById[videoId] || '').trim();
        if (cached) return cached;

        setYoutubeAnalysisLoadingById(prev => ({ ...prev, [videoId]: true }));
        setYoutubeAnalysisErrorById(prev => ({ ...prev, [videoId]: '' }));
        try {
            const res = await authFetch('/api/youtube-video-analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
                    topic: (researchReport?.topic || '').trim(),
                    projectDescription: '',
                }),
            });

            const data = await res.json().catch(() => ({} as any));
            if (!res.ok) {
                throw new Error(data?.error || 'Failed to analyze video');
            }

            const analysis = String(data?.analysis || '').trim();
            if (!analysis) throw new Error('Empty analysis returned');
            setYoutubeAnalysisById(prev => ({ ...prev, [videoId]: analysis }));
            return analysis;
        } catch (e: any) {
            const msg = e?.message || 'Failed to analyze video';
            setYoutubeAnalysisErrorById(prev => ({ ...prev, [videoId]: msg }));
            throw e;
        } finally {
            setYoutubeAnalysisLoadingById(prev => ({ ...prev, [videoId]: false }));
        }
    };

    const createYoutubeNoteNode = (opts: {
        videoId: string;
        title: string;
        thumbnail?: string;
        x: number;
        y: number;
        analysis?: string;
    }): NoteNode => {
        const youtubeUrl = `https://www.youtube.com/watch?v=${opts.videoId}`;
        const analysis = (opts.analysis || '').trim();
        const body = analysis ? `${youtubeUrl}\n\n${analysis}` : youtubeUrl;

        return {
            id: `node-yt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            x: opts.x,
            y: opts.y,
            title: opts.title || 'YouTube Video',
            content: body,
            youtubeVideoId: opts.videoId,
            youtubeUrl,
            youtubeThumbnailUrl: opts.thumbnail,
            youtubeAnalysis: analysis || undefined,
            imageUrl: opts.thumbnail || undefined,
            color: theme ? theme.secondary : '#475569',
            width: 360,
            type: 'note',
            createdAt: Date.now(),
            lastModified: Date.now(),
        };
    };

    // Initialize Nodes
    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);

    const cloneNodesSnapshot = (input: NoteNode[]): NoteNode[] => {
        return input.map(n => {
            const anyN: any = n as any;
            const cloned: any = { ...n };
            if (Array.isArray(anyN.connections)) cloned.connections = [...anyN.connections];
            if (Array.isArray(anyN.drawingPath)) {
                cloned.drawingPath = anyN.drawingPath.map((p: any) => ({ ...p }));
            } else if (anyN.drawingPath && typeof anyN.drawingPath === 'object') {
                cloned.drawingPath = { ...anyN.drawingPath };
            }
            return cloned as NoteNode;
        });
    };

    const clearTransientInteractionState = () => {
        setActiveDrag(null);
        setHoverTargetId(null);
        setConnectingNodeId(null);
        setTempConnectionPos(null);
        setCurrentStroke(null);
        setShapeStart(null);
        setShapeEnd(null);
        setIsPanning(false);
        setSelectedDrawingId(null);
        setSelectedTextId(null);
        setEditingId(null);
        setSelectionRect(null);
        setSelectedIds([]);
        setActiveMultiDrag(null);

        dragStartSnapshotRef.current = null;
        drawingDragStartSnapshotRef.current = null;
        multiDragStartSnapshotRef.current = null;
        multiDragMovedRef.current = false;
    };

    const handleMultiPointerMove = (e: { clientX: number; clientY: number }) => {
        if (!activeMultiDrag) return;
        const worldX = (e.clientX - pan.x) / zoom;
        const worldY = (e.clientY - pan.y) / zoom;
        const dx = worldX - activeMultiDrag.startWorldX;
        const dy = worldY - activeMultiDrag.startWorldY;
        if (dx === 0 && dy === 0) return;

        const idsSet = new Set(activeMultiDrag.ids);
        multiDragMovedRef.current = true;

        const base = multiDragStartSnapshotRef.current || nodesRef.current;
        const updated = applyDeltaToNodes(base, idsSet, dx, dy);
        setNodes(updated);
        nodesRef.current = updated;
    };

    const handleMultiPointerUpCommit = () => {
        const prevSnapshot = multiDragStartSnapshotRef.current;
        multiDragStartSnapshotRef.current = null;
        const moved = multiDragMovedRef.current;
        multiDragMovedRef.current = false;
        setActiveMultiDrag(null);

        if (!moved) return;
        if (prevSnapshot) {
            commitNodes(nodesRef.current, { prevSnapshot });
        } else {
            onUpdateState(nodesRef.current);
        }
    };

    const applyDeltaToNodes = (prevNodes: NoteNode[], idsSet: Set<string>, dx: number, dy: number): NoteNode[] => {
        if (dx === 0 && dy === 0) return prevNodes;
        return prevNodes.map(n => {
            if (!idsSet.has(n.id)) return n;
            if (n.type === 'drawing' && Array.isArray((n as any).drawingPath)) {
                const path = (n as any).drawingPath as { x: number; y: number }[];
                return {
                    ...(n as any),
                    x: (n.x || 0) + dx,
                    y: (n.y || 0) + dy,
                    drawingPath: path.map(p => ({ x: p.x + dx, y: p.y + dy }))
                } as NoteNode;
            }
            if (n.type === 'shape' && (n as any).drawingPath) {
                const d: any = (n as any).drawingPath;
                return {
                    ...(n as any),
                    x: (n.x || 0) + dx,
                    y: (n.y || 0) + dy,
                    drawingPath: {
                        ...d,
                        x1: (d.x1 || 0) + dx,
                        y1: (d.y1 || 0) + dy,
                        x2: (d.x2 || 0) + dx,
                        y2: (d.y2 || 0) + dy,
                    }
                } as NoteNode;
            }
            return { ...n, x: n.x + dx, y: n.y + dy };
        });
    };

    const applyTransformToNodesByIds = (ids: string[], deltaRotation: number, scaleFactor: number) => {
        if (!ids || ids.length === 0) return;
        const idsSet = new Set(ids);
        const prevSnapshot = cloneNodesSnapshot(nodesRef.current);
        const updated = nodesRef.current.map(n => {
            if (!idsSet.has(n.id)) return n;
            if (n.type !== 'text' && n.type !== 'drawing' && n.type !== 'shape') return n;

            const nextRotation = (n.rotation || 0) + deltaRotation;
            const nextScaleRaw = (n.scale || 1) * scaleFactor;
            const nextScale = Math.min(Math.max(nextScaleRaw, 0.2), 4);
            return { ...n, rotation: nextRotation, scale: nextScale };
        });
        commitNodes(updated, { prevSnapshot });
    };

    const deleteNodesByIds = (ids: string[]) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        const prevSnapshot = cloneNodesSnapshot(nodesRef.current);
        const updated = nodesRef.current
            .filter(n => !idSet.has(n.id))
            .map(n => ({
                ...n,
                connections: n.connections?.filter(cId => !idSet.has(cId)),
                parentId: n.parentId && idSet.has(n.parentId) ? undefined : n.parentId,
            }));

        commitNodes(updated, { prevSnapshot });
        setSelectedIds([]);
        setSelectedDrawingId(null);
        setSelectedTextId(null);
        setExpandedId(null);
        setEditingId(null);
    };

    const duplicateNodesByIds = (ids: string[]) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        const offset = 30;

        const toDup = nodesRef.current.filter(n => idSet.has(n.id));
        if (toDup.length === 0) return;

        const idMap = new Map<string, string>();
        toDup.forEach(n => idMap.set(n.id, `${n.type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`));

        const cloned = cloneNodesSnapshot(toDup).map((n: any) => {
            const newId = idMap.get(n.id) as string;
            const oldId = n.id;
            n.id = newId;

            if (typeof n.x === 'number') n.x = n.x + offset;
            if (typeof n.y === 'number') n.y = n.y + offset;

            if (n.type === 'drawing' && Array.isArray(n.drawingPath)) {
                n.drawingPath = n.drawingPath.map((p: any) => ({ x: p.x + offset, y: p.y + offset }));
            }
            if (n.type === 'shape' && n.drawingPath) {
                n.drawingPath = {
                    ...n.drawingPath,
                    x1: (n.drawingPath.x1 || 0) + offset,
                    y1: (n.drawingPath.y1 || 0) + offset,
                    x2: (n.drawingPath.x2 || 0) + offset,
                    y2: (n.drawingPath.y2 || 0) + offset,
                };
            }

            n.parentId = n.parentId && idMap.has(n.parentId) ? idMap.get(n.parentId) : undefined;
            if (Array.isArray(n.connections)) {
                const nextConnections = n.connections
                    .filter((cId: string) => idMap.has(cId))
                    .map((cId: string) => idMap.get(cId));
                n.connections = nextConnections;
            } else {
                n.connections = undefined;
            }

            if (n.type !== 'note') {
                n.connections = undefined;
            }

            n.lastModified = Date.now();
            n.createdAt = Date.now();

            return n as NoteNode;
        });

        const prevSnapshot = cloneNodesSnapshot(nodesRef.current);
        const updated = [...nodesRef.current, ...cloned];
        commitNodes(updated, { prevSnapshot });
        setSelectedIds(cloned.map(n => n.id));
    };

    const commitNodes = (
        nextNodes: NoteNode[],
        options?: { recordHistory?: boolean; prevSnapshot?: NoteNode[] }
    ) => {
        isDirtyRef.current = true;
        const recordHistory = options?.recordHistory !== false;
        const prevSnapshot = options?.prevSnapshot
            ? cloneNodesSnapshot(options.prevSnapshot)
            : cloneNodesSnapshot(nodesRef.current);
        const nextSnapshot = cloneNodesSnapshot(nextNodes);

        if (recordHistory) {
            setHistoryPast(prev => {
                const updated = [...prev, prevSnapshot];
                if (updated.length > HISTORY_LIMIT) updated.shift();
                return updated;
            });
            setHistoryFuture([]);
        }

        setNodes(nextSnapshot);
        nodesRef.current = nextSnapshot;
        onUpdateState(nextSnapshot);
    };

    const getNodeLocalBounds = (n: NoteNode) => {
        if (n.type === 'drawing' && Array.isArray((n as any).drawingPath) && (n as any).drawingPath.length > 0) {
            const pts = (n as any).drawingPath as { x: number; y: number }[];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of pts) {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            }
            return { minX, minY, maxX, maxY };
        }

        if (n.type === 'shape' && (n as any).drawingPath) {
            const d: any = (n as any).drawingPath;
            const x1 = typeof d.x1 === 'number' ? d.x1 : 0;
            const y1 = typeof d.y1 === 'number' ? d.y1 : 0;
            const x2 = typeof d.x2 === 'number' ? d.x2 : 0;
            const y2 = typeof d.y2 === 'number' ? d.y2 : 0;
            return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
        }

        const w = n.width || (n.type === 'text' ? 280 : 250);
        const h = n.type === 'text' ? 70 : 220;
        return { minX: n.x, minY: n.y, maxX: n.x + w, maxY: n.y + h };
    };

    const getNodeBounds = (n: NoteNode) => {
        const base = getNodeLocalBounds(n);
        const rotation = (n.rotation || 0) * (Math.PI / 180);
        const scale = n.scale || 1;
        if (!rotation && scale === 1) return base;

        const cx = (base.minX + base.maxX) / 2;
        const cy = (base.minY + base.maxY) / 2;
        const corners = [
            { x: base.minX, y: base.minY },
            { x: base.maxX, y: base.minY },
            { x: base.maxX, y: base.maxY },
            { x: base.minX, y: base.maxY },
        ];

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        for (const p of corners) {
            const dx = (p.x - cx) * scale;
            const dy = (p.y - cy) * scale;
            const rx = cx + dx * cos - dy * sin;
            const ry = cy + dx * sin + dy * cos;
            minX = Math.min(minX, rx);
            minY = Math.min(minY, ry);
            maxX = Math.max(maxX, rx);
            maxY = Math.max(maxY, ry);
        }
        return { minX, minY, maxX, maxY };
    };

    const getBoundsForNodes = (arr: NoteNode[]) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of arr) {
            const b = getNodeBounds(n);
            minX = Math.min(minX, b.minX);
            minY = Math.min(minY, b.minY);
            maxX = Math.max(maxX, b.maxX);
            maxY = Math.max(maxY, b.maxY);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
        return { minX, minY, maxX, maxY };
    };

    const zoomToBounds = (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const padding = 80;
        const w = Math.max(bounds.maxX - bounds.minX, 1);
        const h = Math.max(bounds.maxY - bounds.minY, 1);
        const scaleX = (rect.width - padding) / w;
        const scaleY = (rect.height - padding) / h;
        const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.1), 5);

        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;

        const targetScreenX = rect.left + rect.width / 2;
        const targetScreenY = rect.top + rect.height / 2;
        const newPanX = targetScreenX - cx * newZoom;
        const newPanY = targetScreenY - cy * newZoom;

        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
    };

    const handleZoomToFit = () => {
        const b = getBoundsForNodes(nodesRef.current);
        if (!b) return;
        zoomToBounds(b);
    };

    const handleCenter = () => {
        const selectedId = expandedId || selectedTextId || selectedDrawingId;
        if (selectedId) {
            const n = nodesRef.current.find(x => x.id === selectedId);
            if (n) {
                const b = getBoundsForNodes([n]);
                if (b) {
                    zoomToBounds(b);
                    return;
                }
            }
        }
        const b = getBoundsForNodes(nodesRef.current);
        if (!b) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const targetScreenX = rect.left + rect.width / 2;
        const targetScreenY = rect.top + rect.height / 2;
        setPan({ x: targetScreenX - cx * zoom, y: targetScreenY - cy * zoom });
    };

    const handleDuplicateSelection = () => {
        const selectedId = expandedId || selectedTextId || selectedDrawingId;
        if (!selectedId) return;
        const node = nodesRef.current.find(n => n.id === selectedId);
        if (!node) return;

        const offset = 30;
        const cloned: any = cloneNodesSnapshot([node])[0];
        const newId = `${node.type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        cloned.id = newId;
        cloned.parentId = undefined;
        cloned.connections = undefined;
        if (typeof cloned.x === 'number') cloned.x = cloned.x + offset;
        if (typeof cloned.y === 'number') cloned.y = cloned.y + offset;

        if (cloned.type === 'drawing' && Array.isArray(cloned.drawingPath)) {
            cloned.drawingPath = cloned.drawingPath.map((p: any) => ({ x: p.x + offset, y: p.y + offset }));
        }
        if (cloned.type === 'shape' && cloned.drawingPath) {
            cloned.drawingPath = {
                ...cloned.drawingPath,
                x1: (cloned.drawingPath.x1 || 0) + offset,
                y1: (cloned.drawingPath.y1 || 0) + offset,
                x2: (cloned.drawingPath.x2 || 0) + offset,
                y2: (cloned.drawingPath.y2 || 0) + offset,
            };
        }

        cloned.createdAt = Date.now();
        cloned.lastModified = Date.now();

        const updated = [...nodesRef.current, cloned as NoteNode];
        commitNodes(updated);

        if (cloned.type === 'text') setSelectedTextId(newId);
        else if (cloned.type === 'drawing' || cloned.type === 'shape') setSelectedDrawingId(newId);
        else setExpandedId(newId);
    };

    const handleUndo = () => {
        if (historyPast.length === 0) return;
        const currentSnapshot = cloneNodesSnapshot(nodesRef.current);
        const prevSnapshot = historyPast[historyPast.length - 1];

        setHistoryPast(prev => prev.slice(0, -1));
        setHistoryFuture(prev => [currentSnapshot, ...prev]);

        clearTransientInteractionState();
        const restored = cloneNodesSnapshot(prevSnapshot);
        setNodes(restored);
        nodesRef.current = restored;
        onUpdateState(restored);
    };

    const handleRedo = () => {
        if (historyFuture.length === 0) return;
        const currentSnapshot = cloneNodesSnapshot(nodesRef.current);
        const nextSnapshot = historyFuture[0];

        setHistoryFuture(prev => prev.slice(1));
        setHistoryPast(prev => {
            const updated = [...prev, currentSnapshot];
            if (updated.length > HISTORY_LIMIT) updated.shift();
            return updated;
        });

        clearTransientInteractionState();
        const restored = cloneNodesSnapshot(nextSnapshot);
        setNodes(restored);
        nodesRef.current = restored;
        onUpdateState(restored);
    };

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const key = (e.key || '').toLowerCase();
            const isMod = e.ctrlKey || e.metaKey;
            if (!isMod) return;

            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return;
            }

            if (key === 'z' && !e.shiftKey) {
                e.preventDefault();
                handleUndo();
                return;
            }

            if ((key === 'z' && e.shiftKey) || key === 'y') {
                e.preventDefault();
                handleRedo();
                return;
            }

            if (key === 'd') {
                e.preventDefault();
                if (toolMode === 'select') {
                    duplicateNodesByIds(selectedIds);
                    return;
                }
                if (toolMode === 'cursor') handleDuplicateSelection();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [historyPast, historyFuture, toolMode, expandedId, selectedTextId, selectedDrawingId, selectedIds]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (editingId) return;
            if (toolMode !== 'select') return;
            if (selectedIds.length === 0) return;
            if (e.key !== 'Delete' && e.key !== 'Backspace') return;
            e.preventDefault();
            deleteNodesByIds(selectedIds);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [editingId, toolMode, selectedIds]);

    useEffect(() => {
        const projectId = currentProjectId || null;
        if (hydratedProjectIdRef.current !== projectId) {
            hydratedProjectIdRef.current = projectId;
            hasHydratedFromPropsRef.current = false;
            isDirtyRef.current = false;
            setHistoryPast([]);
            setHistoryFuture([]);
            setYoutubeAnalysisById({});
            setYoutubeAnalysisLoadingById({});
            setYoutubeAnalysisErrorById({});
        }

        if (isDirtyRef.current) return;

        if (savedState && savedState.length > 0) {
            const snapshot = cloneNodesSnapshot(savedState);
            setNodes(snapshot);
            nodesRef.current = snapshot;
            const nextCache: Record<string, string> = {};
            snapshot.forEach(n => {
                const videoId = (n.youtubeVideoId || '').trim();
                const analysis = (n.youtubeAnalysis || '').trim();
                if (videoId && analysis) nextCache[videoId] = analysis;
            });
            setYoutubeAnalysisById(nextCache);
            setHistoryPast([]);
            setHistoryFuture([]);
            hasHydratedFromPropsRef.current = true;
            return;
        }

        if (!hasHydratedFromPropsRef.current && researchReport) {
            const initial = generateInitialNodes(researchReport);
            const snapshot = cloneNodesSnapshot(initial);
            setNodes(snapshot);
            nodesRef.current = snapshot;
            const nextCache: Record<string, string> = {};
            snapshot.forEach(n => {
                const videoId = (n.youtubeVideoId || '').trim();
                const analysis = (n.youtubeAnalysis || '').trim();
                if (videoId && analysis) nextCache[videoId] = analysis;
            });
            setYoutubeAnalysisById(nextCache);
            setHistoryPast([]);
            setHistoryFuture([]);
            onUpdateState(snapshot);
            hasHydratedFromPropsRef.current = true;
        }
    }, [currentProjectId, researchReport, savedState]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (editingId) return;
            if (!selectedDrawingId) return;
            if (toolMode !== 'cursor') return;
            if (e.key !== 'Delete' && e.key !== 'Backspace') return;
            const node = nodes.find(n => n.id === selectedDrawingId);
            if (!node || (node.type !== 'drawing' && node.type !== 'shape')) return;
            e.preventDefault();
            deleteNodeById(selectedDrawingId);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [editingId, selectedDrawingId, toolMode, nodes]);

    // --- ACTIONS ---

    const handleAddNode = () => {
        const centerX = (window.innerWidth / 2 - pan.x) / zoom;
        const centerY = (window.innerHeight / 2 - pan.y) / zoom;

        const DISTINCT_PALETTE = [
            '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
            '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1',
        ];
        const randomColor = DISTINCT_PALETTE[Math.floor(Math.random() * DISTINCT_PALETTE.length)];

        const newNode: NoteNode = {
            id: `node-${Date.now()}`,
            x: centerX - 125,
            y: centerY - 100,
            title: "New Idea",
            content: "Tap to edit this content...",
            width: 250,
            color: randomColor,
            type: 'note',
            createdAt: Date.now(),
            lastModified: Date.now()
        };

        const updated = [...nodesRef.current, newNode];
        commitNodes(updated);
        setEditingId(newNode.id);
        setEditForm({ title: newNode.title, content: newNode.content });
        setExpandedId(newNode.id);
    };

    const handleAddTextAnnotation = (x: number, y: number) => {
        const newNode: NoteNode = {
            id: `text-${Date.now()}`,
            x: x,
            y: y,
            title: "",
            content: "",
            color: drawingColor,
            type: 'text',
            fontSize: 16,
            createdAt: Date.now(),
            lastModified: Date.now()
        };
        const updated = [...nodesRef.current, newNode];
        commitNodes(updated);
        setEditingId(newNode.id);
        setEditForm({ title: '', content: '' });
    };

    const handleBranchNode = async (e: React.MouseEvent, node: NoteNode) => {
        e.stopPropagation();
        const prevSnapshot = cloneNodesSnapshot(nodesRef.current);
        setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isGenerating: true } : n));

        try {
            const focusBody = ((node.youtubeAnalysis || '').trim() ? (node.youtubeAnalysis as string) : node.content) || '';
            const connected = buildConnectedNotesContext(node);
            const combinedBody = connected
                ? `CONNECTED NOTES CONTEXT:\n${connected}\n\nFOCUS NOTE:\n${focusBody}`
                : focusBody;

            const branchSource: NoteNode = { ...node, content: combinedBody };
            const subTopics = await generateSubTopics(branchSource);
            const newNodes: NoteNode[] = [];
            const childColor = node.color ? darkenHex(node.color, 15) : (theme ? theme.accent : '#93c5fd');

            subTopics.forEach((topic, idx) => {
                const angle = (idx / subTopics.length) * Math.PI * 2 + (Math.random() * 0.5);
                const radius = 300;
                const newNodeId = `node-${Date.now()}-${idx}`;
                newNodes.push({
                    id: newNodeId,
                    x: node.x + Math.cos(angle) * radius,
                    y: node.y + Math.sin(angle) * radius + 50,
                    title: topic.title,
                    content: topic.content,
                    color: childColor,
                    width: 240,
                    parentId: node.id,
                    connections: [node.id], // Auto-connect branching
                    type: 'note',
                    createdAt: Date.now(),
                    lastModified: Date.now()
                });
            });

            const base = nodesRef.current.map(n => ({ ...n, isGenerating: false }));
            const updated = [...base, ...newNodes];
            commitNodes(updated, { prevSnapshot });
        } catch (err) {
            console.error(err);
            setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isGenerating: false } : n));
        }
    };

    const deleteNodeById = (id: string) => {
        const prevSnapshot = cloneNodesSnapshot(nodesRef.current);
        const updated = nodesRef.current.filter(n => n.id !== id).map(n => ({
            ...n,
            connections: n.connections?.filter(cId => cId !== id)
        }));

        commitNodes(updated, { prevSnapshot });

        if (expandedId === id) setExpandedId(null);
        if (editingId === id) setEditingId(null);
        if (selectedDrawingId === id) setSelectedDrawingId(null);
        if (selectedTextId === id) setSelectedTextId(null);
    };

    const handleDeleteNode = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        e.preventDefault();
        deleteNodeById(id);
    };

    const applyDrawingDelta = (prevNodes: NoteNode[], id: string, dx: number, dy: number): NoteNode[] => {
        return prevNodes.map(n => {
            if (n.id !== id) return n;
            if (n.type === 'drawing' && Array.isArray(n.drawingPath)) {
                return {
                    ...n,
                    x: (n.x || 0) + dx,
                    y: (n.y || 0) + dy,
                    drawingPath: n.drawingPath.map(p => ({ x: p.x + dx, y: p.y + dy }))
                };
            }
            if (n.type === 'shape' && n.drawingPath) {
                const d: any = n.drawingPath;
                return {
                    ...n,
                    x: (n.x || 0) + dx,
                    y: (n.y || 0) + dy,
                    drawingPath: {
                        ...d,
                        x1: (d.x1 || 0) + dx,
                        y1: (d.y1 || 0) + dy,
                        x2: (d.x2 || 0) + dx,
                        y2: (d.y2 || 0) + dy,
                    }
                };
            }
            return n;
        });
    };

    const handleDrawingPointerDown = (e: React.PointerEvent, id: string) => {
        if (toolMode !== 'cursor' && toolMode !== 'select') return;
        if (editingId) return;
        e.stopPropagation();
        e.preventDefault();

        if (toolMode === 'select') {
            const worldX = (e.clientX - pan.x) / zoom;
            const worldY = (e.clientY - pan.y) / zoom;
            const nextIds = selectedIds.includes(id) ? selectedIds : [id];
            setSelectedIds(nextIds);
            setSelectedDrawingId(null);
            setSelectedTextId(null);
            setExpandedId(null);

            (e.target as Element).setPointerCapture(e.pointerId);
            multiDragStartSnapshotRef.current = cloneNodesSnapshot(nodesRef.current);
            multiDragMovedRef.current = false;
            setActiveMultiDrag({ ids: nextIds, startWorldX: worldX, startWorldY: worldY });
            return;
        }

        setSelectedDrawingId(id);
        setSelectedTextId(null);
        (e.target as Element).setPointerCapture(e.pointerId);

        drawingDragStartSnapshotRef.current = cloneNodesSnapshot(nodesRef.current);

        const worldX = (e.clientX - pan.x) / zoom;
        const worldY = (e.clientY - pan.y) / zoom;
        lastDrawnNodesRef.current = null;
        setActiveDrawingDrag({ id, lastWorldX: worldX, lastWorldY: worldY });
    };

    const handleDrawingPointerMove = (e: React.PointerEvent) => {
        if (toolMode === 'select' && activeMultiDrag) {
            handleMultiPointerMove(e);
            return;
        }
        if (!activeDrawingDrag) return;
        if (toolMode !== 'cursor') return;
        e.stopPropagation();
        e.preventDefault();

        const worldX = (e.clientX - pan.x) / zoom;
        const worldY = (e.clientY - pan.y) / zoom;
        const dx = worldX - activeDrawingDrag.lastWorldX;
        const dy = worldY - activeDrawingDrag.lastWorldY;
        if (dx === 0 && dy === 0) return;

        setNodes(prev => {
            const updated = applyDrawingDelta(prev, activeDrawingDrag.id, dx, dy);
            lastDrawnNodesRef.current = updated;
            nodesRef.current = updated;
            return updated;
        });

        setActiveDrawingDrag(prev => prev ? { ...prev, lastWorldX: worldX, lastWorldY: worldY } : prev);
    };

    const handleDrawingPointerUp = (e: React.PointerEvent) => {
        if (toolMode === 'select' && activeMultiDrag) {
            e.stopPropagation();
            e.preventDefault();
            try {
                (e.target as Element).releasePointerCapture(e.pointerId);
            } catch {
            }
            handleMultiPointerUpCommit();
            return;
        }
        if (!activeDrawingDrag) return;
        if (toolMode !== 'cursor') return;
        e.stopPropagation();
        e.preventDefault();

        try {
            (e.target as Element).releasePointerCapture(e.pointerId);
        } catch (err) {
        }

        const finalNodes = lastDrawnNodesRef.current;
        if (finalNodes) {
            const prevSnapshot = drawingDragStartSnapshotRef.current;
            drawingDragStartSnapshotRef.current = null;
            if (prevSnapshot) {
                commitNodes(finalNodes, { prevSnapshot });
            } else {
                onUpdateState(finalNodes);
            }
        }

        if (!finalNodes) {
            drawingDragStartSnapshotRef.current = null;
        }
        lastDrawnNodesRef.current = null;
        setActiveDrawingDrag(null);
    };

    const getSelectedDrawingDeleteButtonPos = () => {
        if (toolMode !== 'cursor') return null;
        if (!selectedDrawingId) return null;
        const node = nodes.find(n => n.id === selectedDrawingId);
        if (!node || (node.type !== 'drawing' && node.type !== 'shape')) return null;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return null;

        const b = getNodeBounds(node);
        if (!Number.isFinite(b.minX) || !Number.isFinite(b.minY) || !Number.isFinite(b.maxX) || !Number.isFinite(b.maxY)) return null;

        const anchorWorldX = b.maxX;
        const anchorWorldY = b.minY;
        const anchorScreenX = pan.x + anchorWorldX * zoom;
        const anchorScreenY = pan.y + anchorWorldY * zoom;

        const offsetX = 10;
        const offsetY = -10;
        let left = anchorScreenX - rect.left + offsetX;
        let top = anchorScreenY - rect.top + offsetY;

        const btnW = 72;
        const btnH = 32;
        left = Math.min(Math.max(left, 8), rect.width - btnW - 8);
        top = Math.min(Math.max(top, 8), rect.height - btnH - 8);

        return { left, top };
    };

    const getSelectedTextActionPos = () => {
        if (toolMode !== 'cursor') return null;
        if (!selectedTextId) return null;
        if (editingId === selectedTextId) return null;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return null;

        const el = document.querySelector(`[data-node-id="${selectedTextId}"]`) as HTMLElement | null;
        if (!el) return null;
        const elRect = el.getBoundingClientRect();

        const offsetX = 8;
        const offsetY = -6;
        let left = elRect.right - rect.left + offsetX;
        let top = elRect.top - rect.top + offsetY;

        const btnW = 160;
        const btnH = 36;
        left = Math.min(Math.max(left, 8), rect.width - btnW - 8);
        top = Math.min(Math.max(top, 8), rect.height - btnH - 8);

        return { left, top };
    };

    const handleEditSave = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingId) return;

        const updated = nodesRef.current.map(n =>
            n.id === editingId
                ? { ...n, title: editForm.title, content: editForm.content, lastModified: Date.now() }
                : n
        );
        commitNodes(updated);
        setEditingId(null);
    };

    // --- IMAGE GENERATION & EDITING ---

    const handleGenerateImageForNode = async (node: NoteNode) => {
        setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isGenerating: true } : n));
        try {
            const prompt = `A conceptual illustration for "${node.title}": ${node.content.substring(0, 100)}`;
            const result = await generateImage(prompt);
            const url = result.imageDataUrl;

            const updated = nodesRef.current.map(n => n.id === node.id ? { ...n, imageUrl: url, isGenerating: false, lastModified: Date.now() } : n);
            commitNodes(updated, { recordHistory: false });
        } catch (e) {
            console.error(e);
            setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isGenerating: false } : n));
        }
    };

    const handleEditImageSubmit = async () => {
        if (!imageEditId || !imagePrompt.trim()) return;

        const node = nodes.find(n => n.id === imageEditId);
        if (!node || !node.imageUrl) return;

        setNodes(prev => prev.map(n => n.id === imageEditId ? { ...n, isGenerating: true } : n));
        setImageEditId(null); // Close modal

        try {
            // Edit existing image
            let base64 = node.imageUrl;
            let mime = 'image/png';
            if (base64.startsWith('data:')) {
                const parts = base64.split(',');
                mime = parts[0].split(':')[1].split(';')[0];
                base64 = parts[1];
            }

            const newUrl = await editImage(base64, mime, imagePrompt);

            const updated = nodesRef.current.map(n => n.id === node.id ? { ...n, imageUrl: newUrl, isGenerating: false, lastModified: Date.now() } : n);
            commitNodes(updated, { recordHistory: false });
        } catch (e) {
            console.error(e);
            alert("Image edit failed.");
            setNodes(prev => prev.map(n => n.id === node.id ? { ...n, isGenerating: false } : n));
        } finally {
            setImagePrompt('');
        }
    };

    const handleGlobalGenerate = async () => {
        if (!globalPrompt.trim()) return;

        setGlobalPromptOpen(false);

        const centerX = (window.innerWidth / 2 - pan.x) / zoom;
        const centerY = (window.innerHeight / 2 - pan.y) / zoom;

        const tempId = `node-${Date.now()}`;

        // Add placeholder node
        const newNode: NoteNode = {
            id: tempId,
            x: centerX - 150,
            y: centerY - 150,
            title: "Generative Art",
            content: globalPrompt,
            color: theme ? theme.accent : '#3b82f6',
            width: 300,
            isGenerating: true,
            type: 'note',
            createdAt: Date.now(),
            lastModified: Date.now()
        };

        setNodes(prev => {
            const next = [...prev, newNode];
            nodesRef.current = next;
            return next;
        });

        try {
            const result = await generateImage(globalPrompt);
            const url = result.imageDataUrl;
            const updated = nodesRef.current.map(n => {
                if (n.id === tempId) return null; // Remove placeholder logic in state update below
                return n;
            }).filter(Boolean) as NoteNode[];

            const finalNodes = [...updated, { ...newNode, imageUrl: url, isGenerating: false }];
            commitNodes(finalNodes, { recordHistory: false });

        } catch (e) {
            console.error(e);
            setNodes(prev => prev.filter(n => n.id !== tempId)); // Remove if failed
        } finally {
            setGlobalPrompt('');
        }
    };

    // --- DRAG & DROP FROM GALLERY ---

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    };

    // Touch Drag State
    const [touchDragItem, setTouchDragItem] = useState<{
        item: { url: string; label: string; kind: 'image' | 'video'; mime?: string };
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
    } | null>(null);

    const importGalleryAsset = (
        asset: { url: string; label: string; kind: 'image' | 'video'; mime?: string },
        clientX: number,
        clientY: number
    ) => {
        const isVideo = asset.kind === 'video' || (!!asset.mime && asset.mime.startsWith('video/'));

        // Calculate world coordinates
        const worldX = (clientX - pan.x) / zoom;
        const worldY = (clientY - pan.y) / zoom;

        const newNode: NoteNode = {
            id: `node-img-${Date.now()}`,
            x: worldX - 150, // Center
            y: worldY - 150,
            title: asset.label || (isVideo ? "Gallery Video" : "Gallery Image"),
            content: "Imported from gallery.",
            color: theme ? theme.secondary : '#475569',
            width: 300,
            imageUrl: isVideo ? undefined : asset.url,
            videoUrl: isVideo ? asset.url : undefined,
            type: 'note',
            createdAt: Date.now(),
            lastModified: Date.now()
        };

        const updated = [...nodesRef.current, newNode];
        commitNodes(updated);

        // Log activity for gallery import
        if (currentProjectId) {
            logProjectActivity(
                currentUserUid || 'anonymous',
                currentProjectId,
                'note_added',
                `Added gallery ${asset.kind || 'asset'} to NoteMap: ${asset.label || 'Asset'}`,
                {
                    label: asset.label,
                    kind: asset.kind,
                    mimeType: asset.mime,
                    type: 'gallery_import',
                    source: 'notemap_gallery'
                }
            ).catch(err => console.error('Failed to log gallery import:', err));
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        const clientX = e.clientX;
        const clientY = e.clientY;
        const files = Array.from(e.dataTransfer.files || []);

        const isTextLike = (file: File): boolean => {
            const mt = (file.type || '').toLowerCase();
            const name = (file.name || '').toLowerCase();
            if (mt.startsWith('text/')) return true;
            if (mt === 'application/json') return true;
            if (mt === 'application/xml' || mt === 'text/xml') return true;
            if (name.endsWith('.md') || name.endsWith('.markdown')) return true;
            if (name.endsWith('.txt') || name.endsWith('.csv')) return true;
            if (name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml')) return true;
            if (name.endsWith('.xml') || name.endsWith('.html') || name.endsWith('.htm')) return true;
            return false;
        };

        const readFileAsText = async (file: File): Promise<string> => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.onload = () => resolve(String(reader.result || ''));
                reader.readAsText(file);
            });
        };

        // Native file drop (from desktop) -> create nodes
        if (files.length > 0) {
            const supported = files.filter(f => !!f);
            if (supported.length === 0) return;

            const worldX = (clientX - pan.x) / zoom;
            const worldY = (clientY - pan.y) / zoom;
            const prevSnapshot = cloneNodesSnapshot(nodesRef.current);
            const createdNodes: NoteNode[] = [];
            const createdAssets: { url: string; label: string; kind: 'image' | 'video'; mime?: string }[] = [];

            for (let i = 0; i < supported.length; i++) {
                const file = supported[i];
                const mt = (file.type || '').toLowerCase();
                const isImage = mt.startsWith('image/');
                const isVideo = mt.startsWith('video/');
                const isAudio = mt.startsWith('audio/');
                const kind: 'image' | 'video' | 'audio' | 'file' = isVideo ? 'video' : isAudio ? 'audio' : isImage ? 'image' : 'file';
                let url = '';
                try {
                    if (currentProjectId) {
                        const kb = await storageService.uploadKnowledgeBaseFile(currentProjectId, file);
                        url = kb.url;
                    } else {
                        url = URL.createObjectURL(file);
                    }
                } catch {
                    url = URL.createObjectURL(file);
                }

                let textContent: string | null = null;
                if (isTextLike(file)) {
                    try {
                        const rawText = await readFileAsText(file);
                        const clipped = rawText.length > 8000 ? rawText.slice(0, 8000) + '\n\n…(truncated)' : rawText;
                        textContent = clipped;
                    } catch {
                        textContent = null;
                    }
                }

                const offset = 40 * i;
                createdNodes.push({
                    id: `node-media-${Date.now()}-${Math.floor(Math.random() * 1000)}-${i}`,
                    x: worldX - 150 + offset,
                    y: worldY - 150 + offset,
                    title: file.name || (kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'image' ? 'Image' : 'File'),
                    content:
                        textContent !== null
                            ? textContent
                            : kind === 'file'
                                ? `Imported file: ${file.name || 'File'}`
                                : 'Imported from files.',
                    color: theme ? theme.secondary : '#475569',
                    width: kind === 'file' ? 420 : 300,
                    imageUrl: kind === 'image' ? url : undefined,
                    videoUrl: kind === 'video' ? url : undefined,
                    audioUrl: kind === 'audio' ? url : undefined,
                    fileUrl: kind === 'file' ? url : undefined,
                    fileName: kind === 'file' ? (file.name || 'File') : undefined,
                    fileMime: kind === 'file' ? (file.type || 'application/octet-stream') : undefined,
                    fileSize: kind === 'file' ? file.size : undefined,
                    type: 'note',
                    createdAt: Date.now(),
                    lastModified: Date.now()
                });

                if (kind === 'image' || kind === 'video') {
                    createdAssets.push({ url, label: file.name || (kind === 'video' ? 'Video' : 'Image'), kind, mime: file.type });
                }
            }

            if (createdNodes.length > 0) {
                commitNodes([...nodesRef.current, ...createdNodes], { prevSnapshot });

                // Log activity for file drop
                if (currentProjectId) {
                    logProjectActivity(
                        currentUserUid || 'anonymous',
                        currentProjectId,
                        'file_uploaded',
                        `Added ${createdNodes.length} file(s) to NoteMap via drag & drop`,
                        {
                            count: createdNodes.length,
                            files: createdNodes.map(n => ({ name: n.title, type: n.imageUrl ? 'image' : n.videoUrl ? 'video' : n.audioUrl ? 'audio' : 'file' })),
                            source: 'notemap_drop'
                        }
                    ).catch(err => console.error('Failed to log file drop:', err));
                }
            }

            if (createdAssets.length > 0) {
                setUserGalleryAssets(prev => {
                    const next = [...createdAssets, ...prev];
                    const dedup = new Map<string, { url: string; label: string; kind: 'image' | 'video'; mime?: string }>();
                    for (const it of next) dedup.set(it.url, it);
                    return Array.from(dedup.values());
                });
            }
            return;
        }

        // YouTube drag payload
        const ytVideoId = e.dataTransfer.getData('application/gemini-youtube-video-id');
        if (ytVideoId) {
            const ytTitle = e.dataTransfer.getData('application/gemini-youtube-video-title');
            const ytThumb = e.dataTransfer.getData('application/gemini-youtube-video-thumbnail');

            const worldX = (clientX - pan.x) / zoom;
            const worldY = (clientY - pan.y) / zoom;

            const newNode = createYoutubeNoteNode({
                videoId: ytVideoId,
                title: ytTitle || 'YouTube Video',
                thumbnail: ytThumb || undefined,
                x: worldX - 180,
                y: worldY - 150,
                analysis: (youtubeAnalysisById[ytVideoId] || '').trim() || undefined,
            });

            commitNodes([...nodesRef.current, newNode]);

            // Log activity for YouTube drop
            if (currentProjectId) {
                logProjectActivity(
                    currentUserUid || 'anonymous',
                    currentProjectId,
                    'note_added',
                    `Added YouTube video to NoteMap: ${ytTitle || 'YouTube Video'}`,
                    {
                        videoId: ytVideoId,
                        title: ytTitle,
                        type: 'youtube_note'
                    }
                ).catch(err => console.error('Failed to log YouTube drop:', err));
            }
            return;
        }

        // Project file drag payload
        const projectFileUrl = e.dataTransfer.getData('application/gemini-project-file-url');
        if (projectFileUrl) {
            const projectFileName = e.dataTransfer.getData('application/gemini-project-file-name');
            const projectFileMime = e.dataTransfer.getData('application/gemini-project-file-mime');
            const projectFileSummary = e.dataTransfer.getData('application/gemini-project-file-summary');
            const projectFileExtractedText = e.dataTransfer.getData('application/gemini-project-file-extracted-text');

            const worldX = (clientX - pan.x) / zoom;
            const worldY = (clientY - pan.y) / zoom;

            const summary = (projectFileSummary || '').trim();
            const extracted = (projectFileExtractedText || '').trim();
            const body = summary || extracted || `Imported file: ${projectFileName || 'File'}`;

            const inferredKind = inferMediaKind(projectFileName || '', projectFileUrl, projectFileMime || '');
            const canPreview = !!inferredKind && isDirectMediaUrl(projectFileUrl);
            const isImage = canPreview && inferredKind === 'image';
            const isVideo = canPreview && inferredKind === 'video';
            const isAudio = canPreview && inferredKind === 'audio';

            const newNode: NoteNode = {
                id: `node-projfile-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                x: worldX - 180,
                y: worldY - 150,
                title: projectFileName || 'Project File',
                content: body,
                color: theme ? theme.secondary : '#475569',
                width: (isImage || isVideo) ? 300 : (isAudio ? 360 : 420),
                type: 'note',
                imageUrl: isImage ? projectFileUrl : undefined,
                videoUrl: isVideo ? projectFileUrl : undefined,
                audioUrl: isAudio ? projectFileUrl : undefined,
                fileUrl: (isImage || isVideo || isAudio) ? undefined : projectFileUrl,
                fileName: projectFileName || 'File',
                fileMime: projectFileMime || 'application/octet-stream',
                createdAt: Date.now(),
                lastModified: Date.now()
            };

            commitNodes([...nodesRef.current, newNode]);

            // Log activity for project file import
            if (currentProjectId) {
                logProjectActivity(
                    currentUserUid || 'anonymous',
                    currentProjectId,
                    'note_added',
                    `Imported project file to NoteMap: ${projectFileName || 'File'}`,
                    {
                        fileName: projectFileName,
                        mimeType: projectFileMime,
                        type: 'project_file_import',
                        source: 'project_assets'
                    }
                ).catch(err => console.error('Failed to log project file import:', err));
            }
            return;
        }

        // Gallery drag payload
        const assetUrl = e.dataTransfer.getData("application/gemini-asset-url") || e.dataTransfer.getData("application/gemini-image-url");
        const assetLabel = e.dataTransfer.getData("application/gemini-asset-label") || e.dataTransfer.getData("application/gemini-image-label");
        const assetKind = e.dataTransfer.getData("application/gemini-asset-kind");
        const assetMime = e.dataTransfer.getData("application/gemini-asset-mime");

        if (!assetUrl) return;

        const asset = {
            url: assetUrl,
            label: assetLabel,
            kind: (assetKind as 'image' | 'video') || 'image',
            mime: assetMime
        };
        importGalleryAsset(asset, clientX, clientY);
    };

    // Global Touch Listeners for Gallery DnD
    useEffect(() => {
        if (!touchDragItem) return;

        const onTouchMove = (e: TouchEvent) => {
            const touch = e.touches[0];
            if (!touch) return;
            const dx = touch.clientX - touchDragItem.startX;
            const dy = touch.clientY - touchDragItem.startY;
            // Only prevent scroll if moved significantly
            if (Math.hypot(dx, dy) > 5) {
                e.preventDefault();
            }
            setTouchDragItem(prev => prev ? { ...prev, currentX: touch.clientX, currentY: touch.clientY } : null);
        };

        const onTouchEnd = (e: TouchEvent) => {
            const touch = e.changedTouches[0];
            const endX = touch ? touch.clientX : touchDragItem.currentX;
            const endY = touch ? touch.clientY : touchDragItem.currentY;

            // Check if dropped on canvas
            const canvasRect = containerRef.current?.getBoundingClientRect();
            if (canvasRect) {
                const onCanvas =
                    endX >= canvasRect.left &&
                    endX <= canvasRect.right &&
                    endY >= canvasRect.top &&
                    endY <= canvasRect.bottom;

                if (onCanvas) {
                    importGalleryAsset(touchDragItem.item, endX, endY);
                }
            }
            setTouchDragItem(null);
        };

        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
        window.addEventListener('touchcancel', onTouchEnd);
        return () => {
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onTouchEnd);
            window.removeEventListener('touchcancel', onTouchEnd);
        };
    }, [touchDragItem]);

    const handleGalleryTouchStart = (
        e: React.TouchEvent,
        item: { url: string; label: string; kind: 'image' | 'video'; mime?: string }
    ) => {
        const touch = e.touches[0];
        if (!touch) return;
        setTouchDragItem({
            item,
            startX: touch.clientX,
            startY: touch.clientY,
            currentX: touch.clientX,
            currentY: touch.clientY
        });
    };

    const handleGalleryDragStart = (e: React.DragEvent, item: { url: string; label: string; kind: 'image' | 'video'; mime?: string }) => {
        e.dataTransfer.setData("application/gemini-asset-url", item.url);
        e.dataTransfer.setData("application/gemini-asset-label", item.label);
        e.dataTransfer.setData("application/gemini-asset-kind", item.kind);
        if (item.mime) e.dataTransfer.setData("application/gemini-asset-mime", item.mime);
        if (item.kind === 'image') {
            e.dataTransfer.setData("application/gemini-image-url", item.url);
            e.dataTransfer.setData("application/gemini-image-label", item.label);
        }
        e.dataTransfer.effectAllowed = "copy";
    };

    const handleYoutubeGalleryDragStart = (
        e: React.DragEvent,
        item: { id: string; title: string; thumbnail?: string }
    ) => {
        e.dataTransfer.setData('application/gemini-youtube-video-id', item.id);
        e.dataTransfer.setData('application/gemini-youtube-video-title', item.title);
        if (item.thumbnail) e.dataTransfer.setData('application/gemini-youtube-video-thumbnail', item.thumbnail);
        e.dataTransfer.effectAllowed = 'copy';
    };

    const handleAnalyzeYoutubeFromGallery = async (
        e: React.MouseEvent,
        item: { id: string; title: string; thumbnail?: string }
    ) => {
        e.preventDefault();
        e.stopPropagation();

        const centerX = (window.innerWidth / 2 - pan.x) / zoom;
        const centerY = (window.innerHeight / 2 - pan.y) / zoom;
        const placeholderId = `node-yt-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const youtubeUrl = `https://www.youtube.com/watch?v=${item.id}`;

        const placeholder: NoteNode = {
            id: placeholderId,
            x: centerX - 180,
            y: centerY - 150,
            title: item.title || 'YouTube Video',
            content: youtubeUrl,
            youtubeVideoId: item.id,
            youtubeUrl,
            youtubeThumbnailUrl: item.thumbnail,
            imageUrl: item.thumbnail,
            color: theme ? theme.secondary : '#475569',
            width: 360,
            type: 'note',
            isGenerating: true,
            createdAt: Date.now(),
            lastModified: Date.now()
        };

        commitNodes([...nodesRef.current, placeholder]);

        try {
            const analysis = await analyzeYoutubeVideo(item.id);
            const updated = nodesRef.current.map(n => {
                if (n.id !== placeholderId) return n;
                return {
                    ...n,
                    isGenerating: false,
                    youtubeAnalysis: analysis,
                    content: `${youtubeUrl}\n\n${analysis}`,
                    lastModified: Date.now()
                };
            });
            commitNodes(updated, { recordHistory: false });
        } catch {
            const msg = (youtubeAnalysisErrorById[item.id] || 'Failed to analyze video').trim();
            const updated = nodesRef.current.map(n => {
                if (n.id !== placeholderId) return n;
                return {
                    ...n,
                    isGenerating: false,
                    content: `${youtubeUrl}\n\n${msg}`,
                };
            });
            commitNodes(updated, { recordHistory: false });
        }
    };

    const handleAnalyzeYoutubeFromNode = async (e: React.MouseEvent, nodeId: string) => {
        e.preventDefault();
        e.stopPropagation();
        const node = nodesRef.current.find(n => n.id === nodeId);
        const videoId = (node?.youtubeVideoId || '').trim();
        if (!node || !videoId) return;

        const existing = (node.youtubeAnalysis || youtubeAnalysisById[videoId] || '').trim();
        if (existing) {
            const url = node.youtubeUrl || `https://www.youtube.com/watch?v=${videoId}`;
            const updated = nodesRef.current.map(n => n.id === nodeId ? { ...n, youtubeAnalysis: existing, content: `${url}\n\n${existing}` } : n);
            commitNodes(updated, { recordHistory: false });
            return;
        }

        const updatedBusy = nodesRef.current.map(n => n.id === nodeId ? { ...n, isGenerating: true } : n);
        commitNodes(updatedBusy, { recordHistory: false });

        try {
            const analysis = await analyzeYoutubeVideo(videoId);
            const url = node.youtubeUrl || `https://www.youtube.com/watch?v=${videoId}`;
            const updated = nodesRef.current.map(n => {
                return { ...n, isGenerating: false, youtubeAnalysis: analysis, content: `${url}\n\n${analysis}`, lastModified: Date.now() };
            });
            commitNodes(updated, { recordHistory: false });
        } catch {
            const msg = (youtubeAnalysisErrorById[videoId] || 'Failed to analyze video').trim();
            const url = node.youtubeUrl || `https://www.youtube.com/watch?v=${videoId}`;
            const updated = nodesRef.current.map(n => {
                if (n.id !== nodeId) return n;
                return { ...n, isGenerating: false, content: `${url}\n\n${msg}` };
            });
            commitNodes(updated, { recordHistory: false });
        }
    };


    // --- ZOOM & PAN LOGIC ---

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();

        const scaleAmount = -e.deltaY * 0.001;
        const newZoom = Math.min(Math.max(zoom * (1 + scaleAmount), 0.1), 5);

        const cursorX = e.clientX;
        const cursorY = e.clientY;

        const newPanX = cursorX - (cursorX - pan.x) * (newZoom / zoom);
        const newPanY = cursorY - (cursorY - pan.y) * (newZoom / zoom);

        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
    };

    const handleZoomBtn = (direction: 'in' | 'out') => {
        const factor = direction === 'in' ? 1.2 : 0.8;
        const newZoom = Math.min(Math.max(zoom * factor, 0.1), 5);

        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;

        const newPanX = cx - (cx - pan.x) * (newZoom / zoom);
        const newPanY = cy - (cy - pan.y) * (newZoom / zoom);

        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
    };

    // --- CANVAS POINTER HANDLERS ---

    const handleCanvasPointerDown = (e: React.PointerEvent) => {
        const target = e.target as HTMLElement;
        if (
            target.closest('button') ||
            target.closest('input') ||
            target.closest('textarea') ||
            target.closest('select') ||
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT'
        ) return;

        setSelectedDrawingId(null);
        setSelectedTextId(null);

        const isMouse = e.pointerType === 'mouse';
        const isMiddleMouse = isMouse && e.button === 1;
        const isRightMouse = isMouse && e.button === 2;

        // Ignore right-click drags on the canvas
        if (isRightMouse) return;

        e.preventDefault();
        (e.target as Element).setPointerCapture(e.pointerId);

        // Track pointers for pan / pinch gestures
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // Two-finger gestures (typically touch devices)
        if (pointersRef.current.size === 2) {
            const points = Array.from(pointersRef.current.values());
            const p1 = points[0] as { x: number, y: number };
            const p2 = points[1] as { x: number, y: number };
            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

            prevPinchDistRef.current = dist;
            prevPinchCenterRef.current = center;
            pinchModeRef.current = 'none';

            // Cancel any in-progress drawing when entering a two-finger gesture
            setCurrentStroke(null);
            setShapeStart(null);
            setShapeEnd(null);
            setIsPanning(false);
            return;
        }

        // Selection tool: start marquee selection on background
        if (toolMode === 'select' && !isMiddleMouse) {
            const worldX = (e.clientX - pan.x) / zoom;
            const worldY = (e.clientY - pan.y) / zoom;
            setSelectionRect({ x1: worldX, y1: worldY, x2: worldX, y2: worldY });
            setSelectedIds([]);
            setActiveMultiDrag(null);
            setIsPanning(false);
            return;
        }
        if (!isMiddleMouse) {
            // Handle Pen Tool (primary button / touch only)
            if (toolMode === 'pen') {
                const worldX = (e.clientX - pan.x) / zoom;
                const worldY = (e.clientY - pan.y) / zoom;
                setCurrentStroke([{ x: worldX, y: worldY }]);
                return;
            }

            // Handle Shape Tool (primary button / touch only)
            if (toolMode === 'shape') {
                const worldX = (e.clientX - pan.x) / zoom;
                const worldY = (e.clientY - pan.y) / zoom;
                setShapeStart({ x: worldX, y: worldY });
                setShapeEnd({ x: worldX, y: worldY });
                return;
            }
        }

        // Start panning for single pointer (mouse or touch)
        if (pointersRef.current.size === 1) {
            setIsPanning(true);
            panStartRef.current = { x: e.clientX, y: e.clientY };
            panOriginRef.current = { x: pan.x, y: pan.y };
        }
    };

    const handleCanvasPointerCancel = (e: React.PointerEvent) => {
        pointersRef.current.delete(e.pointerId);
        try {
            (e.target as Element).releasePointerCapture(e.pointerId);
        } catch {
        }

        setCurrentStroke(null);
        setShapeStart(null);
        setShapeEnd(null);
        setConnectingNodeId(null);
        setTempConnectionPos(null);
        setSelectionRect(null);
        setActiveMultiDrag(null);
        multiDragStartSnapshotRef.current = null;
        multiDragMovedRef.current = false;

        if (pointersRef.current.size < 2) {
            prevPinchDistRef.current = null;
            prevPinchCenterRef.current = null;
            pinchModeRef.current = 'none';
        }

        if (pointersRef.current.size === 0) {
            setIsPanning(false);
        }
    };

    const handleCanvasPointerMove = (e: React.PointerEvent) => {
        // Update pointer position for pan / pinch tracking
        if (pointersRef.current.has(e.pointerId)) {
            pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }

        // Two-finger gestures: distinguish between pan and pinch-zoom
        if (pointersRef.current.size === 2) {
            const points = Array.from(pointersRef.current.values());
            const p1 = points[0] as { x: number, y: number };
            const p2 = points[1] as { x: number, y: number };
            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

            const prevDist = prevPinchDistRef.current;
            const prevCenter = prevPinchCenterRef.current;

            if (prevDist && prevCenter) {
                if (pinchModeRef.current === 'none') {
                    const distDeltaRatio = Math.abs(dist - prevDist) / prevDist;
                    const moveDelta = Math.hypot(center.x - prevCenter.x, center.y - prevCenter.y);

                    // Decide once per gesture whether this is a zoom or a pan
                    if (distDeltaRatio > 0.02) {
                        pinchModeRef.current = 'zoom';
                    } else if (moveDelta > 2) {
                        pinchModeRef.current = 'pan';
                    } else {
                        // Not enough movement yet to classify
                        return;
                    }
                }

                if (pinchModeRef.current === 'zoom') {
                    const scale = dist / prevDist;
                    const newZoom = Math.min(Math.max(zoom * scale, 0.1), 5);

                    const newPanX = center.x - (center.x - pan.x) * (newZoom / zoom);
                    const newPanY = center.y - (center.y - pan.y) * (newZoom / zoom);

                    setZoom(newZoom);
                    setPan({ x: newPanX, y: newPanY });
                } else if (pinchModeRef.current === 'pan') {
                    const dxCenter = center.x - prevCenter.x;
                    const dyCenter = center.y - prevCenter.y;
                    setPan(prevPan => ({ x: prevPan.x + dxCenter, y: prevPan.y + dyCenter }));
                }

                prevPinchDistRef.current = dist;
                prevPinchCenterRef.current = center;
            }
            return;
        }

        if (toolMode === 'select') {
            if (activeMultiDrag) {
                handleMultiPointerMove(e);
                return;
            }

            if (selectionRect) {
                const worldX = (e.clientX - pan.x) / zoom;
                const worldY = (e.clientY - pan.y) / zoom;
                setSelectionRect(prev => prev ? { ...prev, x2: worldX, y2: worldY } : prev);
                return;
            }
        }

        // Handle Pen Drawing
        if (toolMode === 'pen' && currentStroke) {
            const worldX = (e.clientX - pan.x) / zoom;
            const worldY = (e.clientY - pan.y) / zoom;
            setCurrentStroke(prev => prev ? [...prev, { x: worldX, y: worldY }] : null);
            return;
        }

        // Handle Shape drawing
        if (toolMode === 'shape' && shapeStart) {
            const worldX = (e.clientX - pan.x) / zoom;
            const worldY = (e.clientY - pan.y) / zoom;
            setShapeEnd({ x: worldX, y: worldY });
            return;
        }

        if (isPanning && pointersRef.current.size === 1) {
            const dx = e.clientX - panStartRef.current.x;
            const dy = e.clientY - panStartRef.current.y;
            setPan({ x: panOriginRef.current.x + dx, y: panOriginRef.current.y + dy });
        }
    };

    const handleCanvasPointerUp = (e: React.PointerEvent) => {
        if (toolMode === 'select') {
            if (activeMultiDrag) {
                pointersRef.current.delete(e.pointerId);
                try {
                    (e.target as Element).releasePointerCapture(e.pointerId);
                } catch {
                }
                handleMultiPointerUpCommit();
                return;
            }

            if (selectionRect) {
                const x1 = Math.min(selectionRect.x1, selectionRect.x2);
                const y1 = Math.min(selectionRect.y1, selectionRect.y2);
                const x2 = Math.max(selectionRect.x1, selectionRect.x2);
                const y2 = Math.max(selectionRect.y1, selectionRect.y2);

                const ids = renderNodes
                    .filter(n => {
                        const b = getNodeBounds(n);
                        return !(b.maxX < x1 || b.minX > x2 || b.maxY < y1 || b.minY > y2);
                    })
                    .map(n => n.id);

                setSelectedIds(ids);
                setSelectionRect(null);
                pointersRef.current.delete(e.pointerId);
                try {
                    (e.target as Element).releasePointerCapture(e.pointerId);
                } catch {
                }
                return;
            }
        }

        // Handle Pen Finish
        if (toolMode === 'pen' && currentStroke) {
            if (currentStroke.length > 2) {
                const newDrawing: NoteNode = {
                    id: `draw-${Date.now()}`,
                    x: 0, y: 0,
                    title: 'Drawing',
                    content: '',
                    type: 'drawing',
                    drawingPath: currentStroke,
                    color: drawingColor,
                    width: brushSize,
                    createdAt: Date.now(),
                    lastModified: Date.now()
                };
                const updated = [...nodesRef.current, newDrawing];
                commitNodes(updated);
            }
            setCurrentStroke(null);
            (e.target as Element).releasePointerCapture(e.pointerId);
            return;
        }

        // Shape creation on pointer up
        if (toolMode === 'shape' && shapeStart && shapeEnd) {
            const newShape: NoteNode = {
                id: `shape-${Date.now()}`,
                x: 0, y: 0,
                title: 'Shape',
                content: '',
                type: 'shape',
                drawingPath: { shapeType: selectedShapeType, x1: shapeStart.x, y1: shapeStart.y, x2: shapeEnd.x, y2: shapeEnd.y } as any,
                color: drawingColor,
                width: brushSize,
                createdAt: Date.now(),
                lastModified: Date.now()
            };
            const updated = [...nodesRef.current, newShape];
            commitNodes(updated);
            setShapeStart(null);
            setShapeEnd(null);
            (e.target as Element).releasePointerCapture(e.pointerId);
            return;
        }

        // Handle Text Creation - only when this was a single-pointer tap
        if (toolMode === 'text' && pointersRef.current.size === 1) {
            const worldX = (e.clientX - pan.x) / zoom;
            const worldY = (e.clientY - pan.y) / zoom;
            handleAddTextAnnotation(worldX, worldY);
            // Keep text tool active so user can add multiple text annotations
        }

        // Clear connection logic if released on canvas
        if (toolMode === 'connect') {
            setConnectingNodeId(null);
            setTempConnectionPos(null);
        }

        pointersRef.current.delete(e.pointerId);
        (e.target as Element).releasePointerCapture(e.pointerId);

        if (pointersRef.current.size < 2) {
            prevPinchDistRef.current = null;
            prevPinchCenterRef.current = null;
            pinchModeRef.current = 'none';
        }

        if (pointersRef.current.size === 0) {
            setIsPanning(false);
        } else if (pointersRef.current.size === 1) {
            const points = Array.from(pointersRef.current.values());
            const p = points[0];
            setIsPanning(true);
            panStartRef.current = { x: p.x, y: p.y };
            panOriginRef.current = { x: pan.x, y: pan.y };
        }
    };

    // --- NODE DRAG HANDLERS ---

    const handleNodePointerDown = (e: React.PointerEvent, id: string) => {
        e.stopPropagation();
        const target = e.target as HTMLElement;

        setSelectedDrawingId(null);
        setSelectedTextId(null);

        if (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.tagName === 'BUTTON' ||
            target.closest('button')
        ) {
            return;
        }

        (e.target as Element).setPointerCapture(e.pointerId);

        // Handle Connection Tool
        if (toolMode === 'connect') {
            setConnectingNodeId(id);
            const mouseWorldX = (e.clientX - pan.x) / zoom;
            const mouseWorldY = (e.clientY - pan.y) / zoom;
            setTempConnectionPos({ x: mouseWorldX, y: mouseWorldY });
            return;
        }

        if (toolMode === 'select') {
            const worldX = (e.clientX - pan.x) / zoom;
            const worldY = (e.clientY - pan.y) / zoom;
            const nextIds = selectedIds.includes(id) ? selectedIds : [id];
            setSelectedIds(nextIds);
            setSelectedDrawingId(null);
            setSelectedTextId(null);

            multiDragStartSnapshotRef.current = cloneNodesSnapshot(nodesRef.current);
            multiDragMovedRef.current = false;
            setActiveMultiDrag({ ids: nextIds, startWorldX: worldX, startWorldY: worldY });
            return;
        }

        // Only drag with cursor tool
        if (toolMode !== 'cursor') return;

        const node = nodes.find(n => n.id === id);
        if (!node) return;

        const mouseWorldX = (e.clientX - pan.x) / zoom;
        const mouseWorldY = (e.clientY - pan.y) / zoom;

        setActiveDrag({
            id,
            worldOffsetX: mouseWorldX - node.x,
            worldOffsetY: mouseWorldY - node.y,
            startScreenX: e.clientX,
            startScreenY: e.clientY
        });

        dragStartSnapshotRef.current = cloneNodesSnapshot(nodesRef.current);
    };

    const handleNodePointerMove = (e: React.PointerEvent) => {
        if (toolMode === 'select' && activeMultiDrag) {
            handleMultiPointerMove(e);
            return;
        }
        // Handle Connection Drag
        if (toolMode === 'connect' && connectingNodeId) {
            const mouseWorldX = (e.clientX - pan.x) / zoom;
            const mouseWorldY = (e.clientY - pan.y) / zoom;
            setTempConnectionPos({ x: mouseWorldX, y: mouseWorldY });
            return;
        }

        if (!activeDrag) return;

        const { id, worldOffsetX, worldOffsetY } = activeDrag;

        const mouseWorldX = (e.clientX - pan.x) / zoom;
        const mouseWorldY = (e.clientY - pan.y) / zoom;

        const newX = mouseWorldX - worldOffsetX;
        const newY = mouseWorldY - worldOffsetY;

        setNodes(prev => {
            const next = prev.map(n => n.id === id ? { ...n, x: newX, y: newY, lastModified: Date.now() } : n);
            nodesRef.current = next;
            return next;
        });

        // Collision Check for Fusion (Center-to-Center)
        const draggedNode = nodes.find(n => n.id === id);
        if (draggedNode && draggedNode.type !== 'drawing' && draggedNode.type !== 'text') {
            const draggedCenter = {
                x: newX + (draggedNode.width || 250) / 2,
                y: newY + 100 // Approx half height
            };

            const collision = nodes.find(n => {
                if (n.id === id || n.type === 'drawing' || n.type === 'text') return false;
                const targetCenter = {
                    x: n.x + (n.width || 250) / 2,
                    y: n.y + 100
                };
                // Threshold of 200 for comfortable overlap detection
                return Math.hypot(draggedCenter.x - targetCenter.x, draggedCenter.y - targetCenter.y) < 200;
            });
            setHoverTargetId(collision ? collision.id : null);
        }
    };

    const handleNodePointerUp = async (e: React.PointerEvent) => {
        const target = e.target as Element;
        try {
            target.releasePointerCapture(e.pointerId);
        } catch {
        }

        if (toolMode === 'select' && activeMultiDrag) {
            handleMultiPointerUpCommit();
            return;
        }

        // Handle Connection Creation
        if (toolMode === 'connect' && connectingNodeId) {
            // Find target node under cursor
            const elements = document.elementsFromPoint(e.clientX, e.clientY);
            let targetId = null;
            for (const el of elements) {
                const nodeId = el.getAttribute('data-node-id');
                if (nodeId && nodeId !== connectingNodeId) {
                    targetId = nodeId;
                    break;
                }
                const closest = el.closest('[data-node-id]');
                if (closest) {
                    const closestId = closest.getAttribute('data-node-id');
                    if (closestId && closestId !== connectingNodeId) {
                        targetId = closestId;
                        break;
                    }
                }
            }

            if (targetId) {
                const updated = nodesRef.current.map(n => {
                    if (n.id === connectingNodeId) {
                        const prev = n.connections || [];
                        if (!prev.includes(targetId!)) return { ...n, connections: [...prev, targetId!] };
                    }
                    if (n.id === targetId) {
                        const prev = n.connections || [];
                        if (!prev.includes(connectingNodeId!)) return { ...n, connections: [...prev, connectingNodeId!] };
                    }
                    return n;
                });
                commitNodes(updated);
            }

            setConnectingNodeId(null);
            setTempConnectionPos(null);
            return;
        }

        if (!activeDrag) return;

        const { id, startScreenX, startScreenY } = activeDrag;

        // CLICK DETECTION
        const dist = Math.hypot(e.clientX - startScreenX, e.clientY - startScreenY);
        if (dist < 5) {
            const node = nodes.find(n => n.id === id);
            if (node && node.type === 'text') {
                const now = Date.now();
                const last = lastTextTapRef.current;
                if (last && last.id === id && now - last.ts < 350) {
                    lastTextTapRef.current = null;
                    setEditingId(id);
                    setEditForm({ title: '', content: node.content });
                } else {
                    lastTextTapRef.current = { id, ts: now };
                    setSelectedTextId(id);
                }
                setActiveDrag(null);
                setHoverTargetId(null);
                dragStartSnapshotRef.current = null;
                return;
            }

            if (editingId !== id) {
                setExpandedId(prev => prev === id ? null : id);
            }

            setActiveDrag(null);
            setHoverTargetId(null);
            dragStartSnapshotRef.current = null;
            return;
        }

        // FUSION LOGIC
        if (hoverTargetId && !fusing) {
            const nodeA = nodes.find(n => n.id === id);
            const nodeB = nodes.find(n => n.id === hoverTargetId);

            if (nodeA && nodeB && nodeA.type === 'note' && nodeB.type === 'note') {
                const prevSnapshot = cloneNodesSnapshot(nodesRef.current);
                setFusing(true);
                setActiveDrag(null);
                setHoverTargetId(null);

                const fallbackColor = theme ? theme.accent : '#60a5fa';
                const fusedColor = blendHexColors(nodeA.color || fallbackColor, nodeB.color || fallbackColor, fallbackColor);

                const newNodeId = `node-fused-${Date.now()}`;
                const midX = (nodeA.x + nodeB.x) / 2;
                const midY = (nodeA.y + nodeB.y) / 2 + 150; // Offset below

                // Create Immediate Placeholder
                const placeholderNode: NoteNode = {
                    id: newNodeId,
                    x: midX,
                    y: midY,
                    title: "Fusing Concepts...",
                    content: "Synthesizing insights...",
                    color: fusedColor,
                    width: 300,
                    parentId: undefined,
                    isGenerating: true,
                    type: 'note',
                    connections: [nodeA.id, nodeB.id] // Auto-connect
                };

                const nodesWithPlaceholder = [...nodes, placeholderNode];
                commitNodes(nodesWithPlaceholder, { prevSnapshot });

                try {
                    const textPromise = generateNoteFusion(nodeA, nodeB);
                    const refsPromise = (async () => {
                        const refs: ImageReference[] = [];
                        const a = nodeA.imageUrl ? await imageUrlToReference(nodeA.imageUrl) : null;
                        const b = nodeB.imageUrl ? await imageUrlToReference(nodeB.imageUrl) : null;
                        if (a) refs.push(a);
                        if (b) refs.push(b);
                        return refs;
                    })();

                    const fusedData = await textPromise;
                    let fusedImageUrl: string | undefined = undefined;
                    try {
                        const refs = await refsPromise;
                        if (refs.length > 0) {
                            const fusionPrompt = `Combine these images into a single coherent new image that fuses the concepts of "${nodeA.title}" and "${nodeB.title}". Use elements from both images. Match this description: ${fusedData.title}. Style: clean, minimalist, abstract blue/white.`;
                            const fusionResult = await generateImageWithReferences(fusionPrompt, refs).catch(() => undefined);
                            fusedImageUrl = fusionResult?.imageDataUrl;
                        }
                    } catch {
                        fusedImageUrl = undefined;
                    }

                    // Update Placeholder with Real Data
                    const finalNodes = nodesWithPlaceholder.map(n => n.id === newNodeId ? {
                        ...n,
                        title: fusedData.title,
                        content: fusedData.content,
                        color: fusedColor,
                        imageUrl: fusedImageUrl,
                        isGenerating: false,
                        lastModified: Date.now()
                    } : n);

                    commitNodes(finalNodes, { recordHistory: false });

                } catch (err) {
                    console.error("Fusion failed", err);
                    // Remove placeholder if failed
                    const reverted = nodes.filter(n => n.id !== newNodeId);
                    commitNodes(reverted, { recordHistory: false });
                } finally {
                    setFusing(false);
                }
                return;
            }
        }

        // IMPORTANT: Save node positions after drag ends (even without fusion)
        // This ensures moved nodes persist when user returns
        const prevSnapshot = dragStartSnapshotRef.current;
        dragStartSnapshotRef.current = null;
        if (prevSnapshot) {
            commitNodes(nodesRef.current, { prevSnapshot });
        } else {
            onUpdateState(nodesRef.current);
        }

        setActiveDrag(null);
        setHoverTargetId(null);
    };

    const bgColor = theme ? theme.background : (isDarkMode ? '#121212' : '#f3f4f6');
    const gridColor = theme ? theme.text : (isDarkMode ? '#333333' : '#e5e7eb');

    const renderNodes = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return nodes.filter(n => {
            if (!q) return true;
            const t = `${n.title || ''} ${n.content || ''}`.toLowerCase();
            return t.includes(q);
        });
    }, [nodes, searchQuery]);

    const renderIdSet = useMemo(() => new Set(renderNodes.map(n => n.id)), [renderNodes]);

    const selectionBox = useMemo(() => {
        if (!selectionRect) return null;
        const x = Math.min(selectionRect.x1, selectionRect.x2);
        const y = Math.min(selectionRect.y1, selectionRect.y2);
        const w = Math.abs(selectionRect.x2 - selectionRect.x1);
        const h = Math.abs(selectionRect.y2 - selectionRect.y1);
        return { x, y, w, h };
    }, [selectionRect]);

    const transformTargetIds = useMemo(() => {
        if (toolMode === 'select') {
            return selectedIds.filter(id => {
                const n = nodesRef.current.find(x => x.id === id);
                return n && (n.type === 'text' || n.type === 'drawing' || n.type === 'shape');
            });
        }

        const id = selectedTextId || selectedDrawingId;
        if (!id) return [];
        const n = nodesRef.current.find(x => x.id === id);
        if (!n) return [];
        if (n.type !== 'text' && n.type !== 'drawing' && n.type !== 'shape') return [];
        return [id];
    }, [toolMode, selectedIds, selectedTextId, selectedDrawingId]);

    // Connection Line (Drag Visual for Fusion)
    let dragLine = null;
    if (activeDrag && hoverTargetId && !connectingNodeId) {
        const draggedNode = nodes.find(n => n.id === activeDrag.id);
        const targetNode = nodes.find(n => n.id === hoverTargetId);

        if (draggedNode && targetNode) {
            const cx1 = draggedNode.x + (draggedNode.width || 250) / 2;
            const cy1 = draggedNode.y + 100;
            const cx2 = targetNode.x + (targetNode.width || 250) / 2;
            const cy2 = targetNode.y + 100;

            dragLine = (
                <g>
                    <line
                        x1={cx1} y1={cy1} x2={cx2} y2={cy2}
                        stroke={theme ? theme.accent : (isDarkMode ? '#fff' : '#3b82f6')}
                        strokeWidth="2"
                        strokeDasharray="5,5"
                        className="animate-pulse"
                    />
                    <circle cx={cx2} cy={cy2} r="30" fill={theme ? theme.accent : '#3b82f6'} opacity="0.2" className="animate-ping" />
                </g>
            );
        }
    }

    // Explicit Connection Lines (New Feature)
    const explicitConnectionLines = nodes.flatMap(node => {
        if (!node.connections) return [];
        return node.connections.map(targetId => {
            if (!renderIdSet.has(node.id) || !renderIdSet.has(targetId)) return null;
            const target = nodes.find(n => n.id === targetId);
            if (!target) return null;
            // Avoid drawing twice for bidirectional connections by ID check
            if (node.id > target.id) return null;

            const sx = node.x + (node.width || 250) / 2;
            const sy = node.y + 50;
            const tx = target.x + (target.width || 250) / 2;
            const ty = target.y + 50;

            return (
                <line
                    key={`conn-${node.id}-${target.id}`}
                    x1={sx} y1={sy} x2={tx} y2={ty}
                    stroke={theme ? theme.secondary : (isDarkMode ? '#ffffff66' : '#94a3b8')}
                    strokeWidth="2"
                />
            );
        });
    });

    // Temporary Connection Line (While Drawing)
    let tempConnectionLine = null;
    if (connectingNodeId && tempConnectionPos) {
        const node = nodes.find(n => n.id === connectingNodeId);
        if (node) {
            const sx = node.x + (node.width || 250) / 2;
            const sy = node.y + 50;
            tempConnectionLine = (
                <line
                    x1={sx} y1={sy} x2={tempConnectionPos.x} y2={tempConnectionPos.y}
                    stroke={theme ? theme.accent : '#3b82f6'}
                    strokeWidth="2"
                    strokeDasharray="5,5"
                />
            );
        }
    }

    // Persistent Parent-Child Hierarchy Lines
    const hierarchyLines = nodes.map(node => {
        if (!node.parentId || node.type === 'drawing' || node.type === 'text') return null;
        if (!renderIdSet.has(node.id) || !renderIdSet.has(node.parentId)) return null;
        const parent = nodes.find(p => p.id === node.parentId);
        if (!parent) return null;

        const pX = parent.x + (parent.width || 250) / 2;
        const pY = parent.y + 75;
        const nX = node.x + (node.width || 250) / 2;
        const nY = node.y + 75;

        const dist = Math.hypot(nX - pX, nY - pY);
        const pathData = `M ${pX} ${pY} C ${pX} ${pY + dist * 0.2}, ${nX} ${nY - dist * 0.2}, ${nX} ${nY}`;

        const isInteracting = activeDrag?.id === node.id || activeDrag?.id === parent.id;

        return (
            <path
                key={`${parent.id}-${node.id}`}
                d={pathData}
                stroke={node.color || '#fff'}
                strokeWidth="4"
                fill="none"
                strokeLinecap="round"
                strokeOpacity="0.4"
                className={isInteracting ? "" : "transition-all duration-300"}
            />
        );
    });

    // SVG Paths for Drawings
    const drawingPaths = renderNodes.filter(n => n.type === 'drawing' && Array.isArray((n as any).drawingPath)).map(node => {
        const pts = (node.drawingPath as any as { x: number; y: number }[]);
        const pathD = pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
        const isMultiSelected = selectedIds.includes(node.id);
        const isSelected = selectedDrawingId === node.id || isMultiSelected;
        const b = getNodeLocalBounds(node);
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const rot = node.rotation || 0;
        const sc = node.scale || 1;
        const transform = (rot !== 0 || sc !== 1) ? `translate(${cx} ${cy}) rotate(${rot}) scale(${sc}) translate(${-cx} ${-cy})` : undefined;
        return (
            <g key={node.id} transform={transform}>
                <path
                    d={pathD}
                    stroke={node.color || '#fff'}
                    strokeWidth={node.width || 4}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={toolMode === 'cursor' ? (activeDrawingDrag?.id === node.id ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}
                    onPointerDown={(e) => handleDrawingPointerDown(e, node.id)}
                    onPointerMove={handleDrawingPointerMove}
                    onPointerUp={handleDrawingPointerUp}
                />
                {isMultiSelected && (
                    <path
                        d={pathD}
                        stroke="#ffffff"
                        strokeWidth={(node.width || 4) + 6}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.25}
                        strokeDasharray="8 6"
                        className="pointer-events-none"
                    />
                )}
                {isSelected && (
                    <path
                        d={pathD}
                        stroke="#fff"
                        strokeWidth={(node.width || 4) + 8}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.3}
                        strokeDasharray="8 4"
                        className="pointer-events-none animate-pulse"
                    />
                )}
            </g>
        );
    });

    // SVG Shapes
    const shapePaths = renderNodes.filter(n => n.type === 'shape').map(node => {
        const isMultiSelected = selectedIds.includes(node.id);
        const isSelected = selectedDrawingId === node.id || isMultiSelected;
        const shapeData = node.drawingPath as any;
        if (!shapeData) return null;

        const b = getNodeLocalBounds(node);
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const rot = node.rotation || 0;
        const sc = node.scale || 1;
        const transform = (rot !== 0 || sc !== 1) ? `translate(${cx} ${cy}) rotate(${rot}) scale(${sc}) translate(${-cx} ${-cy})` : undefined;

        let shapeElement = null;
        const commonProps = {
            stroke: node.color || '#fff',
            strokeWidth: node.width || 4,
            fill: 'none',
            opacity: isSelected ? 1 : 0.8,
            className:
                'pointer-events-auto hover:opacity-100 ' +
                (toolMode === 'cursor'
                    ? (activeDrawingDrag?.id === node.id ? 'cursor-grabbing' : 'cursor-grab')
                    : 'cursor-default'),
            onPointerDown: (e: React.PointerEvent) => handleDrawingPointerDown(e, node.id),
            onPointerMove: handleDrawingPointerMove,
            onPointerUp: handleDrawingPointerUp,
        };

        if (shapeData.shapeType === 'rectangle') {
            const x = Math.min(shapeData.x1, shapeData.x2);
            const y = Math.min(shapeData.y1, shapeData.y2);
            const w = Math.abs(shapeData.x2 - shapeData.x1);
            const h = Math.abs(shapeData.y2 - shapeData.y1);
            shapeElement = (
                <g>
                    <rect x={x} y={y} width={w} height={h} rx={8} {...commonProps} />
                    {isMultiSelected && (
                        <rect x={x} y={y} width={w} height={h} rx={8} stroke="#fff" strokeWidth={(node.width || 4) + 6} fill="none" opacity={0.25} strokeDasharray="8 6" className="pointer-events-none" />
                    )}
                </g>
            );
        } else if (shapeData.shapeType === 'circle') {
            const cx = (shapeData.x1 + shapeData.x2) / 2;
            const cy = (shapeData.y1 + shapeData.y2) / 2;
            const rx = Math.abs(shapeData.x2 - shapeData.x1) / 2;
            const ry = Math.abs(shapeData.y2 - shapeData.y1) / 2;
            shapeElement = (
                <g>
                    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...commonProps} />
                    {isMultiSelected && (
                        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} stroke="#fff" strokeWidth={(node.width || 4) + 6} fill="none" opacity={0.25} strokeDasharray="8 6" className="pointer-events-none" />
                    )}
                </g>
            );
        } else if (shapeData.shapeType === 'line' || shapeData.shapeType === 'arrow') {
            shapeElement = (
                <g>
                    <line x1={shapeData.x1} y1={shapeData.y1} x2={shapeData.x2} y2={shapeData.y2} {...commonProps} />
                    {isMultiSelected && (
                        <line x1={shapeData.x1} y1={shapeData.y1} x2={shapeData.x2} y2={shapeData.y2} stroke="#fff" strokeWidth={(node.width || 4) + 6} fill="none" opacity={0.25} strokeDasharray="8 6" strokeLinecap="round" className="pointer-events-none" />
                    )}
                    {shapeData.shapeType === 'arrow' && (
                        <polygon
                            points={getArrowHead(shapeData.x1, shapeData.y1, shapeData.x2, shapeData.y2)}
                            fill={node.color || '#fff'}
                            opacity={isSelected ? 1 : 0.8}
                        />
                    )}
                </g>
            );
        }

        return <g key={node.id} transform={transform}>{shapeElement}</g>;
    });

    // Helper for arrow heads
    function getArrowHead(x1: number, y1: number, x2: number, y2: number): string {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = 15;
        const p1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
        const p1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
        const p2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
        const p2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
        return `${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`;
    }

    // Shape preview while drawing
    let shapePreview = null;
    if (toolMode === 'shape' && shapeStart && shapeEnd) {
        const previewProps = {
            stroke: drawingColor,
            strokeWidth: brushSize,
            fill: 'none',
            opacity: 0.6,
            strokeDasharray: '5 5'
        };

        if (selectedShapeType === 'rectangle') {
            const x = Math.min(shapeStart.x, shapeEnd.x);
            const y = Math.min(shapeStart.y, shapeEnd.y);
            const w = Math.abs(shapeEnd.x - shapeStart.x);
            const h = Math.abs(shapeEnd.y - shapeStart.y);
            shapePreview = <rect x={x} y={y} width={w} height={h} rx={8} {...previewProps} />;
        } else if (selectedShapeType === 'circle') {
            const cx = (shapeStart.x + shapeEnd.x) / 2;
            const cy = (shapeStart.y + shapeEnd.y) / 2;
            const rx = Math.abs(shapeEnd.x - shapeStart.x) / 2;
            const ry = Math.abs(shapeEnd.y - shapeStart.y) / 2;
            shapePreview = <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...previewProps} />;
        } else if (selectedShapeType === 'line' || selectedShapeType === 'arrow') {
            shapePreview = (
                <g>
                    <line x1={shapeStart.x} y1={shapeStart.y} x2={shapeEnd.x} y2={shapeEnd.y} {...previewProps} />
                    {selectedShapeType === 'arrow' && (
                        <polygon
                            points={getArrowHead(shapeStart.x, shapeStart.y, shapeEnd.x, shapeEnd.y)}
                            fill={drawingColor}
                            opacity={0.6}
                        />
                    )}
                </g>
            );
        }
    }

    // Current Active Stroke
    let currentStrokePath = null;
    if (currentStroke) {
        const pathD = currentStroke.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
        currentStrokePath = (
            <path
                d={pathD}
                stroke={drawingColor}
                strokeWidth={brushSize}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.8"
            />
        );
    }

    // Realtime: Helper to get selection highlight color
    const getSelectionHighlight = (nodeId: string): string | null => {
        if (!onlineCollaborators) return null;
        for (const user of onlineCollaborators) {
            if (user.uid === currentUserUid) continue;
            if (user.noteMapSelectedNodeIds?.includes(nodeId)) {
                return getCollabColor(user.uid);
            }
        }
        return null;
    };

    // Realtime: Helper to render remote cursors
    const renderCollaborators = () => {
        if (!onlineCollaborators || onlineCollaborators.length === 0) return null;

        return (
            <div className="absolute inset-0 pointer-events-none z-[100] overflow-visible">
                {onlineCollaborators.map(user => {
                    if (user.uid === currentUserUid) return null;
                    if (user.noteMapCursorWorldX === undefined || user.noteMapCursorWorldY === undefined) return null;

                    const screenX = user.noteMapCursorWorldX * zoom + pan.x;
                    const screenY = user.noteMapCursorWorldY * zoom + pan.y;
                    const color = getCollabColor(user.uid);

                    return (
                        <div
                            key={user.uid}
                            className="absolute flex flex-col items-start transition-transform duration-100 will-change-transform"
                            style={{
                                transform: `translate(${screenX}px, ${screenY}px)`,
                            }}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="-ml-[3px] -mt-[2px]">
                                <path
                                    d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829V0.500002L16.8829 16.8829L8.13579 16.8829L12.5479 21.2949L5.65376 12.3673Z"
                                    fill={color}
                                    stroke="white"
                                    strokeWidth="1"
                                />
                            </svg>
                            <div
                                className="ml-4 -mt-4 px-2 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap shadow-sm border border-white"
                                style={{ backgroundColor: color }}
                            >
                                {user.displayName || 'Anon'}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="relative w-full h-full overflow-hidden flex">

            {/* GALLERY SIDEBAR */}
            <div className="absolute left-0 top-0 bottom-0 z-[100] flex items-stretch pointer-events-none">
                {/* Panel (Clickable area) */}
                <div className={`pointer-events-auto bg-black/90 backdrop-blur-md border-r border-white/10 flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${isGalleryOpen ? 'w-32 md:w-48 opacity-100' : 'w-0 opacity-0'}`}>
                    <div className="p-4 border-b border-white/10 shrink-0">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-white/50 whitespace-nowrap block text-center">Gallery</span>
                        <div className="mt-3 flex items-center justify-center gap-1">
                            <button
                                type="button"
                                onClick={() => setGalleryScope('research')}
                                className={`px-2 py-1 rounded-md text-[9px] font-bold border transition-colors ${galleryScope === 'research'
                                    ? 'bg-white/15 border-white/25 text-white'
                                    : 'bg-transparent border-white/10 text-white/60 hover:bg-white/10 hover:text-white'
                                    }`}
                            >
                                Research
                            </button>
                            <button
                                type="button"
                                onClick={() => setGalleryScope('project')}
                                className={`px-2 py-1 rounded-md text-[9px] font-bold border transition-colors ${galleryScope === 'project'
                                    ? 'bg-white/15 border-white/25 text-white'
                                    : 'bg-transparent border-white/10 text-white/60 hover:bg-white/10 hover:text-white'
                                    }`}
                            >
                                Project
                            </button>
                        </div>
                    </div>

                    {galleryScope === 'research' && (
                        <div className="p-2 border-b border-white/10 shrink-0">
                            <button
                                type="button"
                                onClick={() => galleryFileInputRef.current?.click()}
                                disabled={isGalleryUploading}
                                className={`w-full text-[10px] font-bold rounded-lg px-2 py-2 border border-white/10 ${isGalleryUploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/10'} text-white/80`}
                                title="Upload images/videos to gallery"
                            >
                                {isGalleryUploading ? 'Uploading…' : 'Upload'}
                            </button>
                            <input
                                ref={galleryFileInputRef}
                                type="file"
                                accept="image/*,video/*"
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                    const files = Array.from(e.target.files || []);
                                    if (files.length) handleGalleryUploadFiles(files);
                                    e.currentTarget.value = '';
                                }}
                            />
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto p-2 space-y-3 scrollbar-hide w-full">
                        {galleryScope === 'project' ? (
                            <>
                                {projectFileGalleryItems.map((item) => {
                                    const kind = inferMediaKind(item.name, item.url, item.mime);
                                    const canPreview = !!kind && isDirectMediaUrl(item.url);

                                    return (
                                        <div
                                            key={item.key}
                                            draggable
                                            onDragStart={(e) => handleProjectFileDragStart(e, item)}
                                            className="group relative aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-white/50 cursor-grab active:cursor-grabbing shrink-0"
                                            title={item.name}
                                        >
                                            {canPreview ? (
                                                <>
                                                    {kind === 'image' && (
                                                        <img
                                                            src={item.url}
                                                            alt={item.name}
                                                            className="absolute inset-0 w-full h-full object-cover"
                                                            onError={(e) => {
                                                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                                                            }}
                                                        />
                                                    )}

                                                    {kind === 'video' && (
                                                        <video
                                                            src={item.url}
                                                            className="absolute inset-0 w-full h-full object-cover"
                                                            muted
                                                            loop
                                                            playsInline
                                                            autoPlay
                                                            onError={(e) => {
                                                                (e.currentTarget as HTMLVideoElement).style.display = 'none';
                                                            }}
                                                        />
                                                    )}

                                                    <div className="absolute left-1 top-1 px-1.5 py-0.5 rounded bg-black/60 text-[8px] font-bold text-white/90">
                                                        {kind?.toUpperCase()}
                                                    </div>

                                                    <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/20 to-transparent">
                                                        <div className="text-[9px] text-white font-semibold truncate w-full">{item.name}</div>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="w-full h-full bg-black/40 flex flex-col items-center justify-center px-2">
                                                        <div className="text-white/80 text-[10px] font-bold text-center line-clamp-2">{item.name}</div>
                                                        <div className="text-white/40 text-[9px] mt-1 truncate w-full text-center">{(item.mime || '').split(';')[0] || 'file'}</div>
                                                    </div>
                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    <div className="absolute inset-x-0 bottom-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <div className="text-[8px] text-white truncate w-full">{item.name}</div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                                {projectFileGalleryItems.length === 0 && (
                                    <div className="text-[10px] text-white/30 text-center py-4">No project files</div>
                                )}
                            </>
                        ) : (
                            <>
                                {youtubeGalleryItems.map((item) => (
                                    <div
                                        key={`yt-${item.id}`}
                                        draggable
                                        onDragStart={(e) => handleYoutubeGalleryDragStart(e, item)}
                                        className="group relative aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-white/50 cursor-grab active:cursor-grabbing shrink-0"
                                        title={item.title}
                                    >
                                        {item.thumbnail ? (
                                            <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full bg-black/40 flex items-center justify-center">
                                                <span className="text-white/80 text-[10px] font-bold">YOUTUBE</span>
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <div className="absolute inset-x-0 bottom-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between gap-1">
                                            <span className="text-[8px] text-white truncate w-full">{item.title}</span>
                                            <button
                                                type="button"
                                                draggable={false}
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                }}
                                                onClick={(e) => handleAnalyzeYoutubeFromGallery(e, item)}
                                                className={`shrink-0 text-[8px] font-bold px-1.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white ${youtubeAnalysisLoadingById[item.id] ? 'opacity-60 cursor-wait' : ''
                                                    }`}
                                                title="Analyze with Gemini"
                                                disabled={!!youtubeAnalysisLoadingById[item.id]}
                                            >
                                                {youtubeAnalysisLoadingById[item.id] ? '…' : 'Analyze'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {galleryItems.map((item, i) => (
                                    <div
                                        key={`${item.url}-${i}`}
                                        draggable
                                        onDragStart={(e) => handleGalleryDragStart(e, item)}
                                        onTouchStart={(e) => handleGalleryTouchStart(e, item)}
                                        className="group relative aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-white/50 cursor-grab active:cursor-grabbing shrink-0"
                                    >
                                        {item.kind === 'video' ? (
                                            <div className="w-full h-full bg-black/40 flex items-center justify-center">
                                                <span className="text-white/80 text-xs font-bold">VIDEO</span>
                                            </div>
                                        ) : (
                                            <img src={item.url} alt={item.label} className="w-full h-full object-cover" />
                                        )}
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-end p-1 transition-opacity">
                                            <span className="text-[8px] text-white truncate w-full">{item.label}</span>
                                        </div>
                                    </div>
                                ))}
                                {galleryItems.length === 0 && youtubeGalleryItems.length === 0 && (
                                    <div className="text-[10px] text-white/30 text-center py-4">No media</div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Toggle Tab */}
                <div className="flex flex-col justify-center pointer-events-auto">
                    <button
                        onClick={() => setIsGalleryOpen(!isGalleryOpen)}
                        className="h-24 bg-black/90 border-y border-r border-white/10 rounded-r-xl flex items-center justify-center text-white/40 hover:text-white hover:bg-black/90 backdrop-blur-md shadow-xl transition-all w-6"
                        title={isGalleryOpen ? "Minimize Gallery" : "Expand Gallery"}
                    >
                        <svg className={`w-3 h-3 transition-transform duration-300 ${isGalleryOpen ? 'rotate-180' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                    </button>
                </div>
            </div>

            {/* CANVAS */}
            <div
                ref={containerRef}
                className={`flex-1 relative h-full overflow-hidden touch-none overscroll-none ${toolMode === 'pen' ? 'cursor-crosshair' : (toolMode === 'text' ? 'cursor-text' : (toolMode === 'select' ? 'cursor-crosshair' : (isPanning ? 'cursor-grabbing' : 'cursor-grab')))}`}
                style={{ backgroundColor: bgColor }}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={(e) => { broadcastState(e); handleCanvasPointerMove(e); }}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerCancel}
                onContextMenu={(e) => e.preventDefault()}
                onWheel={handleWheel}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                {(() => {
                    const pos = getSelectedDrawingDeleteButtonPos();
                    if (!pos) return null;
                    return (
                        <div className="absolute z-50 pointer-events-auto" style={{ left: pos.left, top: pos.top }}>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    deleteNodeById(selectedDrawingId as string);
                                }}
                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-500/90 hover:bg-red-600 text-white shadow-lg"
                                title="Delete selected drawing/shape"
                            >
                                Delete
                            </button>
                        </div>
                    );
                })()}
                {(() => {
                    const pos = getSelectedTextActionPos();
                    if (!pos) return null;
                    return (
                        <div className="absolute z-50 pointer-events-auto" style={{ left: pos.left, top: pos.top }}>
                            <div className="flex items-center gap-2 bg-black/80 backdrop-blur border border-white/10 rounded-full px-2 py-1 shadow-lg">
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const node = nodes.find(n => n.id === selectedTextId);
                                        if (!node) return;
                                        setEditingId(node.id);
                                        setEditForm({ title: '', content: node.content });
                                    }}
                                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 hover:bg-white/20 text-white"
                                    title="Edit text"
                                >
                                    Edit
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        deleteNodeById(selectedTextId as string);
                                    }}
                                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-500/90 hover:bg-red-600 text-white"
                                    title="Delete text"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    );
                })()}
                <div
                    className="absolute inset-0 opacity-20 pointer-events-none"
                    style={{
                        backgroundImage: `radial-gradient(${gridColor} 1px, transparent 1px)`,
                        backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
                        backgroundPosition: `${pan.x}px ${pan.y}px`
                    }}
                />

                <div
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: '0 0'
                    }}
                >
                    <svg className="absolute inset-0 w-full h-full pointer-events-none z-0 overflow-visible">
                        {hierarchyLines}
                        {explicitConnectionLines}
                        {tempConnectionLine}
                        {drawingPaths}
                        {shapePaths}
                        {selectionBox && (
                            <rect
                                x={selectionBox.x}
                                y={selectionBox.y}
                                width={selectionBox.w}
                                height={selectionBox.h}
                                fill="rgba(59,130,246,0.12)"
                                stroke="rgba(59,130,246,0.9)"
                                strokeWidth="2"
                                strokeDasharray="6 4"
                            />
                        )}
                        {currentStrokePath}
                        {shapePreview}
                        {dragLine}
                    </svg>

                    {renderNodes.map(node => {
                        // Skip drawings and shapes as they are SVG
                        if (node.type === 'drawing' || node.type === 'shape') return null;

                        const isDragging = activeDrag?.id === node.id;
                        const isExpanded = expandedId === node.id;
                        const isTarget = hoverTargetId === node.id;
                        const isEditing = editingId === node.id;
                        const hasImage = !!node.imageUrl;
                        const hasVideo = !!(node as any).videoUrl;
                        const hasYoutube = !!(node.youtubeVideoId || node.youtubeUrl);
                        const hasAudio = !!node.audioUrl;
                        const hasFile = !!node.fileUrl;
                        const isText = node.type === 'text';
                        const isMultiSelected = selectedIds.includes(node.id);

                        // Special Rendering for Text Annotations
                        if (isText) {
                            return (
                                <div
                                    key={node.id}
                                    data-node-id={node.id}
                                    onPointerDown={(e) => !isEditing && handleNodePointerDown(e, node.id)}
                                    onPointerMove={!isEditing ? handleNodePointerMove : undefined}
                                    onPointerUp={!isEditing ? handleNodePointerUp : undefined}
                                    onDoubleClick={() => {
                                        setEditingId(node.id);
                                        setEditForm({ title: '', content: node.content });
                                    }}
                                    className={`absolute pointer-events-auto select-none ${isEditing ? 'cursor-text' : (isDragging ? 'cursor-grabbing' : 'cursor-grab')} ${isMultiSelected ? 'ring-2 ring-blue-400/70 rounded-lg' : ''}`}
                                    style={{
                                        transform: `translate(${node.x}px, ${node.y}px) rotate(${node.rotation || 0}deg) scale(${node.scale || 1})`,
                                        transformOrigin: 'center',
                                        color: node.color
                                    }}
                                >
                                    {isEditing ? (
                                        <div className="relative">
                                            <textarea
                                                ref={(el) => el?.focus()}
                                                value={editForm.content}
                                                placeholder="Type here..."
                                                onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Escape') {
                                                        e.preventDefault();
                                                        if (!editForm.content.trim()) {
                                                            deleteNodeById(node.id);
                                                        }
                                                        setEditingId(null);
                                                    } else if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        handleEditSave(e);
                                                    }
                                                }}
                                                className="bg-black/20 backdrop-blur-sm text-xl font-bold outline-none resize-none overflow-hidden rounded-lg px-3 py-2 border-2 border-white/30 focus:border-white/60"
                                                style={{ color: node.color, minWidth: '220px', minHeight: '40px' }}
                                                autoFocus
                                                onBlur={(e) => {
                                                    if (!editForm.content.trim()) {
                                                        deleteNodeById(node.id);
                                                        setEditingId(null);
                                                    } else {
                                                        handleEditSave(e);
                                                    }
                                                }}
                                                onPointerDown={(e) => e.stopPropagation()}
                                            />
                                            <div className="absolute -bottom-5 left-0 text-[10px] opacity-50 whitespace-nowrap">
                                                Enter to save · Esc to cancel
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="group relative">
                                            <p className="text-xl font-bold whitespace-pre-wrap max-w-sm" style={{ textShadow: isDarkMode ? '0 1px 3px rgba(0,0,0,0.5)' : '0 1px 2px rgba(255,255,255,0.5)' }}>
                                                {node.content || <span className="opacity-40 italic">Empty text</span>}
                                            </p>
                                            <div className="absolute -top-8 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setEditingId(node.id); setEditForm({ title: '', content: node.content }); }}
                                                    className="bg-blue-500/90 text-white text-xs px-2 py-1 rounded hover:bg-blue-600"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={(e) => handleDeleteNode(e, node.id)}
                                                    className="bg-red-500/90 text-white text-xs px-2 py-1 rounded hover:bg-red-600"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        }

                        // Standard Note Card
                        return (
                            <div
                                key={node.id}
                                data-node-id={node.id}
                                onPointerDown={(e) => handleNodePointerDown(e, node.id)}
                                onPointerMove={handleNodePointerMove}
                                onPointerUp={handleNodePointerUp}
                                className={`absolute rounded-2xl shadow-lg select-none flex flex-col gap-2 backdrop-blur-md border border-white/20 pointer-events-auto
                                ${isDragging ? 'z-50 shadow-2xl ring-2 ring-white/50 cursor-grabbing' : 'z-10 transition-all duration-300 ease-out cursor-grab'} 
                                ${isExpanded ? 'z-[60] shadow-2xl ring-2 ring-blue-500/50' : 'hover:shadow-xl hover:-translate-y-1'}
                                ${isTarget ? 'ring-4 ring-blue-500 ring-offset-2 ring-offset-[#121212] scale-110' : ''}
                                ${node.isGenerating ? 'animate-pulse' : ''}
                                ${connectingNodeId === node.id ? 'ring-2 ring-white/80' : ''}
                                ${isMultiSelected ? 'ring-2 ring-blue-400/70' : ''}
                            `}
                                style={{
                                    boxShadow: getSelectionHighlight(node.id) ? `0 0 0 3px ${getSelectionHighlight(node.id)}` : undefined,
                                    transform: `translate(${node.x}px, ${node.y}px) ${isDragging ? 'scale(1.05)' : 'scale(1)'}`,
                                    transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0, 0, 1), width 0.3s, height 0.3s',
                                    width: isExpanded ? (hasImage ? 400 : 450) : (node.width || 250),
                                    backgroundColor: node.color || (theme ? theme.surface : '#1e293b'),
                                    padding: hasImage && !isExpanded ? '0' : '1.25rem'
                                }}
                            >
                                {/* IMAGE RENDERING */}
                                {(hasImage || hasVideo) && (
                                    <div className={`relative overflow-hidden ${isExpanded ? 'rounded-lg mb-2 w-full aspect-video' : 'w-full h-full absolute inset-0 rounded-2xl'}`}>
                                        {hasVideo ? (
                                            <video
                                                src={(node as any).videoUrl}
                                                className="w-full h-full object-contain pointer-events-none"
                                                muted
                                                loop
                                                playsInline
                                                autoPlay
                                            />
                                        ) : (
                                            <img src={node.imageUrl} alt="Node" className="w-full h-full object-contain pointer-events-none" />
                                        )}
                                        {!isExpanded && (
                                            <div className="absolute inset-0 bg-black/40 hover:bg-black/20 transition-colors flex items-center justify-center">
                                                <span className="text-white font-bold text-xs text-center px-2 drop-shadow-md">{node.title}</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {hasAudio && isExpanded && (
                                    <div className="w-full rounded-lg border border-white/10 bg-black/20 p-2">
                                        <audio src={node.audioUrl as string} controls className="w-full" />
                                    </div>
                                )}

                                {/* CONTENT RENDERING (Hide if minimized image node) */}
                                {((!hasImage && !hasVideo) || isExpanded) && (
                                    <>
                                        {/* Header */}
                                        <div className="flex items-start gap-2 relative z-10">
                                            {isEditing ? (
                                                <input
                                                    value={editForm.title}
                                                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                                                    className="bg-black/20 rounded px-2 py-1 text-white font-bold w-full outline-none"
                                                    placeholder="Title"
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                />
                                            ) : (
                                                <h3
                                                    className="font-bold text-white text-lg leading-tight flex-1 min-w-0 truncate"
                                                    title={node.title}
                                                >
                                                    {node.title}
                                                </h3>
                                            )}

                                            {!isEditing && isExpanded && (
                                                <div className="flex gap-1 shrink-0">
                                                    <button
                                                        onClick={(e) => handleBranchNode(e, node)}
                                                        className="text-[10px] bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded transition-colors"
                                                        title="Branch"
                                                        onPointerDown={(e) => e.stopPropagation()}
                                                    >
                                                        Branch
                                                    </button>
                                                    {!hasImage && !hasVideo && !hasAudio && !hasYoutube && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => handleGenerateNoteContent(e, node.id)}
                                                            className="text-[10px] bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded transition-colors"
                                                            title="Generate content with Gemini"
                                                            onPointerDown={(e) => e.stopPropagation()}
                                                            disabled={!!node.isGenerating}
                                                        >
                                                            {node.isGenerating ? 'Generating…' : 'Generate'}
                                                        </button>
                                                    )}
                                                    {hasYoutube && (
                                                        <>
                                                            <a
                                                                href={node.youtubeUrl || `https://www.youtube.com/watch?v=${node.youtubeVideoId}`}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="text-[10px] bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded transition-colors"
                                                                title="Open in YouTube"
                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                Open
                                                            </a>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => handleAnalyzeYoutubeFromNode(e, node.id)}
                                                                className="text-[10px] bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded transition-colors"
                                                                title="Analyze with Gemini"
                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                disabled={!!(youtubeAnalysisLoadingById[node.youtubeVideoId || ''] || node.isGenerating)}
                                                            >
                                                                {youtubeAnalysisLoadingById[node.youtubeVideoId || ''] || node.isGenerating ? 'Analyzing…' : 'Analyze'}
                                                            </button>
                                                        </>
                                                    )}
                                                    {/* Image Generation Button for Text Nodes */}
                                                    {!hasImage && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleGenerateImageForNode(node); }}
                                                            className="text-[10px] bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded transition-colors"
                                                            title="Generate Image"
                                                            onPointerDown={(e) => e.stopPropagation()}
                                                        >
                                                            🎨
                                                        </button>
                                                    )}
                                                    {/* Edit Image Button for Image Nodes */}
                                                    {hasImage && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setImageEditId(node.id); setExpandedId(null); }}
                                                            className="text-[10px] bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded transition-colors"
                                                            title="Edit Image"
                                                            onPointerDown={(e) => e.stopPropagation()}
                                                        >
                                                            Edit Img
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* Text Body */}
                                        {isEditing ? (
                                            <textarea
                                                value={editForm.content}
                                                onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                                                className="bg-black/20 rounded px-2 py-1 text-white/80 text-sm w-full h-32 outline-none resize-none mt-2"
                                                placeholder="Content"
                                                onPointerDown={(e) => e.stopPropagation()}
                                            />
                                        ) : (
                                            isExpanded && (node.youtubeAnalysis || '').trim() ? (
                                                <div className={`text-sm text-white/80 leading-relaxed ${isExpanded ? 'mt-2' : 'line-clamp-3'}`}>
                                                    <ReactMarkdown className="prose prose-invert max-w-none">
                                                        {node.youtubeAnalysis as string}
                                                    </ReactMarkdown>
                                                </div>
                                            ) : (
                                                <p className={`text-sm text-white/80 leading-relaxed ${isExpanded ? 'mt-2' : 'line-clamp-3'}`}>
                                                    {node.content}
                                                </p>
                                            )
                                        )}

                                        {hasFile && isExpanded && (
                                            <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-white/80">
                                                <div className="font-bold text-white">{node.fileName || node.title}</div>
                                                <div className="opacity-80 mt-0.5">{node.fileMime || 'file'}</div>
                                                <a
                                                    href={node.fileUrl as string}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-block mt-2 px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-xs"
                                                    onClick={(e) => e.stopPropagation()}
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                >
                                                    Open file
                                                </a>
                                            </div>
                                        )}

                                        {/* Edit Controls */}
                                        {isExpanded && (
                                            <div className="mt-2 flex justify-between items-center border-t border-white/10 pt-2 relative z-10">
                                                <button
                                                    onClick={(e) => handleDeleteNode(e, node.id)}
                                                    className="text-white/60 hover:text-white text-xs px-2 py-1.5 rounded hover:bg-white/10 transition-colors"
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                >
                                                    Delete
                                                </button>

                                                <div className="flex gap-2">
                                                    {isEditing ? (
                                                        <button
                                                            onClick={handleEditSave}
                                                            className="bg-white hover:bg-gray-200 text-black text-xs px-3 py-1.5 rounded font-bold"
                                                            onPointerDown={(e) => e.stopPropagation()}
                                                        >
                                                            Save
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEditingId(node.id);
                                                                setEditForm({ title: node.title, content: node.content });
                                                            }}
                                                            className="bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-1.5 rounded"
                                                            onPointerDown={(e) => e.stopPropagation()}
                                                        >
                                                            Edit
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Global Actions - Bottom Right */}
                <div className="absolute bottom-6 right-6 flex flex-col items-end z-50 pointer-events-none">

                    {/* Zoom & Tools Container */}
                    <div className="pointer-events-auto flex flex-col items-end gap-3 mb-3">

                        {/* Search / Filter */}
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setIsSearchOpen(v => !v)}
                                className={`w-10 h-10 md:w-8 md:h-8 rounded-full text-white flex items-center justify-center text-sm font-bold bg-black/80 backdrop-blur border border-white/10 shadow-lg ${isSearchOpen ? 'hover:bg-white/10' : 'hover:bg-white/20'}`}
                                title={isSearchOpen ? "Close search" : "Search"}
                            >
                                🔍
                            </button>
                            <div
                                className={`bg-black/80 backdrop-blur border border-white/10 shadow-lg rounded-2xl transition-all duration-300 ease-in-out overflow-hidden ${isSearchOpen ? 'max-w-[520px] opacity-100 px-3 py-2' : 'max-w-0 opacity-0 px-0 py-0 border-transparent'}`}
                            >
                                <div className="flex items-center gap-2">
                                    <input
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search"
                                        className="w-40 md:w-56 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-white/30"
                                    />
                                    {(searchQuery.trim()) && (
                                        <button
                                            type="button"
                                            onClick={() => { setSearchQuery(''); }}
                                            className="text-[10px] bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded-lg"
                                            title="Clear search/filter"
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Zoom Controls */}
                        <div className="flex flex-col gap-1 bg-black/80 backdrop-blur rounded-full p-1 border border-white/10 shadow-lg">
                            <button
                                onClick={handleUndo}
                                disabled={historyPast.length === 0}
                                className={`w-10 h-10 md:w-8 md:h-8 rounded-full text-white flex items-center justify-center text-sm font-bold ${historyPast.length === 0 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/20'}`}
                                title="Undo (Ctrl/Cmd+Z)"
                            >
                                ↶
                            </button>
                            <button
                                onClick={handleRedo}
                                disabled={historyFuture.length === 0}
                                className={`w-10 h-10 md:w-8 md:h-8 rounded-full text-white flex items-center justify-center text-sm font-bold ${historyFuture.length === 0 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/20'}`}
                                title="Redo (Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z)"
                            >
                                ↷
                            </button>
                            <button
                                onClick={() => {
                                    if (toolMode === 'select') {
                                        duplicateNodesByIds(selectedIds);
                                        return;
                                    }
                                    handleDuplicateSelection();
                                }}
                                className="w-10 h-10 md:w-8 md:h-8 rounded-full text-white hover:bg-white/20 flex items-center justify-center text-[10px] font-bold"
                                title="Duplicate selected (Ctrl/Cmd+D)"
                            >
                                DUP
                            </button>
                            {transformTargetIds.length > 0 && (
                                <>
                                    <button
                                        onClick={() => applyTransformToNodesByIds(transformTargetIds, -15, 1)}
                                        className="w-10 h-10 md:w-8 md:h-8 rounded-full text-white hover:bg-white/20 flex items-center justify-center text-sm font-bold"
                                        title="Rotate left"
                                    >
                                        ↺
                                    </button>
                                    <button
                                        onClick={() => applyTransformToNodesByIds(transformTargetIds, 15, 1)}
                                        className="w-10 h-10 md:w-8 md:h-8 rounded-full text-white hover:bg-white/20 flex items-center justify-center text-sm font-bold"
                                        title="Rotate right"
                                    >
                                        ↻
                                    </button>
                                    <button
                                        onClick={() => applyTransformToNodesByIds(transformTargetIds, 0, 0.9)}
                                        className="w-10 h-10 md:w-8 md:h-8 rounded-full text-white hover:bg-white/20 flex items-center justify-center text-lg font-bold"
                                        title="Scale down"
                                    >
                                        –
                                    </button>
                                    <button
                                        onClick={() => applyTransformToNodesByIds(transformTargetIds, 0, 1.1)}
                                        className="w-10 h-10 md:w-8 md:h-8 rounded-full text-white hover:bg-white/20 flex items-center justify-center text-lg font-bold"
                                        title="Scale up"
                                    >
                                        +
                                    </button>
                                </>
                            )}
                            {toolMode === 'select' && selectedIds.length > 0 && (
                                <button
                                    onClick={() => deleteNodesByIds(selectedIds)}
                                    className="w-10 h-10 md:w-8 md:h-8 rounded-full text-white bg-red-500/30 hover:bg-red-500/50 flex items-center justify-center text-sm font-bold"
                                    title="Delete selected (Delete/Backspace)"
                                >
                                    ✕
                                </button>
                            )}
                            <button onClick={() => handleZoomBtn('in')} className="w-10 h-10 md:w-8 md:h-8 rounded-full text-white hover:bg-white/20 flex items-center justify-center text-lg font-bold" title="Zoom In">+</button>
                            <button onClick={() => handleZoomBtn('out')} className="w-10 h-10 md:w-8 md:h-8 rounded-full text-white hover:bg-white/20 flex items-center justify-center text-lg font-bold" title="Zoom Out">-</button>
                        </div>

                        {/* Annotation Tools */}
                        <div className="flex flex-col gap-2 bg-black/80 backdrop-blur rounded-full p-1 border border-white/10 shadow-lg">
                            <button
                                onClick={() => setToolMode('cursor')}
                                className={`w-10 h-10 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-colors ${toolMode === 'cursor' ? 'bg-white text-black' : 'text-white hover:bg-white/20'}`}
                                title="Select / Pan"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path></svg>
                            </button>
                            <button
                                onClick={() => setToolMode('select')}
                                className={`w-10 h-10 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-colors ${toolMode === 'select' ? 'bg-white text-black' : 'text-white hover:bg-white/20'}`}
                                title="Selection tool (multi-select)"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <rect x="5" y="5" width="14" height="14" rx="2" strokeWidth="2" strokeDasharray="4 3" />
                                </svg>
                            </button>
                            <button
                                onClick={() => setToolMode('pen')}
                                className={`w-10 h-10 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-colors ${toolMode === 'pen' ? 'bg-white text-black' : 'text-white hover:bg-white/20'}`}
                                title="Draw"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                            </button>
                            <button
                                onClick={() => setToolMode('connect')}
                                className={`w-10 h-10 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-colors ${toolMode === 'connect' ? 'bg-white text-black' : 'text-white hover:bg-white/20'}`}
                                title="Connect Notes"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                            </button>
                            <button
                                onClick={() => setToolMode('text')}
                                className={`w-10 h-10 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-colors ${toolMode === 'text' ? 'bg-white text-black' : 'text-white hover:bg-white/20'}`}
                                title="Text Annotation"
                            >
                                <span className="font-serif font-bold text-lg">T</span>
                            </button>
                            <button
                                onClick={() => setToolMode('shape')}
                                className={`w-10 h-10 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-colors ${toolMode === 'shape' ? 'bg-white text-black' : 'text-white hover:bg-white/20'}`}
                                title="Shapes"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2" /></svg>
                            </button>
                            {/* Color Picker - Cycles through 12 colors */}
                            <button
                                onClick={() => {
                                    const nextIndex = (colorIndex + 1) % COLOR_PALETTE.length;
                                    setColorIndex(nextIndex);
                                    setDrawingColor(COLOR_PALETTE[nextIndex]);
                                }}
                                className="w-10 h-10 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/20 relative group"
                                title={`Color ${colorIndex + 1}/12 - Click to change`}
                            >
                                <div className="w-5 h-5 rounded-full border-2 border-white/50 shadow-lg transition-transform group-hover:scale-110" style={{ backgroundColor: drawingColor }}></div>
                                <span className="absolute -top-1 -right-1 w-3 h-3 bg-white/90 text-[8px] font-bold text-black rounded-full flex items-center justify-center">{colorIndex + 1}</span>
                            </button>
                        </div>

                        {/* Brush Size Control - Shows when pen tool active */}
                        {toolMode === 'pen' && (
                            <div className="flex flex-col gap-1 bg-black/80 backdrop-blur rounded-xl px-3 py-2 border border-white/10 shadow-lg min-w-[120px]">
                                <span className="text-[10px] text-white/60 text-center">Brush size</span>
                                <div className="flex items-center gap-2">
                                    <span className="w-3 h-3 rounded-full bg-white/40" />
                                    <input
                                        type="range"
                                        min="2"
                                        max="20"
                                        value={brushSize}
                                        onChange={(e) => setBrushSize(Number(e.target.value))}
                                        className="flex-1 h-1 accent-white cursor-pointer"
                                    />
                                    <span className="w-3 h-3 rounded-full bg-white" />
                                </div>
                                <div className="flex justify-between text-[9px] text-white/50 mt-0.5">
                                    <span>Thin</span>
                                    <span>{brushSize}px</span>
                                    <span>Thick</span>
                                </div>
                            </div>
                        )}

                        {/* Shape Type Selector - Shows when shape tool active */}
                        {toolMode === 'shape' && (
                            <div className="flex flex-col gap-1 bg-black/80 backdrop-blur rounded-xl p-1 border border-white/10 shadow-lg min-w-[150px]">
                                <div className="flex items-center justify-between gap-1 px-1 pt-1">
                                    <button
                                        onClick={() => setSelectedShapeType('rectangle')}
                                        className={`w-10 h-10 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-colors ${selectedShapeType === 'rectangle' ? 'bg-white text-black' : 'text-white hover:bg-white/20'}`}
                                        title="Rectangle"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2" /></svg>
                                    </button>
                                    <button
                                        onClick={() => setSelectedShapeType('circle')}
                                        className={`w-10 h-10 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-colors ${selectedShapeType === 'circle' ? 'bg-white text-black' : 'text-white hover:bg-white/20'}`}
                                        title="Circle/Ellipse"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="9" strokeWidth="2" /></svg>
                                    </button>
                                    <button
                                        onClick={() => setSelectedShapeType('line')}
                                        className={`w-10 h-10 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-colors ${selectedShapeType === 'line' ? 'bg-white text-black' : 'text-white hover:bg-white/20'}`}
                                        title="Line"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><line x1="4" y1="20" x2="20" y2="4" strokeWidth="2" strokeLinecap="round" /></svg>
                                    </button>
                                    <button
                                        onClick={() => setSelectedShapeType('arrow')}
                                        className={`w-10 h-10 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-colors ${selectedShapeType === 'arrow' ? 'bg-white text-black' : 'text-white hover:bg-white/20'}`}
                                        title="Arrow"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 19L19 5M19 5H9M19 5V15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    </button>
                                </div>
                                <div className="border-t border-white/10 my-1 pt-1 px-1">
                                    <span className="block text-[9px] text-white/50 text-center mb-1">Stroke width</span>
                                    <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-white/40" />
                                        <input
                                            type="range"
                                            min="2"
                                            max="10"
                                            value={brushSize}
                                            onChange={(e) => setBrushSize(Number(e.target.value))}
                                            className="flex-1 h-1 accent-white cursor-pointer"
                                        />
                                        <span className="w-3 h-3 rounded-full bg-white" />
                                    </div>
                                    <div className="flex justify-between text-[8px] text-white/40 mt-0.5">
                                        <span>Thin</span>
                                        <span>{brushSize}px</span>
                                        <span>Thick</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* FAB Menu Items Container - Slides in/out based on state */}
                    <div className={`pointer-events-auto flex flex-col gap-3 items-end transition-all duration-300 ease-in-out overflow-hidden ${isFabOpen ? 'max-h-40 opacity-100 mb-3' : 'max-h-0 opacity-0 mb-0'}`}>
                        {/* Generate Image */}
                        <button
                            onClick={() => { setGlobalPromptOpen(true); setIsFabOpen(false); }}
                            className="flex items-center gap-2 pr-4 pl-2 py-2 rounded-full bg-white text-black shadow-lg hover:bg-gray-200 transition-transform origin-right"
                        >
                            <div className="w-10 h-10 md:w-8 md:h-8 rounded-full bg-black/10 flex items-center justify-center">✨</div>
                            <span className="font-bold text-sm">New Image</span>
                        </button>

                        {/* Add Note */}
                        <button
                            onClick={() => { handleAddNode(); setIsFabOpen(false); }}
                            className="flex items-center gap-2 pr-4 pl-2 py-2 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-500 transition-transform origin-right"
                        >
                            <div className="w-10 h-10 md:w-8 md:h-8 rounded-full bg-white/20 flex items-center justify-center">📝</div>
                            <span className="font-bold text-sm">New Note</span>
                        </button>
                    </div>

                    {/* Main FAB Trigger */}
                    <button
                        onClick={() => setIsFabOpen(!isFabOpen)}
                        className={`pointer-events-auto w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 border border-white/10 ${isFabOpen ? 'bg-white text-black rotate-45' : 'bg-blue-600 text-white hover:scale-110'}`}
                    >
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                    </button>
                </div>

                {/* Image Prompt Modal */}
                {(imageEditId || globalPromptOpen) && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                        <div className="bg-[#121212] border border-white/10 p-6 rounded-2xl w-full max-w-md shadow-2xl space-y-4">
                            <h3 className="text-white text-lg font-bold">
                                {globalPromptOpen ? "Generate New Image" : "Edit Node Image"}
                            </h3>
                            <textarea
                                value={globalPromptOpen ? globalPrompt : imagePrompt}
                                onChange={(e) => globalPromptOpen ? setGlobalPrompt(e.target.value) : setImagePrompt(e.target.value)}
                                placeholder={globalPromptOpen ? "Describe the image you want to create..." : "Describe how to change this image..."}
                                className="w-full h-32 bg-white/5 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 resize-none"
                                autoFocus
                            />
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => { setImageEditId(null); setGlobalPromptOpen(false); }}
                                    className="px-4 py-2 text-gray-400 hover:text-white"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={globalPromptOpen ? handleGlobalGenerate : handleEditImageSubmit}
                                    className="px-6 py-2 bg-white hover:bg-gray-200 text-black rounded-lg font-bold"
                                >
                                    {globalPromptOpen ? "Generate" : "Update"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {/* Realtime Collaborators Overlay */}
                {renderCollaborators()}

                {/* Touch Drag Ghost Element */}
                {touchDragItem && (
                    <div
                        className="fixed z-[9999] pointer-events-none rounded-lg overflow-hidden border-2 border-white shadow-2xl opacity-80"
                        style={{
                            left: touchDragItem.currentX,
                            top: touchDragItem.currentY,
                            width: '80px',
                            height: '80px',
                            transform: 'translate(-50%, -50%)'
                        }}
                    >
                        {touchDragItem.item.kind === 'video' ? (
                            <div className="w-full h-full bg-black/60 flex items-center justify-center">
                                <span className="text-white text-[10px] font-bold">VIDEO</span>
                            </div>
                        ) : (
                            <img src={touchDragItem.item.url} className="w-full h-full object-cover" alt="" />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
