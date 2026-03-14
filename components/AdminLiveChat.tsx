import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import { authFetch } from '../services/authFetch';

const ADMIN_EMAIL = 'contact.mngrm@gmail.com';
const GEMINI_API_KEY = (process as any).env?.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';

// ─── Types ────────────────────────────────────────────────────────────

interface ToolCall {
    name: string;
    args: Record<string, any>;
    result?: any;
    status: 'running' | 'done' | 'error';
}

interface Message {
    id: string;
    role: 'user' | 'model' | 'tool';
    text: string;
    timestamp: number;
    toolCalls?: ToolCall[];
    isStreaming?: boolean;
}

interface AdminLiveChatProps {
    adminId: string;
}

// ─── Tool Declarations ────────────────────────────────────────────────

const ADMIN_TOOLS = [
    {
        name: 'search_users',
        description: 'Search all users in the system by name or email.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: { type: Type.STRING, description: 'Search term for display name or email. Use empty string to list all.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'search_projects',
        description: 'Search all projects across all users by name or description. Use empty string query to list all.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: { type: Type.STRING, description: 'Search term for project name/description. Empty string lists all.' },
                userId: { type: Type.STRING, description: 'Optional: restrict search to one user\'s projects.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'search_tasks',
        description: 'Search all tasks across all projects by title or description.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: { type: Type.STRING, description: 'Search term. Empty string lists all.' },
                userId: { type: Type.STRING, description: 'Optional: filter to a specific user.' },
                status: { type: Type.STRING, description: 'Optional: filter by status', enum: ['todo', 'in_progress', 'done'] },
                priority: { type: Type.STRING, description: 'Optional: filter by priority', enum: ['low', 'medium', 'high'] },
            },
            required: ['query'],
        },
    },
    {
        name: 'search_notes',
        description: 'Search all notes across all projects by title or content.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: { type: Type.STRING, description: 'Search term. Empty string lists all.' },
                userId: { type: Type.STRING, description: 'Optional: filter to a specific user.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'read_project_details',
        description: 'Get the full details of a specific project including all tasks, notes, and session count.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING, description: 'The project owner\'s user ID.' },
                projectId: { type: Type.STRING, description: 'The project ID.' },
            },
            required: ['userId', 'projectId'],
        },
    },
    {
        name: 'create_project',
        description: 'Create a new project for a user.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING, description: 'The owner user ID.' },
                name: { type: Type.STRING, description: 'Project name.' },
                description: { type: Type.STRING, description: 'Project description.' },
            },
            required: ['userId', 'name'],
        },
    },
    {
        name: 'update_project',
        description: 'Update a project\'s name or description.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING },
                projectId: { type: Type.STRING },
                name: { type: Type.STRING, description: 'New project name (optional).' },
                description: { type: Type.STRING, description: 'New description (optional).' },
            },
            required: ['userId', 'projectId'],
        },
    },
    {
        name: 'create_task',
        description: 'Create a new task in a user\'s project.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING },
                projectId: { type: Type.STRING },
                title: { type: Type.STRING },
                description: { type: Type.STRING, description: 'Optional task description.' },
                priority: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
            },
            required: ['userId', 'projectId', 'title', 'priority'],
        },
    },
    {
        name: 'update_task',
        description: 'Update an existing task\'s title, description, status, or priority.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING },
                projectId: { type: Type.STRING },
                taskId: { type: Type.STRING },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                status: { type: Type.STRING, enum: ['todo', 'in_progress', 'done'] },
                priority: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
            },
            required: ['userId', 'projectId', 'taskId'],
        },
    },
    {
        name: 'delete_task',
        description: 'Delete a task from a user\'s project.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING },
                projectId: { type: Type.STRING },
                taskId: { type: Type.STRING },
            },
            required: ['userId', 'projectId', 'taskId'],
        },
    },
    {
        name: 'create_note',
        description: 'Create a new note in a user\'s project.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING },
                projectId: { type: Type.STRING },
                title: { type: Type.STRING },
                content: { type: Type.STRING, description: 'Full markdown content of the note.' },
                color: { type: Type.STRING, description: 'Optional hex color e.g. #3b82f6' },
            },
            required: ['userId', 'projectId', 'title', 'content'],
        },
    },
    {
        name: 'update_note',
        description: 'Edit an existing note\'s title, content, or color.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING },
                projectId: { type: Type.STRING },
                noteId: { type: Type.STRING },
                title: { type: Type.STRING },
                content: { type: Type.STRING },
                color: { type: Type.STRING },
            },
            required: ['userId', 'projectId', 'noteId'],
        },
    },
    {
        name: 'delete_note',
        description: 'Delete a note from a user\'s project.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING },
                projectId: { type: Type.STRING },
                noteId: { type: Type.STRING },
            },
            required: ['userId', 'projectId', 'noteId'],
        },
    },
    {
        name: 'generate_image',
        description: 'Generate an image using Gemini Imagen and add it directly to a project\'s assets.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING, description: 'The project owner\'s user ID.' },
                projectId: { type: Type.STRING, description: 'The project ID.' },
                prompt: { type: Type.STRING, description: 'The detailed image generation prompt.' },
                useProModel: { type: Type.BOOLEAN, description: 'Set to true for highest quality (Pro) or false for fast generations.' },
            },
            required: ['userId', 'projectId', 'prompt'],
        },
    },
    {
        name: 'edit_image',
        description: 'Edit a generated image within a project\'s assets based on an instruction.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING },
                projectId: { type: Type.STRING },
                imageUrl: { type: Type.STRING, description: 'The URL of the image to edit.' },
                prompt: { type: Type.STRING, description: 'The edit instruction (e.g. "make it darker", "add a dog").' },
            },
            required: ['userId', 'projectId', 'imageUrl', 'prompt'],
        },
    },
    {
        name: 'dispatch_agent',
        description: 'Dispatch an autonomous AI sub-agent to work on a complex multi-step goal for a specific project. The agent will execute the goal autonomously using its own tools.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING, description: 'The project owner\'s user ID.' },
                projectId: { type: Type.STRING, description: 'The project ID to work on.' },
                goal: { type: Type.STRING, description: 'Detailed multi-step goal for the agent to accomplish.' },
            },
            required: ['userId', 'projectId', 'goal'],
        },
    },
    {
        name: 'generate_project_website',
        description: 'Generate a functional, single-file website (HTML/Tailwind) string based on the project context.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING },
                projectId: { type: Type.STRING },
                prompt: { type: Type.STRING },
            },
            required: ['userId', 'projectId', 'prompt'],
        },
    },
    {
        name: 'edit_project_website',
        description: 'Fetch the latest generated single-file HTML website for a project and apply AI-driven edits based on the user prompt.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING },
                projectId: { type: Type.STRING },
                prompt: { type: Type.STRING, description: 'Instructions on what to change in the website' },
            },
            required: ['userId', 'projectId', 'prompt'],
        },
    },
    {
        name: 'generate_canvas_website',
        description: 'Generates or updates a full Next.js application (Canvas) and deploys it to Vercel/GitHub. Use this when the user wants a full web app deposited into the Canvas tab, not just a single HTML file.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                userId: { type: Type.STRING },
                projectId: { type: Type.STRING },
                prompt: { type: Type.STRING, description: 'Instructions for the entire full-stack application.' },
            },
            required: ['userId', 'projectId', 'prompt'],
        },
    },
    {
        name: 'get_agent_assignments',
        description: 'Get the status of all recent agent assignments including progress and current step.',
        parameters: {
            type: Type.OBJECT,
            properties: {},
            required: [],
        },
    },
    {
        name: 'create_canvas_node',
        description: 'Creates a visual node on the SwarmCanvas. Use type="project" for project context nodes, type="user" for user nodes, type="task" for task nodes, and type="action" for AI action nodes (with subtype like generate_image, generate_blog, generate_project_website, generate_canvas_website). The data field carries the node payload and the optional position sets {x,y} on the canvas.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                type: { type: Type.STRING, description: 'project | user | task | action' },
                subtype: { type: Type.STRING, description: 'For action nodes: generate_image | generate_blog | generate_project_website | generate_canvas_website' },
                label: { type: Type.STRING },
                data: { type: Type.OBJECT, description: 'Arbitrary payload: project context, action config (including targetUserId, targetProjectId, prompt)', properties: {} },
                position: { type: Type.OBJECT, description: 'Optional {x,y} position', properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } } },
            },
            required: ['type', 'label'],
        },
    },
    {
        name: 'connect_canvas_nodes',
        description: 'Draws an edge from sourceNodeId to targetNodeId on the canvas. Typically used to link a project context node to an action node so the action can inherit the project context when executing.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                sourceNodeId: { type: Type.STRING },
                targetNodeId: { type: Type.STRING },
            },
            required: ['sourceNodeId', 'targetNodeId'],
        },
    },
    {
        name: 'run_canvas_action_node',
        description: 'Executes an action node on the canvas. The node must already exist and be of type=action. It will automatically gather context from all project nodes connected to it via edges, enrich the user prompt with that context using Gemini, then execute the appropriate action (generate_image, generate_blog, etc.).',
        parameters: {
            type: Type.OBJECT,
            properties: {
                nodeId: { type: Type.STRING, description: 'The canvas node ID to execute' },
            },
            required: ['nodeId'],
        },
    },
    {
        name: 'list_canvas_nodes',
        description: 'Returns all current nodes on the canvas (their IDs, types, statuses, and results). Use this to inspect the current canvas state before adding or connecting nodes.',
        parameters: { type: Type.OBJECT, properties: {}, required: [] },
    },
    {
        name: 'clear_canvas',
        description: 'Removes all nodes from the canvas. Use before starting a fresh workflow to avoid clutter.',
        parameters: { type: Type.OBJECT, properties: {}, required: [] },
    },
    {
        name: 'get_recent_activity',
        description: 'Fetch recent activity logs across all users and projects in the platform (collectionGroup query). Returns a formatted timeline. Use this to understand what has been happening on the platform, who has been active, and what assets have been generated.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                limit: { type: Type.NUMBER, description: 'Maximum number of activity entries to return (1-200). Default: 100.' },
                userId: { type: Type.STRING, description: 'Optional: restrict to a specific user\'s activities.' },
            },
            required: [],
        },
    },
];

