import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
    EmailTemplate,
    EmailBlock,
    BlockContent,
    BlockStyles,
    TextBlockContent,
    ImageBlockContent,
    ButtonBlockContent,
    DividerBlockContent,
    SpacerBlockContent,
    SocialBlockContent,
    ColumnsBlockContent,
    UploadedFile,
    TableAsset,
    StripeProduct,
    ProductBlockContent
} from '../types';
import { generateEmailText, generateFullEmail } from '../services/geminiService';
import { logProjectActivity } from '../services/firebase';


// Social Platform Icons
const SOCIAL_ICONS: Record<string, string> = {
    Facebook: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/2021_Facebook_icon.svg.webp',
    Twitter: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/X-Logo-Round-Color.png',
    Instagram: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/Instagram_logo_2016.svg.webp',
    LinkedIn: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/LinkedIn_logo_initials.png',
    TikTok: 'https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/tiktok-6338432_1280.webp',
};

// Social Platform Base URLs
const SOCIAL_BASE_URLS: Record<string, string> = {
    Facebook: 'https://facebook.com/',
    Twitter: 'https://x.com/',
    Instagram: 'https://instagram.com/',
    LinkedIn: 'https://linkedin.com/in/',
    TikTok: 'https://tiktok.com/@',
};

// Simple ID generator (avoids uuid dependency)
const generateId = (): string => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
};

// ============================================================================
// Types
// ============================================================================

interface EmailBuilderProps {
    isDarkMode: boolean;
    projectId: string;
    onSaveTemplate: (template: EmailTemplate) => Promise<void>;
    savedTemplates: EmailTemplate[];
    onShowAssetSelector?: () => Promise<string | null>;
    assets?: UploadedFile[];
    onUploadAsset?: (file: File) => Promise<string>;
    authFetch: (url: string, options?: RequestInit) => Promise<Response>;
    savedTables?: TableAsset[];
    googleDriveConnected?: boolean;
    products?: StripeProduct[];
    projectName?: string;
    projectDescription?: string;
    logoUrl?: string;
    initialFocus?: boolean;
    uid?: string;
}


// ============================================================================
// Block Palette Items
// ============================================================================

const BLOCK_TYPES = [
    { type: 'text', label: 'Text', icon: '📝' },
    { type: 'image', label: 'Image', icon: '🖼️' },
    { type: 'button', label: 'Button', icon: '🔘' },
    { type: 'divider', label: 'Divider', icon: '➖' },
    { type: 'spacer', label: 'Spacer', icon: '↕️' },
    { type: 'social', label: 'Social', icon: '📱' },
    { type: 'columns', label: '2 Columns', icon: '▥' },
    { type: 'header', label: 'Header', icon: '🔝' },
    { type: 'footer', label: 'Footer', icon: '🔚' },
    { type: 'product', label: 'Product', icon: '🛍️' },
] as const;

// ============================================================================
// Default Block Factories
// ============================================================================

const createDefaultBlock = (type: string): EmailBlock => {
    switch (type) {
        case 'text':
            return {
                id: generateId(),
                type: 'text',
                content: { text: '<p>Edit this text...</p>' } as TextBlockContent,
                styles: { padding: '20px', textAlign: 'left', color: '#000000', fontSize: '16px', lineHeight: '1.5' },
            };
        case 'image':
            return {
                id: generateId(),
                type: 'image',
                content: { src: '', alt: 'Image', width: '100%', height: 'auto' } as ImageBlockContent,
                styles: { padding: '10px', textAlign: 'center' },
            };
        case 'button':
            return {
                id: generateId(),
                type: 'button',
                content: { text: 'Click Me', url: '#', backgroundColor: '#0071e3', textColor: '#ffffff', borderRadius: '4px', align: 'center' } as ButtonBlockContent,
                styles: { padding: '20px', textAlign: 'center' },
            };
        case 'divider':
            return {
                id: generateId(),
                type: 'divider',
                content: { color: '#e5e5e5', thickness: '1px' } as DividerBlockContent,
                styles: { padding: '20px' },
            };
        case 'spacer':
            return {
                id: generateId(),
                type: 'spacer',
                content: { height: '20px' } as SpacerBlockContent,
                styles: {},
            };
        case 'social':
            return {
                id: generateId(),
                type: 'social',
                content: {
                    platforms: [
                        { name: 'Facebook', url: 'https://facebook.com/', slug: '', enabled: true },
                        { name: 'Twitter', url: 'https://x.com/', slug: '', enabled: true },
                        { name: 'Instagram', url: 'https://instagram.com/', slug: '', enabled: true },
                        { name: 'LinkedIn', url: 'https://linkedin.com/', slug: '', enabled: false },
                        { name: 'TikTok', url: 'https://tiktok.com/@', slug: '', enabled: false },
                    ],
                } as SocialBlockContent,
                styles: { padding: '20px', textAlign: 'center' },
            };
        case 'columns':
            return {
                id: generateId(),
                type: 'columns',
                content: { columns: 2, children: [{ blocks: [] }, { blocks: [] }] } as ColumnsBlockContent,
                styles: { padding: '10px' },
            };
        case 'header':
            return {
                id: generateId(),
                type: 'header',
                content: { text: 'Your Company Name' } as TextBlockContent,
                styles: {
                    backgroundColor: '#0071e3',
                    color: '#ffffff',
                    fontSize: '24px',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    padding: '24px',
                },
            };
        case 'footer':
            return {
                id: generateId(),
                type: 'footer',
                content: { text: '© 2024 Your Company. All rights reserved.\n\nUnsubscribe | Privacy Policy' } as TextBlockContent,
                styles: {
                    backgroundColor: '#f5f5f5',
                    color: '#666666',
                    fontSize: '12px',
                    textAlign: 'center',
                    padding: '24px',
                },

            };
        case 'product':
            return {
                id: generateId(),
                type: 'product',
                content: {
                    title: 'Product Name',
                    price: '$0.00',
                    description: 'Product description goes here.',
                    buttonText: 'Buy Now',
                    buttonUrl: '#',
                    buttonColor: '#0071e3',
                    buttonTextColor: '#ffffff',
                    buttonBorderRadius: '4px',
                } as ProductBlockContent,
                styles: { padding: '20px', textAlign: 'center', backgroundColor: '#ffffff' },
            };
        default:
            return {
                id: generateId(),
                type: 'text',
                content: { text: 'New block' } as TextBlockContent,
                styles: { padding: '16px' },
            };
    }
};

// ============================================================================
// Tree Helpers
// ============================================================================


const addBlockToTree = (blocks: EmailBlock[], newBlock: EmailBlock, parentId?: string, colIndex?: number, index?: number): EmailBlock[] => {
    if (!parentId) {
        const newBlocks = [...blocks];
        const insertIndex = typeof index === 'number' ? index : newBlocks.length;
        newBlocks.splice(insertIndex, 0, newBlock);
        return newBlocks;
    }

    return blocks.map(block => {
        if (block.id === parentId && block.type === 'columns') {
            const colContent = block.content as ColumnsBlockContent;
            const newChildren = [...colContent.children];
            if (newChildren[colIndex!]) {
                const newCol = { ...newChildren[colIndex!], blocks: [...newChildren[colIndex!].blocks] };
                const insertIndex = typeof index === 'number' ? index : newCol.blocks.length;
                newCol.blocks.splice(insertIndex, 0, newBlock);
                newChildren[colIndex!] = newCol;
                return { ...block, content: { ...colContent, children: newChildren } };
            }
        } else if (block.type === 'columns') {
            const colContent = block.content as ColumnsBlockContent;
            const newChildren = colContent.children.map(col => ({ ...col, blocks: addBlockToTree(col.blocks, newBlock, parentId, colIndex, index) }));
            return { ...block, content: { ...colContent, children: newChildren } };
        }
        return block;
    });
};

const removeBlockFromTree = (blocks: EmailBlock[], blockId: string): EmailBlock[] => {
    return blocks.filter(b => b.id !== blockId).map(block => {
        if (block.type === 'columns') {
            const colContent = block.content as ColumnsBlockContent;
            const newChildren = colContent.children.map(col => ({ ...col, blocks: removeBlockFromTree(col.blocks, blockId) }));
            return { ...block, content: { ...colContent, children: newChildren } };
        }
        return block;
    });
};

const updateBlockInTree = (blocks: EmailBlock[], blockId: string, updates: { content?: Record<string, any>; styles?: Partial<BlockStyles> }): EmailBlock[] => {
    return blocks.map(block => {
        if (block.id === blockId) {
            return {
                ...block,
                ...updates,
                content: updates.content ? { ...block.content, ...updates.content } as BlockContent : block.content,
                styles: updates.styles ? { ...block.styles, ...updates.styles } : block.styles,
            };
        }
        if (block.type === 'columns') {
            const colContent = block.content as ColumnsBlockContent;
            const newChildren = colContent.children.map(col => ({ ...col, blocks: updateBlockInTree(col.blocks, blockId, updates) }));
            return { ...block, content: { ...colContent, children: newChildren } };
        }
        return block;
    });
};

const duplicateBlockInTree = (blocks: EmailBlock[], blockId: string): EmailBlock[] => {
    let blockToDuplicate: EmailBlock | null = null;
    const findBlock = (list: EmailBlock[]) => {
        for (const b of list) {
            if (b.id === blockId) { blockToDuplicate = b; return; }
            if (b.type === 'columns') {
                (b.content as ColumnsBlockContent).children.forEach(col => findBlock(col.blocks));
            }
        }
    };
    findBlock(blocks);

    if (!blockToDuplicate) return blocks;
    const newBlock = { ...blockToDuplicate, id: generateId() };
    // Deep clone children if columns
    if (newBlock.type === 'columns') {
        // Basic deep clone for children IDs
        (newBlock.content as ColumnsBlockContent).children = (newBlock.content as ColumnsBlockContent).children.map(col => ({ ...col, blocks: col.blocks.map(b => ({ ...b, id: generateId() })) }));
    }

    // Insert after original
    const insertAfter = (list: EmailBlock[]): EmailBlock[] => {
        const idx = list.findIndex(b => b.id === blockId);
        if (idx !== -1) {
            const newList = [...list];
            newList.splice(idx + 1, 0, newBlock);
            return newList;
        }
        return list.map(b => {
            if (b.type === 'columns') {
                const colContent = b.content as ColumnsBlockContent;
                const newChildren = colContent.children.map(col => ({ ...col, blocks: insertAfter(col.blocks) }));
                return { ...b, content: { ...colContent, children: newChildren } };
            }
            return b;
        });
    };

    return insertAfter(blocks);
};

