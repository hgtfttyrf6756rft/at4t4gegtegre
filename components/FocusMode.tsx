
import React, { useState, useEffect, useRef } from 'react';

interface FocusModeProps {
    isDarkMode: boolean;
    activeTheme?: string;
    currentTheme?: any;
}

export const FocusMode: React.FC<FocusModeProps> = ({ isDarkMode, activeTheme, currentTheme }) => {
    const [timeLeft, setTimeLeft] = useState(25 * 60);
    const [isActive, setIsActive] = useState(false);
    const [mode, setMode] = useState<'focus' | 'break'>('focus');

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;

        if (isActive && timeLeft > 0) {
            interval = setInterval(() => {
                setTimeLeft((prevTime) => prevTime - 1);
            }, 1000);
        } else if (timeLeft === 0) {
            setIsActive(false);
            // Optional: Play sound or notification here
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isActive, timeLeft]);

    const toggleTimer = () => {
        setIsActive(!isActive);
    };

    const resetTimer = () => {
        setIsActive(false);
        setTimeLeft(mode === 'focus' ? 25 * 60 : 5 * 60);
    };

    const switchMode = (newMode: 'focus' | 'break') => {
        setMode(newMode);
        setIsActive(false);
        setTimeLeft(newMode === 'focus' ? 25 * 60 : 5 * 60);
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const progress = mode === 'focus'
        ? ((25 * 60 - timeLeft) / (25 * 60)) * 100
        : ((5 * 60 - timeLeft) / (5 * 60)) * 100;

    return (
        <div className={`rounded-2xl sm:rounded-3xl p-6 ${isDarkMode
            ? 'bg-[#1d1d1f] border border-[#3d3d3f]/50'
            : activeTheme === 'light'
                ? 'bg-white border border-gray-200 shadow-sm'
                : `${currentTheme?.cardBg || 'bg-white'} border ${currentTheme?.border || 'border-gray-200'}`
            }`}>
            <div className="flex items-center justify-between mb-6">
                <h3 className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    🧠 Focus Mode
                </h3>
                <div className={`flex items-center gap-1 p-1 rounded-full ${isDarkMode ? 'bg-white/10' : 'bg-gray-100'}`}>
                    <button
                        onClick={() => switchMode('focus')}
                        className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${mode === 'focus'
                            ? (isDarkMode ? 'bg-white text-black' : 'bg-white shadow text-gray-900')
                            : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900')
                            }`}
                    >
                        Focus
                    </button>
                    <button
                        onClick={() => switchMode('break')}
                        className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${mode === 'break'
                            ? (isDarkMode ? 'bg-white text-black' : 'bg-white shadow text-gray-900')
                            : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900')
                            }`}
                    >
                        Break
                    </button>
                </div>
            </div>

            <div className="flex flex-col items-center justify-center py-4">
                <div className="relative w-48 h-48 flex items-center justify-center mb-6">
                    {/* Ring Background */}
                    <svg className="absolute w-full h-full -rotate-90" viewBox="0 0 100 100">
                        <circle
                            cx="50"
                            cy="50"
                            r="45"
                            fill="none"
                            stroke={isDarkMode ? '#333' : '#e5e7eb'}
                            strokeWidth="6"
                        />
                        <circle
                            cx="50"
                            cy="50"
                            r="45"
                            fill="none"
                            stroke={mode === 'focus' ? '#3b82f6' : '#10b981'}
                            strokeWidth="6"
                            strokeDasharray="283"
                            strokeDashoffset={283 - (283 * progress) / 100}
                            strokeLinecap="round"
                            className="transition-all duration-1000 ease-linear"
                        />
                    </svg>

                    <div className="text-center z-10">
                        <div className={`text-5xl font-bold font-mono tracking-tighter ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {formatTime(timeLeft)}
                        </div>
                        <div className={`text-xs font-medium uppercase tracking-wider mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            {isActive ? 'Running' : 'Paused'}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full max-w-xs">
                    <button
                        onClick={toggleTimer}
                        className={`flex-1 py-3 px-4 rounded-xl font-semibold transition-all ${isActive
                            ? (isDarkMode ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-red-50 text-red-600 hover:bg-red-100')
                            : (isDarkMode ? 'bg-white text-black hover:bg-gray-200' : 'bg-gray-900 text-white hover:bg-gray-800')
                            }`}
                    >
                        {isActive ? 'Pause' : 'Start Timer'}
                    </button>
                    <button
                        onClick={resetTimer}
                        className={`px-4 py-3 rounded-xl font-semibold transition-all ${isDarkMode
                            ? 'bg-white/10 text-white hover:bg-white/20'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        title="Reset"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};