// ─── Tool Icons & Labels ──────────────────────────────────────────────

const TOOL_META: Record<string, { icon: string; label: string; color: string }> = {
    search_users: { icon: '👤', label: 'Searching Users', color: '#6366f1' },
    search_projects: { icon: '📁', label: 'Searching Projects', color: '#8b5cf6' },
    search_tasks: { icon: '✅', label: 'Searching Tasks', color: '#06b6d4' },
    search_notes: { icon: '📝', label: 'Searching Notes', color: '#f59e0b' },
    read_project_details: { icon: '🔍', label: 'Reading Project', color: '#10b981' },
    create_project: { icon: '🆕', label: 'Creating Project', color: '#10b981' },
    update_project: { icon: '✏️', label: 'Updating Project', color: '#3b82f6' },
    create_task: { icon: '➕', label: 'Creating Task', color: '#10b981' },
    update_task: { icon: '🔄', label: 'Updating Task', color: '#3b82f6' },
    delete_task: { icon: '🗑️', label: 'Deleting Task', color: '#ef4444' },
    create_note: { icon: '📋', label: 'Creating Note', color: '#10b981' },
    update_note: { icon: '✏️', label: 'Updating Note', color: '#3b82f6' },
    delete_note: { icon: '🗑️', label: 'Deleting Note', color: '#ef4444' },
    generate_image: { icon: '🎨', label: 'Generating Image', color: '#ec4899' },
    edit_image: { icon: '🖌️', label: 'Editing Image', color: '#ec4899' },
    dispatch_agent: { icon: '🤖', label: 'Dispatching Agent', color: '#a855f7' },
    get_agent_assignments: { icon: '📊', label: 'Fetching Agent Status', color: '#6366f1' },
    generate_project_website: { icon: '🌐', label: 'Generating Single-File Website', color: '#10b981' },
    edit_project_website: { icon: '🔧', label: 'Editing Single-File Website', color: '#3b82f6' },
    generate_canvas_website: { icon: '🚀', label: 'Deploying Canvas Web App', color: '#8b5cf6' },
    create_canvas_node: { icon: '🟣', label: 'Creating Canvas Node', color: '#a855f7' },
    connect_canvas_nodes: { icon: '🔗', label: 'Connecting Nodes', color: '#6366f1' },
    run_canvas_action_node: { icon: '▶️', label: 'Running Workflow Action', color: '#10b981' },
    list_canvas_nodes: { icon: '📋', label: 'Reading Canvas', color: '#64748b' },
    clear_canvas: { icon: '🧹', label: 'Clearing Canvas', color: '#ef4444' },
    get_recent_activity: { icon: '📊', label: 'Fetching Activity Log', color: '#06b6d4' },
};

