import { GoogleGenAI } from "@google/genai";
import { generateImage, refineWebsiteCode } from "../services/geminiService";
import { runDeployPipeline } from "../services/agentService";
import admin from 'firebase-admin';
import { put } from '@vercel/blob';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
    let credential = undefined;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (projectId && clientEmail && privateKey) {
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
            try {
                const decoded = Buffer.from(privateKey, 'base64').toString('utf8');
                if (decoded.includes('-----BEGIN PRIVATE KEY-----')) { privateKey = decoded; }
            } catch (e) {
                console.warn('Failed to decode base64 FIREBASE_PRIVATE_KEY');
            }
        }
        privateKey = privateKey.replace(/\\n/g, '\n');
        credential = admin.credential.cert({ projectId, clientEmail, privateKey });
    }
    admin.initializeApp({
        credential,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'roist-7ab64.appspot.com',
    });
}

const db = admin.firestore();

// ─── Types ───────────────────────────────────────────────────────────

interface TaskPlanStep {
    step: number;
    action: string;
    status: 'pending' | 'running' | 'done' | 'failed';
    result?: string;
}

// ─── Main Handler ────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const idToken = authHeader.split('Bearer ')[1];

        let isAdmin = false;
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            if (decodedToken.email === 'contact.mngrm@gmail.com') isAdmin = true;
        } catch (e) { /* cron secret fallback */ }

        if (!isAdmin && process.env.CRON_SECRET !== idToken) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        // Process GET requests for searching the ecosystem
        if (req.method === 'GET') {
            const { type, q, userId, status, priority } = req.query;
            const searchQuery = (q || '').toLowerCase().trim();

            let results: any[] = [];
            switch (type) {
                case 'users':
                    results = await searchUsers(searchQuery);
                    break;
                case 'projects':
                    results = await searchProjects(searchQuery, userId);
                    break;
                case 'tasks':
                    results = await searchTasks(searchQuery, userId, status, priority);
                    break;
                case 'notes':
                    results = await searchNotes(searchQuery, userId);
                    break;
                default:
                    return res.status(400).json({ message: 'Invalid type. Use: users, projects, tasks, notes' });
            }
            return res.status(200).json({ type, count: results.length, results });
        }

        // Process POST requests (background worker processing)
        // Find a pending or stalled assignment
        const assignmentsRef = db.collection('agent_assignments');
        const snapshot = await assignmentsRef
            .where('status', 'in', ['pending', 'planning', 'running'])
            .orderBy('updatedAt', 'asc')
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(200).json({ message: 'No pending assignments' });
        }

        const docSnapshot = snapshot.docs[0];
        const assignmentId = docSnapshot.id;
        const assignment = docSnapshot.data();

        // Check if running but stalled (no heartbeat for 2 min)
        if (assignment.status === 'running') {
            const heartbeatAge = Date.now() - (assignment.lastHeartbeatAt || 0);
            if (heartbeatAge < 120000) {
                return res.status(200).json({ message: 'Assignment still actively running.' });
            }
            console.log(`[Worker] Picking up stalled assignment ${assignmentId}...`);
        }

        // Mark as running
        await docSnapshot.ref.update({
            status: 'running',
            updatedAt: Date.now(),
            lastHeartbeatAt: Date.now()
        });

        // Await assignment step to ensure Vercel doesn't kill the serverless function early
        const result = await processAssignment(assignmentId, assignment);

        return res.status(200).json({ message: 'Assignment step processed', id: assignmentId, status: result });

    } catch (error: any) {
        console.error('Error in agent worker:', error);
        return res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
}

// ─── Logging ─────────────────────────────────────────────────────────

async function logStep(assignmentId: string, step: string, message: string, status: 'info' | 'success' | 'warning' | 'error' = 'info') {
    await db.collection('agent_logs').add({
        assignmentId,
        step,
        message,
        status,
        timestamp: Date.now()
    });
}

// ─── Heartbeat ───────────────────────────────────────────────────────

function startHeartbeat(assignmentRef: admin.firestore.DocumentReference) {
    return setInterval(async () => {
        try { await assignmentRef.update({ lastHeartbeatAt: Date.now() }); } catch (e) { }
    }, 30000);
}

// ─── Cross-Database Search Functions ─────────────────────────────────

async function searchUsers(query: string) {
    const snapshot = await db.collection('users').limit(500).get();
    const results: any[] = [];
    const q = query.toLowerCase();
    snapshot.forEach((doc) => {
        const data = doc.data();
        const name = (data.displayName || '').toLowerCase();
        const email = (data.email || '').toLowerCase();
        if (!q || name.includes(q) || email.includes(q)) {
            results.push({ uid: doc.id, email: data.email, displayName: data.displayName });
        }
    });
    return results.slice(0, 30);
}

async function searchProjects(query: string, userId?: string) {
    let snapshot;
    if (userId) {
        snapshot = await db.collection('users').doc(userId).collection('projects').limit(200).get();
    } else {
        snapshot = await db.collectionGroup('projects').limit(500).get();
    }
    const results: any[] = [];
    const q = query.toLowerCase();
    snapshot.forEach((doc) => {
        const data = doc.data();
        const name = (data.name || '').toLowerCase();
        const desc = (data.description || '').toLowerCase();
        if (!q || name.includes(q) || desc.includes(q)) {
            const pathParts = doc.ref.path.split('/');
            const ownerUid = pathParts.length >= 2 ? pathParts[1] : data.ownerUid || 'unknown';
            results.push({
                id: doc.id, name: data.name, ownerUid,
                description: (data.description || '').substring(0, 300),
                taskCount: (data.tasks || []).length,
                noteCount: (data.notes || []).length,
            });
        }
    });
    return results.slice(0, 30);
}

