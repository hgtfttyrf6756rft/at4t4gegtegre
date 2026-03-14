import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { createPortal } from 'react-dom';
import { ProjectNote, ResearchProject, NoteTermDefinition } from '../types';
import { storageService } from '../services/storageService';
import { suggestNoteEnhancements, generateQuickNote, generateTextToSpeech, ai } from '../services/geminiService';
import { deductCredits } from '../services/creditService';
import { logProjectActivity, auth } from '../services/firebase';


import { OnlineUser } from '../hooks/usePresence';

interface NotesPanelProps {
  project: ResearchProject;
  onProjectUpdate: (project: ResearchProject) => void;
  isDarkMode?: boolean;
  readOnly?: boolean;
  autoOpenNewNote?: boolean;
  initialNoteId?: string | null;
  onOpenNoteMap?: () => void;
  updateFocus?: (itemId: string | null, itemType: 'note' | 'task' | 'file' | null) => void;
  onlineCollaborators?: OnlineUser[];
}

const NOTE_COLORS = [
  { id: 'default', color: 'bg-slate-700', border: 'border-slate-600' },
  { id: 'blue', color: 'bg-blue-900/50', border: 'border-blue-700/50' },
  { id: 'green', color: 'bg-emerald-900/50', border: 'border-emerald-700/50' },
  { id: 'yellow', color: 'bg-amber-900/50', border: 'border-amber-700/50' },
  { id: 'pink', color: 'bg-pink-900/50', border: 'border-pink-700/50' },
  { id: 'purple', color: 'bg-violet-900/50', border: 'border-violet-700/50' }
];

