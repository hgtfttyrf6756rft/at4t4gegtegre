import { GoogleGenAI, Type, FunctionDeclaration, Part } from '@google/genai';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { put } from '@vercel/blob';
import { adminApp } from './agentService.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const escapeXml = (unsafe: string) => {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
};

const getBlobToken = () =>
    process.env.BLOB_READ_WRITE_TOKEN_FOR_FRONTEND ||
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.researcher_READ_WRITE_TOKEN ||
    undefined;

/**
 * Send an SMS/MMS via Twilio REST API (for async follow-up messages).
 */
export async function sendTwilioSms(
    to: string,
    from: string,
    body: string,
    mediaUrls?: string[]
): Promise<any> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
        console.error('[sendTwilioSms] Missing Twilio credentials');
        return null;
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const params = new URLSearchParams();
    params.append('To', to);
    params.append('From', from);
    params.append('Body', body);
    if (mediaUrls && mediaUrls.length > 0) {
        console.log(`[sendTwilioSms] Attaching ${mediaUrls.length} MMS media URL(s):`, mediaUrls);
        for (const mediaUrl of mediaUrls) {
            params.append('MediaUrl', mediaUrl);
        }
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    const data = await response.json() as any;
    if (!response.ok) {
        console.error('[sendTwilioSms] Failed:', data);
        throw new Error(data.message || 'Failed to send Twilio SMS');
    }

    console.log(`[sendTwilioSms] Success, SID: ${data.sid}, type: ${mediaUrls?.length ? 'MMS' : 'SMS'}`);
    return data;
}

/**
 * Upload a buffer to Vercel Blob and return the public URL.
 */
async function uploadBufferToBlob(buffer: Buffer, filename: string, contentType: string): Promise<string> {
    const token = getBlobToken();
    const stored = await put(`phone-agent/${filename}`, buffer, {
        access: 'public',
        addRandomSuffix: true,
        token,
        contentType,
    });
    return stored.url;
}

/**
 * Fetch an image from a URL and return it as a base64 data string.
 */
async function fetchImageAsBase64(imageUrl: string): Promise<{ data: string; mimeType: string }> {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    const buffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    const data = Buffer.from(buffer).toString('base64');
    return { data, mimeType };
}

// ─── Tool Declarations ────────────────────────────────────────────────────────

const searchProjectsTool: FunctionDeclaration = {
    name: 'searchProjects',
    description: 'Search across all projects owned by the user. Use this to find a project by name or topic before performing actions.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: { type: Type.STRING, description: 'Search query (project name, topic, keyword)' }
        },
        required: ['query']
    }
};

const getProjectDetailsTool: FunctionDeclaration = {
    name: 'getProjectDetails',
    description: 'Get full details of a specific project including tasks, notes, and file counts.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            projectId: { type: Type.STRING, description: 'The project ID' }
        },
        required: ['projectId']
    }
};

const createProjectTool: FunctionDeclaration = {
    name: 'createProject',
    description: 'Create a new project.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: { type: Type.STRING, description: 'Project name' },
            description: { type: Type.STRING, description: 'Brief description' }
        },
        required: ['name', 'description']
    }
};

const addProjectNoteTool: FunctionDeclaration = {
    name: 'addProjectNote',
    description: 'Add a note to a project. Use searchProjects first if you need the project ID.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            projectId: { type: Type.STRING, description: 'Project ID' },
            title: { type: Type.STRING, description: 'Note title' },
            content: { type: Type.STRING, description: 'Note content' }
        },
        required: ['projectId', 'title', 'content']
    }
};

const addProjectTaskTool: FunctionDeclaration = {
    name: 'addProjectTask',
    description: 'Create a new task in a project. Use searchProjects first if you need the project ID.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            projectId: { type: Type.STRING, description: 'Project ID' },
            title: { type: Type.STRING, description: 'Task title' },
            description: { type: Type.STRING, description: 'Task details' },
            priority: { type: Type.STRING, description: 'Priority level: low, medium, or high' }
        },
        required: ['projectId', 'title']
    }
};

const listProjectTasksTool: FunctionDeclaration = {
    name: 'listProjectTasks',
    description: 'List all tasks in a project.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            projectId: { type: Type.STRING, description: 'Project ID' }
        },
        required: ['projectId']
    }
};

const updateProjectTaskTool: FunctionDeclaration = {
    name: 'updateProjectTask',
    description: 'Update a task status or priority in a project.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            projectId: { type: Type.STRING, description: 'Project ID' },
            taskTitle: { type: Type.STRING, description: 'Title of the task to update' },
            completed: { type: Type.BOOLEAN, description: 'Set to true to mark as done' },
            priority: { type: Type.STRING, description: 'New priority: low, medium, high' }
        },
        required: ['projectId', 'taskTitle']
    }
};

