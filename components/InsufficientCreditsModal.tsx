import React, { useState } from 'react';
import { CreditOperation, CREDIT_COSTS, getOperationDisplayName } from '../services/creditService';
import { subscriptionService } from '../services/subscriptionService';

interface InsufficientCreditsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUpgrade: () => void;
    isDarkMode: boolean;
    operation: CreditOperation | null;
    currentCredits: number;
    creditsNeeded: number;
}

export const InsufficientCreditsModal: React.FC<InsufficientCreditsModalProps> = ({
    isOpen,
    onClose,
    onUpgrade,
    isDarkMode,
    operation,
    currentCredits,
    creditsNeeded,
}) => {
    const [loading, setLoading] = useState(false);

    if (!isOpen || !operation) return null;

    const operationName = getOperationDisplayName(operation);
    const deficit = creditsNeeded - currentCredits;

    const handleGetMoreCredits = async () => {
        setLoading(true);
        try {
            const checkoutUrl = await subscriptionService.createCheckoutSession('monthly');
            if (checkoutUrl) {
                window.location.href = checkoutUrl;
            } else {
                alert('Failed to start checkout. Please try again.');
            }
        } catch (error) {
            console.error('Checkout error:', error);
            alert('Failed to start checkout. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            <div className={`relative w-full max-w-md rounded-2xl p-6 shadow-2xl ${isDarkMode
                ? 'bg-[#141416] border border-white/10'
                : 'bg-white border border-gray-100'
                }`}>
                <div className="text-center">
                    {/* Icon */}
                    <div className={`w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-honey-500/10' : 'bg-honey-50'
                        }`}>
                        <span className="text-3xl">💳</span>
                    </div>

                    {/* Title */}
                    <h3 className={`text-xl font-semibold mb-2 tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`} style={{ fontFamily: 'var(--font-display)' }}>
                        Insufficient Credits
                    </h3>

                    {/* Description */}
                    <p className={`mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        You need <strong className={isDarkMode ? 'text-white' : 'text-gray-900'}>{creditsNeeded}</strong> credits for {operationName.toLowerCase()}, but you only have <strong className={isDarkMode ? 'text-white' : 'text-gray-900'}>{currentCredits}</strong>.
                    </p>

                    {/* Credit Balance Display */}
                    <div className={`mb-4 p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
                        <div className="flex justify-between items-center mb-2">
                            <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Your Balance</span>
                            <span className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{currentCredits} credits</span>
                        </div>
                        <div className="flex justify-between items-center mb-2">
                            <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Cost</span>
                            <span className={`text-lg font-bold ${isDarkMode ? 'text-honey-400' : 'text-honey-600'}`}>-{creditsNeeded} credits</span>
                        </div>
                        <div className={`border-t ${isDarkMode ? 'border-white/10' : 'border-gray-200'} pt-2 mt-2`}>
                            <div className="flex justify-between items-center">
                                <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Available Credits</span>
                                <span className="text-lg font-bold text-coral-500">+{deficit} credits</span>
                            </div>
                        </div>
                    </div>

                    {/* Upgrade CTA */}
                    <div className={`mb-6 p-4 rounded-xl ${isDarkMode ? 'bg-iris-500/10 border border-iris-500/20' : 'bg-iris-50 border border-iris-200'}`}>
                        <p className={`text-[15px] ${isDarkMode ? 'text-iris-300' : 'text-iris-700'}`}>
                            Upgrade to Pro for <strong>2,500 credits</strong>, and <strong>Unlimited Social Posting & Scheduling!</strong>
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-3">
                        <button
                            onClick={handleGetMoreCredits}
                            disabled={loading}
                            className={`w-full py-3 px-4 rounded-xl font-medium bg-gradient-to-r from-iris-500 to-iris-600 text-white hover:opacity-90 transition-opacity shadow-lg shadow-iris-500/25 ${loading ? 'opacity-50 cursor-not-allowed' : ''
                                }`}
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Processing...
                                </span>
                            ) : (
                                'Get More Credits'
                            )}
                        </button>

                        <button
                            onClick={onClose}
                            className={`w-full py-3 px-4 rounded-xl font-medium transition-colors ${isDarkMode
                                ? 'bg-white/10 text-white hover:bg-white/20'
                                : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                                }`}
                        >
                            Go Back
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

/**
 * Credit cost breakdown component for showing costs in UI
 */
export const CreditCostBadge: React.FC<{
    operation: CreditOperation;
    isDarkMode: boolean;
    size?: 'sm' | 'md';
}> = ({ operation, isDarkMode, size = 'sm' }) => {
    const cost = CREDIT_COSTS[operation];

    const sizeClasses = size === 'sm'
        ? 'text-[10px] px-1.5 py-0.5'
        : 'text-xs px-2 py-1';

    return (
        <span className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClasses} ${isDarkMode
            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            : 'bg-amber-50 text-amber-600 border border-amber-200'
            }`}>
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" />
            </svg>
            {cost} credits
        </span>
    );
};

/**
 * Display current credit balance in header/sidebar
 */
export const CreditBalanceDisplay: React.FC<{
    credits: number;
    isDarkMode: boolean;
    onClick?: () => void;
    compact?: boolean;
}> = ({ credits, isDarkMode, onClick, compact = false }) => {
    const isLow = credits < 50;

    const iconUrl = "https://jSRr1lJM4vPVantF.public.blob.vercel-storage.com/coin%20%281%29.png";

    if (compact) {
        return (
            <button
                onClick={onClick}
                className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${isDarkMode
                    ? 'bg-white/5 hover:bg-white/10 text-white'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                    }`}
            >
                <img
                    src={iconUrl}
                    alt="Credits"
                    className="w-5 h-5 object-contain animate-coin-flip"
                />
                <span key={credits} className="font-bold text-sm animate-cycle-down">
                    {credits.toLocaleString()}
                </span>
            </button>
        );
    }

    return (
        <button
            onClick={onClick}
            className={`group flex items-center gap-3 px-4 py-3 rounded-2xl transition-all ${isDarkMode
                ? 'bg-transparent hover:bg-white/10 text-white'
                : 'bg-transparent hover:bg-gray-100 text-gray-900'
                }`}
        >
            <div className="relative">
                <img
                    src={iconUrl}
                    alt="Credits"
                    className="w-8 h-8 object-contain animate-coin-flip"
                />
            </div>
            <div className="flex flex-col items-start overflow-hidden">
                <span key={credits} className="text-2xl font-bold leading-none animate-cycle-down">
                    {credits.toLocaleString()}
                </span>
                <span className={`hidden text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Available Credits
                </span>
            </div>
        </button>
    );
};


