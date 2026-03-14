/**
 * services/agentService.ts
 *
 * Consolidated business logic for the AI Site Builder:
 * - GitHub OAuth flow helpers
 * - GitHub Git Database API (blobs, trees, commits)
 * - Vercel Project & Deployment management
 * - AI Code Generation (Gemini)
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { GoogleGenAI } from '@google/genai';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface ProjectAgent {
    name: string;
    expertise: string;
    approach: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;
const CALLBACK_URL = process.env.GITHUB_CALLBACK_URL || 'https://your-app.vercel.app/github/callback';
const SCOPES = 'repo user:email';

const DEFAULT_AGENT: ProjectAgent = {
    name: "Research Analyst",
    expertise: "Deep investigation, source evaluation, and knowledge synthesis",
    approach: "Methodical research with thorough analysis and evidence-based recommendations"
};

const MODEL_LITE = "gemini-2.0-flash-lite";
const MODEL_FALLBACK_LIST = ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash"];

/**
 * Helper to call Gemini with a fallback chain.
 */
async function callGeminiWithFallback(client: GoogleGenAI, contents: any, config: any) {
    let lastErr: any;
    for (const model of MODEL_FALLBACK_LIST) {
        try {
            console.log(`[agentService] Attempting AI generation with model: ${model}`);
            const response = await client.models.generateContent({
                model,
                contents: typeof contents === 'string' ? [{ role: 'user', parts: [{ text: contents }] }] : contents,
                config: {
                    maxOutputTokens: config.maxOutputTokens,
                    temperature: config.temperature,
                    responseMimeType: config.responseMimeType,
                    responseJsonSchema: config.responseJsonSchema,
                    systemInstruction: config.systemInstruction,
                    thinkingConfig: config.thinkingConfig,
                }
            });
            return response;
        } catch (err: any) {
            lastErr = err;
            console.warn(`[agentService] Model ${model} failed:`, err.message || err);
        }
    }
    throw new Error(`AI generation failed after trying all models. Last error: ${lastErr?.message || lastErr}`);
}

/**
 * Helper to call Gemini Stream with a fallback chain.
 */
async function* callGeminiStreamWithFallback(client: GoogleGenAI, contents: any, config: any) {
    let lastErr: any;
    for (const model of MODEL_FALLBACK_LIST) {
        try {
            console.log(`[agentService] Attempting AI stream with model: ${model}`);
            const stream = await client.models.generateContentStream({
                model,
                contents: typeof contents === 'string' ? [{ role: 'user', parts: [{ text: contents }] }] : contents,
                config: {
                    maxOutputTokens: config.maxOutputTokens,
                    temperature: config.temperature,
                    systemInstruction: config.systemInstruction,
                    thinkingConfig: config.thinkingConfig,
                }
            });
            for await (const chunk of stream) {
                yield chunk;
            }
            return; // Success
        } catch (err: any) {
            lastErr = err;
            console.warn(`[agentService] Model ${model} stream failed:`, err.message || err);
        }
    }
    throw new Error(`AI streaming failed after trying all models. Last error: ${lastErr?.message || lastErr}`);
}

// Standard GitHub API headers
// NOTE: User-Agent is REQUIRED by GitHub API — requests without it receive a 403.
const ghHeaders = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'FreshFront-AI-Agent/1.0',
});

// ─── Admin SDK ────────────────────────────────────────────────────────────────
export function adminApp() {
    if (getApps().length > 0) return getApps()[0];
    return initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    });
}

// ─── GitHub OAuth ─────────────────────────────────────────────────────────────
export function getGitHubAuthUrl(state: string, redirectUri?: string) {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri || CALLBACK_URL);
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('state', state);
    return url.toString();
}

export async function exchangeGitHubCode(code: string, redirectUri?: string) {
    const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            redirect_uri: redirectUri || CALLBACK_URL
        }),
    });
    const data = await res.json() as any;
    if (!data.access_token) throw new Error('No access token received');

    // FIX #4: Bearer (not the deprecated `token` prefix)
    const userRes = await fetch('https://api.github.com/user', { headers: ghHeaders(data.access_token) });
    const ghUser = await userRes.json() as any;
    return { token: data.access_token, username: ghUser.login };
}

// ─── Deployment Pipeline ──────────────────────────────────────────────────────

/** Fetch build log text for a deployment from Vercel's events API. */
async function fetchDeploymentBuildLogs(deploymentId: string): Promise<string> {
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const sep = teamQs ? '&' : '?';
    // Fetch backwards to ensure we get the actual errors at the end of the log
    const url = `https://api.vercel.com/v3/deployments/${deploymentId}/events${teamQs}${sep}direction=backward&limit=100&builds=1`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.VERCEL_PLATFORM_TOKEN}` } });
    if (!res.ok) return `[Could not fetch build logs: HTTP ${res.status}]`;
    const events = await res.json() as any[];
    // events are returned newest-first when direction=backward, so reverse them
    const lines = (Array.isArray(events) ? events : [])
        .filter((e: any) => e?.payload?.text)
        .map((e: any) => (e.payload.text as string).trim())
        .filter(Boolean)
        .reverse();
    const full = lines.join('\n');
    // Cap at ~8000 chars to stay within model context
    return full.length > 8000 ? full.slice(full.length - 8000) : full;
}

/** Poll until the deployment is READY or has ERROR'd. Times out after 10 minutes. */
async function waitForDeploymentReady(deploymentId: string): Promise<{ status: 'READY' | 'FAILED'; url?: string }> {
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const TERMINAL = new Set(['READY', 'ERROR', 'CANCELED']);
    for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const res = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}${teamQs}`, {
            headers: { Authorization: `Bearer ${process.env.VERCEL_PLATFORM_TOKEN}` },
        });
        if (!res.ok) continue;
        const d = await res.json() as any;
        const state: string = d.readyState || '';
        if (TERMINAL.has(state)) {
            return state === 'READY'
                ? { status: 'READY', url: d.url ? `https://${d.url}` : undefined }
                : { status: 'FAILED' };
        }
    }
    return { status: 'FAILED' }; // timed out
}

