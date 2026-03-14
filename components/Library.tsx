import React, { useState, useEffect, useMemo } from 'react';
import { SavedProject, SavedWebsiteVersion } from '../types';
import { storageService } from '../services/storageService';
import { signOut } from 'firebase/auth';
import { auth } from '../services/firebase';

interface LibraryProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadProject: (project: SavedProject, version?: SavedWebsiteVersion) => void;
  isDarkMode: boolean;
}

type SortOption = 'newest' | 'oldest' | 'alpha';

export const Library: React.FC<LibraryProps> = ({ isOpen, onClose, onLoadProject, isDarkMode }) => {
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  useEffect(() => {
    if (isOpen) {
      storageService.getProjects().then(projects => {
        setProjects(projects);
      }).catch(error => {
        console.error('Failed to load projects:', error);
        setProjects([]);
      });
    }
  }, [isOpen]);

  // Handle Escape key to close
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this project?')) {
      await storageService.deleteProject(id);
      const updatedProjects = await storageService.getProjects();
      setProjects(updatedProjects);
    }
  };
  
  const handleSignOut = async () => {
    try {
        await signOut(auth);
        onClose();
    } catch (e) {
        console.error(e);
    }
  };

  // 1. Extract Unique Categories
  const categories = useMemo(() => {
      const cats = new Set<string>();
      projects.forEach(p => {
          if (p.researchReport?.category) {
              cats.add(p.researchReport.category);
          } else {
              cats.add('Uncategorized');
          }
      });
      return ['All', ...Array.from(cats).sort()];
  }, [projects]);

  // 2. Filter & Sort Projects
  const displayedProjects = useMemo(() => {
      let filtered = projects;
      
      if (filterCategory !== 'All') {
          filtered = projects.filter(p => {
              const cat = p.researchReport?.category || 'Uncategorized';
              return cat === filterCategory;
          });
      }

      return filtered.sort((a, b) => {
          if (sortBy === 'newest') return b.lastModified - a.lastModified;
          if (sortBy === 'oldest') return a.lastModified - b.lastModified;
          if (sortBy === 'alpha') return a.topic.localeCompare(b.topic);
          return 0;
      });
  }, [projects, filterCategory, sortBy]);

  return (
    <div className={`fixed inset-0 z-50 flex justify-end transition-all duration-500 ${isOpen ? 'visible pointer-events-auto' : 'invisible pointer-events-none delay-200'}`}>
      {/* Backdrop: Blur removed, just dimming */}
      <div 
        className={`absolute inset-0 bg-black/40 transition-opacity duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      ></div>

      {/* Drawer: Blur added here, background set to neutral black */}
      <div className={`relative w-full max-w-md h-full shadow-2xl transition-transform duration-500 cubic-bezier(0.16, 1, 0.3, 1) flex flex-col border-l border-white/10 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      } ${
        isDarkMode ? 'bg-black/80 backdrop-blur-xl text-white' : 'bg-white/90 backdrop-blur-xl text-gray-900'
      }`}>
        <div className={`p-6 border-b ${isDarkMode ? 'border-white/10' : 'border-gray-200'} flex flex-col gap-4`}>
          <div className="flex justify-between items-center">
            <div>
                <h2 className="text-xl font-bold">Library</h2>
                <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Saved Research & Builds
                </p>
            </div>
            <div className="flex items-center gap-3">
                <button 
                    onClick={handleSignOut}
                    className="text-xs font-bold text-red-500 hover:text-red-400 transition-colors uppercase tracking-wider"
                >
                    Sign Out
                </button>
                <div className="w-px h-4 bg-gray-500/30"></div>
                <button 
                    onClick={onClose}
                    className={`p-2 rounded-full hover:bg-opacity-10 hover:bg-gray-500 transition-colors`}
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
          </div>

          {/* CONTROLS: Filter & Sort */}
          <div className="flex flex-col gap-3">
              {/* Filter Categories (Scrollable) */}
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none mask-image-right">
                  {categories.map(cat => (
                      <button
                          key={cat}
                          onClick={() => setFilterCategory(cat)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border ${
                              filterCategory === cat
                                ? (isDarkMode ? 'bg-white text-black border-white' : 'bg-black text-white border-black')
                                : (isDarkMode ? 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10' : 'bg-black/5 border-black/5 text-gray-600 hover:bg-black/10')
                          }`}
                      >
                          {cat}
                      </button>
                  ))}
              </div>

              {/* Sort Dropdown */}
              <div className="flex justify-between items-center text-xs">
                  <span className={`uppercase font-bold tracking-widest opacity-50 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      {displayedProjects.length} Projects
                  </span>
                  <div className="flex items-center gap-2">
                      <span className="opacity-50">Sort by:</span>
                      <select 
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value as SortOption)}
                          className={`bg-transparent border-none outline-none font-bold cursor-pointer ${isDarkMode ? 'text-white' : 'text-black'}`}
                      >
                          <option value="newest" className="text-black">Newest</option>
                          <option value="oldest" className="text-black">Oldest</option>
                          <option value="alpha" className="text-black">Name (A-Z)</option>
                      </select>
                  </div>
              </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {displayedProjects.length === 0 ? (
            <div className="text-center py-12 opacity-50">
              <span className="text-4xl mb-4 block">📭</span>
              <p>No projects found.</p>
              {filterCategory !== 'All' && <p className="text-xs mt-2">Try clearing the category filter.</p>}
            </div>
          ) : (
            displayedProjects.map(project => {
              const report = project.researchReport;
              if (!report) return null; // Skip projects without research reports
              
              const theme = report.theme;
              const activeTheme = theme ? (isDarkMode ? theme.dark : theme.light) : undefined;
              const category = report.category || 'Uncategorized';
              const headerImage = report.headerImageUrl;
              
              return (
              <div 
                key={project.id}
                className={`group rounded-xl border p-4 transition-all hover:shadow-lg cursor-pointer relative overflow-hidden animate-fade-in ${
                  !activeTheme ? (isDarkMode 
                    ? 'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10' 
                    : 'bg-gray-50 border-gray-200 hover:border-gray-400') : ''
                }`}
                style={activeTheme ? {
                    backgroundColor: activeTheme.surface,
                    borderColor: activeTheme.secondary,
                    color: activeTheme.text
                } : {}}
                onClick={() => onLoadProject(project)}
              >
                {/* Header Image Background with Gradient Mask */}
                {headerImage ? (
                    <div className="absolute inset-0 z-0 pointer-events-none">
                        <div 
                            className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105 opacity-50"
                            style={{ 
                                backgroundImage: `url(${headerImage})`,
                                maskImage: 'linear-gradient(to left, rgba(0,0,0,1) 0%, transparent 80%)',
                                WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,1) 0%, transparent 80%)'
                            }}
                        />
                    </div>
                ) : activeTheme && (
                    /* Fallback Decorative gradient overlay if themed and no image */
                    <div className="absolute top-0 right-0 w-32 h-32 opacity-10 rounded-bl-full pointer-events-none"
                         style={{ background: `linear-gradient(to bottom left, ${activeTheme.primary}, transparent)` }}></div>
                )}

                <div className="flex justify-between items-start mb-2 relative z-10">
                   <div className="pr-4">
                        {/* Category Tag */}
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider mb-1 opacity-70 ${
                            !activeTheme ? (isDarkMode ? 'bg-white/10 text-white' : 'bg-black/10 text-black') : ''
                        }`} style={activeTheme ? { backgroundColor: activeTheme.primary + '33', color: activeTheme.primary } : {}}>
                            {category}
                        </span>
                        <h3 className="font-semibold text-lg line-clamp-1" style={activeTheme ? { color: activeTheme.primary } : {}}>{project.topic}</h3>
                   </div>
                  <button 
                    onClick={(e) => handleDelete(e, project.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-500/10 rounded transition-all shrink-0"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </button>
                </div>
                
                <div className={`text-xs mb-3 ${!activeTheme ? (isDarkMode ? 'text-gray-400' : 'text-gray-500') : ''}`}
                     style={activeTheme ? { color: activeTheme.text, opacity: 0.7 } : {}}
                >
                  Updated: {new Date(project.lastModified).toLocaleDateString()}
                </div>

                <div className="space-y-2 relative z-10">
                  {project.websiteVersions.length > 0 && (
                     <div className={`space-y-1 mt-2 border-t pt-2 ${!activeTheme ? 'border-gray-700/30' : ''}`}
                          style={activeTheme ? { borderColor: activeTheme.secondary + '44' } : {}}
                     >
                        <p className="text-[10px] uppercase font-bold opacity-50">Website Versions</p>
                        <div className="flex flex-wrap gap-2">
                            {project.websiteVersions.map((v, i) => (
                                <button
                                    key={v.id}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onLoadProject(project, v);
                                    }}
                                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                                        !activeTheme ? (isDarkMode 
                                        ? 'bg-white/10 border-white/20 hover:bg-white/20' 
                                        : 'bg-white border-gray-300 hover:bg-gray-100') : ''
                                    }`}
                                    style={activeTheme ? { 
                                        borderColor: activeTheme.secondary, 
                                        color: activeTheme.text,
                                        backgroundColor: activeTheme.background + '80'
                                    } : {}}
                                >
                                    v{project.websiteVersions.length - i}
                                </button>
                            ))}
                        </div>
                     </div>
                  )}
                </div>
              </div>
            )})
          )}
        </div>
      </div>
    </div>
  );
};