const SYSTEM_PROMPT = `You are the Admin AI Command Center for a SaaS platform called Roist.
You have full administrative access to all user data via tools.
You help the admin manage all clients' projects, tasks, notes, and content.

Your capabilities:
- Search and view any user's projects, tasks, notes across the entire platform
- Create, edit, delete content on behalf of users
- Dispatch autonomous AI agents to work on complex goals for specific projects
- Read full project details, track agent assignments
- Fetch real-time activity logs across all users via get_recent_activity

How to behave:
1. When the admin asks about something, ALWAYS use tools first to find real data (don't guess or hallucinate)
2. Search before writing — if asked to create a task for "the AI world models project", first search_projects to find it, then create_task with the real IDs
3. After using tools, summarize what you found/did clearly
4. Be concise and action-oriented — you're a power tool, not a chatbot
5. Use multiple tool calls per turn to accomplish complex tasks end-to-end
6. Show results in clean formatted markdown tables when listing multiple items

🔍 AI WATCHDOG — Platform Health Monitoring:
When the admin says "platform health", "status update", "how's everyone doing", or any similar request for a platform overview:
1. ALWAYS call get_recent_activity first (limit: 100) to get the latest platform-wide events.
2. Analyze the results and output a structured "🟢 Platform Health Summary" that includes:
   - **Active Users**: Who was active in the last 24h (based on activity ownerUid).
   - **Generation Highlights**: What content was created (images, videos, websites, etc.).
   - **⚠️ At-Risk Signals**: Flag any user whose recent activity shows 3+ errors or failures in the last 2 hours, or any project with no activity in 48+ hours despite having many incomplete tasks.
   - **💡 Suggested Actions**: Based on patterns, propose 1-2 quick interventions (e.g., "dispatch agent to help user X finish their stalled website").
3. Format the output as a clean dashboard-style summary with sections and emojis.

Example flow:
User: "Create 3 tasks for John's marketing project"
You: [search_users query="john"] → [search_projects query="marketing" userId="<johnId>"] → [create_task x3] → report what was created

Example flow 2:
User: "Platform health"
You: [get_recent_activity limit=100] → analyze → output structured health summary with at-risk flags and suggested interventions`;