const generateImageTool: FunctionDeclaration = {
    name: 'generateImage',
    description: 'Generate an AI image from a text prompt. The image will be sent back via MMS and optionally saved to a project\'s assets.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            prompt: { type: Type.STRING, description: 'Description of the image to generate' },
            aspectRatio: { type: Type.STRING, description: 'Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4' },
            projectId: { type: Type.STRING, description: 'Optional project ID to save the generated image to that project\'s assets' },
            imageName: { type: Type.STRING, description: 'Optional name for the saved image (e.g. "Product banner")' }
        },
        required: ['prompt']
    }
};

const saveImageToProjectTool: FunctionDeclaration = {
    name: 'saveImageToProject',
    description: 'Save an image (received via MMS or recently generated) to a project\'s knowledge base/assets.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            projectId: { type: Type.STRING, description: 'Project ID to save the image to' },
            imageUrl: { type: Type.STRING, description: 'URL of the image to save' },
            name: { type: Type.STRING, description: 'Name for the saved image' }
        },
        required: ['projectId', 'imageUrl', 'name']
    }
};

const sendEmailTool: FunctionDeclaration = {
    name: 'sendEmail',
    description: 'Send an email via the user\'s connected Gmail or Outlook. Make sure the user has connected their email in the app first.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            provider: { type: Type.STRING, description: 'Email provider: gmail or outlook' },
            to: { type: Type.STRING, description: 'Recipient email address' },
            subject: { type: Type.STRING, description: 'Email subject line' },
            body: { type: Type.STRING, description: 'Email body (plain text or HTML)' }
        },
        required: ['provider', 'to', 'subject', 'body']
    }
};

const postToSocialTool: FunctionDeclaration = {
    name: 'postToSocial',
    description: 'Post content to social media platforms. Requires the user to have connected accounts in the app.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            platforms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Platforms: facebook, instagram, x, tiktok, youtube, linkedin' },
            contentType: { type: Type.STRING, description: 'Content type: text, image, or video' },
            text: { type: Type.STRING, description: 'Caption/text content' },
            mediaUrl: { type: Type.STRING, description: 'URL of media to post (if applicable)' }
        },
        required: ['platforms', 'contentType', 'text']
    }
};

const schedulePostTool: FunctionDeclaration = {
    name: 'schedulePost',
    description: 'Schedule a social media post for later.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            platforms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Platforms to post to' },
            scheduledAt: { type: Type.STRING, description: 'When to post (ISO 8601 or natural language like "tomorrow at 9am")' },
            contentType: { type: Type.STRING, description: 'Content type: text, image, or video' },
            text: { type: Type.STRING, description: 'Caption/text' },
            mediaUrl: { type: Type.STRING, description: 'Media URL if applicable' }
        },
        required: ['platforms', 'scheduledAt', 'contentType', 'text']
    }
};

const getConnectedAccountsTool: FunctionDeclaration = {
    name: 'getConnectedAccounts',
    description: 'Check which social media and email accounts the user has connected.',
    parameters: {
        type: Type.OBJECT,
        properties: {},
        required: []
    }
};

const createStripeProductTool: FunctionDeclaration = {
    name: 'createStripeProduct',
    description: 'Create a Stripe product with a payment link for selling.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: { type: Type.STRING, description: 'Product name' },
            description: { type: Type.STRING, description: 'Product description' },
            price: { type: Type.NUMBER, description: 'Price in dollars' }
        },
        required: ['name', 'price']
    }
};

const saveCapturedLeadTool: FunctionDeclaration = {
    name: 'saveCapturedLead',
    description: 'Saves information collected from the user as a captured lead. Use this once you have collected the required fields.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            data: {
                type: Type.OBJECT,
                description: 'Key-value pairs of collected information (e.g. { "Name": "John", "Email": "john@example.com" })',
                properties: {
                    name: { type: Type.STRING },
                    email: { type: Type.STRING },
                    phone: { type: Type.STRING },
                    notes: { type: Type.STRING }
                }
            }
        },
        required: ['data']
    }
};

const analyzeProjectFileTool: FunctionDeclaration = {
    name: 'analyzeProjectFile',
    description: 'Retrieve and analyze a specific file from a project by name.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            projectId: { type: Type.STRING, description: 'Project ID' },
            fileName: { type: Type.STRING, description: 'Name of the file to analyze' },
            task: { type: Type.STRING, description: 'What to do with the file (summarize, extract key points, etc.)' }
        },
        required: ['projectId', 'fileName']
    }
};

const tools = [{
    functionDeclarations: [
        searchProjectsTool,
        getProjectDetailsTool,
        createProjectTool,
        addProjectNoteTool,
        addProjectTaskTool,
        listProjectTasksTool,
        updateProjectTaskTool,
        generateImageTool,
        saveImageToProjectTool,
        sendEmailTool,
        postToSocialTool,
        schedulePostTool,
        getConnectedAccountsTool,
        createStripeProductTool,
        analyzeProjectFileTool,
    ]
}];

// ─── Response Type ────────────────────────────────────────────────────────────

