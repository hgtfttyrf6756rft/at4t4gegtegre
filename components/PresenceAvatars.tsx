import React, { useState } from 'react';

interface OnlineUser {
    uid: string;
    displayName: string | null;
    photoURL: string | null;
    email: string | null;
    activeTab: string;
}

interface PresenceAvatarsProps {
    users: OnlineUser[];
    isDarkMode: boolean;
    maxVisible?: number;
}

const TAB_LABELS: Record<string, string> = {
    overview: 'Overview',
    research: 'Research',
    assets: 'Assets',
    data: 'Data',
    tasks: 'Tasks',
    notes: 'Notes',
    websites: 'Websites',
    seo: 'SEO',
    social: 'Social',
    products: 'Products',
    emails: 'Emails',
};

function getInitials(name: string | null, email: string | null): string {
    if (name) {
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return parts[0].slice(0, 2).toUpperCase();
    }
    if (email) return email[0].toUpperCase();
    return '?';
}

// Deterministic color from uid
const AVATAR_COLORS = [
    'bg-blue-500',
    'bg-emerald-500',
    'bg-purple-500',
    'bg-amber-500',
    'bg-rose-500',
    'bg-cyan-500',
    'bg-indigo-500',
    'bg-pink-500',
];

function getAvatarColor(uid: string): string {
    let hash = 0;
    for (let i = 0; i < uid.length; i++) {
        hash = ((hash << 5) - hash) + uid.charCodeAt(i);
        hash |= 0;
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const PresenceAvatars: React.FC<PresenceAvatarsProps> = ({
    users,
    isDarkMode,
    maxVisible = 4,
}) => {
    const [hoveredUid, setHoveredUid] = useState<string | null>(null);

    if (users.length === 0) return null;

    const visible = users.slice(0, maxVisible);
    const overflow = users.length - maxVisible;

    return (
        <div className="flex items-center gap-0.5">
            {/* Online indicator dot */}
            <div className="flex items-center gap-1.5 mr-1">
                <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                <span className={`text-[10px] font-medium uppercase tracking-wider ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                    {users.length} online
                </span>
            </div>

            {/* Avatar stack */}
            <div className="flex items-center -space-x-2">
                {visible.map((user) => (
                    <div
                        key={user.uid}
                        className="relative"
                        onMouseEnter={() => setHoveredUid(user.uid)}
                        onMouseLeave={() => setHoveredUid(null)}
                    >
                        {/* Tooltip */}
                        {hoveredUid === user.uid && (
                            <div
                                className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap z-50 pointer-events-none ${isDarkMode
                                        ? 'bg-[#2d2d2f] text-white border border-[#3d3d3f]'
                                        : 'bg-white text-gray-900 border border-gray-200 shadow-lg'
                                    }`}
                            >
                                <div className="font-medium">{user.displayName || user.email || 'Anonymous'}</div>
                                <div className={`${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                                    Viewing {TAB_LABELS[user.activeTab] || user.activeTab}
                                </div>
                            </div>
                        )}

                        {/* Avatar */}
                        {user.photoURL ? (
                            <img
                                src={user.photoURL}
                                alt={user.displayName || 'User'}
                                className={`w-7 h-7 rounded-full border-2 object-cover transition-transform hover:scale-110 hover:z-10 ${isDarkMode ? 'border-[#1d1d1f]' : 'border-white'
                                    }`}
                            />
                        ) : (
                            <div
                                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold text-white transition-transform hover:scale-110 hover:z-10 ${getAvatarColor(user.uid)
                                    } ${isDarkMode ? 'border-[#1d1d1f]' : 'border-white'}`}
                            >
                                {getInitials(user.displayName, user.email)}
                            </div>
                        )}

                        {/* Green online dot */}
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 ${isDarkMode ? 'border-[#1d1d1f]' : 'border-white'
                            }`} />
                    </div>
                ))}

                {overflow > 0 && (
                    <div
                        className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${isDarkMode
                                ? 'bg-[#3d3d3f] text-[#e5e5ea] border-[#1d1d1f]'
                                : 'bg-gray-200 text-gray-600 border-white'
                            }`}
                    >
                        +{overflow}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PresenceAvatars;
