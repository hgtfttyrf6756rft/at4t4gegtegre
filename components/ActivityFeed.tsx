import React from 'react';
import { ProjectActivity, ActivityType } from '../types';
import { ThemeType, PASTEL_THEMES } from '../constants';

interface ActivityFeedProps {
    activities: ProjectActivity[];
    loading: boolean;
    isDarkMode: boolean;
    activeTheme?: ThemeType;
    currentTheme?: typeof PASTEL_THEMES[ThemeType];
}

function timeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

function getInitials(name: string | null): string {
    if (name) {
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return parts[0].slice(0, 2).toUpperCase();
    }
    return '?';
}

const AVATAR_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];

function getColorFromUid(uid: string): string {
    let hash = 0;
    for (let i = 0; i < uid.length; i++) hash = ((hash << 5) - hash) + uid.charCodeAt(i);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const ACTIVITY_ICONS: Record<string, { icon: string; color: string }> = {
    research_added: { icon: '🔬', color: 'bg-blue-500/20' },
    research_deleted: { icon: '🗑', color: 'bg-red-500/20' },
    note_added: { icon: '📝', color: 'bg-yellow-500/20' },
    note_updated: { icon: '✏️', color: 'bg-yellow-500/20' },
    asset_added: { icon: '🎨', color: 'bg-purple-500/20' },
    task_added: { icon: '✅', color: 'bg-green-500/20' },
    task_completed: { icon: '🎉', color: 'bg-green-500/20' },
    file_uploaded: { icon: '📎', color: 'bg-cyan-500/20' },
    file_deleted: { icon: '🗑', color: 'bg-red-500/20' },
    comment_added: { icon: '💬', color: 'bg-indigo-500/20' },
    collaborator_added: { icon: '👤', color: 'bg-pink-500/20' },
    project_updated: { icon: '⚙️', color: 'bg-gray-500/20' },
};

const ActivityFeed: React.FC<ActivityFeedProps> = ({ activities, loading, isDarkMode, activeTheme, currentTheme }) => {
    if (loading) {
        return (
            <div className={`rounded-xl border p-4 ${activeTheme === 'dark'
                ? 'bg-[#1d1d1f] border-[#3d3d3f]'
                : activeTheme === 'light'
                    ? 'bg-white border-gray-200'
                    : currentTheme
                        ? `${currentTheme.cardBg} border ${currentTheme.border}`
                        : 'bg-white border-gray-200'
                }`}>
                <div className="flex items-center gap-2 mb-3">
                    <svg className={`w-4 h-4 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className={`text-sm font-semibold ${isDarkMode ? 'text-[#e5e5ea]' : 'text-gray-900'}`}>Activity</span>
                </div>
                <div className="animate-pulse space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="flex gap-2">
                            <div className={`w-7 h-7 rounded-full ${isDarkMode ? 'bg-[#3d3d3f]' : 'bg-gray-200'}`} />
                            <div className="flex-1 space-y-1.5">
                                <div className={`h-3 w-2/3 rounded ${isDarkMode ? 'bg-[#3d3d3f]' : 'bg-gray-200'}`} />
                                <div className={`h-2 w-1/3 rounded ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-100'}`} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className={`rounded-xl border ${activeTheme === 'dark'
            ? 'bg-[#1d1d1f] border-[#3d3d3f]'
            : activeTheme === 'light'
                ? 'bg-white border-gray-200'
                : currentTheme
                    ? `${currentTheme.cardBg} border ${currentTheme.border}`
                    : 'bg-white border-gray-200'
            }`}>
            {/* Header */}
            <div className={`flex items-center gap-2 px-4 py-3 border-b ${activeTheme === 'dark'
                ? 'border-[#3d3d3f]'
                : activeTheme === 'light'
                    ? 'border-gray-100'
                    : currentTheme
                        ? `border ${currentTheme.border}`
                        : 'border-gray-100'
                }`}>
                <svg className={`w-4 h-4 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className={`text-sm font-semibold ${isDarkMode ? 'text-[#e5e5ea]' : 'text-gray-900'}`}>
                    Activity
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isDarkMode ? 'bg-white/10 text-[#86868b]' : 'bg-gray-100 text-gray-500'
                    }`}>
                    {activities.length}
                </span>
            </div>

            {/* Activity list */}
            <div className="max-h-[300px] overflow-y-auto">
                {activities.length === 0 ? (
                    <div className={`text-center py-8 px-4 ${isDarkMode ? 'text-[#636366]' : 'text-gray-400'}`}>
                        <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-xs">No activity yet</p>
                        <p className="text-[10px] mt-0.5">Actions will appear here as team members make changes</p>
                    </div>
                ) : (
                    <div className="divide-y divide-transparent">
                        {activities.map((activity, index) => {
                            const iconInfo = ACTIVITY_ICONS[activity.type] || { icon: '📋', color: 'bg-gray-500/20' };
                            return (
                                <div
                                    key={activity.id}
                                    className={`flex gap-3 px-4 py-2.5 transition-colors ${activeTheme === 'dark'
                                        ? 'hover:bg-white/5'
                                        : activeTheme === 'light'
                                            ? 'hover:bg-gray-50'
                                            : currentTheme
                                                ? `hover:${currentTheme.bgSecondary}`
                                                : 'hover:bg-gray-50'
                                        }`}
                                >
                                    {/* Timeline dot + avatar */}
                                    <div className="relative flex-shrink-0">
                                        {activity.actorPhoto ? (
                                            <img src={activity.actorPhoto} alt="" className="w-7 h-7 rounded-full object-cover" />
                                        ) : (
                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${getColorFromUid(activity.actorUid)}`}>
                                                {getInitials(activity.actorName)}
                                            </div>
                                        )}
                                        {/* Icon badge */}
                                        <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] ${iconInfo.color} border ${isDarkMode ? 'border-[#1d1d1f]' : 'border-white'
                                            }`}>
                                            {iconInfo.icon}
                                        </span>
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-[#b0b0b5]' : 'text-gray-700'}`}>
                                            <span className={`font-semibold ${isDarkMode ? 'text-[#e5e5ea]' : 'text-gray-900'}`}>
                                                {activity.actorName || 'Someone'}
                                            </span>
                                            {' '}{activity.description}
                                        </p>
                                        <span className={`text-[10px] ${isDarkMode ? 'text-[#636366]' : 'text-gray-400'}`}>
                                            {timeAgo(activity.timestamp)}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ActivityFeed;
