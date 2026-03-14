
import React from 'react';
import { AppMode } from '../types';

interface LayoutProps {
  currentMode: AppMode;
  onModeChange: (mode: AppMode) => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ currentMode, onModeChange, children }) => {
  const navItems = [
    { mode: AppMode.BLOG_CREATOR, label: 'Blog Creator', icon: '🎙️' },
    { mode: AppMode.INSPIRATION, label: 'Research', icon: '✨' },
    { mode: AppMode.IMAGE_STUDIO, label: 'Image Tools', icon: '🎨' },
    { mode: AppMode.MOTION_LAB, label: 'Motion Lab', icon: '🎬' },
  ];

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col hidden md:flex">
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-xl font-semibold text-white tracking-tight">
            Gemini Creator
          </h1>
          <p className="text-xs text-gray-500 mt-1">Voice-Powered Studio</p>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => (
            <button
              key={item.mode}
              onClick={() => onModeChange(item.mode)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                currentMode === item.mode
                  ? 'bg-primary-600/10 text-primary-400 border border-primary-600/20'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-800">
          <div className="text-xs text-gray-600 text-center">
            &copy; 2024 Creative Studio
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Mobile Header */}
        <div className="md:hidden bg-gray-900 border-b border-gray-800 p-4 flex justify-between items-center z-20">
             <h1 className="text-lg font-bold text-white">Gemini Creator</h1>
             <div className="flex gap-2">
               {navItems.map(item => (
                 <button 
                   key={item.mode} 
                   onClick={() => onModeChange(item.mode)}
                   className={`p-2 rounded-lg ${currentMode === item.mode ? 'bg-primary-600 text-white' : 'bg-gray-800 text-gray-400'}`}
                 >
                   {item.icon}
                 </button>
               ))}
             </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-gray-900 via-gray-950 to-gray-950">
          <div className="max-w-7xl mx-auto p-4 md:p-8 h-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};
