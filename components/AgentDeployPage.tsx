import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ResearchProject, DeployConfig, AgentMessage, RepoFile } from '../types';
import { authFetch } from '../services/authFetch';
import { storageService } from '../services/storageService';

interface AgentDeployPageProps {
    project: ResearchProject;
    isDarkMode: boolean;
    onBack: () => void;
    onProjectUpdate: (updated: ResearchProject) => void;
}

type TransferState = 'idle' | 'needs-github' | 'transferring' | 'transferred' | 'error';

const AGENT_INTRO = `👋 I'm your **AI Site Builder**. Describe the site you want and I'll generate, push, and deploy a full Next.js app — live in minutes.`;

// ─── Fullscreen background preview ───────────────────────────────────────────
const FullscreenPreview: React.FC<{ html: string; liveUrl?: string }> = ({ html, liveUrl }) => {
    const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
    const [useLive, setUseLive] = React.useState(false);

    React.useEffect(() => {
        if (!html) return;
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        // Force switch to Blob preview whenever HTML updates for immediate feedback
        setUseLive(false);
        return () => URL.revokeObjectURL(url);
    }, [html]);

    React.useEffect(() => {
        // Only use live URL if we don't have a static HTML preview yet
        if (liveUrl && !html) setUseLive(true);
    }, [liveUrl, !!html]);

    const src = (useLive && liveUrl) ? liveUrl : (blobUrl || liveUrl);
    if (!src) return null;

    return (
        <iframe
            key={src}
            src={src}
            sandbox={useLive ? undefined : 'allow-scripts allow-same-origin'}
            className="absolute inset-0 w-full h-full border-0"
            title="Site Preview"
        />
    );
};

// ─── File Tree Types & Helpers ──────────────────────────────────────────────
interface FileTreeNode {
    name: string;
    path: string;
    type: 'file' | 'dir';
    children: FileTreeNode[];
}

function buildFileTree(files: RepoFile[]): FileTreeNode[] {
    const root: FileTreeNode[] = [];
    const map: Record<string, FileTreeNode> = {};

    files.forEach(f => {
        const parts = f.path.split('/');
        let currentPath = '';
        let currentLevel = root;

        parts.forEach((part, i) => {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const isLast = i === parts.length - 1;
            const type = (isLast && f.type === 'file') ? 'file' : 'dir';

            if (!map[currentPath]) {
                const node: FileTreeNode = { name: part, path: currentPath, type, children: [] };
                map[currentPath] = node;
                currentLevel.push(node);
                // Sort: directories first, then alphabetically
                currentLevel.sort((a, b) => {
                    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
            }
            currentLevel = map[currentPath].children;
        });
    });

    return root;
}

// ─── Minimal markdown renderer ────────────────────────────────────────────────
const RenderText: React.FC<{ text: string }> = ({ text }) => (
    <>
        {text.split('\n').map((line, i, arr) => (
            <React.Fragment key={i}>
                {line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, j) => {
                    if (part.startsWith('**') && part.endsWith('**'))
                        return <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>;
                    if (part.startsWith('`') && part.endsWith('`'))
                        return <code key={j} className="text-[11px] px-1 py-0.5 rounded bg-white/15 text-orange-300">{part.slice(1, -1)}</code>;
                    return part;
                })}
                {i < arr.length - 1 && <br />}
            </React.Fragment>
        ))}
    </>
);

