import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ThemeType, PASTEL_THEMES } from '../constants';

interface SpiderChartDataPoint {
    label: string;
    value: number; // 0-100
}

interface SpiderChartProps {
    data: SpiderChartDataPoint[] | null;
    loading: boolean;
    error: string | null;
    onAnalyze: () => void;
    // Back side (Key Topics)
    backData: SpiderChartDataPoint[] | null;
    backLoading: boolean;
    backError: string | null;
    onAnalyzeBack: () => void;
    isDarkMode: boolean;
    activeTheme: ThemeType;
    currentTheme?: typeof PASTEL_THEMES[ThemeType];
}

/* ─── Canvas drawing helper ─── */
function drawRadar(
    canvas: HTMLCanvasElement,
    data: SpiderChartDataPoint[],
    size: number,
    isDarkMode: boolean,
    accent: 'blue' | 'purple',
) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const maxRadius = size * 0.28;
    const n = data.length;
    const angleStep = (Math.PI * 2) / n;
    const startAngle = -Math.PI / 2;

    ctx.clearRect(0, 0, size, size);

    // Colors per accent
    const gridColor = isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const axisColor = isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)';
    const labelColor = isDarkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';

    const fills: Record<string, { fill: string; stroke: string; dot: string }> = {
        blue: {
            fill: isDarkMode ? 'rgba(0, 113, 227, 0.25)' : 'rgba(0, 113, 227, 0.15)',
            stroke: isDarkMode ? 'rgba(90, 200, 250, 0.8)' : 'rgba(0, 113, 227, 0.7)',
            dot: isDarkMode ? '#5ac8fa' : '#0071e3',
        },
        purple: {
            fill: isDarkMode ? 'rgba(175, 82, 222, 0.25)' : 'rgba(175, 82, 222, 0.15)',
            stroke: isDarkMode ? 'rgba(210, 150, 255, 0.8)' : 'rgba(147, 51, 234, 0.7)',
            dot: isDarkMode ? '#d296ff' : '#9333ea',
        },
    };
    const c = fills[accent];

    // Concentric grid polygons (5 levels)
    for (let level = 1; level <= 5; level++) {
        const r = (maxRadius / 5) * level;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const angle = startAngle + angleStep * (i % n);
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Axis lines
    for (let i = 0; i < n; i++) {
        const angle = startAngle + angleStep * i;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + maxRadius * Math.cos(angle), cy + maxRadius * Math.sin(angle));
        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Data polygon
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
        const idx = i % n;
        const angle = startAngle + angleStep * idx;
        const r = (data[idx].value / 100) * maxRadius;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = c.fill;
    ctx.fill();
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dots
    for (let i = 0; i < n; i++) {
        const angle = startAngle + angleStep * i;
        const r = (data[i].value / 100) * maxRadius;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = c.dot;
        ctx.fill();
    }

    // Multi-line text helper
    const drawMultiLineText = (text: string, x: number, y: number, lineHeight: number) => {
        const words = text.split(' ');
        const lines: string[] = [];

        // Check for single long word (e.g. "Collaboration")
        if (words.length === 1 && text.length > 10) {
            const mid = Math.ceil(text.length / 2);
            lines.push(text.slice(0, mid) + '-');
            lines.push(text.slice(mid));
        } else if (words.length > 1 && text.length > 10) {
            const mid = Math.ceil(words.length / 2);
            lines.push(words.slice(0, mid).join(' '));
            lines.push(words.slice(mid).join(' '));
        } else {
            lines.push(text);
        }
        const totalHeight = lines.length * lineHeight;
        const startY = y - totalHeight / 2 + lineHeight / 2;
        lines.forEach((lineText, i) => {
            ctx.fillText(lineText, x, startY + i * lineHeight);
        });
    };

    // Labels
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = labelColor;
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
        const angle = startAngle + angleStep * i;
        const labelRadius = maxRadius + 22;
        const x = cx + labelRadius * Math.cos(angle);
        const y = cy + labelRadius * Math.sin(angle);
        const cos = Math.cos(angle);
        if (cos > 0.3) ctx.textAlign = 'left';
        else if (cos < -0.3) ctx.textAlign = 'right';
        else ctx.textAlign = 'center';
        drawMultiLineText(data[i].label, x, y, 14);
    }

    // Value labels near dots
    ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = c.dot;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let i = 0; i < n; i++) {
        const angle = startAngle + angleStep * i;
        const r = (data[i].value / 100) * maxRadius;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        ctx.fillText(`${data[i].value}`, x, y - 6);
    }
}