const moveBlockInTree = (blocks: EmailBlock[], blockId: string, direction: 'up' | 'down'): EmailBlock[] => {
    const moveInList = (list: EmailBlock[]): boolean => {
        const index = list.findIndex(b => b.id === blockId);
        if (index === -1) return false;
        if (direction === 'up' && index === 0) return true;
        if (direction === 'down' && index === list.length - 1) return true;

        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        [list[index], list[targetIndex]] = [list[targetIndex], list[index]];
        return true;
    };

    const recursiveMove = (list: EmailBlock[]): EmailBlock[] => {
        if (moveInList(list)) return [...list];
        return list.map(b => {
            if (b.type === 'columns') {
                const colContent = b.content as ColumnsBlockContent;
                const newChildren = colContent.children.map(col => ({ ...col, blocks: recursiveMove([...col.blocks]) }));
                return { ...b, content: { ...colContent, children: newChildren } };
            }
            return b;
        });
    };

    return recursiveMove([...blocks]);
};

// ============================================================================
// EmailBuilder Component
// ============================================================================

export const EmailBuilder: React.FC<EmailBuilderProps> = ({
    isDarkMode,
    projectId,
    onSaveTemplate,
    savedTemplates = [],
    assets = [],
    onUploadAsset,
    onShowAssetSelector,
    authFetch,
    savedTables = [],
    googleDriveConnected = false,
    products = [],
    projectName = '',
    projectDescription = '',
    logoUrl = '',
    initialFocus = false,
    uid = 'anonymous',
}) => {

    // State
    const [blocks, setBlocks] = useState<EmailBlock[]>([]);
    const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
    const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null);
    const [dragOverCol, setDragOverCol] = useState<number | null>(null);
    const [templateName, setTemplateName] = useState('Untitled Template');
    const [draggedBlockType, setDraggedBlockType] = useState<string | null>(null);
    const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
    const [showAssetSelector, setShowAssetSelector] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const aiPromptRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (initialFocus && aiPromptRef.current) {
            aiPromptRef.current.focus();
        }
    }, [initialFocus]);

    const [isGeneratingFullEmail, setIsGeneratingFullEmail] = useState(false);
    const [showMobileAiPrompt, setShowMobileAiPrompt] = useState(false);

    // Email sending state
    const [showSendModal, setShowSendModal] = useState(false);
    const [recipientEmail, setRecipientEmail] = useState('');
    const [emailSubject, setEmailSubject] = useState('');
    const [emailProvider, setEmailProvider] = useState<'gmail' | 'outlook'>('gmail');
    const [gmailConnected, setGmailConnected] = useState(false);
    const [outlookConnected, setOutlookConnected] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [sendSuccess, setSendSuccess] = useState(false);

    // Email list selection state
    const [emailListMode, setEmailListMode] = useState<'single' | 'list'>('single');
    const [selectedTable, setSelectedTable] = useState<TableAsset | null>(null);
    const [emailColumn, setEmailColumn] = useState<string>('');
    const [recipientList, setRecipientList] = useState<string[]>([]);
    const [showTablePicker, setShowTablePicker] = useState(false);
    const [sendProgress, setSendProgress] = useState<{ current: number; total: number } | null>(null);

    // Email scheduling state
    const [scheduleMode, setScheduleMode] = useState<'now' | 'schedule'>('now');
    const [scheduledDateTime, setScheduledDateTime] = useState('');
    const [isScheduling, setIsScheduling] = useState(false);
    const [scheduleSuccess, setScheduleSuccess] = useState(false);

    // Mobile responsive state
    const [showBlocksPalette, setShowBlocksPalette] = useState(false);
    const [showPropertiesPanel, setShowPropertiesPanel] = useState(false);
    const [showMobileMenu, setShowMobileMenu] = useState(false);

    const canvasRef = useRef<HTMLDivElement>(null);

    const findSelectedBlock = (list: EmailBlock[]): EmailBlock | null => {
        for (const b of list) {
            if (b.id === selectedBlockId) return b;
            if (b.type === 'columns') {
                const children = (b.content as ColumnsBlockContent).children;
                for (const col of children) {
                    const found = findSelectedBlock(col.blocks);
                    if (found) return found;
                }
            }
        }
        return null;
    };

    // Helper to find any block by ID
    const findBlockById = useCallback((list: EmailBlock[], id: string): EmailBlock | null => {
        for (const b of list) {
            if (b.id === id) return b;
            if (b.type === 'columns') {
                const children = (b.content as ColumnsBlockContent).children;
                for (const col of children) {
                    const found = findBlockById(col.blocks, id);
                    if (found) return found;
                }
            }
        }
        return null;
    }, []);

    const selectedBlock = useMemo(
        () => findSelectedBlock(blocks),
        [blocks, selectedBlockId]
    );

    const handleDragStart = useCallback((e: React.DragEvent, blockType: string, blockId?: string) => {
        setDraggedBlockType(blockType);
        if (blockId) {
            setDraggedBlockId(blockId);
            e.dataTransfer.effectAllowed = 'move';
        } else {
            setDraggedBlockId(null);
            e.dataTransfer.effectAllowed = 'copy';
        }
        e.dataTransfer.setData('text/plain', blockType);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = draggedBlockId ? 'move' : 'copy';
    }, [draggedBlockId]);

    const handleDrop = useCallback(
        (e: React.DragEvent, targetParentId?: string, targetColIndex?: number, targetIndex?: number) => {
            e.preventDefault();
            e.stopPropagation();
            const blockType = e.dataTransfer.getData('text/plain') || draggedBlockType;
            if (!blockType) return;

            if (draggedBlockId) {
                // Moving an existing block
                if (draggedBlockId === targetParentId) return; // Can't drop into self

                setBlocks((prev) => {
                    const blockToMove = findBlockById(prev, draggedBlockId);
                    if (!blockToMove) return prev;

                    // Remove from old location first
                    const blocksWithoutOld = removeBlockFromTree(prev, draggedBlockId);

                    // Add to new location
                    // Note: If we are moving within the same list, indices might shift.
                    // But removeBlockFromTree returns a new tree.
                    // If targetIndex was calculated based on the OLD tree, it might be off if we removed a block above it.
                    // However, given the current UI, exact index targeting is tricky. 
                    // Usually we drop "at the end" or "into a column". 
                    // Refinement: If dropping onto the canvas (no parent), targetIndex usually means "end".

                    return addBlockToTree(blocksWithoutOld, blockToMove, targetParentId, targetColIndex, targetIndex);
                });
                setDraggedBlockId(null);
            } else {
                // Creating a new block
                const newBlock = createDefaultBlock(blockType);
                setBlocks((prev) => addBlockToTree(prev, newBlock, targetParentId, targetColIndex, targetIndex));
                setSelectedBlockId(newBlock.id);
            }
            setDraggedBlockType(null);
        },
        [draggedBlockType, draggedBlockId, findBlockById]
    );

    const handleDragEnd = useCallback(() => {
        setDraggedBlockType(null);
        setDraggedBlockId(null);
    }, []);

    const handleSelectBlock = useCallback((blockId: string) => {
        setSelectedBlockId(blockId);
    }, []);

    const handleDeleteBlock = useCallback((blockId: string) => {
        setBlocks((prev) => removeBlockFromTree(prev, blockId));
        if (selectedBlockId === blockId) {
            setSelectedBlockId(null);
        }
    }, [selectedBlockId]);

    const handleMoveBlock = useCallback((blockId: string, direction: 'up' | 'down') => {
        setBlocks((prev) => moveBlockInTree(prev, blockId, direction)); // Needs to pass direction dynamically?
        // Wait, onMoveUp calls handleMoveBlock(id, 'up').
        // So the function we pass to BlockRenderer should be (id, direction)?
        // Or we pass discrete handlers.
        // The previous BlockRendererProps had onMoveUp: (id) => void.
        // So we need to match that.
    }, []);

    // Wrappers for BlockRenderer
    const onMoveUp = useCallback((id: string) => handleMoveBlock(id, 'up'), [handleMoveBlock]);
    const onMoveDown = useCallback((id: string) => handleMoveBlock(id, 'down'), [handleMoveBlock]);


    const handleDuplicateBlock = useCallback((blockId: string) => {
        setBlocks((prev) => duplicateBlockInTree(prev, blockId));
    }, []);

    const handleUpdateBlock = useCallback((blockId: string, updates: { content?: Record<string, any>; styles?: Partial<BlockStyles> }) => {
        setBlocks((prev) => updateBlockInTree(prev, blockId, updates));
    }, []);

    const handleGenerateText = useCallback(async (blockId: string, currentText: string) => {
        setIsGenerating(true);
        try {
            // Construct context from all blocks
            const fullContext = blocks.map(b => {
                if (b.type === 'text' || b.type === 'header' || b.type === 'footer') {
                    return (b.content as TextBlockContent).text;
                }
                return `[${b.type} block]`;
            }).join('\n\n');

            const generated = await generateEmailText(currentText, fullContext);
            if (generated) {
                handleUpdateBlock(blockId, { content: { text: generated } });
            }
        } catch (error) {
            console.error('Generation failed:', error);
        } finally {
            setIsGenerating(false);
        }
    }, [blocks, handleUpdateBlock]);

    const handleGenerateFullEmail = useCallback(async () => {
        if (!aiPrompt.trim() || isGeneratingFullEmail) return;

        setIsGeneratingFullEmail(true);
        try {
            // Map products to the format expected by the service
            const productList = products.map(p => ({
                name: p.name,
                price: typeof p.unitAmount === 'number' ? `$${(p.unitAmount / 100).toFixed(2)}` : (p.unitAmount || '$0.00'),
                description: p.description || '',
                imageUrl: Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : undefined,
                paymentLink: p.paymentLinkUrl || undefined,
            }));

            const generatedBlocks = await generateFullEmail({
                prompt: aiPrompt,
                projectName: projectName || 'My Project',
                projectDescription: projectDescription || '',
                logoUrl: logoUrl || '',
                products: productList,
            });

            if (generatedBlocks && generatedBlocks.length > 0) {
                setBlocks(generatedBlocks);
                setSelectedBlockId(null);
                setAiPrompt(''); // Clear prompt after success
            }
        } catch (error) {
            console.error('Failed to generate email:', error);
            alert('Failed to generate email. Please try again.');
        } finally {
            setIsGeneratingFullEmail(false);
        }
    }, [aiPrompt, isGeneratingFullEmail, products, projectName, projectDescription, logoUrl]);

    const handleSaveTemplate = useCallback(() => {
        let subjectToUse = emailSubject;

        // If no subject entered in the send panel, prompt for one
        if (!subjectToUse) {
            const promptSubject = prompt('Please enter a subject for this email template:', templateName !== 'Untitled Template' ? templateName : '');
            if (promptSubject === null) return; // Users cancelled
            subjectToUse = promptSubject;
            setEmailSubject(subjectToUse); // Update state
            setTemplateName(subjectToUse); // Use as template name as requested
        } else {
            // If subject exists, ensure template name matches it (optional, but consistent with request)
            setTemplateName(subjectToUse);
        }

        const template: EmailTemplate = {
            id: generateId(),
            name: subjectToUse || 'Untitled Template', // Use subject as name
            subject: subjectToUse, // Store subject in template if supported (custom field)
            blocks,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        onSaveTemplate?.(template);
        alert('Template saved!');
    }, [blocks, templateName, emailSubject, onSaveTemplate]);

    const handleLoadTemplate = useCallback((template: EmailTemplate) => {
        setBlocks(template.blocks);
        setTemplateName(template.name);
        setSelectedBlockId(null);
        setShowTemplateDropdown(false);
    }, []);

    const handleExportHtml = useCallback(() => {
        const html = generateEmailHtml(blocks);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${templateName.replace(/\s+/g, '_')}.html`;
        a.click();
        URL.revokeObjectURL(url);
    }, [blocks, templateName]);

    const handleClearCanvas = useCallback(() => {
        if (confirm('Are you sure you want to clear the canvas?')) {
            setBlocks([]);
            setSelectedBlockId(null);
        }
    }, []);

    // Check email connection status
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
                console.error('Failed to check email status:', e);
            }
        };
        checkEmailStatus();

        const handler = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type === 'gmail:connected' || event.data?.type === 'outlook:connected') {
                checkEmailStatus();
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [authFetch]);

    const handleSendEmail = useCallback(async () => {
        setSendError(null);
        setSendSuccess(false);

        if (!recipientEmail || !emailSubject) {
            setSendError('Please fill in recipient email and subject.');
            return;
        }

        const isConnected = emailProvider === 'gmail' ? gmailConnected : outlookConnected;
        if (!isConnected) {
            setSendError(`Please connect your ${emailProvider === 'gmail' ? 'Gmail' : 'Outlook'} account first.`);
            return;
        }

        setIsSending(true);
        setSendProgress(null);

        try {
            const html = generateEmailHtml(blocks);
            const endpoint = `/api/email?op=send&provider=${emailProvider}`;

            // Determine recipients based on mode
            const recipients = emailListMode === 'single'
                ? [recipientEmail]
                : recipientList;

            if (recipients.length === 0) {
                setSendError('No recipients to send to.');
                setIsSending(false);
                return;
            }

            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < recipients.length; i++) {
                const to = recipients[i];
                setSendProgress({ current: i + 1, total: recipients.length });

                try {
                    const res = await authFetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            to,
                            subject: emailSubject,
                            html,
                        }),
                    });

                    const data = await res.json();
                    if (data.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch {
                    failCount++;
                }

                // Small delay between sends to avoid rate limits
                if (i < recipients.length - 1) {
                    await new Promise(r => setTimeout(r, 500));
                }
            }

            setSendProgress(null);

            if (failCount === 0) {
                // Log activity
                try {
                    await logProjectActivity(
                        uid,
                        projectId,
                        'email_sent',
                        `Sent email "${emailSubject}" to ${recipients.length} recipient(s)`,
                        {
                            subject: emailSubject,
                            recipientCount: recipients.length,
                            provider: emailProvider
                        }
                    );
                } catch (err) {
                    console.error('Failed to log activity:', err);
                }

                setSendSuccess(true);
                setTimeout(() => {
                    setShowSendModal(false);
                    setSendSuccess(false);
                    setRecipientEmail('');
                    setEmailSubject('');
                    setSelectedTable(null);
                    setEmailColumn('');
                    setRecipientList([]);
                    setEmailListMode('single');
                }, 2000);
            } else {
                setSendError(`Sent ${successCount}/${recipients.length}. ${failCount} failed.`);
            }
        } catch (e: any) {
            const errorMessage = e.message || 'An error occurred while sending email.';
            setSendError(errorMessage);
            setSendProgress(null);

            // Auto-disconnect if auth error detected
            if (errorMessage.toLowerCase().includes('refresh token') ||
                errorMessage.toLowerCase().includes('unauthorized') ||
                errorMessage.toLowerCase().includes('invalid_grant')) {
                if (emailProvider === 'gmail') setGmailConnected(false);
                if (emailProvider === 'outlook') setOutlookConnected(false);
            }
        } finally {
            setIsSending(false);
        }
    }, [recipientEmail, emailSubject, emailProvider, gmailConnected, outlookConnected, blocks, authFetch, emailListMode, recipientList]);

    // Extract emails when table or column changes
    useEffect(() => {
        if (selectedTable && emailColumn) {
            const colIndex = selectedTable.columns.indexOf(emailColumn);
            if (colIndex >= 0) {
                const emails = selectedTable.rows
                    .map(row => row[colIndex])
                    .filter(email => email && email.includes('@'));
                setRecipientList(emails);
            } else {
                setRecipientList([]);
            }
        } else {
            setRecipientList([]);
        }
    }, [selectedTable, emailColumn]);

    // Handle scheduling email
    const handleScheduleEmail = useCallback(async () => {
        setSendError(null);
        setScheduleSuccess(false);

        if (!emailSubject) {
            setSendError('Please enter a subject.');
            return;
        }

        const recipients = emailListMode === 'single'
            ? [recipientEmail]
            : recipientList;

        if (recipients.length === 0 || (emailListMode === 'single' && !recipientEmail)) {
            setSendError('Please specify recipient(s).');
            return;
        }

        if (!scheduledDateTime) {
            setSendError('Please select a scheduled date and time.');
            return;
        }

        const isConnected = emailProvider === 'gmail' ? gmailConnected : outlookConnected;
        if (!isConnected) {
            setSendError(`Please connect your ${emailProvider === 'gmail' ? 'Gmail' : 'Outlook'} account first.`);
            return;
        }

        // Parse and validate schedule time
        const scheduledDate = new Date(scheduledDateTime);
        const now = new Date();
        const minTime = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes from now
        const maxTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

        if (scheduledDate < minTime) {
            setSendError('Scheduled time must be at least 10 minutes in the future.');
            return;
        }
        if (scheduledDate > maxTime) {
            setSendError('Scheduled time cannot be more than 7 days in the future.');
            return;
        }

        setIsScheduling(true);

        try {
            const html = generateEmailHtml(blocks);
            const scheduledAtUnix = Math.floor(scheduledDate.getTime() / 1000);

            const res = await authFetch('/api/email?op=email-schedule-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    scheduledAt: scheduledAtUnix,
                    provider: emailProvider,
                    to: emailListMode === 'single' ? recipientEmail : recipientList,
                    subject: emailSubject,
                    html,
                }),
            });

            const data = await res.json();
            if (data.success) {
                // Log activity
                try {
                    await logProjectActivity(
                        uid,
                        projectId,
                        'email_scheduled',
                        `Scheduled email "${emailSubject}" to ${recipients.length} recipient(s) for ${new Date(scheduledDateTime).toLocaleString()}`,
                        {
                            subject: emailSubject,
                            recipientCount: recipients.length,
                            provider: emailProvider,
                            scheduledAt: scheduledDate.getTime()
                        }
                    );
                } catch (err) {
                    console.error('Failed to log activity:', err);
                }

                setScheduleSuccess(true);
                setTimeout(() => {
                    setShowSendModal(false);
                    setScheduleSuccess(false);
                    setRecipientEmail('');
                    setEmailSubject('');
                    setScheduledDateTime('');
                    setScheduleMode('now');
                    setSelectedTable(null);
                    setEmailColumn('');
                    setRecipientList([]);
                    setEmailListMode('single');
                }, 2000);
            } else {
                setSendError(data.error || 'Failed to schedule email.');
            }
        } catch (e: any) {
            setSendError(e.message || 'An error occurred while scheduling.');
        } finally {
            setIsScheduling(false);
        }
    }, [recipientEmail, emailSubject, emailProvider, gmailConnected, outlookConnected, blocks, authFetch, emailListMode, recipientList, scheduledDateTime, projectId]);


    return (
        <div className={`flex flex-col h-full ${isDarkMode ? 'bg-[#0d0d0d]' : 'bg-gray-50'}`}>
            {/* Toolbar */}
            <div
                className={`flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-2 sm:py-3 border-b ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200'
                    }`}
            >
                {/* Mobile: Blocks toggle button */}
                <button
                    onClick={() => setShowBlocksPalette(!showBlocksPalette)}
                    className={`sm:hidden p-2 rounded-lg transition-colors ${showBlocksPalette
                        ? 'bg-[#0071e3] text-white'
                        : isDarkMode
                            ? 'bg-[#2d2d2f] text-gray-300'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                    title="Toggle Blocks"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                </button>

                <input
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="Template name..."
                    className={`flex-1 min-w-0 max-w-[140px] sm:max-w-none sm:flex-initial px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${isDarkMode
                        ? 'bg-[#2d2d2f] border border-[#3d3d3f] text-white placeholder:text-gray-500'
                        : 'bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400'
                        }`}
                />

                {/* Mobile: AI Prompt Toggle */}
                <button
                    onClick={() => setShowMobileAiPrompt(!showMobileAiPrompt)}
                    className={`sm:hidden p-2 rounded-lg transition-colors ${showMobileAiPrompt
                        ? 'bg-purple-500/10 text-purple-500'
                        : isDarkMode
                            ? 'bg-[#2d2d2f] text-gray-300'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                    title="Generate with AI"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                </button>

                {/* AI Email Generator */}
                <div className="hidden sm:flex items-center gap-2 border-l border-r px-3 mx-1" style={{ borderColor: isDarkMode ? '#3d3d3f' : '#e5e7eb' }}>
                    <svg className="w-4 h-4 text-purple-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    <input
                        ref={aiPromptRef}
                        type="text"
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isGeneratingFullEmail) {
                                handleGenerateFullEmail();
                            }
                        }}
                        placeholder="Describe your email..."
                        className={`w-40 lg:w-56 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 ${isDarkMode
                            ? 'bg-[#1d1d1f] border border-[#3d3d3f] text-white placeholder:text-gray-500'
                            : 'bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400'
                            }`}
                    />
                    <button
                        onClick={handleGenerateFullEmail}
                        disabled={!aiPrompt.trim() || isGeneratingFullEmail}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${aiPrompt.trim() && !isGeneratingFullEmail
                            ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-sm'
                            : isDarkMode
                                ? 'bg-[#2d2d2f] text-gray-500 cursor-not-allowed'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        {isGeneratingFullEmail ? (
                            <>
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                </svg>
                                <span>...</span>
                            </>
                        ) : (
                            <>
                                <span>✨</span>
                                <span>Generate</span>
                            </>
                        )}
                    </button>
                </div>

                <div className="flex items-center gap-1 sm:gap-2 ml-auto">
                    {/* Desktop: All toolbar buttons */}
                    <button
                        onClick={handleClearCanvas}
                        className={`hidden sm:block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isDarkMode
                            ? 'bg-[#2d2d2f] hover:bg-[#3d3d3f] text-gray-300'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                            }`}
                    >
                        Clear
                    </button>

                    <div className="relative hidden sm:block">
                        <button
                            onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isDarkMode
                                ? 'bg-[#2d2d2f] hover:bg-[#3d3d3f] text-gray-300'
                                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                                }`}
                        >
                            Load
                        </button>
                        {showTemplateDropdown && savedTemplates.length > 0 && (
                            <div
                                className={`absolute right-0 top-full mt-1 w-48 rounded-lg shadow-lg z-10 ${isDarkMode ? 'bg-[#2d2d2f] border border-[#3d3d3f]' : 'bg-white border border-gray-200'
                                    }`}
                            >
                                {savedTemplates.map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => handleLoadTemplate(t)}
                                        className={`w-full px-3 py-2 text-left text-sm transition-colors ${isDarkMode ? 'hover:bg-[#3d3d3f] text-white' : 'hover:bg-gray-100 text-gray-900'
                                            }`}
                                    >
                                        {t.name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => setShowPreview(!showPreview)}
                        className={`hidden sm:block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${showPreview
                            ? 'bg-[#0071e3] text-white'
                            : isDarkMode
                                ? 'bg-[#2d2d2f] hover:bg-[#3d3d3f] text-gray-300'
                                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                            }`}
                    >
                        Preview
                    </button>

                    <button
                        onClick={handleExportHtml}
                        className={`hidden sm:block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isDarkMode
                            ? 'bg-[#2d2d2f] hover:bg-[#3d3d3f] text-gray-300'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                            }`}
                    >
                        Export
                    </button>

                    {/* Mobile: More menu */}
                    <div className="relative sm:hidden">
                        <button
                            onClick={() => setShowMobileMenu(!showMobileMenu)}
                            className={`p-2 rounded-lg transition-colors ${showMobileMenu
                                ? 'bg-[#0071e3] text-white'
                                : isDarkMode
                                    ? 'bg-[#2d2d2f] text-gray-300'
                                    : 'bg-gray-100 text-gray-700'
                                }`}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                            </svg>
                        </button>
                        {showMobileMenu && (
                            <div
                                className={`absolute right-0 top-full mt-1 w-36 rounded-lg shadow-lg z-50 ${isDarkMode ? 'bg-[#2d2d2f] border border-[#3d3d3f]' : 'bg-white border border-gray-200'
                                    }`}
                            >
                                <button
                                    onClick={() => { handleClearCanvas(); setShowMobileMenu(false); }}
                                    className={`w-full px-3 py-2.5 text-left text-sm transition-colors ${isDarkMode ? 'hover:bg-[#3d3d3f] text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                                >
                                    Clear
                                </button>
                                <button
                                    onClick={() => { setShowTemplateDropdown(true); setShowMobileMenu(false); }}
                                    className={`w-full px-3 py-2.5 text-left text-sm transition-colors ${isDarkMode ? 'hover:bg-[#3d3d3f] text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                                >
                                    Load Template
                                </button>
                                <button
                                    onClick={() => { setShowPreview(true); setShowMobileMenu(false); }}
                                    className={`w-full px-3 py-2.5 text-left text-sm transition-colors ${isDarkMode ? 'hover:bg-[#3d3d3f] text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                                >
                                    Preview
                                </button>
                                <button
                                    onClick={() => { handleExportHtml(); setShowMobileMenu(false); }}
                                    className={`w-full px-3 py-2.5 text-left text-sm transition-colors ${isDarkMode ? 'hover:bg-[#3d3d3f] text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                                >
                                    Export HTML
                                </button>
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleSaveTemplate}
                        className="px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold bg-[#0071e3] hover:bg-[#0077ed] text-white transition-colors"
                    >
                        Save
                    </button>

                    <button
                        onClick={() => setShowSendModal(true)}
                        className="px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold bg-green-600 hover:bg-green-700 text-white transition-colors"
                    >
                        Send
                    </button>

                    {/* Mobile: Properties toggle button */}
                    <button
                        onClick={() => setShowPropertiesPanel(!showPropertiesPanel)}
                        className={`sm:hidden p-2 rounded-lg transition-colors ${showPropertiesPanel
                            ? 'bg-[#0071e3] text-white'
                            : isDarkMode
                                ? 'bg-[#2d2d2f] text-gray-300'
                                : 'bg-gray-100 text-gray-700'
                            }`}
                        title="Toggle Properties"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Mobile AI Prompt Input Panel */}
            {showMobileAiPrompt && (
                <div className={`sm:hidden px-3 py-2 border-b flex gap-2 ${isDarkMode ? 'bg-[#1d1d1f] border-[#3d3d3f]' : 'bg-white border-gray-200'}`}>
                    <input
                        type="text"
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isGeneratingFullEmail) {
                                handleGenerateFullEmail();
                            }
                        }}
                        placeholder="Describe your email to generate..."
                        className={`flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 ${isDarkMode
                            ? 'bg-[#2d2d2f] border border-[#3d3d3f] text-white placeholder:text-gray-500'
                            : 'bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400'
                            }`}
                        autoFocus
                    />
                    <button
                        onClick={handleGenerateFullEmail}
                        disabled={!aiPrompt.trim() || isGeneratingFullEmail}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${aiPrompt.trim() && !isGeneratingFullEmail
                            ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-sm'
                            : isDarkMode
                                ? 'bg-[#2d2d2f] text-gray-500'
                                : 'bg-gray-100 text-gray-400'
                            }`}
                    >
                        {isGeneratingFullEmail ? (
                            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                            </svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        )}
                    </button>
                </div>
            )}

            <div className="flex flex-1 overflow-hidden relative">
                {/* Mobile Overlay Backdrop */}
                {(showBlocksPalette || showPropertiesPanel) && (
                    <div
                        className="sm:hidden fixed inset-0 bg-black/40 z-30"
                        onClick={() => {
                            setShowBlocksPalette(false);
                            setShowPropertiesPanel(false);
                        }}
                    />
                )}

                {/* Blocks Sidebar */}
                <div
                    className={`
                        ${showBlocksPalette ? 'translate-x-0' : '-translate-x-full'}
                        sm:translate-x-0
                        fixed sm:relative
                        left-0 top-0 sm:top-auto
                        h-full sm:h-auto
                        w-64 sm:w-48
                        flex-shrink-0
                        p-4
                        border-r
                        overflow-y-auto
                        z-40 sm:z-auto
                        transition-transform duration-300 ease-out
                        ${isDarkMode ? 'bg-[#161617] border-[#3d3d3f]' : 'bg-gray-50 border-gray-200'}
                    `}
                >
                    <div className="flex items-center justify-between mb-3">
                        <h3 className={`text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Blocks
                        </h3>
                        {/* Mobile close button */}
                        <button
                            onClick={() => setShowBlocksPalette(false)}
                            className={`sm:hidden p-1.5 rounded-lg ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div className="space-y-2">
                        {BLOCK_TYPES.map((block) => (
                            <div
                                key={block.type}
                                draggable
                                onDragStart={(e) => handleDragStart(e, block.type)}
                                onDragEnd={handleDragEnd}
                                onClick={() => {
                                    // Tap to add on mobile
                                    const newBlock = createDefaultBlock(block.type);
                                    setBlocks((prev) => [...prev, newBlock]);
                                    setSelectedBlockId(newBlock.id);
                                    setShowBlocksPalette(false);
                                    // Open properties panel after adding
                                    setShowPropertiesPanel(true);
                                }}
                                className={`flex items-center gap-2 px-3 py-3 sm:py-2.5 rounded-lg cursor-grab sm:cursor-grab active:cursor-grabbing transition-all touch-manipulation ${isDarkMode
                                    ? 'bg-[#2d2d2f] hover:bg-[#3d3d3f] active:bg-[#4d4d4f] text-white border border-[#3d3d3f]'
                                    : 'bg-white hover:bg-gray-100 active:bg-gray-200 text-gray-900 border border-gray-200 shadow-sm'
                                    }`}
                            >
                                <span className="text-xl sm:text-lg">{block.icon}</span>
                                <span className="text-sm font-medium">{block.label}</span>
                                <span className={`ml-auto text-xs sm:hidden ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Tap to add</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div
                    ref={canvasRef}
                    className={`flex-1 p-3 sm:p-6 overflow-y-auto ${isDarkMode ? 'bg-[#0d0d0d]' : 'bg-gray-100'
                        }`}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e)}
                >
                    <div
                        className={`max-w-full sm:max-w-2xl mx-auto rounded-lg shadow-lg overflow-hidden min-h-[400px] sm:min-h-[500px] ${isDarkMode ? 'bg-[#1d1d1f]' : 'bg-white'
                            }`}
                    >
                        {blocks.length === 0 ? (
                            <div
                                className={`text-center p-8 sm:p-12 border-2 border-dashed rounded-lg m-4 sm:m-8 ${isDarkMode
                                    ? 'border-[#3d3d3f] text-gray-500'
                                    : 'border-gray-300 text-gray-400'
                                    }`}
                            >
                                <div className="text-4xl mb-3">🖼️</div>
                                <p className="text-sm font-medium">Drag blocks here to start building</p>
                                <p className={`text-xs mt-2 sm:hidden ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                                    Or tap the menu icon to add blocks
                                </p>
                            </div>
                        ) : (
                            <div className="p-2 sm:p-4 space-y-2">
                                {blocks.map((block, index) => (
                                    <BlockRenderer
                                        key={block.id}
                                        block={block}
                                        selectedBlockId={selectedBlockId}
                                        isDarkMode={isDarkMode}
                                        onSelect={(id) => {
                                            handleSelectBlock(id);
                                            // On mobile, auto-open properties panel when selecting
                                            if (window.innerWidth < 640) {
                                                setShowPropertiesPanel(true);
                                            }
                                        }}
                                        onDelete={handleDeleteBlock}
                                        onMoveUp={onMoveUp}
                                        onMoveDown={onMoveDown}
                                        onDuplicate={handleDuplicateBlock}
                                        onDrop={(e, parentId, colIndex, idx) => handleDrop(e, parentId, colIndex, idx)}
                                        onDragStart={handleDragStart}
                                        onDragEnd={handleDragEnd}
                                    />
                                ))}
                                <div
                                    className="h-12 sm:h-16 flex items-center justify-center border-2 border-dashed border-transparent hover:border-[#0071e3] rounded transition-colors"
                                    onDragOver={(e) => { e.preventDefault(); }}
                                    onDrop={(e) => handleDrop(e, undefined, undefined, blocks.length)}
                                >
                                    <span className="text-xs text-gray-400 opacity-0 hover:opacity-100">Drop at bottom</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Properties Panel */}
                <div
                    className={`
                        ${showPropertiesPanel ? 'translate-x-0' : 'translate-x-full'}
                        sm:translate-x-0
                        fixed sm:relative
                        right-0 top-0 sm:top-auto
                        h-full sm:h-auto
                        w-80 sm:w-72
                        flex-shrink-0
                        p-4
                        border-l
                        overflow-y-auto
                        z-40 sm:z-auto
                        transition-transform duration-300 ease-out
                        ${isDarkMode ? 'bg-[#161617] border-[#3d3d3f]' : 'bg-gray-50 border-gray-200'}
                    `}
                >
                    <div className="flex items-center justify-between mb-3">
                        <h3 className={`text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Properties
                        </h3>
                        {/* Mobile close button */}
                        <button
                            onClick={() => setShowPropertiesPanel(false)}
                            className={`sm:hidden p-1.5 rounded-lg ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    {selectedBlock ? (
                        <PropertiesPanel
                            block={selectedBlock}
                            isDarkMode={isDarkMode}
                            onUpdate={(updates) => handleUpdateBlock(selectedBlock.id, updates)}
                            onUploadAsset={onUploadAsset}
                            onShowAssetSelector={onShowAssetSelector ? onShowAssetSelector : async () => { setShowAssetSelector(true); return null; }}
                            onGenerateText={handleGenerateText}
                            isGenerating={isGenerating}
                            products={products}
                        />
                    ) : (
                        <div className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            Select a block to edit its properties
                        </div>
                    )}
                </div>
            </div>

            {showPreview && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-white rounded-2xl shadow-2xl">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h3 className="text-lg font-semibold text-gray-900">Email Preview</h3>
                            <button
                                onClick={() => setShowPreview(false)}
                                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div
                            className="p-4"
                            dangerouslySetInnerHTML={{ __html: generateEmailHtml(blocks) }}
                        />
                    </div>
                </div>
            )}

            {showSendModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className={`w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl shadow-2xl ${isDarkMode ? 'bg-[#1e1e1f]' : 'bg-white'}`}>
                        <div className={`flex items-center justify-between p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                            <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Send Email</h3>
                            <button
                                onClick={() => {
                                    setShowSendModal(false);
                                    setSendError(null);
                                    setSendSuccess(false);
                                }}
                                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
                            {/* Gmail/Outlook Connection */}
                            <div className="space-y-3">
                                <label className={`text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Email Provider
                                </label>

                                {/* Gmail */}
                                <div className={`p-3 rounded-lg border flex justify-between items-center ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${gmailConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                        <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Gmail</span>
                                    </div>
                                    <div className="flex gap-2 items-center">
                                        {gmailConnected && (
                                            <button
                                                onClick={() => setEmailProvider('gmail')}
                                                className={`text-xs px-2 py-1 rounded border ${emailProvider === 'gmail' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-transparent text-gray-500'}`}
                                            >
                                                Use
                                            </button>
                                        )}
                                        {!gmailConnected ? (
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const res = await authFetch('/api/email?op=auth-url&provider=gmail&returnTo=' + encodeURIComponent(window.location.pathname));
                                                        const data = await res.json();
                                                        if (data.url) {
                                                            const width = 600;
                                                            const height = 700;
                                                            const left = window.screen.width / 2 - width / 2;
                                                            const top = window.screen.height / 2 - height / 2;
                                                            window.open(data.url, 'Connect Gmail', `width=${width},height=${height},left=${left},top=${top}`);
                                                        }
                                                    } catch (e) {
                                                        console.error(e);
                                                    }
                                                }}
                                                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                            >
                                                Connect
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-green-600 font-medium">Connected</span>
                                                <button
                                                    onClick={async () => {
                                                        if (!confirm('Disconnect Gmail?')) return;
                                                        try {
                                                            await authFetch('/api/email?op=disconnect&provider=gmail', { method: 'POST' });
                                                            setGmailConnected(false);
                                                        } catch (e) {
                                                            console.error('Failed to disconnect Gmail', e);
                                                        }
                                                    }}
                                                    className="text-[10px] text-gray-400 hover:text-red-500 underline"
                                                >
                                                    Disconnect
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Outlook */}
                                <div className={`p-3 rounded-lg border flex justify-between items-center ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${outlookConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                        <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Outlook</span>
                                    </div>
                                    <div className="flex gap-2 items-center">
                                        {outlookConnected && (
                                            <button
                                                onClick={() => setEmailProvider('outlook')}
                                                className={`text-xs px-2 py-1 rounded border ${emailProvider === 'outlook' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-transparent text-gray-500'}`}
                                            >
                                                Use
                                            </button>
                                        )}
                                        {!outlookConnected ? (
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const res = await authFetch('/api/email?op=auth-url&provider=outlook&returnTo=' + encodeURIComponent(window.location.pathname));
                                                        const data = await res.json();
                                                        if (data.url) {
                                                            const width = 600;
                                                            const height = 700;
                                                            const left = window.screen.width / 2 - width / 2;
                                                            const top = window.screen.height / 2 - height / 2;
                                                            window.open(data.url, 'Connect Outlook', `width=${width},height=${height},left=${left},top=${top}`);
                                                        }
                                                    } catch (e) {
                                                        console.error(e);
                                                    }
                                                }}
                                                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                            >
                                                Connect
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-green-600 font-medium">Connected</span>
                                                <button
                                                    onClick={async () => {
                                                        if (!confirm('Disconnect Outlook?')) return;
                                                        try {
                                                            await authFetch('/api/email?op=disconnect&provider=outlook', { method: 'POST' });
                                                            setOutlookConnected(false);
                                                        } catch (e) {
                                                            console.error('Failed to disconnect Outlook', e);
                                                        }
                                                    }}
                                                    className="text-[10px] text-gray-400 hover:text-red-500 underline"
                                                >
                                                    Disconnect
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {(gmailConnected || outlookConnected) && (
                                    <p className="text-xs text-gray-400 text-right">
                                        Sending via: <span className="font-semibold text-blue-500 uppercase">{emailProvider}</span>
                                    </p>
                                )}
                            </div>

                            {/* Recipient Mode Toggle */}
                            <div>
                                <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Recipients
                                </label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setEmailListMode('single')}
                                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${emailListMode === 'single'
                                            ? 'bg-[#0071e3] text-white'
                                            : (isDarkMode ? 'bg-[#2d2d2f] text-gray-400' : 'bg-gray-100 text-gray-600')
                                            }`}
                                    >
                                        Single Recipient
                                    </button>
                                    <button
                                        onClick={() => setEmailListMode('list')}
                                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${emailListMode === 'list'
                                            ? 'bg-[#0071e3] text-white'
                                            : (isDarkMode ? 'bg-[#2d2d2f] text-gray-400' : 'bg-gray-100 text-gray-600')
                                            }`}
                                    >
                                        Email List
                                    </button>
                                </div>
                            </div>

                            {emailListMode === 'single' ? (
                                /* Single Recipient Email */
                                <div>
                                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                        Recipient Email
                                    </label>
                                    <input
                                        type="email"
                                        value={recipientEmail}
                                        onChange={(e) => setRecipientEmail(e.target.value)}
                                        placeholder="recipient@example.com"
                                        className={`w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${isDarkMode
                                            ? 'bg-[#2d2d2f] border border-[#3d3d3f] text-white placeholder:text-gray-500'
                                            : 'bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400'
                                            }`}
                                    />
                                </div>
                            ) : (
                                /* Email List Selection */
                                <div className="space-y-3">
                                    {/* Table Selection */}
                                    <div>
                                        <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                            Select Table
                                        </label>
                                        <div className="flex gap-2">
                                            <select
                                                value={selectedTable?.id || ''}
                                                onChange={(e) => {
                                                    const table = savedTables.find(t => t.id === e.target.value);
                                                    setSelectedTable(table || null);
                                                    setEmailColumn('');
                                                }}
                                                className={`flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${isDarkMode
                                                    ? 'bg-[#2d2d2f] border border-[#3d3d3f] text-white'
                                                    : 'bg-white border border-gray-200 text-gray-900'
                                                    }`}
                                            >
                                                <option value="">Choose a table...</option>
                                                {savedTables.map(table => (
                                                    <option key={table.id} value={table.id}>
                                                        {table.title} ({table.rows.length} rows)
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        {savedTables.length === 0 && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                No tables saved. Go to Assets &gt; Tables to create one.
                                            </p>
                                        )}
                                    </div>

                                    {/* Email Column Selection */}
                                    {selectedTable && (
                                        <div>
                                            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                                Email Column
                                            </label>
                                            <select
                                                value={emailColumn}
                                                onChange={(e) => setEmailColumn(e.target.value)}
                                                className={`w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${isDarkMode
                                                    ? 'bg-[#2d2d2f] border border-[#3d3d3f] text-white'
                                                    : 'bg-white border border-gray-200 text-gray-900'
                                                    }`}
                                            >
                                                <option value="">Select column with emails...</option>
                                                {selectedTable.columns.map(col => (
                                                    <option key={col} value={col}>{col}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    {/* Recipient Preview */}
                                    {recipientList.length > 0 && (
                                        <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-50'}`}>
                                            <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                                <span className="font-semibold text-[#0071e3]">{recipientList.length}</span> recipients found
                                            </p>
                                            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                {recipientList.slice(0, 3).join(', ')}{recipientList.length > 3 ? ` and ${recipientList.length - 3} more...` : ''}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Subject */}
                            <div>
                                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Subject
                                </label>
                                <input
                                    type="text"
                                    value={emailSubject}
                                    onChange={(e) => setEmailSubject(e.target.value)}
                                    placeholder="Email subject..."
                                    className={`w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${isDarkMode
                                        ? 'bg-[#2d2d2f] border border-[#3d3d3f] text-white placeholder:text-gray-500'
                                        : 'bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400'
                                        }`}
                                />
                            </div>

                            {/* Schedule Mode Toggle */}
                            <div>
                                <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Delivery
                                </label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setScheduleMode('now')}
                                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${scheduleMode === 'now'
                                            ? 'bg-green-600 text-white'
                                            : (isDarkMode ? 'bg-[#2d2d2f] text-gray-400' : 'bg-gray-100 text-gray-600')
                                            }`}
                                    >
                                        Send Now
                                    </button>
                                    <button
                                        onClick={() => setScheduleMode('schedule')}
                                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${scheduleMode === 'schedule'
                                            ? 'bg-purple-600 text-white'
                                            : (isDarkMode ? 'bg-[#2d2d2f] text-gray-400' : 'bg-gray-100 text-gray-600')
                                            }`}
                                    >
                                        ⏰ Schedule
                                    </button>
                                </div>
                            </div>

                            {/* Schedule DateTime Picker */}
                            {scheduleMode === 'schedule' && (
                                <div>
                                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                        Schedule Date & Time
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={scheduledDateTime}
                                        onChange={(e) => setScheduledDateTime(e.target.value)}
                                        min={new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 16)}
                                        max={new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)}
                                        className={`w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 ${isDarkMode
                                            ? 'bg-[#2d2d2f] border border-[#3d3d3f] text-white'
                                            : 'bg-white border border-gray-200 text-gray-900'
                                            }`}
                                    />
                                    <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                        Schedule between 10 minutes and 7 days from now
                                    </p>
                                </div>
                            )}

                            {/* Progress Indicator */}
                            {sendProgress && (
                                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                                    <p className="text-sm text-blue-700">
                                        Sending {sendProgress.current}/{sendProgress.total}...
                                    </p>
                                    <div className="mt-2 h-2 bg-blue-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-blue-500 transition-all duration-300"
                                            style={{ width: `${(sendProgress.current / sendProgress.total) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Error/Success Messages */}
                            {sendError && (
                                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                                    <p className="text-sm text-red-700">{sendError}</p>
                                </div>
                            )}

                            {sendSuccess && (
                                <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                                    <p className="text-sm text-green-700">
                                        {emailListMode === 'list' ? `All ${recipientList.length} emails sent successfully!` : 'Email sent successfully!'}
                                    </p>
                                </div>
                            )}

                            {scheduleSuccess && (
                                <div className="p-3 rounded-lg bg-purple-50 border border-purple-200">
                                    <p className="text-sm text-purple-700">
                                        ⏰ Email scheduled successfully for {new Date(scheduledDateTime).toLocaleString()}!
                                    </p>
                                </div>
                            )}

                            {/* Send/Schedule Button */}
                            <button
                                onClick={scheduleMode === 'schedule' ? handleScheduleEmail : handleSendEmail}
                                disabled={(isSending || isScheduling) || !emailSubject || (!gmailConnected && !outlookConnected) ||
                                    (emailListMode === 'single' ? !recipientEmail : recipientList.length === 0) ||
                                    (scheduleMode === 'schedule' && !scheduledDateTime)}
                                className={`w-full py-3 rounded-lg text-sm font-semibold transition-colors ${(isSending || isScheduling) || !emailSubject || (!gmailConnected && !outlookConnected) ||
                                    (emailListMode === 'single' ? !recipientEmail : recipientList.length === 0) ||
                                    (scheduleMode === 'schedule' && !scheduledDateTime)
                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                    : scheduleMode === 'schedule' ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
                                    }`}
                            >
                                {isScheduling
                                    ? 'Scheduling...'
                                    : isSending
                                        ? (sendProgress ? `Sending ${sendProgress.current}/${sendProgress.total}...` : 'Sending...')
                                        : scheduleMode === 'schedule'
                                            ? `⏰ Schedule ${emailListMode === 'list' ? `${recipientList.length || 0} Emails` : 'Email'}`
                                            : (emailListMode === 'list' ? `Send to ${recipientList.length || 0} Recipients` : 'Send Email')
                                }
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showAssetSelector && (
                <AssetSelector
                    assets={assets}
                    onClose={() => setShowAssetSelector(false)}
                    onSelect={(url) => {
                        if (selectedBlockId) {
                            handleUpdateBlock(selectedBlockId, { content: { src: url } });
                        }
                        setShowAssetSelector(false);
                    }}
                    isDarkMode={isDarkMode}
                />
            )}
        </div>
    );
};

// ============================================================================
// Asset Selector Component
// ============================================================================

interface AssetSelectorProps {
    assets: { url?: string; displayName?: string; name?: string; mimeType?: string }[];
    onSelect: (url: string) => void;
    onClose: () => void;
    isDarkMode: boolean;
}

const AssetSelector: React.FC<AssetSelectorProps> = ({ assets, onSelect, onClose, isDarkMode }) => {
    // Filter for images only
    const imageAssets = assets.filter(a => {
        const mime = (a.mimeType || '').toLowerCase();
        return mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i.test(a.name || '');
    });

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div
                className={`w-full max-w-3xl max-h-[80vh] flex flex-col rounded-xl shadow-2xl overflow-hidden ${isDarkMode ? 'bg-[#1e1e1f] border border-[#3d3d3f]' : 'bg-white border border-gray-200'}`}
                onClick={e => e.stopPropagation()}
            >
                <div className={`p-4 border-b flex justify-between items-center ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                    <h3 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Select Image</h3>
                    <button onClick={onClose} className="p-1 hover:opacity-70">
                        <span className="text-xl">×</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    {imageAssets.length === 0 ? (
                        <div className={`text-center py-12 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            No images found in project assets.
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
                            {imageAssets.map((asset, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => asset.url && onSelect(asset.url)}
                                    className={`aspect-square relative rounded-lg overflow-hidden cursor-pointer group border-2 transition-all ${isDarkMode ? 'border-transparent hover:border-[#0071e3]' : 'border-transparent hover:border-[#0071e3]'}`}
                                >
                                    {asset.url ? (
                                        <img
                                            src={asset.url}
                                            alt={asset.displayName || asset.name}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full bg-gray-500 flex items-center justify-center">?</div>
                                    )}
                                    <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1 text-[10px] text-white truncate px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {asset.displayName || asset.name}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// BlockRenderer Component
// ============================================================================

interface BlockRendererProps {
    block: EmailBlock;
    selectedBlockId: string | null;
    isDarkMode: boolean;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onMoveUp: (id: string) => void;
    onMoveDown: (id: string) => void;
    onDuplicate: (id: string) => void;
    onDrop: (e: React.DragEvent, parentId?: string, colIndex?: number, index?: number) => void;
    onDragStart: (e: React.DragEvent, blockType: string, blockId: string) => void;
    onDragEnd: () => void;
}

const BlockRenderer: React.FC<BlockRendererProps> = ({
    block,
    selectedBlockId,
    isDarkMode,
    onSelect,
    onDelete,
    onMoveUp,
    onMoveDown,
    onDuplicate,
    onDrop,
    onDragStart,
    onDragEnd,
}) => {
    const [dragOverCol, setDragOverCol] = useState<number | null>(null);
    const isSelected = selectedBlockId === block.id;

    const renderBlockContent = () => {
        switch (block.type) {
            case 'text':
            case 'header':
            case 'footer':
                return (
                    <div
                        style={{
                            fontSize: block.styles.fontSize,
                            color: block.styles.color,
                            fontWeight: block.styles.fontWeight,
                            lineHeight: block.styles.lineHeight,
                            textAlign: block.styles.textAlign,
                            whiteSpace: 'pre-wrap',
                        }}
                    >
                        {(block.content as TextBlockContent).text}
                    </div>
                );

            case 'image':
                const imgContent = block.content as ImageBlockContent;
                return imgContent.src ? (
                    <img
                        src={imgContent.src}
                        alt={imgContent.alt}
                        style={{ width: imgContent.width, maxWidth: '100%' }}
                    />
                ) : (
                    <div className={`flex items-center justify-center h-32 ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-100'} rounded`}>
                        <span className="text-4xl">🖼️</span>
                    </div>
                );

            case 'button':
                const btnContent = block.content as ButtonBlockContent;
                return (
                    <a
                        href={btnContent.url}
                        onClick={(e) => e.preventDefault()}
                        style={{
                            display: 'inline-block',
                            padding: '12px 24px',
                            backgroundColor: btnContent.backgroundColor,
                            color: btnContent.textColor,
                            borderRadius: btnContent.borderRadius,
                            textDecoration: 'none',
                            fontWeight: 600,
                        }}
                    >
                        {btnContent.text}
                    </a>
                );

            case 'divider':
                const divContent = block.content as DividerBlockContent;
                return (
                    <hr
                        style={{
                            border: 'none',
                            borderTop: `${divContent.thickness} solid ${divContent.color}`,
                            margin: 0,
                        }}
                    />
                );

            case 'spacer':
                const spacerContent = block.content as SpacerBlockContent;
                return <div style={{ height: spacerContent.height }} />;

            case 'social':
                const socContent = block.content as SocialBlockContent;
                return (
                    <div style={{ textAlign: block.styles.textAlign || 'center' }}>
                        {socContent.platforms.filter((p: any) => p.enabled).map((platform: any) => (
                            <a
                                key={platform.name}
                                href={platform.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    display: 'inline-block',
                                    margin: '0 8px',
                                    textDecoration: 'none',
                                }}
                            >
                                <img
                                    src={SOCIAL_ICONS[platform.name] || ''}
                                    alt={platform.name}
                                    style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                                />
                            </a>
                        ))}
                    </div>
                );

            case 'columns':
                const colContent = block.content as ColumnsBlockContent;
                return (
                    <div className="flex gap-4">
                        {colContent.children.map((col, i) => (
                            <div
                                key={i}
                                className={`flex-1 min-h-[80px] border-2 border-dashed rounded p-2 transition-colors ${dragOverCol === i ? 'border-[#0071e3] bg-[#0071e3]/10' : (isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-300')
                                    }`}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setDragOverCol(i);
                                }}
                                onDragLeave={() => setDragOverCol(null)}
                                onDrop={(e) => {
                                    onDrop(e, block.id, i, col.blocks.length);
                                    setDragOverCol(null);
                                }}
                            >
                                {col.blocks.length === 0 ? (
                                    <div className={`text-center text-xs p-2 pointer-events-none ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                        Drop here
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {col.blocks.map((childBlock) => (
                                            <BlockRenderer
                                                key={childBlock.id}
                                                block={childBlock}
                                                selectedBlockId={selectedBlockId}
                                                isDarkMode={isDarkMode}
                                                onSelect={onSelect}
                                                onDelete={onDelete}
                                                onMoveUp={onMoveUp}
                                                onMoveDown={onMoveDown}
                                                onDuplicate={onDuplicate}
                                                onDrop={onDrop}
                                                onDragStart={onDragStart}
                                                onDragEnd={onDragEnd}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                );

            case 'product':
                const prodContent = block.content as ProductBlockContent;
                return (
                    <div className={`border rounded-lg overflow-hidden max-w-sm mx-auto ${isDarkMode ? 'border-[#3d3d3f] bg-[#1d1d1f]' : 'border-gray-200 bg-white'}`}>
                        {prodContent.image ? (
                            <img src={prodContent.image} alt={prodContent.title} className="w-full h-48 object-cover" />
                        ) : (
                            <div className={`w-full h-48 flex items-center justify-center ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-100'}`}>
                                <span className="text-4xl">🛍️</span>
                            </div>
                        )}
                        <div className="p-4 text-center">
                            <h3 className={`text-lg font-bold mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{prodContent.title}</h3>
                            <p className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-[#0071e3]' : 'text-[#0071e3]'}`}>{prodContent.price}</p>
                            <p className={`text-sm mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{prodContent.description}</p>
                            <a
                                href={prodContent.buttonUrl}
                                onClick={e => e.preventDefault()}
                                style={{
                                    display: 'inline-block',
                                    padding: '10px 20px',
                                    backgroundColor: prodContent.buttonColor,
                                    color: prodContent.buttonTextColor,
                                    borderRadius: prodContent.buttonBorderRadius || '4px',
                                    textDecoration: 'none',
                                    fontWeight: 600,
                                }}
                            >
                                {prodContent.buttonText}
                            </a>
                        </div>
                    </div>
                );

            default:
                return <div>Unknown block type</div>;
        }
    };

    return (
        <div
            draggable
            onDragStart={(e) => {
                e.stopPropagation(); // Prevent parent from handling drag start if nested
                onDragStart(e, block.type, block.id);
            }}
            onDragEnd={onDragEnd}
            className={`relative group/block transition-all cursor-move ${isSelected ? 'ring-2 ring-[#0071e3] z-10' : ''
                }`}
            style={{
                backgroundColor: block.styles.backgroundColor,
                padding: block.styles.padding,
                textAlign: block.styles.textAlign,
            }}
            onClick={(e) => {
                e.stopPropagation();
                onSelect(block.id);
            }}
        // Allow dropping ONTO a block to insert after it?
        // For now, let's keep drop logic in container/columns to avoid complexity of "insert before/after".
        // Containers handle drops.
        >
            {/* Block Actions - Always visible when selected, hover on desktop */}
            <div
                className={`absolute right-0 sm:-right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1 transition-opacity z-20 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover/block:opacity-100'
                    }`}
            >
                <button
                    onClick={(e) => { e.stopPropagation(); onMoveUp(block.id); }}
                    className="w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center rounded bg-[#0071e3] text-white text-sm sm:text-xs hover:bg-[#0077ed] touch-manipulation"
                    title="Move up"
                >
                    <svg className="w-4 h-4 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onMoveDown(block.id); }}
                    className="w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center rounded bg-[#0071e3] text-white text-sm sm:text-xs hover:bg-[#0077ed] touch-manipulation"
                    title="Move down"
                >
                    <svg className="w-4 h-4 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onDuplicate(block.id); }}
                    className="w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center rounded bg-[#0071e3] text-white text-sm sm:text-xs hover:bg-[#0077ed] touch-manipulation"
                    title="Duplicate"
                >
                    <svg className="w-4 h-4 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(block.id); }}
                    className="w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center rounded bg-red-500 text-white text-sm sm:text-xs hover:bg-red-600 touch-manipulation"
                    title="Delete"
                >
                    <svg className="w-4 h-4 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {renderBlockContent()}
        </div>
    );
};

// ============================================================================
// PropertiesPanel Component
// ============================================================================

interface PropertiesPanelProps {
    block: EmailBlock;
    isDarkMode: boolean;
    onUpdate: (updates: { content?: Record<string, any>; styles?: Partial<BlockStyles> }) => void;
    onUploadAsset?: (file: File) => Promise<string>;
    onShowAssetSelector?: () => Promise<string | null>;
    onGenerateText: (blockId: string, currentText: string) => Promise<void>;
    isGenerating: boolean;
    products?: StripeProduct[];
}

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ block, isDarkMode, onUpdate, onUploadAsset, onShowAssetSelector, onGenerateText, isGenerating, products = [] }) => {
    const inputClass = `w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3] ${isDarkMode
        ? 'bg-[#2d2d2f] border border-[#3d3d3f] text-white'
        : 'bg-white border border-gray-200 text-gray-900'
        }`;

    const labelClass = `block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`;

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) {
            console.log('No file selected');
            return;
        }
        if (!onUploadAsset) {
            console.error('onUploadAsset prop is missing');
            return;
        }
        const file = e.target.files[0];
        console.log('Uploading file:', file.name, file.type, file.size);
        try {
            const url = await onUploadAsset(file);
            console.log('Upload successful, returned URL:', url);
            if (!url) {
                console.error('Upload returned empty URL');
                alert("Upload failed: No URL returned.");
                return;
            }
            onUpdate({ content: { src: url } });
        } catch (error) {
            console.error("Failed to upload image:", error);
            alert("Failed to upload image: " + (error instanceof Error ? error.message : String(error)));
        }
    };

    return (
        <div className="space-y-4">
            <div className={`pb-3 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                <h3 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {block.type.charAt(0).toUpperCase() + block.type.slice(1)} Properties
                </h3>
            </div>

            {/* Content Properties */}
            <div className="space-y-3">
                <label className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Content</label>

                {(block.type === 'text' || block.type === 'header' || block.type === 'footer') && (
                    <div className="space-y-2">
                        <textarea
                            value={(block.content as TextBlockContent).text}
                            onChange={(e) => onUpdate({ content: { text: e.target.value } })}
                            className={`${inputClass} min-h-[100px]`}
                            placeholder="Enter text..."
                        />
                        <button
                            onClick={() => onGenerateText(block.id, (block.content as TextBlockContent).text)}
                            disabled={isGenerating}
                            className={`w-full py-1.5 px-3 rounded text-xs font-medium flex items-center justify-center gap-2 transition-colors ${isDarkMode
                                ? 'bg-zinc-800 hover:bg-zinc-700 text-gray-200'
                                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                                } ${isGenerating ? 'opacity-50 cursor-wait' : ''}`}
                        >
                            {isGenerating ? (
                                <>
                                    <span className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
                                    <span>Generating...</span>
                                </>
                            ) : (
                                <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                                    </svg>
                                    <span>Generate with AI</span>
                                </>
                            )}
                        </button>
                    </div>
                )}

                {block.type === 'image' && (
                    <>
                        <div>
                            <label className={labelClass}>Image URL</label>
                            <input
                                type="text"
                                value={(block.content as ImageBlockContent).src}
                                onChange={(e) => onUpdate({ content: { src: e.target.value } })}
                                className={inputClass}
                                placeholder="https://example.com/image.jpg"
                            />
                        </div>
                        <div className="flex gap-2">
                            {onUploadAsset && (
                                <label className="flex-1 cursor-pointer bg-[#0071e3] hover:bg-[#0077ed] text-white py-2 px-3 rounded-lg text-xs font-medium text-center transition-colors">
                                    Upload Image
                                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                                </label>
                            )}
                            {onShowAssetSelector && (
                                <button
                                    onClick={async () => {
                                        const url = await onShowAssetSelector();
                                        if (url) {
                                            onUpdate({ content: { src: url } });
                                        }
                                    }}
                                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${isDarkMode
                                        ? 'bg-[#111111] border-[#3d3d3f]/60 text-gray-300 hover:text-white hover:border-[#636366]'
                                        : 'bg-white border-gray-300 text-gray-600 hover:text-gray-900 hover:border-gray-400'
                                        }`}
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16" />
                                    </svg>
                                    Select from assets
                                </button>
                            )}
                        </div>
                        <div>
                            <label className={labelClass}>Alt Text</label>
                            <input
                                type="text"
                                value={(block.content as ImageBlockContent).alt || ''}
                                onChange={(e) => onUpdate({ content: { alt: e.target.value } })}
                                className={inputClass}
                                placeholder="Image description"
                            />
                        </div>
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <label className={labelClass}>Width</label>
                                <input
                                    type="text"
                                    value={(block.content as ImageBlockContent).width || ''}
                                    onChange={(e) => onUpdate({ content: { width: e.target.value } })}
                                    className={inputClass}
                                    placeholder="e.g. 100%"
                                />
                            </div>
                            <div className="flex-1">
                                <label className={labelClass}>Height</label>
                                <input
                                    type="text"
                                    value={(block.content as ImageBlockContent).height || ''}
                                    onChange={(e) => onUpdate({ content: { height: e.target.value } })}
                                    className={inputClass}
                                    placeholder="e.g. auto"
                                />
                            </div>
                        </div>
                    </>
                )}

                {block.type === 'button' && (
                    <>
                        <div>
                            <label className={labelClass}>Button Text</label>
                            <input
                                type="text"
                                value={(block.content as ButtonBlockContent).text}
                                onChange={(e) => onUpdate({ content: { text: e.target.value } })}
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Button URL</label>
                            <input
                                type="text"
                                value={(block.content as ButtonBlockContent).url}
                                onChange={(e) => onUpdate({ content: { url: e.target.value } })}
                                className={inputClass}
                                placeholder="https://example.com"
                            />
                        </div>
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <label className={labelClass}>Background Color</label>
                                <input
                                    type="color"
                                    value={(block.content as ButtonBlockContent).backgroundColor}
                                    onChange={(e) => onUpdate({ content: { backgroundColor: e.target.value } })}
                                    className="h-8 w-12 rounded cursor-pointer"
                                />
                                <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {(block.content as ButtonBlockContent).backgroundColor}
                                </span>
                            </div>
                        </div>
                        <div>
                            <label className={labelClass}>Text Color</label>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="color"
                                    value={(block.content as ButtonBlockContent).textColor}
                                    onChange={(e) => onUpdate({ content: { textColor: e.target.value } })}
                                    className="h-8 w-12 rounded cursor-pointer"
                                />
                                <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {(block.content as ButtonBlockContent).textColor}
                                </span>
                            </div>
                        </div>
                        <div>
                            <label className={labelClass}>Border Radius</label>
                            <input
                                type="text"
                                value={(block.content as ButtonBlockContent).borderRadius || '4px'}
                                onChange={(e) => onUpdate({ content: { borderRadius: e.target.value } })}
                                className={inputClass}
                            />
                        </div>
                    </>
                )}

                {block.type === 'divider' && (
                    <>
                        <div>
                            <label className={labelClass}>Line Color</label>
                            <input
                                type="color"
                                value={(block.content as DividerBlockContent).color}
                                onChange={(e) => onUpdate({ content: { color: e.target.value } })}
                                className="w-full h-10 rounded cursor-pointer"
                            />
                        </div>
                        <div>
                            <label className={labelClass}>Thickness</label>
                            <input
                                type="text"
                                value={(block.content as DividerBlockContent).thickness}
                                onChange={(e) => onUpdate({ content: { thickness: e.target.value } })}
                                className={inputClass}
                                placeholder="1px"
                            />
                        </div>
                    </>
                )}

                {block.type === 'spacer' && (
                    <div>
                        <label className={labelClass}>Height (px)</label>
                        <input
                            type="number"
                            value={parseInt(((block.content as SpacerBlockContent).height || '20px').toString())}
                            onChange={(e) => onUpdate({ content: { height: `${e.target.value}px` } })}
                            className={inputClass}
                        />
                    </div>
                )}

                {block.type === 'social' && (
                    <div className="space-y-4">
                        {(block.content as SocialBlockContent).platforms.map((platform: any, idx: number) => (
                            <div key={idx} className={`border p-3 rounded-lg ${isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-gray-200'}`}>
                                <div className="flex items-center gap-2 mb-2">
                                    <input
                                        type="checkbox"
                                        checked={platform.enabled}
                                        onChange={(e) => {
                                            const newPlatforms = [...(block.content as SocialBlockContent).platforms];
                                            newPlatforms[idx] = { ...newPlatforms[idx], enabled: e.target.checked };
                                            onUpdate({ content: { platforms: newPlatforms } });
                                        }}
                                        className="rounded border-gray-300 text-[#0071e3] focus:ring-[#0071e3]"
                                    />
                                    <img
                                        src={SOCIAL_ICONS[platform.name]}
                                        alt={platform.name}
                                        className="w-5 h-5 object-contain"
                                    />
                                    <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>{platform.name}</span>
                                </div>

                                {platform.enabled && (
                                    <div className="ml-7">
                                        <label className={`text-xs block mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                            Username / Slug
                                        </label>
                                        <div className="flex items-center">
                                            <span className={`text-xs px-2 py-2 border border-r-0 rounded-l-md ${isDarkMode ? 'bg-zinc-900 border-zinc-700 text-gray-500' : 'bg-gray-100 border-gray-300 text-gray-500'}`}>
                                                @
                                            </span>
                                            <input
                                                type="text"
                                                value={platform.slug || ''}
                                                onChange={(e) => {
                                                    const newSlug = e.target.value;
                                                    const newPlatforms = [...(block.content as SocialBlockContent).platforms];
                                                    const baseUrl = SOCIAL_BASE_URLS[platform.name] || '';
                                                    newPlatforms[idx] = {
                                                        ...newPlatforms[idx],
                                                        slug: newSlug,
                                                        url: `${baseUrl}${newSlug}`
                                                    };
                                                    onUpdate({ content: { platforms: newPlatforms } });
                                                }}
                                                placeholder="username"
                                                className={`w-full text-xs px-2 py-2 border rounded-r-md focus:outline-none focus:ring-1 focus:ring-[#0071e3] ${isDarkMode
                                                    ? 'bg-[#1d1d1f] border-zinc-700 text-white placeholder-gray-600'
                                                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                                    }`}
                                            />
                                        </div>
                                        <div className={`text-[10px] mt-1 truncate ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                                            {platform.url}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {block.type === 'product' && (
                    <>
                        <div className={`pb-3 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                            <label className={labelClass}>Select Product</label>
                            <select
                                className={inputClass}
                                onChange={(e) => {
                                    const prodId = e.target.value;
                                    const product = products.find(p => p.id === prodId);
                                    if (product) {
                                        onUpdate({
                                            content: {
                                                title: product.name,
                                                price: `$${(product.unitAmount / 100).toFixed(2)}`,
                                                description: product.description || '',
                                                image: product.images?.[0] || '',
                                                buttonUrl: product.paymentLinkUrl || '#',
                                                buttonText: 'Buy Now'
                                            }
                                        });
                                    }
                                }}
                            >
                                <option value="">-- Start with a Product --</option>
                                {products.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                            <p className={`text-[10px] mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                This will overwrite current fields with product data.
                            </p>
                        </div>

                        <div>
                            <label className={labelClass}>Title</label>
                            <input
                                type="text"
                                value={(block.content as ProductBlockContent).title}
                                onChange={(e) => onUpdate({ content: { title: e.target.value } })}
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <label className={labelClass}>Price</label>
                            <input
                                type="text"
                                value={(block.content as ProductBlockContent).price}
                                onChange={(e) => onUpdate({ content: { price: e.target.value } })}
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <label className={labelClass}>Description</label>
                            <textarea
                                value={(block.content as ProductBlockContent).description}
                                onChange={(e) => onUpdate({ content: { description: e.target.value } })}
                                className={`${inputClass} min-h-[80px]`}
                            />
                            <button
                                onClick={() => onGenerateText(block.id, (block.content as ProductBlockContent).description)}
                                disabled={isGenerating}
                                className={`mt-2 w-full py-1.5 px-3 rounded text-xs font-medium flex items-center justify-center gap-2 transition-colors ${isDarkMode
                                    ? 'bg-zinc-800 hover:bg-zinc-700 text-gray-200'
                                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                                    } ${isGenerating ? 'opacity-50 cursor-wait' : ''}`}
                            >
                                {isGenerating ? (
                                    <>
                                        <span className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
                                        <span>Generating...</span>
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                                        </svg>
                                        <span>Generate with AI</span>
                                    </>
                                )}
                            </button>
                        </div>

                        <div>
                            <label className={labelClass}>Image URL</label>
                            <input
                                type="text"
                                value={(block.content as ProductBlockContent).image || ''}
                                onChange={(e) => onUpdate({ content: { image: e.target.value } })}
                                className={inputClass}
                            />
                        </div>

                        <div className="flex gap-2">
                            {onUploadAsset && (
                                <label className="flex-1 cursor-pointer bg-[#0071e3] hover:bg-[#0077ed] text-white py-2 px-3 rounded-lg text-xs font-medium text-center transition-colors">
                                    Upload Image
                                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                                </label>
                            )}
                            {onShowAssetSelector && (
                                <button
                                    onClick={async () => {
                                        const url = await onShowAssetSelector();
                                        if (url) {
                                            onUpdate({ content: { image: url } });
                                        }
                                    }}
                                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${isDarkMode
                                        ? 'bg-[#111111] border-[#3d3d3f]/60 text-gray-300 hover:text-white hover:border-[#636366]'
                                        : 'bg-white border-gray-300 text-gray-600 hover:text-gray-900 hover:border-gray-400'
                                        }`}
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16" />
                                    </svg>
                                    Select
                                </button>
                            )}
                        </div>

                        <div>
                            <label className={labelClass}>Button Text</label>
                            <input
                                type="text"
                                value={(block.content as ProductBlockContent).buttonText}
                                onChange={(e) => onUpdate({ content: { buttonText: e.target.value } })}
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <label className={labelClass}>Button URL (Payment Link)</label>
                            <input
                                type="text"
                                value={(block.content as ProductBlockContent).buttonUrl}
                                onChange={(e) => onUpdate({ content: { buttonUrl: e.target.value } })}
                                className={inputClass}
                            />
                        </div>

                        <div className="flex gap-2">
                            <div className="flex-1">
                                <label className={labelClass}>Button Color</label>
                                <div className="flex gap-2 items-center">
                                    <input
                                        type="color"
                                        value={(block.content as ProductBlockContent).buttonColor}
                                        onChange={(e) => onUpdate({ content: { buttonColor: e.target.value } })}
                                        className="h-8 w-12 rounded cursor-pointer"
                                    />
                                    <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {(block.content as ProductBlockContent).buttonColor}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            <div className={`border-t pt-3 ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                <label className={`text-xs font-bold uppercase tracking-wider mb-3 block ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Styles</label>

                <div className="space-y-3">
                    <div>
                        <label className={labelClass}>Background Color</label>
                        <div className="flex gap-2 items-center">
                            <input
                                type="color"
                                value={block.styles.backgroundColor || '#ffffff'}
                                onChange={(e) => onUpdate({ styles: { backgroundColor: e.target.value } })}
                                className="h-8 w-12 rounded cursor-pointer"
                            />
                            <button
                                onClick={() => onUpdate({ styles: { backgroundColor: undefined } })}
                                className={`text-xs px-2 py-1 rounded border ${isDarkMode ? 'border-[#3d3d3f] hover:bg-[#3d3d3f] text-gray-400' : 'border-gray-200 hover:bg-gray-100 text-gray-500'}`}
                            >
                                Clear
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className={labelClass}>Padding</label>
                        <input
                            type="text"
                            value={block.styles.padding || '0px'}
                            onChange={(e) => onUpdate({ styles: { padding: e.target.value } })}
                            className={inputClass}
                            placeholder="e.g. 20px"
                        />
                    </div>

                    <div>
                        <label className={labelClass}>Alignment</label>
                        <div className={`flex rounded-lg overflow-hidden border ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                            {['left', 'center', 'right'].map((align) => (
                                <button
                                    key={align}
                                    onClick={() => onUpdate({ styles: { textAlign: align as any } })}
                                    className={`flex-1 py-1 text-xs capitalize ${block.styles.textAlign === align
                                        ? 'bg-[#0071e3] text-white'
                                        : isDarkMode ? 'bg-[#2d2d2f] text-gray-400 hover:bg-[#3d3d3f]' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                        }`}
                                >
                                    {align}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// HTML Generator
// ============================================================================

export function generateEmailHtml(blocks: EmailBlock[]): string {
    const renderBlock = (block: EmailBlock): string => {
        const baseStyle = `
      background-color: ${block.styles.backgroundColor || 'transparent'};
      padding: ${block.styles.padding || '16px'};
      text-align: ${block.styles.textAlign || 'left'};
    `.trim();

        switch (block.type) {
            case 'text':
            case 'header':
            case 'footer':
                return `
          <div style="${baseStyle}; font-size: ${block.styles.fontSize || '16px'}; color: ${block.styles.color || '#333333'}; font-weight: ${block.styles.fontWeight || 'normal'}; line-height: ${block.styles.lineHeight || '1.5'};">
            ${(block.content as TextBlockContent).text.replace(/\n/g, '<br>')}
          </div>
        `;

            case 'image':
                const imgContent = block.content as ImageBlockContent;
                return imgContent.src
                    ? `<div style="${baseStyle}"><img src="${imgContent.src}" alt="${imgContent.alt}" style="width: ${imgContent.width}; max-width: 100%; display: block; margin: 0 auto;"></div>`
                    : '';

            case 'button':
                const btnContent = block.content as ButtonBlockContent;
                return `
          <div style="${baseStyle}">
            <a href="${btnContent.url}" style="display: inline-block; padding: 12px 24px; background-color: ${btnContent.backgroundColor}; color: ${btnContent.textColor}; border-radius: ${btnContent.borderRadius}; text-decoration: none; font-weight: 600;">
              ${btnContent.text}
            </a>
          </div>
        `;

            case 'divider':
                const divContent = block.content as DividerBlockContent;
                return `<div style="${baseStyle}"><hr style="border: none; border-top: ${divContent.thickness} solid ${divContent.color};"></div>`;

            case 'product':
                const prodContent = block.content as ProductBlockContent;
                return `
                    <div style="${baseStyle}; text-align: center;">
                        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 300px; margin: 0 auto; border: 1px solid #e5e5e5; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
                            ${prodContent.image ? `
                            <tr>
                                <td style="padding: 0;">
                                    <img src="${prodContent.image}" alt="${prodContent.title}" style="width: 100%; height: auto; display: block;" />
                                </td>
                            </tr>
                            ` : ''}
                            <tr>
                                <td style="padding: 20px;">
                                    <h3 style="margin: 0 0 8px 0; font-size: 18px; color: #333333;">${prodContent.title}</h3>
                                    <p style="margin: 0 0 12px 0; font-size: 18px; font-weight: bold; color: #0071e3;">${prodContent.price}</p>
                                    <p style="margin: 0 0 20px 0; font-size: 14px; color: #666666;">${prodContent.description}</p>
                                    <a href="${prodContent.buttonUrl}" style="display: inline-block; padding: 10px 20px; background-color: ${prodContent.buttonColor}; color: ${prodContent.buttonTextColor}; border-radius: ${prodContent.buttonBorderRadius || '4px'}; text-decoration: none; font-weight: 600;">
                                        ${prodContent.buttonText}
                                    </a>
                                </td>
                            </tr>
                        </table>
                    </div>
                `;

            case 'spacer':
                const spacerContent = block.content as SpacerBlockContent;
                return `<div style="height: ${spacerContent.height};"></div>`;

            case 'social':
                const socialContent = block.content as SocialBlockContent;
                const socialLinks = socialContent.platforms
                    .filter((p) => p.enabled)
                    .map(
                        (p) =>
                            `<a href="${p.url}" target="_blank" style="display: inline-block; text-decoration: none; margin: 0 8px;">
                                <img src="${SOCIAL_ICONS[p.name]}" alt="${p.name}" width="24" height="24" style="width: 24px; height: 24px; display: block; border: 0;" />
                            </a>`
                    )
                    .join('');
                return `<div style="${baseStyle}">${socialLinks}</div>`;

            case 'columns':
                const colContent = block.content as ColumnsBlockContent;
                const colWidth = `${100 / colContent.columns}%`;
                return `
          <table width="100%" cellpadding="0" cellspacing="0" style="${baseStyle}">
            <tr>
              ${colContent.children.map(col =>
                    `<td width="${colWidth}" valign="top" style="vertical-align: top;">
                  ${col.blocks.map(renderBlock).join('')}
                </td>`
                ).join('')}
            </tr>
          </table>
        `;

            default:
                return '';
        }
    };

    const blocksHtml = blocks.map(renderBlock).join('');

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <tr>
            <td>
              ${blocksHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export default EmailBuilder;