/** Ask AI to patch broken files given the build logs and full repository access. */
async function patchFilesFromBuildLogs(
    repoOwner: string,
    repoName: string,
    files: Record<string, string>,
    buildLogs: string,
    emit: (event: any) => Promise<void>
): Promise<Record<string, string>> {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
    // ── Pre-patch: Deterministically fix missing dependencies ───────────────
    const KNOWN_DEPS: Record<string, string> = {
        'autoprefixer': '^10.4.19',
        'postcss': '^8.4.38',
        'tailwindcss': '^3.4.1',
        '@tailwindcss/typography': '^0.5.13',
        'lucide-react': '^0.417.0',
        '@tanstack/react-table': '^8.17.3',
        'class-variance-authority': '^0.7.0',
        'clsx': '^2.1.1',
        'tailwind-merge': '^2.3.0',
        'react': '^18',
        'react-dom': '^18',
    };

    const missingModuleRegex = /(?:Cannot find module|Can't resolve) '([^']+)'/g;
    let match;
    const missingModules: string[] = [];
    while ((match = missingModuleRegex.exec(buildLogs)) !== null) {
        missingModules.push(match[1]);
    }

    if (missingModules.length > 0 && !files['package.json']) {
        const pkgContent = await getFileContent(repoOwner, repoName, 'package.json');
        if (pkgContent) files['package.json'] = pkgContent;
    }

    if (missingModules.length > 0 && files['package.json']) {
        try {
            const pkg = JSON.parse(files['package.json']);
            if (!pkg.dependencies) pkg.dependencies = {};
            let changed = false;

            for (const mod of missingModules) {
                // Get package root (e.g. '@tailwindcss/typography' not a sub-path)
                const pkgName = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0];
                if (!pkg.dependencies[pkgName]) {
                    pkg.dependencies[pkgName] = KNOWN_DEPS[pkgName] || 'latest';
                    changed = true;
                    console.log(`[agentService] Auto-injecting missing dependency: ${pkgName}`);
                }
            }
            if (changed) {
                files = { ...files, 'package.json': JSON.stringify(pkg, null, 2) };
            }
        } catch (e) {
            console.warn('[agentService] Failed to pre-patch package.json:', e);
        }
    }

    if (buildLogs.includes('autoprefixer')) {
        if (!files['package.json']) {
            const pkgContent = await getFileContent(repoOwner, repoName, 'package.json');
            if (pkgContent) files['package.json'] = pkgContent;
        }
        if (!files['postcss.config.js']) {
            const pcContent = await getFileContent(repoOwner, repoName, 'postcss.config.js');
            if (pcContent) files['postcss.config.js'] = pcContent;
        }

        if (files['package.json']) {
            // Double-check postcss.config.js if autoprefixer is missing or mentioned
            const correctPostcss = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};`;
            if (files['postcss.config.js'] !== correctPostcss) {
                files = { ...files, 'postcss.config.js': correctPostcss };
                console.log('[agentService] Auto-patching postcss.config.js for autoprefixer');
            }
        }
    }

    // ── Mid-patch: Identify and fetch broken files from repository ─────────
    await emit({ type: 'status', text: '🔍 Analyzing full repository tree for build errors...' });
    const fileTreeData = await getRepoFileTree(repoOwner, repoName);
    const filePaths = fileTreeData.filter(f => f.type === 'file').map(f => f.path);

    const identifyPrompt = `You are a Next.js build error investigator. A Vercel build has failed.

## Build Logs
\`\`\`
${buildLogs.length > 4000 ? buildLogs.slice(buildLogs.length - 4000) : buildLogs}
\`\`\`

## Full Repository File Tree
${filePaths.join('\n')}

## Task
Based on the build logs, identify WHICH specific files in the repository are most likely causing the error and need to be edited to fix it.
Return ONLY a JSON array of relative file paths.
Respond with raw JSON only (no markdown fences):
{"brokenFiles": ["path/to/file1.ts", "path/to/file2.tsx"]}

Rules:
- Only include files that actually exist in the file tree.
- Only include files that you need to read and modify to fix the errors.
- Do not include files that just appear in stack traces if they don't need modifications (e.g. node_modules or Next.js internals).`;

    let brokenFilesToFetch: string[] = [];
    try {
        const idRes = await callGeminiWithFallback(client, identifyPrompt, { maxOutputTokens: 2048, temperature: 0.1, thinkingConfig: { thinkingBudget: 1024 } });
        const idText = (idRes.text || '').trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
        const idMatch = idText.match(/\{[\s\S]*\}/);
        if (idMatch) {
            brokenFilesToFetch = JSON.parse(idMatch[0]).brokenFiles || [];
        }
    } catch (e) {
        console.warn('[agentService] Failed to identify broken files:', e);
    }

    if (brokenFilesToFetch.length > 0) {
        await emit({ type: 'status', text: `📥 Fetching code for ${brokenFilesToFetch.length} identified broken file(s)...` });
    }

    for (const path of brokenFilesToFetch) {
        if (!files[path] && filePaths.includes(path)) {
            const content = await getFileContent(repoOwner, repoName, path);
            if (content) {
                files[path] = content;
            }
        }
    }

    const fileList = Object.entries(files)
        .map(([p, c]) => `### ${p}\n\`\`\`\n${c.slice(0, 3000)}\n\`\`\``)
        .join('\n\n');

    const prompt = `You are an expert Next.js build error fixer. A Vercel build has failed.

## Build Logs (most recent errors)
\`\`\`
${buildLogs.length > 4000 ? buildLogs.slice(buildLogs.length - 4000) : buildLogs}
\`\`\`

## Current File Contents (including files identified as broken)
${fileList}

## Task
Return ONLY the files that need to be changed to fix these build errors.
Respond with raw JSON only (no markdown fences):
{"files": {"<relative-path>": "<complete-fixed-file-content>"}}

Rules:
- Only include files that are actually broken and need modification.
- Return the ENTIRE content of each changed file, not just the diff. Do NOT truncate.
- Do not change next.config.js.
- Fix import errors, missing types, syntax errors, and undefined variables.`;

    try {
        const response = await callGeminiWithFallback(client, prompt, { maxOutputTokens: 32768, temperature: 0.1, thinkingConfig: { thinkingBudget: 4096 } });
        const text = (response.text || '').trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return files;
        const parsed = JSON.parse(jsonMatch[0]);
        const patches: Record<string, string> = parsed.files || {};
        return { ...files, ...patches };
    } catch (e) {
        console.warn('[agentService] patchFilesFromBuildLogs failed:', e);
        return files;
    }
}

export async function fetchPexelsImages(query: string, count = 3): Promise<string[]> {
    if (!query) return [];
    try {
        const apiKey = process.env.PEXELS_API_KEY;
        if (!apiKey) return [];
        const encodedQuery = encodeURIComponent(query);
        const url = `https://api.pexels.com/v1/search?query=${encodedQuery}&per_page=${count}&orientation=landscape`;
        const res = await fetch(url, { headers: { Authorization: apiKey } });
        if (!res.ok) return [];
        const data = await res.json() as any;
        return (data.photos || [])
            .map((p: any) => p?.src?.landscape || p?.src?.large)
            .filter(Boolean);
    } catch (e) {
        console.warn('Pexels search failed =', e);
        return [];
    }
}

/**
 * Shared deploy-with-auto-fix loop.
 * Pushes files, waits for Vercel to build, auto-patches on failure, retries.
 */
async function deployWithAutoFix({
    emit, ghToken, vercelToken, teamQs,
    repoOwner, repoName, vercelProjectId,
    initialFiles, previewHtml, isUpdate,
}: any): Promise<{ deploymentId?: string; previewUrl?: string; commitSha?: string }> {
    const MAX_RETRIES = 3;
    let files: Record<string, string> = { ...initialFiles };
    let lastCommitSha: string | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const allFiles = { ...files, 'public/preview.html': previewHtml };

        await emit({ type: 'status', text: attempt === 0 ? '📤 Pushing code to GitHub...' : `📤 Pushing fix (attempt ${attempt + 1})...` });
        const pushResult = await pushFilesToRepo({ token: ghToken, owner: repoOwner, repo: repoName, files: allFiles, isUpdate: attempt > 0 ? true : isUpdate });
        lastCommitSha = pushResult?.sha;

        await emit({ type: 'status', text: `⏳ Vercel is building${attempt > 0 ? ` (fix #${attempt})` : ''}...` });
        // Give Vercel's GitHub integration a moment to detect the push
        await new Promise(r => setTimeout(r, 8000));

        const latestDeploy = await getLatestDeploymentForProject({ token: vercelToken, teamQs, vercelProjectId });
        if (!latestDeploy?.uid) {
            console.warn('[agentService] No deployment found yet, waiting longer...');
            await new Promise(r => setTimeout(r, 10000));
            const retry = await getLatestDeploymentForProject({ token: vercelToken, teamQs, vercelProjectId });
            if (!retry?.uid) throw new Error('Vercel deployment not found after push.');
        }

        const deploymentId = latestDeploy?.uid;
        const buildResult = await waitForDeploymentReady(deploymentId);

        if (buildResult.status === 'READY') {
            await emit({ type: 'status', text: '✅ Build succeeded!' });
            return { deploymentId, previewUrl: buildResult.url, commitSha: lastCommitSha };
        }

        if (attempt < MAX_RETRIES - 1) {
            await emit({ type: 'status', text: `❌ Build failed — fetching logs to auto-fix (attempt ${attempt + 1}/${MAX_RETRIES})...` });
            const logs = await fetchDeploymentBuildLogs(deploymentId);
            await emit({ type: 'logs', text: logs.slice(0, 2000) }); // surface a snippet to the UI
            files = await patchFilesFromBuildLogs(repoOwner, repoName, files, logs, emit);
            await emit({ type: 'status', text: '🔧 AI patch generated — re-pushing...' });
        } else {
            throw new Error(`Build failed after ${MAX_RETRIES} attempts. Check the Vercel dashboard for details.`);
        }
    }
    throw new Error('Unexpected end of deploy loop.');
}

export async function runDeployPipeline({ uid, projectId, userPrompt, existingConfig, isRedeploy, onProgress, appUrl }: any) {
    const emit = async (event: Record<string, any>) => { try { await onProgress?.(event); } catch { } };

    const ghToken = process.env.GITHUB_PLATFORM_TOKEN!;
    const vercelToken = process.env.VERCEL_PLATFORM_TOKEN!;
    const teamId = process.env.VERCEL_TEAM_ID;
    const teamQs = teamId ? `?teamId=${teamId}` : '';

    const db = getFirestore(adminApp());
    const projectDoc = await db.doc(`users/${uid}/projects/${projectId}`).get();
    if (!projectDoc.exists) throw new Error('Project not found');
    const project = projectDoc.data()!;

    const platformGhUser = await getPlatformGhUsername(ghToken);
    const repoName = (isRedeploy && existingConfig?.githubRepoName
        ? existingConfig.githubRepoName
        : `${uid.slice(0, 8)}-${sanitizeRepoName(project.name)}`).toLowerCase();
    const repoOwner = platformGhUser;

    // ── Multi-Agent Orchestration ──────────────────────────────────────────────
    const isExistingDeploy = isRedeploy && existingConfig?.githubRepoUrl;

    if (isExistingDeploy) {
        // 1. ORCHESTRATOR — classify intent
        await emit({ type: 'status', text: '🎯 Analyzing your request...' });
        await emit({ type: 'agentStep', agent: 'orchestrator', status: 'active' });

        const fileTreeData = await getRepoFileTree(repoOwner, repoName);
        const filePaths = fileTreeData.filter(f => f.type === 'file').map(f => f.path);

        const intent = await classifyUserIntent(userPrompt, true, filePaths);
        await emit({ type: 'status', text: `🎯 Intent: ${intent.intent} — ${intent.reasoning}` });
        await emit({ type: 'agentStep', agent: 'orchestrator', status: 'done', result: intent });

        // 2. KNOWLEDGE MANAGER — build enriched context
        await emit({ type: 'agentStep', agent: 'knowledge', status: 'active' });
        const contextSummary = buildProjectKnowledge(project, fileTreeData);
        await emit({ type: 'agentStep', agent: 'knowledge', status: 'done' });

        let enrichedContext = contextSummary;
        if (intent.imageSearchQuery) {
            await emit({ type: 'status', text: `🎨 Designer agent fetching images for "${intent.imageSearchQuery}"...` });
            await emit({ type: 'agentStep', agent: 'designer', status: 'active' });
            const images = await fetchPexelsImages(intent.imageSearchQuery, 4);
            await emit({ type: 'agentStep', agent: 'designer', status: 'done' });
            if (images.length > 0) {
                enrichedContext += `\n\n### Designer Agent Provided Images\nThe Designer Agent found these high-quality stock photos matching the user's request. You MUST use these exact URLs in your code where appropriate:\n${images.map(img => `- ${img}`).join('\n')}`;
            }
        }

        let files: Record<string, string>;
        let previewHtml: string;

        if (intent.intent === 'chat') {
            // Pure conversation — don't redeploy
            await emit({ type: 'status', text: '💬 This looks like a question, not a change request.' });
            await emit({ type: 'done', chat: true, message: 'No deployment changes needed for this request.' });
            return { chat: true };
        }

        // 3. ENGINEER — generate changes (per-file for edits, full for major plan changes)
        await emit({ type: 'agentStep', agent: 'engineer', status: 'active' });

        if (intent.intent === 'edit' || intent.intent === 'restyle' || intent.intent === 'debug') {
            // Per-file editing: only change what's needed
            await emit({ type: 'status', text: '🛠️ Engineering targeted changes...' });
            files = await generateFileChanges(
                enrichedContext, userPrompt, repoOwner, repoName, intent.targetFiles, emit
            );
            // Generate preview HTML in parallel
            previewHtml = await generatePreviewHtml(enrichedContext, userPrompt);
        } else {
            // Full generation for major planning/restructuring
            await emit({ type: 'status', text: '🧠 Generating complete app update...' });
            [files, previewHtml] = await Promise.all([
                generateNextJsApp(enrichedContext, userPrompt),
                generatePreviewHtml(enrichedContext, userPrompt),
            ]);
        }

        // Always ensure safe next.config.js
        files['next.config.js'] = `/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },
};
module.exports = nextConfig;
`;

        const changedFiles = Object.keys(files);
        await emit({ type: 'agentStep', agent: 'engineer', status: 'done', changedFiles });
        await emit({ type: 'preview', html: previewHtml });

        // 4. DEPLOY
        await emit({ type: 'agentStep', agent: 'deploy', status: 'active' });
        const { deploymentId, previewUrl, commitSha } = await deployWithAutoFix({
            emit, ghToken, vercelToken, teamQs,
            repoOwner, repoName,
            vercelProjectId: existingConfig.vercelProjectId,
            initialFiles: files, previewHtml, isUpdate: true,
        });
        await emit({ type: 'agentStep', agent: 'deploy', status: 'done' });

        const result = {
            repoUrl: `https://github.com/${repoOwner}/${repoName}`,
            repoName, repoOwner,
            vercelProjectId: existingConfig.vercelProjectId,
            deploymentId, previewUrl, previewHtml, commitSha, changedFiles,
        };
        await emit({ type: 'done', ...result });
        return result;
    }

    // ── FRESH DEPLOY PATH ────────────────────────────────────────────────────────
    await emit({ type: 'status', text: '🎯 Analyzing your request...' });
    await emit({ type: 'agentStep', agent: 'orchestrator', status: 'active' });
    const intent = await classifyUserIntent(userPrompt, false, []);
    await emit({ type: 'agentStep', agent: 'orchestrator', status: 'done', result: intent });

    await emit({ type: 'agentStep', agent: 'knowledge', status: 'active' });
    const contextSummary = buildProjectKnowledge(project);
    await emit({ type: 'agentStep', agent: 'knowledge', status: 'done' });

    let enrichedContext = contextSummary;
    if (intent.imageSearchQuery) {
        await emit({ type: 'status', text: `🎨 Designer agent fetching images for "${intent.imageSearchQuery}"...` });
        await emit({ type: 'agentStep', agent: 'designer', status: 'active' });
        const images = await fetchPexelsImages(intent.imageSearchQuery, 4);
        await emit({ type: 'agentStep', agent: 'designer', status: 'done' });
        if (images.length > 0) {
            enrichedContext += `\n\n### Designer Agent Provided Images\nThe Designer Agent found these high-quality stock photos matching the user's request. You MUST use these exact URLs in your code for visual appeal:\n${images.map(img => `- ${img}`).join('\n')}`;
        }
    }

    await emit({ type: 'agentStep', agent: 'engineer', status: 'active' });
    await emit({ type: 'status', text: '🧠 Generating your app with AI...' });
    const [files, previewHtml] = await Promise.all([
        generateNextJsApp(enrichedContext, userPrompt),
        generatePreviewHtml(enrichedContext, userPrompt),
    ]);

    // Always ensure safe next.config.js
    files['next.config.js'] = `/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },
};
module.exports = nextConfig;
`;
    const changedFiles = Object.keys(files);
    await emit({ type: 'agentStep', agent: 'engineer', status: 'done', changedFiles });
    await emit({ type: 'preview', html: previewHtml });

    await emit({ type: 'agentStep', agent: 'deploy', status: 'active' });
    await emit({ type: 'status', text: '📁 Creating GitHub repository...' });
    await createGithubRepo({ token: ghToken, repoName, owner: repoOwner });

    if (appUrl && !appUrl.includes('localhost')) {
        const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || 'dev_secret';
        await createGithubWebhook({
            token: ghToken, owner: repoOwner, repo: repoName,
            webhookUrl: `${appUrl}/api/agent?op=github-webhook`, secret: webhookSecret
        });
    }

    await emit({ type: 'status', text: '🔗 Setting up Vercel project...' });
    const vProj = await createVercelProject({ token: vercelToken, teamQs, projectName: repoName, repoOwner, repoName });
    const vercelProjectId = vProj.id;

    await setVercelEnvVars({
        token: vercelToken, teamQs, vercelProjectId,
        envVars: [
            { key: 'NEXT_PUBLIC_PROJECT_ID', value: projectId, target: ['production', 'preview'], type: 'plain' },
            { key: 'NEXT_PUBLIC_PROJECT_NAME', value: project.name, target: ['production', 'preview'], type: 'plain' },
        ]
    });

    const { deploymentId, previewUrl } = await deployWithAutoFix({
        emit, ghToken, vercelToken, teamQs,
        repoOwner, repoName, vercelProjectId,
        initialFiles: files, previewHtml, isUpdate: false,
    });
    await emit({ type: 'agentStep', agent: 'deploy', status: 'done' });

    const result = {
        repoUrl: `https://github.com/${repoOwner}/${repoName}`,
        repoName, repoOwner, vercelProjectId,
        deploymentId, previewUrl, previewHtml, changedFiles,
    };
    await emit({ type: 'done', ...result });
    return result;
}

export async function transferRepoToUser({ uid, projectId }: any) {
    const db = getFirestore(adminApp());
    const ghToken = process.env.GITHUB_PLATFORM_TOKEN!;

    const userDoc = await db.doc(`users/${uid}`).get();
    const { githubAccessToken: userToken, githubUsername: userGhUsername } = userDoc.data() || {};
    if (!userToken || !userGhUsername) throw new Error('Connect your GitHub account first.');

    const projectDoc = await db.doc(`users/${uid}/projects/${projectId}`).get();
    const deploy = projectDoc.data()?.deployConfig;
    if (!deploy?.githubRepoName || !deploy?.githubRepoOwner) throw new Error('No deployed repo found.');

    const res = await fetch(`https://api.github.com/repos/${deploy.githubRepoOwner}/${deploy.githubRepoName}/transfer`, {
        method: 'POST',
        headers: ghHeaders(ghToken),
        body: JSON.stringify({ new_owner: userGhUsername }),
    });
    if (!res.ok) throw new Error((await res.json() as any).message || 'Transfer failed');

    // Attempt to auto-accept the transfer invitation using the user's token
    try {
        const invRes = await fetch('https://api.github.com/user/repository_invitations', { headers: ghHeaders(userToken) });
        if (invRes.ok) {
            const invitations = await invRes.json() as any[];
            const targetInv = invitations.find((inv: any) => inv.repository.full_name === `${deploy.githubRepoOwner}/${deploy.githubRepoName}`);
            if (targetInv) {
                await fetch(`https://api.github.com/user/repository_invitations/${targetInv.id}`, {
                    method: 'PATCH',
                    headers: ghHeaders(userToken)
                });
                console.log(`[transferRepoToUser] Auto-accepted transfer invitation ${targetInv.id} for ${userGhUsername}`);
            }
        }
    } catch (e) {
        console.warn('[transferRepoToUser] Failed to auto-accept repo transfer, user may need to accept via email:', e);
    }

    return { success: true, newRepoUrl: `https://github.com/${userGhUsername}/${deploy.githubRepoName}`, newOwner: userGhUsername };
}

// ─── AI Assistant Classification ──────────────────────────────────────────────
export async function classifyProjectAgent(name: string, description: string): Promise<ProjectAgent> {
    const projectName = (name || "").trim();
    const projectDesc = (description || "").trim();
    if (!projectName && !projectDesc) return { ...DEFAULT_AGENT };

    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });

    const schema = {
        type: "object",
        properties: {
            name: { type: "string", description: "A concise professional role title (2-3 words max). Examples: 'Marketing Strategist', 'Software Engineer', 'Creative Director', 'Data Analyst', 'Content Strategist', 'UX Designer', 'Brand Manager'." },
            expertise: { type: "string", description: "A one-sentence description of the domain expertise most relevant to this specific project." },
            approach: { type: "string", description: "A one-sentence description of how this agent approaches tasks and advises the user on this project." }
        },
        required: ["name", "expertise", "approach"],
        additionalProperties: false
    };

    try {
        const response = await callGeminiWithFallback(client, [{
            role: 'user', parts: [{
                text: `You are assigning a professional AI assistant role to a project management workspace. 
            Project Name: "${projectName}"
            Project Description: "${projectDesc}"
            Return the role as JSON.` }]
        }], {
            temperature: 0.3,
            maxOutputTokens: 200,
            responseMimeType: "application/json",
            responseJsonSchema: schema as any
        });

        const text = (response.text || "").trim();
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return { ...DEFAULT_AGENT };

        const parsed = JSON.parse(match[0]);
        return {
            name: String(parsed?.name || "").trim() || DEFAULT_AGENT.name,
            expertise: String(parsed?.expertise || "").trim() || DEFAULT_AGENT.expertise,
            approach: String(parsed?.approach || "").trim() || DEFAULT_AGENT.approach
        };
    } catch (e) {
        console.error("[agentService] Failed to classify project agent:", e);
        return { ...DEFAULT_AGENT };
    }
}

export function getAgentSystemPromptBlock(agent: ProjectAgent | undefined): string {
    if (!agent || !agent.name) {
        return "You are an elite AI Research Assistant with deep knowledge of the user's project.";
    }
    return `You are **${agent.name}**, an elite AI assistant embedded in the user's project workspace. 
    Your Expertise: ${agent.expertise}
    Your Approach: ${agent.approach}`;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * FIX #2: Full blueprint-compliant system prompt with deterministic component mapping.
 */
async function generateNextJsApp(context: string, userPrompt: string): Promise<Record<string, string>> {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });

    const systemPrompt = `You are an expert Next.js developer and UI engineer. Generate a complete, production-ready Next.js 14 App Router application from the project data provided.

## Output Format
Respond with ONLY raw JSON — no markdown fences, no explanation:
{"files": {"<relative-path>": "<file-content-string>"}}

Always include: package.json, tsconfig.json, next.config.js, tailwind.config.ts, postcss.config.js, app/layout.tsx, app/page.tsx, app/globals.css, lib/data.ts.

## Tech Stack (NON-NEGOTIABLE)
- Next.js 14 App Router, TypeScript ("use client" only where required)
- Tailwind CSS for all styles — no inline styles
- Lucide React for all icons
- shadcn/ui primitives: Button, Card, Badge, Sheet, Table, Tabs
- TanStack Table v8 for any data grids

## Component Mapping Rules (DETERMINISTIC — follow exactly)
1. researchSessions → Dynamic article pages at app/research/[id]/page.tsx using @tailwindcss/typography prose classes
2. tables (TableAsset) → TanStack Table with shadcn/ui Table styling, client-side sort/filter/pagination ("use client")
3. notes → shadcn/ui Sheet (off-canvas overlay) opened from a persistent sidebar icon button
4. tasks → Kanban columns (todo / in-progress / done) built from shadcn/ui Card; completed tasks have line-through
5. Project name + description → Full-width hero on app/page.tsx with gradient background
6. knowledgeBase files → /library route listing files by type with Lucide file-type icons
7. All project data → embedded as a static const in lib/data.ts (no API calls in this MVP)
8. uploadedFiles with a url → Use the actual URL in <img>, <video>, or <a> tags. NEVER use placeholder images when real asset URLs are provided.
9. generatedImages → Display in an image gallery section using the real url values — use <img src={img.url} /> directly.
10. generatedVideos → Embed using <video src={v.url} controls /> with poster={v.thumbnailUrl} if available.

## Design Rules
- Dark mode by default via CSS variables in globals.css
- All colors as HSL CSS vars — never raw Tailwind color names
- Responsive mobile-first layout with a collapsible left sidebar
- Smooth transitions: transition-all duration-200 on all interactive elements
- animate-pulse skeleton placeholders on any loading states

## package.json
Must include: next@14, react@18, react-dom@18, typescript, tailwindcss, postcss, autoprefixer, @tailwindcss/typography, @types/react, @types/node, lucide-react, @tanstack/react-table, class-variance-authority, clsx, tailwind-merge.

## 1. Supabase Authentication & Management API
If the user wants to add authentication:
- Use \`@supabase/supabase-js\` and \`@supabase/ssr\`.
- Tell the user to add \`NEXT_PUBLIC_SUPABASE_URL\` and \`NEXT_PUBLIC_SUPABASE_ANON_KEY\` to .env.
- Provide a lib/supabase.ts with \`createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)\`.
- Provide middleware.ts using \`createServerClient\`.
- To create/manage projects programmatically, they can use the Management API (https://api.supabase.com/v1/projects) with a Personal Access Token in the \`Authorization: Bearer <token>\` header.

## 2. Stripe Subscriptions
If the user wants to add payments or subscriptions:
- Use \`stripe\` for the server, and \`@stripe/stripe-js\` for the client.
- Tell the user to add \`STRIPE_SECRET_KEY\` and \`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY\` to .env.
- Create an app/api/checkout/route.ts to create a Checkout Session: \`stripe.checkout.sessions.create({ mode: 'subscription', line_items: [{ price: priceId, quantity: 1 }], success_url: '...', cancel_url: '...' })\`
- Handle webhooks in app/api/webhooks/stripe/route.ts using \`stripe.webhooks.constructEvent\`.
- For test mode, use card 4242 4242 4242 4242.

## 3. Gemini AI Features
If the user wants to add AI generation, chatbots, etc.:
- Use \`@google/genai\`.
- Tell the user to add \`GEMINI_API_KEY\` to .env.
- Server-side route (e.g., app/api/chat/route.ts): \`const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }); const response = await ai.models.generateContent({ model: 'gemini-2.0-flash', contents: '...' });\`
- Never expose the GEMINI_API_KEY to the client-side code directly.
`;

    const response = await callGeminiWithFallback(client, `Project Data:\n${context}\n\nUser Request: "${userPrompt}"\n\nGenerate the complete Next.js application now.`, {
        systemInstruction: systemPrompt,
        maxOutputTokens: 65536,
        thinkingConfig: { thinkingBudget: 16384 }
    });

    const text = (response.text || '').trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI did not return valid JSON. Raw output: ' + text.slice(0, 300));
    const parsed = JSON.parse(match[0]);

    // Accept both {"files": {...}} and a flat file map {"package.json": "..."}
    if (parsed.files && typeof parsed.files === 'object') return parsed.files as Record<string, string>;
    // If the root object looks like a file map (values are strings), use it directly
    const values = Object.values(parsed);
    if (values.length > 0 && values.every(v => typeof v === 'string')) return parsed as Record<string, string>;
    throw new Error('AI returned JSON but could not find file map. Keys: ' + Object.keys(parsed).join(', '));
}

/**
 * Engineer Agent: per-file change generator.
 * Reads existing files from GitHub and generates only the files that need to change.
 * Much faster than full regeneration for iterative edits.
 */
async function generateFileChanges(
    context: string,
    userPrompt: string,
    repoOwner: string,
    repoName: string,
    targetFiles: string[],
    emit: (event: Record<string, any>) => Promise<void>
): Promise<Record<string, string>> {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });

    // Read current content of target files (or all key files if none specified)
    const filesToRead = targetFiles.length > 0 ? targetFiles : [];
    if (filesToRead.length === 0) {
        // Fetch the file tree to identify key files
        const tree = await getRepoFileTree(repoOwner, repoName);
        const keyPatterns = ['page.tsx', 'layout.tsx', 'globals.css', 'data.ts', 'package.json'];
        for (const f of tree) {
            if (f.type === 'file' && keyPatterns.some(p => f.path.endsWith(p))) {
                filesToRead.push(f.path);
            }
        }
        if (filesToRead.length === 0) {
            filesToRead.push(...tree.filter(f => f.type === 'file').slice(0, 10).map(f => f.path));
        }
    }

    await emit({ type: 'status', text: `📖 Reading ${filesToRead.length} existing files...` });

    const existingContents: Record<string, string> = {};
    await Promise.all(
        filesToRead.map(async (path) => {
            const content = await getFileContent(repoOwner, repoName, path);
            if (content) existingContents[path] = content;
        })
    );

    // Build a summary of existing files for the AI
    const existingFileSummary = Object.entries(existingContents)
        .map(([path, content]) => {
            const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n// ... truncated' : content;
            return `=== ${path} ===\n${truncated}`;
        })
        .join('\n\n');

    await emit({ type: 'status', text: '🛠️ Engineering file changes...' });

    const systemPrompt = `You are an expert Next.js developer. You are making targeted changes to an existing deployed project.

## Rules
1. Return ONLY the files that need to change. Do NOT return unchanged files.
2. For each changed file, return the COMPLETE new content (not a diff).
3. If you need to create new files, include them. 
4. If you need to DELETE a file, include it in the JSON with a value of \`null\`.
5. Respond with ONLY raw JSON — no markdown fences:
{"files": {"<relative-path>": "<complete-file-content>"}}

## INTEGRATION RULES
If the user asks to add Authentication, use Supabase Auth (@supabase/supabase-js, @supabase/ssr). The user must add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env. Provide a lib/supabase.ts with \`createBrowserClient\` and middleware.ts with \`createServerClient\`.
If the user asks to add Payments/Subscriptions, use Stripe (stripe, @stripe/stripe-js). Provide app/api/checkout/route.ts checking out to Stripe, and app/api/webhooks/stripe/route.ts to handle webhooks. Tell the user to add STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
If the user asks to add AI features, use Google Gemini API (@google/genai). Provide app/api/ai/chat/route.ts using \`const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })\`. Tell the user to add GEMINI_API_KEY.

## Current Files
${existingFileSummary}`;

    const response = await callGeminiWithFallback(client, `Project Context:\n${context}\n\nUser Request: "${userPrompt}"\n\nGenerate only the changed files.`, {
        systemInstruction: systemPrompt,
        maxOutputTokens: 65536,
        thinkingConfig: { thinkingBudget: 8192 }
    });

    const text = (response.text || '').trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI did not return valid JSON for file changes');
    const parsed = JSON.parse(match[0]);

    if (parsed.files && typeof parsed.files === 'object') return parsed.files as Record<string, string>;
    const values = Object.values(parsed);
    if (values.length > 0 && values.every(v => typeof v === 'string')) return parsed as Record<string, string>;
    throw new Error('Could not parse file changes from AI response');
}

