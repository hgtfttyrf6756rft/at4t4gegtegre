import React, { useState, useRef, useEffect } from 'react';
import {
  generatePodcastScript,
  generatePodcastAudio,
  TTS_VOICES,
  PodcastScript,
  PodcastAudio
} from '../services/geminiService';
import { storageService } from '../services/storageService';
import { KnowledgeBaseFile, ResearchProject, SavedResearch } from '../types';
import { checkUsageLimit, incrementUsage } from '../services/usageService';
import { UsageLimitModal } from './UsageLimitModal';

interface PodcastStudioProps {
  project: ResearchProject;
  savedResearch: SavedResearch[];
  isDarkMode?: boolean;
  onClose?: () => void;
  onProjectUpdate?: (project: ResearchProject) => void;
  onLocalPodcastAdd?: (file: KnowledgeBaseFile) => void;
  isSubscribed?: boolean;
  onUpgrade?: () => void;
}

type PodcastStyle = 'conversational' | 'educational' | 'debate' | 'interview';
type PodcastDuration = 'short' | 'medium' | 'long';

interface GeneratedPodcast {
  script: PodcastScript;
  audio?: PodcastAudio;
  audioUrl?: string;
  generatedAt: Date;
}

const PodcastStudio: React.FC<PodcastStudioProps> = ({
  project,
  savedResearch,
  isDarkMode = true,
  onClose,
  onProjectUpdate,
  onLocalPodcastAdd,
  isSubscribed = false,
  onUpgrade,
}) => {
  const [step, setStep] = useState<'configure' | 'script' | 'audio' | 'complete'>('configure');
  const [style, setStyle] = useState<PodcastStyle>('conversational');
  const [duration, setDuration] = useState<PodcastDuration>('medium');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [podcast, setPodcast] = useState<GeneratedPodcast | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [editingScript, setEditingScript] = useState(false);
  const [editedSegments, setEditedSegments] = useState<{ speaker: string; text: string }[]>([]);
  const [usageLimitModal, setUsageLimitModal] = useState<{ isOpen: boolean; current: number; limit: number } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const styleOptions: { value: PodcastStyle; label: string; description: string; icon: string }[] = [
    { value: 'conversational', label: 'Conversational', description: 'Friendly discussion between hosts', icon: '💬' },
    { value: 'educational', label: 'Educational', description: 'Expert explains to curious learner', icon: '📚' },
    { value: 'debate', label: 'Debate', description: 'Two perspectives, one topic', icon: '⚖️' },
    { value: 'interview', label: 'Interview', description: 'Q&A with an expert', icon: '🎤' }
  ];

  const durationOptions: { value: PodcastDuration; label: string; time: string }[] = [
    { value: 'short', label: 'Quick', time: '2-3 min' },
    { value: 'medium', label: 'Standard', time: '5-7 min' },
    { value: 'long', label: 'Deep Dive', time: '10-15 min' }
  ];

  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      if (podcast?.audioUrl) {
        URL.revokeObjectURL(podcast.audioUrl);
      }
    };
  }, [podcast?.audioUrl]);

  const handleGenerateScript = async () => {
    const usageCheck = await checkUsageLimit('podcast', isSubscribed);
    if (!usageCheck.allowed) {
      setUsageLimitModal({ isOpen: true, current: usageCheck.current, limit: usageCheck.limit });
      return;
    }

    setIsGenerating(true);
    setError(null);
    setProgressMessage('Crafting your podcast script...');

    try {
      await incrementUsage('podcast');
      const researchSummaries = savedResearch.map(r => ({
        topic: r.topic,
        summary: r.researchReport?.summary || r.researchReport?.tldr || '',
        keyPoints: r.researchReport?.keyPoints?.map(kp => kp.title) || []
      }));

      // Include uploaded files for additional context
      const uploadedFiles = project.uploadedFiles?.map(f => ({
        displayName: f.displayName,
        name: f.name,
        mimeType: f.mimeType,
        summary: f.summary
      }));

      const notes = project.notes || [];
      const noteSnippets = notes
        .slice(0, 10)
        .map(note => {
          const title = note.title || 'Untitled note';
          const body = (note.content || '').trim();
          const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
          return `${title}: ${snippet || 'No content'}`;
        })
        .join('\n');

      const descriptionWithNotes = noteSnippets
        ? `${project.description}\n\nKey project notes:\n${noteSnippets}`
        : project.description;

      const script = await generatePodcastScript(
        project.name,
        descriptionWithNotes,
        researchSummaries,
        style,
        duration,
        uploadedFiles
      );

      setPodcast({ script, generatedAt: new Date() });
      setEditedSegments(script.segments);
      setStep('script');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate script');
    } finally {
      setIsGenerating(false);
      setProgressMessage('');
    }
  };

  const handleGenerateAudio = async () => {
    if (!podcast?.script) return;

    setIsGenerating(true);
    setError(null);

    try {
      const scriptToUse = editingScript
        ? { ...podcast.script, segments: editedSegments }
        : podcast.script;

      const audio = await generatePodcastAudio(scriptToUse, setProgressMessage);

      const audioBlob = base64ToBlob(audio.audioData, audio.mimeType);
      const audioUrl = URL.createObjectURL(audioBlob);

      // Immediately update local state so the UI can move to the player step
      setPodcast(prev => prev ? {
        ...prev,
        script: scriptToUse,
        audio,
        audioUrl
      } : null);
      setStep('complete');

      // Fire-and-forget upload so Firestore persistence cannot block the UI
      (async () => {
        try {
          const safeTitle = scriptToUse.title || 'podcast';
          const fileName = `${safeTitle.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.wav`;
          const file = new File([audioBlob], fileName, { type: audio.mimeType || 'audio/wav' });
          const kbFile = await storageService.uploadKnowledgeBaseFile(project.id, file);

          // CRITICAL: Verify we got a valid persistent URL (Vercel Blob), NOT a local blob: URL
          if (kbFile.url.startsWith('blob:')) {
            console.error('Upload failed to return a persistent URL, returned blob: instead. Skipping Firestore persistence.');
            // We do NOT persist to project.knowledgeBase to avoid saving broken links that only work on this device temporarily.
            // But we DO trigger onLocalPodcastAdd so the user sees it in the current session.
            throw new Error('Upload returned temporary blob URL - not persisting to shared project.');
          }

          const existingKb = project.knowledgeBase || [];
          const updatedKnowledgeBase = [...existingKb, kbFile];

          // Persist updated knowledge base to Firestore/local caches
          await storageService.updateResearchProject(project.id, { knowledgeBase: updatedKnowledgeBase });

          // Also update the in-memory project so Assets can see the podcast immediately
          if (onProjectUpdate) {
            const updatedProject: ResearchProject = {
              ...project,
              knowledgeBase: updatedKnowledgeBase,
              lastModified: Date.now(),
            };
            onProjectUpdate(updatedProject);
          }

          // Let the dashboard know a new podcast asset exists so Assets can reflect it immediately
          onLocalPodcastAdd?.(kbFile);
        } catch (e) {
          console.error('Failed to save podcast audio to project knowledge base', e);

          // If persistence fails (e.g. user not logged in), still surface a local-only podcast asset
          try {
            const safeTitle = scriptToUse.title || 'podcast';
            const localFile: KnowledgeBaseFile = {
              id: `local-podcast-${Date.now()}`,
              name: `${safeTitle.replace(/[^a-z0-9]/gi, '_')}.wav`,
              type: audio.mimeType || 'audio/wav',
              size: audioBlob.size,
              url: audioUrl,
              storagePath: '',
              uploadedAt: Date.now(),
            };
            onLocalPodcastAdd?.(localFile);
          } catch (inner) {
            console.error('Failed to create local podcast asset after persistence error', inner);
          }
        }
      })();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate audio');
    } finally {
      setIsGenerating(false);
      setProgressMessage('');
    }
  };

  const base64ToBlob = (base64: string, mimeType: string): Blob => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  };

  const handlePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleAudioLoaded = () => {
    if (audioRef.current) {
      setAudioDuration(audioRef.current.duration);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleDownload = () => {
    if (!podcast?.audioUrl || !podcast.script) return;

    const link = document.createElement('a');
    link.href = podcast.audioUrl;
    link.download = `${podcast.script.title.replace(/[^a-z0-9]/gi, '_')}.wav`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEditSegment = (index: number, newText: string) => {
    setEditedSegments(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], text: newText };
      return updated;
    });
  };

  return (
    <div className={`w-full h-full overflow-y-auto ${isDarkMode ? 'bg-[#000000]' : 'bg-[#fafafa]'}`}>
      <div className="max-w-4xl mx-auto px-6 md:px-8 py-8 md:py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className={`text-xs font-medium uppercase tracking-[0.16em] mb-1 ${isDarkMode ? 'text-white/60' : 'text-gray-500'
              }`}>
              Create a podcast
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isDarkMode ? 'bg-white/[0.06] hover:bg-white/[0.1] text-white' : 'bg-black/[0.04] hover:bg-black/[0.08] text-black'
                }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Progress Steps */}
        <div className="flex items-center gap-2 mb-10">
          {['Configure', 'Script', 'Generate', 'Listen'].map((label, idx) => {
            const stepOrder = ['configure', 'script', 'audio', 'complete'];
            const currentIdx = stepOrder.indexOf(step);
            const isActive = idx === currentIdx;
            const isComplete = idx < currentIdx;

            return (
              <React.Fragment key={label}>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-medium transition-all ${isComplete
                        ? 'bg-[#30d158] text-white'
                        : isActive
                          ? 'bg-[#0071e3] text-white'
                          : isDarkMode ? 'bg-white/[0.06] text-white/40' : 'bg-black/[0.04] text-black/40'
                      }`}
                  >
                    {isComplete ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      idx + 1
                    )}
                  </div>
                  <span className={`text-[13px] font-medium hidden sm:block ${isActive ? (isDarkMode ? 'text-white' : 'text-[#1d1d1f]') : (isDarkMode ? 'text-white/40' : 'text-black/40')
                    }`}>
                    {label}
                  </span>
                </div>
                {idx < 3 && (
                  <div className={`flex-1 h-[2px] rounded-full max-w-12 ${idx < currentIdx ? 'bg-[#30d158]' : isDarkMode ? 'bg-white/[0.08]' : 'bg-black/[0.06]'
                    }`} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Error Display */}
        {error && (
          <div className={`mb-6 p-4 rounded-2xl border ${isDarkMode ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-[14px]">{error}</p>
            </div>
          </div>
        )}

        {/* Step 1: Configure */}
        {step === 'configure' && (
          <div className="space-y-8 animate-fade-in">
            {/* Research Context */}
            <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#1c1c1e]/60 border-white/[0.06]' : 'bg-white/70 border-black/[0.04]'}`}>
              <h3 className={`text-[15px] font-semibold mb-3 ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                Content Sources
              </h3>
              <p className={`text-[14px] mb-4 ${isDarkMode ? 'text-[#86868b]' : 'text-[#6b7280]'}`}>
                Your podcast will be based on {savedResearch.length} research session{savedResearch.length !== 1 ? 's' : ''}
                {project.uploadedFiles && project.uploadedFiles.length > 0 && ` and ${project.uploadedFiles.length} uploaded file${project.uploadedFiles.length !== 1 ? 's' : ''}`}
              </p>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {savedResearch.slice(0, 5).map((r, i) => (
                    <span
                      key={i}
                      className={`px-3 py-1.5 rounded-full text-[12px] font-medium ${isDarkMode ? 'bg-white/[0.06] text-white/70' : 'bg-black/[0.04] text-black/60'
                        }`}
                    >
                      📚 {r.topic}
                    </span>
                  ))}
                  {savedResearch.length > 5 && (
                    <span className={`px-3 py-1.5 rounded-full text-[12px] font-medium ${isDarkMode ? 'bg-white/[0.06] text-white/50' : 'bg-black/[0.04] text-black/40'
                      }`}>
                      +{savedResearch.length - 5} more
                    </span>
                  )}
                </div>
                {project.uploadedFiles && project.uploadedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {project.uploadedFiles.slice(0, 5).map((f, i) => (
                      <span
                        key={i}
                        className={`px-3 py-1.5 rounded-full text-[12px] font-medium ${isDarkMode ? 'bg-[#5e5ce6]/10 text-[#5e5ce6]' : 'bg-indigo-50 text-indigo-600'
                          }`}
                      >
                        📎 {f.displayName || f.name}
                      </span>
                    ))}
                    {project.uploadedFiles.length > 5 && (
                      <span className={`px-3 py-1.5 rounded-full text-[12px] font-medium ${isDarkMode ? 'bg-[#5e5ce6]/10 text-[#5e5ce6]/70' : 'bg-indigo-50 text-indigo-500'
                        }`}>
                        +{project.uploadedFiles.length - 5} more files
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Style Selection */}
            <div>
              <h3 className={`text-[15px] font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                Podcast Style
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {styleOptions.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setStyle(option.value)}
                    className={`p-4 rounded-2xl border text-left transition-all ${style === option.value
                        ? 'border-[#0071e3] bg-[#0071e3]/10'
                        : isDarkMode
                          ? 'border-white/[0.06] bg-[#1c1c1e]/60 hover:bg-[#1c1c1e]'
                          : 'border-black/[0.04] bg-white/70 hover:bg-white'
                      }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xl">{option.icon}</span>
                      <span className={`text-[15px] font-medium ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                        {option.label}
                      </span>
                    </div>
                    <p className={`text-[13px] ${isDarkMode ? 'text-[#86868b]' : 'text-[#6b7280]'}`}>
                      {option.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Duration Selection */}
            <div>
              <h3 className={`text-[15px] font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                Episode Length
              </h3>
              <div className="flex gap-3">
                {durationOptions.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setDuration(option.value)}
                    className={`flex-1 p-4 rounded-2xl border text-center transition-all ${duration === option.value
                        ? 'border-[#0071e3] bg-[#0071e3]/10'
                        : isDarkMode
                          ? 'border-white/[0.06] bg-[#1c1c1e]/60 hover:bg-[#1c1c1e]'
                          : 'border-black/[0.04] bg-white/70 hover:bg-white'
                      }`}
                  >
                    <div className={`text-[15px] font-medium mb-1 ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                      {option.label}
                    </div>
                    <div className={`text-[13px] ${isDarkMode ? 'text-[#86868b]' : 'text-[#6b7280]'}`}>
                      {option.time}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Generate Button */}
            <button
              onClick={handleGenerateScript}
              disabled={isGenerating}
              className="w-full py-4 rounded-2xl bg-[#0071e3] text-white font-semibold text-[16px] transition-all hover:bg-[#0077ed] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              {isGenerating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {progressMessage || 'Generating...'}
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate Script
                </>
              )}
            </button>
          </div>
        )}

        {/* Step 2: Script Review */}
        {step === 'script' && podcast?.script && (
          <div className="space-y-6 animate-fade-in">
            {/* Script Header */}
            <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#1c1c1e]/60 border-white/[0.06]' : 'bg-white/70 border-black/[0.04]'}`}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className={`text-[20px] font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                    {podcast.script.title}
                  </h2>
                  <p className={`text-[14px] ${isDarkMode ? 'text-[#86868b]' : 'text-[#6b7280]'}`}>
                    {podcast.script.description}
                  </p>
                </div>
                <span className={`px-3 py-1.5 rounded-full text-[12px] font-medium ${isDarkMode ? 'bg-white/[0.06] text-white/60' : 'bg-black/[0.04] text-black/50'
                  }`}>
                  ~{podcast.script.estimatedDuration}
                </span>
              </div>

              {/* Speakers */}
              <div className="flex gap-4">
                {podcast.script.speakers.map((speaker, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold"
                      style={{ background: i === 0 ? '#0071e3' : '#5856d6' }}
                    >
                      {speaker.name.charAt(0)}
                    </div>
                    <div>
                      <div className={`text-[13px] font-medium ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                        {speaker.name}
                      </div>
                      <div className={`text-[11px] ${isDarkMode ? 'text-[#86868b]' : 'text-[#6b7280]'}`}>
                        {speaker.role} • {speaker.voiceName}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Edit Toggle */}
            <div className="flex items-center justify-between">
              <h3 className={`text-[15px] font-semibold ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                Script Preview
              </h3>
              <button
                onClick={() => setEditingScript(!editingScript)}
                className={`px-4 py-2 rounded-full text-[13px] font-medium transition-all ${editingScript
                    ? 'bg-[#0071e3] text-white'
                    : isDarkMode ? 'bg-white/[0.06] text-white hover:bg-white/[0.1]' : 'bg-black/[0.04] text-black hover:bg-black/[0.08]'
                  }`}
              >
                {editingScript ? 'Done Editing' : 'Edit Script'}
              </button>
            </div>

            {/* Script Segments */}
            <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-[#1c1c1e]/40 border-white/[0.06]' : 'bg-white/50 border-black/[0.04]'}`}>
              <div className="max-h-[400px] overflow-y-auto p-4 space-y-3">
                {(editingScript ? editedSegments : podcast.script.segments).map((segment, i) => {
                  const speaker = podcast.script.speakers.find(s => s.name === segment.speaker);
                  const speakerIndex = podcast.script.speakers.findIndex(s => s.name === segment.speaker);

                  return (
                    <div key={i} className="flex gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                        style={{ background: speakerIndex === 0 ? '#0071e3' : '#5856d6' }}
                      >
                        {segment.speaker.charAt(0)}
                      </div>
                      <div className="flex-1">
                        <div className={`text-[12px] font-medium mb-1 ${isDarkMode ? 'text-white/60' : 'text-black/50'}`}>
                          {segment.speaker}
                        </div>
                        {editingScript ? (
                          <textarea
                            value={segment.text}
                            onChange={(e) => handleEditSegment(i, e.target.value)}
                            className={`w-full p-3 rounded-xl text-[14px] leading-relaxed resize-none border ${isDarkMode
                                ? 'bg-white/[0.04] border-white/[0.08] text-white focus:border-[#0071e3]'
                                : 'bg-black/[0.02] border-black/[0.06] text-black focus:border-[#0071e3]'
                              } outline-none transition-colors`}
                            rows={3}
                          />
                        ) : (
                          <p className={`text-[14px] leading-relaxed ${isDarkMode ? 'text-white/90' : 'text-black/80'}`}>
                            {segment.text}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setStep('configure')}
                className={`flex-1 py-4 rounded-2xl font-medium text-[15px] transition-all ${isDarkMode
                    ? 'bg-white/[0.06] text-white hover:bg-white/[0.1]'
                    : 'bg-black/[0.04] text-black hover:bg-black/[0.08]'
                  }`}
              >
                Regenerate Script
              </button>
              <button
                onClick={handleGenerateAudio}
                disabled={isGenerating}
                className="flex-1 py-4 rounded-2xl bg-[#0071e3] text-white font-semibold text-[15px] transition-all hover:bg-[#0077ed] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {progressMessage || 'Generating...'}
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                    Generate Audio
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Audio Player */}
        {step === 'complete' && podcast?.audioUrl && (
          <div className="space-y-6 animate-fade-in">
            {/* Audio hidden element */}
            <audio
              ref={audioRef}
              src={podcast.audioUrl}
              onLoadedMetadata={handleAudioLoaded}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
            />

            {/* Player Card */}
            <div
              className={`p-8 rounded-3xl border ${isDarkMode ? 'bg-[#1c1c1e]/80 border-white/[0.06]' : 'bg-white/80 border-black/[0.04]'}`}
              style={{
                background: isDarkMode
                  ? 'linear-gradient(145deg, rgba(28,28,30,0.9), rgba(0,0,0,0.8))'
                  : 'linear-gradient(145deg, rgba(255,255,255,0.95), rgba(250,250,250,0.9))'
              }}
            >
              {/* Album Art Placeholder */}
              <div className="w-full aspect-square max-w-[280px] mx-auto mb-8 rounded-2xl overflow-hidden" style={{
                background: 'linear-gradient(135deg, #0071e3, #5856d6, #bf5af2)'
              }}>
                <div className="w-full h-full flex flex-col items-center justify-center text-white p-6">
                  <svg className="w-16 h-16 mb-4 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <h3 className="text-xl font-semibold text-center mb-2">{podcast.script.title}</h3>
                  <p className="text-sm opacity-70 text-center">{project.name}</p>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mb-4">
                <input
                  type="range"
                  min={0}
                  max={audioDuration || 100}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full h-1 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #0071e3 ${(currentTime / audioDuration) * 100}%, ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'} ${(currentTime / audioDuration) * 100}%)`
                  }}
                />
                <div className="flex justify-between mt-2">
                  <span className={`text-[12px] ${isDarkMode ? 'text-white/50' : 'text-black/50'}`}>
                    {formatTime(currentTime)}
                  </span>
                  <span className={`text-[12px] ${isDarkMode ? 'text-white/50' : 'text-black/50'}`}>
                    {formatTime(audioDuration)}
                  </span>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-6">
                <button
                  onClick={() => audioRef.current && (audioRef.current.currentTime -= 15)}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isDarkMode ? 'hover:bg-white/[0.1]' : 'hover:bg-black/[0.05]'
                    }`}
                >
                  <svg className={`w-6 h-6 ${isDarkMode ? 'text-white' : 'text-black'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                  </svg>
                </button>

                <button
                  onClick={handlePlayPause}
                  className="w-16 h-16 rounded-full bg-[#0071e3] flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95"
                >
                  {isPlaying ? (
                    <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-7 h-7 ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                <button
                  onClick={() => audioRef.current && (audioRef.current.currentTime += 15)}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isDarkMode ? 'hover:bg-white/[0.1]' : 'hover:bg-black/[0.05]'
                    }`}
                >
                  <svg className={`w-6 h-6 ${isDarkMode ? 'text-white' : 'text-black'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setStep('script')}
                className={`flex-1 py-4 rounded-2xl font-medium text-[15px] transition-all ${isDarkMode
                    ? 'bg-white/[0.06] text-white hover:bg-white/[0.1]'
                    : 'bg-black/[0.04] text-black hover:bg-black/[0.08]'
                  }`}
              >
                Edit Script
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 py-4 rounded-2xl bg-[#30d158] text-white font-semibold text-[15px] transition-all hover:bg-[#2bc550] active:scale-[0.99] flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Podcast
              </button>
            </div>

            {/* Script Summary */}
            <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-[#1c1c1e]/40 border-white/[0.06]' : 'bg-white/50 border-black/[0.04]'}`}>
              <h4 className={`text-[14px] font-semibold mb-3 ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                Episode Details
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className={`text-[12px] ${isDarkMode ? 'text-[#86868b]' : 'text-[#6b7280]'}`}>Hosts</div>
                  <div className={`text-[14px] font-medium ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                    {podcast.script.speakers.map(s => s.name).join(' & ')}
                  </div>
                </div>
                <div>
                  <div className={`text-[12px] ${isDarkMode ? 'text-[#86868b]' : 'text-[#6b7280]'}`}>Duration</div>
                  <div className={`text-[14px] font-medium ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                    {formatTime(audioDuration)}
                  </div>
                </div>
                <div>
                  <div className={`text-[12px] ${isDarkMode ? 'text-[#86868b]' : 'text-[#6b7280]'}`}>Style</div>
                  <div className={`text-[14px] font-medium capitalize ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                    {style}
                  </div>
                </div>
                <div>
                  <div className={`text-[12px] ${isDarkMode ? 'text-[#86868b]' : 'text-[#6b7280]'}`}>Generated</div>
                  <div className={`text-[14px] font-medium ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                    {podcast.generatedAt.toLocaleTimeString()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {usageLimitModal && (
        <UsageLimitModal
          isOpen={usageLimitModal.isOpen}
          onClose={() => setUsageLimitModal(null)}
          onUpgrade={() => {
            setUsageLimitModal(null);
            onUpgrade?.();
          }}
          isDarkMode={isDarkMode}
          usageType="podcast"
          current={usageLimitModal.current}
          limit={usageLimitModal.limit}
          isSubscribed={isSubscribed}
        />
      )}
    </div>
  );
};

export default PodcastStudio;