// ─── Main Component ───────────────────────────────────────────────────────────
export const AgentDeployPage: React.FC<AgentDeployPageProps> = ({
    project, isDarkMode, onBack, onProjectUpdate
}) => {
    const [messages, setMessages] = useState<AgentMessage[]>(
        project.siteBuilderMessages?.length
            ? project.siteBuilderMessages
            : [{ id: 'intro', role: 'agent', text: AGENT_INTRO, timestamp: Date.now() }]
    );
    const [inputText, setInputText] = useState('');
    const [isWorking, setIsWorking] = useState(false);
    const [transferState, setTransferState] = useState<TransferState>('idle');
    const [previewHtml, setPreviewHtml] = useState<string | null>(project.previewHtml || null);
    const [liveUrl, setLiveUrl] = useState<string | undefined>(undefined);
    const [chatOpen, setChatOpen] = useState(true);
    const [statusText, setStatusText] = useState<string>('');
    // Deployment health check
    const [checkStatus, setCheckStatus] = useState<'loading' | 'ok' | 'error' | 'none' | 'idle'>('idle');
    const [checkLogs, setCheckLogs] = useState<string>('');
    // Version Control
    const [showHistory, setShowHistory] = useState(false);
    const [historyCommits, setHistoryCommits] = useState<any[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    // Custom Domain
    const [showDomainModal, setShowDomainModal] = useState(false);
    const [domainInput, setDomainInput] = useState('');
    const [domainLoading, setDomainLoading] = useState(false);
    const [domainError, setDomainError] = useState<string | null>(null);
    const [domainStatus, setDomainStatus] = useState<any>(null);
    // Sidebar / Tooling Tabs
    const [sidebarView, setSidebarView] = useState<'files' | 'history' | 'env' | 'none'>('none');
    // Vercel Env Vars
    const [vercelEnvVars, setVercelEnvVars] = useState<any[]>([]);
    const [vercelCustomEnvs, setVercelCustomEnvs] = useState<any[]>([]);
    const [envLoading, setEnvLoading] = useState(false);
    const [envError, setEnvError] = useState<string | null>(null);
    const [revealEnvIds, setRevealEnvIds] = useState<Set<string>>(new Set());
    const [showAddEnvModal, setShowAddEnvModal] = useState(false);
    const [showAddCustomEnvModal, setShowAddCustomEnvModal] = useState(false);
    const [newEnvVar, setNewEnvVar] = useState({ key: '', value: '', target: ['production', 'preview', 'development'] });
    const [newCustomEnv, setNewCustomEnv] = useState({ slug: '', type: 'preview' as 'production' | 'preview' | 'development' });
    // File Explorer
    const [fileTree, setFileTree] = useState<RepoFile[]>([]);
    const [fileTreeLoading, setFileTreeLoading] = useState(false);
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
    const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null);
    const [fileContentLoading, setFileContentLoading] = useState(false);
    const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
    // Active agent tracking
    const [activeAgent, setActiveAgent] = useState<string | null>(null);
    // Two-way sync
    const [localCommitSha, setLocalCommitSha] = useState<string | null>(null);

    const hasExternalChanges = !isWorking && !!project?.lastKnownCommitSha && !!localCommitSha && project.lastKnownCommitSha !== localCommitSha;

    useEffect(() => {
        if (!localCommitSha && project?.lastKnownCommitSha) {
            setLocalCommitSha(project.lastKnownCommitSha);
        }
    }, [project?.lastKnownCommitSha, localCommitSha]);

    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Persist messages to Firestore
    useEffect(() => {
        // Only save if messages have actually changed and we are not in the initial render
        // Actually, storageService.updateResearchProject handles debouncing/checks if needed
        // but let's be safe and check if they differ from current project state
        if (messages.length > 0 && JSON.stringify(messages) !== JSON.stringify(project.siteBuilderMessages)) {
            storageService.updateResearchProject(project.id, { siteBuilderMessages: messages });
        }
    }, [messages, project.id, project.siteBuilderMessages]);

    const deployConfig = project.deployConfig;
    const isDeployed = !!deployConfig?.vercelPreviewUrl;

    // Initialize live URL from existing deploy config
    useEffect(() => {
        if (deployConfig?.vercelPreviewUrl) {
            setLiveUrl(deployConfig.vercelPreviewUrl.startsWith('http') ? deployConfig.vercelPreviewUrl : `https://${deployConfig.vercelPreviewUrl}`);
        }
    }, [deployConfig?.vercelPreviewUrl]);

    // Check if repo is already transferred on mount
    useEffect(() => {
        if (!deployConfig?.githubRepoOwner) return;
        authFetch('/api/agent?op=github-status')
            .then(r => r.json())
            .then(data => {
                if (data.connected && data.username === deployConfig.githubRepoOwner) {
                    setTransferState('transferred');
                }
            })
            .catch(err => console.error('Failed to check github status:', err));
    }, [deployConfig?.githubRepoOwner]);

    // On mount: if already deployed, check latest deployment status
    useEffect(() => {
        if (!deployConfig?.vercelProjectId) return;
        setCheckStatus('loading');
        authFetch(`/api/agent?op=deployment-check&vercelProjectId=${encodeURIComponent(deployConfig.vercelProjectId)}`)
            .then(r => r.json())
            .then((data: any) => {
                if (data.status === 'READY') {
                    setCheckStatus('ok');
                    if (data.url) {
                        setLiveUrl(data.url.startsWith('http') ? data.url : `https://${data.url}`);
                    }
                } else if (data.status === 'ERROR' || data.status === 'CANCELED') {
                    setCheckStatus('error');
                    setCheckLogs(data.logs || '');
                    appendAgentMessage(
                        `⚠️ The last deployment **failed**. I fetched the build logs — click **Fix Errors** to let me diagnose and redeploy automatically.`
                    );
                } else if (data.status === 'NONE' || data.status === 'UNKNOWN') {
                    setCheckStatus('none');
                } else {
                    // BUILDING / QUEUED — still in progress
                    setCheckStatus('ok');
                }
            })
            .catch(() => setCheckStatus('idle'));
    }, []);

    useEffect(() => {
        if (chatOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, chatOpen]);

    // GitHub OAuth popup listener
    useEffect(() => {
        const handleMessage = async (e: MessageEvent) => {
            if (e.data?.type === 'github:connected') {
                await authFetch('/api/agent?op=github-store-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: e.data.token, username: e.data.username }),
                });
                setTransferState('transferring');
                await executeTransfer();
            }
            if (e.data?.type === 'github:error') {
                setTransferState('error');
                appendAgentMessage(`❌ GitHub connection failed: ${e.data.error}.`);
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [project]);

    // Fetch file tree on mount if deployed
    useEffect(() => {
        if (!deployConfig?.githubRepoOwner || !deployConfig?.githubRepoName) return;
        setFileTreeLoading(true);
        authFetch(`/api/agent?op=repo-files&repoOwner=${encodeURIComponent(deployConfig.githubRepoOwner)}&repoName=${encodeURIComponent(deployConfig.githubRepoName)}`)
            .then(r => r.json())
            .then((data: any) => {
                setFileTree((data.files || []).filter((f: any) => f.type === 'file'));
            })
            .catch(() => { })
            .finally(() => setFileTreeLoading(false));
    }, [deployConfig?.githubRepoOwner, deployConfig?.githubRepoName]);

    // Fetch preview.html on mount to show something immediately
    useEffect(() => {
        if (!deployConfig?.githubRepoOwner || !deployConfig?.githubRepoName) return;
        authFetch(
            `/api/agent?op=file-content&repoOwner=${encodeURIComponent(deployConfig.githubRepoOwner)}&repoName=${encodeURIComponent(deployConfig.githubRepoName)}&path=public%2Fpreview.html`
        )
            .then(r => r.json())
            .then(data => {
                if (data.content) setPreviewHtml(data.content);
            })
            .catch(err => console.warn('Failed to fetch preview.html:', err));
    }, [deployConfig?.githubRepoOwner, deployConfig?.githubRepoName]);

    const fetchFileContent = useCallback(async (path: string) => {
        if (!deployConfig?.githubRepoOwner || !deployConfig?.githubRepoName) return;
        setSelectedFilePath(path);
        setSelectedFileContent(null);
        setFileContentLoading(true);
        try {
            const res = await authFetch(
                `/api/agent?op=file-content&repoOwner=${encodeURIComponent(deployConfig.githubRepoOwner)}&repoName=${encodeURIComponent(deployConfig.githubRepoName)}&path=${encodeURIComponent(path)}`
            );
            const data = await res.json();
            setSelectedFileContent(data.content || null);
        } catch {
            setSelectedFileContent('// Error loading file');
        } finally {
            setFileContentLoading(false);
        }
    }, [deployConfig]);

    const appendAgentMessage = useCallback((text: string, extras?: Partial<AgentMessage>) => {
        setMessages(prev => [...prev, {
            id: crypto.randomUUID(), role: 'agent', text, timestamp: Date.now(), ...extras
        }]);
    }, []);

    const fetchHistory = useCallback(async () => {
        if (!deployConfig?.githubRepoUrl) return;
        setHistoryLoading(true);
        setShowHistory(true);
        try {
            const owner = deployConfig.githubRepoOwner;
            const name = deployConfig.githubRepoName;
            const res = await authFetch(`/api/agent?op=repo-history&repoOwner=${owner}&repoName=${name}`);
            const data = await res.json();
            setHistoryCommits(data.commits || []);
        } catch (e) {
            console.error('Failed to fetch history:', e);
        } finally {
            setHistoryLoading(false);
        }
    }, [deployConfig]);

    const handleRevert = useCallback(async (targetSha: string) => {
        if (isWorking) return;
        setIsWorking(true);
        setSidebarView('none');
        setChatOpen(true);

        const shortSha = targetSha.slice(0, 7);
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text: `⏪ Revert back to version ${shortSha}`, timestamp: Date.now() }]);

        const statusMsgId = crypto.randomUUID();
        setMessages(prev => [...prev, {
            id: statusMsgId, role: 'agent', text: `🔄 Reverting to ${shortSha}...`,
            timestamp: Date.now(), isStreaming: true,
        }]);

        const updateStatus = (s: string) => {
            setStatusText(s);
            setMessages(prev => prev.map(m => m.id === statusMsgId ? { ...m, text: s } : m));
        };

        try {
            const owner = deployConfig?.githubRepoOwner;
            const name = deployConfig?.githubRepoName;
            const res = await authFetch('/api/agent?op=revert-commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoOwner: owner, repoName: name, targetSha }),
            });
            if (!res.ok) throw new Error('Revert failed');

            updateStatus('✅ Revert commit created. Vercel is building...');
            // Wait for new deployment
            let attempts = 0;
            while (attempts < 30) {
                await new Promise(r => setTimeout(r, 6000));
                const statusRes = await authFetch(`/api/agent?op=deployment-check&vercelProjectId=${encodeURIComponent(deployConfig?.vercelProjectId || '')}`);
                if (statusRes.ok) {
                    const s = await statusRes.json();
                    if (s.status === 'READY') {
                        setLiveUrl(s.url);
                        break;
                    }
                    if (s.status === 'ERROR') throw new Error('Build failed after revert');
                    updateStatus(`⏳ Building reverted version${'.'.repeat((attempts % 3) + 1)}`);
                }
                attempts++;
            }

            appendAgentMessage(`🎉 **Successfully reverted!** The site is now back to version \`${shortSha}\`.`);
            setMessages(prev => prev.map(m => m.id === statusMsgId ? { ...m, text: `✅ Reverted to ${shortSha}`, isStreaming: false } : m));

        } catch (err: any) {
            setMessages(prev => prev.map(m => m.id === statusMsgId ? { ...m, text: `❌ Revert failed: ${err.message}`, isStreaming: false } : m));
        } finally {
            setIsWorking(false);
            setStatusText('');
        }
    }, [isWorking, deployConfig, appendAgentMessage]);

    const executeTransfer = useCallback(async () => {
        try {
            const res = await authFetch(`/api/agent?op=transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Transfer failed');
            setTransferState('transferred');
            appendAgentMessage(`✅ **Repository transferred!** New URL: ${data.newRepoUrl}`, { repoUrl: data.newRepoUrl });
            const newConfig = { ...deployConfig, githubRepoOwner: data.newOwner, githubRepoUrl: data.newRepoUrl } as DeployConfig;
            await storageService.updateResearchProject(project.id, { deployConfig: newConfig });
            onProjectUpdate({ ...project, deployConfig: newConfig });
        } catch (e: any) {
            setTransferState('error');
            appendAgentMessage(`❌ Transfer failed: ${e.message}`);
        }
    }, [project, deployConfig, onProjectUpdate, appendAgentMessage]);

    const checkDomainStatus = useCallback(async () => {
        if (!deployConfig?.vercelProjectId || !deployConfig?.customDomain) return;
        setDomainLoading(true);
        try {
            const res = await authFetch(`/api/agent?op=check-domain&vercelProjectId=${deployConfig.vercelProjectId}&domain=${deployConfig.customDomain}`);
            const data = await res.json();
            setDomainStatus(data);
        } catch (e) {
            console.error('Failed to check domain status:', e);
        } finally {
            setDomainLoading(false);
        }
    }, [deployConfig]);

    const handleAddDomain = async () => {
        if (!domainInput || domainLoading || !deployConfig?.vercelProjectId) return;
        setDomainLoading(true);
        setDomainError(null);
        try {
            const res = await authFetch('/api/agent?op=add-domain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vercelProjectId: deployConfig.vercelProjectId, domain: domainInput }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            const newConfig: DeployConfig = { ...deployConfig, customDomain: domainInput, domainVerified: data.verified };
            await storageService.updateResearchProject(project.id, { deployConfig: newConfig });
            onProjectUpdate({ ...project, deployConfig: newConfig });
            setDomainStatus(data);
            setDomainInput('');
        } catch (e: any) {
            setDomainError(e.message);
        } finally {
            setDomainLoading(false);
        }
    };

    const handleRemoveDomain = async () => {
        if (!deployConfig?.customDomain || domainLoading || !deployConfig?.vercelProjectId) return;
        if (!confirm(`Are you sure you want to remove ${deployConfig.customDomain}?`)) return;
        setDomainLoading(true);
        try {
            await authFetch('/api/agent?op=remove-domain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vercelProjectId: deployConfig.vercelProjectId, domain: deployConfig.customDomain }),
            });
            const newConfig: DeployConfig = { ...deployConfig, customDomain: undefined, domainVerified: undefined };
            await storageService.updateResearchProject(project.id, { deployConfig: newConfig });
            onProjectUpdate({ ...project, deployConfig: newConfig });
            setDomainStatus(null);
        } catch (e) {
            console.error('Failed to remove domain:', e);
        } finally {
            setDomainLoading(false);
        }
    };

    const fetchEnvVars = useCallback(async () => {
        if (!deployConfig?.vercelProjectId) return;
        setEnvLoading(true);
        setEnvError(null);
        try {
            const [envRes, customRes] = await Promise.all([
                authFetch(`/api/agent?op=get-env-vars&vercelProjectId=${deployConfig.vercelProjectId}`),
                authFetch(`/api/agent?op=get-custom-envs&vercelProjectId=${deployConfig.vercelProjectId}`)
            ]);
            const envData = await envRes.json();
            const customData = await customRes.json();
            
            if (envData.envs) setVercelEnvVars(envData.envs);
            if (customData.environments) setVercelCustomEnvs(customData.environments);
            
            if (envData.error || customData.error) {
                setEnvError(envData.error || customData.error || 'Failed to load environment data');
            }
        } catch (e) {
            setEnvError('Failed to fetch environment variables');
            console.error(e);
        } finally {
            setEnvLoading(false);
        }
    }, [deployConfig]);

    const handleAddCustomEnv = async () => {
        if (!deployConfig?.vercelProjectId || !newCustomEnv.slug) return;
        setEnvLoading(true);
        try {
            const res = await authFetch('/api/agent?op=add-custom-env', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vercelProjectId: deployConfig.vercelProjectId,
                    ...newCustomEnv
                })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            await fetchEnvVars();
            setShowAddCustomEnvModal(false);
            setNewCustomEnv({ slug: '', type: 'preview' });
        } catch (e: any) {
            setEnvError(e.message);
        } finally {
            setEnvLoading(false);
        }
    };

    const handleRemoveCustomEnv = async (envId: string) => {
        if (!deployConfig?.vercelProjectId || !confirm('Are you sure you want to delete this custom environment?')) return;
        setEnvLoading(true);
        try {
            const res = await authFetch('/api/agent?op=remove-custom-env', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vercelProjectId: deployConfig.vercelProjectId, envId })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            await fetchEnvVars();
        } catch (e: any) {
            setEnvError(e.message);
        } finally {
            setEnvLoading(false);
        }
    };

    const handleAddEnvVar = async () => {
        if (!deployConfig?.vercelProjectId || !newEnvVar.key || !newEnvVar.value) return;
        setEnvLoading(true);
        try {
            const res = await authFetch('/api/agent?op=add-env-var', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vercelProjectId: deployConfig.vercelProjectId,
                    ...newEnvVar
                })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            await fetchEnvVars();
            setShowAddEnvModal(false);
            setNewEnvVar({ key: '', value: '', target: ['production', 'preview', 'development'] });
        } catch (e: any) {
            setEnvError(e.message);
        } finally {
            setEnvLoading(false);
        }
    };

    const handleRemoveEnvVar = async (envId: string) => {
        if (!deployConfig?.vercelProjectId || !confirm('Are you sure you want to delete this environment variable?')) return;
        setEnvLoading(true);
        try {
            const res = await authFetch('/api/agent?op=remove-env-var', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vercelProjectId: deployConfig.vercelProjectId, envId })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            await fetchEnvVars();
        } catch (e: any) {
            setEnvError(e.message);
        } finally {
            setEnvLoading(false);
        }
    };

    const handleVerifyDomain = async () => {
        if (!deployConfig?.customDomain || domainLoading || !deployConfig?.vercelProjectId) return;
        setDomainLoading(true);
        try {
            const res = await authFetch('/api/agent?op=verify-domain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vercelProjectId: deployConfig.vercelProjectId, domain: deployConfig.customDomain }),
            });
            const data = await res.json();
            const newConfig: DeployConfig = { ...deployConfig, domainVerified: data.verified };
            await storageService.updateResearchProject(project.id, { deployConfig: newConfig });
            onProjectUpdate({ ...project, deployConfig: newConfig });
            setDomainStatus(data);
        } catch (e) {
            console.error('Failed to verify domain:', e);
        } finally {
            setDomainLoading(false);
        }
    };

    const handleClaimRepo = useCallback(() => {
        if (transferState === 'transferred') return;
        setTransferState('needs-github');
        const w = 600, h = 700;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top = window.screenY + (window.outerHeight - h) / 2;
        window.open(`/api/agent?op=github-authorize`, 'github-oauth', `width=${w},height=${h},left=${left},top=${top}`);
        appendAgentMessage('🔗 Connect your GitHub account in the popup...');
    }, [transferState, appendAgentMessage]);

    const handleFixErrors = useCallback(async () => {
        if (isWorking) return;
        setIsWorking(true);
        setChatOpen(true);
        const fixPrompt = `Fix the build errors shown in these logs and redeploy:\n\n${checkLogs.slice(0, 3000)}`;
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text: '🔧 Fix build errors automatically', timestamp: Date.now() }]);
        setCheckStatus('idle');

        const statusMsgId = crypto.randomUUID();
        setMessages(prev => [...prev, {
            id: statusMsgId, role: 'agent', text: '🔍 Analyzing build errors...',
            timestamp: Date.now(), isStreaming: true,
        }]);
        const updateStatus = (s: string) => {
            setStatusText(s);
            setMessages(prev => prev.map(m => m.id === statusMsgId ? { ...m, text: s } : m));
        };

        try {
            const res = await authFetch('/api/agent?op=redeploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id, userPrompt: fixPrompt, existingConfig: deployConfig }),
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})) as any; throw new Error(e.error || 'Fix failed'); }

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '', data: any = {}, finalHtml: string | null = null;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n'); buffer = parts.pop() ?? '';
                for (const part of parts) {
                    const line = part.trim();
                    if (!line.startsWith('data: ')) continue;
                    let event: any; try { event = JSON.parse(line.slice(6)); } catch { continue; }
                    if (event.type === 'status') updateStatus(event.text);
                    else if (event.type === 'preview') { setPreviewHtml(event.html); finalHtml = event.html; }
                    else if (event.type === 'done') { data = event; if (event.previewUrl) setLiveUrl(event.previewUrl); }
                    else if (event.type === 'error') throw new Error(event.message);
                }
            }
            const newConfig: DeployConfig = {
                githubRepoUrl: data.repoUrl ?? deployConfig?.githubRepoUrl,
                githubRepoName: data.repoName ?? deployConfig?.githubRepoName,
                githubRepoOwner: data.repoOwner ?? deployConfig?.githubRepoOwner,
                vercelProjectId: data.vercelProjectId ?? deployConfig?.vercelProjectId,
                vercelPreviewUrl: data.previewUrl ?? deployConfig?.vercelPreviewUrl,
                lastDeployedAt: Date.now(), deployStatus: 'ready',
            };
            const updatePayload: any = { deployConfig: newConfig };
            if (finalHtml) updatePayload.previewHtml = finalHtml;
            await storageService.updateResearchProject(project.id, updatePayload);
            onProjectUpdate({ ...project, ...updatePayload });
            setMessages(prev => prev.map(m => m.id === statusMsgId ? { ...m, text: '✅ Fixed and redeployed!', isStreaming: false, previewUrl: data.previewUrl, repoUrl: data.repoUrl } : m));
            if (data.previewUrl) appendAgentMessage('🎉 **Build fixed!** Your site is live again.');
        } catch (err: any) {
            setMessages(prev => prev.map(m => m.id === statusMsgId ? { ...m, text: `❌ ${err.message}`, isStreaming: false } : m));
        } finally {
            setIsWorking(false);
            setStatusText('');
        }
    }, [isWorking, checkLogs, project, deployConfig, appendAgentMessage, onProjectUpdate]);

    const handleSend = useCallback(async () => {
        const text = inputText.trim();
        if (!text || isWorking) return;

        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text, timestamp: Date.now() }]);
        setInputText('');
        setIsWorking(true);
        setChatOpen(true);

        const statusMsgId = crypto.randomUUID();
        setMessages(prev => [...prev, {
            id: statusMsgId, role: 'agent', text: '🔍 Analyzing project context...',
            timestamp: Date.now(), isStreaming: true,
        }]);

        const updateStatus = (status: string) => {
            setStatusText(status);
            setMessages(prev => prev.map(m => m.id === statusMsgId ? { ...m, text: status } : m));
        };

        try {
            const isRedeploy = !!deployConfig?.vercelProjectId;
            const op = isRedeploy ? 'redeploy' : 'generate-and-deploy';

            const res = await authFetch(`/api/agent?op=${op}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id, userPrompt: text, existingConfig: deployConfig }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({})) as any;
                throw new Error(err.error || `Deploy failed (${res.status})`);
            }

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let data: any = {};
            let finalHtml: string | null = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop() ?? '';

                for (const part of parts) {
                    const line = part.trim();
                    if (!line.startsWith('data: ')) continue;
                    let event: any;
                    try { event = JSON.parse(line.slice(6)); } catch { continue; }

                    if (event.type === 'status') {
                        updateStatus(event.text);
                    } else if (event.type === 'agentStep') {
                        if (event.status === 'active') setActiveAgent(event.agent);
                        else if (event.status === 'done') setActiveAgent(null);
                    } else if (event.type === 'preview') {
                        setPreviewHtml(event.html);
                        finalHtml = event.html;
                        setMessages(prev => prev.map(m =>
                            m.id === statusMsgId ? { ...m, previewHtml: event.html } : m
                        ));
                    } else if (event.type === 'done') {
                        data = event;
                        if (event.previewUrl) setLiveUrl(event.previewUrl);
                        // Handle chat-only responses (no deployment)
                        if (event.chat) {
                            setMessages(prev => prev.map(m =>
                                m.id === statusMsgId ? { ...m, text: event.message || '💬 No changes needed.', isStreaming: false } : m
                            ));
                            setIsWorking(false);
                            setStatusText('');
                            setActiveAgent(null);
                            return;
                        }
                    } else if (event.type === 'error') {
                        throw new Error(event.message || 'Deploy pipeline failed');
                    }
                }
            }

            const newConfig: DeployConfig = {
                githubRepoUrl: data.repoUrl ?? deployConfig?.githubRepoUrl,
                githubRepoName: data.repoName ?? deployConfig?.githubRepoName,
                githubRepoOwner: data.repoOwner ?? deployConfig?.githubRepoOwner,
                vercelProjectId: data.vercelProjectId ?? deployConfig?.vercelProjectId,
                vercelPreviewUrl: data.previewUrl ?? deployConfig?.vercelPreviewUrl,
                lastDeployedAt: Date.now(),
                deployStatus: 'ready',
            };
            const updatePayload: any = { deployConfig: newConfig };
            if (finalHtml) updatePayload.previewHtml = finalHtml;
            await storageService.updateResearchProject(project.id, updatePayload);
            onProjectUpdate({ ...project, ...updatePayload });

            if (data.commitSha) {
                setLocalCommitSha(data.commitSha);
            }

            setMessages(prev => prev.map(m =>
                m.id === statusMsgId ? {
                    ...m, text: '✅ Your site is live!', isStreaming: false,
                    previewUrl: data.previewUrl, repoUrl: data.repoUrl,
                    commitSha: data.commitSha,
                    changedFiles: data.changedFiles,
                } : m
            ));

            if (data.previewUrl) {
                setLiveUrl(data.previewUrl);
                const changedCount = data.changedFiles?.length || 0;
                const changedStr = changedCount > 0 ? ` (${changedCount} file${changedCount > 1 ? 's' : ''} changed)` : '';
                appendAgentMessage(`🎉 **Deployment complete!**${changedStr} Ask me to make changes any time and I'll redeploy automatically.`, { commitSha: data.commitSha, changedFiles: data.changedFiles });
                setSidebarView('files'); // Automatically show files after success
            }

            // Refresh file tree after deploy
            if (deployConfig?.githubRepoOwner && deployConfig?.githubRepoName) {
                authFetch(`/api/agent?op=repo-files&repoOwner=${encodeURIComponent(deployConfig.githubRepoOwner)}&repoName=${encodeURIComponent(deployConfig.githubRepoName)}`)
                    .then(r => r.json())
                    .then((d: any) => setFileTree((d.files || []).filter((f: any) => f.type === 'file')))
                    .catch(() => { });
            }

        } catch (err: any) {
            setMessages(prev => prev.map(m =>
                m.id === statusMsgId
                    ? { ...m, text: `❌ ${err.message}`, isStreaming: false }
                    : m
            ));
            appendAgentMessage(`Something went wrong:\n\`${err.message}\`\n\nWant me to try again?`);
        } finally {
            setIsWorking(false);
            setStatusText('');
            setActiveAgent(null);
        }
    }, [inputText, isWorking, project, deployConfig, appendAgentMessage, onProjectUpdate]);


    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    // ─── Layout ───────────────────────────────────────────────────────────────
    return (
        <div className="fixed inset-0 w-full h-full overflow-hidden bg-[#050506]">
            {/* GitHub Sync Banner */}
            {hasExternalChanges && (
                <div className="absolute top-0 left-0 w-full z-[100] bg-[#f59e0b]/90 backdrop-blur-md px-4 py-2 flex items-center justify-between shadow-lg drop-shadow-[0_4px_12px_rgba(245,158,11,0.3)]">
                    <div className="flex items-center gap-2 text-yellow-950 font-medium text-sm">
                        <svg className="w-5 h-5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        External commit detected on GitHub. Refresh file explorer to see changes.
                    </div>
                    <button onClick={() => {
                        setLocalCommitSha(project.lastKnownCommitSha || null);
                        if (deployConfig?.githubRepoOwner && deployConfig?.githubRepoName) {
                            setFileTreeLoading(true);
                            authFetch(`/api/agent?op=repo-files&repoOwner=${encodeURIComponent(deployConfig.githubRepoOwner)}&repoName=${encodeURIComponent(deployConfig.githubRepoName)}`)
                                .then(r => r.json())
                                .then((d: any) => setFileTree((d.files || []).filter((f: any) => f.type === 'file')))
                                .catch(() => { })
                                .finally(() => setFileTreeLoading(false));
                        }
                    }} className="bg-yellow-950 hover:bg-[#451a03] text-yellow-500 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm">
                        Sync Now
                    </button>
                </div>
            )}

            {/* Fullscreen background: preview iframe or placeholder */}
            {previewHtml || liveUrl ? (
                <FullscreenPreview html={previewHtml ?? ''} liveUrl={liveUrl} />
            ) : (
                /* Empty state backdrop */
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 select-none pointer-events-none">
                    <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center opacity-70">
                        <img
                            src="https://inrveiaulksfmzsbyzqj.supabase.co/storage/v1/object/public/images/Untitled%20design.svg"
                            alt="Logo"
                            className="w-8 h-8 object-contain"
                            style={{ filter: 'brightness(0) invert(1)' }}
                        />
                    </div>
                    <p className="text-white/20 text-sm font-medium tracking-wide">Preview will appear here</p>
                </div>
            )}

            {/* Top-left: project name (offset to make room for rail) */}
            <div className="absolute top-4 left-16 flex items-center gap-2 z-20">
                <div className="px-3 py-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/10">
                    <span className="text-white/90 text-xs font-medium truncate max-w-[180px] block">{project.name}</span>
                    <span className="text-white/40 text-[10px]">Canvas</span>
                </div>
            </div>

            {/* Top-right: live site + repo + claim links */}
            <div className="absolute top-4 right-4 flex items-center gap-2 z-20">
                {liveUrl && (
                    <div className="flex items-center gap-1.5">
                        <a href={liveUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 text-white hover:bg-white/20 transition-all font-medium">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            Live Site
                        </a>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(liveUrl);
                                setStatusText('Link copied!');
                                setTimeout(() => setStatusText(''), 2000);
                            }}
                            className="p-1.5 rounded-xl bg-black/40 backdrop-blur-md text-white/70 hover:text-white border border-white/10"
                            title="Copy Live Link"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                        </button>
                    </div>
                )}
                {deployConfig?.githubRepoUrl && transferState === 'transferred' && (
                    <a href={deployConfig.githubRepoUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl bg-black/40 backdrop-blur-md border border-white/10 text-white/60 hover:text-white hover:bg-black/60 transition-all font-medium">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
                        Repo
                    </a>
                )}
                {isDeployed && transferState !== 'transferred' && (
                    <button
                        onClick={handleClaimRepo}
                        disabled={transferState === 'transferring' || transferState === 'needs-github'}
                        className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 text-white hover:bg-white/20 transition-all font-medium disabled:opacity-50">
                        {transferState === 'transferring' || transferState === 'needs-github' ? '⏳ Claiming...' : '⬆ Claim Repo'}
                    </button>
                )}
                {transferState === 'transferred' && (
                    <span className="text-[11px] px-2.5 py-1.5 rounded-xl bg-emerald-500/20 backdrop-blur-md border border-emerald-500/30 text-emerald-300 font-medium">
                        ✓ Repo Claimed
                    </span>
                )}
            </div>

            {/* ── Floating chat panel — bottom center ── */}
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center w-full max-w-2xl px-4">

                {/* Message history — only shown when chat is open */}
                {chatOpen && messages.length > 0 && (
                    <div className="w-full mb-2 max-h-[40vh] overflow-y-auto flex flex-col gap-2 px-0.5">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} items-end gap-2`}>
                                {msg.role === 'agent' && (
                                    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mb-0.5 border border-white/10">
                                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                        </svg>
                                    </div>
                                )}
                                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed backdrop-bl-md ${msg.role === 'user'
                                    ? 'bg-white/10 text-white rounded-br-sm border border-white/15'
                                    : 'bg-black/70 border border-white/10 text-white/90 rounded-bl-sm'
                                    }`}>
                                    {msg.isStreaming && (
                                        <div className="flex items-center gap-1 mb-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-bounce" style={{ animationDelay: '0ms' }} />
                                            <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-bounce" style={{ animationDelay: '150ms' }} />
                                            <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-bounce" style={{ animationDelay: '300ms' }} />
                                        </div>
                                    )}
                                    <RenderText text={msg.text} />
                                    {msg.previewHtml && (
                                        <div className="mt-2 rounded-lg overflow-hidden border border-white/10 bg-black/20">
                                            {/* (Existing PreviewIframe would go here if we wanted it inline, but we use the background) */}
                                        </div>
                                    )}

                                    {(msg.previewUrl || msg.repoUrl || msg.commitSha) && (
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {msg.previewUrl && (
                                                <div className="flex gap-1.5">
                                                    <a href={msg.previewUrl} target="_blank" rel="noopener noreferrer"
                                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white text-black text-[11px] font-semibold hover:bg-gray-200 transition-colors">
                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                        Open
                                                    </a>
                                                    <button
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(msg.previewUrl!);
                                                            setStatusText('Link copied!');
                                                            setTimeout(() => setStatusText(''), 2000);
                                                        }}
                                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 text-white text-[11px] font-semibold hover:bg-white/20 transition-colors"
                                                    >
                                                        Copy Link
                                                    </button>
                                                </div>
                                            )}
                                            {msg.repoUrl && (
                                                <a href={msg.repoUrl} target="_blank" rel="noopener noreferrer"
                                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 text-white text-[11px] font-semibold hover:bg-white/20 transition-colors">
                                                    GitHub
                                                </a>
                                            )}
                                            {msg.commitSha && !isWorking && (
                                                <button
                                                    onClick={() => handleRevert(msg.commitSha!)}
                                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 text-white/90 text-[11px] font-semibold hover:bg-white/20 border border-white/20 transition-colors"
                                                >
                                                    ⏪ Revert to this point
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {msg.changedFiles && msg.changedFiles.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                            <span className="text-[10px] text-white/30 mr-1 self-center">Changed:</span>
                                            {msg.changedFiles.slice(0, 8).map((f: string) => (
                                                <button
                                                    key={f}
                                                    onClick={() => fetchFileContent(f)}
                                                    className="text-left px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/30 transition-colors text-[13px] text-white/70 hover:text-white"
                                                    title={f}
                                                >
                                                    {f.split('/').pop()}
                                                </button>
                                            ))}
                                            {msg.changedFiles.length > 8 && (
                                                <span className="text-[10px] text-white/30 self-center">+{msg.changedFiles.length - 8} more</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={bottomRef} />
                    </div>
                )}

                {/* Input container — the focal floating element */}
                <div className="w-full rounded-2xl overflow-hidden border border-white/15 bg-black/60 backdrop-blur-xl shadow-2xl shadow-black/50">
                    {/* Status bar — visible while working */}
                    {isWorking && statusText && (
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse flex-shrink-0" />
                            {activeAgent && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-white/80 font-medium uppercase tracking-wider">
                                    {activeAgent === 'orchestrator' ? '🎯 Orchestrator'
                                        : activeAgent === 'knowledge' ? '📚 Knowledge'
                                            : activeAgent === 'engineer' ? '🛠️ Engineer'
                                                : activeAgent === 'deploy' ? '🚀 Deploying'
                                                    : activeAgent}
                                </span>
                            )}
                            <span className="text-white/60 text-[11px] truncate">{statusText}</span>
                        </div>
                    )}

                    {/* Failed build warning bar */}
                    {checkStatus === 'error' && !isWorking && (
                        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-red-500/20 bg-red-500/10">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-red-400 text-lg flex-shrink-0">⚠️</span>
                                <span className="text-red-300 text-[12px] font-medium truncate">Last build failed</span>
                            </div>
                            <button
                                onClick={handleFixErrors}
                                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-red-600 hover:bg-gray-100 text-[11px] font-semibold transition-all shadow-sm"
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                Fix Errors
                            </button>
                        </div>
                    )}
                    {checkStatus === 'loading' && (
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
                            <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse flex-shrink-0" />
                            <span className="text-white/40 text-[11px]">Checking deployment status…</span>
                        </div>
                    )}

                    <div className="flex items-end gap-2 px-4 py-3">
                        {/* Toggle chat history button */}
                        <button
                            onClick={() => setChatOpen(o => !o)}
                            className="flex-shrink-0 p-2 rounded-xl text-white/40 hover:text-white/70 hover:bg-white/10 transition-all"
                            title={chatOpen ? 'Hide chat' : 'Show chat'}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                        </button>

                        <textarea
                            ref={inputRef}
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={isDeployed
                                ? "Describe changes to make… I'll redeploy automatically"
                                : "Describe the site you want to build…"
                            }
                            disabled={isWorking}
                            rows={2}
                            className="flex-1 resize-none outline-none text-sm bg-transparent leading-relaxed text-white placeholder-white/30 disabled:opacity-50"
                        />

                        <button
                            onClick={handleSend}
                            disabled={!inputText.trim() || isWorking}
                            className="flex-shrink-0 p-2.5 rounded-xl bg-white text-black hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-md"
                        >
                            {isWorking ? (
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                            )}
                        </button>
                    </div>
                </div>
            </div>
            {/* ── IDE-Style Side Rail ── */}
            <div className="absolute top-0 left-0 bottom-0 w-14 z-[60] bg-black/70 backdrop-blur-xl border-r border-white/10 flex flex-col items-center py-4 gap-4">
                <div className="mb-4">
                    <div className="w-8 h-8 rounded-lg bg-white/8 flex items-center justify-center border border-white/15">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                    </div>
                </div>

                <button
                    onClick={() => setSidebarView(v => v === 'files' ? 'none' : 'files')}
                    className={`p-2.5 rounded-xl transition-all ${sidebarView === 'files' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/80 hover:bg-white/5'}`}
                    title="File Explorer"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                </button>

                <button
                    onClick={() => {
                        if (sidebarView !== 'history') fetchHistory();
                        setSidebarView(v => v === 'history' ? 'none' : 'history');
                    }}
                    className={`p-2.5 rounded-xl transition-all ${sidebarView === 'history' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/80 hover:bg-white/5'}`}
                    title="Version History"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>

                <button
                    onClick={() => {
                        if (sidebarView !== 'env') fetchEnvVars();
                        setSidebarView(v => v === 'env' ? 'none' : 'env');
                    }}
                    className={`p-2.5 rounded-xl transition-all ${sidebarView === 'env' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/80 hover:bg-white/5'}`}
                    title="Environment Variables"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                </button>

                {deployConfig?.vercelProjectId && liveUrl && (
                    <button
                        onClick={() => { setShowDomainModal(true); checkDomainStatus(); }}
                        className="p-2.5 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-all"
                        title="Custom Domain"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                    </button>
                )}

                <button
                    onClick={() => setChatOpen(o => !o)}
                    className={`p-2.5 rounded-xl transition-all ${chatOpen ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/80 hover:bg-white/5'}`}
                    title="Toggle Chat"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                </button>

                <div className="mt-auto flex flex-col gap-4">

                    <button
                        onClick={onBack}
                        className="p-2.5 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-all"
                        title="Back to Dashboard"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z" /></svg>
                    </button>
                </div>
            </div>

            {/* ── Sidebar Pane Overlay ── */}
            {sidebarView === 'history' && (
                <div className="absolute inset-y-0 left-14 w-80 z-50 bg-black/80 backdrop-blur-2xl border-r border-white/10 shadow-2xl animate-slide-in-left flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-white/10">
                        <h3 className="text-white font-semibold text-sm">Version History</h3>
                        <button onClick={() => setSidebarView('none')} className="text-white/40 hover:text-white p-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    <div className="overflow-y-auto flex-1 p-4 space-y-3">
                        {transferState !== 'transferred' ? (
                            <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                                    <svg className="w-6 h-6 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                </div>
                                <div>
                                    <h4 className="text-white font-medium text-sm mb-1.5">Claim Project</h4>
                                    <p className="text-white/40 text-[11px] leading-relaxed">Connect your GitHub account to access the version history and full code control.</p>
                                </div>
                                <button
                                    onClick={handleClaimRepo}
                                    className="w-full py-2.5 rounded-xl bg-white text-black font-semibold text-xs shadow-lg hover:bg-gray-100 transition-all"
                                >
                                    Claim Repository
                                </button>
                            </div>
                        ) : historyLoading ? (
                            <div className="flex flex-col items-center justify-center py-10 gap-3">
                                <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span className="text-white/40 text-xs">Loading versions...</span>
                            </div>
                        ) : (
                            historyCommits.map((c: any) => (
                                <div key={c.sha} className="p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/20 transition-all group">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] font-mono text-white/70 bg-white/10 px-1.5 py-0.5 rounded">
                                            {c.sha.slice(0, 7)}
                                        </span>
                                        <span className="text-[10px] text-white/30 italic">
                                            {new Date(c.date).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <p className="text-white/80 text-[12px] leading-snug mb-3">{c.message}</p>
                                    <button
                                        onClick={() => handleRevert(c.sha)}
                                        disabled={isWorking}
                                        className="w-full py-3.5 rounded-xl bg-white text-black font-semibold text-sm shadow-lg hover:bg-gray-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5"
                                    >
                                        Revert to this point
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* ── File Explorer Pane ── */}
            {sidebarView === 'files' && (
                <div className="absolute inset-y-0 left-14 w-80 z-50 bg-black/80 backdrop-blur-2xl border-r border-white/10 shadow-2xl animate-slide-in-left flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-white/10">
                        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                            <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                            </svg>
                            File Explorer
                        </h3>
                        <button onClick={() => setSidebarView('none')} className="text-white/40 hover:text-white p-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    <div className="overflow-y-auto flex-1 p-3">
                        {transferState !== 'transferred' ? (
                            <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                                    <svg className="w-6 h-6 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                </div>
                                <div>
                                    <h4 className="text-white font-medium text-sm mb-1.5">Claim Project</h4>
                                    <p className="text-white/40 text-[11px] leading-relaxed">Connect your GitHub account to browse files and take ownership of the code.</p>
                                </div>
                                <button
                                    onClick={handleClaimRepo}
                                    className="w-full py-2.5 rounded-xl bg-white text-black font-semibold text-xs shadow-lg hover:bg-gray-100 transition-all"
                                >
                                    Claim Repository
                                </button>
                            </div>
                        ) : fileTreeLoading ? (
                            <div className="flex flex-col items-center justify-center py-10 gap-3">
                                <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span className="text-white/40 text-xs">Loading files...</span>
                            </div>
                        ) : fileTree.length === 0 ? (
                            <p className="text-center text-white/20 text-xs py-10">No files yet — deploy your site first</p>
                        ) : (() => {
                            const tree = buildFileTree(fileTree);

                            const renderNode = (node: FileTreeNode, level: number = 0) => {
                                const isExpanded = expandedDirs.has(node.path);
                                const isSelected = selectedFilePath === node.path;
                                const ext = node.name.split('.').pop() || '';
                                const iconColor = ['ts', 'tsx'].includes(ext) ? 'text-blue-400'
                                    : ['js', 'jsx'].includes(ext) ? 'text-yellow-400'
                                        : ['css', 'scss'].includes(ext) ? 'text-purple-400'
                                            : ['json'].includes(ext) ? 'text-green-400'
                                                : ['md'].includes(ext) ? 'text-white/50'
                                                    : 'text-white/40';

                                if (node.type === 'dir') {
                                    return (
                                        <div key={node.path} className="select-none">
                                            <button
                                                onClick={() => setExpandedDirs(prev => {
                                                    const next = new Set(prev);
                                                    next.has(node.path) ? next.delete(node.path) : next.add(node.path);
                                                    return next;
                                                })}
                                                style={{ paddingLeft: `${level * 12 + 8}px` }}
                                                className="w-full flex items-center gap-2 py-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-all text-[12px] group"
                                            >
                                                <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                </svg>
                                                <svg className="w-3.5 h-3.5 text-yellow-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                                </svg>
                                                <span className="truncate font-medium">{node.name}</span>
                                            </button>
                                            {isExpanded && (
                                                <div className="relative">
                                                    {/* Hierarchy line */}
                                                    <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-white/5 shadow-[0_0_8px_rgba(255,255,255,0.02)]" style={{ left: `${level * 12 + 13}px` }} />
                                                    {node.children.map(child => renderNode(child, level + 1))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }

                                return (
                                    <button
                                        key={node.path}
                                        onClick={() => fetchFileContent(node.path)}
                                        style={{ paddingLeft: `${level * 12 + 24}px` }}
                                        className={`w-full flex items-center gap-2 py-1.5 rounded-lg text-[12px] transition-all group ${isSelected
                                            ? 'bg-white/10 text-white border border-white/20'
                                            : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                                            }`}
                                    >
                                        <span className={`w-7 text-[9px] font-mono text-center flex-shrink-0 opacity-50 ${iconColor}`}>{ext.toUpperCase().slice(0, 3)}</span>
                                        <span className="truncate">{node.name}</span>
                                    </button>
                                );
                            };

                            return (
                                <div className="space-y-0.5 pb-20">
                                    {tree.map(node => renderNode(node))}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* ── Environment Variables Pane ── */}
            {sidebarView === 'env' && (
                <div className="absolute inset-y-0 left-14 w-80 z-50 bg-black/80 backdrop-blur-2xl border-r border-white/10 shadow-2xl animate-slide-in-left flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-white/10">
                        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                            <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                            </svg>
                            Environment Variables
                        </h3>
                        <div className="flex items-center gap-1">
                            <button onClick={fetchEnvVars} className="p-1.5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-all" title="Refresh">
                                <svg className={`w-4 h-4 ${envLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            </button>
                            <button onClick={() => setSidebarView('none')} className="text-white/40 hover:text-white p-1">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-3 pb-24">
                        {!deployConfig?.vercelProjectId ? (
                            <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/20">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                </div>
                                <p className="text-white/40 text-[11px] leading-relaxed">Deploy your site first to manage environment variables.</p>
                            </div>
                        ) : envLoading && vercelEnvVars.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 gap-3">
                                <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span className="text-white/40 text-xs">Loading variables...</span>
                            </div>
                        ) : (
                            <>
                                {envError && (
                                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">
                                        {envError}
                                    </div>
                                )}
                                
                                <div className="space-y-2">
                                    {vercelEnvVars.map(env => (
                                        <div key={env.id} className="p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/20 transition-all group">
                                            <div className="flex items-start justify-between mb-1.5 min-w-0">
                                                <div className="min-w-0 flex-1">
                                                    <h4 className="text-white/90 font-mono text-[12px] truncate pr-2" title={env.key}>{env.key}</h4>
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {env.target.map((t: string) => (
                                                            <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white/40 uppercase tracking-wider">{t}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                                <button 
                                                    onClick={() => handleRemoveEnvVar(env.id)}
                                                    className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-all opacity-0 group-hover:opacity-100"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                </button>
                                            </div>
                                            
                                            <div className="relative mt-2">
                                                <input 
                                                    type={revealEnvIds.has(env.id) ? "text" : "password"}
                                                    value={revealEnvIds.has(env.id) ? (env.value || "No value") : "••••••••••••••••"}
                                                    readOnly
                                                    className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-white/60 outline-none"
                                                />
                                                <button 
                                                    onClick={() => setRevealEnvIds(prev => {
                                                        const next = new Set(prev);
                                                        next.has(env.id) ? next.delete(env.id) : next.add(env.id);
                                                        return next;
                                                    })}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors"
                                                >
                                                    {revealEnvIds.has(env.id) ? 
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" /></svg> : 
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                    }
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    
                                    {vercelEnvVars.length === 0 && !envLoading && (
                                        <div className="py-8 flex flex-col items-center justify-center text-center opacity-30">
                                            <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                            <p className="text-[10px]">No environment variables yet</p>
                                        </div>
                                    )}
                                </div>
                                
                                <button 
                                    onClick={() => setShowAddEnvModal(true)}
                                    className="w-full py-2.5 rounded-xl border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-white font-medium text-xs transition-all flex items-center justify-center gap-2 mt-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                    Add Variable
                                </button>

                                <div className="pt-6 border-t border-white/10 mt-6 pb-2">
                                    <h4 className="text-white/60 font-medium text-[10px] uppercase tracking-wider mb-3 px-1">Custom Environments</h4>
                                    <div className="space-y-2">
                                        {vercelCustomEnvs.map(env => (
                                            <div key={env.id} className="p-3 rounded-xl bg-white/5 border border-white/5 group flex items-center justify-between">
                                                <div className="min-w-0">
                                                    <p className="text-white text-[12px] font-medium truncate">{env.slug}</p>
                                                    <p className="text-white/40 text-[9px] uppercase tracking-tighter mt-0.5">{env.type}</p>
                                                </div>
                                                <button 
                                                    onClick={() => handleRemoveCustomEnv(env.id)}
                                                    className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-all opacity-0 group-hover:opacity-100"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                </button>
                                            </div>
                                        ))}
                                        {vercelCustomEnvs.length === 0 && (
                                            <p className="text-white/20 text-[10px] text-center py-4 italic">No custom environments</p>
                                        )}
                                        <button 
                                            onClick={() => setShowAddCustomEnvModal(true)}
                                            className="w-full py-2.5 rounded-xl border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white font-medium text-xs transition-all flex items-center justify-center gap-2 mt-2"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                            New Custom Environment
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ── Code Viewer Overlay ── */}
            {selectedFilePath && selectedFileContent !== null && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center p-8 bg-black/70 backdrop-blur-sm" onClick={() => { setSelectedFilePath(null); setSelectedFileContent(null); }}>
                    <div className="w-full max-w-4xl max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden bg-[#1a1a1e] border border-white/10 flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-black/30">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-white bg-white/10 px-1.5 py-0.5 rounded">
                                    {selectedFilePath.split('.').pop()?.toUpperCase() || 'FILE'}
                                </span>
                                <span className="text-white/80 text-sm font-medium">{selectedFilePath}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => { navigator.clipboard.writeText(selectedFileContent || ''); setStatusText('Copied!'); setTimeout(() => setStatusText(''), 2000); }}
                                    className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-all"
                                >
                                    Copy
                                </button>
                                <button onClick={() => { setSelectedFilePath(null); setSelectedFileContent(null); }} className="text-white/40 hover:text-white p-1">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        </div>
                        <div className="overflow-auto flex-1 p-0">
                            {fileContentLoading ? (
                                <div className="flex items-center justify-center py-16">
                                    <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                </div>
                            ) : (
                                <pre className="text-[12px] leading-relaxed font-mono text-white/80 p-4 whitespace-pre overflow-x-auto">
                                    {(selectedFileContent || '').split('\n').map((line, i) => (
                                        <div key={i} className="flex hover:bg-white/5 -mx-4 px-4">
                                            <span className="w-10 flex-shrink-0 text-right pr-4 text-white/20 select-none">{i + 1}</span>
                                            <span>{line || ' '}</span>
                                        </div>
                                    ))}
                                </pre>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Custom Domain Modal ── */}
            {showDomainModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowDomainModal(false)}>
                    <div className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden bg-[#1d1d1f] border border-[#3d3d3f]" onClick={e => e.stopPropagation()}>
                        <div className="px-6 py-4 border-b border-[#3d3d3f] flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-semibold text-white">🌐 Custom Domain</h3>
                                <p className="text-sm mt-1 text-[#86868b]">Map your own domain to this website</p>
                            </div>
                            <button onClick={() => setShowDomainModal(false)} className="p-2 rounded-full hover:bg-white/10 text-[#86868b]">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {domainLoading && !domainStatus ? (
                                <div className="flex items-center justify-center py-8 relative">
                                    <div className="w-16 h-16 rounded-full border-4 border-white/10" />
                                    <div className="absolute inset-0 rounded-full border-4 border-white/60 border-t-transparent animate-spin" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                                    </div>
                                </div>
                            ) : deployConfig?.customDomain ? (
                                <div className="space-y-4">
                                    <div className="p-4 rounded-xl bg-[#111111] border border-[#3d3d3f]">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-xs font-medium uppercase tracking-wider text-[#86868b]">Current Domain</p>
                                                <p className="text-lg font-semibold mt-1 text-white">{deployConfig.customDomain}</p>
                                            </div>
                                            <div className={`px-3 py-1 rounded-full text-xs font-medium ${deployConfig.domainVerified ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                                {deployConfig.domainVerified ? '✓ Verified' : '⏳ Pending'}
                                            </div>
                                        </div>
                                    </div>

                                    {!deployConfig.domainVerified && domainStatus?.misconfigured && (
                                        <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                                            <p className="text-sm font-medium mb-2 text-yellow-400">⚠️ DNS Configuration Required</p>
                                            <p className="text-xs mb-3 text-yellow-400/70">Please configure your domain's DNS settings to point to Vercel:</p>

                                            {domainStatus?.recommendedIPv4 && domainStatus.recommendedIPv4.length > 0 && (
                                                <div className="p-3 rounded-lg text-xs font-mono bg-black/30 mb-2">
                                                    <p className="text-[#86868b] mb-1 font-medium">A Record (Root Domains)</p>
                                                    <p className="text-[#86868b]">Name: <span className="text-white font-semibold">@</span></p>
                                                    <p className="text-[#86868b]">Value: <span className="text-white font-semibold break-all">{domainStatus.recommendedIPv4[0]?.value?.[0] || '76.76.21.21'}</span></p>
                                                </div>
                                            )}

                                            {domainStatus?.recommendedCNAME && domainStatus.recommendedCNAME.length > 0 && (
                                                <div className="p-3 rounded-lg text-xs font-mono bg-black/30 mb-2">
                                                    <p className="text-[#86868b] mb-1 font-medium">CNAME Record (Subdomains)</p>
                                                    <p className="text-[#86868b]">Name: <span className="text-white font-semibold">www</span></p>
                                                    <p className="text-[#86868b]">Value: <span className="text-white font-semibold break-all">{domainStatus.recommendedCNAME[0]?.value || 'cname.vercel-dns.com'}</span></p>
                                                </div>
                                            )}

                                            {(!domainStatus?.recommendedIPv4?.length && !domainStatus?.recommendedCNAME?.length && domainStatus?.verification?.length > 0) && (
                                                // Fallback to legacy project domain verification if config is missing
                                                domainStatus.verification.map((v: any, idx: number) => (
                                                    <div key={idx} className="p-3 rounded-lg text-xs font-mono bg-black/30 mb-2">
                                                        <p className="text-[#86868b]">Type: <span className="text-white font-semibold">{v.type}</span></p>
                                                        <p className="text-[#86868b]">Name: <span className="text-white font-semibold">{v.domain}</span></p>
                                                        <p className="text-[#86868b]">Value: <span className="text-white font-semibold break-all">{v.value}</span></p>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}

                                    {!domainStatus?.misconfigured && !deployConfig.domainVerified && !domainStatus?.verification && (
                                        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                                            <p className="text-sm font-medium mb-1 text-white/90">DNS Configured ✅</p>
                                            <p className="text-xs text-white/40">Your DNS records are pointing to Vercel! Click verify to complete setup.</p>
                                        </div>
                                    )}

                                    <div className="flex gap-3">
                                        <button onClick={handleVerifyDomain} disabled={domainLoading} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/5 text-white hover:bg-white/10 transition-all disabled:opacity-50">
                                            {domainLoading ? 'Checking...' : '🔄 Check Status'}
                                        </button>
                                        <button onClick={handleRemoveDomain} disabled={domainLoading} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all">
                                            🗑️ Remove
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-2 text-[#86868b]">Enter your domain</label>
                                        <input
                                            type="text"
                                            value={domainInput}
                                            onChange={e => setDomainInput(e.target.value)}
                                            placeholder="example.com or www.example.com"
                                            className="w-full px-4 py-3 rounded-xl text-sm bg-[#111111] border border-[#3d3d3f] text-white placeholder-[#636366] focus:border-[#0071e3] outline-none transition-colors"
                                        />
                                    </div>
                                    {domainError && <div className="p-3 rounded-xl bg-red-500/20 text-red-400 text-sm">❌ {domainError}</div>}
                                    <button
                                        onClick={handleAddDomain}
                                        disabled={domainLoading || !domainInput.trim()}
                                        className="w-full px-4 py-3 rounded-xl text-sm font-semibold bg-white text-black hover:bg-gray-200 shadow-lg transition-all disabled:opacity-50"
                                    >
                                        {domainLoading ? 'Adding...' : '🌐 Add Custom Domain'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Add Environment Variable Modal ── */}
            {showAddEnvModal && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddEnvModal(false)}>
                    <div className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden bg-[#1d1d1f] border border-[#3d3d3f]" onClick={e => e.stopPropagation()}>
                        <div className="px-6 py-4 border-b border-[#3d3d3f] flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-white">➕ Add Variable</h3>
                            <button onClick={() => setShowAddEnvModal(false)} className="p-2 rounded-full hover:bg-white/10 text-[#86868b]">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        
                        <div className="p-6 space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[#86868b] uppercase tracking-wider">Key</label>
                                <input 
                                    type="text" 
                                    value={newEnvVar.key}
                                    onChange={e => setNewEnvVar(prev => ({ ...prev, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
                                    placeholder="DATABASE_URL"
                                    className="w-full px-4 py-3 rounded-xl bg-[#111111] border border-[#3d3d3f] text-white font-mono text-sm outline-none focus:border-white/20 transition-all"
                                />
                            </div>
                            
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[#86868b] uppercase tracking-wider">Value</label>
                                <textarea 
                                    value={newEnvVar.value}
                                    onChange={e => setNewEnvVar(prev => ({ ...prev, value: e.target.value }))}
                                    placeholder="Your secret value..."
                                    rows={3}
                                    className="w-full px-4 py-3 rounded-xl bg-[#111111] border border-[#3d3d3f] text-white font-mono text-sm outline-none focus:border-white/20 transition-all resize-none"
                                />
                            </div>
                            
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-[#86868b] uppercase tracking-wider">Target Environments</label>
                                <div className="flex flex-wrap gap-2">
                                    {['production', 'preview', 'development'].map(t => (
                                        <button 
                                            key={t}
                                            onClick={() => setNewEnvVar(prev => ({
                                                ...prev,
                                                target: prev.target.includes(t) 
                                                    ? prev.target.filter(x => x !== t) 
                                                    : [...prev.target, t]
                                            }))}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition-all border ${
                                                newEnvVar.target.includes(t) 
                                                    ? 'bg-white text-black border-white' 
                                                    : 'bg-white/5 text-white/40 border-white/10 hover:border-white/20'
                                            }`}
                                        >
                                            {t}
                                        </button>
                                    ))}
                                    {vercelCustomEnvs.map(env => (
                                        <button 
                                            key={env.id}
                                            onClick={() => setNewEnvVar(prev => ({
                                                ...prev,
                                                target: prev.target.includes(env.id) 
                                                    ? prev.target.filter(x => x !== env.id) 
                                                    : [...prev.target, env.id]
                                            }))}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition-all border ${
                                                newEnvVar.target.includes(env.id) 
                                                    ? 'bg-white text-black border-white' 
                                                    : 'bg-white/5 text-white/40 border-white/10 hover:border-white/20'
                                            }`}
                                        >
                                            {env.slug}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            <div className="pt-4 flex gap-3">
                                <button 
                                    onClick={() => setShowAddEnvModal(false)}
                                    className="flex-1 px-4 py-3 rounded-xl text-sm font-medium border border-white/10 text-white/60 hover:text-white transition-all"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={handleAddEnvVar}
                                    disabled={!newEnvVar.key || !newEnvVar.value || newEnvVar.target.length === 0 || envLoading}
                                    className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-white text-black hover:bg-gray-200 shadow-lg disabled:opacity-50 transition-all"
                                >
                                    {envLoading ? 'Adding...' : 'Add Variable'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Add Custom Environment Modal ── */}
            {showAddCustomEnvModal && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddCustomEnvModal(false)}>
                    <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden bg-[#1d1d1f] border border-[#3d3d3f]" onClick={e => e.stopPropagation()}>
                        <div className="px-6 py-4 border-b border-[#3d3d3f] flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-white">🏷️ New Environment</h3>
                            <button onClick={() => setShowAddCustomEnvModal(false)} className="p-2 rounded-full hover:bg-white/10 text-[#86868b]">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        
                        <div className="p-6 space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[#86868b] uppercase tracking-wider">Environment Slug</label>
                                <input 
                                    type="text" 
                                    value={newCustomEnv.slug}
                                    onChange={e => setNewCustomEnv(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                                    placeholder="staging"
                                    className="w-full px-4 py-3 rounded-xl bg-[#111111] border border-[#3d3d3f] text-white text-sm outline-none focus:border-white/20 transition-all font-mono"
                                />
                                <p className="text-[10px] text-[#86868b]">Only lowercase, numbers, and hyphens.</p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-medium text-[#86868b] uppercase tracking-wider">Environment Type</label>
                                <div className="flex gap-2">
                                    {(['production', 'preview', 'development'] as const).map(t => (
                                        <button 
                                            key={t}
                                            onClick={() => setNewCustomEnv(prev => ({ ...prev, type: t }))}
                                            className={`px-3 py-1.5 rounded-lg text-[10px] font-medium uppercase tracking-wider transition-all border flex-1 ${
                                                newCustomEnv.type === t 
                                                    ? 'bg-white text-black border-white' 
                                                    : 'bg-white/5 text-white/40 border-white/10 hover:border-white/20'
                                            }`}
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            <div className="pt-4 flex gap-3">
                                <button 
                                    onClick={() => setShowAddCustomEnvModal(false)}
                                    className="flex-1 px-4 py-3 rounded-xl text-sm font-medium border border-white/10 text-white/60 hover:text-white transition-all"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={handleAddCustomEnv}
                                    disabled={!newCustomEnv.slug || envLoading}
                                    className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-white text-black hover:bg-gray-200 shadow-lg disabled:opacity-50 transition-all"
                                >
                                    {envLoading ? 'Creating...' : 'Create'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
