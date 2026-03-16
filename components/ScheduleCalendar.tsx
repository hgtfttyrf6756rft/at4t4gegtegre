/**
 * ScheduleCalendar - Displays scheduled posts on a calendar view
 */

import React, { useState, useEffect, useMemo } from 'react';
import { authFetch } from '../services/authFetch';

interface ScheduledPost {
    id: string;
    projectId: string;
    scheduledAt: number;
    status: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
    platforms: string[];
    postType: string;
    textContent: string;
}

interface ScheduledEmail {
    id: string;
    projectId: string;
    scheduledAt: number;
    status: 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
    provider: 'gmail' | 'outlook';
    to: string | string[];
    subject: string;
    html: string;
    error?: string;
}

type CalendarItem =
    | ({ type: 'social' } & ScheduledPost)
    | ({ type: 'email' } & ScheduledEmail);

interface Theme {
    primary: string;
    primaryHover: string;
    bgSecondary: string;
    text: string;
    border: string;
    ring: string;
}

interface ScheduleCalendarProps {
    projectId: string;
    isDarkMode: boolean;
    activeTheme?: string;
    currentTheme?: Theme;
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
    facebook: <img src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/2021_Facebook_icon.svg.webp" className="w-4 h-4 inline-block object-contain" alt="Facebook" />,
    instagram: <img src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/Instagram_logo_2016.svg.webp" className="w-4 h-4 inline-block object-contain" alt="Instagram" />,
    tiktok: <img src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/tiktok-6338432_1280.webp" className="w-4 h-4 inline-block object-contain" alt="TikTok" />,
    youtube: <img src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/YouTube_full-color_icon_%282017%29.svg.png" className="w-4 h-4 inline-block object-contain" alt="YouTube" />,
    linkedin: <img src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/LinkedIn_logo_initials.png" className="w-4 h-4 inline-block object-contain" alt="LinkedIn" />,
    x: <img src="https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/X-Logo-Round-Color.png" className="w-4 h-4 inline-block object-contain" alt="X" />,
    gmail: <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="currentColor"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" /></svg>,
    outlook: <svg className="w-4 h-4 text-[#0078D4]" viewBox="0 0 24 24" fill="currentColor"><path d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88m-.25-4.82h8.98l.03.95H7.67l-.04-.95M14.12 5h-4.4q-.83 0-1.5.58-.66.57-.7 1.38l.001.52h8.8V5m-4.4 12.35V22H5.62V8.2q0-.75.57-1.32.57-.58 1.33-.58h4.4m0-1.12h-4.4q-.94 0-1.63.64-.68.65-.68 1.58V22H7.6V8.98q0-.64.43-1.07.44-.43 1.06-.43h4.4V17.35M22 8.13V22H9.72V17.35h7.88V8.13H22m-2.4 13.27h-4.07v-4.02l4.07-.001v4.021" /></svg>
};

const STATUS_COLORS: Record<string, string> = {
    scheduled: 'bg-blue-500',
    publishing: 'bg-yellow-500',
    sending: 'bg-yellow-500',
    published: 'bg-green-500',
    sent: 'bg-green-500',
    failed: 'bg-red-500',
    cancelled: 'bg-gray-500',
};

// Helper to get local date string (YYYY-MM-DD) without timezone offset
const toLocalDateStr = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// Helper to format YYYY-MM-DD string as Month Day, Year without timezone shift
const formatSelectedDate = (dateStr: string): string => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
};

