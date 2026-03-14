import React from 'react';

type SocialPlatform = 'facebook' | 'instagram' | 'x' | 'tiktok' | 'youtube' | 'linkedin';

interface SocialAuthPromptProps {
    platforms: SocialPlatform[];
    isDarkMode: boolean;
    onConnect: (platform: SocialPlatform) => void;
    onDismiss: () => void;
}

const PLATFORM_INFO: Record<SocialPlatform, { name: string; logo: string; color: string }> = {
    facebook: {
        name: 'Facebook',
        logo: 'https://cI6wjaC8e4NWiqIn.public.blob.vercel-storage.com/2021_Facebook_icon.svg.webp',
        color: '#1877F2',
    },
    instagram: {
        name: 'Instagram',
        logo: 'https://cI6wjaC8e4NWiqIn.public.blob.vercel-storage.com/Instagram_logo_2016.svg.webp',
        color: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)',
    },
    x: {
        name: 'X',
        logo: 'https://cI6wjaC8e4NWiqIn.public.blob.vercel-storage.com/X-Logo-Round-Color.png',
        color: '#000000',
    },
    tiktok: {
        name: 'TikTok',
        logo: 'https://cI6wjaC8e4NWiqIn.public.blob.vercel-storage.com/tiktok-6338432_1280.webp',
        color: '#000000',
    },
    youtube: {
        name: 'YouTube',
        logo: 'https://cI6wjaC8e4NWiqIn.public.blob.vercel-storage.com/YouTube_full-color_icon_%282017%29.svg.png',
        color: '#FF0000',
    },
    linkedin: {
        name: 'LinkedIn',
        logo: 'https://cI6wjaC8e4NWiqIn.public.blob.vercel-storage.com/LinkedIn_logo_initials.png',
        color: '#0A66C2',
    },
};

export const SocialAuthPrompt: React.FC<SocialAuthPromptProps> = ({
    platforms,
    isDarkMode,
    onConnect,
    onDismiss,
}) => {
    if (platforms.length === 0) return null;

    return (
        <div
            className={`rounded-xl p-4 border ${isDarkMode
                ? 'bg-[#2d2d2f] border-[#3d3d3f]/50'
                : 'bg-amber-50 border-amber-200'
                }`}
        >
            <div className="flex items-start gap-3">
                <div className="text-amber-500 text-xl">🔗</div>
                <div className="flex-1">
                    <p className={`font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        Connect to post
                    </p>
                    <p className={`text-sm mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        To publish your content, please connect to the following platform{platforms.length > 1 ? 's' : ''}:
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {platforms.map((platform) => {
                            const info = PLATFORM_INFO[platform];
                            return (
                                <button
                                    key={platform}
                                    onClick={() => onConnect(platform)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105 ${isDarkMode
                                        ? 'bg-white/10 hover:bg-white/20 text-white'
                                        : 'bg-white hover:bg-gray-50 text-gray-900 shadow-sm'
                                        }`}
                                    style={{
                                        border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                                    }}
                                >
                                    <img
                                        src={info.logo}
                                        alt={info.name}
                                        className="w-5 h-5 rounded object-contain"
                                    />
                                    Connect {info.name}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <button
                    onClick={onDismiss}
                    className={`p-1 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-200 text-gray-500'
                        }`}
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>
    );
};