async function searchTasks(query: string, userId?: string, statusFilter?: string, priorityFilter?: string) {
    let snapshot;
    if (userId) {
        snapshot = await db.collection('users').doc(userId).collection('projects').limit(200).get();
    } else {
        snapshot = await db.collectionGroup('projects').limit(500).get();
    }
    const results: any[] = [];
    const q = query.toLowerCase();
    snapshot.forEach((doc) => {
        const data = doc.data();
        const pathParts = doc.ref.path.split('/');
        const ownerUid = pathParts.length >= 2 ? pathParts[1] : 'unknown';
        for (const task of (data.tasks || [])) {
            const title = (task.title || '').toLowerCase();
            const desc = (task.description || '').toLowerCase();
            const matchQ = !q || title.includes(q) || desc.includes(q);
            const matchS = !statusFilter || task.status === statusFilter;
            const matchP = !priorityFilter || task.priority === priorityFilter;
            if (matchQ && matchS && matchP) {
                results.push({
                    taskId: task.id, title: task.title, status: task.status, priority: task.priority,
                    projectId: doc.id, projectName: data.name, ownerUid,
                });
            }
        }
    });
    return results.slice(0, 50);
}

async function searchNotes(query: string, userId?: string) {
    let snapshot;
    if (userId) {
        snapshot = await db.collection('users').doc(userId).collection('projects').limit(200).get();
    } else {
        snapshot = await db.collectionGroup('projects').limit(500).get();
    }
    const results: any[] = [];
    const q = query.toLowerCase();
    snapshot.forEach((doc) => {
        const data = doc.data();
        const pathParts = doc.ref.path.split('/');
        const ownerUid = pathParts.length >= 2 ? pathParts[1] : 'unknown';
        for (const note of (data.notes || [])) {
            const title = (note.title || '').toLowerCase();
            const content = (note.content || '').toLowerCase();
            if (!q || title.includes(q) || content.includes(q)) {
                results.push({
                    noteId: note.id, title: note.title, projectId: doc.id,
                    projectName: data.name, ownerUid,
                    contentPreview: (note.content || '').substring(0, 200),
                });
            }
        }
    });
    return results.slice(0, 50);
}

async function readProjectDetails(userId: string, projectId: string) {
    const projectRef = db.collection('users').doc(userId).collection('projects').doc(projectId);
    const doc = await projectRef.get();
    if (!doc.exists) return null;
    const data = doc.data()!;
    return {
        id: doc.id,
        name: data.name,
        description: data.description,
        tasks: (data.tasks || []).map((t: any) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, description: t.description })),
        notes: (data.notes || []).map((n: any) => ({ id: n.id, title: n.title, content: (n.content || '').substring(0, 500) })),
        assetCount: (data.researchSessions || []).reduce((c: number, s: any) => c + (s.assets?.length || 0), 0),
    };
}

// ─── Tool Definitions for Sub-Agent ──────────────────────────────────

const TOOL_DECLARATIONS = [
    {
        name: "search_users",
        description: "Search all users in the ecosystem by name or email. Returns uid, email, displayName.",
        parameters: {
            type: "object",
            properties: { query: { type: "string", description: "Search term for name or email" } },
            required: ["query"]
        }
    },
    {
        name: "search_projects",
        description: "Search all projects across all users by name or description. Optionally filter by userId.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search term for project name/description" },
                userId: { type: "string", description: "Optional: filter to this user's projects only" }
            },
            required: ["query"]
        }
    },
    {
        name: "search_tasks",
        description: "Search all tasks across all projects by title or description. Optionally filter by status or priority.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search term for task title/description" },
                userId: { type: "string", description: "Optional: filter to this user's projects" },
                status: { type: "string", enum: ["todo", "in_progress", "done"] },
                priority: { type: "string", enum: ["low", "medium", "high"] }
            },
            required: ["query"]
        }
    },
    {
        name: "search_notes",
        description: "Search all notes across all projects by title or content.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search term for note title/content" },
                userId: { type: "string", description: "Optional: filter to this user's projects" }
            },
            required: ["query"]
        }
    },
    {
        name: "read_project_details",
        description: "Read the full details of a specific project including all tasks, notes, and asset count.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string", description: "The owner's user ID" },
                projectId: { type: "string", description: "The project ID to read" }
            },
            required: ["userId", "projectId"]
        }
    },
    {
        name: "create_project_note",
        description: "Creates a new note inside a user's project.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                title: { type: "string" },
                content: { type: "string" },
                color: { type: "string", description: "Optional hex color code" }
            },
            required: ["userId", "projectId", "title", "content"]
        }
    },
    {
        name: "create_project_task",
        description: "Creates a new task in a user's project.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                priority: { type: "string", enum: ["low", "medium", "high"] }
            },
            required: ["userId", "projectId", "title", "priority"]
        }
    },
    {
        name: "update_project_task",
        description: "Updates an existing task in a user's project.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                taskId: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                status: { type: "string", enum: ["todo", "in_progress", "done"] },
                priority: { type: "string", enum: ["low", "medium", "high"] }
            },
            required: ["userId", "projectId", "taskId"]
        }
    },
    {
        name: "delete_project_task",
        description: "Deletes an existing task from a user's project.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                taskId: { type: "string" }
            },
            required: ["userId", "projectId", "taskId"]
        }
    },
    {
        name: "create_project_asset",
        description: "Creates a new asset (blog, social, table, doc) inside a user's project.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                type: { type: "string", enum: ["blog", "social", "table", "doc"] },
                data: { type: "object", description: "JSON content of the asset" }
            },
            required: ["userId", "projectId", "title", "type", "data"]
        }
    },
    {
        name: "report_progress",
        description: "Report progress to the shared context so sibling agents can see what you've done. Call this after completing significant actions.",
        parameters: {
            type: "object",
            properties: {
                summary: { type: "string", description: "Brief summary of what you just accomplished" }
            },
            required: ["summary"]
        }
    },
    {
        name: "update_project",
        description: "Updates project name or description.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                name: { type: "string", description: "Optional new name" },
                description: { type: "string", description: "Optional new description" }
            },
            required: ["userId", "projectId"]
        }
    },
    {
        name: "append_project_note",
        description: "Append text to an existing note.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                noteId: { type: "string" },
                text: { type: "string" }
            },
            required: ["userId", "projectId", "noteId", "text"]
        }
    },
    {
        name: "delete_project_note",
        description: "Delete a note from the project.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                noteId: { type: "string" }
            },
            required: ["userId", "projectId", "noteId"]
        }
    },
    {
        name: "search_knowledge_base",
        description: "Search all indexed documents in the project knowledge base.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                query: { type: "string", description: "Search term" }
            },
            required: ["userId", "projectId", "query"]
        }
    },
    {
        name: "generate_image",
        description: "Generate a new image with Gemini based on a text prompt.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                prompt: { type: "string", description: "Image description" }
            },
            required: ["userId", "projectId", "prompt"]
        }
    },
    {
        name: "generate_project_blog",
        description: "Generate a structured markdown blog post from the project context.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                prompt: { type: "string" }
            },
            required: ["userId", "projectId", "prompt"]
        }
    },
    {
        name: "generate_project_website",
        description: "Generate a functional, single-file website (HTML/Tailwind) string based on the project context.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                prompt: { type: "string" }
            },
            required: ["userId", "projectId", "prompt"]
        }
    },
    {
        name: "edit_project_website",
        description: "Fetch the latest generated single-file HTML website for a project and apply AI-driven edits based on the user's prompt.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                prompt: { type: "string", description: "Instructions on what to change in the website" }
            },
            required: ["userId", "projectId", "prompt"]
        }
    },
    {
        name: "generate_canvas_website",
        description: "Generates or updates a full Next.js application (Canvas) and deploys it to Vercel/GitHub. Use this when the user wants a full web app deposited into the Canvas tab, not just a single HTML file.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                prompt: { type: "string", description: "Instructions for the entire full-stack application." }
            },
            required: ["userId", "projectId", "prompt"]
        }
    },
    {
        name: "analyze_project_file",
        description: "Retrieves and analyzes the contents of a specific file from the project's knowledge base.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                fileName: { type: "string", description: "Name of the file to analyze" },
                task: { type: "string", description: "What to do with the file" }
            },
            required: ["userId", "projectId", "fileName"]
        }
    },
    {
        name: "edit_image",
        description: "Edit an existing image using Gemini AI.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                imageUrl: { type: "string" },
                instruction: { type: "string" }
            },
            required: ["userId", "projectId", "imageUrl", "instruction"]
        }
    },
    {
        name: "generate_project_podcast",
        description: "Generate a podcast script from the project context.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                prompt: { type: "string" }
            },
            required: ["userId", "projectId", "prompt"]
        }
    },
    {
        name: "run_project_seo_analysis",
        description: "Run SEO keyword analysis for the project.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                keyword: { type: "string" }
            },
            required: ["userId", "projectId", "keyword"]
        }
    },
    {
        name: "start_new_research_session",
        description: "Start a deep research session on a topic.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string" },
                projectId: { type: "string" },
                topic: { type: "string" }
            },
            required: ["userId", "projectId", "topic"]
        }
    }
];

