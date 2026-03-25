import React, { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import { getAllUsersForAdmin, getAllProjectsForAdmin, FirestoreUser, subscribeToGlobalActivity, GlobalActivityEvent } from '../services/firebase';
import { ResearchProject, ProjectTask, ApiDocEntry } from '../types';
import { authFetch } from '../services/authFetch';
import { apiDocsService } from '../services/apiDocsService';

interface AdminPortalProps {
    user: User;
    onNavigateToProject: (projectId: string, ownerUid: string) => void;
    onBack: () => void;
    isDarkMode: boolean;
}

interface GlobalTask {
    project: ResearchProject;
    task: ProjectTask;
}

// ─── Icons ────────────────────────────────────────────────────────────

const ShieldAlertIcon = () => <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
const UsersIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
const FolderKanbanIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>;
const CheckSquareIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>;
const SearchIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;
const ArrowRightIcon = () => <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>;
const ArrowLeftIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>;
const Loader2Icon = () => <svg className="w-8 h-8 animate-spin text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
const ActivityIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>;
const RocketIcon = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>;
const XIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>;

// ─── Activity type metadata ────────────────────────────────────────────

const ACTIVITY_META: Record<string, { icon: string; color: string; category: string }> = {
    image_generated: { icon: '🎨', color: 'text-pink-400', category: 'AI Generation' },
    video_generated: { icon: '🎬', color: 'text-red-400', category: 'AI Generation' },
    website_generated: { icon: '🌐', color: 'text-emerald-400', category: 'AI Generation' },
    blog_generated: { icon: '📝', color: 'text-amber-400', category: 'AI Generation' },
    podcast_generated: { icon: '🎙️', color: 'text-indigo-400', category: 'AI Generation' },
    world_generated: { icon: '🌍', color: 'text-teal-400', category: 'AI Generation' },
    book_generated: { icon: '📚', color: 'text-orange-400', category: 'AI Generation' },
    table_generated: { icon: '📊', color: 'text-cyan-400', category: 'AI Generation' },
    form_generated: { icon: '📋', color: 'text-sky-400', category: 'AI Generation' },
    image_edited: { icon: '✏️', color: 'text-purple-400', category: 'AI Generation' },
    website_edited: { icon: '🔧', color: 'text-lime-400', category: 'AI Generation' },
    voice_cloned: { icon: '🎤', color: 'text-fuchsia-400', category: 'AI Generation' },
    note_added: { icon: '🗒️', color: 'text-yellow-400', category: 'Content' },
    note_updated: { icon: '✍️', color: 'text-yellow-300', category: 'Content' },
    asset_added: { icon: '📎', color: 'text-blue-400', category: 'Content' },
    asset_created: { icon: '✨', color: 'text-blue-300', category: 'Content' },
    file_uploaded: { icon: '📤', color: 'text-gray-400', category: 'Content' },
    file_deleted: { icon: '🗑️', color: 'text-gray-500', category: 'Content' },
    file_edited: { icon: '📄', color: 'text-gray-400', category: 'Content' },
    website_shared: { icon: '🔗', color: 'text-violet-400', category: 'Content' },
    post_published: { icon: '📣', color: 'text-green-400', category: 'Content' },
    post_scheduled: { icon: '🗓️', color: 'text-green-300', category: 'Content' },
    email_sent: { icon: '✉️', color: 'text-blue-400', category: 'Content' },
    email_scheduled: { icon: '📧', color: 'text-blue-300', category: 'Content' },
    task_added: { icon: '✅', color: 'text-emerald-400', category: 'Tasks & Notes' },
    task_completed: { icon: '🏁', color: 'text-emerald-300', category: 'Tasks & Notes' },
    research_added: { icon: '🔬', color: 'text-sky-400', category: 'Tasks & Notes' },
    research_deleted: { icon: '🗑️', color: 'text-sky-300', category: 'Tasks & Notes' },
    comment_added: { icon: '💬', color: 'text-gray-400', category: 'Tasks & Notes' },
    collaborator_added: { icon: '👥', color: 'text-violet-300', category: 'System' },
    project_updated: { icon: '🔄', color: 'text-gray-400', category: 'System' },
    product_created: { icon: '🛍️', color: 'text-pink-400', category: 'System' },
    app_request_submitted: { icon: '📱', color: 'text-orange-400', category: 'System' },
    pdf_generated: { icon: '📄', color: 'text-red-300', category: 'AI Generation' },
};

const ACTIVITY_CATEGORIES = ['All', 'AI Generation', 'Content', 'Tasks & Notes', 'System'];

function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString();
}