/**
 * Generate a standalone single-file HTML preview of the project interface.
 * Uses Tailwind CDN so no build step needed — renders immediately in an iframe.
 * Uses generateContentStream to collect tokens as they arrive for faster delivery.
 */
async function generatePreviewHtml(context: string, userPrompt: string): Promise<string> {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });
    const stream = callGeminiStreamWithFallback(client, `Project Data:\n${context}\n\nUser Request: "${userPrompt}"\n\nGenerate the preview HTML now.`, {
        maxOutputTokens: 16384,
        systemInstruction: `You are a UI engineer. Generate a SINGLE self-contained index.html file that visually previews the project described in the data.

Rules:
- Use Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Use real asset URLs from uploadedFiles/generatedImages where available — embed them in <img> tags directly.
- Dark mode design: bg-gray-950 text-white, vibrant accent colors.
- Sections: Hero (project name + description), Images gallery (if any), Key data highlights.
- Must be fully self-contained HTML — no external JS frameworks, no module imports.
- Respond with ONLY the raw HTML — no markdown fences, no explanation, starting with <!DOCTYPE html>.`,
    });
    let html = '';
    for await (const chunk of stream) {
        html += chunk.text || '';
    }
    return html.trim().replace(/^```html\n?/i, '').replace(/\n?```$/i, '');
}