export const maxDuration = 300; // Allow enough time for Vercel/NextJS deployments

// Maximum steps a swarm assignment can take before auto-terminating
// ─── Tool Executor ───────────────────────────────────────────────────

async function executeTool(call: any, assignmentId: string, assignment: any): Promise<string> {
    const args = call.args || {};

    try {
        switch (call.name) {
            case 'search_users': {
                const results = await searchUsers(args.query);
                await logStep(assignmentId, 'Tool', `Searched users for "${args.query}" → ${results.length} results`, 'info');
                return JSON.stringify(results);
            }
            case 'search_projects': {
                const results = await searchProjects(args.query, args.userId);
                await logStep(assignmentId, 'Tool', `Searched projects for "${args.query}" → ${results.length} results`, 'info');
                return JSON.stringify(results);
            }
            case 'search_tasks': {
                const results = await searchTasks(args.query, args.userId, args.status, args.priority);
                await logStep(assignmentId, 'Tool', `Searched tasks for "${args.query}" → ${results.length} results`, 'info');
                return JSON.stringify(results);
            }
            case 'search_notes': {
                const results = await searchNotes(args.query, args.userId);
                await logStep(assignmentId, 'Tool', `Searched notes for "${args.query}" → ${results.length} results`, 'info');
                return JSON.stringify(results);
            }
            case 'read_project_details': {
                const details = await readProjectDetails(args.userId, args.projectId);
                if (!details) return JSON.stringify({ error: 'Project not found' });
                await logStep(assignmentId, 'Tool', `Read project details: "${details.name}"`, 'info');
                return JSON.stringify(details);
            }
            case 'create_project_note': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const noteData = {
                    id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    title: args.title,
                    content: args.content,
                    color: args.color || null,
                    createdAt: Date.now(),
                    lastModified: Date.now(),
                    aiGenerated: true
                };
                const notes = [...(projectDoc.data()!.notes || []), noteData];
                await projectRef.update({ notes });
                await logStep(assignmentId, 'Action', `Created Note: "${noteData.title}" in project ${args.projectId}`, 'success');
                return JSON.stringify({ success: true, noteId: noteData.id });
            }
            case 'create_project_task': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const taskData = {
                    id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    title: args.title,
                    description: args.description || '',
                    status: 'todo',
                    priority: args.priority,
                    order: (projectDoc.data()!.tasks || []).length,
                    createdAt: Date.now(),
                    lastModified: Date.now(),
                    aiGenerated: true
                };
                const tasks = [...(projectDoc.data()!.tasks || []), taskData];
                await projectRef.update({ tasks });
                await logStep(assignmentId, 'Action', `Created Task: "${taskData.title}" in project ${args.projectId}`, 'success');
                return JSON.stringify({ success: true, taskId: taskData.id });
            }
            case 'update_project_task': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const tasks = projectDoc.data()!.tasks || [];
                const idx = tasks.findIndex((t: any) => t.id === args.taskId);
                if (idx < 0) return JSON.stringify({ error: `Task ${args.taskId} not found` });
                tasks[idx] = {
                    ...tasks[idx],
                    ...(args.title && { title: args.title }),
                    ...(args.description && { description: args.description }),
                    ...(args.status && { status: args.status }),
                    ...(args.priority && { priority: args.priority }),
                    lastModified: Date.now()
                };
                await projectRef.update({ tasks });
                await logStep(assignmentId, 'Action', `Updated Task: "${tasks[idx].title}"`, 'success');
                return JSON.stringify({ success: true });
            }
            case 'delete_project_task': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                let tasks = projectDoc.data()!.tasks || [];
                const before = tasks.length;
                tasks = tasks.filter((t: any) => t.id !== args.taskId);
                if (tasks.length === before) return JSON.stringify({ error: `Task ${args.taskId} not found` });
                await projectRef.update({ tasks });
                await logStep(assignmentId, 'Action', `Deleted Task: ${args.taskId}`, 'success');
                return JSON.stringify({ success: true });
            }
            case 'create_project_asset': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const assetId = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const assetData = {
                    id: assetId, title: args.title, description: args.description || '',
                    type: args.type, data: args.data,
                    researchTopic: assignment.goal, researchId: `session-${Date.now()}`,
                    timestamp: Date.now(),
                };
                const dummySession = {
                    id: assetData.researchId, timestamp: Date.now(), lastModified: Date.now(),
                    topic: assignment.goal,
                    researchReport: { topic: assignment.goal, tldr: "Generated by Agent Swarm", summary: "Auto generated", headerImagePrompt: "", keyPoints: [], marketImplications: "" },
                    websiteVersions: [], assets: [assetData]
                };
                const sessions = [...(projectDoc.data()!.researchSessions || []), dummySession];
                await projectRef.update({ researchSessions: sessions });
                await logStep(assignmentId, 'Action', `Created Asset: "${args.title}" (${args.type})`, 'success');
                return JSON.stringify({ success: true, assetId });
            }
            case 'update_project': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const updates: any = { lastModified: Date.now() };
                if (args.name) updates.name = args.name;
                if (args.description) updates.description = args.description;
                await projectRef.update(updates);
                await logStep(assignmentId, 'Action', `Updated Project: ${args.projectId}`, 'success');
                return JSON.stringify({ success: true });
            }
            case 'append_project_note': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const notes = projectDoc.data()!.notes || [];
                const idx = notes.findIndex((n: any) => n.id === args.noteId);
                if (idx < 0) return JSON.stringify({ error: 'Note not found' });
                notes[idx].content += '\n' + args.text;
                notes[idx].lastModified = Date.now();
                await projectRef.update({ notes, lastModified: Date.now() });
                await logStep(assignmentId, 'Action', `Appended to Note: "${notes[idx].title}"`, 'success');
                return JSON.stringify({ success: true });
            }
            case 'delete_project_note': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const notes = (projectDoc.data()!.notes || []).filter((n: any) => n.id !== args.noteId);
                await projectRef.update({ notes, lastModified: Date.now() });
                await logStep(assignmentId, 'Action', `Deleted Note: ${args.noteId}`, 'success');
                return JSON.stringify({ success: true });
            }
            case 'search_knowledge_base': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const files = projectDoc.data()!.knowledgeBase || [];
                const q = args.query.toLowerCase();
                const matches = files.filter((f: any) =>
                    (f.name || '').toLowerCase().includes(q) ||
                    (f.summary || '').toLowerCase().includes(q)
                ).slice(0, 5);
                await logStep(assignmentId, 'Tool', `Searched KB for "${args.query}" -> ${matches.length} matches`, 'info');
                return JSON.stringify(matches);
            }
            case 'generate_image': {
                const { prompt, projectId, userId } = args;
                const projectRef = db.collection('users').doc(userId).collection('projects').doc(projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });

                const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
                const response = await genai.models.generateContent({
                    model: 'gemini-3.1-flash-image-preview',
                    contents: { parts: [{ text: prompt }] },
                    config: { responseModalities: ['IMAGE'] }
                });

                const imagePart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
                if (!imagePart || !imagePart.inlineData) return JSON.stringify({ error: 'No image returned' });

                const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
                const blob = await put(`projects/${projectId}/assets/image-${Date.now()}.png`, buffer, {
                    access: 'public', contentType: imagePart.inlineData.mimeType || 'image/png'
                });

                const uploadedFile = {
                    uri: blob.url, name: `Generated Image - ${prompt.substring(0, 20)}`,
                    displayName: prompt.substring(0, 40), mimeType: imagePart.inlineData.mimeType,
                    url: blob.url, summary: prompt, uploadedAt: Date.now()
                };

                const files = [...(projectDoc.data()!.uploadedFiles || []), uploadedFile];
                await projectRef.update({ uploadedFiles: files, lastModified: Date.now() });
                await logStep(assignmentId, 'Action', `Generated Image: ${blob.url}`, 'success');
                return JSON.stringify({ success: true, url: blob.url });
            }
            case 'generate_project_blog': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const data = projectDoc.data()!;
                const context = `Project: ${data.name}\nDescription: ${data.description}\nNotes: ${JSON.stringify(data.notes)}\nTasks: ${JSON.stringify(data.tasks)}`;

                const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
                const response = await genai.models.generateContent({
                    model: 'gemini-2.5-pro',
                    contents: { parts: [{ text: `Generate a structured markdown blog post based on this context and prompt.\nPrompt: ${args.prompt}\nContext: ${context}` }] }
                });
                const blogText = response.candidates?.[0]?.content?.parts?.[0]?.text || 'Failed to generate blog';

                const assetId = `blog-${Date.now()}`;
                const assetData = {
                    id: assetId, title: args.prompt.substring(0, 40), description: 'AI Generated Blog',
                    type: 'blog', data: { text: blogText }, timestamp: Date.now()
                };

                const sessions = [...(data.researchSessions || []), { id: `session-${Date.now()}`, assets: [assetData] }];
                await projectRef.update({ researchSessions: sessions });
                await logStep(assignmentId, 'Action', `Generated Blog: "${args.prompt.substring(0, 30)}"`, 'success');
                return JSON.stringify({ success: true, assetId });
            }
            case 'generate_project_website': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const data = projectDoc.data()!;
                const context = `Project: ${data.name}\nDescription: ${data.description}\nNotes: ${JSON.stringify(data.notes)}\nTasks: ${JSON.stringify(data.tasks)}`;

                const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
                const response = await genai.models.generateContent({
                    model: 'gemini-2.5-pro',
                    contents: { parts: [{ text: `Generate an HTML string with TailwindCSS describing a website for this project based on context and prompt. Return ONLY raw HTML code without markdown formatting.\nPrompt: ${args.prompt}\nContext: ${context}` }] }
                });
                const htmlText = response.candidates?.[0]?.content?.parts?.[0]?.text || '<div>Failed to generate</div>';

                const assetId = `web-${Date.now()}`;
                const websiteVersion = { id: assetId, timestamp: Date.now(), html: htmlText, description: args.prompt.substring(0, 60) };

                // Emulate ProjectLiveAssistant appending to the most recent research session
                const sessions = data.researchSessions || [];
                const latestSession = sessions.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))[0];

                if (latestSession) {
                    const updatedVersions = [websiteVersion, ...(latestSession.websiteVersions || [])];
                    const updatedSessions = sessions.map((s: any) => s.id === latestSession.id ? { ...s, websiteVersions: updatedVersions } : s);
                    await projectRef.update({ researchSessions: updatedSessions });
                } else {
                    // Create a dummy session if none exists
                    await projectRef.update({ researchSessions: [{ id: `session-${Date.now()}`, websiteVersions: [websiteVersion] }] });
                }

                await logStep(assignmentId, 'Action', `Generated Website Option: "${args.prompt.substring(0, 30)}"`, 'success');
                return JSON.stringify({ success: true, assetId, savedTo: latestSession ? 'latest_session' : 'new_session' });
            }
            case 'edit_project_website': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const data = projectDoc.data()!;

                const sessions = data.researchSessions || [];
                const latestSession = sessions.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))[0];
                if (!latestSession || !latestSession.websiteVersions || latestSession.websiteVersions.length === 0) {
                    return JSON.stringify({ error: 'No existing website found to edit. Run generate_project_website first.' });
                }

                const currentHtml = latestSession.websiteVersions[0].html;
                const context = `Project: ${data.name}\nDescription: ${data.description}`;

                // Using refineWebsiteCode from geminiService
                let generatedHtml = "";
                try {
                    generatedHtml = await refineWebsiteCode(currentHtml, context, data.theme, () => { }, () => { });
                } catch (e: any) {
                    return JSON.stringify({ error: 'Failed to edit website: ' + e.message });
                }

                const assetId = `web-${Date.now()}`;
                const websiteVersion = { id: assetId, timestamp: Date.now(), html: generatedHtml, description: args.prompt.substring(0, 60) };

                const updatedVersions = [websiteVersion, ...latestSession.websiteVersions];
                const updatedSessions = sessions.map((s: any) => s.id === latestSession.id ? { ...s, websiteVersions: updatedVersions } : s);
                await projectRef.update({ researchSessions: updatedSessions });

                await logStep(assignmentId, 'Action', `Edited Website: "${args.prompt.substring(0, 30)}"`, 'success');
                return JSON.stringify({ success: true, assetId });
            }
            case 'generate_canvas_website': {
                await logStep(assignmentId, 'Action', `Triggering full Next.js Canvas deployment. This may take a minute.`, 'info');
                try {
                    const result: any = await runDeployPipeline({
                        uid: args.userId,
                        projectId: args.projectId,
                        userPrompt: args.prompt,
                        existingConfig: undefined, // Usually fetched from the DB inside runDeployPipeline
                        isRedeploy: false, // If there's an existing repo, runDeployPipeline handles intent classification
                        onProgress: async (event: any) => {
                            if (event.type === 'status') {
                                await logStep(assignmentId, 'Action', `Deploy step: ${event.text}`, 'info');
                            }
                        },
                        appUrl: process.env.APP_URL || 'http://localhost:3000'
                    });

                    if (result.chat) {
                        return JSON.stringify({ success: true, message: "Intent classified as pure chat. No changes deployed." });
                    }

                    // Save the deployment config back to the project doc just as the UI does
                    const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                    await projectRef.set({
                        deployConfig: {
                            githubRepoUrl: result.repoUrl,
                            githubRepoOwner: result.repoOwner,
                            githubRepoName: result.repoName,
                            vercelProjectId: result.vercelProjectId,
                            lastDeployed: Date.now()
                        }
                    }, { merge: true });

                    await logStep(assignmentId, 'Action', `Canvas website deployed successfully! URL: ${result.previewUrl}`, 'success');
                    return JSON.stringify({ success: true, url: result.previewUrl, githubUrl: result.repoUrl });
                } catch (e: any) {
                    await logStep(assignmentId, 'Action', `Canvas deployment failed: ${e.message}`, 'error');
                    return JSON.stringify({ error: e.message });
                }
            }
            case 'analyze_project_file': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const files = projectDoc.data()!.knowledgeBase || [];
                const q = args.fileName.toLowerCase();
                const targetFile = files.find((f: any) => (f.name || '').toLowerCase().includes(q) || (f.displayName || '').toLowerCase().includes(q));
                if (!targetFile) return JSON.stringify({ error: 'File not found exactly matching query. Try search_knowledge_base first.' });

                const fileContent = targetFile.extractedText || targetFile.summary || targetFile.description || 'No extracted text available.';
                const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
                const response = await genai.models.generateContent({
                    model: 'gemini-2.5-pro',
                    contents: { parts: [{ text: `Analyze this file content based on the given task.\nTask: ${args.task}\nFile Name: ${targetFile.name}\nFile Content: ${fileContent}` }] }
                });
                const resultText = response.candidates?.[0]?.content?.parts?.[0]?.text || 'Failed to analyze';
                await logStep(assignmentId, 'Action', `Analyzed file: ${targetFile.name}`, 'success');
                return JSON.stringify({ result: resultText });
            }
            case 'edit_image': {
                const { instruction, imageUrl, projectId, userId } = args;
                const projectRef = db.collection('users').doc(userId).collection('projects').doc(projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });

                const res = await fetch(imageUrl);
                if (!res.ok) return JSON.stringify({ error: 'Failed to fetch original image' });
                const arrayBuffer = await res.arrayBuffer();
                const base64 = Buffer.from(arrayBuffer).toString('base64');
                const mimeType = res.headers.get('content-type') || 'image/png';

                const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
                const response = await genai.models.generateContent({
                    model: 'gemini-3.1-flash-image-preview',
                    contents: {
                        parts: [
                            { inlineData: { data: base64, mimeType } },
                            { text: `Edit the provided image using the instruction below.\n\nINSTRUCTION:\n${instruction}` }
                        ]
                    },
                    config: { responseModalities: ['IMAGE'] }
                });

                const imagePart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
                if (!imagePart || !imagePart.inlineData) return JSON.stringify({ error: 'No edit returned' });

                const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
                const blob = await put(`projects/${projectId}/assets/edited-${Date.now()}.png`, buffer, {
                    access: 'public', contentType: imagePart.inlineData.mimeType || 'image/png'
                });

                const uploadedFile = {
                    uri: blob.url, name: `Edited Image - ${instruction.substring(0, 20)}`,
                    displayName: `Edited: ${instruction.substring(0, 40)}`, mimeType: imagePart.inlineData.mimeType,
                    url: blob.url, summary: `Edited with instruction: ${instruction}`, uploadedAt: Date.now()
                };

                const files = [...(projectDoc.data()!.uploadedFiles || []), uploadedFile];
                await projectRef.update({ uploadedFiles: files, lastModified: Date.now() });
                await logStep(assignmentId, 'Action', `Edited image: ${blob.url}`, 'success');
                return JSON.stringify({ success: true, url: blob.url });
            }
            case 'generate_project_podcast': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const data = projectDoc.data()!;
                const context = `Project: ${data.name}\nDescription: ${data.description}\nNotes: ${JSON.stringify(data.notes)}\nTasks: ${JSON.stringify(data.tasks)}`;

                const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
                const response = await genai.models.generateContent({
                    model: 'gemini-2.5-pro',
                    contents: { parts: [{ text: `Generate a detailed multi-speaker podcast script based on this project context and prompt. Include speaker labels (e.g., HOST, GUEST).\nPrompt: ${args.prompt}\nContext: ${context}` }] }
                });
                const scriptText = response.candidates?.[0]?.content?.parts?.[0]?.text || 'Failed to generate script';

                const assetId = `podcast-${Date.now()}`;
                const assetData = {
                    id: assetId, title: args.prompt.substring(0, 40), description: 'AI Generated Podcast Script',
                    type: 'doc', data: { text: scriptText }, timestamp: Date.now()
                };

                const sessions = [...(data.researchSessions || []), { id: `session-${Date.now()}`, assets: [assetData] }];
                await projectRef.update({ researchSessions: sessions });
                await logStep(assignmentId, 'Action', `Generated Podcast Script: "${args.prompt.substring(0, 30)}"`, 'success');
                return JSON.stringify({ success: true, assetId });
            }
            case 'run_project_seo_analysis': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });
                const data = projectDoc.data()!;
                const context = `Project: ${data.name}\nDescription: ${data.description}`;

                const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
                const response = await genai.models.generateContent({
                    model: 'gemini-2.5-pro',
                    contents: { parts: [{ text: `Act as an SEO expert. Provide a comprehensive keyword analysis, competitor overview, and optimization strategy for the keyword "${args.keyword}" given the project context: ${context}. Return in markdown format.` }] }
                });
                const analysisText = response.candidates?.[0]?.content?.parts?.[0]?.text || 'Analysis failed';

                const assetId = `seo-${Date.now()}`;
                const assetData = {
                    id: assetId, title: `SEO Analysis: ${args.keyword}`, description: `Keyword Strategy for ${args.keyword}`,
                    type: 'blog', data: { text: analysisText }, timestamp: Date.now()
                };

                const sessions = [...(data.researchSessions || []), { id: `session-${Date.now()}`, assets: [assetData] }];
                await projectRef.update({ researchSessions: sessions });
                await logStep(assignmentId, 'Action', `Ran SEO Analysis for: "${args.keyword}"`, 'info');
                return JSON.stringify({ success: true, analysis: analysisText, assetId });
            }
            case 'start_new_research_session': {
                const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
                const projectDoc = await projectRef.get();
                if (!projectDoc.exists) return JSON.stringify({ error: 'Project not found' });

                const sessionId = `session-${Date.now()}`;
                const newSession = {
                    id: sessionId, timestamp: Date.now(), lastModified: Date.now(),
                    topic: args.topic, status: 'completed',
                    researchReport: { topic: args.topic, tldr: "Agent dispatched deep research...", summary: "Detailed research pending... (handled internally by agent tasks)" },
                    assets: []
                };

                const sessions = [...(projectDoc.data()!.researchSessions || []), newSession];
                await projectRef.update({ researchSessions: sessions });
                await logStep(assignmentId, 'Action', `Started research session on: ${args.topic}`, 'success');
                return JSON.stringify({ success: true, sessionId });
            }
            case 'report_progress': {
                // Update the shared context on the parent session
                if (assignment.sessionId) {
                    const sessionRef = db.collection('agent_swarm_sessions').doc(assignment.sessionId);
                    const sessionDoc = await sessionRef.get();
                    if (sessionDoc.exists) {
                        const existing = sessionDoc.data()!.sharedContext || '';
                        const timestamp = new Date().toISOString();
                        const newEntry = `[${timestamp}] Agent@${assignment.targetProjectId}: ${args.summary}`;
                        await sessionRef.update({
                            sharedContext: existing ? `${existing}\n${newEntry}` : newEntry,
                            updatedAt: Date.now()
                        });
                    }
                }
                await logStep(assignmentId, 'Progress', args.summary, 'info');
                return JSON.stringify({ success: true });
            }
            default:
                return JSON.stringify({ error: `Unknown tool: ${call.name}` });
        }
    } catch (e: any) {
        await logStep(assignmentId, 'Tool_Error', `${call.name} failed: ${e.message}`, 'error');
        return JSON.stringify({ error: e.message });
    }
}