/* ─── Component ─── */
export const SpiderChart: React.FC<SpiderChartProps> = ({
    data,
    loading,
    error,
    onAnalyze,
    backData,
    backLoading,
    backError,
    onAnalyzeBack,
    isDarkMode,
    activeTheme,
    currentTheme,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const frontCanvasRef = useRef<HTMLCanvasElement>(null);
    const backCanvasRef = useRef<HTMLCanvasElement>(null);
    const [canvasSize, setCanvasSize] = useState(280);
    const [isFlipped, setIsFlipped] = useState(false);

    // Touch / swipe state
    const touchStartX = useRef(0);

    // Responsive sizing
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                const width = containerRef.current.clientWidth - 16;
                setCanvasSize(Math.min(Math.max(width, 200), 400));
            }
        };
        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    // Draw front chart
    useEffect(() => {
        if (!data || data.length < 3 || !frontCanvasRef.current) return;
        drawRadar(frontCanvasRef.current, data, canvasSize, isDarkMode, 'blue');
    }, [data, canvasSize, isDarkMode, activeTheme]);

    // Draw back chart
    useEffect(() => {
        if (!backData || backData.length < 3 || !backCanvasRef.current) return;
        drawRadar(backCanvasRef.current, backData, canvasSize, isDarkMode, 'purple');
    }, [backData, canvasSize, isDarkMode, activeTheme]);

    // Swipe handlers
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartX.current = e.touches[0].clientX;
    }, []);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        if (Math.abs(dx) > 40) {
            setIsFlipped(prev => !prev);
        }
    }, []);

    const handleClick = useCallback(() => {
        setIsFlipped(prev => !prev);
    }, []);

    /* ─── Shared sub-components ─── */
    const renderEmpty = (label: string) => (
        <div className={`text-center py-8 ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
            <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-xs">Click <strong>Analyze</strong> to map {label}</p>
        </div>
    );

    const renderSpinner = () => (
        <div className="flex items-center justify-center py-10">
            <div className={`w-12 h-12 rounded-full border-2 border-t-transparent animate-spin ${isDarkMode ? 'border-[#5ac8fa]' : 'border-[#0071e3]'}`} />
        </div>
    );

    const renderError = (msg: string) => (
        <div className={`text-xs rounded-lg px-3 py-2 mb-3 ${isDarkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
            {msg}
        </div>
    );

    const analyzeBtn = (isLoading: boolean, hasData: boolean, action: () => void, accentClass: string) => (
        <button
            onClick={(e) => { e.stopPropagation(); action(); }}
            disabled={isLoading}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''} ${accentClass}`}
        >
            {isLoading ? (
                <span className="flex items-center gap-1.5">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Analyzing...
                </span>
            ) : hasData ? 'Refresh' : 'Analyze'}
        </button>
    );

    // Ensure we use a solid background for the flippable card to prevent "seeing through"
    // to the other side or z-fighting visual artifacts.
    const getSolidBg = (bgClass: string) => bgClass.split('/')[0];

    const cardStyles = `rounded-2xl sm:rounded-3xl border transition-colors overflow-hidden ${activeTheme === 'dark'
        ? 'bg-[#1d1d1f] border-[#3d3d3f]/50'
        : activeTheme === 'light'
            ? 'bg-white border-gray-200'
            : currentTheme
                ? `${getSolidBg(currentTheme.cardBg)} border ${currentTheme.border}`
                : 'bg-white border-gray-200'
        }`;

    return (
        <div
            ref={containerRef}
            style={{ perspective: 900 }}
        >
            {/* Flip container */}
            <div
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                style={{
                    transformStyle: 'preserve-3d',
                    transition: 'transform 0.55s cubic-bezier(.4,.2,.2,1)',
                    transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                    position: 'relative',
                }}
            >
                {/* ══════ FRONT: Project DNA ══════ */}
                <div
                    className={`p-4 ${cardStyles}`}
                    style={{ backfaceVisibility: 'hidden' }}
                >
                    <div className="flex items-center justify-between mb-3">
                        <div
                            className="flex items-center gap-2 cursor-pointer select-none"
                            onClick={handleClick}
                        >
                            <svg className={`w-4 h-4 ${isDarkMode ? 'text-[#5ac8fa]' : 'text-[#0071e3]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                            <h3 className={`text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                Project DNA
                            </h3>
                        </div>
                        {analyzeBtn(
                            loading,
                            !!data,
                            onAnalyze,
                            isDarkMode
                                ? 'bg-[#0071e3]/20 text-[#5ac8fa] hover:bg-[#0071e3]/30'
                                : 'bg-[#0071e3]/10 text-[#0071e3] hover:bg-[#0071e3]/20',
                        )}
                    </div>

                    {error && renderError(error)}
                    {!data && !loading && !error && renderEmpty("your project's DNA")}
                    {loading && !data && renderSpinner()}
                    {data && (
                        <div className="flex justify-center cursor-pointer" onClick={handleClick}>
                            <canvas ref={frontCanvasRef} />
                        </div>
                    )}

                    {/* Indicator dots */}
                    <div className="flex items-center justify-center gap-2 mt-3">
                        <span className={`w-2 h-2 rounded-full transition-colors ${!isFlipped
                            ? (isDarkMode ? 'bg-[#5ac8fa]' : 'bg-[#0071e3]')
                            : (isDarkMode ? 'bg-[#3d3d3f]' : 'bg-gray-300')
                            }`} />
                        <span className={`w-2 h-2 rounded-full transition-colors ${isFlipped
                            ? (isDarkMode ? 'bg-[#d296ff]' : 'bg-[#9333ea]')
                            : (isDarkMode ? 'bg-[#3d3d3f]' : 'bg-gray-300')
                            }`} />
                        <span className={`ml-1 text-[10px] ${isDarkMode ? 'text-[#86868b]' : 'text-gray-400'}`}>
                            {!isFlipped ? 'Tap to flip →' : '← Tap to flip'}
                        </span>
                    </div>
                </div>

                {/* ══════ BACK: Key Topics ══════ */}
                <div
                    className={`p-4 ${cardStyles}`}
                    style={{
                        backfaceVisibility: 'hidden',
                        transform: 'rotateY(180deg)',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                    }}
                >
                    <div className="flex items-center justify-between mb-3">
                        <div
                            className="flex items-center gap-2 cursor-pointer select-none"
                            onClick={handleClick}
                        >
                            <svg className={`w-4 h-4 ${isDarkMode ? 'text-[#d296ff]' : 'text-[#9333ea]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                            </svg>
                            <h3 className={`text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                Key Topics
                            </h3>
                        </div>
                        {analyzeBtn(
                            backLoading,
                            !!backData,
                            onAnalyzeBack,
                            isDarkMode
                                ? 'bg-purple-500/20 text-[#d296ff] hover:bg-purple-500/30'
                                : 'bg-purple-500/10 text-[#9333ea] hover:bg-purple-500/20',
                        )}
                    </div>

                    {backError && renderError(backError)}
                    {!backData && !backLoading && !backError && renderEmpty("your project's key topics")}
                    {backLoading && !backData && renderSpinner()}
                    {backData && (
                        <div className="flex justify-center cursor-pointer" onClick={handleClick}>
                            <canvas ref={backCanvasRef} />
                        </div>
                    )}

                    {/* Indicator dots */}
                    <div className="flex items-center justify-center gap-2 mt-3">
                        <span className={`w-2 h-2 rounded-full transition-colors ${!isFlipped
                            ? (isDarkMode ? 'bg-[#5ac8fa]' : 'bg-[#0071e3]')
                            : (isDarkMode ? 'bg-[#3d3d3f]' : 'bg-gray-300')
                            }`} />
                        <span className={`w-2 h-2 rounded-full transition-colors ${isFlipped
                            ? (isDarkMode ? 'bg-[#d296ff]' : 'bg-[#9333ea]')
                            : (isDarkMode ? 'bg-[#3d3d3f]' : 'bg-gray-300')
                            }`} />
                        <span className={`ml-1 text-[10px] ${isDarkMode ? 'text-[#86868b]' : 'text-gray-400'}`}>
                            {isFlipped ? '← Tap to flip' : 'Tap to flip →'}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};