/**
 * FIX #1: Rich context — includes research sessions (with tables preview), notes, tasks, knowledge base.
 */
function buildContextSummary(project: any): string {
    const snippet = (s: string | undefined, max = 500) =>
        s ? (s.length > max ? s.slice(0, max) + '…' : s) : '';

    const sessions = (project.researchSessions || []).slice(0, 5).map((s: any) => ({
        id: s.id,
        topic: s.topic,
        tldr: snippet(s.researchReport?.tldr),
        slidesCount: (s.researchReport?.slides || []).length,
        tables: (s.researchReport?.tables || []).slice(0, 2).map((t: any) => ({
            title: t.title,
            columns: (t.columns || []).slice(0, 8),
            rowCount: (t.rows || []).length,
            previewRows: (t.rows || []).slice(0, 3),
        })),
        timestamp: s.timestamp,
    }));

    return JSON.stringify({
        name: project.name,
        description: project.description,
        researchSessions: sessions,
        notes: (project.notes || []).slice(0, 10).map((n: any) => ({
            id: n.id, title: n.title, preview: snippet(n.content, 200), color: n.color,
        })),
        tasks: (project.tasks || []).slice(0, 20).map((t: any) => ({
            id: t.id, title: t.title, status: t.status, priority: t.priority,
            description: snippet(t.description, 150),
        })),
        knowledgeBase: (project.knowledgeBase || []).slice(0, 10).map((f: any) => ({
            name: f.name, type: f.type, summary: snippet(f.summary, 200),
            url: f.url || f.blobUrl || null,
        })),
        // Uploaded files — include public URL so AI can reference them directly in the site
        uploadedFiles: (project.uploadedFiles || []).slice(0, 20).map((f: any) => ({
            name: f.displayName || f.name,
            mimeType: f.mimeType,
            url: f.url || f.blobUrl || null,         // Vercel Blob / Firebase Storage URL
            summary: snippet(f.summary, 150),
        })).filter((f: any) => f.url), // Only include assets that have a usable public URL
        // Generated images from the project
        generatedImages: (project.generatedImages || project.images || []).slice(0, 20).map((img: any) => ({
            url: img.url || img.blobUrl || img.imageUrl || null,
            prompt: snippet(img.prompt || img.description, 100),
            name: img.name || img.displayName || null,
        })).filter((img: any) => img.url),
        // Generated videos
        generatedVideos: (project.generatedVideos || project.videos || []).slice(0, 10).map((v: any) => ({
            url: v.url || v.blobUrl || v.videoUrl || null,
            name: v.name || v.displayName || null,
            thumbnailUrl: v.thumbnailUrl || null,
        })).filter((v: any) => v.url),
    }, null, 0);
}