// ─── Context Resumption ──────────────────────────────────────────────

async function buildResumeContext(assignmentId: string, assignment: any): Promise<string> {
    const parts: string[] = [];

    // 1. Prior logs for this assignment
    const logsSnap = await db.collection('agent_logs')
        .where('assignmentId', '==', assignmentId)
        .orderBy('timestamp', 'asc')
        .limit(50)
        .get();

    if (!logsSnap.empty) {
        parts.push("=== PRIOR EXECUTION LOGS (resume context) ===");
        logsSnap.forEach((doc) => {
            const log = doc.data();
            parts.push(`[${log.step}] ${log.message} (${log.status})`);
        });
    }

    // 2. Own context summary
    if (assignment.contextSummary) {
        parts.push(`\n=== YOUR LAST CONTEXT SUMMARY ===\n${assignment.contextSummary}`);
    }

    // 3. Task plan progress
    if (assignment.taskPlan?.length > 0) {
        parts.push("\n=== TASK PLAN STATUS ===");
        for (const step of assignment.taskPlan) {
            parts.push(`Step ${step.step}: [${step.status}] ${step.action}${step.result ? ' → ' + step.result : ''}`);
        }
        parts.push(`Current step: ${assignment.currentStep}`);
    }

    // 4. Sibling awareness
    if (assignment.sessionId) {
        // Read shared context
        const sessionDoc = await db.collection('agent_swarm_sessions').doc(assignment.sessionId).get();
        if (sessionDoc.exists && sessionDoc.data()!.sharedContext) {
            parts.push(`\n=== SHARED SWARM CONTEXT ===\n${sessionDoc.data()!.sharedContext}`);
        }

        // Read sibling assignment statuses
        const siblingsSnap = await db.collection('agent_assignments')
            .where('sessionId', '==', assignment.sessionId)
            .get();

        const siblings: string[] = [];
        siblingsSnap.forEach((doc) => {
            if (doc.id !== assignmentId) {
                const s = doc.data();
                siblings.push(`Agent@${s.targetProjectId}: status=${s.status}, step=${s.currentStep}/${(s.taskPlan || []).length}, context="${(s.contextSummary || '').substring(0, 200)}"`);
            }
        });

        if (siblings.length > 0) {
            parts.push("\n=== SIBLING AGENTS STATUS ===");
            parts.push(...siblings);
        }
    }

    return parts.join('\n');
}