export interface PhoneAgentResponse {
    text: string;
    mediaUrls?: string[];
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function handleIncomingMessage(
    fromNumber: string,
    toNumber: string,
    message: string,
    incomingMediaUrls?: string[]
): Promise<PhoneAgentResponse> {
    const db = getFirestore(adminApp());

    // 1. Identify user by assigned Twilio number
    const normalizedTo = toNumber.replace(/[^\d+]/g, '');
    console.log(`[phoneAgent] Identifying user for number: ${normalizedTo} (original: ${toNumber})`);

    const usersSnapshot = await db.collection('users')
        .where('agentPhoneNumber', 'in', [toNumber, normalizedTo])
        .get();

    let userDoc = usersSnapshot.empty ? null : usersSnapshot.docs[0];

    // Fallback: search all users if exact match fails (handles cases where DB has spaces etc)
    if (!userDoc) {
        const allUsers = await db.collection('users').get();
        userDoc = allUsers.docs.find(u => {
            const num = u.data().agentPhoneNumber;
            return num && num.replace(/[^\d+]/g, '') === normalizedTo;
        }) || null;
    }

    if (!userDoc) {
        console.warn(`[phoneAgent] Message for unassigned number mapping: ${normalizedTo} (original: ${toNumber})`);
        return { text: "This number is not linked to a registered account." };
    }

    const userData = userDoc.data();
    const uid = userDoc.id;
    console.log(`[phoneAgent] Found user: ${uid} (assigned to ${toNumber})`);

    if (!userData.agentPhoneConfig?.enabled) {
        return { text: "The Phone Agent is currently disabled for this account." };
    }

    const customPrompt = userData.agentPhoneConfig?.systemPrompt || '';
    const defaultProjectId = userData.agentPhoneConfig?.defaultProjectId || null;
    const leadCaptureEnabled = !!userData.agentPhoneConfig?.leadCaptureEnabled;

    // 2. Build context based on mode
    let projectListContext = '';
    let defaultProjectContext = '';
    let activeTools = tools; // Default all tools
    let projectList: { id: string, name: string, description: string }[] = [];

    if (leadCaptureEnabled) {
        // Restricted Lead Capture Mode: No project access for security
        console.log(`[phoneAgent] Lead Capture mode enabled for user ${uid}. Restricting context and tools.`);

        const leadFields = userData.agentPhoneConfig?.leadFields || [];
        const fieldsStr = leadFields.map((f: any) => `${f.name}${f.required ? ' (required)' : ''}`).join(', ');

        projectListContext = leadFields.length > 0
            ? `\nLEAD CAPTURE MODE ACTIVE: Your primary goal is to collect the following information from the caller: ${fieldsStr}. 
               Once you have collected the required information, call the 'saveCapturedLead' tool to save the data. 
               DO NOT share any internal project data or user information with the caller.`
            : '\nLEAD CAPTURE MODE ACTIVE. Please engage with the user as per your custom instructions.';

        // Use ONLY saveCapturedLead tool
        activeTools = [{
            functionDeclarations: [saveCapturedLeadTool]
        }];
    } else {
        // Normal Personal Assistant Mode: Full context
        const projectsSnapshot = await db.collection('users').doc(uid).collection('projects')
            .orderBy('lastModified', 'desc').limit(20).get();
        projectList = projectsSnapshot.docs.map(d => {
            const data = d.data();
            return { id: d.id, name: data.name, description: data.description?.substring(0, 80) || '' };
        });

        projectListContext = projectList.length > 0
            ? `\nUSER'S PROJECTS (${projectList.length} total):\n${projectList.map((p, i) => `${i + 1}. "${p.name}" (ID: ${p.id})${p.description ? ` - ${p.description}` : ''}`).join('\n')}\n`
            : '\nThe user has no projects yet.\n';

        defaultProjectContext = defaultProjectId
            ? `\nDEFAULT PROJECT: ID "${defaultProjectId}". Use this project when the user doesn't specify which project.\n`
            : '';

        // Add basic user profile info
        const userProfileInfo = `\nUSER PROFILE: ${userData.displayName || 'Unnamed User'}${userData.description ? ` - ${userData.description}` : ''}\n`;
        projectListContext = userProfileInfo + projectListContext;
    }

    // 3. Build system instruction
    let systemInstruction = `You are an AI assistant communicating via SMS/MMS text messages. Keep responses concise, friendly, and easy to read on a phone screen. Use emoji sparingly for clarity.\n\n`;

    if (customPrompt) {
        systemInstruction += `USER'S CUSTOM INSTRUCTIONS: ${customPrompt}\n`;
    }

    if (leadCaptureEnabled) {
        systemInstruction += `${projectListContext}

CAPABILITIES:
- Capture leads: collect information and save it

ROUTING RULES:
1. Lead Capture is ACTIVE. Only collect info and save leads. Do not mention other capabilities.

SMS FORMATTING:
- Keep replies under 300 characters.
- Use line breaks for readability.`;
    } else {
        systemInstruction += `${projectListContext}
${defaultProjectContext}

CAPABILITIES:
- Project management: search, create, view details, add notes, add/list/update tasks
- AI image generation: generate images and send via MMS
- Save images to projects
- Social media: post to facebook, instagram, x, tiktok, youtube, linkedin (if connected)
- Schedule social posts for later
- Send emails via Gmail or Outlook (if connected)
- Create Stripe products with payment links
- Analyze project files

ROUTING RULES:
1. Normal Assistant Mode is ACTIVE. Help the user manage their projects and accounts.
2. When the user mentions a project by name, use searchProjects to find the matching project ID
3. If ambiguous, ask the user which project they mean
4. Always confirm destructive actions before proceeding
5. IMAGE GENERATION (Normal Mode Only): When asked to generate an image:
   a. ALWAYS find or create a project to save it to BEFORE calling generateImage
   b. ALWAYS include the image URL in your text reply as a fallback for MMS

SMS FORMATTING:
- Keep responses under 300 characters when possible
- Use line breaks for readability
- For lists, use simple numbering (1. 2. 3.)
- When sharing links, put them on their own line`;
    }

    // 4. Load conversation history
    const historyRef = userDoc.ref.collection('phoneAgentHistory')
        .orderBy('timestamp', 'asc').limit(30);
    const historySnapshot = await historyRef.get();

    // Sanitize history: merge consecutive same-role messages
    const rawHistory = historySnapshot.docs.map(doc => doc.data());
    const contents: any[] = [];
    let lastRole = '';

    for (const entry of rawHistory) {
        const text = (entry.text || '').trim();
        if (!text && entry.role === 'model') continue;

        if (entry.role === lastRole && contents.length > 0) {
            contents[contents.length - 1].parts[0].text += `\n${text}`;
        } else {
            contents.push({
                role: entry.role,
                parts: [{ text: text || ' ' }]
            });
            lastRole = entry.role;
        }
    }

    // 5. Build current user message with media context
    let userMessageText = message;

    if (incomingMediaUrls && incomingMediaUrls.length > 0) {
        userMessageText += `\n\n[User sent ${incomingMediaUrls.length} image(s) via MMS]`;
    }

    contents.push({ role: 'user', parts: [{ text: userMessageText }] });

    // Store user message in history
    await userDoc.ref.collection('phoneAgentHistory').doc().set({
        role: 'user',
        text: userMessageText,
        mediaUrls: incomingMediaUrls || [],
        timestamp: Date.now()
    });

    // Select tools based on lead capture mode
    activeTools = leadCaptureEnabled
        ? [{ functionDeclarations: [saveCapturedLeadTool] }]
        : tools;

    // 6. Track state for the conversation turn
    let lastGeneratedImageUrl: string | null = null;
    let lastIncomingMediaUrl = incomingMediaUrls?.[0] || null;
    const responseMediaUrls: string[] = [];

    const MODEL = 'gemini-3.1-flash-lite-preview';

    try {
        const chat = ai.chats.create({
            model: MODEL,
            config: {
                systemInstruction,
                tools: activeTools,
                temperature: 0.7,
                thinkingConfig: {
                    thinkingBudget: -1, // Dynamic thinking — SDK handles thought signatures automatically
                },
            },
            history: contents.slice(0, -1)
        });

        // Build the user message parts (text + optional inline image)
        const messageParts: Part[] = [{ text: message }];

        // If user sent an MMS image, include it inline for Gemini to see
        if (lastIncomingMediaUrl) {
            try {
                const { data, mimeType } = await fetchImageAsBase64(lastIncomingMediaUrl);
                messageParts.push({
                    inlineData: { mimeType, data }
                });
                messageParts.push({ text: '(The user attached this image via MMS. Describe it or act on it as requested.)' });
            } catch (e) {
                console.warn('[phoneAgent] Failed to fetch MMS image:', e);
                messageParts.push({ text: '(User tried to send an image but it could not be loaded.)' });
            }
        }

        let response = await chat.sendMessage({ message: messageParts });

        // Handle tool calls iteratively (max 10 rounds to prevent infinite loops)
        let rounds = 0;
        while (response.functionCalls && response.functionCalls.length > 0 && rounds < 10) {
            rounds++;
            const toolCall = response.functionCalls[0];
            const functionName = toolCall.name;
            const args = toolCall.args || {};

            let toolResult: any = {};

            console.log(`[phoneAgent] Tool: ${functionName}`, JSON.stringify(args).substring(0, 200));

            try {
                // ── Project Management Tools ──
                if (functionName === 'searchProjects') {
                    const query = (args.query as string || '').toLowerCase();
                    const matches = projectList.filter(p =>
                        p.name.toLowerCase().includes(query) ||
                        p.description.toLowerCase().includes(query)
                    );
                    if (matches.length === 0) {
                        toolResult = { results: [], message: 'No matching projects found' };
                    } else {
                        toolResult = { results: matches, message: `Found ${matches.length} project(s)` };
                    }
                }
                else if (functionName === 'getProjectDetails') {
                    const projDoc = await db.collection('users').doc(uid)
                        .collection('projects').doc(args.projectId as string).get();
                    if (projDoc.exists) {
                        const data = projDoc.data()!;
                        toolResult = {
                            id: projDoc.id,
                            name: data.name,
                            description: data.description,
                            tasks: (data.tasks || []).slice(0, 10),
                            notes: (data.notes || []).map((n: any) => ({ title: n.title, preview: n.content?.substring(0, 50) })).slice(0, 10),
                            taskCount: (data.tasks || []).length,
                            noteCount: (data.notes || []).length,
                            fileCount: (data.uploadedFiles || []).length,
                        };
                    } else {
                        toolResult = { error: 'Project not found' };
                    }
                }
                else if (functionName === 'createProject') {
                    const newProjRef = db.collection('users').doc(uid).collection('projects').doc();
                    const now = Date.now();
                    await newProjRef.set({
                        id: newProjRef.id,
                        name: args.name,
                        description: args.description,
                        createdAt: now,
                        lastModified: now,
                        ownerUid: uid,
                        tasks: [],
                        notes: [],
                    });
                    toolResult = { success: true, projectId: newProjRef.id, name: args.name };
                }
                // ── Notes ──
                else if (functionName === 'addProjectNote') {
                    const projRef = db.collection('users').doc(uid)
                        .collection('projects').doc(args.projectId as string);
                    const projDoc = await projRef.get();
                    if (projDoc.exists) {
                        const notes = projDoc.data()?.notes || [];
                        notes.push({
                            id: crypto.randomUUID(),
                            title: args.title,
                            content: args.content,
                            createdAt: Date.now(),
                            lastModified: Date.now()
                        });
                        await projRef.update({ notes, lastModified: Date.now() });
                        toolResult = { success: true, message: `Note "${args.title}" added` };
                    } else {
                        toolResult = { error: 'Project not found' };
                    }
                }
                // ── Tasks ──
                else if (functionName === 'addProjectTask') {
                    const projRef = db.collection('users').doc(uid)
                        .collection('projects').doc(args.projectId as string);
                    const projDoc = await projRef.get();
                    if (projDoc.exists) {
                        const tasks = projDoc.data()?.tasks || [];
                        tasks.push({
                            id: crypto.randomUUID(),
                            title: args.title,
                            description: args.description || '',
                            priority: args.priority || 'medium',
                            completed: false,
                            createdAt: Date.now(),
                        });
                        await projRef.update({ tasks, lastModified: Date.now() });
                        toolResult = { success: true, message: `Task "${args.title}" added` };
                    } else {
                        toolResult = { error: 'Project not found' };
                    }
                }
                else if (functionName === 'listProjectTasks') {
                    const projDoc = await db.collection('users').doc(uid)
                        .collection('projects').doc(args.projectId as string).get();
                    if (projDoc.exists) {
                        const tasks = projDoc.data()?.tasks || [];
                        toolResult = {
                            tasks: tasks.map((t: any, i: number) => ({
                                index: i + 1,
                                title: t.title,
                                priority: t.priority || 'medium',
                                completed: !!t.completed,
                            })),
                            total: tasks.length
                        };
                    } else {
                        toolResult = { error: 'Project not found' };
                    }
                }
                else if (functionName === 'updateProjectTask') {
                    const projRef = db.collection('users').doc(uid)
                        .collection('projects').doc(args.projectId as string);
                    const projDoc = await projRef.get();
                    if (projDoc.exists) {
                        const tasks = projDoc.data()?.tasks || [];
                        const taskTitle = (args.taskTitle as string || '').toLowerCase();
                        const taskIndex = tasks.findIndex((t: any) =>
                            t.title.toLowerCase().includes(taskTitle)
                        );
                        if (taskIndex >= 0) {
                            if (args.completed !== undefined) tasks[taskIndex].completed = args.completed;
                            if (args.priority) tasks[taskIndex].priority = args.priority;
                            tasks[taskIndex].lastModified = Date.now();
                            await projRef.update({ tasks, lastModified: Date.now() });
                            toolResult = { success: true, message: `Task "${tasks[taskIndex].title}" updated` };
                        } else {
                            toolResult = { error: `No task matching "${args.taskTitle}" found` };
                        }
                    } else {
                        toolResult = { error: 'Project not found' };
                    }
                }
                // ── Image Generation ──
                else if (functionName === 'generateImage') {
                    // Use gemini-3.1-flash-image-preview for native image generation
                    const imageAi = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
                    const imageResponse = await imageAi.models.generateContent({
                        model: 'gemini-3.1-flash-image-preview',
                        contents: [{ role: 'user', parts: [{ text: args.prompt as string }] }],
                        config: {
                            responseModalities: ['IMAGE', 'TEXT'],
                        } as any,
                    });

                    // Find the image part (skip thought parts)
                    const imagePart = imageResponse.candidates?.[0]?.content?.parts?.find(
                        (p: any) => p.inlineData?.mimeType?.startsWith('image/') && !p.thought
                    );

                    if (imagePart?.inlineData) {
                        const buffer = Buffer.from(imagePart.inlineData.data!, 'base64');
                        const mimeType = imagePart.inlineData.mimeType!;
                        const ext = mimeType === 'image/png' ? 'png' : 'jpg';
                        const blobUrl = await uploadBufferToBlob(buffer, `gen-${Date.now()}.${ext}`, mimeType);
                        lastGeneratedImageUrl = blobUrl;
                        responseMediaUrls.push(blobUrl);

                        // Auto-save to project assets
                        const genProjectId = args.projectId as string | undefined;
                        const imageName = (args.imageName as string) || `AI Image - ${new Date().toLocaleDateString()}`;

                        const saveImageToProject = async (projectId: string) => {
                            try {
                                const projRef = db.collection('users').doc(uid)
                                    .collection('projects').doc(projectId);
                                const projDoc = await projRef.get();
                                if (projDoc.exists) {
                                    const knowledgeBase = projDoc.data()?.knowledgeBase || [];
                                    knowledgeBase.push({
                                        id: crypto.randomUUID(),
                                        name: imageName,
                                        displayName: imageName,
                                        type: mimeType,
                                        mimeType,
                                        url: blobUrl,
                                        source: 'phone-agent-generated',
                                        createdAt: Date.now(),
                                    });
                                    await projRef.update({ knowledgeBase, lastModified: Date.now() });
                                    return true;
                                }
                            } catch (saveErr: any) {
                                console.warn('[phoneAgent] Failed to save image to project:', saveErr.message);
                            }
                            return false;
                        };

                        if (genProjectId) {
                            const saved = await saveImageToProject(genProjectId);
                            toolResult = {
                                success: true,
                                imageUrl: blobUrl,
                                savedToProject: saved,
                                message: saved
                                    ? `Image generated and saved to project. URL: ${blobUrl}`
                                    : `Image generated (could not save to project). URL: ${blobUrl}`
                            };
                        } else if (defaultProjectId) {
                            // Fall back to user's default project
                            const saved = await saveImageToProject(defaultProjectId);
                            toolResult = {
                                success: true,
                                imageUrl: blobUrl,
                                savedToProject: saved,
                                message: `Image generated and saved to your default project. URL: ${blobUrl}`
                            };
                        } else {
                            // No project at all: auto-create one based on the prompt
                            try {
                                const newProjRef = db.collection('users').doc(uid).collection('projects').doc();
                                const now = Date.now();
                                const projectName = `Images - ${new Date().toLocaleDateString()}`;
                                const projectDescription = `Auto-created from phone agent image generation. Prompt: "${(args.prompt as string).substring(0, 80)}"`;
                                await newProjRef.set({
                                    id: newProjRef.id,
                                    name: projectName,
                                    description: projectDescription,
                                    createdAt: now,
                                    lastModified: now,
                                    ownerUid: uid,
                                    tasks: [],
                                    notes: [],
                                    knowledgeBase: [{
                                        id: crypto.randomUUID(),
                                        name: imageName,
                                        displayName: imageName,
                                        type: mimeType,
                                        mimeType,
                                        url: blobUrl,
                                        source: 'phone-agent-generated',
                                        createdAt: now,
                                    }],
                                });
                                toolResult = {
                                    success: true,
                                    imageUrl: blobUrl,
                                    savedToProject: true,
                                    newProjectId: newProjRef.id,
                                    newProjectName: projectName,
                                    message: `Image generated and saved to new project "${projectName}". URL: ${blobUrl}`
                                };
                            } catch (createErr: any) {
                                console.warn('[phoneAgent] Could not auto-create project:', createErr.message);
                                toolResult = { success: true, imageUrl: blobUrl, savedToProject: false, message: `Image generated. URL: ${blobUrl}` };
                            }
                        }
                    } else {
                        toolResult = { error: 'Failed to generate image. The model did not return an image.' };
                    }
                }
                // ── Save Image to Project ──
                else if (functionName === 'saveImageToProject') {
                    const imageUrl = args.imageUrl as string || lastGeneratedImageUrl || lastIncomingMediaUrl;
                    if (!imageUrl) {
                        toolResult = { error: 'No image available to save' };
                    } else {
                        const projRef = db.collection('users').doc(uid)
                            .collection('projects').doc(args.projectId as string);
                        const projDoc = await projRef.get();
                        if (projDoc.exists) {
                            const knowledgeBase = projDoc.data()?.knowledgeBase || [];
                            knowledgeBase.push({
                                id: crypto.randomUUID(),
                                name: args.name || 'Phone Agent Image',
                                type: 'image/jpeg',
                                url: imageUrl,
                                source: 'phone-agent',
                                createdAt: Date.now(),
                            });
                            await projRef.update({ knowledgeBase, lastModified: Date.now() });
                            toolResult = { success: true, message: `Image saved to project as "${args.name}"` };
                        } else {
                            toolResult = { error: 'Project not found' };
                        }
                    }
                }
                // ── Email ──
                else if (functionName === 'sendEmail') {
                    // Use the app's internal email API endpoint
                    // The phone agent runs server-side, so we call the email service directly via internal fetch
                    const appUrl = process.env.VERCEL_URL
                        ? `https://${process.env.VERCEL_URL}`
                        : process.env.APP_URL || 'http://localhost:3000';

                    // Get user's ID token is not available server-side, so we use admin approach
                    // Store email config in user doc and call email API with uid context
                    const emailRes = await fetch(`${appUrl}/api/email?op=send-admin`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            uid,
                            provider: args.provider,
                            to: args.to,
                            subject: args.subject,
                            body: args.body,
                        })
                    });

                    if (emailRes.ok) {
                        toolResult = { success: true, message: `Email sent to ${args.to}` };
                    } else {
                        const errText = await emailRes.text();
                        toolResult = { error: `Failed to send email: ${errText}` };
                    }
                }
                // ── Social Posting ──
                else if (functionName === 'postToSocial') {
                    const platforms = args.platforms as string[] || [];
                    const results: string[] = [];

                    for (const platform of platforms) {
                        try {
                            const appUrl = process.env.VERCEL_URL
                                ? `https://${process.env.VERCEL_URL}`
                                : process.env.APP_URL || 'http://localhost:3000';

                            const res = await fetch(`${appUrl}/api/social?op=post-admin`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    uid,
                                    platform,
                                    contentType: args.contentType,
                                    text: args.text || '',
                                    mediaUrl: args.mediaUrl || lastGeneratedImageUrl || undefined,
                                })
                            });

                            if (res.ok) {
                                results.push(`✅ ${platform}: Posted`);
                            } else {
                                const errData = await res.json().catch(() => ({}));
                                results.push(`❌ ${platform}: ${(errData as any).error || 'Failed'}`);
                            }
                        } catch (e: any) {
                            results.push(`❌ ${platform}: ${e.message}`);
                        }
                    }

                    toolResult = { results, message: results.join('\n') };
                }
                // ── Schedule Post ──
                else if (functionName === 'schedulePost') {
                    const appUrl = process.env.VERCEL_URL
                        ? `https://${process.env.VERCEL_URL}`
                        : process.env.APP_URL || 'http://localhost:3000';

                    const res = await fetch(`${appUrl}/api/social?op=schedule-create`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: uid,
                            platforms: args.platforms,
                            textContent: args.text || '',
                            mediaUrl: args.mediaUrl || lastGeneratedImageUrl || null,
                            mediaType: args.contentType !== 'text' ? args.contentType : null,
                            scheduledAt: new Date(args.scheduledAt as string).getTime() || Date.now() + 3600000,
                            status: 'pending',
                        })
                    });

                    if (res.ok) {
                        toolResult = { success: true, message: `Post scheduled for ${args.scheduledAt}` };
                    } else {
                        toolResult = { error: 'Failed to schedule post' };
                    }
                }
                // ── Connected Accounts ──
                else if (functionName === 'getConnectedAccounts') {
                    const userD = userData;
                    const connected: string[] = [];

                    if (userD.facebookAccessToken) connected.push('Facebook');
                    if (userD.instagramConnected) connected.push('Instagram');
                    if (userD.xConnected) connected.push('X (Twitter)');
                    if (userD.tiktokAccessToken) connected.push('TikTok');
                    if (userD.youtubeConnected) connected.push('YouTube');
                    if (userD.linkedinAccessToken) connected.push('LinkedIn');
                    if (userD.gmailConnected) connected.push('Gmail');
                    if (userD.outlookConnected) connected.push('Outlook');
                    if (userD.stripeAccountId) connected.push('Stripe');

                    toolResult = {
                        connectedAccounts: connected,
                        message: connected.length > 0
                            ? `Connected: ${connected.join(', ')}`
                            : 'No accounts connected. Connect accounts in the app first.'
                    };
                }
                // ── Stripe Product ──
                else if (functionName === 'createStripeProduct') {
                    const appUrl = process.env.VERCEL_URL
                        ? `https://${process.env.VERCEL_URL}`
                        : process.env.APP_URL || 'http://localhost:3000';

                    const res = await fetch(`${appUrl}/api/billing?op=create-product`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            uid,
                            name: args.name,
                            description: args.description || '',
                            price: args.price,
                        })
                    });

                    if (res.ok) {
                        const data = await res.json();
                        toolResult = { success: true, paymentLink: (data as any).paymentLink, message: `Product "${args.name}" created!` };
                    } else {
                        toolResult = { error: 'Failed to create Stripe product. Make sure Stripe is connected in the app.' };
                    }
                }
                // ── Analyze Project File ──
                else if (functionName === 'analyzeProjectFile') {
                    const projDoc = await db.collection('users').doc(uid)
                        .collection('projects').doc(args.projectId as string).get();
                    if (!projDoc.exists) {
                        toolResult = { error: 'Project not found' };
                    } else {
                        const data = projDoc.data()!;
                        const files = [...(data.uploadedFiles || []), ...(data.knowledgeBase || [])];
                        const fileName = (args.fileName as string || '').toLowerCase();
                        const match = files.find((f: any) =>
                            (f.displayName || f.name || '').toLowerCase().includes(fileName)
                        );

                        if (match) {
                            // For text-based analysis, provide file metadata
                            toolResult = {
                                fileName: match.displayName || match.name,
                                type: match.mimeType || match.type || 'unknown',
                                url: match.uri || match.url,
                                message: `Found file "${match.displayName || match.name}". The file is a ${match.mimeType || match.type || 'unknown'} file.`
                            };
                        } else {
                            const availableFiles = files.map((f: any) => f.displayName || f.name).filter(Boolean).slice(0, 10);
                            toolResult = {
                                error: `File "${args.fileName}" not found.`,
                                availableFiles,
                                message: availableFiles.length > 0
                                    ? `Available files: ${availableFiles.join(', ')}`
                                    : 'No files in this project.'
                            };
                        }
                    }
                }
                // ── Save Lead (for Lead Capture Mode) ──
                else if (functionName === 'saveCapturedLead') {
                    console.log(`[phoneAgent] Saving Lead for user ${uid}:`, args.data);
                    await db.collection('users').doc(uid).collection('phoneAgentLeads').add({
                        callerNumber: fromNumber,
                        data: (args.data as any),
                        agentInstructions: customPrompt,
                        timestamp: Date.now()
                    });
                    toolResult = { success: true, message: 'Lead captured successfully' };
                }
                else {
                    toolResult = { error: `Unknown tool: ${functionName}` };
                }
            } catch (toolError: any) {
                console.error(`[phoneAgent] Tool error (${functionName}):`, toolError);
                toolResult = { error: `Tool failed: ${toolError.message}` };
            }

            // Send tool response back to the model
            // NOTE: response.response must be a plain object (never an array — Gemini will reject it)
            response = await chat.sendMessage({
                message: [{
                    functionResponse: {
                        name: functionName,
                        response: { output: Array.isArray(toolResult) ? { items: toolResult } : toolResult }
                    }
                }]
            });
        }

        let finalReply = response.text || "Done! Let me know if you need anything else.";

        // Always append image URL(s) to message text as SMS fallback (in case MMS doesn't come through)
        if (responseMediaUrls.length > 0) {
            const urlList = responseMediaUrls.join('\n');
            // Only append if not already in the reply
            if (!finalReply.includes(responseMediaUrls[0])) {
                finalReply += `\n\n🖼️ Image link:\n${urlList}`;
            }
        }

        // Store agent reply in history
        await userDoc.ref.collection('phoneAgentHistory').doc().set({
            role: 'model',
            text: finalReply,
            mediaUrls: responseMediaUrls,
            timestamp: Date.now()
        });

        return {
            text: finalReply,
            mediaUrls: responseMediaUrls.length > 0 ? responseMediaUrls : undefined
        };

    } catch (e: any) {
        console.error('[phoneAgent] Gemini error:', e);
        return { text: "Sorry, I encountered an error processing your request. Please try again." };
    }
}