import { AdminAgentSwarm } from './AdminAgentSwarm';

// ─── Smart Dispatch Popover ─────────────────────────────────────────────

interface DispatchPopoverProps {
    user: User;
    projectId: string;
    ownerUid: string;
    onClose: () => void;
    isDarkMode: boolean;
}

const DispatchPopover: React.FC<DispatchPopoverProps> = ({ user, projectId, ownerUid, onClose, isDarkMode }) => {
    const [goal, setGoal] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    const handleDispatch = async () => {
        if (!goal.trim()) return;
        setSubmitting(true);
        try {
            const token = await user.getIdToken();
            await authFetch('/api/admin-tools', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ tool: 'dispatch_agent', args: { userId: ownerUid, projectId, goal: goal.trim() } }),
            });
            setSuccess(true);
            setTimeout(onClose, 1200);
        } catch (e) {
            console.error('[Dispatch] Failed:', e);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className={`absolute right-0 top-10 z-50 w-72 rounded-xl shadow-2xl border p-4 ${isDarkMode ? 'bg-[#18181A] border-[#3F3F46]' : 'bg-white border-gray-200'}`}
            onClick={(e) => e.stopPropagation()}>
            {success ? (
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium py-2">
                    <span>✓</span> Agent dispatched! Check the Swarm tab.
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wide">Dispatch Agent</span>
                        <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><XIcon /></button>
                    </div>
                    <textarea
                        autoFocus
                        value={goal}
                        onChange={(e) => setGoal(e.target.value)}
                        placeholder="e.g. Summarize the project notes into 3 key insights and create a task for each..."
                        rows={3}
                        className={`w-full text-sm rounded-lg border p-2 resize-none outline-none mb-3 ${isDarkMode ? 'bg-[#0f0f11] border-[#2E2E32] text-gray-200 placeholder-gray-600' : 'bg-gray-50 border-gray-200 text-gray-800 placeholder-gray-400'}`}
                    />
                    <button
                        onClick={handleDispatch}
                        disabled={submitting || !goal.trim()}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                    >
                        {submitting ? <span className="animate-spin">⟳</span> : <RocketIcon />}
                        {submitting ? 'Dispatching...' : 'Launch Agent'}
                    </button>
                </>
            )}
        </div>
    );
};

// ─── Edit User Modal ───────────────────────────────────────────────────

interface EditUserModalProps {
    user: User;
    targetUser: FirestoreUser;
    onClose: () => void;
    onUpdated: () => void;
    isDarkMode: boolean;
}

