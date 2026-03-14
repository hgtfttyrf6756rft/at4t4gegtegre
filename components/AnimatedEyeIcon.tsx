import React, { useEffect, useRef, useState } from 'react';

interface AnimatedEyeIconProps {
    className?: string;
    isDarkMode?: boolean;
}

export const AnimatedEyeIcon: React.FC<AnimatedEyeIconProps> = ({
    className = '',
    isDarkMode = false,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!containerRef.current) return;

            const rect = containerRef.current.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            const dx = e.clientX - centerX;
            const dy = e.clientY - centerY;

            // Calculate distance and angle
            const angle = Math.atan2(dy, dx);
            // Limit movement radius
            const distance = Math.min(6, Math.hypot(dx, dy) / 8);

            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance;

            setEyeOffset({ x, y });
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    return (
        <div
            ref={containerRef}
            className={`relative flex items-center justify-center rounded-full shadow-lg overflow-hidden ${className}`}
        >
            <div
                className="flex gap-[6px] items-center justify-center pt-0.5 pointer-events-none transition-transform duration-75"
                style={{ transform: `translate(${eyeOffset.x}px, ${eyeOffset.y}px)` }}
            >
                <div className="w-[7px] h-[14px] bg-white rounded-[50%] animate-blink"></div>
                <div className="w-[7px] h-[14px] bg-white rounded-[50%] animate-blink"></div>
            </div>
        </div>
    );
};