// ─── Main Processing Loop ────────────────────────────────────────────

async function processAssignment(assignmentId: string, assignment: any) {
    const assignmentRef = db.collection('agent_assignments').doc(assignmentId);
    const heartbeat = startHeartbeat(assignmentRef);

    try {
        const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
        const ai = new GoogleGenAI({ apiKey });

        // Build resume context (empty string if fresh assignment)
        const resumeContext = await buildResumeContext(assignmentId, assignment);
        const isResume = assignment.currentStep > 0 || (assignment.taskPlan || []).length > 0;

        await logStep(assignmentId, 'Start', isResume
            ? `Resuming from step ${assignment.currentStep} with prior context`
            : `Starting goal: ${assignment.goal}`
        );

        // ─── Phase 1: Planning (if no taskPlan yet) ──────────────────

        let taskPlan: TaskPlanStep[] = assignment.taskPlan || [];

        if (taskPlan.length === 0) {
            await assignmentRef.update({ status: 'planning', updatedAt: Date.now() });
            await logStep(assignmentId, 'Planning', 'Decomposing goal into step-by-step task plan...');

            const planningPrompt = `You are an AI Admin Agent Planner. Your job is to decompose the following goal into a concrete, numbered step-by-step plan of actions.

GOAL: "${assignment.goal}"
TARGET PROJECT: ${assignment.targetProjectId} (Owner: ${assignment.targetUserId})

Available tools you can use in execution:
- search_users, search_projects, search_tasks, search_notes (cross-database search)
- read_project_details (get full project data)
- create_project_note, create_project_task, update_project_task, delete_project_task, create_project_asset
- report_progress (share progress with sibling agents)

Return a JSON array of steps. Each step should be a SHORT action description. 
Example: [{"step":1,"action":"Search for user John by name"},{"step":2,"action":"Read project details for Johns marketing project"},{"step":3,"action":"Create SEO analysis note"}]

Return ONLY the JSON array, no markdown, no explanation.`;

            const planResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: planningPrompt,
            });

            try {
                const planText = (planResponse as any).text || '';
                // Extract JSON from response (handle potential markdown wrapping)
                const jsonMatch = planText.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    taskPlan = parsed.map((s: any, i: number) => ({
                        step: s.step || i + 1,
                        action: s.action,
                        status: 'pending' as const,
                    }));
                } else {
                    throw new Error('No JSON array found in planning response');
                }
            } catch (parseErr: any) {
                // Fallback: single-step plan
                await logStep(assignmentId, 'Planning', `Could not parse plan, using single-step fallback: ${parseErr.message}`, 'warning');
                taskPlan = [{ step: 1, action: assignment.goal, status: 'pending' }];
            }

            // Write plan to Firestore
            await assignmentRef.update({
                taskPlan,
                currentStep: 0,
                status: 'running',
                updatedAt: Date.now()
            });

            await logStep(assignmentId, 'Planning', `Created ${taskPlan.length}-step plan`, 'success');
            return "more_work";
        }

        // ─── Phase 2: Step-by-Step Execution ─────────────────────────

        const startStep = assignment.currentStep || 0;

        for (let i = startStep; i < taskPlan.length; i++) {
            const step = taskPlan[i];

            // Update step status to running
            taskPlan[i].status = 'running';
            await assignmentRef.update({
                taskPlan,
                currentStep: i,
                lastHeartbeatAt: Date.now(),
                updatedAt: Date.now()
            });

            await logStep(assignmentId, `Step_${step.step}`, `Executing: ${step.action}`);

            // Build fresh sibling context before each step
            const siblingContext = await buildResumeContext(assignmentId, { ...assignment, taskPlan, currentStep: i });

            const stepPrompt = `You are an AI Admin Sub-Agent executing step ${step.step} of a multi-step plan.

OVERALL GOAL: "${assignment.goal}"
CURRENT STEP: "${step.action}"
TARGET USER ID: ${assignment.targetUserId}
TARGET PROJECT ID: ${assignment.targetProjectId}

${siblingContext ? `CONTEXT FROM PRIOR STEPS AND SIBLINGS:\n${siblingContext}\n` : ''}

Execute THIS STEP ONLY using the tools available. Be precise and efficient.
After completing the step, call report_progress to summarize what you did.
If you need data, use search tools first. Always include userId and projectId in tool calls.`;

            const tools: any = [{ functionDeclarations: TOOL_DECLARATIONS }];

            // Multi-turn conversation for this step
            let stepComplete = false;
            let turnCount = 0;
            const maxTurns = 8; // Safety limit per step
            let conversationContents: any[] = [{ role: 'user', parts: [{ text: stepPrompt }] }];

            while (!stepComplete && turnCount < maxTurns) {
                turnCount++;

                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: conversationContents,
                    config: {
                        tools,
                    },
                });

                const responseParts = (response as any).candidates?.[0]?.content?.parts || [];
                const functionCalls = responseParts.filter((p: any) => p.functionCall);
                const textParts = responseParts.filter((p: any) => p.text);

                if (functionCalls.length > 0) {
                    // Add model response to conversation
                    conversationContents.push({ role: 'model', parts: responseParts });

                    // Execute all tool calls
                    const toolResponseParts: any[] = [];
                    for (const part of functionCalls) {
                        const fc = part.functionCall;
                        const result = await executeTool(
                            { name: fc.name, args: fc.args },
                            assignmentId,
                            assignment
                        );
                        toolResponseParts.push({
                            functionResponse: {
                                name: fc.name,
                                response: { result }
                            }
                        });
                    }

                    // Add tool responses to conversation
                    conversationContents.push({ role: 'user', parts: toolResponseParts });

                } else {
                    // No more tool calls — step is done
                    const finalText = textParts.map((p: any) => p.text).join(' ');
                    taskPlan[i].status = 'done';
                    taskPlan[i].result = finalText.substring(0, 500);
                    stepComplete = true;

                    await logStep(assignmentId, `Step_${step.step}`, `Completed: ${finalText.substring(0, 300)}`, 'success');
                }
            }

            if (!stepComplete) {
                taskPlan[i].status = 'done';
                taskPlan[i].result = 'Completed (hit turn limit)';
                await logStep(assignmentId, `Step_${step.step}`, 'Step completed (max turns reached)', 'warning');
            }

            // Update context summary after each step
            const contextSummary = taskPlan
                .filter(s => s.status === 'done')
                .map(s => `Step ${s.step}: ${s.result || s.action}`)
                .join('\n');

            await assignmentRef.update({
                taskPlan,
                currentStep: i + 1,
                contextSummary,
                lastHeartbeatAt: Date.now(),
                updatedAt: Date.now()
            });

            return "more_work"; // End lambda execution after 1 step to avoid Vercel timeouts
        }

        // ─── Phase 3: Completion ─────────────────────────────────────

        await assignmentRef.update({
            status: 'completed',
            updatedAt: Date.now()
        });

        await logStep(assignmentId, 'Complete', `All ${taskPlan.length} steps executed successfully.`, 'success');

        // Update session status if all siblings are done
        if (assignment.sessionId) {
            const siblingsSnap = await db.collection('agent_assignments')
                .where('sessionId', '==', assignment.sessionId)
                .get();

            const allDone = siblingsSnap.docs.every(d => {
                const s = d.data().status;
                return s === 'completed' || s === 'failed';
            });

            if (allDone) {
                await db.collection('agent_swarm_sessions').doc(assignment.sessionId).update({
                    status: 'completed',
                    updatedAt: Date.now()
                });
            }
        }

        return "completed";

    } catch (e: any) {
        console.error('Task execution failed:', e);
        await logStep(assignmentId, 'Fatal_Error', e.message || 'Unknown processing error', 'error');

        const retryCount = (assignment.retryCount || 0) + 1;
        const maxRetries = assignment.maxRetries || 3;

        if (retryCount < maxRetries) {
            // Mark as paused for retry pickup
            await assignmentRef.update({
                status: 'pending',
                retryCount,
                error: e.message,
                updatedAt: Date.now()
            });
            await logStep(assignmentId, 'Retry', `Will retry (attempt ${retryCount}/${maxRetries})`, 'warning');
        } else {
            await assignmentRef.update({
                status: 'failed',
                retryCount,
                error: e.message,
                updatedAt: Date.now()
            });
        }
    } finally {
        clearInterval(heartbeat);
    }
}
