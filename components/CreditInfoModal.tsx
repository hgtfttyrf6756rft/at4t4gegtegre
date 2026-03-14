import React from 'react';
import { CREDIT_COSTS, getOperationDisplayName, CreditOperation } from '../services/creditService';
import { useSubscription } from '../hooks/useSubscription';
import { subscriptionService } from '../services/subscriptionService';
import { useState } from 'react';

interface CreditInfoModalProps {
    isOpen: boolean;
    onClose: () => void;
    isDarkMode: boolean;
    currentCredits: number;
}

export const CreditInfoModal: React.FC<CreditInfoModalProps> = ({
    isOpen,
    onClose,
    isDarkMode,
    currentCredits,
}) => {
    const { isSubscribed, subscription } = useSubscription();
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    const costGroups: Record<string, CreditOperation[]> = {
        'Core': ['seoSearch', 'aiDocEdit', 'aiTableEdit'],
        'Generation': ['websiteGeneration', 'formGeneration', 'blogGeneration', 'tableGeneration', 'docGeneration'],
        'Media': ['imageGenerationFast', 'imageGenerationPro', 'videoClipGeneration', 'videoOverviewGeneration', 'podcastShort', 'podcastMedium', 'podcastLong'],
        'Advanced': ['researchSession', 'magicProjectGeneration', 'bookGeneration']
    };

    const handleSubscribe = async () => {
        if (loading) return;
        setLoading(true);
        try {
            // If already subscribed to Pro, upgrade to Unlimited
            // Otherwise subscribe to Pro
            const priceType = isSubscribed && subscription?.subscriptionTier === 'pro'
                ? 'unlimited_monthly'
                : 'monthly';

            const checkoutUrl = await subscriptionService.createCheckoutSession(priceType);
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

    const showUpgrade = !isSubscribed || (isSubscribed && subscription?.subscriptionTier === 'pro');
    const isUpgradeToUnlimited = isSubscribed && subscription?.subscriptionTier === 'pro';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            <div className={`relative w-full max-w-2xl rounded-3xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto ${isDarkMode
                ? 'bg-[#141416] border border-white/10'
                : 'bg-white border border-gray-100'
                }`}>
                <button
                    onClick={onClose}
                    className={`absolute top-4 right-4 p-2 rounded-full transition-colors ${isDarkMode
                        ? 'text-gray-400 hover:text-white hover:bg-white/10'
                        : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="text-center mb-8">
                    <div className={`w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-honey-500/10' : 'bg-honey-50'
                        }`}>
                        <span className="text-3xl">💳</span>
                    </div>
                    <h2 className={`text-3xl font-semibold mb-2 tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`} style={{ fontFamily: 'var(--font-display)' }}>
                        Your Credits
                    </h2>
                    <div className={`text-5xl font-bold mb-2 ${isDarkMode ? 'text-honey-400' : 'text-honey-600'}`}>
                        {currentCredits.toLocaleString()}
                    </div>
                    <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {isSubscribed
                            ? (isUpgradeToUnlimited
                                ? 'Pro Plan Active. Upgrade to Unlimited for unlimited AI generation.'
                                : 'Unlimited Plan Active: Enjoy unlimited credits and features.')
                            : 'Upgrade to Pro to get 2,500 credits monthly and unlimited social posting.'}
                    </p>
                </div>

                {showUpgrade && (
                    <div className={`mb-8 p-6 rounded-2xl border ${isDarkMode
                        ? 'bg-gradient-to-br from-iris-900/20 to-iris-800/10 border-iris-500/20'
                        : 'bg-gradient-to-br from-iris-50 to-white border-iris-100'
                        }`}>
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                            <div>
                                <h3 className={`font-semibold text-lg mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                    {isUpgradeToUnlimited ? 'Go Unlimited?' : 'Need more credits?'}
                                </h3>
                                <p className={`text-[15px] ${isDarkMode ? 'text-iris-300' : 'text-iris-700'}`}>
                                    {isUpgradeToUnlimited
                                        ? <span>Upgrade to <strong>Unlimited</strong> for unlimited AI generation and all features.</span>
                                        : <span>Subscribe to Pro and get <strong>2,500 credits</strong> instantly, plus <strong>Unlimited Social Posting & Scheduling</strong> to all platforms.</span>
                                    }
                                </p>
                            </div>
                            <button
                                onClick={handleSubscribe}
                                disabled={loading}
                                className={`whitespace-nowrap px-6 py-3 rounded-xl font-medium bg-gradient-to-r ${isUpgradeToUnlimited
                                    ? 'from-purple-600 to-pink-600 shadow-purple-500/25'
                                    : 'from-iris-500 to-iris-600 shadow-iris-500/25'
                                    } text-white shadow-lg active:scale-95 transition-all disabled:opacity-70 disabled:cursor-not-allowed`}
                            >
                                {loading ? 'Loading...' : (isUpgradeToUnlimited ? 'Upgrade to Unlimited' : 'Upgrade to Pro')}
                            </button>
                        </div>
                    </div>
                )}

                <h3 className={`font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    Credit Costs
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {Object.entries(costGroups).map(([group, ops]) => (
                        <div key={group} className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'
                            }`}>
                            <h4 className={`text-sm font-medium mb-3 uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                                }`}>
                                {group}
                            </h4>
                            <div className="space-y-2">
                                {ops.map(op => (
                                    <div key={op} className="flex justify-between items-center text-sm">
                                        <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                                            {getOperationDisplayName(op as CreditOperation)}
                                        </span>
                                        <span className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                                            }`}>
                                            {op === 'videoOverviewGeneration'
                                                ? `${CREDIT_COSTS[op as CreditOperation]} / slide`
                                                : CREDIT_COSTS[op as CreditOperation]}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <h3 className={`font-semibold mt-8 mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    Posting Limits
                </h3>
                <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                        <div>
                            <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Free Tier</h4>
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-green-500">✓</span>
                                    <span className={`text-[13px] ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>3 direct posts per day</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-red-500">✕</span>
                                    <span className={`text-[13px] ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Post Scheduling</span>
                                </div>
                            </div>
                        </div>
                        <div>
                            <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`}>Pro Tier</h4>
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-green-500">✓</span>
                                    <span className={`text-[13px] font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>Unlimited direct posts</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-green-500">✓</span>
                                    <span className={`text-[13px] font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>Unlimited scheduling</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
