import React from 'react';
import { UsageType, getLimitDisplayName, getResetPeriod, getLimits } from '../services/usageService';

interface UsageLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  isDarkMode: boolean;
  usageType: UsageType;
  current: number;
  limit: number;
  isSubscribed: boolean;
}

export const UsageLimitModal: React.FC<UsageLimitModalProps> = ({
  isOpen,
  onClose,
  onUpgrade,
  isDarkMode,
  usageType,
  current,
  limit,
  isSubscribed,
}) => {
  if (!isOpen) return null;

  const featureName = getLimitDisplayName(usageType);
  const resetPeriod = getResetPeriod(usageType);
  const proLimits = getLimits(true);
  const proLimit = proLimits[usageType];

  const isBlocked = limit === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      <div className={`relative w-full max-w-md rounded-2xl p-6 shadow-2xl ${
        isDarkMode 
          ? 'bg-[#1c1c1e] border border-[#3a3a3c]' 
          : 'bg-white border border-gray-200'
      }`}>
        <div className="text-center">
          <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
            isDarkMode ? 'bg-amber-500/10' : 'bg-amber-50'
          }`}>
            <span className="text-3xl">{isBlocked ? '🔒' : '⚡'}</span>
          </div>
          
          <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            {isBlocked ? `${featureName} is a Pro Feature` : `${featureName} Limit Reached`}
          </h3>
          
          <p className={`mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {isBlocked 
              ? `${featureName} is only available with a Pro subscription.`
              : `You've used ${current} of ${limit} ${featureName.toLowerCase()}s this ${resetPeriod === 'daily' ? 'day' : 'month'}.`
            }
          </p>

          {!isBlocked && (
            <div className={`mb-4 p-3 rounded-lg ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className="flex justify-between text-sm mb-2">
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Usage</span>
                <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{current} / {limit}</span>
              </div>
              <div className={`h-2 rounded-full ${isDarkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
                <div 
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-red-500"
                  style={{ width: `${Math.min(100, (current / limit) * 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className={`mb-6 p-4 rounded-lg ${isDarkMode ? 'bg-purple-500/10 border border-purple-500/20' : 'bg-purple-50 border border-purple-200'}`}>
            <p className={`text-sm ${isDarkMode ? 'text-purple-300' : 'text-purple-700'}`}>
              Pro users get <strong>{proLimit}</strong> {featureName.toLowerCase()}s per {resetPeriod === 'daily' ? 'day' : 'month'}
              {!isBlocked && ` (${Math.round(proLimit / limit)}x more)`}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={onUpgrade}
              className="w-full py-3 px-4 rounded-xl font-medium bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:opacity-90 transition-opacity"
            >
              Upgrade to Pro
            </button>
            
            <button
              onClick={onClose}
              className={`w-full py-3 px-4 rounded-xl font-medium transition-colors ${
                isDarkMode
                  ? 'bg-white/10 text-white hover:bg-white/20'
                  : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
              }`}
            >
              {isBlocked ? 'Go Back' : 'Wait Until Reset'}
            </button>
          </div>
          
          {!isBlocked && (
            <p className={`text-xs mt-4 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              {resetPeriod === 'daily' ? 'Limits reset every day at midnight.' : 'Limits reset on the 1st of each month.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