async function createGithubRepo({ token, repoName, owner }: any) {
    const h = ghHeaders(token);
    const base = `https://api.github.com/repos/${owner}/${repoName}`;

    // Create the repo (auto_init:true requests an initial README commit)
    const res = await fetch('https://api.github.com/user/repos', {
        method: 'POST', headers: h,
        body: JSON.stringify({ name: repoName, private: true, auto_init: true }),
    });
    if (!res.ok && res.status !== 422) {
        const err = await res.json() as any;
        throw new Error(`Failed to create GitHub repo "${repoName}": ${err.message || res.status}`);
    }

    // Whether the repo was just created or already existed, guarantee the main branch
    // has at least one commit using the Contents API (works on empty repos too).
    // This is idempotent — GitHub will 422 if README.md already exists, which is fine.
    const initRes = await fetch(`${base}/contents/README.md`, {
        method: 'PUT', headers: h,
        body: JSON.stringify({
            message: 'chore: Initialize repository',
            content: Buffer.from(`# ${repoName}\nAI-generated site.`).toString('base64'),
        }),
    });
    // 201 = created, 422 = file already exists (repo already initialized) — both are fine
    if (!initRes.ok && initRes.status !== 422) {
        const err = await initRes.json() as any;
        throw new Error(`Failed to initialize repo "${repoName}": ${err.message || initRes.status}`);
    }

    // Poll until the main ref is visible in the git database (usually <3s)
    for (let i = 0; i < 10; i++) {
        const refRes = await fetch(`${base}/git/refs/heads/main`, { headers: h });
        if (refRes.ok) return; // ref confirmed — git DB is ready
        await new Promise(r => setTimeout(r, 1500));
    }
    throw new Error(`Timed out waiting for repo "${repoName}" to initialize on GitHub.`);
}