// ─── Main Component ───────────────────────────────────────────────────

export const AdminLiveChat: React.FC<AdminLiveChatProps> = ({ adminId }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const aiRef = useRef<GoogleGenAI | null>(null);

    // Load history
    useEffect(() => {
        const saved = localStorage.getItem('admin_command_center_history');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) setMessages(parsed.slice(-80));
            } catch { }
        }
    }, []);

    // Save history
    useEffect(() => {
        if (messages.length === 0) return;
        const timeout = setTimeout(() => {
            try {
                const toSave = messages.filter(m => !m.isStreaming).slice(-80);
                localStorage.setItem('admin_command_center_history', JSON.stringify(toSave));
            } catch { }
        }, 500);
        return () => clearTimeout(timeout);
    }, [messages]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Initialize Gemini
    const getAI = useCallback(() => {
        if (!aiRef.current) {
            aiRef.current = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        }
        return aiRef.current;
    }, []);

    // ─── Tool Executor ─────────────────────────────────────────────

    const executeTool = useCallback(async (toolName: string, args: Record<string, any>): Promise<any> => {
        const res = await authFetch('/api/admin-tools', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: toolName, args }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(err.error || err.message || `Tool ${toolName} failed`);
        }
        return await res.json();
    }, []);

    // ─── Message Helpers ───────────────────────────────────────────

    const addMessage = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
        const newMsg: Message = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            ...msg,
        };
        setMessages(prev => [...prev, newMsg]);
        return newMsg.id;
    }, []);

    const updateMessage = useCallback((id: string, updates: Partial<Message>) => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
    }, []);

    // ─── Main Send Handler ─────────────────────────────────────────

    const sendMessage = useCallback(async () => {
        const text = inputText.trim();
        if (!text || isProcessing) return;
        setInputText('');
        setError(null);
        setIsProcessing(true);

        // Add user message
        addMessage({ role: 'user', text });

        // Build conversation history for Gemini
        const history: Array<{ role: 'user' | 'model'; parts: any[] }> = [];
        const currentMessages = [...messages, { id: '', role: 'user' as const, text, timestamp: Date.now() }];

        // Only include non-streaming, non-tool messages in history
        for (const msg of currentMessages) {
            if (msg.role === 'user') {
                history.push({ role: 'user', parts: [{ text: msg.text }] });
            } else if (msg.role === 'model' && msg.text) {
                history.push({ role: 'model', parts: [{ text: msg.text }] });
            }
        }

        // Add streaming model message placeholder
        const modelMsgId = addMessage({ role: 'model', text: '', isStreaming: true });

        try {
            const ai = getAI();
            let streamingText = '';
            let fullResponseParts: any[] = [];
            let conversationContents = history;
            let continueLoop = true;
            let loopCount = 0;
            const MAX_LOOPS = 10;

            while (continueLoop && loopCount < MAX_LOOPS) {
                loopCount++;

                // Stream the response
                const streamResult = await ai.models.generateContentStream({
                    model: 'gemini-3-flash-preview',
                    contents: conversationContents,
                    config: {
                        systemInstruction: SYSTEM_PROMPT,
                        tools: [{ functionDeclarations: ADMIN_TOOLS }],
                    },
                });

                streamingText = '';
                const responseParts: any[] = [];

                for await (const chunk of streamResult) {
                    const candidates = (chunk as any).candidates || [];
                    for (const candidate of candidates) {
                        for (const part of (candidate.content?.parts || [])) {
                            if (part.text) {
                                streamingText += part.text;
                                updateMessage(modelMsgId, { text: streamingText, isStreaming: true });
                                responseParts.push({ text: part.text });
                            } else if (part.functionCall) {
                                responseParts.push({ functionCall: part.functionCall });
                            }
                        }
                    }
                }

                fullResponseParts = responseParts;

                // Check for function calls
                const functionCalls = responseParts.filter(p => p.functionCall);

                if (functionCalls.length > 0) {
                    // Add model turn to conversation
                    conversationContents = [
                        ...conversationContents,
                        { role: 'model', parts: responseParts },
                    ];

                    // Show tool call cards
                    const toolCallObjs: ToolCall[] = functionCalls.map(p => ({
                        name: p.functionCall.name,
                        args: p.functionCall.args || {},
                        status: 'running' as const,
                    }));

                    updateMessage(modelMsgId, {
                        text: streamingText,
                        isStreaming: true,
                        toolCalls: toolCallObjs,
                    });

                    // Execute all tools
                    const toolResponses: any[] = [];
                    const completedToolCalls: ToolCall[] = [...toolCallObjs];

                    for (let i = 0; i < functionCalls.length; i++) {
                        const fc = functionCalls[i].functionCall;
                        try {
                            const result = await executeTool(fc.name, fc.args || {});
                            completedToolCalls[i] = { ...completedToolCalls[i], result, status: 'done' };
                            toolResponses.push({
                                functionResponse: {
                                    name: fc.name,
                                    response: result,
                                },
                            });
                        } catch (toolErr: any) {
                            const errResult = { error: toolErr.message };
                            completedToolCalls[i] = { ...completedToolCalls[i], result: errResult, status: 'error' };
                            toolResponses.push({
                                functionResponse: {
                                    name: fc.name,
                                    response: errResult,
                                },
                            });
                        }

                        updateMessage(modelMsgId, { toolCalls: [...completedToolCalls] });
                    }

                    // Add tool responses to conversation
                    conversationContents = [
                        ...conversationContents,
                        { role: 'user', parts: toolResponses },
                    ];

                    // Continue loop for model to process tool results
                } else {
                    // No function calls — we're done
                    continueLoop = false;
                }
            }

            // Finalize
            updateMessage(modelMsgId, { text: streamingText, isStreaming: false });

        } catch (e: any) {
            console.error('[AdminChat] Error:', e);
            updateMessage(modelMsgId, {
                text: `❌ Error: ${e.message}`,
                isStreaming: false,
            });
            setError(e.message);
        } finally {
            setIsProcessing(false);
        }
    }, [inputText, isProcessing, messages, addMessage, updateMessage, getAI, executeTool]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const clearHistory = () => {
        setMessages([]);
        localStorage.removeItem('admin_command_center_history');
    };

    // ─── Render ────────────────────────────────────────────────────

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            background: 'linear-gradient(135deg, #0a0a0f 0%, #0d0d1a 50%, #0a0f1a 100%)',
            color: '#e2e8f0',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            position: 'relative',
            overflow: 'hidden',
        }}>
            {/* Grid background */}
            <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
                backgroundImage: 'linear-gradient(rgba(99,102,241,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.03) 1px, transparent 1px)',
                backgroundSize: '40px 40px',
            }} />

            {/* Header */}
            <div style={{
                position: 'relative', zIndex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid rgba(99,102,241,0.2)',
                background: 'rgba(10,10,20,0.8)',
                backdropFilter: 'blur(20px)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, boxShadow: '0 0 20px rgba(99,102,241,0.4)',
                    }}>🤖</div>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px' }}>Admin Command Center</div>
                        <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 500 }}>Multi-Agent AI System</div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isProcessing && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6366f1' }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', animation: 'pulse 1s infinite' }} />
                            Processing
                        </div>
                    )}
                    <button onClick={clearHistory} style={{
                        padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.3)',
                        background: 'rgba(99,102,241,0.1)', color: '#94a3b8', cursor: 'pointer',
                        fontSize: 12, fontWeight: 500, transition: 'all 0.2s',
                    }}>Clear</button>
                </div>
            </div>

            {/* Messages */}
            <div style={{
                flex: 1, overflowY: 'auto', padding: '16px',
                display: 'flex', flexDirection: 'column', gap: 12,
                position: 'relative', zIndex: 1,
            }}>
                {messages.length === 0 && (
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', height: '100%', gap: 16, opacity: 0.7,
                    }}>
                        <div style={{ fontSize: 48 }}>⚙️</div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>Admin AI Command Center</div>
                            <div style={{ fontSize: 13, color: '#64748b', maxWidth: 400 }}>
                                Search across all users & projects, create/edit tasks & notes, dispatch autonomous agents, and more.
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 500 }}>
                            {[
                                'Platform health',
                                'Show me all users',
                                'Search for the AI world models project',
                                'Create a task in project X',
                                'Dispatch an agent to write notes for project Y',
                            ].map(s => (
                                <button key={s} onClick={() => setInputText(s)} style={{
                                    padding: '6px 12px', borderRadius: 20, fontSize: 12,
                                    border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.1)',
                                    color: '#94a3b8', cursor: 'pointer', transition: 'all 0.2s',
                                }}>{s}</button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map(msg => (
                    <MessageBubble key={msg.id} message={msg} />
                ))}

                {isProcessing && messages[messages.length - 1]?.role !== 'model' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #1e1e2e, #2d2d44)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🤖</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                            {[0, 1, 2].map(i => (
                                <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', animationDelay: `${i * 0.2}s` }} />
                            ))}
                        </div>
                    </div>
                )}

                <div ref={chatEndRef} />
            </div>

            {/* Error bar */}
            {error && (
                <div style={{
                    margin: '0 16px 8px', padding: '10px 14px', borderRadius: 10,
                    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                    color: '#fca5a5', fontSize: 13, position: 'relative', zIndex: 1,
                }}>
                    ❌ {error}
                    <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
                </div>
            )}

            {/* Input */}
            <div style={{
                position: 'relative', zIndex: 1,
                padding: '12px 16px',
                borderTop: '1px solid rgba(99,102,241,0.15)',
                background: 'rgba(10,10,20,0.9)',
                backdropFilter: 'blur(20px)',
            }}>
                <div style={{
                    display: 'flex', gap: 10, alignItems: 'flex-end',
                    background: 'rgba(30,30,50,0.8)', borderRadius: 14,
                    border: '1px solid rgba(99,102,241,0.3)',
                    padding: '10px 12px',
                    boxShadow: '0 0 30px rgba(99,102,241,0.1)',
                    transition: 'border-color 0.2s',
                }}>
                    <textarea
                        ref={textareaRef}
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a command... (Enter to send, Shift+Enter for newline)"
                        disabled={isProcessing}
                        rows={1}
                        style={{
                            flex: 1, background: 'none', border: 'none', outline: 'none',
                            color: '#e2e8f0', fontSize: 14, resize: 'none', lineHeight: 1.5,
                            maxHeight: 120, overflow: 'auto', fontFamily: 'inherit',
                        }}
                        onInput={e => {
                            const t = e.target as HTMLTextAreaElement;
                            t.style.height = 'auto';
                            t.style.height = Math.min(t.scrollHeight, 120) + 'px';
                        }}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={isProcessing || !inputText.trim()}
                        style={{
                            width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer',
                            background: isProcessing || !inputText.trim()
                                ? 'rgba(99,102,241,0.2)'
                                : 'linear-gradient(135deg, #6366f1, #a855f7)',
                            color: 'white', fontSize: 16, display: 'flex', alignItems: 'center',
                            justifyContent: 'center', transition: 'all 0.2s', flexShrink: 0,
                            boxShadow: !isProcessing && inputText.trim() ? '0 0 20px rgba(99,102,241,0.4)' : 'none',
                        }}
                    >
                        {isProcessing ? '⏳' : '↑'}
                    </button>
                </div>
                <div style={{ textAlign: 'center', fontSize: 11, color: '#334155', marginTop: 6 }}>
                    Powered by Gemini 2.5 Flash · Full Firestore access · {ADMIN_EMAIL}
                </div>
            </div>

            <style>{`
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                ::-webkit-scrollbar { width: 4px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.3); border-radius: 2px; }
            `}</style>
        </div>
    );
};

