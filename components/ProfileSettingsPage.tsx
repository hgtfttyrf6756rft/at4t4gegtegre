import React, { useState, useEffect, useRef } from 'react';
import { storageService } from '../services/storageService';
import { UserProfile, ResearchProject } from '../types';
import { auth } from '../services/firebase';
import { authFetch } from '../services/authFetch';
import { deductCredits, hasEnoughCredits, getUserCredits } from '../services/creditService';
import { InsufficientCreditsModal } from './InsufficientCreditsModal';
import { useSubscription } from '../hooks/useSubscription';
import { SubscriptionModal } from './SubscriptionModal';

interface ProfileSettingsPageProps {
    isDarkMode: boolean;
    currentProject: ResearchProject | null;
}

const GEMINI_FEMALE_VOICES = [
    'Achernar', 'Aoede', 'Autonoe', 'Callirrhoe', 'Despina', 'Erinome',
    'Gacrux', 'Kore', 'Laomedeia', 'Leda', 'Pulcherrima', 'Sulafat',
    'Vindemiatrix', 'Zephyr'
];

const GEMINI_MALE_VOICES = [
    'Achird', 'Algenib', 'Alnilam', 'Charon', 'Enceladus', 'Fenrir',
    'Iapetus', 'Orus', 'Puck', 'Rasalgethi', 'Sadachbia', 'Sadaltager',
    'Schedar', 'Umbriel', 'Zubenelgenubi'
];