export async function createGithubWebhook({ token, owner, repo, webhookUrl, secret }: any) {
    const h = ghHeaders(token);
    const base = `https://api.github.com/repos/${owner}/${repo}/hooks`;

    const listRes = await fetch(base, { headers: h });
    if (listRes.ok) {
        const hooks = await listRes.json();
        const existing = hooks.find((h: any) => h.config?.url === webhookUrl);
        if (existing) return;
    }

    const res = await fetch(base, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
            name: 'web',
            active: true,
            events: ['push'],
            config: {
                url: webhookUrl,
                content_type: 'json',
                insecure_ssl: '0',
                secret: secret
            }
        })
    });

    if (!res.ok) {
        const err = await res.json() as any;
        console.error(`Failed to create webhook for ${repo}: ${err.message || res.status}`);
    }
}

async function pushFilesToRepo({ token, owner, repo, files, isUpdate }: any) {
    const base = `https://api.github.com/repos/${owner}/${repo}`;
    const h = ghHeaders(token);

    // Wait until main ref is confirmed ready (should already be from createGithubRepo's poll,
    // but guard here too in case pushFilesToRepo is called standalone on a re-deploy).
    let parentSha: string | undefined;
    let baseTreeSha: string | undefined;
    for (let i = 0; i < 12; i++) {
        const refRes = await fetch(`${base}/git/refs/heads/main`, { headers: h });
        if (refRes.ok) {
            const ref = await refRes.json() as any;
            parentSha = ref.object?.sha;
            if (parentSha) {
                const c = await (await fetch(`${base}/git/commits/${parentSha}`, { headers: h })).json() as any;
                baseTreeSha = c.tree?.sha;
            }
            break;
        }
        console.log(`[agentService] Waiting for main ref to appear (attempt ${i + 1}/12)...`);
        await new Promise(r => setTimeout(r, 2000));
    }
    if (!parentSha) {
        throw new Error(`Repository "${repo}" has no commits after waiting. Cannot push files.`);
    }

    // Step 1: Create blobs (sequentially to avoid rate limiting)
    const blobs: any[] = [];
    for (const [path, content] of Object.entries(files)) {
        // If content is null or explicitly marked for deletion via empty string (in some contexts),
        // we skip blob creation and pass sha: null to delete the file from the tree.
        if (content === null || content === undefined) {
            blobs.push({ path, mode: '100644', type: 'blob', sha: null });
            continue;
        }

        const res = await fetch(`${base}/git/blobs`, {
            method: 'POST', headers: h,
            body: JSON.stringify({ content, encoding: 'utf-8' }),
        });
        const b = await res.json() as any;
        if (!b.sha) throw new Error(`Blob creation failed for "${path}": ${JSON.stringify(b)}`);
        blobs.push({ path, sha: b.sha, mode: '100644', type: 'blob' });
    }

    // Step 2: Create tree
    const treePayload: any = { tree: blobs };
    if (baseTreeSha) {
        treePayload.base_tree = baseTreeSha;
    }

    const tree = await (await fetch(`${base}/git/trees`, {
        method: 'POST', headers: h,
        body: JSON.stringify(treePayload),
    })).json() as any;
    if (!tree.sha) throw new Error(`Tree creation failed: ${JSON.stringify(tree)}`);

    // Step 3: Create commit
    const commit = await (await fetch(`${base}/git/commits`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
            message: isUpdate ? 'feat: Update AI-generated Next.js app' : 'feat: Initial AI-generated Next.js app',
            tree: tree.sha,
            parents: parentSha ? [parentSha] : [],
        }),
    })).json() as any;
    if (!commit.sha) throw new Error(`Commit creation failed: ${JSON.stringify(commit)}`);

    // Step 4: Update or create the branch reference
    const refUrl = `${base}/git/refs/heads/main`;
    if ((await fetch(refUrl, { headers: h })).ok) {
        await fetch(refUrl, { method: 'PATCH', headers: h, body: JSON.stringify({ sha: commit.sha, force: true }) });
    } else {
        await fetch(`${base}/git/refs`, { method: 'POST', headers: h, body: JSON.stringify({ ref: 'refs/heads/main', sha: commit.sha }) });
    }

    return { sha: commit.sha };
}

/**
 * FIX #6: Use /v9/projects (documented endpoint). Env var `target` is an array.
 * FIX #3: No manual deployment trigger needed — Vercel auto-deploys from the GitHub commit.
 */