export const NotesPanel: React.FC<NotesPanelProps> = ({
  project,
  onProjectUpdate,
  isDarkMode = true,
  readOnly = false,
  autoOpenNewNote = false,
  initialNoteId = null,
  onOpenNoteMap,
  updateFocus,
  onlineCollaborators = [],
}) => {
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [selectedColor, setSelectedColor] = useState('default');
  const [editingNote, setEditingNote] = useState<ProjectNote | null>(null);
  const [viewingNote, setViewingNote] = useState<ProjectNote | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isGeneratingNote, setIsGeneratingNote] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [showAiInput, setShowAiInput] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [activeDefinition, setActiveDefinition] = useState<NoteTermDefinition | null>(null);

  const contentRef = useRef<HTMLParagraphElement | null>(null);

  const newNoteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Inline AI Ask state
  const [inlineAskOpen, setInlineAskOpen] = useState(false);
  const [inlineAskPosition, setInlineAskPosition] = useState({ x: 0, y: 0 });
  const [inlineAskSelectedText, setInlineAskSelectedText] = useState('');
  const [inlineAskPrompt, setInlineAskPrompt] = useState('');
  const [inlineAskLoading, setInlineAskLoading] = useState(false);
  const [inlineAskResponse, setInlineAskResponse] = useState('');
  const inlineAskInputRef = useRef<HTMLInputElement | null>(null);

  // Draggable State
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Audio State
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlayAudio = async (text: string) => {
    if (isPlayingAudio) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setIsPlayingAudio(false);
      return;
    }

    if (!text || audioLoading) return;

    setAudioLoading(true);
    try {
      // Deduct credits for TTS
      const creditSuccess = await deductCredits('audioGeneration'); // Assuming 'audioGeneration' or fallback to a standard cost
      if (!creditSuccess) {
        console.warn('Insufficient credits for audio generation');
        // Fallback or notify user (optional enhancement)
      }

      const audioData = await generateTextToSpeech(text);
      if (audioData) {
        const byteCharacters = atob(audioData);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);

        if (audioRef.current) {
          audioRef.current.pause();
        }

        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => setIsPlayingAudio(false);
        audio.play();
        setIsPlayingAudio(true);
      }
    } catch (error) {
      console.error('Failed to play audio:', error);
    } finally {
      setAudioLoading(false);
    }
  };

  // Cleanup audio on unmount or node change
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      setInlineAskPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).closest('.inline-ask-popover')?.getBoundingClientRect();
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
      setIsDragging(true);
    }
  };

  const notes = useMemo(() => {
    const standardNotes = project.notes || [];
    const mapNodes = project.projectNoteMapState || [];
    const convertedMapNotes = mapNodes
      .filter(n => n.type === 'note')
      .map(n => ({
        id: n.id,
        title: n.title,
        content: n.content,
        createdAt: n.createdAt || project.createdAt,
        lastModified: n.lastModified || project.createdAt,
        color: n.color,
        imageUrl: n.imageUrl,
        videoUrl: n.videoUrl,
        audioUrl: n.audioUrl,
        fileUrl: n.fileUrl,
        youtubeVideoId: n.youtubeVideoId,
        pinned: false,
        // Add a flag to distinguish map notes if needed
        isFromMap: true,
      } as ProjectNote & { isFromMap: boolean }));

    return [...standardNotes, ...convertedMapNotes].sort((a, b) => b.lastModified - a.lastModified);
  }, [project.notes, project.projectNoteMapState, project.createdAt]);

  const isReadOnly = !!readOnly;
  const pinnedNotes = notes.filter(n => n.pinned);
  const regularNotes = notes.filter(n => !n.pinned);

  useEffect(() => {
    if (isReadOnly) {
      setShowAiInput(false);
      setIsAddingNote(false);
      setEditingNote(null);
    }
  }, [isReadOnly]);

  useEffect(() => {
    if (autoOpenNewNote && !isReadOnly) {
      setShowAiInput(false);
      setViewingNote(null);
      setEditingNote(null);
      setIsAddingNote(true);
    }
  }, [autoOpenNewNote, isReadOnly]);

  useEffect(() => {
    if (initialNoteId) {
      const note = notes.find(n => n.id === initialNoteId);
      if (note) {
        setViewingNote(note);
        setEditingNote(null);
        // Wait for state update/render then scroll
        setTimeout(() => {
          const element = document.getElementById(`note-${initialNoteId}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
            setTimeout(() => element.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2'), 3000);
          }
        }, 100);
      }
    }
  }, [initialNoteId, notes]);

  useEffect(() => {
    if (!newNoteTextareaRef.current) return;
    const textarea = newNoteTextareaRef.current;
    textarea.style.height = 'auto';
    const maxHeight = 800;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [newNoteContent]);

  const handleAddNote = async () => {
    if (isReadOnly || !newNoteTitle.trim()) return;

    const newNote = await storageService.addNote(project.id, {
      title: newNoteTitle.trim(),
      content: newNoteContent,
      color: selectedColor,
      pinned: false
    });
    const standardNotes = project.notes || [];
    onProjectUpdate({ ...project, notes: [...standardNotes, newNote] });
    setNewNoteTitle('');
    setNewNoteContent('');
    setSelectedColor('default');
    setIsAddingNote(false);

    await logProjectActivity(project.ownerUid, project.id, {
      type: 'note_added',
      description: `added note "${newNote.title}"`,
      actorUid: auth.currentUser?.uid || 'unknown',
      actorName: auth.currentUser?.displayName || 'Unknown',
      actorPhoto: auth.currentUser?.photoURL || undefined,
      metadata: { noteId: newNote.id }
    });
  };

  const handleUpdateNote = async (noteId: string, updates: Partial<ProjectNote>) => {
    if (isReadOnly) return;
    await storageService.updateNote(project.id, noteId, updates);
    const standardNotes = project.notes || [];
    onProjectUpdate({
      ...project,
      notes: standardNotes.map(n => n.id === noteId ? { ...n, ...updates } : n)
    });
    if (editingNote?.id === noteId) setEditingNote(null);
    if (viewingNote?.id === noteId) setViewingNote({ ...viewingNote, ...updates });

    const noteTitle = standardNotes.find(n => n.id === noteId)?.title || 'note';
    const isPin = 'pinned' in updates && Object.keys(updates).length === 1;

    await logProjectActivity(project.ownerUid, project.id, {
      type: 'note_updated',
      description: isPin
        ? `${updates.pinned ? 'pinned' : 'unpinned'} note "${noteTitle}"`
        : `updated note "${noteTitle}"`,
      actorUid: auth.currentUser?.uid || 'unknown',
      actorName: auth.currentUser?.displayName || 'Unknown',
      actorPhoto: auth.currentUser?.photoURL || undefined,
      metadata: { noteId, isPin }
    });
  };

  const handleDeleteNote = async (noteId: string) => {
    if (isReadOnly) return;
    await storageService.deleteNote(project.id, noteId);
    const standardNotes = project.notes || [];
    const noteTitle = standardNotes.find(n => n.id === noteId)?.title || 'note';
    onProjectUpdate({ ...project, notes: standardNotes.filter(n => n.id !== noteId) });
    setViewingNote(null);

    await logProjectActivity(project.ownerUid, project.id, {
      type: 'project_updated',
      description: `deleted note "${noteTitle}"`,
      actorUid: auth.currentUser?.uid || 'unknown',
      actorName: auth.currentUser?.displayName || 'Unknown',
      actorPhoto: auth.currentUser?.photoURL || undefined,
      metadata: { noteId }
    });
  };

  const handleTogglePin = async (note: ProjectNote) => {
    if (isReadOnly) return;
    await handleUpdateNote(note.id, { pinned: !note.pinned });
  };

  const handleGenerateNote = async () => {
    if (isReadOnly || !aiPrompt.trim()) return;

    setIsGeneratingNote(true);
    try {
      // Deduct credits for quick note generation
      const creditSuccess = await deductCredits('quickNoteGeneration');
      if (!creditSuccess) {
        console.warn('Insufficient credits for quick note generation');
        setIsGeneratingNote(false);
        return;
      }

      const generated = await generateQuickNote(project.name, project.description, aiPrompt);
      if (generated) {
        const newNote = await storageService.addNote(project.id, {
          title: generated.title,
          content: generated.content,
          color: 'purple',
          pinned: false,
          aiGenerated: true
        });
        onProjectUpdate({ ...project, notes: [...notes, newNote] });
        setAiPrompt('');
        setShowAiInput(false);
      }
    } catch (error) {
      console.error('Failed to generate note:', error);
    }
    setIsGeneratingNote(false);
  };

  const handleGetSuggestions = async (note: ProjectNote) => {
    if (isReadOnly || !note.content || note.content.length < 10) return;

    setLoadingSuggestions(true);
    try {
      // Deduct credits for note enhancement suggestions
      const creditSuccess = await deductCredits('noteEnhancement');
      if (!creditSuccess) {
        console.warn('Insufficient credits for note enhancement');
        setLoadingSuggestions(false);
        return;
      }

      const suggestions = await suggestNoteEnhancements(note.content, project.description);
      setAiSuggestions(suggestions);
    } catch (error) {
      console.error('Failed to get suggestions:', error);
    }
    setLoadingSuggestions(false);
  };

  const handleApplySuggestion = async (suggestion: string) => {
    if (isReadOnly || !suggestion.trim()) return;

    try {
      // Deduct credits for applying suggestion as note
      const creditSuccess = await deductCredits('quickNoteGeneration');
      if (!creditSuccess) {
        console.warn('Insufficient credits to apply suggestion');
        return;
      }

      const generated = await generateQuickNote(project.name, project.description, suggestion);
      if (!generated) return;

      const color = viewingNote?.color || 'purple';

      const newNote = await storageService.addNote(project.id, {
        title: generated.title,
        content: generated.content,
        color,
        pinned: false,
        aiGenerated: true,
      });

      onProjectUpdate({
        ...project,
        notes: [...notes, newNote],
      });
    } catch (error) {
      console.error('Failed to apply AI suggestion as new note:', error);
    }
  };



  // Inline AI Ask - Handle text selection
  const handleNoteContentMouseUp = useCallback((e: React.MouseEvent) => {
    const isEditing = editingNote && viewingNote && editingNote.id === viewingNote.id;
    if (isReadOnly || !viewingNote || isEditing) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length < 2) {
      return;
    }

    // Check if selection is within the content area
    if (selection.rangeCount > 0 && contentRef.current) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer as Node;
      const element = container instanceof Element ? container : container.parentElement;
      if (!element || !contentRef.current.contains(element)) {
        return;
      }
    }

    // Get position for popover
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    setInlineAskSelectedText(selectedText);
    setInlineAskPosition({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 8
    });
    setInlineAskOpen(true);
    setInlineAskPrompt('');
    setInlineAskResponse('');

    // Focus the input after a short delay
    setTimeout(() => {
      inlineAskInputRef.current?.focus();
    }, 50);
  }, [isReadOnly, viewingNote, editingNote]);

  // Inline AI Ask - Handle AI query
  const handleInlineAsk = async () => {
    if (!inlineAskPrompt.trim() || !viewingNote || inlineAskLoading) return;

    setInlineAskLoading(true);
    setInlineAskResponse('');

    try {
      // Deduct credit for inline AI ask
      const creditSuccess = await deductCredits('inlineAiAsk');
      if (!creditSuccess) {
        setInlineAskResponse('Insufficient credits. Please upgrade to continue.');
        setInlineAskLoading(false);
        return;
      }

      const projectContext = `Project: ${project.name}\nDescription: ${project.description || 'None'}\n${project.researchSessions?.length ? `Research Sessions: ${project.researchSessions.map(s => s.topic).join(', ')}` : ''}`;
      const noteContext = `Note Title: ${viewingNote.title}\nNote Content: ${viewingNote.content}`;

      const systemInstruction = `You are an AI assistant helping analyze text within a note.
Your goal is to answer the user's question about the selected text using the note and project context.

Project Context:
${projectContext}

Note Context:
${noteContext}

Selected Text:
"${inlineAskSelectedText}"`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{
          role: 'user',
          parts: [{ text: inlineAskPrompt }]
        }],
        config: {
          systemInstruction,
          thinkingConfig: {
            thinkingLevel: "medium" as any,
          }
        }
      });

      setInlineAskResponse(response.text || 'No response generated.');
    } catch (error: any) {
      console.error('Inline AI Ask error:', error);
      setInlineAskResponse(`Error: ${error.message || 'Failed to get response'}`);
    } finally {
      setInlineAskLoading(false);
    }
  };

  // Close inline ask popover when clicking outside
  useEffect(() => {
    if (!inlineAskOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('.inline-ask-popover')) {
        setInlineAskOpen(false);
        setInlineAskPrompt('');
        setInlineAskResponse('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [inlineAskOpen]);

  const getColorClasses = (colorId: string) => {
    return NOTE_COLORS.find(c => c.id === colorId) || NOTE_COLORS[0];
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const isEditingCurrentNote = !!(editingNote && viewingNote && editingNote.id === viewingNote.id);

  const renderContentWithDefinitions = (note: ProjectNote) => {
    const content = note.content || '';
    const definitions = note.termDefinitions || [];

    if (!definitions.length) {
      return content;
    }

    const map: Record<string, NoteTermDefinition> = {};
    for (const def of definitions) {
      if (def.term) {
        map[def.term.toLowerCase()] = def;
      }
    }

    const terms = Object.keys(map);
    if (!terms.length) {
      return content;
    }

    const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = terms.map(escapeRegExp).join('|');
    const regex = new RegExp(`(${pattern})`, 'gi');

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const matchIndex = match.index;
      if (matchIndex > lastIndex) {
        parts.push(content.slice(lastIndex, matchIndex));
      }

      const matchedText = match[0];
      const def = map[matchedText.toLowerCase()];
      if (def) {
        parts.push(
          <button
            key={`${def.id}-${matchIndex}-${parts.length}`}
            type="button"
            onClick={() => setActiveDefinition(def)}
            className={
              'underline decoration-dotted underline-offset-2 ' +
              (isDarkMode ? 'text-amber-300 hover:text-amber-200' : 'text-amber-700 hover:text-amber-800')
            }
          >
            {matchedText}
          </button>
        );
      } else {
        parts.push(matchedText);
      }

      lastIndex = matchIndex + matchedText.length;
    }

    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return parts;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 px-1 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Notes</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${isDarkMode ? 'text-slate-500 bg-slate-800' : 'text-gray-600 bg-gray-100'}`}>
            {notes.length} notes
          </span>
        </div>

        {isReadOnly ? (
          <div className={`text-xs font-medium px-3 py-1.5 rounded-full ${isDarkMode ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>
            View-only access · editing disabled
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {onOpenNoteMap && (
              <button
                onClick={onOpenNoteMap}
                disabled={isReadOnly}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                  ? 'bg-white/10 hover:bg-white/15 text-white'
                  : 'bg-white hover:bg-gray-50 text-gray-900 border border-gray-200'
                  }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 01.553-.894L9 2m0 18l6-3m-6 3V2m6 15l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 2" />
                </svg>
                <span className="md:hidden">NoteMap</span>
                <span className="hidden md:inline">Open NoteMap</span>
              </button>
            )}
            <button
              onClick={() => setShowAiInput(!showAiInput)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDarkMode
                ? 'bg-violet-600/20 hover:bg-violet-600/30 text-violet-300'
                : 'bg-violet-100 hover:bg-violet-200 text-violet-700'
                }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="md:hidden">Generate</span>
              <span className="hidden md:inline">AI Generate</span>
            </button>
            <button
              onClick={() => setIsAddingNote(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDarkMode
                ? 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-300'
                : 'bg-blue-100 hover:bg-blue-200 text-blue-700'
                }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="md:hidden">Add</span>
              <span className="hidden md:inline">Add Note</span>
            </button>
          </div>
        )}
      </div>

      {/* AI Generate Input */}
      {showAiInput && (
        <div className={`mb-4 p-3 rounded-xl border ${isDarkMode ? 'bg-violet-500/10 border-violet-500/20' : 'bg-violet-50 border-violet-200'
          }`}>
          <div className="flex items-center gap-2 mb-2">
            <svg className={`w-4 h-4 ${isDarkMode ? 'text-violet-400' : 'text-violet-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span className={`text-xs font-medium ${isDarkMode ? 'text-violet-300' : 'text-violet-700'}`}>
              Describe the note you want AI to create
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g., 'Key takeaways from the research' or 'Action items for next week'"
              className={`flex-1 text-sm px-3 py-2 rounded-lg outline-none border focus:border-violet-500/50 ${isDarkMode
                ? 'bg-slate-800/80 text-white border-white/5 placeholder-slate-500'
                : 'bg-white text-gray-900 border-gray-200 placeholder-gray-400'
                }`}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleGenerateNote();
                if (e.key === 'Escape') setShowAiInput(false);
              }}
            />
            <button
              onClick={handleGenerateNote}
              disabled={isGeneratingNote || !aiPrompt.trim()}
              className={`px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 ${isDarkMode ? 'bg-violet-600 hover:bg-violet-500 text-white' : 'bg-violet-600 hover:bg-violet-500 text-white'
                }`}
            >
              {isGeneratingNote ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              Generate
            </button>
          </div>
        </div>
      )}

      {/* Add Note Form */}
      {isAddingNote && (
        <div className={`mb-4 p-4 rounded-xl border ${isDarkMode ? 'bg-slate-800 border-white/10' : 'bg-white border-gray-200'
          }`}>
          <input
            type="text"
            value={newNoteTitle}
            onChange={(e) => setNewNoteTitle(e.target.value)}
            placeholder="Note title..."
            className={`w-full bg-transparent text-base font-medium outline-none mb-2 ${isDarkMode ? 'text-white placeholder-slate-500' : 'text-gray-900 placeholder-gray-400'
              }`}
            autoFocus
          />
          <textarea
            ref={newNoteTextareaRef}
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            placeholder="Write your note..."
            className={`w-full bg-transparent text-sm outline-none resize-none min-h-24 max-h-[800px] mb-3 ${isDarkMode ? 'text-slate-300 placeholder-slate-500' : 'text-gray-700 placeholder-gray-400'
              }`}
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {NOTE_COLORS.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedColor(c.id)}
                  className={`w-5 h-5 rounded-full ${c.color} border-2 ${selectedColor === c.id ? 'border-white' : 'border-transparent'
                    } transition-colors`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setIsAddingNote(false)}
                className={`px-3 py-1.5 text-sm ${isDarkMode ? 'text-slate-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={handleAddNote}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notes Grid */}
      <div className="flex-1 overflow-y-auto">
        {/* Pinned Notes */}
        {pinnedNotes.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2 px-1">
              <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V5z" />
              </svg>
              <span className="text-xs font-medium text-amber-400 uppercase tracking-wider">Pinned</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {pinnedNotes.map(note => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onView={() => {
                    setViewingNote(note);
                    setEditingNote(null);
                    setEditTitle('');
                    setEditContent('');
                    setAiSuggestions([]);
                  }}
                  onEdit={() => {
                    setViewingNote(note);
                    setEditingNote(note);
                    setEditTitle(note.title);
                    setEditContent(note.content);
                    setAiSuggestions([]);
                  }}
                  onPin={() => handleTogglePin(note)}
                  onDelete={() => handleDeleteNote(note.id)}
                  getColorClasses={getColorClasses}
                  formatDate={formatDate}
                  isDarkMode={isDarkMode}
                />
              ))}
            </div>
          </div>
        )}

        {/* Regular Notes */}
        {regularNotes.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {regularNotes.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                onView={() => {
                  setViewingNote(note);
                  setEditingNote(null);
                  setEditTitle('');
                  setEditContent('');
                  setAiSuggestions([]);
                }}
                onEdit={() => {
                  setViewingNote(note);
                  setEditingNote(note);
                  setEditTitle(note.title);
                  setEditContent(note.content);
                  setAiSuggestions([]);
                }}
                onPin={() => handleTogglePin(note)}
                onDelete={() => handleDeleteNote(note.id)}
                getColorClasses={getColorClasses}
                formatDate={formatDate}
                isDarkMode={isDarkMode}
              />
            ))}
          </div>
        )}

        {notes.length === 0 && !isAddingNote && (
          <div className={`flex flex-col items-center justify-center h-48 ${isDarkMode ? 'text-slate-500' : 'text-gray-500'
            }`}>
            <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">No notes yet</p>
            <p className="text-xs mt-1">Add notes to capture ideas and insights</p>
          </div>
        )}
      </div>

      {/* Note View Modal */}
      {viewingNote && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-0 sm:p-4">
          <div
            className={`w-full max-w-2xl h-full sm:h-auto sm:max-h-[80vh] sm:min-h-[320px] rounded-none sm:rounded-2xl flex flex-col overflow-hidden ${isDarkMode
              ? `${getColorClasses(viewingNote.color || 'default').color} border-0 sm:border ${getColorClasses(viewingNote.color || 'default').border}`
              : 'bg-white border-0 sm:border border-gray-200'
              }`}
          >
            {/* Modal Header */}
            <div className={`flex items-center justify-between p-4 border-b ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{formatDate(viewingNote.lastModified)}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleTogglePin(viewingNote)}
                  className={`p-3 sm:p-2 rounded-lg transition-colors ${isDarkMode
                    ? (viewingNote.pinned
                      ? 'text-amber-400 bg-amber-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/10')
                    : (viewingNote.pinned
                      ? 'text-amber-600 bg-amber-50'
                      : 'text-gray-500 hover:text-amber-600 hover:bg-amber-50')
                    }`}
                >
                  <svg className="w-4 h-4" fill={viewingNote.pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </button>

                <button
                  onClick={() => handlePlayAudio(viewingNote.content)}
                  disabled={audioLoading}
                  className={`p-3 sm:p-2 rounded-lg transition-colors ${isPlayingAudio
                    ? (isDarkMode ? 'text-green-400 bg-green-500/20' : 'text-green-600 bg-green-50')
                    : (isDarkMode ? 'text-slate-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100')
                    }`}
                  title={isPlayingAudio ? "Stop Audio" : "Read Note Aloud"}
                >
                  {audioLoading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : isPlayingAudio ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H2v6h4l5 4V5z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.54 8.46a5 5 0 010 7.07" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.07 4.93a10 10 0 010 14.14" />
                    </svg>
                  )}
                </button>

                <button
                  onClick={() => handleGetSuggestions(viewingNote)}
                  disabled={loadingSuggestions}
                  className={`p-3 sm:p-2 rounded-lg transition-colors ${isDarkMode
                    ? 'text-violet-400 hover:bg-violet-500/20'
                    : 'text-violet-500 hover:bg-violet-50'
                    } ${loadingSuggestions ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title="Get AI Suggestions"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </button>
                {!(viewingNote as any).isFromMap && (
                  <>
                    <button
                      onClick={() => {
                        if (!isEditingCurrentNote) {
                          setEditingNote(viewingNote);
                          setEditTitle(viewingNote.title);
                          setEditContent(viewingNote.content);
                        }
                      }}
                      className={`p-2 rounded-lg transition-colors ${isDarkMode
                        ? 'text-slate-300 hover:text-white hover:bg-white/10'
                        : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                      title={isEditingCurrentNote ? 'Editing note' : 'Edit note'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M4 20h4l9.768-9.768a2 2 0 000-2.828l-2.172-2.172a2 2 0 00-2.828 0L4 15.172V20z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteNote(viewingNote.id)}
                      className={`p-3 sm:p-2 rounded-lg transition-colors ${isDarkMode
                        ? 'text-red-400 hover:bg-red-500/20'
                        : 'text-red-500 hover:bg-red-50'
                        }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </>
                )}
                <button
                  onClick={() => { setViewingNote(null); setAiSuggestions([]); }}
                  className={`p-2 rounded-lg transition-colors ${isDarkMode
                    ? 'text-slate-400 hover:text-white hover:bg-white/10'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 p-4 overflow-y-auto">
              {/* AI Suggestions (now shown above the note content) */}
              {aiSuggestions.length > 0 && (
                <div className={`mb-4 p-3 rounded-lg border ${isDarkMode ? 'bg-violet-500/10 border-violet-500/20' : 'bg-violet-50 border-violet-200'
                  }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <svg className={`w-4 h-4 ${isDarkMode ? 'text-violet-400' : 'text-violet-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-violet-300' : 'text-violet-700'}`}>
                      AI Suggestions
                    </span>
                  </div>
                  <ul className="space-y-3">
                    {aiSuggestions.map((suggestion, idx) => (
                      <li key={idx} className="text-sm flex flex-col gap-1">
                        <div className="flex items-start gap-2">
                          <span className={isDarkMode ? 'text-violet-400 mt-0.5' : 'text-violet-500 mt-0.5'}>
                            •
                          </span>
                          <span className={isDarkMode ? 'text-slate-200' : 'text-gray-700'}>{suggestion}</span>
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleApplySuggestion(suggestion)}
                            className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${isDarkMode
                              ? 'border-violet-500/40 text-violet-200 hover:bg-violet-500/20'
                              : 'border-violet-400 text-violet-700 hover:bg-violet-50'
                              }`}
                          >
                            Apply as new note
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {isEditingCurrentNote ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className={`w-full bg-transparent text-lg font-semibold outline-none border-b pb-1 ${isDarkMode ? 'text-white border-white/20 placeholder-slate-500' : 'text-gray-900 border-gray-300 placeholder-gray-400'
                      }`}
                    placeholder="Note title"
                  />
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className={`w-full bg-transparent text-sm outline-none resize-none min-h-[140px] leading-relaxed ${isDarkMode ? 'text-slate-300 placeholder-slate-500' : 'text-gray-700 placeholder-gray-400'
                      }`}
                    placeholder="Edit note content"
                  />
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={() => {
                        setEditingNote(null);
                        setEditTitle('');
                        setEditContent('');
                      }}
                      className={
                        isDarkMode
                          ? 'px-3 py-1.5 text-xs rounded-lg text-slate-300 hover:text-white hover:bg-white/10'
                          : 'px-3 py-1.5 text-xs rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                      }
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        const updatedTitle = editTitle.trim() || viewingNote.title;
                        handleUpdateNote(viewingNote.id, {
                          title: updatedTitle,
                          content: editContent,
                          lastModified: Date.now(),
                        });
                      }}
                      className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500"
                    >
                      Save changes
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className={`text-xl font-semibold mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{viewingNote.title}</h2>

                  {/* Modal Rich Media Preview */}
                  {(viewingNote.imageUrl || viewingNote.youtubeVideoId) && (
                    <div className="relative aspect-video mb-4 rounded-xl overflow-hidden bg-black/20 border border-white/5">
                      {viewingNote.imageUrl && (
                        <img
                          src={viewingNote.imageUrl}
                          alt={viewingNote.title}
                          className="w-full h-full object-contain"
                        />
                      )}
                      {viewingNote.youtubeVideoId && !viewingNote.imageUrl && (
                        <iframe
                          className="w-full h-full border-0"
                          src={`https://www.youtube.com/embed/${viewingNote.youtubeVideoId}`}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      )}
                    </div>
                  )}

                  {viewingNote.videoUrl && !viewingNote.imageUrl && (
                    <div className="mb-4 rounded-xl overflow-hidden bg-black/20 border border-white/5">
                      <video
                        src={viewingNote.videoUrl}
                        controls
                        className="w-full h-auto max-h-[400px]"
                      />
                    </div>
                  )}
                  {activeDefinition && (
                    <div
                      className={`mb-3 p-3 rounded-lg border ${isDarkMode ? 'bg-amber-500/10 border-amber-400/40' : 'bg-amber-50 border-amber-200'
                        }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className={`text-xs font-semibold uppercase tracking-wide ${isDarkMode ? 'text-amber-200' : 'text-amber-700'
                            }`}
                        >
                          Definition
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveDefinition(null)}
                          className={
                            isDarkMode
                              ? 'text-amber-200/70 hover:text-amber-100 text-[11px]'
                              : 'text-amber-700/70 hover:text-amber-900 text-[11px]'
                          }
                        >
                          Clear
                        </button>
                      </div>
                      <p className={`text-xs ${isDarkMode ? 'text-amber-100' : 'text-amber-900'}`}>
                        <span className="font-semibold">{activeDefinition.term}</span>: {activeDefinition.definition}
                      </p>
                    </div>
                  )}


                  <p
                    ref={contentRef}
                    onMouseUp={handleNoteContentMouseUp}
                    className={`whitespace-pre-wrap break-words leading-relaxed ${isDarkMode ? 'text-slate-300' : 'text-gray-700'
                      }`}
                  >
                    {renderContentWithDefinitions(viewingNote)}
                  </p>

                  {/* Inline AI Ask Popover */}
                  {inlineAskOpen && typeof document !== 'undefined' && createPortal(
                    <div
                      className="inline-ask-popover fixed z-[100] animate-in fade-in slide-in-from-top-2 duration-200"
                      style={{
                        left: `${Math.max(16, Math.min(inlineAskPosition.x - 160, window.innerWidth - 336))}px`,
                        top: `${inlineAskPosition.y}px`,
                      }}
                    >
                      <div className={`w-80 rounded-xl shadow-2xl border backdrop-blur-xl ${isDarkMode
                        ? 'bg-slate-900/95 border-white/10'
                        : 'bg-white/95 border-gray-200'
                        }`}>
                        {/* Selected text preview */}
                        <div
                          className={`px-3 py-2 border-b cursor-move ${isDarkMode ? 'border-white/10' : 'border-gray-100'}`}
                          onMouseDown={handleDragStart}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <svg className={`w-3.5 h-3.5 ${isDarkMode ? 'text-violet-400' : 'text-violet-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                            </svg>
                            <span className={`text-[10px] font-medium uppercase tracking-wide ${isDarkMode ? 'text-violet-300' : 'text-violet-600'
                              }`}>Ask about selection</span>
                          </div>
                          <p className={`text-xs line-clamp-2 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                            "{inlineAskSelectedText.slice(0, 100)}{inlineAskSelectedText.length > 100 ? '...' : ''}"
                          </p>
                        </div>

                        {/* Input and Ask button */}
                        <div className="p-2">
                          <div className="flex gap-2">
                            <input
                              ref={inlineAskInputRef}
                              type="text"
                              value={inlineAskPrompt}
                              onChange={(e) => setInlineAskPrompt(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  handleInlineAsk();
                                }
                                if (e.key === 'Escape') {
                                  setInlineAskOpen(false);
                                }
                              }}
                              placeholder="What would you like to know?"
                              className={`flex-1 text-xs px-3 py-2 rounded-lg outline-none border focus:ring-2 focus:ring-violet-500/30 ${isDarkMode
                                ? 'bg-slate-800 text-white border-white/10 placeholder-slate-500'
                                : 'bg-gray-50 text-gray-900 border-gray-200 placeholder-gray-400'
                                }`}
                            />
                            <button
                              onClick={handleInlineAsk}
                              disabled={inlineAskLoading || !inlineAskPrompt.trim()}
                              className={`px-3 py-2 text-xs font-medium rounded-lg transition-all disabled:opacity-50 flex items-center gap-1.5 ${isDarkMode
                                ? 'bg-violet-600 hover:bg-violet-500 text-white'
                                : 'bg-violet-600 hover:bg-violet-500 text-white'
                                }`}
                            >
                              {inlineAskLoading ? (
                                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                              )}
                              Ask
                            </button>
                          </div>
                        </div>

                        {/* AI Response */}
                        {inlineAskResponse && (
                          <div className={`px-3 pb-3 pt-1 border-t ${isDarkMode ? 'border-white/10' : 'border-gray-100'
                            }`}>
                            <div className="flex items-center gap-1.5 mb-2">
                              <svg className={`w-3 h-3 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                              <span className={`text-[10px] font-medium uppercase tracking-wide ${isDarkMode ? 'text-emerald-300' : 'text-emerald-600'
                                }`}>AI Response</span>
                            </div>
                            <div className={`text-xs leading-relaxed max-h-60 overflow-y-auto prose prose-sm ${isDarkMode ? 'prose-invert text-slate-200' : 'text-gray-700'
                              }`}>
                              <ReactMarkdown>{inlineAskResponse}</ReactMarkdown>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>,
                    document.body
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Note Card Component
const NoteCard: React.FC<{
  note: ProjectNote;
  onView: () => void;
  onEdit: () => void;
  onPin: () => void;
  onDelete: () => void;
  getColorClasses: (colorId: string) => { color: string; border: string };
  formatDate: (timestamp: number) => string;
  isDarkMode?: boolean;
}> = ({ note, onView, onEdit, onPin, onDelete, getColorClasses, formatDate, isDarkMode = true }) => {
  const colors = getColorClasses(note.color || 'default');

  // Light-mode palette for notes: pale backgrounds matching the selected color
  const lightColorMap: Record<string, string> = {
    default: 'bg-slate-50 border border-slate-200',
    blue: 'bg-blue-50 border border-blue-200',
    green: 'bg-emerald-50 border border-emerald-200',
    yellow: 'bg-amber-50 border border-amber-200',
    pink: 'bg-pink-50 border border-pink-200',
    purple: 'bg-violet-50 border border-violet-200',
  };

  const lightClasses = lightColorMap[note.color || 'default'] || 'bg-white border border-gray-200';

  const cardBaseClasses = isDarkMode
    ? `${colors.color} border ${colors.border}`
    : lightClasses;

  return (
    <div
      id={`note-${note.id}`}
      onClick={onView}
      className={`group p-3 rounded-xl ${cardBaseClasses} cursor-pointer transition-shadow hover:shadow-lg`}
    >
      <div className="flex items-start justify-between mb-2">
        <h4 className={`text-sm font-medium line-clamp-1 flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{note.title}</h4>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!(note as any).isFromMap && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onPin(); }}
                className={`p-1 rounded transition-colors ${isDarkMode
                  ? (note.pinned
                    ? 'text-amber-400'
                    : 'text-slate-400 hover:text-amber-400')
                  : (note.pinned
                    ? 'text-amber-600 bg-amber-50'
                    : 'text-gray-500 hover:text-amber-600 hover:bg-amber-50')
                  }`}
                title={note.pinned ? 'Unpin note' : 'Pin note'}
              >
                <svg className="w-3.5 h-3.5" fill={note.pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className={`p-1 rounded transition-colors ${isDarkMode
                  ? 'text-slate-300 hover:text-white hover:bg-white/10'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                title="Edit note"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M4 20h4l9.768-9.768a2 2 0 000-2.828l-2.172-2.172a2 2 0 00-2.828 0L4 15.172V20z" />
                </svg>
              </button>
            </>
          )}
          {(note as any).isFromMap && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-md ${isDarkMode ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-indigo-50 text-indigo-600 border border-indigo-100'}`}>Map</span>
          )}
        </div>
      </div>

      {/* Rich Media Preview */}
      {(note.imageUrl || note.youtubeVideoId) && (
        <div className="relative aspect-video mb-3 rounded-lg overflow-hidden bg-black/20 border border-white/5">
          {note.imageUrl && (
            <img
              src={note.imageUrl}
              alt={note.title}
              className="w-full h-full object-cover"
            />
          )}
          {note.youtubeVideoId && !note.imageUrl && (
            <div className="w-full h-full flex items-center justify-center bg-slate-900">
              <img
                src={`https://img.youtube.com/vi/${note.youtubeVideoId}/mqdefault.jpg`}
                alt="YouTube Thumbnail"
                className="w-full h-full object-cover opacity-60"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {note.videoUrl && !note.imageUrl && (
        <div className="relative aspect-video mb-3 rounded-lg overflow-hidden bg-black/20 border border-white/5 flex items-center justify-center">
          <svg className="w-8 h-8 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className="absolute bottom-2 right-2 text-[9px] font-medium px-1.5 py-0.5 rounded bg-black/50 text-white">Video</span>
        </div>
      )}

      <p className={`text-xs line-clamp-3 mb-2 ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>{note.content}</p>
      <div className="flex items-center justify-between">
        <span className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>{formatDate(note.lastModified)}</span>
        <div className="flex items-center gap-1">
          {note.pinned && (
            <svg className="w-3 h-3 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
              <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V5z" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
};