// ─── Twilio Number Management ─────────────────────────────────────────────────

export async function searchTwilioNumbers(areaCode?: string) {
    console.log('[searchTwilioNumbers] Starting, areaCode:', areaCode);
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
        console.error('[searchTwilioNumbers] Missing credentials:', { hasSid: !!accountSid, hasToken: !!authToken });
        throw new Error("Missing Twilio credentials in environment");
    }

    async function fetchNumbers(country: string) {
        let url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/AvailablePhoneNumbers/${country}/Local.json?SmsEnabled=true&VoiceEnabled=true`;
        if (areaCode) {
            url += `&AreaCode=${areaCode}`;
        }
        const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
        const response = await fetch(url, { headers: { 'Authorization': `Basic ${auth}` } });
        if (!response.ok) return [];
        const data = await response.json();
        return data.available_phone_numbers || [];
    }

    let numbers = await fetchNumbers('US');
    if (numbers.length === 0) {
        console.log('[searchTwilioNumbers] No US results, trying CA...');
        numbers = await fetchNumbers('CA');
    }

    console.log('[searchTwilioNumbers] Found', numbers.length, 'numbers');
    return numbers;
}

export async function buyTwilioNumber(phoneNumber: string, appUrl: string, voiceUrl?: string) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) throw new Error("Missing Twilio credentials in environment");

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    // Configure the webhook url
    const agentUrl = `${appUrl}/api/agent?op=webhook`;
    const globalVoiceUrl = process.env.VOICE_SERVER_URL ? `${process.env.VOICE_SERVER_URL}/twiml` : undefined;
    const finalVoiceUrl = voiceUrl || globalVoiceUrl || agentUrl;

    const body = new URLSearchParams();
    body.append('PhoneNumber', phoneNumber);
    body.append('SmsUrl', agentUrl);
    body.append('SmsMethod', 'POST');
    body.append('VoiceUrl', finalVoiceUrl);
    body.append('VoiceMethod', 'POST');

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Twilio Provisioning API Error: ${text}`);
    }

    const data = await response.json();
    return data.phone_number;
}