async function createVercelProject({ token, teamQs, projectName, repoOwner, repoName }: any) {
    const res = await fetch(`https://api.vercel.com/v9/projects${teamQs}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: projectName,
            framework: 'nextjs',
            gitRepository: { repo: `${repoOwner}/${repoName}`, type: 'github' },
        }),
    });

    if (res.status === 409) {
        // Project already exists, fetch it
        const getRes = await fetch(`https://api.vercel.com/v9/projects/${projectName}${teamQs}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!getRes.ok) {
            const err = await getRes.json() as any;
            throw new Error(`Failed to fetch existing Vercel project "${projectName}": ${err.error?.message || getRes.status}`);
        }
        return getRes.json() as any;
    }

    if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(`Failed to create Vercel project: ${err.error?.message || JSON.stringify(err)}`);
    }
    return res.json() as any;
}

/**
 * Add environment variables to an existing Vercel project.
 * Must be called AFTER createVercelProject — the v9 create body does not accept envVars directly.
 */
async function setVercelEnvVars({ token, teamQs, vercelProjectId, envVars }: any) {
    const sep = teamQs ? '&' : '?';
    const res = await fetch(`https://api.vercel.com/v9/projects/${vercelProjectId}/env${teamQs}${sep}upsert=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(envVars),
    });
    if (!res.ok) {
        const err = await res.json() as any;
        const msg = err.error?.message || JSON.stringify(err);
        if (msg.includes('same Name and Environment exists')) {
            // Ignore redundant env var warnings
            return;
        }
        console.warn('[agentService] setVercelEnvVars warning:', msg);
    }
}

/**
 * Poll for the most recent deployment of a project (triggered automatically by Vercel's git integration).
 */
async function getLatestDeploymentForProject({ token, teamQs, vercelProjectId }: any) {
    const sep = teamQs ? '&' : '?';
    const url = `https://api.vercel.com/v6/deployments${teamQs}${sep}projectId=${vercelProjectId}&limit=1`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return (data.deployments || [])[0] || null;
}

export async function getDeploymentStatus(deploymentId: string) {
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const res = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}${teamQs}`, {
        headers: { Authorization: `Bearer ${process.env.VERCEL_PLATFORM_TOKEN}` },
    });
    if (!res.ok) return { status: 'ERROR', url: undefined };
    const data = await res.json() as any;
    return { status: data.readyState, url: data.url ? `https://${data.url}` : undefined };
}

/**
 * Check the latest deployment of a Vercel project.
 * Returns status, live URL if ready, and build logs snippet if failed.
 */
export async function getLatestDeploymentCheck(vercelProjectId: string): Promise<{
    status: string;
    url?: string;
    deploymentId?: string;
    logs?: string;
}> {
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const sep = teamQs ? '&' : '?';

    // Fetch latest deployment for the project
    const listRes = await fetch(
        `https://api.vercel.com/v6/deployments${teamQs}${sep}projectId=${vercelProjectId}&limit=1`,
        { headers: { Authorization: `Bearer ${process.env.VERCEL_PLATFORM_TOKEN}` } }
    );
    if (!listRes.ok) return { status: 'UNKNOWN' };
    const listData = await listRes.json() as any;
    const latest = (listData.deployments || [])[0];
    if (!latest) return { status: 'NONE' };

    const deploymentId: string = latest.uid;
    const status: string = latest.readyState || 'UNKNOWN';
    const url = latest.url ? `https://${latest.url}` : undefined;

    // If the build failed, fetch build logs for the AI auto-fix context
    if (status === 'ERROR' || status === 'CANCELED') {
        const logs = await fetchDeploymentBuildLogs(deploymentId);
        return { status, url, deploymentId, logs };
    }

    return { status, url, deploymentId };
}

/**
 * Fetch the commit history of a GitHub repo (most recent first).
 */
export async function getRepoCommits(owner: string, repo: string, limit = 20): Promise<Array<{
    sha: string;
    message: string;
    date: string;
    author: string;
}>> {
    const token = process.env.GITHUB_PLATFORM_TOKEN!;
    const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits?per_page=${limit}`,
        { headers: ghHeaders(token) }
    );
    if (!res.ok) return [];
    const commits = await res.json() as any[];
    return commits.map(c => ({
        sha: c.sha,
        message: c.commit?.message?.split('\n')[0] || 'Commit',
        date: c.commit?.committer?.date || c.commit?.author?.date || '',
        author: c.commit?.author?.name || 'AI Site Builder',
    }));
}

/**
 * Fetch the full recursive file tree from a GitHub repo.
 * Uses the Git Trees API with ?recursive=1 for efficiency.
 */
export async function getRepoFileTree(owner: string, repo: string): Promise<Array<{
    path: string;
    size: number;
    sha: string;
    type: 'file' | 'dir';
}>> {
    const token = process.env.GITHUB_PLATFORM_TOKEN!;

    // 1. Get the latest commit SHA on main
    const refRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/main`,
        { headers: ghHeaders(token) }
    );
    if (!refRes.ok) return [];
    const refData = await refRes.json() as any;
    const commitSha = refData.object?.sha;
    if (!commitSha) return [];

    // 2. Get the commit to find the tree SHA
    const commitRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`,
        { headers: ghHeaders(token) }
    );
    if (!commitRes.ok) return [];
    const commitData = await commitRes.json() as any;
    const treeSha = commitData.tree?.sha;
    if (!treeSha) return [];

    // 3. Fetch the full recursive tree
    const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
        { headers: ghHeaders(token) }
    );
    if (!treeRes.ok) return [];
    const treeData = await treeRes.json() as any;

    return (treeData.tree || []).map((item: any) => ({
        path: item.path,
        size: item.size || 0,
        sha: item.sha,
        type: item.type === 'tree' ? 'dir' : 'file',
    }));
}

/**
 * Fetch the content of a single file from a GitHub repo.
 * Uses the Contents API which returns base64-encoded content.
 */
export async function getFileContent(owner: string, repo: string, path: string): Promise<string | null> {
    const token = process.env.GITHUB_PLATFORM_TOKEN!;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=main`,
        { headers: ghHeaders(token) }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;

    // Contents API returns base64-encoded content for files
    if (data.encoding === 'base64' && data.content) {
        return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    return data.content || null;
}

/**
 * Orchestrator Agent: classify user intent to determine which agents to invoke.
 */
export async function classifyUserIntent(
    userMessage: string,
    hasExistingDeploy: boolean,
    fileTree: string[]
): Promise<{
    intent: 'plan' | 'edit' | 'restyle' | 'debug' | 'chat';
    targetFiles: string[];
    imageSearchQuery?: string;
    reasoning: string;
}> {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '' });

    const schema = {
        type: "object",
        properties: {
            intent: {
                type: "string",
                enum: ["plan", "edit", "restyle", "debug", "chat"],
                description: "plan = new project or major feature; edit = modify specific files; restyle = visual/CSS changes only; debug = fix errors; chat = question/conversation"
            },
            targetFiles: {
                type: "array",
                items: { type: "string" },
                description: "File paths that are likely to be affected. Empty for 'plan' (new project) or 'chat'."
            },
            imageSearchQuery: {
                type: "string",
                description: "If the user is asking for a specific theme or redesign (e.g. 'make it a fitness app'), extract a 1-2 word search query for high-quality stock photos (e.g. 'fitness gym'). Leave empty if no images are needed."
            },
            reasoning: {
                type: "string",
                description: "One-sentence explanation of why this intent was chosen."
            }
        },
        required: ["intent", "targetFiles", "reasoning"],
        additionalProperties: false
    };

    const fileListStr = fileTree.length > 0
        ? `\nExisting files in repo:\n${fileTree.slice(0, 100).join('\n')}`
        : '\nNo existing files (new project).';

    try {
        const response = await callGeminiWithFallback(client, [{
            role: 'user', parts: [{
                text: `You are an AI project orchestrator. Classify the user's intent.

Has existing deployment: ${hasExistingDeploy}
${fileListStr}

User message: "${userMessage}"

Return JSON with intent, targetFiles, and reasoning.`
            }]
        }], {
            temperature: 0.1,
            maxOutputTokens: 65536,
            responseMimeType: "application/json",
            responseJsonSchema: schema as any,
            thinkingConfig: { thinkingBudget: 4096 }
        });

        const text = (response.text || '').trim();
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return { intent: hasExistingDeploy ? 'edit' : 'plan', targetFiles: [], reasoning: 'Fallback' };

        const parsed = JSON.parse(match[0]);
        return {
            intent: parsed.intent || (hasExistingDeploy ? 'edit' : 'plan'),
            targetFiles: Array.isArray(parsed.targetFiles) ? parsed.targetFiles : [],
            imageSearchQuery: parsed.imageSearchQuery,
            reasoning: parsed.reasoning || '',
        };
    } catch (e) {
        console.warn('[agentService] classifyUserIntent failed:', e);
        return { intent: hasExistingDeploy ? 'edit' : 'plan', targetFiles: [], reasoning: 'Classification failed, using fallback' };
    }
}