// ─── Message Bubble Component ─────────────────────────────────────────

const MessageBubble: React.FC<{ message: Message }> = ({ message }) => {
    const isUser = message.role === 'user';

    return (
        <div style={{
            display: 'flex',
            flexDirection: isUser ? 'row-reverse' : 'row',
            alignItems: 'flex-start',
            gap: 10,
        }}>
            {/* Avatar */}
            <div style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: isUser
                    ? 'linear-gradient(135deg, #6366f1, #4f46e5)'
                    : 'linear-gradient(135deg, #1e1e2e, #2d2d44)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14,
                boxShadow: isUser ? '0 0 12px rgba(99,102,241,0.3)' : '0 2px 8px rgba(0,0,0,0.3)',
            }}>
                {isUser ? '👤' : '🤖'}
            </div>

            <div style={{ maxWidth: '80%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Tool calls */}
                {message.toolCalls && message.toolCalls.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {message.toolCalls.map((tc, i) => (
                            <ToolCallCard key={i} toolCall={tc} />
                        ))}
                    </div>
                )}

                {/* Text bubble */}
                {(message.text || message.isStreaming) && (
                    <div style={{
                        padding: '10px 14px',
                        borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                        background: isUser
                            ? 'linear-gradient(135deg, rgba(99,102,241,0.3), rgba(79,70,229,0.3))'
                            : 'rgba(20,20,35,0.8)',
                        border: isUser ? '1px solid rgba(99,102,241,0.4)' : '1px solid rgba(255,255,255,0.06)',
                        backdropFilter: 'blur(10px)',
                        fontSize: 14,
                        lineHeight: 1.6,
                        color: '#e2e8f0',
                        boxShadow: isUser ? '0 0 20px rgba(99,102,241,0.15)' : '0 2px 12px rgba(0,0,0,0.3)',
                    }}>
                        {isUser ? (
                            <span style={{ whiteSpace: 'pre-wrap' }}>{message.text}</span>
                        ) : (
                            <div className="markdown-body" style={{ fontSize: 14 }}>
                                <ReactMarkdown
                                    components={{
                                        p: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
                                        ul: ({ children }) => <ul style={{ margin: '4px 0', paddingLeft: 20 }}>{children}</ul>,
                                        ol: ({ children }) => <ol style={{ margin: '4px 0', paddingLeft: 20 }}>{children}</ol>,
                                        li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
                                        code: ({ children, ...props }: any) => props.inline ? (
                                            <code style={{ background: 'rgba(99,102,241,0.2)', padding: '1px 5px', borderRadius: 4, fontSize: 12, fontFamily: 'monospace' }}>{children}</code>
                                        ) : (
                                            <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '10px 14px', borderRadius: 8, overflowX: 'auto', margin: '8px 0' }}>
                                                <code style={{ fontFamily: 'monospace', fontSize: 12 }}>{children}</code>
                                            </pre>
                                        ),
                                        table: ({ children }) => (
                                            <div style={{ overflowX: 'auto', margin: '8px 0' }}>
                                                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>{children}</table>
                                            </div>
                                        ),
                                        th: ({ children }) => <th style={{ border: '1px solid rgba(99,102,241,0.3)', padding: '6px 10px', background: 'rgba(99,102,241,0.15)', fontWeight: 600, textAlign: 'left' }}>{children}</th>,
                                        td: ({ children }) => <td style={{ border: '1px solid rgba(255,255,255,0.08)', padding: '6px 10px' }}>{children}</td>,
                                        strong: ({ children }) => <strong style={{ color: '#a5b4fc', fontWeight: 600 }}>{children}</strong>,
                                        a: ({ children, href }) => <a href={href} style={{ color: '#818cf8', textDecoration: 'underline' }} target="_blank" rel="noopener noreferrer">{children}</a>,
                                        h1: ({ children }) => <h1 style={{ fontSize: 18, fontWeight: 700, margin: '8px 0 6px', color: '#e2e8f0' }}>{children}</h1>,
                                        h2: ({ children }) => <h2 style={{ fontSize: 16, fontWeight: 700, margin: '8px 0 4px', color: '#e2e8f0' }}>{children}</h2>,
                                        h3: ({ children }) => <h3 style={{ fontSize: 14, fontWeight: 600, margin: '6px 0 4px', color: '#c7d2fe' }}>{children}</h3>,
                                        blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid rgba(99,102,241,0.5)', margin: '4px 0', paddingLeft: 12, color: '#94a3b8' }}>{children}</blockquote>,
                                        hr: () => <hr style={{ border: 'none', borderTop: '1px solid rgba(99,102,241,0.2)', margin: '8px 0' }} />,
                                    }}
                                >
                                    {message.text}
                                </ReactMarkdown>
                                {message.isStreaming && (
                                    <span style={{ display: 'inline-block', width: 10, height: 14, background: '#6366f1', marginLeft: 2, animation: 'pulse 1s infinite', borderRadius: 2, verticalAlign: 'middle' }} />
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Timestamp */}
                <div style={{ fontSize: 10, color: '#334155', paddingLeft: 4, alignSelf: isUser ? 'flex-end' : 'flex-start' }}>
                    {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>
        </div>
    );
};

// ─── Tool Call Card ───────────────────────────────────────────────────

const ToolCallCard: React.FC<{ toolCall: ToolCall }> = ({ toolCall }) => {
    const [expanded, setExpanded] = useState(false);
    const meta = TOOL_META[toolCall.name] || { icon: '⚙️', label: toolCall.name, color: '#6366f1' };

    const resultSummary = (() => {
        if (!toolCall.result) return null;
        const r = toolCall.result;
        if (r.error) return `❌ ${r.error}`;
        if (r.count !== undefined) return `${r.count} result${r.count !== 1 ? 's' : ''}`;
        if (r.success) {
            if (r.taskId) return `✅ Task created: ${r.task?.title || r.taskId}`;
            if (r.noteId) return `✅ Note created: ${r.note?.title || r.noteId}`;
            if (r.projectId) return `✅ Project created: ${r.project?.name || r.projectId}`;
            if (r.assignmentId) return `✅ Agent dispatched (${r.assignmentId.substr(0, 8)}...)`;
            if (r.url) return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>✅ Image generated</span>
                    <img src={r.url} alt="Generated" style={{ height: 24, borderRadius: 4, objectFit: 'cover' }} />
                </div>
            );
            return '✅ Done';
        }
        return null;
    })();

    return (
        <div style={{
            borderRadius: 10,
            border: `1px solid ${meta.color}33`,
            background: `${meta.color}0d`,
            overflow: 'hidden',
            fontSize: 12,
        }}>
            <div
                onClick={() => toolCall.status !== 'running' && setExpanded(!expanded)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 12px', cursor: toolCall.status !== 'running' ? 'pointer' : 'default',
                }}
            >
                {/* Status indicator */}
                {toolCall.status === 'running' ? (
                    <div style={{ width: 14, height: 14, border: `2px solid ${meta.color}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                ) : toolCall.status === 'error' ? (
                    <span style={{ color: '#ef4444' }}>✗</span>
                ) : (
                    <span style={{ color: '#10b981' }}>✓</span>
                )}

                <span style={{ fontSize: 14 }}>{meta.icon}</span>
                <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>

                {/* Args preview */}
                <span style={{ color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {Object.entries(toolCall.args).slice(0, 3).map(([k, v]) => `${k}="${String(v).substring(0, 30)}"`).join(' ')}
                </span>

                {/* Result summary */}
                {resultSummary && (
                    <span style={{ color: '#94a3b8', marginLeft: 'auto', flexShrink: 0 }}>{resultSummary}</span>
                )}

                {toolCall.status !== 'running' && (
                    <span style={{ color: '#475569', fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
                )}
            </div>

            {expanded && toolCall.result && (
                <div style={{ borderTop: `1px solid ${meta.color}22`, padding: '8px 12px' }}>
                    <pre style={{
                        margin: 0, fontSize: 11, color: '#94a3b8',
                        overflowX: 'auto', maxHeight: 200,
                        fontFamily: 'monospace', lineHeight: 1.5,
                    }}>
                        {JSON.stringify(toolCall.result, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
};