export const ScheduleCalendar: React.FC<ScheduleCalendarProps> = ({
    projectId,
    isDarkMode,
    activeTheme,
    currentTheme,
}) => {
    const [items, setItems] = useState<CalendarItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Fetch scheduled items
    useEffect(() => {
        const fetchItems = async () => {
            setLoading(true);
            try {
                const [socialRes, emailRes] = await Promise.all([
                    authFetch('/api/social?op=schedule-list', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId }),
                    }),
                    authFetch(`/api/email?op=email-schedule-list&projectId=${projectId}`)
                ]);

                const socialData = await socialRes.json();
                const emailData = await emailRes.json();

                const socialItems: CalendarItem[] = (socialRes.ok && socialData.posts)
                    ? socialData.posts.map((p: ScheduledPost) => ({ ...p, type: 'social' as const }))
                    : [];

                const emailItems: CalendarItem[] = (emailRes.ok && emailData.emails)
                    ? emailData.emails.map((e: ScheduledEmail) => ({ ...e, type: 'email' as const }))
                    : [];

                setItems([...socialItems, ...emailItems]);

                if (!socialRes.ok) setError(socialData.error || 'Failed to load social posts');
                if (!emailRes.ok && error) setError(prev => `${prev}, ${emailData.error}`);
            } catch (e: any) {
                setError(e.message || 'Failed to fetch items');
            } finally {
                setLoading(false);
            }
        };

        if (projectId) {
            fetchItems();
        }
    }, [projectId]);

    // Generate calendar days
    const calendarDays = useMemo(() => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startPadding = firstDay.getDay();
        const totalDays = lastDay.getDate();

        const days: Array<{ date: Date | null; dateStr: string; items: CalendarItem[] }> = [];

        // Add padding for days before month starts
        for (let i = 0; i < startPadding; i++) {
            days.push({ date: null, dateStr: '', items: [] });
        }

        // Add actual days
        for (let d = 1; d <= totalDays; d++) {
            const date = new Date(year, month, d);
            const dateStr = toLocalDateStr(date);

            // Find items for this day (using local time)
            const dayItems = items.filter(item => {
                const itemDate = new Date(item.scheduledAt * 1000);
                return toLocalDateStr(itemDate) === dateStr;
            });

            days.push({ date, dateStr, items: dayItems });
        }

        return days;
    }, [currentMonth, items]);

    // Items for selected date
    const selectedItems = useMemo(() => {
        if (!selectedDate) return [];
        return items.filter(item => {
            const itemDate = new Date(item.scheduledAt * 1000);
            return toLocalDateStr(itemDate) === selectedDate;
        });
    }, [selectedDate, items]);

    const prevMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    };

    const nextMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
    };

    const monthLabel = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

    const handleCancelItem = async (item: CalendarItem) => {
        // Optimistic cancellation is currently only supported for social posts
        if (item.type !== 'social') {
            // In the future, we can add email cancellation here
            return;
        }

        try {
            // Optimistic update
            setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'cancelled' as const } : i));

            const res = await authFetch('/api/social?op=schedule-cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scheduledPostId: item.id }),
            });

            if (!res.ok) {
                // Revert to original object if failed
                setItems(prev => prev.map(i => i.id === item.id ? item : i));
                alert('Failed to cancel item');
            }
        } catch (e) {
            console.error('Failed to cancel:', e);
            // Revert
            setItems(prev => prev.map(i => i.id === item.id ? item : i));
        }
    };

    if (loading) {
        return (
            <div className={`p-6 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className="text-center text-gray-500">Loading scheduled items...</div>
            </div>
        );
    }

    return (
        <div className={`rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'} p-4 md:p-6`}>
            <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
                {/* Calendar Side */}
                <div className="flex-1">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            📅 Scheduled
                        </h3>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={prevMonth}
                                className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-white/10 text-white' : 'hover:bg-gray-200 text-gray-700'}`}
                            >
                                ←
                            </button>
                            <span className={`font-medium min-w-[120px] md:min-w-[140px] text-center text-sm md:text-base ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                {monthLabel}
                            </span>
                            <button
                                onClick={nextMonth}
                                className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-white/10 text-white' : 'hover:bg-gray-200 text-gray-700'}`}
                            >
                                →
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="mb-4 p-3 bg-red-500/20 text-red-400 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    {/* Calendar Grid */}
                    <div className="grid grid-cols-7 gap-1">
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                            <div key={day} className={`text-center text-[10px] uppercase font-bold py-2 ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`}>
                                {day}
                            </div>
                        ))}
                        {calendarDays.map((day, idx) => (
                            <div
                                key={idx}
                                onClick={() => day.dateStr && setSelectedDate(day.dateStr === selectedDate ? null : day.dateStr)}
                                className={`
                                    aspect-square p-0.5 md:p-1 rounded-lg cursor-pointer transition-all relative group
                                    ${day.date ? (isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100') : ''}
                                    ${day.dateStr === selectedDate
                                        ? (activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light'
                                            ? `${currentTheme.primary} text-white shadow-lg`
                                            : 'bg-blue-500 text-white shadow-lg shadow-blue-500/30')
                                        : ''}
                                    ${!day.date ? 'opacity-0 pointer-events-none' : ''}
                                `}
                            >
                                {day.date && (
                                    <>
                                        <span className={`text-xs md:text-sm font-medium absolute top-1 left-1.5 md:static md:block text-center w-full ${day.dateStr === selectedDate ? 'text-white' : (isDarkMode ? 'text-white/90' : 'text-gray-700')}`}>
                                            {day.date.getDate()}
                                        </span>
                                        {day.items.length > 0 && (
                                            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-0.5 md:gap-1">
                                                {day.items.slice(0, 3).map((item, i) => (
                                                    <div
                                                        key={i}
                                                        className={`w-1 h-1 md:w-1.5 md:h-1.5 rounded-full ${day.dateStr === selectedDate ? 'bg-white/80' : STATUS_COLORS[item.status] || 'bg-gray-400'}`}
                                                    />
                                                ))}
                                                {day.items.length > 3 && (
                                                    <span className={`text-[8px] leading-none ${day.dateStr === selectedDate ? 'text-white/80' : 'text-gray-500'}`}>+</span>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Details Sidebar */}
                <div className={`lg:w-[320px] shrink-0 border-t pt-6 mt-2 lg:mt-0 lg:border-t-0 lg:border-l lg:pt-0 ${isDarkMode ? 'border-white/10 lg:border-white/10' : 'border-gray-200 lg:border-gray-200'} lg:pl-8 flex flex-col`}>
                    <div className="flex-1 max-h-[300px] lg:max-h-[480px] overflow-y-auto pr-2 custom-scrollbar">
                        {selectedDate ? (
                            <>
                                <h4 className={`text-sm font-semibold mb-4 uppercase tracking-wider sticky top-0 bg-inherit z-10 py-2 ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                                    {formatSelectedDate(selectedDate)}
                                </h4>

                                {selectedItems.length > 0 ? (
                                    <div className="space-y-3">
                                        {selectedItems.map(item => (
                                            <div
                                                key={item.id}
                                                className={`p-4 rounded-xl transition-all ${isDarkMode ? 'bg-white/5 border border-white/5 hover:bg-white/10' : 'bg-white border border-gray-100 shadow-sm hover:shadow-md'}`}
                                            >
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${item.status === 'scheduled' && activeTheme && currentTheme && activeTheme !== 'dark' && activeTheme !== 'light'
                                                            ? `${currentTheme.primary} text-white`
                                                            : STATUS_COLORS[item.status] || 'bg-gray-500 text-white'
                                                            } text-white`}>
                                                            {item.status}
                                                        </span>
                                                        <span className={`text-xs font-medium ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                                                            {new Date(item.scheduledAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <div className="flex gap-1 text-sm bg-black/10 dark:bg-white/5 p-1 rounded-md">
                                                        {item.type === 'social' ? (
                                                            item.platforms.map(p => (
                                                                <span key={p} title={p} className="flex items-center justify-center">{PLATFORM_ICONS[p] || '📱'}</span>
                                                            ))
                                                        ) : (
                                                            <span title={item.provider} className="flex items-center justify-center">{PLATFORM_ICONS[item.provider] || '📧'}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <p className={`text-sm line-clamp-3 leading-relaxed ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`}>
                                                    {item.type === 'social' ? (item.textContent || '(Media post)') : (item.subject || '(No Subject)')}
                                                </p>

                                                {/* Email Specific Details */}
                                                {item.type === 'email' && (
                                                    <p className={`text-xs mt-2 ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`}>
                                                        To: {Array.isArray(item.to) ? `${item.to.length} recipients` : item.to}
                                                    </p>
                                                )}

                                                {item.status === 'scheduled' && item.type === 'social' && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleCancelItem(item);
                                                        }}
                                                        className="mt-3 text-xs font-semibold text-red-400 hover:text-red-300 transition-colors"
                                                    >
                                                        Cancel Post
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className={`mt-4 lg:mt-8 text-center p-6 rounded-2xl border-2 border-dashed ${isDarkMode ? 'border-white/5 bg-white/2' : 'border-gray-100 bg-gray-50/50'}`}>
                                        <div className="text-2xl mb-2">🏖️</div>
                                        <p className={`text-sm ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>
                                            No items scheduled for this day.
                                        </p>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center p-6 min-h-[200px]">
                                <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isDarkMode ? 'bg-white/5' : 'bg-white shadow-sm'}`}>
                                    <span className="text-2xl opacity-50">🗓️</span>
                                </div>
                                <h4 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                    Daily Schedule
                                </h4>
                                <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>
                                    Select a date on the calendar to see detailed schedule information.
                                </p>
                            </div>
                        )}
                    </div>

                    {((items.length === 0) && !selectedDate) && (
                        <div className={`mt-auto pt-6 border-t ${isDarkMode ? 'border-white/5' : 'border-gray-100'}`}>
                            <p className={`text-center text-xs italic ${isDarkMode ? 'text-white/30' : 'text-gray-400'}`}>
                                No scheduled items found in this month.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ScheduleCalendar;