/**
 * Knowledge Manager: enhanced context builder that includes file tree metadata
 * and provides richer project data to the other agents.
 */
export function buildProjectKnowledge(project: any, fileTree?: Array<{ path: string; type: string }>): string {
    // Start with the existing context summary
    const baseContext = buildContextSummary(project);

    if (!fileTree || fileTree.length === 0) return baseContext;

    // Enrich with file tree information
    const filesByDir: Record<string, string[]> = {};
    for (const f of fileTree.filter(f => f.type === 'file')) {
        const parts = f.path.split('/');
        const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
        if (!filesByDir[dir]) filesByDir[dir] = [];
        filesByDir[dir].push(parts[parts.length - 1]);
    }

    const treeStr = Object.entries(filesByDir)
        .map(([dir, files]) => `${dir}/\n${files.map(f => `  ${f}`).join('\n')}`)
        .join('\n');

    return `${baseContext}\n\n## Current File Tree\n${treeStr}`;
}

/**
 * Revert to a previous commit by creating a new commit that has the old tree.
 * This is a forward-revert (preserves history, adds a new commit on top).
 */
export async function revertToCommitSha(owner: string, repo: string, targetSha: string): Promise<{ newSha: string; url: string }> {
    const token = process.env.GITHUB_PLATFORM_TOKEN!;

    // 0. Get the default branch
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: ghHeaders(token) });
    if (!repoRes.ok) throw new Error(`Failed to fetch repo ${owner}/${repo}`);
    const repoData = await repoRes.json() as any;
    const defaultBranch = repoData.default_branch || 'main';

    // 1. Get the old commit's tree SHA
    const oldCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${targetSha}`, { headers: ghHeaders(token) });
    if (!oldCommitRes.ok) throw new Error(`Failed to fetch commit ${targetSha}`);
    const oldCommit = await oldCommitRes.json() as any;
    const oldTreeSha: string = oldCommit.tree?.sha;
    if (!oldTreeSha) throw new Error('Could not read tree from commit');

    // 2. Get current HEAD SHA (parent for new commit)
    const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, { headers: ghHeaders(token) });
    if (!refRes.ok) throw new Error(`Could not read ${defaultBranch} branch ref`);
    const currentHead: string = (await refRes.json() as any).object?.sha;

    // 3. Create new commit pointing to old tree
    const commitMsg = `Revert to ${targetSha.slice(0, 7)} (via AI Site Builder)`;
    const newCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        headers: ghHeaders(token),
        body: JSON.stringify({ message: commitMsg, tree: oldTreeSha, parents: [currentHead] }),
    });
    if (!newCommitRes.ok) {
        const err = await newCommitRes.text();
        throw new Error(`Failed to create revert commit: ${err}`);
    }
    const newCommit = await newCommitRes.json() as any;
    const newSha: string = newCommit.sha;

    // 4. Update branch ref to new commit
    const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`, {
        method: 'PATCH',
        headers: ghHeaders(token),
        body: JSON.stringify({ sha: newSha }),
    });
    if (!updateRes.ok) {
        const err = await updateRes.text();
        throw new Error(`Failed to update ${defaultBranch} ref: ${err}`);
    }

    return { newSha, url: `https://github.com/${owner}/${repo}/commit/${newSha}` };
}


async function getPlatformGhUsername(token: string) {
    if (!token) throw new Error('GITHUB_PLATFORM_TOKEN is not set in environment variables');
    const res = await fetch('https://api.github.com/user', { headers: ghHeaders(token) });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to fetch GitHub platform username (HTTP ${res.status}): ${body}`);
    }
    return (await res.json() as any).login;
}

function sanitizeRepoName(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
}

/** Add a custom domain to a Vercel project */
export async function addVercelDomain(projectId: string, domain: string) {
    const token = process.env.VERCEL_PLATFORM_TOKEN;
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';

    // Step 1: Add apex domain to account
    const apexRes = await fetch(`https://api.vercel.com/v7/domains${teamQs}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: domain })
    });

    // 409 Conflict is okay if the domain is already added to the account
    if (!apexRes.ok && apexRes.status !== 409) {
        throw new Error(await apexRes.text());
    }

    // Step 2: Add domain to project
    const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/domains${teamQs}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: domain })
    });
    return await res.json();
}

/** Check status of a custom domain on a Vercel project */
export async function checkVercelDomainStatus(projectId: string, domain: string) {
    const token = process.env.VERCEL_PLATFORM_TOKEN;
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';

    // Get precise DNS configuration from v6 config endpoint
    const res = await fetch(`https://api.vercel.com/v6/domains/${domain}/config${teamQs}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const configData = await res.json();

    // Get project domain info to check verification status
    const projectDomainRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/domains/${domain}${teamQs}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const projectDomainData = await projectDomainRes.json();

    return {
        ...configData,
        verified: projectDomainData.verified,
        verification: projectDomainData.verification
    };
}

/** Get information for a single domain in an account or team */
export async function getVercelDomainInfo(domain: string) {
    const token = process.env.VERCEL_PLATFORM_TOKEN;
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const res = await fetch(`https://api.vercel.com/v5/domains/${domain}${teamQs}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
}

/** Remove a custom domain from a Vercel project */
export async function removeVercelDomain(projectId: string, domain: string) {
    const token = process.env.VERCEL_PLATFORM_TOKEN;
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';

    // Step 1: Remove from project
    await fetch(`https://api.vercel.com/v9/projects/${projectId}/domains/${domain}${teamQs}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });

    // Step 2: Also try to remove from platform level (clean up)
    await fetch(`https://api.vercel.com/v6/domains/${domain}${teamQs}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });

    return { success: true };
}

/** Explicitly trigger domain verification check */
export async function verifyVercelDomain(projectId: string, domain: string) {
    const token = process.env.VERCEL_PLATFORM_TOKEN;
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/domains/${domain}/verify${teamQs}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
}

/** Get all environment variables for a Vercel project */
export async function getVercelEnvVars(projectId: string) {
    const token = process.env.VERCEL_PLATFORM_TOKEN;
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env${teamQs}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
}

/** Create or upsert an environment variable for a Vercel project */
export async function createVercelEnvVar(projectId: string, key: string, value: string, target: string[]) {
    const token = process.env.VERCEL_PLATFORM_TOKEN;
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env${teamQs}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ key, value, type: 'encrypted', target })
    });
    return await res.json();
}

/** Update an environment variable for a Vercel project */
export async function updateVercelEnvVar(projectId: string, envId: string, value: string, target: string[]) {
    const token = process.env.VERCEL_PLATFORM_TOKEN;
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${envId}${teamQs}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ value, target })
    });
    return await res.json();
}

/** Remove an environment variable from a Vercel project */
export async function removeVercelEnvVar(projectId: string, envId: string) {
    const token = process.env.VERCEL_PLATFORM_TOKEN;
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${envId}${teamQs}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
}

/** Get custom environments for a Vercel project */
export async function getVercelCustomEnvs(projectId: string) {
    const token = process.env.VERCEL_PLATFORM_TOKEN;
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/custom-environments${teamQs}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
}

/** Create a custom environment for a Vercel project */
export async function createVercelCustomEnv(projectId: string, slug: string, type: 'production' | 'preview' | 'development' = 'preview') {
    const token = process.env.VERCEL_PLATFORM_TOKEN;
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/custom-environments${teamQs}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ slug, type })
    });
    return await res.json();
}

/** Remove a custom environment from a Vercel project */
export async function removeVercelCustomEnv(projectId: string, envId: string) {
    const token = process.env.VERCEL_PLATFORM_TOKEN;
    const teamQs = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/custom-environments/${envId}${teamQs}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
}