export const ProfileSettingsPage: React.FC<ProfileSettingsPageProps> = ({ isDarkMode, currentProject }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState<UserProfile>({});
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Provisioning Modal State
    const [showProvisionModal, setShowProvisionModal] = useState(false);
    const [searchAreaCode, setSearchAreaCode] = useState('');
    const [availableNumbers, setAvailableNumbers] = useState<any[]>([]);
    const [searchingNumbers, setSearchingNumbers] = useState(false);
    const [provisioning, setProvisioning] = useState(false);
    const [insufficientCreditsModal, setInsufficientCreditsModal] = useState<{ show: boolean, needed: number, current: number } | null>(null);

    // Lead Capture State
    const [capturedLeads, setCapturedLeads] = useState<any[]>([]);
    const [fetchingLeads, setFetchingLeads] = useState(false);

    // Note Mode State
    const [capturedNotes, setCapturedNotes] = useState<any[]>([]);
    const [fetchingNotes, setFetchingNotes] = useState(false);

    const { subscription, showUpgradeModal, openUpgradeModal, closeUpgradeModal } = useSubscription();
    const isPro = subscription.subscribed || subscription.subscriptionTier === 'pro' || subscription.subscriptionTier === 'unlimited';

    // Load profile on mount
    useEffect(() => {
        const loadProfile = async () => {
            try {
                setLoading(true);
                const data = await storageService.getUserProfile();
                if (data) {
                    setProfile(data);
                } else if (auth.currentUser) {
                    // Fallback to auth defaults if no profile doc exists
                    setProfile({
                        displayName: auth.currentUser.displayName || '',
                        photoURL: auth.currentUser.photoURL || '',
                        email: auth.currentUser.email || ''
                    });
                }
            } catch (e) {
                console.error("Failed to load profile", e);
                setMessage({ type: 'error', text: 'Failed to load profile' });
            } finally {
                setLoading(false);
            }
        };

        const loadLeads = async () => {
            try {
                setFetchingLeads(true);
                const leads = await storageService.getPhoneAgentLeads();
                setCapturedLeads(leads);
            } catch (e) {
                console.error("Failed to load leads", e);
            } finally {
                setFetchingLeads(false);
            }
        };

        const loadNotes = async () => {
            try {
                setFetchingNotes(true);
                const notes = await storageService.getPhoneAgentNotes();
                setCapturedNotes(notes);
            } catch (e) {
                console.error("Failed to load notes", e);
            } finally {
                setFetchingNotes(false);
            }
        };

        loadProfile();
        loadLeads();
        loadNotes();
    }, []);

    // Helper to ensure default lead fields exist
    useEffect(() => {
        if (profile.agentPhoneConfig?.enabled && profile.agentPhoneConfig?.leadCaptureEnabled && (!profile.agentPhoneConfig.leadFields || profile.agentPhoneConfig.leadFields.length === 0)) {
            setProfile(prev => ({
                ...prev,
                agentPhoneConfig: {
                    ...prev.agentPhoneConfig!,
                    leadFields: [
                        { id: '1', name: 'Name', required: true },
                        { id: '2', name: 'Email', required: true },
                        { id: '3', name: 'Address', required: false }
                    ]
                }
            }));
        }
    }, [profile.agentPhoneConfig?.enabled, profile.agentPhoneConfig?.leadCaptureEnabled]);

    const goBack = () => {
        if (typeof window === 'undefined') return;
        window.history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
    };

    const goToDDI = () => {
        if (typeof window === 'undefined') return;
        window.history.pushState({}, '', '/ddi');
        window.dispatchEvent(new PopStateEvent('popstate'));
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            setMessage(null);
            await storageService.updateUserProfile(profile);
            setMessage({ type: 'success', text: 'Profile updated successfully' });

            // Clear success message after 3s
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            console.error("Failed to update profile", e);
            setMessage({ type: 'error', text: 'Failed to save changes' });
        } finally {
            setSaving(false);
        }
    };

    const handleExportData = () => {
        if (!currentProject) return;

        // Export the full project object including all sub-collections
        const payload = {
            ...currentProject,
            exportMetadata: {
                exportedAt: Date.now(),
                exportedBy: profile.email || 'unknown',
                appVersion: '1.0.0'
            }
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentProject.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_full_export.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            // Basic validation
            if (file.size > 5 * 1024 * 1024) {
                setMessage({ type: 'error', text: 'Image must be under 5MB' });
                return;
            }

            try {
                setSaving(true); // Show loading state on avatar
                const url = await storageService.uploadProfileImage(file);
                setProfile(prev => ({ ...prev, photoURL: url }));
                // Auto-save the new URL to profile
                await storageService.updateUserProfile({ ...profile, photoURL: url });
                setMessage({ type: 'success', text: 'Profile picture updated' });
                setTimeout(() => setMessage(null), 3000);
            } catch (error) {
                console.error("Failed to upload image", error);
                setMessage({ type: 'error', text: 'Failed to upload image' });
            } finally {
                setSaving(false);
            }
        }
    };

    const handleSearchNumbers = async () => {
        setSearchingNumbers(true);
        setAvailableNumbers([]);
        try {
            const res = await authFetch('/api/agent?op=search-numbers', {
                method: 'POST',
                body: JSON.stringify({ areaCode: searchAreaCode })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Server error');
            setAvailableNumbers(data.numbers || []);
        } catch (e: any) {
            setMessage({ type: 'error', text: 'Failed to search numbers: ' + e.message });
            setTimeout(() => setMessage(null), 5000);
        } finally {
            setSearchingNumbers(false);
        }
    };

    const handleBuyNumber = async (phoneNumber: string) => {
        setProvisioning(true);
        try {
            // Credit Check
            const hasCredits = await hasEnoughCredits('phoneProvisioning');
            if (!hasCredits) {
                const current = await getUserCredits();
                setInsufficientCreditsModal({ show: true, needed: 400, current });
                setProvisioning(false);
                return;
            }

            const res = await authFetch('/api/agent?op=buy-number', {
                method: 'POST',
                body: JSON.stringify({
                    phoneNumber,
                    existingConfig: profile.agentPhoneConfig
                })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                // Deduct credits on success
                await deductCredits('phoneProvisioning');

                setProfile(prev => ({
                    ...prev,
                    agentPhoneNumber: data.phoneNumber,
                    agentPhoneConfig: { ...(prev.agentPhoneConfig || {}), enabled: true }
                }));
                setMessage({ type: 'success', text: `Successfully provisioned ${data.phoneNumber}!` });
                setShowProvisionModal(false);
                setTimeout(() => setMessage(null), 5000);
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (e: any) {
            setMessage({ type: 'error', text: 'Failed to provision number. Ensure TWILIO credentials are set. Error: ' + e.message });
            setTimeout(() => setMessage(null), 5000);
        } finally {
            setProvisioning(false);
        }
    };

    const addLeadField = () => {
        setProfile(prev => ({
            ...prev,
            agentPhoneConfig: {
                ...(prev.agentPhoneConfig || { enabled: true }),
                leadFields: [
                    ...(prev.agentPhoneConfig?.leadFields || []),
                    { id: crypto.randomUUID(), name: '', required: false }
                ]
            }
        }));
    };

    const removeLeadField = (id: string) => {
        setProfile(prev => ({
            ...prev,
            agentPhoneConfig: {
                ...(prev.agentPhoneConfig || { enabled: true }),
                leadFields: (prev.agentPhoneConfig?.leadFields || []).filter(f => f.id !== id)
            }
        }));
    };

    const updateLeadField = (id: string, updates: any) => {
        setProfile(prev => ({
            ...prev,
            agentPhoneConfig: {
                ...(prev.agentPhoneConfig || { enabled: true }),
                leadFields: (prev.agentPhoneConfig?.leadFields || []).map(f => f.id === id ? { ...f, ...updates } : f)
            }
        }));
    };

    const handleDeleteLead = async (id: string) => {
        if (!confirm('Are you sure you want to delete this lead?')) return;
        try {
            await storageService.deletePhoneAgentLead(id);
            setCapturedLeads(prev => prev.filter(l => l.id !== id));
        } catch (e) {
            console.error("Failed to delete lead", e);
        }
    };

    const handleDeleteNote = async (id: string) => {
        if (!confirm('Are you sure you want to delete this note?')) return;
        try {
            await storageService.deletePhoneAgentNote(id);
            setCapturedNotes(prev => prev.filter(n => n.id !== id));
        } catch (e) {
            console.error("Failed to delete note", e);
        }
    };

    // UI Theme classes
    const ui = {
        page: isDarkMode ? 'bg-[#000000] text-white' : 'bg-gray-50 text-gray-900',
        card: isDarkMode
            ? 'bg-[#1c1c1e] border border-[#3a3a3c]/70 shadow-xl shadow-black/20'
            : 'bg-white border border-gray-200 shadow-sm',
        input: isDarkMode
            ? 'bg-[#2c2c2e] border-[#3a3a3c] text-white focus:border-[#0a84ff] placeholder-[#636366]'
            : 'bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 placeholder-gray-400',
        label: isDarkMode ? 'text-[#86868b]' : 'text-gray-600',
        heading: isDarkMode ? 'text-white' : 'text-gray-900',
        subtext: isDarkMode ? 'text-[#636366]' : 'text-gray-500',
        buttonPrimary: 'bg-[#0071e3] hover:bg-[#0077ed] text-white shadow-lg shadow-blue-500/30',
        buttonSecondary: isDarkMode
            ? 'bg-[#2c2c2e] hover:bg-[#3a3a3c] text-white border border-[#3a3a3c]'
            : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300',
    };

    return (
        <div className={`min-h-screen h-screen overflow-y-auto ${ui.page} font-sans selection:bg-blue-500/30`}>
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16">

                {/* Header */}
                <div className="flex items-center justify-between gap-4 mb-10">
                    <div>
                        <button
                            onClick={goBack}
                            className={`mb-4 flex items-center gap-2 text-sm font-medium transition-colors ${isDarkMode ? 'text-[#0a84ff] hover:text-[#409cff]' : 'text-[#0071e3] hover:text-[#0077ed]'}`}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                            </svg>
                            <span>Back to Projects</span>
                        </button>
                        <h1 className={`text-3xl sm:text-4xl font-bold tracking-tight ${ui.heading}`}>Profile Settings</h1>
                        <p className={`mt-2 text-base ${ui.subtext}`}>Manage your branding and account preferences</p>
                    </div>
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-8 h-8 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : (
                    <div className="space-y-6">

                        {/* Branding Card */}
                        <div className={`rounded-3xl p-6 sm:p-8 overflow-hidden relative ${ui.card}`}>

                            <div className="flex flex-col sm:flex-row gap-8">

                                {/* Avatar Section */}
                                <div className="flex-shrink-0">
                                    <div className="relative group mx-auto sm:mx-0 w-28 h-28 sm:w-32 sm:h-32">
                                        <div className={`w-full h-full rounded-full overflow-hidden border-4 transition-all ${isDarkMode ? 'border-[#2c2c2e] group-hover:border-[#3a3a3c]' : 'border-white shadow-md group-hover:border-gray-50'}`}>
                                            {profile.photoURL ? (
                                                <img src={profile.photoURL} alt="Profile" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className={`w-full h-full flex items-center justify-center ${isDarkMode ? 'bg-[#2c2c2e]' : 'bg-gray-100'}`}>
                                                    <svg className={`w-12 h-12 ${isDarkMode ? 'text-[#636366]' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                    </svg>
                                                </div>
                                            )}
                                        </div>

                                        {/* Overlay for upload */}
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 rounded-full transition-opacity duration-200 backdrop-blur-sm cursor-pointer"
                                        >
                                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                            </svg>
                                        </button>
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            onChange={handleFileChange}
                                            className="hidden"
                                            accept="image/png, image/jpeg, image/webp"
                                        />
                                    </div>
                                    <p className={`mt-3 text-xs text-center ${ui.subtext}`}>Tap to change</p>
                                </div>

                                {/* Fields Section */}
                                <div className="flex-1 space-y-5">
                                    <div>
                                        <label className={`block text-sm font-semibold mb-2 ${ui.label}`}>Display Name / Company Name</label>
                                        <input
                                            type="text"
                                            value={profile.displayName || ''}
                                            onChange={e => setProfile(prev => ({ ...prev, displayName: e.target.value }))}
                                            placeholder="e.g. Acme Corp or John Doe"
                                            className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 transition-all ${ui.input}`}
                                        />
                                    </div>

                                    <div>
                                        <label className={`block text-sm font-semibold mb-2 ${ui.label}`}>
                                            Brand Description / Bio
                                            <span className={`ml-2 text-xs font-normal ${isDarkMode ? 'text-[#0a84ff]' : 'text-[#0071e3]'}`}>
                                                Used by AI agents
                                            </span>
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={profile.description || ''}
                                            onChange={e => setProfile(prev => ({ ...prev, description: e.target.value }))}
                                            placeholder="Describe your brand voice, mission, or personal bio. Agents will use this context to tailor their responses."
                                            className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 transition-all resize-none ${ui.input}`}
                                        />
                                        <p className={`mt-2 text-xs ${ui.subtext}`}>
                                            Your agents will read this to maintain consistency with your brand identity across projects.
                                        </p>
                                    </div>
                                </div>

                            </div>

                            {/* Footer Actions */}
                            <div className={`mt-8 pt-6 border-t flex justify-end gap-3 ${isDarkMode ? 'border-[#3a3a3c]' : 'border-gray-100'}`}>
                                {message && (
                                    <div className={`flex-1 flex items-center text-sm font-medium ${message.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                                        {message.type === 'success' ? (
                                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                        ) : (
                                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        )}
                                        {message.text}
                                    </div>
                                )}

                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className={`px-6 py-2.5 rounded-full font-medium transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${ui.buttonPrimary}`}
                                >
                                    {saving ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>

                        </div>

                        {/* Phone Agent Settings */}
                        <div className={`rounded-3xl p-6 sm:p-8 relative overflow-hidden ${ui.card}`}>
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className={`text-lg font-semibold ${ui.heading}`}>Phone Agent</h3>
                                    <p className={`text-sm ${ui.subtext} mt-1`}>Configure your personal AI assistant via SMS/Voice.</p>
                                </div>
                            </div>
                            <div className={`space-y-4 ${!isPro ? 'opacity-40 pointer-events-none' : ''}`}>
                                <div>
                                    <label className={`block text-sm font-semibold mb-2 ${ui.label}`}>Assigned Twilio Number</label>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="text"
                                            value={profile.agentPhoneNumber || ''}
                                            onChange={e => setProfile(prev => ({ ...prev, agentPhoneNumber: e.target.value }))}
                                            placeholder="+1 (555) 555-5555"
                                            className={`flex-1 px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 transition-all ${ui.input}`}
                                        />
                                        <button
                                            onClick={() => setShowProvisionModal(true)}
                                            className={`px-4 py-3 rounded-xl font-medium transition-colors whitespace-nowrap ${ui.buttonSecondary}`}
                                        >
                                            Get New Number
                                        </button>
                                    </div>
                                    <p className={`mt-2 text-xs ${ui.subtext}`}>Enter the Twilio phone number acting as your agent, or provision a new one.</p>
                                </div>
                                <div className="pt-2">
                                    <label className={`flex items-center gap-3 cursor-pointer`}>
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={profile.agentPhoneConfig?.enabled ?? false}
                                                onChange={e => setProfile(prev => ({
                                                    ...prev,
                                                    agentPhoneConfig: { ...(prev.agentPhoneConfig || { enabled: false }), enabled: e.target.checked }
                                                }))}
                                            />
                                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                                        </div>
                                        <span className={`text-sm font-medium ${ui.label}`}>Enable Phone Agent</span>
                                    </label>
                                </div>
                                {profile.agentPhoneConfig?.enabled && (
                                    <>
                                        <div className="pt-2">
                                            <label className={`block text-sm font-semibold mb-2 ${ui.label}`}>Agent Mode</label>
                                            <div className="flex bg-[#2c2c2e]/50 p-1 rounded-xl border border-[#3a3a3c] space-x-1">
                                                <button
                                                    onClick={() => setProfile(prev => ({
                                                        ...prev,
                                                        agentPhoneConfig: { ...(prev.agentPhoneConfig || { enabled: true }), mode: 'personal' }
                                                    }))}
                                                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${(profile.agentPhoneConfig?.mode === 'personal' || !profile.agentPhoneConfig?.mode) ? 'bg-blue-600 text-white shadow-lg' : 'text-[#86868b]'}`}
                                                >
                                                    Personal / Client
                                                </button>
                                                <button
                                                    onClick={() => setProfile(prev => ({
                                                        ...prev,
                                                        agentPhoneConfig: { ...(prev.agentPhoneConfig || { enabled: true }), mode: 'note' }
                                                    }))}
                                                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${profile.agentPhoneConfig?.mode === 'note' ? 'bg-blue-600 text-white shadow-lg' : 'text-[#86868b]'}`}
                                                >
                                                    Note Mode
                                                </button>
                                            </div>
                                            <p className={`mt-2 text-[10px] ${ui.subtext}`}>
                                                {profile.agentPhoneConfig?.mode === 'note' 
                                                    ? "Text notes to this number. Call the number to talk to an AI that strictly answers based on your notes."
                                                    : "Acts as a general assistant that can be customized with persona instructions and capture lead info."}
                                            </p>
                                        </div>

                                        <div className="pt-2">
                                            <label className={`block text-sm font-semibold mb-2 ${ui.label}`}>Welcome Greeting (Spoken by Twilio)</label>
                                            <textarea
                                                rows={2}
                                                value={profile.agentPhoneConfig?.welcomeGreeting || ''}
                                                onChange={e => setProfile(prev => ({
                                                    ...prev,
                                                    agentPhoneConfig: { ...(prev.agentPhoneConfig || { enabled: true }), welcomeGreeting: e.target.value }
                                                }))}
                                                placeholder="The very first thing the AI says when someone calls (e.g., 'Hello, thanks for calling Acme Corp! How can I help?')."
                                                className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 transition-all resize-none ${ui.input}`}
                                            />
                                            <p className={`mt-2 text-[10px] ${ui.subtext}`}>This is played immediately by Twilio before the AI starts processing speech.</p>
                                        </div>

                                        <div className="pt-2">
                                            <div className="flex items-center justify-between mb-2">
                                                <label className={`text-sm font-semibold ${ui.label}`}>Agent Voice</label>
                                                <div className="flex bg-[#2c2c2e]/50 p-1 rounded-xl border border-[#3a3a3c]">
                                                    <button
                                                        onClick={() => setProfile(prev => ({
                                                            ...prev,
                                                            agentPhoneConfig: { ...(prev.agentPhoneConfig || { enabled: true }), voiceGender: 'female', voiceName: 'Kore' }
                                                        }))}
                                                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${profile.agentPhoneConfig?.voiceGender === 'female' || !profile.agentPhoneConfig?.voiceGender ? 'bg-blue-600 text-white shadow-lg' : 'text-[#86868b]'}`}
                                                    >
                                                        Female
                                                    </button>
                                                    <button
                                                        onClick={() => setProfile(prev => ({
                                                            ...prev,
                                                            agentPhoneConfig: { ...(prev.agentPhoneConfig || { enabled: true }), voiceGender: 'male', voiceName: 'Fenrir' }
                                                        }))}
                                                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${profile.agentPhoneConfig?.voiceGender === 'male' ? 'bg-blue-600 text-white shadow-lg' : 'text-[#86868b]'}`}
                                                    >
                                                        Male
                                                    </button>
                                                </div>
                                            </div>
                                            <select
                                                value={profile.agentPhoneConfig?.voiceName || ''}
                                                onChange={e => setProfile(prev => ({
                                                    ...prev,
                                                    agentPhoneConfig: { ...(prev.agentPhoneConfig || { enabled: true }), voiceName: e.target.value }
                                                }))}
                                                className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 transition-all ${ui.input}`}
                                            >
                                                <option value="">Select a voice...</option>
                                                {(profile.agentPhoneConfig?.voiceGender === 'male' ? GEMINI_MALE_VOICES : GEMINI_FEMALE_VOICES).map(v => (
                                                    <option key={v} value={v}>{v}</option>
                                                ))}
                                            </select>
                                            <p className={`mt-2 text-[10px] ${ui.subtext}`}>Choose the persona and tone for your phone agent.</p>
                                        </div>

                                        <div className="pt-2">
                                            <label className={`block text-sm font-semibold mb-2 ${ui.label}`}>Custom System Prompt / Persona</label>
                                            <textarea
                                                rows={2}
                                                value={profile.agentPhoneConfig?.systemPrompt || ''}
                                                onChange={e => setProfile(prev => ({
                                                    ...prev,
                                                    agentPhoneConfig: { ...(prev.agentPhoneConfig || { enabled: true }), systemPrompt: e.target.value }
                                                }))}
                                                placeholder="Optional instructions for how the agent should behave over SMS (e.g., 'Be extremely concise', 'Always act professionally')."
                                                className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 transition-all resize-none ${ui.input}`}
                                            />
                                        </div>

                                        {/* Lead Capture Settings */}
                                        {profile.agentPhoneConfig?.mode !== 'note' && (
                                            <div className="pt-4 border-t border-[#3a3a3c]/30 mt-4">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h4 className={`text-sm font-semibold ${ui.label}`}>Lead Capture Settings</h4>
                                                    <label className="relative inline-flex items-center cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            className="sr-only peer"
                                                            checked={profile.agentPhoneConfig?.leadCaptureEnabled}
                                                            onChange={e => setProfile(prev => ({
                                                                ...prev,
                                                                agentPhoneConfig: { ...(prev.agentPhoneConfig || { enabled: true }), leadCaptureEnabled: e.target.checked }
                                                            }))}
                                                        />
                                                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                                                        <span className={`ml-3 text-xs font-medium ${ui.label}`}>Enabled</span>
                                                    </label>
                                                </div>

                                                {profile.agentPhoneConfig?.leadCaptureEnabled && (
                                                    <div className="space-y-3">
                                                        <p className={`text-xs ${ui.subtext} mb-2`}>Specify fields for the AI agent to collect during the conversation.</p>
                                                        {(profile.agentPhoneConfig?.leadFields || []).map((field, idx) => (
                                                            <div key={field.id} className="flex items-center gap-2 group">
                                                                <input
                                                                    type="text"
                                                                    value={field.name}
                                                                    onChange={e => updateLeadField(field.id, { name: e.target.value })}
                                                                    placeholder="Field Name"
                                                                    className={`flex-1 px-3 py-1.5 text-sm rounded-lg border focus:outline-none ${ui.input}`}
                                                                />
                                                                <label className="flex items-center gap-1.5 cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={field.required}
                                                                        onChange={e => updateLeadField(field.id, { required: e.target.checked })}
                                                                        className="rounded border-gray-400 text-blue-600 focus:ring-blue-500"
                                                                    />
                                                                    <span className={`text-[10px] font-medium uppercase tracking-wider ${ui.label}`}>Req</span>
                                                                </label>
                                                                <button
                                                                    onClick={() => removeLeadField(field.id)}
                                                                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-500 opacity-40 hover:opacity-100 transition-all"
                                                                >
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                                </button>
                                                            </div>
                                                        ))}
                                                        <button
                                                            onClick={addLeadField}
                                                            className={`w-full mt-2 py-2 border-2 border-dashed rounded-xl text-xs font-medium transition-all ${isDarkMode ? 'border-[#3a3a3c] hover:border-blue-500/50 text-[#86868b] hover:text-blue-400' : 'border-gray-200 hover:border-blue-500/50 text-gray-500 hover:text-blue-600'}`}
                                                        >
                                                            + Add Field
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Phone Agent Section Footer Actions */}
                                <div className={`mt-8 pt-6 border-t flex justify-end gap-3 ${isDarkMode ? 'border-[#3a3a3c]' : 'border-gray-100'}`}>
                                    {message && (
                                        <div className={`flex-1 flex items-center text-sm font-medium ${message.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                                            {message.type === 'success' ? (
                                                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                            ) : (
                                                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            )}
                                            {message.text}
                                        </div>
                                    )}

                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className={`px-6 py-2.5 rounded-full font-medium transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${ui.buttonPrimary}`}
                                    >
                                        {saving ? 'Saving...' : 'Save Phone Settings'}
                                    </button>
                                </div>
                            </div>

                            {!isPro && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/5 dark:bg-[#1c1c1e]/20 backdrop-blur-[2px] z-10 p-6 text-center">
                                    <div className="bg-white dark:bg-[#2c2c2e] p-6 rounded-3xl shadow-2xl border dark:border-[#3a3a3c] max-w-xs scale-100 transition-transform">
                                        <div className="text-3xl mb-3">🔒</div>
                                        <h4 className={`text-base font-bold mb-2 ${ui.heading}`}>Pro / Unlimited Feature</h4>
                                        <p className={`text-xs ${ui.subtext} mb-5 leading-relaxed`}>
                                            The Phone Agent is exclusive to our Pro and Unlimited members. Upgrade now to get your own AI assistant.
                                        </p>
                                        <button
                                            onClick={() => openUpgradeModal('button', 'pro')}
                                            className="w-full py-2.5 rounded-full bg-gradient-to-r from-[#0071e3] to-[#5e5ce6] text-white text-sm font-semibold shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
                                        >
                                            Upgrade to Pro
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Captured Leads / Note Mode Section */}
                        {profile.agentPhoneConfig?.enabled && profile.agentPhoneConfig?.mode === 'note' ? (
                            <div className={`rounded-3xl p-6 sm:p-8 ${ui.card}`}>
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h3 className={`text-lg font-semibold ${ui.heading}`}>My Notes</h3>
                                        <p className={`text-xs ${ui.subtext} mt-1`}>Text your agent number to save notes silently</p>
                                    </div>
                                    <div className={`px-3 py-1 rounded-full text-xs font-semibold ${isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                                        {capturedNotes.length} total
                                    </div>
                                </div>

                                {fetchingNotes ? (
                                    <div className="flex justify-center py-10">
                                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent"></div>
                                    </div>
                                ) : capturedNotes.length === 0 ? (
                                    <div className={`text-center py-12 rounded-2xl border-2 border-dashed ${isDarkMode ? 'border-[#3a3a3c]' : 'border-gray-100'}`}>
                                        <div className={`text-sm ${ui.subtext}`}>No notes saved yet</div>
                                        <p className={`text-[10px] ${ui.subtext} mt-1`}>Send an SMS to {profile.agentPhoneNumber || 'your agent number'} to create your first note.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                                        {capturedNotes.map((note) => (
                                            <div key={note.id} className={`rounded-2xl p-4 border ${isDarkMode ? 'border-[#3a3a3c] bg-[#2c2c2e]/30' : 'border-gray-100 bg-gray-50/50'}`}>
                                                <div className="flex justify-between items-start mb-2">
                                                    <div>
                                                        <div className={`text-[10px] ${ui.subtext}`}>{new Date(note.timestamp).toLocaleString()}</div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleDeleteNote(note.id)}
                                                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-500/50 hover:text-red-500 transition-all"
                                                        title="Delete note"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                    </button>
                                                </div>
                                                <div className={`text-sm ${ui.heading} whitespace-pre-wrap`}>{note.body}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className={`rounded-3xl p-6 sm:p-8 ${ui.card}`}>
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h3 className={`text-lg font-semibold ${ui.heading}`}>Captured Leads</h3>
                                        <p className={`text-xs ${ui.subtext} mt-1`}>Automatic data collection from your Phone Agent</p>
                                    </div>
                                    <div className={`px-3 py-1 rounded-full text-xs font-semibold ${isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                                        {capturedLeads.length} total
                                    </div>
                                </div>

                                {fetchingLeads ? (
                                    <div className="flex justify-center py-10">
                                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent"></div>
                                    </div>
                                ) : capturedLeads.length === 0 ? (
                                    <div className={`text-center py-12 rounded-2xl border-2 border-dashed ${isDarkMode ? 'border-[#3a3a3c]' : 'border-gray-100'}`}>
                                        <div className={`text-sm ${ui.subtext}`}>No leads captured yet</div>
                                        <p className={`text-[10px] ${ui.subtext} mt-1`}>Leads will appear here once your agent collects info from callers.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {capturedLeads.map((lead) => (
                                            <div key={lead.id} className={`rounded-2xl p-4 border ${isDarkMode ? 'border-[#3a3a3c] bg-[#2c2c2e]/30' : 'border-gray-100 bg-gray-50/50'}`}>
                                                <div className="flex justify-between items-start mb-3">
                                                    <div>
                                                        <div className={`text-sm font-semibold ${ui.heading}`}>{lead.callerNumber || 'Unknown Caller'}</div>
                                                        <div className={`text-[10px] ${ui.subtext}`}>{new Date(lead.timestamp).toLocaleString()}</div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleDeleteLead(lead.id)}
                                                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-500/50 hover:text-red-500 transition-all"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                    </button>
                                                </div>

                                                <div className="grid grid-cols-2 gap-3">
                                                    {Object.entries(lead.data || {}).map(([key, val]) => (
                                                        <div key={key}>
                                                            <div className={`text-[10px] uppercase tracking-wider font-semibold ${ui.label}`}>{key}</div>
                                                            <div className={`text-sm ${ui.heading}`}>{val as string || '-'}</div>
                                                        </div>
                                                    ))}
                                                </div>

                                                {(lead.agentName || lead.agentInstructions) && (
                                                    <div className={`mt-3 pt-3 border-t ${isDarkMode ? 'border-[#3a3a3c]' : 'border-gray-200'}`}>
                                                        <div className={`text-[9px] uppercase tracking-wider font-semibold ${ui.label} mb-1`}>Agent Context</div>
                                                        {lead.agentName && <div className={`text-[10px] ${ui.heading}`}>Agent: {lead.agentName}</div>}
                                                        {lead.agentInstructions && (
                                                            <div className={`text-[10px] ${ui.subtext} italic mt-0.5 mt-0.5 line-clamp-1`}>
                                                                "{lead.agentInstructions}"
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Account Info & Data Settings */}
                        <div className={`rounded-3xl p-6 sm:p-8 ${ui.card}`}>
                            <h3 className={`text-lg font-semibold mb-4 ${ui.heading}`}>Account & Data</h3>

                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                                <div>
                                    <div className={`text-sm font-medium mb-1 ${ui.label}`}>Email Address</div>
                                    <div className={`text-base ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{profile.email || 'No email linked'}</div>
                                    <div className={`mt-1 text-xs ${ui.subtext}`}>Managed via Google Auth</div>
                                </div>

                                <div className="flex flex-col items-start sm:items-end gap-2">
                                    {currentProject && (
                                        <button
                                            onClick={handleExportData}
                                            className={`px-5 py-2.5 rounded-full text-sm font-medium transition-colors mb-2 ${ui.buttonSecondary}`}
                                        >
                                            Export Research Data
                                        </button>
                                    )}
                                    <button
                                        onClick={goToDDI}
                                        className={`px-5 py-2.5 rounded-full text-sm font-medium transition-colors ${ui.buttonSecondary}`}
                                    >
                                        Manage Data & Deletion
                                    </button>
                                    <p className={`text-xs max-w-xs sm:text-right ${ui.subtext}`}>
                                        Access your Data Deletion Interface (DDI) to manage or remove your account data.
                                    </p>
                                </div>
                            </div>
                        </div>

                    </div>
                )}

                {/* Provisioning Modal Overlay */}
                {showProvisionModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <div className={`w-full max-w-lg rounded-3xl p-6 shadow-2xl scale-100 transition-transform ${ui.card}`}>
                            <div className="flex justify-between items-center mb-6">
                                <h3 className={`text-xl font-semibold ${ui.heading}`}>Buy Phone Number</h3>
                                <button onClick={() => setShowProvisionModal(false)} className={`p-2 rounded-full hover:bg-gray-200 dark:hover:bg-[#3a3a3c] transition-colors ${ui.subtext}`}>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>

                            <div className="mb-6">
                                <label className={`block text-sm font-semibold mb-2 ${ui.label}`}>Area Code (Optional)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="e.g. 415"
                                        value={searchAreaCode}
                                        onChange={e => setSearchAreaCode(e.target.value)}
                                        className={`flex-1 px-4 py-2.5 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 transition-all ${ui.input}`}
                                    />
                                    <button
                                        onClick={handleSearchNumbers}
                                        disabled={searchingNumbers}
                                        className={`px-5 py-2.5 rounded-xl font-medium transition-all ${ui.buttonPrimary} disabled:opacity-50`}
                                    >
                                        {searchingNumbers ? 'Searching...' : 'Search'}
                                    </button>
                                </div>
                                <div className="mt-3 flex items-center gap-2">
                                    <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-blue-50 text-blue-600 border border-blue-100'}`}>
                                        400 Credits
                                    </div>
                                    <p className={`text-xs ${ui.subtext}`}>One-time setup fee + approx $1.15/mo via Twilio.</p>
                                </div>
                            </div>

                            <div className={`space-y-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar`}>
                                {availableNumbers.length === 0 && !searchingNumbers && (
                                    <div className={`text-center py-8 ${ui.subtext}`}>
                                        Enter an area code and click Search to find available numbers.
                                    </div>
                                )}
                                {availableNumbers.map((num: any) => (
                                    <div key={num.phone_number} className={`flex items-center justify-between p-4 rounded-xl border ${isDarkMode ? 'border-[#3a3a3c] bg-[#2c2c2e]' : 'border-gray-200 bg-gray-50'}`}>
                                        <div>
                                            <div className={`font-semibold text-lg ${ui.heading}`}>{num.friendly_name}</div>
                                            <div className={`text-xs mt-1 ${ui.subtext}`}>
                                                {num.locality ? `${num.locality}, ` : ''}{num.region ? `${num.region}` : ''}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleBuyNumber(num.phone_number)}
                                            disabled={provisioning}
                                            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all bg-green-600 hover:bg-green-700 text-white disabled:opacity-50`}
                                        >
                                            Buy & Assign
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Insufficient Credits Modal */}
                {insufficientCreditsModal?.show && (
                    <InsufficientCreditsModal
                        isOpen={insufficientCreditsModal.show}
                        onClose={() => setInsufficientCreditsModal(null)}
                        onUpgrade={() => {
                            setInsufficientCreditsModal(null);
                            goToDDI(); // Or whatever the upgrade path is, usually SubscriptionModal
                        }}
                        isDarkMode={isDarkMode}
                        creditsNeeded={insufficientCreditsModal.needed}
                        currentCredits={insufficientCreditsModal.current}
                        operation="phoneProvisioning"
                    />
                )}

                <SubscriptionModal
                    isOpen={showUpgradeModal}
                    onClose={closeUpgradeModal}
                    isDarkMode={isDarkMode}
                />
            </div>
        </div>
    );
};
