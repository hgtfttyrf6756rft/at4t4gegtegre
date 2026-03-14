import React from 'react';

interface UpgradePromptProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  isDarkMode: boolean;
  errorMessage?: string;
}

export const UpgradePrompt: React.FC<UpgradePromptProps> = ({
  isOpen,
  onClose,
  onUpgrade,
  isDarkMode,
  errorMessage,
}) => {
  if (!isOpen) return null;

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
            <span className="text-3xl">⚡</span>
          </div>
          
          <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Usage Limit Reached
          </h3>
          
          <p className={`mb-6 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {errorMessage || 'You\'ve hit the free tier limit. Upgrade to Pro for unlimited research with premium AI models.'}
          </p>

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
              Maybe Later
            </button>
          </div>
          
          <p className={`text-xs mt-4 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            Pro includes unlimited research, premium models, and more.
          </p>
        </div>
      </div>
    </div>
  );
};
