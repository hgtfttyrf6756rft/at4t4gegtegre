import React, { useState } from 'react';
import { subscriptionService } from '../services/subscriptionService';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  trigger?: 'button' | 'error';
  initialTier?: 'pro' | 'unlimited';
}

type PriceType = 'monthly' | 'annual' | 'unlimited_monthly' | 'unlimited_annual';

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  isOpen,
  onClose,
  isDarkMode,
  trigger = 'button',
  initialTier = 'pro',
}) => {
  const [loading, setLoading] = useState<PriceType | null>(null);
  const [selectedTier, setSelectedTier] = useState<'pro' | 'unlimited'>(initialTier);

  // Sync selectedTier with initialTier when modal opens or initialTier changes
  React.useEffect(() => {
    if (isOpen) {
      setSelectedTier(initialTier);
    }
  }, [isOpen, initialTier]);

  if (!isOpen) return null;

  const handleSubscribe = async (priceType: PriceType) => {
    setLoading(priceType);
    try {
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
      setLoading(null);
    }
  };

  const platformLogos = {
    facebook: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/2021_Facebook_icon.svg.webp',
    instagram: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/Instagram_logo_2016.svg.webp',
    tiktok: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/tiktok-6338432_1280.webp',
    youtube: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/YouTube_full-color_icon_%282017%29.svg.png',
    linkedin: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/LinkedIn_logo_initials.png',
    x: 'https://I3mnKOjlTrVNlYat.public.blob.vercel-storage.com/X-Logo-Round-Color.png',
  };

  const proBenefits = [
    { icon: '💳', text: '2,500 Credits Included (renews each billing cycle)' },
    {
      icon: '📱',
      text: 'Unlimited Posts + Scheduling',
      subtext: 'All platforms',
      isPlatforms: true
    },
    { icon: '🔬', text: 'Access All AI Features' },
    { icon: '🤖', text: 'Premium AI Models (Gemini 3 Pro)' },
    { icon: '🎨', text: 'Image & Video Generation (Nano Banana Pro & Sora 2)' },
    { icon: '💾', text: 'Permanent File Storage' },
  ];

  const unlimitedBenefits = [
    { icon: '💳', text: '2,500 Credits + Unlimited Access After Credits' },
    { icon: '🔬', text: 'Unlimited Deep Research' },
    { icon: '🎨', text: 'Unlimited Image & Video Generation' },
    { icon: '🌐', text: 'Unlimited Browser Automation' },
    { icon: '🎙️', text: 'Unlimited Podcasts' },
    {
      icon: '📱',
      text: 'Unlimited Social Media Scheduling',
      subtext: 'All platforms',
      isPlatforms: true
    },
    { icon: '📧', text: 'Unlimited Email Campaigns' },
  ];

  const benefits = selectedTier === 'pro' ? proBenefits : unlimitedBenefits;

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

        {trigger === 'error' && (
          <div className={`mb-6 p-4 rounded-2xl ${isDarkMode ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-amber-50 border border-amber-200'
            }`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className={`font-semibold ${isDarkMode ? 'text-amber-400' : 'text-amber-700'}`}>
                  Usage Limit Reached
                </h3>
                <p className={`text-sm ${isDarkMode ? 'text-amber-400/80' : 'text-amber-600'}`}>
                  Upgrade to Pro or Unlimited for access to premium AI models.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-iris-500/10 to-iris-400/10 border border-iris-500/20 mb-4">
            <span className="text-lg">✨</span>
            <span className={`text-sm font-medium ${isDarkMode ? 'text-iris-400' : 'text-iris-600'}`}>
              Unlock Premium Features
            </span>
          </div>
          <h2 className={`text-3xl font-semibold mb-2 tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`} style={{ fontFamily: 'var(--font-display)' }}>
            Choose Your Plan
          </h2>
          <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Get access to advanced AI research tools
          </p>
        </div>

        {/* Tier Toggle */}
        <div className="flex justify-center mb-6">
          <div className={`inline-flex p-1 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-gray-100'}`}>
            <button
              onClick={() => setSelectedTier('pro')}
              className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${selectedTier === 'pro'
                ? isDarkMode
                  ? 'bg-[#0071e3] text-white shadow-lg'
                  : 'bg-blue-600 text-white shadow-lg'
                : isDarkMode
                  ? 'text-gray-400 hover:text-white'
                  : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              Pro
            </button>
            <button
              onClick={() => setSelectedTier('unlimited')}
              className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${selectedTier === 'unlimited'
                ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                : isDarkMode
                  ? 'text-gray-400 hover:text-white'
                  : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              Unlimited ∞
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 mb-6">
          {benefits.map((benefit, index) => (
            <div
              key={index}
              className={`flex items-start gap-3 p-4 rounded-xl border ${isDarkMode ? 'bg-white/[0.03] border-white/5' : 'bg-gray-50 border-gray-100'
                }`}
            >
              <span className="text-xl flex-shrink-0 mt-0.5">{benefit.icon}</span>
              <div className="flex-1">
                <span className={`text-[15px] font-medium leading-snug ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {benefit.text}
                </span>
                {benefit.isPlatforms && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {Object.values(platformLogos).map((logo, i) => (
                      <img
                        key={i}
                        src={logo}
                        alt="Platform"
                        className="w-5 h-5 object-contain opacity-70"
                      />
                    ))}
                  </div>
                )}
                {benefit.subtext && !benefit.isPlatforms && (
                  <div className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {benefit.subtext}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Pricing Cards */}
        {selectedTier === 'pro' ? (
          <div className="grid grid-cols-2 gap-4">
            <div className={`relative p-6 rounded-2xl border-2 transition-all ${isDarkMode
              ? 'bg-[#2c2c2e] border-[#3a3a3c] hover:border-[#0071e3]/50'
              : 'bg-gray-50 border-gray-200 hover:border-blue-300'
              }`}>
              <div className="text-center mb-4">
                <p className={`text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Monthly
                </p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    $34.99
                  </span>
                  <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>/mo</span>
                </div>
              </div>
              <button
                onClick={() => handleSubscribe('monthly')}
                disabled={loading !== null}
                className={`w-full py-3 px-4 rounded-xl font-medium transition-all ${loading === 'monthly'
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
                  } ${isDarkMode
                    ? 'bg-white/10 text-white hover:bg-white/20'
                    : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                  }`}
              >
                {loading === 'monthly' ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Processing...
                  </span>
                ) : (
                  'Subscribe Monthly'
                )}
              </button>
            </div>

            <div className={`relative p-6 rounded-2xl border-2 transition-all ${isDarkMode
              ? 'bg-gradient-to-br from-[#0071e3]/20 to-[#5e5ce6]/20 border-[#0071e3]/50'
              : 'bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-300'
              }`}>
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-[#0071e3] to-[#5e5ce6] text-white">
                  SAVE 17%
                </span>
              </div>
              <div className="text-center mb-4">
                <p className={`text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Annual
                </p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    $349
                  </span>
                  <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>/yr</span>
                </div>
                <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  ~$29.08/month
                </p>
              </div>
              <button
                onClick={() => handleSubscribe('annual')}
                disabled={loading !== null}
                className={`w-full py-3 px-4 rounded-xl font-medium transition-all ${loading === 'annual'
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
                  } bg-gradient-to-r from-iris-500 to-iris-600 text-white hover:opacity-90 shadow-lg shadow-iris-500/25`}
              >
                {loading === 'annual' ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Processing...
                  </span>
                ) : (
                  'Subscribe Annually'
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className={`relative p-6 rounded-2xl border-2 transition-all ${isDarkMode
              ? 'bg-[#2c2c2e] border-[#3a3a3c] hover:border-purple-500/50'
              : 'bg-gray-50 border-gray-200 hover:border-purple-300'
              }`}>
              <div className="text-center mb-4">
                <p className={`text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Monthly
                </p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    $79
                  </span>
                  <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>/mo</span>
                </div>
              </div>
              <button
                onClick={() => handleSubscribe('unlimited_monthly')}
                disabled={loading !== null}
                className={`w-full py-3 px-4 rounded-xl font-medium transition-all ${loading === 'unlimited_monthly'
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
                  } ${isDarkMode
                    ? 'bg-white/10 text-white hover:bg-white/20'
                    : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                  }`}
              >
                {loading === 'unlimited_monthly' ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Processing...
                  </span>
                ) : (
                  'Subscribe Monthly'
                )}
              </button>
            </div>

            <div className={`relative p-6 rounded-2xl border-2 transition-all ${isDarkMode
              ? 'bg-gradient-to-br from-purple-600/20 to-pink-600/20 border-purple-500/50'
              : 'bg-gradient-to-br from-purple-50 to-pink-50 border-purple-300'
              }`}>
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-purple-600 to-pink-600 text-white">
                  SAVE 31%
                </span>
              </div>
              <div className="text-center mb-4">
                <p className={`text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Annual
                </p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    $649.99
                  </span>
                  <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>/yr</span>
                </div>
                <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  ~$54.17/month
                </p>
              </div>
              <button
                onClick={() => handleSubscribe('unlimited_annual')}
                disabled={loading !== null}
                className={`w-full py-3 px-4 rounded-xl font-medium transition-all ${loading === 'unlimited_annual'
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
                  } bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:opacity-90 shadow-lg shadow-purple-500/25`}
              >
                {loading === 'unlimited_annual' ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Processing...
                  </span>
                ) : (
                  'Subscribe Annually'
                )}
              </button>
            </div>
          </div>
        )}

        <p className={`text-center text-xs mt-6 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          Secure payment powered by Stripe. Cancel anytime.
        </p>
      </div>
    </div >
  );
};