const EditUserModal: React.FC<EditUserModalProps> = ({ user, targetUser, onClose, onUpdated, isDarkMode }) => {
    const [credits, setCredits] = useState(targetUser.credits || 0);
    const [subscribed, setSubscribed] = useState(targetUser.subscribed || false);
    const [unlimited, setUnlimited] = useState(targetUser.unlimited || false);
    const [tier, setTier] = useState(targetUser.subscriptionTier || 'pro');
    const [displayName, setDisplayName] = useState(targetUser.displayName || '');
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            const token = await user.getIdToken();
            await authFetch('/api/admin-tools', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    tool: 'update_user',
                    args: {
                        userId: targetUser.uid,
                        updates: {
                            credits,
                            subscribed,
                            unlimited,
                            subscriptionTier: tier,
                            displayName
                        }
                    }
                }),
            });
            onUpdated();
            onClose();
        } catch (e) {
            console.error('[EditUser] Failed:', e);
            alert('Failed to update user');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className={`w-full max-w-md rounded-2xl shadow-2xl border ${isDarkMode ? 'bg-[#18181A] border-[#2E2E32]' : 'bg-white border-gray-200'}`}>
                <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-[#2E2E32]">
                    <h3 className="text-lg font-semibold">Edit User</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><XIcon /></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-gray-400 uppercase mb-1">Display Name</label>
                        <input
                            value={displayName}
                            onChange={e => setDisplayName(e.target.value)}
                            className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${isDarkMode ? 'bg-[#0f0f11] border-[#2E2E32] text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-400 uppercase mb-1">Credits</label>
                        <input
                            type="number"
                            value={credits}
                            onChange={e => setCredits(parseInt(e.target.value) || 0)}
                            className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${isDarkMode ? 'bg-[#0f0f11] border-[#2E2E32] text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">Subscribed</label>
                        <input
                            type="checkbox"
                            checked={subscribed}
                            onChange={e => setSubscribed(e.target.checked)}
                            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">Unlimited Plan</label>
                        <input
                            type="checkbox"
                            checked={unlimited}
                            onChange={e => setUnlimited(e.target.checked)}
                            className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-400 uppercase mb-1">Tier</label>
                        <select
                            value={tier}
                            onChange={e => setTier(e.target.value as any)}
                            className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${isDarkMode ? 'bg-[#0f0f11] border-[#2E2E32] text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
                        >
                            <option value="pro">Pro</option>
                            <option value="unlimited">Unlimited</option>
                        </select>
                    </div>
                </div>
                <div className="p-6 pt-0">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50 transition-colors"
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Main AdminPortal Component ─────────────────────────────────────────

export const AdminPortal: React.FC<AdminPortalProps> = ({ user, onNavigateToProject, onBack, isDarkMode }) => {
    const [activeTab, setActiveTab] = useState<'activity' | 'users' | 'projects' | 'tasks' | 'swarm' | 'docs'>('activity');
    const [loading, setLoading] = useState(true);

    // API Docs state
    const [apiDocs, setApiDocs] = useState<ApiDocEntry[]>([]);
    const [docsLoading, setDocsLoading] = useState(false);
    const [newDocApi, setNewDocApi] = useState('');
    const [newDocTags, setNewDocTags] = useState('');
    const [newDocContent, setNewDocContent] = useState('');
    const [savingDoc, setSavingDoc] = useState(false);

    const [users, setUsers] = useState<FirestoreUser[]>([]);
    const [projects, setProjects] = useState<ResearchProject[]>([]);
    const [globalTasks, setGlobalTasks] = useState<GlobalTask[]>([]);

    const [globalActivity, setGlobalActivity] = useState<GlobalActivityEvent[]>([]);
    const [activityCategory, setActivityCategory] = useState<string>('All');

    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<ProjectTask['status'] | 'all'>('all');
    const [priorityFilter, setPriorityFilter] = useState<ProjectTask['priority'] | 'all'>('all');

    const [dispatchOpen, setDispatchOpen] = useState<string | null>(null); // projectId
    const [editingUser, setEditingUser] = useState<FirestoreUser | null>(null);

    useEffect(() => {
        if (user.email !== 'contact.mngrm@gmail.com') return;

        const loadData = async () => {
            setLoading(true);
            try {
                const [fetchedUsers, fetchedProjects] = await Promise.all([
                    getAllUsersForAdmin(),
                    getAllProjectsForAdmin(),
                ]);
                setUsers(fetchedUsers);
                setProjects(fetchedProjects);

                const tasks: GlobalTask[] = [];
                fetchedProjects.forEach(p => {
                    (p.tasks || []).forEach(t => tasks.push({ project: p, task: t }));
                });
                tasks.sort((a, b) => b.task.createdAt - a.task.createdAt);
                setGlobalTasks(tasks);
            } catch (error) {
                console.error("Error loading admin data:", error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [user]);

    const handleRefresh = async () => {
        setLoading(true);
        try {
            const [fetchedUsers, fetchedProjects] = await Promise.all([
                getAllUsersForAdmin(),
                getAllProjectsForAdmin(),
            ]);
            setUsers(fetchedUsers);
            setProjects(fetchedProjects);
        } finally {
            setLoading(false);
        }
    };

    // Subscribe to global activity stream
    useEffect(() => {
        if (user.email !== 'contact.mngrm@gmail.com') return;
        const unsub = subscribeToGlobalActivity((events) => setGlobalActivity(events));
        return () => unsub();
    }, [user]);

    // Load API docs when tab is opened
    useEffect(() => {
        if (activeTab !== 'docs') return;
        setDocsLoading(true);
        apiDocsService.getAllDocs().then(docs => {
            setApiDocs(docs);
            setDocsLoading(false);
        });
    }, [activeTab]);

    const handleSaveDoc = async () => {
        if (!newDocApi.trim() || !newDocContent.trim()) return;
        setSavingDoc(true);
        try {
            await apiDocsService.saveDoc({
                api: newDocApi.trim(),
                documentation: newDocContent.trim(),
                tags: newDocTags.split(',').map(t => t.trim()).filter(Boolean),
            });
            setNewDocApi(''); setNewDocTags(''); setNewDocContent('');
            const docs = await apiDocsService.getAllDocs();
            setApiDocs(docs);
        } finally {
            setSavingDoc(false);
        }
    };

    const handleDeleteDoc = async (id: string) => {
        if (!confirm('Delete this API doc?')) return;
        await apiDocsService.deleteDoc(id);
        setApiDocs(prev => prev.filter(d => d.id !== id));
    };

    // Close dispatch popover on outside click
    const handleRootClick = useCallback(() => setDispatchOpen(null), []);

    if (user.email !== 'contact.mngrm@gmail.com') {
        return (
            <div className={`h-screen w-full flex flex-col items-center justify-center ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
                <div className="text-red-500 mb-4"><svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg></div>
                <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
                <p className="text-gray-500">You do not have administrative privileges.</p>
                <button onClick={onBack} className="mt-6 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Go Back</button>
            </div>
        );
    }

    const filteredUsers = users.filter(u =>
        u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.uid.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const filteredProjects = projects.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.id.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const filteredTasks = globalTasks.filter(t => {
        const matchesSearch = t.task.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.project.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = statusFilter === 'all' || t.task.status === statusFilter;
        const matchesPriority = priorityFilter === 'all' || t.task.priority === priorityFilter;
        return matchesSearch && matchesStatus && matchesPriority;
    });
    const filteredActivity = globalActivity.filter(ev => {
        const meta = ACTIVITY_META[ev.type];
        if (activityCategory !== 'All' && meta?.category !== activityCategory) return false;
        if (!searchQuery) return true;
        return ev.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            ev.ownerUid.toLowerCase().includes(searchQuery.toLowerCase()) ||
            ev.projectId.toLowerCase().includes(searchQuery.toLowerCase());
    });

    const tabCls = (tab: string) =>
        `flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === tab
            ? (tab === 'swarm'
                ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md'
                : (isDarkMode ? 'bg-[#3F3F46] text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm'))
            : (tab === 'swarm'
                ? (isDarkMode ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-500')
                : (isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'))
        }`;

    return (
        <div className={`h-screen w-full flex flex-col ${isDarkMode ? 'bg-[#0f0f11] text-gray-200' : 'bg-[#f4f4f5] text-gray-800'}`} onClick={handleRootClick}>
            {/* Header */}
            <div className={`flex items-center justify-between px-6 py-4 border-b ${isDarkMode ? 'bg-[#18181A] border-[#2E2E32]' : 'bg-white border-gray-200'}`}>
                <div className="flex items-center gap-4">
                    <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-[#2E2E32] text-gray-400 hover:text-gray-200' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'}`}>
                        <ArrowLeftIcon />
                    </button>
                    <div className="flex items-center gap-2">
                        <ShieldAlertIcon />
                        <h1 className="text-xl font-semibold">Admin Portal</h1>
                        {globalActivity.length > 0 && (
                            <span className="ml-1 flex items-center gap-1 text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Live
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex bg-gray-100 dark:bg-[#2E2E32] rounded-lg p-1 gap-0.5">
                    <button onClick={() => setActiveTab('activity')} className={tabCls('activity')}>
                        <ActivityIcon /> Activity
                        {globalActivity.length > 0 && <span className="ml-1 text-[10px] bg-pink-500/20 text-pink-400 px-1.5 py-0.5 rounded-full">{globalActivity.length}</span>}
                    </button>
                    <button onClick={() => setActiveTab('tasks')} className={tabCls('tasks')}>
                        <CheckSquareIcon /> Global Tasks
                    </button>
                    <button onClick={() => setActiveTab('projects')} className={tabCls('projects')}>
                        <FolderKanbanIcon /> All Projects
                    </button>
                    <button onClick={() => setActiveTab('users')} className={tabCls('users')}>
                        <UsersIcon /> Users
                    </button>
                    <button onClick={() => setActiveTab('swarm')} className={tabCls('swarm')}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                        Agent Swarm
                    </button>
                    <button onClick={() => setActiveTab('docs')} className={tabCls('docs')}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                        API Docs
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto p-6" onClick={handleRootClick}>
                <div className="max-w-6xl mx-auto">
                    {activeTab === 'docs' ? (
                        /* ── API Docs Tab ── */
                        <div className="space-y-6">
                            {/* Add New Doc Form */}
                            <div className={`rounded-xl border p-5 ${isDarkMode ? 'bg-[#18181A] border-[#2E2E32]' : 'bg-white border-gray-200'}`}>
                                <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                                    <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                    Add API Documentation
                                </h2>
                                <div className="grid grid-cols-2 gap-3 mb-3">
                                    <div>
                                        <label className={`text-xs font-medium mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>API Name *</label>
                                        <input
                                            value={newDocApi}
                                            onChange={e => setNewDocApi(e.target.value)}
                                            placeholder="e.g. Google Calendar API"
                                            className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${isDarkMode ? 'bg-[#0f0f11] border-[#2E2E32] text-white placeholder-gray-600' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'}`}
                                        />
                                    </div>
                                    <div>
                                        <label className={`text-xs font-medium mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Tags (comma-separated)</label>
                                        <input
                                            value={newDocTags}
                                            onChange={e => setNewDocTags(e.target.value)}
                                            placeholder="e.g. calendar, google, scheduling"
                                            className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${isDarkMode ? 'bg-[#0f0f11] border-[#2E2E32] text-white placeholder-gray-600' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'}`}
                                        />
                                    </div>
                                </div>
                                <div className="mb-3">
                                    <label className={`text-xs font-medium mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Documentation / Quickstart *</label>
                                    <textarea
                                        value={newDocContent}
                                        onChange={e => setNewDocContent(e.target.value)}
                                        placeholder="Paste API documentation, quickstart guide, or code examples here..."
                                        rows={8}
                                        className={`w-full px-3 py-2 rounded-lg border text-sm outline-none resize-y font-mono ${isDarkMode ? 'bg-[#0f0f11] border-[#2E2E32] text-white placeholder-gray-600' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'}`}
                                    />
                                </div>
                                <button
                                    onClick={handleSaveDoc}
                                    disabled={savingDoc || !newDocApi.trim() || !newDocContent.trim()}
                                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                                >
                                    {savingDoc ? <span className="animate-spin">⟳</span> : <RocketIcon />}
                                    Save Documentation
                                </button>
                            </div>

                            {/* Existing Docs List */}
                            <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'bg-[#18181A] border-[#2E2E32]' : 'bg-white border-gray-200'}`}>
                                <div className={`px-5 py-3 border-b text-sm font-medium ${isDarkMode ? 'border-[#2E2E32] text-gray-300' : 'border-gray-200 text-gray-700'}`}>
                                    {apiDocs.length} API Documentation {apiDocs.length === 1 ? 'Entry' : 'Entries'}
                                </div>
                                {docsLoading ? (
                                    <div className="p-8 flex justify-center"><Loader2Icon /></div>
                                ) : apiDocs.length === 0 ? (
                                    <div className="p-8 text-center text-gray-500 text-sm">No docs added yet. Add your first API documentation above.</div>
                                ) : (
                                    <div className="divide-y divide-gray-100 dark:divide-[#2E2E32]">
                                        {apiDocs.map(doc => (
                                            <div key={doc.id} className={`p-4 hover:bg-gray-50 dark:hover:bg-[#202022] transition-colors`}>
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="flex-1 min-w-0">
                                                        <h3 className="font-medium text-sm">{doc.api}</h3>
                                                        <div className="flex flex-wrap gap-1 mt-1.5">
                                                            {(doc.tags || []).map(tag => (
                                                                <span key={tag} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isDarkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>{tag}</span>
                                                            ))}
                                                        </div>
                                                        <pre className={`mt-2 text-xs rounded p-2 max-h-24 overflow-y-auto whitespace-pre-wrap ${isDarkMode ? 'bg-[#0f0f11] text-gray-400' : 'bg-gray-50 text-gray-600'}`}>{doc.documentation?.slice(0, 300)}{doc.documentation?.length > 300 ? '…' : ''}</pre>
                                                    </div>
                                                    <button
                                                        onClick={() => handleDeleteDoc(doc.id)}
                                                        className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-red-900/30 text-gray-500 hover:text-red-400' : 'hover:bg-red-50 text-gray-400 hover:text-red-500'}`}
                                                    >
                                                        <XIcon />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : activeTab === 'swarm' ? (
                        <div className="h-[calc(100vh-140px)] -mx-6 -my-6 rounded-t-none rounded-xl overflow-hidden border-t border-gray-800">
                            <AdminAgentSwarm adminId={user.uid} />
                        </div>
                    ) : activeTab === 'activity' ? (
                        /* ── Activity Tab ── */
                        <div>
                            {/* Category Filter Bar */}
                            <div className="flex flex-wrap items-center gap-3 mb-5">
                                <div className="relative flex-1 min-w-[200px]">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"><SearchIcon /></div>
                                    <input
                                        type="text"
                                        placeholder="Search activity..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className={`w-full pl-10 pr-4 py-2.5 rounded-xl border outline-none text-sm transition-colors ${isDarkMode ? 'bg-[#18181A] border-[#2E2E32] focus:border-[#4b4b52] text-white' : 'bg-white border-gray-200 focus:border-gray-300 text-gray-900'}`}
                                    />
                                </div>
                                <div className="flex gap-1.5">
                                    {ACTIVITY_CATEGORIES.map(cat => (
                                        <button key={cat} onClick={() => setActivityCategory(cat)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${activityCategory === cat
                                                ? (isDarkMode ? 'bg-[#3F3F46] text-white' : 'bg-gray-800 text-white')
                                                : (isDarkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-[#2E2E32]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100')
                                                }`}>
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Activity Feed */}
                            <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'bg-[#18181A] border-[#2E2E32]' : 'bg-white border-gray-200'}`}>
                                {filteredActivity.length === 0 ? (
                                    <div className="p-12 text-center">
                                        <div className="text-3xl mb-3">⚡</div>
                                        <p className="text-gray-500 text-sm">No activity events yet — they'll appear here in real time.</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-gray-100 dark:divide-[#2E2E32]">
                                        {filteredActivity.map((ev) => {
                                            const meta = ACTIVITY_META[ev.type] || { icon: '•', color: 'text-gray-400', category: 'System' };
                                            return (
                                                <div key={ev.id} className={`flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-[#202022] transition-colors group`}>
                                                    {/* Icon */}
                                                    <span className="text-lg w-8 text-center flex-shrink-0">{meta.icon}</span>

                                                    {/* Body */}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-gray-200 dark:text-gray-200 leading-snug truncate">{ev.description}</p>
                                                        <div className={`flex items-center gap-2 mt-0.5 text-[11px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                            <span className={`font-medium ${meta.color}`}>{meta.category}</span>
                                                            <span>·</span>
                                                            <span>project: <span className="font-mono">{ev.projectId.slice(0, 10)}…</span></span>
                                                            {ev.actorName && <><span>·</span><span>{ev.actorName}</span></>}
                                                        </div>
                                                    </div>

                                                    {/* Timestamp + Jump In */}
                                                    <div className="flex items-center gap-3 flex-shrink-0">
                                                        <span className={`text-[11px] tabular-nums ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                                                            {ev.timestamp ? relativeTime(ev.timestamp) : '—'}
                                                        </span>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onNavigateToProject(ev.projectId, ev.ownerUid); }}
                                                            className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-medium transition-all"
                                                        >
                                                            Jump In <ArrowRightIcon />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        /* ── Other Tabs (Users / Projects / Tasks) ── */
                        <>
                            {/* Search Bar */}
                            <div className="mb-6 relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2"><SearchIcon /></div>
                                <input
                                    type="text"
                                    placeholder={`Search ${activeTab}...`}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className={`w-full pl-12 pr-4 py-3 rounded-xl border outline-none transition-colors ${isDarkMode ? 'bg-[#18181A] border-[#2E2E32] focus:border-[#4b4b52] text-white' : 'bg-white border-gray-200 focus:border-gray-300 text-gray-900'}`}
                                />
                            </div>

                            {activeTab === 'tasks' && (
                                <div className="flex flex-wrap gap-4 mb-6">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Status:</span>
                                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className={`px-3 py-1.5 rounded-lg border text-sm outline-none transition-colors ${isDarkMode ? 'bg-[#18181A] border-[#2E2E32] text-white' : 'bg-white border-gray-200 text-gray-900'}`}>
                                            <option value="all">All Statuses</option>
                                            <option value="todo">To Do</option>
                                            <option value="in_progress">In Progress</option>
                                            <option value="done">Done</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Priority:</span>
                                        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as any)} className={`px-3 py-1.5 rounded-lg border text-sm outline-none transition-colors ${isDarkMode ? 'bg-[#18181A] border-[#2E2E32] text-white' : 'bg-white border-gray-200 text-gray-900'}`}>
                                            <option value="all">All Priorities</option>
                                            <option value="high">High</option>
                                            <option value="medium">Medium</option>
                                            <option value="low">Low</option>
                                        </select>
                                    </div>
                                    {(statusFilter !== 'all' || priorityFilter !== 'all') && (
                                        <button onClick={() => { setStatusFilter('all'); setPriorityFilter('all'); }} className="text-xs font-medium text-blue-500 hover:underline">Clear Filters</button>
                                    )}
                                </div>
                            )}

                            {loading ? (
                                <div className="flex justify-center items-center py-20"><Loader2Icon /></div>
                            ) : (
                                <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'bg-[#18181A] border-[#2E2E32]' : 'bg-white border-gray-200'}`}>
                                    {activeTab === 'tasks' && (
                                        <div className="divide-y divide-gray-200 dark:divide-[#2E2E32]">
                                            {filteredTasks.length === 0 ? (
                                                <div className="p-8 text-center text-gray-500">No tasks found.</div>
                                            ) : filteredTasks.map(({ project, task }) => (
                                                <div key={task.id} className={`p-4 hover:bg-gray-50 dark:hover:bg-[#202022] transition-colors flex items-center justify-between group`}>
                                                    <div className="flex items-start gap-4">
                                                        <div className={`mt-1 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${task.status === 'done' ? 'bg-green-500 border-green-500' : isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
                                                            {task.status === 'done' && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                                                        </div>
                                                        <div>
                                                            <h3 className="font-medium text-sm">{task.title}</h3>
                                                            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                                Project: <span className="font-medium text-blue-500">{project.name}</span> · Status: <span className="capitalize">{task.status}</span> · Priority: <span className={`capitalize ${task.priority === 'high' ? 'text-red-400 font-medium' : task.priority === 'medium' ? 'text-orange-400' : 'text-blue-400'}`}>{task.priority}</span>
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <button onClick={() => onNavigateToProject(project.id, project.ownerUid!)}
                                                        className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition-all font-medium">
                                                        Help User <ArrowRightIcon />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {activeTab === 'projects' && (
                                        <div className="divide-y divide-gray-200 dark:divide-[#2E2E32]">
                                            {filteredProjects.length === 0 ? (
                                                <div className="p-8 text-center text-gray-500">No projects found.</div>
                                            ) : filteredProjects.map((project) => (
                                                <div key={project.id} className="p-4 hover:bg-gray-50 dark:hover:bg-[#202022] transition-colors flex items-center justify-between group relative"
                                                    onClick={(e) => e.stopPropagation()}>
                                                    <div>
                                                        <h3 className="font-medium">{project.name}</h3>
                                                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                            Owner: <span className="font-mono">{project.ownerUid?.slice(0, 12)}…</span> · Tasks: {project.tasks?.length || 0}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {/* Smart Dispatch button */}
                                                        <div className="relative">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setDispatchOpen(dispatchOpen === project.id ? null : project.id); }}
                                                                className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition-all font-medium"
                                                            >
                                                                <RocketIcon /> Dispatch Agent
                                                            </button>
                                                            {dispatchOpen === project.id && (
                                                                <DispatchPopover
                                                                    user={user}
                                                                    projectId={project.id}
                                                                    ownerUid={project.ownerUid!}
                                                                    onClose={() => setDispatchOpen(null)}
                                                                    isDarkMode={isDarkMode}
                                                                />
                                                            )}
                                                        </div>
                                                        <button onClick={() => onNavigateToProject(project.id, project.ownerUid!)}
                                                            className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition-all font-medium">
                                                            Jump In <ArrowRightIcon />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {activeTab === 'users' && (
                                        <div className="divide-y divide-gray-200 dark:divide-[#2E2E32]">
                                            {filteredUsers.length === 0 ? (
                                                <div className="p-8 text-center text-gray-500">No users found.</div>
                                            ) : filteredUsers.map((u) => (
                                                <div key={u.uid} className={`p-4 flex items-center justify-between`}>
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold uppercase overflow-hidden">
                                                            {u.photoURL ? <img src={u.photoURL} alt={u.email || ''} className="w-full h-full object-cover" /> : u.email?.[0] || '?'}
                                                        </div>
                                                        <div>
                                                            <h3 className="font-medium text-sm">{u.email || 'No email provided'}</h3>
                                                            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                                UID: {u.uid} {u.displayName ? `· Name: ${u.displayName}` : ''}
                                                                {u.credits !== undefined && ` · Credits: ${u.credits}`}
                                                                {u.subscribed && ` · ✅ Subscribed`}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => setEditingUser(u)}
                                                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${isDarkMode ? 'border-[#3F3F46] hover:bg-[#2E2E32] text-gray-300' : 'border-gray-200 hover:bg-gray-50 text-gray-600'}`}
                                                    >
                                                        Edit
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Modals */}
            {editingUser && (
                <EditUserModal
                    user={user}
                    targetUser={editingUser}
                    onClose={() => setEditingUser(null)}
                    onUpdated={handleRefresh}
                    isDarkMode={isDarkMode}
                />
            )}
        </div>
    );
};
