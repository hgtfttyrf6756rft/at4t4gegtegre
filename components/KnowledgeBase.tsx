import React, { useState, useRef } from 'react';
import { ResearchProject, KnowledgeBaseFile, SavedResearch } from '../types';
import { storageService } from '../services/storageService';
import { analyzeDocument, indexKnowledgeBaseFileToFileSearch } from '../services/geminiService';

interface KnowledgeBaseProps {
  project: ResearchProject;
  onProjectUpdate: (project: ResearchProject) => void;
  isDarkMode: boolean;
}

type FileCategory = 'all' | 'project' | 'research';

export const KnowledgeBase: React.FC<KnowledgeBaseProps> = ({
  project,
  onProjectUpdate,
  isDarkMode
}) => {
  const [uploading, setUploading] = useState(false);
  const [analyzingFile, setAnalyzingFile] = useState<string | null>(null);
  const [indexingFileId, setIndexingFileId] = useState<string | null>(null);
  const [indexingError, setIndexingError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<FileCategory>('all');
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectFiles = project.knowledgeBase || [];
  const researchFiles: (KnowledgeBaseFile & { researchTopic?: string })[] = [];
  
  project.researchSessions.forEach(session => {
    if (session.uploadedFiles) {
      session.uploadedFiles.forEach(file => {
        researchFiles.push({
          ...file,
          researchTopic: session.topic
        });
      });
    }
  });

  const allFiles = [...projectFiles, ...researchFiles].sort((a, b) => b.uploadedAt - a.uploadedAt);

  const displayedFiles = activeCategory === 'all' 
    ? allFiles 
    : activeCategory === 'project' 
      ? projectFiles 
      : researchFiles;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setUploading(true);
    
    try {
      const uploadedFiles: KnowledgeBaseFile[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const uploadedFile = await storageService.uploadKnowledgeBaseFile(project.id, file);
        
        setAnalyzingFile(file.name);
        try {
          const analysis = await analyzeDocument(file);
          uploadedFile.summary = analysis.substring(0, 500);
          uploadedFile.extractedText = analysis;
        } catch (e) {
          console.error('Failed to analyze file:', e);
        }
        
        uploadedFiles.push(uploadedFile);
      }
      
      const updatedKnowledgeBase = [...projectFiles, ...uploadedFiles];
      const updatedProject = {
        ...project,
        knowledgeBase: updatedKnowledgeBase,
        lastModified: Date.now()
      };

      await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
      onProjectUpdate(updatedProject);
      
    } catch (error) {
      console.error('Failed to upload files:', error);
      alert('Failed to upload files. Please try again.');
    } finally {
      setUploading(false);
      setAnalyzingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleIndexForSearch = async (file: KnowledgeBaseFile) => {
    if (!file || !file.url) return;
    if (indexingFileId) return;

    setIndexingFileId(file.id);
    setIndexingError(null);

    try {
      const response = await fetch(file.url);
      if (!response.ok) {
        throw new Error(`Failed to download file (${response.status})`);
      }
      const blob = await response.blob();

      const result = await indexKnowledgeBaseFileToFileSearch({
        projectId: project.id,
        kbFileId: file.id,
        displayName: file.name,
        mimeType: file.type,
        file: blob,
      });

      const updatedFile: KnowledgeBaseFile = {
        ...file,
        fileSearchDocumentName: result.documentName || file.fileSearchDocumentName,
        fileSearchIndexedAt: Date.now(),
        fileSearchIndexError: undefined,
      };

      if (file.researchSessionId) {
        const session = project.researchSessions.find(s => s.id === file.researchSessionId);
        if (!session) throw new Error('Research session not found for this file.');
        const updatedFiles = (session.uploadedFiles || []).map(f => (f.id === file.id ? updatedFile : f));
        await storageService.updateResearchSession(project.id, session.id, { uploadedFiles: updatedFiles });

        const updatedSessions = project.researchSessions.map(s =>
          s.id === session.id ? { ...s, uploadedFiles: updatedFiles, lastModified: Date.now() } : s
        );
        onProjectUpdate({
          ...project,
          researchSessions: updatedSessions,
          lastModified: Date.now(),
        });
      } else {
        const updatedKnowledgeBase = (project.knowledgeBase || []).map(f => (f.id === file.id ? updatedFile : f));
        await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
        onProjectUpdate({
          ...project,
          knowledgeBase: updatedKnowledgeBase,
          lastModified: Date.now(),
        });
      }
    } catch (e: any) {
      const message = String(e?.message || e);
      setIndexingError(message);
      try {
        const updatedFile: KnowledgeBaseFile = {
          ...file,
          fileSearchIndexError: message,
        };

        if (file.researchSessionId) {
          const session = project.researchSessions.find(s => s.id === file.researchSessionId);
          if (session) {
            const updatedFiles = (session.uploadedFiles || []).map(f => (f.id === file.id ? updatedFile : f));
            await storageService.updateResearchSession(project.id, session.id, { uploadedFiles: updatedFiles });
            const updatedSessions = project.researchSessions.map(s =>
              s.id === session.id ? { ...s, uploadedFiles: updatedFiles, lastModified: Date.now() } : s
            );
            onProjectUpdate({
              ...project,
              researchSessions: updatedSessions,
              lastModified: Date.now(),
            });
          }
        } else {
          const updatedKnowledgeBase = (project.knowledgeBase || []).map(f => (f.id === file.id ? updatedFile : f));
          await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
          onProjectUpdate({
            ...project,
            knowledgeBase: updatedKnowledgeBase,
            lastModified: Date.now(),
          });
        }
      } catch (persistError) {
        console.error('Failed to persist KB File Search indexing error', persistError);
      }
    } finally {
      setIndexingFileId(null);
    }
  };

  const handleDeleteFile = async (file: KnowledgeBaseFile) => {
    if (!confirm(`Delete "${file.name}"?`)) return;
    
    try {
      await storageService.deleteKnowledgeBaseFile(project.id, file);
      
      if (file.researchSessionId) {
        const session = project.researchSessions.find(s => s.id === file.researchSessionId);
        if (session) {
          const updatedFiles = (session.uploadedFiles || []).filter(f => f.id !== file.id);
          await storageService.updateResearchSession(project.id, session.id, { uploadedFiles: updatedFiles });
          
          const updatedSessions = project.researchSessions.map(s => 
            s.id === file.researchSessionId ? { ...s, uploadedFiles: updatedFiles } : s
          );
          onProjectUpdate({ ...project, researchSessions: updatedSessions, lastModified: Date.now() });
        }
      } else {
        const updatedKnowledgeBase = projectFiles.filter(f => f.id !== file.id);
        await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });
        onProjectUpdate({ ...project, knowledgeBase: updatedKnowledgeBase, lastModified: Date.now() });
      }
    } catch (error) {
      console.error('Failed to delete file:', error);
      alert('Failed to delete file. Please try again.');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) {
      return (
        <svg className="w-5 h-5 text-[#bf5af2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    }
    if (type === 'application/pdf') {
      return (
        <svg className="w-5 h-5 text-[#ff453a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    }
    if (type.startsWith('video/')) {
      return (
        <svg className="w-5 h-5 text-[#0071e3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5 text-[#86868b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Knowledge Base</h3>
          <p className="text-sm text-[#86868b] mt-1">
            Files uploaded here are available to all future research agents
          </p>
        </div>
        
        <div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.doc,.docx,.mp4,.mpeg,.mov,.avi"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-full font-medium transition-all text-sm disabled:opacity-50 active:scale-[0.98]"
          >
            {uploading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {analyzingFile ? `Analyzing...` : 'Uploading...'}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload Files
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {(['all', 'project', 'research'] as FileCategory[]).map(category => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
              activeCategory === category
                ? 'bg-[#0071e3] text-white'
                : 'bg-[#2d2d2f] text-[#86868b] hover:text-white hover:bg-[#3d3d3f]'
            }`}
          >
            {category === 'all' ? `All (${allFiles.length})` : 
             category === 'project' ? `Project (${projectFiles.length})` :
             `Research (${researchFiles.length})`}
          </button>
        ))}
      </div>

      {displayedFiles.length === 0 ? (
        <div className="bg-[#1d1d1f] border border-[#3d3d3f]/50 rounded-2xl sm:rounded-3xl p-8 sm:p-12 text-center">
          <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto bg-[#2d2d2f] rounded-2xl flex items-center justify-center mb-4">
            <svg className="w-7 h-7 sm:w-8 sm:h-8 text-[#424245]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          </div>
          <h4 className="text-white font-medium mb-2">No files yet</h4>
          <p className="text-[#86868b] text-sm max-w-md mx-auto">
            Upload PDFs, images, documents, or videos. AI will extract content and make it available to research agents.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {displayedFiles.map(file => (
            <div
              key={file.id}
              className="bg-[#1d1d1f] border border-[#3d3d3f]/50 rounded-xl sm:rounded-2xl p-4 hover:border-[#0071e3]/30 transition-colors group"
            >
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-[#2d2d2f] rounded-xl flex items-center justify-center">
                  {getFileIcon(file.type)}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-medium text-white truncate text-sm sm:text-base">{file.name}</h4>
                    {file.researchSessionId ? (
                      <span className="px-2 py-0.5 text-[10px] sm:text-xs bg-[#5e5ce6]/20 text-[#5e5ce6] rounded-full">
                        Research
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] sm:text-xs bg-[#0071e3]/20 text-[#0071e3] rounded-full">
                        Project
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2 sm:gap-3 mt-1 text-[10px] sm:text-xs text-[#636366] flex-wrap">
                    <span>{formatFileSize(file.size)}</span>
                    <span>•</span>
                    <span>{formatDate(file.uploadedAt)}</span>
                    {'researchTopic' in file && (file as any).researchTopic && (
                      <>
                        <span className="hidden sm:inline">•</span>
                        <span className="text-[#5e5ce6] hidden sm:inline">{String((file as any).researchTopic)}</span>
                      </>
                    )}
                  </div>
                  
                  {file.summary && (
                    <div className="mt-2">
                      <button
                        onClick={() => setExpandedFile(expandedFile === file.id ? null : file.id)}
                        className="text-xs text-[#0071e3] hover:text-[#0077ed] flex items-center gap-1 transition-colors"
                      >
                        <svg className={`w-3 h-3 transition-transform ${expandedFile === file.id ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        {expandedFile === file.id ? 'Hide' : 'Show'} AI Summary
                      </button>
                      {expandedFile === file.id && (
                        <p className="mt-2 text-xs sm:text-sm text-[#86868b] bg-[#2d2d2f] rounded-xl p-3 leading-relaxed">
                          {file.summary}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-[#86868b] hover:text-white hover:bg-[#2d2d2f] rounded-xl transition-colors"
                    title="Open file"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  <button
                    onClick={() => handleIndexForSearch(file)}
                    disabled={indexingFileId === file.id}
                    className={`p-2 rounded-xl transition-colors ${indexingFileId === file.id
                      ? 'text-[#86868b] opacity-60 cursor-wait'
                      : file.fileSearchIndexedAt
                        ? 'text-green-400 hover:bg-green-400/10'
                        : 'text-[#86868b] hover:text-white hover:bg-[#2d2d2f]'
                      }`}
                    title={file.fileSearchIndexedAt ? 'Indexed for search' : 'Index for search'}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.35-5.65a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDeleteFile(file)}
                    className="p-2 text-[#86868b] hover:text-[#ff453a] hover:bg-[#ff453a]/10 rounded-xl transition-colors"
                    title="Delete file"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
              {!!file.fileSearchIndexError && (
                <div className="mt-2 text-[11px] text-red-400">
                  {file.fileSearchIndexError}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!!indexingError && (
        <div className="text-xs text-red-400">
          {indexingError}
        </div>
      )}

      <div className="bg-gradient-to-br from-[#0071e3]/10 to-[#5e5ce6]/10 border border-[#0071e3]/20 rounded-2xl p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-[#0071e3]/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-[#0071e3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <h4 className="text-sm font-medium text-white mb-1">How Knowledge Base Works</h4>
            <p className="text-xs sm:text-sm text-[#86868b] leading-relaxed">
              <strong className="text-[#0071e3]">Project files</strong> are analyzed by AI and made available to all future research sessions within this project. 
              When you start new research, the AI agent will automatically access relevant content from these files as background context.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
