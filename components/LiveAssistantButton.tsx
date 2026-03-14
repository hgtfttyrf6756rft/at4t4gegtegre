import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface LiveAssistantButtonProps {
    onClick: () => void;
    className?: string;
    isDarkMode?: boolean;
    children?: React.ReactNode;
    visible?: boolean; // Controls if button should be shown
}

export const LiveAssistantButton: React.FC<LiveAssistantButtonProps> = ({
    onClick,
    className = '',
    isDarkMode = false,
    children,
    visible = true
}) => {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!buttonRef.current) return;

            const rect = buttonRef.current.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            const dx = e.clientX - centerX;
            const dy = e.clientY - centerY;

            // Calculate distance and angle
            const angle = Math.atan2(dy, dx);
            // More sensitive tracking: Divisor 4 instead of 20, Max 6px instead of 3px
            const distance = Math.min(6, Math.hypot(dx, dy) / 4);

            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance;

            setEyeOffset({ x, y });
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    // Don't render if not visible or not mounted
    if (!mounted || !visible) return null;

    const buttonElement = (
        <button
            ref={buttonRef}
            onClick={onClick}
            className={`fixed bottom-6 right-6 w-12 h-12 sm:w-14 sm:h-14 rounded-full shadow-lg transition-all duration-300 hover:scale-110 active:scale-95 flex items-center justify-center group z-[9999] ${className}`}
            title="Chat with AI"
        >
            <div
                className="flex gap-[6px] items-center justify-center pt-0.5 pointer-events-none"
                style={{ transform: `translate(${eyeOffset.x}px, ${eyeOffset.y}px)` }}
            >
                <div className="w-[7px] h-[14px] bg-white rounded-[50%] animate-blink"></div>
                <div className="w-[7px] h-[14px] bg-white rounded-[50%] animate-blink"></div>
            </div>
            {children}
        </button>
    );

    // Use portal to render to document.body, ensuring fixed positioning works correctly
    // regardless of parent transforms or filters
    return createPortal(buttonElement, document.body);
};
