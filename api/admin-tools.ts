import admin from 'firebase-admin';
import { GoogleGenAI } from '@google/genai';
import { generateImage, refineWebsiteCode } from '../services/geminiService';
import { runDeployPipeline } from '../services/agentService';
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

async function logProjectActivity(ownerUid: string, projectId: string, type: string, description: string, metadata: any = {}) {
    try {
        const activityId = `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const activityRef = db.collection('users').doc(ownerUid).collection('projects').doc(projectId).collection('activity').doc(activityId);
        await activityRef.set({
            id: activityId,
            type,
            description,
            metadata: {
                ...metadata,
                tags: metadata.tags || [type.split('_')[0]]
            },
            actorUid: 'admin-agent',
            actorName: 'Admin Agent',
            actorPhoto: null,
            timestamp: Date.now()
        });
    } catch (e) {
        console.error('[admin-tools] Failed to log activity:', e);
    }
}

const ADMIN_EMAIL = 'contact.mngrm@gmail.com';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
const genai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

export default async function handler(req: any, res: any) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // Auth check
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        if (decoded.email !== ADMIN_EMAIL) {
            return res.status(403).json({ message: 'Forbidden: admin only' });
        }
    } catch (e) {
        return res.status(401).json({ message: 'Invalid token' });
    }

    const { tool, args } = req.body;
    if (!tool || !args) {
        return res.status(400).json({ message: 'Missing tool or args' });
    }

    try {
        const result = await executeTool(tool, args);
        return res.status(200).json(result);
    } catch (e: any) {
        console.error(`[admin-tools] Tool ${tool} failed:`, e);
        return res.status(500).json({ error: e.message });
    }
}

// ─── Tool Executor ────────────────────────────────────────────────────

async function executeTool(tool: string, args: any): Promise<any> {
    switch (tool) {

        case 'update_user': {
            if (!args.userId || !args.updates) return { error: 'Missing userId or updates' };
            const ref = db.collection('users').doc(args.userId);
            const updates = { ...args.updates, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
            await ref.update(updates);
            return { success: true };
        }

        // ── Search ─────────────────────────────────────────────────────
        case 'search_users': {
            const snap = await db.collection('users').limit(500).get();
            const q = (args.query || '').toLowerCase();
            const results: any[] = [];
            snap.forEach(doc => {
                const d = doc.data();
                if (!q || (d.displayName || '').toLowerCase().includes(q) || (d.email || '').toLowerCase().includes(q)) {
                    results.push({ uid: doc.id, email: d.email, displayName: d.displayName, createdAt: d.createdAt });
                }
            });
            return { results: results.slice(0, 30), count: Math.min(results.length, 30) };
        }

        case 'search_projects': {
            const snap = args.userId
                ? await db.collection('users').doc(args.userId).collection('projects').limit(200).get()
                : await db.collectionGroup('projects').limit(500).get();
            const q = (args.query || '').toLowerCase();
            const results: any[] = [];
            snap.forEach(doc => {
                const d = doc.data();
                if (!q || (d.name || '').toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q)) {
                    const pathParts = doc.ref.path.split('/');
                    const ownerUid = pathParts.length >= 2 ? pathParts[1] : d.ownerUid || 'unknown';
                    results.push({
                        id: doc.id, name: d.name, ownerUid,
                        description: (d.description || '').substring(0, 200),
                        taskCount: (d.tasks || []).length,
                        noteCount: (d.notes || []).length,
                        createdAt: d.createdAt,
                        lastModified: d.lastModified,
                    });
                }
            });
            return { results: results.slice(0, 30), count: Math.min(results.length, 30) };
        }

        case 'search_tasks': {
            const snap = args.userId
                ? await db.collection('users').doc(args.userId).collection('projects').limit(200).get()
                : await db.collectionGroup('projects').limit(500).get();
            const q = (args.query || '').toLowerCase();
            const results: any[] = [];
            snap.forEach(doc => {
                const d = doc.data();
                const pathParts = doc.ref.path.split('/');
                const ownerUid = pathParts.length >= 2 ? pathParts[1] : 'unknown';
                for (const t of (d.tasks || [])) {
                    const matchQ = !q || (t.title || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q);
                    const matchS = !args.status || t.status === args.status;
                    const matchP = !args.priority || t.priority === args.priority;
                    if (matchQ && matchS && matchP) {
                        results.push({ taskId: t.id, title: t.title, status: t.status, priority: t.priority, projectId: doc.id, projectName: d.name, ownerUid });
                    }
                }
            });
            return { results: results.slice(0, 50), count: Math.min(results.length, 50) };
        }

        case 'search_notes': {
            const snap = args.userId
                ? await db.collection('users').doc(args.userId).collection('projects').limit(200).get()
                : await db.collectionGroup('projects').limit(500).get();
            const q = (args.query || '').toLowerCase();
            const results: any[] = [];
            snap.forEach(doc => {
                const d = doc.data();
                const pathParts = doc.ref.path.split('/');
                const ownerUid = pathParts.length >= 2 ? pathParts[1] : 'unknown';
                for (const n of (d.notes || [])) {
                    if (!q || (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q)) {
                        results.push({ noteId: n.id, title: n.title, projectId: doc.id, projectName: d.name, ownerUid, preview: (n.content || '').substring(0, 200) });
                    }
                }
            });
            return { results: results.slice(0, 50), count: Math.min(results.length, 50) };
        }

        case 'read_project_details': {
            const ref = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
            const doc = await ref.get();
            if (!doc.exists) return { error: 'Project not found' };
            const d = doc.data()!;
            return {
                id: doc.id,
                name: d.name,
                description: d.description,
                tasks: (d.tasks || []).map((t: any) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, description: (t.description || '').substring(0, 300) })),
                notes: (d.notes || []).map((n: any) => ({ id: n.id, title: n.title, content: (n.content || '').substring(0, 500) })),
                sessionCount: (d.researchSessions || []).length,
                createdAt: d.createdAt,
                lastModified: d.lastModified,
            };
        }

        // ── Projects ───────────────────────────────────────────────────
        case 'create_project': {
            const projectData = {
                id: `proj-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`,
                name: args.name,
                description: args.description || '',
                ownerUid: args.userId,
                tasks: [],
                notes: [],
                researchSessions: [],
                knowledgeBase: [],
                createdAt: Date.now(),
                lastModified: Date.now(),
            };
            await db.collection('users').doc(args.userId).collection('projects').doc(projectData.id).set(projectData);
            return { success: true, projectId: projectData.id, project: { id: projectData.id, name: projectData.name } };
        }

        case 'update_project': {
            const ref = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
            const updates: any = { lastModified: Date.now() };
            if (args.name) updates.name = args.name;
            if (args.description !== undefined) updates.description = args.description;
            await ref.update(updates);
            return { success: true };
        }

        // ── Tasks ──────────────────────────────────────────────────────
        case 'create_task': {
            const ref = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
            const doc = await ref.get();
            if (!doc.exists) return { error: 'Project not found' };
            const taskData = {
                id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`,
                title: args.title,
                description: args.description || '',
                status: 'todo',
                priority: args.priority || 'medium',
                order: (doc.data()!.tasks || []).length,
                createdAt: Date.now(),
                lastModified: Date.now(),
                aiGenerated: true,
            };
            const tasks = [...(doc.data()!.tasks || []), taskData];
            await ref.update({ tasks, lastModified: Date.now() });
            return { success: true, taskId: taskData.id, task: { id: taskData.id, title: taskData.title } };
        }

        case 'update_task': {
            const ref = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
            const doc = await ref.get();
            if (!doc.exists) return { error: 'Project not found' };
            const tasks = doc.data()!.tasks || [];
            const idx = tasks.findIndex((t: any) => t.id === args.taskId);
            if (idx < 0) return { error: `Task ${args.taskId} not found` };
            tasks[idx] = {
                ...tasks[idx],
                ...(args.title && { title: args.title }),
                ...(args.description !== undefined && { description: args.description }),
                ...(args.status && { status: args.status }),
                ...(args.priority && { priority: args.priority }),
                lastModified: Date.now(),
            };
            await ref.update({ tasks, lastModified: Date.now() });
            return { success: true };
        }

        case 'delete_task': {
            const ref = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
            const doc = await ref.get();
            if (!doc.exists) return { error: 'Project not found' };
            const tasks = (doc.data()!.tasks || []).filter((t: any) => t.id !== args.taskId);
            await ref.update({ tasks, lastModified: Date.now() });
            return { success: true };
        }

        // ── Notes ──────────────────────────────────────────────────────
        case 'create_note': {
            const ref = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
            const doc = await ref.get();
            if (!doc.exists) return { error: 'Project not found' };
            const noteData = {
                id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`,
                title: args.title,
                content: args.content,
                color: args.color || null,
                createdAt: Date.now(),
                lastModified: Date.now(),
                aiGenerated: true,
            };
            const notes = [...(doc.data()!.notes || []), noteData];
            await ref.update({ notes, lastModified: Date.now() });
            return { success: true, noteId: noteData.id, note: { id: noteData.id, title: noteData.title } };
        }

        case 'update_note': {
            const ref = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
            const doc = await ref.get();
            if (!doc.exists) return { error: 'Project not found' };
            const notes = doc.data()!.notes || [];
            const idx = notes.findIndex((n: any) => n.id === args.noteId);
            if (idx < 0) return { error: `Note ${args.noteId} not found` };
            notes[idx] = {
                ...notes[idx],
                ...(args.title && { title: args.title }),
                ...(args.content !== undefined && { content: args.content }),
                ...(args.color !== undefined && { color: args.color }),
                lastModified: Date.now(),
            };
            await ref.update({ notes, lastModified: Date.now() });
            return { success: true };
        }

        case 'delete_note': {
            const ref = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
            const doc = await ref.get();
            if (!doc.exists) return { error: 'Project not found' };
            const notes = (doc.data()!.notes || []).filter((n: any) => n.id !== args.noteId);
            await ref.update({ notes, lastModified: Date.now() });
            return { success: true };
        }

        // ── Generation ─────────────────────────────────────────────────
        case 'generate_image': {
            if (!genai) return { error: 'Gemini not configured' };
            const { prompt, projectId, userId, useProModel } = args;
            if (!prompt || !projectId || !userId) return { error: 'Missing prompt, projectId, or userId' };

            const ref = db.collection('users').doc(userId).collection('projects').doc(projectId);
            const doc = await ref.get();
            if (!doc.exists) return { error: 'Project not found' };

            const response = await genai.models.generateContent({
                model: useProModel ? 'gemini-3.1-flash-image-preview' : 'gemini-3.1-flash-image-preview',
                contents: { parts: [{ text: `${prompt}\n\nSTYLE GUIDE:\n- High quality, professional presentation.\n- Visually striking.` }] },
                config: { responseModalities: ['IMAGE'] }
            });

            const candidateParts = response.candidates?.[0]?.content?.parts || [];
            const imagePart = candidateParts.find((p: any) => p.inlineData?.data);
            if (!imagePart || !imagePart.inlineData) return { error: 'No image returned from Gemini' };

            const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
            const blob = await put(`projects/${projectId}/assets/image-${Date.now()}.png`, buffer, {
                access: 'public',
                contentType: imagePart.inlineData.mimeType || 'image/png'
            });

            const uploadedFile = {
                uri: blob.url,
                name: `Generated Image - ${prompt.substring(0, 20)}`,
                displayName: prompt.substring(0, 40),
                mimeType: imagePart.inlineData.mimeType || 'image/png',
                url: blob.url,
                summary: prompt,
                uploadedAt: Date.now()
            };

            const files = [...(doc.data()!.uploadedFiles || []), uploadedFile];
            await ref.update({ uploadedFiles: files, lastModified: Date.now() });

            await logProjectActivity(userId, projectId, 'image_generated', `Generated image: ${prompt}`, { url: blob.url, tags: ['image', 'ai-generated'] });

            return { success: true, url: blob.url, file: uploadedFile };
        }

        case 'edit_image': {
            if (!genai) return { error: 'Gemini not configured' };
            const { prompt, imageUrl, projectId, userId } = args;
            if (!prompt || !imageUrl || !projectId || !userId) return { error: 'Missing prompt, imageUrl, projectId, or userId' };

            const ref = db.collection('users').doc(userId).collection('projects').doc(projectId);
            const doc = await ref.get();
            if (!doc.exists) return { error: 'Project not found' };

            // Fetch the existing image
            const res = await fetch(imageUrl);
            if (!res.ok) return { error: 'Failed to fetch original image' };
            const arrayBuffer = await res.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');
            const mimeType = res.headers.get('content-type') || 'image/png';

            const response = await genai.models.generateContent({
                model: 'gemini-3.1-flash-image-preview',
                contents: {
                    parts: [
                        { inlineData: { data: base64, mimeType } },
                        { text: `Edit the provided image using the instruction below.\n\nINSTRUCTION:\n${prompt}` }
                    ]
                },
                config: { responseModalities: ['IMAGE'] }
            });

            const candidateParts = response.candidates?.[0]?.content?.parts || [];
            const imagePart = candidateParts.find((p: any) => p.inlineData?.data);
            if (!imagePart || !imagePart.inlineData) return { error: 'No image returned from Gemini' };

            const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
            const blob = await put(`projects/${projectId}/assets/edited-${Date.now()}.png`, buffer, {
                access: 'public',
                contentType: imagePart.inlineData.mimeType || 'image/png'
            });

            const uploadedFile = {
                uri: blob.url,
                name: `Edited Image - ${prompt.substring(0, 20)}`,
                displayName: `Edited: ${prompt.substring(0, 40)}`,
                mimeType: imagePart.inlineData.mimeType || 'image/png',
                url: blob.url,
                summary: `Edited with instruction: ${prompt}`,
                uploadedAt: Date.now()
            };

            const files = [...(doc.data()!.uploadedFiles || []), uploadedFile];
            await ref.update({ uploadedFiles: files, lastModified: Date.now() });

            await logProjectActivity(userId, projectId, 'image_generated', `Edited image with instruction: ${prompt}`, { url: blob.url, tags: ['image', 'edited'] });

            return { success: true, url: blob.url, file: uploadedFile };
        }

        // ── Websites & Canvas ──────────────────────────────────────────
        case 'generate_project_website': {
            const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
            const projectDoc = await projectRef.get();
            if (!projectDoc.exists) return { error: 'Project not found' };
            const data = projectDoc.data()!;
            const context = `Project: ${data.name}\nDescription: ${data.description}\nNotes: ${JSON.stringify(data.notes)}\nTasks: ${JSON.stringify(data.tasks)}`;

            const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
            const response = await genai.models.generateContent({
                model: 'gemini-3.1-pro-preview',
                contents: { parts: [{ text: `Generate an HTML string with TailwindCSS describing a website for this project based on context and prompt. Return ONLY raw HTML code without markdown formatting.\nPrompt: ${args.prompt}\nContext: ${context}` }] }
            });
            const htmlText = response.candidates?.[0]?.content?.parts?.[0]?.text || '<div>Failed to generate</div>';

            const assetId = `web-${Date.now()}`;
            const websiteVersion = { id: assetId, timestamp: Date.now(), html: htmlText, description: args.prompt.substring(0, 60) };

            const sessions = data.researchSessions || [];
            const latestSession = sessions.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))[0];

            if (latestSession) {
                const updatedVersions = [websiteVersion, ...(latestSession.websiteVersions || [])];
                const updatedSessions = sessions.map((s: any) => s.id === latestSession.id ? { ...s, websiteVersions: updatedVersions } : s);
                await projectRef.update({ researchSessions: updatedSessions });
            } else {
                await projectRef.update({ researchSessions: [{ id: `session-${Date.now()}`, websiteVersions: [websiteVersion] }] });
            }

            await logProjectActivity(args.userId, args.projectId, 'website_generated', `Generated website version: ${args.prompt}`, { assetId, tags: ['website', 'design'] });

            return { success: true, assetId, savedTo: latestSession ? 'latest_session' : 'new_session' };
        }

        case 'edit_project_website': {
            const projectRef = db.collection('users').doc(args.userId).collection('projects').doc(args.projectId);
            const projectDoc = await projectRef.get();
            if (!projectDoc.exists) return { error: 'Project not found' };
            const data = projectDoc.data()!;

            const sessions = data.researchSessions || [];
            const latestSession = sessions.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))[0];
            if (!latestSession || !latestSession.websiteVersions || latestSession.websiteVersions.length === 0) {
                return { error: 'No existing website found to edit. Run generate_project_website first.' };
            }

            const currentHtml = latestSession.websiteVersions[0].html;
            const context = `Project: ${data.name}\nDescription: ${data.description}`;

            let generatedHtml = "";
            try {
                generatedHtml = await refineWebsiteCode(currentHtml, context, data.theme, () => { }, () => { });
            } catch (e: any) {
                return { error: 'Failed to edit website: ' + e.message };
            }

            const assetId = `web-${Date.now()}`;
            const websiteVersion = { id: assetId, timestamp: Date.now(), html: generatedHtml, description: args.prompt.substring(0, 60) };

            const updatedVersions = [websiteVersion, ...latestSession.websiteVersions];
            const updatedSessions = sessions.map((s: any) => s.id === latestSession.id ? { ...s, websiteVersions: updatedVersions } : s);
            await projectRef.update({ researchSessions: updatedSessions });

            await logProjectActivity(args.userId, args.projectId, 'website_generated', `Edited website: ${args.prompt}`, { assetId, tags: ['website', 'edited'] });

            return { success: true, assetId };
        }

        case 'generate_canvas_website': {
            try {
                const result: any = await runDeployPipeline({
                    uid: args.userId,
                    projectId: args.projectId,
                    userPrompt: args.prompt,
                    existingConfig: undefined,
                    isRedeploy: false,
                    onProgress: async () => { }, // Admin chat doesn't stream background deployment logs individually yet
                    appUrl: process.env.APP_URL || 'http://localhost:3000'
                });

                if (result.chat) {
                    return { success: true, message: "Intent classified as pure chat. No changes deployed." };
                }

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

                await logProjectActivity(args.userId, args.projectId, 'website_generated', `Deployed Next.js Canvas website: ${args.prompt}`, { url: result.previewUrl, tags: ['website', 'canvas', 'deployed'] });

                return { success: true, url: result.previewUrl, githubUrl: result.repoUrl };
            } catch (e: any) {
                return { error: e.message };
            }
        }

        // ── Agent Dispatch ─────────────────────────────────────────────
        case 'dispatch_agent': {
            // Create a swarm session then an assignment
            const sessionRef = await db.collection('agent_swarm_sessions').add({
                adminId: ADMIN_EMAIL,
                directive: args.goal,
                status: 'active',
                sharedContext: '',
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            const assignmentRef = await db.collection('agent_assignments').add({
                sessionId: sessionRef.id,
                adminId: ADMIN_EMAIL,
                targetUserId: args.userId,
                targetProjectId: args.projectId,
                goal: args.goal,
                status: 'pending',
                taskPlan: [],
                currentStep: 0,
                contextSummary: '',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                retryCount: 0,
                maxRetries: 3,
            });
            return { success: true, sessionId: sessionRef.id, assignmentId: assignmentRef.id };
        }

        case 'get_agent_assignments': {
            const snap = await db.collection('agent_assignments')
                .orderBy('createdAt', 'desc')
                .limit(20)
                .get();
            const assignments = snap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    status: data.status,
                    goal: data.goal,
                    targetProjectId: data.targetProjectId,
                    targetUserId: data.targetUserId,
                    currentStep: data.currentStep,
                    totalSteps: (data.taskPlan || []).length,
                    createdAt: data.createdAt,
                    error: data.error,
                };
            });
            return { assignments, count: assignments.length };
        }

        // ── Canvas Node Management ──────────────────────────────────────────
        case 'create_canvas_node': {
            const node = {
                type: args.type,          // 'project' | 'user' | 'task' | 'action'
                subtype: args.subtype || null,
                label: args.label,
                data: args.data || {},    // arbitrary payload (project context, action config, etc.)
                status: 'idle',
                result: null,
                position: args.position || { x: 200 + Math.random() * 600, y: 200 + Math.random() * 400 },
                edges: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            const ref = await db.collection('canvas_nodes').add(node);
            return { success: true, nodeId: ref.id, node };
        }

        case 'connect_canvas_nodes': {
            const sourceRef = db.collection('canvas_nodes').doc(args.sourceNodeId);
            const sourceDoc = await sourceRef.get();
            if (!sourceDoc.exists) return { error: 'Source node not found' };
            const currentEdges: string[] = sourceDoc.data()?.edges || [];
            if (!currentEdges.includes(args.targetNodeId)) {
                await sourceRef.update({ edges: [...currentEdges, args.targetNodeId], updatedAt: Date.now() });
            }
            return { success: true };
        }

        case 'list_canvas_nodes': {
            const snap = await db.collection('canvas_nodes').orderBy('createdAt', 'desc').limit(50).get();
            const nodes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            return { nodes, count: nodes.length };
        }

        case 'clear_canvas': {
            const snap = await db.collection('canvas_nodes').get();
            const batch = db.batch();
            snap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            return { success: true, deleted: snap.size };
        }

        case 'run_canvas_action_node': {
            const nodeRef = db.collection('canvas_nodes').doc(args.nodeId);
            const nodeDoc = await nodeRef.get();
            if (!nodeDoc.exists) return { error: 'Node not found' };
            const nodeData = nodeDoc.data()!;
            if (nodeData.type !== 'action') return { error: 'Node is not an action node' };

            // Mark as running
            await nodeRef.update({ status: 'running', updatedAt: Date.now() });

            // Gather context from connected project nodes
            const connectedIds: string[] = nodeData.edges || [];
            let projectContext = '';
            for (const id of connectedIds) {
                const connDoc = await db.collection('canvas_nodes').doc(id).get();
                if (connDoc.exists) {
                    const connData = connDoc.data()!;
                    if (connData.type === 'project') {
                        projectContext += `\nProject: ${connData.data?.name}\nDescription: ${connData.data?.description}\n`;
                        if (connData.data?.notes) projectContext += `Notes: ${JSON.stringify(connData.data.notes).slice(0, 2000)}\n`;
                        if (connData.data?.tasks) projectContext += `Tasks: ${JSON.stringify(connData.data.tasks).slice(0, 1000)}\n`;
                    }
                }
            }

            // Enrich prompt using Gemini
            const basePrompt = nodeData.data?.prompt || '';
            const genaiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
            let enrichedPrompt = basePrompt;
            if (projectContext && basePrompt) {
                try {
                    const enrichResponse = await genaiClient.models.generateContent({
                        model: 'gemini-3.1-flash-lite-preview',
                        contents: { parts: [{ text: `You are a creative director. Based on the following project context, rewrite this vague instruction into a specific, detailed, actionable prompt for AI generation.\n\nProject Context:\n${projectContext}\n\nOriginal instruction: "${basePrompt}"\n\nReturn ONLY the refined prompt, no explanation.` }] }
                    });
                    enrichedPrompt = enrichResponse.candidates?.[0]?.content?.parts?.[0]?.text || basePrompt;
                } catch (e) { /* use raw prompt on failure */ }
            }

            // Execute the action based on subtype
            let result: any = null;
            const userId = nodeData.data?.targetUserId;
            const projectId = nodeData.data?.targetProjectId;

            try {
                const subtype = nodeData.subtype;
                if (subtype === 'generate_image') {
                    result = await executeTool('generate_image', { ...nodeData.data, prompt: enrichedPrompt, userId, projectId });
                } else if (subtype === 'generate_project_website') {
                    result = await executeTool('generate_project_website', { userId, projectId, prompt: enrichedPrompt });
                } else if (subtype === 'generate_canvas_website') {
                    result = await executeTool('generate_canvas_website', { userId, projectId, prompt: enrichedPrompt });
                } else if (subtype === 'generate_blog') {
                    const projectRef = db.collection('users').doc(userId).collection('projects').doc(projectId);
                    const projectDoc = await projectRef.get();
                    const pd = projectDoc.data() || {};
                    const context = `Project: ${pd.name}\nDescription: ${pd.description}`;
                    const genaiClientInner = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
                    const r = await genaiClientInner.models.generateContent({
                        model: 'gemini-3.1-pro-preview',
                        contents: { parts: [{ text: `Write a detailed, structured blog post about this topic. Context: ${context}\n\nPrompt: ${enrichedPrompt}\n\nReturn full markdown.` }] }
                    });
                    const blogText = r.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    result = { success: true, blog: blogText };
                    if (userId && projectId) {
                        await logProjectActivity(userId, projectId, 'blog_generated', `Generated canvas blog post: ${enrichedPrompt}`, { tags: ['blog', 'canvas'] });
                    }
                } else {
                    result = { error: `Unsupported action subtype: ${subtype}` };
                }

                await nodeRef.update({ status: 'done', result, enrichedPrompt, updatedAt: Date.now() });
                return { success: true, result };
            } catch (e: any) {
                await nodeRef.update({ status: 'error', result: { error: e.message }, updatedAt: Date.now() });
                return { error: e.message };
            }
        }

        // ── Activity Log ────────────────────────────────────────────────
        case 'get_recent_activity': {
            const limit = Math.min(Math.max(args.limit || 100, 1), 200);
            const userId: string | undefined = args.userId;

            let query: FirebaseFirestore.Query;
            if (userId) {
                // All activity for a specific user across their projects
                query = db.collectionGroup('activity')
                    .where('ownerUid', '==', userId)
                    .orderBy('timestamp', 'desc')
                    .limit(limit);
            } else {
                // All activity platform-wide
                query = db.collectionGroup('activity')
                    .orderBy('timestamp', 'desc')
                    .limit(limit);
            }

            const snap = await query.get();
            const activities: any[] = [];
            snap.forEach((doc) => {
                const d = doc.data();
                // Extract ownerUid and projectId from the document path
                // Path: users/{uid}/projects/{pid}/activity/{activityId}
                const pathParts = doc.ref.path.split('/');
                const ownerUid = pathParts.length >= 2 ? pathParts[1] : d.ownerUid || 'unknown';
                const projectId = pathParts.length >= 4 ? pathParts[3] : d.projectId || 'unknown';
                const tags = Array.isArray(d.metadata?.tags) ? d.metadata.tags : [];
                activities.push({
                    id: doc.id,
                    ownerUid,
                    projectId,
                    type: d.type,
                    description: d.description,
                    actorName: d.actorName,
                    timestamp: d.timestamp,
                    date: d.timestamp ? new Date(d.timestamp).toISOString() : null,
                    tags,
                });
            });

            // Format a human-readable timeline for the AI
            const timeline = activities.map((a) => {
                const date = a.date ? new Date(a.date).toLocaleString() : 'unknown time';
                const tagStr = a.tags.length > 0 ? ` [${a.tags.join(', ')}]` : '';
                return `[${date}] [user:${a.ownerUid.slice(0, 8)}] [project:${a.projectId.slice(0, 12)}] ${a.actorName || 'User'}: ${a.description}${tagStr}`;
            }).join('\n');

            return {
                count: activities.length,
                timeline,
                activities: activities.slice(0, 50), // Return raw data capped at 50 for API
            };
        }

        default:
            return { error: `Unknown tool: ${tool}` };
    }
}
