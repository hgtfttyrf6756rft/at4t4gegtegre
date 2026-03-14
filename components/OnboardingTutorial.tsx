import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface TutorialStep {
    id: string;
    targetSelector: string;
    title: string;
    description: string;
    position: 'top' | 'bottom' | 'left' | 'right';
    icon?: React.ReactNode;
}

interface OnboardingTutorialProps {
    steps: TutorialStep[];
    isDarkMode: boolean;
    onComplete: () => void;
    storageKey?: string;
}

const STORAGE_KEY_DEFAULT = 'freshfront-onboarding-completed';

export const OnboardingTutorial: React.FC<OnboardingTutorialProps> = ({
    steps,
    isDarkMode,
    onComplete,
    storageKey = STORAGE_KEY_DEFAULT,
}) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
    const [isVisible, setIsVisible] = useState(true);

    // Find and measure target element
    const updateTargetRect = useCallback(() => {
        if (currentStep >= steps.length) return;

        const step = steps[currentStep];
        const target = document.querySelector(step.targetSelector);

        if (target) {
            const rect = target.getBoundingClientRect();
            setTargetRect(rect);
        } else {
            setTargetRect(null);
        }
    }, [currentStep, steps]);

    useEffect(() => {
        updateTargetRect();

        // Update on resize/scroll
        const handleUpdate = () => updateTargetRect();
        window.addEventListener('resize', handleUpdate);
        window.addEventListener('scroll', handleUpdate, true);

        // Poll for element availability (in case of dynamic content)
        const pollInterval = setInterval(handleUpdate, 200);

        return () => {
            window.removeEventListener('resize', handleUpdate);
            window.removeEventListener('scroll', handleUpdate, true);
            clearInterval(pollInterval);
        };
    }, [updateTargetRect]);

    const handleNext = () => {
        if (currentStep < steps.length - 1) {
            setCurrentStep(prev => prev + 1);
        } else {
            handleComplete();
        }
    };

    const handleSkip = () => {
        handleComplete();
    };

    const handleComplete = () => {
        setIsVisible(false);
        localStorage.setItem(storageKey, 'true');
        onComplete();
    };

    if (!isVisible || currentStep >= steps.length || !targetRect) {
        return null;
    }

    const step = steps[currentStep];
    const padding = 8;

    // Calculate spotlight position with padding
    const spotlightStyle = {
        left: targetRect.left - padding,
        top: targetRect.top - padding,
        width: targetRect.width + padding * 2,
        height: targetRect.height + padding * 2,
        borderRadius: '16px',
    };

    // Calculate tooltip position
    const getTooltipStyle = (): React.CSSProperties => {
        const tooltipWidth = 320;
        const tooltipMargin = 16;

        switch (step.position) {
            case 'top':
                return {
                    left: Math.max(16, Math.min(targetRect.left + targetRect.width / 2 - tooltipWidth / 2, window.innerWidth - tooltipWidth - 16)),
                    bottom: window.innerHeight - targetRect.top + tooltipMargin,
                };
            case 'bottom':
                return {
                    left: Math.max(16, Math.min(targetRect.left + targetRect.width / 2 - tooltipWidth / 2, window.innerWidth - tooltipWidth - 16)),
                    top: targetRect.bottom + tooltipMargin,
                };
            case 'left':
                return {
                    right: window.innerWidth - targetRect.left + tooltipMargin,
                    top: Math.max(16, targetRect.top + targetRect.height / 2 - 60),
                };
            case 'right':
                return {
                    left: targetRect.right + tooltipMargin,
                    top: Math.max(16, targetRect.top + targetRect.height / 2 - 60),
                };
            default:
                return {
                    left: targetRect.left,
                    top: targetRect.bottom + tooltipMargin,
                };
        }
    };

    const tooltipStyle = getTooltipStyle();

    // Arrow positioning
    const getArrowStyle = (): React.CSSProperties => {
        const arrowSize = 10;

        switch (step.position) {
            case 'top':
                return {
                    left: '50%',
                    bottom: -arrowSize,
                    transform: 'translateX(-50%) rotate(45deg)',
                };
            case 'bottom':
                return {
                    left: '50%',
                    top: -arrowSize,
                    transform: 'translateX(-50%) rotate(45deg)',
                };
            case 'left':
                return {
                    right: -arrowSize,
                    top: '50%',
                    transform: 'translateY(-50%) rotate(45deg)',
                };
            case 'right':
                return {
                    left: -arrowSize,
                    top: '50%',
                    transform: 'translateY(-50%) rotate(45deg)',
                };
            default:
                return {};
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] pointer-events-none">
            {/* Backdrop overlay with spotlight cutout */}
            <svg className="absolute inset-0 w-full h-full pointer-events-auto">
                <defs>
                    <mask id="spotlight-mask">
                        <rect x="0" y="0" width="100%" height="100%" fill="white" />
                        <rect
                            x={spotlightStyle.left}
                            y={spotlightStyle.top}
                            width={spotlightStyle.width}
                            height={spotlightStyle.height}
                            rx="16"
                            ry="16"
                            fill="black"
                        />
                    </mask>
                </defs>
                <rect
                    x="0"
                    y="0"
                    width="100%"
                    height="100%"
                    fill={isDarkMode ? 'rgba(0, 0, 0, 0.75)' : 'rgba(0, 0, 0, 0.5)'}
                    mask="url(#spotlight-mask)"
                />
            </svg>

            {/* Spotlight border glow */}
            <div
                className="absolute pointer-events-none transition-all duration-300 ease-out"
                style={{
                    ...spotlightStyle,
                    boxShadow: `0 0 0 3px ${isDarkMode ? 'rgba(0, 113, 227, 0.6)' : 'rgba(0, 113, 227, 0.5)'}, 0 0 20px rgba(0, 113, 227, 0.3)`,
                }}
            />

            {/* Tooltip card */}
            <div
                className={
                    'fixed pointer-events-auto w-80 rounded-2xl border shadow-2xl backdrop-blur-xl animate-fade-in ' +
                    (isDarkMode
                        ? 'bg-[#1c1c1e]/95 border-[#3a3a3c] text-white'
                        : 'bg-white/95 border-gray-200 text-gray-900')
                }
                style={tooltipStyle}
            >
                {/* Arrow */}
                <div
                    className={
                        'absolute w-5 h-5 ' +
                        (isDarkMode ? 'bg-[#1c1c1e] border-[#3a3a3c]' : 'bg-white border-gray-200')
                    }
                    style={{
                        ...getArrowStyle(),
                        borderRight: step.position === 'left' ? `1px solid ${isDarkMode ? '#3a3a3c' : '#e5e7eb'}` : 'none',
                        borderBottom: step.position === 'left' || step.position === 'top' ? `1px solid ${isDarkMode ? '#3a3a3c' : '#e5e7eb'}` : 'none',
                        borderLeft: step.position === 'right' ? `1px solid ${isDarkMode ? '#3a3a3c' : '#e5e7eb'}` : 'none',
                        borderTop: step.position === 'right' || step.position === 'bottom' ? `1px solid ${isDarkMode ? '#3a3a3c' : '#e5e7eb'}` : 'none',
                    }}
                />

                {/* Content */}
                <div className="p-5">
                    {/* Step indicator */}
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-1.5">
                            {steps.map((_, index) => (
                                <div
                                    key={index}
                                    className={
                                        'w-2 h-2 rounded-full transition-all duration-200 ' +
                                        (index === currentStep
                                            ? 'bg-[#0071e3] w-6'
                                            : index < currentStep
                                                ? 'bg-[#0071e3]/50'
                                                : isDarkMode
                                                    ? 'bg-[#3a3a3c]'
                                                    : 'bg-gray-300')
                                    }
                                />
                            ))}
                        </div>
                        <span className={'text-xs font-medium ' + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                            {currentStep + 1} of {steps.length}
                        </span>
                    </div>

                    {/* Icon */}
                    {step.icon && (
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[#0071e3]/10 text-[#0071e3] mb-4">
                            {step.icon}
                        </div>
                    )}

                    {/* Title & Description */}
                    <h3 className={'text-lg font-semibold mb-2 ' + (isDarkMode ? 'text-white' : 'text-gray-900')}>
                        {step.title}
                    </h3>
                    <p className={'text-sm leading-relaxed ' + (isDarkMode ? 'text-[#86868b]' : 'text-gray-600')}>
                        {step.description}
                    </p>

                    {/* Actions */}
                    <div className="flex items-center justify-between mt-5 pt-4 border-t" style={{ borderColor: isDarkMode ? '#3a3a3c' : '#e5e7eb' }}>
                        <button
                            onClick={handleSkip}
                            className={
                                'text-sm font-medium transition-colors ' +
                                (isDarkMode ? 'text-[#86868b] hover:text-white' : 'text-gray-500 hover:text-gray-900')
                            }
                        >
                            Skip tour
                        </button>
                        <button
                            onClick={handleNext}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-medium transition-all active:scale-[0.98]"
                        >
                            <span>{currentStep === steps.length - 1 ? 'Get started' : 'Next'}</span>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

// Hook to check if tutorial should be shown
export const useShouldShowTutorial = (storageKey = STORAGE_KEY_DEFAULT): boolean => {
    const [shouldShow, setShouldShow] = useState(false);

    useEffect(() => {
        const completed = localStorage.getItem(storageKey);
        setShouldShow(completed !== 'true');
    }, [storageKey]);

    return shouldShow;
};

// Helper to reset tutorial (for testing)
export const resetTutorial = (storageKey = STORAGE_KEY_DEFAULT): void => {
    localStorage.removeItem(storageKey);
};

export default OnboardingTutorial;
